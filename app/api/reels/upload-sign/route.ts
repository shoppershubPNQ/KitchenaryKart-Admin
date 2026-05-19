/**
 * POST /api/reels/upload-sign
 *
 * Returns a signed Cloudinary upload payload so the browser can upload the
 * raw video file directly to Cloudinary, bypassing Vercel's 4.5 MB function
 * body limit.
 *
 * Why direct-to-Cloudinary: Reels are typically 5-60 MB. A "server-side"
 * upload (browser → our /api/reels/upload → Cloudinary) hits Vercel's
 * platform-level FUNCTION_PAYLOAD_TOO_LARGE error at 4.5 MB. The signed-URL
 * pattern moves the file transfer out of our serverless path entirely while
 * keeping our credentials secret.
 *
 * Response shape:
 *   {
 *     cloudName, apiKey, timestamp, folder, signature, uploadUrl
 *   }
 * The browser builds a FormData with these fields + the file and POSTs to
 * `uploadUrl`. Cloudinary verifies the signature server-to-server before
 * accepting the file.
 */
import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { withAuth } from '@/lib/auth';
import { fail } from '@/lib/api';

let configured = false;
function configure() {
  if (configured) return;
  if (!process.env.CLOUDINARY_URL) {
    throw new Error('CLOUDINARY_URL env var is not set');
  }
  cloudinary.config({ secure: true });
  configured = true;
}

export const POST = withAuth(
  async () => {
    try {
      configure();
      const config = cloudinary.config();
      if (!config.cloud_name || !config.api_key || !config.api_secret) {
        return fail('Cloudinary credentials not parsed from CLOUDINARY_URL', 500);
      }

      const timestamp = Math.round(Date.now() / 1000);
      const folder = 'kk-reels';

      // Sign exactly the params we're going to upload with. The browser must
      // include the same params in the upload request or Cloudinary rejects
      // the signature.
      const signature = cloudinary.utils.api_sign_request(
        { timestamp, folder },
        config.api_secret,
      );

      return NextResponse.json({
        cloudName: config.cloud_name,
        apiKey: config.api_key,
        timestamp,
        folder,
        signature,
        uploadUrl: `https://api.cloudinary.com/v1_1/${config.cloud_name}/video/upload`,
      });
    } catch (e: any) {
      return fail(e?.message || 'Sign failed', 500);
    }
  },
  ['admin', 'sales', 'staff'],
);
