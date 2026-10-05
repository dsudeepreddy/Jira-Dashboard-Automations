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
import { sendMonthlyReportHandler, sendWeeklyReportHandler } from './controllers/reportController';
import { sendMonthlyReport, sendWeeklyReport } from './services/monthlyReportService';
import {
  isMonthlyReportDue,
  isWeeklyReportDue,
  localDateKey,
  readScheduleState,
  reportPeriodKey,
  shouldSkipAlreadySent,
  writeScheduleState,
  zonedParts,
} from './services/monthlyReportSchedule';
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
  const scheduleState = readScheduleState();
  const payload: Record<string, unknown> = {
    status: 'ok',
    service: 'backend-api',
    timestamp: new Date().toISOString(),
    jira: jiraDiagnostics,
    email: emailDiagnostics(),
    monthlyReportSchedule: {
      enabled: env.MONTHLY_REPORT_ENABLED,
      day: env.MONTHLY_REPORT_DAY,
      hour: env.MONTHLY_REPORT_HOUR,
      timezone: env.MONTHLY_REPORT_TIMEZONE,
      nextAutoSend: `Every month on day=${env.MONTHLY_REPORT_DAY} at ${String(env.MONTHLY_REPORT_HOUR).padStart(2, '0')}:00 ${env.MONTHLY_REPORT_TIMEZONE}`,
      lastMonthlyKey: scheduleState.lastMonthlyKey || scheduleState.lastMondayKey || null,
      lastPeriodKey: scheduleState.lastPeriodKey || null,
      lastSentAt: scheduleState.lastSentAt || null,
    },
    weeklyReportSchedule: {
      enabled: env.WEEKLY_REPORT_ENABLED,
      weekday: env.WEEKLY_REPORT_WEEKDAY,
      hour: env.WEEKLY_REPORT_HOUR,
      timezone: env.MONTHLY_REPORT_TIMEZONE,
      nextAutoSend: `Every weekday=${env.WEEKLY_REPORT_WEEKDAY} (1=Mon) at ${String(env.WEEKLY_REPORT_HOUR).padStart(2, '0')}:00 ${env.MONTHLY_REPORT_TIMEZONE}`,
      lastWeeklyKey: scheduleState.lastWeeklyKey || null,
      lastWeeklySentAt: scheduleState.lastWeeklySentAt || null,
    },
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
app.post('/api/v1/reports/weekly', syncLimiter, requireSyncToken, sendWeeklyReportHandler);
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

let loggedWaitingForMonthly = false;
let loggedWaitingForWeekly = false;
let loggedEmailNotConfigured = false;

async function startMonthlyReportScheduler() {
  if (!env.MONTHLY_REPORT_ENABLED) {
    console.log(JSON.stringify({
      event: 'monthly_report_scheduler_disabled',
      detail: 'Set MONTHLY_REPORT_ENABLED=true to auto-send on MONTHLY_REPORT_DAY at MONTHLY_REPORT_HOUR.',
    }));
  } else {
    console.log(JSON.stringify({
      event: 'monthly_report_scheduler_started',
      timezone: env.MONTHLY_REPORT_TIMEZONE,
      day: env.MONTHLY_REPORT_DAY,
      hour: env.MONTHLY_REPORT_HOUR,
      emailConfigured: isEmailConfigured(),
      nextAutoSend: `Every month on day=${env.MONTHLY_REPORT_DAY} at ${String(env.MONTHLY_REPORT_HOUR).padStart(2, '0')}:00 ${env.MONTHLY_REPORT_TIMEZONE}`,
    }));
  }

  if (!env.WEEKLY_REPORT_ENABLED) {
    console.log(JSON.stringify({
      event: 'weekly_report_scheduler_disabled',
      detail: 'Set WEEKLY_REPORT_ENABLED=true to auto-send every Monday at WEEKLY_REPORT_HOUR.',
    }));
  } else {
    console.log(JSON.stringify({
      event: 'weekly_report_scheduler_started',
      timezone: env.MONTHLY_REPORT_TIMEZONE,
      weekday: env.WEEKLY_REPORT_WEEKDAY,
      hour: env.WEEKLY_REPORT_HOUR,
      emailConfigured: isEmailConfigured(),
      nextAutoSend: `Every weekday=${env.WEEKLY_REPORT_WEEKDAY} (1=Mon) at ${String(env.WEEKLY_REPORT_HOUR).padStart(2, '0')}:00 ${env.MONTHLY_REPORT_TIMEZONE}`,
    }));
  }

  if (!env.MONTHLY_REPORT_ENABLED && !env.WEEKLY_REPORT_ENABLED) return;

  const tick = async () => {
    if (!isEmailConfigured()) {
      if (!loggedEmailNotConfigured) {
        loggedEmailNotConfigured = true;
        console.log(JSON.stringify({
          event: 'report_scheduler_skipped',
          reason: 'email_not_configured',
          detail: 'Set SMTP_HOST, SMTP_FROM, and MONTHLY_REPORT_TO (plus SMTP_PROXY if needed).',
        }));
      }
      return;
    }
    loggedEmailNotConfigured = false;

    const now = new Date();
    const local = zonedParts(now, env.MONTHLY_REPORT_TIMEZONE);
    const state = readScheduleState();

    if (env.MONTHLY_REPORT_ENABLED) {
      const dueDay = env.MONTHLY_REPORT_DAY;
      const dueHour = env.MONTHLY_REPORT_HOUR;
      if (!isMonthlyReportDue(local, dueDay, dueHour)) {
        if (!loggedWaitingForMonthly) {
          loggedWaitingForMonthly = true;
          console.log(JSON.stringify({
            event: 'monthly_report_waiting',
            timezone: env.MONTHLY_REPORT_TIMEZONE,
            day: local.day,
            hour: local.hour,
            dueDay,
            dueHour,
            nextAutoSend: `Every month on day=${dueDay} at ${String(dueHour).padStart(2, '0')}:00 ${env.MONTHLY_REPORT_TIMEZONE}`,
          }));
        }
      } else {
        loggedWaitingForMonthly = false;
        const scheduleKey = localDateKey(local);
        const periodKey = reportPeriodKey(now);
        if (!shouldSkipAlreadySent({
          scheduleKey,
          periodKey,
          state,
          oncePerPeriod: true,
          kind: 'monthly',
        })) {
          try {
            const result = await sendMonthlyReport({});
            writeScheduleState({
              lastMonthlyKey: scheduleKey,
              lastPeriodKey: periodKey,
              lastSentAt: new Date().toISOString(),
            });
            console.log(JSON.stringify({
              event: 'monthly_report_sent',
              subject: result.subject,
              recipients: result.recipients,
              messageId: 'messageId' in result ? result.messageId : undefined,
              scheduleKey,
              periodKey,
            }));
          } catch (error) {
            console.error(JSON.stringify({
              event: 'monthly_report_failed',
              scheduleKey,
              periodKey,
              error: error instanceof Error ? error.message : 'unknown',
              detail: 'Will retry each minute while still in the due hour.',
            }));
          }
        }
      }
    }

    if (env.WEEKLY_REPORT_ENABLED) {
      const dueWeekday = env.WEEKLY_REPORT_WEEKDAY;
      const dueHour = env.WEEKLY_REPORT_HOUR;
      if (!isWeeklyReportDue(local, dueWeekday, dueHour)) {
        if (!loggedWaitingForWeekly) {
          loggedWaitingForWeekly = true;
          console.log(JSON.stringify({
            event: 'weekly_report_waiting',
            timezone: env.MONTHLY_REPORT_TIMEZONE,
            weekday: local.weekday,
            hour: local.hour,
            dueWeekday,
            dueHour,
            nextAutoSend: `Every weekday=${dueWeekday} (1=Mon) at ${String(dueHour).padStart(2, '0')}:00 ${env.MONTHLY_REPORT_TIMEZONE}`,
          }));
        }
      } else {
        loggedWaitingForWeekly = false;
        const scheduleKey = localDateKey(local);
        const latestState = readScheduleState();
        if (!shouldSkipAlreadySent({
          scheduleKey,
          state: latestState,
          kind: 'weekly',
        })) {
          try {
            const result = await sendWeeklyReport({});
            writeScheduleState({
              lastWeeklyKey: scheduleKey,
              lastWeeklySentAt: new Date().toISOString(),
            });
            console.log(JSON.stringify({
              event: 'weekly_report_sent',
              subject: result.subject,
              recipients: result.recipients,
              messageId: 'messageId' in result ? result.messageId : undefined,
              scheduleKey,
              periodLabel: result.report.periodLabel,
            }));
          } catch (error) {
            console.error(JSON.stringify({
              event: 'weekly_report_failed',
              scheduleKey,
              error: error instanceof Error ? error.message : 'unknown',
              detail: 'Will retry each minute while still in the due hour.',
            }));
          }
        }
      }
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
      monthlyReportDay: env.MONTHLY_REPORT_DAY,
      monthlyReportHour: env.MONTHLY_REPORT_HOUR,
      monthlyReportTimezone: env.MONTHLY_REPORT_TIMEZONE,
      weeklyReportEnabled: env.WEEKLY_REPORT_ENABLED,
      weeklyReportWeekday: env.WEEKLY_REPORT_WEEKDAY,
      weeklyReportHour: env.WEEKLY_REPORT_HOUR,
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
