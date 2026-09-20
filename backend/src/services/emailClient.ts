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

export async function sendMail(input: {
  to: string | string[];
  subject: string;
  text: string;
  html: string;
}): Promise<{ messageId: string; accepted: string[] }> {
  if (!env.SMTP_HOST || !env.SMTP_FROM) {
    throw new Error('SMTP is not configured. Set SMTP_HOST and SMTP_FROM.');
  }

  const transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASS || '' }
      : undefined,
    ...(env.SMTP_PROXY ? { proxy: env.SMTP_PROXY } : {}),
    connectionTimeout: 30_000,
    greetingTimeout: 30_000,
    socketTimeout: 60_000,
    tls: {
      rejectUnauthorized: false,
    },
  });

  // Required for HTTP CONNECT / SOCKS proxy support in Nodemailer.
  if (env.SMTP_PROXY) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const socks = require('socks');
      transporter.set('proxy_socks_module', socks);
    } catch {
      throw new Error('SMTP_PROXY is set but the "socks" package is missing. Run npm install socks in backend/.');
    }
  }

  const result = await transporter.sendMail({
    from: env.SMTP_FROM,
    to: Array.isArray(input.to) ? input.to.join(', ') : input.to,
    subject: input.subject,
    text: input.text,
    html: input.html,
  });

  return {
    messageId: String(result.messageId || ''),
    accepted: (result.accepted || []).map(String),
  };
}
