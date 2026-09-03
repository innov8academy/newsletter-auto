import test from 'node:test';
import assert from 'node:assert/strict';
import sharp from 'sharp';
import { MemoryStudioRepository } from './helpers/studio-memory';
import {
  StudioService,
  recoverStatus,
  selectStyleAnchors,
} from '../src/lib/studio/service';
import { upgradeDraft, inputSignature } from '../src/lib/studio/state';
import {
  buildRenderPrompt,
  EDITORIAL_PROFILE,
  hash,
  manifest,
  validatePlan,
} from '../src/lib/studio/prompts';
import { structuredCall } from '../src/lib/studio/providers';
import type {
  BufferedReference,
  StudioAsset,
  StylePack,
} from '../src/lib/studio/types';
import { installSeedStyle } from '../src/lib/studio/seed-style';

const baseStory = {
  emoji: '',
  title: 'A camera launches',
  hookParagraph: 'A new device.',
  bulletPoints: ['A verified camera.'],
  whyItMatters: 'Privacy controls matter.',
  l8rsTake: 'Try it before judging.',
};
const scene = {
  storyThesis: 'A camera launches',
  entities: ['camera'],
  scene: 'A camera on a table',
  metaphor: '',
  composition: 'one focal point',
  palette: ['blue'],
  focalPoint: 'camera',
  mustInclude: ['camera'],
  avoid: ['unrequested text'],
  referenceUsage: [],
  renderPrompt: 'A camera on a table.',
  altText: 'Editorial image of a camera',
  uncertainties: [],
};
const receipt = () => ({
  id: crypto.randomUUID(),
  model: 'test',
  amountUsd: 0.14,
  basis: 'provider' as const,
  pricingDate: 'test',
  usage: { cost: 0.14 },
});
async function fixture() {
  const repo = new MemoryStudioRepository();
  const draft = upgradeDraft({
    title: 'L8R',
    subtitle: '',
    date: '2026-09-02',
    stories: [baseStory],
    intro: '',
    toc: [],
    memeIdeas: [],
    quickSummary: '',
    rawMarkdown: '',
  });
  await repo.saveDraft(draft, null);
  const pixels = await sharp({
    create: { width: 2048, height: 1152, channels: 3, background: '#2444cc' },
  })
    .png()
    .toBuffer();
  let renders = 0;
  let searches = 0;
  const plannerRefs: BufferedReference[][] = [];
  const renderedRefs: BufferedReference[][] = [];
  const directions: string[] = [];
  const service = new StudioService(repo, {
    planImage: async (story, work, _style, refs) => {
      plannerRefs.push(refs);
      directions.push(work.direction);
      const signature = inputSignature(story, work);
      return {
        ...scene,
        referenceUsage: refs.map((ref) => ({ id: ref.id, use: ref.role })),
        inputSignature: signature,
        inputHash: hash(signature),
        references: manifest(refs),
        model: 'google/gemini-3.7-flash',
        cost: receipt(),
        createdAt: new Date().toISOString(),
      };
    },
    renderImage: async (_preset, _prompt, refs) => {
      renders++;
      renderedRefs.push(refs);
      return {
        bytes: pixels,
        mimeType: 'image/png',
        requestId: 'provider-test',
        cost: receipt(),
        provider: 'test',
      };
    },
    inspectImage: async () => ({
      status: 'checked',
      findings: [],
      suggestedEdit: '',
      scores: { relevance: 5, fidelity: 5, style: 5, readability: 5 },
      cost: receipt(),
    }),
    downloadPublicImage: async () => pixels,
    findNewsReferences: async () => {
      searches++;
      return {
        images: [
          {
            url: 'https://images.example/camera.png',
            thumbnail: '',
            title: 'Official camera',
            source: 'Example',
            sourcePageUrl: 'https://example.com/camera',
          },
        ],
        queries: ['camera', 'camera release'],
        cost: receipt(),
        warning: null,
      };
    },
  });
  const storyId = draft.stories[0].studioStoryId;
  const { work } = await service.context(draft.studioDraftId, storyId);
  return {
    repo,
    draft,
    storyId,
    work,
    service,
    pixels,
    plannerRefs,
    renderedRefs,
    directions,
    renders: () => renders,
    searches: () => searches,
  };
}

