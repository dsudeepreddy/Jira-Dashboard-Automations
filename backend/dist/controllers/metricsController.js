"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getMetricsHandler = getMetricsHandler;
const zod_1 = require("zod");
const jiraClient_1 = require("../services/jiraClient");
const jiraRepository_1 = require("../db/jiraRepository");
const database_1 = require("../db/database");
const analytics_1 = require("../shared/analytics");
const dashboardContract_1 = require("../shared/dashboardContract");
const env_1 = require("../config/env");
const filtersSchema = zod_1.z.object({
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
});
function statusLookupFrom(statuses) {
    return new Map(statuses.map((status) => [status.name.toLowerCase(), status.statusCategory?.key || '']));
}
function catalogNames(values) {
    return [...new Set(values.map((value) => (value || '').trim()).filter(Boolean))]
        .sort((left, right) => left.localeCompare(right))
        .map((name) => ({ id: name, name }));
}
function asIso(value) {
    if (!value)
        return null;
    const date = value instanceof Date ? value : new Date(String(value));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
/** Soft-timeout helper so optional catalog calls cannot stall /metrics. */
function soft(promise, fallback, ms = 12_000) {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve(fallback), ms);
        promise.then((value) => {
            clearTimeout(timer);
            resolve(value);
        }, () => {
            clearTimeout(timer);
            resolve(fallback);
        });
    });
}
async function getMetricsHandler(req, res, next) {
    try {
        const parsed = filtersSchema.parse(req.query);
        const dbEnabled = (0, database_1.isDatabaseEnabled)();
        const { label: _label, licenseBu: _licenseBu, auditType: _auditType, application: _application, ...scopeForCatalog } = parsed;
        let projects;
        let agileSprints;
        let issueTypes;
        let statuses;
        let searchResult;
        let storedEpics;
        let syncState;
        if (dbEnabled) {
            [
                projects,
                agileSprints,
                issueTypes,
                statuses,
                searchResult,
                storedEpics,
                syncState,
            ] = await Promise.all([
                (0, jiraRepository_1.getStoredProjects)(),
                (0, jiraRepository_1.getStoredSprints)(),
                (0, jiraRepository_1.getStoredIssueTypes)(),
                (0, jiraRepository_1.getStoredStatuses)(),
                (0, jiraRepository_1.getStoredSnapshot)(scopeForCatalog).then((issues) => ({ issues, sprints: [] })),
                (0, jiraRepository_1.getStoredEpics)(),
                (0, jiraRepository_1.getSyncState)(),
            ]);
        }
        else {
            // Search is required. Catalogs are soft-timed so SMTP/proxy/Agile issues cannot sink the dashboard.
            const [projectsResult, sprintsResult, typesResult, statusesResult, searchOutcome, epicsResult] = await Promise.all([
                soft(jiraClient_1.jiraClient.getProjects(), []),
                soft(jiraClient_1.jiraClient.getSprints(), []),
                soft(jiraClient_1.jiraClient.getIssueTypes(), []),
                soft(jiraClient_1.jiraClient.getIssueStatuses(), []),
                jiraClient_1.jiraClient.searchIssues(scopeForCatalog),
                soft(jiraClient_1.jiraClient.getEpics(parsed.projectKey), []),
            ]);
            projects = projectsResult;
            agileSprints = sprintsResult;
            issueTypes = typesResult;
            statuses = statusesResult;
            searchResult = searchOutcome;
            storedEpics = epicsResult;
            syncState = null;
        }
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
        const labels = catalogNames(issues.flatMap((issue) => issue.labels || []));
        const licenseBus = catalogNames(issues.flatMap((issue) => issue.licenseBu || []));
        const auditTypes = catalogNames(issues.flatMap((issue) => issue.auditType || []));
        const applications = catalogNames(issues.flatMap((issue) => issue.application || []));
        const epics = [...new Map([
                ...storedEpics.map((epic) => [epic.key, epic]),
                ...issues.filter((issue) => issue.epicKey).map((issue) => [issue.epicKey, { key: issue.epicKey, name: issue.epicName || issue.epicKey || '' }]),
            ]).values()].sort((left, right) => left.name.localeCompare(right.name));
        return res.json({
            projects,
            sprints,
            issueTypes,
            labels,
            epics,
            licenseBus,
            auditTypes,
            applications,
            statuses,
            metrics,
            filters: parsed,
            meta: {
                source: 'jira',
                issueCount: metrics.totalIssues,
                requestId: res.locals.requestId,
                persistence: dbEnabled ? 'percona' : 'jira-direct',
                lastSuccessAt,
                lastSyncedAt,
                fetchedAt,
                lastError: syncState?.last_error || null,
                stale,
                truncated: dbEnabled ? issues.length >= 10000 : issues.length >= env_1.env.JIRA_MAX_ISSUES,
                browseBaseUrl: dashboardContract_1.ATLASSIAN_BROWSE_BASE_URL,
            },
        });
    }
    catch (error) {
        next(error);
    }
}
