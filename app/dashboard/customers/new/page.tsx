import { CustomerForm } from '@/components/CustomerForm';

export default function NewCustomerPage() {
  return (
    <div className="max-w-4xl space-y-4">
      <h1 className="text-2xl font-semibold text-slate-900">New customer</h1>
      <CustomerForm isNew initial={{ name: '', email: '', customerType: 'retail', country: 'India' }} />
    </div>
  );
}
