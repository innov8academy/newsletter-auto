'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { ResearchReport } from '@/lib/types';
import { saveWizardDraft } from '@/lib/studio/wizard-draft';
import type { StoryBlock } from '@/lib/draft-generator';
import { browserStorage as localStorage } from '@/lib/browser-storage';
import { MAX_NEWSLETTER_STORIES, validResearchReports } from '@/lib/storage';
import { useSharedSession } from '@/components/SharedSessionProvider';

// Wizard step definitions
export const WIZARD_STEPS = [
    { id: 'setup', label: 'Setup', description: 'Select and order stories' },
    { id: 'hook', label: 'Hook', description: 'Title & Subtitle' },
    { id: 'intro', label: 'Intro', description: 'Introduction paragraph' },
    { id: 'toc', label: 'TOC', description: "In Today's Post" },
    { id: 'stories', label: 'Stories', description: 'Generate each story' },
    { id: 'summary', label: 'Summary', description: 'Quick summary & outro' },
] as const;

export type WizardStepId = typeof WIZARD_STEPS[number]['id'];

// Completed section data
interface CompletedSections {
    hook: {
        title: string;
        subtitle: string;
    } | null;
    intro: string | null;
    toc: string[] | null;
    stories: StoryBlock[];
    summary: string | null;
    memeIdeas: Array<{
        templateName: string;
        topText: string;
        bottomText: string;
        angle: string;
    }>;
}

// Main wizard state
interface WizardState {
    currentStep: number;
    currentStoryIndex: number; // For story step (0, 1, 2...)
    selectedReports: ResearchReport[];
    completed: CompletedSections;
    isGenerating: boolean;
    error: string | null;
}

// Context value interface
interface WizardContextValue extends WizardState {
    // Navigation
    goToStep: (step: number) => void;
    nextStep: () => void;
    prevStep: () => void;
    canGoBack: boolean;
    canGoNext: boolean;

    // Story navigation
    nextStory: () => void;
    prevStory: () => void;
    setCurrentStoryIndex: (index: number) => void;

    // Report selection
    setSelectedReports: (reports: ResearchReport[]) => void;
    addReport: (report: ResearchReport) => void;
    removeReport: (reportId: string) => void;
    reorderReports: (fromIndex: number, toIndex: number) => void;

    // Section completion
    saveHook: (title: string, subtitle: string) => void;
    saveIntro: (intro: string) => void;
    saveToc: (toc: string[]) => void;
    saveStory: (storyIndex: number, story: StoryBlock) => void;
    saveStoryBySource: (sourceId: string, story: StoryBlock) => void;
    saveSummary: (summary: string) => void;
    saveMemeIdeas: (ideas: CompletedSections['memeIdeas']) => void;

    // Generation state
    setIsGenerating: (value: boolean) => void;
    setError: (error: string | null) => void;

    // Utility
    resetWizard: () => void;
    getProgress: () => { current: number; total: number; percentage: number };
    isStepComplete: (stepIndex: number) => boolean;
}

const STORAGE_KEY = 'newsletter-wizard-state';
const STORAGE_SCHEMA_VERSION = 2;

function createInitialCompletedSections(): CompletedSections {
    return {
        hook: null,
        intro: null,
        toc: null,
        stories: [],
        summary: null,
        memeIdeas: [],
    };
}

function getReportSignature(reports: ResearchReport[]): string {
    return reports.map(report => report.story.id).join('|');
}

function isArticleStyleStory(story: unknown): story is StoryBlock {
    if (!story || typeof story !== 'object') return false;
    const candidate = story as Partial<StoryBlock>;
    return (
        typeof candidate.title === 'string' &&
        typeof candidate.hookParagraph === 'string' &&
        Array.isArray(candidate.bulletPoints) &&
        typeof candidate.whyItMatters === 'string' &&
        typeof candidate.l8rsTake === 'string'
    );
}

function isArticleStyleCompleted(completed: Partial<CompletedSections> | undefined): boolean {
    if (!completed || !Array.isArray(completed.stories) || completed.stories.length === 0) return true;
    return completed.stories.every(story => !story || isArticleStyleStory(story));
}

function clampStep(step: number): number {
    if (!Number.isFinite(step)) return 0;
    return Math.max(0, Math.min(step, WIZARD_STEPS.length - 1));
}

