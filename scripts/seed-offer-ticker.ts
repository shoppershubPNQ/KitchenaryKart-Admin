/** Seed the offer ticker with starter lines — ONLY if nothing is saved yet
 *  (never overwrites the owner's text). Every line is something the site
 *  already promises (free shipping threshold, GST invoice, pan-India, bulk
 *  pricing on WhatsApp). The owner edits them in admin → Offer ticker. */
import { prisma } from '../lib/db';

const KEY = 'offer_ticker';
const STARTER = {
  enabled: true,
  speed: 'normal',
  items: [
    { text: 'Free pan-India delivery on orders above ₹5,000', href: '/shop' },
    { text: 'GST invoice with every order — claim full input tax credit', href: null },
    { text: 'Bulk & HORECA pricing — WhatsApp +91 98903 52455', href: 'https://wa.me/919890352455' },
  ],
};

(async () => {
  const existing = await prisma.setting.findUnique({ where: { key: KEY } });
  if (existing) {
    console.log('offer_ticker already set — left unchanged:', existing.value);
  } else {
    await prisma.setting.create({ data: { key: KEY, value: JSON.stringify(STARTER), dataType: 'json' } });
    console.log('seeded offer_ticker with', STARTER.items.length, 'starter offers');
  }
  await prisma.$disconnect();
})();
