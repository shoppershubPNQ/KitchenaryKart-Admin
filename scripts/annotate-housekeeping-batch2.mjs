/** Corrected copies of five owner documents (28-29 Sep 2026): LED display
 *  board (8), hand dryer (5), soap dispensers (37), kettle / hot plate /
 *  coffee maker (8), LED pest controller (5).
 *
 *  check-doc-vs-listing.ts found no product fact that differs from the
 *  listing, so everything here is editorial (owner rule: mine to fix):
 *  - "Useful Features" → "Key Features"; "Suitable For:" → "Suitable for:"
 *  - nine sentences that compared a product with our other listings (the 43"
 *    vs 55" screens, "a black metal-style board", "a standard white unit",
 *    "within the … range") rewritten to describe the product on its own
 *  - 21 SEO titles over 60 shortened; the soap titles also carry size and
 *    colour, because the document gave, e.g., all nine SS 500/800/1000ml
 *    Silver/Black/Gold pages one of three identical titles
 *  - 36 soap metas at 170-213 characters: the shared tail "for organised,
 *    refillable soap and toiletry use in …" shortened to fit 160
 *
 *  The LED, hand dryer and kettle documents first had no Care & Use line; the
 *  owner's corrected versions (29 Sep) added one per document — see CARE.
 *
 *  Usage: node scripts/annotate-housekeeping-batch2.mjs
 */
import { readFileSync, writeFileSync } from 'fs';

