/**
 * リクエスト共通フィルター (filter.mt.js)
 * true を返すと後続の処理に進みます。
 */
exports.handler = async function() {
    // アクセスログ出力などの共通処理
    // console.log(`[${new Date().toISOString()}] ${$request.method} ${$request.path}`);
    
    return true;
};
