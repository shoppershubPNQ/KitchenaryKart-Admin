/**
 * Shared shell for every customer-facing email.
 *
 * MIRRORED in web/lib/email-layout.ts — the two projects deploy separately and
 * share no package, so a change here must be copied there (same as the Prisma
 * schemas). Keep the two files identical.
 *
 * Why it is built the way it is, rather than as normal web markup:
 *
 * - TABLES, not divs with flex/grid. Outlook on Windows renders through Word,
 *   which has no flexbox, no grid and no max-width on a div.
 * - FLUID WIDTH *AND* MEDIA QUERIES. Gmail's app renders non-Gmail accounts
 *   through a path that drops <style>, so the media queries silently vanish.
 *   Every table is therefore width:100% with max-width:600px, which already
 *   fits a phone on its own; the media queries only refine spacing and type.
 * - A PREHEADER. Gmail shows this after the subject in the inbox list. Left
 *   out, it pulls whatever text comes first, which is usually the brand name.
 * - INLINE STYLES on anything that matters. Embedded CSS is stripped by some
 *   clients; the <style> block is treated as an enhancement, never a
 *   requirement.
 * - NO background images and no web fonts: both fail silently often enough
 *   that the fallback has to look finished on its own.
 */

export const BRAND = {
  red: '#A01818',
  redDark: '#7A1212',
  ink: '#1A1A1A',
  body: '#3F3B38',
  muted: '#8A8178',
  line: '#E8E2D4',
  lineSoft: '#F0EBDE',
  cream: '#F5F1EA',
  creamSoft: '#FAF7EE',
  white: '#FFFFFF',
  green: '#1E7A4C',
} as const;

export const SUPPORT_EMAIL = 'support@kitchenarykart.com';
export const WHATSAPP_NUMBER = '+91 98903 52455';
export const WHATSAPP_LINK = 'https://wa.me/919890352455';
export const STORE_URL = 'https://kitchenarykart.com';

const FONT = `-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif`;

export function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function inr(n: unknown): string {
  return '₹' + Number(n ?? 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/**
 * A button that survives Outlook. The MSO conditional draws a rectangle behind
 * the link, because Word ignores padding and border-radius on an anchor — the
 * link would otherwise be bare blue text.
 */
export function button(label: string, href: string, opts: { colour?: string } = {}): string {
  const bg = opts.colour ?? BRAND.red;
  return `
  <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
    <tr>
      <td align="center" bgcolor="${bg}" style="border-radius:8px;">
        <!--[if mso]>
        <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" xmlns:w="urn:schemas-microsoft-com:office:word"
          href="${esc(href)}" style="height:46px;v-text-anchor:middle;width:280px;" arcsize="18%" stroke="f" fillcolor="${bg}">
          <w:anchorlock/><center style="color:#ffffff;font-family:${FONT};font-size:15px;font-weight:bold;">${esc(label)}</center>
        </v:roundrect>
        <![endif]-->
        <!--[if !mso]><!-- -->
        <a href="${esc(href)}" class="kk-btn"
           style="display:inline-block;background:${bg};color:#ffffff;text-decoration:none;font-family:${FONT};font-size:15px;font-weight:600;line-height:20px;padding:13px 30px;border-radius:8px;letter-spacing:0.2px;">${esc(label)}</a>
        <!--<![endif]-->
      </td>
    </tr>
  </table>`;
}

/** Small caps label above a value — "ORDER NUMBER", "SHIPPING TO" etc. */
export function label(text: string): string {
  return `<div style="color:${BRAND.muted};font-size:11px;letter-spacing:1px;text-transform:uppercase;font-weight:600;margin:0 0 6px 0;">${esc(text)}</div>`;
}

export function paragraph(html: string, opts: { muted?: boolean; size?: number } = {}): string {
  const colour = opts.muted ? BRAND.muted : BRAND.body;
  const size = opts.size ?? 15;
  return `<p style="margin:0 0 14px 0;color:${colour};font-size:${size}px;line-height:1.6;">${html}</p>`;
}

/** Tinted panel for the few facts that matter most (tracking number, totals). */
export function panel(innerHtml: string): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"
         style="background:${BRAND.creamSoft};border:1px solid ${BRAND.line};border-radius:10px;">
    <tr><td class="kk-panel" style="padding:18px 20px;">${innerHtml}</td></tr>
  </table>`;
}

/** label / value rows that stay readable when they wrap on a phone. */
export function factRows(rows: Array<{ k: string; v: string; mono?: boolean }>): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${rows
      .map(
        (r, i) => `
      <tr>
        <td style="padding:${i ? '8px' : '0'} 0 0 0;color:${BRAND.muted};font-size:13px;line-height:1.5;">${esc(r.k)}</td>
      </tr>
      <tr>
        <td style="padding:2px 0 0 0;color:${BRAND.ink};font-size:15px;font-weight:600;line-height:1.5;${
          r.mono ? `font-family:'Courier New',Courier,monospace;letter-spacing:0.5px;` : ''
        }">${esc(r.v)}</td>
      </tr>`,
      )
      .join('')}
  </table>`;
}