test('one-click missing images searches once, sends real references, and attaches the first output', async () => {
  const f = await fixture();
  const args = { draftId: f.draft.studioDraftId, storyId: f.storyId };
  const results = await Promise.all([
    f.service.generateMissing(args),
    f.service.generateMissing(args),
  ]);
  const complete = results.find((run) => run.status === 'complete')!;
  assert.ok(complete);
  assert.equal(f.searches(), 1);
  assert.equal(f.renders(), 1);
  assert.equal(f.plannerRefs[0][0].role, 'news');
  assert.ok(f.plannerRefs[0][0].bytes.length);
  assert.deepEqual(f.plannerRefs[0], f.renderedRefs[0]);
  assert.equal(
    (await f.service.context(args.draftId, args.storyId)).work
      .selectedGenerationId,
    complete.id,
  );
  const changed = {
    ...f.draft,
    stories: [{ ...f.draft.stories[0], hookParagraph: 'Edited body text' }],
  };
  await f.repo.saveDraft(changed, 1);
  assert.equal((await f.service.generateMissing(args)).id, complete.id);
  assert.equal(f.renders(), 1, 'body edits or reload must not regenerate');
});

test('missing-image failures retain body content and need an explicit retry', async () => {
  const f = await fixture();
  const broken = new StudioService(f.repo, {
    findNewsReferences: async () => {
      throw new Error('search failed');
    },
  });
  const args = { draftId: f.draft.studioDraftId, storyId: f.storyId };
  const failed = await broken.generateMissing(args);
  assert.equal(failed.status, 'failed');
  assert.deepEqual((await f.repo.getDraft(args.draftId))?.payload, f.draft);
  assert.equal((await f.service.generateMissing(args)).id, failed.id);
  assert.equal(f.renders(), 0);
  assert.equal(
    (await f.service.generateMissing({ ...args, retryId: crypto.randomUUID() }))
      .status,
    'complete',
  );
  assert.equal(f.renders(), 1);
});

