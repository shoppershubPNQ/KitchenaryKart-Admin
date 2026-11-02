/**
 * The website chatbot's five tools: the definitions sent to Claude (TOOLS) and
 * the server implementations (executeTool).
 *
 * TOOLS is a module-level constant in fixed order, byte-identical on every
 * request, never built per request (prompt-caching.md -> silent invalidators).
 * Every tool is `strict: true` with `additionalProperties: false` and every
 * property in `required`; optional values are `anyOf [string, null]`. There
 * are no minLength / maximum constraints in the schemas (unsupported with
 * strict tools - tool-use-concepts.md -> JSON Schema Limitations); the zod
 * checks in executeTool enforce them instead.
 *
 * Tool results are DATA only - they never contain instructions.
 *
 * Writes: the ONLY write any tool can cause outside the bot's own chat_*
 * tables is save_lead's one Inquiry per chat (with the customer's consent).
 * track_order and save_lead also bump attempt counters in chat_rate_limits.
 * Catalogue, orders and customers are read-only here.
 *
 * NOTE: this file must not import ./claude (claude.ts imports TOOLS from here;
 * a cycle would leave TOOLS uninitialised when PROMPT_VERSION is computed).
 */
import type Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { productDetails, searchCatalog } from './catalog';
import { lookupOrderForChat } from './orders';
import { buildHandoff, TEAM_EMAIL, TEAM_HOURS_LONG, TEAM_PHONE_DISPLAY, type Handoff } from './messages';
import { hitLimit, istDayKey, UNKNOWN_IP_BUCKET, withinSalesHours } from './limits';
import { LIMITS } from './models';
import { prisma } from '../db';
import { createInquiryWithNotification } from '../inquiry-create';
import { resolveOrderItems } from '../order-items';
import { adminBaseUrl } from '../admin-notify';

/** The store's own number (prompt + handoff) - never saved as a customer's. */
const TEAM_PHONE10 = '9890352455';
/** First line of every chatbot Inquiry message (also used to find duplicates). */
const LEAD_PREFIX = '[Website chatbot]';

const DEVANAGARI_DIGITS = '०१२३४५६७८९';
/** "₹४,५००" -> "₹4,500": Devanagari digits to ASCII (other text unchanged). */
export const toAsciiDigits = (s: string) => s.replace(/[०-९]/g, (d) => String(DEVANAGARI_DIGITS.indexOf(d)));

