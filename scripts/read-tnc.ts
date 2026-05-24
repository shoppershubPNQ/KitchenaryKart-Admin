import { prisma } from '../lib/db';

async function main() {
  const p = await prisma.policy.findUnique({ where: { slug: 'terms-and-conditions' } });
  if (!p) { console.log('Not found'); return; }
  console.log('--- TITLE ---');
  console.log(p.title);
  console.log('--- BODY ---');
  console.log(p.body);
  await prisma.$disconnect();
}
main().catch((e) => { console.error(e); process.exit(1); });
