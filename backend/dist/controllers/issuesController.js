"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getIssuesHandler = getIssuesHandler;
const zod_1 = require("zod");
const jiraClient_1 = require("../services/jiraClient");
const jiraRepository_1 = require("../db/jiraRepository");
const database_1 = require("../db/database");
const querySchema = zod_1.z.object({
    projectKey: zod_1.z.string().optional(),
    sprintId: zod_1.z.coerce.number().int().positive().optional(),
    issueType: zod_1.z.string().optional(),
    startDate: zod_1.z.preprocess((value) => (value === '' ? undefined : value), zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    endDate: zod_1.z.preprocess((value) => (value === '' ? undefined : value), zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    page: zod_1.z.coerce.number().int().positive().default(1),
    pageSize: zod_1.z.coerce.number().int().positive().max(100).default(25),
});
async function getIssuesHandler(req, res, next) {
    try {
        const parsed = querySchema.parse(req.query);
        if ((0, database_1.isDatabaseEnabled)()) {
            const result = await (0, jiraRepository_1.getStoredIssuesPage)(parsed, parsed.page, parsed.pageSize);
            return res.json({
                issues: result.issues.map((issue) => ({
                    id: issue.id,
                    key: issue.key,
                    summary: issue.summary,
                    status: issue.status,
                    created: issue.created,
                    updated: issue.updated,
                    resolved: issue.resolved,
                    issuetype: issue.issueType ? { name: issue.issueType } : undefined,
                    project: issue.projectKey ? { key: issue.projectKey } : undefined,
                    assignee: issue.assignee,
                    storyPoints: issue.storyPoints,
                    flagged: issue.flagged,
                })),
                page: parsed.page,
                pageSize: parsed.pageSize,
                total: result.total,
                requestId: res.locals.requestId,
            });
        }
        const { issues } = await jiraClient_1.jiraClient.searchIssues(parsed);
        const start = (parsed.page - 1) * parsed.pageSize;
        const pageIssues = issues.slice(start, start + parsed.pageSize);
        return res.json({
            issues: pageIssues.map((issue) => ({
                id: issue.id,
                key: issue.key,
                summary: issue.summary,
                status: issue.status,
                created: issue.created,
                updated: issue.updated,
                resolved: issue.resolved,
                issuetype: issue.issueType ? { name: issue.issueType } : undefined,
                project: issue.projectKey ? { key: issue.projectKey } : undefined,
                assignee: issue.assignee,
                storyPoints: issue.storyPoints,
                flagged: issue.flagged,
            })),
            page: parsed.page,
            pageSize: parsed.pageSize,
            total: issues.length,
            requestId: res.locals.requestId,
        });
    }
    catch (error) {
        next(error);
    }
}
