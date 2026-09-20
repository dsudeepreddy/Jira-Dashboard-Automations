import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();
dotenv.config({ path: '../.env.local' });

function asBool(value: unknown, fallback = false): boolean {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'n', 'off'].includes(normalized)) return false;
  return fallback;
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(5000),
  REDIS_HOST: z.string().default('redis-cache'),
  REDIS_PORT: z.coerce.number().default(6379),
  REDIS_PASSWORD: z.string().optional(),
  JIRA_DOMAIN: z.string().url().default('https://yourcompany.atlassian.net'),
  JIRA_EMAIL: z.string().email().optional().or(z.literal('')),
  JIRA_API_TOKEN: z.string().optional(),
  JIRA_OAUTH_TOKEN: z.string().optional(),
  JIRA_PROJECT_KEY: z.string().optional(),
  JIRA_BOARD_ID: z.preprocess(
    (value) => (value === '' || value === undefined ? undefined : value),
    z.coerce.number().int().positive().optional(),
  ),
  JIRA_STORY_POINTS_FIELD: z.string().default('customfield_10016'),
  JIRA_SPRINT_FIELD: z.string().default('customfield_10020'),
  JIRA_LICENSE_BU_FIELD: z.string().optional().or(z.literal('')),
  JIRA_AUDIT_TYPE_FIELD: z.string().optional().or(z.literal('')),
  JIRA_APPLICATION_FIELD: z.string().optional().or(z.literal('')),
  JIRA_EPIC_LINK_FIELD: z.string().optional().or(z.literal('')),
  JIRA_LOOKBACK_DAYS: z.coerce.number().int().positive().max(730).default(120),
  CACHE_TTL_MS: z.coerce.number().default(60000),
  JIRA_MAX_ISSUES: z.coerce.number().int().positive().max(10000).default(1000),
  JIRA_PAGE_SIZE: z.coerce.number().int().positive().max(100).default(50),
  DB_ENABLED: z.preprocess((value) => asBool(value, false), z.boolean().default(false)),
  DB_AUTO_CREATE: z.preprocess((value) => asBool(value, false), z.boolean().default(false)),
  DB_HOST: z.string().default('percona-proxy'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().default('jira_analytics'),
  DB_USER: z.string().default('jira_dashboard'),
  DB_PASSWORD: z.string().default(''),
  DB_SSL: z.preprocess((value) => (value === undefined || value === '' ? undefined : asBool(value, true)), z.boolean().default(true)),
  DB_SSL_VERIFY: z.preprocess((value) => asBool(value, true), z.boolean().default(true)),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().max(100).default(10),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.string().default('info'),
  SYNC_API_TOKEN: z.string().optional().or(z.literal('')),
  BACKEND_API_TOKEN: z.string().optional().or(z.literal('')),
  SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(900000),
  STALE_AFTER_MS: z.coerce.number().int().positive().default(1800000),
  SMTP_HOST: z.string().optional().or(z.literal('')),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: z.preprocess((value) => asBool(value, false), z.boolean().default(false)),
  SMTP_USER: z.string().optional().or(z.literal('')),
  SMTP_PASS: z.string().optional().or(z.literal('')),
  SMTP_FROM: z.string().optional().or(z.literal('')),
  /** HTTP CONNECT proxy for SMTP, e.g. http://tinyproxy:8888 */
  SMTP_PROXY: z.string().optional().or(z.literal('')),
  MONTHLY_REPORT_TO: z.string().optional().or(z.literal('')),
  MONTHLY_REPORT_PROJECT_KEY: z.string().optional().or(z.literal('')),
  MONTHLY_REPORT_DASHBOARD_URL: z.string().optional().or(z.literal('')),
  MONTHLY_REPORT_ENABLED: z.preprocess((value) => asBool(value, false), z.boolean().default(false)),
  MONTHLY_REPORT_DAY: z.coerce.number().int().min(1).max(28).default(1),
});

const parsedEnv = envSchema.parse(process.env);

// Allow SMTP_HOST="smtp.example.com:25" by splitting host/port.
if (parsedEnv.SMTP_HOST && parsedEnv.SMTP_HOST.includes(':') && !parsedEnv.SMTP_HOST.includes('://')) {
  const [host, portText] = parsedEnv.SMTP_HOST.split(':');
  const port = Number(portText);
  if (host && Number.isFinite(port)) {
    parsedEnv.SMTP_HOST = host;
    parsedEnv.SMTP_PORT = port;
  }
}

export const env = parsedEnv;

export function maskSecret(value?: string) {
  if (!value) return 'not-configured';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}
