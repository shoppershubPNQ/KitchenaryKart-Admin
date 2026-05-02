import { NextRequest } from 'next/server';
import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { fail, handleError } from '@/lib/api';
import { renderInvoicePdf } from '@/lib/invoice';

export const GET = withAuth(async (_req, { params }) => {
  try {
    const id = parseInt(params.id);
    const order = await prisma.order.findUnique({
      where: { id },
      include: { items: true, customer: true },
    });
    if (!order) return fail('Not found', 404);

    const companyName = (await prisma.setting.findUnique({ where: { key: 'company_name' } }))?.value || 'KitchenaryKart';
    const companyGst = (await prisma.setting.findUnique({ where: { key: 'company_gst' } }))?.value || undefined;

    const pdf = await renderInvoicePdf({
      orderNumber: order.orderNumber,
      date: order.createdAt,
      company: { name: companyName, gst: companyGst },
      customer: {
        name: order.customerName || order.customer?.name || 'Customer',
        email: order.customerEmail || order.customer?.email || undefined,
        phone: order.customerPhone || order.customer?.phone || undefined,
        address: order.shippingAddress || order.customer?.billingAddress || undefined,
        gstNumber: order.customer?.gstNumber || undefined,
      },
      items: order.items.map(i => ({
        name: i.productName || '',
        sku: i.productSku || '',
        quantity: i.quantity,
        unitPrice: Number(i.unitPrice),
        taxPercent: Number(i.taxPercent),
        lineTotal: Number(i.lineTotal),
      })),
      subtotal: Number(order.subtotal || 0),
      tax: Number(order.taxAmount || 0),
      shipping: Number(order.shippingCost || 0),
      total: Number(order.totalAmount || 0),
    });

    return new Response(new Uint8Array(pdf), {
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `inline; filename="invoice-${order.orderNumber}.pdf"`,
      },
    });
  } catch (e) {
    return handleError(e);
  }
});
