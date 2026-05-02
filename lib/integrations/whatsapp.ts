/** WhatsApp via Twilio. Stubbed when credentials are missing. */

export const whatsappEnabled = Boolean(
  process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_WHATSAPP_FROM
);

export async function sendWhatsApp(to: string, body: string): Promise<{ sent: boolean; reason?: string }> {
  if (!whatsappEnabled) {
    console.log(`[whatsapp:stub] → ${to}: ${body}`);
    return { sent: false, reason: 'Twilio credentials not configured' };
  }
  const sid = process.env.TWILIO_ACCOUNT_SID!;
  const token = process.env.TWILIO_AUTH_TOKEN!;
  const from = process.env.TWILIO_WHATSAPP_FROM!;
  const url = `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`;

  const params = new URLSearchParams({
    From: from,
    To: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
    Body: body,
  });
  const auth = Buffer.from(`${sid}:${token}`).toString('base64');

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params,
  });
  if (!res.ok) {
    const txt = await res.text();
    console.error('Twilio error:', txt);
    return { sent: false, reason: `Twilio ${res.status}` };
  }
  return { sent: true };
}

export async function notifyOrderStatus(phone: string, orderNumber: string, status: string) {
  const msg = `KitchenaryKart order ${orderNumber}: status updated to ${status}.`;
  return sendWhatsApp(phone, msg);
}
