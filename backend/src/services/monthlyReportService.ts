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
import { renderMonthlyReportEmail } from './monthlyReportEmail';
import { emailDiagnostics, isEmailConfigured, sendMail } from './emailClient';

function parseRecipients(value?: string): string[] {
  return (value || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export async function loadIssuesForMonthlyReport(projectKey?: string) {
  if (isDatabaseEnabled()) {
    return getStoredSnapshot({ projectKey, startDate: undefined, endDate: undefined });
  }
  const result = await jiraClient.searchIssues({ projectKey });
  return result.issues;
}

export async function generateMonthlyReport(options: {
  month?: string;
  projectKey?: string;
} = {}): Promise<MonthlyReport> {
  const window = options.month ? monthWindowFromYm(options.month) : previousMonthWindow();
  const projectKey = options.projectKey || env.MONTHLY_REPORT_PROJECT_KEY || env.JIRA_PROJECT_KEY || undefined;
  const issues = await loadIssuesForMonthlyReport(projectKey);
  // Touch statuses so DB path stays warm; report builder does not need lookup for open/closed month math.
  if (isDatabaseEnabled()) await getStoredStatuses().catch(() => []);
  return buildMonthlyReport(issues, {
    ...window,
    projectKey,
  });
}

export async function sendMonthlyReport(options: {
  month?: string;
  projectKey?: string;
  to?: string;
  dryRun?: boolean;
} = {}) {
  const report = await generateMonthlyReport({
    month: options.month,
    projectKey: options.projectKey,
  });
  const rendered = renderMonthlyReportEmail(report, env.MONTHLY_REPORT_DASHBOARD_URL || undefined);
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
    text: rendered.text,
    html: rendered.html,
  });

  return {
    dryRun: false as const,
    email: emailDiagnostics(),
    recipients,
    subject: rendered.subject,
    report,
    messageId: sent.messageId,
    accepted: sent.accepted,
  };
}
