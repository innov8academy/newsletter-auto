'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useDraftImages } from './DraftImagesProvider';
import AssetPreview from './AssetPreview';
import { buttonClass, downloadStudioAsset, fieldClass } from './client-api';

export function DraftImageCard({ sourceId }: { sourceId: string }) {
  const images = useDraftImages();
  const [editing, setEditing] = useState(false);
  const [instruction, setInstruction] = useState('');
  const [dismissed, setDismissed] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState<{
    assetId: string;
    message: string;
  } | null>(null);
  const story = images.draft?.stories.find(
    (item) => item.sourceStoryId === sourceId,
  );
  if (!story) return null;
  const summary = images.stories.find(
    (item) => item.storyId === story.studioStoryId,
  );
  const selected = summary?.selected;
  const latest = summary?.latest;
  const candidate =
    latest?.status === 'complete' &&
    latest.id !== selected?.id &&
    latest.id !== dismissed
      ? latest
      : null;
  const displayed = candidate || selected;
  const asset = images.assets.find(
    (item) => item.id === displayed?.deliveryAssetId,
  );
  const pending =
    images.busy[story.studioStoryId] || latest?.status === 'running';
  const failure =
    latest && latest.status !== 'complete' && latest.status !== 'running'
      ? latest.error
      : '';
  const error = images.errors[story.studioStoryId] || failure;
  const progressLabels = {
    references: 'Finding news references…',
    planning: 'Preparing image…',
    rendering: 'Generating image…',
    saving: 'Saving image…',
    quality: 'Checking image…',
  };
  let status = selected ? 'Attached to newsletter' : 'No image yet';
  if (candidate)
    status = selected
      ? 'New version — your current image is unchanged'
      : 'Saved — choose this version to attach it';
  if (pending) status = progressLabels[latest?.stage || 'planning'];
  function retry() {
    if (
      latest &&
      ['interrupted', 'save_failed'].includes(latest.status) &&
      !window.confirm(
        'The previous provider request may have been charged. Check its history first. Start a new paid image request?',
      )
    )
      return;
    images.generate(story!.studioStoryId, Boolean(latest));
  }
  async function download() {
    if (!asset || asset.status !== 'ready' || downloading) return;
    setDownloading(true);
    setDownloadError(null);
    try {
      await downloadStudioAsset(asset.id);
    } catch (error) {
      setDownloadError({
        assetId: asset.id,
        message:
          error instanceof Error
            ? error.message
            : 'Could not download the image. Please try again.',
      });
    } finally {
      setDownloading(false);
    }
  }
  return (
    <section
      aria-label={`Image for ${story.title}`}
      className="min-w-0 self-start rounded-xl border border-white/10 bg-black/20 p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="text-sm font-medium text-white/90">Story image</h3>
        <span className="text-xs text-white/50">
          {displayed?.presetId === 'gpt-image-2-high'
            ? 'GPT Image 2'
            : 'Nano Banana Pro'}
        </span>
      </div>
      {asset ? (
        <AssetPreview asset={asset} className="aspect-video w-full" />
      ) : (
        <div className="flex aspect-video items-center justify-center rounded-lg bg-white/5 p-4 text-center text-sm text-white/60">
          {pending ? status : 'Your image will appear here.'}
        </div>
      )}
      <p role="status" className="mt-3 text-xs text-white/65">
        {status}
      </p>
      {error && (
        <p role="alert" className="mt-2 break-words text-sm text-coral-300">
          {error}
        </p>
      )}
      {latest?.warnings?.map((warning) => (
        <p key={warning} className="mt-2 text-xs text-amber-200">
          {warning}
        </p>
      ))}
      {candidate && (
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            className={buttonClass}
            disabled={pending || !summary?.revision}
            onClick={() =>
              void images.select(
                story.studioStoryId,
                candidate.id,
                summary!.revision!,
              )
            }
          >
            Use this version
          </button>
          {selected && (
            <button
              className={buttonClass}
              onClick={() => setDismissed(candidate.id)}
            >
              Keep current
            </button>
          )}
        </div>
      )}
      {!selected && !candidate && (
        <button
          className={`${buttonClass} mt-3`}
          onClick={retry}
          disabled={pending || Boolean(images.setupError)}
        >
          {pending
            ? 'Generating image…'
            : latest || error
              ? 'Retry image'
              : 'Generate image'}
        </button>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className={buttonClass}
          disabled={asset?.status !== 'ready' || downloading}
          aria-busy={downloading}
          onClick={() => void download()}
        >
          {downloading ? 'Downloading…' : 'Download'}
        </button>
        {selected && !editing && (
          <button
            type="button"
            className={buttonClass}
            disabled={pending}
            onClick={() => setEditing(true)}
          >
            Change image
          </button>
        )}
      </div>
      {downloadError && downloadError.assetId === asset?.id && (
        <p role="alert" className="mt-2 break-words text-sm text-coral-300">
          {downloadError.message}
        </p>
      )}
      {editing && selected && (
        <form
          className="mt-3 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (instruction.trim()) {
              images.refine(story.studioStoryId, selected, instruction);
              setEditing(false);
            }
          }}
        >
          <label
            className="block text-sm text-white/80"
            htmlFor={`change-${story.studioStoryId}`}
          >
            What should change?
          </label>
          <textarea
            id={`change-${story.studioStoryId}`}
            className={`${fieldClass} min-h-24 text-base`}
            value={instruction}
            onChange={(event) => setInstruction(event.target.value)}
            placeholder="For example: make the background brighter."
            required
            maxLength={3000}
          />
          <div className="flex flex-wrap gap-2">
            <button type="submit" className={buttonClass} disabled={pending}>
              Generate revised image
            </button>
            <button
              type="button"
              className={buttonClass}
              onClick={() => setEditing(false)}
            >
              Cancel
            </button>
          </div>
          <p className="text-xs text-white/50">
            Creates one paid revision. Your current image stays selected until
            you approve the replacement.
          </p>
        </form>
      )}
      <Link
        href={`/studio?draftId=${images.draft?.studioDraftId}&storyId=${story.studioStoryId}`}
        className="mt-4 inline-block text-xs text-purple-300 underline underline-offset-4"
      >
        Advanced image editor
      </Link>
    </section>
  );
}

