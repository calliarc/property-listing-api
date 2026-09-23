import type { Db } from '../db/pool.js';
import { HttpError } from '../lib/errors.js';
import { Params } from '../lib/listing-query.js';
import type { Media, MediaCreate, MediaUpdate } from '../schemas/media.js';

const COLUMNS = 'id, listing_id, media_type, url, caption, position, created_at';
const FIELDS = ['media_type', 'url', 'caption', 'position'] as const;

type MediaRow = Omit<Media, 'created_at'> & { created_at: Date };
const toMedia = (r: MediaRow): Media => ({ ...r, created_at: new Date(r.created_at).toISOString() });

export class MediaRepository {
  constructor(private readonly db: Db) {}

  async listForListing(listingId: string): Promise<Media[]> {
    const { rows } = await this.db.query<MediaRow>(
      `SELECT ${COLUMNS} FROM listing_media WHERE listing_id = $1 ORDER BY position, created_at`,
      [listingId],
    );
    return rows.map(toMedia);
  }

  async create(listingId: string, input: MediaCreate): Promise<Media> {
    const p = new Params();
    const cols = ['listing_id'];
    const vals = [p.add(listingId)];
    for (const f of FIELDS) {
      if (input[f] !== undefined) {
        cols.push(f);
        vals.push(p.add(input[f]));
      }
    }
    const { rows } = await this.db.query<MediaRow>(
      `INSERT INTO listing_media (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING ${COLUMNS}`,
      p.values,
    );
    return toMedia(rows[0]!);
  }

  async update(listingId: string, mediaId: string, input: MediaUpdate): Promise<Media | undefined> {
    const p = new Params();
    const sets: string[] = [];
    for (const f of FIELDS) {
      if (input[f] !== undefined) sets.push(`${f} = ${p.add(input[f])}`);
    }
    if (sets.length === 0) throw new HttpError(400, 'No updatable fields provided');
    const { rows } = await this.db.query<MediaRow>(
      `UPDATE listing_media SET ${sets.join(', ')} WHERE id = ${p.add(mediaId)} AND listing_id = ${p.add(listingId)} RETURNING ${COLUMNS}`,
      p.values,
    );
    return rows[0] ? toMedia(rows[0]) : undefined;
  }

  async delete(listingId: string, mediaId: string): Promise<boolean> {
    const { rowCount } = await this.db.query('DELETE FROM listing_media WHERE id = $1 AND listing_id = $2', [
      mediaId,
      listingId,
    ]);
    return (rowCount ?? 0) > 0;
  }
}