const D = 'scripts/docs/';
const DOCS = [
  {
    src: 'Kitchenary_Kart_LED_Display_Board_All_8_Product_Descriptions.txt', out: 'led-display-board-8-annotated.txt',
    replace: [
      [' The 43-inch Ultra HD display provides a dedicated digital communication point without requiring a larger 55-inch screen.',
       ' The 43-inch Ultra HD display provides a dedicated digital communication point.'],
      ['The larger 55-inch / 135 cm screen provides more display area than the 43-inch model.',
       'The 55-inch / 135 cm screen gives a large display area for digital content.'],
      [' where a warmer presentation is preferred over a black metal-style board.',
       ' where a warmer, wooden presentation suits the space.'],
    ],
    titles: {
      'KKHRE0061-AS43': '43 Inch Android LED Advertising Screen',
      'KKHRE0062-AS55': '55 Inch Android LED Advertising Screen',
      'KKHRE0066-WLEDWB4060': 'Wooden LED Writing Board 40x60cm Carton',
      'KKHRE0068-WLEDWB5070': 'LED Writing Board 50x70cm Lite Brown',
    },
  },
  {
    src: 'Kitchenary_Kart_Hand_Dryer_All_5_Human_Tone_SEO.txt', out: 'hand-dryer-5-annotated.txt',
    replace: [
      [' make this a distinct option within the Kitchenary Kart hand-dryer range for hotels, offices and other shared washroom environments.',
       ' suit hotels, offices and other shared washroom environments.'],
      ['1900W Power: Higher-wattage option within this hand-dryer range.',
       '1900W Power: Rated at 1900W for busy shared washrooms.'],
      [' that want an electric hand dryer but do not want a standard white unit disrupting a black, dark or contemporary washroom design.',
       ' that want an electric hand dryer to suit a black, dark or contemporary washroom design.'],
    ],
    titles: {
      'KKHRE0037-HNDDRY1800S': '1800W SS Premium Auto Hand Dryer Silver',
      'KKHRE0038-HNDDRY1800B': '1800W SS Premium Auto Hand Dryer Black',
    },
  },
  {
    src: 'Kitchenary_Kart_Kettle_Hot_Plate_Coffee_Maker_All_8_Human_Tone_SEO.txt', out: 'kettle-hotplate-8-annotated.txt',
    replace: [],
    titles: {
      'KKHRE0053-ABTR': 'Kettle Tray with Socket & Sachet Holder',
      'KKHRE0054-BHP': '160W Double Decanter Warmer Hot Plate',
      'KKHRE0055-MHP': 'Hot Plate with 2L Kettle & Coffee Maker',
      'KKHRE0056-HOK1.2L': 'Honeyson Electric Kettle 1.2L with Tray',
      'KKHRE0057-PFCM': 'Coffee Bean Grinder & Filter Coffee Maker',
      'KKHRE0059-CC1.8L': '1.8L Coffee Carafe, Induction SS Bottom',
      'KKHRE0060-PGS': 'Portable Gas Stove, Can & Tank Cylinder',
    },
  },
  {
    src: 'Kitchenary_Kart_LED_Electric_Pest_Controller_All_5_Product_Descriptions.txt', out: 'pest-controller-5-annotated.txt',
    replace: [
      ['The 20W version offers a mid-range wattage option within the Kitchenary Kart pest-controller range, allowing buyers to select a model based on the intended installation area and their pest-management setup.',
       'The 20W version lets buyers match the unit to the intended installation area and their pest-management setup.'],
    ],
    regex: [[/(\d+)W Model: Provides a \1W wattage option within the Kitchenary Kart electric pest-controller range\./g,
      '$1W Model: Rated at $1W; choose the wattage to suit the size of the installation area.']],
    titles: {},
  },
  {
    src: 'Kitchenary_Kart_Soap_Dispensers_All_37_Human_Tone_SEO.txt', out: 'soap-dispensers-37-annotated.txt',
    replace: [],
    soapMetas: true,
    titles: {
      'KKHRE0130-PCCSD250FR': 'PC Crystal Soap Dispenser 250ml Flat Round',
      'KKHRE0131-PCCSD250TC': 'PC Crystal Soap Dispenser 250ml Cone Shape',
      'KKHRE0132-PCCSD300': 'PC Crystal Soap Dispenser 300ml',
      'KKHRE0133-PARSD1000M1': 'Sensor Soap Dispenser 1000ml Model No. 1',
      'KKHRE0134-PARSD1000M2': 'Sensor Soap Dispenser 1000ml Model No. 2',
      'KKHRE0135-PARSD300': 'Rechargeable Sensor Soap Dispenser 300ml',
      'KKHRE0136-PSD350W': 'Plastic Soap Dispenser 350ml White',
      'KKHRE0137-PSD350B': 'Plastic Soap Dispenser 350ml Black',
      'KKHRE0138-PSD350SBW': 'Plastic Soap Dispenser 350ml Slim White',
      'KKHRE0139-PSD350SBB': 'Plastic Soap Dispenser 350ml Slim Black',
      'KKHRE0140-PSD600W': 'Plastic Soap Dispenser 600ml White',
      'KKHRE0141-PSD600B': 'Plastic Soap Dispenser 600ml Black',
      'KKHRE0142-PSD750W': 'Plastic Soap Dispenser 750ml White',
      'KKHRE0143-PSD750B': 'Plastic Soap Dispenser 750ml Black',
      'KKHRE0145-250A': 'SS Premium Soap Dispenser 250ml Silver',
      'KKHRE0146-SSPSD350S': 'SS Premium Soap Dispenser 350ml Silver',
      'KKHRE0147-SSPSD350B': 'SS Premium Soap Dispenser 350ml Black',
      'KKHRE0148-SSPSD700S': 'SS Premium Soap Dispenser 700ml Silver',
      'KKHRE0149-SSPSD700B': 'SS Premium Soap Dispenser 700ml Black',
      'KKHRE0153-SSRSD500S': 'SS Soap Dispenser 500ml Silver',
      'KKHRE0154-SSRSD500B': 'SS Soap Dispenser 500ml Black',
      'KKHRE0155-SSRSD500G': 'SS Soap Dispenser 500ml Gold',
      'KKHRE0156-SSRSD800S': 'SS Soap Dispenser 800ml Silver',
      'KKHRE0157-SSRSD800B': 'SS Soap Dispenser 800ml Black',
      'KKHRE0158-SSRSD800G': 'SS Soap Dispenser 800ml Gold',
      'KKHRE0150-SSRSD1000S': 'SS Soap Dispenser 1000ml Silver',
      'KKHRE0151-SSRSD1000B': 'SS Soap Dispenser 1000ml Black',
      'KKHRE0152-SSRSD1000G': 'SS Soap Dispenser 1000ml Gold',
      'KKHRE0124-VSD500B': 'VAMA 2-in-1 Soap & Lotion Dispenser Black',
      'KKHRE0125-VSD500W': 'VAMA 2-in-1 Soap & Lotion Dispenser White',
      'KKHRE0126-VTS3.1': 'VAMA 3-in-1 Glass Toiletry Set, 380ml',
      'KKHRE0127-VSD370B': 'VAMA Glass Soap Dispenser 370ml Black',
      'KKHRE0128-VSD480B': 'VAMA Glass Soap Dispenser 480ml Black',
      'KKHRE0129-VSD480W': 'VAMA Glass Soap Dispenser 480ml White',
      'KKHRE0159-WBSD': 'Bamboo Soap & Sanitizer Dispenser 250ml',
      'KKHRE0160-WBTSSD': 'Bamboo Toiletry Set with Soap Dispenser',
      'KKHRE0144-SDS': 'Soap Dispenser Stand',
    },
  },
];

