/**
 * 生成画像 永続化保存 API
 * POST /api/save
 * body: {
 *   prompt, negative_prompt, translated_prompt, translated_negative_prompt,
 *   width, height, steps, cfg_scale, seed, sampler_name, parent_id,
 *   generation_time_ms, base64Data
 * }
 */
exports.handler = async function() {
    const imageModel = $loadLib('imageModel.js');
    const sdClient = $loadLib('sdClient.js');

    const body = $request.body || {};
    const base64Data = body.base64Data;

    const editId = body.id || body.edit_id || null;

    if (!base64Data) {
        $response.status(400);
        return { success: false, error: '画像データ (base64Data) がありません' };
    }

    try {
        // 画像ファイルを /uploads/... に永続保存
        const imagePath = sdClient.saveImageFile(base64Data);

        let recordId;
        if (editId) {
            // 編集モード：既存レコードを上書き更新
            const parsedId = parseInt(editId, 10);
            imageModel.updateImage(parsedId, {
                prompt: body.prompt || '',
                negative_prompt: body.negative_prompt || '',
                translated_prompt: body.translated_prompt || '',
                translated_negative_prompt: body.translated_negative_prompt || '',
                width: body.width || 512,
                height: body.height || 512,
                steps: body.steps || 20,
                cfg_scale: body.cfg_scale || 7.0,
                seed: body.seed !== undefined ? body.seed : -1,
                sampler_name: body.sampler_name || 'euler_a',
                image_path: imagePath,
                generation_time_ms: body.generation_time_ms || 0
            });
            recordId = parsedId;
        } else {
            // 新規作成モード：DBに新規レコード作成
            recordId = imageModel.createImage({
                prompt: body.prompt || '',
                negative_prompt: body.negative_prompt || '',
                translated_prompt: body.translated_prompt || '',
                translated_negative_prompt: body.translated_negative_prompt || '',
                width: body.width || 512,
                height: body.height || 512,
                steps: body.steps || 20,
                cfg_scale: body.cfg_scale || 7.0,
                seed: body.seed !== undefined ? body.seed : -1,
                sampler_name: body.sampler_name || 'euler_a',
                image_path: imagePath,
                parent_id: body.parent_id || null,
                generation_time_ms: body.generation_time_ms || 0
            });
        }

        const savedItem = imageModel.getImageById(recordId);

        return {
            success: true,
            data: savedItem,
            message: editId ? '画像を上書き保存しました' : '画像を保存しました'
        };
    } catch (e) {
        $response.status(500);
        return {
            success: false,
            error: e.message
        };
    }
};
