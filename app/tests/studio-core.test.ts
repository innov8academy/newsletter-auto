import assert from 'node:assert/strict';
import test from 'node:test';
import { PRESETS, imageCost, textCost } from '../src/lib/studio/models';
import {
  upgradeDraft,
  emptyWorkspace,
  inputSignature,
  clearWorkspace,
  reconcileDraft,
} from '../src/lib/studio/state';
import { buildImageRequest } from '../src/lib/studio/providers';

const story = {
  emoji: '',
  title: 'പുതിയ AI device',
  hookParagraph: 'A wearable launches.',
  bulletPoints: ['It has a camera.'],
  whyItMatters: 'Hands-free access.',
  l8rsTake: 'Test the privacy controls.',
};
const oldDraft = {
  storageSchemaVersion: 2,
  title: 'L8R',
  subtitle: '',
  date: '2026-09-02',
  intro: '',
  toc: [],
  stories: [story],
  memeIdeas: [],
  quickSummary: '',
  rawMarkdown: '',
};

test('v2 migration keeps content and IDs stable, including after reordering', () => {
  const draft = upgradeDraft(oldDraft);
  assert.equal(draft.stories[0].l8rsTake, story.l8rsTake);
  assert.equal(draft.storageSchemaVersion, 3);
  assert.deepEqual(upgradeDraft(draft), draft);
  const other = { ...story, title: 'Another story' };
  const expanded = reconcileDraft(
    { ...oldDraft, stories: [story, other] },
    draft,
  );
  const reordered = reconcileDraft(
    { ...oldDraft, stories: [other, story] },
    expanded,
  );
  assert.equal(
    reordered.stories[1].studioStoryId,
    draft.stories[0].studioStoryId,
  );
  assert.equal(reordered.studioDraftId, draft.studioDraftId);
});

test('input signature includes the full story, direction, roles, and style version', () => {
  const draft = upgradeDraft(oldDraft);
  const work = emptyWorkspace(
    draft.studioDraftId,
    draft.stories[0].studioStoryId,
  );
  const base = inputSignature(draft.stories[0], work);
  assert.notEqual(
    inputSignature({ ...draft.stories[0], whyItMatters: 'Changed' }, work),
    base,
  );
  assert.notEqual(
    inputSignature(draft.stories[0], { ...work, direction: 'Use a camera' }),
    base,
  );
  assert.notEqual(
    inputSignature(draft.stories[0], { ...work, stylePackId: 'v2' }),
    base,
  );
  assert.notEqual(
    inputSignature(draft.stories[0], {
      ...work,
      references: [{ assetId: 'a', role: 'news', note: '' }],
    }),
    base,
  );
});

test('clear removes every prompt input while retaining generation selection', () => {
  const work = {
    ...emptyWorkspace('draft', 'story'),
    direction: 'idea',
    references: [{ assetId: 'a', role: 'news' as const, note: '' }],
    manualPrompt: 'edited',
    selectedGenerationId: 'generation',
  };
  const cleared = clearWorkspace(work);
  assert.equal(cleared.direction, '');
  assert.equal(cleared.manualPrompt, null);
  assert.deepEqual(cleared.references, []);
  assert.equal(cleared.selectedGenerationId, 'generation');
});

test('image adapters use native image APIs and correct presets', () => {
  const refs = [
    {
      id: 'a',
      role: 'news' as const,
      name: 'device',
      note: '',
      bytes: Buffer.from('image'),
      mimeType: 'image/png',
    },
  ];
  const nano = buildImageRequest('nano-pro-2k', 'A device', refs, 'key');
  assert.equal(nano.url, 'https://openrouter.ai/api/v1/images');
  const payload = JSON.parse(nano.init.body as string);
  assert.equal(payload.model, 'google/gemini-3-pro-image');
  assert.equal(payload.resolution, '2K');
  assert.equal(payload.aspect_ratio, '16:9');
  assert.equal(payload.n, 1);
  assert.ok(
    payload.input_references[0].image_url.url.startsWith(
      'data:image/png;base64,',
    ),
  );
  const gpt = buildImageRequest('gpt-image-2-high', 'A device', refs, 'key');
  assert.equal(gpt.url, 'https://api.openai.com/v1/images/edits');
  const form = gpt.init.body as FormData;
  assert.equal(form.get('model'), 'gpt-image-2');
  assert.equal(form.get('size'), '2048x1152');
  assert.equal(form.get('quality'), 'high');
  assert.equal(form.getAll('image[]').length, 1);
  assert.equal(
    buildImageRequest('gpt-image-2-high', 'No refs', [], 'key').url,
    'https://api.openai.com/v1/images/generations',
  );
});

test('costs use provider usage and preserve unknown input cost', () => {
  assert.equal(PRESETS['nano-pro-2k'].outputEstimateUsd, 0.1344);
  assert.equal(
    imageCost('gpt-image-2-high', {
      input_tokens: 1100,
      input_tokens_details: { text_tokens: 100, image_tokens: 1000 },
      output_tokens: 5650,
    }).amountUsd,
    0.178,
  );
  assert.equal(imageCost('nano-pro-2k', { cost: 0.15 }).basis, 'provider');
  assert.equal(imageCost('gpt-image-2-high', {}).amountUsd, null);
  assert.equal(
    textCost(
      { prompt_tokens: 1000, completion_tokens: 1000 },
      new Date('2027-01-01'),
    ).amountUsd,
    0.009,
  );
});
