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

function safeParseJson(str) {
    if (!str) return null;
    try {
        const clean = str
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '');
        return JSON.parse(clean);
    } catch (e) {
        try {
            const maachangHome = process.env.MAACHANG_HOME || path.resolve(__dirname, '../../maachang');
            const context = require(path.join(maachangHome, 'src', 'context.js'));
            return context.parseJson(str);
        } catch (err) {
            return null;
        }
    }
}

function loadConf(confName) {
    if (typeof $loadConf !== 'undefined') {
        const loaded = $loadConf(confName);
        if (loaded) return loaded;
    }
    try {
        const localPath = path.join(process.cwd(), 'conf', `${confName}.local.json`);
        const confPath = path.join(process.cwd(), 'conf', `${confName}.json`);
        if (fs.existsSync(localPath)) {
            return safeParseJson(fs.readFileSync(localPath, 'utf8'));
        }
        if (fs.existsSync(confPath)) {
            return safeParseJson(fs.readFileSync(confPath, 'utf8'));
        }
    } catch (e) {}
    return null;
}


function getLlmConf() {
    const localConf = loadConf("localLlm");
    if (localConf && (localConf.models || localConf.activeModel || localConf.provider || localConf.external || localConf.openai)) {
        return localConf;
    }
    const sdConf = loadConf("sdServer");
    return sdConf?.llm || {};
}

