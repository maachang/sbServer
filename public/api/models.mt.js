/**
 * ローカル LLM モデル管理 API
 * GET /api/models                 : モデル一覧・現在の状態取得
 * GET /api/models?action=progress : ダウンロード/ロード進捗のリアルタイム取得
 * POST /api/models/switch         : アクティブモデルの切り替え / ロード
 * POST /api/models/add            : 新規モデルの追加
 * POST /api/models/delete         : モデルの削除
 */
exports.handler = async function() {
    const translator = $loadLib('translator.js');
    const method = $request.method;
    const body = $request.body || {};
    const action = $request.getQuery('action', '');

    try {
        if (method === 'GET') {
            if (action === 'progress') {
                const progress = translator.getLoadProgress();
                return {
                    success: true,
                    data: progress
                };
            }

            const status = translator.getModelsStatus();
            return {
                success: true,
                data: status
            };
        }

        if (method === 'POST') {
            // 切り替え / ロード
            if (action === 'switch' || body.action === 'switch') {
                const modelId = body.modelId;
                if (!modelId) {
                    $response.status(400);
                    return { success: false, error: 'modelId が指定されていません' };
                }
                const result = await translator.switchModel(modelId);
                return {
                    success: true,
                    data: result,
                    message: `モデルを [${modelId}] に切り替えました`
                };
            }

            // 新規モデル追加
            if (action === 'add' || body.action === 'add') {
                const modelId = body.modelId;
                if (!modelId) {
                    $response.status(400);
                    return { success: false, error: 'modelId が指定されていません' };
                }
                const result = translator.addModel({
                    id: modelId,
                    name: body.name,
                    description: body.description,
                    dtype: body.dtype || 'q4',
                    task: body.task || 'text-generation'
                });
                return {
                    success: true,
                    data: result,
                    message: `モデル [${modelId}] を登録しました`
                };
            }

            // キャッシュファイルのみ削除 (ディスク容量解放)
            if (action === 'deleteCache' || body.action === 'deleteCache') {
                const modelId = body.modelId;
                if (!modelId) {
                    $response.status(400);
                    return { success: false, error: 'modelId が指定されていません' };
                }
                translator.deleteModelCache(modelId);
                const result = translator.getModelsStatus();
                return {
                    success: true,
                    data: result,
                    message: `モデル [${modelId}] のダウンロード済みキャッシュを削除しました`
                };
            }

            // モデル削除（設定から削除、オプションでキャッシュも削除）
            if (action === 'delete' || body.action === 'delete') {
                const modelId = body.modelId;
                const deleteCache = body.deleteCache === true;
                if (!modelId) {
                    $response.status(400);
                    return { success: false, error: 'modelId が指定されていません' };
                }
                const result = translator.deleteModel(modelId, deleteCache);
                return {
                    success: true,
                    data: result,
                    message: `モデル [${modelId}] を削除しました${deleteCache ? '（キャッシュも削除）' : ''}`
                };
            }
        }

        $response.status(405);
        return { success: false, error: 'Method Not Allowed' };

    } catch (e) {
        $response.status(500);
        return {
            success: false,
            error: e.message
        };
    }
};
