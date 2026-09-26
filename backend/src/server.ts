import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env';
import { jiraClient, jiraDiagnostics } from './services/jiraClient';
import { emailDiagnostics, isEmailConfigured } from './services/emailClient';
import { getMetricsHandler } from './controllers/metricsController';
import { getIssuesHandler } from './controllers/issuesController';
import { getExportIssuesHandler } from './controllers/exportController';
import { runJiraSync, syncJiraHandler, jiraWebhookHandler } from './controllers/syncController';
import { sendMonthlyReportHandler } from './controllers/reportController';
import { sendMonthlyReport } from './services/monthlyReportService';
import { initializeDatabase, checkDatabase, isDatabaseEnabled } from './db/database';
import { getSyncState } from './db/jiraRepository';
import healthRouter from './routes/health';
import { errorHandler } from './middleware/errorHandler';
import { metricsText, requestContext } from './middleware/observability';
import { requireDashboardToken, requireSyncToken } from './middleware/auth';

const app = express();

app.use(requestContext);
app.use(helmet());
app.use(cors({ origin: env.CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

const syncLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

app.get('/api/v1/health', async (req, res) => {
  const database = await checkDatabase();
  const payload: Record<string, unknown> = {
    status: 'ok',
    service: 'backend-api',
    timestamp: new Date().toISOString(),
    jira: jiraDiagnostics,
    email: emailDiagnostics(),
    database,
  };
  // Optional live Jira probe — keep default /health fast for Compose healthchecks.
  if (req.query.jira === '1' || req.query.jira === 'true') {
    try {
      const started = Date.now();
      await jiraClient.getIssueStatuses();
      payload.jiraReachable = { ok: true, ms: Date.now() - started };
    } catch (error) {
      payload.jiraReachable = {
        ok: false,
        detail: error instanceof Error ? error.message : 'unknown',
      };
    }
  }
  res.json(payload);
});

app.use('/api/v1', healthRouter);
app.get('/api/v1/metrics', requireDashboardToken, getMetricsHandler);
app.get('/api/v1/issues', requireDashboardToken, getIssuesHandler);
app.get('/api/v1/export/issues', requireDashboardToken, getExportIssuesHandler);
app.post('/api/v1/sync', syncLimiter, requireSyncToken, syncJiraHandler);
app.post('/api/v1/webhooks/jira', syncLimiter, requireSyncToken, jiraWebhookHandler);
app.post('/api/v1/reports/monthly', syncLimiter, requireSyncToken, sendMonthlyReportHandler);
app.get('/api/v1/observability/metrics', (_req, res) => {
  res.type('text/plain').send(metricsText());
});

app.use(errorHandler);

async function startScheduledSync() {
  if (!isDatabaseEnabled() || env.SYNC_INTERVAL_MS <= 0) return;
  const tick = async (full = false) => {
    try {
      const result = await runJiraSync(full);
      console.log(JSON.stringify({ event: 'scheduled_sync_completed', ...result }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'scheduled_sync_failed',
        error: error instanceof Error ? error.message : 'unknown',
      }));
    }
  };
  const state = isDatabaseEnabled() ? await getSyncState().catch(() => null) : null;
  await tick(!state?.last_success_at);
  setInterval(() => { void tick(false); }, env.SYNC_INTERVAL_MS);
}

let lastMonthlyReportKey: string | null = null;
let loggedWaitingForReportSlot = false;

function zonedParts(now: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const read = (type: string) => parts.find((part) => part.type === type)?.value || '';
  const weekdayMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    weekday: weekdayMap[read('weekday')] ?? -1,
    year: Number(read('year')),
    month: Number(read('month')),
    day: Number(read('day')),
    hour: Number(read('hour')),
    minute: Number(read('minute')),
  };
}

async function startMonthlyReportScheduler() {
  if (!env.MONTHLY_REPORT_ENABLED) return;
  const tick = async () => {
    if (!isEmailConfigured()) {
      console.log(JSON.stringify({ event: 'monthly_report_skipped', reason: 'email_not_configured' }));
      return;
    }
    const now = new Date();
    const local = zonedParts(now, env.MONTHLY_REPORT_TIMEZONE);
    const dueWeekday = env.MONTHLY_REPORT_WEEKDAY;
    const dueHour = env.MONTHLY_REPORT_HOUR;
    const isDueDay = local.weekday === dueWeekday;
    const isDueHour = local.hour === dueHour;
    if (!isDueDay || !isDueHour) {
      if (!loggedWaitingForReportSlot) {
        loggedWaitingForReportSlot = true;
        console.log(JSON.stringify({
          event: 'monthly_report_waiting',
          timezone: env.MONTHLY_REPORT_TIMEZONE,
          weekday: local.weekday,
          hour: local.hour,
          dueWeekday,
          dueHour,
          nextAutoSend: `Every weekday=${dueWeekday} (1=Mon) at ${String(dueHour).padStart(2, '0')}:00 ${env.MONTHLY_REPORT_TIMEZONE}. To send now: POST /api/v1/reports/monthly`,
        }));
      }
      return;
    }
    loggedWaitingForReportSlot = false;
    // One send per local calendar week (year + ISO-ish week from Mon date).
    const weekKey = `${local.year}-${String(local.month).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
    if (lastMonthlyReportKey === weekKey) return;
    try {
      const result = await sendMonthlyReport({});
      lastMonthlyReportKey = weekKey;
      console.log(JSON.stringify({
        event: 'monthly_report_sent',
        subject: result.subject,
        recipients: result.recipients,
        messageId: 'messageId' in result ? result.messageId : undefined,
        scheduleKey: weekKey,
      }));
    } catch (error) {
      console.error(JSON.stringify({
        event: 'monthly_report_failed',
        error: error instanceof Error ? error.message : 'unknown',
      }));
    }
  };
  setInterval(() => { void tick(); }, 60 * 1000);
  void tick();
}

async function start() {
  await initializeDatabase();
  const systemProxySet = Boolean(
    process.env.HTTP_PROXY
    || process.env.http_proxy
    || process.env.HTTPS_PROXY
    || process.env.https_proxy,
  );
  if (systemProxySet && !env.JIRA_HTTP_PROXY) {
    console.warn(JSON.stringify({
      event: 'jira_proxy_isolation',
      detail: 'HTTP_PROXY/HTTPS_PROXY is set but Jira uses direct connections (proxy:false). SMTP still uses SMTP_PROXY only. Set JIRA_HTTP_PROXY if Atlassian must go through a proxy.',
    }));
  }
  app.listen(env.PORT, () => {
    console.log(JSON.stringify({
      event: 'server_started',
      service: 'backend-api',
      port: env.PORT,
      database: env.DB_ENABLED ? 'percona' : 'disabled',
      syncIntervalMs: env.SYNC_INTERVAL_MS,
      monthlyReportEnabled: env.MONTHLY_REPORT_ENABLED,
      emailConfigured: isEmailConfigured(),
      smtpHostSet: Boolean(env.SMTP_HOST),
      smtpPort: env.SMTP_PORT,
      smtpProxySet: Boolean(env.SMTP_PROXY),
      smtpFromSet: Boolean(env.SMTP_FROM),
      monthlyReportToSet: Boolean(env.MONTHLY_REPORT_TO),
      jiraDomainSet: Boolean(env.JIRA_DOMAIN && !env.JIRA_DOMAIN.includes('yourcompany')),
      jiraProjectKey: env.JIRA_PROJECT_KEY || null,
      jiraHttpProxySet: Boolean(env.JIRA_HTTP_PROXY),
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
