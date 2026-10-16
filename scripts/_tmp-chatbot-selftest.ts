/**
 * Website chatbot self-test - READ-ONLY against the live database.
 *
 *   npx tsx scripts/_tmp-chatbot-selftest.ts
 *
 * Never calls save_lead's writer, persistTurn, hitLimit or any create/update,
 * never calls the Claude API (the tool loop runs against a fake Claude), and
 * prints no customer PII (the order check prints only match + status).
 * Prints PASS / FAIL per check and exits non-zero on any FAIL.
 */
import Anthropic from '@anthropic-ai/sdk';

// The local .env points the storefront at localhost; test against the live
// storefront search (a GET) unless told otherwise. Must be set before the
// catalog module is loaded, hence the dynamic imports below.
process.env.PUBLIC_SITE_URL = process.env.CHATBOT_TEST_SITE_URL || 'https://kitchenarykart.com';

let failures = 0;
let passes = 0;
function check(name: string, ok: boolean, detail = '') {
  if (ok) passes++;
  else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  - ${detail}` : ''}`);
}
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

(async () => {
  const { prisma } = await import('../lib/db');
  const catalog = await import('../lib/chatbot/catalog');
  const { maskAnthropicKey } = await import('../lib/chatbot/config');
  const claude = await import('../lib/chatbot/claude');
  const { normalizeIndianMobile, prepareLead, TOOLS } = await import('../lib/chatbot/tools');
  const { orderCandidates, lookupOrderForChat } = await import('../lib/chatbot/orders');
  const { istDayKey, istDayStartUtc, withinSalesHours } = await import('../lib/chatbot/limits');
  const { costUsd } = await import('../lib/chatbot/pricing');
  const { amountsIn, mentionsDiscountAmount, percentsIn, runChatTurn, wordAmountsIn } = await import('../lib/chatbot/turn');
  const { MSG_EN } = await import('../lib/chatbot/messages');
  const { SYSTEM_PROMPT } = await import('../lib/chatbot/prompt');
  const { resolveOrderItems } = await import('../lib/order-items');

  try {
    console.log('\n== Pure functions');
    const fi = catalog.formatInr;
    check('formatInr 1457.3', fi(1457.3) === '₹1,457.30', fi(1457.3));
    check('formatInr 2500', fi(2500) === '₹2,500', fi(2500));
    check('formatInr 125000', fi(125000) === '₹1,25,000', fi(125000));
    check('formatInr 99.5', fi(99.5) === '₹99.50', fi(99.5));
    check('formatInr 10000000', fi(10000000) === '₹1,00,00,000', fi(10000000));

    const masked = maskAnthropicKey('sk-ant-api03-' + 'x'.repeat(40) + 'ab12');
    check('maskAnthropicKey', masked === 'sk-ant-…ab12', masked);
    const scrubbed = claude.scrubSecrets('bad key sk-ant-api03-ABCdef_123-xyz in message');
    check('scrubSecrets removes sk-ant-…', !/sk-ant-[A-Za-z0-9]/.test(scrubbed), scrubbed);

    check('phone +91 98765 43210', normalizeIndianMobile('+91 98765 43210') === '9876543210');
    check('phone 09876543210', normalizeIndianMobile('09876543210') === '9876543210');
    check('phone 12345 invalid', normalizeIndianMobile('12345') === null);

    const c1 = orderCandidates('kk1a2b3c4d') ?? [];
    check('order candidates kk1a2b3c4d', c1.includes('KK1A2B3C4D') && c1.includes('KK-1A2B3C4D'), c1.join(','));
    const c2 = orderCandidates('KK-ABC') ?? [];
    check('order candidates KK-ABC', c2.includes('KK-ABC') && c2.includes('KKABC'), c2.join(','));
    check('order candidates rejects junk', orderCandidates('a') === null && orderCandidates('<script>') === null);

    const t1829 = new Date('2026-10-16T18:29:00Z');
    const t1831 = new Date('2026-10-16T18:31:00Z');
    check('istDayKey 18:29Z', istDayKey(t1829) === '2026-10-16', istDayKey(t1829));
    check('istDayKey 18:31Z', istDayKey(t1831) === '2026-10-17', istDayKey(t1831));
    check('istDayStartUtc 18:29Z', istDayStartUtc(t1829).toISOString() === '2026-10-15T18:30:00.000Z', istDayStartUtc(t1829).toISOString());
    check('istDayStartUtc 18:31Z', istDayStartUtc(t1831).toISOString() === '2026-10-16T18:30:00.000Z', istDayStartUtc(t1831).toISOString());

    // 2026-10-18 is a Sunday, 2026-10-19 a Monday (IST).
    check('sales hours Sunday 12:00 IST', withinSalesHours(new Date('2026-10-18T06:30:00Z')) === false);
    check('sales hours Monday 09:59 IST', withinSalesHours(new Date('2026-10-19T04:29:00Z')) === false);
    check('sales hours Monday 10:00 IST', withinSalesHours(new Date('2026-10-19T04:30:00Z')) === true);
    check('sales hours Monday 19:00 IST', withinSalesHours(new Date('2026-10-19T13:30:00Z')) === false);

    const u = { input: 1000, output: 500, cacheRead: 2000, cacheWrite: 3000 };
    check('costUsd haiku', near(costUsd('claude-haiku-5-5', 'claude-haiku-5-5', u), 0.000745), String(costUsd('claude-haiku-5-5', 'claude-haiku-5-5', u)));
    check('costUsd sonnet 5.5', near(costUsd('claude-sonnet-5-5', 'claude-sonnet-5-5', u), 0.0149));
    check('costUsd opus 5.5', near(costUsd('claude-opus-5-5', 'claude-opus-5-5', u), 0.0294));
    check('costUsd opus 5 (fallback target, longest-prefix match)', near(costUsd('claude-opus-5', 'claude-opus-5-5', u), 0.03725));
    check(
      'costUsd haiku over 100K prompt card',
      near(costUsd('claude-haiku-5-5', 'claude-haiku-5-5', { input: 150000, output: 1000, cacheRead: 0, cacheWrite: 0 }), 0.0775),
    );
    check('costUsd opus 4.8 (Opus 5.5 fallback target)', near(costUsd('claude-opus-4-8', 'claude-opus-5-5', u), 0.03725));
    check('costUsd unknown model -> highest known rate', near(costUsd('claude-future-x', 'claude-sonnet-5-5', u), 0.0745));

    const amts = amountsIn('₹12,500 and Rs. 1,457.30 or 2500 rupees; 10 am; 18% GST').sort((a, b) => a - b);
    check('amountsIn', JSON.stringify(amts) === JSON.stringify([145730, 250000, 1250000]), JSON.stringify(amts));
    check('amountsIn Devanagari digits', JSON.stringify(amountsIn('कीमत ₹४,५०० है')) === JSON.stringify([450000]));
    check('amountsIn "sirf 4500 mein"', amountsIn('sirf 4500 mein de denge').includes(450000));
    check('percentsIn', JSON.stringify(percentsIn('10% off, 18 प्रतिशत GST')) === JSON.stringify([10, 18]));
    check('wordAmountsIn', JSON.stringify(wordAmountsIn('1.2 lakh or 45k, 2 kg, 5 kW')) === JSON.stringify(['1.2lakh', '45k']));
    check('discount near a number', mentionsDiscountAmount('Aapko 10% discount mil jayega') && mentionsDiscountAmount('₹500 off today'));
    check('no discount flag on a plain decline', !mentionsDiscountAmount('Discounts are confirmed by our team. The price is ₹12,500 incl. GST.'));
    check('no discount flag on "switch off after 30 min"', !mentionsDiscountAmount('Switch it off after 30 minutes of use.'));

    const blocks = [
      { type: 'thinking', thinking: '', signature: 's1' },
      { type: 'fallback', from: { model: 'a' }, to: { model: 'b' } },
      { type: 'thinking', thinking: '', signature: 's2' },
      { type: 'text', text: 'hi' },
    ] as unknown as Parameters<typeof claude.sanitizeAssistantContent>[0];
    const san = claude.sanitizeAssistantContent(blocks) as unknown as Array<{ type: string; signature?: string }>;
    check(
      'sanitizeAssistantContent drops pre-fallback thinking + marker',
      san.length === 2 && san[0].type === 'thinking' && san[0].signature === 's2' && san[1].type === 'text',
      JSON.stringify(san.map((b) => b.type)),
    );
    const txt = claude.extractReplyText([
      { type: 'thinking', thinking: 'secret', signature: 'x' },
      { type: 'text', text: 'Price **₹2,500** incl. GST' },
    ] as unknown as Parameters<typeof claude.extractReplyText>[0]);
    check('extractReplyText skips thinking, strips **', txt === 'Price ₹2,500 incl. GST', txt);

    console.log('\n== Tool schemas');
    const BANNED = ['minLength', 'maxLength', 'minimum', 'maximum', 'pattern'];
    function walk(schema: any, path: string, errs: string[]) {
      if (!schema || typeof schema !== 'object') return;
      for (const b of BANNED) if (b in schema) errs.push(`${path}: has ${b}`);
      if (schema.type === 'object') {
        if (schema.additionalProperties !== false) errs.push(`${path}: additionalProperties not false`);
        const props = Object.keys(schema.properties ?? {});
        const req: string[] = schema.required ?? [];
        for (const p of props) if (!req.includes(p)) errs.push(`${path}: ${p} not required`);
        for (const p of props) walk(schema.properties[p], `${path}.${p}`, errs);
      }
      if (schema.items) walk(schema.items, `${path}[]`, errs);
      for (const k of ['anyOf', 'oneOf', 'allOf']) if (Array.isArray(schema[k])) schema[k].forEach((s: any, i: number) => walk(s, `${path}.${k}${i}`, errs));
    }
    for (const t of TOOLS) {
      const errs: string[] = [];
      if (t.strict !== true) errs.push('strict !== true');
      walk(t.input_schema, t.name, errs);
      check(`tool ${t.name} schema`, errs.length === 0, errs.join('; '));
    }
    const approxTokens = Math.round((SYSTEM_PROMPT.length + JSON.stringify(TOOLS).length) / 4);
    console.log(`      PROMPT_VERSION ${claude.PROMPT_VERSION}; prompt + tools ≈ ${approxTokens} tokens`);
    check('prompt + tools above the cache minimum (rough count > 600)', approxTokens > 600);

    console.log('\n== Catalogue (read-only, live DB + storefront search GET)');
    const priceRe = /^₹[0-9,]+(\.[0-9]{2})?$/;
    function sizesOk(r: any): boolean {
      return r.results.every((p: any) => p.sizes.every((s: any) => (s.price_display && priceRe.test(s.price_display)) || s.price_on_request === true));
    }
    for (const q of ['masala grinder', 'बेन मैरी', 'chai wala bhagona', 'tandoor']) {
      const r = await catalog.searchCatalog(q);
      const json = JSON.stringify(r);
      check(`search "${q}" returns results`, r.results.length >= 1, `${r.results.length}: ${r.results.map((x: any) => x.name).slice(0, 3).join(' | ')}`);
      check(`search "${q}" price formats`, sizesOk(r));
      check(`search "${q}" no stock counts / costPrice`, !json.includes('"stock"') && !json.includes('costPrice'));
    }
    const none = await catalog.searchCatalog('zzqqxx');
    check('search "zzqqxx" returns nothing', none.results.length === 0, String(none.results.length));

    const failingFetch = (async () => {
      throw new Error('forced failure');
    }) as unknown as typeof fetch;
    const local = await catalog.searchCatalog('masala grinder', { fetchImpl: failingFetch });
    check('search local fallback (storefront fetch forced to fail)', local.results.length >= 1 && sizesOk(local), `${local.results.length}`);

    const bms2 = await catalog.productDetails('KKSP0006-BMS2');
    const bmsSize = bms2.found ? bms2.sizes.find((s: any) => s.sku === 'KKSP0006-BMS2') : undefined;
    check('details KKSP0006-BMS2 shows ₹1,457.30', bmsSize?.price_display === '₹1,457.30', String(bmsSize?.price_display));

    for (const sku of ['KKHE0167-PSSMSD', 'KKHE0276-2PW', 'KKHE0068-CMRS4.40']) {
      const exists =
        (await prisma.productVariant.count({ where: { skuSuffix: sku, product: { status: 'active' } } })) +
        (await prisma.product.count({ where: { sku, status: 'active' } }));
      if (!exists) {
        console.log(`      (${sku} is no longer an active sku - skipped)`);
        continue;
      }
      const d = await catalog.productDetails(sku);
      const size = d.found ? d.sizes.find((s: any) => s.sku === sku) : undefined;
      const charged = (await resolveOrderItems([sku], { activeOnly: true })).get(sku);
      const want = charged ? catalog.formatInr(charged.price) : null;
      check(`details ${sku} = checkout (variant) price`, !!size && !!want && size.price_display === want, `${size?.price_display} vs ${want}`);
    }

    for (const status of ['draft', 'discontinued'] as const) {
      const p = await prisma.product.findFirst({ where: { status }, select: { sku: true, name: true } });
      if (!p) {
        console.log(`      (no ${status} product to test)`);
        continue;
      }
      const d = await catalog.productDetails(p.sku);
      check(`${status} ${p.sku} not found by details`, d.found === false);
      const s = await catalog.searchCatalog(p.name.slice(0, 60));
      check(`${status} ${p.sku} never in search`, !s.results.some((r: any) => r.product_ref === p.sku || r.sizes.some((x: any) => x.sku === p.sku)));
    }

    const zeroParent = await prisma.product.findFirst({
      where: { status: 'active', stock: 0, variants: { some: { stock: { gt: 0 }, skuSuffix: { not: null } } } },
      select: { sku: true, name: true },
    });
    if (zeroParent) {
      const d = await catalog.productDetails(zeroParent.sku);
      check(`parent stock 0 with stocked size (${zeroParent.sku}) shows in stock`, d.found === true && d.sizes.some((s: any) => s.in_stock));
      const s = await catalog.searchCatalog(zeroParent.name.slice(0, 60));
      const hit = s.results.find((r: any) => r.product_ref === zeroParent.sku);
      if (hit) check(`search any_in_stock for ${zeroParent.sku}`, hit.any_in_stock === true);
    } else {
      console.log('      (no active parent with stock 0 and a stocked size)');
    }

    console.log('\n== Orders (read-only; prints only match + status)');
    const recent = await prisma.order.findMany({
      where: { customerPhone: { not: null } },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: { orderNumber: true, customerPhone: true },
    });
    const ord = recent.find((o) => (o.customerPhone ?? '').replace(/\D/g, '').length >= 4);
    if (ord) {
      const true4 = (ord.customerPhone ?? '').replace(/\D/g, '').slice(-4);
      const wrong4 = true4.split('').map((ch) => String((Number(ch) + 1) % 10)).join('');
      // A fake attempt counter: hitLimit writes chat_rate_limits, and this test never writes.
      const noLimit = { hitLimit: async () => ({ ok: true, count: 1, retryAfterSec: 1 }) };
      const ctx = { orderLookups: 0, ipHash: null };
      const bad = await lookupOrderForChat(ord.orderNumber, wrong4, ctx, noLimit);
      check('track_order wrong last-4 -> match false', bad.ok === true && 'match' in bad && bad.match === false);
      const good = await lookupOrderForChat(ord.orderNumber, true4, ctx, noLimit);
      const ok = good.ok === true && 'match' in good && good.match === true;
      const keys = Object.keys(good);
      const leaks = ['address', 'shipping_address', 'name', 'customer_name', 'phone', 'customer_phone', 'email', 'gstin'].filter((k) => keys.includes(k));
      check('track_order right last-4 -> match true', ok, ok ? `status: ${(good as any).status}` : '');
      check('track_order result has no address/name/phone/email', leaks.length === 0, leaks.join(','));
      check('track_order counts lookups', ctx.orderLookups === 2);
      const capped = await lookupOrderForChat(ord.orderNumber, true4, { orderLookups: 5, ipHash: null }, noLimit);
      check('track_order stops after 5 look-ups', capped.ok === false && capped.error === 'too_many_attempts');
      const limited = await lookupOrderForChat(ord.orderNumber, true4, { orderLookups: 0, ipHash: null }, {
        hitLimit: async () => ({ ok: false, count: 99, retryAfterSec: 60 }),
      });
      check('track_order per-order / per-IP limit -> too_many_attempts', limited.ok === false && limited.error === 'too_many_attempts');
    } else {
      console.log('      (no order with a phone to test)');
    }

    console.log('\n== save_lead validation only (no write)');
    const baseLead = { consent: true, name: 'Test', phone: '9876543210', email: null, city: null, topic: 'other', requirement: 'x', products: [] };
    const typed = { leadInquiryId: null, customerTexts: ['yes please, I am Test, my number is +91 98765 43210'] };
    const l1 = prepareLead({ ...baseLead, consent: false }, typed);
    check('consent false -> consent_required', 'done' in l1 && JSON.parse(l1.done.content).error === 'consent_required' && l1.done.isError);
    const l2 = prepareLead({ ...baseLead, phone: '12345' }, typed);
    check('phone 12345 -> invalid_phone', 'done' in l2 && JSON.parse(l2.done.content).error === 'invalid_phone');
    const l3 = prepareLead(baseLead, { ...typed, leadInquiryId: 99 });
    check('second lead in a chat -> already_saved (no write)', 'done' in l3 && JSON.parse(l3.done.content).already_saved === true);
    const l4 = prepareLead({ ...baseLead, email: 'not-an-email', products: [{ sku: 'A', quantity: 2 }, { sku: '', quantity: 1 }, { sku: 'B', quantity: 0 }] }, typed);
    check('bad email dropped, bad items dropped', 'lead' in l4 && l4.lead.email === null && l4.lead.products.length === 1);
    const l5 = prepareLead({ ...baseLead, phone: '9123456789' }, typed);
    check('phone the customer never typed -> phone_not_from_customer', 'done' in l5 && JSON.parse(l5.done.content).error === 'phone_not_from_customer');
    const l6 = prepareLead({ ...baseLead, phone: '+91 98903 52455' }, { leadInquiryId: null, customerTexts: ['call 98903 52455'] });
    check("store's own number -> phone_not_from_customer", 'done' in l6 && JSON.parse(l6.done.content).error === 'phone_not_from_customer');
    const l7 = prepareLead({ ...baseLead, name: 'Rahul' }, typed);
    check('name the customer never typed -> dropped', 'lead' in l7 && l7.lead.name === null);
    const l8 = prepareLead(baseLead, { leadInquiryId: null, customerTexts: ['मेरा नंबर ९८७६५४३२१० है, Test'] });
    check('Devanagari-typed phone accepted', 'lead' in l8 && l8.lead.phone10 === '9876543210');

    console.log('\n== Mock-Claude tool loop (no API, no DB)');
    type P = any;
    let idc = 0;
    const msg = (model: string, content: any[], stop_reason: string, extra: Record<string, unknown> = {}) =>
      ({
        id: `msg_${++idc}`,
        type: 'message',
        role: 'assistant',
        model,
        content,
        stop_reason,
        stop_sequence: null,
        stop_details: null,
        container: null,
        context_management: null,
        usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 50 },
        ...extra,
      }) as unknown as Anthropic.Beta.BetaMessage;
    const toolUse = (name: string, input: unknown) => ({ type: 'tool_use', id: `toolu_${++idc}`, name, input });
    const text = (t: string) => ({ type: 'text', text: t });
    const fakeTool = async () => ({ content: JSON.stringify({ ok: true, results: [{ price_display: '₹12,500' }] }), isError: false, summary: 'fake' });
    const newCtx = () => ({
      sessionId: '00000000-0000-4000-8000-000000000000',
      ipHash: null,
      customerTexts: ['price of masala grinder?'],
      leadInquiryId: null,
      orderLookups: 0,
      handoff: null,
      leadSavedThisTurn: false,
    });
    const userContent = [{ type: 'text' as const, text: 'price of masala grinder?' }];
    const baseInput = (model: any) => ({
      model,
      history: [] as any[],
      userContent,
      customerText: 'price of masala grinder?',
      ctx: newCtx(),
      deadline: Date.now() + 50_000,
      hindi: false,
      costCeilingUsd: 0,
    });
    const paramIssues = (p: P, model: string): string[] => {
      const issues: string[] = [];
      for (const k of ['temperature', 'top_p', 'top_k']) if (k in p) issues.push(`has ${k}`);
      const last = p.messages[p.messages.length - 1];
      if (last?.role !== 'user') issues.push('last message is not user');
      if (model === 'claude-haiku-5-5') {
        if ('fallbacks' in p) issues.push('haiku has fallbacks');
        if ((p.betas ?? []).some((b: string) => b.startsWith('server-side-fallback'))) issues.push('haiku has fallback beta');
      } else {
        if (p.fallbacks !== 'default') issues.push('fallbacks !== default');
        for (const b of ['thinking-binding-controls-2026-08-01', 'server-side-fallback-2026-07-01']) if (!(p.betas ?? []).includes(b)) issues.push(`missing beta ${b}`);
      }
      if (p.thinking?.type !== 'adaptive') issues.push('thinking not adaptive');
      const wantEffort = model === 'claude-haiku-5-5' ? 'medium' : 'low';
      if (p.output_config?.effort !== wantEffort) issues.push(`effort ${p.output_config?.effort} (want ${wantEffort})`);
      if (!['auto', 'none'].includes(p.tool_choice?.type)) issues.push(`tool_choice ${p.tool_choice?.type}`);
      return issues;
    };

    // 1 + 7: search then an allowed price, on all three models.
    for (const model of ['claude-haiku-5-5', 'claude-sonnet-5-5', 'claude-opus-5-5']) {
      const seen: P[] = [];
      const script = [msg(model, [toolUse('search_products', { query: 'masala grinder' })], 'tool_use'), msg(model, [text('It is ₹12,500 incl. GST.')], 'end_turn')];
      const out = await runChatTurn(baseInput(model), {
        callClaude: async (p) => {
          seen.push(JSON.parse(JSON.stringify(p)));
          return script.shift()!;
        },
        executeTool: fakeTool,
        now: Date.now,
      });
      check(`[${model}] search -> allowed price: ok, 4 rows`, out.status === 'ok' && out.rows.length === 4 && out.rows.map((r) => r.kind).join(',') === 'customer,tool_call,tool_result,reply', `${out.status} ${out.rows.map((r) => r.kind).join(',')}`);
      const issues = seen.flatMap((p) => paramIssues(p, model));
      check(`[${model}] request params`, issues.length === 0, [...new Set(issues)].join('; '));
      check(`[${model}] cost recorded`, (out.rows[1].costUsd ?? 0) > 0);
    }

    // 2: five consecutive tool_use responses -> the 5th call is text-only.
    {
      const seen: P[] = [];
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async (p) => {
          seen.push(p);
          if (seen.length <= 4) return msg('claude-haiku-5-5', [toolUse('search_products', { query: 'x' + seen.length })], 'tool_use');
          return msg('claude-haiku-5-5', [text('Here are the options.')], 'end_turn');
        },
        executeTool: fakeTool,
        now: Date.now,
      });
      check('tool budget: 5th call has tool_choice none', seen.length === 5 && seen[4].tool_choice?.type === 'none' && seen[3].tool_choice?.type === 'auto');
      check('tool budget: turn ends ok', out.status === 'ok');
    }

    // 3: refusal.
    {
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async () => msg('claude-haiku-5-5', [], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }),
        executeTool: fakeTool,
        now: Date.now,
      });
      check('refusal: status refused, all rows replay=false, refused text', out.status === 'refused' && out.rows.every((r) => !r.replay) && out.reply === MSG_EN.refused && out.rows.at(-1)?.stopReason === 'refusal:cyber');
    }

    // 4: max_tokens with only thinking -> one retry at 8192, first response not appended.
    {
      const seen: P[] = [];
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async (p) => {
          seen.push(JSON.parse(JSON.stringify(p)));
          return seen.length === 1
            ? msg('claude-haiku-5-5', [{ type: 'thinking', thinking: '', signature: 'sig' }], 'max_tokens')
            : msg('claude-haiku-5-5', [text('Done.')], 'end_turn');
        },
        executeTool: fakeTool,
        now: Date.now,
      });
      check(
        'max_tokens retry: 8192 and not appended',
        seen.length === 2 && seen[0].max_tokens === 4096 && seen[1].max_tokens === 8192 && seen[1].messages.length === seen[0].messages.length && out.status === 'ok',
      );
      check('max_tokens retry: discarded usage still counted', (out.rows.at(-1)?.inputTokens ?? 0) === 200);
    }

    // 5: an invented price -> guard, rewrite; repeated -> price fallback.
    {
      const seen: P[] = [];
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async (p) => {
          seen.push(p);
          return msg('claude-haiku-5-5', [text('Special price ₹99,999 for you.')], 'end_turn');
        },
        executeTool: fakeTool,
        now: Date.now,
      });
      const kinds = out.rows.map((r) => r.kind).join(',');
      check('price guard: second call after a guard note', seen.length === 2 && kinds.includes('guard'), kinds);
      check('price guard repeated -> price_fallback, turn forgotten', out.status === 'price_fallback' && out.reply === MSG_EN.priceFallback && out.rows.every((r) => !r.replay));
    }
    {
      let n = 0;
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async () =>
          ++n === 1 ? msg('claude-haiku-5-5', [text('It costs ₹99,999.')], 'end_turn') : msg('claude-haiku-5-5', [text('Please check the product page for the price.')], 'end_turn'),
        executeTool: fakeTool,
        now: Date.now,
      });
      check('price guard: fixed on rewrite -> ok, guard rows kept in history', out.status === 'ok' && out.rows.filter((r) => r.kind === 'guard' && r.replay).length === 1);
    }

    // Customer-typed amount echoed back is NOT allowed any more.
    {
      let n = 0;
      const out = await runChatTurn(
        { ...baseInput('claude-haiku-5-5'), customerText: 'Can you do ₹9,000?', userContent: [{ type: 'text' as const, text: 'Can you do ₹9,000?' }] },
        {
          callClaude: async () => msg('claude-haiku-5-5', [text(++n === 1 ? 'OK, ₹9,000 is fine.' : 'Our team confirms any special price personally.')], 'end_turn'),
          executeTool: fakeTool,
          now: Date.now,
        },
      );
      check('price guard: customer amount echoed -> rewrite', n === 2 && out.status === 'ok');
    }
    // A discount promise -> rewrite, then the discount fallback.
    {
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async () => msg('claude-haiku-5-5', [text('Aapko 10% discount mil jayega.')], 'end_turn'),
        executeTool: fakeTool,
        now: Date.now,
      });
      check('discount guard repeated -> discount fallback', out.status === 'price_fallback' && out.reply === MSG_EN.discountFallback);
    }
    // tool_use under a non-tool_use stop is never executed.
    {
      let ran = 0;
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async () => msg('claude-haiku-5-5', [toolUse('save_lead', {})], 'model_context_window_exceeded'),
        executeTool: async () => {
          ran++;
          return fakeTool();
        },
        now: Date.now,
      });
      check('tool_use with a non-tool_use stop -> error, tool not run', out.status === 'error' && ran === 0);
    }
    // A reply cut off twice at max_tokens fails instead of showing half a sentence.
    {
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async () => msg('claude-haiku-5-5', [text('The price of the 2 kg model is')], 'max_tokens'),
        executeTool: fakeTool,
        now: Date.now,
      });
      check('max_tokens twice with text -> error, usage of both calls kept', out.status === 'error' && (out.rows.at(-1)?.inputTokens ?? 0) === 200);
    }
    // A 400 on a replayed history -> one retry without thinking blocks.
    {
      const seen: P[] = [];
      const history = [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'thinking', thinking: '', signature: 'bad' }, { type: 'text', text: 'Hello!' }] },
      ] as unknown as Anthropic.Beta.BetaMessageParam[];
      const out = await runChatTurn({ ...baseInput('claude-haiku-5-5'), history }, {
        callClaude: async (p) => {
          seen.push(JSON.parse(JSON.stringify(p)));
          if (seen.length === 1) {
            throw new Anthropic.BadRequestError(400, { type: 'error', error: { type: 'invalid_request_error', message: 'bad block' } }, 'bad block', new Headers());
          }
          return msg('claude-haiku-5-5', [text('Hello again.')], 'end_turn');
        },
        executeTool: fakeTool,
        now: Date.now,
      });
      const retriedWithout = seen.length === 2 && !JSON.stringify(seen[1].messages).includes('"thinking"');
      check('400 on history -> retried once without thinking, ok', out.status === 'ok' && retriedWithout);
    }
    // input_transformations are counted (drop_block is on).
    {
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async () =>
          msg('claude-haiku-5-5', [text('Hello.')], 'end_turn', {
            input_transformations: [{ type: 'thinking_dropped', path: 'messages.1.content.0', reason: 'prefix_binding_mismatch' }],
          }),
        executeTool: fakeTool,
        now: Date.now,
      });
      check('input_transformations -> bindingDrops + note', out.bindingDrops === 1 && !!out.bindingNote && out.rows.at(-1)?.stopReason === 'end_turn+drop');
    }
    // A lead saved, then a refusal -> the customer is told the details arrived.
    {
      let n = 0;
      const ctx = newCtx();
      const out = await runChatTurn({ ...baseInput('claude-haiku-5-5'), ctx }, {
        callClaude: async () =>
          ++n === 1
            ? msg('claude-haiku-5-5', [toolUse('save_lead', {})], 'tool_use')
            : msg('claude-haiku-5-5', [], 'refusal', { stop_details: { type: 'refusal', category: 'cyber', explanation: null } }),
        executeTool: async (_name, _input, c) => {
          c.leadSavedThisTurn = true;
          return fakeTool();
        },
        now: Date.now,
      });
      check('refusal after a saved lead -> errorAfterLead + leadSaved', out.status === 'refused' && out.reply === MSG_EN.errorAfterLead && out.leadSaved);
    }

    // 6: authentication error -> unavailable + key invalid.
    {
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async () => {
          throw new Anthropic.AuthenticationError(401, { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }, 'invalid x-api-key', new Headers());
        },
        executeTool: fakeTool,
        now: Date.now,
      });
      check('auth error -> code unavailable, keyStatus invalid', out.status === 'error' && out.code === 'unavailable' && out.keyStatus === 'invalid' && out.rows.every((r) => !r.replay));
    }
    {
      const out = await runChatTurn(baseInput('claude-haiku-5-5'), {
        callClaude: async () => {
          throw new Anthropic.RateLimitError(429, { type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, 'slow down', new Headers());
        },
        executeTool: fakeTool,
        now: Date.now,
      });
      check('429 -> upstream_busy', out.status === 'error' && out.code === 'upstream_busy');
    }
    {
      const out = await runChatTurn({ ...baseInput('claude-haiku-5-5'), deadline: Date.now() + 1000 }, {
        callClaude: async () => msg('claude-haiku-5-5', [text('x')], 'end_turn'),
        executeTool: fakeTool,
        now: Date.now,
      });
      check('deadline -> error', out.status === 'error' && out.code === 'error');
    }

    // Classification of key-test errors (no network).
    const k401 = claude.classifyKeyError(new Anthropic.AuthenticationError(401, undefined, 'x', new Headers()), 'claude-haiku-5-5');
    check('classifyKeyError 401 -> invalid', k401.status === 'invalid');
    const k402 = claude.classifyKeyError(new Anthropic.APIError(402, undefined, 'billing', new Headers()), 'claude-haiku-5-5');
    check('classifyKeyError 402 -> billing', k402.status === 'billing');
    const kconn = claude.classifyKeyError(new Anthropic.APIConnectionError({ message: 'down' }), 'claude-haiku-5-5');
    check('classifyKeyError connection -> error', kconn.status === 'error' && kconn.detail.includes('api.anthropic.com'));
  } catch (e) {
    failures++;
    console.log('FAIL  self-test crashed:', e instanceof Error ? `${e.name}: ${e.message}` : String(e));
  } finally {
    await prisma.$disconnect();
  }

  console.log(`\n${passes} passed, ${failures} failed`);
  process.exitCode = failures ? 1 : 0;
})();
