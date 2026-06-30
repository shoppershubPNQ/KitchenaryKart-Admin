/**
 * GST invoice serial allocation.
 *
 * CGST Rule 46(b) requires invoice numbers to be consecutive within a
 * financial year, unique, and not exceed 16 characters. We use the
 * format `KK/<FY>/<padded serial>` (e.g. `KK/2026-27/0001`) which fits
 * in 15 characters for serials up to 9999, then 16 for 10000+ (still
 * compliant).
 *
 * Allocation is **lazy**: the serial is assigned only when an invoice
 * is actually generated. This avoids burning serials on pending or
 * cancelled orders, which would create gaps in the GST filing.
 *
 * Allocation is **atomic**: a Prisma `$transaction` reads the current
 * max serial for the financial year and inserts the next one. With
 * the `(invoice_financial_year, invoice_serial)` unique constraint,
 * two concurrent allocations would result in one transaction failing
 * — we catch P2002 and retry once.
 */
import { Prisma } from '@prisma/client';
import { prisma } from './db';

/**
 * Indian financial year for a given date, in `YYYY-YY` form.
 *
 * The Indian FY runs 1 April → 31 March. So:
 * - 2026-04-01 → "2026-27"
 * - 2027-03-31 → "2026-27"
 * - 2027-04-01 → "2027-28"
 */
export function getFinancialYear(date: Date): string {
  const month = date.getMonth(); // 0 = Jan
  const year = date.getFullYear();
  const startYear = month >= 3 ? year : year - 1; // April onwards = start of FY
  const endYear = startYear + 1;
  const endYY = String(endYear).slice(-2);
  return `${startYear}-${endYY}`;
}

/**
 * UTC bounds for a financial year. `start` is inclusive, `end` is
 * exclusive — use these with Prisma `gte` / `lt` filters.
 */
export function getFinancialYearBounds(fy: string): { start: Date; end: Date } {
  const startYear = parseInt(fy.slice(0, 4));
  return {
    start: new Date(Date.UTC(startYear, 3, 1, 0, 0, 0)),       // 1 April 00:00 UTC
    end: new Date(Date.UTC(startYear + 1, 3, 1, 0, 0, 0)),     // next 1 April 00:00 UTC
  };
}

/**
 * UTC bounds for a calendar month within a financial year.
 * `month` is 1-12.
 */
export function getMonthBounds(fy: string, month: number): { start: Date; end: Date } {
  const fyStartYear = parseInt(fy.slice(0, 4));
  // Months 4-12 belong to the FY start year; months 1-3 belong to the next year.
  const calendarYear = month >= 4 ? fyStartYear : fyStartYear + 1;
  return {
    start: new Date(Date.UTC(calendarYear, month - 1, 1, 0, 0, 0)),
    end: new Date(Date.UTC(calendarYear, month, 1, 0, 0, 0)),
  };
}

/** "KK/2026-27/0001" — public-facing invoice number. */
export function formatInvoiceNumber(fy: string, serial: number): string {
  return `KK/${fy}/${String(serial).padStart(4, '0')}`;
}

/**
 * Return the existing invoice number for an order, allocating one if
 * the order doesn't have a serial yet. Idempotent — subsequent calls
 * for the same order return the same number.
 *
 * The financial year is determined by `order.createdAt`, not "now",
 * so an invoice generated late still goes into the correct FY's
 * sequence.
 */
export async function ensureInvoiceNumber(orderId: number): Promise<{
  fy: string;
  /** null when the order is not yet paid — no GST serial is burned. */
  serial: number | null;
  /** null when not paid; caller renders a proforma (see invoice route). */
  formatted: string | null;
}> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await tryAllocate(orderId);
    if (result) return result;
  }
  throw new Error(`Failed to allocate invoice serial for order ${orderId} after 3 retries`);
}

async function tryAllocate(orderId: number): Promise<
  { fy: string; serial: number | null; formatted: string | null } | null
> {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    select: {
      id: true,
      createdAt: true,
      invoiceSerial: true,
      invoiceFinancialYear: true,
      paymentStatus: true,
    },
  });
  if (!order) throw new Error(`Order ${orderId} not found`);

  // Already allocated — return it as-is. Pure read path on the hot
  // case (which is what the storefront / customer-side invoice view
  // hits every time).
  if (order.invoiceSerial != null && order.invoiceFinancialYear) {
    return {
      fy: order.invoiceFinancialYear,
      serial: order.invoiceSerial,
      formatted: formatInvoiceNumber(order.invoiceFinancialYear, order.invoiceSerial),
    };
  }

  const fy = getFinancialYear(order.createdAt);

  // A GST tax-invoice number is for a COMPLETED sale. Only paid orders get a
  // serial — pending/failed/cancelled orders return null so viewing their
  // invoice never burns a number (it renders as a proforma instead). The
  // serial is normally allocated at payment-success time (razorpay route),
  // so paid orders get clean sequential numbers in payment order.
  if (order.paymentStatus !== 'completed') {
    return { fy, serial: null, formatted: null };
  }

  try {
    return await prisma.$transaction(async (tx) => {
      const last = await tx.order.findFirst({
        where: { invoiceFinancialYear: fy },
        orderBy: { invoiceSerial: 'desc' },
        select: { invoiceSerial: true },
      });
      const nextSerial = (last?.invoiceSerial ?? 0) + 1;
      await tx.order.update({
        where: { id: orderId },
        data: { invoiceFinancialYear: fy, invoiceSerial: nextSerial },
      });
      return { fy, serial: nextSerial, formatted: formatInvoiceNumber(fy, nextSerial) };
    });
  } catch (e) {
    // P2002 = unique constraint violation. Means another concurrent
    // request grabbed our nextSerial first. Retry — the next attempt
    // will see the updated max and pick serial+1.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return null;
    }
    throw e;
  }
}

/**
 * Bulk-allocate serials for any orders in a given financial year that
 * don't have one yet. Used by the GST report generator so reports are
 * complete (every paid order in the period gets an invoice number).
 *
 * Orders are allocated in `createdAt` ascending order so serials line
 * up with chronology — auditors expect this. Returns the count
 * allocated.
 */
export async function backfillSerialsForFinancialYear(fy: string): Promise<number> {
  const { start, end } = getFinancialYearBounds(fy);
  const orders = await prisma.order.findMany({
    where: {
      createdAt: { gte: start, lt: end },
      paymentStatus: 'completed',
      invoiceSerial: null,
    },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  });
  let count = 0;
  for (const o of orders) {
    await ensureInvoiceNumber(o.id);
    count++;
  }
  return count;
}
