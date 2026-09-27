// State Persistence Utility
// Persists curated stories, selections, and research reports to localStorage

import { CuratedStory, ResearchReport } from './types';
import type { NewsletterDraft } from './draft-generator';
import { browserStorage as localStorage } from './browser-storage';

const STORAGE_KEYS = {
    CURATED_STORIES: 'innov8_curated_stories',
    SELECTED_IDS: 'innov8_selected_ids',
    RESEARCH_REPORTS: 'innov8_research_reports',
    LAST_UPDATED: 'innov8_last_updated',
    API_KEY: 'openrouter_api_key',
    CUSTOM_FEEDS: 'innov8_custom_feeds',
    SHOWN_HEADLINES: 'innov8_shown_headlines',
    WIZARD_STATE: 'newsletter-wizard-state',
    CURRENT_DRAFT: 'currentDraft',
} as const;

export const MAX_NEWSLETTER_STORIES = 30;

// Type for the complete persisted state
export interface PersistedState {
    curatedStories: CuratedStory[];
    selectedIds: string[];
    researchReports: ResearchReport[];
    lastUpdated: string;
    customFeeds: any[];
}

export interface SharedSelectionState {
    sessionId: string;
    revision: number;
    curatedStories: CuratedStory[];
    selectedIds: string[];
    researchReports: ResearchReport[];
    wizardState: unknown | null;
    currentDraft: NewsletterDraft | null;
    updatedAt: string | null;
}

export class SharedSelectionError extends Error {
    constructor(
        message: string,
        public readonly status: number,
        public readonly code: string,
        public readonly latest?: SharedSelectionState,
    ) {
        super(message);
        this.name = 'SharedSelectionError';
    }
}

export function validResearchReports(value: unknown): ResearchReport[] {
    if (!Array.isArray(value)) return [];
    return value.filter((report): report is ResearchReport => {
        if (!report || typeof report !== 'object') return false;
        const item = report as Partial<ResearchReport>;
        return !!item.story && typeof item.story.id === 'string' &&
            typeof item.story.headline === 'string' && typeof item.deepResearch === 'string';
    }).map(report => ({
        ...report,
        keyPoints: Array.isArray(report.keyPoints) ? report.keyPoints.filter(point => typeof point === 'string') : [],
        implications: typeof report.implications === 'string' ? report.implications : '',
        sources: Array.isArray(report.sources) ? report.sources.filter(source => typeof source === 'string') : [],
    }));
}

function parseSharedState(value: unknown): SharedSelectionState {
    if (!value || typeof value !== 'object') throw new SharedSelectionError('The shared newsletter has invalid data. Retry or contact the site owner.', 500, 'invalid_state');
    const state = value as Record<string, unknown>;
    if (typeof state.sessionId !== 'string' || !state.sessionId ||
        !Number.isSafeInteger(state.revision) || (state.revision as number) < 0 ||
        !Array.isArray(state.curatedStories) || !Array.isArray(state.selectedIds) ||
        !Array.isArray(state.researchReports)) {
        throw new SharedSelectionError('The shared newsletter has invalid data. Retry or contact the site owner.', 500, 'invalid_state');
    }
    return {
        sessionId: state.sessionId,
        revision: state.revision as number,
        curatedStories: (state.curatedStories as unknown[]).filter((story): story is CuratedStory =>
            !!story && typeof story === 'object' && typeof (story as CuratedStory).id === 'string' && typeof (story as CuratedStory).headline === 'string'),
        selectedIds: (state.selectedIds as unknown[]).filter((id): id is string => typeof id === 'string'),
        researchReports: validResearchReports(state.researchReports),
        wizardState: state.wizardState ?? null,
        currentDraft: state.currentDraft && typeof state.currentDraft === 'object' ? state.currentDraft as NewsletterDraft : null,
        updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : null,
    };
}

/**
 * Save curated stories to localStorage
 */
export function saveCuratedStories(stories: CuratedStory[]): void {
    try {
        localStorage.setItem(STORAGE_KEYS.CURATED_STORIES, JSON.stringify(stories));
        localStorage.setItem(STORAGE_KEYS.LAST_UPDATED, new Date().toISOString());
    } catch (error) {
        console.error('Failed to save curated stories:', error);
    }
}

/**
 * Load curated stories from localStorage
 */
export function loadCuratedStories(): CuratedStory[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.CURATED_STORIES);
        const value = stored ? JSON.parse(stored) : [];
        return Array.isArray(value) ? value.filter(story => story && typeof story.id === 'string' && typeof story.headline === 'string') : [];
    } catch (error) {
        console.error('Failed to load curated stories:', error);
        return [];
    }
}

/**
 * Save selected story IDs to localStorage
 */
export function saveSelectedIds(ids: string[]): void {
    try {
        localStorage.setItem(STORAGE_KEYS.SELECTED_IDS, JSON.stringify(ids));
    } catch (error) {
        console.error('Failed to save selected IDs:', error);
    }
}

/**
 * Load selected story IDs from localStorage
 */
export function loadSelectedIds(): string[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.SELECTED_IDS);
        const value = stored ? JSON.parse(stored) : [];
        return Array.isArray(value) ? value.filter(id => typeof id === 'string') : [];
    } catch (error) {
        console.error('Failed to load selected IDs:', error);
        return [];
    }
}

/**
 * Save research reports to localStorage
 */
export function saveResearchReports(reports: ResearchReport[]): void {
    try {
        localStorage.setItem(STORAGE_KEYS.RESEARCH_REPORTS, JSON.stringify(reports));
    } catch (error) {
        console.error('Failed to save research reports:', error);
    }
}

/**
 * Load research reports from localStorage
 */
