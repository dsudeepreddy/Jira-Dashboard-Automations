import * as XLSX from 'xlsx';
import type { AnalyticsIssue } from '../shared/analytics';
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

function joinList(values?: Array<string | null | undefined>) {
  return (values || []).map((value) => (value || '').trim()).filter(Boolean).join(', ');
}

function issueRow(issue: AnalyticsIssue) {
  return {
    Key: issue.key,
    Summary: issue.summary,
    Status: issue.status || '',
    Assignee: issue.assignee || 'Unassigned',
    'Audit Type': joinList(issue.auditType),
    Application: joinList(issue.application),
    'License/BU': joinList(issue.licenseBu),
    Created: issue.created?.slice(0, 10) || '',
    Updated: issue.updated?.slice(0, 10) || '',
    Resolved: (issue.resolved || issue.doneAt)?.slice(0, 10) || '',
    'Team SLA days': issue.teamSlaDays ?? '',
    'Reviewer SLA days': issue.reviewerSlaDays ?? '',
  };
}

/** Build an .xlsx buffer for the monthly report email attachment. */
export function buildMonthlyReportWorkbookBuffer(
  report: MonthlyReport,
  issues: AnalyticsIssue[],
): { filename: string; content: Buffer; contentType: string } {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const ym = report.startDate.slice(0, 7);

  const summary = [
    ['SRE Audit monthly report'],
    ['Period', report.periodLabel],
    ['Start', report.startDate],
    ['End', report.endDate],
    ['Project', report.projectKey || 'All'],
    ['Generated', new Date().toISOString()],
    [],
    ['KPI', 'Value'],
    ['Opened', report.totals.opened],
    ['Closed', report.totals.closed],
    ['Net change', report.totals.netChange],
    ['Still open', report.totals.stillOpen],
    ['On hold', report.totals.onHold],
    ['Under validation', report.totals.underValidation],
    ['Team SLA avg (days)', report.teamSlaOverall.avgDays ?? ''],
    ['Team SLA samples', report.teamSlaOverall.count],
    ['Reviewer SLA avg (days)', report.reviewerSlaOverall.avgDays ?? ''],
    ['Reviewer SLA samples', report.reviewerSlaOverall.count],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), sheetName('Summary', used));

  const byType = report.byAuditType.map((row) => ({
    'Audit type': row.auditType,
    Opened: row.opened,
    Closed: row.closed,
    'Team SLA avg (days)': row.teamSlaAvgDays ?? '',
    'Team SLA samples': row.teamSlaCount,
    'Reviewer SLA avg (days)': row.reviewerSlaAvgDays ?? '',
    'Reviewer SLA samples': row.reviewerSlaCount,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    byType.length ? XLSX.utils.json_to_sheet(byType) : XLSX.utils.aoa_to_sheet([['No audit-type activity']]),
    sheetName('By audit type', used),
  );

  const apps = report.topApplications.map((row) => ({
    Application: row.name,
    Opened: row.opened,
    Closed: row.closed,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    apps.length ? XLSX.utils.json_to_sheet(apps) : XLSX.utils.aoa_to_sheet([['No application activity']]),
    sheetName('Applications', used),
  );

  const breaches = report.topBreaches.map((row) => ({
    Key: row.key,
    Summary: row.summary,
    Kind: row.kind === 'team' ? 'Team' : 'Reviewer',
    Status: row.status,
    Assignee: row.assignee || 'Unassigned',
    'Audit types': row.auditTypes.join(', '),
    'Elapsed days': row.slaDays,
    'Target days': row.targetDays,
  }));
  XLSX.utils.book_append_sheet(
    wb,
    breaches.length ? XLSX.utils.json_to_sheet(breaches) : XLSX.utils.aoa_to_sheet([['No open SLA breaches']]),
    sheetName('SLA breaches', used),
  );

  const monthIssues = issues.filter((issue) => {
    const created = dayKey(issue.created);
    const resolved = dayKey(issue.resolved || issue.doneAt);
    return inMonth(created, report.startDate, report.endDate)
      || inMonth(resolved, report.startDate, report.endDate);
  });
  XLSX.utils.book_append_sheet(
    wb,
    monthIssues.length
      ? XLSX.utils.json_to_sheet(monthIssues.map(issueRow))
      : XLSX.utils.aoa_to_sheet([['No tickets opened or closed in this month']]),
    sheetName('Tickets', used),
  );

  const content = Buffer.from(XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  return {
    filename: `sre-audit-monthly-${ym}.xlsx`,
    content,
    contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  };
}
