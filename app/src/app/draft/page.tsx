'use client';

import { useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { ResearchReport } from '@/lib/types';
import { NewsletterDraft, DRAFT_MODELS, DraftModelId, StoryBlock } from '@/lib/draft-generator';
import { WizardProvider, useWizard, WIZARD_STEPS, getCurrentDateContext } from '@/context/WizardContext';
import { StepIndicator, WizardNavigation } from '@/components/StepIndicator';
import { EditableSection, EditableBulletList } from '@/components/EditableSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from '@/components/ui/select';
import { loadResearchReports } from '@/lib/storage';
import { addCost } from '@/lib/cost-tracker';
import {
    Sparkles,
    FileText,
    Loader2,
    ArrowLeft,
    Check,
    CheckCircle2,
    RefreshCw,
    ChevronRight,
    Newspaper,
    Settings2,
    Image as ImageIcon,
    X,
    ChevronUp,
    ChevronDown,
    Copy,
    History,
} from 'lucide-react';

// Helper function to convert wizard state to NewsletterDraft and save to localStorage
function saveWizardStateToCurrentDraft(completed: {
    hook: { title: string; subtitle: string } | null;
    intro: string | null;
    toc: string[] | null;
    stories: StoryBlock[];
    summary: string | null;
    memeIdeas: Array<{ templateName: string; topText: string; bottomText: string; angle: string }>;
}) {
    const draft: NewsletterDraft = {
        title: completed.hook?.title || '',
        subtitle: completed.hook?.subtitle || '',
        date: getCurrentDateContext(),
        memeIdeas: completed.memeIdeas || [],
        intro: completed.intro || '',
        toc: completed.toc || [],
        stories: completed.stories || [],
        quickSummary: completed.summary || '',
        rawMarkdown: '',
    };
    localStorage.setItem('currentDraft', JSON.stringify(draft));
}

// Skip to Studio button component with context access
function SkipToStudioButton() {
    const router = useRouter();
    const { completed } = useWizard();

    const handleSkipToStudio = () => {
        // Save current state to localStorage before navigating
        saveWizardStateToCurrentDraft(completed);
        router.push('/studio');
    };

    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={handleSkipToStudio}
            className="text-purple-300 hover:text-purple-200"
        >
            <ImageIcon className="w-4 h-4 mr-2" />
            Skip to Studio
        </Button>
    );
}

