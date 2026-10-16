/**
 * GET  /api/he-price-watch          the latest HE price rises (top 15, new ones first) + whether this user has seen them
 * GET  /api/he-price-watch?full=1   every stored rise, for the full list page
 * POST { action: 'seen', checkedAt } this user has seen the rises of that check; the pop-up stays away until a new one
 * POST { action: 'run' }            check HE now instead of waiting for the daily run (admin only)
 *
 * Read-only for products: nothing here changes a price. See lib/he-price-watch.ts.
 */
import { z } from 'zod';
import { withAuth } from '@/lib/auth';
import { fail, handleError, ok } from '@/lib/api';
import {
  HE_WATCH_ROLES,
  computeHeIncreases,
  currentIncreases,
  isNewTo,
  readHeWatch,
  readSeen,
  saveHeWatch,
  saveSeen,
} from '@/lib/he-price-watch';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// "Check now" reads HE's whole feed, which takes longer than the platform default.
export const maxDuration = 300;

const POPUP_ROWS = 15;
/** A day's run plus slack. Older than this, the daily check has stopped and the owner must hear about it. */
const STALE_MS = 36 * 3600 * 1000;

export const GET = withAuth(async (req, { user }) => {
  try {
    const snapshot = await readHeWatch();
    // Never checked (just deployed, or HE not connected yet) is not "stopped working".
    if (!snapshot) return ok({ ok: true, checked: false, stale: false, total: 0, products: 0, newCount: 0, seen: true, items: [] });

    const [items, seenMap] = await Promise.all([currentIncreases(snapshot), readSeen(user.id)]);
    const tagged = items.map((i) => ({ ...i, isNew: isNewTo(seenMap, i) }));
    const newCount = tagged.filter((i) => i.isNew).length;
    const full = new URL(req.url).searchParams.get('full') === '1';
    // New rises first, so a small new one is not hidden under "+ N more" behind rows already seen.
    const popupRows = [...tagged.filter((i) => i.isNew), ...tagged.filter((i) => !i.isNew)].slice(0, POPUP_ROWS);
    // NaN (a broken date) counts as stale too.
    const stale = !(Date.now() - Date.parse(snapshot.checkedAt) < STALE_MS);
    return ok({
      ok: true,
      checked: true,
      checkedAt: snapshot.checkedAt,
      stale,
      // Sizes; products counts listings, since one listing can have several sizes rising.
      total: tagged.length,
      products: new Set(tagged.map((i) => i.productId)).size,
      newCount,
      seen: newCount === 0,
      gstDiffers: snapshot.gstDiffers,
      examined: snapshot.examined,
      // The stored list was cut to its biggest rises; the smallest ones past the cut are not listed.
      truncated: snapshot.total > snapshot.items.length,
      items: full ? tagged : popupRows,
    });
  } catch (e) {
    return handleError(e);
  }
}, HE_WATCH_ROLES);

const postSchema = z.object({ action: z.enum(['seen', 'run']), checkedAt: z.string().optional() });

export const POST = withAuth(async (req, { user }) => {
  try {
    const { action, checkedAt } = postSchema.parse(await req.json());

    if (action === 'seen') {
      const snapshot = await readHeWatch();
      // A newer check landed after the pop-up loaded: saving now would mark rises this user never saw.
      if (snapshot && checkedAt && snapshot.checkedAt !== checkedAt) {
        return ok({ ok: true, seen: 0, changed: true });
      }
      const items = snapshot ? await currentIncreases(snapshot) : [];
      await saveSeen(user.id, items);
      return ok({ ok: true, seen: items.length });
    }

    // Calls HE for the whole feed, so it stays with admins even if more roles get the pop-up.
    if (user.role !== 'admin') return fail('Only an admin can run the check.', 403);
    const snapshot = await computeHeIncreases();
    await saveHeWatch(snapshot);
    return ok({ ok: true, checkedAt: snapshot.checkedAt, total: snapshot.total, gstDiffers: snapshot.gstDiffers, examined: snapshot.examined });
  } catch (e) {
    return handleError(e);
  }
}, HE_WATCH_ROLES);
