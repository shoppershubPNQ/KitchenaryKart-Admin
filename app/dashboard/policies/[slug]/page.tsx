import Link from 'next/link';
import { notFound } from 'next/navigation';
import { prisma } from '@/lib/db';
import { PolicyEditor } from '@/components/PolicyEditor';

export default async function EditPolicyPage({
  params,
}: {
  params: { slug: string };
}) {
  const policy = await prisma.policy.findUnique({ where: { slug: params.slug } });
  if (!policy) notFound();

  return (
    <div className="space-y-4 max-w-4xl">
      <div>
        <Link href="/dashboard/policies" className="text-xs text-slate-500 hover:text-brand">
          ← Back to policies
        </Link>
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl font-semibold text-slate-900">{policy.title}</h1>
          <code className="text-xs text-slate-400">/policy/{policy.slug}</code>
        </div>
      </div>

      <PolicyEditor
        initial={{
          slug: policy.slug,
          title: policy.title,
          body: policy.body,
          isActive: policy.isActive,
          position: policy.position,
        }}
      />
    </div>
  );
}
