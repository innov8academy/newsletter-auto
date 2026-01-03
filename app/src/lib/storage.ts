// State Persistence Utility
// Persists curated stories, selections, and research reports to localStorage

import { CuratedStory, ResearchReport } from './types';

const STORAGE_KEYS = {
    CURATED_STORIES: 'innov8_curated_stories',
    SELECTED_IDS: 'innov8_selected_ids',
    RESEARCH_REPORTS: 'innov8_research_reports',
    LAST_UPDATED: 'innov8_last_updated',
    API_KEY: 'openrouter_api_key',
    CUSTOM_FEEDS: 'innov8_custom_feeds',
} as const;

// Type for the complete persisted state
export interface PersistedState {
    curatedStories: CuratedStory[];
    selectedIds: string[];
    researchReports: ResearchReport[];
    lastUpdated: string;
    customFeeds: any[];
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
        return stored ? JSON.parse(stored) : [];
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
        return stored ? JSON.parse(stored) : [];
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
        return stored ? JSON.parse(stored) : [];
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
 * Clear all persisted state (for refresh)
 */
export function clearPersistedState(): void {
    try {
        localStorage.removeItem(STORAGE_KEYS.CURATED_STORIES);
        localStorage.removeItem(STORAGE_KEYS.SELECTED_IDS);
        localStorage.removeItem(STORAGE_KEYS.RESEARCH_REPORTS);
        localStorage.removeItem(STORAGE_KEYS.LAST_UPDATED);
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
