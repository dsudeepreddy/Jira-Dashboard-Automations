"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syncJiraHandler = syncJiraHandler;
const jiraClient_1 = require("../services/jiraClient");
const jiraRepository_1 = require("../db/jiraRepository");
const database_1 = require("../db/database");
async function syncJiraHandler(_req, res, next) {
    try {
        if (!(0, database_1.isDatabaseEnabled)()) {
            return res.status(503).json({
                type: 'https://api.example.com/problems/database-disabled',
                title: 'Percona persistence is disabled',
                status: 503,
                detail: 'Set DB_ENABLED=true to enable Jira snapshot persistence.',
                code: 'DATABASE_DISABLED',
                requestId: res.locals.requestId,
            });
        }
        const [projects, issues] = await Promise.all([
            jiraClient_1.jiraClient.getProjects(),
            jiraClient_1.jiraClient.searchIssues(),
        ]);
        await (0, jiraRepository_1.upsertJiraSnapshot)(projects, issues);
        return res.status(202).json({ status: 'accepted', source: 'jira', projects: projects.length, issues: issues.length, requestId: res.locals.requestId });
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
