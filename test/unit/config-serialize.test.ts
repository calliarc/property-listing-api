import { describe, expect, it } from 'vitest';
import { loadConfig, parseCorsOrigin } from '../../src/config.js';
import { toFeatureCollection, toListing, type ListingRow } from '../../src/lib/serialize.js';
import { pageMeta } from '../../src/schemas/common.js';
import { isValidApiKey } from '../../src/plugins/auth.js';
import { createHash } from 'node:crypto';
import { prng } from '../../src/db/seed.js';

describe('config', () => {
  it('parses CORS origins', () => {
    expect(parseCorsOrigin(undefined)).toBe(false);
    expect(parseCorsOrigin('*')).toBe(true);
    expect(parseCorsOrigin('https://a.test')).toEqual(['https://a.test']);
    expect(parseCorsOrigin('https://a.test, https://b.test')).toEqual(['https://a.test', 'https://b.test']);
  });

  it('loads defaults and API keys', () => {
    const c = loadConfig({ API_KEYS: 'one, two,,', PORT: '8080' });
    expect(c.apiKeys).toEqual(['one', 'two']);
    expect(c.port).toBe(8080);
    expect(c.rateLimitMax).toBe(100);
    expect(c.docsEnabled).toBe(true);
    expect(() => loadConfig({ PORT: 'abc' })).toThrow();
  });
});

describe('api key check', () => {
  const keys = ['secret-a', 'secret-b'].map((k) => createHash('sha256').update(k).digest());
  it('accepts configured keys only', () => {
    expect(isValidApiKey('secret-b', keys)).toBe(true);
    expect(isValidApiKey('secret-c', keys)).toBe(false);
    expect(isValidApiKey(undefined, keys)).toBe(false);
    expect(isValidApiKey('', keys)).toBe(false);
  });
});

describe('serialization', () => {
  const row: ListingRow = {
    id: '00000000-0000-4000-8000-000000000001',
    agent_id: null,
    title: 'Demo',
    description: null,
    property_type: 'house',
    status: 'active',
    price: 250000,
    currency: 'USD',
    beds: 3,
    baths: 2.5,
    sqft: 1500,
    year_built: 1999,
    address_line1: '1 Example Street',
    address_line2: null,
    city: 'Sampleton',
    region: null,
    postal_code: null,
    country: 'US',
    lat: 30.5,
    lng: -97.5,
    distance_m: 123.456,
    created_at: new Date('2026-01-01T00:00:00Z'),
    updated_at: new Date('2026-01-02T00:00:00Z'),
  };

  it('maps rows to the API shape', () => {
    const l = toListing(row);
    expect(l.address.line1).toBe('1 Example Street');
    expect(l.location).toEqual({ lat: 30.5, lng: -97.5 });
    expect(l.distance_m).toBe(123.5);
    expect(l.created_at).toBe('2026-01-01T00:00:00.000Z');
  });

  it('builds a GeoJSON FeatureCollection with [lng, lat] coordinates', () => {
    const fc = toFeatureCollection([toListing(row)], pageMeta(1, 20, 1));
    expect(fc.type).toBe('FeatureCollection');
    expect(fc.features[0]!.geometry).toEqual({ type: 'Point', coordinates: [-97.5, 30.5] });
    expect(fc.features[0]!.properties).not.toHaveProperty('location');
    expect(fc.meta).toEqual({ page: 1, limit: 20, total: 1, total_pages: 1 });
  });

  it('computes page meta', () => {
    expect(pageMeta(2, 10, 0).total_pages).toBe(0);
    expect(pageMeta(2, 10, 21).total_pages).toBe(3);
  });
});

describe('seed prng', () => {
  it('is deterministic', () => {
    const a = prng(1);
    const b = prng(1);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
  });
});
