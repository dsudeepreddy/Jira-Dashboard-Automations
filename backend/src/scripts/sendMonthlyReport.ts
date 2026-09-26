import fs from 'node:fs';
import path from 'node:path';
import { sendMonthlyReport, sendSmtpTestEmail } from '../services/monthlyReportService';
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
  const smtpTest = hasFlag('--smtp-test') || hasFlag('--smtpTest');
  const month = argValue('--month');
  const projectKey = argValue('--project') || argValue('--projectKey');
  const to = argValue('--to');
  const outPath = argValue('--out') || argValue('--output');

  console.log(JSON.stringify({
    event: 'monthly_report_cli_start',
    mode: smtpTest ? 'smtp-test' : dryRun ? 'dry-run' : 'send',
    month: month || null,
    projectKey: projectKey || env.MONTHLY_REPORT_PROJECT_KEY || env.JIRA_PROJECT_KEY || null,
    to: to || env.MONTHLY_REPORT_TO || null,
    outPath: outPath || null,
    email: emailDiagnostics(),
    note: smtpTest
      ? 'SMTP-only probe (no Jira). Use this first to verify mail delivery.'
      : 'Full report loads Jira/DB first; that can take minutes. Prefer --smtp-test for connectivity.',
  }));

  if (smtpTest) {
    if (!isEmailConfigured() && !to) {
      console.error(JSON.stringify({
        event: 'monthly_report_cli_failed',
        error: 'Email is not configured. Set SMTP_HOST, SMTP_FROM, MONTHLY_REPORT_TO (and SMTP_PROXY if needed).',
      }));
      process.exit(2);
    }
    const started = Date.now();
    const result = await sendSmtpTestEmail({ to });
    console.log(JSON.stringify({
      event: 'monthly_report_cli_smtp_test_sent',
      durationMs: Date.now() - started,
      subject: result.subject,
      recipients: result.recipients,
      messageId: result.messageId,
      accepted: result.accepted,
    }));
    return;
  }

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
    periodLabel: result.report.periodLabel,
    messageId: 'messageId' in result ? result.messageId : undefined,
    accepted: 'accepted' in result ? result.accepted : undefined,
  }));

  if (dryRun && 'html' in result && result.html) {
    const file = outPath
      || path.join('/tmp', `sre-audit-monthly-${result.report.startDate.slice(0, 7)}.html`);
    fs.writeFileSync(file, result.html, 'utf8');
    console.log(JSON.stringify({
      event: 'monthly_report_html_written',
      path: file,
      subject: result.subject,
      bytes: Buffer.byteLength(result.html, 'utf8'),
    }));
    console.log(`HTML preview written to ${file}`);
    console.log('Copy out of the container, e.g.:');
    console.log(`  podman cp jira-backend-api:${file} ./monthly-report-preview.html`);
    console.log('Then open monthly-report-preview.html in a browser.');
    console.log('--- text preview (first 1500 chars) ---');
    console.log((result.text || '').slice(0, 1500));
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
