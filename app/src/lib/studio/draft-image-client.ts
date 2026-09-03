import type {
  DraftRecord,
  GenerationRun,
  StudioAsset,
  StudioDraft,
} from './types';

export interface DraftImageSummary {
  storyId: string;
  selected: GenerationRun | null;
  latest: GenerationRun | null;
  revision: number | null;
}
export interface DraftImageStatus {
  stories: DraftImageSummary[];
  assets: StudioAsset[];
}
type Api = <T>(path: string, method?: string, body?: unknown) => Promise<T>;
type LocalDraftStorage = Pick<Storage, 'getItem' | 'setItem'>;

// Page-lifetime coordinator. Reads are side-effect free; only explicit actions
// enter generate/refine. Draft CAS writes are serial, image requests are not.
export class DraftImageClient {
  private saveTail: Promise<unknown> = Promise.resolve();
  private active = new Map<string, Promise<{ run: GenerationRun }>>();
  constructor(
    private storage: LocalDraftStorage,
    private api: Api,
  ) {}

  draft(): StudioDraft | null {
    const raw = this.storage.getItem('currentDraft');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StudioDraft;
    return parsed.studioDraftId && Array.isArray(parsed.stories)
      ? parsed
      : null;
  }
  sync(): Promise<DraftRecord> {
    const result = this.saveTail
      .catch(() => undefined)
      .then(async () => {
        const draft = this.draft();
        if (!draft)
          throw new Error('Save the newsletter body before generating images.');
        const result = await this.api<{ draft: DraftRecord }>(
          'drafts',
          'POST',
          {
            draft,
            revision: draft.studioServerRevision ?? null,
          },
        );
        const latest = this.draft();
        if (latest?.studioDraftId === draft.studioDraftId) {
          // Never replace content with the older snapshot returned by a slow save.
          this.storage.setItem(
            'currentDraft',
            JSON.stringify({
              ...latest,
              studioServerRevision: result.draft.revision,
            }),
          );
        }
        return result.draft;
      });
    this.saveTail = result;
    return result;
  }
  async load(): Promise<DraftImageStatus> {
    const draft = this.draft();
    if (!draft) return { stories: [], assets: [] };
    return this.api<DraftImageStatus>(`drafts/${draft.studioDraftId}/images`);
  }
  generate(storyId: string, retryId?: string) {
    return this.run(storyId, async (draftId) =>
      this.api<{ run: GenerationRun }>('generations/missing', 'POST', {
        draftId,
        storyId,
        retryId,
      }),
    );
  }
  refine(storyId: string, source: GenerationRun, instruction: string) {
    if (!instruction.trim())
      return Promise.reject(new Error('Describe what you want to change.'));
    return this.run(storyId, async (draftId) =>
      this.api<{ run: GenerationRun }>('generations', 'POST', {
        draftId,
        storyId,
        requestId: crypto.randomUUID(),
        presetId: source.presetId,
        operation: 'edit',
        editSourceId: source.id,
        editInstruction: instruction,
      }),
    );
  }
  private run(
    storyId: string,
    action: (draftId: string) => Promise<{ run: GenerationRun }>,
  ) {
    const draftId = this.draft()?.studioDraftId;
    const key = `${draftId}:${storyId}`;
    const active = this.active.get(key);
    if (active) return active;
    const promise = this.sync()
      .then((draft) => {
        if (
          draft.id !== draftId ||
          !draft.payload.stories.some(
            (story) => story.studioStoryId === storyId,
          )
        )
          throw new Error(
            'The newsletter selection changed. No image request was sent.',
          );
        return action(draft.id);
      })
      .finally(() => {
        this.active.delete(key);
      });
    this.active.set(key, promise);
    return promise;
  }
}
