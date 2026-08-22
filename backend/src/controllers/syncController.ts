import { Request, Response, NextFunction } from 'express';
import { jiraClient } from '../services/jiraClient';
import { markSyncFailure, upsertJiraSnapshot } from '../db/jiraRepository';
import { isDatabaseEnabled } from '../db/database';

export async function syncJiraHandler(_req: Request, res: Response, next: NextFunction) {
  try {
    if (!isDatabaseEnabled()) {
      return res.status(503).json({
        type: 'https://api.example.com/problems/database-disabled',
        title: 'Percona persistence is disabled',
        status: 503,
        detail: 'Set DB_ENABLED=true to enable Jira snapshot persistence.',
        code: 'DATABASE_DISABLED',
        requestId: res.locals.requestId,
      });
    }
    const [projects, issues] = await Promise.all([
      jiraClient.getProjects(),
      jiraClient.searchIssues(),
    ]);
    await upsertJiraSnapshot(projects, issues);
    return res.status(202).json({ status: 'accepted', source: 'jira', projects: projects.length, issues: issues.length, requestId: res.locals.requestId });
  } catch (error) {
    try { await markSyncFailure(error); } catch (databaseError) { console.error(JSON.stringify({ event: 'sync_state_write_failed', error: databaseError instanceof Error ? databaseError.message : 'unknown' })); }
    next(error);
  }
}
