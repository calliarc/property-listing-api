import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createPool } from './db/pool.js';

const config = loadConfig();
const pool = createPool(config.databaseUrl, config.dbPoolMax);
const app = await buildApp({ config, db: pool });

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await pool.end();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

try {
  await app.listen({ host: config.host, port: config.port });
} catch (err) {
  app.log.error(err);
  await pool.end();
  process.exit(1);
}
