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
const exportController_1 = require("./controllers/exportController");
const syncController_1 = require("./controllers/syncController");
const reportController_1 = require("./controllers/reportController");
const monthlyReportService_1 = require("./services/monthlyReportService");
const monthlyReportSchedule_1 = require("./services/monthlyReportSchedule");
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
app.get('/api/v1/health', async (req, res) => {
    const database = await (0, database_1.checkDatabase)();
    const scheduleState = (0, monthlyReportSchedule_1.readScheduleState)();
    const payload = {
        status: 'ok',
        service: 'backend-api',
        timestamp: new Date().toISOString(),
        jira: jiraClient_1.jiraDiagnostics,
        email: (0, emailClient_1.emailDiagnostics)(),
        monthlyReportSchedule: {
            enabled: env_1.env.MONTHLY_REPORT_ENABLED,
            weekday: env_1.env.MONTHLY_REPORT_WEEKDAY,
            hour: env_1.env.MONTHLY_REPORT_HOUR,
            timezone: env_1.env.MONTHLY_REPORT_TIMEZONE,
            nextAutoSend: `Every weekday=${env_1.env.MONTHLY_REPORT_WEEKDAY} (1=Mon) at ${String(env_1.env.MONTHLY_REPORT_HOUR).padStart(2, '0')}:00 ${env_1.env.MONTHLY_REPORT_TIMEZONE}`,
            lastMondayKey: scheduleState.lastMondayKey || null,
            lastPeriodKey: scheduleState.lastPeriodKey || null,
            lastSentAt: scheduleState.lastSentAt || null,
        },
        database,
    };
    // Optional live Jira probe — keep default /health fast for Compose healthchecks.
    if (req.query.jira === '1' || req.query.jira === 'true') {
        try {
            const started = Date.now();
            await jiraClient_1.jiraClient.getIssueStatuses();
            payload.jiraReachable = { ok: true, ms: Date.now() - started };
        }
        catch (error) {
            payload.jiraReachable = {
                ok: false,
                detail: error instanceof Error ? error.message : 'unknown',
            };
        }
    }
    res.json(payload);
});
app.use('/api/v1', health_1.default);
app.get('/api/v1/metrics', auth_1.requireDashboardToken, metricsController_1.getMetricsHandler);
app.get('/api/v1/issues', auth_1.requireDashboardToken, issuesController_1.getIssuesHandler);
app.get('/api/v1/export/issues', auth_1.requireDashboardToken, exportController_1.getExportIssuesHandler);
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
let loggedWaitingForReportSlot = false;
let loggedEmailNotConfigured = false;
async function startMonthlyReportScheduler() {
    if (!env_1.env.MONTHLY_REPORT_ENABLED) {
        console.log(JSON.stringify({
            event: 'monthly_report_scheduler_disabled',
            detail: 'Set MONTHLY_REPORT_ENABLED=true to auto-send every Monday at MONTHLY_REPORT_HOUR.',
        }));
        return;
    }
    console.log(JSON.stringify({
        event: 'monthly_report_scheduler_started',
        timezone: env_1.env.MONTHLY_REPORT_TIMEZONE,
        weekday: env_1.env.MONTHLY_REPORT_WEEKDAY,
        hour: env_1.env.MONTHLY_REPORT_HOUR,
        emailConfigured: (0, emailClient_1.isEmailConfigured)(),
        nextAutoSend: `Every weekday=${env_1.env.MONTHLY_REPORT_WEEKDAY} (1=Mon) at ${String(env_1.env.MONTHLY_REPORT_HOUR).padStart(2, '0')}:00 ${env_1.env.MONTHLY_REPORT_TIMEZONE}`,
    }));
    const tick = async () => {
        if (!(0, emailClient_1.isEmailConfigured)()) {
            if (!loggedEmailNotConfigured) {
                loggedEmailNotConfigured = true;
                console.log(JSON.stringify({
                    event: 'monthly_report_skipped',
                    reason: 'email_not_configured',
                    detail: 'Set SMTP_HOST, SMTP_FROM, and MONTHLY_REPORT_TO (plus SMTP_PROXY if needed).',
                }));
            }
            return;
        }
        loggedEmailNotConfigured = false;
        const now = new Date();
        const local = (0, monthlyReportSchedule_1.zonedParts)(now, env_1.env.MONTHLY_REPORT_TIMEZONE);
        const dueWeekday = env_1.env.MONTHLY_REPORT_WEEKDAY;
        const dueHour = env_1.env.MONTHLY_REPORT_HOUR;
        if (!(0, monthlyReportSchedule_1.isMonthlyReportDue)(local, dueWeekday, dueHour)) {
            if (!loggedWaitingForReportSlot) {
                loggedWaitingForReportSlot = true;
                console.log(JSON.stringify({
                    event: 'monthly_report_waiting',
                    timezone: env_1.env.MONTHLY_REPORT_TIMEZONE,
                    weekday: local.weekday,
                    hour: local.hour,
                    dueWeekday,
                    dueHour,
                    nextAutoSend: `Every weekday=${dueWeekday} (1=Mon) at ${String(dueHour).padStart(2, '0')}:00 ${env_1.env.MONTHLY_REPORT_TIMEZONE}. To send now: POST /api/v1/reports/monthly`,
                }));
            }
            return;
        }
        loggedWaitingForReportSlot = false;
        const mondayKey = (0, monthlyReportSchedule_1.mondayScheduleKey)(local);
        const periodKey = (0, monthlyReportSchedule_1.reportPeriodKey)(now);
        const state = (0, monthlyReportSchedule_1.readScheduleState)();
        if ((0, monthlyReportSchedule_1.shouldSkipAlreadySent)({
            mondayKey,
            periodKey,
            state,
            oncePerPeriod: false,
        })) {
            return;
        }
        try {
            const result = await (0, monthlyReportService_1.sendMonthlyReport)({});
            (0, monthlyReportSchedule_1.writeScheduleState)({
                lastMondayKey: mondayKey,
                lastPeriodKey: periodKey,
                lastSentAt: new Date().toISOString(),
            });
            console.log(JSON.stringify({
                event: 'monthly_report_sent',
                subject: result.subject,
                recipients: result.recipients,
                messageId: 'messageId' in result ? result.messageId : undefined,
                scheduleKey: mondayKey,
                periodKey,
            }));
        }
        catch (error) {
            console.error(JSON.stringify({
                event: 'monthly_report_failed',
                scheduleKey: mondayKey,
                periodKey,
                error: error instanceof Error ? error.message : 'unknown',
                detail: 'Will retry each minute while still in the due hour.',
            }));
        }
    };
    setInterval(() => { void tick(); }, 60 * 1000);
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
            monthlyReportWeekday: env_1.env.MONTHLY_REPORT_WEEKDAY,
            monthlyReportHour: env_1.env.MONTHLY_REPORT_HOUR,
            monthlyReportTimezone: env_1.env.MONTHLY_REPORT_TIMEZONE,
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
