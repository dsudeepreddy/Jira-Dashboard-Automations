import { Request, Response, NextFunction } from 'express';
import { jiraClient } from '../services/jiraClient';
import { markSyncFailure, upsertJiraSnapshot, getSyncState } from '../db/jiraRepository';
import { isDatabaseEnabled } from '../db/database';
import { redisCache } from '../cache/redisClient';

export async function runJiraSync(full = false) {
  if (!isDatabaseEnabled()) {
    const error = Object.assign(new Error('Set DB_ENABLED=true to enable Jira snapshot persistence.'), {
      statusCode: 503,
      code: 'DATABASE_DISABLED',
    });
    throw error;
  }

  const [projects, issueTypes, statuses, agileSprints, syncState] = await Promise.all([
    jiraClient.getProjects(),
    jiraClient.getIssueTypes(),
    jiraClient.getIssueStatuses(),
    jiraClient.getSprints().catch(() => []),
    getSyncState(),
  ]);

  jiraClient.setStatusLookup(statuses);

  const updatedSince = !full && syncState?.last_issue_updated_at
    ? new Date(new Date(syncState.last_issue_updated_at).getTime() - 5 * 60 * 1000).toISOString()
    : undefined;

  const { issues, sprints: issueSprints } = await jiraClient.searchIssues({
    updatedSince,
    unbounded: full,
  });
  const sprints = [...new Map([...agileSprints, ...issueSprints].map((sprint) => [sprint.id, sprint])).values()];

  await upsertJiraSnapshot({ projects, issues, sprints, issueTypes, statuses });
  await redisCache.del('jira:projects');
  await redisCache.del('jira:projects:all');
  await redisCache.del('jira:sprints');
  await redisCache.del('jira:issueTypes');
  await redisCache.del('jira:issueTypes:all');
  await redisCache.del('jira:issueTypes:fromProjects');
  await redisCache.del('jira:statuses');

  return { projects: projects.length, issues: issues.length, sprints: sprints.length, incremental: Boolean(updatedSince) };
}

export async function syncJiraHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const full = req.query.full === 'true' || req.query.full === '1';
    const result = await runJiraSync(full);
    return res.status(202).json({ status: 'accepted', source: 'jira', ...result, requestId: res.locals.requestId });
  } catch (error) {
    try { await markSyncFailure(error); } catch (databaseError) {
      console.error(JSON.stringify({ event: 'sync_state_write_failed', error: databaseError instanceof Error ? databaseError.message : 'unknown' }));
    }
    next(error);
  }
}

export async function jiraWebhookHandler(_req: Request, res: Response) {
  res.status(202).json({ status: 'accepted', source: 'jira-webhook', requestId: res.locals.requestId });
  void runJiraSync(false).then((result) => {
    console.log(JSON.stringify({ event: 'webhook_sync_completed', ...result }));
  }).catch(async (error) => {
    try { await markSyncFailure(error); } catch { /* already logged by caller */ }
    console.error(JSON.stringify({
      event: 'webhook_sync_failed',
      error: error instanceof Error ? error.message : 'unknown',
    }));
  });
}
