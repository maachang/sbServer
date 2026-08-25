/**
 * AI プロンプト最適化・アシスト API
 * POST /api/assist
 * body: { prompt: "日本語または英語", negative_prompt: "既存のネガティブ" }
 */
exports.handler = async function() {
    const translator = $loadLib('translator.js');
    const sdClient = $loadLib('sdClient.js');

    let body = $request.body || {};
    if (typeof body === 'string') {
        try { body = JSON.parse(body); } catch (e) { body = {}; }
    }

    const prompt = body.prompt || '';
    const negativePrompt = body.negative_prompt || '';

    let modelType = body.modelType;
    if (!modelType && (body.serverId || body.server_id)) {
        const srv = sdClient.resolveServer(body.serverId || body.server_id);
        modelType = srv?.modelType || 'sd15';
    }
    if (!modelType) modelType = 'sd15';

    if (!prompt || !prompt.trim()) {
        return {
            success: true,
            prompt: '',
            negative_prompt: negativePrompt,
            original_prompt: '',
            modelType
        };
    }

    try {
        if (translator && translator.assistPrompt) {
            const result = await translator.assistPrompt(prompt, negativePrompt, modelType);
            return {
                success: true,
                ...result
            };
        } else {
            return {
                success: false,
                error: 'Translator library not available'
            };
        }
    } catch (e) {
        $response.status(500);
        return {
            success: false,
            error: e.message
        };
    }
};
