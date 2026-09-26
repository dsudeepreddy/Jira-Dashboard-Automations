"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AUDIT_STATUS_BUCKETS = exports.DEFAULT_REVIEWER_SLA_TARGET_DAYS = exports.DEFAULT_TEAM_SLA_TARGET_DAYS = exports.STATUS_COLORS = void 0;
exports.colorForStatus = colorForStatus;
exports.isoWeekKey = isoWeekKey;
exports.toSafeDate = toSafeDate;
exports.shiftIsoDate = shiftIsoDate;
exports.isInCreatedDateRange = isInCreatedDateRange;
exports.createdDateJql = createdDateJql;
exports.daysBetween = daysBetween;
exports.ageBucket = ageBucket;
exports.categoryForStatus = categoryForStatus;
exports.isDoneIssue = isDoneIssue;
exports.deriveFlowTimestamps = deriveFlowTimestamps;
exports.isApprovedStatus = isApprovedStatus;
exports.isOnHoldStatus = isOnHoldStatus;
exports.isUnderValidationStatus = isUnderValidationStatus;
exports.isAuditDoneStatus = isAuditDoneStatus;
exports.bucketAuditStatus = bucketAuditStatus;
exports.deriveAuditSlaTimestamps = deriveAuditSlaTimestamps;
exports.calculateValidationTime = calculateValidationTime;
exports.aggregateDashboardMetrics = aggregateDashboardMetrics;
const dashboardContract_1 = require("./dashboardContract");
exports.STATUS_COLORS = {
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
    'Approve / Approved': '#db2777',
    'On Hold': '#f97316',
    'Under Validation': '#a855f7',
};
/** Stable color for a Jira status name (used by status breakdown + assignee stage stacks). */
function colorForStatus(name) {
    const normalized = name.toLowerCase().trim();
    const matchedKey = Object.keys(exports.STATUS_COLORS).find((key) => key.toLowerCase() === normalized);
    if (matchedKey)
        return exports.STATUS_COLORS[matchedKey];
    if (normalized.includes('approve') || normalized.includes('approval'))
        return exports.STATUS_COLORS.Approve || '#ec4899';
    if (normalized.includes('todo') || normalized === 'to-do' || normalized === 'to do')
        return exports.STATUS_COLORS['To Do'] || '#94a3b8';
    if (normalized.includes('progress'))
        return exports.STATUS_COLORS['In Progress'] || '#fbbf24';
    if (normalized.includes('hold'))
        return exports.STATUS_COLORS['On Hold'] || '#f97316';
    if (normalized.includes('validation'))
        return exports.STATUS_COLORS['Under Validation'] || '#a855f7';
    if (normalized === 'done' || normalized.includes('complete') || normalized.includes('closed')) {
        return exports.STATUS_COLORS.Done || '#10b981';
    }
    if (normalized.includes('block'))
        return exports.STATUS_COLORS.Blocked || '#f87171';
    return '#64748b';
}
const DONE_NAMES = new Set(['done', 'completed', 'closed', 'resolved', 'complete']);
const PROGRESS_NAMES = new Set(['in progress', 'indeterminate', 'in review', 'in development', 'doing']);
const SLICE_COLORS = ['#22d3ee', '#a78bfa', '#34d399', '#fbbf24', '#f87171', '#60a5fa', '#fb7185', '#c084fc', '#2dd4bf', '#f97316', '#818cf8', '#94a3b8'];
/** Default targets for “out of usual SLA” ticket lists (calendar days). */
exports.DEFAULT_TEAM_SLA_TARGET_DAYS = 7;
exports.DEFAULT_REVIEWER_SLA_TARGET_DAYS = 5;
/** Canonical audit workflow stages for View more completion dashboards. */
exports.AUDIT_STATUS_BUCKETS = [
    'To Do',
    'Approve / Approved',
    'On Hold',
    'In Progress',
    'Under Validation',
    'Done',
];
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
/** Shift a YYYY-MM-DD calendar date by a number of days. */
function shiftIsoDate(isoDate, days) {
    const [year, month, day] = isoDate.split('-').map(Number);
    if (!year || !month || !day)
        return isoDate;
    return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}
