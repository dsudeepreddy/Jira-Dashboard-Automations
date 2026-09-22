import http from 'node:http';
import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';

const COMPOSE_BACKEND = 'http://backend-api:5000/api/v1';
const LOCAL_BACKEND = 'http://localhost:5001/api/v1';

export function backendHeaders(): Record<string, string> | undefined {
  const token = process.env.BACKEND_API_TOKEN || process.env.SYNC_API_TOKEN;
  return token ? { 'x-api-token': token } : undefined;
}

function isLoopbackHost(hostname: string) {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
}

/**
 * Resolve analytics API base URL.
 * Compose often loads BACKEND_API_URL=http://127.0.0.1:5001 from .env.local (host-oriented).
 * Inside the frontend container that points at itself → timeout. Rewrite to backend-api.
 */
export function backendUrl() {
  const configured = (process.env.BACKEND_API_URL || '').trim().replace(/\/+$/, '');
  const inCompose = process.env.IN_COMPOSE === '1' || process.env.IN_PODMAN_COMPOSE === '1';
  const composeBackend = (process.env.COMPOSE_BACKEND_URL || COMPOSE_BACKEND).replace(/\/+$/, '');

  if (inCompose) {
    if (!configured) return composeBackend;
    try {
      if (isLoopbackHost(new URL(configured).hostname)) return composeBackend;
    } catch {
      return composeBackend;
    }
    return configured;
  }

  return configured || LOCAL_BACKEND;
}

/**
 * Direct HTTP(S) GET that ignores HTTP_PROXY/HTTPS_PROXY.
 * Global fetch() in Node follows those env vars (often set to tinyproxy for SMTP),
 * which breaks Next.js → backend-api calls inside Compose.
 */
function directGet(urlString: string, headers?: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(urlString);
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: headers || {},
        // agent:false → no proxy agent, even if HTTP_PROXY is set
        agent: false,
        timeout: 120_000,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
        res.on('end', () => {
          resolve({
            status: res.statusCode || 500,
            body: Buffer.concat(chunks).toString('utf8'),
          });
        });
      },
    );
    req.on('timeout', () => {
      req.destroy();
      reject(new Error(`Timed out calling backend at ${url.origin}${url.pathname}`));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function proxyBackendGet(request: NextRequest, path: string) {
  const base = backendUrl();
  const target = `${base}/${path}?${new URL(request.url).searchParams.toString()}`;
  try {
    const response = await directGet(target, backendHeaders());
    let payload: unknown;
    try {
      payload = response.body ? JSON.parse(response.body) : {};
    } catch {
      payload = { error: 'Backend returned non-JSON', details: response.body.slice(0, 500) };
    }
    return NextResponse.json(payload, { status: response.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Jira API error';
    const loopback = /127\.0\.0\.1|localhost/.test(base);
    return NextResponse.json(
      {
        error: 'Unable to reach the Jira analytics backend.',
        details: message,
        backendUrl: base,
        configuredBackendApiUrl: process.env.BACKEND_API_URL || null,
        hint: loopback
          ? 'BACKEND_API_URL points at loopback. Inside Compose that is the frontend container itself — use http://backend-api:5000/api/v1 (redeploy with updated compose / remove BACKEND_API_URL from .env.local).'
          : 'Check that jira-backend-api is healthy and reachable from the frontend container.',
      },
      { status: 502 },
    );
  }
}