test('automatic image search skips rejected candidates and reports an empty reference set without rendering', async () => {
  const f = await fixture();
  const broken = new StudioService(f.repo, {
    findNewsReferences: async () => ({
      images: [
        {
          url: 'https://example.com/bad',
          thumbnail: '',
          title: 'Camera',
          source: '',
          sourcePageUrl: null,
        },
      ],
      queries: [],
      cost: receipt(),
      warning: null,
    }),
    downloadPublicImage: async () => {
      throw new Error('invalid image');
    },
    renderImage: async () => {
      throw new Error('must not render');
    },
  });
  const run = await broken.generateMissing({
    draftId: f.draft.studioDraftId,
    storyId: f.storyId,
  });
  assert.equal(run.status, 'failed');
  assert.match(run.error!, /reference/i);
  assert.equal(
    run.costs.length,
    1,
    'record query planning charges even when references fail',
  );
});
async function asset(
  f: Awaited<ReturnType<typeof fixture>>,
  role: 'news' | 'subject' | 'style',
): Promise<StudioAsset> {
  const id = crypto.randomUUID();
  const path = `test/${id}.png`;
  await f.repo.putObject(path, f.pixels, 'image/png');
  const result: StudioAsset = {
    id,
    draftId: role === 'style' ? null : f.draft.studioDraftId,
    role,
    status: 'ready',
    name: role,
    originalPath: path,
    conditioningPath: null,
    mimeType: 'image/png',
    width: 2048,
    height: 1152,
    byteLength: f.pixels.length,
    checksum: id,
    eligibleForConditioning: true,
    tags: ['camera'],
    palette: ['blue'],
    texture: 'print',
    sourcePageUrl: null,
    originalUrl: null,
    createdAt: new Date().toISOString(),
  };
  await f.repo.putAsset(result);
  return result;
}
test('all reference roles and creative direction reach planning and rendering as bytes', async () => {
  const f = await fixture();
  const news = await asset(f, 'news');
  const subject = await asset(f, 'subject');
  const styleAsset = await asset(f, 'style');
  const style: StylePack = {
    id: crypto.randomUUID(),
    slug: 'test',
    name: 'Editorial',
    version: 1,
    profile: EDITORIAL_PROFILE,
    assetIds: [styleAsset.id],
    anchorIds: [styleAsset.id],
    active: true,
    createdAt: new Date().toISOString(),
  };
  await f.repo.insertStyle(style);
  await f.service.saveWork(f.draft.studioDraftId, f.storyId, {
    revision: f.work.revision,
    direction: 'Make the camera recognizable',
    stylePackId: style.id,
    references: [
      { assetId: news.id, role: 'news', note: 'Use this camera' },
      { assetId: subject.id, role: 'subject', note: 'Use this person' },
    ],
  });
  const run = await f.service.generate({
    draftId: f.draft.studioDraftId,
    storyId: f.storyId,
    requestId: crypto.randomUUID(),
    presetId: 'gpt-image-2-high',
  });
  assert.equal(run.status, 'complete');
  assert.deepEqual(
    f.plannerRefs[0].map((ref) => ref.role),
    ['style', 'news', 'subject'],
  );
  assert.deepEqual(
    f.renderedRefs[0].map((ref) => ref.bytes),
    f.plannerRefs[0].map((ref) => ref.bytes),
  );
  assert.equal(f.directions[0], 'Make the camera recognizable');
  assert.equal(f.repo.published.size, 0);
  assert.equal(f.renders(), 1);
});
test('duplicate generation IDs charge the renderer once and reload recovers saved assets', async () => {
  const f = await fixture();
  const input = {
    draftId: f.draft.studioDraftId,
    storyId: f.storyId,
    requestId: crypto.randomUUID(),
    presetId: 'gpt-image-2-high',
  };
  await Promise.all([f.service.generate(input), f.service.generate(input)]);
  assert.equal(f.renders(), 1);
  assert.equal(
    f.plannerRefs.length,
    1,
    'A duplicate request must not pay for planning twice either',
  );
  const recovered = await new StudioService(f.repo).generate(input);
  assert.equal(recovered.status, 'complete');
  assert.ok(recovered.originalAssetId);
  assert.ok(recovered.deliveryAssetId);
  const { work } = await f.service.context(f.draft.studioDraftId, f.storyId);
  await f.service.selectImage(
    f.draft.studioDraftId,
    f.storyId,
    recovered.id,
    work.revision,
  );
  const exported = await f.service.exportImages(f.draft.studioDraftId);
  assert.match(exported.imageUrls['0'], /^https:\/\/public.example\//);
  assert.ok(!exported.imageUrls['0'].includes('token='));
  assert.equal(f.repo.published.size, 1);
});
test('manual prompt survives changed inputs and requires deliberate reconciliation', async () => {
  const f = await fixture();
  const news = await asset(f, 'news');
  const planned = await f.service.preparePlan(f.draft.studioDraftId, f.storyId);
  let work = await f.service.saveWork(f.draft.studioDraftId, f.storyId, {
    revision: planned.revision,
    manualPrompt: 'My manually composed scene',
  });
  work = await f.service.saveWork(f.draft.studioDraftId, f.storyId, {
    revision: work.revision,
    direction: 'New direction',
    references: [
      { assetId: news.id, role: 'news', note: 'New visual evidence' },
    ],
  });
  await assert.rejects(
    f.service.generate({
      draftId: f.draft.studioDraftId,
      storyId: f.storyId,
      requestId: crypto.randomUUID(),
    }),
    { code: 'manual_prompt_stale' },
  );
  assert.equal(f.renders(), 0);
  assert.equal(work.manualPrompt, 'My manually composed scene');
  await f.service.saveWork(f.draft.studioDraftId, f.storyId, {
    revision: work.revision,
    acceptManual: true,
  });
  const run = await f.service.generate({
    draftId: f.draft.studioDraftId,
    storyId: f.storyId,
    requestId: crypto.randomUUID(),
    presetId: 'gpt-image-2-high',
  });
  assert.match(run.prompt, /My manually composed scene/);
  assert.equal(f.plannerRefs.length, 2);
  assert.deepEqual(
    f.plannerRefs.at(-1)?.map((ref) => ref.id),
    [news.id],
  );
  assert.deepEqual(
    f.plannerRefs.at(-1)?.map((ref) => ref.id),
    f.renderedRefs.at(-1)?.map((ref) => ref.id),
  );
  assert.equal(
    (await f.repo.getWorkspace(f.draft.studioDraftId, f.storyId))?.manualPrompt,
    'My manually composed scene',
  );
});
test('no-style mode adds no style instructions or sample images', async () => {
  const f = await fixture();
  const work = await f.service.preparePlan(f.draft.studioDraftId, f.storyId);
  const prompt = buildRenderPrompt(work.plan!, null, []);
  assert.ok(!prompt.includes('SELECTED STYLE'));
  assert.ok(!prompt.includes('halftone'));
  assert.equal(f.plannerRefs[0].length, 0);
  assert.throws(
    () =>
      validatePlan({ ...scene, referenceUsage: [] }, [
        { id: 'missing', role: 'news', name: 'news', note: '' },
      ]),
    { code: 'missing_reference' },
  );
});
test('selected missing references fail before a paid render', async () => {
  const f = await fixture();
  const news = await asset(f, 'news');
  await f.service.saveWork(f.draft.studioDraftId, f.storyId, {
    revision: f.work.revision,
    references: [{ assetId: news.id, role: 'news', note: '' }],
  });
  f.repo.objects.clear();
  await assert.rejects(
    f.service.generate({
      draftId: f.draft.studioDraftId,
      storyId: f.storyId,
      requestId: crypto.randomUUID(),
    }),
    { code: 'asset_unavailable' },
  );
  assert.equal(f.renders(), 0);
});
test('stale browser revisions cannot overwrite saved work', async () => {
  const f = await fixture();
  await f.service.saveWork(f.draft.studioDraftId, f.storyId, {
    revision: f.work.revision,
    direction: 'Saved elsewhere',
  });
  await assert.rejects(
    f.service.saveWork(f.draft.studioDraftId, f.storyId, {
      revision: f.work.revision,
      direction: 'Old browser',
    }),
    { code: 'revision_conflict' },
  );
  assert.equal(
    (await f.repo.getWorkspace(f.draft.studioDraftId, f.storyId))?.direction,
    'Saved elsewhere',
  );
});
test('failed asset saving keeps charges and never calls the renderer again', async () => {
  const f = await fixture();
  await f.service.preparePlan(f.draft.studioDraftId, f.storyId);
  f.repo.putObject = async () => {
    throw new Error('storage down');
  };
  const input = {
    draftId: f.draft.studioDraftId,
    storyId: f.storyId,
    requestId: crypto.randomUUID(),
    presetId: 'gpt-image-2-high',
  };
  const run = await f.service.generate(input);
  assert.equal(run.status, 'save_failed');
  assert.equal(run.costs.length, 1);
  await f.service.generate(input);
  assert.equal(f.renders(), 1);
  assert.equal(
    recoverStatus({
      ...run,
      status: 'running',
      startedAt: new Date(0).toISOString(),
    }).status,
    'interrupted',
  );
});
test('planner requests use Gemini 3.7 with schema and actual image parts', async () => {
  let body: Record<string, unknown> = {};
  const fetcher: typeof fetch = async (_url, init) => {
    body = JSON.parse(init?.body as string);
    return new Response(
      JSON.stringify({
        choices: [{ message: { content: '{"ok":true}' } }],
        usage: { cost: 0.001 },
      }),
      { status: 200 },
    );
  };
  await structuredCall(
    {
      schema: { type: 'object' },
      schemaName: 'test',
      system: 'Art direction',
      text: 'പുതിയ camera',
      references: [
        {
          id: 'ref',
          name: 'camera',
          role: 'news',
          note: '',
          bytes: Buffer.from('real-bytes'),
          mimeType: 'image/png',
        },
      ],
    },
    { NODE_ENV: 'test', OPENROUTER_API_KEY: 'test' },
    fetcher,
  );
  assert.equal(body.model, 'google/gemini-3.7-flash');
  assert.equal(body.temperature, undefined);
  assert.ok(body.response_format);
  assert.match(
    JSON.stringify(body.messages),
    /data:image\/png;base64,cmVhbC1ieXRlcw==/,
  );
  assert.match(JSON.stringify(body.messages), /പുതിയ/);
});

test('the seed catalog has forty examples, five eligible anchors, and a deterministic three-image selection', async () => {
  const repo = new MemoryStudioRepository();
  const pack = await installSeedStyle(repo);
  const assets = await repo.getAssets(pack.assetIds);
  assert.equal(assets.length, 40);
  assert.equal(assets.filter((a) => a.eligibleForConditioning).length, 5);
  assert.equal(pack.anchorIds.length, 5);
  assert.equal(selectStyleAnchors(pack, assets, 'financial coins').length, 3);
  assert.ok(
    selectStyleAnchors(pack, assets, 'financial coins')[0].tags.includes(
      'coins',
    ),
  );
  const again = await installSeedStyle(repo);
  assert.equal(again.id, pack.id);
  assert.equal(repo.styles.size, 1);
});

test('refinement sends the original to both the planner and renderer and retains the first output', async () => {
  const f = await fixture();
  const first = await f.service.generate({
    draftId: f.draft.studioDraftId,
    storyId: f.storyId,
    requestId: crypto.randomUUID(),
    presetId: 'gpt-image-2-high',
  });
  const second = await f.service.generate({
    draftId: f.draft.studioDraftId,
    storyId: f.storyId,
    requestId: crypto.randomUUID(),
    presetId: 'gpt-image-2-high',
    operation: 'edit',
    editSourceId: first.id,
    editInstruction: 'Make the background yellow',
  });
  assert.equal(second.status, 'complete');
  assert.equal(f.renders(), 2);
  assert.equal(f.plannerRefs.at(-1)?.at(-1)?.role, 'edit-source');
  assert.deepEqual(
    f.plannerRefs.at(-1)?.map((r) => r.id),
    f.renderedRefs.at(-1)?.map((r) => r.id),
  );
  assert.equal((await f.repo.getGeneration(first.id))?.status, 'complete');
});

test('newsletter export follows stable story IDs after reordering', async () => {
  const f = await fixture();
  const first = await f.service.generate({
    draftId: f.draft.studioDraftId,
    storyId: f.storyId,
    requestId: crypto.randomUUID(),
    presetId: 'gpt-image-2-high',
  });
  const firstWork = (await f.service.context(f.draft.studioDraftId, f.storyId))
    .work;
  await f.service.selectImage(
    f.draft.studioDraftId,
    f.storyId,
    first.id,
    firstWork.revision,
  );
  const secondStory = {
    ...f.draft.stories[0],
    title: 'Another story',
    studioStoryId: crypto.randomUUID(),
  };
  const expanded = await f.repo.saveDraft(
    { ...f.draft, stories: [...f.draft.stories, secondStory] },
    1,
  );
  const second = {
    ...first,
    id: crypto.randomUUID(),
    storyId: secondStory.studioStoryId,
    requestHash: 'second-fixture',
  };
  await f.repo.claimGeneration(second);
  const secondWork = (
    await f.service.context(f.draft.studioDraftId, secondStory.studioStoryId)
  ).work;
  await f.service.selectImage(
    f.draft.studioDraftId,
    secondStory.studioStoryId,
    second.id,
    secondWork.revision,
  );
  await f.repo.saveDraft(
    { ...expanded.payload, stories: [...expanded.payload.stories].reverse() },
    expanded.revision,
  );
  const exported = await f.service.exportImages(f.draft.studioDraftId);
  assert.ok(exported.imageUrls['0'].includes(secondStory.studioStoryId));
  assert.ok(exported.imageUrls['0'].includes(second.id));
  assert.ok(exported.imageUrls['1'].includes(f.storyId));
  assert.ok(exported.imageUrls['1'].includes(first.id));
});
