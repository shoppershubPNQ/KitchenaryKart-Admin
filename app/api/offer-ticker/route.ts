/**
 * GET / PUT the offer ticker (scrolling red strip under the home hero).
 * Saving busts the storefront's home cache so the change shows in seconds.
 */
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';
import { revalidateWeb } from '@/lib/revalidateWeb';
import { OFFER_TICKER_KEY, offerTickerSchema, parseOfferTicker } from '@/lib/offer-ticker';

export const GET = withAuth(async () => {
  try {
    const row = await prisma.setting.findUnique({ where: { key: OFFER_TICKER_KEY } });
    return ok({ ticker: parseOfferTicker(row?.value) });
  } catch (e) {
    return handleError(e);
  }
});

export const PUT = withAuth(async (req) => {
  try {
    const ticker = offerTickerSchema.parse(await req.json());
    const value = JSON.stringify(ticker);
    await prisma.setting.upsert({
      where: { key: OFFER_TICKER_KEY },
      create: { key: OFFER_TICKER_KEY, value, dataType: 'json' },
      update: { value, dataType: 'json' },
    });
    await revalidateWeb('offer-ticker');
    return ok({ saved: true, ticker });
  } catch (e) {
    return handleError(e);
  }
}, ['admin', 'staff']);
