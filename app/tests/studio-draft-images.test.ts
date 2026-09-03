import test from 'node:test';
import assert from 'node:assert/strict';
import { DraftImageClient } from '../src/lib/studio/draft-image-client';
import { upgradeDraft } from '../src/lib/studio/state';
import { saveWizardDraft } from '../src/lib/studio/wizard-draft';
import type { ResearchReport } from '../src/lib/types';

const initial = () =>
  upgradeDraft({
    title: 'Newsletter',
    subtitle: '',
    date: '2026-09-03',
    intro: '',
    toc: [],
    memeIdeas: [],
    quickSummary: '',
    rawMarkdown: '',
    stories: [
      {
        emoji: '',
        title: 'Story',
        hookParagraph: 'Saved body',
        bulletPoints: [],
        whyItMatters: '',
        l8rsTake: '',
        sourceStoryId: 'news-1',
      },
    ],
  });
function storage() {
  const values = new Map<string, string>([
    ['currentDraft', JSON.stringify(initial())],
  ]);
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

test('reading draft image status never starts a paid generation; concurrent clicks share one request', async () => {
  const local = storage();
  const calls: string[] = [];
  const client: DraftImageClient = new DraftImageClient(
    local,
    async <T>(path: string, method = 'GET'): Promise<T> => {
      calls.push(`${method} ${path}`);
      if (path === 'drafts')
        return {
          draft: {
            id: client.draft()!.studioDraftId,
            payload: client.draft(),
            revision: 1,
          },
        } as T;
      if (path.endsWith('/images')) return { stories: [], assets: [] } as T;
      return { run: { status: 'complete' } } as T;
    },
  );
  await client.load();
  assert.equal(
    calls.some((call) => call.startsWith('POST')),
    false,
  );
  const id = client.draft()!.stories[0].studioStoryId;
  await Promise.all([client.generate(id), client.generate(id)]);
  assert.equal(
    calls.filter((call) => call === 'POST generations/missing').length,
    1,
  );
});

test('draft synchronization preserves edits made during saving and serializes browser revisions', async () => {
  const local = storage();
  let revision = 0;
  const observed: number[] = [];
  const client = new DraftImageClient(
    local,
    async <T>(_path: string, _method?: string, value?: unknown) => {
      const body = value as {
        draft: ReturnType<typeof initial>;
        revision: number | null;
      };
      observed.push(body.revision ?? 0);
      const current = client.draft()!;
      current.stories[0].hookParagraph = 'Edited while saving';
      local.setItem('currentDraft', JSON.stringify(current));
      await Promise.resolve();
      return {
        draft: {
          id: body.draft.studioDraftId,
          payload: body.draft,
          revision: ++revision,
        },
      } as T;
    },
  );
  await Promise.all([client.sync(), client.sync()]);
  assert.equal(client.draft()!.stories[0].hookParagraph, 'Edited while saving');
  assert.deepEqual(observed, [0, 1]);
  assert.equal(client.draft()!.studioServerRevision, 2);
});

test('image errors never modify or remove body content, and a save conflict prevents rendering', async () => {
  const local = storage();
  const before = local.getItem('currentDraft');
  let renders = 0;
  const client = new DraftImageClient(local, async <T>(path: string) => {
    if (path === 'drafts') throw new Error('Revision conflict');
    renders++;
    return {} as T;
  });
  await assert.rejects(
    client.generate(client.draft()!.stories[0].studioStoryId),
    /Revision conflict/,
  );
  assert.equal(renders, 0);
  assert.equal(local.getItem('currentDraft'), before);
});

test('wizard autosave preserves draft and story identities across dates', () => {
  const local = storage();
  const previous = JSON.parse(local.getItem('currentDraft')!);
  const report: ResearchReport = {
    story: {
      id: 'news-1',
      headline: 'Story',
      summary: '',
      category: 'AI',
      baseScore: 1,
      finalScore: 1,
      entities: [],
      originalUrl: null,
      sources: [],
      publishedAt: '',
      crossSourceCount: 1,
      boosts: [],
    },
    deepResearch: '',
    keyPoints: [],
    implications: '',
    sources: [],
  };
  const sections = {
    hook: { title: previous.title, subtitle: '' },
    intro: '',
    toc: [],
    stories: previous.stories,
    summary: '',
    memeIdeas: [],
  };
  const next = saveWizardDraft(sections, [report], 'Next day', local);
  assert.equal(next.studioDraftId, previous.studioDraftId);
  assert.equal(
    next.stories[0].studioStoryId,
    previous.stories[0].studioStoryId,
  );
  assert.equal(next.date, previous.date);
});
