/**
 * Fix the "Mealting" → "Melting" typo across the products table.
 *
 * Defaults to dry-run. Pass --apply to actually write.
 *
 *   node scripts/fix-mealting-typo.mjs            # dry-run
 *   node scripts/fix-mealting-typo.mjs --apply    # write
 *
 * Idempotent — running twice is safe (the second run finds zero
 * matches and exits clean). Wraps writes in a single $transaction so
 * either all rows update or none do.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

// Case-preserving replacement: "Mealting" → "Melting", "mealting" →
// "melting", "MEALTING" → "MELTING". We only ever drop the "a" — the
// rest of the casing is preserved exactly.
function fix(str) {
  if (!str) return str;
  return str.replace(/mealting/gi, (m) => {
    if (m === 'MEALTING') return 'MELTING';
    if (m[0] === 'M') return 'Melting';
    return 'melting';
  });
}

async function main() {
  const matches = await prisma.product.findMany({
    where: {
      OR: [
        { name: { contains: 'mealting', mode: 'insensitive' } },
        { metaKeywords: { contains: 'mealting', mode: 'insensitive' } },
        { description: { contains: 'mealting', mode: 'insensitive' } },
        { metaTitle: { contains: 'mealting', mode: 'insensitive' } },
        { metaDescription: { contains: 'mealting', mode: 'insensitive' } },
      ],
    },
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      metaTitle: true,
      metaDescription: true,
      metaKeywords: true,
    },
  });

  if (matches.length === 0) {
    console.log('✅ Nothing to fix — no rows match "mealting". (Already fixed?)');
    return;
  }

  console.log(`\nFound ${matches.length} product(s) with the typo:\n`);
  for (const p of matches) {
    console.log(`  [${p.id}] ${p.sku}`);
    if (p.name?.match(/mealting/i)) {
      console.log(`    name:         "${p.name}"`);
      console.log(`             →   "${fix(p.name)}"`);
    }
    if (p.metaKeywords?.match(/mealting/i)) {
      const before = p.metaKeywords;
      const after = fix(before);
      console.log(`    metaKeywords: ${before.length > 80 ? before.slice(0, 77) + '…' : before}`);
      console.log(`             →   ${after.length > 80 ? after.slice(0, 77) + '…' : after}`);
    }
    if (p.description?.match(/mealting/i)) {
      console.log(`    description:  (contains typo — will fix)`);
    }
    if (p.metaTitle?.match(/mealting/i)) {
      console.log(`    metaTitle:    "${p.metaTitle}" → "${fix(p.metaTitle)}"`);
    }
    if (p.metaDescription?.match(/mealting/i)) {
      console.log(`    metaDescription: (contains typo — will fix)`);
    }
  }

  if (!APPLY) {
    console.log(
      `\n— DRY RUN —\nRe-run with  node scripts/fix-mealting-typo.mjs --apply  to write.\n`,
    );
    return;
  }

  console.log(`\nApplying updates in a transaction…`);
  await prisma.$transaction(
    matches.map((p) =>
      prisma.product.update({
        where: { id: p.id },
        data: {
          name: fix(p.name),
          description: fix(p.description),
          metaTitle: fix(p.metaTitle),
          metaDescription: fix(p.metaDescription),
          metaKeywords: fix(p.metaKeywords),
        },
      }),
    ),
  );
  console.log(`✅ Updated ${matches.length} product(s).`);

  // Best-effort storefront cache bust so the live PDP picks up the
  // new name immediately instead of waiting for the 5-min ISR window.
  const revalidateUrl = process.env.WEB_REVALIDATE_URL;
  const revalidateSecret = process.env.REVALIDATE_SECRET;
  if (revalidateUrl && revalidateSecret) {
    try {
      const u = new URL(revalidateUrl);
      u.searchParams.set('tag', 'products');
      u.searchParams.set('secret', revalidateSecret);
      const res = await fetch(u.toString(), { method: 'POST' });
      console.log(`Storefront revalidate: HTTP ${res.status}`);
    } catch (e) {
      console.log(`Revalidate failed (non-fatal): ${e.message}`);
    }
  } else {
    console.log(
      `\nNote: WEB_REVALIDATE_URL / REVALIDATE_SECRET not set — the storefront`,
    );
    console.log(
      `will pick up the change on its next ISR window (~5 min) automatically.`,
    );
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
