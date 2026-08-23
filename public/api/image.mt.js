/**
 * 単一画像取得 API
 * GET /api/image?id=123
 */
exports.handler = async function() {
    const imageModel = $loadLib('imageModel.js');
    const id = parseInt($request.getQuery('id', '0'), 10);

    if (!id) {
        $response.status(400);
        return { success: false, error: 'IDが指定されていません' };
    }

    try {
        const item = imageModel.getImageById(id);
        if (!item) {
            $response.status(404);
            return { success: false, error: '画像が見つかりません' };
        }
        return {
            success: true,
            data: item
        };
    } catch (e) {
        $response.status(500);
        return { success: false, error: e.message };
    }
};
