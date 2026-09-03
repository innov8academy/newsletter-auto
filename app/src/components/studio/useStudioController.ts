'use client';
import { useEffect, useRef, useState } from 'react';
import type { NewsletterDraft } from '@/lib/draft-generator';
import type {
  CostReceipt,
  DraftRecord,
  GenerationRun,
  PresetId,
  SearchCandidate,
  StoryWorkspace,
  StudioAsset,
  StudioDraft,
  StylePack,
} from '@/lib/studio/types';
import {
  inputSignature,
  isManualPromptStale,
  upgradeDraft,
} from '@/lib/studio/state';
import { StudioClientError, studioApi, uploadReference } from './client-api';

type Caps = {
  storage: { ready: boolean; error: string };
  planner: { model: string; configured: boolean };
  search: { configured: boolean; provider: string | null };
  presets: {
    id: PresetId;
    name: string;
    configured: boolean;
    reason: string | null;
    outputEstimateUsd: number;
  }[];
};
type DraftSummary = {
  id: string;
  title: string;
  date: string;
  storyCount: number;
  revision: number;
};
type StoryResponse = {
  work: StoryWorkspace;
  generations: GenerationRun[];
  assets: StudioAsset[];
  costs: { id: string; stage: string; receipt: CostReceipt }[];
};
const editable = (work: StoryWorkspace) => ({
  direction: work.direction,
  stylePackId: work.stylePackId,
  references: work.references,
  manualPrompt: work.manualPrompt,
  presetId: work.presetId,
});

