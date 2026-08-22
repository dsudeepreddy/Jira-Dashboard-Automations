import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { jiraClient } from '../services/jiraClient';
import {
  getStoredIssueTypes,
  getStoredProjects,
  getStoredSnapshot,
  getStoredSprints,
  getStoredStatuses,
  getSyncState,
} from '../db/jiraRepository';
import { isDatabaseEnabled } from '../db/database';
import { aggregateDashboardMetrics } from '../shared/analytics';
import type { AnalyticsSprint } from '../shared/analytics';
import { env } from '../config/env';

const filtersSchema = z.object({
  projectKey: z.string().optional(),
  sprintId: z.coerce.number().int().positive().optional(),
  issueType: z.string().optional(),
  startDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

function statusLookupFrom(statuses: Array<{ name: string; statusCategory?: { key?: string } }>) {
  return new Map(statuses.map((status) => [status.name.toLowerCase(), status.statusCategory?.key || '']));
}

function asIso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

export async function getMetricsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = filtersSchema.parse(req.query);
    const dbEnabled = isDatabaseEnabled();

    const [projects, agileSprints, issueTypes, statuses, searchResult, syncState] = dbEnabled
      ? await Promise.all([
          getStoredProjects(),
          getStoredSprints(),
          getStoredIssueTypes(),
          getStoredStatuses(),
          getStoredSnapshot(parsed).then((issues) => ({ issues, sprints: [] as AnalyticsSprint[] })),
          getSyncState(),
        ])
      : await Promise.all([
          jiraClient.getProjects(),
          jiraClient.getSprints().catch(() => []),
          jiraClient.getIssueTypes(),
          jiraClient.getIssueStatuses(),
          jiraClient.searchIssues(parsed),
          Promise.resolve(null),
        ]);

    const issues = searchResult.issues;
    const sprints = [...new Map([...agileSprints, ...searchResult.sprints].map((sprint) => [sprint.id, sprint])).values()];

    if (dbEnabled && !syncState?.last_success_at) {
      return res.status(503).json({
        type: 'https://api.example.com/problems/sync-required',
        title: 'Database snapshot is not ready',
        status: 503,
        detail: 'Run POST /api/v1/sync before requesting database-backed metrics.',
        code: 'SYNC_REQUIRED',
        requestId: res.locals.requestId,
      });
    }

    const fetchedAt = new Date().toISOString();
    const lastSuccessAt = asIso(syncState?.last_success_at) || (dbEnabled ? null : fetchedAt);
    const lastSyncedAt = asIso(syncState?.last_synced_at) || (dbEnabled ? null : fetchedAt);
    const stale = dbEnabled && lastSuccessAt ? Date.now() - new Date(lastSuccessAt).getTime() > env.STALE_AFTER_MS : false;
    const metrics = aggregateDashboardMetrics(issues, sprints, parsed, statusLookupFrom(statuses));

    return res.json({
      projects,
      sprints,
      issueTypes,
      statuses,
      metrics,
      filters: parsed,
      meta: {
        source: 'jira',
        issueCount: issues.length,
        requestId: res.locals.requestId,
        persistence: dbEnabled ? 'percona' : 'jira-direct',
        lastSuccessAt,
        lastSyncedAt,
        fetchedAt,
        lastError: syncState?.last_error || null,
        stale,
        truncated: dbEnabled ? issues.length >= 10000 : issues.length >= env.JIRA_MAX_ISSUES,
        browseBaseUrl: `${env.JIRA_DOMAIN.replace(/\/+$/, '')}/browse`,
      },
    });
  } catch (error) {
    next(error);
  }
}
