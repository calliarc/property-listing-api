/**
 * Integration tests against a real PostgreSQL + PostGIS database.
 * Skipped unless DATABASE_URL is set. WARNING: truncates the agents/listings/media tables.
 *
 *   DATABASE_URL=postgres://postgres:postgres@localhost:5432/property_listing_test npm run test:integration
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type pg from 'pg';
import { createPool } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { seed } from '../../src/db/seed.js';
import { appWith, TEST_API_KEY } from '../helpers.js';

const DATABASE_URL = process.env.DATABASE_URL;
const auth = { 'x-api-key': TEST_API_KEY };

// Reference point: a fictional downtown. Offsets of 0.01 deg latitude are ~1.11 km.
const CENTER = { lat: 40.0, lng: -100.0 };

describe.skipIf(!DATABASE_URL)('API integration (PostgreSQL + PostGIS)', () => {
  let pool: pg.Pool;
  let app: Awaited<ReturnType<typeof appWith>>;
  let agentId: string;
  const ids: Record<string, string> = {};

  const listing = (name: string, dLat: number, dLng: number, extra: Record<string, unknown> = {}) => ({
    title: `Test ${name}`,
    property_type: 'house',
    price: 300000,
    beds: 3,
    baths: 2,
    sqft: 1500,
    address: { line1: `${name} Example Street`, city: 'Testville', region: 'Demo' },
    location: { lat: CENTER.lat + dLat, lng: CENTER.lng + dLng },
    ...extra,
  });

  beforeAll(async () => {
    pool = createPool(DATABASE_URL!, Number.parseInt(process.env.DB_POOL_MAX ?? '4', 10));
    await migrate(pool, undefined, () => undefined);
    await pool.query('TRUNCATE listing_media, listings, agents');
    app = await appWith(pool);

    const agent = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: auth,
      payload: { name: 'Pat Example', email: 'Pat@Example.com', brokerage: 'Demo Realty' },
    });
    expect(agent.statusCode).toBe(201);
    agentId = agent.json().id;

    const fixtures = {
      center: listing('center', 0, 0, { agent_id: agentId, price: 500000, beds: 4 }),
      near: listing('near', 0.01, 0, { property_type: 'condo', price: 250000, beds: 2 }),
      mid: listing('mid', 0.05, 0, { price: 750000, beds: 5, status: 'pending' }),
      far: listing('far', 0.5, 0.5, { property_type: 'land', beds: null, baths: null, sqft: null, price: 90000 }),
      west: listing('west', 0, -0.2, { property_type: 'apartment', price: 1200000 }),
    };
    for (const [key, body] of Object.entries(fixtures)) {
      const res = await app.inject({ method: 'POST', url: '/v1/listings', headers: auth, payload: body });
      expect(res.statusCode, res.body).toBe(201);
      ids[key] = res.json().id;
    }
  });

  afterAll(async () => {
    await app?.close();
    await pool?.end();
  });

  it('migrations are idempotent', async () => {
    expect(await migrate(pool, undefined, () => undefined)).toEqual([]);
  });

  it('health reports database up', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toMatchObject({ status: 'ok', database: 'up' });
  });

  it('creates and reads a listing with location', async () => {
    const res = await app.inject({ method: 'GET', url: `/v1/listings/${ids.center}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({
      title: 'Test center',
      price: 500000,
      baths: 2,
      status: 'active',
      currency: 'USD',
      agent_id: agentId,
      address: { line1: 'center Example Street', city: 'Testville', country: 'US' },
    });
    expect(body.location.lat).toBeCloseTo(CENTER.lat, 6);
    expect(body.location.lng).toBeCloseTo(CENTER.lng, 6);
    expect(body.media).toEqual([]);
  });

  it('lists with filters, sorting and pagination', async () => {
    const all = await app.inject({ method: 'GET', url: '/v1/listings?limit=2&sort=price' });
    expect(all.json().meta).toEqual({ page: 1, limit: 2, total: 5, total_pages: 3 });
    expect(all.json().data.map((l: { price: number }) => l.price)).toEqual([90000, 250000]);

    const page3 = await app.inject({ method: 'GET', url: '/v1/listings?limit=2&page=3&sort=price' });
    expect(page3.json().data).toHaveLength(1);

    const beyond = await app.inject({ method: 'GET', url: '/v1/listings?limit=2&page=10' });
    expect(beyond.json()).toMatchObject({ data: [], meta: { total: 5 } });

    const filtered = await app.inject({
      method: 'GET',
      url: '/v1/listings?min_price=200000&max_price=800000&min_beds=3&status=active,pending&sort=-price',
    });
    expect(filtered.json().data.map((l: { title: string }) => l.title)).toEqual(['Test mid', 'Test center']);

    const byType = await app.inject({ method: 'GET', url: '/v1/listings?property_type=condo,land' });
    expect(byType.json().meta.total).toBe(2);

    const byAgent = await app.inject({ method: 'GET', url: `/v1/listings?agent_id=${agentId}&city=testville` });
    expect(byAgent.json().data.map((l: { id: string }) => l.id)).toEqual([ids.center]);

    const baths = await app.inject({ method: 'GET', url: '/v1/listings?min_baths=2&max_sqft=1500' });
    expect(baths.json().meta.total).toBe(4);
  });

  it('radius search uses ST_DWithin and sorts by distance', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/listings/search/radius?lat=${CENTER.lat}&lng=${CENTER.lng}&radius=6000`,
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data as { title: string; distance_m: number }[];
    expect(data.map((l) => l.title)).toEqual(['Test center', 'Test near', 'Test mid']);
    expect(data[0]!.distance_m).toBe(0);
    expect(data[1]!.distance_m).toBeGreaterThan(1000);
    expect(data[1]!.distance_m).toBeLessThan(1200);

    const small = await app.inject({
      method: 'GET',
      url: `/v1/listings/search/radius?lat=${CENTER.lat}&lng=${CENTER.lng}&radius=2000&property_type=condo`,
    });
    expect(small.json().data.map((l: { title: string }) => l.title)).toEqual(['Test near']);
  });

  it('bounding box search uses ST_MakeEnvelope', async () => {
    const bbox = [CENTER.lng - 0.1, CENTER.lat - 0.1, CENTER.lng + 0.1, CENTER.lat + 0.1].join(',');
    const res = await app.inject({ method: 'GET', url: `/v1/listings/search/bbox?bbox=${bbox}&sort=price` });
    expect(res.json().data.map((l: { title: string }) => l.title)).toEqual(['Test near', 'Test center', 'Test mid']);
  });

  it('polygon search accepts GeoJSON and returns a FeatureCollection', async () => {
    const { lat, lng } = CENTER;
    // A thin east-west strip covering "center" and "west" but not "near"/"mid" (north) or "far".
    const geometry = {
      type: 'Polygon',
      coordinates: [
        [
          [lng - 0.3, lat - 0.005],
          [lng + 0.005, lat - 0.005],
          [lng + 0.005, lat + 0.005],
          [lng - 0.3, lat + 0.005],
          [lng - 0.3, lat - 0.005],
        ],
      ],
    };
    const res = await app.inject({
      method: 'POST',
      url: '/v1/listings/search/polygon?format=geojson&sort=price',
      payload: { geometry },
    });
    expect(res.statusCode, res.body).toBe(200);
    const fc = res.json();
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features.map((f: { properties: { title: string } }) => f.properties.title)).toEqual([
      'Test center',
      'Test west',
    ]);
    expect(fc.features[0].geometry.type).toBe('Point');
    expect(fc.features[0].geometry.coordinates[0]).toBeCloseTo(lng, 6);
    expect(fc.features[0].geometry.coordinates[1]).toBeCloseTo(lat, 6);
    expect(fc.meta.total).toBe(2);

    const multi = await app.inject({
      method: 'POST',
      url: '/v1/listings/search/polygon',
      payload: { geometry: { type: 'MultiPolygon', coordinates: [geometry.coordinates] } },
    });
    expect(multi.json().meta.total).toBe(2);
  });

  it('geojson format works for radius search', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/listings/search/radius?lat=${CENTER.lat}&lng=${CENTER.lng}&radius=500&format=geojson`,
    });
    const fc = res.json();
    expect(fc.features).toHaveLength(1);
    expect(fc.features[0].properties.distance_m).toBe(0);
  });

  it('updates listings partially', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/listings/${ids.near}`,
      headers: auth,
      payload: { price: 260000, status: 'sold', address: { line2: 'Unit 4' }, location: { lat: 41, lng: -101 } },
    });
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ price: 260000, status: 'sold', address: { line1: 'near Example Street', line2: 'Unit 4' } });
    expect(body.location).toEqual({ lat: 41, lng: -101 });
    expect(new Date(body.updated_at).getTime()).toBeGreaterThanOrEqual(new Date(body.created_at).getTime());

    const missing = await app.inject({
      method: 'PATCH',
      url: '/v1/listings/00000000-0000-4000-8000-000000000000',
      headers: auth,
      payload: { price: 1 },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('rejects unknown agent references with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/listings',
      headers: auth,
      payload: listing('bad', 0, 0, { agent_id: '00000000-0000-4000-8000-000000000000' }),
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('INVALID_REFERENCE');
  });

  it('manages media for a listing', async () => {
    const url = `/v1/listings/${ids.center}/media`;
    const a = await app.inject({ method: 'POST', url, headers: auth, payload: { url: 'https://img.example.com/a.jpg', position: 1 } });
    const b = await app.inject({
      method: 'POST',
      url,
      headers: auth,
      payload: { url: 'https://img.example.com/plan.pdf', media_type: 'floor_plan', position: 0, caption: 'Plan' },
    });
    expect(a.statusCode).toBe(201);
    expect(b.statusCode).toBe(201);

    const list = await app.inject({ method: 'GET', url });
    expect(list.json().data.map((m: { media_type: string }) => m.media_type)).toEqual(['floor_plan', 'image']);

    const patched = await app.inject({
      method: 'PATCH',
      url: `${url}/${a.json().id}`,
      headers: auth,
      payload: { caption: 'Front' },
    });
    expect(patched.json().caption).toBe('Front');

    const detail = await app.inject({ method: 'GET', url: `/v1/listings/${ids.center}` });
    expect(detail.json().media).toHaveLength(2);

    const del = await app.inject({ method: 'DELETE', url: `${url}/${b.json().id}`, headers: auth });
    expect(del.statusCode).toBe(204);
    const wrongListing = await app.inject({ method: 'DELETE', url: `/v1/listings/${ids.far}/media/${a.json().id}`, headers: auth });
    expect(wrongListing.statusCode).toBe(404);

    const noListing = await app.inject({
      method: 'POST',
      url: '/v1/listings/00000000-0000-4000-8000-000000000000/media',
      headers: auth,
      payload: { url: 'https://img.example.com/x.jpg' },
    });
    expect(noListing.statusCode).toBe(404);
  });

  it('manages agents', async () => {
    const dup = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: auth,
      payload: { name: 'Dup', email: 'pat@example.com' },
    });
    expect(dup.statusCode).toBe(409);

    const list = await app.inject({ method: 'GET', url: '/v1/agents?q=pat' });
    expect(list.json().meta.total).toBe(1);
    expect(list.json().data[0].email).toBe('pat@example.com');

    const patched = await app.inject({ method: 'PATCH', url: `/v1/agents/${agentId}`, headers: auth, payload: { phone: '+1-555-0100' } });
    expect(patched.json().phone).toBe('+1-555-0100');

    const del = await app.inject({ method: 'DELETE', url: `/v1/agents/${agentId}`, headers: auth });
    expect(del.statusCode).toBe(204);
    const listingAfter = await app.inject({ method: 'GET', url: `/v1/listings/${ids.center}` });
    expect(listingAfter.json().agent_id).toBeNull();
    expect((await app.inject({ method: 'GET', url: `/v1/agents/${agentId}` })).statusCode).toBe(404);
  });

  it('deletes listings and cascades media', async () => {
    const del = await app.inject({ method: 'DELETE', url: `/v1/listings/${ids.center}`, headers: auth });
    expect(del.statusCode).toBe(204);
    expect((await app.inject({ method: 'GET', url: `/v1/listings/${ids.center}` })).statusCode).toBe(404);
    const { rows } = await pool.query('SELECT COUNT(*)::int AS n FROM listing_media WHERE listing_id = $1', [ids.center]);
    expect(rows[0].n).toBe(0);
  });

  it('seed script inserts synthetic data', async () => {
    const result = await seed(pool, { count: 40, agents: 3, reset: true });
    expect(result.listings).toBe(40);
    const res = await app.inject({ method: 'GET', url: '/v1/listings?limit=1' });
    expect(res.json().meta.total).toBe(40);
    const { rows } = await pool.query("SELECT COUNT(*)::int AS n FROM agents WHERE email LIKE '%@example.com'");
    expect(rows[0].n).toBe(3);
    // Seeded Sampleton listings cluster around their demo centre
    const near = await app.inject({ method: 'GET', url: '/v1/listings/search/radius?lat=30.2672&lng=-97.7431&radius=30000' });
    expect(near.json().meta.total).toBe(10);
  });
});
