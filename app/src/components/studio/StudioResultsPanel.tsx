'use client';
/* Private signed URLs intentionally bypass Next's public image optimizer. */
/* eslint-disable @next/next/no-img-element */
import { Image as ImageIcon, Loader2, Check, Download } from 'lucide-react';
import { PRESETS } from '@/lib/studio/models';
import type { StudioController } from './useStudioController';
import AssetPreview from './AssetPreview';
import { buttonClass, fieldClass, primaryClass } from './client-api';
export default function StudioResultsPanel({
  studio,
}: {
  studio: StudioController;
}) {
  const {
    draft,
    storyId,
    work,
    assets,
    generations,
    busy,
    conflict,
    editInstruction,
    pendingId,
    setNotice,
    setPendingId,
    setPreviewId,
    setEditInstruction,
    task,
    generate,
    selectRun,
    download,
    shownRun,
    shownAsset,
    canGenerate,
  } = studio;
  if (!work) return null;
  return (
    <section className="min-w-0 space-y-4">
      <div className="overflow-hidden rounded-xl border border-white/10 bg-black/30 p-2">
        {shownAsset ? (
          <AssetPreview
            key={shownAsset.id}
            asset={shownAsset}
            className="aspect-video w-full"
          />
        ) : (
          <div className="flex aspect-video items-center justify-center p-8 text-center text-white/30">
            <div>
              {pendingId || shownRun?.status === 'running' ? (
                <>
                  <Loader2 className="mx-auto mb-3 animate-spin" />
                  <p>
                    Generation in progress. Saved status is checked
                    automatically.
                  </p>
                </>
              ) : (
                <>
                  <ImageIcon size={48} className="mx-auto mb-3 opacity-30" />
                  <p>Your generated image appears here.</p>
                </>
              )}
            </div>
          </div>
        )}
      </div>
      {pendingId && !generations.some((run) => run.id === pendingId) && (
        <div className="rounded-lg border border-amber-400/20 p-3 text-xs text-white/55">
          Waiting for request {pendingId.slice(0, 8)} to be recorded. A refresh
          will not resubmit it.
          <button
            className={`${buttonClass} mt-2 w-full text-xs`}
            disabled={!!busy}
            onClick={() => {
              if (draft)
                localStorage.removeItem(
                  `studio_pending_${draft.id}_${storyId}`,
                );
              setPendingId(null);
              setNotice(
                'Pending display dismissed. Check provider history before requesting another image.',
              );
            }}
          >
            Dismiss pending display after checking provider history
          </button>
        </div>
      )}
      {shownRun && (
        <div className="rounded-xl border border-white/10 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm">{PRESETS[shownRun.presetId].name}</p>
              <p className="mt-1 text-xs text-white/45">
                {shownRun.status} ·{' '}
                {assets.find((a) => a.id === shownRun.originalAssetId)?.width ||
                  '—'}
                ×
                {assets.find((a) => a.id === shownRun.originalAssetId)
                  ?.height || '—'}{' '}
                original · {new Date(shownRun.startedAt).toLocaleString()}
              </p>
            </div>
            <span className="text-sm text-white/60">
              $
              {shownRun.costs
                .reduce((sum, receipt) => sum + (receipt.amountUsd || 0), 0)
                .toFixed(4)}
              {shownRun.costs.some((c) => c.amountUsd === null)
                ? ' + unknown'
                : ''}
            </span>
          </div>
          {shownRun.error && (
            <p className="mt-3 text-sm text-rose-200">{shownRun.error}</p>
          )}
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              className={primaryClass}
              disabled={!!busy || conflict || shownRun.status !== 'complete'}
              onClick={() =>
                void task('Selecting newsletter image', () =>
                  selectRun(shownRun),
                )
              }
            >
              <Check size={14} />
              {work.selectedGenerationId === shownRun.id
                ? 'Selected for newsletter'
                : 'Use this image'}
            </button>
            {shownRun.originalAssetId && (
              <button
                className={buttonClass}
                onClick={() =>
                  void task('Opening original download', () =>
                    download(shownRun.originalAssetId!),
                  )
                }
              >
                <Download size={14} />
                Original
              </button>
            )}
            {shownRun.deliveryAssetId && (
              <button
                className={buttonClass}
                onClick={() =>
                  void task('Opening delivery download', () =>
                    download(shownRun.deliveryAssetId!),
                  )
                }
              >
                <Download size={14} />
                2048×1152 delivery
              </button>
            )}
          </div>
          <details className="mt-3 text-xs text-white/45">
            <summary className="cursor-pointer">
              Request and references used
            </summary>
            <p className="mt-2 break-all">
              {shownRun.model} · {shownRun.provider}
            </p>
            <ol className="mt-2 list-inside list-decimal">
              {shownRun.references.map((ref) => (
                <li key={ref.id}>
                  {ref.role} — {ref.name.split(' · ')[0]}
                </li>
              ))}
            </ol>
          </details>
          {shownRun.quality && (
            <div className="mt-4 border-t border-white/10 pt-3">
              <h3 className="text-sm text-white/75">Visual check · advisory</h3>
              {shownRun.quality.scores && (
                <p className="mt-2 text-xs text-white/50">
                  Relevance {shownRun.quality.scores.relevance}/5 · Fidelity{' '}
                  {shownRun.quality.scores.fidelity}/5 · Style{' '}
                  {shownRun.quality.scores.style}/5 · Readability{' '}
                  {shownRun.quality.scores.readability}
                  /5
                </p>
              )}
              <ul className="mt-2 list-inside list-disc text-sm text-white/60">
                {shownRun.quality.findings.map((finding, index) => (
                  <li key={index}>{finding}</li>
                ))}
              </ul>
              {shownRun.quality.suggestedEdit && (
                <button
                  className={`${buttonClass} mt-2 text-xs`}
                  onClick={() =>
                    setEditInstruction(shownRun.quality!.suggestedEdit)
                  }
                >
                  Use suggested refinement
                </button>
              )}
            </div>
          )}
        </div>
      )}
      {shownRun?.status === 'complete' && (
        <div className="rounded-xl border border-white/10 p-4">
          <label className="text-sm font-medium">
            Refine this image
            <textarea
              className={`${fieldClass} mt-2 min-h-20`}
              disabled={!!busy || conflict}
              value={editInstruction}
              onChange={(e) => setEditInstruction(e.target.value)}
              placeholder="Describe only what should change. Everything else should be preserved."
            />
          </label>
          <button
            className={`${buttonClass} mt-3`}
            disabled={
              !!busy || !canGenerate || !editInstruction.trim() || !!pendingId
            }
            onClick={() =>
              void task('Generating refinement', () => generate('edit'))
            }
          >
            Create refinement · one new image
          </button>
          <p className="mt-2 text-xs text-white/40">
            The current image remains in history.
          </p>
        </div>
      )}
      {generations.length > 0 && (
        <section
          aria-label="Image history"
          className="rounded-xl border border-white/10 p-4"
        >
          <h3 className="mb-3 text-sm font-medium">Image history</h3>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {generations.map((run) => {
              const asset = assets.find(
                (item) =>
                  item.id === (run.deliveryAssetId || run.originalAssetId),
              );
              return (
                <button
                  key={run.id}
                  className={`overflow-hidden rounded-lg border p-1 text-left ${shownRun?.id === run.id ? 'border-purple-400' : 'border-white/10'}`}
                  aria-label={`Preview ${PRESETS[run.presetId].name} from ${new Date(run.startedAt).toLocaleTimeString()}`}
                  onClick={() => setPreviewId(run.id)}
                >
                  {asset?.previewUrl ? (
                    <img
                      src={asset.previewUrl}
                      alt={run.plan?.altText || 'Saved generation'}
                      className="aspect-video w-full object-contain"
                    />
                  ) : (
                    <span className="flex aspect-video items-center justify-center text-xs text-white/40">
                      {run.status}
                    </span>
                  )}
                  <span className="mt-1 block px-1 text-[10px] text-white/50">
                    {run.operation} · {run.status}
                    {work.selectedGenerationId === run.id ? ' · selected' : ''}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
}
