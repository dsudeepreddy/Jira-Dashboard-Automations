"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMetricsHandler = getMetricsHandler;
const zod_1 = require("zod");
const jiraClient_1 = require("../services/jiraClient");
const jiraRepository_1 = require("../db/jiraRepository");
const database_1 = require("../db/database");
const analytics_1 = require("../shared/analytics");
const env_1 = require("../config/env");
const filtersSchema = zod_1.z.object({
    projectKey: zod_1.z.string().optional(),
    sprintId: zod_1.z.coerce.number().int().positive().optional(),
    issueType: zod_1.z.string().optional(),
    startDate: zod_1.z.preprocess((value) => (value === '' ? undefined : value), zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
    endDate: zod_1.z.preprocess((value) => (value === '' ? undefined : value), zod_1.z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()),
});
function statusLookupFrom(statuses) {
    return new Map(statuses.map((status) => [status.name.toLowerCase(), status.statusCategory?.key || '']));
}
function asIso(value) {
    if (!value)
        return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
async function getMetricsHandler(req, res, next) {
    try {
        const parsed = filtersSchema.parse(req.query);
        const dbEnabled = (0, database_1.isDatabaseEnabled)();
        const [projects, agileSprints, issueTypes, statuses, searchResult, syncState] = dbEnabled
            ? await Promise.all([
                (0, jiraRepository_1.getStoredProjects)(),
                (0, jiraRepository_1.getStoredSprints)(),
                (0, jiraRepository_1.getStoredIssueTypes)(),
                (0, jiraRepository_1.getStoredStatuses)(),
                (0, jiraRepository_1.getStoredSnapshot)(parsed).then((issues) => ({ issues, sprints: [] })),
                (0, jiraRepository_1.getSyncState)(),
            ])
            : await Promise.all([
                jiraClient_1.jiraClient.getProjects(),
                jiraClient_1.jiraClient.getSprints().catch(() => []),
                jiraClient_1.jiraClient.getIssueTypes(),
                jiraClient_1.jiraClient.getIssueStatuses(),
                jiraClient_1.jiraClient.searchIssues(parsed),
                Promise.resolve(null),
            ]);
        const issues = searchResult.issues;
        const sprints = [...new Map([...agileSprints, ...searchResult.sprints].map((sprint) => [sprint.id, sprint])).values()];
        if (dbEnabled && !syncState?.last_success_at) {
            return res.status(503).json({
                type: 'https://api.example.com/problems/sync-required',
                title: 'Database snapshot is not ready',
                status: 503,
                detail: 'Run POST /api/v1/sync before requesting database-backed metrics.',
                code: 'SYNC_REQUIRED',
                requestId: res.locals.requestId,
            });
        }
        const fetchedAt = new Date().toISOString();
        const lastSuccessAt = asIso(syncState?.last_success_at) || (dbEnabled ? null : fetchedAt);
        const lastSyncedAt = asIso(syncState?.last_synced_at) || (dbEnabled ? null : fetchedAt);
        const stale = dbEnabled && lastSuccessAt ? Date.now() - new Date(lastSuccessAt).getTime() > env_1.env.STALE_AFTER_MS : false;
        const metrics = (0, analytics_1.aggregateDashboardMetrics)(issues, sprints, parsed, statusLookupFrom(statuses));
        return res.json({
            projects,
            sprints,
            issueTypes,
            statuses,
            metrics,
            filters: parsed,
            meta: {
                source: 'jira',
                issueCount: issues.length,
                requestId: res.locals.requestId,
                persistence: dbEnabled ? 'percona' : 'jira-direct',
                lastSuccessAt,
                lastSyncedAt,
                fetchedAt,
                lastError: syncState?.last_error || null,
                stale,
                truncated: dbEnabled ? issues.length >= 10000 : issues.length >= env_1.env.JIRA_MAX_ISSUES,
                browseBaseUrl: `${env_1.env.JIRA_DOMAIN.replace(/\/+$/, '')}/browse`,
            },
        });
    }
    catch (error) {
        next(error);
    }
}
