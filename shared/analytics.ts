import type { DashboardFilters, DashboardMetrics, FieldMetrics, FieldSlice } from './dashboardContract';
import { UNTAGGED_LABEL } from './dashboardContract';

export const STATUS_COLORS: Record<string, string> = {
  Open: '#60a5fa',
  'In Progress': '#fbbf24',
  'In Review': '#a78bfa',
  Completed: '#34d399',
  Closed: '#16a34a',
  Blocked: '#f87171',
  'To Do': '#94a3b8',
  Done: '#10b981',
  Reopened: '#fb7185',
  Approve: '#ec4899',
  Approved: '#db2777',
};

export type StatusCategory = 'new' | 'indeterminate' | 'done' | 'unknown';

export interface AnalyticsSprint {
  id: number;
  name: string;
  state: string;
  startDate?: string;
  endDate?: string;
  completeDate?: string;
}

export interface AnalyticsIssue {
  id: string;
  key: string;
  summary: string;
  status: string;
  statusCategory?: StatusCategory | string;
  issueType?: string;
  projectKey?: string;
  created: string;
  updated: string;
  resolved?: string | null;
  assignee?: string | null;
  storyPoints?: number | null;
  flagged?: boolean;
  priority?: string | null;
  labels?: string[];
  components?: string[];
  licenseBu?: string[];
  auditType?: string[];
  application?: string[];
  epicKey?: string | null;
  epicName?: string | null;
  inProgressAt?: string | null;
  lastStatusChangedAt?: string | null;
  sprintIds?: number[];
}

export interface ChangelogItem {
  field?: string;
  fromString?: string | null;
  toString?: string | null;
}

export interface ChangelogHistory {
  created: string;
  items?: ChangelogItem[];
}

const DONE_NAMES = new Set(['done', 'completed', 'closed', 'resolved', 'complete']);
const PROGRESS_NAMES = new Set(['in progress', 'indeterminate', 'in review', 'in development', 'doing']);
const SLICE_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#fb7185', '#c084fc', '#2dd4bf', '#f97316', '#818cf8', '#94a3b8'];

