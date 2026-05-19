/**
 * Transactional email via Resend, mirroring web/lib/email.ts.
 *
 * Admin only — used for order confirmation, status updates, and other
 * post-checkout messages to customers. The OTP login email lives on the
 * storefront under web/lib/email.ts and uses the same Resend account.
 *
 * Falls back to a no-op (logs to console) when RESEND_API_KEY is missing,
 * so admin functionality isn't blocked by misconfigured environments.
 */
import { Resend } from 'resend';

let client: Resend | null = null;

function getClient(): Resend | null {
  if (client) return client;
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.warn('[kk:email] RESEND_API_KEY missing — emails will NOT be sent.');
    return null;
  }
  client = new Resend(key);
  return client;
}

function getFromHeader(): string {
  const email = process.env.RESEND_FROM_EMAIL || 'noreply@kitchenarykart.com';
  const name = process.env.RESEND_FROM_NAME || 'KitchenaryKart';
  return `${name} <${email}>`;
}

interface SendArgs {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Optional tag for Resend dashboard / logs grouping. */
  category?: string;
}

/**
 * Send a transactional email via Resend. Returns true on success.
 * Never throws — callers decide whether email failure blocks their flow
 * (typically not — order completion should not fail if email fails).
 */
export async function sendEmail({ to, subject, html, text, category }: SendArgs): Promise<boolean> {
  const resend = getClient();
  if (!resend) return false;

  try {
    const result = await resend.emails.send({
      from: getFromHeader(),
      to,
      subject,
      html,
      text,
      tags: category ? [{ name: 'category', value: category }] : undefined,
    });
    if (result.error) {
      console.error('[kk:email] Resend error:', result.error);
      return false;
    }
    console.log(`[kk:email] sent to ${to} (id=${result.data?.id}, cat=${category || 'none'})`);
    return true;
  } catch (err) {
    console.error('[kk:email] sendEmail threw:', err);
    return false;
  }
}
