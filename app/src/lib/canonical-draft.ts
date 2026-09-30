import type { NewsletterDraft } from './draft-generator';
import type { WizardSections } from './studio/wizard-draft';

/** Only completion flags are stored beside the canonical body. Never a second body. */
export function completionFlags(completed: WizardSections) {
  return {
    hook: completed.hook != null, intro: completed.intro != null,
    toc: completed.toc != null, summary: completed.summary != null,
    stories: (completed.stories ?? []).filter(Boolean).map(story => story.sourceStoryId).filter(Boolean),
  };
}

export function hydrateWizard(wizard: Record<string, unknown> | null, draft: NewsletterDraft | null) {
  if (!wizard || !draft) return wizard;
  const flags = wizard.completion as ReturnType<typeof completionFlags> | undefined;
  if (!flags) return wizard; // Unmigrated legacy work remains available for recovery.
  const reports = wizard.selectedReports as Array<{ story: { id: string } }>;
  const navigation = Object.fromEntries(Object.entries(wizard).filter(([key]) => key !== 'completion'));
  return { ...navigation, completed: {
    hook: flags.hook ? { title: draft.title, subtitle: draft.subtitle } : null,
    intro: flags.intro ? draft.intro : null, toc: flags.toc ? draft.toc : null,
    summary: flags.summary ? draft.quickSummary : null, memeIdeas: draft.memeIdeas ?? [],
    stories: (reports ?? []).map(report => flags.stories.includes(report.story.id)
      ? draft.stories.find(story => story.sourceStoryId === report.story.id) ?? null : null),
  } };
}

export function metadataOnly(wizard: Record<string, unknown> | null) {
  if (!wizard || !wizard.completed) return wizard;
  const { completed, ...metadata } = wizard;
  return { ...metadata, completion: { ...completionFlags(completed as WizardSections), stories: ((completed as WizardSections).stories ?? []).flatMap((story, index) => {
    const reports = metadata.selectedReports as Array<{ story: { id: string } }> | undefined;
    return story ? [story.sourceStoryId ?? reports?.[index]?.story.id].filter(Boolean) : [];
  }) } };
}
