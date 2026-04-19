// Apply migration 0004 via Supabase's Transaction Pooler. Probes several regions since
// the direct DB host (db.<ref>.supabase.co) is DNS-blocked from this environment but the
// pooler (aws-0-<region>.pooler.supabase.com) resolves publicly.
//
// Reads SUPABASE_DB_URL from the repo-root .env, extracts just the password + project
// ref, then tries each candidate region until one accepts auth.

import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..', '..');
const require = createRequire(import.meta.url);
const { Client } = require(resolve(repoRoot, 'node_modules/.pnpm/pg@8.20.0/node_modules/pg'));

function loadEnv() {
  const raw = readFileSync(resolve(repoRoot, '.env'), 'utf8');
  const env = {};
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').replace(/\r$/, '');
  }
  return env;
}

const env = loadEnv();
const dbUrl = env.SUPABASE_DB_URL;
if (!dbUrl) {
  console.error('SUPABASE_DB_URL not set in .env');
  process.exit(1);
}

// Parse the existing URL to pull password + ref.
// Shape: postgres://postgres:<PWD>@db.<REF>.supabase.co:5432/postgres
const m = dbUrl.match(
  /^postgres(?:ql)?:\/\/postgres:([^@]+)@db\.([a-z0-9]+)\.supabase\.co(?::(\d+))?\/postgres/i,
);
if (!m) {
  console.error('SUPABASE_DB_URL is not in the expected direct-host form; cannot auto-rewrite.');
  console.error('Expected: postgres://postgres:<PWD>@db.<REF>.supabase.co:5432/postgres');
  process.exit(2);
}
const [, password, ref] = m;
console.log(`ref: ${ref}, password length: ${password.length}`);

// Regions to try. ap-south-1 comes first since the project's Cloudflare edge is MAA.
const CANDIDATE_REGIONS = [
  // Probe order: Cloudflare edged at MAA (Chennai) so India regions first; then the
  // other AWS regions Supabase supports.
  'ap-south-1',        // Mumbai
  'ap-southeast-1',    // Singapore
  'ap-southeast-2',    // Sydney
  'ap-northeast-1',    // Tokyo
  'ap-northeast-2',    // Seoul
  'us-east-1',         // N. Virginia
  'us-east-2',         // Ohio
  'us-west-1',         // N. California
  'ca-central-1',      // Canada
  'eu-west-1',         // Ireland
  'eu-west-2',         // London
  'eu-west-3',         // Paris
  'eu-central-1',      // Frankfurt
  'eu-central-2',      // Zurich
  'eu-north-1',        // Stockholm
  'sa-east-1',         // São Paulo
];

const MIGRATION_SQL = `
ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS persist_transcripts_default BOOLEAN NOT NULL DEFAULT TRUE;
`;

const LEDGER_SQL = `
INSERT INTO public._migrations (filename, sha256)
VALUES ('0004_phase9_settings.sql', 'manual-pooler-apply')
ON CONFLICT (filename) DO NOTHING;
`;

async function tryRegion(region) {
  const host = `aws-0-${region}.pooler.supabase.com`;
  const user = `postgres.${ref}`;
  console.log(`\n>>> trying ${host} ...`);
  const client = new Client({
    host,
    port: 6543,
    user,
    password,
    database: 'postgres',
    ssl: { rejectUnauthorized: false },
    // 10 s connect timeout per region so we don't hang forever if a pooler is slow.
    connectionTimeoutMillis: 10_000,
  });
  try {
    await client.connect();
    console.log(`    connected via ${region}`);

    const before = await client.query(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema='public' AND table_name='profiles' AND column_name='persist_transcripts_default'`,
    );
    const alreadyExists = before.rows.length > 0;
    console.log(
      `    column ${alreadyExists ? 'already exists' : 'not yet present'} — ${alreadyExists ? 'ensuring ledger' : 'applying migration'}`,
    );

    await client.query('BEGIN');
    await client.query(MIGRATION_SQL);
    await client.query(LEDGER_SQL);
    await client.query('COMMIT');

    const after = await client.query(
      `SELECT column_name, data_type, column_default, is_nullable
       FROM information_schema.columns
       WHERE table_schema='public' AND table_name='profiles' AND column_name='persist_transcripts_default'`,
    );
    console.log('    VERIFIED:', JSON.stringify(after.rows[0]));

    await client.end();
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    try { await client.end(); } catch {}
    console.log(`    failed: ${msg}`);
    return false;
  }
}

let applied = false;
for (const region of CANDIDATE_REGIONS) {
  if (await tryRegion(region)) { applied = true; break; }
}

if (applied) {
  console.log('\nDONE — migration 0004 applied + ledger updated.');
  process.exit(0);
} else {
  console.error('\nFAIL — no region accepted auth. You may need the Dashboard SQL Editor path.');
  process.exit(2);
}
