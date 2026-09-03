/**
 * POST /api/integrations/test — prove a courier account actually works.
 *
 * Makes a REAL authenticated call, not just a credential-shape check: saving a
 * password only proves it was typed. Shiprocket re-logins and reads the pickup
 * locations; Delhivery does a pincode lookup. The result is stamped onto the
 * row so the Integrations page can say "connected" honestly.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { setVerified, providerEnabled } from '@/lib/integration-credentials';
import { testShiprocket } from '@/lib/integrations/shiprocket';
import { testDelhivery } from '@/lib/integrations/delhivery';

const schema = z.object({ provider: z.enum(['shiprocket', 'delhivery']) });

/**
 * Couriers lock an account after a few failed logins. Once one says so, keep
 * the button from making it worse — retrying is exactly what extends the
 * lockout, and the operator cannot tell that from the outside.
 */
const LOCKOUT_WORDS = /blocked|too many|locked|rate limit|throttl/i;
const LOCKOUT_COOLDOWN_MS = 30 * 60 * 1000;

export const POST = withAuth(async (req) => {
  try {
    const { provider } = schema.parse(await req.json());

    if (!(await providerEnabled(provider))) {
      return fail('Save the credentials first, and make sure the integration is switched on.', 400);
    }

    const row = await prisma.integrationCredential.findUnique({ where: { provider } });
    if (row?.lastError && LOCKOUT_WORDS.test(row.lastError)) {
      const since = Date.now() - row.updatedAt.getTime();
      if (since < LOCKOUT_COOLDOWN_MS) {
        const mins = Math.ceil((LOCKOUT_COOLDOWN_MS - since) / 60000);
        return ok({
          ok: false,
          provider,
          detail:
            `${row.lastError} Retrying now would extend the lock, so this is paused for about ${mins} more minute${mins === 1 ? '' : 's'}. ` +
            `Check the password by signing in to the courier's own panel first — saving new credentials clears this wait.`,
        });
      }
    }

    try {
      const res = provider === 'shiprocket' ? await testShiprocket() : await testDelhivery();
      await setVerified(provider, null);
      return ok({ ok: true, provider, detail: res.detail });
    } catch (e) {
      // The courier's own words are the useful part ("pickup location not
      // found", "invalid token") — store and return those, not a generic 500.
      const message = e instanceof Error ? e.message : 'Connection failed';
      await setVerified(provider, message.slice(0, 500));
      return ok({ ok: false, provider, detail: message });
    }
  } catch (e) {
    if (e instanceof z.ZodError) return fail('Bad request', 400);
    return handleError(e);
  }
}, ['admin']);
