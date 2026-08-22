import fs from 'node:fs/promises';
import path from 'node:path';
import mysql, { Pool, PoolConnection } from 'mysql2/promise';
import { env } from '../config/env';

let pool: Pool | null = null;

function quoteIdentifier(identifier: string) {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

export function isDatabaseEnabled() {
  return env.DB_ENABLED;
}

export function getDatabasePool() {
  if (!env.DB_ENABLED) return null;
  if (!pool) {
    pool = mysql.createPool({
      host: env.DB_HOST,
      port: env.DB_PORT,
      user: env.DB_USER,
      password: env.DB_PASSWORD,
      database: env.DB_NAME,
      waitForConnections: true,
      connectionLimit: env.DB_CONNECTION_LIMIT,
      queueLimit: 0,
      ssl: env.DB_SSL ? { rejectUnauthorized: env.DB_SSL_VERIFY } : undefined,
      timezone: 'Z',
      enableKeepAlive: true,
    });
  }
  return pool;
}

async function createDatabaseIfNeeded() {
  const bootstrapPool = mysql.createPool({
    host: env.DB_HOST,
    port: env.DB_PORT,
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    waitForConnections: true,
    connectionLimit: 1,
    ssl: env.DB_SSL ? { rejectUnauthorized: env.DB_SSL_VERIFY } : undefined,
    timezone: 'Z',
  });

  try {
    await bootstrapPool.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(env.DB_NAME)} CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  } finally {
    await bootstrapPool.end();
  }
}

export async function withDatabaseConnection<T>(operation: (connection: PoolConnection) => Promise<T>) {
  const database = getDatabasePool();
  if (!database) throw new Error('Percona database is not enabled. Set DB_ENABLED=true.');
  const connection = await database.getConnection();
  try {
    return await operation(connection);
  } finally {
    connection.release();
  }
}

export async function initializeDatabase() {
  if (!env.DB_ENABLED) return;
  if (env.DB_AUTO_CREATE) await createDatabaseIfNeeded();
  const database = getDatabasePool();
  if (!database) return;
  const schema = await fs.readFile(path.join(__dirname, 'schema.sql'), 'utf8');
  for (const statement of schema.split(';').map((part) => part.trim()).filter(Boolean)) {
    await database.query(statement);
  }
}

export async function checkDatabase() {
  const database = getDatabasePool();
  if (!database) return { enabled: false, connected: false };
  try {
    await database.query('SELECT 1');
    return { enabled: true, connected: true };
  } catch (error) {
    return { enabled: true, connected: false, error: error instanceof Error ? error.message : 'database check failed' };
  }
}
