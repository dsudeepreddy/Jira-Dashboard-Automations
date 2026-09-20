"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadIssuesForMonthlyReport = loadIssuesForMonthlyReport;
exports.generateMonthlyReport = generateMonthlyReport;
exports.sendMonthlyReport = sendMonthlyReport;
const env_1 = require("../config/env");
const database_1 = require("../db/database");
const jiraRepository_1 = require("../db/jiraRepository");
const jiraClient_1 = require("./jiraClient");
const monthlyReport_1 = require("../shared/monthlyReport");
const monthlyReportEmail_1 = require("./monthlyReportEmail");
const emailClient_1 = require("./emailClient");
function parseRecipients(value) {
    return (value || '')
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
}
async function loadIssuesForMonthlyReport(projectKey) {
    if ((0, database_1.isDatabaseEnabled)()) {
        return (0, jiraRepository_1.getStoredSnapshot)({ projectKey, startDate: undefined, endDate: undefined });
    }
    const result = await jiraClient_1.jiraClient.searchIssues({ projectKey });
    return result.issues;
}
async function generateMonthlyReport(options = {}) {
    const window = options.month ? (0, monthlyReport_1.monthWindowFromYm)(options.month) : (0, monthlyReport_1.previousMonthWindow)();
    const projectKey = options.projectKey || env_1.env.MONTHLY_REPORT_PROJECT_KEY || env_1.env.JIRA_PROJECT_KEY || undefined;
    const issues = await loadIssuesForMonthlyReport(projectKey);
    // Touch statuses so DB path stays warm; report builder does not need lookup for open/closed month math.
    if ((0, database_1.isDatabaseEnabled)())
        await (0, jiraRepository_1.getStoredStatuses)().catch(() => []);
    return (0, monthlyReport_1.buildMonthlyReport)(issues, {
        ...window,
        projectKey,
    });
}
async function sendMonthlyReport(options = {}) {
    const started = Date.now();
    console.log(JSON.stringify({
        event: 'monthly_report_build_start',
        dryRun: Boolean(options.dryRun),
        month: options.month || null,
        projectKey: options.projectKey || env_1.env.MONTHLY_REPORT_PROJECT_KEY || env_1.env.JIRA_PROJECT_KEY || null,
    }));
    const report = await generateMonthlyReport({
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
        text: rendered.text,
        html: rendered.html,
    });
    return {
        dryRun: false,
        email: (0, emailClient_1.emailDiagnostics)(),
        recipients,
        subject: rendered.subject,
        report,
        messageId: sent.messageId,
        accepted: sent.accepted,
    };
}
