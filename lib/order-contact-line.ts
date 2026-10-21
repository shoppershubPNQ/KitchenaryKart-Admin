import { detectStateFromAddress } from './gst-states';

/**
 * The address an admin-raised order STORES, in the storefront checkout's format
 * — "<Name> · <Phone>\n<address>". The invoice prints only the address string
 * and the courier parser (shipments.ts parseShippingAddress) reads name + phone
 * from that first line, so a manual order saved with the bare address printed
 * no contact number (owner 2026-10-21, KK-MVHS74TN).
 *
 * Returns the address untouched when it already has that line, when the name
 * or phone is missing, or when adding the line would change the detected state:
 * place of supply (CGST+SGST vs IGST) and freight are found by state NAME
 * anywhere in this string, and a business name can contain one.
 */
export function withContactLine(
  address: string | null | undefined,
  name: string | null | undefined,
  phone: string | null | undefined,
): string | undefined {
  const addr = address?.trim();
  const n = name?.trim();
  const p = phone?.trim();
  if (!addr || !n || !p || addr.split('\n')[0].includes('·')) return address ?? undefined;
  // The operator often types the business name at the start of the address too.
  const rest = addr.toLowerCase().startsWith(n.toLowerCase())
    ? addr.slice(n.length).replace(/^[\s,.\-]+/, '')
    : addr;
  const composed = `${n} · ${p}\n${rest || addr}`;
  return detectStateFromAddress(composed)?.code === detectStateFromAddress(addr)?.code ? composed : address ?? undefined;
}
