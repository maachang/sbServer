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

function saveConf(confName, data) {
    try {
        const confPath = path.join(process.cwd(), 'conf', `${confName}.json`);
        fs.writeFileSync(confPath, JSON.stringify(data, null, 2), 'utf8');
        return true;
    } catch (e) {
        console.error('[sdClient] Failed to save config:', e);
        return false;
    }
}

function resolveServer(conf, serverId) {
    const servers = conf.servers || [];
    if (serverId) {
        const found = servers.find(s => s.id === serverId || s.name === serverId);
        if (found) return found;
    }
    if (conf.activeServer) {
        const found = servers.find(s => s.id === conf.activeServer || s.name === conf.activeServer);
        if (found) return found;
    }
    if (servers.length > 0) {
        return servers[0];
    }
    return {
        id: 'default',
        name: 'デフォルト SD サーバー',
        baseUrl: conf.baseUrl || 'http://127.0.0.1:8080',
        endpoint: conf.endpoint || '/sdapi/v1/txt2img',
        timeoutMs: conf.timeoutMs !== undefined ? conf.timeoutMs : 600000
    };
}

module.exports = {
    /**
     * SDサーバー設定の解決
     */
    resolveServer(serverId) {
        const conf = loadConf('sdServer') || {};
        const srv = resolveServer(conf, serverId);
        return {
            ...srv,
            baseUrl: srv.baseUrl || conf.baseUrl || 'http://127.0.0.1:8080'
        };
    },

    /**
     * SDサーバー定義一覧の取得
     */
    getServerList() {
        const conf = loadConf('sdServer') || {};
        const servers = conf.servers || [];
        if (servers.length === 0) {
            return [{
                id: 'default',
                name: 'デフォルト SD サーバー',
                baseUrl: conf.baseUrl || 'http://127.0.0.1:8080',
                endpoint: conf.endpoint || '/sdapi/v1/txt2img',
                timeoutMs: conf.timeoutMs !== undefined ? conf.timeoutMs : 600000,
                description: 'デフォルト接続先'
            }];
        }
        return servers;
    },

    /**
     * sd-server を呼び出して画像生成を実行
     * @param {Object} params
     * @param {AbortSignal} [clientSignal] クライアント切断や手動キャンセル検知用 Signal
     * @returns {Promise<{ base64Data: string, seed: number, rawResponse?: any, serverInfo?: any }>}
     */
    async generate(params, clientSignal) {
        const conf = loadConf('sdServer') || {};
        const server = resolveServer(conf, params.serverId || params.server_id);
        const baseUrl = server.baseUrl || conf.baseUrl || 'http://127.0.0.1:8080';
        const endpoint = server.endpoint || conf.endpoint || '/sdapi/v1/txt2img';
        const timeoutMs = server.timeoutMs !== undefined ? server.timeoutMs : (conf.timeoutMs !== undefined ? conf.timeoutMs : 600000);

        const url = `${baseUrl.replace(/\/$/, '')}${endpoint}`;

        const srvDefaults = server.defaults || {};
        const globalDefaults = conf.defaults || {};

        const effectiveWidth = params.width || srvDefaults.width || globalDefaults.width || 512;
        const effectiveHeight = params.height || srvDefaults.height || globalDefaults.height || 512;
        const effectiveSteps = params.steps || srvDefaults.steps || globalDefaults.steps || 20;
        const effectiveCfg = params.cfg_scale !== undefined ? params.cfg_scale : (srvDefaults.cfg_scale !== undefined ? srvDefaults.cfg_scale : (globalDefaults.cfg_scale !== undefined ? globalDefaults.cfg_scale : 7.0));
        const effectiveSampler = params.sampler_name || srvDefaults.sampler_name || globalDefaults.sampler_name || 'euler_a';

        // OpenAI API 互換 /v1/images/generations 形式および sd-server 独自パラメータをマッピング
        const payload = {
            prompt: params.prompt,
            negative_prompt: params.negative_prompt || '',
            size: `${effectiveWidth}x${effectiveHeight}`,
            width: effectiveWidth,
            height: effectiveHeight,
            steps: effectiveSteps,
            cfg_scale: effectiveCfg,
            seed: params.seed !== undefined && params.seed !== -1 ? params.seed : Math.floor(Math.random() * 2147483647),
            sampler_name: effectiveSampler,
            batch_size: 1,
            n_iter: 1,
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

            // 1. まず sdcpp 非同期ジョブAPI (/sdcpp/v1/img_gen) を試行 (ソケットタイムアウト完全回避)
            try {
                const sdcppPayload = {
                    prompt: payload.prompt,
                    negative_prompt: payload.negative_prompt,
                    width: effectiveWidth,
                    height: effectiveHeight,
                    seed: payload.seed,
                    sample_params: {
                        sample_steps: effectiveSteps,
                        sample_method: effectiveSampler,
                        guidance: {
                            txt_cfg: effectiveCfg
                        }
                    },
                    output_format: 'png',
                    output_compression: 100
                };

                const jobInitRes = await fetch(`${baseUrl.replace(/\/$/, '')}/sdcpp/v1/img_gen`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(sdcppPayload),
                    signal: AbortSignal.timeout(5000)
                });

                if (jobInitRes.status === 200 || jobInitRes.status === 202) {
                    const jobData = await jobInitRes.json();
                    if (jobData && jobData.id) {
                        const jobId = jobData.id;
                        const pollUrl = `${baseUrl.replace(/\/$/, '')}${jobData.poll_url || `/sdcpp/v1/jobs/${jobId}`}`;
                        console.log(`[sdClient] sdcpp async job created: ${jobId}. Polling ${pollUrl}...`);

                        const startTime = Date.now();
                        while (Date.now() - startTime < timeoutMs) {
                            if (controller.signal.aborted) {
                                fetch(`${baseUrl.replace(/\/$/, '')}/sdcpp/v1/jobs/${jobId}/cancel`, { method: 'POST' }).catch(() => {});
                                if (controller.signal.reason?.message === 'CLIENT_ABORTED') {
                                    throw new Error('クライアントによって生成が中断（キャンセル）されました');
                                }
                                throw new Error(`sd-server への画像生成リクエストがタイムアウトしました (${Math.round(timeoutMs / 1000)}秒経過)`);
                            }

                            await new Promise(r => setTimeout(r, 1500));

                            try {
                                const pollRes = await fetch(pollUrl, { signal: AbortSignal.timeout(4000) });
                                if (pollRes.ok) {
                                    const st = await pollRes.json();
                                    if (st.status === 'completed') {
                                        const b64 = st.result?.images?.[0]?.b64_json || st.result?.data?.[0]?.b64_json || '';
                                        if (!b64) {
                                            throw new Error('sdcpp ジョブから画像データ(Base64)を取得できませんでした');
                                        }
                                        return {
                                            base64Data: b64.replace(/^data:image\/\w+;base64,/, ''),
                                            seed: payload.seed,
                                            serverInfo: { id: server.id, name: server.name },
                                            rawResponse: st
                                        };
                                    } else if (st.status === 'failed' || st.status === 'cancelled') {
                                        const errMsg = st.error?.message || (typeof st.error === 'string' ? st.error : st.status);
                                        throw new Error(`sd-server ジョブエラー: ${errMsg}`);
                                    }
                                }
                            } catch (pe) {
                                if (pe.message && pe.message.includes('sd-server ジョブエラー')) throw pe;
                            }
                        }

                        throw new Error(`sd-server への画像生成リクエストがタイムアウトしました (${Math.round(timeoutMs / 1000)}秒経過)`);
                    }
                }
            } catch (sdcppErr) {
                if (controller.signal.aborted || (sdcppErr.message && (sdcppErr.message.includes('キャンセル') || sdcppErr.message.includes('タイムアウト') || sdcppErr.message.includes('ジョブエラー')))) {
                    throw sdcppErr;
                }
                console.log('[sdClient] sdcpp API fallback to synchronous endpoint:', sdcppErr.message);
            }

            // 2. 同期エンドポイントへのフォールバック実行
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
                serverInfo: {
                    id: server.id,
                    name: server.name
                },
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
     * @param {string} baseUrl
     * @param {string} [jobId]
     */
    async sendCancelSignal(baseUrl, jobId) {
        if (!baseUrl) return;
        const base = baseUrl.replace(/\/$/, '');

        if (jobId) {
            try {
                await fetch(`${base}/sdcpp/v1/jobs/${jobId}/cancel`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    signal: AbortSignal.timeout(2000)
                });
                return;
            } catch (e) {}
        }

        const endpoints = [
            { path: '/cancel', method: 'POST' },
            { path: '/sdapi/v1/interrupt', method: 'POST' }
        ];

        await Promise.allSettled(endpoints.map(ep =>
            fetch(`${base}${ep.path}`, {
                method: ep.method,
                headers: { 'Content-Type': 'application/json' },
                signal: AbortSignal.timeout(2000)
            }).catch(() => {})
        ));
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
    },

    /**
     * 全設定の取得
     */
    getAllConfig() {
        const conf = loadConf('sdServer') || {};
        const servers = conf.servers || [];
        const activeServer = conf.activeServer || (servers[0] ? servers[0].id : 'default');
        return {
            activeServer,
            servers,
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
    },

    /**
     * デフォルトサーバーの変更
     */
    setActiveServer(serverId) {
        const conf = loadConf('sdServer') || {};
        conf.activeServer = serverId;
        saveConf('sdServer', conf);
        return this.getAllConfig();
    },

    /**
     * サーバーの追加 / 更新
     */
    saveServer(serverData) {
        const conf = loadConf('sdServer') || {};
        if (!conf.servers) conf.servers = [];

        const id = (serverData.id || `server-${Date.now()}`).trim();
        const item = {
            id: id,
            name: (serverData.name || id).trim(),
            modelType: (serverData.modelType || 'sd15').trim(),
            baseUrl: (serverData.baseUrl || 'http://127.0.0.1:8080').trim().replace(/\/+$/, ''),
            endpoint: (serverData.endpoint || '/sdapi/v1/txt2img').trim(),
            timeoutMs: parseInt(serverData.timeoutMs, 10) || 600000,
            description: (serverData.description || '').trim()
        };

        if (serverData.defaults && typeof serverData.defaults === 'object') {
            const defs = {};
            if (serverData.defaults.width) defs.width = parseInt(serverData.defaults.width, 10);
            if (serverData.defaults.height) defs.height = parseInt(serverData.defaults.height, 10);
            if (serverData.defaults.steps) defs.steps = parseInt(serverData.defaults.steps, 10);
            if (serverData.defaults.cfg_scale !== undefined && serverData.defaults.cfg_scale !== '') {
                defs.cfg_scale = parseFloat(serverData.defaults.cfg_scale);
            }
            if (serverData.defaults.sampler_name) defs.sampler_name = serverData.defaults.sampler_name.trim();

            if (Object.keys(defs).length > 0) {
                item.defaults = defs;
            }
        }

        const existingIdx = conf.servers.findIndex(s => s.id === id);
        if (existingIdx >= 0) {
            conf.servers[existingIdx] = item;
        } else {
            conf.servers.push(item);
        }

        if (!conf.activeServer) {
            conf.activeServer = id;
        }

        saveConf('sdServer', conf);
        return this.getAllConfig();
    },

    /**
     * サーバーの削除
     */
    deleteServer(serverId) {
        const conf = loadConf('sdServer') || {};
        if (!conf.servers) return this.getAllConfig();

        conf.servers = conf.servers.filter(s => s.id !== serverId);
        if (conf.activeServer === serverId) {
            conf.activeServer = conf.servers[0]?.id || '';
        }

        saveConf('sdServer', conf);
        return this.getAllConfig();
    },

    /**
     * デフォルトパラメータの保存
     */
    saveDefaults(defaultsData) {
        const conf = loadConf('sdServer') || {};
        conf.defaults = {
            width: parseInt(defaultsData.width, 10) || 512,
            height: parseInt(defaultsData.height, 10) || 512,
            steps: parseInt(defaultsData.steps, 10) || 20,
            cfg_scale: parseFloat(defaultsData.cfg_scale) || 7.0,
            sampler_name: defaultsData.sampler_name || 'euler_a',
            seed: parseInt(defaultsData.seed, 10) !== undefined ? parseInt(defaultsData.seed, 10) : -1
        };
        saveConf('sdServer', conf);
        return this.getAllConfig();
    },

    /**
     * サーバー接続テスト
     */
    async testServerConnection(serverData) {
        const baseUrl = (serverData.baseUrl || 'http://127.0.0.1:8080').trim().replace(/\/+$/, '');
        const endpoint = (serverData.endpoint || '/sdapi/v1/txt2img').trim();

        // テスト用候補URL
        const testUrls = [];
        if (endpoint.startsWith('/sdapi')) {
            testUrls.push(`${baseUrl}/sdapi/v1/samplers`);
            testUrls.push(`${baseUrl}/sdapi/v1/sd-models`);
            testUrls.push(`${baseUrl}/sdapi/v1/options`);
        } else if (endpoint.startsWith('/v1')) {
            testUrls.push(`${baseUrl}/v1/models`);
        }
        testUrls.push(`${baseUrl}/`);

        let lastError = null;
        for (const url of testUrls) {
            try {
                const res = await fetch(url, {
                    method: 'GET',
                    headers: { 'Accept': 'application/json, text/plain, */*' },
                    signal: AbortSignal.timeout(4000)
                });
                if (res.ok || res.status === 404 || res.status === 405) {
                    return {
                        success: true,
                        status: res.status,
                        url: url,
                        message: `接続に成功しました (${baseUrl} - HTTP ${res.status})`
                    };
                }
            } catch (err) {
                lastError = err;
            }
        }

        return {
            success: false,
            error: lastError ? `接続失敗: ${lastError.message}` : '接続できませんでした'
        };
    }
};
