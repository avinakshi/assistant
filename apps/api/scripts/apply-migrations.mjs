// Run every SQL file under src/db/migrations against SUPABASE_DB_URL.
//
// Uses `pg` from the api's node_modules (installed below) — one workspace-internal
// dependency instead of requiring `psql` to be on PATH, which isn't given on fresh
// Windows boxes.
//
// Usage:  set -a && source .env && set +a && node scripts/apply-migrations.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';

const dbUrl = process.env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set — did you `set -a && source .env && set +a`?');
  process.exit(1);
}

const migrationsDir = resolve(process.cwd(), 'src/db/migrations');
const files = readdirSync(migrationsDir)
  .filter((f) => f.endsWith('.sql'))
  .sort();

if (files.length === 0) {
  console.log('no migration files found');
  process.exit(0);
}

const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
await client.connect();
console.log(`connected to ${dbUrl.replace(/:[^:@]+@/, ':****@')}`);

for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  console.log(`\n=== applying ${file} (${sql.length} chars) ===`);
  try {
    await client.query(sql);
    console.log(`  ok`);
  } catch (err) {
    console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 2;
    break;
  }
}

await client.end();
console.log('\ndone');