/** Inclusive YYYY-MM-DD comparison against the UTC calendar date of `created`. */
function isInCreatedDateRange(created, startDate, endDate) {
    const instant = toSafeDate(created);
    if (!instant)
        return !startDate && !endDate;
    const day = instant.toISOString().slice(0, 10);
    if (startDate && day < startDate)
        return false;
    if (endDate && day > endDate)
        return false;
    return true;
}
/** Jira treats a date-only literal as midnight, so the end bound is exclusive next day. */
function createdDateJql(startDate, endDate) {
    const parts = [];
    if (startDate)
        parts.push(`created >= "${startDate}"`);
    if (endDate)
        parts.push(`created < "${shiftIsoDate(endDate, 1)}"`);
    return parts.length ? parts.join(' AND ') : null;
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
function isApprovedStatus(name) {
    const n = name.toLowerCase().trim();
    return n === 'approved' || n === 'approve' || /\bapproved\b/.test(n) || /\bapprove\b/.test(n);
}
function isOnHoldStatus(name) {
    const n = name.toLowerCase().trim();
    return n.includes('on hold') || n.includes('on-hold') || n === 'hold' || n.includes('blocked');
}
function isUnderValidationStatus(name) {
    const n = name.toLowerCase().trim();
    return n.includes('under validation') || n === 'validation' || (n.includes('validate') && !n.includes('invalid'));
}
function isAuditDoneStatus(name) {
    const n = name.toLowerCase().trim();
    return DONE_NAMES.has(n) || /\b(done|closed|complete|resolved)\b/.test(n);
}
function bucketAuditStatus(status) {
    const n = status.toLowerCase().trim();
    if (isUnderValidationStatus(status))
        return 'Under Validation';
    if (isApprovedStatus(status))
        return 'Approve / Approved';
    if (isOnHoldStatus(status))
        return 'On Hold';
    if (isAuditDoneStatus(status))
        return 'Done';
    if (n.includes('to do') || n === 'todo' || n === 'backlog' || n === 'new' || n === 'open' || n === 'reopened')
        return 'To Do';
    if (n.includes('progress') || n.includes('doing') || n.includes('development') || n.includes('in review'))
        return 'In Progress';
    return 'Other';
}
/**
 * Team SLA: first Approved → first Under Validation.
 * Reviewer SLA: first Under Validation → first Done (or resolutiondate).
 */
function deriveAuditSlaTimestamps(created, resolved, currentStatus, histories, now = new Date()) {
    const sorted = [...histories].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
    let approvedAt = null;
    let underValidationAt = null;
    let doneAt = resolved || null;
    for (const history of sorted) {
        for (const item of history.items || []) {
            if (item.field !== 'status')
                continue;
            const to = item.toString || '';
            if (!approvedAt && isApprovedStatus(to))
                approvedAt = history.created;
            if (!underValidationAt && isUnderValidationStatus(to))
                underValidationAt = history.created;
            if (!doneAt && isAuditDoneStatus(to))
                doneAt = history.created;
        }
    }
    // Current status fallbacks when changelog never recorded the transition.
    if (!approvedAt && isApprovedStatus(currentStatus))
        approvedAt = created;
    if (!underValidationAt && isUnderValidationStatus(currentStatus))
        underValidationAt = created;
    if (!doneAt && isAuditDoneStatus(currentStatus))
        doneAt = resolved || created;
    const teamSlaDays = approvedAt && underValidationAt
        ? Number(daysBetween(new Date(approvedAt), new Date(underValidationAt)).toFixed(2))
        : null;
    const reviewerSlaDays = underValidationAt && doneAt
        ? Number(daysBetween(new Date(underValidationAt), new Date(doneAt)).toFixed(2))
        : null;
    return {
        approvedAt,
        underValidationAt,
        doneAt,
        teamSlaDays,
        reviewerSlaDays,
        validationDays: calculateValidationTime(created, resolved, currentStatus, histories, now),
    };
}
function calculateValidationTime(created, resolved, currentStatus, histories, now = new Date()) {
    const sorted = [...histories].sort((a, b) => new Date(a.created).getTime() - new Date(b.created).getTime());
    const statusTransitions = [];
    for (const history of sorted) {
        for (const item of history.items || []) {
            if (item.field !== 'status')
                continue;
            if (statusTransitions.length === 0 && item.fromString) {
                statusTransitions.push({ status: item.fromString, timestamp: new Date(created) });
            }
            statusTransitions.push({ status: item.toString || '', timestamp: new Date(history.created) });
        }
    }
    if (statusTransitions.length === 0) {
        statusTransitions.push({ status: currentStatus, timestamp: new Date(created) });
    }
    else {
        if (statusTransitions[0].timestamp.getTime() > new Date(created).getTime()) {
            const firstStatusItem = sorted[0]?.items?.find((i) => i.field === 'status');
            if (firstStatusItem?.fromString) {
                statusTransitions.unshift({ status: firstStatusItem.fromString, timestamp: new Date(created) });
            }
        }
    }
    let validationMs = 0;
    const endPoint = resolved ? new Date(resolved) : now;
    for (let i = 0; i < statusTransitions.length; i++) {
        const transition = statusTransitions[i];
        const nextTransitionTime = (i + 1 < statusTransitions.length)
            ? statusTransitions[i + 1].timestamp
            : endPoint;
        const statusLower = transition.status.toLowerCase();
        const isValidation = statusLower.includes('validation') || statusLower.includes('validate');
        if (isValidation) {
            const duration = nextTransitionTime.getTime() - transition.timestamp.getTime();
            if (duration > 0) {
                validationMs += duration;
            }
        }
    }
    return Number((validationMs / (1000 * 60 * 60 * 24)).toFixed(2));
}
function average(values) {
    if (!values.length)
        return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}
function emptyFieldMetrics() {
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
        fieldMetrics: emptyFieldMetrics(),
        validationTimeByAuditType: [],
        auditInsights: emptyAuditInsights(),
        teamSlaByAuditType: [],
        reviewerSlaByAuditType: [],
    };
}
function emptyAuditInsights() {
    return {
        workByAuditType: [],
        statusByAuditType: [],
        teamSlaByAuditType: [],
        reviewerSlaByAuditType: [],
        teamSlaTargetDays: exports.DEFAULT_TEAM_SLA_TARGET_DAYS,
        reviewerSlaTargetDays: exports.DEFAULT_REVIEWER_SLA_TARGET_DAYS,
        teamSlaBreaches: [],
        reviewerSlaBreaches: [],
    };
}
function cleanKeys(values) {
    return [...new Set((values || []).map((value) => (value || '').trim()).filter(Boolean))];
}
function slaByAuditType(issues, daysOf) {
    const map = new Map();
    issues.forEach((issue) => {
        const days = daysOf(issue);
        if (days == null || !Number.isFinite(days) || days < 0)
            return;
        const types = cleanKeys(issue.auditType);
        if (!types.length)
            types.push('(none)');
        types.forEach((type) => {
            const current = map.get(type) || { total: 0, count: 0 };
            current.total += days;
            current.count += 1;
            map.set(type, current);
        });
    });
    return [...map.entries()]
        .map(([auditType, value]) => ({
        auditType,
        avgDays: Number((value.total / value.count).toFixed(2)),
        count: value.count,
    }))
        .sort((a, b) => b.avgDays - a.avgDays);
}
function buildStatusByAuditType(issues) {
    const map = new Map();
    issues.forEach((issue) => {
        const types = cleanKeys(issue.auditType);
        if (!types.length)
            types.push('(none)');
        const bucket = bucketAuditStatus(issue.status);
        types.forEach((type) => {
            const stages = map.get(type) || new Map();
            stages.set(bucket, (stages.get(bucket) || 0) + 1);
            map.set(type, stages);
        });
    });
    return [...map.entries()]
        .map(([auditType, stages]) => {
        const stageRows = [
            ...exports.AUDIT_STATUS_BUCKETS.map((name, index) => ({
                name,
                value: stages.get(name) || 0,
                color: exports.STATUS_COLORS[name] || SLICE_COLORS[index % SLICE_COLORS.length],
            })),
            ...(stages.get('Other')
                ? [{ name: 'Other', value: stages.get('Other') || 0, color: '#94a3b8' }]
                : []),
        ];
        return {
            auditType,
            total: stageRows.reduce((sum, row) => sum + row.value, 0),
            stages: stageRows,
        };
    })
        .sort((a, b) => b.total - a.total);
}
function collectSlaBreaches(issues, options) {
    const breaches = [];
    issues.forEach((issue) => {
        const auditTypes = cleanKeys(issue.auditType);
        const completed = options.completedDaysOf(issue);
        if (typeof completed === 'number' && completed > options.targetDays) {
            breaches.push({
                key: issue.key,
                summary: issue.summary,
                assignee: issue.assignee || null,
                status: issue.status,
                auditTypes,
                slaDays: Number(completed.toFixed(2)),
                targetDays: options.targetDays,
                state: 'completed',
            });
            return;
        }
        if (!options.isInFlight(issue))
            return;
        const start = toSafeDate(options.inFlightStartOf(issue));
        if (!start)
            return;
        const elapsed = daysBetween(start, options.now);
        if (elapsed <= options.targetDays)
            return;
        breaches.push({
            key: issue.key,
            summary: issue.summary,
            assignee: issue.assignee || null,
            status: issue.status,
            auditTypes,
            slaDays: Number(elapsed.toFixed(2)),
            targetDays: options.targetDays,
            state: 'in_flight',
        });
    });
    return breaches.sort((a, b) => b.slaDays - a.slaDays).slice(0, 50);
}
function buildAuditInsights(scoped, fieldMetrics, statusLookup, now, teamSlaByAuditType, reviewerSlaByAuditType) {
    return {
        workByAuditType: fieldMetrics.auditTypes,
        statusByAuditType: buildStatusByAuditType(scoped),
        teamSlaByAuditType,
        reviewerSlaByAuditType,
        teamSlaTargetDays: exports.DEFAULT_TEAM_SLA_TARGET_DAYS,
        reviewerSlaTargetDays: exports.DEFAULT_REVIEWER_SLA_TARGET_DAYS,
        teamSlaBreaches: collectSlaBreaches(scoped, {
            completedDaysOf: (issue) => issue.teamSlaDays,
            inFlightStartOf: (issue) => issue.approvedAt,
            isInFlight: (issue) => Boolean(issue.approvedAt) && !issue.underValidationAt && !isDoneIssue(issue, statusLookup),
            targetDays: exports.DEFAULT_TEAM_SLA_TARGET_DAYS,
            now,
        }),
        reviewerSlaBreaches: collectSlaBreaches(scoped, {
            completedDaysOf: (issue) => issue.reviewerSlaDays,
            inFlightStartOf: (issue) => issue.underValidationAt,
            isInFlight: (issue) => Boolean(issue.underValidationAt) && !issue.doneAt && !isDoneIssue(issue, statusLookup),
            targetDays: exports.DEFAULT_REVIEWER_SLA_TARGET_DAYS,
            now,
        }),
    };
}
function fieldSlices(issues, keysOf, statusLookup, options = {}) {
    const { includeEmpty = false, emptyName = '(none)', limit = 12 } = options;
    const map = new Map();
    for (const issue of issues) {
        const keys = cleanKeys(keysOf(issue));
        const names = keys.length ? keys : (includeEmpty ? [emptyName] : []);
        if (!names.length)
            continue;
        const done = isDoneIssue(issue, statusLookup);
        for (const name of names) {
            const current = map.get(name) || { count: 0, openCount: 0, doneCount: 0, points: 0 };
            current.count += 1;
            if (done)
                current.doneCount += 1;
            else
                current.openCount += 1;
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
function aggregateFieldMetrics(issues, statusLookup) {
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
function hasSelected(values, wanted) {
    const needle = wanted.trim().toLowerCase();
    return cleanKeys(values).some((value) => value.toLowerCase() === needle);
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
    if (filters.label === dashboardContract_1.UNTAGGED_LABEL) {
        if (cleanKeys(issue.labels).length)
            return false;
    }
    else if (filters.label) {
        const wanted = filters.label.trim().toLowerCase();
        if (!cleanKeys(issue.labels).some((label) => label.toLowerCase() === wanted))
            return false;
    }
    if (filters.epicKey && issue.epicKey !== filters.epicKey)
        return false;
    if (filters.licenseBu && !hasSelected(issue.licenseBu, filters.licenseBu))
        return false;
    if (filters.auditType && !hasSelected(issue.auditType, filters.auditType))
        return false;
    if (filters.application && !hasSelected(issue.application, filters.application))
        return false;
    if (!isInCreatedDateRange(issue.created, filters.startDate, filters.endDate))
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
        color: colorForStatus(name),
    })).sort((a, b) => b.value - a.value);
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
        const current = assigneeMap.get(name) || { openCount: 0, points: 0, stages: new Map() };
        current.openCount += 1;
        current.points += issuePoints(issue);
        const stage = current.stages.get(issue.status) || { count: 0, keys: [] };
        stage.count += 1;
        if (stage.keys.length < 40)
            stage.keys.push(issue.key);
        current.stages.set(issue.status, stage);
        assigneeMap.set(name, current);
    });
    const assigneeLoad = [...assigneeMap.entries()]
        .map(([name, value]) => ({
        name,
        openCount: value.openCount,
        points: value.points,
        stages: [...value.stages.entries()]
            .map(([status, stage]) => ({
            status,
            count: stage.count,
            keys: stage.keys,
            color: colorForStatus(status),
        }))
            .sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)),
    }))
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
    const validationMap = new Map();
    scoped.forEach((issue) => {
        const valDays = issue.validationDays || 0;
        const auditTypes = issue.auditType || [];
        auditTypes.forEach((type) => {
            const current = validationMap.get(type) || { totalDays: 0, count: 0 };
            if (valDays > 0) {
                current.totalDays += valDays;
                current.count += 1;
            }
            validationMap.set(type, current);
        });
    });
    const validationTimeByAuditType = [...validationMap.entries()]
        .map(([auditType, value]) => ({
        auditType,
        avgDays: value.count > 0 ? Number((value.totalDays / value.count).toFixed(2)) : 0,
        count: value.count,
    }))
        .sort((a, b) => b.avgDays - a.avgDays);
    const teamSlaByAuditType = slaByAuditType(scoped, (issue) => issue.teamSlaDays);
    const reviewerSlaByAuditType = slaByAuditType(scoped, (issue) => issue.reviewerSlaDays);
    const fieldMetrics = aggregateFieldMetrics(scoped, statusLookup);
    const auditInsights = buildAuditInsights(scoped, fieldMetrics, statusLookup, now, teamSlaByAuditType, reviewerSlaByAuditType);
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
        fieldMetrics,
        validationTimeByAuditType,
        auditInsights,
        teamSlaByAuditType,
        reviewerSlaByAuditType,
    };
}
