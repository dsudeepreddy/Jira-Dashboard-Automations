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
    progress: '#f97316',
    validation: '#a855f7',
    apps: '#0ea5e9',
    types: '#6366f1',
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
/** Compact deep-link glyph (email-safe) — opens the matching dashboard section. */
function detailLink(dashboardUrl, hash) {
    if (!dashboardUrl)
        return '';
    const href = `${dashboardUrl.replace(/\/$/, '')}${hash.startsWith('#') ? hash : `#${hash}`}`;
    return `<a href="${escapeHtml(href)}" title="Open this section in the dashboard" style="display:inline-block;margin-left:8px;width:20px;height:20px;line-height:20px;text-align:center;border-radius:999px;border:1px solid #a5f3fc;background:#ecfeff;color:#0e7490;font-size:12px;font-weight:700;text-decoration:none;vertical-align:middle;">↗</a>`;
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
function sectionTitle(title, subtitle, dashboardUrl, hash) {
    return `
    <tr>
      <td style="padding:18px 28px 6px;">
        <div style="font-size:16px;font-weight:700;color:#0f172a;">
          ${escapeHtml(title)}${hash ? detailLink(dashboardUrl, hash) : ''}
        </div>
        ${subtitle ? `<div style="margin-top:4px;font-size:12px;color:#64748b;">${escapeHtml(subtitle)}</div>` : ''}
      </td>
    </tr>`;
}
/**
 * Dual-series horizontal bars (same layout as SLA Metrics):
 * one row label, then series A bar + value, then series B bar + value.
 */
function dualSeriesChart(rows, options) {
    const usable = rows.filter((row) => row.primary != null || row.secondary != null);
    if (!usable.length) {
        return `<div style="padding:16px;color:#64748b;font-size:13px;">${escapeHtml(options.emptyLabel)}</div>`;
    }
    const max = Math.max(1, ...usable.flatMap((row) => [row.primary || 0, row.secondary || 0]));
    const suffix = options.valueSuffix || '';
    const body = usable.map((row) => {
        const primary = row.primary;
        const secondary = row.secondary;
        const primaryPct = Math.max(primary ? 4 : 0, Math.round(((primary || 0) / max) * 100));
        const secondaryPct = Math.max(secondary ? 4 : 0, Math.round(((secondary || 0) / max) * 100));
        const tip = `${options.primaryLabel}: ${primary == null ? 'n/a' : `${primary}${suffix}`} · ${options.secondaryLabel}: ${secondary == null ? 'n/a' : `${secondary}${suffix}`}`;
        return `
      <tr>
        <td style="padding:8px 0;font-size:12px;font-weight:600;color:#334155;width:26%;vertical-align:top;">${escapeHtml(row.label)}</td>
        <td style="padding:8px 0;width:74%;" title="${escapeHtml(tip)}">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin-bottom:4px;">
            <tr>
              <td style="width:${primaryPct}%;background:${options.primaryColor};height:10px;border-radius:5px;" title="${escapeHtml(`${options.primaryLabel}: ${primary == null ? 'n/a' : `${primary}${suffix}`}`)}"></td>
              <td style="padding-left:8px;font-size:11px;color:${options.primaryColor};white-space:nowrap;">${primary == null ? '—' : `${primary}${suffix}`}</td>
            </tr>
          </table>
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0;">
            <tr>
              <td style="width:${secondaryPct}%;background:${options.secondaryColor};height:10px;border-radius:5px;" title="${escapeHtml(`${options.secondaryLabel}: ${secondary == null ? 'n/a' : `${secondary}${suffix}`}`)}"></td>
              <td style="padding-left:8px;font-size:11px;color:${options.secondaryColor};white-space:nowrap;">${secondary == null ? '—' : `${secondary}${suffix}`}</td>
            </tr>
          </table>
        </td>
      </tr>`;
    }).join('');
    return `
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="border:1px solid #e2e8f0;border-radius:14px;background:#ffffff;padding:12px 14px;">
      <tr><td style="padding-bottom:8px;">${legendChip(options.primaryLabel, options.primaryColor)}${legendChip(options.secondaryLabel, options.secondaryColor)}</td></tr>
      ${body}
    </table>`;
}
function breachList(report, dashboardUrl) {
    const browse = dashboardContract_1.ATLASSIAN_BROWSE_BASE_URL;
    if (!report.topBreaches.length) {
        return `<div style="padding:16px;border:1px solid #bbf7d0;border-radius:14px;background:#f0fdf4;color:#166534;font-size:13px;">No open tickets outside usual SLA.${detailLink(dashboardUrl, '#outside-sla')}</div>`;
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
    const auditBars = dualSeriesChart(report.byAuditType.slice(0, 8).map((row) => ({
        label: row.auditType,
        primary: row.opened,
        secondary: row.closed,
    })), {
        primaryLabel: 'Opened',
        secondaryLabel: 'Closed',
        primaryColor: COLORS.opened,
        secondaryColor: COLORS.closed,
        emptyLabel: 'No audit-type activity in this month.',
    });
    const appBars = dualSeriesChart(report.topApplications.slice(0, 8).map((row) => ({
        label: row.name,
        primary: row.opened,
        secondary: row.closed,
    })), {
        primaryLabel: 'Opened',
        secondaryLabel: 'Closed',
        primaryColor: COLORS.opened,
        secondaryColor: COLORS.closed,
        emptyLabel: 'No application activity tagged this month.',
    });
    const slaBars = dualSeriesChart(report.byAuditType.slice(0, 8).map((row) => ({
        label: row.auditType,
        primary: row.teamSlaAvgDays,
        secondary: row.reviewerSlaAvgDays,
    })), {
        primaryLabel: slaLabels_1.SRE_AUDIT_TEAM_SLA_LABEL,
        secondaryLabel: slaLabels_1.COMPLIANCE_SLA_LABEL,
        primaryColor: COLORS.team,
        secondaryColor: COLORS.reviewer,
        emptyLabel: 'No completed SLA handoffs this month.',
        valueSuffix: 'd',
    });
    const openDashboardBtn = dashboardUrl
        ? `<a href="${escapeHtml(dashboardUrl)}" style="display:inline-block;background:rgba(255,255,255,0.95);color:#0e7490;text-decoration:none;padding:10px 14px;border-radius:12px;font-size:12px;font-weight:700;white-space:nowrap;border:1px solid rgba(255,255,255,0.55);">Open Dashboard</a>`
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
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    <td style="vertical-align:middle;">
                      <div style="font-size:11px;letter-spacing:0.16em;text-transform:uppercase;opacity:0.9;">SRE Audit · Monthly Jira Report</div>
                      <div style="margin-top:8px;font-size:26px;font-weight:700;">${escapeHtml(report.periodLabel)}</div>
                      <div style="margin-top:6px;font-size:13px;opacity:0.9;">${escapeHtml(report.startDate)} → ${escapeHtml(report.endDate)}${report.projectKey ? ` · ${escapeHtml(report.projectKey)}` : ''}</div>
                    </td>
                    ${openDashboardBtn ? `<td style="vertical-align:middle;text-align:right;padding-left:16px;width:1%;">${openDashboardBtn}</td>` : ''}
                  </tr>
                </table>
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
                    ${metricCard('In Progress', String(report.totals.inProgress), COLORS.progress, '#fff7ed')}
                    ${metricCard('Under Validation', String(report.totals.underValidation), COLORS.validation, '#faf5ff')}
                  </tr>
                </table>
              </td>
            </tr>
            <tr>
              <td style="padding:4px 18px 8px;">
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                  <tr>
                    ${metricCard('Total Applications', String(report.totals.uniqueApplications), COLORS.apps, '#f0f9ff')}
                    ${metricCard('Audit Types', String(report.totals.uniqueAuditTypes), COLORS.types, '#eef2ff')}
                    ${metricCard(`${slaLabels_1.SRE_AUDIT_TEAM_SLA_LABEL} avg`, report.teamSlaOverall.avgDays == null ? '—' : `${report.teamSlaOverall.avgDays}d`, COLORS.team, '#fffbeb')}
                    ${metricCard(`${slaLabels_1.COMPLIANCE_SLA_LABEL} avg`, report.reviewerSlaOverall.avgDays == null ? '—' : `${report.reviewerSlaOverall.avgDays}d`, COLORS.reviewer, '#ecfdf5')}
                  </tr>
                </table>
              </td>
            </tr>
            ${sectionTitle('Opened / Closed by Audit Type', undefined, dashboardUrl, '#work-by-audit-type')}
            <tr><td style="padding:8px 20px 12px;">${auditBars}</td></tr>
            ${sectionTitle('SLA Metrics by Audit Type', `${slaLabels_1.SRE_AUDIT_TEAM_SLA_LABEL} (Approved → Under Validation, ${report.teamSlaOverall.targetDays}d) · ${slaLabels_1.COMPLIANCE_SLA_LABEL} (Under Validation → Done, ${report.reviewerSlaOverall.targetDays}d)`, dashboardUrl, '#sla-metrics')}
            <tr><td style="padding:8px 20px 12px;">${slaBars}</td></tr>
            ${sectionTitle('Top Applications', 'Opened vs closed by application', dashboardUrl, '#secondary-kpis')}
            <tr><td style="padding:8px 20px 12px;">${appBars}</td></tr>
            ${sectionTitle('Outside Usual SLA', `${slaLabels_1.SRE_AUDIT_TEAM_SLA_LABEL} ${report.teamSlaOverall.targetDays}d · ${slaLabels_1.COMPLIANCE_SLA_LABEL} ${report.reviewerSlaOverall.targetDays}d`, dashboardUrl, '#outside-sla')}
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
    ].filter((line) => line !== undefined).join('\n');
    return { subject, text, html };
}