export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: 'search_products',
    description: "Search the live Kitchenary Kart catalogue (only products currently on sale). Call this before you mention any product, size, price or availability: when the customer names or describes a product, asks 'do you have', 'price of' or 'in stock', or wants a recommendation. Accepts English, Hindi (Devanagari) or Hinglish. Returns up to 5 products, each with product_ref, name, url, price_range, any_in_stock and up to 6 sizes; each size has its own exact GST-inclusive price_display and in_stock.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: "The product words as the customer wrote them, with size, capacity or power if given, e.g. 'masala grinder 2 kg', 'gas tandoor', 'बेन मैरी'. Not a whole sentence." },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'get_product_details',
    description: "Get one product's full live details: every size with its own exact GST-inclusive price_display, mrp_display and in_stock; specifications (capacity, power, dimensions, weight, material); GST rate; a short description; and the product link. Call this when the customer asks about sizes, specifications or details of a product returned by search_products, or types a product code (SKU).",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        sku: { type: 'string', description: 'A product_ref or size sku exactly as returned by search_products, or a product code the customer typed.' },
      },
      required: ['sku'],
      additionalProperties: false,
    },
  },
  {
    name: 'track_order',
    description: "Look up the status of the customer's own order. Call only when the customer has given BOTH the order number and the last 4 digits of the mobile number used on that order. Returns match: false when the details don't match (never say which part was wrong), or the status, dates, courier, tracking link, item names and order total.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        order_number: { type: 'string', description: 'Order number exactly as the customer typed it (it starts with KK, e.g. KK1A2B3C4D).' },
        phone_last4: { type: 'string', description: 'The last 4 digits of the mobile number on the order, as typed by the customer.' },
      },
      required: ['order_number', 'phone_last4'],
      additionalProperties: false,
    },
  },
  {
    name: 'save_lead',
    description: "Save the customer's requirement to the Kitchenary Kart team's Inquiries list so the team contacts them. Call ONLY after the customer has clearly said yes in this chat to sharing their details with the team, and only with details they typed. Never call it without that yes. One lead per chat.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        consent: { type: 'boolean', description: 'true only if the customer clearly agreed in this chat to be contacted by the team.' },
        name: { anyOf: [{ type: 'string' }, { type: 'null' }], description: "Customer's name as typed, or null if they didn't give one. Never guess." },
        phone: { type: 'string', description: "The customer's Indian mobile number as typed (10 digits, may include +91)." },
        email: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'Email if the customer gave one, else null.' },
        city: { anyOf: [{ type: 'string' }, { type: 'null' }], description: 'City or pincode if the customer gave one, else null.' },
        topic: { type: 'string', enum: ['product_enquiry', 'bulk_or_b2b_quote', 'discount_request', 'delivery_question', 'installation_or_warranty', 'out_of_stock_interest', 'callback_request', 'other'] },
        requirement: { type: 'string', description: 'One to three plain English sentences for the team: what the customer needs, quantities, product names and sizes discussed, and anything they asked for that you could not answer.' },
        products: {
          type: 'array',
          description: 'Products the customer wants, using only skus returned by the tools in this chat. Empty array if none.',
          items: {
            type: 'object',
            properties: {
              sku: { type: 'string' },
              quantity: { type: 'integer', description: 'Units wanted; 1 if not stated.' },
            },
            required: ['sku', 'quantity'],
            additionalProperties: false,
          },
        },
      },
      required: ['consent', 'name', 'phone', 'email', 'city', 'topic', 'requirement', 'products'],
      additionalProperties: false,
    },
  },
  {
    name: 'handoff_to_team',
    description: "Show the customer 'Chat on WhatsApp' and 'Call' buttons for the Kitchenary Kart sales team. Call when the customer wants a person, a call or WhatsApp; asks for a discount, special or bulk price, delivery date, installation, warranty or service; has a complaint, return, refund, cancellation or payment problem; or when you cannot help. Returns the team's WhatsApp number, phone, hours and whether the team is available now.",
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        reason: { type: 'string', enum: ['customer_asked', 'discount_or_bulk_price', 'delivery_date', 'installation_warranty_service', 'complaint_return_refund', 'payment_problem', 'order_problem', 'not_found_or_cannot_help', 'other'] },
        summary: { type: 'string', description: "One short sentence in the customer's language to pre-fill their WhatsApp message, e.g. 'I need a quote for 2 gas tandoors for my restaurant in Pune.' No phone numbers, addresses or other personal details." },
      },
      required: ['reason', 'summary'],
      additionalProperties: false,
    },
  },
];

// ---------------------------------------------------------------- runtime

export interface ToolCtx {
  sessionId: string;
  /** HMAC of the visitor network (per-IP lead and order-lookup limits), null when unknown. */
  ipHash: string | null;
  /** Everything the customer typed in this chat, this turn included - save_lead
   *  only accepts a phone number that appears here. */
  customerTexts: string[];
  /** Set -> save_lead refuses a second lead (one lead per chat). */
  leadInquiryId: number | null;
  /** Persisted at the end of the turn (also on failure). */
  orderLookups: number;
  /** Set by handoff_to_team -> returned to the widget as buttons. */
  handoff: Handoff | null;
  leadSavedThisTurn: boolean;
}

export interface ToolOutcome {
  /** JSON.stringify(result) - what Claude receives as the tool_result. */
  content: string;
  isError: boolean;
  /** One line for the admin chat log. */
  summary: string;
}

const TOPIC_LABELS: Record<string, string> = {
  product_enquiry: 'Product enquiry',
  bulk_or_b2b_quote: 'Bulk / B2B quote',
  discount_request: 'Discount / special price request',
  delivery_question: 'Delivery question',
  installation_or_warranty: 'Installation / warranty question',
  out_of_stock_interest: 'Out-of-stock interest',
  callback_request: 'Call-back request',
  other: 'Other',
};

