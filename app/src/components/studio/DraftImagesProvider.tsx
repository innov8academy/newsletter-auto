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
import { saveWizardDraft, type WizardSections } from '@/lib/studio/wizard-draft';
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
  const savedId = useRef<string | null>(null);
  const sessionId = useRef<string | null>(null);
  const syncedWizard = useRef<{ sessionId: string; signature: string } | null>(null);
  const seenSharedDraft = useRef<string | null>(null);
  const refreshing = useRef(false);

  const shareStudioRevision = useCallback(() => {
    try {
      const local = client.current?.draft();
      const shared = sharedClient.getSnapshot().state;
      if (!local || !shared || shared.sessionId !== sessionId.current ||
          shared.currentDraft?.studioDraftId !== local.studioDraftId ||
          local.studioServerRevision == null ||
          local.studioServerRevision <= (shared.currentDraft.studioServerRevision ?? -1)) return;
      sharedClient.mutate({ currentDraft: {
        ...shared.currentDraft,
        studioServerRevision: local.studioServerRevision,
      } });
    } catch (cause) {
      setDraftError(cause instanceof Error ? cause.message : 'Could not share the Studio revision.');
    }
  }, [sharedClient]);

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
    const shared = sharedSnapshot.state;
    if (!shared || sharedSnapshot.phase === 'loading' || sharedSnapshot.phase === 'load_error' || sharedSnapshot.phase === 'conflict') return;
    if (sessionId.current !== shared.sessionId) {
      sessionId.current = shared.sessionId;
      syncedWizard.current = null;
      seenSharedDraft.current = null;
      savedId.current = null;
      setDraft(null);
      setStatus({ stories: [], assets: [] });
      setErrors({});
      setBusy({});
    }
    // The parent restores wizard state after a session switch. Wait until its
    // reports and completed sections match this session before writing a draft.
    if (!selectedReports.length) {
      setDraft(null);
      setDraftError('');
      return;
    }
    if (!matchesSharedWizard(selectedReports, completed, shared.wizardState)) return;
    const signature = stableJson({ selectedReports, completed });
    const sharedDraftJson = stableJson(shared.currentDraft);
    let existing: StudioDraft | null = null;
    if (shared.currentDraft) {
      try {
        const upgraded = upgradeDraft(shared.currentDraft);
        if (
          stableJson(upgraded) === sharedDraftJson &&
          upgraded.stories.length === selectedReports.length &&
          upgraded.stories.every(
            (story, index) => story.sourceStoryId === selectedReports[index].story.id,
          )
        ) existing = upgraded;
      } catch {
        // saveWizardDraft retains a backup and repairs malformed local drafts.
      }
    }
    if (
      syncedWizard.current?.sessionId === shared.sessionId &&
      syncedWizard.current.signature === signature
    ) {
      if (seenSharedDraft.current === sharedDraftJson) return;
      if (existing || !shared.currentDraft) {
        setDraft(existing);
        setDraftError('');
        seenSharedDraft.current = sharedDraftJson;
        if (existing && savedId.current !== existing.studioDraftId) {
          savedId.current = existing.studioDraftId;
        }
        if (existing) void refresh();
        return;
      }
      syncedWizard.current = null;
    }
    if (!syncedWizard.current && existing) {
      syncedWizard.current = { sessionId: shared.sessionId, signature };
      seenSharedDraft.current = sharedDraftJson;
      setDraft(existing);
      setDraftError('');
      if (savedId.current !== existing.studioDraftId) {
        savedId.current = existing.studioDraftId;
        void refresh();
      }
      return;
    }
    let next: StudioDraft;
    try {
      next = saveWizardDraft(
        completed,
        selectedReports,
        getCurrentDateContext(),
      );
    } catch (cause) {
      setDraft(null);
      savedId.current = null;
      setDraftError(
        cause instanceof Error
          ? cause.message
          : 'This draft could not be saved. Your writing is still available.',
      );
      return;
    }
    setDraft(next);
    setDraftError('');
    if (savedId.current !== next.studioDraftId) {
      savedId.current = next.studioDraftId;
      setStatus({ stories: [], assets: [] });
      setErrors({});
      void refresh();
    }
    try {
      if (sharedDraftJson !== stableJson(next))
        sharedClient.mutate({ currentDraft: next });
      syncedWizard.current = { sessionId: shared.sessionId, signature };
      seenSharedDraft.current = stableJson(next);
    } catch (cause) {
      setDraftError(
        cause instanceof Error
          ? cause.message
          : 'The shared draft could not be saved. Your writing is still available.',
      );
    }
  }, [completed, selectedReports, refresh, sharedClient, sharedSnapshot]);

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
          shareStudioRevision();
          active.current.delete(storyId);
          setBusy((old) => ({ ...old, [storyId]: false }));
          void refresh();
        });
    },
    [refresh, shareStudioRevision],
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
      localStorage.setItem('currentDraft', JSON.stringify(next));
      setDraft(next);
      generate(target.studioStoryId);
    },
    [generate],
  );
  const sync = useCallback(async () => {
    if (client.current) {
      await client.current.sync();
      shareStudioRevision();
    }
  }, [shareStudioRevision]);
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