/**
 * Order lines. The name and the amount sit in one row on desktop; on a narrow
 * screen the amount keeps its column rather than stacking, because a price
 * that jumps below the name reads as a separate line item.
 */
export function itemsTable(
  items: Array<{ name: string; meta?: string; amount: string }>,
): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${items
      .map(
        (it) => `
      <tr>
        <td style="padding:12px 12px 12px 0;border-bottom:1px solid ${BRAND.lineSoft};vertical-align:top;">
          <div style="color:${BRAND.ink};font-size:14px;font-weight:600;line-height:1.45;">${esc(it.name)}</div>
          ${it.meta ? `<div style="color:${BRAND.muted};font-size:12px;line-height:1.5;margin-top:3px;">${esc(it.meta)}</div>` : ''}
        </td>
        <td style="padding:12px 0;border-bottom:1px solid ${BRAND.lineSoft};text-align:right;vertical-align:top;white-space:nowrap;color:${BRAND.ink};font-size:14px;font-weight:600;">${esc(it.amount)}</td>
      </tr>`,
      )
      .join('')}
  </table>`;
}

export function totalsTable(rows: Array<{ k: string; v: string; strong?: boolean }>): string {
  return `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
    ${rows
      .map(
        (r) => `
      <tr>
        <td style="padding:${r.strong ? '10px 0 0 0' : '5px 0 0 0'};${
          r.strong ? `border-top:1px solid ${BRAND.line};` : ''
        }color:${r.strong ? BRAND.ink : BRAND.body};font-size:${r.strong ? '16px' : '14px'};font-weight:${
          r.strong ? '700' : '400'
        };">${esc(r.k)}</td>
        <td style="padding:${r.strong ? '10px 0 0 0' : '5px 0 0 0'};${
          r.strong ? `border-top:1px solid ${BRAND.line};` : ''
        }text-align:right;white-space:nowrap;color:${r.strong ? BRAND.ink : BRAND.body};font-size:${
          r.strong ? '16px' : '14px'
        };font-weight:${r.strong ? '700' : '600'};">${esc(r.v)}</td>
      </tr>`,
      )
      .join('')}
  </table>`;
}

export function spacer(px = 22): string {
  return `<div style="line-height:${px}px;height:${px}px;font-size:0;">&nbsp;</div>`;
}

export interface ShellInput {
  /** Inbox preview line, shown right after the subject. */
  preheader: string;
  subject: string;
  /** Small uppercase chip above the heading, e.g. "Order confirmed". */
  eyebrow?: string;
  heading: string;
  /** Main content, already-built HTML blocks. */
  body: string;
  /** Extra line in the footer above the standard contact block. */
  footerNote?: string;
  /**
   * Drop the "reply to this email" offer. Set it on anything sent from the
   * noreply address (the OTP), where inviting a reply sends the customer into
   * a mailbox nobody reads.
   */
  quiet?: boolean;
}

/**
 * Wraps content in the branded frame. Everything a client might drop — the
 * <style> block, dark-mode rules, the rounded corners — is decoration; the
 * inline styles alone already produce a finished email.
 */
export function emailShell({ preheader, subject, eyebrow, heading, body, footerNote, quiet }: ShellInput): string {
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta http-equiv="X-UA-Compatible" content="IE=edge" />
<meta name="color-scheme" content="light" />
<meta name="supported-color-schemes" content="light" />
<title>${esc(subject)}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  /* Enhancement only — assume any of this can be dropped. */
  body { margin:0 !important; padding:0 !important; width:100% !important; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%; }
  table { border-collapse:collapse !important; mso-table-lspace:0pt; mso-table-rspace:0pt; }
  img { border:0; outline:none; text-decoration:none; -ms-interpolation-mode:bicubic; }
  a { color:${BRAND.red}; }
  @media screen and (max-width:600px) {
    .kk-pad { padding-left:20px !important; padding-right:20px !important; }
    .kk-panel { padding:16px !important; }
    .kk-h1 { font-size:22px !important; line-height:1.3 !important; }
    /* A thumb-sized target beats a neat inline button on a phone. */
    .kk-btn { display:block !important; width:100% !important; box-sizing:border-box !important; text-align:center !important; padding:15px 20px !important; }
    .kk-card { border-radius:0 !important; border-left:0 !important; border-right:0 !important; }
    .kk-outer { padding:0 !important; }
  }
</style>
</head>
<body style="margin:0;padding:0;background:${BRAND.cream};">
  <!-- Inbox preview text, then blank characters so the client does not pull body copy in after it. -->
  <div style="display:none;font-size:1px;color:${BRAND.cream};line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;mso-hide:all;">
    ${esc(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;
  </div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${BRAND.cream};">
    <tr>
      <td class="kk-outer" align="center" style="padding:32px 12px;">

        <table role="presentation" class="kk-card" width="600" cellpadding="0" cellspacing="0" border="0"
               style="width:100%;max-width:600px;background:${BRAND.white};border:1px solid ${BRAND.line};border-radius:14px;overflow:hidden;">

          <!-- Brand bar -->
          <tr>
            <td align="center" style="background:${BRAND.ink};padding:18px 24px;">
              <a href="${STORE_URL}" style="text-decoration:none;">
                <span style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;color:${BRAND.white};letter-spacing:0.6px;">Kitchenary</span><span style="font-family:Georgia,'Times New Roman',serif;font-size:21px;font-weight:700;color:#E7C9A0;letter-spacing:0.6px;">Kart</span>
              </a>
            </td>
          </tr>

          <!-- Content -->
          <tr>
            <td class="kk-pad" style="padding:30px 34px 10px 34px;font-family:${FONT};">
              ${
                eyebrow
                  ? `<div style="margin:0 0 12px 0;"><span style="display:inline-block;background:${BRAND.creamSoft};border:1px solid ${BRAND.line};color:${BRAND.red};font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;padding:5px 12px;border-radius:999px;">${esc(eyebrow)}</span></div>`
                  : ''
              }
              <h1 class="kk-h1" style="margin:0 0 14px 0;color:${BRAND.ink};font-size:25px;line-height:1.28;font-weight:700;letter-spacing:-0.2px;">${esc(heading)}</h1>
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="kk-pad" style="padding:22px 34px 28px 34px;border-top:1px solid ${BRAND.lineSoft};font-family:${FONT};">
              ${footerNote ? `<p style="margin:0 0 12px 0;color:${BRAND.muted};font-size:12.5px;line-height:1.6;">${footerNote}</p>` : ''}
              <p style="margin:0 0 10px 0;color:${BRAND.body};font-size:13px;line-height:1.7;">
                ${
                  quiet
                    ? `This message is automated and replies are not monitored. Need help? Write to
                <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.red};text-decoration:underline;">${SUPPORT_EMAIL}</a>
                or <a href="${WHATSAPP_LINK}" style="color:${BRAND.red};text-decoration:underline;">WhatsApp ${WHATSAPP_NUMBER}</a>.`
                    : `Need help? Reply to this email, write to
                <a href="mailto:${SUPPORT_EMAIL}" style="color:${BRAND.red};text-decoration:underline;">${SUPPORT_EMAIL}</a>,
                or <a href="${WHATSAPP_LINK}" style="color:${BRAND.red};text-decoration:underline;">WhatsApp ${WHATSAPP_NUMBER}</a>.`
                }
              </p>
              <p style="margin:0;color:${BRAND.muted};font-size:11.5px;line-height:1.6;">
                Kitchenary Kart · Commercial kitchen equipment · GST invoice on every order<br />
                <a href="${STORE_URL}" style="color:${BRAND.muted};text-decoration:underline;">kitchenarykart.com</a>
              </p>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}

/** Plain-text part. Lines are joined as given; falsy entries drop out. */
export function textBody(lines: Array<string | false | null | undefined>): string {
  return lines.filter((l): l is string => typeof l === 'string').join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

/** Standard sign-off for the text part, so every email ends the same way. */
export function textFooter(): string {
  return `\n\nNeed help? Reply to this email, write to ${SUPPORT_EMAIL}, or WhatsApp ${WHATSAPP_NUMBER}.\nKitchenary Kart · ${STORE_URL}`;
}