function saveLlmConf(data) {
    saveConf("localLlm", data);
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
    const conf = getLlmConf();
    const defaultModelId = conf.activeModel || 'onnx-community/Qwen2.5-1.5B-Instruct';
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
        
        const modelsList = conf.models || [];
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
        const conf = getLlmConf();
        const provider = conf.provider || 'local';
        const configuredModel = conf.activeModel || 'onnx-community/Qwen2.5-1.5B-Instruct';
        
        const models = (conf.models || []).map(m => {
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
                isActive: (provider === 'local') && (isLoaded || (activeModelId === null && isConfigured))
            };
        });

        // 設定一覧に含まれていないディスク上の孤立キャッシュモデルを検出
        const allCached = scanAllCachedModels();
        const orphanCaches = allCached.filter(c => !models.some(m => m.id === c.id));

        return {
            provider: provider,
            activeModel: activeModelId || configuredModel,
            isLoaded: currentPipe !== null,
            loadProgress: currentLoadProgress,
            models: models,
            orphanCaches: orphanCaches,
            external: {
                endpoint: conf.external?.endpoint || 'http://localhost:8080/v1',
                model: conf.external?.model || 'default',
                apiKey: conf.external?.apiKey || ''
            },
            openai: {
                apiKey: conf.openai?.apiKey || '',
                model: conf.openai?.model || 'gpt-4o-mini'
            }
        };
    },

    /**
     * LLM プロバイダーの切り替え (local | external | openai)
     */
    switchProvider(provider) {
        const conf = getLlmConf();
        if (!['local', 'external', 'openai'].includes(provider)) {
            throw new Error(`無効なプロバイダーです: ${provider}`);
        }
        conf.provider = provider;
        saveLlmConf(conf);
        return this.getModelsStatus();
    },

    /**
     * 外部LLMサーバー設定の保存
     */
    saveExternalConfig(settings = {}) {
        const conf = getLlmConf();
        conf.external = {
            endpoint: (settings.endpoint || 'http://localhost:8080/v1').trim(),
            model: (settings.model || 'default').trim(),
            apiKey: (settings.apiKey || '').trim()
        };
        saveLlmConf(conf);
        return this.getModelsStatus();
    },

    /**
     * OpenAI 設定の保存
     */
    saveOpenAIConfig(settings = {}) {
        const conf = getLlmConf();
        conf.openai = {
            apiKey: (settings.apiKey || '').trim(),
            model: (settings.model || 'gpt-4o-mini').trim()
        };
        saveLlmConf(conf);
        return this.getModelsStatus();
    },

    /**
     * 接続テスト (external / openai)
     */
    async testConnection(params = {}) {
        const provider = params.provider || 'external';
        const messages = [
            { role: 'system', content: 'You are a translation assistant.' },
            { role: 'user', content: 'Translate to English: 魔法の剣' }
        ];

        if (provider === 'external') {
            const endpoint = (params.endpoint || 'http://localhost:8080/v1').trim().replace(/\/$/, '');
            const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;
            const headers = { 'Content-Type': 'application/json' };
            if (params.apiKey) headers['Authorization'] = `Bearer ${params.apiKey.trim()}`;

            try {
                const res = await fetch(url, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({
                        model: params.model || 'default',
                        messages,
                        max_tokens: 32,
                        temperature: 0.1
                    }),
                    signal: AbortSignal.timeout(15000)
                });

                if (!res.ok) {
                    const errText = await res.text();
                    return { success: false, error: `外部サーバーエラー (${res.status}): ${errText.slice(0, 200)}` };
                }

                const json = await res.json();
                const reply = json.choices?.[0]?.message?.content || JSON.stringify(json);
                return { success: true, reply: reply.trim(), message: '外部LLMサーバーへの接続と応答に成功しました！' };
            } catch (err) {
                return { success: false, error: `接続失敗: ${err.message}` };
            }
        } else if (provider === 'openai') {
            const apiKey = (params.apiKey || getLlmConf()?.openai?.apiKey || '').trim();
            if (!apiKey) {
                return { success: false, error: 'OpenAI APIキーが入力されていません' };
            }

            try {
                const res = await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${apiKey}`
                    },
                    body: JSON.stringify({
                        model: params.model || 'gpt-4o-mini',
                        messages,
                        max_tokens: 32,
                        temperature: 0.1
                    }),
                    signal: AbortSignal.timeout(15000)
                });

                if (!res.ok) {
                    const errText = await res.text();
                    return { success: false, error: `OpenAI APIエラー (${res.status}): ${errText.slice(0, 200)}` };
                }

                const json = await res.json();
                const reply = json.choices?.[0]?.message?.content || '';
                return { success: true, reply: reply.trim(), message: 'OpenAI APIへの接続と応答に成功しました！' };
            } catch (err) {
                return { success: false, error: `接続失敗: ${err.message}` };
            }
        }

        return { success: false, error: '無効なプロバイダーです' };
    },

    /**
     * リモートサーバー（外部LLMルーター / OpenAI）からモデル一覧を取得
     */
    async fetchRemoteModels(params = {}) {
        const provider = params.provider || 'external';

        if (provider === 'external') {
            const conf = getLlmConf();
            let endpoint = (params.endpoint || conf.external?.endpoint || 'http://localhost:8080/v1').trim();
            const apiKey = (params.apiKey !== undefined ? params.apiKey : (conf.external?.apiKey || '')).trim();

            if (!endpoint) {
                return { success: false, error: 'エンドポイントURLが指定されていません' };
            }

            endpoint = endpoint.replace(/\/chat\/completions\/?$/, '').replace(/\/+$/, '');

            // /v1/models または /models
            let modelsUrl = `${endpoint}/models`;
            if (!endpoint.endsWith('/v1') && !endpoint.includes('/v1/')) {
                modelsUrl = `${endpoint}/v1/models`;
            }

            const headers = { 'Accept': 'application/json' };
            if (apiKey) {
                headers['Authorization'] = `Bearer ${apiKey}`;
            }

            try {
                let res = await fetch(modelsUrl, {
                    method: 'GET',
                    headers,
                    signal: AbortSignal.timeout(10000)
                });

                if (!res.ok && modelsUrl.includes('/v1/models')) {
                    const fallbackUrl = `${endpoint}/models`;
                    try {
                        const fallbackRes = await fetch(fallbackUrl, {
                            method: 'GET',
                            headers,
                            signal: AbortSignal.timeout(10000)
                        });
                        if (fallbackRes.ok) {
                            res = fallbackRes;
                        }
                    } catch (e) {}
                }

                if (!res.ok) {
                    const errText = await res.text();
                    return { success: false, error: `モデル一覧の取得に失敗しました (${res.status}): ${errText.slice(0, 200)}` };
                }

                const json = await res.json();
                let modelList = [];

                if (Array.isArray(json.data)) {
                    modelList = json.data.map(m => (typeof m === 'string' ? m : (m.id || m.name || '')));
                } else if (Array.isArray(json.models)) {
                    modelList = json.models.map(m => (typeof m === 'string' ? m : (m.name || m.model || m.id || '')));
                } else if (Array.isArray(json)) {
                    modelList = json.map(m => (typeof m === 'string' ? m : (m.id || m.name || '')));
                }

                modelList = [...new Set(modelList.filter(Boolean))];

                if (modelList.length === 0) {
                    return { success: false, error: 'サーバーからモデルが見つかりませんでした' };
                }

                return {
                    success: true,
                    models: modelList,
                    message: `${modelList.length} 件のモデルを取得しました`
                };
            } catch (err) {
                return { success: false, error: `接続エラー: ${err.message}` };
            }
        } else if (provider === 'openai') {
            const conf = getLlmConf();
            const apiKey = (params.apiKey !== undefined ? params.apiKey : (conf.openai?.apiKey || '')).trim();

            if (!apiKey) {
                return { success: false, error: 'OpenAI APIキーを入力してください' };
            }

            try {
                const res = await fetch('https://api.openai.com/v1/models', {
                    method: 'GET',
                    headers: {
                        'Authorization': `Bearer ${apiKey}`,
                        'Accept': 'application/json'
                    },
                    signal: AbortSignal.timeout(15000)
                });

                if (!res.ok) {
                    const errText = await res.text();
                    return { success: false, error: `OpenAI APIエラー (${res.status}): ${errText.slice(0, 200)}` };
                }

                const json = await res.json();
                let modelList = [];

                if (Array.isArray(json.data)) {
                    const allIds = json.data.map(m => m.id).filter(Boolean);
                    const priorityPrefixes = ['gpt-4o', 'gpt-4', 'o1', 'o3', 'chatgpt', 'gpt-3.5'];
                    const chatModels = allIds.filter(id => priorityPrefixes.some(p => id.startsWith(p)));
                    const otherModels = allIds.filter(id => !priorityPrefixes.some(p => id.startsWith(p)));

                    chatModels.sort();
                    otherModels.sort();
                    modelList = [...chatModels, ...otherModels];
                }

                if (modelList.length === 0) {
                    return { success: false, error: 'モデルが見つかりませんでした' };
                }

                return {
                    success: true,
                    models: modelList,
                    message: `${modelList.length} 件のモデルを取得しました`
                };
            } catch (err) {
                return { success: false, error: `OpenAI 接続エラー: ${err.message}` };
            }
        }

        return { success: false, error: '無効なプロバイダーです' };
    },

    /**
     * アクティブモデルの切り替え / ロード (ローカルLLM)
     */
    async switchModel(modelId) {
        const conf = getLlmConf();
        
        let modelDef = (conf.models || []).find(m => m.id === modelId);
        if (!modelDef) {
            modelDef = {
                id: modelId,
                name: modelId.split('/').pop(),
                description: 'カスタム追加モデル',
                dtype: 'q4',
                task: 'text-generation'
            };
            if (!conf.models) conf.models = [];
            conf.models.push(modelDef);
        }

        // ロード実行
        await getPipeline(modelId);

        // ロード成功後に設定を保存（プロバイダーも local にセット）
        conf.activeModel = modelId;
        conf.provider = 'local';
        saveLlmConf(conf);

        return this.getModelsStatus();
    },

    /**
     * 新規モデルの登録（設定保存）
     */
    addModel(modelInfo) {
        const conf = getLlmConf();
        if (!conf.models) conf.models = [];

        const existingIdx = conf.models.findIndex(m => m.id === modelInfo.id);
        const item = {
            id: modelInfo.id.trim(),
            name: modelInfo.name ? modelInfo.name.trim() : modelInfo.id.split('/').pop(),
            description: modelInfo.description ? modelInfo.description.trim() : '',
            dtype: modelInfo.dtype || 'q4',
            task: modelInfo.task || 'text-generation'
        };

        if (existingIdx >= 0) {
            conf.models[existingIdx] = item;
        } else {
            conf.models.push(item);
        }

        saveLlmConf(conf);
        return this.getModelsStatus();
    },

    /**
     * モデルの削除（設定から削除、オプションでキャッシュも削除）
     * @param {string} modelId 
     * @param {boolean} [deleteCache=false]
     */
    deleteModel(modelId, deleteCache = false) {
        const conf = getLlmConf();
        if (!conf.models) return this.getModelsStatus();

        if (deleteCache) {
            deleteModelCache(modelId);
        }

        conf.models = conf.models.filter(m => m.id !== modelId);
        if (conf.activeModel === modelId) {
            conf.activeModel = conf.models[0]?.id || 'onnx-community/Qwen2.5-1.5B-Instruct';
        }
        saveLlmConf(conf);
        return this.getModelsStatus();
    },

    /**
     * 共通 LLM 呼び出し実行部 (ローカル ONNX / 外部サーバー / OpenAI)
     * @param {Array<{role: string, content: string}>} messages
     * @param {object} options
     * @returns {Promise<string>}
     */
    async runChatCompletion(messages, options = {}) {
        const conf = getLlmConf();
        const provider = conf.provider || 'local';

        if (provider === 'external') {
            const ext = conf.external || {};
            const endpoint = (ext.endpoint || 'http://localhost:8080/v1').trim().replace(/\/$/, '');
            const url = endpoint.endsWith('/chat/completions') ? endpoint : `${endpoint}/chat/completions`;
            const headers = { 'Content-Type': 'application/json' };
            if (ext.apiKey) headers['Authorization'] = `Bearer ${ext.apiKey.trim()}`;

            const res = await fetch(url, {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: ext.model || 'default',
                    messages: messages,
                    temperature: options.temperature !== undefined ? options.temperature : 0.1,
                    max_tokens: options.max_tokens || 256
                }),
                signal: AbortSignal.timeout(60000)
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`外部LLMサーバーエラー (${res.status}): ${errText.slice(0, 200)}`);
            }
            const json = await res.json();
            return json.choices?.[0]?.message?.content || '';

        } else if (provider === 'openai') {
            const oai = conf.openai || {};
            if (!oai.apiKey) {
                throw new Error('OpenAI APIキーが設定されていません。LLM設定画面から入力してください。');
            }
            const headers = {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${oai.apiKey.trim()}`
            };

            const res = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers,
                body: JSON.stringify({
                    model: oai.model || 'gpt-4o-mini',
                    messages: messages,
                    temperature: options.temperature !== undefined ? options.temperature : 0.1,
                    max_tokens: options.max_tokens || 256
                }),
                signal: AbortSignal.timeout(60000)
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`OpenAI APIエラー (${res.status}): ${errText.slice(0, 200)}`);
            }
            const json = await res.json();
            return json.choices?.[0]?.message?.content || '';

        } else {
            // local (Transformers.js ONNX)
            const pipe = await getPipeline();
            const output = await pipe(messages, {
                max_new_tokens: options.max_tokens || 160,
                do_sample: false
            });

            if (output && output[0] && output[0].generated_text) {
                const generated = output[0].generated_text;
                if (Array.isArray(generated)) {
                    return generated[generated.length - 1]?.content || '';
                } else if (typeof generated === 'string') {
                    return generated;
                }
            }
            return '';
        }
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
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text.trim() }
            ];

            const reply = await this.runChatCompletion(messages, { max_tokens: 64, temperature: 0.1 });
            if (reply) {
                let cleanResult = reply.trim()
                    .replace(/^["']|["']$/g, '')
                    .replace(/^(Output:\s*|Translation:\s*|Here is the translation:\s*)/i, '');
                return cleanResult || text;
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
            const systemPrompt = `You are an expert AI prompt engineer specialized in Stable Diffusion image generation.
Convert the user's idea into high-quality, comma-separated English tags and recommended negative prompt tags for Stable Diffusion.

CRITICAL RULES:
1. When the input describes an item, weapon, or object (like sword, potion, armor, machine, artifact) without explicitly asking for a character/person:
   - Must add composition tags to focus on the object only: "item focus, weapon focus, solo, no humans, simple background, intricate details".
   - Set negative prompt to exclude people: "human, person, character, warrior, knight, hands, holding weapon, low quality, worst quality, blurry".
2. When the input describes a character / person:
   - Detail appearance, costume, expression, pose, lighting, atmosphere, masterpiece.
   - Set negative prompt: "worst quality, low quality, bad anatomy, bad hands, missing fingers, blurry".
3. When the input describes scenery / landscape:
   - Detail scenery, architecture, mood, lighting, high resolution.
   - Set negative prompt: "worst quality, low quality, blurry, text, watermark".

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
                { role: 'system', content: systemPrompt },
                { role: 'user', content: text.trim() }
            ];

            const reply = await this.runChatCompletion(messages, { max_tokens: 180, temperature: 0.1 });
            if (reply) {
                let cleaned = reply.trim()
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
