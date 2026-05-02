/**
 * Policies endpoint.
 *
 * GET  /api/policies — list all policies (auto-seeds the five standard ones
 *                      on first call so a fresh install has rows to edit).
 * POST /api/policies — create a new custom policy with a unique slug.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';

const STANDARD_POLICIES: { slug: string; title: string; position: number }[] = [
  { slug: 'privacy-policy',       title: 'Privacy Policy',       position: 1 },
  { slug: 'terms-and-conditions', title: 'Terms & Conditions',   position: 2 },
  { slug: 'shipping-policy',      title: 'Shipping Policy',      position: 3 },
  { slug: 'pricing-policy',       title: 'Pricing Policy',       position: 4 },
  { slug: 'cancellation-policy',  title: 'Cancellation Policy',  position: 5 },
];

const createSchema = z.object({
  slug: z
    .string()
    .min(1)
    .regex(/^[a-z0-9-]+$/, 'Slug must be lowercase letters, digits, and dashes only.'),
  title: z.string().min(1),
  body: z.string().optional(),
  isActive: z.boolean().optional(),
  position: z.number().int().optional(),
});

export const GET = withAuth(async () => {
  try {
    // Idempotently seed the five standard slugs so the admin always has
    // them to edit — without overwriting any custom body that's been saved.
    await Promise.all(
      STANDARD_POLICIES.map((p) =>
        prisma.policy.upsert({
          where: { slug: p.slug },
          create: { slug: p.slug, title: p.title, body: '', position: p.position },
          update: {},
        }),
      ),
    );
    const policies = await prisma.policy.findMany({
      orderBy: [{ position: 'asc' }, { id: 'asc' }],
    });
    return ok({ policies });
  } catch (e) {
    return handleError(e);
  }
});

export const POST = withAuth(async (req) => {
  try {
    const body = createSchema.parse(await req.json());
    const policy = await prisma.policy.create({
      data: {
        slug: body.slug,
        title: body.title,
        body: body.body ?? '',
        isActive: body.isActive ?? true,
        position: body.position ?? 99,
      },
    });
    await revalidateWeb('policies');
    return ok({ policy }, { status: 201 });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'sales', 'staff']);
