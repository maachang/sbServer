/**
 * 画像生成リクエストのバリデーション定義
 */
module.exports = {
    prompt: {
        type: 'string',
        required: true,
        minLen: 1,
        maxLen: 4000,
        messages: {
            required: 'プロンプトを入力してください',
            minLen: 'プロンプトは1文字以上で入力してください'
        }
    },
    negative_prompt: {
        type: 'string',
        required: false,
        maxLen: 4000,
        default: ''
    },
    width: {
        type: 'int',
        required: false,
        range: [64, 2048],
        default: 512
    },
    height: {
        type: 'int',
        required: false,
        range: [64, 2048],
        default: 512
    },
    steps: {
        type: 'int',
        required: false,
        range: [1, 150],
        default: 20
    },
    cfg_scale: {
        type: 'float',
        required: false,
        range: [1.0, 30.0],
        default: 7.0
    },
    seed: {
        type: 'int',
        required: false,
        default: -1
    },
    sampler_name: {
        type: 'string',
        required: false,
        default: 'euler_a'
    },
    parent_id: {
        type: 'int',
        required: false,
        default: null
    }
};
