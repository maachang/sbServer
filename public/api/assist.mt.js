/**
 * AI プロンプト最適化・アシスト API
 * POST /api/assist
 * body: { prompt: "日本語または英語", negative_prompt: "既存のネガティブ" }
 */
exports.handler = async function() {
    const translator = $loadLib('translator.js');
    const body = $request.body || {};
    const prompt = body.prompt || '';
    const negativePrompt = body.negative_prompt || '';

    if (!prompt || !prompt.trim()) {
        return {
            success: true,
            prompt: '',
            negative_prompt: negativePrompt,
            original_prompt: ''
        };
    }

    try {
        if (translator && translator.assistPrompt) {
            const result = await translator.assistPrompt(prompt, negativePrompt);
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