export function loadResearchReports(): ResearchReport[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.RESEARCH_REPORTS);
        return validResearchReports(stored ? JSON.parse(stored) : []);
    } catch (error) {
        console.error('Failed to load research reports:', error);
        return [];
    }
}

/**
 * Get the last update timestamp
 */
export function getLastUpdated(): Date | null {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.LAST_UPDATED);
        return stored ? new Date(stored) : null;
    } catch (error) {
        return null;
    }
}

/**
 * Load complete persisted state
 */
export function loadPersistedState(): PersistedState {
    return {
        curatedStories: loadCuratedStories(),
        selectedIds: loadSelectedIds(),
        researchReports: loadResearchReports(),
        lastUpdated: getLastUpdated()?.toISOString() || '',
        customFeeds: loadCustomFeeds(),
    };
}

/**
 * Load the shared selected-news handoff queue from the server.
 */
export async function loadSharedSelection(): Promise<{ initialized: boolean; state: SharedSelectionState | null }> {
    let response: Response;
    try {
        response = await fetch('/api/shared-selection', { cache: 'no-store' });
    } catch {
        throw new SharedSelectionError('Could not connect to the shared newsletter. Check your connection and retry.', 0, 'network');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
        throw new SharedSelectionError(data?.error || 'Could not load the shared newsletter.', response.status, data?.code || 'load_failed');
    }
    if (data.initialized === false && !data.state) return { initialized: false, state: null };
    return { initialized: true, state: parseSharedState(data.state) };
}

/**
 * Save the shared selected-news handoff queue to the server.
 */
export async function saveSharedSelection(state: Omit<SharedSelectionState, 'revision' | 'updatedAt'>, expectedRevision: number): Promise<SharedSelectionState> {
    let response: Response;
    try {
        response = await fetch('/api/shared-selection', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...state, expectedRevision }),
        });
    } catch {
        throw new SharedSelectionError('Could not save the shared newsletter. Your changes remain on this device.', 0, 'network');
    }
    const data = await response.json().catch(() => null);
    if (!response.ok || !data?.success) {
        throw new SharedSelectionError(data?.error || 'Could not save the shared newsletter. Your changes remain on this device.', response.status, data?.code || 'save_failed', data?.state ? parseSharedState(data.state) : undefined);
    }
    return parseSharedState(data.state);
}

interface ClearPersistedStateOptions {
    includeShownHeadlines?: boolean;
}

/**
 * Clear persisted session state. API keys and custom feeds are intentionally kept.
 */
export function clearPersistedState(options: ClearPersistedStateOptions = {}): void {
    try {
        localStorage.removeItem(STORAGE_KEYS.CURATED_STORIES);
        localStorage.removeItem(STORAGE_KEYS.SELECTED_IDS);
        localStorage.removeItem(STORAGE_KEYS.RESEARCH_REPORTS);
        localStorage.removeItem(STORAGE_KEYS.LAST_UPDATED);
        const previousDraft = localStorage.getItem(STORAGE_KEYS.CURRENT_DRAFT);
        if (previousDraft) localStorage.setItem('studio_previous_draft_backup', previousDraft);
        localStorage.removeItem(STORAGE_KEYS.WIZARD_STATE);
        localStorage.removeItem(STORAGE_KEYS.CURRENT_DRAFT);
        if (options.includeShownHeadlines) {
            clearShownHeadlines();
        }
    } catch (error) {
        console.error('Failed to clear persisted state:', error);
    }
}

/**
 * Get API key from localStorage
 */
export function getApiKey(): string {
    try {
        return localStorage.getItem(STORAGE_KEYS.API_KEY) || '';
    } catch (error) {
        return '';
    }
}

export function saveApiKey(key: string): void {
    try {
        localStorage.setItem(STORAGE_KEYS.API_KEY, key);
    } catch (error) {
        console.error('Failed to save API key:', error);
    }
}

/**
 * Save custom feeds to localStorage
 */
export function saveCustomFeeds(feeds: any[]): void {
    try {
        localStorage.setItem(STORAGE_KEYS.CUSTOM_FEEDS, JSON.stringify(feeds));
    } catch (error) {
        console.error('Failed to save custom feeds:', error);
    }
}

/**
 * Load custom feeds from localStorage
 */
export function loadCustomFeeds(): any[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.CUSTOM_FEEDS);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        return [];
    }
}

interface ShownHeadline {
    text: string;
    shownAt: string;
}

/**
 * Save shown headlines to localStorage (appends to existing, auto-expires after 48h)
 */
export function saveShownHeadlines(headlines: string[]): void {
    try {
        const existing = loadShownHeadlines();
        const now = new Date().toISOString();
        const newEntries: ShownHeadline[] = headlines.map(text => ({ text, shownAt: now }));
        const combined = [...existing, ...newEntries];
        localStorage.setItem(STORAGE_KEYS.SHOWN_HEADLINES, JSON.stringify(combined));
    } catch (error) {
        console.error('Failed to save shown headlines:', error);
    }
}

/**
 * Clear the hidden shown-headline memory used by "Find More".
 */
export function clearShownHeadlines(): void {
    try {
        localStorage.removeItem(STORAGE_KEYS.SHOWN_HEADLINES);
    } catch (error) {
        console.error('Failed to clear shown headlines:', error);
    }
}

/**
 * Load shown headlines from localStorage (auto-expires entries older than 48h)
 */
export function loadShownHeadlines(): ShownHeadline[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEYS.SHOWN_HEADLINES);
        if (!stored) return [];
        const all: ShownHeadline[] = JSON.parse(stored);
        const cutoff = new Date();
        cutoff.setHours(cutoff.getHours() - 48);
        // Filter out expired entries
        return all.filter(h => new Date(h.shownAt) >= cutoff);
    } catch (error) {
        return [];
    }
}
