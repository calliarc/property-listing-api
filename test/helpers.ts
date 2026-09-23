import { buildApp } from '../src/app.js';
import { loadConfig, type Config } from '../src/config.js';
import type { Db } from '../src/db/pool.js';

export const TEST_API_KEY = 'test-key-not-a-secret';

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    ...loadConfig({}),
    apiKeys: [TEST_API_KEY],
    rateLimitMax: 10_000,
    corsOrigin: ['https://maps.example.com'],
    ...overrides,
  };
}

export interface FakeDb extends Db {
  calls: { text: string; values?: unknown[] }[];
}

/** A stand-in for pg.Pool that records queries and returns empty results. */
export function fakeDb(rows: unknown[] = []): FakeDb {
  const calls: FakeDb['calls'] = [];
  return {
    calls,
    query: (async (text: string, values?: unknown[]) => {
      calls.push({ text, values });
      return { rows, rowCount: rows.length };
    }) as unknown as Db['query'],
    connect: (async () => {
      throw new Error('not supported in fake db');
    }) as unknown as Db['connect'],
    end: (async () => undefined) as unknown as Db['end'],
  };
}

export async function appWith(db: Db, overrides: Partial<Config> = {}) {
  const app = await buildApp({ config: testConfig(overrides), db, logger: false });
  await app.ready();
  return app;
}