export function DraftImagesToolbar() {
  const images = useDraftImages();
  const missing =
    images.draft?.stories.filter(
      (story) =>
        images.writtenStoryIds.includes(story.studioStoryId) &&
        !images.stories.some(
          (item) =>
            item.storyId === story.studioStoryId &&
            (item.selected || item.latest),
        ) &&
        !images.busy[story.studioStoryId],
    ) || [];
  const ready = images.stories.filter((story) => story.selected).length;
  const pending = new Set([
    ...Object.keys(images.busy).filter((id) => images.busy[id]),
    ...images.stories
      .filter((item) => item.latest?.status === 'running')
      .map((item) => item.storyId),
  ]).size;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.02] p-3">
      <div>
        <p role="status" className="text-sm text-white/80">
          Images: {ready} ready{pending ? ` · ${pending} generating` : ''}
        </p>
        <p className="mt-1 text-xs text-white/50">
          Images finish while you keep writing. Text edits don’t regenerate
          them.
        </p>
        {(images.setupError || images.errors.$status) && (
          <p className="mt-1 max-w-2xl text-xs text-amber-200">
            {images.setupError || images.errors.$status}
          </p>
        )}
      </div>
      {missing.length > 0 && (
        <button
          className={buttonClass}
          disabled={Boolean(images.setupError)}
          onClick={() =>
            missing.forEach((story) => images.generate(story.studioStoryId))
          }
        >
          Generate missing images ({missing.length})
        </button>
      )}
      {images.errors.$status && (
        <button className={buttonClass} onClick={() => void images.refresh()}>
          Refresh status
        </button>
      )}
    </div>
  );
}
