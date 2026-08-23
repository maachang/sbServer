/**
 * 画像削除 API
 * POST /api/delete
 * body: { id: 123 }
 */
exports.handler = async function() {
    const imageModel = $loadLib('imageModel.js');
    const body = $request.body || {};
    const id = parseInt(body.id || $request.getQuery('id', '0'), 10);

    if (!id) {
        $response.status(400);
        return { success: false, error: 'IDが指定されていません' };
    }

    try {
        const deleted = imageModel.deleteImage(id);
        if (!deleted) {
            $response.status(404);
            return { success: false, error: '画像が見つからないか、削除できませんでした' };
        }
        return {
            success: true,
            message: '削除しました'
        };
    } catch (e) {
        $response.status(500);
        return { success: false, error: e.message };
    }
};
