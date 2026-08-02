/**
 * DELETE /api/sync/keys/[id]
 *
 * Revokes a sync key. The row is kept (not deleted) so the usage history stays
 * readable in the Sync tab; auth rejects the key from this moment on.
 */
import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';

export const dynamic = 'force-dynamic';

export const DELETE = withAuth(async (_req: NextRequest, { params }) => {
  try {
    const id = Number(params?.id);
    if (!Number.isInteger(id)) return fail('Invalid key id', 400);

    const key = await prisma.syncApiKey.findUnique({ where: { id } });
    if (!key) return fail('Key not found', 404);
    if (key.revokedAt) return ok({ revoked: true, already: true, id });

    await prisma.syncApiKey.update({ where: { id }, data: { revokedAt: new Date() } });

    return ok({
      revoked: true,
      id,
      message: `"${key.name}" revoked. Any panel still using it will get a 401 on its next sync.`,
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
