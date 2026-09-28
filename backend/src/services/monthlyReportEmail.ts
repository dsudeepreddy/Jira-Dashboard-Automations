import {
  COMPLIANCE_SLA_LABEL,
  SRE_AUDIT_TEAM_SLA_LABEL,
  slaKindLabel,
} from '../shared/slaLabels';
import type { MonthlyReport } from '../shared/monthlyReport';
import { monthlyReportIntro, monthlyReportSubject } from '../shared/monthlyReport';
import { ATLASSIAN_BROWSE_BASE_URL } from '../shared/dashboardContract';

const COLORS = {
  opened: '#0891b2',
  closed: '#7c3aed',
  team: '#f59e0b',
  reviewer: '#10b981',
  progress: '#f97316',
  validation: '#a855f7',
  apps: '#0ea5e9',
  types: '#6366f1',
  headerFrom: '#0e7490',
  headerTo: '#6d28d9',
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function detailButton(dashboardUrl: string | undefined, hash: string): string {
  if (!dashboardUrl) return '';
  const href = `${dashboardUrl.replace(/\/$/, '')}${hash.startsWith('#') ? hash : `#${hash}`}`;
  return `<a href="${escapeHtml(href)}" style="display:inline-block;margin-left:10px;padding:3px 10px;border-radius:999px;border:1px solid #67e8f9;background:#ecfeff;color:#0e7490;font-size:11px;font-weight:700;text-decoration:none;vertical-align:middle;">Details</a>`;
}

function metricCard(
  label: string,
  value: string,
  accent: string,
  tint: string,
  dashboardUrl?: string,
  hash?: string,
): string {
  return `
    <td style="padding:6px;width:25%;vertical-align:top;">
      <div style="border:1px solid ${accent}33;border-radius:14px;padding:14px 12px;background:${tint};">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${accent};font-weight:700;">
          ${escapeHtml(label)}${hash ? detailButton(dashboardUrl, hash) : ''}
        </div>
        <div style="margin-top:8px;font-size:24px;font-weight:700;color:#0f172a;">${escapeHtml(value)}</div>
      </div>
    </td>`;
}

function legendChip(label: string, color: string): string {
  return `<span style="display:inline-block;margin-right:12px;font-size:12px;color:#475569;">
    <span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${color};margin-right:6px;vertical-align:middle;"></span>${escapeHtml(label)}
  </span>`;
}

function sectionTitle(title: string, subtitle?: string, dashboardUrl?: string, hash?: string): string {
  return `
    <tr>
      <td style="padding:18px 28px 6px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;">
          ${escapeHtml(title)}${hash ? detailButton(dashboardUrl, hash) : ''}
        </div>
        ${subtitle ? `<div style="margin-top:4px;font-size:12px;color:#64748b;">${escapeHtml(subtitle)}</div>` : ''}
      </td>
    </tr>`;
}

/** Combined opened + closed on one line; hover (title) shows counts. */
function combinedOpenedClosedChart(
  rows: Array<{ label: string; opened: number; closed: number }>,
  emptyLabel: string,
): string {
  if (!rows.length) {
    return `<div style="padding:16px;color:#64748b;font-size:13px;">${escapeHtml(emptyLabel)}</div>`;
  }
  const max = Math.max(1, ...rows.flatMap((row) => [row.opened + row.closed]));
  const body = rows.map((row) => {
    const openPct = Math.max(row.opened ? 3 : 0, Math.round((row.opened / max) * 100));
    const closedPct = Math.max(row.closed ? 3 : 0, Math.round((row.closed / max) * 100));
    const tip = `Opened: ${row.opened} · Closed: ${row.closed}`;
    return `
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:600;color:#334155;width:28%;vertical-align:middle;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0;width:72%;" title="${escapeHtml(tip)}">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" title="${escapeHtml(tip)}">
            <tr>
              <td style="width:${openPct}%;background:${COLORS.opened};height:14px;border-radius:6px 0 0 6px;" title="Opened: ${row.opened}"></td>
              <td style="width:${closedPct}%;background:${COLORS.closed};height:14px;border-radius:0 6px 6px 0;" title="Closed: ${row.closed}"></td>
              <td></td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:14px;background:#ffffff;padding:12px 14px;">
      <tr><td style="padding-bottom:8px;">${legendChip('Opened', COLORS.opened)}${legendChip('Closed', COLORS.closed)}</td></tr>
      ${body}
    </table>`;
}

/** Combined SRE Audit Team + Compliance SLA averages by audit type. */
function combinedSlaChart(
  rows: Array<{ label: string; teamDays: number | null; reviewerDays: number | null }>,
  emptyLabel: string,
): string {
  const usable = rows.filter((row) => row.teamDays != null || row.reviewerDays != null);
  if (!usable.length) {
    return `<div style="padding:16px;color:#64748b;font-size:13px;">${escapeHtml(emptyLabel)}</div>`;
  }
  const max = Math.max(
    1,
    ...usable.flatMap((row) => [row.teamDays || 0, row.reviewerDays || 0]),
  );
  const body = usable.map((row) => {
    const team = row.teamDays;
    const reviewer = row.reviewerDays;
    const teamPct = Math.max(team ? 4 : 0, Math.round(((team || 0) / max) * 100));
    const reviewerPct = Math.max(reviewer ? 4 : 0, Math.round(((reviewer || 0) / max) * 100));
    const tip = `${SRE_AUDIT_TEAM_SLA_LABEL}: ${team == null ? 'n/a' : `${team}d`} · ${COMPLIANCE_SLA_LABEL}: ${reviewer == null ? 'n/a' : `${reviewer}d`}`;
    return `
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:600;color:#334155;width:26%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0;width:74%;" title="${escapeHtml(tip)}">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:4px;">
            <tr>
              <td style="width:${teamPct}%;background:${COLORS.team};height:10px;border-radius:5px;" title="${escapeHtml(`${SRE_AUDIT_TEAM_SLA_LABEL}: ${team == null ? 'n/a' : `${team}d`}`)}"></td>
              <td style="padding-left:8px;font-size:11px;color:#b45309;white-space:nowrap;">${team == null ? '—' : `${team}d`}</td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0;">
            <tr>
              <td style="width:${reviewerPct}%;background:${COLORS.reviewer};height:10px;border-radius:5px;" title="${escapeHtml(`${COMPLIANCE_SLA_LABEL}: ${reviewer == null ? 'n/a' : `${reviewer}d`}`)}"></td>
              <td style="padding-left:8px;font-size:11px;color:#047857;white-space:nowrap;">${reviewer == null ? '—' : `${reviewer}d`}</td>
            </tr>
          </table>
        </td>
      </tr>`;
  }).join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:14px;background:#ffffff;padding:12px 14px;">
      <tr><td style="padding-bottom:8px;">${legendChip(SRE_AUDIT_TEAM_SLA_LABEL, COLORS.team)}${legendChip(COMPLIANCE_SLA_LABEL, COLORS.reviewer)}</td></tr>
      ${body}
    </table>`;
}

function breachList(report: MonthlyReport, dashboardUrl?: string): string {
  const browse = ATLASSIAN_BROWSE_BASE_URL;
  if (!report.topBreaches.length) {
    return `<div style="padding:16px;border:1px solid #bbf7d0;border-radius:14px;background:#f0fdf4;color:#166534;font-size:13px;">No open tickets outside usual SLA.${detailButton(dashboardUrl, '#outside-sla')}</div>`;
  }
  const rows = report.topBreaches.slice(0, 10).map((row) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-family:ui-monospace,Menlo,monospace;font-size:12px;">
        <a href="${browse}/${encodeURIComponent(row.key)}" style="color:#0891b2;text-decoration:none;">${escapeHtml(row.key)}</a>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:12px;color:#334155;">${escapeHtml(row.summary.slice(0, 64))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:11px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${row.kind === 'team' ? '#fff7ed' : '#ecfdf5'};color:${row.kind === 'team' ? '#c2410c' : '#047857'};font-weight:600;">
          ${slaKindLabel(row.kind)}
        </span>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:12px;font-weight:700;color:#b91c1c;white-space:nowrap;">${row.slaDays}d / ${row.targetDays}d</td>
    </tr>`).join('');

  return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #fecaca;border-radius:14px;overflow:hidden;background:#fff7f7;">
      <tr style="background:#fef2f2;">
        <th style="text-align:left;padding:10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#b91c1c;">Key</th>
        <th style="text-align:left;padding:10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#b91c1c;">Summary</th>
        <th style="text-align:left;padding:10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#b91c1c;">SLA</th>
        <th style="text-align:left;padding:10px;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;color:#b91c1c;">Elapsed</th>
      </tr>
      ${rows}
    </table>`;
}

export function renderMonthlyReportEmail(report: MonthlyReport, dashboardUrl?: string): { subject: string; text: string; html: string } {
  const subject = monthlyReportSubject(report);
  const intro = monthlyReportIntro(report);

  const auditBars = combinedOpenedClosedChart(
    report.byAuditType.slice(0, 8).map((row) => ({
      label: row.auditType,
      opened: row.opened,
      closed: row.closed,
    })),
    'No audit-type activity in this month.',
  );

  const appBars = combinedOpenedClosedChart(
    report.topApplications.slice(0, 8).map((row) => ({
      label: row.name,
      opened: row.opened,
      closed: row.closed,
    })),
    'No application activity tagged this month.',
  );

  const slaBars = combinedSlaChart(
    report.byAuditType.slice(0, 8).map((row) => ({
      label: row.auditType,
      teamDays: row.teamSlaAvgDays,
      reviewerDays: row.reviewerSlaAvgDays,
    })),
    'No completed SLA handoffs this month.',
  );

  const openDashboard = dashboardUrl
    ? `
            <tr>
              <td style="padding:16px 28px 8px;">
                <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:linear-gradient(135deg,#0891b2,#7c3aed);color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:700;">Open Dashboard</a>
              </td>
            </tr>`
    : '';

  const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#e0f2fe;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(180deg,#cffafe 0%,#e9d5ff 45%,#f8fafc 100%);padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #a5f3fc;box-shadow:0 12px 40px rgba(14,116,144,0.12);">
            <tr>
              <td style="padding:26px 28px;background:linear-gradient(135deg,${COLORS.headerFrom},${COLORS.headerTo});color:#ffffff;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.9;">SRE Audit · Monthly Jira Report</div>
                <div style="margin-top:8px;font-size:26px;font-weight:700;">${escapeHtml(report.periodLabel)}</div>
                <div style="margin-top:6px;font-size:13px;opacity:0.9;">${escapeHtml(report.startDate)} → ${escapeHtml(report.endDate)}${report.projectKey ? ` · ${escapeHtml(report.projectKey)}` : ''}</div>
              </td>
            </tr>
            ${openDashboard}
            <tr>
              <td style="padding:18px 28px;color:#334155;font-size:14px;line-height:1.5;background:#f0f9ff;border-bottom:1px solid #e0f2fe;">
                ${escapeHtml(intro)}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 18px 4px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    ${metricCard('Opened', String(report.totals.opened), COLORS.opened, '#ecfeff', dashboardUrl, '#hero-kpis')}
                    ${metricCard('Closed', String(report.totals.closed), COLORS.closed, '#f5f3ff', dashboardUrl, '#hero-kpis')}
                    ${metricCard('In Progress', String(report.totals.inProgress), COLORS.progress, '#fff7ed', dashboardUrl, '#team-load')}
                    ${metricCard('Under Validation', String(report.totals.underValidation), COLORS.validation, '#faf5ff', dashboardUrl, '#hero-kpis')}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 18px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    ${metricCard('Total Applications', String(report.totals.uniqueApplications), COLORS.apps, '#f0f9ff', dashboardUrl, '#secondary-kpis')}
                    ${metricCard('Audit Types', String(report.totals.uniqueAuditTypes), COLORS.types, '#eef2ff', dashboardUrl, '#secondary-kpis')}
                    ${metricCard(`${SRE_AUDIT_TEAM_SLA_LABEL} avg`, report.teamSlaOverall.avgDays == null ? '—' : `${report.teamSlaOverall.avgDays}d`, COLORS.team, '#fffbeb', dashboardUrl, '#sla-metrics')}
                    ${metricCard(`${COMPLIANCE_SLA_LABEL} avg`, report.reviewerSlaOverall.avgDays == null ? '—' : `${report.reviewerSlaOverall.avgDays}d`, COLORS.reviewer, '#ecfdf5', dashboardUrl, '#sla-metrics')}
                  </tr>
                </table>
              </td>
            </tr>
            ${sectionTitle('Opened / Closed by Audit Type', undefined, dashboardUrl, '#work-by-audit-type')}
            <tr><td style="padding:8px 20px 12px;">${auditBars}</td></tr>
            ${sectionTitle('SLA Metrics by Audit Type', `${SRE_AUDIT_TEAM_SLA_LABEL} (Approved → Under Validation, ${report.teamSlaOverall.targetDays}d) · ${COMPLIANCE_SLA_LABEL} (Under Validation → Done, ${report.reviewerSlaOverall.targetDays}d)`, dashboardUrl, '#sla-metrics')}
            <tr><td style="padding:8px 20px 12px;">${slaBars}</td></tr>
            ${sectionTitle('Top Applications', 'Opened vs closed by application', dashboardUrl, '#secondary-kpis')}
            <tr><td style="padding:8px 20px 12px;">${appBars}</td></tr>
            ${sectionTitle('Outside Usual SLA', `${SRE_AUDIT_TEAM_SLA_LABEL} ${report.teamSlaOverall.targetDays}d · ${COMPLIANCE_SLA_LABEL} ${report.reviewerSlaOverall.targetDays}d`, dashboardUrl, '#outside-sla')}
            <tr><td style="padding:8px 20px 16px;">${breachList(report, dashboardUrl)}</td></tr>
            <tr>
              <td style="padding:0 28px 28px;font-size:12px;color:#64748b;">
                Full month detail is attached as Excel (same layout as the dashboard export, scoped to this month).
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;

  const text = [
    subject,
    '',
    intro,
    dashboardUrl ? `Open Dashboard: ${dashboardUrl}` : '',
    '',
    `Opened: ${report.totals.opened}`,
    `Closed: ${report.totals.closed}`,
    `In Progress: ${report.totals.inProgress}`,
    `Under Validation: ${report.totals.underValidation}`,
    `Total Applications: ${report.totals.uniqueApplications}`,
    `Audit Types: ${report.totals.uniqueAuditTypes}`,
    `${SRE_AUDIT_TEAM_SLA_LABEL} avg: ${report.teamSlaOverall.avgDays ?? 'n/a'}`,
    `${COMPLIANCE_SLA_LABEL} avg: ${report.reviewerSlaOverall.avgDays ?? 'n/a'}`,
    '',
    'By audit type:',
    ...report.byAuditType.map((row) => `- ${row.auditType}: opened ${row.opened}, closed ${row.closed}`),
    '',
    'Top applications:',
    ...report.topApplications.map((row) => `- ${row.name}: opened ${row.opened}, closed ${row.closed}`),
    '',
    'Open SLA breaches:',
    ...(report.topBreaches.length
      ? report.topBreaches.map((row) => `- ${row.key} [${row.kind}] ${row.slaDays}d/${row.targetDays}d — ${row.summary}`)
      : ['- none']),
  ].filter((line) => line !== undefined).join('\n');

  return { subject, text, html };
}
