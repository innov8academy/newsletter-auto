import 'server-only';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { StudioError } from './errors';
import type {
  CostReceipt,
  DraftRecord,
  GenerationRun,
  StoryWorkspace,
  StudioAsset,
  StudioDraft,
  StylePack,
} from './types';

export const PRIVATE_BUCKET = 'l8r-studio-private';
export const PUBLIC_BUCKET = 'l8r-newsletter-images';
export interface UsageEvent {
  id: string;
  stage: string;
  receipt: CostReceipt;
  createdAt: string;
}
export interface StudioRepository {
  listDrafts(): Promise<DraftRecord[]>;
  getDraft(id: string): Promise<DraftRecord | null>;
  saveDraft(draft: StudioDraft, revision: number | null): Promise<DraftRecord>;
  getWorkspace(
    draftId: string,
    storyId: string,
  ): Promise<StoryWorkspace | null>;
  saveWorkspace(
    work: StoryWorkspace,
    revision: number | null,
  ): Promise<StoryWorkspace>;
  getAssets(ids: string[]): Promise<StudioAsset[]>;
  listAssets(draftId: string | null): Promise<StudioAsset[]>;
  putAsset(asset: StudioAsset): Promise<void>;
  listStyles(): Promise<StylePack[]>;
  insertStyle(pack: StylePack): Promise<void>;
  activateStyle(id: string): Promise<void>;
  getGeneration(id: string): Promise<GenerationRun | null>;
  listGenerations(draftId: string, storyId: string): Promise<GenerationRun[]>;
  claimGeneration(
    run: GenerationRun,
  ): Promise<{ claimed: boolean; run: GenerationRun }>;
  saveGeneration(run: GenerationRun): Promise<void>;
  recordCost(
    draftId: string | null,
    storyId: string | null,
    stage: string,
    cost: CostReceipt,
  ): Promise<void>;
  getCosts(draftId: string): Promise<UsageEvent[]>;
  putObject(
    path: string,
    bytes: Buffer,
    mimeType: string,
    published?: boolean,
  ): Promise<void>;
  getObject(path: string): Promise<Buffer>;
  signObject(path: string, download?: string): Promise<string>;
  uploadTicket(
    path: string,
  ): Promise<{ signedUrl: string; token: string; path: string }>;
  publicUrl(path: string): string;
  checkReady(): Promise<void>;
}
function fail(error: { code?: string; message?: string } | null) {
  if (!error) return;
  if (['42P01', 'PGRST205', '42883', 'PGRST202'].includes(error.code || ''))
    throw new StudioError(
      'migration_required',
      'Image Studio storage is not installed. Apply migration 003_image_studio_v2.sql.',
      503,
    );
  throw new StudioError(
    'storage_unavailable',
    'Studio storage is unavailable. No unsaved work was overwritten.',
    503,
  );
}
function draftRow(row: {
  id: string;
  payload: StudioDraft;
  revision: number;
  updated_at: string;
}): DraftRecord {
  return {
    id: row.id,
    payload: row.payload,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
}
export class SupabaseStudioRepository implements StudioRepository {
  private db: SupabaseClient;
  constructor(env: NodeJS.ProcessEnv = process.env) {
    if (!env.NEXT_PUBLIC_SUPABASE_URL || !env.SUPABASE_SERVICE_ROLE_KEY)
      throw new StudioError(
        'storage_not_configured',
        'Configure the Supabase URL and server service key for Image Studio.',
        503,
      );
    this.db = createClient(
      env.NEXT_PUBLIC_SUPABASE_URL,
      env.SUPABASE_SERVICE_ROLE_KEY,
      {
        auth: { persistSession: false, autoRefreshToken: false },
        global: {
          fetch: (input, init) =>
            fetch(input, {
              ...init,
              signal: init?.signal
                ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
                : AbortSignal.timeout(15_000),
            }),
        },
      },
    );
  }
  async checkReady() {
    for (const table of [
      'studio_drafts',
      'studio_assets',
      'studio_style_packs',
      'studio_generations',
      'studio_story_workspaces',
      'studio_usage_events',
    ]) {
      const { error } = await this.db
        .from(table)
        .select(table === 'studio_story_workspaces' ? 'draft_id' : 'id')
        .limit(1);
      fail(error);
    }
    const { data, error } = await this.db.storage.getBucket(PRIVATE_BUCKET);
    if (error || !data || data.public)
      throw new StudioError(
        'storage_not_ready',
        'The private Studio bucket is missing or has incorrect access settings.',
        503,
      );
    const published = await this.db.storage.getBucket(PUBLIC_BUCKET);
    if (published.error || !published.data?.public)
      throw new StudioError(
        'storage_not_ready',
        'The newsletter delivery bucket is missing or has incorrect access settings.',
        503,
      );
  }
  async listDrafts() {
    const { data, error } = await this.db
      .from('studio_drafts')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(100);
    fail(error);
    return (data || []).map(draftRow);
  }
  async getDraft(id: string) {
    const { data, error } = await this.db
      .from('studio_drafts')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    fail(error);
    return data ? draftRow(data) : null;
  }
  async saveDraft(draft: StudioDraft, revision: number | null) {
    const row = {
      id: draft.studioDraftId,
      payload: draft,
      revision: (revision || 0) + 1,
      updated_at: new Date().toISOString(),
    };
    const query =
      revision === null
        ? this.db.from('studio_drafts').insert(row)
        : this.db
            .from('studio_drafts')
            .update(row)
            .eq('id', row.id)
            .eq('revision', revision);
    const { data, error } = await query.select('*').maybeSingle();
    if (error?.code === '23505' || (!error && !data))
      throw new StudioError(
        'revision_conflict',
        'This draft changed in another browser. Reload its saved version before saving again.',
        409,
      );
    fail(error);
    return draftRow(data!);
  }
  async getWorkspace(draftId: string, storyId: string) {
    const { data, error } = await this.db
      .from('studio_story_workspaces')
      .select('*')
      .eq('draft_id', draftId)
      .eq('story_id', storyId)
      .maybeSingle();
    fail(error);
    return data
      ? ({ ...data.payload, revision: data.revision } as StoryWorkspace)
      : null;
  }
  async saveWorkspace(work: StoryWorkspace, revision: number | null) {
    const next = { ...work, revision: (revision || 0) + 1 };
    const row = {
      draft_id: next.draftId,
      story_id: next.storyId,
      payload: next,
      revision: next.revision,
      updated_at: new Date().toISOString(),
    };
    const query =
      revision === null
        ? this.db.from('studio_story_workspaces').insert(row)
        : this.db
            .from('studio_story_workspaces')
            .update(row)
            .eq('draft_id', row.draft_id)
            .eq('story_id', row.story_id)
            .eq('revision', revision);
    const { data, error } = await query.select('revision').maybeSingle();
    if (error?.code === '23505' || (!error && !data))
      throw new StudioError(
        'revision_conflict',
        'This story changed in another browser. Reload it to resolve the conflict; your local edits are retained.',
        409,
      );
    fail(error);
    return next;
  }
  async getAssets(ids: string[]) {
    if (!ids.length) return [];
    const { data, error } = await this.db
      .from('studio_assets')
      .select('payload')
      .in('id', ids);
    fail(error);
    return (data || []).map((row) => row.payload as StudioAsset);
  }
  async listAssets(draftId: string | null) {
    let q = this.db
      .from('studio_assets')
      .select('payload')
      .order('created_at', { ascending: false });
    q = draftId ? q.eq('draft_id', draftId) : q.is('draft_id', null);
    const { data, error } = await q.limit(500);
    fail(error);
    return (data || []).map((row) => row.payload as StudioAsset);
  }
  async putAsset(asset: StudioAsset) {
    const { error } = await this.db.from('studio_assets').upsert({
      id: asset.id,
      draft_id: asset.draftId,
      role: asset.role,
      checksum: asset.checksum,
      payload: { ...asset, previewUrl: undefined },
      created_at: asset.createdAt,
    });
    fail(error);
  }
  async listStyles() {
    const { data, error } = await this.db
      .from('studio_style_packs')
      .select('*')
      .order('created_at', { ascending: false });
    fail(error);
    return (data || []).map(
      (row) => ({ ...row.payload, active: row.active }) as StylePack,
    );
  }
  async insertStyle(pack: StylePack) {
    const { error } = await this.db.from('studio_style_packs').insert({
      id: pack.id,
      slug: pack.slug,
      version: pack.version,
      payload: pack,
      active: false,
      created_at: pack.createdAt,
    });
    if (error?.code === '23505')
      throw new StudioError(
        'style_version_conflict',
        'This style version already exists. Reload the library and try again.',
        409,
      );
    fail(error);
  }
  async activateStyle(id: string) {
    const { error } = await this.db.rpc('studio_activate_style_pack', {
      pack_id: id,
    });
    fail(error);
  }
  async getGeneration(id: string) {
    const { data, error } = await this.db
      .from('studio_generations')
      .select('payload')
      .eq('id', id)
      .maybeSingle();
    fail(error);
    return (data?.payload as GenerationRun) || null;
  }
  async listGenerations(draftId: string, storyId: string) {
    const { data, error } = await this.db
      .from('studio_generations')
      .select('payload')
      .eq('draft_id', draftId)
      .eq('story_id', storyId)
      .order('started_at', { ascending: false })
      .limit(100);
    fail(error);
    return (data || []).map((row) => row.payload as GenerationRun);
  }
  async claimGeneration(run: GenerationRun) {
    const { error } = await this.db.from('studio_generations').insert({
      id: run.id,
      draft_id: run.draftId,
      story_id: run.storyId,
      request_hash: run.requestHash,
      status: run.status,
      payload: run,
      started_at: run.startedAt,
    });
    if (error?.code === '23505') {
      const existing = await this.getGeneration(run.id);
      if (!existing || existing.requestHash !== run.requestHash)
        throw new StudioError(
          'request_conflict',
          'This request ID belongs to a different generation.',
          409,
        );
      return { claimed: false, run: existing };
    }
    fail(error);
    return { claimed: true, run };
  }
  async saveGeneration(run: GenerationRun) {
    const { error } = await this.db
      .from('studio_generations')
      .update({ status: run.status, payload: run })
      .eq('id', run.id)
      .eq('request_hash', run.requestHash);
    fail(error);
  }
  async recordCost(
    draftId: string | null,
    storyId: string | null,
    stage: string,
    cost: CostReceipt,
  ) {
    const { error } = await this.db.from('studio_usage_events').upsert(
      {
        id: cost.id || crypto.randomUUID(),
        draft_id: draftId,
        story_id: storyId,
        stage,
        receipt: cost,
      },
      { onConflict: 'id', ignoreDuplicates: true },
    );
    fail(error);
  }
  async getCosts(draftId: string) {
    const { data, error } = await this.db
      .from('studio_usage_events')
      .select('*')
      .eq('draft_id', draftId)
      .order('created_at');
    fail(error);
    return (data || []).map((row) => ({
      id: row.id,
      stage: row.stage,
      receipt: row.receipt,
      createdAt: row.created_at,
    })) as UsageEvent[];
  }
  async putObject(
    path: string,
    bytes: Buffer,
    mimeType: string,
    published = false,
  ) {
    const { error } = await this.db.storage
      .from(published ? PUBLIC_BUCKET : PRIVATE_BUCKET)
      .upload(path, bytes, {
        contentType: mimeType,
        upsert: true,
        cacheControl: published ? '31536000' : '3600',
      });
    if (error)
      throw new StudioError(
        'asset_save_failed',
        'The image could not be saved to storage.',
        503,
      );
  }
  async getObject(path: string) {
    const { data, error } = await this.db.storage
      .from(PRIVATE_BUCKET)
      .download(path);
    if (error || !data)
      throw new StudioError(
        'asset_unavailable',
        'A selected reference could not be loaded. Remove or replace it before generating.',
        422,
      );
    return Buffer.from(await data.arrayBuffer());
  }
  async signObject(path: string, download?: string) {
    const { data, error } = await this.db.storage
      .from(PRIVATE_BUCKET)
      .createSignedUrl(path, 3600, download ? { download } : {});
    if (error || !data)
      throw new StudioError(
        'preview_unavailable',
        'Could not refresh the private image preview.',
        503,
      );
    return data.signedUrl;
  }
  async uploadTicket(path: string) {
    const { data, error } = await this.db.storage
      .from(PRIVATE_BUCKET)
      .createSignedUploadUrl(path);
    if (error || !data)
      throw new StudioError(
        'upload_unavailable',
        'Could not create a private upload.',
        503,
      );
    return { signedUrl: data.signedUrl, token: data.token, path };
  }
  publicUrl(path: string) {
    return this.db.storage.from(PUBLIC_BUCKET).getPublicUrl(path).data
      .publicUrl;
  }
}
