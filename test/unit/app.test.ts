import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appWith, fakeDb, TEST_API_KEY, type FakeDb } from '../helpers.js';

const validListing = {
  title: 'Demo house',
  property_type: 'house',
  price: 350000,
  beds: 3,
  baths: 2,
  address: { line1: '1 Example Street', city: 'Sampleton' },
  location: { lat: 30.26, lng: -97.74 },
};

describe('app (no database)', () => {
  let db: FakeDb;
  let app: Awaited<ReturnType<typeof appWith>>;

  beforeAll(async () => {
    db = fakeDb();
    app = await appWith(db);
  });
  afterAll(() => app.close());

  it('serves the OpenAPI document with the API key scheme', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/json' });
    expect(res.statusCode).toBe(200);
    const doc = res.json();
    expect(doc.openapi).toBe('3.0.3');
    expect(doc.components.securitySchemes.ApiKeyAuth).toMatchObject({ type: 'apiKey', in: 'header', name: 'x-api-key' });
    expect(Object.keys(doc.paths)).toEqual(
      expect.arrayContaining([
        '/v1/listings',
        '/v1/listings/{id}',
        '/v1/listings/search/radius',
        '/v1/listings/search/bbox',
        '/v1/listings/search/polygon',
        '/v1/listings/{id}/media',
        '/v1/agents',
      ]),
    );
    expect(doc.paths['/v1/listings'].post.security).toEqual([{ ApiKeyAuth: [] }]);
  });

  it('serves Swagger UI at /docs', async () => {
    const res = await app.inject({ method: 'GET', url: '/docs/' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/html');
  });

  it('reports health', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok', version: '0.1.0', database: 'up' });
  });

  it('sets security headers and CORS', async () => {
    const res = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://maps.example.com' } });
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['content-security-policy']).toBeDefined();
    expect(res.headers['access-control-allow-origin']).toBe('https://maps.example.com');
    const other = await app.inject({ method: 'GET', url: '/health', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });

  it.each([
    ['/v1/listings?limit=500', /limit/],
    ['/v1/listings?property_type=castle', /property_type/],
    ['/v1/listings?sort=random', /sort/],
    ['/v1/listings?min_price=10&max_price=5', /min_price/],
    ['/v1/listings?sort=distance', /radius/],
    ['/v1/listings/search/radius?lat=30&lng=-97', /radius/],
    ['/v1/listings/search/radius?lat=95&lng=-97&radius=100', /lat/],
    ['/v1/listings/search/bbox?bbox=1,2,3', /bbox/],
    ['/v1/listings/search/bbox?bbox=3,2,1,4', /bbox/],
    ['/v1/listings/not-a-uuid', /id/],
  ])('rejects invalid request %s with 400', async (url, message) => {
    const res = await app.inject({ method: 'GET', url });
    expect(res.statusCode).toBe(400);
    expect(res.json().message).toMatch(message);
  });

  it('rejects malformed polygons', async () => {
    const open = await app.inject({
      method: 'POST',
      url: '/v1/listings/search/polygon',
      payload: { geometry: { type: 'Polygon', coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1]]] } },
    });
    expect(open.statusCode).toBe(400);
    expect(open.json().message).toMatch(/closed/);
    const wrongType = await app.inject({
      method: 'POST',
      url: '/v1/listings/search/polygon',
      payload: { geometry: { type: 'Point', coordinates: [0, 0] } },
    });
    expect(wrongType.statusCode).toBe(400);
  });

  it('requires an API key for writes', async () => {
    const before = db.calls.length;
    const none = await app.inject({ method: 'POST', url: '/v1/listings', payload: validListing });
    expect(none.statusCode).toBe(401);
    const wrong = await app.inject({
      method: 'DELETE',
      url: '/v1/listings/00000000-0000-4000-8000-000000000001',
      headers: { 'x-api-key': 'nope' },
    });
    expect(wrong.statusCode).toBe(401);
    expect(db.calls.length).toBe(before); // no query ran
  });

  it('validates listing bodies after authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/v1/listings',
      headers: { 'x-api-key': TEST_API_KEY },
      payload: { ...validListing, location: { lat: 30 } },
    });
    expect(res.statusCode).toBe(400);
    const extra = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': TEST_API_KEY },
      payload: { name: 'A', email: 'not-an-email' },
    });
    expect(extra.statusCode).toBe(400);
  });

  it('returns JSON 404 for unknown routes', async () => {
    const res = await app.inject({ method: 'GET', url: '/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('Not Found');
  });

  it('returns an empty GeoJSON FeatureCollection when requested', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/listings?format=geojson' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      type: 'FeatureCollection',
      features: [],
      meta: { page: 1, limit: 20, total: 0, total_pages: 0 },
    });
  });
});

describe('app configuration', () => {
  it('rejects all writes when no API keys are configured', async () => {
    const app = await appWith(fakeDb(), { apiKeys: [] });
    const res = await app.inject({
      method: 'POST',
      url: '/v1/agents',
      headers: { 'x-api-key': 'anything' },
      payload: { name: 'A', email: 'a@example.com' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().message).toMatch(/no API keys/);
    await app.close();
  });

  it('rate limits clients', async () => {
    const app = await appWith(fakeDb(), { rateLimitMax: 2 });
    const codes = [];
    for (let i = 0; i < 3; i++) codes.push((await app.inject({ method: 'GET', url: '/v1/agents' })).statusCode);
    expect(codes).toEqual([200, 200, 429]);
    await app.close();
  });

  it('returns 503 from /health when the database is down', async () => {
    const db = fakeDb();
    db.query = (async () => {
      throw new Error('connection refused');
    }) as unknown as typeof db.query;
    const app = await appWith(db);
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(503);
    await app.close();
  });
});
