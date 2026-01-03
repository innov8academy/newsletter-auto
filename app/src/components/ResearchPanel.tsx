'use client';

import { useState } from 'react';
import { CuratedStory, ResearchReport } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
    Sparkles,
    FileText,
    Loader2,
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
} from 'lucide-react';

interface ResearchPanelProps {
    selectedStories: CuratedStory[];
    apiKey: string;
    onReportGenerated?: (report: ResearchReport) => void;
}

interface StoryResearchState {
    status: 'idle' | 'loading' | 'success' | 'error';
    report?: ResearchReport;
    error?: string;
}

export function ResearchPanel({ selectedStories, apiKey, onReportGenerated }: ResearchPanelProps) {
    const [researchStates, setResearchStates] = useState<Record<string, StoryResearchState>>({});
    const [activeReportId, setActiveReportId] = useState<string | null>(null);
    const [isResearchingAll, setIsResearchingAll] = useState(false);

    async function researchStory(story: CuratedStory) {
        setResearchStates(prev => ({
            ...prev,
            [story.id]: { status: 'loading' }
        }));

        try {
            const response = await fetch('/api/research', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ story, apiKey }),
            });

            const data = await response.json();

            if (data.success && data.report) {
                setResearchStates(prev => ({
                    ...prev,
                    [story.id]: { status: 'success', report: data.report }
                }));
                setActiveReportId(story.id);
                onReportGenerated?.(data.report);
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

    async function researchAll() {
        setIsResearchingAll(true);

        // Research stories sequentially to avoid rate limits
        for (const story of selectedStories) {
            if (researchStates[story.id]?.status !== 'success') {
                await researchStory(story);
            }
        }

        setIsResearchingAll(false);
    }

    const activeReport = activeReportId ? researchStates[activeReportId]?.report : null;
    const completedCount = Object.values(researchStates).filter(s => s.status === 'success').length;

    // Section icon mapping - newsletter format
    const sectionIcons: Record<string, React.ReactNode> = {
        'The Story': <BookOpen className="w-4 h-4" />,
        'The Context': <TrendingUp className="w-4 h-4" />,
        'The Hot Take': <Sparkles className="w-4 h-4" />,
        "What's Next": <Eye className="w-4 h-4" />,
        'Quotables': <FileText className="w-4 h-4" />,
    };

    if (selectedStories.length === 0) {
        return null;
    }

    return (
        <div className="flex flex-col h-full">
            {/* Header */}
            <div className="flex items-center justify-between mb-4 pb-4 border-b border-white/5">
                <div>
                    <h3 className="font-semibold text-white flex items-center gap-2">
                        <Sparkles className="w-4 h-4 text-amber-400" />
                        Deep Research
                    </h3>
                    <p className="text-xs text-white/40 mt-1">
                        {completedCount}/{selectedStories.length} stories analyzed
                    </p>
                </div>
                <Button
                    size="sm"
                    onClick={researchAll}
                    disabled={isResearchingAll || selectedStories.length === 0}
                    className="bg-gradient-to-r from-amber-500 to-coral-500 hover:from-amber-400 hover:to-coral-400 text-[#0B0B0F] font-semibold border-0"
                >
                    {isResearchingAll ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            Researching...
                        </>
                    ) : (
                        <>
                            <Sparkles className="w-4 h-4 mr-2" />
                            Research All
                        </>
                    )}
                </Button>
            </div>

            {/* Story Queue */}
            <div className="space-y-2 mb-4">
                {selectedStories.map((story) => {
                    const state = researchStates[story.id] || { status: 'idle' };
                    const isActive = activeReportId === story.id;

                    return (
                        <button
                            key={story.id}
                            onClick={() => {
                                if (state.status === 'success') {
                                    setActiveReportId(story.id);
                                } else if (state.status === 'idle') {
                                    researchStory(story);
                                }
                            }}
                            className={`w-full text-left p-3 rounded-lg border transition-all hover-lift ${isActive
                                ? 'bg-amber-500/10 border-amber-500/30 shadow-glow-amber-sm'
                                : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
                                }`}
                        >
                            <div className="flex items-start gap-3">
                                <div className="shrink-0 mt-0.5">
                                    {state.status === 'loading' && (
                                        <Loader2 className="w-4 h-4 text-amber-400 animate-spin" />
                                    )}
                                    {state.status === 'success' && (
                                        <CheckCircle2 className="w-4 h-4 text-teal-400" />
                                    )}
                                    {state.status === 'error' && (
                                        <XCircle className="w-4 h-4 text-coral-500" />
                                    )}
                                    {state.status === 'idle' && (
                                        <ChevronRight className="w-4 h-4 text-white/30" />
                                    )}
                                </div>
                                <div className="flex-1 min-w-0">
                                    <p className={`text-sm line-clamp-2 ${isActive ? 'text-white' : 'text-white/70'}`}>
                                        {story.headline}
                                    </p>
                                    {state.status === 'error' && (
                                        <p className="text-xs text-coral-400 mt-1">{state.error}</p>
                                    )}
                                </div>
                            </div>
                        </button>
                    );
                })}
            </div>

            {/* Active Report Display */}
            {activeReport && (
                <div className="flex-1 border-t border-white/5 pt-4">
                    <div className="flex items-center gap-2 mb-3">
                        <Badge className="bg-teal-500/20 text-teal-400 border-teal-500/30">
                            <CheckCircle2 className="w-3 h-3 mr-1" />
                            Research Complete
                        </Badge>
                        <span className="text-xs text-white/40">
                            {activeReport.sources.length} sources cited
                        </span>
                    </div>

                    <ScrollArea className="h-[400px] -mr-2 pr-2">
                        <div className="prose prose-invert prose-sm max-w-none">
                            {/* Render markdown sections with custom styling */}
                            <ResearchContent content={activeReport.deepResearch} icons={sectionIcons} />
                        </div>
                    </ScrollArea>
                </div>
            )}

            {/* Empty state for report area */}
            {!activeReport && selectedStories.length > 0 && (
                <div className="flex-1 flex items-center justify-center border-t border-white/5 pt-4">
                    <div className="text-center">
                        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mx-auto mb-3 border border-white/5">
                            <FileText className="w-5 h-5 text-white/20" />
                        </div>
                        <p className="text-sm text-white/40">
                            Click a story to start research
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
}

// Component to render markdown research content with section styling
function ResearchContent({ content, icons }: { content: string; icons: Record<string, React.ReactNode> }) {
    // Split content by H2 headers
    const sections = content.split(/(?=## )/);

    return (
        <div className="space-y-6">
            {sections.map((section, index) => {
                if (!section.trim()) return null;

                // Extract header and content
                const headerMatch = section.match(/^## (.+?)\n/);
                if (!headerMatch) {
                    // No header, just render as paragraph
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
                    <div key={index} className="bg-black/30 rounded-xl p-4 border border-white/5 border-accent-left hover:border-amber-500/20 transition-colors">
                        <h3 className="text-sm uppercase tracking-wider text-white/60 font-semibold mb-3 flex items-center gap-2">
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
