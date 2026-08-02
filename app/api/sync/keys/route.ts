/**
 * Sync API key management. Admin-session authenticated (NOT key-authenticated)
 * — this is the panel issuing credentials, not a partner consuming them.
 *
 *   GET  /api/sync/keys   list issued keys + usage
 *   POST /api/sync/keys   issue a new key (plaintext returned exactly once)
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { generateSyncKey } from '@/lib/sync-auth';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async () => {
  try {
    const keys = await prisma.syncApiKey.findMany({
      orderBy: [{ revokedAt: 'asc' }, { createdAt: 'desc' }],
      include: { createdBy: { select: { name: true } } },
    });

    return ok({
      keys: keys.map((key) => ({
        id: key.id,
        name: key.name,
        // Never the hash — the prefix is all the UI can (and needs to) show.
        key_prefix: key.keyPrefix,
        last_used_at: key.lastUsedAt,
        last_used_ip: key.lastUsedIp,
        request_count: key.requestCount,
        revoked_at: key.revokedAt,
        active: key.revokedAt === null,
        created_at: key.createdAt,
        created_by: key.createdBy?.name ?? null,
      })),
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);

const createSchema = z.object({
  name: z.string().trim().min(1, 'Give the key a name so you can tell them apart').max(120),
});

export const POST = withAuth(async (req: NextRequest, { user }) => {
  try {
    const body = createSchema.parse(await req.json());
    const { key, keyPrefix, keyHash } = generateSyncKey();

    const created = await prisma.syncApiKey.create({
      data: { name: body.name, keyPrefix, keyHash, createdById: user.id },
    });

    return ok(
      {
        // The ONLY time the plaintext exists outside the partner's config. It
        // is not recoverable afterwards — the row holds a hash.
        key,
        warning: 'Copy this key now — it cannot be shown again.',
        created: {
          id: created.id,
          name: created.name,
          key_prefix: created.keyPrefix,
          created_at: created.createdAt,
          active: true,
          request_count: 0,
        },
      },
      { status: 201 },
    );
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
