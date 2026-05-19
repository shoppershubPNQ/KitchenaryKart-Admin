/**
 * POST /api/reels/upload
 *
 * Multipart form upload for Reel videos. Accepts a single `file` field
 * (MP4 / MOV / WebM), ships it to Cloudinary under `kk-reels/` as a
 * video-typed resource, and returns the absolute delivery URL plus an
 * auto-generated poster image URL.
 *
 * Limits chosen to match Instagram Reel output: MP4/MOV/WebM, 60 MB max
 * (covers a 90-second 1080p clip comfortably).
 */
import { NextRequest, NextResponse } from 'next/server';
import path from 'node:path';
import { withAuth } from '@/lib/auth';
import { fail } from '@/lib/api';
import { uploadBuffer } from '@/lib/cloudinary-upload';

const ALLOWED_TYPES = new Set([
  'video/mp4',
  'video/quicktime',
  'video/webm',
  'video/x-m4v',
]);
const MAX_BYTES = 60 * 1024 * 1024; // 60 MB

function safeName(name: string): string {
  const base = path.basename(name).toLowerCase();
  return (
    base
      .replace(/\.[^.]+$/, '')
      .replace(/[^a-z0-9._-]+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '') || 'reel'
  );
}

/** Cloudinary serves a poster JPG for any video by swapping the extension. */
function posterFromVideoUrl(videoUrl: string): string {
  return videoUrl.replace(/\.(mp4|mov|webm|m4v)(?:\?.*)?$/i, '.jpg');
}

export const POST = withAuth(
  async (req: NextRequest) => {
    try {
      const form = await req.formData();
      const file = form.get('file');
      if (!(file instanceof File)) return fail('No file attached', 400);
      if (!ALLOWED_TYPES.has(file.type)) {
        return fail(
          `Unsupported type: ${file.type}. Use MP4, MOV or WebM.`,
          415,
        );
      }
      if (file.size > MAX_BYTES) return fail('File too large (max 60 MB)', 413);

      const buf = Buffer.from(await file.arrayBuffer());
      const stamp = Date.now().toString(36);
      const publicIdPrefix = `${stamp}-${safeName(file.name)}`;

      const { url } = await uploadBuffer(buf, {
        folder: 'kk-reels',
        publicIdPrefix,
        resourceType: 'video',
      });

      return NextResponse.json(
        { videoUrl: url, thumbnailUrl: posterFromVideoUrl(url) },
        { status: 201 },
      );
    } catch (e: any) {
      return fail(e?.message || 'Upload failed', 500);
    }
  },
  ['admin', 'sales', 'staff'],
);
