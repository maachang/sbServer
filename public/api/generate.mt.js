/**
 * 画像生成実行 API
 * POST /api/generate
 */
exports.handler = async function() {
    const validate = $loadLib('validate.js');
    const imageSchema = $loadLib('validates/image.js');
    const sdClient = $loadLib('sdClient.js');
    const imageModel = $loadLib('imageModel.js');

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
        // sd-server へ生成リクエスト (クライアント切断シグナル連動)
        const genResult = await sdClient.generate(params, clientSignal);

        const durationMs = Date.now() - startTime;

        // 画像ファイル保存
        const imagePath = sdClient.saveImageFile(genResult.base64Data);

        // DB登録 (生成所要時間をミリ秒で記録)
        const recordId = imageModel.createImage({
            prompt: params.prompt,
            negative_prompt: params.negative_prompt,
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
            durationSec: (durationMs / 1000).toFixed(2)
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
