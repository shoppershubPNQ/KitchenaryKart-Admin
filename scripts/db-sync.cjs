/**
 * Best-effort production schema sync, run at build time (before `next build`).
 *
 * Why: the app uses Prisma `db push` (no migration history). When we add a
 * column to schema.prisma and deploy, the generated client selects that column
 * — but if production's database never had `db push` applied, every query
 * throws "column does not exist" and pages render empty (e.g. "No products
 * found"). This step applies *additive* schema changes automatically on each
 * deploy so that class of breakage can't happen.
 *
 * Safety:
 *   - `prisma db push` WITHOUT `--accept-data-loss`: additive changes (new
 *     columns/indexes) apply; a destructive change (dropping a column) errors
 *     instead of silently deleting production data.
 *   - We NEVER fail the build. Any error (DB unreachable, a change that needs
 *     manual review, missing env) is logged and the build continues — so a
 *     transient hiccup can't take down deploys. Worst case is the pre-existing
 *     behaviour (apply the change manually), never worse.
 *   - `db push` needs a direct (non-pooled) connection. We prefer
 *     DIRECT_DATABASE_URL and fall back to DATABASE_URL so it works even if
 *     only the pooled URL is configured in the deploy environment.
 */
const { execSync } = require('node:child_process');

const url = process.env.DIRECT_DATABASE_URL || process.env.DATABASE_URL;
if (!url) {
  console.warn('[db-sync] No DATABASE_URL / DIRECT_DATABASE_URL set — skipping schema sync.');
  process.exit(0);
}

try {
  execSync('npx prisma db push --skip-generate', {
    stdio: 'inherit',
    // Ensure schema.prisma's env("DIRECT_DATABASE_URL") resolves even when only
    // the pooled DATABASE_URL is present in the environment.
    env: { ...process.env, DIRECT_DATABASE_URL: url },
  });
  console.log('[db-sync] Database schema is in sync.');
} catch (e) {
  console.warn(
    '[db-sync] prisma db push did not complete — continuing build. ' +
      'If this was a real schema change, apply it manually (npm run prisma:push against the prod DB).',
  );
}
