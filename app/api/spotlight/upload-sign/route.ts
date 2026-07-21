/**
 * POST /api/spotlight/upload-sign
 *
 * Signed Cloudinary payload so the browser uploads the spotlight video DIRECTLY
 * to Cloudinary, bypassing Vercel's 4.5 MB function body limit (same reason as
 * the reels signer). Response: { cloudName, apiKey, timestamp, folder,
 * signature, uploadUrl }.
 */
import { NextResponse } from 'next/server';
import { v2 as cloudinary } from 'cloudinary';
import { withAuth } from '@/lib/auth';
import { fail } from '@/lib/api';

let configured = false;
function configure() {
  if (configured) return;
  if (!process.env.CLOUDINARY_URL) throw new Error('CLOUDINARY_URL env var is not set');
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
      const folder = 'kk-spotlight';
      const signature = cloudinary.utils.api_sign_request({ timestamp, folder }, config.api_secret);
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
