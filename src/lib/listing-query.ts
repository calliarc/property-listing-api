import type { ListingListQuery, ListingSort, PolygonGeometry } from '../schemas/listing.js';
import { HttpError } from './errors.js';

export type GeoFilter =
  | { kind: 'radius'; lat: number; lng: number; radius: number }
  | { kind: 'bbox'; minLng: number; minLat: number; maxLng: number; maxLat: number }
  | { kind: 'polygon'; geometry: PolygonGeometry };

export interface SqlQuery {
  text: string;
  values: unknown[];
}

/** Collects positional parameters ($1, $2, ...) so values are never interpolated into SQL. */
export class Params {
  readonly values: unknown[] = [];
  add(value: unknown): string {
    this.values.push(value);
    return `$${this.values.length}`;
  }
}

export const LISTING_COLUMNS = `
  l.id, l.agent_id, l.title, l.description, l.property_type, l.status, l.price, l.currency,
  l.beds, l.baths, l.sqft, l.year_built,
  l.address_line1, l.address_line2, l.city, l.region, l.postal_code, l.country,
  ST_Y(l.location::geometry) AS lat, ST_X(l.location::geometry) AS lng,
  l.created_at, l.updated_at`;

const SORT_COLUMNS: Record<string, string> = {
  created_at: 'l.created_at',
  price: 'l.price',
  beds: 'l.beds',
  sqft: 'l.sqft',
  distance: 'distance_m',
};

export function orderByClause(sort: ListingSort | undefined, geo?: GeoFilter): string {
  const effective = sort ?? (geo?.kind === 'radius' ? 'distance' : '-created_at');
  if (effective === 'distance' && geo?.kind !== 'radius') {
    throw new HttpError(400, 'sort=distance is only supported for radius search');
  }
  const desc = effective.startsWith('-');
  const key = desc ? effective.slice(1) : effective;
  const column = SORT_COLUMNS[key];
  if (!column) throw new HttpError(400, `Unsupported sort: ${effective}`);
  // NULLS LAST keeps listings without beds/sqft at the end in both directions; id breaks ties for stable paging.
  return `ORDER BY ${column} ${desc ? 'DESC' : 'ASC'} NULLS LAST, l.id ASC`;
}

/** Parses "minLng,minLat,maxLng,maxLat" and validates ranges. */
export function parseBbox(bbox: string): Extract<GeoFilter, { kind: 'bbox' }> {
  const parts = bbox.split(',').map((p) => Number(p.trim()));
  if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) {
    throw new HttpError(400, 'bbox must be "minLng,minLat,maxLng,maxLat"');
  }
  const [minLng, minLat, maxLng, maxLat] = parts as [number, number, number, number];
  if ([minLng, maxLng].some((v) => v < -180 || v > 180) || [minLat, maxLat].some((v) => v < -90 || v > 90)) {
    throw new HttpError(400, 'bbox coordinates out of range');
  }
  if (minLng >= maxLng || minLat >= maxLat) {
    throw new HttpError(400, 'bbox min values must be smaller than max values');
  }
  return { kind: 'bbox', minLng, minLat, maxLng, maxLat };
}

/** Checks GeoJSON polygon rings are closed and positions are valid WGS84 coordinates. */
export function validatePolygon(geometry: PolygonGeometry): void {
  const polygons = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
  for (const rings of polygons) {
    for (const ring of rings) {
      if (ring.length < 4) throw new HttpError(400, 'Each polygon ring needs at least 4 positions');
      for (const pos of ring) {
        const [lng, lat] = pos as [number, number];
        if (lng < -180 || lng > 180 || lat < -90 || lat > 90) {
          throw new HttpError(400, 'Polygon coordinates out of range (expected [lng, lat])');
        }
      }
      const first = ring[0]!;
      const last = ring[ring.length - 1]!;
      if (first[0] !== last[0] || first[1] !== last[1]) {
        throw new HttpError(400, 'Polygon rings must be closed (first position equals last)');
      }
    }
  }
}

function csv(value: string | undefined): string[] {
  return value ? [...new Set(value.split(',').map((v) => v.trim()).filter(Boolean))] : [];
}

function range(where: string[], p: Params, column: string, min?: number, max?: number, label = column): void {
  if (min !== undefined && max !== undefined && min > max) {
    throw new HttpError(400, `min_${label} must be less than or equal to max_${label}`);
  }
  if (min !== undefined) where.push(`${column} >= ${p.add(min)}`);
  if (max !== undefined) where.push(`${column} <= ${p.add(max)}`);
}

/**
 * Builds a parameterised listing search query.
 * Returns one row per listing plus a `total_count` window column for pagination.
 */
export function buildListingSearch(filters: ListingListQuery, geo?: GeoFilter): SqlQuery & { count: SqlQuery } {
  const p = new Params();
  const where: string[] = [];
  let distanceSelect = '';

  range(where, p, 'l.price', filters.min_price, filters.max_price, 'price');
  range(where, p, 'l.beds', filters.min_beds, filters.max_beds, 'beds');
  range(where, p, 'l.baths', filters.min_baths, filters.max_baths, 'baths');
  range(where, p, 'l.sqft', filters.min_sqft, filters.max_sqft, 'sqft');

  const types = csv(filters.property_type);
  if (types.length) where.push(`l.property_type = ANY(${p.add(types)}::text[])`);
  const statuses = csv(filters.status);
  if (statuses.length) where.push(`l.status = ANY(${p.add(statuses)}::text[])`);
  if (filters.agent_id) where.push(`l.agent_id = ${p.add(filters.agent_id)}`);
  if (filters.city) where.push(`lower(l.city) = lower(${p.add(filters.city)})`);

  if (geo?.kind === 'radius') {
    const point = `ST_SetSRID(ST_MakePoint(${p.add(geo.lng)}, ${p.add(geo.lat)}), 4326)::geography`;
    where.push(`ST_DWithin(l.location, ${point}, ${p.add(geo.radius)})`);
    distanceSelect = `, ST_Distance(l.location, ${point}) AS distance_m`;
  } else if (geo?.kind === 'bbox') {
    where.push(
      `l.location::geometry && ST_MakeEnvelope(${p.add(geo.minLng)}, ${p.add(geo.minLat)}, ${p.add(geo.maxLng)}, ${p.add(geo.maxLat)}, 4326)`,
    );
  } else if (geo?.kind === 'polygon') {
    validatePolygon(geo.geometry);
    where.push(
      `ST_Within(l.location::geometry, ST_SetSRID(ST_GeomFromGeoJSON(${p.add(JSON.stringify(geo.geometry))}), 4326))`,
    );
  }

  const page = filters.page ?? 1;
  const limit = filters.limit ?? 20;
  const order = orderByClause(filters.sort, geo);

  const whereSql = where.length ? `WHERE ${where.join('\n  AND ')}` : '';
  const filterValues = [...p.values];
  const count: SqlQuery = { text: `SELECT COUNT(*) AS total FROM listings l\n${whereSql}`, values: filterValues };

  const text = `SELECT ${LISTING_COLUMNS}${distanceSelect}, COUNT(*) OVER() AS total_count
FROM listings l
${whereSql}
${order}
LIMIT ${p.add(limit)} OFFSET ${p.add((page - 1) * limit)}`;

  return { text, values: p.values, count };
}
