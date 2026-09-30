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
import { useWizard } from '@/context/WizardContext';
import { useSharedSession } from '@/components/SharedSessionProvider';
import { browserStorage as localStorage } from '@/lib/browser-storage';
import type { StoryBlock } from '@/lib/draft-generator';
import type { ResearchReport } from '@/lib/types';
import type { GenerationRun, StudioDraft } from '@/lib/studio/types';
import { upgradeDraft } from '@/lib/studio/state';
import {
  DraftImageClient,
  type DraftImageStatus,
} from '@/lib/studio/draft-image-client';
import { type WizardSections } from '@/lib/studio/wizard-draft';
import { studioApi, StudioClientError } from './client-api';
import { createUuid } from '@/lib/uuid';

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

function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left.localeCompare(right)))
      : item,
  );
}

export function matchesSharedWizard(
  selectedReports: ResearchReport[],
  completed: WizardSections,
  wizardState: unknown,
): boolean {
  if (!wizardState || typeof wizardState !== 'object') return false;
  const wizard = wizardState as Record<string, unknown>;
  return (
    Array.isArray(wizard.selectedReports) &&
    stableJson({ selectedReports, completed }) ===
      stableJson({ selectedReports: wizard.selectedReports, completed: wizard.completed })
  );
}

export const useDraftImages = () => {
  const value = useContext(Context);
  if (!value) throw new Error('DraftImagesProvider is required.');
  return value;
};

export function DraftImagesProvider({ children }: { children: ReactNode }) {
  const { completed, selectedReports } = useWizard();
  const { client: sharedClient, snapshot: sharedSnapshot } = useSharedSession();
  const client = useRef<DraftImageClient | null>(null);
  const [draft, setDraft] = useState<StudioDraft | null>(null);
  const [status, setStatus] = useState<DraftImageStatus>({
    stories: [],
    assets: [],
  });
  const [busy, setBusy] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [setupError, setSetupError] = useState('');
  const [draftError, setDraftError] = useState('');
  const active = useRef(new Set<string>());
  const sessionId = useRef<string | null>(null);
  const seenSharedDraft = useRef<string | null>(null);
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
    client.current = new DraftImageClient(localStorage, studioApi, async () => {
      if (!await sharedClient.waitForSaved()) throw new Error('Save or resolve the cloud warning before generating images. No image request was sent.');
      const current = sharedClient.getSnapshot().state?.currentDraft;
      if (!current || current.studioServerRevision == null) throw new Error('The cloud draft is not ready. Retry cloud saving before generating images.');
      return { id: current.studioDraftId!, payload: upgradeDraft(current), revision: current.studioServerRevision, updatedAt: sharedClient.getSnapshot().state?.updatedAt ?? '' };
    });
    void checkSetup();
  // Stable page coordinator retains in-flight image request identities.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sharedClient]);
  const authSeen = useRef(false);
  const checkSetup = useCallback(() => {
    return studioApi<{
      storage: { ready: boolean; error: string };
      planner: { configured: boolean };
      search: { configured: boolean };
      style: { configured: boolean };
    }>('capabilities')
      .then((caps) =>
        setSetupError(
          !caps.storage.ready
            ? caps.storage.error
            : !caps.style?.configured
              ? 'Activate the L8R editorial style before generating images. Body writing is still available.'
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
    if (sharedSnapshot.phase === 'auth') authSeen.current = true;
    if (sharedSnapshot.phase === 'ready' && authSeen.current) {
      authSeen.current = false; void checkSetup();
    }
  }, [sharedSnapshot.phase, checkSetup]);

  useEffect(() => {
    const shared = sharedSnapshot.state;
    if (!shared || sharedSnapshot.phase === 'loading' || sharedSnapshot.phase === 'load_error' || sharedSnapshot.phase === 'conflict' || sharedSnapshot.phase === 'auth') return;
    if (sessionId.current !== shared.sessionId) {
      sessionId.current = shared.sessionId;
      seenSharedDraft.current = null;
      setDraft(null);
      setStatus({ stories: [], assets: [] });
      setErrors({});
      setBusy({});
    }
    if (!shared.currentDraft) { setDraft(null); return; }
    try {
      const next = upgradeDraft(shared.currentDraft);
      setDraft(next); setDraftError('');
      if (seenSharedDraft.current !== stableJson(next)) {
        seenSharedDraft.current = stableJson(next);
        void refresh();
      }
    } catch { setDraftError('The saved draft needs recovery before using images. Your writing is retained.'); }
  }, [refresh, sharedSnapshot]);

  useEffect(() => {
    if (!draft?.studioDraftId) return;
    const timer = window.setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [draft?.studioDraftId, refresh]);
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
          void sharedClient.load();
          active.current.delete(storyId);
          setBusy((old) => ({ ...old, [storyId]: false }));
          void refresh();
        });
    },
    [refresh, sharedClient],
  );
  const generate = useCallback(
    (storyId: string, retry = false) => {
      perform(storyId, (session) =>
        session.generate(storyId, retry ? createUuid() : undefined),
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
      const shared = sharedClient.getSnapshot().state;
      if (!shared) return;
      const wizard = shared.wizardState as { completed?: WizardSections; selectedReports?: ResearchReport[] } | null;
      if (!wizard?.completed) return;
      const stories = [...wizard.completed.stories];
      const index = wizard.selectedReports?.findIndex(report => report.story.id === sourceId) ?? -1;
      if (index < 0) return;
      stories[index] = { ...body, sourceStoryId: sourceId };
      sharedClient.mutate({ currentDraft: next, wizardState: { ...wizard, completed: { ...wizard.completed, stories } } });
      setDraft(next);
      generate(target.studioStoryId);
    },
    [generate, sharedClient],
  );
  const sync = useCallback(async () => {
    if (client.current) {
      await client.current.sync();
      await sharedClient.load();
    }
  }, [sharedClient]);
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
      {draftError && (
        <p role="alert" className="mx-auto max-w-[1400px] px-4 pt-4 text-sm text-amber-200 sm:px-6">
          {draftError}
        </p>
      )}
      {children}
    </Context.Provider>
  );
}
