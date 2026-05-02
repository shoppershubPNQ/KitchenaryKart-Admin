import { prisma } from '@/lib/db';
import { withAuth } from '@/lib/auth';
import { handleError, ok } from '@/lib/api';

export const GET = withAuth(async () => {
  try {
    const categories = await prisma.category.findMany({ orderBy: { name: 'asc' } });
    return ok({ categories });
  } catch (e) {
    return handleError(e);
  }
});
