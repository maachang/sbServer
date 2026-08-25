/**
 * sdServer 設定取得 API
 * GET /api/config
 */
exports.handler = async function() {
    const conf = $loadConf('sdServer') || {};
    const llmConf = $loadConf('localLlm') || conf.llm || {};
    const sdClient = $loadLib('sdClient.js');
    const translator = $loadLib('translator.js');

    let activeModelName = 'ローカルLLM';
    if (translator && translator.getModelsStatus) {
        const status = translator.getModelsStatus();
        const activeItem = status.models.find(m => m.id === status.activeModel);
        if (activeItem) {
            activeModelName = activeItem.name || activeItem.id;
        } else if (status.activeModel) {
            activeModelName = status.activeModel.split('/').pop();
        }
    }

    const servers = sdClient && sdClient.getServerList ? sdClient.getServerList() : (conf.servers || []);
    const activeServer = conf.activeServer || (servers[0] ? servers[0].id : 'default');

    return {
        success: true,
        servers: servers,
        activeServer: activeServer,
        defaults: conf.defaults || {
            width: 512,
            height: 512,
            steps: 20,
            cfg_scale: 7.0,
            sampler_name: 'euler_a',
            seed: -1
        },
        options: conf.options || {},
        llm: {
            activeModel: llmConf.activeModel || 'onnx-community/Qwen2.5-1.5B-Instruct',
            activeModelName: activeModelName
        }
    };
};
