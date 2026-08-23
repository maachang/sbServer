/**
 * API エンドポイントサンプル (.mt.js)
 */
exports.handler = async function() {
    const sessionMod = $loadLib('session.js');
    let session = sessionMod.getSession($request);

    if (!session) {
        session = sessionMod.createSession($response, {
            visitedAt: new Date().toISOString(),
            count: 1
        });
    } else {
        session.data.count = (session.data.count || 0) + 1;
        sessionMod.setSession(session.sid, session.data);
    }

    return {
        message: "Hello from maachang!",
        serverTime: new Date().toISOString(),
        clientIp: $request.ip,
        sessionCount: session.data.count
    };
};
