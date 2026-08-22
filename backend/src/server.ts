import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { env } from './config/env';
import { jiraDiagnostics } from './services/jiraClient';
import { getMetricsHandler } from './controllers/metricsController';
import { syncJiraHandler } from './controllers/syncController';
import { initializeDatabase } from './db/database';
import { checkDatabase } from './db/database';
import healthRouter from './routes/health';
import { errorHandler } from './middleware/errorHandler';
import { metricsText, requestContext } from './middleware/observability';

const app = express();

app.use(requestContext);
app.use(helmet({
  contentSecurityPolicy: false,
  crossOriginEmbedderPolicy: false,
}));
app.use(cors({ origin: env.CORS_ORIGIN.split(',') }));
app.use(express.json({ limit: '1mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

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
app.get('/api/v1/metrics', getMetricsHandler);
app.post('/api/v1/sync', syncJiraHandler);
app.get('/api/v1/observability/metrics', (_req, res) => {
  res.type('text/plain').send(metricsText());
});
app.get('/api/v1/projects', async (_req, res) => {
  const projects = await (await import('./services/jiraClient')).jiraClient.getProjects();
  res.json(projects);
});

app.use(errorHandler);

async function start() {
  await initializeDatabase();
  app.listen(env.PORT, () => {
    console.log(JSON.stringify({ event: 'server_started', service: 'backend-api', port: env.PORT, database: env.DB_ENABLED ? 'percona' : 'disabled' }));
  });
}

start().catch((error) => {
  console.error(JSON.stringify({ event: 'server_start_failed', error: error instanceof Error ? error.message : 'unknown' }));
  process.exit(1);
});