export function useStudioController() {
  const [caps, setCaps] = useState<Caps | null>(null);
  const [drafts, setDrafts] = useState<DraftSummary[]>([]);
  const [styles, setStyles] = useState<StylePack[]>([]);
  const [draft, setDraft] = useState<DraftRecord | null>(null);
  const [storyId, setStoryId] = useState('');
  const [work, setWork] = useState<StoryWorkspace | null>(null);
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [styleAssets, setStyleAssets] = useState<StudioAsset[]>([]);
  const [generations, setGenerations] = useState<GenerationRun[]>([]);
  const [costs, setCosts] = useState<StoryResponse['costs']>([]);
  const [candidates, setCandidates] = useState<SearchCandidate[]>([]);
  const [brokenWeb, setBrokenWeb] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState('Opening Studio');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [dirty, setDirty] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [editInstruction, setEditInstruction] = useState('');
  const [localDraft, setLocalDraft] = useState<NewsletterDraft | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const workRef = useRef<StoryWorkspace | null>(null);
  const dirtyRef = useRef(false);
  const actionInFlight = useRef(false);
  const saveRef = useRef<Promise<StoryWorkspace | null> | null>(null);
  const draftRef = useRef<DraftRecord | null>(null);
  const storyRef = useRef('');
  function installWork(value: StoryWorkspace) {
    workRef.current = value;
    setWork(value);
  }
  function markDirty(value: boolean) {
    dirtyRef.current = value;
    setDirty(value);
  }
  function report(cause: unknown) {
    setError(
      cause instanceof Error ? cause.message : 'The Studio operation failed.',
    );
    if (
      cause instanceof StudioClientError &&
      cause.code === 'revision_conflict'
    )
      setConflict(true);
  }
  async function task(label: string, action: () => Promise<void>) {
    if (actionInFlight.current) return;
    actionInFlight.current = true;
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (cause) {
      report(cause);
    } finally {
      actionInFlight.current = false;
      setBusy('');
    }
  }
  function cache(record: DraftRecord) {
    localStorage.setItem(
      'currentDraft',
      JSON.stringify({
        ...record.payload,
        studioServerRevision: record.revision,
      }),
    );
    localStorage.setItem('studio_last_draft', record.id);
  }
  async function loadLists() {
    const [saved, library] = await Promise.all([
      studioApi<{ drafts: DraftSummary[] }>('drafts'),
      studioApi<{ styles: StylePack[] }>('styles'),
    ]);
    setDrafts(saved.drafts);
    setStyles(library.styles);
    return saved.drafts;
  }
  async function loadStory(
    record: DraftRecord,
    id: string,
    refreshOnly = false,
  ) {
    if (!refreshOnly) {
      storyRef.current = id;
      setStoryId(id);
      setCandidates([]);
      setBrokenWeb(new Set());
      setPreviewId(null);
      setEditInstruction('');
      setConflict(false);
      markDirty(false);
    }
    const response = await studioApi<StoryResponse>(
      `stories/${record.id}/${id}`,
    );
    if (draftRef.current?.id !== record.id || storyRef.current !== id) return;
    if (!refreshOnly || (!dirtyRef.current && !saveRef.current))
      installWork(response.work);
    setAssets(response.assets);
    setGenerations(response.generations);
    setCosts(response.costs);
    const pending = localStorage.getItem(`studio_pending_${record.id}_${id}`);
    setPendingId(pending);
    if (
      pending &&
      response.generations.some(
        (run) => run.id === pending && run.status !== 'running',
      )
    ) {
      localStorage.removeItem(`studio_pending_${record.id}_${id}`);
      setPendingId(null);
    }
  }
  async function openDraft(record: DraftRecord) {
    draftRef.current = record;
    setDraft(record);
    cache(record);
    await loadStory(record, record.payload.stories[0].studioStoryId);
  }
  async function initialize() {
    const available = await studioApi<Caps>('capabilities');
    setCaps(available);
    let parsed: NewsletterDraft | null = null;
    try {
      const raw =
        localStorage.getItem('studio_unsynced_draft') ||
        localStorage.getItem('currentDraft');
      if (raw) parsed = JSON.parse(raw);
    } catch {
      setError(
        'The local draft could not be read. Its original storage entry has been retained.',
      );
    }
    if (parsed) setLocalDraft(parsed);
    if (!available.storage.ready) return;
    const list = await loadLists();
    if (parsed?.stories?.length) {
      try {
        const migrated = upgradeDraft(parsed);
        localStorage.setItem('studio_unsynced_draft', JSON.stringify(migrated));
        const result = await studioApi<{ draft: DraftRecord }>(
          'drafts',
          'POST',
          { draft: migrated, revision: parsed.studioServerRevision ?? null },
        );
        localStorage.removeItem('studio_unsynced_draft');
        setLocalDraft(null);
        await openDraft(result.draft);
        await loadLists();
        return;
      } catch (cause) {
        setNotice(
          'The local draft was retained separately because it could not be synchronized. Open the saved draft or import the local version as a copy.',
        );
        report(cause);
      }
    }
    const preferred = localStorage.getItem('studio_last_draft');
    const first = list.find((item) => item.id === preferred) || list[0];
    if (first)
      await openDraft(
        (await studioApi<{ draft: DraftRecord }>(`drafts/${first.id}`)).draft,
      );
  }
  useEffect(() => {
    void task(
      'Opening Studio',
      initialize,
    ); /* Initial bootstrap uses refs for subsequent actions. */
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  async function flush(): Promise<StoryWorkspace | null> {
    if (saveRef.current) await saveRef.current;
    const snapshot = workRef.current;
    if (!snapshot || !dirtyRef.current) return snapshot;
    const promise = (async () => {
      const response = await studioApi<{ work: StoryWorkspace }>(
        `stories/${snapshot.draftId}/${snapshot.storyId}`,
        'PATCH',
        { ...editable(snapshot), revision: snapshot.revision },
      );
      const current = workRef.current;
      if (
        current?.storyId !== snapshot.storyId ||
        current.draftId !== snapshot.draftId
      )
        return response.work;
      const changedDuringSave =
        JSON.stringify(editable(current)) !==
        JSON.stringify(editable(snapshot));
      installWork(
        changedDuringSave
          ? { ...response.work, ...editable(current) }
          : response.work,
      );
      markDirty(changedDuringSave);
      return response.work;
    })();
    saveRef.current = promise;
    try {
      await promise;
    } finally {
      saveRef.current = null;
    }
    return dirtyRef.current ? flush() : workRef.current;
  }
  useEffect(() => {
    if (!dirty || conflict) return;
    const timer = setTimeout(() => {
      void flush().catch(report);
    }, 750);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, dirty, conflict]);
  const hasRunningGeneration = generations.some(
    (run) => run.status === 'running',
  );
  useEffect(() => {
    if (!draft || !storyId || (!pendingId && !hasRunningGeneration)) return;
    const timer = setInterval(() => {
      const record = draftRef.current;
      if (record) void loadStory(record, storyRef.current, true).catch(report);
    }, 5000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft?.id, storyId, pendingId, hasRunningGeneration]);
  useEffect(() => {
    const id = work?.stylePackId;
    if (!id) {
      setStyleAssets([]);
      return;
    }
    let active = true;
    void studioApi<{ assets: StudioAsset[] }>(`styles/${id}`)
      .then((data) => {
        if (active) setStyleAssets(data.assets);
      })
      .catch(() => {
        if (active) setStyleAssets([]);
      });
    return () => {
      active = false;
    };
  }, [work?.stylePackId]);
  function edit(patch: Partial<StoryWorkspace>) {
    if (!workRef.current) return;
    installWork({ ...workRef.current, ...patch });
    markDirty(true);
  }
  function changeReferenceRole(index: number, role: 'news' | 'subject') {
    const current = workRef.current;
    if (!current) return;
    if (
      current.references.filter((ref, i) => ref.role === role && i !== index)
        .length >= 3
    ) {
      setError(`Use up to three ${role} references.`);
      return;
    }
    edit({
      references: current.references.map((ref, i) =>
        i === index ? { ...ref, role } : ref,
      ),
    });
  }
  async function refresh() {
    const current = draftRef.current;
    if (current) await loadStory(current, storyRef.current, true);
  }
  async function prepare() {
    await flush();
    const current = workRef.current!;
    const result = await studioApi<{ work: StoryWorkspace }>('plans', 'POST', {
      draftId: current.draftId,
      storyId: current.storyId,
    });
    installWork(result.work);
    markDirty(false);
    await refresh();
  }
  async function generate(operation: 'generate' | 'edit') {
    await flush();
    const current = workRef.current!;
    const id = crypto.randomUUID();
    const pendingKey = `studio_pending_${current.draftId}_${current.storyId}`;
    localStorage.setItem(pendingKey, id);
    setPendingId(id);
    try {
      const result = await studioApi<{ run: GenerationRun }>(
        'generations',
        'POST',
        {
          requestId: id,
          draftId: current.draftId,
          storyId: current.storyId,
          presetId: current.presetId,
          operation,
          editSourceId: operation === 'edit' ? shownRun?.id : undefined,
          editInstruction,
        },
      );
      if (result.run.status !== 'running') {
        localStorage.removeItem(pendingKey);
        setPendingId(null);
      }
      setPreviewId(result.run.id);
      await refresh();
      if (result.run.status !== 'complete')
        setError(result.run.error || 'The request is still running.');
      else
        setNotice(
          'Image saved. Select “Use this image” when you want it included in the newsletter.',
        );
    } catch (cause) {
      if (
        cause instanceof StudioClientError &&
        [400, 401, 403, 409, 422, 503].includes(cause.status)
      ) {
        localStorage.removeItem(pendingKey);
        setPendingId(null);
      }
      throw cause;
    }
  }
  async function keepManual() {
    await flush();
    const current = workRef.current!;
    const result = await studioApi<{ work: StoryWorkspace }>(
      `stories/${current.draftId}/${current.storyId}`,
      'PATCH',
      { revision: current.revision, acceptManual: true },
    );
    installWork(result.work);
  }
  async function clear() {
    await flush();
    const current = workRef.current!;
    const result = await studioApi<{ work: StoryWorkspace }>(
      `stories/${current.draftId}/${current.storyId}`,
      'PATCH',
      { revision: current.revision, clear: true },
    );
    installWork(result.work);
    markDirty(false);
    setCandidates([]);
    setBrokenWeb(new Set());
  }
  async function search() {
    await flush();
    const current = workRef.current!;
    const result = await studioApi<{
      images: SearchCandidate[];
      warning?: string;
    }>('references/search', 'POST', {
      draftId: current.draftId,
      storyId: current.storyId,
    });
    setCandidates(result.images);
    setBrokenWeb(new Set());
    if (result.warning) setNotice(result.warning);
  }
  async function addNewsReference(candidate: SearchCandidate) {
    const current = workRef.current!;
    if (current.references.filter((ref) => ref.role === 'news').length >= 3)
      throw new Error(
        'Use up to three news references. Remove one before adding another.',
      );
    const { asset } = await studioApi<{ asset: StudioAsset }>(
      'references/import',
      'POST',
      { draftId: current.draftId, candidate },
    );
    setAssets((old) => [...old.filter((a) => a.id !== asset.id), asset]);
    if (!current.references.some((ref) => ref.assetId === asset.id))
      edit({
        references: [
          ...current.references,
          { assetId: asset.id, role: 'news', note: '' },
        ],
      });
    await flush();
  }
  async function uploadSubjects(files: FileList | null) {
    if (!files?.length) return;
    const current = workRef.current!;
    const remaining =
      3 - current.references.filter((ref) => ref.role === 'subject').length;
    if (files.length > remaining)
      throw new Error(
        `You can add ${remaining} more subject reference${remaining === 1 ? '' : 's'}.`,
      );
    for (const file of Array.from(files)) {
      const asset = await uploadReference(file, 'subject', current.draftId);
      setAssets((old) => [...old.filter((a) => a.id !== asset.id), asset]);
      edit({
        references: [
          ...workRef.current!.references,
          { assetId: asset.id, role: 'subject', note: '' },
        ],
      });
      await flush();
    }
  }
  async function selectRun(run: GenerationRun) {
    await flush();
    const current = workRef.current!;
    const result = await studioApi<{ work: StoryWorkspace }>(
      'selection',
      'POST',
      {
        draftId: current.draftId,
        storyId: current.storyId,
        generationId: run.id,
        revision: current.revision,
      },
    );
    installWork(result.work);
  }
  async function download(assetId: string) {
    const { asset } = await studioApi<{ asset: StudioAsset }>(
      `assets/${assetId}?download=1`,
    );
    if (asset.previewUrl)
      window.open(asset.previewUrl, '_blank', 'noopener,noreferrer');
  }
  async function exportBeehiiv() {
    await flush();
    const response = await fetch('/api/beehiiv/draft', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ studioDraftId: draftRef.current!.id }),
    });
    const data = await response.json();
    if (!response.ok || !data.success)
      throw new Error(data.error || 'Beehiiv export failed.');
    setNotice(
      `Beehiiv draft created${data.postId ? `: ${data.postId}` : ''}.${data.skippedImages?.length ? ` Skipped images: ${data.skippedImages.join(', ')}` : ''}`,
    );
  }
  async function importLocal(copy: boolean) {
    if (!localDraft) return;
    const value: StudioDraft = upgradeDraft(localDraft);
    if (copy) {
      value.studioDraftId = crypto.randomUUID();
      value.stories = value.stories.map((story) => ({
        ...story,
        studioStoryId: crypto.randomUUID(),
      }));
      delete value.studioServerRevision;
    }
    const result = await studioApi<{ draft: DraftRecord }>('drafts', 'POST', {
      draft: value,
      revision: copy ? null : (value.studioServerRevision ?? null),
    });
    localStorage.removeItem('studio_unsynced_draft');
    setLocalDraft(null);
    setConflict(false);
    await openDraft(result.draft);
    await loadLists();
  }
  const story = draft?.payload.stories.find(
    (item) => item.studioStoryId === storyId,
  );
  const stale = Boolean(
    story &&
      work &&
      work.plan &&
      work.plan.inputSignature !== inputSignature(story, work),
  );
  const manualStale = Boolean(
    story && work && isManualPromptStale(story, work),
  );
  const shownRun =
    generations.find((run) => run.id === previewId) ||
    generations.find((run) => run.id === work?.selectedGenerationId) ||
    generations[0];
  const shownAsset = assets.find(
    (asset) =>
      asset.id === (shownRun?.deliveryAssetId || shownRun?.originalAssetId),
  );
  const allReceipts = new Map<string, CostReceipt>();
  costs.forEach((event) => allReceipts.set(event.id, event.receipt));
  generations.forEach((run) =>
    run.costs.forEach((cost, i) =>
      allReceipts.set(cost.id || `${run.id}:${i}`, cost),
    ),
  );
  const total = [...allReceipts.values()].reduce(
    (sum, cost) => sum + (cost.amountUsd || 0),
    0,
  );
  const unknownCost = [...allReceipts.values()].some(
    (cost) => cost.amountUsd === null,
  );
  const canGenerate = Boolean(
    caps?.planner.configured &&
      caps.presets.find((p) => p.id === work?.presetId)?.configured &&
      !manualStale &&
      !conflict,
  );

  return {
    caps,
    drafts,
    styles,
    draft,
    storyId,
    work,
    assets,
    styleAssets,
    generations,
    candidates,
    brokenWeb,
    busy,
    error,
    notice,
    dirty,
    conflict,
    libraryOpen,
    editInstruction,
    localDraft,
    pendingId,
    workRef,
    setLibraryOpen,
    setError,
    setNotice,
    setPendingId,
    setPreviewId,
    setEditInstruction,
    setConflict,
    setBrokenWeb,
    task,
    initialize,
    loadLists,
    openDraft,
    loadStory,
    flush,
    edit,
    prepare,
    generate,
    keepManual,
    clear,
    search,
    addNewsReference,
    uploadSubjects,
    selectRun,
    download,
    exportBeehiiv,
    importLocal,
    changeReferenceRole,
    markDirty,
    story,
    stale,
    manualStale,
    shownRun,
    shownAsset,
    total,
    unknownCost,
    canGenerate,
  };
}
export type StudioController = ReturnType<typeof useStudioController>;
