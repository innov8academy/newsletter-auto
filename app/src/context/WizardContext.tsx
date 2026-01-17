'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { ResearchReport } from '@/lib/types';
import { StoryBlock } from '@/lib/draft-generator';

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

// Initial state
const initialCompletedSections: CompletedSections = {
    hook: null,
    intro: null,
    toc: null,
    stories: [],
    summary: null,
    memeIdeas: [],
};

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
    const [state, setState] = useState<WizardState>(initialState);

    // Load state from localStorage on mount
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                // Don't restore isGenerating or error state
                setState(prev => ({
                    ...prev,
                    currentStep: parsed.currentStep ?? 0,
                    currentStoryIndex: parsed.currentStoryIndex ?? 0,
                    selectedReports: parsed.selectedReports ?? [],
                    completed: {
                        ...initialCompletedSections,
                        ...parsed.completed,
                    },
                }));
            }
        } catch (e) {
            console.error('[Wizard] Failed to restore state:', e);
        }
    }, []);

    // Save state to localStorage on changes (debounced)
    useEffect(() => {
        const timeoutId = setTimeout(() => {
            try {
                const toSave = {
                    currentStep: state.currentStep,
                    currentStoryIndex: state.currentStoryIndex,
                    selectedReports: state.selectedReports,
                    completed: state.completed,
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
            } catch (e) {
                console.error('[Wizard] Failed to save state:', e);
            }
        }, 300);

        return () => clearTimeout(timeoutId);
    }, [state.currentStep, state.currentStoryIndex, state.selectedReports, state.completed]);

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
        setState(prev => ({ ...prev, selectedReports: reports }));
    }, []);

    const addReport = useCallback((report: ResearchReport) => {
        setState(prev => {
            if (prev.selectedReports.find(r => r.story.id === report.story.id)) {
                return prev;
            }
            return { ...prev, selectedReports: [...prev.selectedReports, report] };
        });
    }, []);

    const removeReport = useCallback((reportId: string) => {
        setState(prev => ({
            ...prev,
            selectedReports: prev.selectedReports.filter(r => r.story.id !== reportId),
        }));
    }, []);

    const reorderReports = useCallback((fromIndex: number, toIndex: number) => {
        setState(prev => {
            const reports = [...prev.selectedReports];
            const [removed] = reports.splice(fromIndex, 1);
            reports.splice(toIndex, 0, removed);
            return { ...prev, selectedReports: reports };
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
        setState(initialState);
        localStorage.removeItem(STORAGE_KEY);
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
