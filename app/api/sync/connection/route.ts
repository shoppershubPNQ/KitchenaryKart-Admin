/**
 * The inbound connection: which partner catalogue we import FROM.
 *
 *   GET    status (never the key itself — only a masked form)
 *   PUT    save; a blank apiKey keeps the stored one
 *   DELETE disconnect, keeping imported products and history
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { connectionStatus, disconnect, saveConnection, testConnection } from '@/lib/sync-connection';
import { statusCounts } from '@/lib/sync-consumer';
import { PARTNER_SOURCE } from '@/lib/sync-connection';

export const dynamic = 'force-dynamic';

async function fullStatus() {
  const [status, counts, lastRun, known] = await Promise.all([
    connectionStatus(),
    statusCounts(),
    prisma.syncRun.findFirst({
      where: { source: PARTNER_SOURCE },
      orderBy: { startedAt: 'desc' },
    }),
    prisma.syncLink.count({ where: { source: PARTNER_SOURCE } }),
  ]);
  return { ...status, counts, known_listings: known, last_run: lastRun };
}

export const GET = withAuth(async () => {
  try {
    return ok(await fullStatus());
  } catch (e) {
    return handleError(e);
  }
});

const saveSchema = z.object({
  baseUrl: z.string().trim().min(1, 'baseUrl is required').max(500),
  apiKey: z.string().trim().max(200).optional(),
});

export const PUT = withAuth(async (req: NextRequest) => {
  try {
    const body = saveSchema.parse(await req.json());
    await saveConnection(body.baseUrl, body.apiKey);
    const test = await testConnection();
    return ok({
      status: await fullStatus(),
      test,
      message: test.ok
        ? 'Hotelic Essentials connected. Run a scan to see what is available to import.'
        : `Connection saved, but the test failed: ${test.message}`,
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);

export const DELETE = withAuth(async () => {
  try {
    await disconnect();
    return ok({
      status: await fullStatus(),
      message: 'Hotelic Essentials disconnected. Imported products and history are kept.',
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
