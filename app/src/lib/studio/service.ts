import 'server-only';
import { createHash } from 'node:crypto';
import { StudioError, record, string, uuid } from './errors';
import {
  emptyWorkspace,
  clearWorkspace,
  inputSignature,
  isManualPromptStale,
  upgradeDraft,
} from './state';
import { DEFAULT_PRESET, PRESETS, presetId } from './models';
import {
  buildRenderPrompt,
  hash,
  inspectImage,
  manifest,
  planImage,
} from './prompts';
import { renderImage } from './providers';
import { IMAGE_PROMPT_VERSION, selectStyleAnchors } from './editorial-style';
import { findNewsReferences, importNewsReferences } from './search';
import {
  downloadPublicImage,
  MAX_UPLOAD_BYTES,
  normalizeReference,
  prepareOutput,
} from './media';
import type { StudioRepository } from './repository';
import type {
  BufferedReference,
  GenerationRun,
  ReferenceSelection,
  StudioAsset,
} from './types';
import type { NewsletterDraft } from '../draft-generator';

export function stableId(value: string): string {
  const hex = createHash('sha256').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function recoverStatus(
  run: GenerationRun,
  now = Date.now(),
): GenerationRun {
  return run.status === 'running' && now - Date.parse(run.startedAt) > 360_000
    ? {
        ...run,
        status: 'interrupted',
        error:
          'This request no longer has a confirmed outcome. Check provider history before starting a new paid request.',
      }
    : run;
}
async function retrySave(action: () => Promise<void>) {
  for (let attempt = 0; ; attempt++) {
    try {
      await action();
      return;
    } catch (error) {
      if (attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 300 * (attempt + 1)));
    }
  }
}
const defaultDependencies = {
  planImage,
  renderImage,
  inspectImage,
  downloadPublicImage,
  findNewsReferences,
};

