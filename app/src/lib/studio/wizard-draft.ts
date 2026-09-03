import type { NewsletterDraft, StoryBlock } from '../draft-generator';
import type { ResearchReport } from '../types';
import { reconcileDraft } from './state';

export interface WizardSections {
  hook: { title: string; subtitle: string } | null;
  intro: string | null;
  toc: string[] | null;
  stories: StoryBlock[];
  summary: string | null;
  memeIdeas: NewsletterDraft['memeIdeas'];
}
export function saveWizardDraft(
  completed: WizardSections,
  reports: ResearchReport[],
  date: string,
  storage: Pick<Storage, 'getItem' | 'setItem'> = localStorage,
) {
  let previous: NewsletterDraft | null = null;
  const raw = storage.getItem('currentDraft');
  try {
    previous = raw ? JSON.parse(raw) : null;
  } catch {
    if (raw) storage.setItem('studio_invalid_draft_backup', raw);
  }
  const stories = reports.map((report, index): StoryBlock => {
    const story = completed.stories[index];
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
      )
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
