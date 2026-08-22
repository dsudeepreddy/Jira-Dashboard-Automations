"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.metricsText = metricsText;
exports.requestContext = requestContext;
const crypto_1 = require("crypto");
const counters = {
    requests: 0,
    errors: 0,
};
function metricsText() {
    return [
        '# HELP jira_api_requests_total Total HTTP requests handled by the backend.',
        '# TYPE jira_api_requests_total counter',
        `jira_api_requests_total ${counters.requests}`,
        '# HELP jira_api_errors_total Total HTTP 4xx and 5xx responses.',
        '# TYPE jira_api_errors_total counter',
        `jira_api_errors_total ${counters.errors}`,
    ].join('\n') + '\n';
}
function requestContext(req, res, next) {
    const requestId = req.header('x-request-id') || (0, crypto_1.randomUUID)();
    res.setHeader('x-request-id', requestId);
    res.locals.requestId = requestId;
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
        counters.requests += 1;
        if (res.statusCode >= 400)
            counters.errors += 1;
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
        console.log(JSON.stringify({
            timestamp: new Date().toISOString(),
            level: res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info',
            event: 'http_request',
            requestId,
            method: req.method,
            path: req.originalUrl,
            statusCode: res.statusCode,
            durationMs: Number(durationMs.toFixed(2)),
        }));
    });
    next();
}
