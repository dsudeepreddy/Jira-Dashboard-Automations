import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();
dotenv.config({ path: '../.env.local' });

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
  JIRA_LOOKBACK_DAYS: z.coerce.number().int().positive().max(730).default(120),
  CACHE_TTL_MS: z.coerce.number().default(60000),
  JIRA_MAX_ISSUES: z.coerce.number().int().positive().max(10000).default(1000),
  JIRA_PAGE_SIZE: z.coerce.number().int().positive().max(100).default(50),
  DB_ENABLED: z.preprocess((value) => value === 'true' || value === true, z.boolean().default(false)),
  DB_AUTO_CREATE: z.preprocess((value) => value === 'true' || value === true, z.boolean().default(false)),
  DB_HOST: z.string().default('percona-proxy'),
  DB_PORT: z.coerce.number().default(3306),
  DB_NAME: z.string().default('jira_analytics'),
  DB_USER: z.string().default('jira_dashboard'),
  DB_PASSWORD: z.string().default(''),
  DB_SSL: z.preprocess((value) => (value === undefined || value === '' ? undefined : value === 'true' || value === true), z.boolean().default(true)),
  DB_SSL_VERIFY: z.preprocess((value) => value !== 'false' && value !== false, z.boolean().default(true)),
  DB_CONNECTION_LIMIT: z.coerce.number().int().positive().max(100).default(10),
  CORS_ORIGIN: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.string().default('info'),
  SYNC_API_TOKEN: z.string().optional().or(z.literal('')),
  BACKEND_API_TOKEN: z.string().optional().or(z.literal('')),
  SYNC_INTERVAL_MS: z.coerce.number().int().min(0).default(900000),
  STALE_AFTER_MS: z.coerce.number().int().positive().default(1800000),
});

export const env = envSchema.parse(process.env);

export function maskSecret(value?: string) {
  if (!value) return 'not-configured';
  if (value.length <= 8) return '*'.repeat(value.length);
  return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}
