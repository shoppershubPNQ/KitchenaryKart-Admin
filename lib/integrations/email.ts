/** Email via SMTP (Nodemailer). Stubbed when credentials are missing. */
import nodemailer from 'nodemailer';

export const emailEnabled = Boolean(
  process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS
);

let transporter: nodemailer.Transporter | null = null;

function getTransporter() {
  if (!emailEnabled) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT || '587'),
    secure: (process.env.SMTP_PORT || '587') === '465',
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
  });
  return transporter;
}

export async function sendEmail(to: string, subject: string, html: string): Promise<{ sent: boolean; reason?: string }> {
  const t = getTransporter();
  if (!t) {
    console.log(`[email:stub] → ${to} — ${subject}`);
    return { sent: false, reason: 'SMTP not configured' };
  }
  await t.sendMail({
    from: process.env.SMTP_FROM || 'no-reply@kitchenarykart.com',
    to,
    subject,
    html,
  });
  return { sent: true };
}
