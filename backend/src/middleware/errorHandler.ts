import { NextFunction, Request, Response } from 'express';

export function errorHandler(error: any, _req: Request, res: Response, _next: NextFunction) {
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