const searchInput = z.object({ query: z.string().trim().min(1).max(120) });
const detailsInput = z.object({ sku: z.string().trim().min(1).max(80) });
const trackInput = z.object({
  order_number: z.string().trim().min(1).max(40),
  phone_last4: z.string().min(1).max(12),
});
const leadInput = z.object({
  consent: z.boolean(),
  name: z.string().trim().max(80).nullable(),
  phone: z.string().max(20),
  email: z.string().trim().max(120).nullable(),
  city: z.string().trim().max(80).nullable(),
  topic: z.enum([
    'product_enquiry',
    'bulk_or_b2b_quote',
    'discount_request',
    'delivery_question',
    'installation_or_warranty',
    'out_of_stock_interest',
    'callback_request',
    'other',
  ]),
  requirement: z.string().trim().min(1).max(1000),
  products: z.array(z.unknown()),
});
const leadProduct = z.object({
  sku: z.string().trim().min(1).max(80),
  quantity: z.number().int().min(1).max(10000),
});
const handoffInput = z.object({
  reason: z.enum([
    'customer_asked',
    'discount_or_bulk_price',
    'delivery_date',
    'installation_warranty_service',
    'complaint_return_refund',
    'payment_problem',
    'order_problem',
    'not_found_or_cannot_help',
    'other',
  ]),
  summary: z.string().max(300),
});

const result = (data: unknown, summary: string, isError = false): ToolOutcome => ({
  content: JSON.stringify(data),
  isError,
  summary: summary.slice(0, 300),
});

function invalidInput(name: string, err: z.ZodError): ToolOutcome {
  const detail = err.errors.map((x) => `${x.path.join('.') || 'input'}: ${x.message}`).join('; ').slice(0, 300);
  return result({ ok: false, error: 'invalid_input', detail }, `${name}: invalid input (${detail})`, true);
}

/** 10-digit Indian mobile, or null. "+91 98765 43210" and "09876543210" both
 *  become "9876543210". */
export function normalizeIndianMobile(phone: string): string | null {
  let d = phone.replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('91')) d = d.slice(2);
  else if (d.length === 11 && d.startsWith('0')) d = d.slice(1);
  return /^[6-9]\d{9}$/.test(d) ? d : null;
}

export interface PreparedLead {
  name: string | null;
  phone10: string;
  email: string | null;
  city: string | null;
  topic: string;
  requirement: string;
  products: Array<{ sku: string; quantity: number }>;
}

/** Lower-case, digits to ASCII, for "did the customer type this" checks. */
const typedText = (texts: string[]) => toAsciiDigits(texts.join('\n')).toLowerCase();

/** True when every word (2+ characters) of `value` appears in what the customer typed. */
function customerTyped(value: string, typed: string): boolean {
  const words = value.toLowerCase().split(/\s+/).filter((w) => w.length >= 2);
  return words.length > 0 && words.every((w) => typed.includes(w));
}

/**
 * Pure checks for save_lead, in the spec's order (no database): consent,
 * one-lead-per-chat, phone (valid AND typed by the customer, never the
 * store's own number), email, product items. A name or email the customer
 * did not type is dropped. Returns either the final tool result (`done`) or
 * the cleaned lead.
 */
