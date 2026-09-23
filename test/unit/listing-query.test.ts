import { describe, expect, it } from 'vitest';
import { buildListingSearch, orderByClause, parseBbox, validatePolygon } from '../../src/lib/listing-query.js';
import { HttpError } from '../../src/lib/errors.js';

describe('buildListingSearch', () => {
  it('builds an unfiltered query with default paging and sort', () => {
    const q = buildListingSearch({});
    expect(q.text).not.toContain('WHERE');
    expect(q.text).toContain('ORDER BY l.created_at DESC NULLS LAST, l.id ASC');
    expect(q.text).toMatch(/LIMIT \$1 OFFSET \$2$/);
    expect(q.values).toEqual([20, 0]);
    expect(q.count.values).toEqual([]);
  });

  it('parameterises numeric range and list filters', () => {
    const q = buildListingSearch({
      min_price: 100000,
      max_price: 500000,
      min_beds: 2,
      min_baths: 1.5,
      property_type: 'house,condo,house',
      status: 'active',
      city: 'Sampleton',
      page: 3,
      limit: 10,
      sort: 'price',
    });
    expect(q.text).toContain('l.price >= $1');
    expect(q.text).toContain('l.price <= $2');
    expect(q.text).toContain('l.beds >= $3');
    expect(q.text).toContain('l.baths >= $4');
    expect(q.text).toContain('l.property_type = ANY($5::text[])');
    expect(q.text).toContain('l.status = ANY($6::text[])');
    expect(q.text).toContain('lower(l.city) = lower($7)');
    expect(q.text).toContain('ORDER BY l.price ASC');
    expect(q.values).toEqual([100000, 500000, 2, 1.5, ['house', 'condo'], ['active'], 'Sampleton', 10, 20]);
    // count query shares the filter params but not LIMIT/OFFSET
    expect(q.count.values).toEqual(q.values.slice(0, -2));
    expect(q.count.text).toContain('WHERE');
  });

  it('never interpolates user values into SQL text', () => {
    const evil = "x'); DROP TABLE listings; --";
    const q = buildListingSearch({ city: evil });
    expect(q.text).not.toContain(evil);
    expect(q.values).toContain(evil);
  });

  it('rejects inverted ranges', () => {
    expect(() => buildListingSearch({ min_price: 10, max_price: 5 })).toThrow(HttpError);
    expect(() => buildListingSearch({ min_beds: 4, max_beds: 1 })).toThrow(/min_beds/);
  });

  it('adds ST_DWithin and distance for radius search, sorted by distance', () => {
    const q = buildListingSearch({}, { kind: 'radius', lat: 30.1, lng: -97.2, radius: 5000 });
    expect(q.text).toContain('ST_DWithin(l.location, ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography, $3)');
    expect(q.text).toContain('AS distance_m');
    expect(q.text).toContain('ORDER BY distance_m ASC');
    expect(q.values.slice(0, 3)).toEqual([-97.2, 30.1, 5000]);
  });

  it('uses ST_MakeEnvelope for bbox search', () => {
    const q = buildListingSearch({}, parseBbox('-98,30,-97,31'));
    expect(q.text).toContain('ST_MakeEnvelope($1, $2, $3, $4, 4326)');
    expect(q.values.slice(0, 4)).toEqual([-98, 30, -97, 31]);
  });

  it('uses ST_GeomFromGeoJSON + ST_Within for polygon search', () => {
    const geometry = {
      type: 'Polygon' as const,
      coordinates: [
        [
          [-98, 30],
          [-97, 30],
          [-97, 31],
          [-98, 30],
        ],
      ],
    };
    const q = buildListingSearch({ max_price: 1 }, { kind: 'polygon', geometry });
    expect(q.text).toContain('ST_Within(l.location::geometry, ST_SetSRID(ST_GeomFromGeoJSON($2), 4326))');
    expect(JSON.parse(q.values[1] as string)).toEqual(geometry);
  });
});

describe('orderByClause', () => {
  it('supports descending sort', () => {
    expect(orderByClause('-sqft')).toBe('ORDER BY l.sqft DESC NULLS LAST, l.id ASC');
  });
  it('only allows distance for radius search', () => {
    expect(() => orderByClause('distance')).toThrow(/radius/);
    expect(orderByClause('distance', { kind: 'radius', lat: 0, lng: 0, radius: 1 })).toContain('distance_m ASC');
  });
});

describe('parseBbox', () => {
  it('parses and trims values', () => {
    expect(parseBbox(' -1.5, 2 ,3,4 ')).toEqual({ kind: 'bbox', minLng: -1.5, minLat: 2, maxLng: 3, maxLat: 4 });
  });
  it.each([['1,2,3'], ['a,b,c,d'], ['-200,0,10,10'], ['0,-95,10,10'], ['10,0,0,10'], ['0,10,10,0']])('rejects %s', (v) => {
    expect(() => parseBbox(v)).toThrow(HttpError);
  });
});

describe('validatePolygon', () => {
  const ring = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 0],
  ];
  it('accepts closed polygons and multipolygons', () => {
    expect(() => validatePolygon({ type: 'Polygon', coordinates: [ring] })).not.toThrow();
    expect(() => validatePolygon({ type: 'MultiPolygon', coordinates: [[ring], [ring]] })).not.toThrow();
  });
  it('rejects open rings', () => {
    expect(() => validatePolygon({ type: 'Polygon', coordinates: [[...ring.slice(0, 3), [0, 1]]] })).toThrow(/closed/);
  });
  it('rejects out-of-range coordinates (lat/lng swapped)', () => {
    expect(() =>
      validatePolygon({
        type: 'Polygon',
        coordinates: [
          [
            [0, 0],
            [0, 100],
            [1, 100],
            [0, 0],
          ],
        ],
      }),
    ).toThrow(/range/);
  });
});
