/**
 * 画像生成実行 API (非同期タスク・ポーリング方式対応)
 * POST /api/generate                 : 生成開始 (taskId を即時返却)
 * GET /api/generate?taskId=xxx       : 生成ステータス確認
 * POST /api/generate (action:cancel) : 生成キャンセル
 */

// グローバルタスク管理マップ
if (!global.__sdTasks) {
    global.__sdTasks = new Map();
}

// 10分以上経過した古いタスクの定期クリーンアップ
setInterval(() => {
    const now = Date.now();
    for (const [id, task] of global.__sdTasks.entries()) {
        if (now - task.createdTime > 10 * 60 * 1000) {
            global.__sdTasks.delete(id);
        }
    }
}, 60000);

exports.handler = async function() {
    const validate = $loadLib('validate.js');
    const imageSchema = $loadLib('validates/image.js');
    const sdClient = $loadLib('sdClient.js');
    const imageModel = $loadLib('imageModel.js');
    const translator = $loadLib('translator.js');

    const method = $request.method;
    let body = $request.body || {};
    if (typeof body === 'string') {
        try {
            body = JSON.parse(body);
        } catch (e) {
            body = {};
        }
    }
    const taskId = $request.getQuery('taskId', '') || body.taskId || '';
    const action = $request.getQuery('action', '') || body.action || '';

    // キャンセル要求 (POST または GET)
    if (action === 'cancel' || body.action === 'cancel') {
        console.log(`[generate.mt.js] Cancel request received for taskId: ${taskId}`);
        if (taskId) {
            const task = global.__sdTasks.get(taskId);
            if (task && task.status === 'running') {
                task.status = 'failed';
                task.error = 'ユーザーによって生成がキャンセルされました';
                try {
                    task.abortController.abort(new Error('CLIENT_ABORTED'));
                } catch (e) {}
                if (task.serverBaseUrl) {
                    sdClient.sendCancelSignal(task.serverBaseUrl).catch(() => {});
                }
            }
        }
        return { success: true, message: 'キャンセル処理を実行しました' };
    }

    // GET /api/generate?taskId=... (ステータス確認)
    if (method === 'GET' && taskId) {
        const task = global.__sdTasks.get(taskId);
        if (!task) {
            $response.status(404);
            return { success: false, error: '指定された生成タスクが存在しないか、有効期限が切れています' };
        }

        if (task.status === 'running') {
            const elapsedMs = Date.now() - task.startTime;
            return {
                success: true,
                taskId: task.id,
                status: 'running',
                elapsedMs: elapsedMs,
                elapsedSec: (elapsedMs / 1000).toFixed(1)
            };
        }

        if (task.status === 'completed') {
            return {
                success: true,
                taskId: task.id,
                status: 'completed',
                ...task.result
            };
        }

        if (task.status === 'failed') {
            return {
                success: false,
                taskId: task.id,
                status: 'failed',
                error: task.error || '画像生成に失敗しました'
            };
        }
    }

    if (method !== 'POST') {
        $response.status(405);
        return { success: false, error: 'Method Not Allowed' };
    }

    // バリデーション
    const checkResult = validate.check(body, imageSchema);
    if (!checkResult.valid) {
        $response.status(400);
        return {
            success: false,
            errors: checkResult.errors
        };
    }

    const params = checkResult.data;
    const autoSave = body.autoSave === true;
    const promptMode = body.promptMode || (body.promptAssist ? 'assist' : 'direct');
    const userPrompt = params.prompt;
    const userNegativePrompt = params.negative_prompt || '';
    const theme = params.theme || body.theme || body.themeId || '';

    // 新規タスクの作成
    const newTaskId = `task_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
    const abortController = new AbortController();
    const targetServer = sdClient.resolveServer(body.serverId || body.server_id);

    const task = {
        id: newTaskId,
        status: 'running',
        createdTime: Date.now(),
        startTime: Date.now(),
        serverBaseUrl: targetServer ? targetServer.baseUrl : null,
        abortController,
        result: null,
        error: null
    };

    global.__sdTasks.set(newTaskId, task);

    // バックグラウンドで非同期生成を実行
    (async () => {
        try {
            let translatedPrompt = '';
            let translatedNegativePrompt = '';
            let effectivePrompt = userPrompt;
            let effectiveNegativePrompt = userNegativePrompt;
            const modelType = targetServer ? (targetServer.modelType || 'sd15') : 'sd15';
            
            if (promptMode === 'assist' && translator && translator.assistPrompt) {
                const assistResult = await translator.assistPrompt(userPrompt, userNegativePrompt, modelType, theme);
                if (assistResult.prompt) {
                    translatedPrompt = assistResult.prompt;
                    effectivePrompt = assistResult.prompt;
                }
                if (assistResult.negative_prompt !== undefined) {
                    translatedNegativePrompt = assistResult.negative_prompt;
                    effectiveNegativePrompt = assistResult.negative_prompt;
                }
            } else if (translator) {
                if (translator.translateJaToEn) {
                    if (translator.containsJapanese(userPrompt)) {
                        translatedPrompt = await translator.translateJaToEn(userPrompt);
                        effectivePrompt = translatedPrompt;
                    }
                    if (translator.containsJapanese(userNegativePrompt)) {
                        translatedNegativePrompt = await translator.translateJaToEn(userNegativePrompt);
                        effectiveNegativePrompt = translatedNegativePrompt;
                    }
                }
                if (theme && translator.applyThemeToPrompt) {
                    const themed = translator.applyThemeToPrompt(effectivePrompt, effectiveNegativePrompt, theme, modelType);
                    effectivePrompt = themed.prompt;
                    effectiveNegativePrompt = themed.negative_prompt;
                    if (translatedPrompt) {
                        translatedPrompt = effectivePrompt;
                    }
                    if (translatedNegativePrompt) {
                        translatedNegativePrompt = effectiveNegativePrompt;
                    }
                }
            }

            const sdParams = {
                ...params,
                serverId: body.serverId || body.server_id,
                prompt: effectivePrompt,
                negative_prompt: effectiveNegativePrompt
            };

            const genResult = await sdClient.generate(sdParams, abortController.signal);
            const durationMs = Date.now() - task.startTime;
            const finalSeed = genResult.seed !== undefined ? genResult.seed : params.seed;

            let createdItem = null;
            let imagePath = null;

            if (autoSave) {
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
                    server_id: genResult.serverInfo?.id || params.serverId || params.server_id,
                    server_name: genResult.serverInfo?.name || '',
                    theme: theme,
                    generation_time_ms: durationMs
                });
                createdItem = imageModel.getImageById(recordId);
            }

            task.status = 'completed';
            task.result = {
                base64Data: genResult.base64Data,
                imageDataUrl: `data:image/png;base64,${genResult.base64Data}`,
                imagePath: imagePath,
                data: createdItem,
                serverInfo: genResult.serverInfo || null,
                seed: finalSeed,
                durationMs: durationMs,
                durationSec: (durationMs / 1000).toFixed(2),
                theme: theme,
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
                    server_id: genResult.serverInfo?.id || params.serverId || params.server_id,
                    server_name: genResult.serverInfo?.name || '',
                    theme: theme,
                    generation_time_ms: durationMs
                }
            };
        } catch (err) {
            task.status = 'failed';
            task.error = err.message || '画像生成に失敗しました';
        }
    })();

    // 即座に taskId を返却（HTTP接続を切断せず、タイムアウトしないポーリングに切り替え）
    return {
        success: true,
        taskId: newTaskId,
        status: 'running'
    };
};
