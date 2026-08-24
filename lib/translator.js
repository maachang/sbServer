/**
 * Transformers.js + LiquidAI/LFM2.5-1.2B-JP-ONNX 常駐型プロンプト翻訳モジュール
 */

let pipePromise = null;

// 日本語文字（ひらがな、カタカナ、漢字等）を含むか判定
function containsJapanese(text) {
    if (!text || typeof text !== 'string') return false;
    return /[\u3040-\u309F\u30A0-\u30FF\u4E00-\u9FAF]/.test(text);
}

/**
 * モデルパイプラインの取得（初回呼び出し時にロードし、メモリ上に常駐）
 */
async function getPipeline() {
    if (!pipePromise) {
        pipePromise = (async () => {
            console.log('[translator] Initializing Transformers.js pipeline (LiquidAI/LFM2.5-1.2B-JP-ONNX)...');
            const { pipeline } = await import('@huggingface/transformers');
            const pipe = await pipeline('text-generation', 'LiquidAI/LFM2.5-1.2B-JP-ONNX', {
                dtype: 'q4'
            });
            console.log('[translator] Transformers.js model loaded into memory and resident.');
            return pipe;
        })();
    }
    return pipePromise;
}

module.exports = {
    containsJapanese,
    getPipeline,

    /**
     * 日本語プロンプトを英語に翻訳・変換
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
                    content: 'Translate the given Japanese text to English for an image generation prompt. Respond ONLY with the English translation. Do not repeat Japanese.'
                },
                {
                    role: 'user',
                    content: `Translate to English: ${text.trim()}`
                }
            ];

            const output = await pipe(messages, {
                max_new_tokens: 64,
                temperature: 0.1,
                top_p: 0.95
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
                    const cleanResult = assistantMsg.trim().replace(/^["']|["']$/g, '');
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
