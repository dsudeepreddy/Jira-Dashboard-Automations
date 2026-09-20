"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.renderMonthlyReportEmail = renderMonthlyReportEmail;
const monthlyReport_1 = require("../shared/monthlyReport");
const dashboardContract_1 = require("../shared/dashboardContract");
function escapeHtml(value) {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
function metricCard(label, value) {
    return `
    <td style="padding:8px;width:25%;">
      <div style="border:1px solid #e2e8f0;border-radius:12px;padding:14px 12px;background:#f8fafc;">
        <div style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#64748b;">${escapeHtml(label)}</div>
        <div style="margin-top:6px;font-size:22px;font-weight:600;color:#0f172a;">${escapeHtml(value)}</div>
      </div>
    </td>`;
}
function tableHeader(cells) {
    return `<tr>${cells.map((cell) => `<th style="text-align:left;padding:10px 12px;font-size:11px;text-transform:uppercase;letter-spacing:0.06em;color:#64748b;border-bottom:1px solid #e2e8f0;">${escapeHtml(cell)}</th>`).join('')}</tr>`;
}
function tableCell(value, mono = false) {
    return `<td style="padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#334155;${mono ? 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px;' : ''}">${value}</td>`;
}
function renderMonthlyReportEmail(report, dashboardUrl) {
    const subject = (0, monthlyReport_1.monthlyReportSubject)(report);
    const intro = (0, monthlyReport_1.monthlyReportIntro)(report);
    const browse = dashboardContract_1.ATLASSIAN_BROWSE_BASE_URL;
    const byTypeRows = report.byAuditType.length
        ? report.byAuditType.map((row) => `
      <tr>
        ${tableCell(escapeHtml(row.auditType))}
        ${tableCell(String(row.opened))}
        ${tableCell(String(row.closed))}
        ${tableCell(row.teamSlaAvgDays == null ? '—' : `${row.teamSlaAvgDays}d (${row.teamSlaCount})`)}
        ${tableCell(row.reviewerSlaAvgDays == null ? '—' : `${row.reviewerSlaAvgDays}d (${row.reviewerSlaCount})`)}
      </tr>`).join('')
        : `<tr>${tableCell('No audit-type activity in this month.', false)}</tr>`;
    const appRows = report.topApplications.length
        ? report.topApplications.map((row) => `
      <tr>
        ${tableCell(escapeHtml(row.name))}
        ${tableCell(String(row.opened))}
        ${tableCell(String(row.closed))}
      </tr>`).join('')
        : `<tr>${tableCell('No application activity tagged this month.')}</tr>`;
    const breachRows = report.topBreaches.length
        ? report.topBreaches.map((row) => `
      <tr>
        ${tableCell(`<a href="${browse}/${encodeURIComponent(row.key)}" style="color:#0891b2;text-decoration:none;">${escapeHtml(row.key)}</a>`, true)}
        ${tableCell(escapeHtml(row.summary.slice(0, 80)))}
        ${tableCell(row.kind === 'team' ? 'Team' : 'Reviewer')}
        ${tableCell(`${row.slaDays}d / ${row.targetDays}d`)}
        ${tableCell(escapeHtml(row.assignee || 'Unassigned'))}
      </tr>`).join('')
        : `<tr>${tableCell('No open SLA breaches right now.')}</tr>`;
    const html = `<!DOCTYPE html>
<html>
  <body style="margin:0;padding:0;background:#f1f5f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f1f5f9;padding:24px 12px;">
      <tr>
        <td align="center">
          <table role="presentation" width="680" cellspacing="0" cellpadding="0" style="max-width:680px;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #e2e8f0;">
            <tr>
              <td style="padding:24px 28px;background:linear-gradient(135deg,#0f172a,#155e75);color:#ffffff;">
                <div style="font-size:12px;letter-spacing:0.12em;text-transform:uppercase;opacity:0.8;">SRE Audit</div>
                <div style="margin-top:8px;font-size:24px;font-weight:600;">Monthly Report — ${escapeHtml(report.periodLabel)}</div>
                <div style="margin-top:6px;font-size:13px;opacity:0.85;">${escapeHtml(report.startDate)} → ${escapeHtml(report.endDate)}${report.projectKey ? ` · ${escapeHtml(report.projectKey)}` : ''}</div>
              </td>
            </tr>
            <tr>
              <td style="padding:22px 28px;color:#334155;font-size:14px;line-height:1.55;">
                ${escapeHtml(intro)}
              </td>
            </tr>
            <tr>
              <td style="padding:0 20px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    ${metricCard('Opened', String(report.totals.opened))}
                    ${metricCard('Closed', String(report.totals.closed))}
                    ${metricCard('Net change', `${report.totals.netChange > 0 ? '+' : ''}${report.totals.netChange}`)}
                    ${metricCard('Still open', String(report.totals.stillOpen))}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 20px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    ${metricCard('On hold', String(report.totals.onHold))}
                    ${metricCard('Under validation', String(report.totals.underValidation))}
                    ${metricCard('Team SLA avg', report.teamSlaOverall.avgDays == null ? '—' : `${report.teamSlaOverall.avgDays}d`)}
                    ${metricCard('Reviewer SLA avg', report.reviewerSlaOverall.avgDays == null ? '—' : `${report.reviewerSlaOverall.avgDays}d`)}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:18px 28px 8px;">
                <div style="font-size:16px;font-weight:600;color:#0f172a;">Opened / closed by audit type</div>
                <div style="margin-top:4px;font-size:12px;color:#64748b;">Plus team & reviewer SLA averages completed in this month.</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 20px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  ${tableHeader(['Audit type', 'Opened', 'Closed', 'Team SLA', 'Reviewer SLA'])}
                  ${byTypeRows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px;">
                <div style="font-size:16px;font-weight:600;color:#0f172a;">Top applications this month</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 20px 16px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  ${tableHeader(['Application', 'Opened', 'Closed'])}
                  ${appRows}
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 28px;">
                <div style="font-size:16px;font-weight:600;color:#0f172a;">Open tickets outside usual SLA</div>
                <div style="margin-top:4px;font-size:12px;color:#64748b;">Team target ${report.teamSlaOverall.targetDays}d · Reviewer target ${report.reviewerSlaOverall.targetDays}d</div>
              </td>
            </tr>
            <tr>
              <td style="padding:8px 20px 20px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
                  ${tableHeader(['Key', 'Summary', 'SLA', 'Elapsed', 'Assignee'])}
                  ${breachRows}
                </table>
              </td>
            </tr>
            ${dashboardUrl ? `
            <tr>
              <td style="padding:8px 28px 28px;">
                <a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:#0891b2;color:#ffffff;text-decoration:none;padding:10px 16px;border-radius:10px;font-size:13px;font-weight:600;">Open dashboard</a>
              </td>
            </tr>` : ''}
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
        `Team SLA avg: ${report.teamSlaOverall.avgDays ?? 'n/a'} (${report.teamSlaOverall.count})`,
        `Reviewer SLA avg: ${report.reviewerSlaOverall.avgDays ?? 'n/a'} (${report.reviewerSlaOverall.count})`,
        '',
        'By audit type:',
        ...report.byAuditType.map((row) => `- ${row.auditType}: opened ${row.opened}, closed ${row.closed}, team SLA ${row.teamSlaAvgDays ?? 'n/a'}, reviewer SLA ${row.reviewerSlaAvgDays ?? 'n/a'}`),
        '',
        'Open SLA breaches:',
        ...(report.topBreaches.length
            ? report.topBreaches.map((row) => `- ${row.key} [${row.kind}] ${row.slaDays}d/${row.targetDays}d — ${row.summary}`)
            : ['- none']),
    ].join('\n');
    return { subject, text, html };
}
