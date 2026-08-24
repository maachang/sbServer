/**
 * Transformers.js 常駐型・動的切り替え対応 プロンプト翻訳モジュール
 */
const fs = require('node:fs');
const path = require('node:path');

let activeModelId = null;
let currentPipe = null;
let loadPromise = null;

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

// 日本語文字（ひらがな、カタカナ、漢字等）を含むか判定
function containsJapanese(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
}

// ローカルにキャッシュ済みか判定
function isModelCached(modelId) {
    const cacheBase = path.join(process.cwd(), 'node_modules', '@huggingface', 'transformers', '.cache');
    const modelPath = path.join(cacheBase, ...modelId.split('/'));
    return fs.existsSync(modelPath);
}

/**
 * モデルパイプラインのロード / 切り替え
 * @param {string} [targetModelId] 
 * @param {Function} [progressCallback]
 */
async function getPipeline(targetModelId, progressCallback) {
    const conf = loadConf('sdServer') || {};
    const defaultModelId = conf.llm?.activeModel || 'onnx-community/Qwen3.5-0.8B-ONNX';
    const modelId = targetModelId || activeModelId || defaultModelId;

    if (currentPipe && activeModelId === modelId) {
        return currentPipe;
    }

    if (loadPromise && activeModelId === modelId) {
        return loadPromise;
    }

    activeModelId = modelId;
    loadPromise = (async () => {
        console.log(`[translator] Loading Transformers.js model: ${modelId}...`);
        const { pipeline } = await import('@huggingface/transformers');
        
        const modelsList = conf.llm?.models || [];
        const modelDef = modelsList.find(m => m.id === modelId) || {};
        const dtype = modelDef.dtype || 'q4';
        const task = modelDef.task || 'text-generation';

        const pipe = await pipeline(task, modelId, {
            dtype: dtype,
            progress_callback: progressCallback || (() => {})
        });

        currentPipe = pipe;
        activeModelId = modelId;
        console.log(`[translator] Model [${modelId}] loaded into memory and resident.`);
        return pipe;
    })();

    try {
        const pipe = await loadPromise;
        return pipe;
    } finally {
        loadPromise = null;
    }
}

module.exports = {
    containsJapanese,
    isModelCached,

    /**
     * 現在の設定およびモデル一覧・状態の取得
     */
    getModelsStatus() {
        const conf = loadConf('sdServer') || {};
        const active = activeModelId || conf.llm?.activeModel || 'onnx-community/Qwen3.5-0.8B-ONNX';
        const models = (conf.llm?.models || []).map(m => ({
            ...m,
            isLoaded: activeModelId === m.id && currentPipe !== null,
            isCached: isModelCached(m.id),
            isActive: active === m.id
        }));

        return {
            activeModel: active,
            isLoaded: currentPipe !== null,
            models: models
        };
    },

    /**
     * アクティブモデルの切り替え / ロード
     */
    async switchModel(modelId, progressCallback) {
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
        await getPipeline(modelId, progressCallback);

        // 設定を保存
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
     * モデルの削除（設定から削除）
     */
    deleteModel(modelId) {
        const conf = loadConf('sdServer') || {};
        if (!conf.llm || !conf.llm.models) return this.getModelsStatus();

        conf.llm.models = conf.llm.models.filter(m => m.id !== modelId);
        if (conf.llm.activeModel === modelId) {
            conf.llm.activeModel = conf.llm.models[0]?.id || 'onnx-community/Qwen3.5-0.8B-ONNX';
        }
        saveConf('sdServer', conf);
        return this.getModelsStatus();
    },

    /**
     * 日本語プロンプトを英語に翻訳・変換 (推論OFF: do_sample=false)
     * @param {string} text
     * @returns {Promise<string>}
     */
    async translateJaToEn(text) {
        if (!text || typeof text !== 'string' || !text.trim()) {
            return '';
        }

        // 日本語が含まれていない場合は翻訳スキップ
        if (!containsJapanese(text)) {
            return text;
        }

        try {
            const pipe = await getPipeline();

            const messages = [
                {
                    role: 'system',
                    content: 'Translate Japanese to English for an image generation prompt. Output ONLY the English translation without explanation or extra commentary.'
                },
                {
                    role: 'user',
                    content: text.trim()
                }
            ];

            // 推論OFF (サンプリングOFF・決定論的出力)
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
                        .replace(/^(Translation:|Here is the translation:)\s*/i, '');
                    return cleanResult || text;
                }
            }

            return text;
        } catch (e) {
            console.error('[translator] Translation error:', e);
            return text;
        }
    }
};
