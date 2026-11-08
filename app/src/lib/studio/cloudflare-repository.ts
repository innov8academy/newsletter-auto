import 'server-only';
import { callL8RData } from '../cloudflare-data';
import { StudioError } from './errors';
import { R2ObjectStore } from './r2-object-store';
import type { StudioRepository, UsageEvent } from './repository';
import type { CostReceipt, DraftRecord, GenerationRun, StoryWorkspace, StudioAsset, StudioDraft, StylePack } from './types';

type Scalar = string | number | null;
type Row = Record<string, unknown>;
type QueryResult = { rows: Row[]; changes: number };
type DataCall = <T>(request: Record<string, unknown>) => Promise<T>;
type ObjectStore = Pick<R2ObjectStore, 'checkReady' | 'putObject' | 'getObject' | 'signObject' | 'uploadTicket' | 'publicUrl'>;

function parse<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T;
}
function draftRow(row: Row): DraftRecord {
  return { id: row.id as string, payload: parse<StudioDraft>(row.payload), revision: row.revision as number, updatedAt: row.updated_at as string };
}
function storageError(): StudioError {
  return new StudioError('storage_unavailable', 'Studio storage is unavailable. No unsaved work was overwritten.', 503);
}

export class CloudflareStudioRepository implements StudioRepository {
  constructor(
    private readonly data: DataCall = callL8RData,
    private readonly objects: ObjectStore = new R2ObjectStore(),
  ) {}

