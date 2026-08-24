/**
 * 翻訳 API
 * POST /api/translate
 * body: { text: "日本語テキスト" }
 */
exports.handler = async function() {
    const translator = $loadLib('translator.js');
    const body = $request.body || {};
    const text = body.text || '';

    if (!text || !text.trim()) {
        return {
            success: true,
            translatedText: '',
            hasJapanese: false
        };
    }

    try {
        const hasJapanese = translator.containsJapanese(text);
        const translatedText = await translator.translateJaToEn(text);

        return {
            success: true,
            originalText: text,
            translatedText: translatedText,
            hasJapanese: hasJapanese
        };
    } catch (e) {
        $response.status(500);
        return {
            success: false,
            error: e.message
        };
    }
};
