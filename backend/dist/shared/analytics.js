"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.STATUS_COLORS = void 0;
exports.isoWeekKey = isoWeekKey;
exports.toSafeDate = toSafeDate;
exports.daysBetween = daysBetween;
exports.ageBucket = ageBucket;
exports.categoryForStatus = categoryForStatus;
exports.isDoneIssue = isDoneIssue;
exports.deriveFlowTimestamps = deriveFlowTimestamps;
exports.aggregateDashboardMetrics = aggregateDashboardMetrics;
exports.STATUS_COLORS = {
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
const DONE_NAMES = new Set(['done', 'completed', 'closed', 'resolved', 'complete']);
const PROGRESS_NAMES = new Set(['in progress', 'indeterminate', 'in review', 'in development', 'doing']);
function isoWeekKey(value) {
    const utc = new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
    return `${utc.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}
function toSafeDate(value) {
    if (!value)
        return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}
function daysBetween(start, end) {
    return Math.max(0, (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24));
}
function ageBucket(days) {
    if (days <= 2)
        return '0–2d';
    if (days <= 7)
        return '3–7d';
    if (days <= 14)
        return '8–14d';
    return '14d+';
}
function categoryForStatus(name, statusLookup) {
    const mapped = statusLookup?.get(name.toLowerCase());
    if (mapped === 'new' || mapped === 'indeterminate' || mapped === 'done')
        return mapped;
    const normalized = name.toLowerCase();
    if (DONE_NAMES.has(normalized) || /\b(done|closed|complete)\b/.test(normalized))
        return 'done';
    if (PROGRESS_NAMES.has(normalized) || /progress|review|develop|doing/.test(normalized))
        return 'indeterminate';
    if (normalized === 'open' || normalized === 'new' || normalized === 'backlog' || normalized.includes('to do'))
        return 'new';
    if (normalized.includes('block'))
        return 'indeterminate';
    return 'unknown';
}
function isDoneIssue(issue, statusLookup) {
    if (issue.resolved)
        return true;
    const category = issue.statusCategory || categoryForStatus(issue.status, statusLookup);
    return category === 'done';
}
function deriveFlowTimestamps(created, resolved, histories, statusLookup) {
    let inProgressAt = null;
    let lastStatusChangedAt = null;
    const sorted = [...histories].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
    for (const history of sorted) {
        for (const item of history.items || []) {
            if (item.field !== 'status')
                continue;
            lastStatusChangedAt = history.created;
            const toCategory = categoryForStatus(item.toString || '', statusLookup);
            if (!inProgressAt && toCategory === 'indeterminate') {
                inProgressAt = history.created;
            }
        }
    }
    if (!inProgressAt && resolved)
        inProgressAt = created;
    return { inProgressAt, lastStatusChangedAt };
}
function average(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function emptyMetrics() {
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
    };
}
function issuePoints(issue) {
    return typeof issue.storyPoints === 'number' && Number.isFinite(issue.storyPoints) ? issue.storyPoints : 0;
}
function matchesFilters(issue, filters) {
    if (filters.projectKey && issue.projectKey && issue.projectKey !== filters.projectKey)
        return false;
    if (filters.issueType && issue.issueType !== filters.issueType)
        return false;
    if (filters.sprintId && !(issue.sprintIds || []).includes(filters.sprintId))
        return false;
    // Sprint membership already defines the window; created-date filters would drop older sprint items.
    if (filters.sprintId)
        return true;
    const created = toSafeDate(issue.created);
    if (filters.startDate && created && created < new Date(`${filters.startDate}T00:00:00.000Z`))
        return false;
    if (filters.endDate && created && created > new Date(`${filters.endDate}T23:59:59.999Z`))
        return false;
    return true;
}
function completionDate(issue, statusLookup) {
    return toSafeDate(issue.resolved)
        || (isDoneIssue(issue, statusLookup) ? toSafeDate(issue.lastStatusChangedAt) : null);
}
function issueCategory(issue, statusLookup) {
    return issue.statusCategory || categoryForStatus(issue.status, statusLookup);
}
function aggregateDashboardMetrics(issues, sprints = [], filters = {}, statusLookup, now = new Date()) {
    const scoped = issues.filter((issue) => matchesFilters(issue, filters));
    if (!scoped.length)
        return emptyMetrics();
    const doneIssues = scoped.filter((issue) => isDoneIssue(issue, statusLookup));
    const openIssues = scoped.filter((issue) => !isDoneIssue(issue, statusLookup));
    const blockedCount = scoped.filter((issue) => issue.flagged || /block/i.test(issue.status)).length;
    const completionRate = (doneIssues.length / scoped.length) * 100;
    const cycleTimes = doneIssues
        .map((issue) => {
        const end = completionDate(issue, statusLookup);
        const start = toSafeDate(issue.inProgressAt) || toSafeDate(issue.created);
        if (!start || !end)
            return null;
        return daysBetween(start, end);
    })
        .filter((value) => value !== null);
    const leadTimes = doneIssues
        .map((issue) => {
        const start = toSafeDate(issue.created);
        const end = completionDate(issue, statusLookup);
        if (!start || !end)
            return null;
        return daysBetween(start, end);
    })
        .filter((value) => value !== null);
    const byWeek = new Map();
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
    const statusMap = new Map();
    scoped.forEach((issue) => statusMap.set(issue.status, (statusMap.get(issue.status) || 0) + 1));
    const statusBreakdown = [...statusMap.entries()].map(([name, value]) => ({
        name,
        value,
        color: exports.STATUS_COLORS[name] || '#64748b',
    }));
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
    function sprintVelocity(sprintId) {
        const members = scoped.filter((issue) => (issue.sprintIds || []).includes(sprintId) && isDoneIssue(issue, statusLookup));
        return usesPoints ? members.reduce((sum, issue) => sum + issuePoints(issue), 0) : members.length;
    }
    let velocityBasis = 'sprint';
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
        const byWeek = new Map();
        scoped.forEach((issue) => {
            if (!isDoneIssue(issue, statusLookup))
                return;
            const end = completionDate(issue, statusLookup);
            if (!end)
                return;
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
    if (!velocityTrend.length)
        velocityTrend = emptyMetrics().velocityTrend;
    const latestVelocity = velocityTrend.at(-1)?.actual
        ?? (usesPoints ? doneIssues.reduce((sum, issue) => sum + issuePoints(issue), 0) : doneIssues.length);
    const wipCounts = { '0–2d': 0, '3–7d': 0, '8–14d': 0, '14d+': 0 };
    scoped.filter((issue) => issueCategory(issue, statusLookup) === 'indeterminate').forEach((issue) => {
        const start = toSafeDate(issue.inProgressAt) || toSafeDate(issue.lastStatusChangedAt) || toSafeDate(issue.created);
        if (!start)
            return;
        wipCounts[ageBucket(daysBetween(start, now))] += 1;
    });
    const assigneeMap = new Map();
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
    const timeMap = new Map();
    openIssues.forEach((issue) => {
        const start = toSafeDate(issue.lastStatusChangedAt) || toSafeDate(issue.updated) || toSafeDate(issue.created);
        if (!start)
            return;
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
    };
}