/**
 * Care & Use, from the owner's corrected documents (29 Sep 2026). Each of those
 * gave ONE line to a whole document; applied as written it told a marker set
 * to "disconnect power", a PC carafe and a gas stove to keep "electrical
 * components" dry, and an LED standee (filed under hand dryers) to "keep air
 * openings clear". Each product keeps only the sentences that apply to it,
 * checked against its listing (power field, material, name).
 */
const HAND = 'Install and operate according to the product instructions. Keep the unit away from direct water exposure and disconnect the power before cleaning or maintenance. Wipe the exterior with a soft cloth and keep air openings clear.';
const LED_UNIT = 'Use in a suitable indoor location and follow the product instructions for setup and operation. Keep electrical parts away from direct water exposure. Switch off and disconnect power before cleaning or moving the unit.';
const LED_BOARD = `${LED_UNIT} Use compatible markers and clean the writing surface as recommended.`;
const HEATED = 'Follow the product instructions for setup and operation. Use only with a compatible power supply. Switch off and allow heated parts to cool before cleaning, and keep electrical components away from direct water exposure.';
const POWERED = 'Follow the product instructions for setup and operation. Use only with a compatible power supply. Switch off before cleaning, and keep electrical components away from direct water exposure.';
const CARE = {
  // hand dryers — the document's line as written
  'KKHRE0035-HNDDRY1200W': HAND, 'KKHRE0036-HNDRY1900W': HAND, 'KKHRE0037-HNDDRY1800S': HAND, 'KKHRE0038-HNDDRY1800B': HAND,
  // the A2 LED standee sits in the hand dryer document but is a lit standee: no air openings
  'KKHRE0039-MSLEDDBA2': LED_UNIT,
  // screens and standee: no writing surface
  'KKHRE0061-AS43': LED_UNIT, 'KKHRE0062-AS55': LED_UNIT, 'KKHRE0063-MSLEDDBA1': LED_UNIT,
  // LED writing boards: lit, with a button controller, and a marker surface
  'KKHRE0065-MSLEDWB5070': LED_BOARD, 'KKHRE0066-WLEDWB4060': LED_BOARD, 'KKHRE0067-WLEDWB4060L': LED_BOARD, 'KKHRE0068-WLEDWB5070': LED_BOARD,
  // the marker set is not electrical
  'KKHRE0069-MRKLEDWB8PP': 'Use with compatible LED writing boards and clean the writing surface as recommended. Replace the caps after use.',
  // heated: 160 W decanter warmer, 2000 W Minimax, 1500 W Honeyson, 1355 W Marado
  'KKHRE0054-BHP': HEATED, 'KKHRE0055-MHP': HEATED, 'KKHRE0056-HOK1.2L': HEATED, 'KKHRE0058-MK1.2L': HEATED,
  // electrical, no heating stated: the socket tray and the grinder / filter maker
  'KKHRE0053-ABTR': POWERED, 'KKHRE0057-PFCM': POWERED,
  // not electrical
  'KKHRE0059-CC1.8L': 'Follow the product instructions for use. Allow the carafe to cool before cleaning, and heat it only on a compatible induction surface.',
  'KKHRE0060-PGS': 'Follow the product instructions for setup and operation. Use only with compatible gas cans or tank cylinders. Switch off and allow the burner to cool before cleaning or packing it into the carry case.',
};

