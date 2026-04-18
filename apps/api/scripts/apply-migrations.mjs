// Run every SQL file under src/db/migrations against SUPABASE_DB_URL.
//
// Tracks applied migrations in a `_migrations` table so re-runs are idempotent. Each .sql
// file is either run in full (wrapped in a transaction) or skipped; no partial tracking.
// For heavier ops we'd want a proper migration tool (Atlas, Flyway), but for this
// project's scale this is enough.
//
// Usage (from apps/api/):  node scripts/apply-migrations.mjs

import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
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

// Ledger table. Keeps track of which .sql files we've applied + their hash, so a file that
// silently changes gets flagged on the next run.
await client.query(`
  CREATE TABLE IF NOT EXISTS public._migrations (
    filename   TEXT PRIMARY KEY,
    sha256     TEXT NOT NULL,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`);

const appliedRows = (await client.query(
  'SELECT filename, sha256 FROM public._migrations',
)).rows;
const applied = new Map(appliedRows.map((r) => [r.filename, r.sha256]));

let failed = false;
for (const file of files) {
  const sql = readFileSync(join(migrationsDir, file), 'utf8');
  const sha = createHash('sha256').update(sql).digest('hex').slice(0, 16);

  if (applied.has(file)) {
    if (applied.get(file) !== sha) {
      console.warn(`! ${file} already applied but its contents changed (sha drift)`);
    } else {
      console.log(`= skip ${file} (already applied)`);
    }
    continue;
  }

  console.log(`\n→ applying ${file} (${sql.length} chars, sha ${sha})`);
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query(
      'INSERT INTO public._migrations (filename, sha256) VALUES ($1, $2)',
      [file, sha],
    );
    await client.query('COMMIT');
    console.log(`  ok`);
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    console.error(`  FAILED: ${err instanceof Error ? err.message : String(err)}`);
    failed = true;
    break;
  }
}

await client.end();
console.log(failed ? '\nFAIL' : '\ndone');
process.exit(failed ? 2 : 0);
