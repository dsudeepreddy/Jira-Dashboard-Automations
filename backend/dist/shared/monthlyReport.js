"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.previousMonthWindow = previousMonthWindow;
exports.monthWindowFromYm = monthWindowFromYm;
exports.buildMonthlyReport = buildMonthlyReport;
exports.monthlyReportSubject = monthlyReportSubject;
exports.monthlyReportIntro = monthlyReportIntro;
const analytics_1 = require("./analytics");
function dayKey(value) {
    const date = (0, analytics_1.toSafeDate)(value);
    return date ? date.toISOString().slice(0, 10) : null;
}
function inMonth(day, startDate, endDate) {
    return Boolean(day && day >= startDate && day <= endDate);
}
function cleanTypes(values) {
    const cleaned = [...new Set((values || []).map((value) => (value || '').trim()).filter(Boolean))];
    return cleaned.length ? cleaned : ['(none)'];
}
function average(values) {
    if (!values.length)
        return null;
    return Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2));
}
function isOnHold(status) {
    const n = status.toLowerCase();
    return n.includes('on hold') || n.includes('on-hold') || n === 'hold';
}
function isUnderValidation(status) {
    const n = status.toLowerCase();
    return n.includes('under validation') || n === 'validation';
}
/** Previous calendar month relative to `now` (UTC date parts). */
function previousMonthWindow(now = new Date()) {
    const year = now.getUTCFullYear();
    const month = now.getUTCMonth(); // 0-based current
    const start = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(Date.UTC(year, month, 0)); // last day of previous month
    const startDate = start.toISOString().slice(0, 10);
    const endDate = end.toISOString().slice(0, 10);
    const periodLabel = start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
    return { startDate, endDate, periodLabel };
}
function monthWindowFromYm(yearMonth) {
    const match = /^(\d{4})-(\d{2})$/.exec(yearMonth);
    if (!match)
        throw new Error('month must be YYYY-MM');
    const year = Number(match[1]);
    const monthIndex = Number(match[2]) - 1;
    const start = new Date(Date.UTC(year, monthIndex, 1));
    const end = new Date(Date.UTC(year, monthIndex + 1, 0));
    return {
        startDate: start.toISOString().slice(0, 10),
        endDate: end.toISOString().slice(0, 10),
        periodLabel: start.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
    };
}
function buildMonthlyReport(issues, options) {
    const now = options.now || new Date();
    const teamTarget = options.teamSlaTargetDays ?? analytics_1.DEFAULT_TEAM_SLA_TARGET_DAYS;
    const reviewerTarget = options.reviewerSlaTargetDays ?? analytics_1.DEFAULT_REVIEWER_SLA_TARGET_DAYS;
    const { startDate, endDate, periodLabel } = options;
    const byType = new Map();
    const ensure = (type) => {
        const current = byType.get(type) || { opened: 0, closed: 0, teamDays: [], reviewerDays: [] };
        byType.set(type, current);
        return current;
    };
    let opened = 0;
    let closed = 0;
    let stillOpen = 0;
    let onHold = 0;
    let underValidation = 0;
    const appMap = new Map();
    const breaches = [];
    for (const issue of issues) {
        const createdDay = dayKey(issue.created);
        const resolvedDay = dayKey(issue.resolved || issue.doneAt);
        const openedInMonth = inMonth(createdDay, startDate, endDate);
        const closedInMonth = inMonth(resolvedDay, startDate, endDate);
        const types = cleanTypes(issue.auditType);
        const apps = [...new Set((issue.application || []).map((value) => value.trim()).filter(Boolean))];
        if (openedInMonth) {
            opened += 1;
            types.forEach((type) => { ensure(type).opened += 1; });
            apps.forEach((name) => {
                const row = appMap.get(name) || { opened: 0, closed: 0 };
                row.opened += 1;
                appMap.set(name, row);
            });
        }
        if (closedInMonth) {
            closed += 1;
            types.forEach((type) => { ensure(type).closed += 1; });
            apps.forEach((name) => {
                const row = appMap.get(name) || { opened: 0, closed: 0 };
                row.closed += 1;
                appMap.set(name, row);
            });
        }
        const teamCompletedDay = dayKey(issue.underValidationAt);
        if (inMonth(teamCompletedDay, startDate, endDate) && typeof issue.teamSlaDays === 'number') {
            types.forEach((type) => { ensure(type).teamDays.push(issue.teamSlaDays); });
        }
        const reviewerCompletedDay = dayKey(issue.doneAt || issue.resolved);
        if (inMonth(reviewerCompletedDay, startDate, endDate) && typeof issue.reviewerSlaDays === 'number') {
            types.forEach((type) => { ensure(type).reviewerDays.push(issue.reviewerSlaDays); });
        }
        if (!(0, analytics_1.isDoneIssue)(issue)) {
            stillOpen += 1;
            if (isOnHold(issue.status))
                onHold += 1;
            if (isUnderValidation(issue.status))
                underValidation += 1;
            if (issue.approvedAt && !issue.underValidationAt) {
                const start = (0, analytics_1.toSafeDate)(issue.approvedAt);
                if (start) {
                    const elapsed = (0, analytics_1.daysBetween)(start, now);
                    if (elapsed > teamTarget) {
                        breaches.push({
                            key: issue.key,
                            summary: issue.summary,
                            assignee: issue.assignee || null,
                            status: issue.status,
                            auditTypes: types.filter((type) => type !== '(none)'),
                            slaDays: Number(elapsed.toFixed(1)),
                            targetDays: teamTarget,
                            kind: 'team',
                        });
                    }
                }
            }
            if (issue.underValidationAt && !issue.doneAt && !issue.resolved) {
                const start = (0, analytics_1.toSafeDate)(issue.underValidationAt);
                if (start) {
                    const elapsed = (0, analytics_1.daysBetween)(start, now);
                    if (elapsed > reviewerTarget) {
                        breaches.push({
                            key: issue.key,
                            summary: issue.summary,
                            assignee: issue.assignee || null,
                            status: issue.status,
                            auditTypes: types.filter((type) => type !== '(none)'),
                            slaDays: Number(elapsed.toFixed(1)),
                            targetDays: reviewerTarget,
                            kind: 'reviewer',
                        });
                    }
                }
            }
        }
    }
    const teamAll = [...byType.values()].flatMap((row) => row.teamDays);
    const reviewerAll = [...byType.values()].flatMap((row) => row.reviewerDays);
    return {
        periodLabel,
        startDate,
        endDate,
        projectKey: options.projectKey,
        totals: {
            opened,
            closed,
            netChange: opened - closed,
            stillOpen,
            onHold,
            underValidation,
        },
        byAuditType: [...byType.entries()]
            .map(([auditType, row]) => ({
            auditType,
            opened: row.opened,
            closed: row.closed,
            teamSlaAvgDays: average(row.teamDays),
            teamSlaCount: row.teamDays.length,
            reviewerSlaAvgDays: average(row.reviewerDays),
            reviewerSlaCount: row.reviewerDays.length,
        }))
            .sort((a, b) => (b.opened + b.closed) - (a.opened + a.closed) || a.auditType.localeCompare(b.auditType)),
        teamSlaOverall: { avgDays: average(teamAll), count: teamAll.length, targetDays: teamTarget },
        reviewerSlaOverall: { avgDays: average(reviewerAll), count: reviewerAll.length, targetDays: reviewerTarget },
        topBreaches: breaches.sort((a, b) => b.slaDays - a.slaDays).slice(0, 15),
        topApplications: [...appMap.entries()]
            .map(([name, row]) => ({ name, ...row }))
            .sort((a, b) => (b.opened + b.closed) - (a.opened + a.closed))
            .slice(0, 10),
    };
}
function monthlyReportSubject(report) {
    const project = report.projectKey ? ` · ${report.projectKey}` : '';
    return `SRE Audit Monthly Report — ${report.periodLabel}${project}`;
}
function monthlyReportIntro(report) {
    const net = report.totals.netChange;
    const netText = net === 0
        ? 'opened and closed volumes were balanced'
        : net > 0
            ? `backlog grew by ${net} ticket${net === 1 ? '' : 's'}`
            : `backlog shrank by ${Math.abs(net)} ticket${Math.abs(net) === 1 ? '' : 's'}`;
    const teamSla = report.teamSlaOverall.avgDays == null
        ? 'Team SLA had no completed Approved→Under Validation transitions'
        : `Team SLA averaged ${report.teamSlaOverall.avgDays}d across ${report.teamSlaOverall.count} completed handoff${report.teamSlaOverall.count === 1 ? '' : 's'} (target ${report.teamSlaOverall.targetDays}d)`;
    const reviewerSla = report.reviewerSlaOverall.avgDays == null
        ? 'Reviewer SLA had no completed Under Validation→Done transitions'
        : `Reviewer SLA averaged ${report.reviewerSlaOverall.avgDays}d across ${report.reviewerSlaOverall.count} completion${report.reviewerSlaOverall.count === 1 ? '' : 's'} (target ${report.reviewerSlaOverall.targetDays}d)`;
    return [
        `This is the SRE Audit monthly summary for ${report.periodLabel}${report.projectKey ? ` (${report.projectKey})` : ''}.`,
        `In this period we opened ${report.totals.opened} ticket${report.totals.opened === 1 ? '' : 's'} and closed ${report.totals.closed}, so ${netText}.`,
        `${teamSla}. ${reviewerSla}.`,
        report.topBreaches.length
            ? `${report.topBreaches.length} open ticket${report.topBreaches.length === 1 ? '' : 's'} currently sit outside the usual SLA window and are listed below for follow-up.`
            : 'No open tickets are currently outside the usual team/reviewer SLA windows.',
    ].join(' ');
}
