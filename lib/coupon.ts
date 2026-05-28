/**
 * Coupon validation — single source of truth shared by:
 *   - the storefront's /api/coupons/validate (read-only preview)
 *   - the backend /api/public/checkout (authoritative, applies discount)
 *
 * Security note: the storefront NEVER computes the discount itself. It
 * calls validate to SHOW the customer a preview, but the binding
 * discount is recomputed here at checkout time before the Razorpay
 * amount is set. A tampered client can't fake a discount.
 *
 * The web repo has a byte-identical copy at web/lib/coupon.ts. Keep
 * them in sync — the logic must match exactly so the preview equals
 * the charged amount.
 */
import { prisma } from '@/lib/db';

export interface CouponValidationResult {
  valid: boolean;
  /** ₹ amount to subtract from the subtotal. 0 when invalid. */
  discountAmount: number;
  /** Customer-facing message — success confirmation or failure reason. */
  message: string;
  coupon: {
    id: number;
    code: string;
    discountType: 'percent' | 'fixed';
    discountValue: number;
  } | null;
}

function fail(message: string): CouponValidationResult {
  return { valid: false, discountAmount: 0, message, coupon: null };
}

/**
 * Round to whole rupees. We never charge paise-level discounts —
 * keeps the invoice + Razorpay amount clean.
 */
function roundRupees(n: number): number {
  return Math.round(n);
}

export async function validateCoupon(opts: {
  code: string;
  subtotal: number;
  customerPhone?: string | null;
}): Promise<CouponValidationResult> {
  const code = (opts.code || '').trim().toUpperCase();
  const subtotal = Number(opts.subtotal) || 0;

  if (!code) return fail('Please enter a coupon code.');
  if (subtotal <= 0) return fail('Your cart is empty.');

  const coupon = await prisma.coupon.findUnique({ where: { code } });
  if (!coupon) return fail('This coupon code is not valid.');
  if (!coupon.isActive) return fail('This coupon is no longer active.');

  const now = new Date();
  if (coupon.startsAt && now < coupon.startsAt) {
    return fail('This coupon is not active yet.');
  }
  if (coupon.expiresAt && now > coupon.expiresAt) {
    return fail('This coupon has expired.');
  }

  const minOrder = coupon.minOrderValue ? Number(coupon.minOrderValue) : 0;
  if (minOrder > 0 && subtotal < minOrder) {
    return fail(
      `Add ₹${roundRupees(minOrder - subtotal).toLocaleString('en-IN')} more to use this coupon (min order ₹${roundRupees(minOrder).toLocaleString('en-IN')}).`,
    );
  }

  // Global usage cap.
  if (coupon.usageLimit != null && coupon.usageCount >= coupon.usageLimit) {
    return fail('This coupon has reached its usage limit.');
  }

  // Per-customer cap (matched on phone). Only enforced when we know
  // the phone AND the coupon sets a per-customer limit.
  if (coupon.perCustomerLimit != null && opts.customerPhone) {
    const phone = opts.customerPhone.replace(/\D/g, '');
    if (phone) {
      const usedByCustomer = await prisma.couponRedemption.count({
        where: {
          couponId: coupon.id,
          customerPhone: { contains: phone.slice(-10) },
        },
      });
      if (usedByCustomer >= coupon.perCustomerLimit) {
        return fail('You have already used this coupon.');
      }
    }
  }

  // Compute the discount.
  let discount: number;
  if (coupon.discountType === 'percent') {
    discount = (subtotal * Number(coupon.discountValue)) / 100;
    if (coupon.maxDiscountAmount != null) {
      discount = Math.min(discount, Number(coupon.maxDiscountAmount));
    }
  } else {
    discount = Number(coupon.discountValue);
  }

  // Never discount more than the subtotal (free items, not negative totals).
  discount = roundRupees(Math.min(discount, subtotal));

  if (discount <= 0) return fail('This coupon gives no discount on your cart.');

  const label =
    coupon.discountType === 'percent'
      ? `${Number(coupon.discountValue)}% off`
      : `₹${roundRupees(Number(coupon.discountValue)).toLocaleString('en-IN')} off`;

  return {
    valid: true,
    discountAmount: discount,
    message: `Coupon applied — ${label} (−₹${discount.toLocaleString('en-IN')})`,
    coupon: {
      id: coupon.id,
      code: coupon.code,
      discountType: coupon.discountType as 'percent' | 'fixed',
      discountValue: Number(coupon.discountValue),
    },
  };
}
