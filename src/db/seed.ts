/**
 * Seeds the database with SYNTHETIC demo data. Every address, agent, email and phone
 * number is fictional ("Example Street", "@example.com", 555-01xx numbers).
 * Coordinates are random points around a few metro areas so map searches look realistic.
 *
 * Usage: npm run seed -- [--count 200] [--reset]
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type pg from 'pg';
import { loadConfig } from '../config.js';
import { LISTING_STATUSES, PROPERTY_TYPES } from '../schemas/listing.js';
import { createPool } from './pool.js';

/** Small deterministic PRNG (mulberry32) so seed output is reproducible. */
export function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const DEMO_AREAS = [
  { city: 'Sampleton', region: 'Demo North', lat: 30.2672, lng: -97.7431 },
  { city: 'Mockford', region: 'Demo West', lat: 39.7392, lng: -104.9903 },
  { city: 'Fictionville', region: 'Demo Coast', lat: 47.6062, lng: -122.3321 },
  { city: 'Placeholder Bay', region: 'Demo South', lat: 25.7617, lng: -80.1918 },
];

const STREETS = ['Example', 'Sample', 'Placeholder', 'Demo', 'Mock', 'Test', 'Fictional', 'Imaginary'];
const SUFFIXES = ['Street', 'Avenue', 'Lane', 'Court', 'Way', 'Drive'];
const FIRST = ['Alex', 'Sam', 'Jordan', 'Taylor', 'Casey', 'Riley', 'Morgan', 'Jamie'];
const ADJECTIVES = ['Sunny', 'Spacious', 'Modern', 'Cozy', 'Renovated', 'Charming', 'Bright', 'Quiet'];

export interface SeedOptions {
  count?: number;
  agents?: number;
  reset?: boolean;
  seed?: number;
}

export async function seed(pool: pg.Pool, opts: SeedOptions = {}): Promise<{ agents: number; listings: number; media: number }> {
  const { count = 200, agents: agentCount = 8, reset = false, seed: seedValue = 42 } = opts;
  const rand = prng(seedValue);
  const pick = <T>(arr: readonly T[]): T => arr[Math.floor(rand() * arr.length)]!;
  const between = (min: number, max: number) => Math.floor(min + rand() * (max - min + 1));

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if (reset) await client.query('TRUNCATE listing_media, listings, agents');

    const agentIds: string[] = [];
    for (let i = 0; i < agentCount; i++) {
      const name = `${FIRST[i % FIRST.length]} Example ${i + 1}`;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO agents (name, email, phone, brokerage, license_number)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (email) DO UPDATE SET name = EXCLUDED.name
         RETURNING id`,
        [name, `agent${i + 1}@example.com`, `+1-555-01${String(i).padStart(2, '0')}`, 'Demo Realty (fictional)', `DEMO-${1000 + i}`],
      );
      agentIds.push(rows[0]!.id);
    }

    let media = 0;
    for (let i = 0; i < count; i++) {
      const area = DEMO_AREAS[i % DEMO_AREAS.length]!;
      const type = pick(PROPERTY_TYPES);
      const isLand = type === 'land';
      const beds = isLand || type === 'commercial' ? null : between(0, 6);
      const baths = beds === null ? null : Math.max(1, between(2, 8) / 2);
      const sqft = isLand ? null : between(450, 5200);
      const price = Math.round((isLand ? between(40, 600) : between(150, 2500)) * 1000);
      // ~0.15 degrees jitter (roughly 15 km) around the metro centre
      const lat = area.lat + (rand() - 0.5) * 0.3;
      const lng = area.lng + (rand() - 0.5) * 0.3;
      const street = `${between(1, 9999)} ${pick(STREETS)} ${pick(SUFFIXES)}`;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO listings (agent_id, title, description, property_type, status, price, beds, baths, sqft, year_built,
           address_line1, city, region, postal_code, country, location)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, 'US',
           ST_SetSRID(ST_MakePoint($15, $16), 4326)::geography)
         RETURNING id`,
        [
          pick(agentIds),
          `${pick(ADJECTIVES)} ${type.replace('_', ' ')} in ${area.city}`,
          'Synthetic demo listing. This property does not exist.',
          type,
          rand() < 0.75 ? 'active' : pick(LISTING_STATUSES),
          price,
          beds,
          baths,
          sqft,
          isLand ? null : between(1920, 2024),
          street,
          area.city,
          area.region,
          `D${String(between(0, 9999)).padStart(4, '0')}`,
          lng,
          lat,
        ],
      );
      const photos = between(0, 3);
      for (let j = 0; j < photos; j++) {
        await client.query(
          `INSERT INTO listing_media (listing_id, media_type, url, caption, position) VALUES ($1, 'image', $2, $3, $4)`,
          [rows[0]!.id, `https://picsum.photos/seed/${rows[0]!.id.slice(0, 8)}-${j}/1200/800`, `Demo photo ${j + 1}`, j],
        );
        media++;
      }
    }
    await client.query('COMMIT');
    return { agents: agentCount, listings: count, media };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

function parseArgs(argv: string[]): SeedOptions {
  const opts: SeedOptions = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--reset') opts.reset = true;
    else if (argv[i] === '--count') opts.count = Number.parseInt(argv[++i] ?? '', 10);
  }
  if (opts.count !== undefined && (!Number.isInteger(opts.count) || opts.count < 0)) {
    throw new Error('--count must be a non-negative integer');
  }
  return opts;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl, 1);
  seed(pool, parseArgs(process.argv.slice(2)))
    .then((r) => console.log(`seeded ${r.agents} agents, ${r.listings} listings, ${r.media} media items (synthetic data)`))
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err instanceof Error ? err.message : err);
      await pool.end();
      process.exit(1);
    });
}
