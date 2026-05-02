import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { CustomerForm } from '@/components/CustomerForm';
import { dateShort } from '@/lib/fetch';

export default async function EditCustomerPage({ params }: { params: { id: string } }) {
  const id = parseInt(params.id);
  if (Number.isNaN(id)) notFound();
  const c = await prisma.customer.findUnique({
    where: { id },
    include: {
      orders: {
        orderBy: { createdAt: 'desc' },
        take: 25,
        select: { id: true, orderNumber: true, orderStatus: true, totalAmount: true, createdAt: true },
      },
    },
  });
  if (!c) notFound();

  return (
    <div className="max-w-4xl space-y-6">
      <div>
        <div className="text-sm text-slate-500">Customer</div>
        <h1 className="text-2xl font-semibold text-slate-900">{c.name}</h1>
      </div>
      <CustomerForm
        isNew={false}
        initial={{
          id: c.id,
          name: c.name,
          email: c.email,
          phone: c.phone,
          companyName: c.companyName,
          customerType: c.customerType as any,
          billingAddress: c.billingAddress,
          shippingAddress: c.shippingAddress,
          city: c.city, state: c.state, postalCode: c.postalCode, country: c.country,
          gstNumber: c.gstNumber,
          creditLimit: Number(c.creditLimit),
        }}
      />

      <div className="card">
        <div className="px-4 py-3 border-b border-slate-200 font-semibold">Order history ({c.orders.length})</div>
        {c.orders.length === 0 && <div className="p-6 text-slate-400 text-sm">No orders.</div>}
        {c.orders.length > 0 && (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs text-slate-500 uppercase">
              <tr><th className="px-4 py-2 text-left">Order #</th><th className="px-4 py-2 text-left">Date</th><th className="px-4 py-2 text-left">Status</th><th className="px-4 py-2 text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {c.orders.map(o => (
                <tr key={o.id}>
                  <td className="px-4 py-2 font-mono text-xs"><Link className="text-brand hover:underline" href={`/dashboard/orders/${o.id}`}>{o.orderNumber}</Link></td>
                  <td className="px-4 py-2">{dateShort(o.createdAt)}</td>
                  <td className="px-4 py-2">{o.orderStatus}</td>
                  <td className="px-4 py-2 text-right">₹{Number(o.totalAmount || 0).toLocaleString('en-IN')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
