'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { getCurrentDateContext, useWizard } from '@/context/WizardContext';
import type { StoryBlock } from '@/lib/draft-generator';
import type { GenerationRun, StudioDraft } from '@/lib/studio/types';
import {
  DraftImageClient,
  type DraftImageStatus,
} from '@/lib/studio/draft-image-client';
import { saveWizardDraft } from '@/lib/studio/wizard-draft';
import { studioApi, StudioClientError } from './client-api';

interface ImageContext extends DraftImageStatus {
  draft: StudioDraft | null;
  busy: Record<string, boolean>;
  errors: Record<string, string>;
  setupError: string;
  writtenStoryIds: string[];
  sync: () => Promise<void>;
  generatedBody: (sourceId: string, body: StoryBlock) => void;
  generate: (storyId: string, retry?: boolean) => void;
  refine: (storyId: string, source: GenerationRun, instruction: string) => void;
  select: (
    storyId: string,
    generationId: string,
    revision: number,
  ) => Promise<void>;
  refresh: () => Promise<void>;
}
const Context = createContext<ImageContext | null>(null);
export const useDraftImages = () => {
  const value = useContext(Context);
  if (!value) throw new Error('DraftImagesProvider is required.');
  return value;
};

export function DraftImagesProvider({ children }: { children: ReactNode }) {
  const { completed, selectedReports } = useWizard();
  const client = useRef<DraftImageClient | null>(null);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [status, setStatus] = useState<DraftImageStatus>({
    stories: [],
    assets: [],
  });
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [setupError, setSetupError] = useState('');
  const active = useRef(new Set<string>());
  const savedId = useRef<string | null>(null);
  const refreshing = useRef(false);

  const refresh = useCallback(async () => {
    const session = client.current;
    const id = session?.draft()?.studioDraftId;
    if (!session || !id || refreshing.current) return;
    refreshing.current = true;
    try {
      const result = await session.load();
      if (session.draft()?.studioDraftId === id) {
        setStatus(result);
        setErrors((old) => (old.$status ? { ...old, $status: '' } : old));
      }
    } catch (cause) {
      if (
        session.draft()?.studioDraftId === id &&
        !(cause instanceof StudioClientError && cause.status === 404)
      )
        setErrors((old) => ({
          ...old,
          $status:
            'Image status could not be refreshed. Saved images are unchanged; use Refresh status before retrying.',
        }));
    } finally {
      refreshing.current = false;
    }
  }, []);

  useEffect(() => {
    client.current = new DraftImageClient(localStorage, studioApi);
    void studioApi<{
      storage: { ready: boolean; error: string };
      planner: { configured: boolean };
      search: { configured: boolean };
    }>('capabilities')
      .then((caps) =>
        setSetupError(
          !caps.storage.ready
            ? caps.storage.error
            : !caps.planner.configured
              ? 'Configure OpenRouter to generate images. Body writing is still available.'
              : !caps.search.configured
                ? 'Configure image search to find news references. Body writing is still available.'
                : '',
        ),
      )
      .catch((cause) =>
        setSetupError(
          cause instanceof Error
            ? cause.message
            : 'Image setup is unavailable.',
        ),
      );
  }, []);

  useEffect(() => {
    // Wait for the wizard's saved selection to be restored; never overwrite it
    // with the provider's empty first render.
    if (!selectedReports.length) return;
    const next = saveWizardDraft(
      completed,
      selectedReports,
      getCurrentDateContext(),
    );
    setDraft(next);
    if (savedId.current !== next.studioDraftId) {
      savedId.current = next.studioDraftId;
      setStatus({ stories: [], assets: [] });
      setErrors({});
      void refresh();
    }
  }, [completed, selectedReports, refresh]);

  const polling =
    Object.values(busy).some(Boolean) ||
    status.stories.some((story) => story.latest?.status === 'running');
  useEffect(() => {
    if (!polling) return;
    const timer = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(timer);
  }, [polling, refresh]);
  useEffect(() => {
    const onFocus = () => void refresh();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [refresh]);

  const perform = useCallback(
    (
      storyId: string,
      action: (session: DraftImageClient) => Promise<unknown>,
    ) => {
      const session = client.current;
      if (!session || active.current.has(storyId)) return;
      const draftId = session.draft()?.studioDraftId;
      active.current.add(storyId);
      setBusy((old) => ({ ...old, [storyId]: true }));
      setErrors((old) => ({ ...old, [storyId]: '' }));
      void action(session)
        .catch((cause) => {
          if (session.draft()?.studioDraftId === draftId)
            setErrors((old) => ({
              ...old,
              [storyId]:
                cause instanceof Error
                  ? cause.message
                  : 'Image request failed. Your body text is saved.',
            }));
        })
        .finally(() => {
          active.current.delete(storyId);
          setBusy((old) => ({ ...old, [storyId]: false }));
          void refresh();
        });
    },
    [refresh],
  );
  const generate = useCallback(
    (storyId: string, retry = false) => {
      perform(storyId, (session) =>
        session.generate(storyId, retry ? crypto.randomUUID() : undefined),
      );
    },
    [perform],
  );

  const generatedBody = useCallback(
    (sourceId: string, body: StoryBlock) => {
      const session = client.current;
      const current = session?.draft();
      const target = current?.stories.find(
        (story) => story.sourceStoryId === sourceId,
      );
      if (!current || !target) return;
      // Capture the newly finished body before React's next autosave effect. Match
      // by source identity, never the index that may have changed during writing.
      const next = {
        ...current,
        stories: current.stories.map((story) =>
          story.studioStoryId === target.studioStoryId
            ? {
                ...body,
                sourceStoryId: sourceId,
                studioStoryId: target.studioStoryId,
              }
            : story,
        ),
      };
      localStorage.setItem('currentDraft', JSON.stringify(next));
      setDraft(next);
      generate(target.studioStoryId);
    },
    [generate],
  );
  const sync = useCallback(async () => {
    if (client.current) await client.current.sync();
  }, []);
  const refine = useCallback(
    (storyId: string, source: GenerationRun, instruction: string) => {
      perform(storyId, (session) =>
        session.refine(storyId, source, instruction),
      );
    },
    [perform],
  );
  const select = useCallback(
    async (storyId: string, generationId: string, revision: number) => {
      try {
        await studioApi('selection', 'POST', {
          draftId: client.current?.draft()?.studioDraftId,
          storyId,
          generationId,
          revision,
        });
        await refresh();
      } catch (cause) {
        setErrors((old) => ({
          ...old,
          [storyId]:
            cause instanceof Error
              ? cause.message
              : 'Could not change the selected image.',
        }));
      }
    },
    [refresh],
  );

  const writtenStoryIds =
    draft?.stories
      .filter((story) =>
        selectedReports.some(
          (report, index) =>
            report.story.id === story.sourceStoryId &&
            completed.stories[index]?.title,
        ),
      )
      .map((story) => story.studioStoryId) || [];
  return (
    <Context.Provider
      value={{
        ...status,
        draft,
        busy,
        errors,
        setupError,
        writtenStoryIds,
        sync,
        generatedBody,
        generate,
        refine,
        select,
        refresh,
      }}
    >
      {children}
    </Context.Provider>
  );
}
