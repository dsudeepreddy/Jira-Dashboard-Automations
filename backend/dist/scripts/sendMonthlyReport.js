"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_fs_1 = __importDefault(require("node:fs"));
const node_path_1 = __importDefault(require("node:path"));
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
    const weekly = hasFlag('--weekly') || hasFlag('--week');
    const month = argValue('--month');
    const projectKey = argValue('--project') || argValue('--projectKey');
    const to = argValue('--to');
    const outPath = argValue('--out') || argValue('--output');
    const kind = weekly ? 'weekly' : 'monthly';
    console.log(JSON.stringify({
        event: `${kind}_report_cli_start`,
        mode: smtpTest ? 'smtp-test' : dryRun ? 'dry-run' : 'send',
        kind,
        month: month || null,
        projectKey: projectKey || env_1.env.MONTHLY_REPORT_PROJECT_KEY || env_1.env.JIRA_PROJECT_KEY || null,
        to: to || (weekly ? (env_1.env.WEEKLY_REPORT_TO || env_1.env.MONTHLY_REPORT_TO) : env_1.env.MONTHLY_REPORT_TO) || null,
        outPath: outPath || null,
        email: (0, emailClient_1.emailDiagnostics)(),
        note: smtpTest
            ? 'SMTP-only probe (no Jira). Use this first to verify mail delivery.'
            : 'Full report loads Jira/DB first; that can take minutes. Prefer --smtp-test for connectivity.',
    }));
    if (smtpTest) {
        if (!(0, emailClient_1.isEmailConfigured)() && !to) {
            console.error(JSON.stringify({
                event: 'report_cli_failed',
                error: 'Email is not configured. Set SMTP_HOST, SMTP_FROM, MONTHLY_REPORT_TO (and SMTP_PROXY if needed).',
            }));
            process.exit(2);
        }
        const started = Date.now();
        const result = await (0, monthlyReportService_1.sendSmtpTestEmail)({ to });
        console.log(JSON.stringify({
            event: 'report_cli_smtp_test_sent',
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
            event: 'report_cli_failed',
            error: 'Email is not configured. Set SMTP_HOST, SMTP_FROM, MONTHLY_REPORT_TO (and SMTP_PROXY if needed).',
        }));
        process.exit(2);
    }
    const started = Date.now();
    const result = weekly
        ? await (0, monthlyReportService_1.sendWeeklyReport)({ dryRun, projectKey, to })
        : await (0, monthlyReportService_1.sendMonthlyReport)({ dryRun, month, projectKey, to });
    console.log(JSON.stringify({
        event: dryRun ? `${kind}_report_cli_preview` : `${kind}_report_cli_sent`,
        durationMs: Date.now() - started,
        subject: result.subject,
        recipients: result.recipients,
        totals: result.report.totals,
        periodLabel: result.report.periodLabel,
        startDate: result.report.startDate,
        endDate: result.report.endDate,
        messageId: 'messageId' in result ? result.messageId : undefined,
        accepted: 'accepted' in result ? result.accepted : undefined,
    }));
    if (result.dryRun) {
        const defaultName = kind === 'weekly'
            ? `sre-audit-weekly-${result.report.startDate}_to_${result.report.endDate}.html`
            : `sre-audit-monthly-${result.report.startDate.slice(0, 7)}.html`;
        const file = outPath || node_path_1.default.join('/tmp', defaultName);
        node_fs_1.default.writeFileSync(file, result.html, 'utf8');
        console.log(JSON.stringify({
            event: `${kind}_report_html_written`,
            path: file,
            subject: result.subject,
            bytes: Buffer.byteLength(result.html, 'utf8'),
        }));
        const xlsxPath = file.replace(/\.html?$/i, '.xlsx');
        node_fs_1.default.writeFileSync(xlsxPath, result.attachment.content);
        console.log(JSON.stringify({
            event: `${kind}_report_xlsx_written`,
            path: xlsxPath,
            filename: result.attachment.filename,
            bytes: result.attachment.bytes,
        }));
        console.log(`HTML preview written to ${file}`);
        console.log(`Excel preview written to ${xlsxPath}`);
        console.log('--- text preview (first 1500 chars) ---');
        console.log((result.text || '').slice(0, 1500));
    }
}
main()
    .then(() => {
    // Force exit: open DB/SMTP handles otherwise keep the CLI process alive.
    process.exit(0);
})
    .catch((error) => {
    console.error(JSON.stringify({
        event: 'report_cli_failed',
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
    }));
    process.exit(1);
});
