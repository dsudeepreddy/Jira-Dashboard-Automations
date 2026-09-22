"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.errorHandler = errorHandler;
function errorHandler(error, _req, res, _next) {
    const statusCode = error?.statusCode || error?.status || 500;
    const code = error?.code || 'INTERNAL_ERROR';
    const message = error?.message || 'Unexpected server error';
    console.error(JSON.stringify({
        event: 'request_failed',
        requestId: res.locals.requestId,
        statusCode,
        code,
        detail: message,
    }));
    res.status(statusCode).json({
        type: 'https://api.example.com/problems/internal-error',
        title: 'Request failed',
        status: statusCode,
        detail: message,
        code,
        requestId: res.locals.requestId,
    });
}
