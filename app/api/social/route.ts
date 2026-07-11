/**
 * Social-link settings — convenience wrapper around the generic Setting
 * key/value table. Stores keys `social.<platform>` and busts the storefront
 * cache after each save so the footer updates immediately.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const PLATFORMS = ['instagram', 'youtube', 'twitter', 'facebook', 'whatsapp', 'linkedin'] as const;
type Platform = typeof PLATFORMS[number];

const updateSchema = z.object(
  Object.fromEntries(
    PLATFORMS.map((p) => [p, z.string().max(500).optional()]),
  ) as Record<Platform, z.ZodOptional<z.ZodString>>,
);

export const GET = withAuth(async () => {
  try {
    const keys = PLATFORMS.map((p) => `social.${p}`);
    const rows = await prisma.setting.findMany({ where: { key: { in: keys } } });
    const links: Record<string, string> = {};
    for (const p of PLATFORMS) links[p] = '';
    for (const r of rows) {
      const platform = r.key.replace(/^social\./, '');
      if (PLATFORMS.includes(platform as Platform)) links[platform] = r.value || '';
    }
    return ok({ links });
  } catch (e) {
    return handleError(e);
  }
});

export const PUT = withAuth(async (req) => {
  try {
    const body = updateSchema.parse(await req.json());
    await Promise.all(
      PLATFORMS.map((p) => {
        const value = (body[p] ?? '').toString().trim();
        return prisma.setting.upsert({
          where: { key: `social.${p}` },
          create: { key: `social.${p}`, value, dataType: 'url' },
          update: { value, dataType: 'url' },
        });
      }),
    );
    await revalidateWeb('social');
    return ok({ saved: true });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
