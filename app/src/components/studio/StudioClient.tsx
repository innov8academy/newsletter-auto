'use client';
import Link from 'next/link';
import {
  ArrowLeft,
  Image as ImageIcon,
  Palette,
  RefreshCw,
  Send,
  X,
} from 'lucide-react';
import type { DraftRecord } from '@/lib/studio/types';
import StyleLibrary from './StyleLibrary';
import StudioPromptPanel from './StudioPromptPanel';
import StudioResultsPanel from './StudioResultsPanel';
import { useStudioController } from './useStudioController';
import { buttonClass, fieldClass, saveJsonFile, studioApi } from './client-api';
export default function StudioClient() {
  const studio = useStudioController();
  const {
    caps,
    drafts,
    styles,
    draft,
    storyId,
    work,
    busy,
    error,
    notice,
    dirty,
    conflict,
    libraryOpen,
    localDraft,
    workRef,
    setLibraryOpen,
    setError,
    setConflict,
    task,
    initialize,
    loadLists,
    openDraft,
    loadStory,
    flush,
    edit,
    clear,
    exportBeehiiv,
    importLocal,
    markDirty,
    story,
    total,
    unknownCost,
  } = studio;

  return (
    <div className="min-h-screen bg-[#0B0B0F] text-white">
      <header className="border-b border-white/10 bg-[#0B0B0F] px-4 py-4 sm:px-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Link
              href="/draft"
              className="rounded p-1 text-white/50 hover:text-white"
              aria-label="Back to draft"
            >
              <ArrowLeft size={20} />
            </Link>
            <div>
              <h1 className="flex items-center gap-2 font-display text-xl">
                <ImageIcon className="text-purple-400" size={21} />
                Image Studio
              </h1>
              <p className="text-xs text-white/45">L8R editorial images</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span role="status" className="mr-2 text-xs text-white/50">
              {busy
                ? busy
                : conflict
                  ? 'Save conflict'
                  : dirty
                    ? error
                      ? 'Edits not saved'
                      : 'Saving edits…'
                    : work
                      ? 'Saved'
                      : ''}
            </span>
            <button
              className={buttonClass}
              onClick={() => setLibraryOpen(!libraryOpen)}
              disabled={!!busy || !caps?.storage.ready}
            >
              <Palette size={16} />
              Style library
            </button>
            <button
              className={buttonClass}
              disabled={!!busy || !draft || conflict}
              onClick={() => void task('Creating Beehiiv draft', exportBeehiiv)}
            >
              <Send size={16} />
              Beehiiv draft
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1600px] p-4 sm:p-6">
        {error && (
          <div
            role="alert"
            className="mb-4 flex items-start justify-between gap-3 rounded-lg border border-rose-400/30 bg-rose-500/10 p-3 text-sm text-rose-200"
          >
            <div className="min-w-0 break-words">
              {error}
              {dirty && !conflict && (
                <button
                  className={`${buttonClass} ml-3 text-xs`}
                  disabled={!!busy}
                  onClick={() =>
                    void task('Retrying save', async () => {
                      await flush();
                    })
                  }
                >
                  Retry saving edits
                </button>
              )}
              {error.toLowerCase().includes('sign in') && (
                <Link href="/login" className="ml-2 underline">
                  Sign in
                </Link>
              )}
            </div>
            <button onClick={() => setError('')} aria-label="Dismiss error">
              <X size={16} />
            </button>
          </div>
        )}
        {notice && (
          <div
            role="status"
            className="mb-4 rounded-lg border border-white/10 bg-white/5 p-3 text-sm text-white/65"
          >
            {notice}
          </div>
        )}
        {caps && !caps.storage.ready && (
          <section className="mb-6 rounded-xl border border-amber-300/25 bg-amber-500/5 p-5">
            <h2 className="font-medium">Studio storage needs setup</h2>
            <p className="mt-2 text-sm text-white/60">{caps.storage.error}</p>
            <button
              className={`${buttonClass} mt-3`}
              disabled={!!busy}
              onClick={() => void task('Checking setup', initialize)}
            >
              <RefreshCw size={14} />
              Check again
            </button>
            {localDraft && (
              <button
                className={`${buttonClass} ml-2 mt-3`}
                onClick={() =>
                  saveJsonFile(localDraft, 'l8r-local-draft-backup.json')
                }
              >
                Download local draft backup
              </button>
            )}
          </section>
        )}
        {caps?.storage.ready && !caps.planner.configured && (
          <p className="mb-4 rounded-lg border border-amber-300/20 p-3 text-sm text-amber-100/80">
            OpenRouter is not configured on this server. You can manage saved
            work and references; prompt and image generation become available
            after setup.
          </p>
        )}
        {localDraft && caps?.storage.ready && (
          <div className="mb-5 flex flex-wrap items-center gap-3 rounded-lg border border-white/15 p-3">
            <span className="text-sm text-white/65">
              A local newsletter draft is available.
            </span>
            <button
              className={buttonClass}
              disabled={!!busy}
              onClick={() =>
                void task('Importing local draft', () => importLocal(false))
              }
            >
              Import local draft
            </button>
            <button
              className={buttonClass}
              disabled={!!busy}
              onClick={() =>
                void task('Importing a separate copy', () => importLocal(true))
              }
            >
              Import as separate copy
            </button>
          </div>
        )}
        {libraryOpen && caps?.storage.ready && (
          <StyleLibrary
            styles={styles}
            canAnalyze={caps.planner.configured}
            onClose={() => setLibraryOpen(false)}
            onChanged={async (selected) => {
              await loadLists();
              if (selected && workRef.current) {
                edit({ stylePackId: selected.id });
                await flush();
              }
            }}
          />
        )}
        <div className="grid gap-5 lg:grid-cols-[230px_minmax(0,1fr)]">
          <aside className="rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <label
              className="mb-2 block text-xs font-medium uppercase tracking-wide text-white/45"
              htmlFor="saved-draft"
            >
              Saved newsletter
            </label>
            <select
              id="saved-draft"
              className={`${fieldClass} mb-4`}
              value={draft?.id || ''}
              disabled={!!busy || conflict || !caps?.storage.ready}
              onChange={(e) => {
                const nextDraftId = e.target.value;
                void task('Opening draft', async () => {
                  await flush();
                  await openDraft(
                    (
                      await studioApi<{ draft: DraftRecord }>(
                        `drafts/${nextDraftId}`,
                      )
                    ).draft,
                  );
                });
              }}
            >
              <option value="">Choose a draft</option>
              {drafts.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.title}
                </option>
              ))}
            </select>
            {draft && (
              <>
                <p className="mb-3 text-xs text-white/45">
                  {draft.payload.date} · {draft.payload.stories.length} stories
                </p>
                <nav
                  aria-label="Newsletter stories"
                  className="flex gap-2 overflow-x-auto lg:flex-col"
                >
                  {draft.payload.stories.map((item, index) => (
                    <button
                      key={item.studioStoryId}
                      aria-current={
                        storyId === item.studioStoryId ? 'page' : undefined
                      }
                      className={`min-w-[160px] rounded-lg border p-3 text-left text-sm lg:min-w-0 ${storyId === item.studioStoryId ? 'border-purple-400/40 bg-purple-500/15 text-white' : 'border-transparent text-white/55 hover:bg-white/5'}`}
                      disabled={!!busy || conflict}
                      onClick={() =>
                        void task('Opening story', async () => {
                          await flush();
                          await loadStory(draft, item.studioStoryId);
                        })
                      }
                    >
                      <span className="mb-1 block text-[10px] uppercase text-white/35">
                        Story {index + 1}
                      </span>
                      {item.title}
                    </button>
                  ))}
                </nav>
              </>
            )}
            <div className="mt-5 border-t border-white/10 pt-4 text-xs text-white/45">
              <p>Recorded Studio usage</p>
              <p className="mt-1 text-lg text-white/80">
                ${total.toFixed(4)}
                {unknownCost ? ' + unknown usage' : ''}
              </p>
              <p className="mt-1">
                Includes measured planning and generation receipts. Older
                workflow cost entries are retained separately.
              </p>
            </div>
          </aside>
          {!draft || !story || !work ? (
            <section className="flex min-h-80 items-center justify-center rounded-xl border border-white/10 p-8 text-center">
              <div>
                <ImageIcon
                  className="mx-auto mb-4 text-purple-400/40"
                  size={48}
                />
                <h2 className="text-lg">
                  Open a newsletter to create its images
                </h2>
                <p className="mt-2 max-w-md text-sm text-white/45">
                  Import the draft from your browser or choose a saved
                  newsletter. Your reference library and completed images stay
                  available across devices.
                </p>
                <Link href="/draft" className={`${buttonClass} mt-5`}>
                  Go to draft editor
                </Link>
              </div>
            </section>
          ) : (
            <div className="min-w-0">
              <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-xl font-semibold">{story.title}</h2>
                  <p className="mt-1 text-sm text-white/45">
                    Build the scene, review the prompt, then choose an image.
                  </p>
                </div>
                <button
                  className={buttonClass}
                  disabled={!!busy || conflict}
                  onClick={() => void task('Clearing prompt inputs', clear)}
                >
                  Clear all inputs
                </button>
              </div>
              {conflict && (
                <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-400/30 p-3 text-sm">
                  <span>Your edits are retained locally.</span>
                  <button
                    className={buttonClass}
                    onClick={() =>
                      saveJsonFile(
                        workRef.current,
                        'l8r-unsaved-studio-edits.json',
                      )
                    }
                  >
                    Download my edits
                  </button>
                  <button
                    className={buttonClass}
                    onClick={() =>
                      void task('Reloading saved story', async () => {
                        saveJsonFile(
                          workRef.current,
                          'l8r-unsaved-studio-edits.json',
                        );
                        markDirty(false);
                        setConflict(false);
                        await loadStory(draft, storyId);
                      })
                    }
                  >
                    Back up edits and reload saved
                  </button>
                </div>
              )}
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(320px,0.9fr)_minmax(0,1.1fr)]">
                <StudioPromptPanel studio={studio} />
                <StudioResultsPanel studio={studio} />
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
