/**
 * Where internal alerts go — new paid order, unpaid checkout, quote request.
 * One list, so every alert reaches the same inboxes.
 *
 * admin@kitchenarykart.com is only the admin LOGIN, not a real mailbox, so it
 * must NOT be added here.
 */
export function adminRecipients(extra: Array<string | null | undefined> = []): string[] {
  return [
    ...new Set(
      [
        ...(process.env.ADMIN_NOTIFY_EMAIL || '').split(','),
        'shoppershub.ind@gmail.com',
        'support@kitchenarykart.com',
        ...extra,
      ]
        .map((s) => (s || '').trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}

/** Base URL of the admin panel, for links inside alert emails. */
export function adminBaseUrl(): string {
  return process.env.ADMIN_BASE_URL || 'https://kitchenary-kart-admin-nujh.vercel.app';
}