export class StudioService {
  private deps: typeof defaultDependencies;
  constructor(
    public repo: StudioRepository,
    deps: Partial<typeof defaultDependencies> = {},
  ) {
    this.deps = { ...defaultDependencies, ...deps };
  }
  async context(draftId: string, storyId: string) {
    const draft = await this.repo.getDraft(uuid(draftId));
    const story = draft?.payload.stories.find(
      (story) => story.studioStoryId === uuid(storyId),
    );
    if (!draft || !story)
      throw new StudioError(
        'story_not_found',
        'This story is not in the saved draft.',
        404,
      );
    let work = await this.repo.getWorkspace(draftId, storyId);
    if (!work) {
      const styles = await this.repo.listStyles();
      try {
        work = await this.repo.saveWorkspace(
          emptyWorkspace(
            draftId,
            storyId,
            styles.find((style) => style.active)?.id || null,
          ),
          null,
        );
      } catch (error) {
        if (
          !(error instanceof StudioError) ||
          error.code !== 'revision_conflict'
        )
          throw error;
        work = await this.repo.getWorkspace(draftId, storyId);
      }
    }
    if (!work)
      throw new StudioError(
        'storage_unavailable',
        'The story workspace could not be opened.',
        503,
      );
    return { draft, story, work };
  }
  async importDraft(value: NewsletterDraft, revision: number | null) {
    const draft = upgradeDraft(value);
    delete draft.studioServerRevision;
    if (JSON.stringify(draft).length > 3_500_000)
      throw new StudioError(
        'draft_too_large',
        'The draft contains oversized embedded images. Download a backup and remove embedded images before importing.',
      );
    const existing = await this.repo.getDraft(draft.studioDraftId);
    if (existing && JSON.stringify(existing.payload) === JSON.stringify(draft))
      return existing;
    if (existing && revision === null) {
      throw new StudioError(
        'revision_conflict',
        'A saved version of this draft already exists. Open it, or import the local draft as a separate copy.',
        409,
      );
    }
    return this.repo.saveDraft(draft, revision);
  }
  async saveWork(draftId: string, storyId: string, value: unknown) {
    const { story, work } = await this.context(draftId, storyId);
    const patch = record(value);
    if (patch.revision !== work.revision)
      throw new StudioError(
        'revision_conflict',
        'This story changed elsewhere. Reload it before saving; your local changes are retained.',
        409,
      );
    if (patch.clear === true)
      return this.repo.saveWorkspace(clearWorkspace(work), work.revision);
    const next = { ...work };
    if ('styleDisabled' in patch) {
      if (typeof patch.styleDisabled !== 'boolean')
        throw new StudioError(
          'invalid_style',
          'Choose a style or explicitly select None.',
        );
      next.styleDisabled = patch.styleDisabled;
    }
    if ('direction' in patch)
      next.direction = string(patch.direction, 'Direction', 5000);
    if ('stylePackId' in patch) {
      next.stylePackId =
        patch.stylePackId === null ? null : uuid(patch.stylePackId);
      if (next.stylePackId) next.styleDisabled = false;
      if (
        next.stylePackId &&
        !(await this.repo.listStyles()).some(
          (style) => style.id === next.stylePackId,
        )
      )
        throw new StudioError(
          'style_not_found',
          'Choose an existing style version.',
        );
    }
    if ('presetId' in patch) next.presetId = presetId(patch.presetId);
    if ('references' in patch) {
      if (!Array.isArray(patch.references) || patch.references.length > 6)
        throw new StudioError(
          'too_many_references',
          'Choose up to three news and three subject references.',
        );
      next.references = patch.references.map((value) => {
        const ref = record(value);
        if (ref.role !== 'news' && ref.role !== 'subject')
          throw new StudioError(
            'invalid_role',
            'Choose the news or subject role.',
          );
        return {
          assetId: uuid(ref.assetId),
          role: ref.role,
          note: string(ref.note ?? '', 'Reference note', 1000),
        } as ReferenceSelection;
      });
      if (
        new Set(next.references.map((ref) => ref.assetId)).size !==
          next.references.length ||
        ['news', 'subject'].some(
          (role) =>
            next.references.filter((ref) => ref.role === role).length > 3,
        )
      )
        throw new StudioError(
          'too_many_references',
          'Each reference must be unique, with no more than three per role.',
        );
      const assets = await this.repo.getAssets(
        next.references.map((ref) => ref.assetId),
      );
      if (
        next.references.some(
          (ref) =>
            !assets.some(
              (asset) =>
                asset.id === ref.assetId &&
                asset.draftId === draftId &&
                asset.status === 'ready' &&
                ['news', 'subject'].includes(asset.role),
            ),
        )
      )
        throw new StudioError(
          'reference_unavailable',
          'A selected reference is unavailable in this draft.',
        );
    }
    if ('manualPrompt' in patch) {
      next.manualPrompt =
        patch.manualPrompt === null
          ? null
          : string(patch.manualPrompt, 'Edited prompt', 10000);
      if (next.manualPrompt === null) next.manualApprovedSignature = null;
      else if (work.plan?.inputSignature === inputSignature(story, next))
        next.manualApprovedSignature = inputSignature(story, next);
    }
    if (patch.acceptManual === true && next.manualPrompt !== null)
      next.manualApprovedSignature = inputSignature(story, next);
    return this.repo.saveWorkspace(next, work.revision);
  }
  async references(
    context: Awaited<ReturnType<StudioService['context']>>,
    editSourceId?: string,
  ) {
    const { work } = context;
    const { draftId, storyId } = work;
    if (!work.stylePackId && work.styleDisabled !== true)
      throw new StudioError(
        'style_required',
        'L8R style is not configured for this story. Activate the editorial style before generating, or explicitly select None in the advanced editor.',
        409,
      );
    const style = work.stylePackId
      ? (await this.repo.listStyles()).find(
          (pack) => pack.id === work.stylePackId,
        ) || null
      : null;
    if (work.stylePackId && !style)
      throw new StudioError(
        'style_unavailable',
        'The selected style version is unavailable.',
      );
    const buffered: BufferedReference[] = [];
    if (style) {
      const assets = await this.repo.getAssets(style.anchorIds);
      if (
        style.anchorIds.some(
          (id) =>
            !assets.some(
              (asset) => asset.id === id && asset.status === 'ready',
            ),
        )
      )
        throw new StudioError(
          'style_reference_unavailable',
          'A style anchor is missing. Repair this style version before generating.',
        );
      const selected = selectStyleAnchors(style, assets);
      if (
        !selected.length ||
        selected.length !== Math.min(3, style.anchorIds.length)
      )
        throw new StudioError(
          'style_reference_unavailable',
          'Every selected style reference must be unique, ready and large enough for conditioning.',
        );
      for (const asset of selected)
        buffered.push({
          id: asset.id,
          role: 'style',
          name: asset.name,
          note: `Palette: ${asset.palette.join(', ')}. ${asset.texture}`,
          bytes: await this.repo.getObject(
            asset.conditioningPath || asset.originalPath,
          ),
          mimeType: asset.conditioningPath ? 'image/jpeg' : asset.mimeType,
        });
    }
    const assets = await this.repo.getAssets(
      work.references.map((ref) => ref.assetId),
    );
    for (const ref of work.references) {
      const asset = assets.find((asset) => asset.id === ref.assetId);
      if (!asset || asset.status !== 'ready' || asset.draftId !== draftId)
        throw new StudioError(
          'reference_unavailable',
          'A selected reference must be replaced or removed before generating.',
        );
      buffered.push({
        id: asset.id,
        role: ref.role,
        name: asset.name,
        note: ref.note,
        bytes: await this.repo.getObject(
          asset.conditioningPath || asset.originalPath,
        ),
        mimeType: asset.conditioningPath ? 'image/jpeg' : asset.mimeType,
      });
    }
    if (editSourceId) {
      const source = await this.repo.getGeneration(uuid(editSourceId));
      if (
        !source ||
        source.draftId !== draftId ||
        source.storyId !== storyId ||
        source.status !== 'complete' ||
        !source.originalAssetId
      )
        throw new StudioError(
          'invalid_edit_source',
          'Choose a completed image from this story to refine.',
        );
      const [asset] = await this.repo.getAssets([source.originalAssetId]);
      if (!asset)
        throw new StudioError(
          'invalid_edit_source',
          'The original image is unavailable.',
        );
      buffered.push({
        id: asset.id,
        role: 'edit-source',
        name: 'Image to refine',
        note: 'Preserve everything except the requested edit.',
        bytes: await this.repo.getObject(asset.originalPath),
        mimeType: asset.mimeType,
      });
    }
    return { refs: buffered, style };
  }
  async preparePlan(draftId: string, storyId: string) {
    const context = await this.context(draftId, storyId);
    const { story, work } = context;
    const { refs, style } = await this.references(context);
    const plan = {
      ...(await this.deps.planImage(story, work, style, refs)),
      systemVersion: IMAGE_PROMPT_VERSION,
    };
    await this.repo.recordCost(draftId, storyId, 'plan', plan.cost);
    return this.repo.saveWorkspace(
      { ...work, plan, manualPrompt: null, manualApprovedSignature: null },
      work.revision,
    );
  }
  async generate(input: {
    draftId: string;
    storyId: string;
    requestId: string;
    presetId?: unknown;
    operation?: unknown;
    editSourceId?: string;
    editInstruction?: unknown;
    automatic?: boolean;
  }) {
    const requestStartedAt = Date.now();
    const draftId = uuid(input.draftId);
    const storyId = uuid(input.storyId);
    const id = uuid(input.requestId);
    const operation = input.operation === 'edit' ? 'edit' : 'generate';
    const editInstruction =
      operation === 'edit'
        ? string(input.editInstruction, 'Edit instruction', 3000).trim()
        : '';
    if (operation === 'edit' && (!editInstruction || !input.editSourceId))
      throw new StudioError(
        'edit_required',
        'Select an image and describe the refinement.',
      );
    const existing = await this.repo.getGeneration(id);
    if (existing) {
      if (
        existing.draftId !== draftId ||
        existing.storyId !== storyId ||
        (input.presetId && input.presetId !== existing.presetId) ||
        existing.operation !== operation
      )
        throw new StudioError(
          'request_conflict',
          'That request ID belongs to a different generation.',
          409,
        );
      return recoverStatus(existing);
    }
    const context = await this.context(draftId, storyId);
    const { story } = context;
    let { work } = context;
    if (work.manualPrompt !== null && !work.manualPrompt.trim())
      throw new StudioError(
        'empty_prompt',
        'Write an image prompt or generate a new one.',
      );
    if (isManualPromptStale(story, work))
      throw new StudioError(
        'manual_prompt_stale',
        'Review the changed inputs, then keep your edited prompt or regenerate it.',
        409,
      );
    const chosen = presetId(input.presetId || work.presetId || DEFAULT_PRESET);
    let { refs, style } = await this.references(
      context,
      operation === 'edit' ? input.editSourceId : undefined,
    );
    const inputSnapshot = {
      story,
      direction: work.direction,
      stylePackId: work.stylePackId,
      styleDisabled: work.styleDisabled === true,
      systemVersion: IMAGE_PROMPT_VERSION,
      references: manifest(refs),
      manualPrompt: work.manualPrompt,
      editSourceId: input.editSourceId || null,
      editInstruction,
    };
    const requestHash = hash({
      draftId,
      storyId,
      chosen,
      operation,
      inputSnapshot,
    });
    let run: GenerationRun = {
      id,
      draftId,
      storyId,
      requestHash,
      presetId: chosen,
      operation,
      status: 'running',
      stage: input.automatic ? 'references' : 'planning',
      inputSnapshot,
      prompt: '',
      plan: work.plan,
      references: manifest(refs),
      originalAssetId: null,
      deliveryAssetId: null,
      providerRequestId: null,
      provider: PRESETS[chosen].provider,
      model: PRESETS[chosen].model,
      costs: [],
      quality: null,
      error: null,
      startedAt: new Date().toISOString(),
      finishedAt: null,
    };
    // Claim precedes both planner and renderer: replays cannot spend twice.
    const claim = await this.repo.claimGeneration(run);
    if (!claim.claimed) return recoverStatus(claim.run);
    let providerFinished = false;
    try {
      if (
        input.automatic &&
        !work.references.some((ref) => ref.role === 'news')
      ) {
        const search = await this.deps.findNewsReferences(
          story,
          work.direction,
        );
        run.costs.push(search.cost);
        await this.repo.saveGeneration(run);
        await this.repo.recordCost(
          draftId,
          storyId,
          'search-queries',
          search.cost,
        );
        const { selected, rejected } = await importNewsReferences(
          search.images,
          (candidate) => this.importNews(draftId, candidate),
          requestStartedAt + 90_000,
          /\b(?:logo|rebrand|branding|brand identity)\b/i.test(
            `${story.title} ${work.direction}`,
          ),
        );
        if (!selected.length)
          throw new StudioError(
            'no_usable_references',
            'No usable news reference was found. Your body text is saved. Retry the image or choose a reference in the advanced editor.',
            422,
          );
        work = await this.repo.saveWorkspace(
          { ...work, references: [...work.references, ...selected] },
          work.revision,
        );
        ({ refs, style } = await this.references({ ...context, work }));
        run.references = manifest(refs);
        run.inputSnapshot = { ...inputSnapshot, references: manifest(refs) };
        if (rejected.length)
          run.warnings = [
            `Skipped ${rejected.length} unavailable web reference(s).`,
          ];
      }
      const signature = inputSignature(story, work);
      run.stage = 'planning';
      await this.repo.saveGeneration(run);
      let renderPlan = work.plan;
      const needsPlan =
        operation === 'edit' ||
        !renderPlan ||
        renderPlan.systemVersion !== IMAGE_PROMPT_VERSION ||
        renderPlan.inputSignature !== signature;
      if (needsPlan) {
        const direction = [
          work.direction,
          work.manualPrompt
            ? 'Use this user-edited scene as the creative brief: ' +
              work.manualPrompt
            : '',
          operation === 'edit'
            ? 'Refine the EDIT SOURCE only as follows: ' +
              editInstruction +
              '. Preserve everything else.'
            : '',
        ]
          .filter(Boolean)
          .join('\n');
        renderPlan = await this.deps.planImage(
          story,
          { ...work, direction },
          style,
          refs,
        );
        renderPlan = {
          ...renderPlan,
          systemVersion: IMAGE_PROMPT_VERSION,
          inputSignature: signature,
          inputHash: hash(signature),
        };
        run.costs.push(renderPlan.cost);
        await this.repo.recordCost(
          draftId,
          storyId,
          operation === 'edit' ? 'edit-plan' : 'plan',
          renderPlan.cost,
        );
        if (operation === 'generate') {
          try {
            await this.repo.saveWorkspace(
              { ...work, plan: renderPlan },
              work.revision,
            );
          } catch (error) {
            if (
              !(error instanceof StudioError) ||
              error.code !== 'revision_conflict'
            )
              throw error;
          }
        }
      }
      if (!renderPlan)
        throw new StudioError(
          'plan_required',
          'Prepare an image prompt first.',
        );
      const prompt = buildRenderPrompt(
        renderPlan,
        style,
        manifest(refs),
        work.manualPrompt,
        editInstruction,
      );
      run = { ...run, plan: renderPlan, prompt, stage: 'rendering' };
      await this.repo.saveGeneration(run);
      const deadline = Math.max(
        1000,
        Math.min(240_000, 270_000 - (Date.now() - requestStartedAt)),
      );
      const result = await this.deps.renderImage(
        chosen,
        prompt,
        refs,
        process.env,
        fetch,
        deadline,
      );
      providerFinished = true;
      run.costs.push(result.cost);
      run.provider = result.provider;
      run.providerRequestId = result.requestId;
      run.stage = 'saving';
      await retrySave(() => this.repo.saveGeneration(run));
      await this.repo
        .recordCost(draftId, storyId, 'image', result.cost)
        .catch(() => undefined);
      const output = await prepareOutput(result.bytes, chosen);
      for (const [kind, bytes, width, height, mime] of [
        ['original', output.original, output.width, output.height, 'image/png'],
        ['delivery', output.delivery, 2048, 1152, 'image/jpeg'],
      ] as const) {
        const assetId = stableId(id + ':' + kind);
        const path =
          'generations/' +
          id +
          '/' +
          kind +
          (kind === 'original' ? '.png' : '.jpg');
        await retrySave(() => this.repo.putObject(path, bytes, mime));
        const asset: StudioAsset = {
          id: assetId,
          draftId,
          role: kind === 'original' ? 'output' : 'delivery',
          status: 'ready',
          name: story.title + ' — ' + kind,
          originalPath: path,
          conditioningPath: null,
          mimeType: mime,
          width,
          height,
          byteLength: bytes.length,
          checksum: createHash('sha256').update(bytes).digest('hex'),
          eligibleForConditioning: false,
          tags: [],
          palette: [],
          texture: '',
          sourcePageUrl: null,
          originalUrl: null,
          createdAt: new Date().toISOString(),
        };
        await retrySave(() => this.repo.putAsset(asset));
        if (kind === 'original') run.originalAssetId = assetId;
        else run.deliveryAssetId = assetId;
        await retrySave(() => this.repo.saveGeneration(run));
      }
      run = {
        ...run,
        status: 'complete',
        stage: 'quality',
        finishedAt: new Date().toISOString(),
      };
      await retrySave(() => this.repo.saveGeneration(run));
      if (input.automatic) await this.attachFirstImage(run);
      if (Date.now() - requestStartedAt < 240_000) {
        try {
          run.quality = await this.deps.inspectImage(
            output.original,
            { ...renderPlan, renderPrompt: prompt },
            refs,
            style,
          );
          if (run.quality.cost) {
            run.costs.push(run.quality.cost);
            await this.repo
              .recordCost(draftId, storyId, 'quality', run.quality.cost)
              .catch(() => undefined);
          }
        } catch {
          run.quality = {
            status: 'unavailable',
            findings: [
              'The image is saved. Its advisory visual check was unavailable.',
            ],
            suggestedEdit: '',
          };
        }
      } else
        run.quality = {
          status: 'unavailable',
          findings: [
            'The image is saved. The visual check was skipped because the request was near its deadline.',
          ],
          suggestedEdit: '',
        };
      await this.repo.saveGeneration(run).catch(() => undefined);
      return run;
    } catch (error) {
      run.status = providerFinished
        ? 'save_failed'
        : error instanceof StudioError && error.code === 'outcome_unknown'
          ? 'interrupted'
          : 'failed';
      run.error =
        error instanceof StudioError
          ? error.message
          : 'Generation could not be completed. No automatic rerender was requested.';
      run.finishedAt = new Date().toISOString();
      await this.repo.saveGeneration(run).catch(() => undefined);
      return run;
    }
  }
  async generateMissing(input: {
    draftId: string;
    storyId: string;
    retryId?: string;
  }) {
    const { work } = await this.context(input.draftId, input.storyId);
    if (work.selectedGenerationId) {
      const selected = await this.repo.getGeneration(work.selectedGenerationId);
      if (selected) return recoverStatus(selected);
    }
    const history = (
      await this.repo.listGenerations(work.draftId, work.storyId)
    ).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const completed = history.find((run) => run.status === 'complete');
    if (completed) {
      await this.attachFirstImage(completed);
      return completed;
    }
    const running = history.find(
      (run) => recoverStatus(run).status === 'running',
    );
    if (running) return running;
    if (history.length && !input.retryId) return recoverStatus(history[0]);
    return this.generate({
      draftId: work.draftId,
      storyId: work.storyId,
      requestId: input.retryId
        ? uuid(input.retryId)
        : stableId(`first-image:${work.draftId}:${work.storyId}`),
      presetId: work.presetId,
      automatic: true,
    });
  }
  private async attachFirstImage(run: GenerationRun) {
    if (run.status !== 'complete' || !run.deliveryAssetId) return;
    for (let attempt = 0; attempt < 3; attempt++) {
      const work = await this.repo.getWorkspace(run.draftId, run.storyId);
      if (!work || work.selectedGenerationId) return;
      try {
        await this.repo.saveWorkspace(
          { ...work, selectedGenerationId: run.id },
          work.revision,
        );
        return;
      } catch (error) {
        if (
          !(error instanceof StudioError) ||
          error.code !== 'revision_conflict'
        )
          break;
      }
    }
    run.warnings = [
      ...(run.warnings || []),
      'Image saved. Choose “Use this image” to attach it.',
    ];
  }
  async selectImage(
    draftId: string,
    storyId: string,
    generationId: string,
    revision: number,
  ) {
    const { work } = await this.context(draftId, storyId);
    if (work.revision !== revision)
      throw new StudioError(
        'revision_conflict',
        'Reload this story before changing its selected image.',
        409,
      );
    const run = await this.repo.getGeneration(uuid(generationId));
    if (
      !run ||
      run.status !== 'complete' ||
      run.draftId !== draftId ||
      run.storyId !== storyId ||
      !run.deliveryAssetId
    )
      throw new StudioError(
        'invalid_selection',
        'Choose a saved image from this story.',
      );
    return this.repo.saveWorkspace(
      { ...work, selectedGenerationId: run.id },
      revision,
    );
  }
  async createUpload(
    draftId: string | null,
    role: 'style' | 'subject',
    name: string,
    size: number,
    mimeType: string,
  ) {
    if (draftId && !(await this.repo.getDraft(uuid(draftId))))
      throw new StudioError(
        'draft_not_found',
        'Open a saved draft first.',
        404,
      );
    if (
      !['image/png', 'image/jpeg', 'image/webp'].includes(mimeType) ||
      !Number.isFinite(size) ||
      size <= 0 ||
      size > MAX_UPLOAD_BYTES
    )
      throw new StudioError(
        'invalid_upload',
        'Use a JPEG, PNG or WebP image up to 10 MB.',
      );
    const id = crypto.randomUUID();
    const path = `uploads/${id}/source`;
    const asset: StudioAsset = {
      id,
      draftId: role === 'style' ? null : draftId,
      role,
      status: 'pending',
      name: string(name, 'Filename', 255),
      originalPath: path,
      conditioningPath: null,
      mimeType,
      width: 0,
      height: 0,
      byteLength: size,
      checksum: '',
      eligibleForConditioning: false,
      tags: [],
      palette: [],
      texture: '',
      sourcePageUrl: null,
      originalUrl: null,
      createdAt: new Date().toISOString(),
    };
    await this.repo.putAsset(asset);
    return { assetId: id, ...(await this.repo.uploadTicket(path)) };
  }
  async finalizeUpload(id: string) {
    const [asset] = await this.repo.getAssets([uuid(id)]);
    if (!asset)
      throw new StudioError(
        'asset_not_found',
        'This upload does not exist.',
        404,
      );
    if (asset.status === 'ready') return asset;
    try {
      const bytes = await this.repo.getObject(asset.originalPath);
      const normalized = await normalizeReference(bytes);
      await this.repo.putObject(asset.originalPath, bytes, normalized.mimeType);
      const path = `references/${id}/conditioning.jpg`;
      await this.repo.putObject(path, normalized.conditioning, 'image/jpeg');
      const next = {
        ...asset,
        ...normalized,
        conditioning: undefined,
        conditioningPath: path,
        byteLength: bytes.length,
        status: 'ready' as const,
      };
      await this.repo.putAsset(next);
      return next;
    } catch (error) {
      const rejected = {
        ...asset,
        status: 'rejected' as const,
        rejectionReason:
          error instanceof StudioError
            ? error.message
            : 'This upload could not be validated.',
      };
      await this.repo.putAsset(rejected);
      throw error;
    }
  }
  async importNews(draftId: string, value: unknown) {
    if (!(await this.repo.getDraft(uuid(draftId))))
      throw new StudioError(
        'draft_not_found',
        'Open a saved draft first.',
        404,
      );
    const data = record(value);
    const url = string(data.url, 'Image URL', 3000);
    const bytes = await this.deps.downloadPublicImage(url);
    const normalized = await normalizeReference(bytes);
    const duplicate = (await this.repo.listAssets(draftId)).find(
      (a) =>
        a.role === 'news' &&
        a.checksum === normalized.checksum &&
        a.status === 'ready',
    );
    if (duplicate) return duplicate;
    const id = crypto.randomUUID();
    const path = `references/${id}/original`;
    const conditioningPath = `references/${id}/conditioning.jpg`;
    await this.repo.putObject(path, bytes, normalized.mimeType);
    await this.repo.putObject(
      conditioningPath,
      normalized.conditioning,
      'image/jpeg',
    );
    const sourcePageUrl =
      typeof data.sourcePageUrl === 'string' &&
      /^https?:\/\//i.test(data.sourcePageUrl)
        ? data.sourcePageUrl.slice(0, 3000)
        : null;
    const asset: StudioAsset = {
      id,
      draftId,
      role: 'news',
      status: 'ready',
      name: string(data.title || 'News reference', 'Image title', 500),
      originalPath: path,
      conditioningPath,
      mimeType: normalized.mimeType,
      width: normalized.width,
      height: normalized.height,
      byteLength: bytes.length,
      checksum: normalized.checksum,
      eligibleForConditioning: normalized.eligibleForConditioning,
      tags: [],
      palette: [],
      texture: '',
      sourcePageUrl,
      originalUrl: url,
      createdAt: new Date().toISOString(),
    };
    await this.repo.putAsset(asset);
    return asset;
  }
  async previewAssets(assets: StudioAsset[]) {
    return Promise.all(
      assets.map(async (asset) => ({
        ...asset,
        previewUrl:
          asset.status === 'ready'
            ? await this.repo
                .signObject(asset.conditioningPath || asset.originalPath)
                .catch(() => '')
            : undefined,
      })),
    );
  }
  async exportImages(draftId: string) {
    const draft = await this.repo.getDraft(uuid(draftId));
    if (!draft)
      throw new StudioError(
        'draft_not_found',
        'The saved draft is unavailable.',
        404,
      );
    const images: Record<string, string> = {};
    for (const [index, story] of draft.payload.stories.entries()) {
      const work = await this.repo.getWorkspace(draftId, story.studioStoryId);
      if (!work?.selectedGenerationId) continue;
      const run = await this.repo.getGeneration(work.selectedGenerationId);
      if (
        !run?.deliveryAssetId ||
        run.status !== 'complete' ||
        run.draftId !== draftId ||
        run.storyId !== story.studioStoryId
      )
        throw new StudioError(
          'export_image_unavailable',
          `The selected image for ${story.title} is unavailable.`,
        );
      const [asset] = await this.repo.getAssets([run.deliveryAssetId]);
      if (!asset)
        throw new StudioError(
          'export_image_unavailable',
          `The selected image for ${story.title} is unavailable.`,
        );
      const path = `${draftId}/${story.studioStoryId}/${run.id}.jpg`;
      await this.repo.putObject(
        path,
        await this.repo.getObject(asset.originalPath),
        'image/jpeg',
        true,
      );
      images[String(index)] = this.repo.publicUrl(path);
    }
    return { draft: draft.payload, imageUrls: images };
  }
}