export function prepareLead(
  input: unknown,
  ctx: Pick<ToolCtx, 'leadInquiryId' | 'customerTexts'>,
): { done: ToolOutcome } | { lead: PreparedLead } {
  const parsed = leadInput.safeParse(input);
  if (!parsed.success) return { done: invalidInput('save_lead', parsed.error) };
  const v = parsed.data;

  if (v.consent !== true) {
    return {
      done: result(
        { ok: false, error: 'consent_required', detail: 'Ask the customer if they agree to share their details with the team.' },
        'save_lead: consent_required',
        true,
      ),
    };
  }
  if (ctx.leadInquiryId) {
    return {
      done: result(
        {
          ok: true,
          saved: false,
          already_saved: true,
          detail: `This chat already sent a requirement to the team. For more details the customer can WhatsApp ${TEAM_PHONE_DISPLAY}.`,
        },
        'save_lead: already saved in this chat (no write)',
      ),
    };
  }
  const phone10 = normalizeIndianMobile(toAsciiDigits(v.phone));
  if (!phone10) {
    return {
      done: result({ ok: false, error: 'invalid_phone', detail: 'Ask for a 10-digit Indian mobile number.' }, 'save_lead: invalid_phone', true),
    };
  }
  const typed = typedText(ctx.customerTexts);
  const typedDigits = typed.replace(/\D/g, '');
  if (phone10 === TEAM_PHONE10 || !typedDigits.includes(phone10)) {
    return {
      done: result(
        { ok: false, error: 'phone_not_from_customer', detail: 'Ask the customer to type their own 10-digit mobile number.' },
        'save_lead: phone not typed by the customer',
        true,
      ),
    };
  }
  const name = v.name && customerTyped(v.name, typed) ? v.name : null;
  const email =
    v.email && z.string().email().safeParse(v.email).success && typed.includes(v.email.toLowerCase()) ? v.email : null;
  const products: Array<{ sku: string; quantity: number }> = [];
  for (const item of v.products.slice(0, 10)) {
    const p = leadProduct.safeParse(item);
    if (p.success) products.push(p.data);
  }
  return {
    lead: {
      name,
      phone10,
      email,
      city: v.city || null,
      topic: v.topic,
      requirement: v.requirement,
      products,
    },
  };
}

async function saveLead(input: unknown, ctx: ToolCtx): Promise<ToolOutcome> {
  const prep = prepareLead(input, ctx);
  if ('done' in prep) return prep.done;
  const lead = prep.lead;

  // Each lead writes an Inquiry and sends a team email through the same
  // Resend account as order emails, and a new chat costs nothing - so cap
  // leads per visitor network and per day, whatever the chat.
  const perIp = await hitLimit(`lead:ip:${ctx.ipHash ?? UNKNOWN_IP_BUCKET}`, 86_400, LIMITS.maxLeadsPerIpPerDay);
  const perDay = await hitLimit(`lead:day:${istDayKey()}`, 172_800, LIMITS.maxLeadsPerDay);
  if (!perIp.ok || !perDay.ok) {
    return result(
      { ok: false, error: 'lead_limit', detail: `Could not pass this on right now - offer WhatsApp ${TEAM_PHONE_DISPLAY} instead.` },
      `save_lead: ${perIp.ok ? 'daily' : 'per-visitor'} lead limit reached (no write)`,
      true,
    );
  }

  // Same mobile number already sent by the chatbot in the last 24 h (e.g. a
  // turn whose save could not be recorded): no second Inquiry or email.
  const dup = await prisma.inquiry.findFirst({
    where: {
      customerPhone: { endsWith: lead.phone10 },
      message: { startsWith: LEAD_PREFIX },
      createdAt: { gte: new Date(Date.now() - 86_400_000) },
    },
    orderBy: { id: 'desc' },
    select: { id: true },
  });
  if (dup) {
    ctx.leadInquiryId = dup.id;
    return result(
      {
        ok: true,
        saved: false,
        already_with_team: true,
        detail: `The team already has a request from this mobile number today and will contact the customer during working hours. For anything extra the customer can WhatsApp ${TEAM_PHONE_DISPLAY}.`,
        team_hours: TEAM_HOURS_LONG,
      },
      `save_lead: duplicate of Inquiry #${dup.id} (no write)`,
    );
  }

  const resolved = await resolveOrderItems(
    lead.products.map((p) => p.sku),
    { activeOnly: true, qualifyVariantNames: true },
  );
  const known = lead.products.filter((p) => resolved.has(p.sku));
  const unknown = lead.products.filter((p) => !resolved.has(p.sku)).map((p) => p.sku);

  const lines = [`${LEAD_PREFIX} ${TOPIC_LABELS[lead.topic] ?? 'Other'}`, lead.requirement];
  if (lead.city) lines.push(`City: ${lead.city}`);
  if (known.length) {
    lines.push(`Products: ${known.map((p) => `${resolved.get(p.sku)!.name} (${p.sku}) × ${p.quantity}`).join('; ')}`);
  }
  if (unknown.length) lines.push(`Unlisted products mentioned: ${unknown.join(', ')}`);
  lines.push(`Chat transcript: ${adminBaseUrl()}/dashboard/chatbot/logs?session=${ctx.sessionId}`);
  const message = lines.join('\n').slice(0, 2000);

  const { inquiryId } = await createInquiryWithNotification(
    {
      customerName: lead.name ?? '',
      customerEmail: lead.email ?? '',
      customerPhone: lead.phone10,
      companyName: '',
      message,
      items: known,
    },
    { subject: (who, p10) => `New chatbot lead from ${who}${p10 ? ` (${p10})` : ''}` },
  );
  ctx.leadInquiryId = inquiryId;
  ctx.leadSavedThisTurn = true;
  return result({ ok: true, saved: true, team_hours: TEAM_HOURS_LONG }, `save_lead: saved as Inquiry #${inquiryId}`);
}

