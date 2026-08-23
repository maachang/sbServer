/**
 * 画像一覧取得 API
 * GET /api/images
 * query: keyword, limit, offset
 */
exports.handler = async function() {
    const imageModel = $loadLib('imageModel.js');

    const keyword = $request.getQuery('keyword', '');
    const limit = parseInt($request.getQuery('limit', '20'), 10) || 20;
    const offset = parseInt($request.getQuery('offset', '0'), 10) || 0;

    try {
        const result = imageModel.findImages({ keyword, limit, offset });
        return {
            success: true,
            ...result
        };
    } catch (e) {
        $response.status(500);
        return {
            success: false,
            error: e.message
        };
    }
};
