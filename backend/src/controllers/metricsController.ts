import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { jiraClient } from '../services/jiraClient';
import { getStoredProjects, getStoredSnapshot, getSyncState } from '../db/jiraRepository';
import { isDatabaseEnabled } from '../db/database';

const filtersSchema = z.object({
  projectKey: z.string().optional(),
  sprintId: z.coerce.number().int().positive().optional(),
  issueType: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});

const STATUS_COLORS: Record<string, string> = {
  Open: '#60a5fa',
  'In Progress': '#fbbf24',
  'In Review': '#a78bfa',
  Completed: '#34d399',
  Closed: '#22c55e',
  Blocked: '#f87171',
  'To Do': '#94a3b8',
  Done: '#34d399',
  Reopened: '#fb7185',
};

function normalizeStatus(status: string | { name?: string } | undefined) {
  if (typeof status === 'string') return status;
  return status?.name || 'Unknown';
}

function toSafeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function aggregateMetrics(issues: any[]) {
  const totalIssues = issues.length;
  const completedStatuses = new Set(['Completed', 'Closed', 'Done']);
  const resolvedCount = issues.filter((issue) => completedStatuses.has(normalizeStatus(issue.status)) || Boolean(issue.resolved)).length;
  const completionRate = totalIssues === 0 ? 0 : (resolvedCount / totalIssues) * 100;
  const velocity = issues.filter((issue) => !!issue.resolved).length;

  const cycleTimes = issues
    .filter((issue) => issue.created && issue.resolved)
    .map((issue) => {
      const start = toSafeDate(issue.created);
      const end = toSafeDate(issue.resolved);
      if (!start || !end) return null;
      return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
    })
    .filter((value): value is number => value !== null);

  const avgCycleTimeDays = cycleTimes.length ? cycleTimes.reduce((sum, value) => sum + value, 0) / cycleTimes.length : 0;

  const byDay = new Map<string, { created: number; resolved: number }>();
  const byWeek = new Map<string, { created: number; resolved: number }>();

  issues.forEach((issue) => {
    const created = toSafeDate(issue.created);
    if (created) {
      const dateKey = created.toISOString().slice(0, 10);
      const daily = byDay.get(dateKey) || { created: 0, resolved: 0 };
      daily.created += 1;
      byDay.set(dateKey, daily);

      const weekKey = `W${Math.ceil((created.getUTCDate() + created.getUTCDay()) / 7)}`;
      const weekly = byWeek.get(weekKey) || { created: 0, resolved: 0 };
      weekly.created += 1;
      byWeek.set(weekKey, weekly);
    }

    const resolved = toSafeDate(issue.resolved);
    if (resolved) {
      const dateKey = resolved.toISOString().slice(0, 10);
      const daily = byDay.get(dateKey) || { created: 0, resolved: 0 };
      daily.resolved += 1;
      byDay.set(dateKey, daily);

      const weekKey = `W${Math.ceil((resolved.getUTCDate() + resolved.getUTCDay()) / 7)}`;
      const weekly = byWeek.get(weekKey) || { created: 0, resolved: 0 };
      weekly.resolved += 1;
      byWeek.set(weekKey, weekly);
    }
  });

  const createdVsResolved = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([period, value]) => ({ period, created: value.created, resolved: value.resolved }));

  const statusMap = new Map<string, number>();
  issues.forEach((issue) => {
    const status = normalizeStatus(issue.status);
    statusMap.set(status, (statusMap.get(status) || 0) + 1);
  });

  const statusBreakdown = [...statusMap.entries()].map(([name, value]) => ({
    name,
    value,
    color: STATUS_COLORS[name] || '#64748b',
  }));

  const velocityTrend = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-6)
    .map(([period, value]) => ({
      period,
      target: Math.max(4, Math.round((value.created + value.resolved) / 2)),
      actual: value.resolved,
    }));

  return {
    totalIssues,
    completionRate: Number(completionRate.toFixed(1)),
    velocity,
    avgCycleTimeDays: Number(avgCycleTimeDays.toFixed(1)),
    createdVsResolved: createdVsResolved.length ? createdVsResolved : [{ period: 'No data', created: 0, resolved: 0 }],
    statusBreakdown,
    velocityTrend: velocityTrend.length ? velocityTrend : [{ period: 'No data', target: 0, actual: 0 }],
  };
}

export async function getMetricsHandler(req: Request, res: Response, next: NextFunction) {
  try {
    const parsed = filtersSchema.parse(req.query);

    const [projects, sprints, issueTypes, statuses, issues, syncState] = isDatabaseEnabled()
      ? await Promise.all([
          getStoredProjects(),
          jiraClient.getSprints(),
          jiraClient.getIssueTypes(),
          jiraClient.getIssueStatuses(),
          getStoredSnapshot(parsed),
          getSyncState(),
        ])
      : await Promise.all([
          jiraClient.getProjects(),
          jiraClient.getSprints(),
          jiraClient.getIssueTypes(),
          jiraClient.getIssueStatuses(),
          jiraClient.searchIssues(parsed),
          Promise.resolve(null),
        ]);

    if (isDatabaseEnabled() && !syncState?.last_success_at) {
      return res.status(503).json({
        type: 'https://api.example.com/problems/sync-required',
        title: 'Database snapshot is not ready',
        status: 503,
        detail: 'Run POST /api/v1/sync before requesting database-backed metrics.',
        code: 'SYNC_REQUIRED',
        requestId: res.locals.requestId,
      });
    }

    const metrics = aggregateMetrics(issues);

    return res.json({
      projects,
      sprints,
      issueTypes,
      statuses,
      issues,
      metrics,
      filters: parsed,
      meta: {
        source: 'jira',
        issueCount: issues.length,
        requestId: res.locals.requestId,
        persistence: isDatabaseEnabled() ? 'percona' : 'jira-direct',
      },
    });
  } catch (error) {
    next(error);
  }
}
