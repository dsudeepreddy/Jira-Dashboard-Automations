import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { jiraClient } from '../services/jiraClient';
import {
  getStoredEpics,
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
import { ATLASSIAN_BROWSE_BASE_URL } from '../shared/dashboardContract';
import { env } from '../config/env';

const filtersSchema = z.object({
  projectKey: z.string().optional(),
  sprintId: z.coerce.number().int().positive().optional(),
  issueType: z.string().optional(),
  label: z.string().optional(),
  epicKey: z.string().optional(),
  licenseBu: z.string().optional(),
  auditType: z.string().optional(),
  application: z.string().optional(),
  startDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
  endDate: z.preprocess((value) => (value === '' ? undefined : value), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});

function statusLookupFrom(statuses: Array<{ name: string; statusCategory?: { key?: string } }>) {
  return new Map(statuses.map((status) => [status.name.toLowerCase(), status.statusCategory?.key || '']));
}

function catalogNames(values: Array<string | null | undefined>) {
  return [...new Set(values.map((value) => (value || '').trim()).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right))
    .map((name) => ({ id: name, name }));
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
    const {
      label: _label,
      licenseBu: _licenseBu,
      auditType: _auditType,
      application: _application,
      ...scopeForCatalog
    } = parsed;

    const [projects, agileSprints, issueTypes, statuses, searchResult, storedEpics, syncState] = dbEnabled
      ? await Promise.all([
          getStoredProjects(),
          getStoredSprints(),
          getStoredIssueTypes(),
          getStoredStatuses(),
          getStoredSnapshot(scopeForCatalog).then((issues) => ({ issues, sprints: [] as AnalyticsSprint[] })),
          getStoredEpics(),
          getSyncState(),
        ])
      : await Promise.all([
          jiraClient.getProjects(),
          jiraClient.getSprints().catch(() => []),
          jiraClient.getIssueTypes(),
          jiraClient.getIssueStatuses(),
          jiraClient.searchIssues(scopeForCatalog),
          jiraClient.getEpics(parsed.projectKey).catch(() => []),
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
    const labels = catalogNames(issues.flatMap((issue) => issue.labels || []));
    const licenseBus = catalogNames(issues.flatMap((issue) => issue.licenseBu || []));
    const auditTypes = catalogNames(issues.flatMap((issue) => issue.auditType || []));
    const applications = catalogNames(issues.flatMap((issue) => issue.application || []));
    const epics = [...new Map([
      ...storedEpics.map((epic) => [epic.key, epic] as const),
      ...issues.filter((issue) => issue.epicKey).map((issue) => [issue.epicKey as string, { key: issue.epicKey as string, name: issue.epicName || issue.epicKey || '' }] as const),
    ]).values()].sort((left, right) => left.name.localeCompare(right.name));

    return res.json({
      projects,
      sprints,
      issueTypes,
      labels,
      epics,
      licenseBus,
      auditTypes,
      applications,
      statuses,
      metrics,
      filters: parsed,
      meta: {
        source: 'jira',
        issueCount: metrics.totalIssues,
        requestId: res.locals.requestId,
        persistence: dbEnabled ? 'percona' : 'jira-direct',
        lastSuccessAt,
        lastSyncedAt,
        fetchedAt,
        lastError: syncState?.last_error || null,
        stale,
        truncated: dbEnabled ? issues.length >= 10000 : issues.length >= env.JIRA_MAX_ISSUES,
        browseBaseUrl: ATLASSIAN_BROWSE_BASE_URL,
      },
    });
  } catch (error) {
    next(error);
  }
}
