import * as XLSX from 'xlsx';
import type { DashboardIssue, DashboardPayload } from '@/shared/dashboardContract';
import {
  COMPLIANCE_SLA_LABEL,
  SRE_AUDIT_TEAM_SLA_LABEL,
} from '@/shared/slaLabels';

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

function joinList(values?: string[] | null) {
  return (values || []).filter(Boolean).join(', ');
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
    [`${SRE_AUDIT_TEAM_SLA_LABEL} days`]: issue.teamSlaDays ?? '',
    [`${COMPLIANCE_SLA_LABEL} days`]: issue.reviewerSlaDays ?? '',
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

export function buildAuditWorkbook(payload: DashboardPayload, issues: DashboardIssue[]) {
  const wb = XLSX.utils.book_new();
  const usedNames = new Set<string>();
  const filters = payload.filters || {};
  const metrics = payload.metrics;
  const insights = metrics.auditInsights;

  const summaryRows: Array<Array<string | number>> = [
    ['SRE Audit export'],
    ['Generated', new Date().toISOString()],
    ['Project', filters.projectKey || 'All'],
    ['Epic', filters.epicKey || 'All'],
    ['License/BU', filters.licenseBu || 'All'],
    ['Audit type filter', filters.auditType || 'All'],
    ['Application', filters.application || 'All'],
    ['Created from', filters.startDate || ''],
    ['Created to', filters.endDate || ''],
    [],
    ['KPI', 'Value'],
    ['Total issues', metrics.totalIssues],
    ['Open issues', metrics.openIssues],
    ['Completion rate %', metrics.completionRate],
    ['Blocked', metrics.blockedCount],
    ['Avg lead time (days)', metrics.avgLeadTimeDays],
    ['Monthly throughput', metrics.avgMonthlyThroughput ?? metrics.avgWeeklyThroughput],
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
    [`${SRE_AUDIT_TEAM_SLA_LABEL} by audit type`, 'Avg days', 'Count'],
    ...(insights?.teamSlaByAuditType || []).map((row) => [row.auditType, row.avgDays, row.count]),
    [],
    [`${COMPLIANCE_SLA_LABEL} by audit type`, 'Avg days', 'Count'],
    ...(insights?.reviewerSlaByAuditType || []).map((row) => [row.auditType, row.avgDays, row.count]),
  ];
  XLSX.utils.book_append_sheet(wb, aoaToSheet(summaryRows), sheetName('Summary', usedNames));

  const byType = new Map<string, DashboardIssue[]>();
  const uncategorized: DashboardIssue[] = [];
  issues.forEach((issue) => {
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
    const sheet = XLSX.utils.aoa_to_sheet([
      [`Audit type: ${type}`],
      ['Tickets', typeIssues.length],
      ['Open', typeIssues.filter((issue) => !issue.resolved).length],
      [`${SRE_AUDIT_TEAM_SLA_LABEL} avg (days)`, teamSla?.avgDays ?? ''],
      [`${SRE_AUDIT_TEAM_SLA_LABEL} samples`, teamSla?.count ?? ''],
      [`${COMPLIANCE_SLA_LABEL} avg (days)`, reviewerSla?.avgDays ?? ''],
      [`${COMPLIANCE_SLA_LABEL} samples`, reviewerSla?.count ?? ''],
      [],
    ]);
    let nextRow = 8;
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
    const sheet = XLSX.utils.aoa_to_sheet([['Uncategorized (no Audit Type)'], ['Tickets', uncategorized.length], []]);
    appendSection(sheet, 3, 'Tickets', issueRows(uncategorized));
    XLSX.utils.book_append_sheet(wb, sheet, sheetName('Uncategorized', usedNames));
  }

  return wb;
}

export function downloadAuditWorkbook(payload: DashboardPayload, issues: DashboardIssue[]) {
  const wb = buildAuditWorkbook(payload, issues);
  const date = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `sre-audit-export-${date}.xlsx`);
}
