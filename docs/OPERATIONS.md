# Operations runbook

Lightweight operations doc for Interview Copilot. Covers deploys, secrets,
migrations, incident response, and cost monitoring. Update as the footprint
grows — right now this is the whole surface.

## Architecture summary

| Component | Runtime | Where it lives |
|---|---|---|
| Web (Next.js 15) | Node / Vercel | `apps/web/` |
| Api (Fastify WS + HTTP) | Node | `apps/api/` |
| Desktop (Electron + Rust) | User's machine | `apps/desktop/`, native addon in `packages/audio-core/` |
| Chrome extension | User's browser | `apps/extension/` |
| Database | Supabase (ap-south-1) | migrations in `apps/api/src/db/migrations/` |
| STT | Deepgram Nova-3 | api outbound |
| LLM | Gemini (default) + Claude (opt-in) | api outbound |
| OCR | Google Cloud Vision | api outbound |

Single source of truth for what goes where: the 12-week plan in
`docs/INTERVIEW-COPILOT-COMPLETE.txt`.

## Environment variables

Secrets live in `.env` (gitignored). Every service reads through
`packages/shared/src/env.ts` which Zod-validates at startup.

Categories:
- **Supabase**: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
  `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_DB_URL` (for migrations)
- **Api auth**: `WS_SHARED_SECRET` (dev/CI fallback; disable in prod by setting
  it to an unguessable ~32-char value and leaving it only in api env)
- **STT / LLM / OCR**: `DEEPGRAM_API_KEY`, `GOOGLE_API_KEY`,
  `ANTHROPIC_API_KEY`, `GOOGLE_CLOUD_VISION_KEY`
- **Desktop**: `DESKTOP_API_BASE_URL`, `DESKTOP_API_WS_URL`,
  `DESKTOP_WEB_BASE_URL`
- **Web**: `NEXT_PUBLIC_API_BASE_URL`, `NEXT_PUBLIC_API_WS_URL`

## Deploys

### Web (Next.js)

1. Push to `main`.
2. Vercel auto-deploys (when connected) on every push.
3. Verify `/` returns 200 and `/app` redirects to `/login?next=%2Fapp`.

### Api (Fastify)

Running as a plain Node service. `pnpm --filter @repo/api dev` locally
(uses tsx, always works). For production:

- `pnpm --filter @repo/api build` emits to `dist/` (note: there's a
  known ESM-extension issue with `pnpm start` — see
  `docs/KNOWN_LIMITATIONS.md`. Run via `tsx` until the import-extension
  cleanup lands).
- Deploy target TBD (currently dev-only).

### Desktop

Users build with `pnpm --filter @repo/desktop dist` or use the signed
artifact from the GitHub Release triggered by a `v*.*.*` tag.

Release flow:
1. Bump `apps/desktop/package.json` `version`.
2. `git tag v0.1.0 && git push --tags`.
3. `.github/workflows/desktop-release.yml` runs on windows-latest +
   macos-14, builds installers, publishes to GitHub Releases.
4. Signing: set repo secrets `WIN_CSC_LINK`, `WIN_CSC_KEY_PASSWORD`
   (Windows .pfx base64 + password) and `MAC_CSC_LINK`,
   `MAC_CSC_KEY_PASSWORD`, `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`,
   `APPLE_TEAM_ID` (Apple Developer). Builds without them produce
   unsigned installers that still work but show OS warnings on first
   launch.

### Chrome extension

Published via the Chrome Web Store Developer Dashboard manually (there's
no CI publish yet). Build locally, zip `apps/extension/dist/`, upload.

## Database migrations

Files live in `apps/api/src/db/migrations/NNNN_*.sql`, applied in order
by `apps/api/scripts/apply-migrations.mjs` which tracks them in a
`_migrations` ledger.

Standard path:
```bash
cd apps/api
node scripts/apply-migrations.mjs     # reads SUPABASE_DB_URL from env
```

