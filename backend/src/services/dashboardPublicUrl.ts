import { execSync } from 'node:child_process';
import os from 'node:os';
import { env } from '../config/env';

function isIpHostname(hostname: string): boolean {
  if (!hostname) return false;
  if (hostname === '0.0.0.0' || hostname === '::' || hostname === '[::]') return true;
  // IPv4
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return true;
  // IPv6 (URL.hostname may omit brackets)
  if (hostname.includes(':')) return true;
  return false;
}

/** Prefer DASHBOARD_PUBLIC_HOSTNAME, then `hostname -a`, then os.hostname(). */
export function resolvePublicHostname(): string {
  const configured = (env.DASHBOARD_PUBLIC_HOSTNAME || '').trim();
  if (configured) return configured;

  try {
    const aliases = execSync('hostname -a', { encoding: 'utf8' })
      .trim()
      .split(/\s+/)
      .map((part) => part.trim())
      .filter(Boolean)
      .filter((part) => !isIpHostname(part));
    if (aliases[0]) return aliases[0];
  } catch {
    // hostname -a is not available on all platforms
  }

  return os.hostname();
}

/**
 * Normalize the email "Open Dashboard" URL so IP hosts are replaced with a hostname.
 * Uses MONTHLY_REPORT_DASHBOARD_URL when raw is omitted.
 */
export function resolveMonthlyReportDashboardUrl(raw?: string | null): string | undefined {
  const base = (raw || env.MONTHLY_REPORT_DASHBOARD_URL || '').trim();
  if (!base) return undefined;

  try {
    const url = new URL(base);
    if (isIpHostname(url.hostname)) {
      url.hostname = resolvePublicHostname();
    }
    return url.toString().replace(/\/$/, '');
  } catch {
    return base.replace(/\/$/, '');
  }
}
