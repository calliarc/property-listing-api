import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadConfig } from '../config.js';
import { createPool } from './pool.js';

const here = path.dirname(fileURLToPath(import.meta.url));
// Works from both src/db (tsx) and dist/db (compiled): migrations/ lives at the repo root.
export const MIGRATIONS_DIR = path.resolve(here, '..', '..', 'migrations');

const LOCK_ID = 727_001;

/** Applies pending *.sql files from the migrations folder in filename order, each in its own transaction. */
export async function migrate(pool: pg.Pool, dir = MIGRATIONS_DIR, log: (msg: string) => void = console.log): Promise<string[]> {
  const client = await pool.connect();
  const applied: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_ID]);
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )`);
    const done = new Set((await client.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
    const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    for (const file of files) {
      if (done.has(file)) continue;
      const sql = await readFile(path.join(dir, file), 'utf8');
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      }
      applied.push(file);
      log(`applied ${file}`);
    }
    if (applied.length === 0) log('no pending migrations');
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_ID]).catch(() => undefined);
    client.release();
  }
  return applied;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, 1);
  migrate(pool)
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err instanceof Error ? err.message : err);
      await pool.end();
      process.exit(1);
    });
}
