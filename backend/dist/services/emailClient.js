"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isEmailConfigured = isEmailConfigured;
exports.emailDiagnostics = emailDiagnostics;
exports.connectViaHttpProxy = connectViaHttpProxy;
exports.sendMail = sendMail;
const node_http_1 = __importDefault(require("node:http"));
const nodemailer_1 = __importDefault(require("nodemailer"));
const env_1 = require("../config/env");
function isEmailConfigured() {
    return Boolean(env_1.env.SMTP_HOST && env_1.env.SMTP_FROM && env_1.env.MONTHLY_REPORT_TO);
}
function emailDiagnostics() {
    return {
        configured: isEmailConfigured(),
        host: env_1.env.SMTP_HOST || 'not-configured',
        port: env_1.env.SMTP_PORT,
        secure: env_1.env.SMTP_SECURE,
        requireTLS: env_1.env.SMTP_REQUIRE_TLS,
        from: env_1.env.SMTP_FROM || 'not-configured',
        to: env_1.env.MONTHLY_REPORT_TO || 'not-configured',
        proxy: env_1.env.SMTP_PROXY || 'not-configured',
        user: env_1.env.SMTP_USER ? (0, env_1.maskSecret)(env_1.env.SMTP_USER) : 'not-configured',
        monthlyReportEnabled: env_1.env.MONTHLY_REPORT_ENABLED,
    };
}
/** HTTP CONNECT through tinyproxy-style proxies (same idea as curl -x). */
function connectViaHttpProxy(proxyUrl, targetHost, targetPort, timeoutMs = 30_000) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (error) => {
            if (settled)
                return;
            settled = true;
            reject(error);
        };
        const ok = (socket) => {
            if (settled)
                return;
            settled = true;
            resolve(socket);
        };
        let proxy;
        try {
            proxy = new URL(proxyUrl);
        }
        catch {
            fail(new Error(`Invalid SMTP_PROXY URL: ${proxyUrl}`));
            return;
        }
        const req = node_http_1.default.request({
            protocol: proxy.protocol,
            hostname: proxy.hostname,
            port: proxy.port || (proxy.protocol === 'https:' ? 443 : 80),
            method: 'CONNECT',
            path: `${targetHost}:${targetPort}`,
            headers: {
                Host: `${targetHost}:${targetPort}`,
                'Proxy-Connection': 'Keep-Alive',
            },
            timeout: timeoutMs,
        });
        req.setTimeout(timeoutMs, () => {
            req.destroy();
            fail(new Error(`Proxy CONNECT timed out after ${timeoutMs}ms via ${proxyUrl}`));
        });
        req.on('connect', (res, socket) => {
            if (res.statusCode !== 200) {
                socket.destroy();
                fail(new Error(`Proxy CONNECT failed with status ${res.statusCode} via ${proxyUrl}`));
                return;
            }
            socket.setTimeout(timeoutMs);
            ok(socket);
        });
        req.on('error', (error) => fail(error instanceof Error ? error : new Error(String(error))));
        req.end();
    });
}
async function sendMail(input) {
    if (!env_1.env.SMTP_HOST || !env_1.env.SMTP_FROM) {
        throw new Error('SMTP is not configured. Set SMTP_HOST and SMTP_FROM.');
    }
    const host = env_1.env.SMTP_HOST;
    const port = env_1.env.SMTP_PORT;
    console.log(JSON.stringify({
        event: 'smtp_send_start',
        host,
        port,
        proxy: env_1.env.SMTP_PROXY || null,
        to: Array.isArray(input.to) ? input.to : [input.to],
    }));
    const transporter = nodemailer_1.default.createTransport({
        host,
        port,
        secure: env_1.env.SMTP_SECURE,
        requireTLS: env_1.env.SMTP_REQUIRE_TLS,
        auth: env_1.env.SMTP_USER
            ? { user: env_1.env.SMTP_USER, pass: env_1.env.SMTP_PASS || '' }
            : undefined,
        connectionTimeout: 30_000,
        greetingTimeout: 30_000,
        socketTimeout: 60_000,
        tls: {
            rejectUnauthorized: false,
        },
        logger: false,
        debug: false,
    });
    // Nodemailer's runtime supports getSocket; types omit it.
    if (env_1.env.SMTP_PROXY) {
        const proxyUrl = env_1.env.SMTP_PROXY;
        transporter.getSocket = (options, callback) => {
            const targetHost = options.host || host;
            const targetPort = options.port || port;
            connectViaHttpProxy(proxyUrl, targetHost, targetPort)
                .then((connection) => callback(null, { connection }))
                .catch((error) => callback(error instanceof Error ? error : new Error(String(error))));
        };
    }
    try {
        const result = await transporter.sendMail({
            from: env_1.env.SMTP_FROM,
            to: Array.isArray(input.to) ? input.to.join(', ') : input.to,
            subject: input.subject,
            text: input.text,
            html: input.html,
        });
        console.log(JSON.stringify({
            event: 'smtp_send_ok',
            messageId: result.messageId,
            accepted: result.accepted,
        }));
        return {
            messageId: String(result.messageId || ''),
            accepted: (result.accepted || []).map(String),
        };
    }
    catch (error) {
        console.error(JSON.stringify({
            event: 'smtp_send_failed',
            error: error instanceof Error ? error.message : 'unknown',
        }));
        throw error;
    }
}
