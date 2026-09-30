/** Hand edits (30 Sep 2026) after clean-doc-filler on the mini black/white board
 *  (13) and hanger (7) documents: the "useful … / practical …" phrasings the
 *  filler tool does not cover. Each edit must match exactly once.
 *  Usage: node scripts/edit-mini-board-hanger.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const JOBS = {
  'scripts/docs/mini-board-13-final.txt': [
    ['is a practical add-on for counters', 'is a handy add-on for counters'],
    ['Useful Spare Set: Convenient to keep with', 'Spare Set: Keep it with'],
    ['Clean gently with the suitable duster', 'Clean gently with the duster'],
    ['Its compact size makes it useful where counter or ta', 'Its compact size fits where counter or ta'],
    ['It is a practical choice for counters, buffet sections', 'It works well at counters, buffet sections'],
    ['display board with useful writing space for daily specials', 'display board with room for daily specials'],
    ['Useful for Changing Promotions: Suitable for specials, offers', 'Changing Promotions: Made for specials, offers'],
    ['It is useful where a compact table label would be too small', 'It fits where a compact table label would be too small'],
    ['The reusable format is especially practical when the message changes regularly.', 'Being reusable, it pays off when the message changes often.'],
    ['is a practical choice where staff need to update information regularly', 'suits staff who update information regularly'],
    ['Wooden Display Format: Useful on counters, tables and buffet areas.', 'Wooden Display Format: Stands on counters, tables and buffet areas.'],
    ['Provides practical writing space for short multi-line information.', 'Room for short multi-line information.'],
    ['Useful Near Point of Service: Can present information close to', 'Near the Point of Service: Shows information close to'],
    // Care lines said "compatible writing material" — photos show chalk on the
    // black boards and a dry-erase marker + sponge with the white boards.
    ['Care & Use: Use only on compatible erasable writing surfaces.', 'Care & Use: Use on whiteboard surfaces only.'],
    ['Care & Use: Use compatible writing material for the board surface.', 'Care & Use: Write with chalk or chalk markers.'],
    ['Care & Use: Write only with compatible material, clean gently', 'Care & Use: Write only with chalk or chalk markers, clean gently'],
    ['Care & Use: Use compatible writing material and clean the surface gently.', 'Care & Use: Use chalk and wipe the surface gently with a dry duster.'],
    ['Care & Use: Use compatible writing material.', 'Care & Use: Chalk and chalk markers work best on this surface.'],
    ['Care & Use: Use compatible writing material and clean the writing surface carefully.', 'Care & Use: Stick to chalk or chalk markers and clean the surface carefully.'],
    ['Care & Use: Use a compatible marker for the writing surface.', 'Care & Use: Use a whiteboard marker on the surface.'],
    ['Care & Use: Use compatible erasable writing material.', 'Care & Use: Write with dry-erase markers only.'],
    ['Care & Use: Write with compatible erasable material and clean gently.', 'Care & Use: Write with whiteboard markers and wipe clean gently.'],
    ['Care & Use: Use compatible erasable writing tools.', 'Care & Use: Dry-erase markers suit this surface.'],
    ['Care & Use: Use compatible erasable writing material and clean gently.', 'Care & Use: Use dry-erase markers and clean gently.'],
  ],
  'scripts/docs/hanger-7-final.txt': [
    ['make it especially useful where the hanger remains visible to guests', 'suit places where the hanger stays in view of guests'],
    ['Useful for Coats & Jackets: Helps keep outerwear', 'Coats & Jackets: Keeps outerwear'],
    ['The Heavy variant is useful in hotel rooms, offices', 'The Heavy variant works well in hotel rooms, offices'],
    ['Useful Near Entry or Dressing Areas: Creates a convenient place', 'Entry or Dressing Areas: Gives a ready place'],
    ['It is useful in rooms and common areas where garments need', 'It suits rooms and common areas where garments need'],
    ['The Regular variant is a practical choice for guest rooms', 'The Regular variant fits guest rooms'],
    ['Flexible Placement: Useful in guest rooms, office spaces', 'Flexible Placement: At home in guest rooms, office spaces'],
    ['Useful for Multi-Room Setup: A practical hanger option when equipping', 'Multi-Room Setup: An easy choice when equipping'],
    ['making it useful for garments such as trousers, skirts', 'which helps with garments such as trousers, skirts'],
    ['It is a practical wardrobe option for hotels, serviced apartments', 'It is a sensible wardrobe option for hotels, serviced apartments'],
    ['Dedicated Garment Hanging: Helps keep clothing organised', 'Garment Hanging: Keeps clothing organised'],
  ],
};
// KKHRE0082 "Wooden Triangle Writing & Painting Board": its photos show a 150 cm
// wooden easel stand with no writing surface — held for the owner.
const HOLD = ['KKHRE0082-WTRIPB'];
for (const [file, edits] of Object.entries(JOBS)) {
  let t = readFileSync(file, 'utf8');
  for (const sku of HOLD) {
    const lines = t.split('\n');
    const i = lines.findIndex((l) => l.includes(`SKU: ${sku}`));
    if (i < 0) continue;
    const start = i - 1; // its [Heading1]
    let end = lines.findIndex((l, j) => j > i && l.startsWith('[Heading1]'));
    if (end < 0) end = lines.length;
    lines.splice(start, end - start);
    t = lines.join('\n');
    console.log(`${file}: held ${sku}`);
  }
  for (const [from, to] of edits) {
    const n = t.split(from).length - 1;
    if (n === 0 && t.includes(to)) continue; // already applied on an earlier run
    if (n !== 1) throw new Error(`${file}: expected 1 match, found ${n}: ${from.slice(0, 60)}`);
    t = t.replace(from, to);
  }
  const left = t.match(/\b(useful|practical|compatible|dedicated)\b/gi);
  if (left) throw new Error(`${file}: still has ${left.join(', ')}`);
  writeFileSync(file, t);
  console.log(`${file}: ${edits.length} edits, no filler left`);
}
