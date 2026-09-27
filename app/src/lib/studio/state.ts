import type { NewsletterDraft } from '../draft-generator';
import type { StoryWorkspace, StudioDraft, StudioStory } from './types';
import { DEFAULT_PRESET } from './models';
import { StudioError } from './errors';
import { createUuid } from '../uuid';

export const MAX_STUDIO_STORIES = 30;

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
    typeof input.title !== 'string'
  )
    throw new StudioError(
      'invalid_draft',
      'Open a newsletter draft containing at least one story.',
    );
  if (input.stories.length > MAX_STUDIO_STORIES)
    throw new StudioError(
      'too_many_stories',
      `Studio supports up to ${MAX_STUDIO_STORIES} stories. Remove stories from the selection before opening this draft.`,
    );
  const ids = new Set<string>();
  const stories = input.stories.map((story) => {
    if (
      !story ||
      typeof story !== 'object' ||
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
      : createUuid();
    if (ids.has(id)) id = createUuid();
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
      : createUuid(),
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
  const previousStories = Array.isArray(previous?.stories)
    ? previous.stories.filter((story): story is typeof input.stories[number] =>
        Boolean(story && typeof story === 'object'),
      )
    : [];
  const sourceOverlap =
    previous &&
    input.stories.some(
      (story) =>
        story.sourceStoryId &&
        previousStories.some(
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
      ? previousStories.find(
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
    styleDisabled: false,
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
    styleDisabled: work.styleDisabled === true,
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
