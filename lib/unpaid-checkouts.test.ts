/**
 * Rules for the unpaid-checkouts call list and its Excel file.
 *   npx tsx --test lib/unpaid-checkouts.test.ts      (or: npm test)
 * No database: lib/unpaid-checkouts.ts is pure.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as ExcelJS from 'exceljs';
import {
  type CheckoutOrder,
  type PaidOrder,
  ageText,
  buildUnpaidCheckoutsWorkbook,
  buyerWhatsAppUrl,
  placeFromAddress,
  selectUnpaidCheckouts,
  unpaidCheckoutsFilename,
} from './unpaid-checkouts';

const NOW = new Date('2026-11-04T12:00:00Z'); // 17:30 IST
const minsAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

let seq = 0;
function order(over: Partial<CheckoutOrder> = {}): CheckoutOrder {
  seq++;
  return {
    id: seq,
    orderNumber: `KKORD${String(seq).padStart(4, '0')}`,
    customerName: 'Ravi Kumar',
    // A different buyer per order unless a test says otherwise.
    customerPhone: `+91 91${String(seq).padStart(8, '0')}`,
    customerEmail: `buyer${seq}@example.com`,
    shippingAddress: 'Ravi Kumar · +91 98765 43210\nShop 4, MG Road, Pune, Maharashtra, 411001',
    totalAmount: 4130,
    orderStatus: 'pending',
    paymentStatus: 'pending',
    razorpayOrderId: 'order_abc',
    replacementOfId: null,
    contactedAt: null,
    createdAt: minsAgo(90),
    items: [{ productName: 'Chafing Dish', productSku: 'KK1', quantity: 2 }],
    ...over,
  };
}
const select = (orders: CheckoutOrder[], paid: PaidOrder[] = []) => selectUnpaidCheckouts(orders, paid, { now: NOW });

test('only unpaid website checkouts are listed', () => {
  const r = select([
    order({ razorpayOrderId: null, customerPhone: '9000000001' }), // admin draft / payment link
    order({ paymentStatus: 'completed', customerPhone: '9000000002' }),
    order({ paymentStatus: 'refunded', customerPhone: '9000000003' }),
    order({ orderStatus: 'processing', customerPhone: '9000000004' }),
    order({ replacementOfId: 7, customerPhone: '9000000005' }), // free replacement
    order({ customerPhone: '9000000006', orderNumber: 'KEEP-PENDING' }),
    order({ customerPhone: '9000000007', paymentStatus: 'failed', orderNumber: 'KEEP-FAILED' }),
    order({ customerPhone: '9000000008', orderStatus: 'cancelled', orderNumber: 'KEEP-CANCELLED' }),
  ]);
  assert.deepEqual(r.rows.map((x) => x.orderNumber).sort(), ['KEEP-CANCELLED', 'KEEP-FAILED', 'KEEP-PENDING']);
  const status = Object.fromEntries(r.rows.map((x) => [x.orderNumber, x.status]));
  assert.equal(status['KEEP-PENDING'], 'Not paid yet');
  assert.equal(status['KEEP-FAILED'], 'Payment failed');
  assert.equal(status['KEEP-CANCELLED'], 'Cancelled, not paid');
});

test('a checkout under 30 minutes old is left out (may still be paying)', () => {
  const r = select([order({ createdAt: minsAgo(29) }), order({ createdAt: minsAgo(31), customerPhone: '9111111111', customerEmail: null })]);
  assert.equal(r.rows.length, 1);
  assert.equal(r.skipped.tooRecent, 1);
  assert.equal(r.rows[0].minutesSince, 31);
});

test('staff test checkouts are left out — same rule as the funnel metrics', () => {
  const r = select([
    order({ customerEmail: 'priya@hotelicessentials.com', customerPhone: '9000000010' }),
    order({ customerName: 'Test order', customerPhone: '9000000011', customerEmail: null }),
    order({ customerName: 'Ravi', customerEmail: 'test@gmail.com', customerPhone: '9000000012' }),
    // "Testa" is a real surname, not the word "test"
    order({ customerName: 'Maria Testa', customerEmail: 'maria@example.com', customerPhone: '9000000013', orderNumber: 'REAL' }),
  ]);
  assert.equal(r.skipped.staffTest, 3);
  assert.deepEqual(r.rows.map((x) => x.orderNumber), ['REAL']);
});

test('a buyer who paid a LATER order is left out; one who paid EARLIER stays', () => {
  const cart = order({ customerPhone: '098765 43210', customerEmail: 'ravi@example.com', createdAt: minsAgo(300) });
  // Paid later, phone stored in another format → same buyer.
  const r1 = select([cart], [{ customerPhone: '+919876543210', customerEmail: null, createdAt: minsAgo(200) }]);
  assert.equal(r1.rows.length, 0);
  assert.equal(r1.skipped.boughtLater, 1);
  // Same buyer by email, different case.
  const r2 = select([cart], [{ customerPhone: null, customerEmail: 'RAVI@Example.com', createdAt: minsAgo(100) }]);
  assert.equal(r2.rows.length, 0);
  // Paid BEFORE this cart: a returning customer's new cart is a fresh lead.
  const r3 = select([cart], [{ customerPhone: '9876543210', customerEmail: null, createdAt: minsAgo(400) }]);
  assert.equal(r3.rows.length, 1);
  // Someone else paid — no effect.
  const r4 = select([cart], [{ customerPhone: '9123456789', customerEmail: 'other@example.com', createdAt: minsAgo(100) }]);
  assert.equal(r4.rows.length, 1);
});

test('the bought-later rule is per attempt: an old cart drops, a newer one stays', () => {
  const monday = order({ customerPhone: '9876543210', createdAt: minsAgo(3 * 1440), orderNumber: 'MON' });
  const wednesday = order({ customerPhone: '9876543210', createdAt: minsAgo(60), orderNumber: 'WED', items: [{ productName: 'Bain Marie', productSku: 'KK2', quantity: 1 }] });
  const r = select([monday, wednesday], [{ customerPhone: '9876543210', customerEmail: null, createdAt: minsAgo(2 * 1440) }]);
  assert.deepEqual(r.rows.map((x) => x.orderNumber), ['WED']);
  assert.equal(r.rows[0].attempts, 1);
  assert.equal(r.skipped.boughtLater, 1);
});

test('repeat attempts by one buyer become one row showing the latest cart', () => {
  const a = order({ orderNumber: 'A1', createdAt: minsAgo(200), totalAmount: 1000, customerPhone: '9876543210', customerEmail: 'ravi@example.com' });
  const b = order({ orderNumber: 'A2', createdAt: minsAgo(150), totalAmount: 1500, customerPhone: '+91-98765-43210', contactedAt: minsAgo(120) });
  const c = order({ orderNumber: 'A3', createdAt: minsAgo(100), totalAmount: 2000, customerPhone: null, customerEmail: 'Ravi@example.com', customerName: '' });
  const other = order({ orderNumber: 'B1', createdAt: minsAgo(50), customerPhone: '9000000099', customerEmail: 'b@example.com', customerName: 'Sita' });
  const r = select([c, other, a, b]);
  assert.equal(r.rows.length, 2);
  // Newest first.
  assert.deepEqual(r.rows.map((x) => x.orderNumber), ['B1', 'A3']);
  const ravi = r.rows[1];
  assert.equal(ravi.attempts, 3);
  assert.deepEqual(ravi.earlierOrderNumbers, ['A1', 'A2']);
  assert.equal(ravi.amount, 2000);
  // The latest attempt had no name / phone: taken from an earlier attempt.
  assert.equal(ravi.name, 'Ravi Kumar');
  assert.equal(ravi.phone10, '9876543210');
  assert.equal(ravi.contactedAt?.getTime(), minsAgo(120).getTime());
});

test('orders with neither phone nor email are never merged', () => {
  const r = select([
    order({ customerPhone: null, customerEmail: null, orderNumber: 'X1' }),
    order({ customerPhone: '', customerEmail: '  ', orderNumber: 'X2' }),
  ]);
  assert.equal(r.rows.length, 2);
  assert.ok(r.rows.every((x) => x.whatsappUrl === null));
});

test('the exit-popup answer is carried onto the row', () => {
  const o = order({ orderNumber: 'R1' });
  const r = selectUnpaidCheckouts([o], [], { now: NOW, reasons: new Map([['R1', { label: 'Price too high', note: 'found cheaper' }]]) });
  assert.equal(r.rows[0].reason, 'Price too high — "found cheaper"');
});

test('city, state and pincode from real address shapes', () => {
  assert.deepEqual(placeFromAddress('Ravi · +91 98765 43210\nShop 4, MG Road, Pune, Maharashtra, 411001'), { city: 'Pune', state: 'Maharashtra', pincode: '411001' });
  // Unpicked dropdown, and "MN" inside a street name is NOT Manipur.
  assert.deepEqual(placeFromAddress('A · +91 9\n8-346, MN REDDY NAGAR CHINTAL, HYDERABAD, ---Select---, 500067'), { city: 'HYDERABAD', state: '', pincode: '500067' });
  // Misspelt state.
  assert.equal(placeFromAddress('A · 1\nnew usmanpura , aurangabad, maharastra, 431005').state, 'Maharashtra');
  assert.equal(placeFromAddress('A · 1\nnew usmanpura , aurangabad, maharastra, 431005').city, 'aurangabad');
  // Pincode stuck to the state with a dash; "Dist." prefix.
  assert.deepEqual(placeFromAddress('A · 1\nWing D, Dahanu, Dist. Palghar, Maharashtra – 401602'), { city: 'Palghar', state: 'Maharashtra', pincode: '401602' });
  // Doubled commas.
  assert.deepEqual(placeFromAddress('A · 1\nHotel Onn Saggu Chowk , , Ludhiana , Punjab, 141001'), { city: 'Ludhiana', state: 'Punjab', pincode: '141001' });
  // Short form and "India".
  assert.deepEqual(placeFromAddress('A · 1\nLane 2, Thane, MH, India, 400601'), { city: 'Thane', state: 'Maharashtra', pincode: '400601' });
  // City and state in one part.
  assert.deepEqual(placeFromAddress('A · 1\nPlot 9, Andheri, Mumbai Maharashtra 400053'), { city: 'Mumbai', state: 'Maharashtra', pincode: '400053' });
  // No state given: last part is the city.
  assert.deepEqual(placeFromAddress('A · 1\nnear medical, Mumbai , Dharavi , 400017'), { city: 'Dharavi', state: '', pincode: '400017' });
  // Manipal is a city, not Manipur.
  assert.equal(placeFromAddress('A · 1\nTiger Circle, Manipal, 576104').state, '');
  assert.deepEqual(placeFromAddress(null), { city: '', state: '', pincode: '' });
});

test('WhatsApp link to the buyer: 91 added, short opening line', () => {
  const url = buyerWhatsAppUrl({
    customerPhone: '98765 43210',
    customerName: 'Ravi Kumar',
    items: [
      { productName: 'Chafing Dish', productSku: 'KK1', quantity: 1 },
      { productName: 'Bain Marie', productSku: 'KK2', quantity: 1 },
    ],
  });
  assert.ok(url?.startsWith('https://wa.me/919876543210?text='));
  const text = decodeURIComponent(url!.split('?text=')[1]);
  assert.equal(text, 'Hi Ravi, this is Kitchenary Kart. You were ordering Chafing Dish and 1 more item on our website. Can we help you complete the order?');
  assert.ok(buyerWhatsAppUrl({ customerPhone: '+91 98765 43210', customerName: null, items: [] })?.startsWith('https://wa.me/919876543210?'));
  assert.ok(buyerWhatsAppUrl({ customerPhone: '098765 43210', customerName: null, items: [] })?.startsWith('https://wa.me/919876543210?'));
  assert.equal(buyerWhatsAppUrl({ customerPhone: '12345', customerName: 'X', items: [] }), null);
});

test('age text and file name', () => {
  assert.equal(ageText(45), '45 min');
  assert.equal(ageText(60), '1 h');
  assert.equal(ageText(190), '3 h 10 min');
  assert.equal(ageText(1440), '1 day');
  assert.equal(ageText(3 * 1440 + 4 * 60 + 5), '3 days 4 h');
  // 20:00 UTC on 4 Nov is 01:30 IST on 5 Nov — the file is dated in IST.
  assert.equal(unpaidCheckoutsFilename(new Date('2026-11-04T20:00:00Z')), 'unpaid-checkouts-2026-11-05.xlsx');
});

test('the Excel file has the columns, one row per buyer, IST times, links and a total', async () => {
  const r = select([
    order({ orderNumber: 'E1', createdAt: new Date('2026-11-04T09:00:00Z'), totalAmount: 1000, customerPhone: '9000000021', customerEmail: null }),
    order({ orderNumber: 'E2', createdAt: new Date('2026-11-04T10:00:00Z'), totalAmount: 2500.5, customerPhone: '9000000022', customerEmail: null }),
  ]);
  const buf = await buildUnpaidCheckoutsWorkbook(r, { now: NOW, periodLabel: 'last 7 days' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  const ws = wb.getWorksheet('Unpaid checkouts')!;
  assert.match(String(ws.getCell('A1').value), /Unpaid checkouts — last 7 days/);
  const headers = (ws.getRow(4).values as unknown[]).slice(1);
  for (const h of ['Order no.', 'Date & time (IST)', 'Name', 'Phone', 'Email', 'City', 'State', 'Items', 'Amount', 'Minutes since checkout', 'WhatsApp the buyer']) {
    assert.ok(headers.includes(h), `missing column ${h}`);
  }
  const col = (h: string) => headers.indexOf(h) + 1;
  // Newest first; 10:00 UTC = 15:30 IST, written as IST wall-clock.
  assert.equal(ws.getRow(5).getCell(col('Order no.')).value, 'E2');
  assert.equal((ws.getRow(5).getCell(col('Date & time (IST)')).value as Date).toISOString(), '2026-11-04T15:30:00.000Z');
  assert.equal(ws.getRow(5).getCell(col('Minutes since checkout')).value, 120);
  assert.equal(ws.getRow(5).getCell(col('Phone')).value, '+91 90000 00022');
  assert.equal(ws.getRow(5).getCell(col('City')).value, 'Pune');
  const link = ws.getRow(5).getCell(col('WhatsApp the buyer')).value as { hyperlink: string };
  assert.ok(link.hyperlink.startsWith('https://wa.me/919000000022'));
  const total = ws.getRow(7).getCell(col('Amount')).value as { formula: string; result: number };
  assert.equal(total.formula, 'SUBTOTAL(109,J5:J6)');
  assert.equal(total.result, 3500.5);
});

test('an empty period still makes a readable file', async () => {
  const buf = await buildUnpaidCheckoutsWorkbook(select([]), { now: NOW, periodLabel: 'last 24 hours' });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf as unknown as ArrayBuffer);
  assert.equal(wb.getWorksheet('Unpaid checkouts')!.getCell('A5').value, 'No unpaid checkouts in this period.');
});
