/**
 * 画像生成実行 API
 * POST /api/generate
 * パラメータ: { ..., autoSave: true | false } (デフォルト: false)
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
    const autoSave = body.autoSave === true; // デフォルトは即時保存せずBase64で返す
    const startTime = Date.now();
    const clientSignal = $request.raw?.signal;

    try {
        // 元の入力（日本語などユーザー入力そのもの）を保持
        const userPrompt = params.prompt;
        const userNegativePrompt = params.negative_prompt || '';

        const promptMode = body.promptMode || (body.promptAssist ? 'assist' : 'direct'); // 'assist' | 'direct'
        let translatedPrompt = '';
        let translatedNegativePrompt = '';

        // sd-server に渡すプロンプトを準備
        let effectivePrompt = userPrompt;
        let effectiveNegativePrompt = userNegativePrompt;

        if (promptMode === 'assist' && translator && translator.assistPrompt) {
            // AIアシストモード: SD向けタグ最適化 + ネガティブ補完
            const assistResult = await translator.assistPrompt(userPrompt, userNegativePrompt);
            if (assistResult.prompt) {
                translatedPrompt = assistResult.prompt;
                effectivePrompt = assistResult.prompt;
            }
            if (assistResult.negative_prompt) {
                translatedNegativePrompt = assistResult.negative_prompt;
                effectiveNegativePrompt = assistResult.negative_prompt;
            }
            console.log(`[generate:assist] Prompt: "${userPrompt}" -> "${effectivePrompt}" | Neg: "${effectiveNegativePrompt}"`);
        } else if (translator && translator.translateJaToEn) {
            // 通常直訳モード
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
            serverId: body.serverId || body.server_id,
            prompt: effectivePrompt,
            negative_prompt: effectiveNegativePrompt
        };

        const genResult = await sdClient.generate(sdParams, clientSignal);
        const durationMs = Date.now() - startTime;
        const finalSeed = genResult.seed !== undefined ? genResult.seed : params.seed;

        let createdItem = null;
        let imagePath = null;

        if (autoSave) {
            // 自動保存指定時のみDB登録・ファイル保存
            imagePath = sdClient.saveImageFile(genResult.base64Data);
            const recordId = imageModel.createImage({
                prompt: userPrompt,
                negative_prompt: userNegativePrompt,
                translated_prompt: translatedPrompt,
                translated_negative_prompt: translatedNegativePrompt,
                width: params.width,
                height: params.height,
                steps: params.steps,
                cfg_scale: params.cfg_scale,
                seed: finalSeed,
                sampler_name: params.sampler_name,
                image_path: imagePath,
                parent_id: params.parent_id,
                generation_time_ms: durationMs
            });
            createdItem = imageModel.getImageById(recordId);
        }

        return {
            success: true,
            base64Data: genResult.base64Data,
            imageDataUrl: `data:image/png;base64,${genResult.base64Data}`,
            imagePath: imagePath,
            data: createdItem,
            serverInfo: genResult.serverInfo || null,
            seed: finalSeed,
            durationMs: durationMs,
            durationSec: (durationMs / 1000).toFixed(2),
            translated: {
                prompt: translatedPrompt || null,
                negative_prompt: translatedNegativePrompt || null
            },
            meta: {
                prompt: userPrompt,
                negative_prompt: userNegativePrompt,
                translated_prompt: translatedPrompt,
                translated_negative_prompt: translatedNegativePrompt,
                width: params.width,
                height: params.height,
                steps: params.steps,
                cfg_scale: params.cfg_scale,
                seed: finalSeed,
                sampler_name: params.sampler_name,
                parent_id: params.parent_id,
                generation_time_ms: durationMs
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
