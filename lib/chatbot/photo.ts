/**
 * Customer photos in the website chat - pure checks, SERVER ONLY (Buffer).
 *
 * The widget shrinks the photo in the browser (long side <= 1024 px, JPEG,
 * about 300 KB) and sends it as base64 with the message. The route never
 * trusts that: the media type must be on the allow-list, the bytes must
 * start with that format's signature, the size and pixel dimensions must be
 * within the caps below, and the stored base64 is re-encoded from the decoded
 * bytes. Nothing here decodes pixels (no native image library on the route),
 * so a file with a valid header but broken image data can still reach Claude:
 * turn.ts answers Claude's 400 on such a photo with photo_invalid and keeps
 * the chat open.
 *
 * Storage: the photo is stored as a base64 image block inside the customer
 * row's `content` in chat_messages (append-only history, replayed byte for
 * byte), not through the Files API - see the notes in public-chat.ts.
 *
 * No imports: pure functions, testable without a database.
 */

export const PHOTO_MEDIA_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;
export type PhotoMediaType = (typeof PHOTO_MEDIA_TYPES)[number];
export const isPhotoMediaType = (v: unknown): v is PhotoMediaType =>
  typeof v === 'string' && (PHOTO_MEDIA_TYPES as readonly string[]).includes(v);

/** Decoded bytes per photo: exactly the contract's limit (the widget aims for
 *  < 300 KB and never sends more than 400,000 - web/components/chat-photo.ts
 *  PHOTO_MAX_BYTES). */
export const MAX_PHOTO_BYTES = 400_000;
/** Base64 characters for MAX_PHOTO_BYTES. */
export const MAX_PHOTO_B64_CHARS = Math.ceil(MAX_PHOTO_BYTES / 3) * 4;
/** Request body with a photo: the base64 plus the usual 8,000-byte message
 *  body and the SKU hints. Vercel's own limit (~4.5 MB) is far above this. */
export const MAX_PHOTO_BODY_BYTES = MAX_PHOTO_B64_CHARS + 16_000;
/** Each side, and the whole picture. The widget sends a long side of at most
 *  1024 px (chat-photo.ts fit() rounds w * r, so never more); 1100 leaves a
 *  little slack, and the area cap keeps a photo at about 1024 x 1024 pixels.
 *  At about ceil(w/28) x ceil(h/28) image tokens that is at most ~1,400 tokens
 *  per photo, whatever a direct API caller sends - the figure models.ts uses
 *  for TURN_COST_RESERVE_USD. (The API itself accepts much larger images.) */
export const MAX_PHOTO_SIDE = 1100;
export const MAX_PHOTO_PIXELS = 1024 * 1024;
export const MIN_PHOTO_SIDE = 16;
/** Photo-search hints used per photo. */
export const MAX_PHOTO_HINTS = 8;

/** Accepted SKU shapes for a hint (the photo index uses letters, digits and
 *  ( ) . + / _ -, e.g. KKPB0060-H1/1-WBWOL, KKHE0141-288(C06)). */
export const HINT_SKU_RE = /^[A-Za-z0-9][A-Za-z0-9().+\/_-]{0,79}$/;

/** Strict base64 (standard alphabet, padded). */
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

/** Format from the first bytes, or null. */
export function sniffImageType(buf: Uint8Array): PhotoMediaType | null {
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (buf.length >= 8 && PNG.every((b, i) => buf[i] === b)) return 'image/png';
  const ascii = (from: number, to: number) => String.fromCharCode(...buf.subarray(from, to));
  if (buf.length >= 16 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'image/webp';
  return null;
}

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + ((b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]);

function pngSize(b: Uint8Array): { width: number; height: number } | null {
  // Signature (8) + IHDR length (4) + "IHDR" (4) + width (4) + height (4).
  if (b.length < 24 || String.fromCharCode(...b.subarray(12, 16)) !== 'IHDR') return null;
  return { width: u32be(b, 16), height: u32be(b, 20) };
}

function jpegSize(b: Uint8Array): { width: number; height: number } | null {
  let i = 2; // after SOI
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) return null;
    let marker = b[i + 1];
    // Fill bytes.
    while (marker === 0xff && i + 2 < b.length) {
      i++;
      marker = b[i + 1];
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2; // no length
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return null; // EOI / SOS before any frame header
    if (i + 3 >= b.length) return null;
    const len = u16be(b, i + 2);
    if (len < 2) return null;
    // SOF0-SOF15, except DHT (C4), JPG (C8) and DAC (CC).
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 8 >= b.length) return null;
      return { height: u16be(b, i + 5), width: u16be(b, i + 7) };
    }
    i += 2 + len;
  }
  return null;
}