// Step content components
function SetupStep() {
    const router = useRouter();
    const {
        selectedReports,
        addReport,
        removeReport,
        reorderReports,
        nextStep,
        isStepComplete,
    } = useWizard();
    const [allReports, setAllReports] = useState<ResearchReport[]>([]);

    useEffect(() => {
        const reports = loadResearchReports();
        if (reports.length === 0) {
            router.push('/research');
            return;
        }
        setAllReports(reports);
    }, [router]);

    const isSelected = (reportId: string) =>
        selectedReports.some(r => r.story.id === reportId);

    const moveUp = (index: number) => {
        if (index > 0) reorderReports(index, index - 1);
    };

    const moveDown = (index: number) => {
        if (index < selectedReports.length - 1) reorderReports(index, index + 1);
    };

    return (
        <div className="grid grid-cols-2 gap-6 h-full">
            {/* Selected Stories */}
            <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 flex flex-col">
                <div className="flex items-center justify-between mb-4">
                    <h2 className="font-semibold flex items-center gap-2 text-white/90">
                        <CheckCircle2 className="w-4 h-4 text-teal-400" />
                        Selected Stories
                    </h2>
                    <span className="text-xs text-white/40">First = main story</span>
                </div>

                {selectedReports.length === 0 ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border-2 border-dashed border-white/5 rounded-xl">
                        <FileText className="w-8 h-8 text-white/20 mb-3" />
                        <p className="text-sm text-white/40">
                            Select stories from the right →
                        </p>
                    </div>
                ) : (
                    <ScrollArea className="flex-1 -mr-2 pr-2">
                        <div className="space-y-2">
                            {selectedReports.map((report, index) => (
                                <div
                                    key={report.story.id}
                                    className="group flex items-start gap-2 p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 relative"
                                >
                                    <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-400 to-coral-500 rounded-l-xl" />

                                    <div className="flex flex-col gap-1 ml-2">
                                        <button
                                            onClick={() => moveUp(index)}
                                            disabled={index === 0}
                                            className="p-0.5 hover:bg-white/10 rounded disabled:opacity-20"
                                        >
                                            <ChevronUp className="w-3 h-3" />
                                        </button>
                                        <button
                                            onClick={() => moveDown(index)}
                                            disabled={index === selectedReports.length - 1}
                                            className="p-0.5 hover:bg-white/10 rounded disabled:opacity-20"
                                        >
                                            <ChevronDown className="w-3 h-3" />
                                        </button>
                                    </div>

                                    <div className="flex-1 min-w-0">
                                        <Badge className={`text-xs px-1.5 py-0 mb-1 ${index === 0 ? 'bg-amber-500/30 text-amber-300' : 'bg-white/10 text-white/60'}`}>
                                            {index === 0 ? 'Main' : `#${index + 1}`}
                                        </Badge>
                                        <p className="text-sm text-white/80 line-clamp-2">
                                            {report.story.headline}
                                        </p>
                                    </div>

                                    <button
                                        onClick={() => removeReport(report.story.id)}
                                        className="p-1 hover:bg-white/10 rounded text-white/30 hover:text-coral-400"
                                    >
                                        <X className="w-4 h-4" />
                                    </button>
                                </div>
                            ))}
                        </div>
                    </ScrollArea>
                )}

                <div className="pt-4 mt-4 border-t border-white/5">
                    <Button
                        onClick={nextStep}
                        disabled={!isStepComplete(0)}
                        className="w-full bg-gradient-to-r from-amber-500 to-coral-500 text-[#0B0B0F] h-12 font-semibold disabled:opacity-50"
                    >
                        <Sparkles className="w-4 h-4 mr-2" />
                        Start Newsletter ({selectedReports.length} stories)
                    </Button>
                </div>
            </div>

            {/* Available Reports */}
            <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 flex flex-col">
                <h2 className="font-semibold mb-4 flex items-center gap-2 text-white/90">
                    <FileText className="w-4 h-4 text-white/40" />
                    Available Reports
                    <span className="text-xs text-white/40 font-normal ml-auto">
                        {allReports.length} reports
                    </span>
                </h2>

                <ScrollArea className="flex-1 -mr-2 pr-2">
                    <div className="space-y-2">
                        {allReports.map((report) => {
                            const selected = isSelected(report.story.id);
                            return (
                                <button
                                    key={report.story.id}
                                    onClick={() => !selected && addReport(report)}
                                    disabled={selected}
                                    className={`w-full text-left p-3 rounded-xl border transition-all ${selected
                                        ? 'bg-teal-500/10 border-teal-500/30 opacity-50 cursor-not-allowed'
                                        : 'bg-white/5 border-white/5 hover:bg-white/10'
                                        }`}
                                >
                                    <div className="flex items-start gap-3">
                                        <div className="shrink-0 mt-0.5">
                                            {selected ? (
                                                <Check className="w-4 h-4 text-teal-400" />
                                            ) : (
                                                <FileText className="w-4 h-4 text-white/30" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="text-sm text-white/80 line-clamp-2">
                                                {report.story.headline}
                                            </p>
                                            <p className="text-xs text-white/40 mt-1">
                                                {report.sources.length} sources
                                            </p>
                                        </div>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                </ScrollArea>
            </div>
        </div>
    );
}

// Generic generation step component
interface GenerationStepProps {
    title: string;
    sectionType: 'title' | 'intro' | 'toc' | 'summary';
    content: string | string[] | { title: string; subtitle: string } | null;
    onSave: (content: any) => void;
    placeholder: string;
}

function GenerationStep({ title, sectionType, content, onSave, placeholder }: GenerationStepProps) {
    const { selectedReports, prevStep, nextStep, isGenerating, setIsGenerating, setError, error } = useWizard();
    const [localContent, setLocalContent] = useState('');
    const [hasGenerated, setHasGenerated] = useState(false);
    const [selectedModel, setSelectedModel] = useState<DraftModelId>('anthropic/claude-sonnet-4');
    const [copied, setCopied] = useState(false);

    // Reset state when section type changes (navigating between steps)
    useEffect(() => {
        // Reset local state for new section
        setLocalContent('');
        setHasGenerated(false);
        setCopied(false);
    }, [sectionType]);

    // Restore content if already saved in wizard context
    useEffect(() => {
        if (content) {
            let restoredContent = '';
            if (typeof content === 'string') {
                restoredContent = content;
            } else if (Array.isArray(content)) {
                restoredContent = '**In today\'s post:**\n' + content.map(item => `• ${item}`).join('\n');
            } else if ('title' in content) {
                restoredContent = `# ${content.title}\n\nPLUS: ${content.subtitle}`;
            }
            setLocalContent(restoredContent);
            setHasGenerated(true);
        }
    }, [content, sectionType]);

    const copyToClipboard = async () => {
        await navigator.clipboard.writeText(localContent);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const generateContent = useCallback(async () => {
        setIsGenerating(true);
        setError(null);

        try {
            const response = await fetch('/api/generate-section', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sectionType,
                    researchReports: selectedReports,
                    modelId: selectedModel,
                }),
            });

            const data = await response.json();

            if (data.success) {
                setLocalContent(data.content);
                setHasGenerated(true);

                // Track cost
                if (data.cost) {
                    addCost({
                        source: data.costSource || `section-${sectionType}`,
                        model: data.model || selectedModel,
                        cost: data.cost,
                        description: `Generated ${sectionType}`,
                    });
                }
            } else {
                setError(data.error || 'Failed to generate');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error');
        } finally {
            setIsGenerating(false);
        }
    }, [selectedReports, sectionType, selectedModel, setIsGenerating, setError]);

    // Auto-generate on mount if no content
    useEffect(() => {
        if (!content && !hasGenerated && selectedReports.length > 0) {
            generateContent();
        }
    }, [content, hasGenerated, selectedReports.length, generateContent]);

    const handleConfirm = () => {
        // Parse content based on section type
        if (sectionType === 'title') {
            const titleMatch = localContent.match(/^#\s+(.+?)(?:\n|$)/m);
            const subtitleMatch = localContent.match(/PLUS:\s*(.+?)(?:\n|$)/i);
            onSave({
                title: titleMatch ? titleMatch[1].trim() : localContent.split('\n')[0],
                subtitle: subtitleMatch ? subtitleMatch[1].trim() : '',
            });
        } else if (sectionType === 'toc') {
            const items = localContent
                .split('\n')
                .filter(line => line.trim().match(/^[•\-\*]/))
                .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
                .filter(Boolean);
            onSave(items);
        } else {
            onSave(localContent);
        }
        nextStep();
    };

    return (
        <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 h-full flex flex-col">
            <div className="flex items-center justify-between mb-6">
                <h2 className="font-display text-xl text-white/90">{title}</h2>
                <div className="flex items-center gap-2">
                    <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as DraftModelId)}>
                        <SelectTrigger className="w-[180px] bg-black/30 border-white/10 text-white text-sm h-8">
                            <SelectValue placeholder="Select model" />
                        </SelectTrigger>
                        <SelectContent className="bg-surface-elevated border-white/10">
                            {DRAFT_MODELS.map((model) => (
                                <SelectItem key={model.id} value={model.id} className="text-white">
                                    {model.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={copyToClipboard}
                        disabled={!localContent}
                        className="text-white/50 hover:text-teal-400"
                    >
                        {copied ? (
                            <><Check className="w-4 h-4 mr-1 text-teal-400" /> Copied!</>
                        ) : (
                            <><Copy className="w-4 h-4 mr-1" /> Copy</>
                        )}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={generateContent}
                        disabled={isGenerating}
                        className="text-white/50 hover:text-amber-400"
                    >
                        <RefreshCw className={`w-4 h-4 mr-1 ${isGenerating ? 'animate-spin' : ''}`} />
                        Regen
                    </Button>
                </div>
            </div>

            {error && (
                <div className="mb-4 p-4 rounded-xl bg-coral-500/10 border border-coral-500/30 text-coral-300 text-sm">
                    {error}
                </div>
            )}

            <div className="flex-1 min-h-[300px]">
                {isGenerating && !hasGenerated ? (
                    <div className="h-full min-h-[300px] flex flex-col items-center justify-center text-white/40">
                        <Loader2 className="w-8 h-8 animate-spin mb-4" />
                        <p>Generating {title.toLowerCase()}...</p>
                    </div>
                ) : (
                    <Textarea
                        value={localContent}
                        onChange={(e) => setLocalContent(e.target.value)}
                        placeholder={placeholder}
                        className="h-full min-h-[300px] resize-none bg-black/20 border-white/10 text-white font-mono text-sm"
                    />
                )}
            </div>

            <WizardNavigation
                onNext={handleConfirm}
                nextLabel="Confirm & Continue"
                isNextLoading={isGenerating}
                isNextDisabled={!localContent.trim()}
            />
        </div>
    );
}

// Story generation step
function StoryStep() {
    const {
        selectedReports,
        currentStoryIndex,
        completed,
        saveStory,
        nextStory,
        prevStory,
        nextStep,
        prevStep,
        setCurrentStoryIndex,
        isGenerating,
        setIsGenerating,
        error,
        setError,
    } = useWizard();
    const [localStory, setLocalStory] = useState<StoryBlock | null>(null);
    const [selectedModel, setSelectedModel] = useState<DraftModelId>('google/gemini-3-pro-preview');
    const [copied, setCopied] = useState(false);
    const [customInput, setCustomInput] = useState('');
    const [showRegenOptions, setShowRegenOptions] = useState(false);
    const [hasAutoGenerated, setHasAutoGenerated] = useState<Record<number, boolean>>({});

    const totalStories = selectedReports.length;
    const currentReport = selectedReports[currentStoryIndex];
    const savedStory = completed.stories[currentStoryIndex];

    // Copy story as formatted text
    const copyStory = async () => {
        if (!localStory) return;
        const text = `### ${localStory.emoji} ${localStory.title}

${localStory.hookParagraph}

**🔍 Key Points:**
${(localStory.bulletPoints || []).map(p => `• ${p}`).join('\n')}

**🚨 Why This Matters:**
${(localStory.whyItMatters || []).map(p => `• ${p}`).join('\n')}

**⏭️ What's Next:**
${(localStory.whatsNext || []).map(p => `• ${p}`).join('\n')}

**💡 L8R's Take:**
${(localStory.l8rsTake || []).map(p => `• ${p}`).join('\n')}`;
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Restore story from saved state when switching stories
    useEffect(() => {
        if (savedStory && savedStory.title) {
            setLocalStory(savedStory);
        } else {
            // Only generate if we haven't already tried for this story
            if (!hasAutoGenerated[currentStoryIndex] && selectedReports.length > 0 && !isGenerating) {
                setHasAutoGenerated(prev => ({ ...prev, [currentStoryIndex]: true }));
                generateStory();
            }
        }
    }, [currentStoryIndex, savedStory]);

    const generateStory = useCallback(async (userInstructions?: string) => {
        setIsGenerating(true);
        setError(null);
        setShowRegenOptions(false);

        try {
            const response = await fetch('/api/generate-section', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sectionType: 'story',
                    storyIndex: currentStoryIndex,
                    researchReports: selectedReports,
                    modelId: selectedModel,
                    userInput: userInstructions || customInput || undefined,
                }),
            });

            const data = await response.json();

            if (data.success) {
                // Parse the story content
                const parsed = parseStoryContent(data.content, currentStoryIndex);
                setLocalStory(parsed);
                // Auto-save to wizard context
                saveStory(currentStoryIndex, parsed);
                setCustomInput('');

                if (data.cost) {
                    addCost({
                        source: data.costSource || 'section-story',
                        model: data.model || selectedModel,
                        cost: data.cost,
                        description: `Generated story ${currentStoryIndex + 1}`,
                    });
                }
            } else {
                setError(data.error || 'Failed to generate story');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error');
        } finally {
            setIsGenerating(false);
        }
    }, [currentStoryIndex, selectedReports, selectedModel, customInput, setIsGenerating, setError, saveStory]);

    const parseStoryContent = (content: string, storyIndex: number): StoryBlock => {
        const emojis = ['🧠', '💰', '🤖', '🔥', '⚡', '🎯'];

        // Extract title - handle "### emoji Title" or "### Title"
        const titleMatch = content.match(/###?\s*[🧠💰🤖🔥⚡🎯💡🚀🎬📰🏥◆◇○●]?\s*([^\n]+)/);
        // Clean up title - remove any leading special chars the AI might add
        const title = titleMatch
            ? titleMatch[1].replace(/^[◆◇○●♦♢✦✧⬥⯑\s]+/, '').trim()
            : '';

        // Extract hook paragraph - text between title and first **section**
        const hookMatch = content.match(/###?[^\n]+\n\n([\s\S]*?)(?=\*\*[🔍🚨⏭️💡])/);
        const hookParagraph = hookMatch ? hookMatch[1].trim() : '';

        // Robust bullet extraction - tries multiple patterns
        const extractBullets = (sectionName: string, emoji?: string): string[] => {
            // Pattern variations to try (most specific to least)
            const patterns = [
                // Pattern 1: **emoji Section Name:** with bullets below
                emoji ? new RegExp(`\\*\\*${emoji}[^*]*${sectionName}[^*]*\\*\\*:?\\s*\\n([\\s\\S]*?)(?=\\*\\*[🔍🚨⏭️💡]|$)`, 'i') : null,
                // Pattern 2: **Section Name:** (no emoji)
                new RegExp(`\\*\\*[^*]*${sectionName}[^*]*\\*\\*:?\\s*\\n([\\s\\S]*?)(?=\\*\\*[🔍🚨⏭️💡]|$)`, 'i'),
                // Pattern 3: Section Name: on its own line
                new RegExp(`${sectionName}:?\\s*\\n([\\s\\S]*?)(?=\\n\\s*\\*\\*|\\n\\s*[A-Z][a-z]+:|$)`, 'i'),
            ].filter(Boolean) as RegExp[];

            for (const pattern of patterns) {
                const match = content.match(pattern);
                if (match && match[1]) {
                    const bullets = match[1]
                        .split('\n')
                        .map(line => line.trim())
                        .filter(line => line.match(/^[•\-\*]/))
                        .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
                        .filter(line => line.length > 5); // Filter out too-short lines

                    if (bullets.length > 0) {
                        console.log(`[Parse] Found ${bullets.length} bullets for "${sectionName}"`);
                        return bullets.slice(0, 4);
                    }
                }
            }

            console.warn(`[Parse] No bullets found for "${sectionName}"`);
            return [];
        };

        const result = {
            emoji: emojis[storyIndex % emojis.length],
            title,
            hookParagraph,
            bulletPoints: extractBullets('Key Points', '🔍'),
            whyItMatters: extractBullets('Why This Matters', '🚨'),
            whatsNext: extractBullets("What's Next", '⏭️'),
            l8rsTake: extractBullets("L8R's Take", '💡'),
        };

        console.log(`[Parse] Story ${storyIndex + 1}: title="${title.substring(0, 30)}...", bullets=[${result.bulletPoints.length}, ${result.whyItMatters.length}, ${result.whatsNext.length}, ${result.l8rsTake.length}]`);

        return result;
    };

    const updateField = (field: keyof StoryBlock, value: string | string[]) => {
        if (!localStory) return;
        setLocalStory({ ...localStory, [field]: value });
    };

    const handleConfirmStory = () => {
        if (!localStory) return;
        saveStory(currentStoryIndex, localStory);

        if (currentStoryIndex < totalStories - 1) {
            nextStory();
        } else {
            nextStep();
        }
    };

    const handleBack = () => {
        if (currentStoryIndex > 0) {
            prevStory();
        } else {
            prevStep();
        }
    };

    return (
        <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between mb-4">
                <div>
                    <h2 className="font-display text-xl text-white/90">
                        Story {currentStoryIndex + 1} of {totalStories}
                    </h2>
                    <p className="text-sm text-white/50 mt-1">
                        {currentReport?.story.headline?.substring(0, 60)}...
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    {/* Story navigation pills */}
                    <div className="flex gap-1">
                        {selectedReports.map((_, i) => (
                            <button
                                key={i}
                                onClick={() => setCurrentStoryIndex(i)}
                                className={`w-8 h-8 rounded-full text-xs font-medium transition-all ${i === currentStoryIndex
                                    ? 'bg-amber-500 text-black'
                                    : completed.stories[i]?.title
                                        ? 'bg-teal-500/20 text-teal-400 border border-teal-500/30'
                                        : 'bg-white/10 text-white/40'
                                    }`}
                            >
                                {i + 1}
                            </button>
                        ))}
                    </div>
                    <div className="w-px h-6 bg-white/10" />
                    <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as DraftModelId)}>
                        <SelectTrigger className="w-[140px] bg-black/30 border-white/10 text-white text-xs h-8">
                            <SelectValue placeholder="Model" />
                        </SelectTrigger>
                        <SelectContent className="bg-surface-elevated border-white/10">
                            {DRAFT_MODELS.map((model) => (
                                <SelectItem key={model.id} value={model.id} className="text-white text-xs">
                                    {model.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={copyStory}
                        disabled={!localStory}
                        className="text-white/50 hover:text-teal-400"
                    >
                        {copied ? (
                            <><Check className="w-4 h-4 mr-1 text-teal-400" /> Copied!</>
                        ) : (
                            <><Copy className="w-4 h-4 mr-1" /> Copy</>
                        )}
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowRegenOptions(!showRegenOptions)}
                        disabled={isGenerating}
                        className="text-white/50 hover:text-amber-400"
                    >
                        <RefreshCw className={`w-4 h-4 mr-1 ${isGenerating ? 'animate-spin' : ''}`} />
                        Regen
                    </Button>
                </div>
            </div>

            {/* Regenerate Options Panel */}
            {showRegenOptions && (
                <div className="mb-4 p-4 rounded-xl bg-amber-500/5 border border-amber-500/20">
                    <p className="text-sm text-amber-300 mb-2">Custom instructions (optional):</p>
                    <Textarea
                        value={customInput}
                        onChange={(e) => setCustomInput(e.target.value)}
                        placeholder="e.g., 'Focus more on the financial impact' or 'Make it more casual and fun'"
                        className="mb-3 min-h-[60px] bg-black/30 border-white/10 text-white text-sm"
                    />
                    <div className="flex gap-2">
                        <Button
                            onClick={() => generateStory()}
                            disabled={isGenerating}
                            className="bg-gradient-to-r from-amber-500 to-coral-500 text-black text-sm"
                        >
                            {isGenerating ? (
                                <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> Generating...</>
                            ) : (
                                <><RefreshCw className="w-4 h-4 mr-1" /> Regenerate Story</>
                            )}
                        </Button>
                        <Button
                            variant="ghost"
                            onClick={() => setShowRegenOptions(false)}
                            className="text-white/50"
                        >
                            Cancel
                        </Button>
                    </div>
                </div>
            )}

            {error && (
                <div className="mb-4 p-3 rounded-xl bg-coral-500/10 border border-coral-500/30 text-coral-300 text-sm">
                    {error}
                </div>
            )}

            {/* Story content */}
            <ScrollArea className="flex-1 -mr-2 pr-2">
                {isGenerating && !localStory ? (
                    <div className="h-64 flex flex-col items-center justify-center text-white/40">
                        <Loader2 className="w-8 h-8 animate-spin mb-4" />
                        <p>Generating story {currentStoryIndex + 1}...</p>
                    </div>
                ) : localStory ? (
                    <div className="space-y-6">
                        {/* Title */}
                        <div>
                            <label className="text-xs text-white/40 uppercase tracking-wider mb-2 block">
                                Title
                            </label>
                            <div className="flex items-center gap-2">
                                <span className="text-2xl">{localStory.emoji}</span>
                                <input
                                    type="text"
                                    value={localStory.title}
                                    onChange={(e) => updateField('title', e.target.value)}
                                    className="flex-1 bg-black/20 border border-white/10 rounded-xl px-4 py-3 text-white text-lg font-semibold"
                                />
                            </div>
                        </div>

                        {/* Hook */}
                        <div>
                            <label className="text-xs text-white/40 uppercase tracking-wider mb-2 block">
                                Hook (2-3 sentences)
                            </label>
                            <Textarea
                                value={localStory.hookParagraph}
                                onChange={(e) => updateField('hookParagraph', e.target.value)}
                                className="bg-black/20 border-white/10 text-white min-h-[80px]"
                            />
                        </div>

                        {/* Key Points */}
                        <div>
                            <label className="text-xs text-white/40 uppercase tracking-wider mb-2 flex items-center gap-2">
                                🔍 Key Points
                            </label>
                            <div className="space-y-2">
                                {(localStory.bulletPoints || []).map((point, i) => (
                                    <input
                                        key={i}
                                        type="text"
                                        value={point}
                                        onChange={(e) => {
                                            const newPoints = [...localStory.bulletPoints];
                                            newPoints[i] = e.target.value;
                                            updateField('bulletPoints', newPoints);
                                        }}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                                    />
                                ))}
                            </div>
                        </div>

                        {/* Why This Matters */}
                        <div>
                            <label className="text-xs text-white/40 uppercase tracking-wider mb-2 flex items-center gap-2">
                                🚨 Why This Matters
                            </label>
                            <div className="space-y-2">
                                {(localStory.whyItMatters || []).map((point, i) => (
                                    <input
                                        key={i}
                                        type="text"
                                        value={point}
                                        onChange={(e) => {
                                            const newPoints = [...localStory.whyItMatters];
                                            newPoints[i] = e.target.value;
                                            updateField('whyItMatters', newPoints);
                                        }}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                                    />
                                ))}
                            </div>
                        </div>

                        {/* What's Next */}
                        <div>
                            <label className="text-xs text-white/40 uppercase tracking-wider mb-2 flex items-center gap-2">
                                ⏭️ What's Next
                            </label>
                            <div className="space-y-2">
                                {(localStory.whatsNext || []).map((point, i) => (
                                    <input
                                        key={i}
                                        type="text"
                                        value={point}
                                        onChange={(e) => {
                                            const newPoints = [...localStory.whatsNext];
                                            newPoints[i] = e.target.value;
                                            updateField('whatsNext', newPoints);
                                        }}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                                    />
                                ))}
                            </div>
                        </div>

                        {/* L8R's Take */}
                        <div>
                            <label className="text-xs text-white/40 uppercase tracking-wider mb-2 flex items-center gap-2">
                                💡 L8R's Take (Alex's Opinion)
                            </label>
                            <div className="space-y-2">
                                {(localStory.l8rsTake || []).map((point, i) => (
                                    <input
                                        key={i}
                                        type="text"
                                        value={point}
                                        onChange={(e) => {
                                            const newPoints = [...(localStory.l8rsTake || [])];
                                            newPoints[i] = e.target.value;
                                            updateField('l8rsTake', newPoints);
                                        }}
                                        className="w-full bg-black/20 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                                    />
                                ))}
                            </div>
                        </div>
                    </div>
                ) : null}
            </ScrollArea>

            {/* Navigation */}
            <div className="flex items-center justify-between pt-4 border-t border-white/5 mt-4">
                <button
                    onClick={handleBack}
                    className="flex items-center gap-2 px-4 py-2 text-sm text-white/50 hover:text-white hover:bg-white/5 rounded-lg"
                >
                    <ChevronRight className="w-4 h-4 rotate-180" />
                    Back
                </button>

                <Button
                    onClick={handleConfirmStory}
                    disabled={!localStory?.title || isGenerating}
                    className="bg-gradient-to-r from-amber-500 to-coral-500 text-[#0B0B0F] px-6"
                >
                    {currentStoryIndex < totalStories - 1 ? (
                        <>
                            Confirm & Next Story
                            <ChevronRight className="w-4 h-4 ml-2" />
                        </>
                    ) : (
                        <>
                            Confirm & Finish Stories
                            <Check className="w-4 h-4 ml-2" />
                        </>
                    )}
                </Button>
            </div>
        </div>
    );
}

// Main content component that renders based on current step
function WizardContent() {
    const router = useRouter();
    const { currentStep, completed, saveHook, saveIntro, saveToc, saveSummary } = useWizard();

    const renderStep = () => {
        switch (currentStep) {
            case 0:
                return <SetupStep />;
            case 1:
                return (
                    <GenerationStep
                        title="Generate Hook (Title & Subtitle)"
                        sectionType="title"
                        content={completed.hook}
                        onSave={({ title, subtitle }) => saveHook(title, subtitle)}
                        placeholder="# Your Newsletter Title Here&#10;&#10;PLUS: Story 2 teaser | Story 3 teaser"
                    />
                );
            case 2:
                return (
                    <GenerationStep
                        title="Generate Introduction"
                        sectionType="intro"
                        content={completed.intro}
                        onSave={saveIntro}
                        placeholder="Write your introduction here..."
                    />
                );
            case 3:
                return (
                    <GenerationStep
                        title="Generate Table of Contents"
                        sectionType="toc"
                        content={completed.toc}
                        onSave={saveToc}
                        placeholder="**In today's post:**&#10;• 🎬 Story 1 title&#10;• 💰 Story 2 title&#10;• 📰 Story 3 title"
                    />
                );
            case 4:
                return <StoryStep />;
            case 5:
                return (
                    <GenerationStep
                        title="Generate Quick Summary"
                        sectionType="summary"
                        content={completed.summary}
                        onSave={(summary) => {
                            saveSummary(summary);

                            // Save with the new summary value (completed.summary won't have it yet)
                            const updatedCompleted = { ...completed, summary };
                            saveWizardStateToCurrentDraft(updatedCompleted);

                            router.push('/studio');
                        }}
                        placeholder="### 🚀 Quick L8R Summary..."
                    />
                );
            default:
                return null;
        }
    };

    return (
        <div className="flex-1 overflow-hidden">
            {renderStep()}
        </div>
    );
}

// Main page component
function WizardDraftPage() {
    const router = useRouter();

    return (
        <div className="min-h-screen bg-[#0B0B0F] text-white noise-overlay">
            <div className="fixed inset-0 bg-gradient-to-br from-coral-900/5 via-transparent to-amber-900/5 pointer-events-none" />

            {/* Header */}
            <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0B0B0F]/80 border-b border-white/5">
                <div className="max-w-[1400px] mx-auto px-6 py-4">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-4">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => router.push('/research')}
                                className="text-white/50 hover:text-amber-400"
                            >
                                <ArrowLeft className="w-4 h-4 mr-2" />
                                Research
                            </Button>
                            <div className="h-6 w-px bg-white/10" />
                            <h1 className="font-display text-xl flex items-center gap-2">
                                <Newspaper className="w-5 h-5 text-coral-400" />
                                Newsletter Wizard
                            </h1>
                        </div>
                        <div className="flex items-center gap-2">
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => router.push('/draft-classic')}
                                className="text-white/40 hover:text-white/60"
                            >
                                <History className="w-4 h-4 mr-1" />
                                Classic View
                            </Button>
                            <SkipToStudioButton />
                        </div>
                    </div>

                    {/* Step indicator */}
                    <StepIndicator />
                </div>
            </header>

            {/* Main content */}
            <main className="max-w-[1400px] mx-auto px-6 py-6 h-[calc(100vh-160px)]">
                <WizardContent />
            </main>
        </div>
    );
}

// Export with provider wrapper
export default function DraftPage() {
    return (
        <WizardProvider>
            <WizardDraftPage />
        </WizardProvider>
    );
}
