/**
 * sd-server 設定管理 API
 * GET /api/sdServers                 : サーバー一覧・アクティブ設定取得
 * POST /api/sdServers                : サーバー追加/更新/削除/デフォルト設定
 */
exports.handler = async function() {
    const sdClient = $loadLib('sdClient.js');
    const method = $request.method;
    const body = $request.body || {};
    const action = $request.getQuery('action', '') || body.action || '';

    try {
        if (method === 'GET') {
            const config = sdClient.getAllConfig();
            return {
                success: true,
                data: config
            };
        }

        if (method === 'POST') {
            // アクティブ（デフォルト）サーバー切り替え
            if (action === 'setActive') {
                const serverId = body.serverId || body.id;
                if (!serverId) {
                    $response.status(400);
                    return { success: false, error: 'serverId が指定されていません' };
                }
                const result = sdClient.setActiveServer(serverId);
                return {
                    success: true,
                    data: result,
                    message: `デフォルトの SD サーバーを [${serverId}] に設定しました`
                };
            }

            // サーバー追加 / 更新
            if (action === 'saveServer' || action === 'add' || action === 'edit') {
                if (!body.name || !body.baseUrl) {
                    $response.status(400);
                    return { success: false, error: 'サーバー名とベースURLは必須です' };
                }
                const result = sdClient.saveServer(body);
                return {
                    success: true,
                    data: result,
                    message: `SD サーバー [${body.name}] を保存しました`
                };
            }

            // サーバー削除
            if (action === 'deleteServer' || action === 'delete') {
                const serverId = body.serverId || body.id;
                if (!serverId) {
                    $response.status(400);
                    return { success: false, error: 'serverId が指定されていません' };
                }
                const result = sdClient.deleteServer(serverId);
                return {
                    success: true,
                    data: result,
                    message: `SD サーバー [${serverId}] を削除しました`
                };
            }

            // デフォルト生成パラメータ保存
            if (action === 'saveDefaults') {
                const result = sdClient.saveDefaults(body);
                return {
                    success: true,
                    data: result,
                    message: 'デフォルト生成パラメータを保存しました'
                };
            }

            // 接続テスト
            if (action === 'testConnection') {
                const testResult = await sdClient.testServerConnection(body);
                if (!testResult.success) {
                    $response.status(400);
                    return {
                        success: false,
                        error: testResult.error
                    };
                }
                return {
                    success: true,
                    data: testResult,
                    message: testResult.message || '接続に成功しました！'
                };
            }

            $response.status(400);
            return { success: false, error: `無効な action です: ${action}` };
        }

        $response.status(405);
        return { success: false, error: 'Method Not Allowed' };
    } catch (err) {
        $response.status(500);
        return {
            success: false,
            error: err.message
        };
    }
};
