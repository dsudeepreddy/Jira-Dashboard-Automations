import { DashboardFilters, DashboardMetrics, JiraIssue } from './types';

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

function toSafeDate(value?: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function normalizeStatus(status: JiraIssue['status']) {
  return typeof status === 'string' ? status : status?.name || 'Unknown';
}

export function aggregateDashboardMetrics(issues: JiraIssue[], filters: DashboardFilters = {}): DashboardMetrics {
  const totalIssues = issues.length;
  const completedStatuses = new Set(['Completed', 'Closed', 'Done']);
  const resolvedCount = issues.filter((issue) => {
    const status = normalizeStatus(issue.status);
    return completedStatuses.has(status) || Boolean(issue.resolved);
  }).length;
  const completionRate = totalIssues === 0 ? 0 : (resolvedCount / totalIssues) * 100;

  const velocity = issues.filter((issue) => issue.resolved).length;

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
      const dayKey = created.toISOString().slice(0, 10);
      const existing = byDay.get(dayKey) || { created: 0, resolved: 0 };
      existing.created += 1;
      byDay.set(dayKey, existing);

      const weekKey = `W${Math.ceil((created.getUTCDate() + created.getUTCDay()) / 7)}`;
      const weekEntry = byWeek.get(weekKey) || { created: 0, resolved: 0 };
      weekEntry.created += 1;
      byWeek.set(weekKey, weekEntry);
    }

    const resolved = toSafeDate(issue.resolved);
    if (resolved) {
      const dayKey = resolved.toISOString().slice(0, 10);
      const entry = byDay.get(dayKey) || { created: 0, resolved: 0 };
      entry.resolved += 1;
      byDay.set(dayKey, entry);

      const weekKey = `W${Math.ceil((resolved.getUTCDate() + resolved.getUTCDay()) / 7)}`;
      const weekEntry = byWeek.get(weekKey) || { created: 0, resolved: 0 };
      weekEntry.resolved += 1;
      byWeek.set(weekKey, weekEntry);
    }
  });

  const createdVsResolved = [...byDay.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([period, data]) => ({ period, created: data.created, resolved: data.resolved }));

  if (createdVsResolved.length === 0) {
    createdVsResolved.push({ period: 'No data', created: 0, resolved: 0 });
  }

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
    .map(([period, data]) => ({
      period,
      target: Math.max(4, Math.round((data.created + data.resolved) / 2)),
      actual: data.resolved,
    }));

  if (velocityTrend.length === 0) {
    velocityTrend.push({ period: 'No data', target: 0, actual: 0 });
  }

  return {
    totalIssues,
    completionRate: Number(completionRate.toFixed(1)),
    velocity,
    avgCycleTimeDays: Number(avgCycleTimeDays.toFixed(1)),
    createdVsResolved,
    statusBreakdown,
    velocityTrend,
  };
}
