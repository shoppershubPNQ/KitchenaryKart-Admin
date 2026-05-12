/**
 * POST /api/banners/upload
 *
 * Multipart form upload. Accepts a single `file` field, ships it to
 * Cloudinary under the `kk-banners` folder, and returns the absolute
 * delivery URL.
 *
 * Why Cloudinary instead of writing to disk: Vercel serverless has a
 * read-only filesystem (only `/tmp` is writable and it's per-invocation),
 * and admin+web run as separate Vercel projects — they don't share volumes.
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { withAuth } from '@/lib/auth';
import { fail } from '@/lib/api';
import { uploadBuffer } from '@/lib/cloudinary-upload';

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
    .replace(/\.[^.]+$/, '') // strip extension; Cloudinary infers from buffer
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

    const buf = Buffer.from(await file.arrayBuffer());
    const stamp = Date.now().toString(36);
    const publicIdPrefix = `${stamp}-${safeName(file.name)}`;

    const { url } = await uploadBuffer(buf, {
      folder: 'kk-banners',
      publicIdPrefix,
    });

    return NextResponse.json({ imageUrl: url }, { status: 201 });
  } catch (e: any) {
    return fail(e?.message || 'Upload failed', 500);
  }
}, ['admin', 'sales', 'staff']);
