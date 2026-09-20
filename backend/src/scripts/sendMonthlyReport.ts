import { sendMonthlyReport } from '../services/monthlyReportService';
import { emailDiagnostics, isEmailConfigured } from '../services/emailClient';
import { env } from '../config/env';

function argValue(flag: string): string | undefined {
  const index = process.argv.indexOf(flag);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main() {
  const dryRun = hasFlag('--dry-run') || hasFlag('--dryRun');
  const month = argValue('--month');
  const projectKey = argValue('--project') || argValue('--projectKey');
  const to = argValue('--to');

  console.log(JSON.stringify({
    event: 'monthly_report_cli_start',
    dryRun,
    month: month || null,
    projectKey: projectKey || env.MONTHLY_REPORT_PROJECT_KEY || env.JIRA_PROJECT_KEY || null,
    to: to || env.MONTHLY_REPORT_TO || null,
    email: emailDiagnostics(),
  }));

  if (!dryRun && !isEmailConfigured()) {
    console.error(JSON.stringify({
      event: 'monthly_report_cli_failed',
      error: 'Email is not configured. Set SMTP_HOST, SMTP_FROM, MONTHLY_REPORT_TO (and SMTP_PROXY if needed).',
    }));
    process.exit(2);
  }

  const started = Date.now();
  const result = await sendMonthlyReport({ dryRun, month, projectKey, to });
  console.log(JSON.stringify({
    event: dryRun ? 'monthly_report_cli_preview' : 'monthly_report_cli_sent',
    durationMs: Date.now() - started,
    subject: result.subject,
    recipients: result.recipients,
    totals: result.report.totals,
    messageId: 'messageId' in result ? result.messageId : undefined,
    accepted: 'accepted' in result ? result.accepted : undefined,
  }));

  if (dryRun) {
    console.log('--- text preview ---');
    console.log((result.text || '').slice(0, 2000));
  }
}

main().catch((error) => {
  console.error(JSON.stringify({
    event: 'monthly_report_cli_failed',
    error: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }));
  process.exit(1);
});