If the direct DB host (`db.<ref>.supabase.co`) is blocked from your
network, fall back to the Supabase Dashboard SQL Editor
(`https://supabase.com/dashboard/project/<ref>/sql/new`) and paste the
migration + a `INSERT INTO _migrations (filename, sha256) VALUES (…)
ON CONFLICT DO NOTHING;` line to mark it applied.

## Rotating secrets

1. Generate a new value at the provider.
2. Update `.env` on every host that runs the api (dev machines + prod).
3. Restart the api. Env vars are read at boot only.
4. Revoke the old value at the provider.

For `WS_SHARED_SECRET`: any dev/CI client that used it needs to be
updated too (the api integration tests + the desktop app's dev env).
Rotation is disruptive — schedule it.

For Supabase keys: use `supabase link && supabase projects api-keys --rotate`
if you have the CLI, else through the dashboard.

## Incident response

### "Api is returning 500s"

1. Check `/health` — is it up at all?
2. Tail api logs (`pnpm --filter @repo/api dev` locally streams them;
   prod depends on your log sink).
3. Common causes:
   - Supabase outage: check status.supabase.com
   - LLM outage: Gemini status, or Anthropic
   - Expired service-role key: rotate
   - New migration not applied: run the migration script

### "Users see QUOTA_EXCEEDED"

Expected behavior for free tier users past 10 min/week. Verify via:
```sql
SELECT user_id, SUM(duration_s) / 60.0 AS minutes
FROM sessions
WHERE started_at >= now() - interval '7 days'
  AND kind = 'live'
GROUP BY user_id
ORDER BY minutes DESC;
```

### "Desktop WS keeps 1008-ing"

Almost always token mismatch. Commit `5b8d3a8` fixed the primary case
where `setToken(undefined)` wiped the shared-secret on reconnect — if
you're seeing it again on current main, add a log-once before the close
in `apps/desktop/src/main/ws/ws-client.ts:openOnce` to dump the current
token length, and verify the api's `WS_SHARED_SECRET` matches the
desktop's env.

### "Session recap never lands for a live session"

- Check that migration 0004 is applied (column exists on `profiles`).
- Check that `persistTranscripts` was `true` on that `session.start` —
  a `false` skips event writes and therefore skips recap.
- Check the api log for `recap skipped: too few events` (we require ≥2
  events before calling Gemini).

## Cost monitoring

Quick per-provider checks:

- **Deepgram.** Dashboard → Usage. Currently Nova-3 at $0.0043/min
  streaming. 10-min free sessions × N users bounds weekly cost.
- **Gemini.** Free tier covers dev generously; monitor via
  console.cloud.google.com → APIs → Quotas for `generativelanguage.googleapis.com`.
- **Claude.** Opt-in per request, so cost scales with user selection.
  `ANTHROPIC_API_KEY` dashboard shows spend.
- **Google Cloud Vision.** First 1K requests/month free. Extension +
  desktop OCR both hit this; at scale budget ~$1.50 per additional 1K.
- **Supabase.** ap-south-1 free tier covers early beta; watch DB size
  and egress.

If costs spike, look at the api request log (high-cardinality userId
counts) and the `sessions` table (duration_s sums by user).

## Rate limits in place

| Surface | Limit | File |
|---|---|---|
| `/ws/session` OCR screenshot | 10 per connection per minute | `apps/api/src/lib/rate-limiter.ts` + orchestrator |
| `/api/extension/coding-answer` | 10 per user per minute | `apps/api/src/rest/extension-coding-answer.ts` |
| `POST /api/keys` | 5 per user per hour | `apps/api/src/rest/api-keys.ts` |
| Free-tier live minutes | 10 min per user per rolling 7 days | `apps/api/src/lib/usage.ts` |

All limits return a clear HTTP status + `Retry-After` header.

## Kill switches

- To stop new live sessions: set `WS_SHARED_SECRET` to a fresh value
  without updating client builds. All existing + new connections 1008.
- To stop new extension coding answers: unset `GOOGLE_API_KEY` on the
  api; the endpoint returns a 503 with a meaningful message.
- To stop new API-key creation: can be enforced without a code change
  by setting the rate limit to 0 via env (follow-up; today it's
  hardcoded).
