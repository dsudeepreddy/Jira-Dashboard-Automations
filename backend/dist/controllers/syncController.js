"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runJiraSync = runJiraSync;
exports.syncJiraHandler = syncJiraHandler;
exports.jiraWebhookHandler = jiraWebhookHandler;
const jiraClient_1 = require("../services/jiraClient");
const jiraRepository_1 = require("../db/jiraRepository");
const database_1 = require("../db/database");
const redisClient_1 = require("../cache/redisClient");
async function runJiraSync(full = false) {
    if (!(0, database_1.isDatabaseEnabled)()) {
        const error = Object.assign(new Error('Set DB_ENABLED=true to enable Jira snapshot persistence.'), {
            statusCode: 503,
            code: 'DATABASE_DISABLED',
        });
        throw error;
    }
    const [projects, issueTypes, statuses, agileSprints, syncState] = await Promise.all([
        jiraClient_1.jiraClient.getProjects(),
        jiraClient_1.jiraClient.getIssueTypes(),
        jiraClient_1.jiraClient.getIssueStatuses(),
        jiraClient_1.jiraClient.getSprints().catch(() => []),
        (0, jiraRepository_1.getSyncState)(),
    ]);
    jiraClient_1.jiraClient.setStatusLookup(statuses);
    const updatedSince = !full && syncState?.last_issue_updated_at
        ? new Date(new Date(syncState.last_issue_updated_at).getTime() - 5 * 60 * 1000).toISOString()
        : undefined;
    const { issues, sprints: issueSprints } = await jiraClient_1.jiraClient.searchIssues({
        updatedSince,
        unbounded: full,
    });
    const sprints = [...new Map([...agileSprints, ...issueSprints].map((sprint) => [sprint.id, sprint])).values()];
    await (0, jiraRepository_1.upsertJiraSnapshot)({ projects, issues, sprints, issueTypes, statuses });
    await redisClient_1.redisCache.del('jira:projects');
    await redisClient_1.redisCache.del('jira:sprints');
    await redisClient_1.redisCache.del('jira:issueTypes');
    await redisClient_1.redisCache.del('jira:statuses');
    return { projects: projects.length, issues: issues.length, sprints: sprints.length, incremental: Boolean(updatedSince) };
}
async function syncJiraHandler(req, res, next) {
    try {
        const full = req.query.full === 'true' || req.query.full === '1';
        const result = await runJiraSync(full);
        return res.status(202).json({ status: 'accepted', source: 'jira', ...result, requestId: res.locals.requestId });
    }
    catch (error) {
        try {
            await (0, jiraRepository_1.markSyncFailure)(error);
        }
        catch (databaseError) {
            console.error(JSON.stringify({ event: 'sync_state_write_failed', error: databaseError instanceof Error ? databaseError.message : 'unknown' }));
        }
        next(error);
    }
}
async function jiraWebhookHandler(_req, res) {
    res.status(202).json({ status: 'accepted', source: 'jira-webhook', requestId: res.locals.requestId });
    void runJiraSync(false).then((result) => {
        console.log(JSON.stringify({ event: 'webhook_sync_completed', ...result }));
    }).catch(async (error) => {
        try {
            await (0, jiraRepository_1.markSyncFailure)(error);
        }
        catch { /* already logged by caller */ }
        console.error(JSON.stringify({
            event: 'webhook_sync_failed',
            error: error instanceof Error ? error.message : 'unknown',
        }));
    });
}
