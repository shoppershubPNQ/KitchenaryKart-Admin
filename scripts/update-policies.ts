/**
 * One-shot policy updater (2026-05-23):
 *   1. Append "Your Rights Under DPDPA 2023" + Grievance Officer
 *      blocks to the Privacy Policy (was missing — outstanding since
 *      2026-05-20 compliance audit).
 *   2. Insert an explicit Refund Policy link into the T&C "Returns
 *      and Exchanges" section (was a vague reference; now links to
 *      /policy/refund-policy).
 *
 * Idempotent — if the marker phrases already exist in the body the
 * script logs "already up-to-date" and exits without rewriting.
 *
 * After saving, hits the storefront's revalidate endpoint for the
 * `policies` tag so the footer + /policy/* pages refresh within seconds.
 */
import { prisma } from '../lib/db';

const DPDPA_MARKER = 'Your Rights Under the Digital Personal Data Protection Act';
const REFUND_LINK_MARKER = 'kitchenarykart.com/policy/refund-policy';

const PRIVACY_APPENDIX = `

Your Rights Under the Digital Personal Data Protection Act, 2023
As a Data Principal under DPDPA 2023, you have the following rights with respect to your personal data:

- Right to Access: Obtain a summary of the personal data being processed by Kitchenary Kart and the processing activities undertaken with that data.
- Right to Correction and Erasure: Request correction of inaccurate or misleading personal data, completion of incomplete data, updating of outdated data, and erasure of personal data that is no longer necessary for the purpose it was collected.
- Right to Grievance Redressal: Use the grievance mechanism described below for any act or omission of Kitchenary Kart regarding the exercise of your rights or the performance of obligations under DPDPA 2023.
- Right to Nominate: Nominate another individual to exercise these rights in the event of your death or incapacity.
- Right to Withdraw Consent: Withdraw any consent previously given for the processing of your personal data, at any time, with the same ease with which it was given. Withdrawal does not affect the lawfulness of processing based on consent before its withdrawal.

How We Process Your Data Under DPDPA 2023
Kitchenary Kart acts as the Data Fiduciary for personal data collected through this Site. We process personal data only for lawful purposes for which you have provided consent, or for legitimate uses permitted under DPDPA 2023 (such as fulfilling orders you have placed, complying with legal obligations, or responding to medical or safety emergencies).

Data Retention: We retain personal data only for as long as necessary to fulfil the purpose for which it was collected, including any legal, accounting, tax, or reporting requirements. Order and invoice records are retained for a minimum of 8 years to comply with GST and Income Tax law. On expiry of the retention period or when the purpose is fulfilled, personal data is erased unless retention is required by law.

Consent and Withdrawal: Where processing is based on your consent, you may withdraw that consent at any time by writing to the Grievance Officer named below. Withdrawal of consent may limit our ability to provide certain services (for example, order fulfilment will not be possible without your shipping address).

Children's Data: We do not knowingly collect or process personal data of children under 18 years of age. If you believe a child has shared personal data with us, please contact the Grievance Officer for prompt deletion.

Data Protection Board of India: If your grievance is not satisfactorily addressed by us within the prescribed time, you may approach the Data Protection Board of India through the channels notified by the Government of India under DPDPA 2023.

Grievance Officer
In accordance with the Information Technology Act, 2000, the Consumer Protection (E-Commerce) Rules, 2020, and the Digital Personal Data Protection Act, 2023, the Grievance Officer for Kitchenary Kart is:

Name: Vishakha
Designation: Grievance Officer, Kitchenary Kart (Shoppers Hub, Proprietorship)
Address: A2/103, Parshwanagar, Opp. Swami Vivekanand Garden, Kondhwa Budruk, Pune – 411048, Maharashtra, India
Email: support@kitchenarykart.com
Phone: +91 98903 52455
Working Hours: Monday to Saturday, 10:00 AM to 6:00 PM IST (excluding public holidays)

We acknowledge every grievance within 48 hours of receipt and aim to resolve it within 15 days, as required under the IT Rules, 2021. Grievances relating to personal data under DPDPA 2023 are resolved within 30 days.

Last updated: 23 May 2026.`;

const OLD_RETURNS_LINE =
  'Customers are encouraged to review our Return Policy for detailed information on how to return or exchange a product.';
const NEW_RETURNS_LINE =
  'For full return / refund eligibility, timelines, restocking fees, and the step-by-step process, please review our Refund Policy at https://kitchenarykart.com/policy/refund-policy before raising a request.';

async function bustCache() {
  const SITE_URL = process.env.STOREFRONT_URL || 'https://kitchenarykart.com';
  try {
    const res = await fetch(`${SITE_URL}/api/revalidate?tag=policies`, { method: 'POST' });
    console.log(`[cache] ${SITE_URL}/api/revalidate?tag=policies →`, res.status);
  } catch (e) {
    console.warn('[cache] revalidate failed (the storefront will refresh on next ISR window):', e);
  }
}

async function main() {
  // ── Privacy Policy ──────────────────────────────────────────
  const priv = await prisma.policy.findUnique({ where: { slug: 'privacy-policy' } });
  if (!priv) {
    console.warn('[privacy] policy row not found — nothing to update');
  } else if (priv.body.includes(DPDPA_MARKER)) {
    console.log('[privacy] DPDPA / Grievance Officer section already present — skipping');
  } else {
    const newBody = priv.body.trimEnd() + PRIVACY_APPENDIX;
    await prisma.policy.update({
      where: { id: priv.id },
      data: { body: newBody },
    });
    console.log(`[privacy] appended DPDPA + Grievance Officer section (+${newBody.length - priv.body.length} chars)`);
  }

  // ── Terms & Conditions ─────────────────────────────────────
  const tnc = await prisma.policy.findUnique({ where: { slug: 'terms-and-conditions' } });
  if (!tnc) {
    console.warn('[tnc] policy row not found — nothing to update');
  } else if (tnc.body.includes(REFUND_LINK_MARKER)) {
    console.log('[tnc] refund policy link already present — skipping');
  } else if (!tnc.body.includes(OLD_RETURNS_LINE)) {
    console.warn('[tnc] could not find old returns line to replace — leave manual update for admin');
  } else {
    const newBody = tnc.body.replace(OLD_RETURNS_LINE, NEW_RETURNS_LINE);
    await prisma.policy.update({
      where: { id: tnc.id },
      data: { body: newBody },
    });
    console.log('[tnc] inserted refund policy URL into Returns and Exchanges section');
  }

  await bustCache();
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
