import 'server-only';
import sharp from 'sharp';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import https from 'node:https';
import { createHash } from 'node:crypto';
import { StudioError } from './errors';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
export const MAX_PIXELS = 40_000_000;
export const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];
export function isPublicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 &&
        (b === 0 || b === 168 || b === 2 || (b === 88 && c === 99))) ||
      (a === 198 && (b === 18 || b === 19 || (b === 51 && c === 100))) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const lower = address.toLowerCase();
    // Conservatively allow global unicast, excluding transition/documentation/special ranges.
    if (
      !/^[23][0-9a-f]{3}:/.test(lower) ||
      lower.startsWith('2002:') ||
      lower.startsWith('2001:db8:')
    )
      return false;
    if (
      lower.startsWith('2001:') &&
      parseInt(lower.split(':')[1] || '0', 16) <= 0x1ff
    )
      return false;
    return true;
  }
  return false;
}
export async function publicDestination(
  value: string,
  resolver: (
    host: string,
    options: { all: true },
  ) => Promise<{ address: string; family: number }[]> = lookup,
) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new StudioError('invalid_url', 'Use a valid HTTPS image URL.');
  }
  if (
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    (url.port && url.port !== '443')
  )
    throw new StudioError(
      'unsafe_url',
      'Only public HTTPS image URLs on port 443 are supported.',
    );
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (
    host.toLowerCase() === 'localhost' ||
    host.toLowerCase().endsWith('.local')
  )
    throw new StudioError(
      'unsafe_url',
      'Local addresses cannot be used as news references.',
    );
  const addresses = isIP(host)
    ? [{ address: host, family: isIP(host) }]
    : await resolver(host, { all: true });
  if (
    !addresses.length ||
    addresses.some((item) => !isPublicAddress(item.address))
  )
    throw new StudioError(
      'unsafe_url',
      'The image destination is not a public internet address.',
    );
  return { url, address: addresses[0].address, family: addresses[0].family };
}
async function fetchPinned(
  target: Awaited<ReturnType<typeof publicDestination>>,
): Promise<{ status: number; location?: string; bytes: Buffer }> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      target.url,
      {
        family: target.family,
        lookup: (_host, _options, callback) =>
          callback(null, target.address, target.family),
        headers: {
          'User-Agent': 'L8R-ReferenceFetcher/2.0',
          Accept: 'image/jpeg,image/png,image/webp',
        },
      },
      (res) => {
        const status = res.statusCode || 500;
        if ([301, 302, 303, 307, 308].includes(status)) {
          res.resume();
          resolve({
            status,
            location: res.headers.location,
            bytes: Buffer.alloc(0),
          });
          return;
        }
        if (status !== 200) {
          res.resume();
          reject(
            new StudioError(
              'image_unavailable',
              `The image source returned HTTP ${status}. Choose another reference.`,
              422,
            ),
          );
          return;
        }
        if (Number(res.headers['content-length'] || 0) > MAX_UPLOAD_BYTES) {
          res.destroy();
          reject(
            new StudioError(
              'image_too_large',
              'The source image is larger than 10 MB.',
            ),
          );
          return;
        }
        const chunks: Buffer[] = [];
        let size = 0;
        res.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_UPLOAD_BYTES) {
            res.destroy();
            reject(
              new StudioError(
                'image_too_large',
                'The source image is larger than 10 MB.',
              ),
            );
          } else chunks.push(chunk);
        });
        res.on('error', reject);
        res.on('end', () => resolve({ status, bytes: Buffer.concat(chunks) }));
      },
    );
    request.setTimeout(10_000, () =>
      request.destroy(
        new StudioError(
          'image_timeout',
          'The image source took too long to respond.',
        ),
      ),
    );
    const deadline = setTimeout(
      () =>
        request.destroy(
          new StudioError('image_timeout', 'The image download took too long.'),
        ),
      15_000,
    );
    request.on('close', () => clearTimeout(deadline));
    request.on('error', reject);
  });
}
export async function downloadPublicImage(
  url: string,
  resolve = publicDestination,
  transport = fetchPinned,
): Promise<Buffer> {
  let current = url;
  for (let redirect = 0; redirect <= 3; redirect++) {
    const target = await resolve(current);
    const response = await transport(target);
    if (response.status === 200) return response.bytes;
    if (!response.location || redirect === 3)
      throw new StudioError(
        'redirect_limit',
        'This image has too many redirects.',
      );
    current = new URL(response.location, target.url).toString();
  }
  throw new StudioError(
    'image_unavailable',
    'The image could not be downloaded.',
  );
}
export async function normalizeReference(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_UPLOAD_BYTES)
    throw new StudioError(
      'image_too_large',
      'Upload a JPEG, PNG or WebP image up to 10 MB.',
    );
  try {
    const meta = await sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
      animated: false,
    }).metadata();
    if (
      !['jpeg', 'png', 'webp'].includes(meta.format || '') ||
      !meta.width ||
      !meta.height ||
      (meta.pages || 1) > 1
    )
      throw new Error('format');
    const conditioning = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
      .rotate()
      .resize({
        width: 1536,
        height: 1536,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 90 })
      .toBuffer();
    const normalizedMeta = await sharp(conditioning).metadata();
    return {
      conditioning,
      width: normalizedMeta.width!,
      height: normalizedMeta.height!,
      mimeType: `image/${meta.format}`,
      checksum: createHash('sha256').update(bytes).digest('hex'),
      eligibleForConditioning:
        Math.max(meta.width, meta.height) >= 1000 &&
        Math.min(meta.width, meta.height) >= 384,
    };
  } catch {
    throw new StudioError(
      'invalid_image',
      'The file is not a decodable JPEG, PNG or WebP within the 40-megapixel limit.',
    );
  }
}
export async function prepareOutput(
  bytes: Buffer,
  preset: 'nano-pro-2k' | 'gpt-image-2-high',
) {
  try {
    const meta = await sharp(bytes, {
      limitInputPixels: MAX_PIXELS,
    }).metadata();
    if (!meta.width || !meta.height || Math.max(meta.width, meta.height) < 2048)
      throw new Error('resolution');
    if (
      preset === 'gpt-image-2-high' &&
      (meta.width !== 2048 || meta.height !== 1152)
    )
      throw new Error('resolution');
    if (Math.abs(meta.width / meta.height - 16 / 9) > 0.05)
      throw new Error('ratio');
    const original = await sharp(bytes, { limitInputPixels: MAX_PIXELS })
      .png()
      .toBuffer();
    const delivery = await sharp(original)
      .resize(2048, 1152, {
        fit: 'cover',
        position: 'centre',
        withoutEnlargement: true,
      })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();
    return { original, delivery, width: meta.width, height: meta.height };
  } catch {
    throw new StudioError(
      'invalid_output',
      'The provider output did not match the selected 2K landscape preset. It was not silently upscaled.',
      502,
    );
  }
}
