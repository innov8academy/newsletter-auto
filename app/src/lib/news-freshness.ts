import type { CuratedStory, NewsItem } from './types';

export const MAX_NEWS_AGE_HOURS = 36;

export function normalizeNewsDate(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) return '';
  const time = Date.parse(value);
  return Number.isFinite(time) ? new Date(time).toISOString() : '';
}

export function isFreshNews(value: string, now = Date.now(), hours = MAX_NEWS_AGE_HOURS): boolean {
  const time = Date.parse(value);
  return Number.isFinite(time) && time <= now && time >= now - hours * 3600000;
}

// Preserve selected work, but do not keep old unselected cards at the top forever.
export function currentNews(stories: CuratedStory[], selectedIds: string[], now = Date.now()): CuratedStory[] {
  const selected = new Set(selectedIds);
  return stories.filter(story => selected.has(story.id) || isFreshNews(story.publishedAt, now))
    .sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt) || b.finalScore - a.finalScore);
}

export function selectNewsCandidates(items: NewsItem[], limit: number): NewsItem[] {
  const sorted = [...items].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt));
  const sources = new Set<string>();
  const firstPerSource = sorted.filter(item => {
    if (sources.has(item.sourceName)) return false;
    sources.add(item.sourceName);
    return true;
  });
  const chosen = new Set(firstPerSource);
  return [...firstPerSource, ...sorted.filter(item => !chosen.has(item))].slice(0, limit);
}
