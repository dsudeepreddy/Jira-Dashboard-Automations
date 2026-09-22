"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
exports.maskSecret = maskSecret;
const dotenv_1 = __importDefault(require("dotenv"));
const zod_1 = require("zod");
dotenv_1.default.config();
dotenv_1.default.config({ path: '../.env.local' });
function asBool(value, fallback = false) {
    if (value === undefined || value === null || value === '')
        return fallback;
    if (typeof value === 'boolean')
        return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 'yes', 'y', 'on'].includes(normalized))
        return true;
    if (['0', 'false', 'no', 'n', 'off'].includes(normalized))
        return false;
    return fallback;
}
const envSchema = zod_1.z.object({
    NODE_ENV: zod_1.z.enum(['development', 'test', 'production']).default('development'),
    PORT: zod_1.z.coerce.number().default(5000),
    REDIS_HOST: zod_1.z.string().default('redis-cache'),
    REDIS_PORT: zod_1.z.coerce.number().default(6379),
    REDIS_PASSWORD: zod_1.z.string().optional(),
    JIRA_DOMAIN: zod_1.z.string().url().default('https://yourcompany.atlassian.net'),
    JIRA_EMAIL: zod_1.z.string().email().optional().or(zod_1.z.literal('')),
    JIRA_API_TOKEN: zod_1.z.string().optional(),
    JIRA_OAUTH_TOKEN: zod_1.z.string().optional(),
    JIRA_PROJECT_KEY: zod_1.z.string().optional(),
    JIRA_BOARD_ID: zod_1.z.preprocess((value) => (value === '' || value === undefined ? undefined : value), zod_1.z.coerce.number().int().positive().optional()),
    JIRA_STORY_POINTS_FIELD: zod_1.z.string().default('customfield_10016'),
    JIRA_SPRINT_FIELD: zod_1.z.string().default('customfield_10020'),
    JIRA_LICENSE_BU_FIELD: zod_1.z.string().optional().or(zod_1.z.literal('')),
    JIRA_AUDIT_TYPE_FIELD: zod_1.z.string().optional().or(zod_1.z.literal('')),
    JIRA_APPLICATION_FIELD: zod_1.z.string().optional().or(zod_1.z.literal('')),
    JIRA_EPIC_LINK_FIELD: zod_1.z.string().optional().or(zod_1.z.literal('')),
    JIRA_LOOKBACK_DAYS: zod_1.z.coerce.number().int().positive().max(730).default(120),
    CACHE_TTL_MS: zod_1.z.coerce.number().default(60000),
    JIRA_MAX_ISSUES: zod_1.z.coerce.number().int().positive().max(10000).default(1000),
    JIRA_PAGE_SIZE: zod_1.z.coerce.number().int().positive().max(100).default(50),
    DB_ENABLED: zod_1.z.preprocess((value) => asBool(value, false), zod_1.z.boolean().default(false)),
    DB_AUTO_CREATE: zod_1.z.preprocess((value) => asBool(value, false), zod_1.z.boolean().default(false)),
    DB_HOST: zod_1.z.string().default('percona-proxy'),
    DB_PORT: zod_1.z.coerce.number().default(3306),
    DB_NAME: zod_1.z.string().default('jira_analytics'),
    DB_USER: zod_1.z.string().default('jira_dashboard'),
    DB_PASSWORD: zod_1.z.string().default(''),
    DB_SSL: zod_1.z.preprocess((value) => (value === undefined || value === '' ? undefined : asBool(value, true)), zod_1.z.boolean().default(true)),
    DB_SSL_VERIFY: zod_1.z.preprocess((value) => asBool(value, true), zod_1.z.boolean().default(true)),
    DB_CONNECTION_LIMIT: zod_1.z.coerce.number().int().positive().max(100).default(10),
    CORS_ORIGIN: zod_1.z.string().default('http://localhost:3000'),
    LOG_LEVEL: zod_1.z.string().default('info'),
    SYNC_API_TOKEN: zod_1.z.string().optional().or(zod_1.z.literal('')),
    BACKEND_API_TOKEN: zod_1.z.string().optional().or(zod_1.z.literal('')),
    SYNC_INTERVAL_MS: zod_1.z.coerce.number().int().min(0).default(900000),
    STALE_AFTER_MS: zod_1.z.coerce.number().int().positive().default(1800000),
    SMTP_HOST: zod_1.z.string().optional().or(zod_1.z.literal('')),
    SMTP_PORT: zod_1.z.coerce.number().int().positive().default(587),
    SMTP_SECURE: zod_1.z.preprocess((value) => asBool(value, false), zod_1.z.boolean().default(false)),
    /** Match curl --ssl-reqd (STARTTLS required) when the relay expects TLS on port 25/587. */
    SMTP_REQUIRE_TLS: zod_1.z.preprocess((value) => asBool(value, false), zod_1.z.boolean().default(false)),
    SMTP_USER: zod_1.z.string().optional().or(zod_1.z.literal('')),
    SMTP_PASS: zod_1.z.string().optional().or(zod_1.z.literal('')),
    SMTP_FROM: zod_1.z.string().optional().or(zod_1.z.literal('')),
    /** HTTP CONNECT proxy for SMTP, e.g. http://tinyproxy:8888 */
    SMTP_PROXY: zod_1.z.string().optional().or(zod_1.z.literal('')),
    MONTHLY_REPORT_TO: zod_1.z.string().optional().or(zod_1.z.literal('')),
    MONTHLY_REPORT_PROJECT_KEY: zod_1.z.string().optional().or(zod_1.z.literal('')),
    MONTHLY_REPORT_DASHBOARD_URL: zod_1.z.string().optional().or(zod_1.z.literal('')),
    MONTHLY_REPORT_ENABLED: zod_1.z.preprocess((value) => asBool(value, false), zod_1.z.boolean().default(false)),
    MONTHLY_REPORT_DAY: zod_1.z.coerce.number().int().min(1).max(28).default(1),
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
exports.env = parsedEnv;
function maskSecret(value) {
    if (!value)
        return 'not-configured';
    if (value.length <= 8)
        return '*'.repeat(value.length);
    return `${value.slice(0, 4)}${'*'.repeat(value.length - 8)}${value.slice(-4)}`;
}
