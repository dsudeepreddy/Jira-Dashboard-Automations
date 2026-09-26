import * as XLSX from 'xlsx';
import {
  aggregateDashboardMetrics,
  type AnalyticsIssue,
} from '../shared/analytics';
import type { DashboardIssue, DashboardPayload } from '../shared/dashboardContract';
import type { MonthlyReport } from '../shared/monthlyReport';

function sheetName(raw: string, used: Set<string>): string {
  let base = raw.replace(/[\\/?*[\]:]/g, ' ').replace(/\s+/g, ' ').trim() || 'Sheet';
  if (base.length > 28) base = base.slice(0, 28).trim();
  let name = base;
  let n = 2;
  while (used.has(name.toLowerCase())) {
    const suffix = ` (${n})`;
    name = `${base.slice(0, Math.max(1, 31 - suffix.length))}${suffix}`;
    n += 1;
  }
  used.add(name.toLowerCase());
  return name;
}

function dayKey(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function inMonth(day: string | null, startDate: string, endDate: string): boolean {
  return Boolean(day && day >= startDate && day <= endDate);
}

function joinList(values?: string[] | null) {
  return (values || []).filter(Boolean).join(', ');
}

/** Issues opened or closed in the report month (same scope as the email narrative). */
export function filterIssuesForReportMonth(issues: AnalyticsIssue[], report: MonthlyReport): AnalyticsIssue[] {
  return issues.filter((issue) => {
    const created = dayKey(issue.created);
    const resolved = dayKey(issue.resolved || issue.doneAt);
    return inMonth(created, report.startDate, report.endDate)
      || inMonth(resolved, report.startDate, report.endDate);
  });
}

function toDashboardIssue(issue: AnalyticsIssue): DashboardIssue {
  return {
    id: issue.id,
    key: issue.key,
    summary: issue.summary,
    status: issue.status,
    created: issue.created,
    updated: issue.updated,
    resolved: issue.resolved || issue.doneAt || null,
    issuetype: issue.issueType ? { name: issue.issueType } : undefined,
    project: issue.projectKey ? { key: issue.projectKey } : undefined,
    assignee: issue.assignee,
    storyPoints: issue.storyPoints,
    flagged: issue.flagged,
    auditType: issue.auditType || [],
    application: issue.application || [],
    licenseBu: issue.licenseBu || [],
    epicKey: issue.epicKey || null,
    epicName: issue.epicName || null,
    teamSlaDays: issue.teamSlaDays ?? null,
    reviewerSlaDays: issue.reviewerSlaDays ?? null,
    validationDays: issue.validationDays,
  };
}

function issueRows(issues: DashboardIssue[]) {
  return issues.map((issue) => ({
    Key: issue.key,
    Summary: issue.summary,
    Status: issue.status || '',
    Assignee: issue.assignee || 'Unassigned',
    'Audit Type': joinList(issue.auditType),
    Application: joinList(issue.application),
    'License/BU': joinList(issue.licenseBu),
    Epic: issue.epicName || issue.epicKey || '',
    Flagged: issue.flagged ? 'Yes' : 'No',
    'Story points': issue.storyPoints ?? '',
    Created: issue.created?.slice(0, 10) || '',
    Updated: issue.updated?.slice(0, 10) || '',
    Resolved: issue.resolved?.slice(0, 10) || '',
    'Team SLA days': issue.teamSlaDays ?? '',
    'Reviewer SLA days': issue.reviewerSlaDays ?? '',
  }));
}

function statusCounts(issues: DashboardIssue[]) {
  const map = new Map<string, number>();
  issues.forEach((issue) => {
    const status = issue.status || 'Unknown';
    map.set(status, (map.get(status) || 0) + 1);
  });
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([status, count]) => ({ Status: status, Count: count }));
}

function aoaToSheet(rows: Array<Array<string | number>>) {
  return XLSX.utils.aoa_to_sheet(rows);
}

function appendSection(sheet: XLSX.WorkSheet, startRow: number, title: string, rows: Record<string, string | number>[]) {
  const titleCell = XLSX.utils.encode_cell({ r: startRow, c: 0 });
  sheet[titleCell] = { t: 's', v: title };
  if (!rows.length) {
    const empty = XLSX.utils.encode_cell({ r: startRow + 1, c: 0 });
    sheet[empty] = { t: 's', v: '(none)' };
    return startRow + 3;
  }
  XLSX.utils.sheet_add_json(sheet, rows, { origin: startRow + 1, skipHeader: false });
  return startRow + 1 + rows.length + 2;
}

/**
 * Same workbook layout as the dashboard Excel export, scoped to issues
 * opened or closed in the monthly report period.
 */
