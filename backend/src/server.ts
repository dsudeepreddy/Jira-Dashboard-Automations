import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env';
import { jiraDiagnostics } from './services/jiraClient';
import { getMetricsHandler } from './controllers/metricsController';
import { getIssuesHandler } from './controllers/issuesController';
import { runJiraSync, syncJiraHandler, jiraWebhookHandler } from './controllers/syncController';
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

app.get('/api/v1/health', async (_req, res) => {
  const database = await checkDatabase();
  res.json({
    status: 'ok',
    service: 'backend-api',
    timestamp: new Date().toISOString(),
    jira: jiraDiagnostics,
    database,
  });
});

app.use('/api/v1', healthRouter);
app.get('/api/v1/metrics', requireDashboardToken, getMetricsHandler);
app.get('/api/v1/issues', requireDashboardToken, getIssuesHandler);
app.post('/api/v1/sync', syncLimiter, requireSyncToken, syncJiraHandler);
app.post('/api/v1/webhooks/jira', syncLimiter, requireSyncToken, jiraWebhookHandler);
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

async function start() {
  await initializeDatabase();
  app.listen(env.PORT, () => {
    console.log(JSON.stringify({
      event: 'server_started',
      service: 'backend-api',
      port: env.PORT,
      database: env.DB_ENABLED ? 'percona' : 'disabled',
      syncIntervalMs: env.SYNC_INTERVAL_MS,
    }));
  });
  await startScheduledSync();
}

start().catch((error) => {
  console.error(JSON.stringify({ event: 'server_start_failed', error: error instanceof Error ? error.message : 'unknown' }));
  process.exit(1);
});
