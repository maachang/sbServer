/**
 * sdServer 設定取得 API
 * GET /api/config
 */
exports.handler = async function() {
    const conf = $loadConf('sdServer') || {};

    return {
        success: true,
        defaults: conf.defaults || {
            width: 512,
            height: 512,
            steps: 20,
            cfg_scale: 7.0,
            sampler_name: 'euler_a',
            seed: -1
        },
        options: conf.options || {}
    };
};
