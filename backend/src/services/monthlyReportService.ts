import { env } from '../config/env';
import { isDatabaseEnabled } from '../db/database';
import { getStoredSnapshot, getStoredStatuses } from '../db/jiraRepository';
import { jiraClient } from './jiraClient';
import {
  buildMonthlyReport,
  monthWindowFromYm,
  previousMonthWindow,
  type MonthlyReport,
} from '../shared/monthlyReport';
import type { AnalyticsIssue } from '../shared/analytics';
import { renderMonthlyReportEmail } from './monthlyReportEmail';
import { buildMonthlyReportWorkbookBuffer } from './monthlyReportWorkbook';
import { emailDiagnostics, isEmailConfigured, sendMail } from './emailClient';

function parseRecipients(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function loadIssuesForMonthlyReport(options: {
  projectKey?: string;
  startDate: string;
  endDate: string;
}) {
  const { projectKey, startDate, endDate } = options;
  if (isDatabaseEnabled()) {
    // Snapshot may be larger than one month; filter in memory via buildMonthlyReport.
    console.log(JSON.stringify({ event: 'monthly_report_load_db', projectKey: projectKey || null }));
    return getStoredSnapshot({ projectKey });
  }
  console.log(JSON.stringify({
    event: 'monthly_report_load_jira',
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
    event: 'monthly_report_load_jira_done',
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

export async function sendMonthlyReport(options: {
  month?: string;
  projectKey?: string;
  to?: string;
  dryRun?: boolean;
} = {}) {
  const started = Date.now();
  console.log(JSON.stringify({
    event: 'monthly_report_build_start',
    dryRun: Boolean(options.dryRun),
    month: options.month || null,
    projectKey: options.projectKey || env.MONTHLY_REPORT_PROJECT_KEY || env.JIRA_PROJECT_KEY || null,
  }));

  const { report, issues } = await generateMonthlyReport({
    month: options.month,
    projectKey: options.projectKey,
  });
  console.log(JSON.stringify({
    event: 'monthly_report_build_done',
    durationMs: Date.now() - started,
    opened: report.totals.opened,
    closed: report.totals.closed,
    periodLabel: report.periodLabel,
  }));

  const rendered = renderMonthlyReportEmail(report, env.MONTHLY_REPORT_DASHBOARD_URL || undefined);
  const workbook = buildMonthlyReportWorkbookBuffer(report, issues);
  const attachment: MonthlyReportAttachment = {
    filename: workbook.filename,
    content: workbook.content,
    contentType: workbook.contentType,
    bytes: workbook.content.length,
  };
  const recipients = parseRecipients(options.to || env.MONTHLY_REPORT_TO);

  if (options.dryRun) {
    return {
      dryRun: true as const,
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
    throw Object.assign(new Error('Monthly report email is not configured. Set SMTP_HOST, SMTP_FROM, and MONTHLY_REPORT_TO.'), {
      statusCode: 503,
      code: 'EMAIL_NOT_CONFIGURED',
    });
  }
  if (!recipients.length) {
    throw Object.assign(new Error('No monthly report recipients configured.'), {
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
