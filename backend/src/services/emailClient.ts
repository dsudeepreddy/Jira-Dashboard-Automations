import http from 'node:http';
import type { Socket } from 'node:net';
import nodemailer from 'nodemailer';
import { env, maskSecret } from '../config/env';

export function isEmailConfigured(): boolean {
  return Boolean(env.SMTP_HOST && env.SMTP_FROM && env.MONTHLY_REPORT_TO);
}

export function emailDiagnostics() {
  return {
    configured: isEmailConfigured(),
    host: env.SMTP_HOST || 'not-configured',
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    from: env.SMTP_FROM || 'not-configured',
    to: env.MONTHLY_REPORT_TO || 'not-configured',
    proxy: env.SMTP_PROXY || 'not-configured',
    user: env.SMTP_USER ? maskSecret(env.SMTP_USER) : 'not-configured',
    monthlyReportEnabled: env.MONTHLY_REPORT_ENABLED,
  };
}

/** HTTP CONNECT through tinyproxy-style proxies (same idea as curl -x). */
export function connectViaHttpProxy(
  proxyUrl: string,
  targetHost: string,
  targetPort: number,
  timeoutMs = 30_000,
): Promise<Socket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const ok = (socket: Socket) => {
      if (settled) return;
      settled = true;
      resolve(socket);
    };

    let proxy: URL;
    try {
      proxy = new URL(proxyUrl);
    } catch {
      fail(new Error(`Invalid SMTP_PROXY URL: ${proxyUrl}`));
      return;
    }

    const req = http.request({
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

export async function sendMail(input: {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
}): Promise<{ messageId: string; accepted: string[] }> {
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    throw new Error('SMTP is not configured. Set SMTP_HOST and SMTP_FROM.');
  }

  const host = env.SMTP_HOST;
  const port = env.SMTP_PORT;
  console.log(JSON.stringify({
    event: 'smtp_send_start',
    host,
    port,
    proxy: env.SMTP_PROXY || null,
    to: Array.isArray(input.to) ? input.to : [input.to],
  }));

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' }
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
  if (env.SMTP_PROXY) {
    const proxyUrl = env.SMTP_PROXY;
    (transporter as unknown as {
      getSocket: (
        options: { host?: string; port?: number },
        callback: (error: Error | null, data?: { connection: Socket }) => void,
      ) => void;
    }).getSocket = (options, callback) => {
      const targetHost = options.host || host;
      const targetPort = options.port || port;
      connectViaHttpProxy(proxyUrl, targetHost, targetPort)
        .then((connection) => callback(null, { connection }))
        .catch((error) => callback(error instanceof Error ? error : new Error(String(error))));
    };
  }

  try {
    const result = await transporter.sendMail({
      from: env.SMTP_FROM,
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
  } catch (error) {
    console.error(JSON.stringify({
      event: 'smtp_send_failed',
      error: error instanceof Error ? error.message : 'unknown',
    }));
    throw error;
  }
}
