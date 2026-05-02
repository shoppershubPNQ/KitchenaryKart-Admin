/**
 * POST /api/banners/upload
 *
 * Multipart form upload. Accepts a single `file` field, writes it to the
 * web storefront's `public/banners/` folder (so the image is served directly
 * by Next.js at `/banners/<filename>`), and returns the public path.
 *
 * The web project is resolved from the admin's cwd — both live side-by-side
 * under `C-code/`, so `../web/public/banners/` is always the right folder.
 */
import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { withAuth } from '@/lib/auth';
import { fail } from '@/lib/api';

const WEB_PUBLIC = path.resolve(process.cwd(), '..', 'web', 'public', 'banners');

const ALLOWED_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
]);
const MAX_BYTES = 8 * 1024 * 1024; // 8 MB

function safeName(name: string): string {
  const base = path.basename(name).toLowerCase();
  return base
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'banner';
}

export const POST = withAuth(async (req: NextRequest) => {
  try {
    const form = await req.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return fail('No file attached', 400);
    if (!ALLOWED_TYPES.has(file.type)) {
      return fail(`Unsupported type: ${file.type}. Use JPG, PNG, WEBP or GIF.`, 415);
    }
    if (file.size > MAX_BYTES) return fail('File too large (max 8 MB)', 413);

    await mkdir(WEB_PUBLIC, { recursive: true });

    const ext = path.extname(file.name) || '.jpg';
    const stamp = Date.now().toString(36);
    const filename = `${stamp}-${safeName(path.basename(file.name, ext))}${ext.toLowerCase()}`;
    const full = path.join(WEB_PUBLIC, filename);

    const bytes = Buffer.from(await file.arrayBuffer());
    await writeFile(full, bytes);

    return NextResponse.json({ imageUrl: `/banners/${filename}` }, { status: 201 });
  } catch (e: any) {
    return fail(e?.message || 'Upload failed', 500);
  }
}, ['admin', 'sales', 'staff']);
