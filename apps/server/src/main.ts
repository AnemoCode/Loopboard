import { buildApp } from './app.js';
import { createDb, runMigrations } from './db/index.js';
import { loadEnv } from './env.js';

const env = loadEnv();
const { db, client } = createDb(env.DATABASE_URL);
await runMigrations(db);
const { app } = await buildApp(env, db);

const shutdown = async () => {
  await app.close();
  await client.end({ timeout: 5 });
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

await app.listen({ port: env.PORT, host: env.HOST });
