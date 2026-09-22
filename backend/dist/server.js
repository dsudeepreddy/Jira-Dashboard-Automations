"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
const express_rate_limit_1 = require("express-rate-limit");
const env_1 = require("./config/env");
const jiraClient_1 = require("./services/jiraClient");
const emailClient_1 = require("./services/emailClient");
const metricsController_1 = require("./controllers/metricsController");
const issuesController_1 = require("./controllers/issuesController");
const syncController_1 = require("./controllers/syncController");
const reportController_1 = require("./controllers/reportController");
const monthlyReportService_1 = require("./services/monthlyReportService");
const database_1 = require("./db/database");
const jiraRepository_1 = require("./db/jiraRepository");
const health_1 = __importDefault(require("./routes/health"));
const errorHandler_1 = require("./middleware/errorHandler");
const observability_1 = require("./middleware/observability");
const auth_1 = require("./middleware/auth");
const app = (0, express_1.default)();
app.use(observability_1.requestContext);
app.use((0, helmet_1.default)());
app.use((0, cors_1.default)({ origin: env_1.env.CORS_ORIGIN.split(',') }));
app.use(express_1.default.json({ limit: '1mb' }));
const limiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000,
    max: 200,
    standardHeaders: true,
    legacyHeaders: false,
});
app.use(limiter);
const syncLimiter = (0, express_rate_limit_1.rateLimit)({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
});
app.get('/api/v1/health', async (_req, res) => {
    const database = await (0, database_1.checkDatabase)();
    res.json({
        status: 'ok',
        service: 'backend-api',
        timestamp: new Date().toISOString(),
        jira: jiraClient_1.jiraDiagnostics,
        email: (0, emailClient_1.emailDiagnostics)(),
        database,
    });
});
app.use('/api/v1', health_1.default);
app.get('/api/v1/metrics', auth_1.requireDashboardToken, metricsController_1.getMetricsHandler);
app.get('/api/v1/issues', auth_1.requireDashboardToken, issuesController_1.getIssuesHandler);
app.post('/api/v1/sync', syncLimiter, auth_1.requireSyncToken, syncController_1.syncJiraHandler);
app.post('/api/v1/webhooks/jira', syncLimiter, auth_1.requireSyncToken, syncController_1.jiraWebhookHandler);
app.post('/api/v1/reports/monthly', syncLimiter, auth_1.requireSyncToken, reportController_1.sendMonthlyReportHandler);
app.get('/api/v1/observability/metrics', (_req, res) => {
    res.type('text/plain').send((0, observability_1.metricsText)());
});
app.use(errorHandler_1.errorHandler);
async function startScheduledSync() {
    if (!(0, database_1.isDatabaseEnabled)() || env_1.env.SYNC_INTERVAL_MS <= 0)
        return;
    const tick = async (full = false) => {
        try {
            const result = await (0, syncController_1.runJiraSync)(full);
            console.log(JSON.stringify({ event: 'scheduled_sync_completed', ...result }));
        }
        catch (error) {
            console.error(JSON.stringify({
                event: 'scheduled_sync_failed',
                error: error instanceof Error ? error.message : 'unknown',
            }));
        }
    };
    const state = (0, database_1.isDatabaseEnabled)() ? await (0, jiraRepository_1.getSyncState)().catch(() => null) : null;
    await tick(!state?.last_success_at);
    setInterval(() => { void tick(false); }, env_1.env.SYNC_INTERVAL_MS);
}
let lastMonthlyReportKey = null;
let loggedWaitingForReportDay = false;
async function startMonthlyReportScheduler() {
    if (!env_1.env.MONTHLY_REPORT_ENABLED)
        return;
    const tick = async () => {
        if (!(0, emailClient_1.isEmailConfigured)()) {
            console.log(JSON.stringify({ event: 'monthly_report_skipped', reason: 'email_not_configured' }));
            return;
        }
        const now = new Date();
        const day = now.getUTCDate();
        if (day !== env_1.env.MONTHLY_REPORT_DAY) {
            if (!loggedWaitingForReportDay) {
                loggedWaitingForReportDay = true;
                console.log(JSON.stringify({
                    event: 'monthly_report_waiting',
                    utcDate: day,
                    reportDay: env_1.env.MONTHLY_REPORT_DAY,
                    nextAutoSend: `Next auto-send is on UTC day ${env_1.env.MONTHLY_REPORT_DAY} (previous calendar month). To send now: POST /api/v1/reports/monthly`,
                }));
            }
            return;
        }
        loggedWaitingForReportDay = false;
        const key = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
        if (lastMonthlyReportKey === key)
            return;
        try {
            const result = await (0, monthlyReportService_1.sendMonthlyReport)({});
            lastMonthlyReportKey = key;
            console.log(JSON.stringify({
                event: 'monthly_report_sent',
                subject: result.subject,
                recipients: result.recipients,
                messageId: 'messageId' in result ? result.messageId : undefined,
            }));
        }
        catch (error) {
            console.error(JSON.stringify({
                event: 'monthly_report_failed',
                error: error instanceof Error ? error.message : 'unknown',
            }));
        }
    };
    setInterval(() => { void tick(); }, 60 * 60 * 1000);
    void tick();
}
async function start() {
    await (0, database_1.initializeDatabase)();
    const systemProxySet = Boolean(process.env.HTTP_PROXY
        || process.env.http_proxy
        || process.env.HTTPS_PROXY
        || process.env.https_proxy);
    if (systemProxySet && !env_1.env.JIRA_HTTP_PROXY) {
        console.warn(JSON.stringify({
            event: 'jira_proxy_isolation',
            detail: 'HTTP_PROXY/HTTPS_PROXY is set but Jira uses direct connections (proxy:false). SMTP still uses SMTP_PROXY only. Set JIRA_HTTP_PROXY if Atlassian must go through a proxy.',
        }));
    }
    app.listen(env_1.env.PORT, () => {
        console.log(JSON.stringify({
            event: 'server_started',
            service: 'backend-api',
            port: env_1.env.PORT,
            database: env_1.env.DB_ENABLED ? 'percona' : 'disabled',
            syncIntervalMs: env_1.env.SYNC_INTERVAL_MS,
            monthlyReportEnabled: env_1.env.MONTHLY_REPORT_ENABLED,
            emailConfigured: (0, emailClient_1.isEmailConfigured)(),
            smtpHostSet: Boolean(env_1.env.SMTP_HOST),
            smtpPort: env_1.env.SMTP_PORT,
            smtpProxySet: Boolean(env_1.env.SMTP_PROXY),
            smtpFromSet: Boolean(env_1.env.SMTP_FROM),
            monthlyReportToSet: Boolean(env_1.env.MONTHLY_REPORT_TO),
            jiraDomainSet: Boolean(env_1.env.JIRA_DOMAIN && !env_1.env.JIRA_DOMAIN.includes('yourcompany')),
            jiraProjectKey: env_1.env.JIRA_PROJECT_KEY || null,
            jiraHttpProxySet: Boolean(env_1.env.JIRA_HTTP_PROXY),
            systemHttpProxySet: systemProxySet,
        }));
    });
    await startScheduledSync();
    await startMonthlyReportScheduler();
}
start().catch((error) => {
    console.error(JSON.stringify({ event: 'server_start_failed', error: error instanceof Error ? error.message : 'unknown' }));
    process.exit(1);
});
