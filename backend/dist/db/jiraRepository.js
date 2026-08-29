"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.upsertJiraSnapshot = upsertJiraSnapshot;
exports.markSyncFailure = markSyncFailure;
exports.getStoredSnapshot = getStoredSnapshot;
exports.getStoredIssuesPage = getStoredIssuesPage;
exports.getStoredEpics = getStoredEpics;
exports.getStoredProjects = getStoredProjects;
exports.getStoredSprints = getStoredSprints;
exports.getStoredIssueTypes = getStoredIssueTypes;
exports.getStoredStatuses = getStoredStatuses;
exports.getSyncState = getSyncState;
const database_1 = require("./database");
const analytics_1 = require("../shared/analytics");
const dashboardContract_1 = require("../shared/dashboardContract");
function toMysqlDate(value) {
    return value ? new Date(value).toISOString().slice(0, 23).replace('T', ' ') : null;
}
function asIso(value) {
    if (!value)
        return null;
    return new Date(String(value)).toISOString();
}
async function upsertJiraSnapshot(input) {
    await (0, database_1.withDatabaseConnection)(async (connection) => {
        await connection.beginTransaction();
        try {
            for (const project of input.projects) {
                await connection.execute(`INSERT INTO jira_projects (id, project_key, name, project_type_key)
           VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), project_type_key = VALUES(project_type_key)`, [project.id, project.key, project.name, project.projectTypeKey || null]);
            }
            for (const sprint of input.sprints) {
                await connection.execute(`INSERT INTO jira_sprints (id, board_id, name, state, start_date, end_date, complete_date)
           VALUES (?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), state = VALUES(state), start_date = VALUES(start_date),
             end_date = VALUES(end_date), complete_date = VALUES(complete_date)`, [sprint.id, sprint.boardId || null, sprint.name, sprint.state,
                    toMysqlDate(sprint.startDate), toMysqlDate(sprint.endDate), toMysqlDate(sprint.completeDate)]);
            }
            for (const issueType of input.issueTypes) {
                await connection.execute(`INSERT INTO jira_issue_types (id, name, description) VALUES (?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), description = VALUES(description)`, [issueType.id, issueType.name, issueType.description || null]);
            }
            for (const status of input.statuses) {
                await connection.execute(`INSERT INTO jira_statuses (id, name, category_key, category_name) VALUES (?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE name = VALUES(name), category_key = VALUES(category_key), category_name = VALUES(category_name)`, [status.id, status.name, status.statusCategory?.key || null, status.statusCategory?.name || null]);
            }
            let newestIssueUpdate = null;
            for (const issue of input.issues) {
                if (!issue.projectKey || !issue.created || !issue.updated)
                    continue;
                if (!newestIssueUpdate || issue.updated > newestIssueUpdate)
                    newestIssueUpdate = issue.updated;
                await connection.execute(`INSERT INTO jira_issues
             (id, issue_key, project_key, summary, status, status_category, issue_type, priority, assignee,
              story_points, flagged, labels_json, components_json, license_bu_json, audit_type_json, application_json,
              epic_key, epic_name, created_at, updated_at, resolved_at, in_progress_at, last_status_changed_at, raw_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON DUPLICATE KEY UPDATE
             project_key = VALUES(project_key), summary = VALUES(summary), status = VALUES(status),
             status_category = VALUES(status_category), issue_type = VALUES(issue_type), priority = VALUES(priority),
             assignee = VALUES(assignee), story_points = VALUES(story_points), flagged = VALUES(flagged),
             labels_json = VALUES(labels_json), components_json = VALUES(components_json),
             license_bu_json = VALUES(license_bu_json), audit_type_json = VALUES(audit_type_json),
             application_json = VALUES(application_json), epic_key = VALUES(epic_key), epic_name = VALUES(epic_name),
             created_at = VALUES(created_at), updated_at = VALUES(updated_at), resolved_at = VALUES(resolved_at),
             in_progress_at = VALUES(in_progress_at), last_status_changed_at = VALUES(last_status_changed_at),
             raw_json = VALUES(raw_json)`, [
                    issue.id,
                    issue.key,
                    issue.projectKey,
                    issue.summary,
                    issue.status,
                    issue.statusCategory || null,
                    issue.issueType || null,
                    issue.priority || null,
                    issue.assignee || null,
                    issue.storyPoints ?? null,
                    issue.flagged ? 1 : 0,
                    JSON.stringify(issue.labels || []),
                    JSON.stringify(issue.components || []),
                    JSON.stringify(issue.licenseBu || []),
                    JSON.stringify(issue.auditType || []),
                    JSON.stringify(issue.application || []),
                    issue.epicKey || null,
                    issue.epicName || null,
                    toMysqlDate(issue.created),
                    toMysqlDate(issue.updated),
                    toMysqlDate(issue.resolved),
                    toMysqlDate(issue.inProgressAt),
                    toMysqlDate(issue.lastStatusChangedAt),
                    JSON.stringify(issue),
                ]);
                if (issue.sprintIds) {
                    await connection.execute('DELETE FROM jira_issue_sprints WHERE issue_id = ?', [issue.id]);
                    for (const sprintId of issue.sprintIds) {
                        await connection.execute('INSERT INTO jira_issue_sprints (issue_id, sprint_id) VALUES (?, ?) ON DUPLICATE KEY UPDATE sprint_id = VALUES(sprint_id)', [issue.id, sprintId]);
                    }
                }
            }
            await connection.execute(`INSERT INTO jira_sync_state (source_name, last_synced_at, last_success_at, last_issue_updated_at, last_error)
         VALUES ('jira', UTC_TIMESTAMP(3), UTC_TIMESTAMP(3), ?, NULL)
         ON DUPLICATE KEY UPDATE last_synced_at = VALUES(last_synced_at), last_success_at = VALUES(last_success_at),
           last_issue_updated_at = COALESCE(VALUES(last_issue_updated_at), last_issue_updated_at), last_error = NULL`, [toMysqlDate(newestIssueUpdate)]);
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
function issueWhere(filters) {
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
    if (filters.sprintId) {
        clauses.push('EXISTS (SELECT 1 FROM jira_issue_sprints s WHERE s.issue_id = i.id AND s.sprint_id = ?)');
        values.push(filters.sprintId);
    }
    if (filters.label === dashboardContract_1.UNTAGGED_LABEL) {
        clauses.push('(i.labels_json IS NULL OR JSON_LENGTH(i.labels_json) = 0)');
    }
    else if (filters.label) {
        clauses.push('JSON_CONTAINS(i.labels_json, JSON_QUOTE(?), \'$\')');
        values.push(filters.label);
    }
    if (filters.epicKey) {
        clauses.push('i.epic_key = ?');
        values.push(filters.epicKey);
    }
    if (filters.licenseBu) {
        clauses.push('JSON_CONTAINS(i.license_bu_json, JSON_QUOTE(?), \'$\')');
        values.push(filters.licenseBu);
    }
    if (filters.auditType) {
        clauses.push('JSON_CONTAINS(i.audit_type_json, JSON_QUOTE(?), \'$\')');
        values.push(filters.auditType);
    }
    if (filters.application) {
        clauses.push('JSON_CONTAINS(i.application_json, JSON_QUOTE(?), \'$\')');
        values.push(filters.application);
    }
    if (filters.startDate) {
        clauses.push('i.created_at >= ?');
        values.push(`${filters.startDate} 00:00:00`);
    }
    if (filters.endDate) {
        clauses.push('i.created_at < ?');
        values.push(`${(0, analytics_1.shiftIsoDate)(filters.endDate, 1)} 00:00:00`);
    }
    return { sql: clauses.join(' AND '), values };
}
function parseJsonStringList(value) {
    if (Array.isArray(value))
        return value.map(String).filter(Boolean);
    if (typeof value !== 'string' || !value.trim())
        return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    }
    catch {
        return [];
    }
}
function mapIssueRow(row, sprintIds = []) {
    return {
        id: String(row.id),
        key: String(row.issue_key),
        projectKey: String(row.project_key),
        summary: String(row.summary),
        status: String(row.status),
        statusCategory: row.status_category ? String(row.status_category) : undefined,
        issueType: row.issue_type ? String(row.issue_type) : undefined,
        assignee: row.assignee ? String(row.assignee) : null,
        storyPoints: row.story_points == null ? null : Number(row.story_points),
        flagged: Boolean(row.flagged),
        priority: row.priority ? String(row.priority) : null,
        labels: parseJsonStringList(row.labels_json),
        components: parseJsonStringList(row.components_json),
        licenseBu: parseJsonStringList(row.license_bu_json),
        auditType: parseJsonStringList(row.audit_type_json),
        application: parseJsonStringList(row.application_json),
        epicKey: row.epic_key ? String(row.epic_key) : null,
        epicName: row.epic_name ? String(row.epic_name) : null,
        created: new Date(row.created_at).toISOString(),
        updated: new Date(row.updated_at).toISOString(),
        resolved: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
        inProgressAt: row.in_progress_at ? new Date(row.in_progress_at).toISOString() : null,
        lastStatusChangedAt: row.last_status_changed_at ? new Date(row.last_status_changed_at).toISOString() : null,
        sprintIds,
    };
}
async function getStoredSnapshot(filters = {}) {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const { sql, values } = issueWhere(filters);
        const [rows] = await connection.execute(`SELECT id, issue_key, project_key, summary, status, status_category, issue_type, priority, assignee, story_points,
              flagged, labels_json, components_json, license_bu_json, audit_type_json, application_json, epic_key, epic_name,
              created_at, updated_at, resolved_at, in_progress_at, last_status_changed_at
       FROM jira_issues i WHERE ${sql} ORDER BY i.updated_at DESC LIMIT 10000`, values);
        if (!rows.length)
            return [];
        const ids = rows.map((row) => String(row.id));
        const [sprintRows] = await connection.query(`SELECT issue_id, sprint_id FROM jira_issue_sprints WHERE issue_id IN (${ids.map(() => '?').join(',')})`, ids);
        const sprintMap = new Map();
        sprintRows.forEach((row) => {
            const list = sprintMap.get(String(row.issue_id)) || [];
            list.push(Number(row.sprint_id));
            sprintMap.set(String(row.issue_id), list);
        });
        return rows.map((row) => mapIssueRow(row, sprintMap.get(String(row.id)) || []));
    });
}
async function getStoredIssuesPage(filters = {}, page = 1, pageSize = 25, orderBy = 'i.updated_at DESC') {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const { sql, values } = issueWhere(filters);
        const [countRows] = await connection.execute(`SELECT COUNT(*) AS total FROM jira_issues i WHERE ${sql}`, values);
        const total = Number(countRows[0]?.total || 0);
        const safePageSize = Math.min(100, Math.max(1, Math.trunc(pageSize)));
        const offset = Math.max(0, (Math.max(1, Math.trunc(page)) - 1) * safePageSize);
        const allowedOrder = new Set([
            'i.updated_at DESC', 'i.updated_at ASC',
            'i.created_at DESC', 'i.created_at ASC',
            'i.issue_key ASC', 'i.issue_key DESC',
        ]);
        const sortSql = allowedOrder.has(orderBy) ? orderBy : 'i.updated_at DESC';
        const [rows] = await connection.execute(`SELECT id, issue_key, project_key, summary, status, status_category, issue_type, assignee, story_points,
              flagged, created_at, updated_at, resolved_at, in_progress_at, last_status_changed_at
       FROM jira_issues i WHERE ${sql} ORDER BY ${sortSql} LIMIT ${safePageSize} OFFSET ${offset}`, values);
        return { total, issues: rows.map((row) => mapIssueRow(row)) };
    });
}
async function getStoredEpics() {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const [rows] = await connection.query(`SELECT epic_key AS \`key\`, MAX(epic_name) AS name
       FROM jira_issues WHERE epic_key IS NOT NULL AND epic_key <> ''
       GROUP BY epic_key ORDER BY name`);
        return rows.map((row) => ({ key: String(row.key), name: String(row.name || row.key) }));
    });
}
async function getStoredProjects() {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const [rows] = await connection.query('SELECT id, project_key AS `key`, name, project_type_key AS projectTypeKey FROM jira_projects ORDER BY name');
        return rows;
    });
}
async function getStoredSprints() {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const [rows] = await connection.query('SELECT id, name, state, start_date AS startDate, end_date AS endDate, complete_date AS completeDate FROM jira_sprints ORDER BY COALESCE(complete_date, end_date, start_date) DESC');
        return rows.map((row) => ({
            id: Number(row.id),
            name: String(row.name),
            state: String(row.state),
            startDate: asIso(row.startDate) || undefined,
            endDate: asIso(row.endDate) || undefined,
            completeDate: asIso(row.completeDate) || undefined,
        }));
    });
}
async function getStoredIssueTypes() {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const [rows] = await connection.query('SELECT id, name, description FROM jira_issue_types ORDER BY name');
        return rows;
    });
}
async function getStoredStatuses() {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const [rows] = await connection.query('SELECT id, name, category_key, category_name FROM jira_statuses ORDER BY name');
        return rows.map((row) => ({
            id: String(row.id),
            name: String(row.name),
            statusCategory: { key: String(row.category_key || ''), name: String(row.category_name || '') },
        }));
    });
}
async function getSyncState() {
    return (0, database_1.withDatabaseConnection)(async (connection) => {
        const [rows] = await connection.query('SELECT source_name, last_synced_at, last_success_at, last_issue_updated_at, last_error FROM jira_sync_state WHERE source_name = \'jira\'');
        return rows[0] || null;
    });
}
