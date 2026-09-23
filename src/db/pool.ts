import pg from 'pg';

// Return NUMERIC columns (price, baths) as JS numbers instead of strings.
pg.types.setTypeParser(pg.types.builtins.NUMERIC, (v) => Number.parseFloat(v));
// Return BIGINT (e.g. COUNT(*)) as numbers; counts in this API stay far below 2^53.
pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export type Db = Pick<pg.Pool, 'query' | 'connect' | 'end'>;

export function createPool(connectionString: string, max = 10): pg.Pool {
  return new pg.Pool({ connectionString, max });
}
