/**
 * Indian GST state names + 2-digit state codes (as per the GSTIN format).
 * Used to detect the buyer's place of supply from a free-text shipping
 * address, so the invoice can split GST into CGST+SGST (intra-state) or
 * IGST (inter-state) per CGST Rule 46.
 *
 * The aliases list covers the most common abbreviations (e.g. "MH" for
 * Maharashtra) plus a few alternate spellings (Orissa = Odisha).
 */
export interface GstState {
  name: string;
  /** 2-digit GSTIN state code, padded. */
  code: string;
  aliases: string[];
}

export const GST_STATES: GstState[] = [
  { name: 'Jammu and Kashmir', code: '01', aliases: ['JK', 'J&K', 'Jammu', 'Kashmir'] },
  { name: 'Himachal Pradesh', code: '02', aliases: ['HP'] },
  { name: 'Punjab', code: '03', aliases: ['PB'] },
  { name: 'Chandigarh', code: '04', aliases: ['CH'] },
  { name: 'Uttarakhand', code: '05', aliases: ['UK', 'Uttaranchal'] },
  { name: 'Haryana', code: '06', aliases: ['HR'] },
  { name: 'Delhi', code: '07', aliases: ['DL', 'New Delhi'] },
  { name: 'Rajasthan', code: '08', aliases: ['RJ'] },
  { name: 'Uttar Pradesh', code: '09', aliases: ['UP'] },
  { name: 'Bihar', code: '10', aliases: ['BR'] },
  { name: 'Sikkim', code: '11', aliases: ['SK'] },
  { name: 'Arunachal Pradesh', code: '12', aliases: ['AR'] },
  { name: 'Nagaland', code: '13', aliases: ['NL'] },
  { name: 'Manipur', code: '14', aliases: ['MN'] },
  { name: 'Mizoram', code: '15', aliases: ['MZ'] },
  { name: 'Tripura', code: '16', aliases: ['TR'] },
  { name: 'Meghalaya', code: '17', aliases: ['ML'] },
  { name: 'Assam', code: '18', aliases: ['AS'] },
  { name: 'West Bengal', code: '19', aliases: ['WB'] },
  { name: 'Jharkhand', code: '20', aliases: ['JH'] },
  { name: 'Odisha', code: '21', aliases: ['OD', 'Orissa'] },
  { name: 'Chhattisgarh', code: '22', aliases: ['CG', 'Chattisgarh'] },
  { name: 'Madhya Pradesh', code: '23', aliases: ['MP'] },
  { name: 'Gujarat', code: '24', aliases: ['GJ'] },
  { name: 'Daman and Diu', code: '25', aliases: ['DD'] },
  { name: 'Dadra and Nagar Haveli', code: '26', aliases: ['DN'] },
  { name: 'Maharashtra', code: '27', aliases: ['MH'] },
  { name: 'Karnataka', code: '29', aliases: ['KA'] },
  { name: 'Goa', code: '30', aliases: ['GA'] },
  { name: 'Lakshadweep', code: '31', aliases: ['LD'] },
  { name: 'Kerala', code: '32', aliases: ['KL'] },
  { name: 'Tamil Nadu', code: '33', aliases: ['TN', 'Tamilnadu'] },
  { name: 'Puducherry', code: '34', aliases: ['PY', 'Pondicherry'] },
  { name: 'Andaman and Nicobar Islands', code: '35', aliases: ['AN'] },
  { name: 'Telangana', code: '36', aliases: ['TG', 'TS'] },
  { name: 'Andhra Pradesh', code: '37', aliases: ['AP'] },
  { name: 'Ladakh', code: '38', aliases: ['LA'] },
];

/**
 * Try to detect the buyer's state from a free-text shipping address.
 * Matches full state names first (most reliable), then aliases as
 * whole words to avoid false positives like "AP" inside other words.
 *
 * Returns null when nothing matches — caller decides the fallback
 * (typically: treat as inter-state so we charge IGST and stay safe).
 */
export function detectStateFromAddress(
  address: string | null | undefined,
): GstState | null {
  if (!address) return null;
  const lc = address.toLowerCase();

  // Full names first — longest first to prefer "Andhra Pradesh" over "Pradesh".
  const byNameLen = [...GST_STATES].sort((a, b) => b.name.length - a.name.length);
  for (const s of byNameLen) {
    if (lc.includes(s.name.toLowerCase())) return s;
  }

  // Aliases — match as whole words so "MH" doesn't trigger on a random word.
  for (const s of GST_STATES) {
    for (const alias of s.aliases) {
      const re = new RegExp(`(^|[^a-z])${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z]|$)`, 'i');
      if (re.test(address)) return s;
    }
  }

  return null;
}
