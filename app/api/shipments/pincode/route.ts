/**
 * GET /api/shipments/pincode?pin=411048 — Delhivery serviceability for the
 * shipping panel. Also fills the state/district the address blob often lacks.
 */
import { NextRequest } from 'next/server';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { pincodeCheck } from '@/lib/shipments';
import { DelhiveryError } from '@/lib/integrations/delhivery';

export const dynamic = 'force-dynamic';

export const GET = withAuth(async (req: NextRequest) => {
  try {
    const pin = new URL(req.url).searchParams.get('pin')?.trim() ?? '';
    if (!/^\d{6}$/.test(pin)) return fail('Pincode must be 6 digits', 400);
    return ok(await pincodeCheck(pin));
  } catch (e) {
    if (e instanceof DelhiveryError) return fail(e.message, 422);
    return handleError(e);
  }
}, ['admin', 'staff']);
