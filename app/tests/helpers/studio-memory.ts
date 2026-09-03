import type {
  StudioRepository,
  UsageEvent,
} from '../../src/lib/studio/repository';
import type {
  CostReceipt,
  DraftRecord,
  GenerationRun,
  StoryWorkspace,
  StudioAsset,
  StudioDraft,
  StylePack,
} from '../../src/lib/studio/types';
import { StudioError } from '../../src/lib/studio/errors';

export class MemoryStudioRepository implements StudioRepository {
  drafts = new Map<string, DraftRecord>();
  works = new Map<string, StoryWorkspace>();
  assets = new Map<string, StudioAsset>();
  styles = new Map<string, StylePack>();
  runs = new Map<string, GenerationRun>();
  objects = new Map<string, Buffer>();
  published = new Map<string, Buffer>();
  usage = new Map<string, UsageEvent>();
  async checkReady() {}
  async listDrafts() {
    return structuredClone([...this.drafts.values()]);
  }
  async getDraft(id: string) {
    return structuredClone(this.drafts.get(id) || null);
  }
  async saveDraft(draft: StudioDraft, revision: number | null) {
    const existing = this.drafts.get(draft.studioDraftId);
    if ((existing?.revision ?? null) !== revision)
      throw new StudioError('revision_conflict', 'Conflict', 409);
    const record = {
      id: draft.studioDraftId,
      payload: draft,
      revision: (revision || 0) + 1,
      updatedAt: new Date().toISOString(),
    };
    this.drafts.set(record.id, structuredClone(record));
    return structuredClone(record);
  }
  async getWorkspace(draftId: string, storyId: string) {
    return structuredClone(this.works.get(`${draftId}:${storyId}`) || null);
  }
  async saveWorkspace(work: StoryWorkspace, revision: number | null) {
    const key = `${work.draftId}:${work.storyId}`;
    const existing = this.works.get(key);
    if ((existing?.revision ?? null) !== revision)
      throw new StudioError('revision_conflict', 'Conflict', 409);
    const next = { ...work, revision: (revision || 0) + 1 };
    this.works.set(key, structuredClone(next));
    return structuredClone(next);
  }
  async getAssets(ids: string[]) {
    return structuredClone(
      ids.flatMap((id) => (this.assets.has(id) ? [this.assets.get(id)!] : [])),
    );
  }
  async listAssets(draftId: string | null) {
    return structuredClone(
      [...this.assets.values()].filter((asset) => asset.draftId === draftId),
    );
  }
  async putAsset(asset: StudioAsset) {
    this.assets.set(asset.id, structuredClone(asset));
  }
  async listStyles() {
    return structuredClone([...this.styles.values()]);
  }
  async insertStyle(style: StylePack) {
    this.styles.set(style.id, structuredClone(style));
  }
  async activateStyle(id: string) {
    this.styles.forEach((style) => {
      style.active = style.id === id;
    });
  }
  async getGeneration(id: string) {
    return structuredClone(this.runs.get(id) || null);
  }
  async listGenerations(draftId: string, storyId: string) {
    return structuredClone(
      [...this.runs.values()].filter(
        (run) => run.draftId === draftId && run.storyId === storyId,
      ),
    );
  }
  async claimGeneration(run: GenerationRun) {
    const existing = this.runs.get(run.id);
    if (existing) {
      if (existing.requestHash !== run.requestHash)
        throw new StudioError('request_conflict', 'Conflict', 409);
      return { claimed: false, run: structuredClone(existing) };
    }
    this.runs.set(run.id, structuredClone(run));
    return { claimed: true, run: structuredClone(run) };
  }
  async saveGeneration(run: GenerationRun) {
    this.runs.set(run.id, structuredClone(run));
  }
  async recordCost(
    _draftId: string | null,
    _storyId: string | null,
    stage: string,
    receipt: CostReceipt,
  ) {
    const id = receipt.id || crypto.randomUUID();
    if (!this.usage.has(id))
      this.usage.set(id, {
        id,
        stage,
        receipt,
        createdAt: new Date().toISOString(),
      });
  }
  async getCosts() {
    return structuredClone([...this.usage.values()]);
  }
  async putObject(
    path: string,
    bytes: Buffer,
    _mime: string,
    published = false,
  ) {
    (published ? this.published : this.objects).set(path, Buffer.from(bytes));
  }
  async getObject(path: string) {
    const bytes = this.objects.get(path);
    if (!bytes)
      throw new StudioError('asset_unavailable', 'Missing bytes', 422);
    return Buffer.from(bytes);
  }
  async signObject(path: string) {
    return `https://private.example/${path}?token=temporary`;
  }
  async uploadTicket(path: string) {
    return { signedUrl: `https://upload.example/${path}`, token: 'test', path };
  }
  publicUrl(path: string) {
    return `https://public.example/${path}`;
  }
}