  private async query(sql: string, params: Scalar[] = []): Promise<QueryResult> {
    try { return await this.data<QueryResult>({ op: 'query', sql, params }); }
    catch { throw storageError(); }
  }
  async checkReady(): Promise<void> {
    try {
      const health = await this.data<{ ready: boolean }>({ op: 'health' });
      if (!health.ready) throw new Error('Database not ready');
      await this.objects.checkReady();
    } catch { throw new StudioError('storage_not_ready', 'Studio storage is not ready.', 503); }
  }
  async listDrafts(): Promise<DraftRecord[]> {
    const result = await this.query('SELECT * FROM studio_drafts ORDER BY updated_at DESC LIMIT 100');
    return result.rows.map(draftRow);
  }
  async getDraft(id: string): Promise<DraftRecord | null> {
    const result = await this.query('SELECT * FROM studio_drafts WHERE id=?', [id]);
    return result.rows[0] ? draftRow(result.rows[0]) : null;
  }
  async saveDraft(draft: StudioDraft, revision: number | null): Promise<DraftRecord> {
    let result: Row;
    try { result = await this.data<Row>({ op: 'newsletter_studio_save', body: draft, expectedRevision: revision }); }
    catch { throw storageError(); }
    if (result.choiceRequired) throw new StudioError('draft_recovery_required', 'Review the preserved draft versions in Current newsletter before editing images.', 409);
    if (result.conflict) throw new StudioError('revision_conflict', 'This draft changed in another browser. Reload its saved version before saving again.', 409);
    return draftRow(result);
  }
  async getWorkspace(draftId: string, storyId: string): Promise<StoryWorkspace | null> {
    const result = await this.query('SELECT payload,revision FROM studio_story_workspaces WHERE draft_id=? AND story_id=?', [draftId, storyId]);
    const row = result.rows[0];
    return row ? { ...parse<StoryWorkspace>(row.payload), revision: row.revision as number } : null;
  }
  async saveWorkspace(work: StoryWorkspace, revision: number | null): Promise<StoryWorkspace> {
    const next = { ...work, revision: (revision || 0) + 1 };
    const now = new Date().toISOString();
    const result = revision === null
      ? await this.query('INSERT OR IGNORE INTO studio_story_workspaces(draft_id,story_id,payload,revision,updated_at) VALUES(?,?,?,?,?)', [work.draftId, work.storyId, JSON.stringify(next), next.revision, now])
      : await this.query('UPDATE studio_story_workspaces SET payload=?,revision=?,updated_at=? WHERE draft_id=? AND story_id=? AND revision=?', [JSON.stringify(next), next.revision, now, work.draftId, work.storyId, revision]);
    if (result.changes !== 1) throw new StudioError('revision_conflict', 'This story changed in another browser. Reload it to resolve the conflict; your local edits are retained.', 409);
    return next;
  }
  async getAssets(ids: string[]): Promise<StudioAsset[]> {
    if (!ids.length) return [];
    const assets: StudioAsset[] = [];
    for (let index = 0; index < ids.length; index += 100) {
      const chunk = ids.slice(index, index + 100);
      const result = await this.query(`SELECT payload FROM studio_assets WHERE id IN (${chunk.map(() => '?').join(',')})`, chunk);
      assets.push(...result.rows.map((row) => parse<StudioAsset>(row.payload)));
    }
    return assets;
  }
  async listAssets(draftId: string | null): Promise<StudioAsset[]> {
    const result = draftId
      ? await this.query('SELECT payload FROM studio_assets WHERE draft_id=? ORDER BY created_at DESC LIMIT 500', [draftId])
      : await this.query('SELECT payload FROM studio_assets WHERE draft_id IS NULL ORDER BY created_at DESC LIMIT 500');
    return result.rows.map((row) => parse<StudioAsset>(row.payload));
  }
  async putAsset(asset: StudioAsset): Promise<void> {
    const { previewUrl: _previewUrl, ...payload } = asset;
    await this.query('INSERT INTO studio_assets(id,draft_id,role,checksum,payload,created_at) VALUES(?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET draft_id=excluded.draft_id,role=excluded.role,checksum=excluded.checksum,payload=excluded.payload,created_at=excluded.created_at', [asset.id, asset.draftId, asset.role, asset.checksum, JSON.stringify(payload), asset.createdAt]);
  }
  async listStyles(): Promise<StylePack[]> {
    const result = await this.query('SELECT payload,active FROM studio_style_packs ORDER BY created_at DESC');
    return result.rows.map((row) => ({ ...parse<StylePack>(row.payload), active: row.active === 1 }));
  }
  async insertStyle(pack: StylePack): Promise<void> {
    const result = await this.query('INSERT OR IGNORE INTO studio_style_packs(id,slug,version,payload,active,created_at) VALUES(?,?,?,?,0,?)', [pack.id, pack.slug, pack.version, JSON.stringify(pack), pack.createdAt]);
    if (result.changes !== 1) throw new StudioError('style_version_conflict', 'This style version already exists. Reload the library and try again.', 409);
  }
  async activateStyle(id: string): Promise<void> {
    try { await this.data({ op: 'activate_style', packId: id }); }
    catch { throw storageError(); }
  }
  async getGeneration(id: string): Promise<GenerationRun | null> {
    const result = await this.query('SELECT payload FROM studio_generations WHERE id=?', [id]);
    return result.rows[0] ? parse<GenerationRun>(result.rows[0].payload) : null;
  }
  async listGenerations(draftId: string, storyId: string): Promise<GenerationRun[]> {
    const result = await this.query('SELECT payload FROM studio_generations WHERE draft_id=? AND story_id=? ORDER BY started_at DESC LIMIT 100', [draftId, storyId]);
    return result.rows.map((row) => parse<GenerationRun>(row.payload));
  }
  async claimGeneration(run: GenerationRun): Promise<{ claimed: boolean; run: GenerationRun }> {
    const result = await this.query('INSERT OR IGNORE INTO studio_generations(id,draft_id,story_id,request_hash,status,payload,started_at) VALUES(?,?,?,?,?,?,?)', [run.id, run.draftId, run.storyId, run.requestHash, run.status, JSON.stringify(run), run.startedAt]);
    if (result.changes === 1) return { claimed: true, run };
    const existing = await this.getGeneration(run.id);
    if (!existing || existing.requestHash !== run.requestHash)
      throw new StudioError('request_conflict', 'This request ID belongs to a different generation.', 409);
    return { claimed: false, run: existing };
  }
  async saveGeneration(run: GenerationRun): Promise<void> {
    await this.query('UPDATE studio_generations SET status=?,payload=? WHERE id=? AND request_hash=?', [run.status, JSON.stringify(run), run.id, run.requestHash]);
  }
  async recordCost(draftId: string | null, storyId: string | null, stage: string, cost: CostReceipt): Promise<void> {
    const id = cost.id || crypto.randomUUID();
    await this.query('INSERT OR IGNORE INTO studio_usage_events(id,draft_id,story_id,stage,receipt,created_at) VALUES(?,?,?,?,?,?)', [id, draftId, storyId, stage, JSON.stringify(cost), new Date().toISOString()]);
  }
  async getCosts(draftId: string): Promise<UsageEvent[]> {
    const result = await this.query('SELECT id,stage,receipt,created_at FROM studio_usage_events WHERE draft_id=? ORDER BY created_at', [draftId]);
    return result.rows.map((row) => ({ id: row.id as string, stage: row.stage as string, receipt: parse<CostReceipt>(row.receipt), createdAt: row.created_at as string }));
  }
  putObject(path: string, bytes: Buffer, mimeType: string, published = false): Promise<void> { return this.objects.putObject(path, bytes, mimeType, published); }
  getObject(path: string): Promise<Buffer> { return this.objects.getObject(path); }
  signObject(path: string, download?: string): Promise<string> { return this.objects.signObject(path, download); }
  uploadTicket(path: string): Promise<{ signedUrl: string; token: string; path: string }> { return this.objects.uploadTicket(path); }
  publicUrl(path: string): string { return this.objects.publicUrl(path); }
}