export function buildMonthlyReportWorkbookBuffer(
  report: MonthlyReport,
  issues: AnalyticsIssue[],
): { filename: string; content: Buffer; contentType: string } {
  const monthIssues = filterIssuesForReportMonth(issues, report);
  const metrics = aggregateDashboardMetrics(monthIssues, [], {
    projectKey: report.projectKey,
  });
  // Month-activity set for ticket sheets (opened or closed in-period).
  const exportIssues = monthIssues.map(toDashboardIssue);
  const insights = metrics.auditInsights;
  const filters: DashboardPayload['filters'] = {
    projectKey: report.projectKey,
    startDate: report.startDate,
    endDate: report.endDate,
  };

  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const ym = report.startDate.slice(0, 7);

  const summaryRows: Array<Array<string | number>> = [
    ['SRE Audit monthly export'],
    ['Period', report.periodLabel],
    ['Generated', new Date().toISOString()],
    ['Project', filters.projectKey || 'All'],
    ['Month from', report.startDate],
    ['Month to', report.endDate],
    ['Scope', 'Tickets opened or closed in this month'],
    [],
    ['Monthly KPIs', 'Value'],
    ['Opened (month)', report.totals.opened],
    ['Closed (month)', report.totals.closed],
    ['Net change', report.totals.netChange],
    ['Still open (current)', report.totals.stillOpen],
    ['On hold', report.totals.onHold],
    ['Under validation', report.totals.underValidation],
    ['Team SLA avg (days)', report.teamSlaOverall.avgDays ?? ''],
    ['Reviewer SLA avg (days)', report.reviewerSlaOverall.avgDays ?? ''],
    [],
    ['Dashboard-style KPIs (month activity set)', 'Value'],
    ['Total issues in export', exportIssues.length],
    ['Open issues', metrics.openIssues],
    ['Done issues', metrics.doneCount],
    ['Completion rate %', metrics.completionRate],
    ['Avg lead time (days)', metrics.avgLeadTimeDays],
    ['Monthly throughput', metrics.avgMonthlyThroughput],
    [],
    ['Work by audit type', 'Count', 'Open', 'Done', 'Done %'],
    ...(insights?.workByAuditType || []).map((row) => [
      row.name,
      row.count,
      row.openCount,
      row.doneCount,
      row.completionRate,
    ]),
    [],
    ['Team SLA by audit type', 'Avg days', 'Count'],
    ...(insights?.teamSlaByAuditType || []).map((row) => [row.auditType, row.avgDays, row.count]),
    [],
    ['Reviewer SLA by audit type', 'Avg days', 'Count'],
    ...(insights?.reviewerSlaByAuditType || []).map((row) => [row.auditType, row.avgDays, row.count]),
    [],
    ['Opened / closed by audit type (month)', 'Opened', 'Closed', 'Team SLA', 'Reviewer SLA'],
    ...report.byAuditType.map((row) => [
      row.auditType,
      row.opened,
      row.closed,
      row.teamSlaAvgDays ?? '',
      row.reviewerSlaAvgDays ?? '',
    ]),
  ];
  XLSX.utils.book_append_sheet(wb, aoaToSheet(summaryRows), sheetName('Summary', usedNames));

  const byType = new Map<string, DashboardIssue[]>();
  const uncategorized: DashboardIssue[] = [];
  exportIssues.forEach((issue) => {
    const types = (issue.auditType || []).map((value) => value.trim()).filter(Boolean);
    if (!types.length) {
      uncategorized.push(issue);
      return;
    }
    types.forEach((type) => {
      const list = byType.get(type) || [];
      list.push(issue);
      byType.set(type, list);
    });
  });

  const typeNames = [...byType.keys()].sort((a, b) => a.localeCompare(b));
  for (const type of typeNames) {
    const typeIssues = byType.get(type) || [];
    const teamSla = insights?.teamSlaByAuditType.find((row) => row.auditType === type);
    const reviewerSla = insights?.reviewerSlaByAuditType.find((row) => row.auditType === type);
    const stage = insights?.statusByAuditType.find((row) => row.auditType === type);
    const monthType = report.byAuditType.find((row) => row.auditType === type);
    const sheet = XLSX.utils.aoa_to_sheet([
      [`Audit type: ${type}`],
      ['Period', report.periodLabel],
      ['Tickets in month export', typeIssues.length],
      ['Opened this month', monthType?.opened ?? ''],
      ['Closed this month', monthType?.closed ?? ''],
      ['Open (current status)', typeIssues.filter((issue) => !issue.resolved).length],
      ['Team SLA avg (days)', teamSla?.avgDays ?? monthType?.teamSlaAvgDays ?? ''],
      ['Reviewer SLA avg (days)', reviewerSla?.avgDays ?? monthType?.reviewerSlaAvgDays ?? ''],
      [],
    ]);
    let nextRow = 9;
    nextRow = appendSection(
      sheet,
      nextRow,
      'Status counts',
      stage?.stages?.length
        ? stage.stages.map((row) => ({ Status: row.name, Count: row.value }))
        : statusCounts(typeIssues),
    );
    nextRow = appendSection(sheet, nextRow, 'Tickets', issueRows(typeIssues));
    const ref = sheet['!ref'] || 'A1';
    const range = XLSX.utils.decode_range(ref);
    range.e.r = Math.max(range.e.r, nextRow);
    sheet['!ref'] = XLSX.utils.encode_range(range);
    XLSX.utils.book_append_sheet(wb, sheet, sheetName(type, usedNames));
  }

  if (uncategorized.length) {
    const sheet = XLSX.utils.aoa_to_sheet([
      ['Uncategorized (no Audit Type)'],
      ['Period', report.periodLabel],
      ['Tickets', uncategorized.length],
      [],
    ]);
    appendSection(sheet, 4, 'Tickets', issueRows(uncategorized));
    XLSX.utils.book_append_sheet(wb, sheet, sheetName('Uncategorized', usedNames));
  }

  if (report.topBreaches.length) {
    XLSX.utils.book_append_sheet(
      wb,
      XLSX.utils.json_to_sheet(report.topBreaches.map((row) => ({
        Key: row.key,
        Summary: row.summary,
        Kind: row.kind === 'team' ? 'Team' : 'Reviewer',
        Status: row.status,
        Assignee: row.assignee || 'Unassigned',
        'Audit types': row.auditTypes.join(', '),
        'Elapsed days': row.slaDays,
        'Target days': row.targetDays,
      }))),
      sheetName('SLA breaches', usedNames),
    );
  }

  const content = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return {
    filename: `sre-audit-monthly-${ym}.xlsx`,
    content,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
