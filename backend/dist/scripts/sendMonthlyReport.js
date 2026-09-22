"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const monthlyReportService_1 = require("../services/monthlyReportService");
const emailClient_1 = require("../services/emailClient");
const env_1 = require("../config/env");
function argValue(flag) {
    const index = process.argv.indexOf(flag);
    if (index < 0)
        return undefined;
    return process.argv[index + 1];
}
function hasFlag(flag) {
    return process.argv.includes(flag);
}
async function main() {
    const dryRun = hasFlag('--dry-run') || hasFlag('--dryRun');
    const smtpTest = hasFlag('--smtp-test') || hasFlag('--smtpTest');
    const month = argValue('--month');
    const projectKey = argValue('--project') || argValue('--projectKey');
    const to = argValue('--to');
    console.log(JSON.stringify({
        event: 'monthly_report_cli_start',
        mode: smtpTest ? 'smtp-test' : dryRun ? 'dry-run' : 'send',
        month: month || null,
        projectKey: projectKey || env_1.env.MONTHLY_REPORT_PROJECT_KEY || env_1.env.JIRA_PROJECT_KEY || null,
        to: to || env_1.env.MONTHLY_REPORT_TO || null,
        email: (0, emailClient_1.emailDiagnostics)(),
        note: smtpTest
            ? 'SMTP-only probe (no Jira). Use this first to verify mail delivery.'
            : 'Full report loads Jira/DB first; that can take minutes. Prefer --smtp-test for connectivity.',
    }));
    if (smtpTest) {
        if (!(0, emailClient_1.isEmailConfigured)() && !to) {
            console.error(JSON.stringify({
                event: 'monthly_report_cli_failed',
                error: 'Email is not configured. Set SMTP_HOST, SMTP_FROM, MONTHLY_REPORT_TO (and SMTP_PROXY if needed).',
            }));
            process.exit(2);
        }
        const started = Date.now();
        const result = await (0, monthlyReportService_1.sendSmtpTestEmail)({ to });
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
    if (!dryRun && !(0, emailClient_1.isEmailConfigured)()) {
        console.error(JSON.stringify({
            event: 'monthly_report_cli_failed',
            error: 'Email is not configured. Set SMTP_HOST, SMTP_FROM, MONTHLY_REPORT_TO (and SMTP_PROXY if needed).',
        }));
        process.exit(2);
    }
    const started = Date.now();
    const result = await (0, monthlyReportService_1.sendMonthlyReport)({ dryRun, month, projectKey, to });
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
