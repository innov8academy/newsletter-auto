'use client';
/* Private signed URLs bypass the public Next image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { useState } from 'react';
import { ExternalLink, RefreshCw } from 'lucide-react';
import type { StudioAsset } from '@/lib/studio/types';
import { studioApi } from './client-api';

export default function AssetPreview({
  asset,
  className = 'h-28 w-full',
  enlarge = true,
}: {
  asset: StudioAsset;
  className?: string;
  enlarge?: boolean;
}) {
  const [refreshed, setRefreshed] = useState<{
    source: string | undefined;
    id: string;
    url: string;
  } | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const url =
    refreshed?.id === asset.id && refreshed.source === asset.previewUrl
      ? refreshed.url
      : asset.previewUrl || '';
  const failed = failedUrl === url;
  async function refresh(open = false) {
    try {
      const result = await studioApi<{ asset: StudioAsset }>(
        `assets/${asset.id}`,
      );
      setRefreshed({
        source: asset.previewUrl,
        id: asset.id,
        url: result.asset.previewUrl || '',
      });
      setFailedUrl(null);
      if (open && result.asset.previewUrl)
        window.open(result.asset.previewUrl, '_blank', 'noopener,noreferrer');
    } catch {
      setFailedUrl(url);
    }
  }
  return (
    <div
      className={`relative overflow-hidden rounded-lg bg-white/5 ${className}`}
    >
      {url && !failed ? (
        <img
          src={url}
          alt={asset.name}
          className="h-full w-full object-contain"
          onError={() => setFailedUrl(url)}
        />
      ) : (
        <button
          type="button"
          onClick={() => void refresh()}
          className="flex h-full w-full items-center justify-center gap-2 p-3 text-xs text-white/60"
        >
          <RefreshCw size={14} />
          {failed ? 'Preview unavailable · retry' : 'Load preview'}
        </button>
      )}
      {url && !failed && enlarge && (
        <button
          type="button"
          aria-label={`Enlarge ${asset.name}`}
          onClick={() => void refresh(true)}
          className="absolute right-1 top-1 rounded bg-black/70 p-1.5 text-white hover:bg-purple-700"
        >
          <ExternalLink size={12} />
        </button>
      )}
    </div>
  );
}
