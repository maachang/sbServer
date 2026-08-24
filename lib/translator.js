/**
 * Transformers.js 常駐型・動的切り替え対応 プロンプト翻訳モジュール
 */
const fs = require('node:fs');
const path = require('node:path');

let activeModelId = null;
let currentPipe = null;
let loadPromise = null;

// モデルダウンロード/ロードの進捗状況
const currentLoadProgress = {
    modelId: null,
    status: 'idle', // 'idle' | 'downloading' | 'loading' | 'ready' | 'error'
    file: '',
    progress: 0,
    loaded: 0,
    total: 0,
    message: '',
    updatedAt: Date.now()
};

function loadConf(confName) {
    if (typeof $loadConf !== 'undefined') {
        return $loadConf(confName);
    }
    try {
        const localPath = path.join(process.cwd(), 'conf', `${confName}.local.json`);
        const confPath = path.join(process.cwd(), 'conf', `${confName}.json`);
        if (fs.existsSync(localPath)) {
            return JSON.parse(fs.readFileSync(localPath, 'utf8'));
        }
        if (fs.existsSync(confPath)) {
            return JSON.parse(fs.readFileSync(confPath, 'utf8'));
        }
    } catch (e) {}
    return null;
}

function saveConf(confName, data) {
    try {
        const confPath = path.join(process.cwd(), 'conf', `${confName}.json`);
        fs.writeFileSync(confPath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[translator] Failed to save config:', e);
        return false;
    }
}

// キャッシュベースディレクトリの取得
function getCacheBaseDir() {
    return path.join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache');
}

// モデルのキャッシュディレクトリパス取得
function getModelCachePath(modelId) {
    if (!modelId) return null;
    const cacheBase = getCacheBaseDir();
    return path.join(cacheBase, ...modelId.split('/'));
}

// ディレクトリサイズを再帰的に計算 (bytes)
function getDirSizeBytes(dirPath) {
    if (!fs.existsSync(dirPath)) return 0;
    let total = 0;
    try {
        const entries = fs.readdirSync(dirPath, { withFileTypes: true });
        for (const entry of entries) {
            const fullPath = path.join(dirPath, entry.name);
            if (entry.isDirectory()) {
                total += getDirSizeBytes(fullPath);
            } else if (entry.isFile()) {
                const stat = fs.statSync(fullPath);
                total += stat.size;
            }
        }
    } catch (e) {}
    return total;
}

// バイト数を読みやすい単位にフォーマット
function formatBytes(bytes) {
    if (!bytes || bytes <= 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

// 日本語文字（ひらがな、カタカナ、漢字等）を含むか判定
function containsJapanese(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
}

// ローカルにキャッシュ（モデル本体 ONNX ファイル）が存在するか判定 & 容量取得
function getModelCacheInfo(modelId) {
    const modelPath = getModelCachePath(modelId);
    if (!modelPath || !fs.existsSync(modelPath)) {
        return { isCached: false, sizeBytes: 0, sizeFormatted: '0 B' };
    }

    const onnxDir = path.join(modelPath, 'onnx');
    let hasFiles = false;
    if (fs.existsSync(onnxDir)) {
        const files = fs.readdirSync(onnxDir);
        if (files.length > 0) hasFiles = true;
    }
    if (!hasFiles) {
        const rootFiles = fs.readdirSync(modelPath);
        hasFiles = rootFiles.some(f => f.endsWith('.onnx') || f.endsWith('.json'));
    }

    if (!hasFiles) {
        return { isCached: false, sizeBytes: 0, sizeFormatted: '0 B' };
    }

    const sizeBytes = getDirSizeBytes(modelPath);
    return {
        isCached: true,
        sizeBytes: sizeBytes,
        sizeFormatted: formatBytes(sizeBytes)
    };
}

function isModelCached(modelId) {
    return getModelCacheInfo(modelId).isCached;
}

// ディスク上の全キャッシュ済みモデルをスキャン
function scanAllCachedModels() {
    const cacheBase = getCacheBaseDir();
    if (!fs.existsSync(cacheBase)) return [];

    const cachedList = [];
    try {
        const owners = fs.readdirSync(cacheBase, { withFileTypes: true });
        for (const owner of owners) {
            if (!owner.isDirectory()) continue;
            const ownerPath = path.join(cacheBase, owner.name);
            const modelDirs = fs.readdirSync(ownerPath, { withFileTypes: true });
            for (const mDir of modelDirs) {
                if (!mDir.isDirectory()) continue;
                const modelId = `${owner.name}/${mDir.name}`;
                const cacheInfo = getModelCacheInfo(modelId);
                if (cacheInfo.isCached) {
                    cachedList.push({
                        id: modelId,
                        sizeBytes: cacheInfo.sizeBytes,
                        sizeFormatted: cacheInfo.sizeFormatted
                    });
                }
            }
        }
    } catch (e) {}
    return cachedList;
}

// モデルキャッシュ（ディスク上の実体ファイル）の削除
function deleteModelCache(modelId) {
    if (!modelId) return false;

    // 現在メモリに常駐中のモデルであればアンロード
    if (activeModelId === modelId) {
        currentPipe = null;
        activeModelId = null;
        currentLoadProgress.status = 'idle';
        currentLoadProgress.message = '';
        currentLoadProgress.modelId = null;
    }

    const modelPath = getModelCachePath(modelId);
    if (modelPath && fs.existsSync(modelPath)) {
        try {
            fs.rmSync(modelPath, { recursive: true, force: true });
            
            // 親ディレクトリが空なら削除
            const parentDir = path.dirname(modelPath);
            if (fs.existsSync(parentDir)) {
                const remaining = fs.readdirSync(parentDir);
                if (remaining.length === 0) {
                    fs.rmdirSync(parentDir);
                }
            }
            console.log(`[translator] Model cache deleted: ${modelId}`);
            return true;
        } catch (e) {
            console.error(`[translator] Failed to delete cache for ${modelId}:`, e);
            throw e;
        }
    }
    return false;
}

/**
 * モデルパイプラインのロード / 切り替え
 * @param {string} [targetModelId] 
 */
async function getPipeline(targetModelId) {
    const conf = loadConf('sdServer') || {};
    const defaultModelId = conf.llm?.activeModel || 'onnx-community/Qwen2.5-1.5B-Instruct';
    const modelId = targetModelId || activeModelId || defaultModelId;

    if (currentPipe && activeModelId === modelId) {
        return currentPipe;
    }

    if (loadPromise && activeModelId === modelId) {
        return loadPromise;
    }

    activeModelId = modelId;
    currentLoadProgress.modelId = modelId;
    currentLoadProgress.status = 'downloading';
    currentLoadProgress.progress = 0;
    currentLoadProgress.file = '初期化中...';
    currentLoadProgress.message = `[${modelId}] を準備しています...`;
    currentLoadProgress.updatedAt = Date.now();

    loadPromise = (async () => {
        console.log(`[translator] Loading Transformers.js model: ${modelId}...`);
        const { pipeline } = await import('@huggingface/transformers');
        
        const modelsList = conf.llm?.models || [];
        const modelDef = modelsList.find(m => m.id === modelId) || {};
        const dtype = modelDef.dtype || 'q4';
        const task = modelDef.task || 'text-generation';

        const pipe = await pipeline(task, modelId, {
            dtype: dtype,
            progress_callback: (p) => {
                currentLoadProgress.updatedAt = Date.now();
                if (p.status === 'initiate') {
                    currentLoadProgress.status = 'downloading';
                    currentLoadProgress.file = p.file || '';
                    currentLoadProgress.message = `ダウンロード開始: ${p.file || ''}`;
                } else if (p.status === 'progress') {
                    currentLoadProgress.status = 'downloading';
                    currentLoadProgress.file = p.file || '';
                    currentLoadProgress.progress = Math.round(p.progress || 0);
                    currentLoadProgress.loaded = p.loaded || 0;
                    currentLoadProgress.total = p.total || 0;
                    currentLoadProgress.message = `${p.file || ''} をダウンロード中 (${Math.round(p.progress || 0)}%)`;
                } else if (p.status === 'done') {
                    currentLoadProgress.message = `完了: ${p.file || ''}`;
                } else if (p.status === 'ready') {
                    currentLoadProgress.status = 'loading';
                    currentLoadProgress.message = 'ONNX ランタイムにモデルをロード中...';
                }
            }
        });

        currentPipe = pipe;
        activeModelId = modelId;
        currentLoadProgress.status = 'ready';
        currentLoadProgress.progress = 100;
        currentLoadProgress.message = `モデル [${modelId}] の常駐化が完了しました`;
        currentLoadProgress.updatedAt = Date.now();
        console.log(`[translator] Model [${modelId}] loaded into memory and resident.`);
        return pipe;
    })();

    try {
        const pipe = await loadPromise;
        return pipe;
    } catch (err) {
        activeModelId = null;
        currentPipe = null;
        currentLoadProgress.status = 'error';
        currentLoadProgress.message = `ロードエラー: ${err.message}`;
        currentLoadProgress.updatedAt = Date.now();
        throw err;
    } finally {
        loadPromise = null;
    }
}

module.exports = {
    containsJapanese,
    isModelCached,
    getModelCacheInfo,
    scanAllCachedModels,
    deleteModelCache,

    /**
     * 現在のダウンロード/ロード進捗の取得
     */
    getLoadProgress() {
        return {
            ...currentLoadProgress,
            activeModelId: activeModelId
        };
    },

    /**
     * 現在の設定およびモデル一覧・状態の取得
     */
    getModelsStatus() {
        const conf = loadConf('sdServer') || {};
        const configuredModel = conf.llm?.activeModel || 'onnx-community/Qwen2.5-1.5B-Instruct';
        
        const models = (conf.llm?.models || []).map(m => {
            const isLoaded = activeModelId === m.id && currentPipe !== null;
            const isConfigured = configuredModel === m.id;
            const cacheInfo = getModelCacheInfo(m.id);

            return {
                ...m,
                isLoaded: isLoaded,
                isConfigured: isConfigured,
                isCached: cacheInfo.isCached,
                cacheSize: cacheInfo.sizeFormatted,
                cacheBytes: cacheInfo.sizeBytes,
                isActive: isLoaded || (activeModelId === null && isConfigured)
            };
        });

        // 設定一覧に含まれていないディスク上の孤立キャッシュモデルを検出
        const allCached = scanAllCachedModels();
        const orphanCaches = allCached.filter(c => !models.some(m => m.id === c.id));

        return {
            activeModel: activeModelId || configuredModel,
            isLoaded: currentPipe !== null,
            loadProgress: currentLoadProgress,
            models: models,
            orphanCaches: orphanCaches
        };
    },

    /**
     * アクティブモデルの切り替え / ロード
     */
    async switchModel(modelId) {
        const conf = loadConf('sdServer') || {};
        if (!conf.llm) conf.llm = {};
        
        let modelDef = (conf.llm.models || []).find(m => m.id === modelId);
        if (!modelDef) {
            modelDef = {
                id: modelId,
                name: modelId.split('/').pop(),
                description: 'カスタム追加モデル',
                dtype: 'q4',
                task: 'text-generation'
            };
            if (!conf.llm.models) conf.llm.models = [];
            conf.llm.models.push(modelDef);
        }

        // ロード実行
        await getPipeline(modelId);

        // ロード成功後に設定を保存
        conf.llm.activeModel = modelId;
        saveConf('sdServer', conf);

        return this.getModelsStatus();
    },

    /**
     * 新規モデルの登録（設定保存）
     */
    addModel(modelInfo) {
        const conf = loadConf('sdServer') || {};
        if (!conf.llm) conf.llm = {};
        if (!conf.llm.models) conf.llm.models = [];

        const existingIdx = conf.llm.models.findIndex(m => m.id === modelInfo.id);
        const item = {
            id: modelInfo.id.trim(),
            name: modelInfo.name ? modelInfo.name.trim() : modelInfo.id.split('/').pop(),
            description: modelInfo.description ? modelInfo.description.trim() : '',
            dtype: modelInfo.dtype || 'q4',
            task: modelInfo.task || 'text-generation'
        };

        if (existingIdx >= 0) {
            conf.llm.models[existingIdx] = item;
        } else {
            conf.llm.models.push(item);
        }

        saveConf('sdServer', conf);
        return this.getModelsStatus();
    },

    /**
     * モデルの削除（設定から削除、オプションでキャッシュも削除）
     * @param {string} modelId 
     * @param {boolean} [deleteCache=false]
     */
    deleteModel(modelId, deleteCache = false) {
        const conf = loadConf('sdServer') || {};
        if (!conf.llm || !conf.llm.models) return this.getModelsStatus();

        if (deleteCache) {
            deleteModelCache(modelId);
        }

        conf.llm.models = conf.llm.models.filter(m => m.id !== modelId);
        if (conf.llm.activeModel === modelId) {
            conf.llm.activeModel = conf.llm.models[0]?.id || 'onnx-community/Qwen2.5-1.5B-Instruct';
        }
        saveConf('sdServer', conf);
        return this.getModelsStatus();
    },

    /**
     * 日本語プロンプトを忠実に英語に翻訳・変換 (推論OFF: do_sample=false)
     * @param {string} text
     * @returns {Promise<string>}
     */
    async translateJaToEn(text) {
        if (!text || typeof text !== 'string' || !text.trim()) {
            return '';
        }

        if (!containsJapanese(text)) {
            return text;
        }

        try {
            const pipe = await getPipeline();

            const systemPrompt = `You are an accurate translator from Japanese to English for image generation prompts.
Translate the user's Japanese prompt into direct, faithful English.
Do NOT invent extra details, styles, colors, cushions, clothes, or stories that were not in the input.
If the user asks politely like "〜を作成して" or "〜を描いて" (please create / make / draw), just extract and translate the target subject.

Examples:
Input: かわいい猫
Output: cute cat

Input: 熊の画像を作成して
Output: a bear

Input: 桜並木を歩く女子高生、春の日差し
Output: a high school girl walking along cherry blossom trees, spring sunlight

Input: サイバーパンクな都市の夜、ネオン
Output: cyberpunk city at night, neon lights`;

            const messages = [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: text.trim()
                }
            ];

            const output = await pipe(messages, {
                max_new_tokens: 64,
                do_sample: false
            });

            if (output && output[0] && output[0].generated_text) {
                const generated = output[0].generated_text;
                let assistantMsg = '';
                if (Array.isArray(generated)) {
                    assistantMsg = generated[generated.length - 1]?.content || '';
                } else if (typeof generated === 'string') {
                    assistantMsg = generated;
                }

                if (assistantMsg) {
                    let cleanResult = assistantMsg.trim()
                        .replace(/^["']|["']$/g, '')
                        .replace(/^(Output:\s*|Translation:\s*|Here is the translation:\s*)/i, '');
                    return cleanResult || text;
                }
            }

            return text;
        } catch (e) {
            console.error('[translator] Translation error:', e);
            return text;
        }
    },

    /**
     * 日本語または英語のプロンプトから Stable Diffusion 向けに最適化されたプロンプトとネガティブプロンプトを生成 (AIアシスト)
     * @param {string} text ユーザー入力プロンプト
     * @param {string} [currentNegative] 既存のネガティブプロンプト
     * @returns {Promise<{ prompt: string, negative_prompt: string, original_prompt: string }>}
     */
    async assistPrompt(text, currentNegative = '') {
        if (!text || typeof text !== 'string' || !text.trim()) {
            return {
                prompt: '',
                negative_prompt: currentNegative || '',
                original_prompt: ''
            };
        }

        try {
            const pipe = await getPipeline();

            const systemPrompt = `You are an expert AI prompt engineer specialized in Stable Diffusion image generation.
Convert the user's idea into high-quality, comma-separated English tags and recommended negative prompt tags for Stable Diffusion.

CRITICAL RULES:
1. When the input describes an item, weapon, or object (like sword, potion, armor, machine, artifact) without explicitly asking for a character/person:
   - Must add composition tags to focus on the object only: "item focus, weapon focus, solo, no humans, simple background, intricate details".
   - Set negative prompt to exclude people: "human, person, character, holding, hands, fingers, bad quality, worst quality, blurry".
2. When the input describes a character / person:
   - Detail appearance, costume, expression, pose, lighting, atmosphere, masterpiece.
   - Set negative prompt: "worst quality, low quality, bad anatomy, bad hands, missing fingers, blurry".
3. When the input describes scenery / landscape:
   - Detail scenery, architecture, mood, lighting, high resolution.
   - Set negative prompt: "worst quality, low quality, text, watermark, blurry".

Output ONLY valid JSON format:
{
  "prompt": "tag1, tag2, tag3...",
  "negative_prompt": "neg_tag1, neg_tag2..."
}

Examples:
User: 危険で恐ろしい魔剣を表現して
Assistant: {"prompt": "cursed dark magic sword, glowing crimson and purple demonic aura, sharp jagged blade, ornate hilt, dark fantasy, weapon focus, item focus, solo, no humans, simple dark background, masterpiece, 8k", "negative_prompt": "human, person, character, warrior, knight, hands, holding weapon, low quality, worst quality, blurry"}

User: 桜の木の下で微笑む女子高生、春の日差し
Assistant: {"prompt": "1girl, japanese high school girl, gentle smile, school uniform, standing under blooming cherry blossom trees, falling petals, warm spring sunlight, soft focus, masterpiece, best quality", "negative_prompt": "worst quality, low quality, bad anatomy, bad hands, extra digits, blurry"}

User: 近未来都市の夜景、ネオン街
Assistant: {"prompt": "futuristic cyberpunk metropolis at night, neon billboards, glowing signs, wet asphalt with reflections, skyscrapers, cinematic lighting, 8k resolution, scenery focus", "negative_prompt": "worst quality, low quality, blurry, text, watermark"}`;

            const messages = [
                {
                    role: 'system',
                    content: systemPrompt
                },
                {
                    role: 'user',
                    content: text.trim()
                }
            ];

            const output = await pipe(messages, {
                max_new_tokens: 160,
                do_sample: false
            });

            if (output && output[0] && output[0].generated_text) {
                const generated = output[0].generated_text;
                let assistantMsg = '';
                if (Array.isArray(generated)) {
                    assistantMsg = generated[generated.length - 1]?.content || '';
                } else if (typeof generated === 'string') {
                    assistantMsg = generated;
                }

                if (assistantMsg) {
                    let cleaned = assistantMsg.trim()
                        .replace(/^```json\s*/i, '')
                        .replace(/^```\s*/i, '')
                        .replace(/\s*```$/i, '')
                        .trim();

                    const jsonMatch = cleaned.match(/\{[\s\S]*\}/);
                    if (jsonMatch) {
                        try {
                            const parsed = JSON.parse(jsonMatch[0]);
                            const optimizedPrompt = parsed.prompt ? String(parsed.prompt).trim() : '';
                            let optimizedNeg = parsed.negative_prompt ? String(parsed.negative_prompt).trim() : '';
                            
                            if (currentNegative && currentNegative.trim()) {
                                if (optimizedNeg) {
                                    optimizedNeg = `${currentNegative.trim()}, ${optimizedNeg}`;
                                } else {
                                    optimizedNeg = currentNegative.trim();
                                }
                            }

                            if (optimizedPrompt) {
                                return {
                                    prompt: optimizedPrompt,
                                    negative_prompt: optimizedNeg,
                                    original_prompt: text
                                };
                            }
                        } catch (pe) {
                            console.warn('[translator] JSON parse warning in assistPrompt:', pe.message);
                        }
                    }
                }
            }

            const direct = await this.translateJaToEn(text);
            return {
                prompt: direct,
                negative_prompt: currentNegative || 'worst quality, low quality, normal quality, blurry',
                original_prompt: text
            };
        } catch (e) {
            console.error('[translator] assistPrompt error:', e);
            const direct = await this.translateJaToEn(text);
            return {
                prompt: direct,
                negative_prompt: currentNegative || '',
                original_prompt: text
            };
        }
    }
};
