/**
 * Server-side Cloudinary upload helper.
 *
 * Used by admin endpoints that accept file uploads (banner image, product
 * image). Writing to local disk doesn't work on Vercel — the filesystem is
 * read-only outside `/tmp`, and even `/tmp` is per-invocation. Everything
 * persistent must go to Cloudinary (or an equivalent object store).
 *
 * Reads credentials from CLOUDINARY_URL (cloudinary://<key>:<secret>@<cloud>)
 * which is the same env var the storefront uses for product image redirects.
 */
import { v2 as cloudinary } from 'cloudinary';

let configured = false;
function configure() {
  if (configured) return;
  // CLOUDINARY_URL is parsed automatically by the SDK on first call.
  if (!process.env.CLOUDINARY_URL) {
    throw new Error('CLOUDINARY_URL env var is not set');
  }
  cloudinary.config({ secure: true });
  configured = true;
}

interface UploadOptions {
  /** Cloudinary folder, e.g. "kk-banners" or "kk/<sku>". */
  folder: string;
  /** Suggested public_id prefix (not strict — Cloudinary may suffix it). */
  publicIdPrefix?: string;
  /** Apply standard product/banner transforms on delivery. */
  resourceType?: 'image' | 'auto';
}

export async function uploadBuffer(
  buf: Buffer,
  opts: UploadOptions,
): Promise<{ url: string; publicId: string }> {
  configure();
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      {
        folder: opts.folder,
        public_id: opts.publicIdPrefix,
        resource_type: opts.resourceType ?? 'image',
        overwrite: false,
        unique_filename: true,
      },
      (err, result) => {
        if (err) return reject(err);
        if (!result) return reject(new Error('No result from Cloudinary'));
        resolve({ url: result.secure_url, publicId: result.public_id });
      },
    );
    stream.end(buf);
  });
}