/** The tool input as the admin log shows it - the phone digits of an order
 *  lookup are masked. */
export function redactForLog(name: string, input: unknown): unknown {
  if (name === 'track_order' && input && typeof input === 'object') {
    return { ...(input as Record<string, unknown>), phone_last4: '••••' };
  }
  return input;
}

const shortErr = (e: unknown) =>
  (e instanceof Error ? `${e.name}: ${e.message}` : String(e)).replace(/sk-ant-[A-Za-z0-9_-]+/g, 'sk-ant-…').slice(0, 300);

/**
 * Validate with zod, run the implementation, and return the tool_result
 * content. Unknown tool -> unknown_tool; any thrown error (database, timeout)
 * -> temporary_failure. Never throws.
 */
export async function executeTool(name: string, input: unknown, ctx: ToolCtx): Promise<ToolOutcome> {
  try {
    switch (name) {
      case 'search_products': {
        const p = searchInput.safeParse(input);
        if (!p.success) return invalidInput(name, p.error);
        const r = await searchCatalog(p.data.query);
        const names = r.results.map((x) => x.name);
        return result(r, `search "${p.data.query}": ${names.length} products${names.length ? ` - ${names.join(', ')}` : ''}`);
      }
      case 'get_product_details': {
        const p = detailsInput.safeParse(input);
        if (!p.success) return invalidInput(name, p.error);
        const r = await productDetails(p.data.sku);
        return result(r, r.found ? `details ${p.data.sku}: ${r.name} (${r.sizes.length} sizes)` : `details ${p.data.sku}: not found`);
      }
      case 'track_order': {
        const p = trackInput.safeParse(input);
        if (!p.success) return invalidInput(name, p.error);
        const r = await lookupOrderForChat(p.data.order_number, p.data.phone_last4, ctx);
        if (!r.ok) {
          const { isError: _flag, ...rest } = r;
          return result(rest, `track_order: ${r.error}`, true);
        }
        return result(r, r.match ? `track_order: match - ${r.status}` : 'track_order: no match');
      }
      case 'save_lead':
        return await saveLead(input, ctx);
      case 'handoff_to_team': {
        const p = handoffInput.safeParse(input);
        if (!p.success) return invalidInput(name, p.error);
        ctx.handoff = buildHandoff(p.data.summary);
        return result(
          {
            ok: true,
            buttons_shown: true,
            whatsapp: TEAM_PHONE_DISPLAY,
            phone: TEAM_PHONE_DISPLAY,
            email: TEAM_EMAIL,
            hours: TEAM_HOURS_LONG,
            team_available_now: withinSalesHours(),
          },
          `handoff buttons shown (${p.data.reason})`,
        );
      }
      default:
        return { content: '{"ok":false,"error":"unknown_tool"}', isError: true, summary: `unknown tool ${String(name).slice(0, 60)}` };
    }
  } catch (e) {
    console.error('[chatbot] tool failed:', name, shortErr(e));
    return { content: '{"ok":false,"error":"temporary_failure"}', isError: true, summary: `${name}: temporary_failure` };
  }
}
