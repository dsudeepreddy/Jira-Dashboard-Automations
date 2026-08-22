import { NextFunction, Request, Response } from 'express';
import { env } from '../config/env';

function readToken(req: Request) {
  const header = req.header('x-api-token') || req.header('x-sync-token') || '';
  const bearer = req.header('authorization')?.replace(/^Bearer\s+/i, '') || '';
  const query = typeof req.query.token === 'string' ? req.query.token : '';
  return header || bearer || query;
}

function unauthorized(res: Response, detail: string) {
  return res.status(401).json({
    type: 'https://api.example.com/problems/unauthorized',
    title: 'Unauthorized',
    status: 401,
    detail,
    code: 'UNAUTHORIZED',
    requestId: res.locals.requestId,
  });
}

export function requireDashboardToken(req: Request, res: Response, next: NextFunction) {
  if (!env.BACKEND_API_TOKEN) return next();
  if (readToken(req) !== env.BACKEND_API_TOKEN) {
    return unauthorized(res, 'Provide a valid x-api-token header.');
  }
  return next();
}

export function requireSyncToken(req: Request, res: Response, next: NextFunction) {
  const expected = env.SYNC_API_TOKEN || env.BACKEND_API_TOKEN;
  if (!expected) {
    if (env.NODE_ENV === 'production') {
      return unauthorized(res, 'SYNC_API_TOKEN must be configured in production.');
    }
    return next();
  }
  if (readToken(req) !== expected) {
    return unauthorized(res, 'Provide a valid x-sync-token or x-api-token header.');
  }
  return next();
}
