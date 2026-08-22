"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertJiraSnapshot = upsertJiraSnapshot;
exports.markSyncFailure = markSyncFailure;
exports.getStoredSnapshot = getStoredSnapshot;
exports.getStoredProjects = getStoredProjects;
exports.getSyncState = getSyncState;
const database_1 = require("./database");
function toMysqlDate(value) {
    return value ? new Date(value).toISOString().slice(0, 23).replace('T', ' ') : null;
}
async function upsertJiraSnapshot(projects, issues) {
    await (0, database_1.withDatabaseConnection)(async (connection) => {
        await connection.beginTransaction();
        try {
            for (const project of projects) {
                await connection.execute(`INSERT INTO jira_projects (id, project_key, name, project_type_key)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), project_type_key = VALUES(project_type_key)`, [project.id, project.key, project.name, project.projectTypeKey || null]);
            }
            for (const issue of issues) {
                if (!issue.project?.key || !issue.created || !issue.updated)
                    continue;
                await connection.execute(`INSERT INTO jira_issues
             (id, issue_key, project_key, summary, status, issue_type, priority, created_at, updated_at, resolved_at, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             project_key = VALUES(project_key), summary = VALUES(summary), status = VALUES(status),
             issue_type = VALUES(issue_type), priority = VALUES(priority), created_at = VALUES(created_at),
             updated_at = VALUES(updated_at), resolved_at = VALUES(resolved_at), raw_json = VALUES(raw_json)`, [
                    issue.id,
                    issue.key,
                    issue.project.key,
                    issue.summary,
                    typeof issue.status === 'string' ? issue.status : issue.status?.name || 'Unknown',
                    issue.issuetype?.name || null,
                    issue.priority?.name || null,
                    toMysqlDate(issue.created),
                    toMysqlDate(issue.updated),
                    toMysqlDate(issue.resolved),
                    JSON.stringify(issue),
                ]);
            }
            await connection.execute(`INSERT INTO jira_sync_state (source_name, last_synced_at, last_success_at, last_error)
         VALUES ('jira', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), NULL)
         ON DUPLICATE KEY UPDATE last_synced_at = VALUES(last_synced_at), last_success_at = VALUES(last_success_at), last_error = NULL`);
            await connection.commit();
        }
        catch (error) {
            await connection.rollback();
            throw error;
        }
    });
}
async function markSyncFailure(error) {
    await (0, database_1.withDatabaseConnection)((connection) => connection.execute(`INSERT INTO jira_sync_state (source_name, last_synced_at, last_error)
     VALUES ('jira', UTC_TIMESTAMP(3), ?)
     ON DUPLICATE KEY UPDATE last_synced_at = VALUES(last_synced_at), last_error = VALUES(last_error)`, [error instanceof Error ? error.message : 'Jira sync failed']).then(() => undefined));
}
async function getStoredSnapshot(filters = {}) {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const clauses = ['1 = 1'];
        const values = [];
        if (filters.projectKey) {
            clauses.push('i.project_key = ?');
            values.push(filters.projectKey);
        }
        if (filters.issueType) {
            clauses.push('i.issue_type = ?');
            values.push(filters.issueType);
        }
        if (filters.startDate) {
            clauses.push('i.created_at >= ?');
            values.push(`${filters.startDate} 00:00:00`);
        }
        if (filters.endDate) {
            clauses.push('i.created_at <= ?');
            values.push(`${filters.endDate} 23:59:59`);
        }
        if (!filters.startDate && !filters.endDate)
            clauses.push('i.created_at >= UTC_TIMESTAMP() - INTERVAL 30 DAY');
        const [rows] = await connection.execute(`SELECT id, issue_key, project_key, summary, status, issue_type, priority, created_at, updated_at, resolved_at
       FROM jira_issues i WHERE ${clauses.join(' AND ')} ORDER BY i.created_at DESC LIMIT 5000`, values);
        const issues = rows.map((row) => ({
            id: String(row.id), key: String(row.issue_key), project: { key: String(row.project_key) }, summary: String(row.summary),
            status: String(row.status), issuetype: row.issue_type ? { name: String(row.issue_type) } : undefined,
            priority: row.priority ? { name: String(row.priority) } : undefined,
            created: new Date(row.created_at).toISOString(), updated: new Date(row.updated_at).toISOString(),
            resolved: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
        }));
        return issues;
    });
}
async function getStoredProjects() {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const [rows] = await connection.query('SELECT id, project_key AS `key`, name, project_type_key AS projectTypeKey FROM jira_projects ORDER BY name');
        return rows;
    });
}
async function getSyncState() {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const [rows] = await connection.query('SELECT source_name, last_synced_at, last_success_at, last_error FROM jira_sync_state WHERE source_name = \'jira\'');
        return rows[0] || null;
    });
}
