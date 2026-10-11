import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { PLATFORM_SCHEMA } from './schema.mjs';

export function openPlatformDatabase(filename) {
  if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
  const db = new DatabaseSync(filename);
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  db.exec(PLATFORM_SCHEMA);
  for (const statement of [
    'ALTER TABLE players ADD COLUMN failed_login_count INTEGER NOT NULL DEFAULT 0',
    'ALTER TABLE players ADD COLUMN login_locked_until TEXT',
  ]) { try { db.exec(statement); } catch { /* already migrated */ } }
  return db;
}

export function inTransaction(db, work) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
