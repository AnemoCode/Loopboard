import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export type Db = ReturnType<typeof createDb>['db'];

export function createDb(url: string) {
  const client = postgres(url, { max: 10, onnotice: () => {} });
  const db = drizzle(client, { schema, casing: 'snake_case' });
  return { db, client };
}

/** Apply the SQL migrations in apps/server/drizzle (found next to src/ in dev and dist/ in production). */
export async function runMigrations(db: Db) {
  const candidates = ['../../drizzle', '../drizzle'].map((p) =>
    fileURLToPath(new URL(p, import.meta.url)),
  );
  const folder = candidates.find((c) => existsSync(`${c}/meta/_journal.json`));
  if (!folder) throw new Error('Migrations folder not found');
  await migrate(db, { migrationsFolder: folder });
}

export { schema };
