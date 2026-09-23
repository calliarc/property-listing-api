// Starts an in-memory PostgreSQL + PostGIS server (PGlite, WebAssembly) on a local port.
// Handy for trying the API or running integration tests without Docker.
// Experimental: PGlite runs a single backend, so use DB_POOL_MAX=1 with it.
// Production and CI use the real postgis/postgis image instead.
//
//   npm run db:lite                      # listens on 127.0.0.1:5433
//   PGLITE_PORT=6543 npm run db:lite
import { PGlite } from '@electric-sql/pglite';
import { postgis } from '@electric-sql/pglite-postgis';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';

const port = Number.parseInt(process.env.PGLITE_PORT ?? '5433', 10);
const host = process.env.PGLITE_HOST ?? '127.0.0.1';

const db = await PGlite.create({ extensions: { postgis } });
const server = new PGLiteSocketServer({ db, port, host, maxConnections: 16 });
await server.start();
console.log(`PGlite + PostGIS listening on ${host}:${port}`);
console.log(`DATABASE_URL=postgres://postgres@${host}:${port}/postgres DB_POOL_MAX=1`);

const stop = async () => {
  await server.stop();
  await db.close();
  process.exit(0);
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
