import { env } from '../config/env';
import { isDatabaseEnabled } from '../db/database';
import { getStoredSnapshot, getStoredStatuses } from '../db/jiraRepository';
import { jiraClient } from './jiraClient';
import {
  buildMonthlyReport,
  monthWindowFromYm,
  previousMonthWindow,
  previousWeekWindow,
  type MonthlyReport,
  type ReportKind,
} from '../shared/monthlyReport';
import type { AnalyticsIssue } from '../shared/analytics';
import { renderMonthlyReportEmail } from './monthlyReportEmail';
import { buildMonthlyReportWorkbookBuffer } from './monthlyReportWorkbook';
import { emailDiagnostics, isEmailConfigured, sendMail } from './emailClient';
import { resolveMonthlyReportDashboardUrl } from './dashboardPublicUrl';

function parseRecipients(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function reportRecipients(kind: ReportKind, overrideTo?: string): string[] {
  if (overrideTo) return parseRecipients(overrideTo);
  if (kind === 'weekly') {
    return parseRecipients(env.WEEKLY_REPORT_TO || env.MONTHLY_REPORT_TO);
  }
  return parseRecipients(env.MONTHLY_REPORT_TO);
}

export async function loadIssuesForMonthlyReport(options: {
  projectKey?: string;
  startDate: string;
  endDate: string;
}) {
  const { projectKey, startDate, endDate } = options;
  if (isDatabaseEnabled()) {
    console.log(JSON.stringify({ event: 'period_report_load_db', projectKey: projectKey || null }));
    return getStoredSnapshot({ projectKey });
  }
  console.log(JSON.stringify({
    event: 'period_report_load_jira',
    projectKey: projectKey || null,
    startDate,
    endDate,
  }));
  const result = await jiraClient.searchIssues({
    projectKey,
    activityStartDate: startDate,
    activityEndDate: endDate,
    unbounded: true,
    orderBy: 'updated DESC',
  });
  console.log(JSON.stringify({
    event: 'period_report_load_jira_done',
    issueCount: result.issues.length,
  }));
  return result.issues;
}

export async function generateMonthlyReport(options: {
  month?: string;
  projectKey?: string;
} = {}): Promise<{ report: MonthlyReport; issues: AnalyticsIssue[] }> {
  const window = options.month ? monthWindowFromYm(options.month) : previousMonthWindow();
  const projectKey = options.projectKey || env.MONTHLY_REPORT_PROJECT_KEY || env.JIRA_PROJECT_KEY || undefined;
  const issues = await loadIssuesForMonthlyReport({
    projectKey,
    startDate: window.startDate,
    endDate: window.endDate,
  });
  if (isDatabaseEnabled()) await getStoredStatuses().catch(() => []);
  const report = buildMonthlyReport(issues, {
    ...window,
    projectKey,
  });
  return { report, issues };
}

export async function generateWeeklyReport(options: {
  projectKey?: string;
  now?: Date;
} = {}): Promise<{ report: MonthlyReport; issues: AnalyticsIssue[] }> {
  const window = previousWeekWindow(options.now || new Date(), env.MONTHLY_REPORT_TIMEZONE);
  const projectKey = options.projectKey || env.MONTHLY_REPORT_PROJECT_KEY || env.JIRA_PROJECT_KEY || undefined;
  const issues = await loadIssuesForMonthlyReport({
    projectKey,
    startDate: window.startDate,
    endDate: window.endDate,
  });
  if (isDatabaseEnabled()) await getStoredStatuses().catch(() => []);
  const report = buildMonthlyReport(issues, {
    ...window,
    projectKey,
  });
  return { report, issues };
}

/** Tiny SMTP-only probe — does not call Jira. */
export async function sendSmtpTestEmail(options: { to?: string } = {}) {
  if (!isEmailConfigured() && !options.to) {
    throw Object.assign(new Error('Set SMTP_HOST, SMTP_FROM, MONTHLY_REPORT_TO (or pass --to).'), {
      statusCode: 503,
      code: 'EMAIL_NOT_CONFIGURED',
    });
  }
  const recipients = parseRecipients(options.to || env.MONTHLY_REPORT_TO);
  if (!recipients.length) {
    throw Object.assign(new Error('No recipients. Pass --to or set MONTHLY_REPORT_TO.'), {
      statusCode: 400,
      code: 'NO_RECIPIENTS',
    });
  }
  const subject = `SRE Audit SMTP test — ${new Date().toISOString()}`;
  const text = [
    'This is a connectivity test from the Jira Dashboard backend.',
    `Host: ${env.SMTP_HOST}:${env.SMTP_PORT}`,
    `Proxy: ${env.SMTP_PROXY || '(none)'}`,
    `From: ${env.SMTP_FROM}`,
    `To: ${recipients.join(', ')}`,
  ].join('\n');
  const html = `<pre style="font-family:ui-monospace,monospace">${text.replace(/</g, '&lt;')}</pre>`;

  const sent = await sendMail({
    to: recipients,
    subject,
    text,
    html,
  });
  return {
    subject,
    recipients,
    messageId: sent.messageId,
    accepted: sent.accepted,
    email: emailDiagnostics(),
  };
}

export type MonthlyReportAttachment = {
  filename: string;
  content: Buffer;
  contentType: string;
  bytes: number;
};

async function sendPeriodReport(options: {
  kind: ReportKind;
  month?: string;
  projectKey?: string;
  to?: string;
  dryRun?: boolean;
}) {
  const kind = options.kind;
  const started = Date.now();
  console.log(JSON.stringify({
    event: `${kind}_report_build_start`,
    dryRun: Boolean(options.dryRun),
    month: options.month || null,
    projectKey: options.projectKey || env.MONTHLY_REPORT_PROJECT_KEY || env.JIRA_PROJECT_KEY || null,
  }));

  const { report, issues } = kind === 'weekly'
    ? await generateWeeklyReport({ projectKey: options.projectKey })
    : await generateMonthlyReport({ month: options.month, projectKey: options.projectKey });

  console.log(JSON.stringify({
    event: `${kind}_report_build_done`,
    durationMs: Date.now() - started,
    opened: report.totals.opened,
    closed: report.totals.closed,
    periodLabel: report.periodLabel,
    startDate: report.startDate,
    endDate: report.endDate,
  }));

  const rendered = renderMonthlyReportEmail(report, resolveMonthlyReportDashboardUrl(), kind);
  const workbook = buildMonthlyReportWorkbookBuffer(report, issues, kind);
  const attachment: MonthlyReportAttachment = {
    filename: workbook.filename,
    content: workbook.content,
    contentType: workbook.contentType,
    bytes: workbook.content.length,
  };
  const recipients = reportRecipients(kind, options.to);

  if (options.dryRun) {
    return {
      dryRun: true as const,
      kind,
      email: emailDiagnostics(),
      recipients,
      subject: rendered.subject,
      report,
      html: rendered.html,
      text: rendered.text,
      attachment,
    };
  }

  if (!isEmailConfigured()) {
    throw Object.assign(new Error('Report email is not configured. Set SMTP_HOST, SMTP_FROM, and MONTHLY_REPORT_TO.'), {
      statusCode: 503,
      code: 'EMAIL_NOT_CONFIGURED',
    });
  }
  if (!recipients.length) {
    throw Object.assign(new Error('No report recipients configured.'), {
      statusCode: 400,
      code: 'NO_RECIPIENTS',
    });
  }

  const sent = await sendMail({
    to: recipients,
    subject: rendered.subject,
    text: `${rendered.text}\n\nExcel attachment: ${workbook.filename}`,
    html: rendered.html,
    attachments: [{
      filename: workbook.filename,
      content: workbook.content,
      contentType: workbook.contentType,
    }],
  });

  return {
    dryRun: false as const,
    kind,
    email: emailDiagnostics(),
    recipients,
    subject: rendered.subject,
    report,
    messageId: sent.messageId,
    accepted: sent.accepted,
    attachment: {
      filename: attachment.filename,
      bytes: attachment.bytes,
    },
  };
}

export async function sendMonthlyReport(options: {
  month?: string;
  projectKey?: string;
  to?: string;
  dryRun?: boolean;
} = {}) {
  return sendPeriodReport({ ...options, kind: 'monthly' });
}

export async function sendWeeklyReport(options: {
  projectKey?: string;
  to?: string;
  dryRun?: boolean;
} = {}) {
  return sendPeriodReport({ ...options, kind: 'weekly' });
}
