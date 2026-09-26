"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadIssuesForMonthlyReport = loadIssuesForMonthlyReport;
exports.generateMonthlyReport = generateMonthlyReport;
exports.sendSmtpTestEmail = sendSmtpTestEmail;
exports.sendMonthlyReport = sendMonthlyReport;
const env_1 = require("../config/env");
const database_1 = require("../db/database");
const jiraRepository_1 = require("../db/jiraRepository");
const jiraClient_1 = require("./jiraClient");
const monthlyReport_1 = require("../shared/monthlyReport");
const monthlyReportEmail_1 = require("./monthlyReportEmail");
const monthlyReportWorkbook_1 = require("./monthlyReportWorkbook");
const emailClient_1 = require("./emailClient");
function parseRecipients(value) {
    return (value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}
async function loadIssuesForMonthlyReport(options) {
    const { projectKey, startDate, endDate } = options;
    if ((0, database_1.isDatabaseEnabled)()) {
        // Snapshot may be larger than one month; filter in memory via buildMonthlyReport.
        console.log(JSON.stringify({ event: 'monthly_report_load_db', projectKey: projectKey || null }));
        return (0, jiraRepository_1.getStoredSnapshot)({ projectKey });
    }
    console.log(JSON.stringify({
        event: 'monthly_report_load_jira',
        projectKey: projectKey || null,
        startDate,
        endDate,
    }));
    const result = await jiraClient_1.jiraClient.searchIssues({
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
async function generateMonthlyReport(options = {}) {
    const window = options.month ? (0, monthlyReport_1.monthWindowFromYm)(options.month) : (0, monthlyReport_1.previousMonthWindow)();
    const projectKey = options.projectKey || env_1.env.MONTHLY_REPORT_PROJECT_KEY || env_1.env.JIRA_PROJECT_KEY || undefined;
    const issues = await loadIssuesForMonthlyReport({
        projectKey,
        startDate: window.startDate,
        endDate: window.endDate,
    });
    if ((0, database_1.isDatabaseEnabled)())
        await (0, jiraRepository_1.getStoredStatuses)().catch(() => []);
    const report = (0, monthlyReport_1.buildMonthlyReport)(issues, {
        ...window,
        projectKey,
    });
    return { report, issues };
}
/** Tiny SMTP-only probe — does not call Jira. */
async function sendSmtpTestEmail(options = {}) {
    if (!(0, emailClient_1.isEmailConfigured)() && !options.to) {
        throw Object.assign(new Error('Set SMTP_HOST, SMTP_FROM, MONTHLY_REPORT_TO (or pass --to).'), {
            statusCode: 503,
            code: 'EMAIL_NOT_CONFIGURED',
        });
    }
    const recipients = parseRecipients(options.to || env_1.env.MONTHLY_REPORT_TO);
    if (!recipients.length) {
        throw Object.assign(new Error('No recipients. Pass --to or set MONTHLY_REPORT_TO.'), {
            statusCode: 400,
            code: 'NO_RECIPIENTS',
        });
    }
    const subject = `SRE Audit SMTP test — ${new Date().toISOString()}`;
    const text = [
        'This is a connectivity test from the Jira Dashboard backend.',
        `Host: ${env_1.env.SMTP_HOST}:${env_1.env.SMTP_PORT}`,
        `Proxy: ${env_1.env.SMTP_PROXY || '(none)'}`,
        `From: ${env_1.env.SMTP_FROM}`,
        `To: ${recipients.join(', ')}`,
    ].join('\n');
    const html = `<pre style="font-family:ui-monospace,monospace">${text.replace(/</g, '&lt;')}</pre>`;
    const sent = await (0, emailClient_1.sendMail)({
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
        email: (0, emailClient_1.emailDiagnostics)(),
    };
}
async function sendMonthlyReport(options = {}) {
    const started = Date.now();
    console.log(JSON.stringify({
        event: 'monthly_report_build_start',
        dryRun: Boolean(options.dryRun),
        month: options.month || null,
        projectKey: options.projectKey || env_1.env.MONTHLY_REPORT_PROJECT_KEY || env_1.env.JIRA_PROJECT_KEY || null,
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
    const rendered = (0, monthlyReportEmail_1.renderMonthlyReportEmail)(report, env_1.env.MONTHLY_REPORT_DASHBOARD_URL || undefined);
    const workbook = (0, monthlyReportWorkbook_1.buildMonthlyReportWorkbookBuffer)(report, issues);
    const attachment = {
        filename: workbook.filename,
        content: workbook.content,
        contentType: workbook.contentType,
        bytes: workbook.content.length,
    };
    const recipients = parseRecipients(options.to || env_1.env.MONTHLY_REPORT_TO);
    if (options.dryRun) {
        return {
            dryRun: true,
            email: (0, emailClient_1.emailDiagnostics)(),
            recipients,
            subject: rendered.subject,
            report,
            html: rendered.html,
            text: rendered.text,
            attachment,
        };
    }
    if (!(0, emailClient_1.isEmailConfigured)()) {
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
    const sent = await (0, emailClient_1.sendMail)({
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
        dryRun: false,
        email: (0, emailClient_1.emailDiagnostics)(),
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
