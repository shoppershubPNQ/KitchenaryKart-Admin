/** One-off, idempotent: extend analytics_events for first-party visitor
 *  tracking. Additive only (nullable columns + indexes); the table was empty.
 *  Index names match Prisma's defaults so the schema and DB agree. */
import { prisma } from '../lib/db';

const SQL = [
  'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS visitor_id VARCHAR(40)',
  'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS session_id VARCHAR(40)',
  'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS path TEXT',
  'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS sku TEXT',
  'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS order_number TEXT',
  'ALTER TABLE analytics_events ADD COLUMN IF NOT EXISTS duration_ms INTEGER',
  'CREATE INDEX IF NOT EXISTS analytics_events_session_id_idx ON analytics_events (session_id)',
  'CREATE INDEX IF NOT EXISTS analytics_events_visitor_id_idx ON analytics_events (visitor_id)',
  'CREATE INDEX IF NOT EXISTS analytics_events_order_number_idx ON analytics_events (order_number)',
  'CREATE INDEX IF NOT EXISTS analytics_events_event_type_created_at_idx ON analytics_events (event_type, created_at)',
];

(async () => {
  const before = await prisma.$queryRawUnsafe<Array<{ n: bigint }>>('SELECT COUNT(*) AS n FROM analytics_events');
  console.log('rows in analytics_events before:', Number(before[0].n));
  for (const s of SQL) {
    await prisma.$executeRawUnsafe(s);
    console.log('ok:', s);
  }
  const cols = await prisma.$queryRawUnsafe<Array<{ column_name: string; data_type: string }>>(
    "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'analytics_events' ORDER BY ordinal_position",
  );
  console.log(cols.map((c) => `${c.column_name}:${c.data_type}`).join(', '));
  await prisma.$disconnect();
})();
