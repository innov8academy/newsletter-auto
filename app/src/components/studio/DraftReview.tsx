'use client';
import { useState } from 'react';
import { useDraftImages } from './DraftImagesProvider';
import { DraftImageCard, DraftImagesToolbar } from './DraftImageCard';
import { buttonClass, saveJsonFile } from './client-api';

export default function DraftReview({ onBack }: { onBack: () => void }) {
  const images = useDraftImages();
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState('');
  const draft = images.draft;
  async function exportDraft() {
    setExporting(true);
    setMessage('');
    try {
      await images.sync();
      const response = await fetch('/api/beehiiv/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studioDraftId: draft!.studioDraftId }),
      });
      const result = await response.json();
      if (!response.ok || !result.success)
        throw new Error(result.error || 'Could not create the Beehiiv draft.');
      setMessage('Beehiiv draft created. Nothing was published.');
    } catch (cause) {
      setMessage(
        cause instanceof Error
          ? cause.message
          : 'Export failed. Your newsletter is still saved.',
      );
    } finally {
      setExporting(false);
    }
  }
  if (!draft) return null;
  return (
    <div className="space-y-6 pb-8">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="font-display text-2xl">Review newsletter</h2>
          <p className="mt-1 text-sm text-white/60">
            Your content and images, together. Change only what needs changing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={buttonClass} onClick={onBack}>
            Back to writing
          </button>
          <button
            className={buttonClass}
            onClick={() => saveJsonFile(draft, 'l8r-newsletter.json')}
          >
            Download draft
          </button>
          <button
            className={buttonClass}
            disabled={
              exporting ||
              Boolean(images.setupError) ||
              Object.values(images.busy).some(Boolean) ||
              images.stories.some((story) => story.latest?.status === 'running')
            }
            onClick={() => void exportDraft()}
          >
            {exporting ? 'Creating draft…' : 'Create Beehiiv draft'}
          </button>
        </div>
      </div>
      <p role="status" className="text-sm text-amber-200">
        {message}
      </p>
      <DraftImagesToolbar />
      <article className="space-y-6">
        <header>
          <h2 className="font-display text-3xl">{draft.title}</h2>
          <p className="mt-2 text-white/70">{draft.subtitle}</p>
        </header>
        <p className="whitespace-pre-wrap text-white/85">{draft.intro}</p>
        {draft.toc.length > 0 && (
          <ul className="list-inside list-disc text-white/75">
            {draft.toc.map((item, index) => (
              <li key={index}>{item}</li>
            ))}
          </ul>
        )}
        {draft.stories.map((story) => (
          <section
            key={story.studioStoryId}
            className="grid gap-6 border-t border-white/10 pt-6 lg:grid-cols-[minmax(0,1fr)_300px]"
          >
            <div className="min-w-0 space-y-3">
              <h3 className="text-xl font-semibold">
                {story.emoji} {story.title}
              </h3>
              <p className="whitespace-pre-wrap">{story.hookParagraph}</p>
              <ul className="list-inside list-disc text-white/80">
                {story.bulletPoints.map((point, index) => (
                  <li key={index}>{point}</li>
                ))}
              </ul>
              {story.whyItMatters && (
                <p>
                  <strong>Why it matters: </strong>
                  {story.whyItMatters}
                </p>
              )}
              {story.l8rsTake && (
                <p>
                  <strong>L8R’s take: </strong>
                  {story.l8rsTake}
                </p>
              )}
            </div>
            <DraftImageCard sourceId={story.sourceStoryId || ''} />
          </section>
        ))}
        <p className="whitespace-pre-wrap border-t border-white/10 pt-6 text-white/80">
          {draft.quickSummary}
        </p>
      </article>
    </div>
  );
}
