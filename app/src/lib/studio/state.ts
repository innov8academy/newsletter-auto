import type { NewsletterDraft } from '../draft-generator';
import type { StoryWorkspace, StudioDraft, StudioStory } from './types';
import { DEFAULT_PRESET } from './models';
import { StudioError } from './errors';

function validId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}
export function upgradeDraft(input: NewsletterDraft): StudioDraft {
  if (
    !input ||
    !Array.isArray(input.stories) ||
    !input.stories.length ||
    input.stories.length > 30 ||
    typeof input.title !== 'string'
  )
    throw new StudioError(
      'invalid_draft',
      'Open a newsletter draft containing at least one story.',
    );
  const ids = new Set<string>();
  const stories = input.stories.map((story) => {
    if (
      typeof story.title !== 'string' ||
      typeof story.hookParagraph !== 'string' ||
      !Array.isArray(story.bulletPoints) ||
      !story.bulletPoints.every((p) => typeof p === 'string')
    )
      throw new StudioError(
        'invalid_draft',
        'This draft needs its story text repaired before opening Studio. The original draft has been retained.',
      );
    let id = validId(story.studioStoryId)
      ? story.studioStoryId
      : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    return {
      ...story,
      whyItMatters: story.whyItMatters || '',
      l8rsTake: story.l8rsTake || '',
      studioStoryId: id,
    };
  });
  return {
    ...input,
    studioDraftId: validId(input.studioDraftId)
      ? input.studioDraftId
      : crypto.randomUUID(),
    storageSchemaVersion: 3,
    stories,
  };
}
// Retain identity on the draft-writing surfaces, before Studio sees reordered data.
export function reconcileDraft(
  input: NewsletterDraft,
  previous?: NewsletterDraft | null,
): StudioDraft {
  const used = new Set<string>();
  const sourceOverlap =
    previous &&
    input.stories.some(
      (story) =>
        story.sourceStoryId &&
        previous.stories.some(
          (old) => old.sourceStoryId === story.sourceStoryId,
        ),
    );
  const sameDraft =
    previous &&
    (input.studioDraftId
      ? input.studioDraftId === previous.studioDraftId
      : input.date === previous.date &&
        (input.title === previous.title || sourceOverlap));
  const stories = input.stories.map((story) => {
    const match = sameDraft
      ? previous.stories.find(
          (old) =>
            old.studioStoryId &&
            !used.has(old.studioStoryId) &&
            (story.studioStoryId
              ? old.studioStoryId === story.studioStoryId
              : story.sourceStoryId
                ? old.sourceStoryId === story.sourceStoryId
                : old.title === story.title),
        )
      : undefined;
    if (match?.studioStoryId) used.add(match.studioStoryId);
    return {
      ...story,
      studioStoryId: story.studioStoryId || match?.studioStoryId,
      imageUrl: story.imageUrl || match?.imageUrl,
    };
  });
  return upgradeDraft({
    ...input,
    studioDraftId:
      input.studioDraftId || (sameDraft ? previous.studioDraftId : undefined),
    studioServerRevision:
      input.studioServerRevision ??
      (sameDraft ? previous.studioServerRevision : undefined),
    stories,
  });
}
export function emptyWorkspace(
  draftId: string,
  storyId: string,
  stylePackId: string | null = null,
): StoryWorkspace {
  return {
    draftId,
    storyId,
    revision: 1,
    direction: '',
    stylePackId,
    references: [],
    plan: null,
    manualPrompt: null,
    manualApprovedSignature: null,
    selectedGenerationId: null,
    presetId: DEFAULT_PRESET,
  };
}
export function clearWorkspace(work: StoryWorkspace): StoryWorkspace {
  return {
    ...work,
    direction: '',
    references: [],
    plan: null,
    manualPrompt: null,
    manualApprovedSignature: null,
  };
}
export function inputSignature(
  story: StudioStory,
  work: StoryWorkspace,
): string {
  return JSON.stringify({
    story: {
      id: story.studioStoryId,
      title: story.title,
      hookParagraph: story.hookParagraph,
      bulletPoints: story.bulletPoints,
      whyItMatters: story.whyItMatters,
      l8rsTake: story.l8rsTake,
    },
    direction: work.direction,
    stylePackId: work.stylePackId,
    references: work.references.map((ref) => ({
      assetId: ref.assetId,
      role: ref.role,
      note: ref.note,
    })),
  });
}
export function isManualPromptStale(
  story: StudioStory,
  work: StoryWorkspace,
): boolean {
  return (
    work.manualPrompt !== null &&
    work.manualApprovedSignature !== inputSignature(story, work)
  );
}