const BRAND = ' | Kitchenary Kart';
const SOAP_TAIL = / for organised, refillable soap and toiletry use in hotel bathrooms, guest rooms, offices and commercial wash areas\.$/;
const SOAP_ENDINGS = [
  ' for hotel bathrooms, guest rooms, offices and commercial wash areas.',
  ' for hotel bathrooms, guest rooms and offices.',
];
const COMPARE = /\b(among (these|the listed|our|other)|within (this|the kitchenary kart)[^.]*range|higher[- ]rated|higher[- ]wattage option|larger option|compared (to|with)|than (the|our|other|a larger|larger)|other models?|distinct option within|larger electric|without requiring (a|the) (large|larger)|preferred over a black|standard white unit)\b/i;

const allTitles = new Map();
for (const doc of DOCS) {
  let text = readFileSync(D + doc.src, 'utf8').replace(/\r\n/g, '\n');
  for (const [from, to] of doc.replace) {
    if (!text.includes(from)) throw new Error(`${doc.src}: not found: ${from.slice(0, 80)}`);
    text = text.replace(from, to);
  }
  for (const [re, to] of doc.regex ?? []) {
    if (!re.test(text)) throw new Error(`${doc.src}: regex found nothing: ${re}`);
    text = text.replace(re, to);
  }
  text = text.replace(/^\[Heading2\] Useful Features$/gm, '[Heading2] Key Features')
             .replace(/^\[b\] Suitable For:/gm, '[b] Suitable for:');

  const lines = text.split('\n');
  let sku = '';
  let titled = 0;
  let cared = 0;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('[b] SKU:')) sku = l.replace('[b] SKU:', '').trim();
    // The owner's corrected documents (29 Sep) add one Care & Use line per
    // document; CARE holds it tailored per product. Inserted after "Suitable for".
    if (l.startsWith('[b] Suitable for:') && CARE[sku]) {
      if (lines.slice(i + 1, i + 3).some((x) => /Care & Use:/.test(x))) throw new Error(`${sku}: already has Care & Use`);
      lines.splice(i + 1, 0, `[b] Care & Use: ${CARE[sku]}`);
      cared++;
    }
    if (l === '[Heading2] SEO Title') {
      if (doc.titles[sku]) { lines[i + 1] = `[] ${doc.titles[sku]}${BRAND}`; titled++; }
      const t = lines[i + 1].slice(3);
      if (t.length > 60) throw new Error(`${sku}: title ${t.length} — ${t}`);
      if (allTitles.has(t)) throw new Error(`${sku}: duplicate title of ${allTitles.get(t)} — ${t}`);
      allTitles.set(t, sku);
    }
    if (l === '[Heading2] Meta Description') {
      let m = lines[i + 1].slice(3);
      if (doc.soapMetas && m.length > 160) {
        const head = m.replace(SOAP_TAIL, '');
        if (head === m) throw new Error(`${sku}: soap meta has an unexpected ending — ${m}`);
        m = SOAP_ENDINGS.map((e) => head + e).find((c) => c.length <= 160) ?? '';
        if (!m) throw new Error(`${sku}: no soap meta ending fits`);
        lines[i + 1] = `[] ${m}`;
      }
      if (m.length > 160 || !/[.!]$/.test(m)) throw new Error(`${sku}: meta ${m.length} — ${m}`);
    }
    if (COMPARE.test(l) && !/Search Phrases/.test(lines[i - 1] ?? '')) throw new Error(`${sku}: still compares — ${l.slice(0, 120)}`);
  }
  if (titled !== Object.keys(doc.titles).length) throw new Error(`${doc.src}: set ${titled} of ${Object.keys(doc.titles).length} titles`);
  writeFileSync(D + doc.out, lines.join('\n'));
  console.log(`${doc.out} · ${titled} titles rewritten · ${cared} Care & Use lines`);
}
console.log(`${allTitles.size} titles, all unique and <= 60`);
