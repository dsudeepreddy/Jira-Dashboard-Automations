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
    user: env.SMTP_USER ? maskSecret(env.SMTP_USER) : 'not-configured',
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
  });

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
