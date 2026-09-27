import type { NewsletterDraft, StoryBlock } from '../draft-generator';
import type { ResearchReport } from '../types';
import { MAX_STUDIO_STORIES, reconcileDraft } from './state';
import { browserStorage as localStorage } from '../browser-storage';

export interface WizardSections {
  hook: { title: string; subtitle: string } | null;
  intro: string | null;
  toc: string[] | null;
  stories: StoryBlock[];
  summary: string | null;
  memeIdeas: NewsletterDraft['memeIdeas'];
}

function isSavedStory(value: unknown): value is StoryBlock {
  if (!value || typeof value !== 'object') return false;
  const story = value as Partial<StoryBlock>;
  return (
    typeof story.title === 'string' &&
    typeof story.hookParagraph === 'string' &&
    Array.isArray(story.bulletPoints) &&
    story.bulletPoints.every((point) => typeof point === 'string')
  );
}

function hasWrittenBody(story: StoryBlock): boolean {
  return Boolean(
    story.title.trim() ||
    story.hookParagraph.trim() ||
    story.bulletPoints.some((point) => point.trim()) ||
    story.whyItMatters?.trim() ||
    story.l8rsTake?.trim(),
  );
}

export function saveWizardDraft(
  completed: WizardSections,
  reports: ResearchReport[],
  date: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
) {
  if (reports.length > MAX_STUDIO_STORIES)
    throw new Error(
      `Studio supports up to ${MAX_STUDIO_STORIES} stories. Remove stories from the selection before opening this draft.`,
    );
  let previous: NewsletterDraft | null = null;
  const raw = storage.getItem('currentDraft');
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : null;
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const saved = parsed as Partial<NewsletterDraft>;
      const savedStories = Array.isArray(saved.stories) ? saved.stories : [];
      const validStories = savedStories.filter(isSavedStory);
      if (!Array.isArray(saved.stories) || validStories.length !== savedStories.length)
        storage.setItem('studio_invalid_draft_backup', raw!);
      previous = { ...saved, stories: validStories } as NewsletterDraft;
    } else if (raw) {
      storage.setItem('studio_invalid_draft_backup', raw);
    }
  } catch {
    if (raw) storage.setItem('studio_invalid_draft_backup', raw);
  }
  const stories = reports.map((report, index): StoryBlock => {
    const atIndex = completed.stories[index];
    const completedStory =
      atIndex && (!atIndex.sourceStoryId || atIndex.sourceStoryId === report.story.id)
        ? atIndex
        : completed.stories.find((story) => story?.sourceStoryId === report.story.id);
    const savedStory = previous?.stories.find(
      (story) => story.sourceStoryId === report.story.id,
    );
    const story =
      isSavedStory(completedStory) && hasWrittenBody(completedStory)
        ? completedStory
        : savedStory;
    const fallback = (report.deepResearch || report.story.summary || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 220);
    return {
      studioStoryId: story?.studioStoryId,
      sourceStoryId: report.story.id,
      emoji: story?.emoji || ['🧠', '💰', '🤖', '🔥'][index % 4],
      title: story?.title || report.story.headline,
      hookParagraph: story?.hookParagraph || fallback,
      bulletPoints: story?.bulletPoints || (fallback ? [fallback] : []),
      whyItMatters: story?.whyItMatters || '',
      l8rsTake: story?.l8rsTake || '',
      imageUrl: story?.imageUrl,
    };
  });
  const draft = reconcileDraft(
    {
      title: completed.hook?.title || 'Newsletter Draft',
      subtitle: completed.hook?.subtitle || '',
      date: previous?.stories.some((story) =>
        reports.some((report) => report.story.id === story.sourceStoryId),
      ) && typeof previous.date === 'string'
        ? previous.date
        : date,
      stories,
      intro: completed.intro || '',
      toc: completed.toc || [],
      memeIdeas: completed.memeIdeas,
      quickSummary: completed.summary || '',
      rawMarkdown: '',
    },
    previous,
  );
  storage.setItem('currentDraft', JSON.stringify(draft));
  return draft;
}
