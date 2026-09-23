import type { Db } from '../db/pool.js';
import { HttpError } from '../lib/errors.js';
import { buildListingSearch, LISTING_COLUMNS, Params, type GeoFilter } from '../lib/listing-query.js';
import { toListing, type ListingRow } from '../lib/serialize.js';
import { pageMeta, type PageMeta } from '../schemas/common.js';
import type { Listing, ListingCreate, ListingListQuery, ListingUpdate } from '../schemas/listing.js';
import type { Media } from '../schemas/media.js';

/** Maps API field names to listing columns for simple (non-geo) values. */
const SIMPLE_FIELDS = {
  agent_id: 'agent_id',
  title: 'title',
  description: 'description',
  property_type: 'property_type',
  status: 'status',
  price: 'price',
  currency: 'currency',
  beds: 'beds',
  baths: 'baths',
  sqft: 'sqft',
  year_built: 'year_built',
} as const;

const ADDRESS_FIELDS = {
  line1: 'address_line1',
  line2: 'address_line2',
  city: 'city',
  region: 'region',
  postal_code: 'postal_code',
  country: 'country',
} as const;

export class ListingRepository {
  constructor(private readonly db: Db) {}

  async search(filters: ListingListQuery, geo?: GeoFilter): Promise<{ data: Listing[]; meta: PageMeta }> {
    const q = buildListingSearch(filters, geo);
    let rows: (ListingRow & { total_count: number })[];
    try {
      rows = (await this.db.query<ListingRow & { total_count: number }>(q.text, q.values)).rows;
    } catch (err) {
      // PostGIS raises XX000 for geometries it cannot parse or evaluate (e.g. self-intersecting rings).
      if (geo?.kind === 'polygon' && (err as { code?: string }).code === 'XX000') {
        throw new HttpError(400, 'Invalid polygon geometry', 'INVALID_GEOMETRY');
      }
      throw err;
    }
    const page = filters.page ?? 1;
    const limit = filters.limit ?? 20;
    let total = rows[0]?.total_count ?? 0;
    if (rows.length === 0 && page > 1) {
      total = (await this.db.query<{ total: number }>(q.count.text, q.count.values)).rows[0]?.total ?? 0;
    }
    return { data: rows.map(toListing), meta: pageMeta(page, limit, total) };
  }

  async findById(id: string): Promise<Listing | undefined> {
    const { rows } = await this.db.query<ListingRow>(`SELECT ${LISTING_COLUMNS} FROM listings l WHERE l.id = $1`, [id]);
    return rows[0] ? toListing(rows[0]) : undefined;
  }

  async findByIdWithMedia(id: string): Promise<Listing | undefined> {
    const listing = await this.findById(id);
    if (!listing) return undefined;
    const { rows } = await this.db.query<Media>(
      `SELECT id, listing_id, media_type, url, caption, position, created_at
       FROM listing_media WHERE listing_id = $1 ORDER BY position, created_at`,
      [id],
    );
    return { ...listing, media: rows.map((m) => ({ ...m, created_at: new Date(m.created_at).toISOString() })) };
  }

  async create(input: ListingCreate): Promise<Listing> {
    const p = new Params();
    const cols: string[] = [];
    const vals: string[] = [];
    for (const [field, column] of Object.entries(SIMPLE_FIELDS)) {
      const value = input[field as keyof typeof SIMPLE_FIELDS];
      if (value !== undefined) {
        cols.push(column);
        vals.push(p.add(value));
      }
    }
    for (const [field, column] of Object.entries(ADDRESS_FIELDS)) {
      const value = input.address[field as keyof typeof ADDRESS_FIELDS];
      if (value !== undefined) {
        cols.push(column);
        vals.push(p.add(value));
      }
    }
    cols.push('location');
    vals.push(`ST_SetSRID(ST_MakePoint(${p.add(input.location.lng)}, ${p.add(input.location.lat)}), 4326)::geography`);

    const { rows } = await this.db.query<ListingRow>(
      `WITH l AS (INSERT INTO listings (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING *)
       SELECT ${LISTING_COLUMNS} FROM l`,
      p.values,
    );
    return toListing(rows[0]!);
  }

  async update(id: string, input: ListingUpdate): Promise<Listing | undefined> {
    const p = new Params();
    const sets: string[] = [];
    for (const [field, column] of Object.entries(SIMPLE_FIELDS)) {
      const value = input[field as keyof typeof SIMPLE_FIELDS];
      if (value !== undefined) sets.push(`${column} = ${p.add(value)}`);
    }
    if (input.address) {
      for (const [field, column] of Object.entries(ADDRESS_FIELDS)) {
        const value = input.address[field as keyof typeof ADDRESS_FIELDS];
        if (value !== undefined) sets.push(`${column} = ${p.add(value)}`);
      }
    }
    if (input.location) {
      sets.push(
        `location = ST_SetSRID(ST_MakePoint(${p.add(input.location.lng)}, ${p.add(input.location.lat)}), 4326)::geography`,
      );
    }
    if (sets.length === 0) throw new HttpError(400, 'No updatable fields provided');
    const { rows } = await this.db.query<ListingRow>(
      `UPDATE listings AS l SET ${sets.join(', ')} WHERE l.id = ${p.add(id)} RETURNING ${LISTING_COLUMNS}`,
      p.values,
    );
    return rows[0] ? toListing(rows[0]) : undefined;
  }

  async delete(id: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM listings WHERE id = $1', [id]);
    return (rowCount ?? 0) > 0;
  }

  async exists(id: string): Promise<boolean> {
    const { rows } = await this.db.query('SELECT 1 FROM listings WHERE id = $1', [id]);
    return rows.length > 0;
  }
}