function reconcileCompletedStories(
    completed: CompletedSections,
    previousReports: ResearchReport[],
    nextReports: ResearchReport[],
): CompletedSections {
    const storiesById = new Map<string, StoryBlock>();
    previousReports.forEach((report, index) => {
        const story = completed.stories[index];
        if (story) storiesById.set(report.story.id, story);
    });

    return {
        ...completed,
        stories: nextReports.map(report => storiesById.get(report.story.id)) as StoryBlock[],
    };
}

// Initial state
const initialCompletedSections: CompletedSections = createInitialCompletedSections();

const initialState: WizardState = {
    currentStep: 0,
    currentStoryIndex: 0,
    selectedReports: [],
    completed: initialCompletedSections,
    isGenerating: false,
    error: null,
};

// Create context
const WizardContext = createContext<WizardContextValue | undefined>(undefined);

// Provider component
export function WizardProvider({ children }: { children: ReactNode }) {
    const { client: sharedClient, snapshot: sharedSnapshot } = useSharedSession();
    const [state, setState] = useState<WizardState>(initialState);
    const [hasRestored, setHasRestored] = useState(false);
    const [stateSessionId, setStateSessionId] = useState<string | null>(null);
    const [stateWizardVersion, setStateWizardVersion] = useState('null');
    const appliedSessionId = useRef<string | null>(null);
    const appliedWizard = useRef<string | null>(null);

    // Restore the exact report subset and order saved with this shared session.
    useEffect(() => {
        const session = sharedSnapshot.state;
        if (!session) return;
        const serialized = JSON.stringify(session.wizardState);
        if (appliedSessionId.current === session.sessionId && appliedWizard.current === serialized) return;
        const currentReports = validResearchReports(session.researchReports);
        let next: WizardState = {
            ...initialState, selectedReports: currentReports,
            completed: createInitialCompletedSections(),
        };
        try {
            const parsed = session.wizardState as Record<string, unknown> | null;
            if (parsed && typeof parsed === 'object') {
                const savedReports = validResearchReports(parsed.selectedReports);
                const available = new Map(currentReports.map(report => [report.story.id, report]));
                const chosen = savedReports.map(report => available.get(report.story.id));
                const completed = parsed.completed as Partial<CompletedSections> | undefined;
                const valid = parsed.schemaVersion === STORAGE_SCHEMA_VERSION &&
                    Array.isArray(parsed.selectedReports) && savedReports.length === parsed.selectedReports.length &&
                    chosen.every(Boolean) && isArticleStyleCompleted(completed) &&
                    (!completed?.stories || Array.isArray(completed.stories));
                if (valid) {
                    const selectedReports = chosen as ResearchReport[];
                    const maxStoryIndex = Math.max(0, selectedReports.length - 1);
                    next = {
                        ...initialState,
                        currentStep: clampStep(Number(parsed.currentStep ?? 0)),
                        currentStoryIndex: Math.max(0, Math.min(Number(parsed.currentStoryIndex ?? 0), maxStoryIndex)),
                        selectedReports,
                        completed: { ...createInitialCompletedSections(), ...completed },
                    };
                } else {
                    localStorage.setItem('studio_invalid_wizard_backup', JSON.stringify(parsed));
                }
            }
        } catch (error) {
            console.error('[Wizard] Failed to restore shared state:', error);
        }
        appliedSessionId.current = session.sessionId;
        appliedWizard.current = serialized;
        setState(next);
        setStateSessionId(session.sessionId);
        setStateWizardVersion(serialized);
        setHasRestored(true);
    }, [sharedSnapshot.state]);

    // Local cache and server write are both tied to the session revision.
    useEffect(() => {
        if (!hasRestored || stateSessionId !== sharedSnapshot.state?.sessionId ||
            stateWizardVersion !== JSON.stringify(sharedSnapshot.state?.wizardState)) return;
        if (!state.selectedReports.length && !sharedSnapshot.state.researchReports.length && !sharedSnapshot.state.wizardState) return;
        const toSave = {
            currentStep: state.currentStep,
            currentStoryIndex: state.currentStoryIndex,
            selectedReports: state.selectedReports,
            schemaVersion: STORAGE_SCHEMA_VERSION,
            reportSignature: getReportSignature(state.selectedReports),
            completed: state.completed,
        };
        const serialized = JSON.stringify(toSave);
        if (serialized === appliedWizard.current) return;
        try {
            localStorage.setItem(STORAGE_KEY, serialized);
            const currentDraft = state.selectedReports.length
                ? saveWizardDraft(state.completed, state.selectedReports, getCurrentDateContext())
                : null;
            sharedClient.mutate({ wizardState: toSave, currentDraft });
            appliedWizard.current = serialized;
            setStateWizardVersion(serialized);
        } catch (error) {
            console.error('[Wizard] Failed to save state:', error);
        }
    }, [hasRestored, stateSessionId, stateWizardVersion, sharedSnapshot.state, state.currentStep, state.currentStoryIndex, state.selectedReports, state.completed]);

    // Navigation
    const goToStep = useCallback((step: number) => {
        if (step >= 0 && step < WIZARD_STEPS.length) {
            setState(prev => ({ ...prev, currentStep: step, error: null }));
        }
    }, []);

    const nextStep = useCallback(() => {
        setState(prev => {
            const next = Math.min(prev.currentStep + 1, WIZARD_STEPS.length - 1);
            return { ...prev, currentStep: next, error: null };
        });
    }, []);

    const prevStep = useCallback(() => {
        setState(prev => {
            const next = Math.max(prev.currentStep - 1, 0);
            return { ...prev, currentStep: next, error: null };
        });
    }, []);

    // Story navigation
    const nextStory = useCallback(() => {
        setState(prev => {
            const maxIndex = Math.max(0, prev.selectedReports.length - 1);
            const next = Math.min(prev.currentStoryIndex + 1, maxIndex);
            return { ...prev, currentStoryIndex: next };
        });
    }, []);

    const prevStory = useCallback(() => {
        setState(prev => ({
            ...prev,
            currentStoryIndex: Math.max(prev.currentStoryIndex - 1, 0),
        }));
    }, []);

    const setCurrentStoryIndex = useCallback((index: number) => {
        setState(prev => ({ ...prev, currentStoryIndex: index }));
    }, []);

    // Report management
    const setSelectedReports = useCallback((reports: ResearchReport[]) => {
        setState(prev => reports.length > MAX_NEWSLETTER_STORIES
            ? { ...prev, error: `A newsletter can contain at most ${MAX_NEWSLETTER_STORIES} stories.` }
            : {
                ...prev,
                currentStoryIndex: Math.min(prev.currentStoryIndex, Math.max(0, reports.length - 1)),
                selectedReports: reports,
                completed: reconcileCompletedStories(prev.completed, prev.selectedReports, reports),
            });
    }, []);

    const addReport = useCallback((report: ResearchReport) => {
        setState(prev => {
            if (prev.selectedReports.find(r => r.story.id === report.story.id)) {
                return prev;
            }
            if (prev.selectedReports.length >= MAX_NEWSLETTER_STORIES) {
                return { ...prev, error: `A newsletter can contain at most ${MAX_NEWSLETTER_STORIES} stories.` };
            }
            const selectedReports = [...prev.selectedReports, report];
            return {
                ...prev,
                selectedReports,
                completed: reconcileCompletedStories(prev.completed, prev.selectedReports, selectedReports),
            };
        });
    }, []);

    const removeReport = useCallback((reportId: string) => {
        setState(prev => {
            const selectedReports = prev.selectedReports.filter(r => r.story.id !== reportId);
            return {
                ...prev,
                currentStoryIndex: Math.min(prev.currentStoryIndex, Math.max(0, selectedReports.length - 1)),
                selectedReports,
                completed: reconcileCompletedStories(prev.completed, prev.selectedReports, selectedReports),
            };
        });
    }, []);

    const reorderReports = useCallback((fromIndex: number, toIndex: number) => {
        setState(prev => {
            const reports = [...prev.selectedReports];
            const [removed] = reports.splice(fromIndex, 1);
            reports.splice(toIndex, 0, removed);
            return {
                ...prev,
                selectedReports: reports,
                completed: reconcileCompletedStories(prev.completed, prev.selectedReports, reports),
            };
        });
    }, []);

    // Section savers
    const saveHook = useCallback((title: string, subtitle: string) => {
        setState(prev => ({
            ...prev,
            completed: { ...prev.completed, hook: { title, subtitle } },
        }));
    }, []);

    const saveIntro = useCallback((intro: string) => {
        setState(prev => ({
            ...prev,
            completed: { ...prev.completed, intro },
        }));
    }, []);

    const saveToc = useCallback((toc: string[]) => {
        setState(prev => ({
            ...prev,
            completed: { ...prev.completed, toc },
        }));
    }, []);

    const saveStory = useCallback((storyIndex: number, story: StoryBlock) => {
        setState(prev => {
            const stories = [...prev.completed.stories];
            stories[storyIndex] = story;
            return {
                ...prev,
                completed: { ...prev.completed, stories },
            };
        });
    }, []);

    const saveSummary = useCallback((summary: string) => {
        setState(prev => ({
            ...prev,
            completed: { ...prev.completed, summary },
        }));
    }, []);

    const saveMemeIdeas = useCallback((ideas: CompletedSections['memeIdeas']) => {
        setState(prev => ({
            ...prev,
            completed: { ...prev.completed, memeIdeas: ideas },
        }));
    }, []);

    // Generation state
    const setIsGenerating = useCallback((value: boolean) => {
        setState(prev => ({ ...prev, isGenerating: value }));
    }, []);

    const setError = useCallback((error: string | null) => {
        setState(prev => ({ ...prev, error }));
    }, []);

    // Utility
    const resetWizard = useCallback(() => {
        setState({ ...initialState, completed: createInitialCompletedSections() });
        localStorage.removeItem(STORAGE_KEY);
    }, []);

    const saveStoryBySource = useCallback((sourceId: string, story: StoryBlock) => {
        setState(prev => {
            const index = prev.selectedReports.findIndex(report => report.story.id === sourceId);
            if (index < 0) return prev;
            const stories = [...prev.completed.stories];
            stories[index] = { ...story, sourceStoryId: sourceId };
            return { ...prev, completed: { ...prev.completed, stories } };
        });
    }, []);

    const getProgress = useCallback(() => {
        const totalSteps = WIZARD_STEPS.length;
        const storiesTotal = state.selectedReports.length;
        const storiesComplete = state.completed.stories.filter(s => s && s.title).length;

        // Calculate weighted progress
        // Stories step counts as multiple steps
        let current = state.currentStep;
        if (state.currentStep === 4 && storiesTotal > 0) {
            // Add partial progress for stories
            current += (storiesComplete / storiesTotal);
        }

        const total = totalSteps;
        const percentage = Math.round((current / total) * 100);

        return { current: Math.round(current), total, percentage };
    }, [state.currentStep, state.selectedReports.length, state.completed.stories]);

    const isStepComplete = useCallback((stepIndex: number) => {
        const stepId = WIZARD_STEPS[stepIndex]?.id;
        switch (stepId) {
            case 'setup':
                return state.selectedReports.length > 0;
            case 'hook':
                return state.completed.hook !== null;
            case 'intro':
                return state.completed.intro !== null;
            case 'toc':
                return state.completed.toc !== null;
            case 'stories':
                return state.completed.stories.length === state.selectedReports.length &&
                    state.completed.stories.every(s => s && s.title);
            case 'summary':
                return state.completed.summary !== null;
            default:
                return false;
        }
    }, [state.selectedReports.length, state.completed]);

    // Computed values
    const canGoBack = state.currentStep > 0;
    const canGoNext = isStepComplete(state.currentStep) && state.currentStep < WIZARD_STEPS.length - 1;

    const value: WizardContextValue = {
        ...state,
        goToStep,
        nextStep,
        prevStep,
        canGoBack,
        canGoNext,
        nextStory,
        prevStory,
        setCurrentStoryIndex,
        setSelectedReports,
        addReport,
        removeReport,
        reorderReports,
        saveHook,
        saveIntro,
        saveToc,
        saveStory,
        saveStoryBySource,
        saveSummary,
        saveMemeIdeas,
        setIsGenerating,
        setError,
        resetWizard,
        getProgress,
        isStepComplete,
    };

    return (
        <WizardContext.Provider value={value}>
            {children}
        </WizardContext.Provider>
    );
}

// Hook to use wizard context
export function useWizard() {
    const context = useContext(WizardContext);
    if (context === undefined) {
        throw new Error('useWizard must be used within a WizardProvider');
    }
    return context;
}

// Helper to get current date for prompts
export function getCurrentDateContext(): string {
    const now = new Date();
    return now.toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
    });
}

// Date injection prompt section
export function getDateInjectionPrompt(): string {
    const dateContext = getCurrentDateContext();
    return `## CURRENT DATE: ${dateContext}
⚠️ CRITICAL: Today is ${dateContext}. We are in January 2026.
- Do NOT reference "Q1 2025", "late 2024", or outdated timelines
- All predictions should be from TODAY forward
- If something happened in the past, use specific dates like "in December 2025"`;
}
