/**
 * バリデーション定義サンプル (validates/sample.js)
 * 
 * 利用方法:
 *   const validate = $loadLib('validate.js');
 *   const sampleSchema = $loadLib('validates/sample.js'); // または $loadLib('sample.js')
 *   const result = validate.check($request.body, sampleSchema);
 *   if (!result.valid) {
 *       return $response.json({ errors: result.errors }, 400);
 *   }
 */
module.exports = {
    name: {
        type: 'string',
        required: true,
        minLen: 1,
        maxLen: 50,
        messages: {
            required: '名前は必須です',
            maxLen: '名前は50文字以内で入力してください'
        }
    },
    email: {
        type: 'string',
        required: false,
        mail: true,
        messages: {
            mail: '有効なメールアドレス形式で入力してください'
        }
    },
    age: {
        type: 'int',
        required: false,
        range: [0, 150],
        messages: {
            type: '年齢は数値で入力してください',
            range: '年齢は0歳から150歳の間で入力してください'
        }
    }
};
