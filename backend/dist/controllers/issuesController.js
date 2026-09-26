"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ISSUE_SORTS = void 0;
exports.getIssuesHandler = getIssuesHandler;
const zod_1 = require("zod");
const jiraClient_1 = require("../services/jiraClient");
const jiraRepository_1 = require("../db/jiraRepository");
const database_1 = require("../db/database");
exports.ISSUE_SORTS = {
    'updated-desc': { label: 'Latest updated', jql: 'updated DESC', sql: 'i.updated_at DESC', field: 'updated', dir: -1 },
    'updated-asc': { label: 'Oldest updated', jql: 'updated ASC', sql: 'i.updated_at ASC', field: 'updated', dir: 1 },
    'created-desc': { label: 'Latest created', jql: 'created DESC', sql: 'i.created_at DESC', field: 'created', dir: -1 },
    'created-asc': { label: 'Oldest created', jql: 'created ASC', sql: 'i.created_at ASC', field: 'created', dir: 1 },
    'key-asc': { label: 'Key A–Z', jql: 'key ASC', sql: 'i.issue_key ASC', field: 'key', dir: 1 },
    'key-desc': { label: 'Key Z–A', jql: 'key DESC', sql: 'i.issue_key DESC', field: 'key', dir: -1 },
};
function compareIssues(left, right, sort) {
    const spec = exports.ISSUE_SORTS[sort];
    const a = spec.field === 'key' ? left.key : left[spec.field];
    const b = spec.field === 'key' ? right.key : right[spec.field];
    if (a < b)
        return -1 * spec.dir;
    if (a > b)
        return 1 * spec.dir;
    return 0;
}
const querySchema = zod_1.z.object({
    projectKey: zod_1.z.string().optional(),
    sprintId: zod_1.z.coerce.number().int().positive().optional(),
    issueType: zod_1.z.string().optional(),
    label: zod_1.z.string().optional(),
    epicKey: zod_1.z.string().optional(),
    licenseBu: zod_1.z.string().optional(),
    auditType: zod_1.z.string().optional(),
    application: zod_1.z.string().optional(),
    startDate: zod_1.z.preprocess((value) => (value === '' ? undefined : value), zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    endDate: zod_1.z.preprocess((value) => (value === '' ? undefined : value), zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    page: zod_1.z.coerce.number().int().positive().default(1),
    pageSize: zod_1.z.coerce.number().int().positive().max(100).default(25),
    sort: zod_1.z.enum(['updated-desc', 'updated-asc', 'created-desc', 'created-asc', 'key-asc', 'key-desc']).default('updated-desc'),
});
async function getIssuesHandler(req, res, next) {
    try {
        const parsed = querySchema.parse(req.query);
        const sort = parsed.sort;
        let issues;
        let total;
        if ((0, database_1.isDatabaseEnabled)()) {
            const result = await (0, jiraRepository_1.getStoredIssuesPage)(parsed, parsed.page, parsed.pageSize, exports.ISSUE_SORTS[sort].sql);
            issues = result.issues;
            total = result.total;
        }
        else {
            const searched = await jiraClient_1.jiraClient.searchIssues({ ...parsed, orderBy: exports.ISSUE_SORTS[sort].jql });
            const sorted = [...searched.issues].sort((left, right) => compareIssues(left, right, sort));
            const start = (parsed.page - 1) * parsed.pageSize;
            issues = sorted.slice(start, start + parsed.pageSize);
            total = searched.issues.length;
        }
        const comments = await jiraClient_1.jiraClient.getLatestHumanComments(issues.map((issue) => issue.key)).catch(() => new Map());
        return res.json({
            issues: issues.map((issue) => ({
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
                auditType: issue.auditType || [],
                application: issue.application || [],
                licenseBu: issue.licenseBu || [],
                epicKey: issue.epicKey || null,
                epicName: issue.epicName || null,
                latestComment: comments.get(issue.key) || null,
            })),
            page: parsed.page,
            pageSize: parsed.pageSize,
            total,
            sort,
            requestId: res.locals.requestId,
        });
    }
    catch (error) {
        next(error);
    }
}
