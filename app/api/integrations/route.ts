/**
 * Courier credentials.
 *
 * GET  masked state for the Integrations page — never a plaintext secret.
 * PUT  save one provider's credentials (encrypted at rest, lib/crypto.ts).
 *
 * Admin only. Deliberately separate from /api/settings, which is plain
 * key/value with no secret handling and renders every row as a visible input.
 */
import { z } from 'zod';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import { encryptionAvailable, decryptJson, maskSecret } from '@/lib/crypto';
import { saveCreds, SECRET_FIELDS } from '@/lib/integration-credentials';
import type { ShipmentProvider } from '@prisma/client';

const PROVIDERS: ShipmentProvider[] = ['shiprocket', 'delhivery'];

/** Public base of the admin app, so the page can show the exact webhook URL to
 *  paste into the courier's panel. */
function adminBase(): string {
  return (
    process.env.ADMIN_BASE_URL ||
    (process.env.NODE_ENV === 'production'
      ? 'https://kitchenary-kart-admin-nujh.vercel.app'
      : 'http://localhost:3000')
  );
}

export const GET = withAuth(async () => {
  try {
    const rows = await prisma.integrationCredential.findMany();
    const byProvider = new Map(rows.map((r) => [r.provider, r]));

    const integrations = PROVIDERS.map((provider) => {
      const row = byProvider.get(provider);
      const creds = row?.encrypted ? decryptJson<Record<string, string>>(row.encrypted) : null;
      const secrets = SECRET_FIELDS[provider];

      // Secrets are replaced by a mask; everything else (email, client name,
      // pickup location) is shown so the owner can confirm what is stored.
      const fields: Record<string, string> = {};
      if (creds) {
        for (const [k, v] of Object.entries(creds)) {
          fields[k] = secrets.includes(k) ? maskSecret(String(v)) : String(v ?? '');
        }
      }

      return {
        provider,
        configured: !!row?.encrypted,
        // A stored blob that will not decrypt means the encryption key changed
        // — say so plainly, because "configured" would be a lie.
        unreadable: !!row?.encrypted && creds === null,
        isActive: row?.isActive ?? false,
        fields,
        lastVerifiedAt: row?.lastVerifiedAt ?? null,
        lastError: row?.lastError ?? null,
        // ONE neutral endpoint for both couriers, identified by the secret
        // they present rather than by the path. Shiprocket refuses a webhook
        // URL containing "shiprocket", "sr" or "kr", so the provider name
        // cannot appear here — and putting the secret in the path would leak
        // it into every access log along the way.
        webhookUrl: `${adminBase()}/api/public/webhooks/courier`,
        webhookSecret: row?.webhookSecret ?? null,
        tokenExpiresAt: row?.tokenExpiresAt ?? null,
      };
    });

    return ok({
      integrations,
      // Without the key nothing can be saved or read, so the page shows a
      // banner instead of inputs that would fail on submit.
      encryptionAvailable,
    });
  } catch (e) {
    return handleError(e);
  }
}, ['admin']);

const shiprocketSchema = z.object({
  provider: z.literal('shiprocket'),
  isActive: z.boolean().optional(),
  fields: z.object({
    email: z.string().email(),
    password: z.string().min(1),
    pickupLocation: z.string().trim().optional(),
    channelId: z.string().trim().optional(),
  }),
});

const delhiverySchema = z.object({
  provider: z.literal('delhivery'),
  isActive: z.boolean().optional(),
  fields: z.object({
    apiToken: z.string().min(1),
    clientName: z.string().min(1),
    pickupLocation: z.string().trim().optional(),
    useStaging: z.boolean().optional(),
  }),
});

const schema = z.discriminatedUnion('provider', [shiprocketSchema, delhiverySchema]);

export const PUT = withAuth(async (req) => {
  try {
    if (!encryptionAvailable) {
      return fail(
        'INTEGRATION_ENC_KEY is not set on this deployment, so credentials cannot be encrypted. Add it in Vercel and redeploy.',
        503,
      );
    }
    const body = schema.parse(await req.json());

    // The mask is what GET sends back, so a form saved without retyping the
    // secret would otherwise store the literal bullets. Keep the stored value.
    const existingRow = await prisma.integrationCredential.findUnique({
      where: { provider: body.provider },
    });
    const existing = existingRow?.encrypted
      ? decryptJson<Record<string, string>>(existingRow.encrypted)
      : null;

    const merged: Record<string, unknown> = { ...body.fields };
    for (const key of SECRET_FIELDS[body.provider]) {
      const val = (body.fields as Record<string, unknown>)[key];
      if (typeof val === 'string' && val.startsWith('••••') && existing?.[key]) {
        merged[key] = existing[key];
      }
    }

    await saveCreds(body.provider, merged, body.isActive ?? true);
    return ok({ saved: true, provider: body.provider });
  } catch (e) {
    if (e instanceof z.ZodError) return fail(e.issues[0]?.message ?? 'Bad request', 400);
    return handleError(e);
  }
}, ['admin']);
