/**
 * 画像生成実行 API
 * POST /api/generate
 */
exports.handler = async function() {
    const validate = $loadLib('validate.js');
    const imageSchema = $loadLib('validates/image.js');
    const sdClient = $loadLib('sdClient.js');
    const imageModel = $loadLib('imageModel.js');
    const translator = $loadLib('translator.js');

    const body = $request.body || {};
    const checkResult = validate.check(body, imageSchema);

    if (!checkResult.valid) {
        $response.status(400);
        return {
            success: false,
            errors: checkResult.errors
        };
    }

    const params = checkResult.data;
    const startTime = Date.now();
    const clientSignal = $request.raw?.signal;

    try {
        // 元の入力（日本語などユーザー入力そのもの）を保持
        const userPrompt = params.prompt;
        const userNegativePrompt = params.negative_prompt || '';

        let translatedPrompt = '';
        let translatedNegativePrompt = '';

        // sd-server に渡すプロンプトを準備
        let effectivePrompt = userPrompt;
        let effectiveNegativePrompt = userNegativePrompt;

        if (translator && translator.translateJaToEn) {
            if (translator.containsJapanese(userPrompt)) {
                translatedPrompt = await translator.translateJaToEn(userPrompt);
                effectivePrompt = translatedPrompt;
                console.log(`[generate] Prompt translated: "${userPrompt}" -> "${effectivePrompt}"`);
            }
            if (translator.containsJapanese(userNegativePrompt)) {
                translatedNegativePrompt = await translator.translateJaToEn(userNegativePrompt);
                effectiveNegativePrompt = translatedNegativePrompt;
                console.log(`[generate] Negative prompt translated: "${userNegativePrompt}" -> "${effectiveNegativePrompt}"`);
            }
        }

        // sd-server へ生成リクエスト (実際に渡すのは英語プロンプト)
        const sdParams = {
            ...params,
            prompt: effectivePrompt,
            negative_prompt: effectiveNegativePrompt
        };

        const genResult = await sdClient.generate(sdParams, clientSignal);

        const durationMs = Date.now() - startTime;

        // 画像ファイル保存
        const imagePath = sdClient.saveImageFile(genResult.base64Data);

        // DB登録 (prompt には元の日本語を保持し、translated_prompt に英語を記録)
        const recordId = imageModel.createImage({
            prompt: userPrompt,
            negative_prompt: userNegativePrompt,
            translated_prompt: translatedPrompt,
            translated_negative_prompt: translatedNegativePrompt,
            width: params.width,
            height: params.height,
            steps: params.steps,
            cfg_scale: params.cfg_scale,
            seed: genResult.seed !== undefined ? genResult.seed : params.seed,
            sampler_name: params.sampler_name,
            image_path: imagePath,
            parent_id: params.parent_id,
            generation_time_ms: durationMs
        });

        const createdItem = imageModel.getImageById(recordId);

        return {
            success: true,
            data: createdItem,
            durationMs: durationMs,
            durationSec: (durationMs / 1000).toFixed(2),
            translated: {
                prompt: translatedPrompt || null,
                negative_prompt: translatedNegativePrompt || null
            }
        };
    } catch (e) {
        $response.status(500);
        return {
            success: false,
            error: e.message,
            durationMs: Date.now() - startTime
        };
    }
};
