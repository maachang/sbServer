/**
 * sd-server (stable-diffusion.cpp 等) 連携モジュール
 */
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function safeParseJson(str) {
    if (!str) return null;
    try {
        const clean = str
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/\/\/.*/g, '');
        return JSON.parse(clean);
    } catch (e) {
        try {
            const maachangHome = process.env.MAACHANG_HOME || path.resolve(__dirname, '../../maachang');
            const context = require(path.join(maachangHome, 'src', 'context.js'));
            return context.parseJson(str);
        } catch (err) {
            return null;
        }
    }
}

function loadConf(confName) {
    if (typeof $loadConf !== 'undefined') {
        const loaded = $loadConf(confName);
        if (loaded) return loaded;
    }
    try {
        const localPath = path.join(process.cwd(), 'conf', `${confName}.local.json`);
        const confPath = path.join(process.cwd(), 'conf', `${confName}.json`);
        if (fs.existsSync(localPath)) {
            return safeParseJson(fs.readFileSync(localPath, 'utf8'));
        }
        if (fs.existsSync(confPath)) {
            return safeParseJson(fs.readFileSync(confPath, 'utf8'));
        }
    } catch (e) {}
    return null;
}

module.exports = {
    /**
     * sd-server を呼び出して画像生成を実行
     * @param {Object} params
     * @param {AbortSignal} [clientSignal] クライアント切断や手動キャンセル検知用 Signal
     * @returns {Promise<{ base64Data: string, seed: number, rawResponse?: any }>}
     */
    async generate(params, clientSignal) {
        const conf = loadConf('sdServer') || {};
        const baseUrl = conf.baseUrl || 'http://127.0.0.1:8080';
        const endpoint = conf.endpoint || '/v1/images/generations';
        const timeoutMs = conf.timeoutMs !== undefined ? conf.timeoutMs : 600000; // デフォルト10分

        const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;

        // OpenAI API 互換 /v1/images/generations 形式および sd-server 独自パラメータをマッピング
        const payload = {
            prompt: params.prompt,
            negative_prompt: params.negative_prompt || '',
            size: `${params.width || 512}x${params.height || 512}`,
            width: params.width || 512,
            height: params.height || 512,
            steps: params.steps || 20,
            cfg_scale: params.cfg_scale || 7.0,
            seed: params.seed !== undefined && params.seed !== -1 ? params.seed : Math.floor(Math.random() * 2147483647),
            sampler_name: params.sampler_name || 'euler_a',
            n: 1,
            response_format: 'b64_json'
        };

        const controller = new AbortController();
        let timer = null;
        if (timeoutMs > 0) {
            timer = setTimeout(() => {
                console.log(`[sdClient] Generation timed out after ${timeoutMs}ms. Canceling sd-server generation...`);
                controller.abort(new Error('TIMEOUT'));
                // タイムアウト時も sd-server に中断信号を送信
                this.sendCancelSignal(baseUrl).catch(() => {});
            }, timeoutMs);
        }

        // クライアント側（ブラウザのリロード・離脱・手動キャンセル）からのキャンセル連動
        const onClientAbort = () => {
            console.log('[sdClient] Client aborted the request. Canceling sd-server generation...');
            controller.abort(new Error('CLIENT_ABORTED'));
            // sd-server に中断信号を送信
            this.sendCancelSignal(baseUrl).catch(() => {});
        };

        if (clientSignal) {
            if (clientSignal.aborted) {
                onClientAbort();
            } else {
                clientSignal.addEventListener('abort', onClientAbort, { once: true });
            }
        }

        try {
            console.log(`[sdClient] Requesting sd-server: ${url}`, {
                prompt: payload.prompt,
                size: payload.size,
                steps: payload.steps,
                seed: payload.seed,
                timeoutMs
            });

            const res = await fetch(url, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(payload),
                signal: controller.signal
            });

            if (!res.ok) {
                const errText = await res.text();
                throw new Error(`sd-server error (${res.status}): ${errText}`);
            }

            const json = await res.json();

            // レスポンス解析 (OpenAI形式: data[0].b64_json、または images[0] 等)
            let b64 = '';
            if (json.data && json.data.length > 0 && json.data[0].b64_json) {
                b64 = json.data[0].b64_json;
            } else if (json.images && json.images.length > 0) {
                b64 = json.images[0];
            } else if (typeof json === 'string') {
                b64 = json;
            } else if (json.b64_json) {
                b64 = json.b64_json;
            } else {
                throw new Error('sd-server から画像データ(Base64)を取得できませんでした');
            }

            // data:image/...;base64, プレフィックスが付いている場合は除去
            b64 = b64.replace(/^data:image\/\w+;base64,/, '');

            return {
                base64Data: b64,
                seed: payload.seed,
                rawResponse: json
            };
        } catch (e) {
            if (controller.signal.aborted) {
                if (controller.signal.reason?.message === 'CLIENT_ABORTED' || e.message === 'CLIENT_ABORTED') {
                    throw new Error('クライアントによって生成が中断（キャンセル）されました');
                }
                // タイムアウト時
                throw new Error(`sd-server への画像生成リクエストがタイムアウトしました (${Math.round(timeoutMs / 1000)}秒経過。sd-serverの中断処理を実行しました)`);
            }
            throw e;
        } finally {
            if (timer) clearTimeout(timer);
            if (clientSignal) {
                clientSignal.removeEventListener('abort', onClientAbort);
            }
        }
    },

    /**
     * sd-server (stable-diffusion.cpp) への中断リクエスト送信
     * (POST /cancel または POST /v1/cancel 等に対応)
     */
    async sendCancelSignal(baseUrl) {
        const cancelEndpoints = ['/cancel', '/v1/cancel', '/sdapi/v1/interrupt'];
        for (const ep of cancelEndpoints) {
            try {
                await fetch(`${baseUrl.replace(/\/$/, '')}${ep}`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(3000)
                });
            } catch (e) {}
        }
    },

    /**
     * Base64画像データをファイルとして保存
     * @param {string} base64Data
     * @returns {string} 保存先Web公開パス (/uploads/...)
     */
    saveImageFile(base64Data) {
        const uploadDir = path.join(process.cwd(), 'public', 'uploads');
        if (!fs.existsSync(uploadDir)) {
            fs.mkdirSync(uploadDir, { recursive: true });
        }

        const fileName = `${Date.now()}_${crypto.randomBytes(4).toString('hex')}.png`;
        const filePath = path.join(uploadDir, fileName);

        const buffer = Buffer.from(base64Data, 'base64');
        fs.writeFileSync(filePath, buffer);

        return `/uploads/${fileName}`;
    }
};
