"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireDashboardToken = requireDashboardToken;
exports.requireSyncToken = requireSyncToken;
const env_1 = require("../config/env");
function readToken(req) {
    const header = req.header('x-api-token') || req.header('x-sync-token') || '';
    const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
    const query = typeof req.query.token === 'string' ? req.query.token : '';
    return header || bearer || query;
}
function unauthorized(res, detail) {
    return res.status(401).json({
        type: 'https://api.example.com/problems/unauthorized',
        title: 'Unauthorized',
        status: 401,
        detail,
        code: 'UNAUTHORIZED',
        requestId: res.locals.requestId,
    });
}
function requireDashboardToken(req, res, next) {
    if (!env_1.env.BACKEND_API_TOKEN)
        return next();
    if (readToken(req) !== env_1.env.BACKEND_API_TOKEN) {
        return unauthorized(res, 'Provide a valid x-api-token header.');
    }
    return next();
}
function requireSyncToken(req, res, next) {
    const expected = env_1.env.SYNC_API_TOKEN || env_1.env.BACKEND_API_TOKEN;
    if (!expected) {
        if (env_1.env.NODE_ENV === 'production') {
            return unauthorized(res, 'SYNC_API_TOKEN must be configured in production.');
        }
        return next();
    }
    if (readToken(req) !== expected) {
        return unauthorized(res, 'Provide a valid x-sync-token or x-api-token header.');
    }
    return next();
}
