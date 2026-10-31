import { prisma } from './db';
import type { BankDetails } from './invoice';

/** Settings rows holding the bank account printed on proforma invoices (owner fills them in Dashboard → Settings).
 *  Kept as plain rows so they are edited like the other company_* settings. */
export const BANK_SETTING_KEYS = {
  accountName: 'bank_account_name',
  bankName: 'bank_name',
  accountNumber: 'bank_account_number',
  ifsc: 'bank_ifsc',
  branch: 'bank_branch',
  upi: 'bank_upi_id',
} as const;

/** The bank account for proformas, or null until at least the account number and IFSC are filled in. */
export async function getBankDetails(): Promise<BankDetails | null> {
  const rows = await prisma.setting.findMany({ where: { key: { in: Object.values(BANK_SETTING_KEYS) } }, select: { key: true, value: true } });
  const val = (key: string) => rows.find((r) => r.key === key)?.value?.trim() || null;
  const bank: BankDetails = Object.fromEntries(Object.entries(BANK_SETTING_KEYS).map(([field, key]) => [field, val(key)]));
  return bank.accountNumber && bank.ifsc ? bank : null;
}
