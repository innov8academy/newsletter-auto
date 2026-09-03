'use client';
/* Signed private URLs and source thumbnails intentionally bypass Next's image optimizer. */
/* eslint-disable @next/next/no-img-element */
import {
  Search,
  X,
  Plus,
  Sparkles,
  Loader2,
  Image as ImageIcon,
} from 'lucide-react';
import { PRESETS } from '@/lib/studio/models';
import type { PresetId } from '@/lib/studio/types';
import type { StudioController } from './useStudioController';
import AssetPreview from './AssetPreview';
import { buttonClass, fieldClass, primaryClass } from './client-api';
export default function StudioPromptPanel({
  studio,
}: {
  studio: StudioController;
}) {
  const {
    caps,
    styles,
    work,
    assets,
    styleAssets,
    candidates,
    brokenWeb,
    busy,
    conflict,
    pendingId,
    setLibraryOpen,
    setBrokenWeb,
    task,
    edit,
    prepare,
    generate,
    keepManual,
    search,
    addNewsReference,
    uploadSubjects,
    changeReferenceRole,
    story,
    stale,
    manualStale,
    canGenerate,
  } = studio;
  if (!work || !story) return null;
  return (
    <section className="min-w-0 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <details className="mb-4 rounded-lg bg-white/5 p-3 text-sm">
        <summary className="cursor-pointer text-white/70">
          Story context
        </summary>
        <div className="mt-3 space-y-2 text-white/55">
          <p>{story.hookParagraph}</p>
          <ul className="list-inside list-disc">
            {story.bulletPoints.map((point, index) => (
              <li key={index}>{point}</li>
            ))}
          </ul>
          <p>{story.whyItMatters}</p>
          <p>{story.l8rsTake}</p>
        </div>
      </details>
      <fieldset disabled={!!busy || conflict}>
        <label className="mb-4 block text-sm font-medium">
          Your direction
          <textarea
            className={`${fieldClass} mt-2 min-h-24`}
            placeholder="What should this image communicate? Add a scene, visual metaphor, or specific subject instruction."
            value={work.direction}
            onChange={(e) => edit({ direction: e.target.value })}
          />
        </label>
        <label className="mb-3 block text-sm font-medium">
          Visual style
          <select
            className={`${fieldClass} mt-2`}
            value={
              work.stylePackId || (work.styleDisabled ? '' : 'unconfigured')
            }
            onChange={(e) =>
              edit({
                stylePackId: e.target.value || null,
                styleDisabled: !e.target.value,
              })
            }
          >
            {!work.stylePackId && !work.styleDisabled && (
              <option value="unconfigured" disabled>
                Style not configured
              </option>
            )}
            <option value="">None — no style conditioning</option>
            {styles.map((style) => (
              <option key={style.id} value={style.id}>
                {style.name} · v{style.version}
              </option>
            ))}
          </select>
        </label>
      </fieldset>
      {!styles.length && (
        <button
          className={`${buttonClass} mb-4 w-full`}
          disabled={!!busy}
          onClick={() => setLibraryOpen(true)}
        >
          Install the supplied L8R style pack
        </button>
      )}
      {work.stylePackId && (
        <div className="mb-4">
          <p className="mb-2 text-xs text-white/45">
            Selected style references · sent in this order
          </p>
          <div className="grid grid-cols-3 gap-2">
            {(styles.find((p) => p.id === work.stylePackId)?.anchorIds || [])
              .flatMap((id) => {
                const asset = styleAssets.find((item) => item.id === id);
                return asset ? [asset] : [];
              })
              .slice(0, 3)
              .map((asset) => (
                <AssetPreview
                  key={asset.id}
                  asset={asset}
                  className="h-16 w-full"
                />
              ))}
          </div>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">News and subject references</h3>
        <button
          className={buttonClass}
          disabled={
            !!busy ||
            !caps?.search.configured ||
            !caps?.planner.configured ||
            conflict
          }
          onClick={() => void task('Finding relevant images', search)}
        >
          <Search size={14} />
          Find from web
        </button>
      </div>
      {!caps?.search.configured && (
        <p className="mb-3 text-xs text-amber-100/60">
          Web image search needs Serper or Brave configured on the server.
        </p>
      )}
      {candidates.length > 0 && (
        <div className="mb-4 grid max-h-80 grid-cols-2 gap-2 overflow-y-auto">
          {candidates.map((candidate) => (
            <article
              key={candidate.url}
              className="rounded-lg border border-teal-400/20 p-2"
            >
              <a
                href={candidate.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Enlarge ${candidate.title}`}
                className="block h-24 bg-white/5"
              >
                {brokenWeb.has(candidate.url) ? (
                  <span className="flex h-full items-center justify-center text-xs text-rose-200">
                    Preview unavailable
                  </span>
                ) : (
                  <img
                    src={
                      candidate.thumbnail.startsWith('https:')
                        ? candidate.thumbnail
                        : candidate.url
                    }
                    alt={candidate.title}
                    className="h-full w-full object-contain"
                    onError={() =>
                      setBrokenWeb((old) => new Set([...old, candidate.url]))
                    }
                  />
                )}
              </a>
              <p className="mt-2 line-clamp-2 text-xs text-white/70">
                {candidate.title}
              </p>
              {candidate.sourcePageUrl && (
                <a
                  href={candidate.sourcePageUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[11px] text-teal-300 hover:underline"
                >
                  {candidate.source || 'Source page'}
                </a>
              )}
              <button
                className={`${buttonClass} mt-2 w-full py-1 text-xs`}
                disabled={
                  !!busy ||
                  conflict ||
                  work.references.filter((r) => r.role === 'news').length >= 3
                }
                onClick={() =>
                  void task('Adding news reference', () =>
                    addNewsReference(candidate),
                  )
                }
              >
                Use as news reference
              </button>
            </article>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {work.references.map((ref, index) => {
          const asset = assets.find((a) => a.id === ref.assetId);
          return (
            <article
              key={ref.assetId}
              className="rounded-lg border border-white/10 p-2"
            >
              <div className="flex gap-3">
                {asset ? (
                  <AssetPreview asset={asset} className="h-20 w-24 shrink-0" />
                ) : (
                  <div className="flex h-20 w-24 items-center justify-center text-xs text-rose-300">
                    Reference unavailable
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-1 text-xs text-white/60">
                    {asset?.name || ref.assetId}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <select
                      aria-label={`Role for reference ${index + 1}`}
                      className={fieldClass}
                      disabled={!!busy || conflict}
                      value={ref.role}
                      onChange={(e) =>
                        changeReferenceRole(
                          index,
                          e.target.value as 'news' | 'subject',
                        )
                      }
                    >
                      <option value="news">News evidence</option>
                      <option value="subject">Subject reference</option>
                    </select>
                    <button
                      className={buttonClass}
                      aria-label={`Remove reference ${index + 1}`}
                      disabled={!!busy || conflict}
                      onClick={() =>
                        edit({
                          references: work.references.filter(
                            (_, i) => i !== index,
                          ),
                        })
                      }
                    >
                      <X size={14} />
                    </button>
                  </div>
                </div>
              </div>
              <input
                className={`${fieldClass} mt-2`}
                aria-label={`Use instructions for reference ${index + 1}`}
                placeholder="What should be preserved or used from this image?"
                value={ref.note}
                disabled={!!busy || conflict}
                onChange={(e) =>
                  edit({
                    references: work.references.map((item, i) =>
                      i === index ? { ...item, note: e.target.value } : item,
                    ),
                  })
                }
              />
            </article>
          );
        })}
      </div>
      <label
        className={`${buttonClass} mt-3 w-full cursor-pointer border-dashed`}
      >
        <Plus size={15} />
        Upload subject images · max 3
        <input
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp"
          className="sr-only"
          disabled={!!busy || conflict}
          onChange={(e) => {
            const files = e.target.files;
            void task('Uploading subject references', () =>
              uploadSubjects(files),
            );
            e.target.value = '';
          }}
        />
      </label>
      {assets.some(
        (a) =>
          ['news', 'subject'].includes(a.role) &&
          a.status === 'ready' &&
          !work.references.some((ref) => ref.assetId === a.id),
      ) && (
        <details className="mt-3 text-xs text-white/55">
          <summary className="cursor-pointer">
            Previously uploaded references
          </summary>
          <div className="mt-2 space-y-1">
            {assets
              .filter(
                (a) =>
                  ['news', 'subject'].includes(a.role) &&
                  a.status === 'ready' &&
                  !work.references.some((ref) => ref.assetId === a.id),
              )
              .map((asset) => (
                <button
                  key={asset.id}
                  className={`${buttonClass} w-full justify-start truncate text-xs`}
                  disabled={
                    !!busy ||
                    conflict ||
                    work.references.filter((ref) => ref.role === asset.role)
                      .length >= 3
                  }
                  onClick={() =>
                    edit({
                      references: [
                        ...work.references,
                        {
                          assetId: asset.id,
                          role: asset.role as 'news' | 'subject',
                          note: '',
                        },
                      ],
                    })
                  }
                >
                  {asset.name}
                </button>
              ))}
          </div>
        </details>
      )}
      <div className="my-5 border-t border-white/10" />
      <button
        className={`${buttonClass} mb-3 w-full`}
        disabled={!!busy || !caps?.planner.configured || conflict}
        onClick={() => void task('Preparing image prompt', prepare)}
      >
        <Sparkles size={15} />
        {work.plan ? 'Regenerate prompt' : 'Generate prompt'}
      </button>
      <label className="block text-sm font-medium">
        Image prompt
        <textarea
          className={`${fieldClass} mt-2 min-h-44 leading-relaxed`}
          value={work.manualPrompt ?? work.plan?.renderPrompt ?? ''}
          disabled={!!busy || conflict}
          onChange={(e) => edit({ manualPrompt: e.target.value })}
          placeholder="Generate a scene plan or write your own prompt."
        />
      </label>
      {manualStale && (
        <div className="mt-3 rounded-lg border border-amber-300/30 p-3 text-xs text-amber-100">
          <p>Review the changed inputs before using your edited prompt.</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              className={buttonClass}
              disabled={!!busy || conflict}
              onClick={() => void task('Keeping edited prompt', keepManual)}
            >
              Keep edit with current references
            </button>
            <button
              className={buttonClass}
              disabled={!!busy || conflict}
              onClick={() => void task('Preparing fresh prompt', prepare)}
            >
              Regenerate prompt
            </button>
          </div>
        </div>
      )}
      {stale && !manualStale && (
        <p className="mt-2 text-xs text-amber-100/65">
          The brief changed. The plan will be refreshed before rendering.
        </p>
      )}
      {work.plan && (
        <details className="mt-3 text-xs text-white/50">
          <summary className="cursor-pointer">
            Scene plan and actual reference manifest
          </summary>
          <p className="mt-2">{work.plan.storyThesis}</p>
          <p className="mt-1">{work.plan.composition}</p>
          <ol className="mt-2 list-inside list-decimal space-y-1">
            {work.plan.references.map((ref) => (
              <li key={ref.id}>
                {ref.role}: {ref.name.split(' · ')[0]} —{' '}
                {
                  work.plan?.referenceUsage.find((item) => item.id === ref.id)
                    ?.use
                }
              </li>
            ))}
          </ol>
          {work.plan.uncertainties.length > 0 && (
            <p className="mt-2 text-amber-200/70">
              Uncertainty: {work.plan.uncertainties.join(' ')}
            </p>
          )}
        </details>
      )}
      <label className="mb-3 mt-5 block text-sm font-medium">
        Image model
        <select
          className={`${fieldClass} mt-2`}
          value={work.presetId}
          disabled={!!busy || conflict}
          onChange={(e) => edit({ presetId: e.target.value as PresetId })}
        >
          {Object.values(PRESETS).map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
      </label>
      <button
        className={`${primaryClass} w-full py-3`}
        disabled={!!busy || !canGenerate || Boolean(pendingId)}
        onClick={() =>
          void task('Generating and saving image', () => generate('generate'))
        }
      >
        {busy.includes('Generating') ? (
          <Loader2 size={16} className="animate-spin" />
        ) : (
          <ImageIcon size={16} />
        )}
        Generate one image · ~$
        {PRESETS[work.presetId].outputEstimateUsd.toFixed(3)} output
      </button>
      <p className="mt-2 text-xs text-white/40">
        Prompt, reference inputs and the visual check cost extra. No automatic
        rerenders.
      </p>
      {!caps?.presets.find((p) => p.id === work.presetId)?.configured && (
        <p className="mt-2 text-xs text-amber-200/70">
          {caps?.presets.find((p) => p.id === work.presetId)?.reason}
        </p>
      )}
    </section>
  );
}
