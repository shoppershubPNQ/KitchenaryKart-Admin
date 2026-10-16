/** Create the website chatbot tables (chat_sessions, chat_messages, chat_rate_limits).
 *
 *  Additive and idempotent - safe to re-run. Raw SQL, the same as the courier
 *  tables (scripts/_tmp-create-shipment-tables.ts): the build-time `db push`
 *  is refused by unrelated drift, so tables the new code reads must exist
 *  BEFORE that code deploys. Matches prisma/schema.prisma exactly (names,
 *  types, defaults, index names), so a later push sees no drift:
 *   - `@updatedAt` columns have NO database default (Prisma sets them on every
 *     write; raw SQL in lib/chatbot/limits.ts + store.ts sets them explicitly);
 *   - `@default(uuid())` is generated client-side, so `id` has no default;
 *   - `content` is `json` (keeps key order for byte-exact replay), `tool_calls`
 *     is Prisma's default `jsonb`;
 *   - the foreign key gets Postgres's default name chat_messages_session_id_fkey,
 *     which is also Prisma's.
 *
 *  Usage (from admin/):  npx tsx scripts/create-chatbot-tables.ts           (dry run)
 *                        npx tsx scripts/create-chatbot-tables.ts --apply   (writes)
 *
 *  Rollback (manual, owner OK only):
 *    DROP TABLE IF EXISTS chat_messages; DROP TABLE IF EXISTS chat_sessions;
 *    DROP TABLE IF EXISTS chat_rate_limits;
 *    DELETE FROM settings WHERE key LIKE 'chatbot\_%';
 */
import { prisma } from '../lib/db';

const APPLY = process.argv.includes('--apply');

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS chat_sessions (
     id                  UUID PRIMARY KEY,
     created_at          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
     updated_at          TIMESTAMP(3) NOT NULL,
     model               VARCHAR(40) NOT NULL,
     token_hash          VARCHAR(64),
     prompt_version      VARCHAR(16) NOT NULL,
     ip_hash             VARCHAR(64),
     user_agent          VARCHAR(300),
     start_path          VARCHAR(300),
     tracking_session_id VARCHAR(40),
     user_message_count  INTEGER NOT NULL DEFAULT 0,
     input_tokens        INTEGER NOT NULL DEFAULT 0,
     output_tokens       INTEGER NOT NULL DEFAULT 0,
     cache_read_tokens   INTEGER NOT NULL DEFAULT 0,
     cache_write_tokens  INTEGER NOT NULL DEFAULT 0,
     cost_usd            DECIMAL(10,6) NOT NULL DEFAULT 0,
     lead_inquiry_id     INTEGER,
     order_lookups       INTEGER NOT NULL DEFAULT 0,
     handoff_shown       BOOLEAN NOT NULL DEFAULT false,
     busy_until          TIMESTAMP(3),
     closed_at           TIMESTAMP(3),
     last_error          VARCHAR(500)
   )`,
  // Added after the first version of this script: a table created by it
  // before then gets the column here (no-op otherwise).
  `ALTER TABLE chat_sessions ADD COLUMN IF NOT EXISTS token_hash VARCHAR(64)`,
  `CREATE INDEX IF NOT EXISTS chat_sessions_created_at_idx ON chat_sessions(created_at)`,
  `CREATE INDEX IF NOT EXISTS chat_sessions_updated_at_idx ON chat_sessions(updated_at)`,
  `CREATE INDEX IF NOT EXISTS chat_sessions_ip_hash_created_at_idx ON chat_sessions(ip_hash, created_at)`,
  `CREATE INDEX IF NOT EXISTS chat_sessions_lead_inquiry_id_idx ON chat_sessions(lead_inquiry_id)`,

  `CREATE TABLE IF NOT EXISTS chat_messages (
     id                 BIGSERIAL PRIMARY KEY,
     session_id         UUID NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE ON UPDATE CASCADE,
     role               VARCHAR(12) NOT NULL,
     kind               VARCHAR(16) NOT NULL,
     replay             BOOLEAN NOT NULL DEFAULT true,
     content            JSON NOT NULL,
     text               TEXT,
     tool_calls         JSONB,
     model              VARCHAR(40),
     stop_reason        VARCHAR(40),
     input_tokens       INTEGER NOT NULL DEFAULT 0,
     output_tokens      INTEGER NOT NULL DEFAULT 0,
     cache_read_tokens  INTEGER NOT NULL DEFAULT 0,
     cache_write_tokens INTEGER NOT NULL DEFAULT 0,
     cost_usd           DECIMAL(10,6) NOT NULL DEFAULT 0,
     created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
   )`,
  `CREATE INDEX IF NOT EXISTS chat_messages_session_id_id_idx ON chat_messages(session_id, id)`,
  `CREATE INDEX IF NOT EXISTS chat_messages_created_at_idx ON chat_messages(created_at)`,
  `CREATE INDEX IF NOT EXISTS chat_messages_kind_created_at_idx ON chat_messages(kind, created_at)`,

  `CREATE TABLE IF NOT EXISTS chat_rate_limits (
     key          VARCHAR(100) PRIMARY KEY,
     window_start TIMESTAMP(3) NOT NULL,
     count        INTEGER NOT NULL DEFAULT 0,
     updated_at   TIMESTAMP(3) NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS chat_rate_limits_updated_at_idx ON chat_rate_limits(updated_at)`,
];

const TABLES = ['chat_sessions', 'chat_messages', 'chat_rate_limits'];

async function present() {
  const t = await prisma.$queryRawUnsafe<Array<{ table_name: string }>>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name IN ('chat_sessions','chat_messages','chat_rate_limits')
      ORDER BY table_name`);
  const i = await prisma.$queryRawUnsafe<Array<{ indexname: string }>>(
    `SELECT indexname FROM pg_indexes
      WHERE tablename IN ('chat_sessions','chat_messages','chat_rate_limits') ORDER BY indexname`);
  return { tables: t.map((r) => r.table_name), indexes: i.map((r) => r.indexname) };
}

(async () => {
  const before = await present();
  console.log('tables before :', before.tables.join(', ') || 'none');
  if (!APPLY) {
    console.log(`\nwould run ${STATEMENTS.length} statements:\n`);
    for (const s of STATEMENTS) console.log('  ' + s.trim().split('\n')[0]);
    console.log('\nDRY RUN - re-run with --apply');
    return;
  }
  for (const sql of STATEMENTS) {
    await prisma.$executeRawUnsafe(sql);
    console.log('ok:', sql.trim().split('\n')[0].slice(0, 80));
  }
  const after = await present();
  console.log('\ntables after  :', after.tables.join(', '));
  console.log('indexes after :', after.indexes.join(', '));
  const missing = TABLES.filter((t) => !after.tables.includes(t));
  if (missing.length) { console.error('MISSING:', missing.join(', ')); process.exitCode = 1; }
})().finally(() => prisma.$disconnect());
