'use client';
import type { StudioAsset } from '@/lib/studio/types';

export class StudioClientError extends Error {
  constructor(
    message: string,
    public code: string,
    public status: number,
  ) {
    super(message);
  }
}
export async function studioApi<T>(
  path: string,
  method = 'GET',
  body?: unknown,
): Promise<T> {
  const response = await fetch(`/api/studio/${path}`, {
    method,
    headers:
      body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: 'no-store',
  });
  const data = await response.json().catch(() => ({
    error:
      'The server connection ended. Refresh to check saved run status before retrying.',
    code: 'connection_ended',
  }));
  if (!response.ok || data.success === false)
    throw new StudioClientError(
      data.error || 'Studio request failed.',
      data.code || 'studio_error',
      response.status,
    );
  return data as T;
}
export async function downloadStudioAsset(assetId: string): Promise<void> {
  // Request a fresh attachment URL; the displayed preview may have expired.
  const { asset } = await studioApi<{ asset: StudioAsset }>(
    `assets/${encodeURIComponent(assetId)}?download=1`,
  );
  let url: URL;
  try {
    url = new URL(asset?.previewUrl || '');
    if (!['https:', 'http:'].includes(url.protocol)) throw new Error();
  } catch {
    throw new Error('The image download link is unavailable. Please try again.');
  }
  const anchor = document.createElement('a');
  anchor.href = url.href;
  anchor.download = `${asset.id}.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`;
  anchor.referrerPolicy = 'no-referrer';
  anchor.click();
}
export async function uploadReference(
  file: File,
  role: 'subject' | 'style',
  draftId: string | null,
): Promise<StudioAsset> {
  const ticket = await studioApi<{ assetId: string; signedUrl: string }>(
    'references/uploads',
    'POST',
    { draftId, role, name: file.name, size: file.size, mimeType: file.type },
  );
  const upload = await fetch(ticket.signedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type, 'x-upsert': 'false' },
    body: file,
  });
  if (!upload.ok)
    throw new Error(
      `Could not upload ${file.name}. The original file is unchanged.`,
    );
  return (
    await studioApi<{ asset: StudioAsset }>('references/finalize', 'POST', {
      assetId: ticket.assetId,
    })
  ).asset;
}
export const buttonClass =
  'inline-flex items-center justify-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm font-medium text-white/85 transition hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-purple-400';
export const primaryClass = `${buttonClass} border-purple-500/60 bg-purple-600 hover:bg-purple-500 text-white`;
export const fieldClass =
  'w-full rounded-lg border border-white/15 bg-black/25 px-3 py-2 text-sm text-white placeholder:text-white/35 focus:border-purple-400 focus:outline-none disabled:opacity-50';
export function saveJsonFile(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
