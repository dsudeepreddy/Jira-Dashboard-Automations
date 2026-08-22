"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.isDatabaseEnabled = isDatabaseEnabled;
exports.getDatabasePool = getDatabasePool;
exports.withDatabaseConnection = withDatabaseConnection;
exports.initializeDatabase = initializeDatabase;
exports.checkDatabase = checkDatabase;
const promises_1 = __importDefault(require("node:fs/promises"));
const node_path_1 = __importDefault(require("node:path"));
const promise_1 = __importDefault(require("mysql2/promise"));
const env_1 = require("../config/env");
let pool = null;
function quoteIdentifier(identifier) {
    return `\`${identifier.replace(/`/g, '``')}\``;
}
function isDatabaseEnabled() {
    return env_1.env.DB_ENABLED;
}
function getDatabasePool() {
    if (!env_1.env.DB_ENABLED)
        return null;
    if (!pool) {
        pool = promise_1.default.createPool({
            host: env_1.env.DB_HOST,
            port: env_1.env.DB_PORT,
            user: env_1.env.DB_USER,
            password: env_1.env.DB_PASSWORD,
            database: env_1.env.DB_NAME,
            waitForConnections: true,
            connectionLimit: env_1.env.DB_CONNECTION_LIMIT,
            queueLimit: 0,
            ssl: env_1.env.DB_SSL ? { rejectUnauthorized: env_1.env.DB_SSL_VERIFY } : undefined,
            timezone: 'Z',
            enableKeepAlive: true,
        });
    }
    return pool;
}
async function createDatabaseIfNeeded() {
    const bootstrapPool = promise_1.default.createPool({
        host: env_1.env.DB_HOST,
        port: env_1.env.DB_PORT,
        user: env_1.env.DB_USER,
        password: env_1.env.DB_PASSWORD,
        waitForConnections: true,
        connectionLimit: 1,
        ssl: env_1.env.DB_SSL ? { rejectUnauthorized: env_1.env.DB_SSL_VERIFY } : undefined,
        timezone: 'Z',
    });
    try {
        await bootstrapPool.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(env_1.env.DB_NAME)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    }
    finally {
        await bootstrapPool.end();
    }
}
async function withDatabaseConnection(operation) {
    const database = getDatabasePool();
    if (!database)
        throw new Error('Percona database is not enabled. Set DB_ENABLED=true.');
    const connection = await database.getConnection();
    try {
        return await operation(connection);
    }
    finally {
        connection.release();
    }
}
async function ensureColumn(database, table, column, definition) {
    const [rows] = await database.query(`SELECT COUNT(*) AS present FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`, [env_1.env.DB_NAME, table, column]);
    if (Number(rows[0]?.present || 0) === 0) {
        await database.query(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}`);
    }
}
async function initializeDatabase() {
    if (!env_1.env.DB_ENABLED)
        return;
    if (env_1.env.DB_AUTO_CREATE)
        await createDatabaseIfNeeded();
    const database = getDatabasePool();
    if (!database)
        return;
    const schema = await promises_1.default.readFile(node_path_1.default.join(__dirname, 'schema.sql'), 'utf8');
    for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
        await database.query(statement);
    }
    await ensureColumn(database, 'jira_issues', 'status_category', 'VARCHAR(64) NULL');
    await ensureColumn(database, 'jira_issues', 'assignee', 'VARCHAR(255) NULL');
    await ensureColumn(database, 'jira_issues', 'story_points', 'DECIMAL(10,2) NULL');
    await ensureColumn(database, 'jira_issues', 'flagged', 'TINYINT(1) NOT NULL DEFAULT 0');
    await ensureColumn(database, 'jira_issues', 'in_progress_at', 'DATETIME(3) NULL');
    await ensureColumn(database, 'jira_issues', 'last_status_changed_at', 'DATETIME(3) NULL');
    await ensureColumn(database, 'jira_sync_state', 'last_issue_updated_at', 'DATETIME(3) NULL');
}
async function checkDatabase() {
    const database = getDatabasePool();
    if (!database)
        return { enabled: false, connected: false };
    try {
        await database.query('SELECT 1');
        return { enabled: true, connected: true };
    }
    catch (error) {
        return { enabled: true, connected: false, error: error instanceof Error ? error.message : 'database check failed' };
    }
}
