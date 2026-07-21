import { z } from 'zod';

/**
 * Shared Zod schema for the Featured Spotlight routes. Kept in lib/ (not in the
 * route file) because Next.js only allows the HTTP-method exports from a
 * route.ts — exporting anything else fails `next build`'s route validation.
 * All content blocks are optional so a half-filled spotlight still saves.
 */
export const spotlightSchema = z.object({
  slug: z
    .string()
    .min(1)
    .max(80)
    .regex(/^[a-z0-9-]+$/, 'Slug: lowercase letters, numbers and hyphens only'),
  productSku: z.string().min(1),
  eyebrow: z.string().nullable().optional(),
  headline: z.string().nullable().optional(),
  videoUrl: z.string().nullable().optional(),
  videoPoster: z.string().nullable().optional(),
  keyFeatures: z.array(z.string()).optional(),
  specifications: z.array(z.object({ label: z.string(), value: z.string() })).optional(),
  packagingIncludes: z.array(z.string()).optional(),
  idealFor: z.array(z.string()).optional(),
  whyBuy: z.array(z.object({ title: z.string(), text: z.string() })).optional(),
  comparison: z
    .object({
      kkLabel: z.string().nullable().optional(),
      othersLabel: z.string().nullable().optional(),
      rows: z.array(z.object({ feature: z.string(), kk: z.string(), others: z.string() })),
    })
    .optional(),
  careDisposal: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  position: z.number().int().optional(),
  isActive: z.boolean().optional(),
});
