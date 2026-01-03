'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { CuratedStory, ResearchReport } from '@/lib/types';
import { RESEARCH_MODELS, ResearchModelId } from '@/lib/researcher';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import {
    loadCuratedStories,
    loadSelectedIds,
    loadResearchReports,
    saveResearchReports,
    getApiKey,
    getLastUpdated,
} from '@/lib/storage';
import {
    Sparkles,
    FileText,
    Loader2,
    ChevronLeft,
    ChevronRight,
    AlertCircle,
    BookOpen,
    TrendingUp,
    Users,
    Cpu,
    Scale,
    Eye,
    Link2,
    CheckCircle2,
    XCircle,
    Plus,
    Search,
    ArrowLeft,
    Clock,
    Settings2,
} from 'lucide-react';

interface StoryResearchState {
    status: 'idle' | 'loading' | 'success' | 'error';
    report?: ResearchReport;
    error?: string;
}

// Custom topic type for manual research
interface CustomTopic {
    id: string;
    topic: string;
    createdAt: Date;
}

export default function ResearchPage() {
    const router = useRouter();

    // State
    const [stories, setStories] = useState<CuratedStory[]>([]);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [researchReports, setResearchReports] = useState<ResearchReport[]>([]);
    const [researchStates, setResearchStates] = useState<Record<string, StoryResearchState>>({});
    const [activeReportId, setActiveReportId] = useState<string | null>(null);
    const [isResearchingAll, setIsResearchingAll] = useState(false);
    const [apiKey, setApiKey] = useState('');
    const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

    // Model selection
    const [selectedModel, setSelectedModel] = useState<ResearchModelId>('perplexity/sonar-deep-research');

    // Manual topic input
    const [customTopic, setCustomTopic] = useState('');
    const [customTopics, setCustomTopics] = useState<CustomTopic[]>([]);
    const [isEnhancing, setIsEnhancing] = useState(false);

    // Client-side only flag to prevent hydration mismatch
    const [isMounted, setIsMounted] = useState(false);

    // Load persisted state on mount
    useEffect(() => {
        const loadedStories = loadCuratedStories();
        const loadedIds = loadSelectedIds();
        const loadedReports = loadResearchReports();
        const loadedKey = getApiKey();
        const loadedTime = getLastUpdated();

        setStories(loadedStories);
        setSelectedIds(new Set(loadedIds));
        setResearchReports(loadedReports);
        setApiKey(loadedKey);
        setLastUpdated(loadedTime);

        // Initialize research states from saved reports
        const initialStates: Record<string, StoryResearchState> = {};
        loadedReports.forEach(report => {
            initialStates[report.story.id] = { status: 'success', report };
        });
        setResearchStates(initialStates);

        // Auto-select first report if available
        if (loadedReports.length > 0) {
            setActiveReportId(loadedReports[0].story.id);
        }

        // Mark as mounted for client-side only rendering
        setIsMounted(true);
    }, []);

    // Get selected stories
    const selectedStories = stories.filter(s => selectedIds.has(s.id));

    // Section icons - new newsletter format
    const sectionIcons: Record<string, React.ReactNode> = {
        'The Story': <BookOpen className="w-4 h-4" />,
        'The Context': <TrendingUp className="w-4 h-4" />,
        'The Hot Take': <Sparkles className="w-4 h-4" />,
        "What's Next": <Eye className="w-4 h-4" />,
        'Quotables': <FileText className="w-4 h-4" />,
    };

    // Research a single story
    async function researchStory(story: CuratedStory) {
        setResearchStates(prev => ({
            ...prev,
            [story.id]: { status: 'loading' }
        }));

        try {
            const response = await fetch('/api/research', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ story, apiKey, modelId: selectedModel }),
            });

            const data = await response.json();

            if (data.success && data.report) {
                const newReport = data.report;
                setResearchStates(prev => ({
                    ...prev,
                    [story.id]: { status: 'success', report: newReport }
                }));

                // Update reports list and persist
                setResearchReports(prev => {
                    const updated = prev.find(r => r.story.id === story.id)
                        ? prev.map(r => r.story.id === story.id ? newReport : r)
                        : [...prev, newReport];
                    saveResearchReports(updated);
                    return updated;
                });

                setActiveReportId(story.id);
            } else {
                setResearchStates(prev => ({
                    ...prev,
                    [story.id]: { status: 'error', error: data.error || 'Research failed' }
                }));
            }
        } catch (error) {
            setResearchStates(prev => ({
                ...prev,
                [story.id]: {
                    status: 'error',
                    error: error instanceof Error ? error.message : 'Network error'
                }
            }));
        }
    }

    // Research custom topic
    async function researchCustomTopic() {
        if (!customTopic.trim()) return;

        let enhancedSummary = `User-requested research on: ${customTopic}`;

        // Step 1: Enhance the prompt if we have an API key
        if (apiKey) {
            try {
                setIsEnhancing(true);
                const response = await fetch('/api/enhance-prompt', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ topic: customTopic, apiKey }),
                });

                const data = await response.json();
                if (data.success && data.enhancedPrompt) {
                    enhancedSummary = data.enhancedPrompt;
                }
            } catch (error) {
                console.error('Failed to enhance prompt:', error);
                // Continue with original topic if enhancement fails
            } finally {
                setIsEnhancing(false);
            }
        }

        const topicId = `custom-${Date.now()}`;
        const fakeStory: CuratedStory = {
            id: topicId,
            headline: customTopic,
            summary: enhancedSummary, // Use the enhanced prompt here
            category: 'custom',
            sources: ['manual'],
            baseScore: 10,
            finalScore: 10,
            crossSourceCount: 1,
            entities: [],
            originalUrl: null,
            publishedAt: new Date().toISOString(),
            boosts: ['manual-research'],
        };

        // Add to custom topics
        setCustomTopics(prev => [...prev, { id: topicId, topic: customTopic, createdAt: new Date() }]);
        setCustomTopic('');

        // Research it
        await researchStory(fakeStory);
    }

    // Research all selected stories
    async function researchAll() {
        setIsResearchingAll(true);

        for (const story of selectedStories) {
            if (researchStates[story.id]?.status !== 'success') {
                await researchStory(story);
            }
        }

        setIsResearchingAll(false);
    }

    const activeReport = activeReportId ? researchStates[activeReportId]?.report : null;
    const completedCount = Object.values(researchStates).filter(s => s.status === 'success').length;
    const allItems = [...selectedStories, ...customTopics.map(ct => ({ id: ct.id, headline: ct.topic, isCustom: true } as CuratedStory & { isCustom: boolean }))];

    return (
        <div className="min-h-screen bg-[#0B0B0F] text-white noise-overlay">
            {/* Atmospheric gradient */}
            <div className="fixed inset-0 bg-gradient-to-br from-amber-900/5 via-transparent to-teal-900/5 pointer-events-none" />

            {/* Header */}
            <header className="sticky top-0 z-50 bg-[#0B0B0F]/80 backdrop-blur-xl border-b border-white/5">
                <div className="max-w-[1800px] mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push('/')}
                            className="text-white/50 hover:text-amber-400 hover:bg-white/5"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Curation
                        </Button>
                        <div className="h-6 w-px bg-white/10" />
                        <h1 className="font-display text-xl flex items-center gap-2">
                            <Sparkles className="w-5 h-5 text-amber-400" />
                            Deep Research Lab
                        </h1>
                    </div>

                    <div className="flex items-center gap-3">
                        {/* Model Selector - Styled as a pill */}
                        <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-surface border border-white/10">
                            <div className="w-2 h-2 rounded-full bg-teal-400 animate-pulse" />
                            <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as ResearchModelId)}>
                                <SelectTrigger className="w-auto min-w-[180px] bg-transparent border-0 text-white text-sm h-7 p-0 focus:ring-0 focus:ring-offset-0">
                                    <SelectValue placeholder="Select model" />
                                </SelectTrigger>
                                <SelectContent className="bg-[#1a1a22] border-white/10 shadow-xl shadow-black/50 z-[100]">
                                    {RESEARCH_MODELS.map((model) => (
                                        <SelectItem
                                            key={model.id}
                                            value={model.id}
                                            className="text-white focus:bg-amber-500/20 focus:text-amber-300 cursor-pointer"
                                        >
                                            <div className="flex flex-col py-1">
                                                <span className="font-medium">{model.name}</span>
                                                <span className="text-xs text-white/40">{model.description}</span>
                                            </div>
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>

                        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20 px-3 py-1">
                            {completedCount} researched
                        </Badge>

                        {completedCount > 0 && (
                            <Button
                                onClick={() => router.push('/draft')}
                                className="bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-400 hover:to-teal-500 text-[#0B0B0F] h-9 px-4 font-semibold text-sm border-0 shadow-glow-teal"
                            >
                                <FileText className="w-4 h-4 mr-2" />
                                Create Newsletter
                            </Button>
                        )}
                    </div>
                </div>
            </header>

            <main className="max-w-[1800px] mx-auto px-6 py-8">
                <div className="grid grid-cols-12 gap-8 h-[calc(100vh-140px)]">

                    {/* Left Panel - Story Queue + Manual Input */}
                    <div className="col-span-4 flex flex-col h-full">
                        <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 flex flex-col h-full deco-corner-tl">

                            {/* Manual Topic Input */}
                            <div className="mb-6 pb-6 border-b border-white/5">
                                <label className="text-xs uppercase tracking-wider text-amber-400/80 font-semibold mb-2 block flex items-center gap-2">
                                    <Search className="w-3.5 h-3.5" />
                                    Research Any Topic
                                </label>
                                <div className="flex gap-2">
                                    <Input
                                        value={customTopic}
                                        onChange={(e) => setCustomTopic(e.target.value)}
                                        onKeyDown={(e) => e.key === 'Enter' && researchCustomTopic()}
                                        placeholder="e.g., OpenAI GPT-5 rumors..."
                                        className="bg-black/40 border-white/10 text-white placeholder:text-white/30 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20"
                                    />
                                    <Button
                                        onClick={researchCustomTopic}
                                        disabled={!customTopic.trim() || !apiKey || isEnhancing}
                                        size="sm"
                                        className="bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 border border-amber-500/30 shrink-0"
                                    >
                                        {isEnhancing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                                    </Button>
                                </div>
                            </div>

                            {/* Research Queue Header */}
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-sm font-semibold text-white/80 flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-white/40" />
                                    Research Queue
                                </h3>
                                <Button
                                    size="sm"
                                    onClick={researchAll}
                                    disabled={isResearchingAll || selectedStories.length === 0}
                                    className="bg-gradient-to-r from-amber-500 to-coral-500 hover:from-amber-400 hover:to-coral-400 text-[#0B0B0F] border-0 text-xs font-semibold"
                                >
                                    {isResearchingAll ? (
                                        <>
                                            <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                                            Working...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-3 h-3 mr-1.5" />
                                            Research All
                                        </>
                                    )}
                                </Button>
                            </div>

                            {/* Story List */}
                            <ScrollArea className="flex-1 -mr-2 pr-2">
                                <div className="space-y-2">
                                    {selectedStories.length === 0 && customTopics.length === 0 ? (
                                        <div className="text-center py-12 text-white/30">
                                            <Search className="w-8 h-8 mx-auto mb-3 opacity-50" />
                                            <p className="text-sm">No stories selected</p>
                                            <p className="text-xs mt-1">Add a custom topic above or go back to select stories</p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* Selected Stories */}
                                            {selectedStories.map((story) => {
                                                const state = researchStates[story.id] || { status: 'idle' };
                                                const isActive = activeReportId === story.id;

                                                return (
                                                    <div
                                                        key={story.id}
                                                        className={`group relative w-full text-left p-3 rounded-xl border transition-all hover-lift ${isActive
                                                            ? 'bg-amber-500/10 border-amber-500/30 shadow-glow-amber-sm'
                                                            : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                                                            }`}
                                                    >
                                                        {isActive && (
                                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-400 to-coral-500 rounded-l-xl"></div>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                if (state.status === 'success') {
                                                                    setActiveReportId(story.id);
                                                                } else if (state.status === 'idle' || state.status === 'error') {
                                                                    researchStory(story);
                                                                }
                                                            }}
                                                            className="w-full text-left"
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <div className="shrink-0 mt-0.5">
                                                                    {state.status === 'loading' && <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />}
                                                                    {state.status === 'success' && <CheckCircle2 className="w-4 h-4 text-teal-400" />}
                                                                    {state.status === 'error' && <XCircle className="w-4 h-4 text-coral-500" />}
                                                                    {state.status === 'idle' && <ChevronRight className="w-4 h-4 text-white/30" />}
                                                                </div>
                                                                <div className="flex-1 min-w-0 pr-16 bg-transparent">
                                                                    <p className={`text-sm line-clamp-2 ${isActive ? 'text-white' : 'text-white/70'}`}>
                                                                        {story.headline}
                                                                    </p>
                                                                    {state.status === 'error' && (
                                                                        <p className="text-xs text-coral-400 mt-1">{state.error}</p>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </button>
                                                        {/* Redo Button - shows on hover for completed/error items */}
                                                        {(state.status === 'success' || state.status === 'error') && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    researchStory(story);
                                                                }}
                                                                className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity bg-amber-500/20 hover:bg-amber-500/40 text-amber-400 text-xs px-2 py-1 rounded-md flex items-center gap-1"
                                                                title="Redo research with current model"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                                </svg>
                                                                Redo
                                                            </button>
                                                        )}
                                                    </div>
                                                );
                                            })}

                                            {/* Custom Topics */}
                                            {customTopics.map((ct) => {
                                                const state = researchStates[ct.id] || { status: 'idle' };
                                                const isActive = activeReportId === ct.id;

                                                return (
                                                    <div
                                                        key={ct.id}
                                                        className={`group relative w-full text-left p-3 rounded-xl border transition-all hover-lift ${isActive
                                                            ? 'bg-teal-500/10 border-teal-500/30 shadow-glow-teal'
                                                            : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                                                            }`}
                                                    >
                                                        {isActive && (
                                                            <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-teal-400 to-teal-500 rounded-l-xl"></div>
                                                        )}
                                                        <button
                                                            onClick={() => {
                                                                if (state.status === 'success') {
                                                                    setActiveReportId(ct.id);
                                                                } else if (state.status === 'idle' || state.status === 'error') {
                                                                    // Reconstruct story for retry
                                                                    const story: CuratedStory = state.report?.story || {
                                                                        id: ct.id,
                                                                        headline: ct.topic,
                                                                        summary: `User-requested research on: ${ct.topic}`,
                                                                        category: 'custom',
                                                                        sources: ['manual'],
                                                                        baseScore: 10,
                                                                        finalScore: 10,
                                                                        crossSourceCount: 1,
                                                                        entities: [],
                                                                        originalUrl: null,
                                                                        publishedAt: new Date().toISOString(),
                                                                        boosts: ['manual-research'],
                                                                    };
                                                                    researchStory(story);
                                                                }
                                                            }}
                                                            className="w-full text-left"
                                                        >
                                                            <div className="flex items-start gap-3">
                                                                <div className="shrink-0 mt-0.5">
                                                                    {state.status === 'loading' && <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />}
                                                                    {state.status === 'success' && <CheckCircle2 className="w-4 h-4 text-teal-400" />}
                                                                    {state.status === 'error' && <XCircle className="w-4 h-4 text-coral-500" />}
                                                                    {state.status === 'idle' && <Search className="w-4 h-4 text-teal-400/50" />}
                                                                </div>
                                                                <div className="flex-1 min-w-0 pr-16 bg-transparent">
                                                                    <div className="flex items-center gap-2 mb-1">
                                                                        <Badge className="bg-teal-500/20 text-teal-300 border-teal-500/30 text-[10px] px-1.5 py-0">
                                                                            Custom
                                                                        </Badge>
                                                                    </div>
                                                                    <p className={`text-sm line-clamp-2 ${isActive ? 'text-white' : 'text-white/70'}`}>
                                                                        {ct.topic}
                                                                    </p>
                                                                </div>
                                                            </div>
                                                        </button>

                                                        {/* Redo Button for Custom Topics */}
                                                        {(state.status === 'success' || state.status === 'error') && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // Reconstruct story for retry
                                                                    const story: CuratedStory = state.report?.story || {
                                                                        id: ct.id,
                                                                        headline: ct.topic,
                                                                        summary: `User-requested research on: ${ct.topic}`,
                                                                        category: 'custom',
                                                                        sources: ['manual'],
                                                                        baseScore: 10,
                                                                        finalScore: 10,
                                                                        crossSourceCount: 1,
                                                                        entities: [],
                                                                        originalUrl: null,
                                                                        publishedAt: new Date().toISOString(),
                                                                        boosts: ['manual-research'],
                                                                    };
                                                                    researchStory(story);
                                                                }}
                                                                className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 transition-opacity bg-teal-500/20 hover:bg-teal-500/40 text-teal-300 text-xs px-2 py-1 rounded-md flex items-center gap-1 border border-teal-500/30 backdrop-blur-sm z-10"
                                                                title="Redo research"
                                                            >
                                                                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                                                </svg>
                                                                Redo
                                                            </button>
                                                        )}
                                                    </div>

                                                );
                                            })}
                                        </>
                                    )}
                                </div>
                            </ScrollArea>
                        </div>
                    </div>

                    {/* Right Panel - Research Report View */}
                    <div className="col-span-8 flex flex-col h-full">
                        <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl flex flex-col h-full overflow-hidden deco-corner-br">

                            {activeReport ? (
                                <>
                                    {/* Report Header */}
                                    <div className="p-6 border-b border-white/5 bg-gradient-to-r from-amber-900/10 to-transparent">
                                        <div className="flex items-start justify-between">
                                            <div className="flex-1 min-w-0 pr-4">
                                                <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30 mb-3">
                                                    <CheckCircle2 className="w-3 h-3 mr-1" />
                                                    Research Complete
                                                </Badge>
                                                <h2 className="font-display text-xl font-semibold text-white line-clamp-2">
                                                    {activeReport.story.headline}
                                                </h2>
                                                <p className="text-sm text-white/40 mt-2 flex items-center gap-2">
                                                    <FileText className="w-3.5 h-3.5" />
                                                    {activeReport.sources.length} sources analyzed
                                                </p>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Report Content */}
                                    <ScrollArea className="flex-1 p-6">
                                        <div className="space-y-6 max-w-4xl">
                                            <ResearchContent content={activeReport.deepResearch} icons={sectionIcons} />
                                        </div>
                                    </ScrollArea>
                                </>
                            ) : (
                                /* Empty State */
                                <div className="flex-1 flex items-center justify-center">
                                    <div className="text-center">
                                        <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-4 border border-white/5">
                                            <FileText className="w-7 h-7 text-white/20" />
                                        </div>
                                        <p className="text-white/40 text-sm">
                                            Select a story or enter a topic to begin research
                                        </p>
                                        <p className="text-white/20 text-xs mt-1">
                                            Click on any item in the queue to view or start research
                                        </p>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div >
            </main >
        </div >
    );
}

// Component to render markdown research content with section styling
function ResearchContent({ content, icons }: { content: string; icons: Record<string, React.ReactNode> }) {
    const sections = content.split(/(?=## )/);

    return (
        <div className="space-y-6">
            {sections.map((section, index) => {
                if (!section.trim()) return null;

                const headerMatch = section.match(/^## (.+?)\n/);
                if (!headerMatch) {
                    return (
                        <p key={index} className="text-white/70 text-sm leading-relaxed">
                            {section.trim()}
                        </p>
                    );
                }

                const header = headerMatch[1].trim();
                const sectionContent = section.slice(headerMatch[0].length).trim();
                const icon = icons[header];

                return (
                    <div key={index} className="bg-black/30 rounded-xl p-5 border border-white/5 border-accent-left hover:border-amber-500/20 transition-colors">
                        <h3 className="text-xs uppercase tracking-wider text-white/50 font-semibold mb-3 flex items-center gap-2">
                            {icon && <span className="text-amber-400">{icon}</span>}
                            {header}
                        </h3>
                        <div className="text-white/80 text-sm leading-relaxed whitespace-pre-wrap">
                            {sectionContent}
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
