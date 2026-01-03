// Types for the newsletter automation system

export interface NewsItem {
  id: string;
  title: string;
  url: string;
  source: string;
  sourceName: string;
  publishedAt: string;
  summary?: string;
  imageUrl?: string;
  author?: string;
  content?: string;
  isSelected?: boolean;
}

// Curated story after AI processing
export interface CuratedStory {
  id: string;
  headline: string;
  summary: string;
  category: string;
  baseScore: number;
  finalScore: number;
  entities: string[];
  originalUrl: string | null;
  sources: string[]; // All sources that mentioned this story
  publishedAt: string;
  crossSourceCount: number;
  boosts: string[]; // Reasons for score boosts
}

export interface NewsletterConfig {
  name: string;
  tagline: string;
  voiceGuidelines: string;
  imageStylePrompt: string;
  rssFeeds: RSSFeed[];
}

export interface RSSFeed {
  name: string;
  url: string;
  category: string;
  tier?: number;
}

export interface ResearchReport {
  story: CuratedStory;
  deepResearch: string;
  keyPoints: string[];
  implications: string;
  sources: string[];
}

export interface NewsletterDraft {
  hookTitle: string;
  introImagePrompt: string;
  introImageUrl?: string;
  introText: string;
  tableOfContents: string[];
  sections: NewsletterSection[];
  summary: string;
}

export interface NewsletterSection {
  heading: string;
  imagePrompt: string;
  imageUrl?: string;
  content: string;
  sourceUrl: string;
}

// Curation progress for UI
export interface CurationProgress {
  stage: 'fetching' | 'extracting' | 'scoring' | 'done';
  current: number;
  total: number;
  message: string;
}
