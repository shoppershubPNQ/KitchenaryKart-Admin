/**
 * GET/PUT /api/sync/pricing
 *
 * The re-pricing rule applied to everything imported from the partner. Kept
 * beside the connection rather than in Settings: it is a property of THIS link,
 * and the operator setting it up is the one who knows the trade terms.
 */
import { NextRequest } from 'next/server';
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { getPricingRule, pricingPreview, savePricingRule } from '@/lib/sync-pricing';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async () => {
  try {
    const rule = await getPricingRule();
    return ok({ rule, preview: pricingPreview(rule) });
  } catch (e) {
    return handleError(e);
  }
});

const schema = z.object({
  // Signed: +30 marks up, -30 marks down. Clamped either side of a write-off.
  percent: z.number().min(-95).max(500),
  gstMode: z.enum(['remove', 'add', 'none']),
});

export const PUT = withAuth(async (req: NextRequest) => {
  try {
    const body = schema.parse(await req.json());
    const rule = await savePricingRule(body.percent, body.gstMode);
    const preview = pricingPreview(rule);
    return ok({
      rule,
      preview,
      message: `Import pricing saved — ${preview.note} ₹${preview.sample} becomes ₹${preview.result}.`,
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);
