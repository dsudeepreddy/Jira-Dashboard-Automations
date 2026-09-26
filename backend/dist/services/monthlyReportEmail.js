"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMonthlyReportEmail = renderMonthlyReportEmail;
const slaLabels_1 = require("../shared/slaLabels");
const monthlyReport_1 = require("../shared/monthlyReport");
const dashboardContract_1 = require("../shared/dashboardContract");
const COLORS = {
    opened: '#0891b2',
    closed: '#7c3aed',
    team: '#f59e0b',
    reviewer: '#10b981',
    hold: '#f97316',
    validation: '#a855f7',
    open: '#64748b',
    headerFrom: '#0e7490',
    headerTo: '#6d28d9',
};
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function metricCard(label, value, accent, tint) {
    return `
    <td style="padding:6px;width:25%;vertical-align:top;">
      <div style="border:1px solid ${accent}33;border-radius:14px;padding:14px 12px;background:${tint};">
        <div style="font-size:10px;letter-spacing:0.1em;text-transform:uppercase;color:${accent};font-weight:700;">${escapeHtml(label)}</div>
        <div style="margin-top:8px;font-size:24px;font-weight:700;color:#0f172a;">${escapeHtml(value)}</div>
      </div>
    </td>`;
}
function legendChip(label, color) {
    return `<span style="display:inline-block;margin-right:12px;font-size:12px;color:#475569;">
    <span style="display:inline-block;width:10px;height:10px;border-radius:999px;background:${color};margin-right:6px;vertical-align:middle;"></span>${escapeHtml(label)}
  </span>`;
}
function sectionTitle(title, subtitle) {
    return `
    <tr>
      <td style="padding:18px 28px 6px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;">${escapeHtml(title)}</div>
        ${subtitle ? `<div style="margin-top:4px;font-size:12px;color:#64748b;">${escapeHtml(subtitle)}</div>` : ''}
      </td>
    </tr>`;
}
/** Email-safe horizontal paired bars (Opened / Closed). */
function pairedBarChart(rows, emptyLabel) {
    if (!rows.length) {
        return `<div style="padding:16px;color:#64748b;font-size:13px;">${escapeHtml(emptyLabel)}</div>`;
    }
    const max = Math.max(1, ...rows.flatMap((row) => [row.opened, row.closed]));
    const body = rows.map((row) => {
        const openPct = Math.max(row.opened ? 4 : 0, Math.round((row.opened / max) * 100));
        const closedPct = Math.max(row.closed ? 4 : 0, Math.round((row.closed / max) * 100));
        return `
      <tr>
        <td style="padding:8px 0 4px;font-size:12px;font-weight:600;color:#334155;width:28%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0 4px;width:72%;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:4px;">
            <tr>
              <td style="width:${openPct}%;background:${COLORS.opened};height:12px;border-radius:6px;"></td>
              <td style="padding-left:8px;font-size:11px;color:#0891b2;white-space:nowrap;">${row.opened} opened</td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0;">
            <tr>
              <td style="width:${closedPct}%;background:${COLORS.closed};height:12px;border-radius:6px;"></td>
              <td style="padding-left:8px;font-size:11px;color:#7c3aed;white-space:nowrap;">${row.closed} closed</td>
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
/** Single-series horizontal bars (e.g. SLA days). */
function singleBarChart(rows, color, emptyLabel) {
    if (!rows.length) {
        return `<div style="padding:16px;color:#64748b;font-size:13px;">${escapeHtml(emptyLabel)}</div>`;
    }
    const max = Math.max(1, ...rows.map((row) => row.value));
    const body = rows.map((row) => {
        const pct = Math.max(row.value ? 4 : 0, Math.round((row.value / max) * 100));
        return `
      <tr>
        <td style="padding:7px 0;font-size:12px;font-weight:600;color:#334155;width:32%;">${escapeHtml(row.label)}</td>
        <td style="padding:7px 0;width:52%;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
            <tr><td style="width:${pct}%;background:${color};height:12px;border-radius:6px;"></td><td></td></tr>
          </table>
        </td>
        <td style="padding:7px 0 7px 8px;font-size:12px;color:#0f172a;font-weight:600;white-space:nowrap;text-align:right;">${row.value}${row.suffix || ''}</td>
      </tr>`;
    }).join('');
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:14px;background:#ffffff;padding:8px 14px;">
      ${body}
    </table>`;
}
function snapshotBars(report) {
    const rows = [
        { label: 'Still open', value: report.totals.stillOpen, color: COLORS.open },
        { label: 'On hold', value: report.totals.onHold, color: COLORS.hold },
        { label: 'Under validation', value: report.totals.underValidation, color: COLORS.validation },
        { label: 'Outside SLA', value: report.topBreaches.length, color: '#ef4444' },
    ].filter((row) => row.value > 0);
    if (!rows.length) {
        return `<div style="padding:16px;color:#64748b;font-size:13px;">No open-work snapshot for this month.</div>`;
    }
    const max = Math.max(1, ...rows.map((row) => row.value));
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:14px;background:#ffffff;padding:8px 14px;">
      ${rows.map((row) => {
        const pct = Math.max(4, Math.round((row.value / max) * 100));
        return `<tr>
          <td style="padding:7px 0;font-size:12px;font-weight:600;color:#334155;width:36%;">${escapeHtml(row.label)}</td>
          <td style="padding:7px 0;width:48%;">
            <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
              <tr><td style="width:${pct}%;background:${row.color};height:12px;border-radius:6px;"></td><td></td></tr>
            </table>
          </td>
          <td style="padding:7px 0 7px 8px;font-size:12px;font-weight:700;color:#0f172a;text-align:right;">${row.value}</td>
        </tr>`;
    }).join('')}
    </table>`;
}
function throughputCompare(report) {
    const max = Math.max(1, report.totals.opened, report.totals.closed);
    const openPct = Math.max(report.totals.opened ? 6 : 0, Math.round((report.totals.opened / max) * 100));
    const closedPct = Math.max(report.totals.closed ? 6 : 0, Math.round((report.totals.closed / max) * 100));
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:14px;background:linear-gradient(180deg,#ecfeff,#ffffff);padding:14px;">
      <tr><td style="padding-bottom:10px;">${legendChip('Opened', COLORS.opened)}${legendChip('Closed', COLORS.closed)}</td></tr>
      <tr>
        <td>
          <div style="font-size:12px;font-weight:600;color:#0891b2;margin-bottom:4px;">Opened · ${report.totals.opened}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td style="width:${openPct}%;background:${COLORS.opened};height:18px;border-radius:8px;"></td><td></td>
          </tr></table>
          <div style="font-size:12px;font-weight:600;color:#7c3aed;margin:12px 0 4px;">Closed · ${report.totals.closed}</div>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr>
            <td style="width:${closedPct}%;background:${COLORS.closed};height:18px;border-radius:8px;"></td><td></td>
          </tr></table>
        </td>
      </tr>
    </table>`;
}
function breachList(report) {
    const browse = dashboardContract_1.ATLASSIAN_BROWSE_BASE_URL;
    if (!report.topBreaches.length) {
        return `<div style="padding:16px;border:1px solid #bbf7d0;border-radius:14px;background:#f0fdf4;color:#166534;font-size:13px;">No open tickets outside usual SLA.</div>`;
    }
    const rows = report.topBreaches.slice(0, 10).map((row) => `
    <tr>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-family:ui-monospace,Menlo,monospace;font-size:12px;">
        <a href="${browse}/${encodeURIComponent(row.key)}" style="color:#0891b2;text-decoration:none;">${escapeHtml(row.key)}</a>
      </td>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:12px;color:#334155;">${escapeHtml(row.summary.slice(0, 64))}</td>
      <td style="padding:8px 10px;border-bottom:1px solid #fee2e2;font-size:11px;">
        <span style="display:inline-block;padding:2px 8px;border-radius:999px;background:${row.kind === 'team' ? '#fff7ed' : '#ecfdf5'};color:${row.kind === 'team' ? '#c2410c' : '#047857'};font-weight:600;">
          ${(0, slaLabels_1.slaKindLabel)(row.kind)}
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
function renderMonthlyReportEmail(report, dashboardUrl) {
    const subject = (0, monthlyReport_1.monthlyReportSubject)(report);
    const intro = (0, monthlyReport_1.monthlyReportIntro)(report);
    const auditBars = pairedBarChart(report.byAuditType.slice(0, 8).map((row) => ({
        label: row.auditType,
        opened: row.opened,
        closed: row.closed,
    })), 'No audit-type activity in this month.');
    const appBars = pairedBarChart(report.topApplications.slice(0, 8).map((row) => ({
        label: row.name,
        opened: row.opened,
        closed: row.closed,
    })), 'No application activity tagged this month.');
    const teamSlaBars = singleBarChart(report.byAuditType
        .filter((row) => row.teamSlaAvgDays != null)
        .slice(0, 8)
        .map((row) => ({ label: row.auditType, value: row.teamSlaAvgDays, suffix: 'd' })), COLORS.team, 'No completed SRE Audit Team SLA handoffs this month.');
    const reviewerSlaBars = singleBarChart(report.byAuditType
        .filter((row) => row.reviewerSlaAvgDays != null)
        .slice(0, 8)
        .map((row) => ({ label: row.auditType, value: row.reviewerSlaAvgDays, suffix: 'd' })), COLORS.reviewer, 'No completed Compliance SLA transitions this month.');
    const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#e0f2fe;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:linear-gradient(180deg,#cffafe 0%,#e9d5ff 45%,#f8fafc 100%);padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:18px;overflow:hidden;border:1px solid #a5f3fc;box-shadow:0 12px 40px rgba(14,116,144,0.12);">
            <tr>
              <td style="padding:26px 28px;background:linear-gradient(135deg,${COLORS.headerFrom},${COLORS.headerTo});color:#ffffff;">
                <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.9;">SRE Audit · Monthly</div>
                <div style="margin-top:8px;font-size:26px;font-weight:700;">${escapeHtml(report.periodLabel)}</div>
                <div style="margin-top:6px;font-size:13px;opacity:0.9;">${escapeHtml(report.startDate)} → ${escapeHtml(report.endDate)}${report.projectKey ? ` · ${escapeHtml(report.projectKey)}` : ''}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px;color:#334155;font-size:14px;line-height:1.5;background:#f0f9ff;border-bottom:1px solid #e0f2fe;">
                ${escapeHtml(intro)}
              </td>
            </tr>
            <tr>
              <td style="padding:16px 18px 4px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    ${metricCard('Opened', String(report.totals.opened), COLORS.opened, '#ecfeff')}
                    ${metricCard('Closed', String(report.totals.closed), COLORS.closed, '#f5f3ff')}
                    ${metricCard('Net', `${report.totals.netChange > 0 ? '+' : ''}${report.totals.netChange}`, report.totals.netChange > 0 ? '#ea580c' : '#059669', report.totals.netChange > 0 ? '#fff7ed' : '#ecfdf5')}
                    ${metricCard('Still open', String(report.totals.stillOpen), COLORS.open, '#f8fafc')}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 18px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    ${metricCard('On hold', String(report.totals.onHold), COLORS.hold, '#fff7ed')}
                    ${metricCard('Under validation', String(report.totals.underValidation), COLORS.validation, '#faf5ff')}
                    ${metricCard(`${slaLabels_1.SRE_AUDIT_TEAM_SLA_LABEL} avg`, report.teamSlaOverall.avgDays == null ? '—' : `${report.teamSlaOverall.avgDays}d`, COLORS.team, '#fffbeb')}
                    ${metricCard(`${slaLabels_1.COMPLIANCE_SLA_LABEL} avg`, report.reviewerSlaOverall.avgDays == null ? '—' : `${report.reviewerSlaOverall.avgDays}d`, COLORS.reviewer, '#ecfdf5')}
                  </tr>
                </table>
              </td>
            </tr>
            ${sectionTitle('Throughput this month', 'Opened vs closed overall')}
            <tr><td style="padding:8px 20px 12px;">${throughputCompare(report)}</td></tr>
            ${sectionTitle('Opened / closed by audit type')}
            <tr><td style="padding:8px 20px 12px;">${auditBars}</td></tr>
            ${sectionTitle('Top applications', 'Opened vs closed by application')}
            <tr><td style="padding:8px 20px 12px;">${appBars}</td></tr>
            ${sectionTitle(`${slaLabels_1.SRE_AUDIT_TEAM_SLA_LABEL} by audit type`, `Approved → Under Validation (target ${report.teamSlaOverall.targetDays}d)`)}
            <tr><td style="padding:8px 20px 12px;">${teamSlaBars}</td></tr>
            ${sectionTitle(`${slaLabels_1.COMPLIANCE_SLA_LABEL} by audit type`, `Under Validation → Done (target ${report.reviewerSlaOverall.targetDays}d)`)}
            <tr><td style="padding:8px 20px 12px;">${reviewerSlaBars}</td></tr>
            ${sectionTitle('Open work snapshot', 'Current open portfolio pressure')}
            <tr><td style="padding:8px 20px 12px;">${snapshotBars(report)}</td></tr>
            ${sectionTitle('Outside usual SLA', `${slaLabels_1.SRE_AUDIT_TEAM_SLA_LABEL} ${report.teamSlaOverall.targetDays}d · ${slaLabels_1.COMPLIANCE_SLA_LABEL} ${report.reviewerSlaOverall.targetDays}d`)}
            <tr><td style="padding:8px 20px 16px;">${breachList(report)}</td></tr>
            ${dashboardUrl ? `
            <tr>
              <td style="padding:4px 28px 12px;">
                <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:linear-gradient(135deg,#0891b2,#7c3aed);color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-size:13px;font-weight:700;">Open dashboard</a>
              </td>
            </tr>` : ''}
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
        '',
        `Opened: ${report.totals.opened}`,
        `Closed: ${report.totals.closed}`,
        `Net change: ${report.totals.netChange}`,
        `Still open: ${report.totals.stillOpen}`,
        `On hold: ${report.totals.onHold}`,
        `Under validation: ${report.totals.underValidation}`,
        `${slaLabels_1.SRE_AUDIT_TEAM_SLA_LABEL} avg: ${report.teamSlaOverall.avgDays ?? 'n/a'}`,
        `${slaLabels_1.COMPLIANCE_SLA_LABEL} avg: ${report.reviewerSlaOverall.avgDays ?? 'n/a'}`,
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
    ].join('\n');
    return { subject, text, html };
}
