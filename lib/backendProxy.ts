import http from 'node:http';
import https from 'node:https';
import { NextRequest, NextResponse } from 'next/server';

export function backendHeaders(): Record<string, string> | undefined {
  const token = process.env.BACKEND_API_TOKEN || process.env.SYNC_API_TOKEN;
  return token ? { 'x-api-token': token } : undefined;
}

export function backendUrl() {
  return (process.env.BACKEND_API_URL || 'http://localhost:5001/api/v1').replace(/\/+$/, '');
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
      reject(new Error(`Timed out calling backend at ${url.hostname}`));
    });
    req.on('error', reject);
    req.end();
  });
}

export async function proxyBackendGet(request: NextRequest, path: string) {
  const target = `${backendUrl()}/${path}?${new URL(request.url).searchParams.toString()}`;
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
    return NextResponse.json(
      {
        error: 'Unable to reach the Jira analytics backend.',
        details: message,
        backendUrl: backendUrl(),
        hint: 'BFF uses direct HTTP (ignores HTTP_PROXY). Check that jira-backend-api is up and BACKEND_API_URL is reachable from the frontend container.',
      },
      { status: 502 },
    );
  }
}