export function isoWeekKey(value: Date): string {
  const utc = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

export function toSafeDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Shift a YYYY-MM-DD calendar date by a number of days. */
export function shiftIsoDate(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

/** Inclusive YYYY-MM-DD comparison against the UTC calendar date of `created`. */
export function isInCreatedDateRange(created: string | null | undefined, startDate?: string, endDate?: string): boolean {
  const instant = toSafeDate(created);
  if (!instant) return !startDate && !endDate;
  const day = instant.toISOString().slice(0, 10);
  if (startDate && day < startDate) return false;
  if (endDate && day > endDate) return false;
  return true;
}

/** Jira treats a date-only literal as midnight, so the end bound is exclusive next day. */
export function createdDateJql(startDate?: string, endDate?: string): string | null {
  const parts: string[] = [];
  if (startDate) parts.push(`created >= "${startDate}"`);
  if (endDate) parts.push(`created < "${shiftIsoDate(endDate, 1)}"`);
  return parts.length ? parts.join(' AND ') : null;
}

export function daysBetween(start: Date, end: Date): number {
  return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}

export function ageBucket(days: number): string {
  if (days <= 2) return '0–2d';
  if (days <= 7) return '3–7d';
  if (days <= 14) return '8–14d';
  return '14d+';
}

export function categoryForStatus(name: string, statusLookup?: Map<string, string>): StatusCategory {
  const mapped = statusLookup?.get(name.toLowerCase());
  if (mapped === 'new' || mapped === 'indeterminate' || mapped === 'done') return mapped;
  const normalized = name.toLowerCase();
  if (DONE_NAMES.has(normalized) || /\b(done|closed|complete)\b/.test(normalized)) return 'done';
  if (PROGRESS_NAMES.has(normalized) || /progress|review|develop|doing/.test(normalized)) return 'indeterminate';
  if (normalized === 'open' || normalized === 'new' || normalized === 'backlog' || normalized.includes('to do')) return 'new';
  if (normalized.includes('block')) return 'indeterminate';
  return 'unknown';
}

export function isDoneIssue(issue: AnalyticsIssue, statusLookup?: Map<string, string>): boolean {
  if (issue.resolved) return true;
  const category = (issue.statusCategory as StatusCategory | undefined) || categoryForStatus(issue.status, statusLookup);
  return category === 'done';
}

export function deriveFlowTimestamps(
  created: string,
  resolved: string | null | undefined,
  histories: ChangelogHistory[],
  statusLookup?: Map<string, string>,
): { inProgressAt: string | null; lastStatusChangedAt: string | null } {
  let inProgressAt: string | null = null;
  let lastStatusChangedAt: string | null = null;
  const sorted = [...histories].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());

  for (const history of sorted) {
    for (const item of history.items || []) {
      if (item.field !== 'status') continue;
      lastStatusChangedAt = history.created;
      const toCategory = categoryForStatus(item.toString || '', statusLookup);
      if (!inProgressAt && toCategory === 'indeterminate') {
        inProgressAt = history.created;
      }
    }
  }

  if (!inProgressAt && resolved) inProgressAt = created;
  return { inProgressAt, lastStatusChangedAt };
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function emptyFieldMetrics(): FieldMetrics {
  return {
    uniqueLabels: 0,
    labeledIssues: 0,
    unlabeledIssues: 0,
    uniqueComponents: 0,
    uniqueLicenseBus: 0,
    uniqueAuditTypes: 0,
    uniqueApplications: 0,
    uniqueEpics: 0,
    labels: [],
    components: [],
    priorities: [],
    issueTypes: [],
    projects: [],
    licenseBus: [],
    auditTypes: [],
    applications: [],
    epics: [],
  };
}

function emptyMetrics(): DashboardMetrics {
  return {
    totalIssues: 0,
    openIssues: 0,
    blockedCount: 0,
    completionRate: 0,
    velocity: 0,
    velocityUnit: 'issues',
    avgCycleTimeDays: 0,
    avgLeadTimeDays: 0,
    avgWeeklyThroughput: 0,
    createdVsResolved: [{ period: 'No data', created: 0, resolved: 0 }],
    statusBreakdown: [],
    velocityTrend: [{ period: 'No data', target: 0, actual: 0 }],
    wipAging: [
      { bucket: '0–2d', count: 0 },
      { bucket: '3–7d', count: 0 },
      { bucket: '8–14d', count: 0 },
      { bucket: '14d+', count: 0 },
    ],
    assigneeLoad: [],
    timeInStatus: [],
    forecast: { remainingIssues: 0, avgWeeklyThroughput: 0, estimatedWeeks: null, estimatedDate: null },
    velocityBasis: 'week',
    fieldMetrics: emptyFieldMetrics(),
  };
}

function cleanKeys(values?: Array<string | null | undefined>): string[] {
  return [...new Set((values || []).map((value) => (value || '').trim()).filter(Boolean))];
}

function fieldSlices(
  issues: AnalyticsIssue[],
  keysOf: (issue: AnalyticsIssue) => string[],
  statusLookup?: Map<string, string>,
  options: { includeEmpty?: boolean; emptyName?: string; limit?: number } = {},
): FieldSlice[] {
  const { includeEmpty = false, emptyName = '(none)', limit = 12 } = options;
  const map = new Map<string, { count: number; openCount: number; doneCount: number; points: number }>();

  for (const issue of issues) {
    const keys = cleanKeys(keysOf(issue));
    const names = keys.length ? keys : (includeEmpty ? [emptyName] : []);
    if (!names.length) continue;
    const done = isDoneIssue(issue, statusLookup);
    for (const name of names) {
      const current = map.get(name) || { count: 0, openCount: 0, doneCount: 0, points: 0 };
      current.count += 1;
      if (done) current.doneCount += 1;
      else current.openCount += 1;
      current.points += issuePoints(issue);
      map.set(name, current);
    }
  }

  return [...map.entries()]
    .map(([name, value]) => ({
      name,
      ...value,
      completionRate: value.count ? Number(((value.doneCount / value.count) * 100).toFixed(1)) : 0,
      color: SLICE_COLORS[0],
    }))
    .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map((row, index) => ({ ...row, color: SLICE_COLORS[index % SLICE_COLORS.length] }));
}

function aggregateFieldMetrics(issues: AnalyticsIssue[], statusLookup?: Map<string, string>): FieldMetrics {
  const labeledIssues = issues.filter((issue) => cleanKeys(issue.labels).length > 0).length;
  const licenseBus = fieldSlices(issues, (issue) => issue.licenseBu || [], statusLookup, { limit: 20 });
  const auditTypes = fieldSlices(issues, (issue) => issue.auditType || [], statusLookup, { limit: 12 });
  const applications = fieldSlices(issues, (issue) => issue.application || [], statusLookup, { limit: 20 });
  const epics = fieldSlices(issues, (issue) => (issue.epicName || issue.epicKey ? [issue.epicName || issue.epicKey || ''] : []), statusLookup, { limit: 12 });
  return {
    uniqueLabels: new Set(issues.flatMap((issue) => cleanKeys(issue.labels))).size,
    labeledIssues,
    unlabeledIssues: issues.length - labeledIssues,
    uniqueComponents: new Set(issues.flatMap((issue) => cleanKeys(issue.components))).size,
    uniqueLicenseBus: new Set(issues.flatMap((issue) => cleanKeys(issue.licenseBu))).size,
    uniqueAuditTypes: new Set(issues.flatMap((issue) => cleanKeys(issue.auditType))).size,
    uniqueApplications: new Set(issues.flatMap((issue) => cleanKeys(issue.application))).size,
    uniqueEpics: new Set(issues.map((issue) => issue.epicKey).filter(Boolean)).size,
    labels: fieldSlices(issues, (issue) => issue.labels || [], statusLookup, { limit: 20 }),
    components: fieldSlices(issues, (issue) => issue.components || [], statusLookup, { limit: 12 }),
    priorities: fieldSlices(issues, (issue) => (issue.priority ? [issue.priority] : []), statusLookup, {
      includeEmpty: true,
      emptyName: '(none)',
      limit: 10,
    }),
    issueTypes: fieldSlices(issues, (issue) => (issue.issueType ? [issue.issueType] : []), statusLookup, {
      includeEmpty: true,
      emptyName: '(none)',
      limit: 12,
    }),
    projects: fieldSlices(issues, (issue) => (issue.projectKey ? [issue.projectKey] : []), statusLookup, {
      includeEmpty: true,
      emptyName: '(none)',
      limit: 12,
    }),
    licenseBus,
    auditTypes,
    applications,
    epics,
  };
}

function hasSelected(values: Array<string | null | undefined> | undefined, wanted: string) {
  const needle = wanted.trim().toLowerCase();
  return cleanKeys(values).some((value) => value.toLowerCase() === needle);
}

function issuePoints(issue: AnalyticsIssue): number {
  return typeof issue.storyPoints === 'number' && Number.isFinite(issue.storyPoints) ? issue.storyPoints : 0;
}

function matchesFilters(issue: AnalyticsIssue, filters: DashboardFilters): boolean {
  if (filters.projectKey && issue.projectKey && issue.projectKey !== filters.projectKey) return false;
  if (filters.issueType && issue.issueType !== filters.issueType) return false;
  if (filters.sprintId && !(issue.sprintIds || []).includes(filters.sprintId)) return false;
  if (filters.label === UNTAGGED_LABEL) {
    if (cleanKeys(issue.labels).length) return false;
  } else if (filters.label) {
    const wanted = filters.label.trim().toLowerCase();
    if (!cleanKeys(issue.labels).some((label) => label.toLowerCase() === wanted)) return false;
  }
  if (filters.epicKey && issue.epicKey !== filters.epicKey) return false;
  if (filters.licenseBu && !hasSelected(issue.licenseBu, filters.licenseBu)) return false;
  if (filters.auditType && !hasSelected(issue.auditType, filters.auditType)) return false;
  if (filters.application && !hasSelected(issue.application, filters.application)) return false;
  if (!isInCreatedDateRange(issue.created, filters.startDate, filters.endDate)) return false;
  return true;
}

function completionDate(issue: AnalyticsIssue, statusLookup?: Map<string, string>): Date | null {
  return toSafeDate(issue.resolved)
    || (isDoneIssue(issue, statusLookup) ? toSafeDate(issue.lastStatusChangedAt) : null);
}

function issueCategory(issue: AnalyticsIssue, statusLookup?: Map<string, string>): StatusCategory {
  return (issue.statusCategory as StatusCategory | undefined) || categoryForStatus(issue.status, statusLookup);
}

export function aggregateDashboardMetrics(
  issues: AnalyticsIssue[],
  sprints: AnalyticsSprint[] = [],
  filters: DashboardFilters = {},
  statusLookup?: Map<string, string>,
  now = new Date(),
): DashboardMetrics {
  const scoped = issues.filter((issue) => matchesFilters(issue, filters));
  if (!scoped.length) return emptyMetrics();

  const doneIssues = scoped.filter((issue) => isDoneIssue(issue, statusLookup));
  const openIssues = scoped.filter((issue) => !isDoneIssue(issue, statusLookup));
  const blockedCount = scoped.filter((issue) => issue.flagged || /block/i.test(issue.status)).length;
  const completionRate = (doneIssues.length / scoped.length) * 100;

  const cycleTimes = doneIssues
    .map((issue) => {
      const end = completionDate(issue, statusLookup);
      const start = toSafeDate(issue.inProgressAt) || toSafeDate(issue.created);
      if (!start || !end) return null;
      return daysBetween(start, end);
    })
    .filter((value): value is number => value !== null);

  const leadTimes = doneIssues
    .map((issue) => {
      const start = toSafeDate(issue.created);
      const end = completionDate(issue, statusLookup);
      if (!start || !end) return null;
      return daysBetween(start, end);
    })
    .filter((value): value is number => value !== null);

  const byWeek = new Map<string, { created: number; resolved: number }>();
  scoped.forEach((issue) => {
    const created = toSafeDate(issue.created);
    if (created) {
      const key = isoWeekKey(created);
      const entry = byWeek.get(key) || { created: 0, resolved: 0 };
      entry.created += 1;
      byWeek.set(key, entry);
    }
    const resolved = toSafeDate(issue.resolved);
    if (resolved) {
      const key = isoWeekKey(resolved);
      const entry = byWeek.get(key) || { created: 0, resolved: 0 };
      entry.resolved += 1;
      byWeek.set(key, entry);
    }
  });

  const createdVsResolved = [...byWeek.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-8)
    .map(([period, value]) => ({ period, created: value.created, resolved: value.resolved }));

  const recentThroughput = createdVsResolved.slice(-4).map((row) => row.resolved);
  const avgWeeklyThroughput = Number(average(recentThroughput).toFixed(1));

  const statusMap = new Map<string, number>();
  scoped.forEach((issue) => statusMap.set(issue.status, (statusMap.get(issue.status) || 0) + 1));
  const statusBreakdown = [...statusMap.entries()].map(([name, value]) => {
    const normalized = name.toLowerCase().trim();
    let color = '#64748b';

    const matchedKey = Object.keys(STATUS_COLORS).find((k) => k.toLowerCase() === normalized);
    if (matchedKey) {
      color = STATUS_COLORS[matchedKey];
    } else if (normalized.includes('approve') || normalized.includes('approval')) {
      color = STATUS_COLORS['Approve'] || '#ec4899';
    } else if (normalized.includes('todo') || normalized === 'to-do') {
      color = STATUS_COLORS['To Do'] || '#94a3b8';
    } else if (normalized.includes('progress')) {
      color = STATUS_COLORS['In Progress'] || '#fbbf24';
    } else if (normalized === 'done') {
      color = STATUS_COLORS['Done'] || '#10b981';
    }

    return {
      name,
      value,
      color,
    };
  });

  const completedSprints = sprints
    .filter((sprint) => {
      const state = sprint.state?.toLowerCase() || '';
      return state === 'closed' || state === 'complete' || Boolean(sprint.completeDate);
    })
    .sort((a, b) => (toSafeDate(a.completeDate || a.endDate)?.getTime() || 0) - (toSafeDate(b.completeDate || b.endDate)?.getTime() || 0));

  const activeSprints = sprints.filter((sprint) => sprint.state?.toLowerCase() === 'active');
  const sprintsForTrend = filters.sprintId
    ? sprints.filter((sprint) => sprint.id === filters.sprintId)
    : [...new Map([...completedSprints.slice(-6), ...activeSprints].map((sprint) => [sprint.id, sprint])).values()];

  const usesPoints = scoped.some((issue) => issuePoints(issue) > 0);

  function sprintVelocity(sprintId: number) {
    const members = scoped.filter((issue) => (issue.sprintIds || []).includes(sprintId) && isDoneIssue(issue, statusLookup));
    return usesPoints ? members.reduce((sum, issue) => sum + issuePoints(issue), 0) : members.length;
  }

  let velocityBasis: 'sprint' | 'week' = 'sprint';
  let velocityTrend = sprintsForTrend.map((sprint, index, all) => {
    const actual = sprintVelocity(sprint.id);
    const prior = all.slice(0, index).map((previous) => sprintVelocity(previous.id));
    return {
      period: sprint.name,
      actual: Number(actual.toFixed(1)),
      target: Number((prior.length ? average(prior) : actual).toFixed(1)),
    };
  });

  if (!sprintsForTrend.length || !scoped.some((issue) => (issue.sprintIds || []).length)) {
    velocityBasis = 'week';
    const byWeek = new Map<string, number>();
    scoped.forEach((issue) => {
      if (!isDoneIssue(issue, statusLookup)) return;
      const end = completionDate(issue, statusLookup);
      if (!end) return;
      const key = isoWeekKey(end);
      byWeek.set(key, (byWeek.get(key) || 0) + (usesPoints ? issuePoints(issue) : 1));
    });
    const weeks = [...byWeek.entries()].sort(([a], [b]) => a.localeCompare(b)).slice(-6);
    velocityTrend = weeks.map(([period, actual], index, all) => ({
      period,
      actual: Number(actual.toFixed(1)),
      target: Number((index ? average(all.slice(0, index).map((row) => row[1])) : actual).toFixed(1)),
    }));
  }

  if (!velocityTrend.length) velocityTrend = emptyMetrics().velocityTrend;

  const latestVelocity = velocityTrend.at(-1)?.actual
    ?? (usesPoints ? doneIssues.reduce((sum, issue) => sum + issuePoints(issue), 0) : doneIssues.length);

  const wipCounts: Record<string, number> = { '0–2d': 0, '3–7d': 0, '8–14d': 0, '14d+': 0 };
  scoped.filter((issue) => issueCategory(issue, statusLookup) === 'indeterminate').forEach((issue) => {
    const start = toSafeDate(issue.inProgressAt) || toSafeDate(issue.lastStatusChangedAt) || toSafeDate(issue.created);
    if (!start) return;
    wipCounts[ageBucket(daysBetween(start, now))] += 1;
  });

  const assigneeMap = new Map<string, { openCount: number; points: number }>();
  openIssues.forEach((issue) => {
    const name = issue.assignee || 'Unassigned';
    const current = assigneeMap.get(name) || { openCount: 0, points: 0 };
    current.openCount += 1;
    current.points += issuePoints(issue);
    assigneeMap.set(name, current);
  });
  const assigneeLoad = [...assigneeMap.entries()]
    .map(([name, value]) => ({ name, ...value }))
    .sort((a, b) => b.openCount - a.openCount)
    .slice(0, 8);

  const timeMap = new Map<string, { totalDays: number; count: number }>();
  openIssues.forEach((issue) => {
    const start = toSafeDate(issue.lastStatusChangedAt) || toSafeDate(issue.updated) || toSafeDate(issue.created);
    if (!start) return;
    const current = timeMap.get(issue.status) || { totalDays: 0, count: 0 };
    current.totalDays += daysBetween(start, now);
    current.count += 1;
    timeMap.set(issue.status, current);
  });
  const timeInStatus = [...timeMap.entries()]
    .map(([status, value]) => ({ status, avgDays: Number((value.totalDays / value.count).toFixed(1)), count: value.count }))
    .sort((a, b) => b.avgDays - a.avgDays)
    .slice(0, 8);

  const remainingIssues = openIssues.length;
  const estimatedWeeks = avgWeeklyThroughput > 0 ? Number((remainingIssues / avgWeeklyThroughput).toFixed(1)) : null;
  const estimatedDate = estimatedWeeks == null
    ? null
    : new Date(now.getTime() + estimatedWeeks * 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return {
    totalIssues: scoped.length,
    openIssues: remainingIssues,
    blockedCount,
    completionRate: Number(completionRate.toFixed(1)),
    velocity: Number(Number(latestVelocity).toFixed(1)),
    velocityUnit: usesPoints ? 'points' : 'issues',
    avgCycleTimeDays: Number(average(cycleTimes).toFixed(1)),
    avgLeadTimeDays: Number(average(leadTimes).toFixed(1)),
    avgWeeklyThroughput,
    createdVsResolved: createdVsResolved.length ? createdVsResolved : emptyMetrics().createdVsResolved,
    statusBreakdown,
    velocityTrend,
    velocityBasis,
    wipAging: Object.entries(wipCounts).map(([bucket, count]) => ({ bucket, count })),
    assigneeLoad,
    timeInStatus,
    forecast: { remainingIssues, avgWeeklyThroughput, estimatedWeeks, estimatedDate },
    fieldMetrics: aggregateFieldMetrics(scoped, statusLookup),
  };
}