function webpSize(b: Uint8Array): { width: number; height: number } | null {
  if (b.length < 30) return null;
  const chunk = String.fromCharCode(...b.subarray(12, 16));
  if (chunk === 'VP8 ') {
    // Frame tag (3) then start code 9d 01 2a, then 14-bit width / height.
    if (b[23] !== 0x9d || b[24] !== 0x01 || b[25] !== 0x2a) return null;
    return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
  }
  if (chunk === 'VP8L') {
    if (b[20] !== 0x2f) return null;
    const b0 = b[21];
    const b1 = b[22];
    const b2 = b[23];
    const b3 = b[24];
    return { width: 1 + (((b1 & 0x3f) << 8) | b0), height: 1 + (((b3 & 0x0f) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)) };
  }
  if (chunk === 'VP8X') return { width: 1 + u24le(b, 24), height: 1 + u24le(b, 27) };
  return null;
}

/** Pixel size from the file header, or null when it cannot be read. */
export function imageSize(buf: Uint8Array, type: PhotoMediaType): { width: number; height: number } | null {
  if (type === 'image/png') return pngSize(buf);
  if (type === 'image/jpeg') return jpegSize(buf);
  return webpSize(buf);
}

export interface CheckedPhoto {
  mediaType: PhotoMediaType;
  /** Canonical base64 of the decoded bytes (what is sent to Claude and stored). */
  data: string;
  bytes: number;
  width: number;
  height: number;
}

export type PhotoCheck = { ok: true; photo: CheckedPhoto } | { ok: false; reason: string };

/**
 * Validate a photo from the widget. `reason` is for the server log only (no
 * customer data); the customer sees the fixed photo_invalid text.
 */
export function checkPhoto(mediaType: string, data: string): PhotoCheck {
  if (!isPhotoMediaType(mediaType)) return { ok: false, reason: 'media type not allowed' };
  if (typeof data !== 'string' || data.length < 16) return { ok: false, reason: 'empty' };
  if (data.length > MAX_PHOTO_B64_CHARS) return { ok: false, reason: 'too large' };
  if (data.length % 4 !== 0 || !B64_RE.test(data)) return { ok: false, reason: 'not base64' };
  const buf = Buffer.from(data, 'base64');
  if (buf.length === 0 || buf.length > MAX_PHOTO_BYTES) return { ok: false, reason: 'too large' };
  const sniffed = sniffImageType(buf);
  if (!sniffed) return { ok: false, reason: 'not an image' };
  if (sniffed !== mediaType) return { ok: false, reason: `bytes are ${sniffed}, declared ${mediaType}` };
  const size = imageSize(buf, sniffed);
  if (!size) return { ok: false, reason: 'unreadable header' };
  const { width, height } = size;
  if (
    width < MIN_PHOTO_SIDE ||
    height < MIN_PHOTO_SIDE ||
    width > MAX_PHOTO_SIDE ||
    height > MAX_PHOTO_SIDE ||
    width * height > MAX_PHOTO_PIXELS
  ) {
    return { ok: false, reason: `size ${width}x${height} out of range` };
  }
  return { ok: true, photo: { mediaType: sniffed, data: buf.toString('base64'), bytes: buf.length, width, height } };
}

/** Clean the widget's photo-search SKUs: trimmed, allowed shape, unique, in order, at most MAX_PHOTO_HINTS. */
export function cleanHintSkus(raw: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const r of raw ?? []) {
    const s = String(r).trim();
    if (!HINT_SKU_RE.test(s) || out.includes(s)) continue;
    out.push(s);
    if (out.length >= MAX_PHOTO_HINTS) break;
  }
  return out;
}

/** Metadata kept on the customer row (chat_messages.tool_calls, jsonb) for the
 *  admin log and the per-chat photo count (store.ts counts rows whose
 *  tool_calls has a "photo" key). Never the image itself. */
export interface CustomerPhotoMeta {
  photo: { mediaType: PhotoMediaType; bytes: number; width: number; height: number };
  /** SKUs the widget's photo search sent / the ones that are active products. */
  photoHints: { sent: number; used: string[] };
}

export function isCustomerPhotoMeta(v: unknown): v is CustomerPhotoMeta {
  const p = (v as { photo?: unknown } | null)?.photo as Record<string, unknown> | undefined;
  return !!p && typeof p === 'object' && isPhotoMediaType(p.mediaType);
}

/** The first base64 image block of a stored customer row's content, re-checked
 *  (magic bytes must match the stored type). Null for anything else - including
 *  a block whose data a future retention clean-up has replaced with a stub, so
 *  the admin photo route then answers 404. */
export function storedPhoto(content: unknown): { mediaType: PhotoMediaType; bytes: Buffer } | null {
  if (!Array.isArray(content)) return null;
  for (const b of content as Array<Record<string, unknown>>) {
    if (b?.type !== 'image') continue;
    const src = b.source as Record<string, unknown> | undefined;
    if (src?.type !== 'base64' || typeof src.data !== 'string' || !isPhotoMediaType(src.media_type)) continue;
    const buf = Buffer.from(src.data, 'base64');
    if (sniffImageType(buf) !== src.media_type) continue;
    return { mediaType: src.media_type, bytes: buf };
  }
  return null;
}
