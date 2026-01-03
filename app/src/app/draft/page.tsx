'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { ResearchReport } from '@/lib/types';
import { NewsletterDraft, DRAFT_MODELS, DraftModelId, StoryBlock } from '@/lib/draft-generator';
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
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from '@/components/ui/popover';
import {
    loadResearchReports,
    getApiKey,
} from '@/lib/storage';
import { addCost } from '@/lib/cost-tracker';
import {
    Sparkles,
    FileText,
    Loader2,
    ArrowLeft,
    Check,
    CheckCircle2,
    RefreshCw,
    Copy,
    Download,
    X,
    ChevronRight,
    Newspaper,
    Settings2,
    Image as ImageIcon,
    Wand2,
    Trash2,
    MoreHorizontal,
    Maximize2,
} from 'lucide-react';

// Image models moved to Studio Page

export default function DraftPage() {
    const router = useRouter();

    // State
    const [allReports, setAllReports] = useState<ResearchReport[]>([]);
    const [selectedReports, setSelectedReports] = useState<ResearchReport[]>([]);
    const [apiKey, setApiKey] = useState('');
    const [isGenerating, setIsGenerating] = useState(false);
    const [draft, setDraft] = useState<NewsletterDraft | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [selectedModel, setSelectedModel] = useState<DraftModelId>('anthropic/claude-sonnet-4');

    // Story regeneration state
    const [regeneratingStoryIndex, setRegeneratingStoryIndex] = useState<number | null>(null);
    const [storyRegenPrompt, setStoryRegenPrompt] = useState('');
    const [storyRegenModel, setStoryRegenModel] = useState<DraftModelId>('anthropic/claude-sonnet-4');
    const [storyPopoverOpen, setStoryPopoverOpen] = useState<number | null>(null);

    // Load reports on mount
    useEffect(() => {
        const reports = loadResearchReports();
        const key = getApiKey();

        // Flow protection: redirect to Research if no reports
        if (reports.length === 0) {
            router.push('/research');
            return;
        }

        setAllReports(reports);
        setApiKey(key || '');
    }, [router]);

    // Auto-save draft to localStorage for Studio access
    useEffect(() => {
        if (draft) {
            localStorage.setItem('currentDraft', JSON.stringify(draft));
        }
    }, [draft]);

    // Update draft field
    function updateDraft(field: keyof NewsletterDraft, value: string) {
        if (!draft) return;
        setDraft({ ...draft, [field]: value });
    }

    // Update a story field
    function updateStory(storyIndex: number, field: keyof StoryBlock, value: string | string[]) {
        if (!draft) return;
        const newStories = [...draft.stories];
        newStories[storyIndex] = { ...newStories[storyIndex], [field]: value };
        setDraft({ ...draft, stories: newStories });
    }

    // Replace entire story block
    function replaceStory(storyIndex: number, newStory: StoryBlock) {
        if (!draft) return;
        const newStories = [...draft.stories];
        // Preserve existing emoji if not returned (api usually handles this but good to be safe)
        if (!newStory.emoji) newStory.emoji = newStories[storyIndex].emoji;

        newStories[storyIndex] = newStory;
        setDraft({ ...draft, stories: newStories });
    }

    // Build full context for a story section regeneration
    // Includes both current draft content AND the original deep research
    function getStoryContext(storyIndex: number): string {
        if (!draft) return '';
        const story = draft.stories[storyIndex];

        // Get the original research report for this story (if available)
        const originalReport = selectedReports[storyIndex];
        const deepResearch = originalReport?.deepResearch || '';
        const originalHeadline = originalReport?.story?.headline || '';
        const keyPoints = originalReport?.keyPoints?.join('\n• ') || '';
        const implications = originalReport?.implications || '';

        return `
## ORIGINAL RESEARCH (Source Material):
Headline: ${originalHeadline}

Deep Research:
${deepResearch}

Key Points from Research:
• ${keyPoints}

Implications:
${implications}

---

## CURRENT DRAFT CONTENT (What's been written so far):
Story Title: ${story.title}

Hook: ${story.hookParagraph}

Key Points:
${story.bulletPoints.map(p => `• ${p}`).join('\n')}

Why This Matters:
${story.whyItMatters.map(p => `• ${p}`).join('\n')}

What's Next:
${story.whatsNext.map(p => `• ${p}`).join('\n')}
`.trim();
    }

    // Regenerate a text section via API
    async function regenerateSection(
        sectionType: string,
        currentContent: string,
        prompt: string,
        model: DraftModelId,
        context?: string
    ): Promise<string> {
        const response = await fetch('/api/regenerate-section', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentContent,
                userPrompt: prompt,
                sectionType,
                modelId: model,
                apiKey,
                context,
            }),
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error);

        // Track cost
        if (data.cost) {
            addCost({
                source: data.costSource || 'regen-section',
                model: data.model || model,
                cost: data.cost,
                description: `Regen ${sectionType}`,
            });
        }

        return data.content;
    }

    // Regenerate a bullet list section via API
    async function regenerateBullets(
        sectionType: string,
        currentItems: string[],
        prompt: string,
        model: DraftModelId,
        context?: string
    ): Promise<string[]> {
        const response = await fetch('/api/regenerate-section', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                currentContent: currentItems.join('\n'),
                userPrompt: prompt,
                sectionType,
                modelId: model,
                apiKey,
                context,
            }),
        });
        const data = await response.json();
        if (!data.success) throw new Error(data.error);

        // Track cost
        if (data.cost) {
            addCost({
                source: data.costSource || 'regen-section',
                model: data.model || model,
                cost: data.cost,
                description: `Regen ${sectionType} bullets`,
            });
        }

        return data.isArray ? data.content : data.content.split('\n').filter((l: string) => l.trim());
    }

    // Regenerate ENTIRE story via API
    async function handleRegenerateStory(storyIndex: number) {
        if (!draft || !storyRegenPrompt.trim()) return;

        setRegeneratingStoryIndex(storyIndex);

        try {
            const currentStory = draft.stories[storyIndex];
            const context = getStoryContext(storyIndex);

            const response = await fetch('/api/regenerate-story', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    currentStory,
                    userPrompt: storyRegenPrompt,
                    modelId: storyRegenModel,
                    apiKey,
                    context
                }),
            });

            const data = await response.json();

            if (data.success && data.story) {
                // Preserve the emoji from original story
                data.story.emoji = currentStory.emoji;
                replaceStory(storyIndex, data.story);
                setStoryPopoverOpen(null);
                setStoryRegenPrompt('');

                // Track cost
                if (data.cost) {
                    addCost({
                        source: data.costSource || 'regen-story',
                        model: data.model || storyRegenModel,
                        cost: data.cost,
                        description: `Regen story: ${currentStory.title.substring(0, 30)}...`,
                    });
                }
            } else {
                console.error("Failed to regenerate story:", data.error);
                // Ideally show a toast or error message here
            }
        } catch (err) {
            console.error("Error regenerating story:", err);
        } finally {
            setRegeneratingStoryIndex(null);
        }
    }

    // IMAGE GENERATION HANDLING
    // Image generation moved to Studio Page

    // Add report to selection
    function addReport(report: ResearchReport) {
        if (!selectedReports.find(r => r.story.id === report.story.id)) {
            setSelectedReports([...selectedReports, report]);
        }
    }

    // Remove report from selection
    function removeReport(reportId: string) {
        setSelectedReports(selectedReports.filter(r => r.story.id !== reportId));
    }

    // Move report up in order
    function moveUp(index: number) {
        if (index === 0) return;
        const newOrder = [...selectedReports];
        [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
        setSelectedReports(newOrder);
    }

    // Move report down in order
    function moveDown(index: number) {
        if (index === selectedReports.length - 1) return;
        const newOrder = [...selectedReports];
        [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
        setSelectedReports(newOrder);
    }

    // Generate newsletter draft
    async function generateDraft() {
        if (selectedReports.length === 0) return;

        setIsGenerating(true);
        setError(null);

        try {
            const response = await fetch('/api/generate-draft', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ reports: selectedReports, apiKey, modelId: selectedModel }),
            });

            const data = await response.json();

            if (data.success && data.draft) {
                setDraft(data.draft);

                // Track cost
                if (data.cost) {
                    addCost({
                        source: data.costSource || 'draft',
                        model: data.model || selectedModel,
                        cost: data.cost,
                        description: `Generated draft from ${selectedReports.length} reports`,
                    });
                }
            } else {
                setError(data.error || 'Failed to generate draft');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error');
        } finally {
            setIsGenerating(false);
        }
    }

    // Copy markdown to clipboard
    async function copyToClipboard() {
        if (!draft) return;
        await navigator.clipboard.writeText(draft.rawMarkdown);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }

    // Download as markdown file
    function downloadMarkdown() {
        if (!draft) return;
        const blob = new Blob([draft.rawMarkdown], { type: 'text/markdown' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `newsletter-${draft.date.replace(/,?\s+/g, '-').toLowerCase()}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }

    // Check if report is already selected
    function isSelected(reportId: string) {
        return selectedReports.some(r => r.story.id === reportId);
    }

    return (
        <div className="min-h-screen bg-[#0B0B0F] text-white noise-overlay">
            {/* Atmospheric gradient */}
            <div className="fixed inset-0 bg-gradient-to-br from-coral-900/5 via-transparent to-amber-900/5 pointer-events-none" />

            {/* Header */}
            <header className="sticky top-0 z-50 backdrop-blur-xl bg-[#0B0B0F]/80 border-b border-white/5">
                <div className="max-w-[1800px] mx-auto px-6 py-4 flex items-center justify-between">
                    <div className="flex items-center gap-4">
                        <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => router.push('/research')}
                            className="text-white/50 hover:text-amber-400 hover:bg-white/5"
                        >
                            <ArrowLeft className="w-4 h-4 mr-2" />
                            Back to Research
                        </Button>
                        <div className="h-6 w-px bg-white/10" />
                        <h1 className="font-display text-xl flex items-center gap-2">
                            <Newspaper className="w-5 h-5 text-coral-400" />
                            Newsletter Draft
                        </h1>
                    </div>

                    <div className="flex items-center gap-3">
                        {draft && (
                            <>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={copyToClipboard}
                                    className="text-white/50 hover:text-teal-400 hover:bg-white/5"
                                >
                                    {copied ? (
                                        <Check className="w-4 h-4 mr-2 text-teal-400" />
                                    ) : (
                                        <Copy className="w-4 h-4 mr-2" />
                                    )}
                                    {copied ? 'Copied!' : 'Copy'}
                                </Button>
                                {/* Studio Button */}
                                <Button
                                    onClick={() => router.push('/studio')}
                                    className="bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 animate-pulse-slow"
                                >
                                    <ImageIcon className="w-4 h-4 mr-2" />
                                    Open Image Studio 🎨
                                </Button>
                            </>
                        )}
                        <Badge className="bg-amber-500/10 text-amber-400 border-amber-500/20">
                            {selectedReports.length} selected
                        </Badge>
                    </div>
                </div>
            </header>

            <main className="max-w-[1800px] mx-auto px-6 py-8">
                <div className="grid grid-cols-12 gap-8 h-[calc(100vh-140px)]">

                    {/* Left Panel - Report Selection */}
                    <div className="col-span-4 flex flex-col h-full space-y-6">

                        {/* Selected Reports (Orderable) */}
                        <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 flex-1 flex flex-col deco-corner-tl">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="font-semibold flex items-center gap-2 text-white/90">
                                    <CheckCircle2 className="w-4 h-4 text-teal-400" />
                                    Selected Stories
                                </h2>
                                <span className="text-xs text-white/40">
                                    First = main story
                                </span>
                            </div>

                            {selectedReports.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border-2 border-dashed border-white/5 rounded-xl">
                                    <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3 border border-white/5">
                                        <FileText className="w-5 h-5 text-white/20" />
                                    </div>
                                    <p className="text-sm text-white/40 font-light">
                                        Select research reports below<br />to include in your newsletter
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
                                                {/* Accent bar */}
                                                <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-400 to-coral-500 rounded-l-xl"></div>

                                                <div className="flex flex-col gap-1 ml-2">
                                                    <button
                                                        onClick={() => moveUp(index)}
                                                        disabled={index === 0}
                                                        className="p-0.5 hover:bg-white/10 rounded disabled:opacity-20 text-white/50 hover:text-amber-400 transition-colors"
                                                    >
                                                        <ChevronRight className="w-3 h-3 -rotate-90" />
                                                    </button>
                                                    <button
                                                        onClick={() => moveDown(index)}
                                                        disabled={index === selectedReports.length - 1}
                                                        className="p-0.5 hover:bg-white/10 rounded disabled:opacity-20 text-white/50 hover:text-amber-400 transition-colors"
                                                    >
                                                        <ChevronRight className="w-3 h-3 rotate-90" />
                                                    </button>
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2 mb-1">
                                                        <Badge className={`text-xs px-1.5 py-0 ${index === 0 ? 'bg-amber-500/30 text-amber-300 border-amber-500/40' : 'bg-white/10 text-white/60 border-white/10'}`}>
                                                            {index === 0 ? 'Main' : `#${index + 1}`}
                                                        </Badge>
                                                    </div>
                                                    <p className="text-sm text-white/80 line-clamp-2">
                                                        {report.story.headline}
                                                    </p>
                                                </div>
                                                <button
                                                    onClick={() => removeReport(report.story.id)}
                                                    className="p-1 hover:bg-white/10 rounded text-white/30 hover:text-coral-400 transition-colors"
                                                >
                                                    <X className="w-4 h-4" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </ScrollArea>
                            )}

                            {/* Generate Button */}
                            <div className="pt-4 mt-4 border-t border-white/5">
                                <Button
                                    onClick={generateDraft}
                                    disabled={selectedReports.length === 0 || isGenerating}
                                    className="w-full bg-gradient-to-r from-amber-500 to-coral-500 hover:from-amber-400 hover:to-coral-400 text-[#0B0B0F] h-12 font-semibold text-sm border-0 shadow-glow-amber"
                                >
                                    {isGenerating ? (
                                        <>
                                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                            Generating Newsletter...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles className="w-4 h-4 mr-2" />
                                            Generate Newsletter Draft
                                        </>
                                    )}
                                </Button>
                            </div>
                        </div>

                        {/* Available Reports */}
                        <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 flex-1 flex flex-col">
                            <h2 className="font-semibold mb-4 flex items-center gap-2 text-white/90">
                                <FileText className="w-4 h-4 text-white/40" />
                                Available Reports
                                <span className="text-xs text-white/40 font-normal ml-auto">
                                    {allReports.length} reports
                                </span>
                            </h2>

                            {allReports.length === 0 ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center p-4">
                                    <p className="text-sm text-white/40">
                                        No research reports found.<br />
                                        <button
                                            onClick={() => router.push('/research')}
                                            className="text-amber-400 hover:underline"
                                        >
                                            Go to Research Lab
                                        </button>
                                    </p>
                                </div>
                            ) : (
                                <ScrollArea className="flex-1 -mr-2 pr-2">
                                    <div className="space-y-2">
                                        {allReports.map((report) => {
                                            const selected = isSelected(report.story.id);
                                            return (
                                                <button
                                                    key={report.story.id}
                                                    onClick={() => !selected && addReport(report)}
                                                    disabled={selected}
                                                    className={`w-full text-left p-3 rounded-xl border transition-all hover-lift ${selected
                                                        ? 'bg-teal-500/10 border-teal-500/30 opacity-50 cursor-not-allowed'
                                                        : 'bg-white/5 border-white/5 hover:bg-white/10 hover:border-white/10'
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
                            )}
                        </div>
                    </div>

                    {/* Right Panel - Newsletter Preview */}
                    <div className="col-span-8 flex flex-col h-full">
                        <div className="bg-surface/80 backdrop-blur-xl border border-white/10 rounded-2xl p-6 flex-1 flex flex-col overflow-hidden deco-corner-br">
                            <div className="flex items-center justify-between mb-4">
                                <h2 className="font-display text-lg flex items-center gap-2 text-white/90">
                                    <Newspaper className="w-5 h-5 text-coral-400" />
                                    Newsletter Preview
                                </h2>
                                <div className="flex items-center gap-3">
                                    {/* Model Selector */}
                                    <div className="flex items-center gap-2">
                                        <Settings2 className="w-4 h-4 text-white/40" />
                                        <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as DraftModelId)}>
                                            <SelectTrigger className="w-[180px] bg-black/30 border-white/10 text-white text-sm h-8">
                                                <SelectValue placeholder="Select model" />
                                            </SelectTrigger>
                                            <SelectContent className="bg-surface-elevated border-white/10">
                                                {DRAFT_MODELS.map((model) => (
                                                    <SelectItem
                                                        key={model.id}
                                                        value={model.id}
                                                        className="text-white focus:bg-white/10 focus:text-white"
                                                    >
                                                        <span className="font-medium">{model.name}</span>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>
                                    </div>
                                    {draft && (
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={generateDraft}
                                            disabled={isGenerating}
                                            className="text-white/50 hover:text-amber-400 hover:bg-white/5"
                                        >
                                            <RefreshCw className={`w-4 h-4 mr-2 ${isGenerating ? 'animate-spin' : ''}`} />
                                            Regenerate
                                        </Button>
                                    )}
                                </div>
                            </div>

                            {error && (
                                <div className="mb-4 p-4 rounded-xl bg-coral-500/10 border border-coral-500/30 text-coral-300 text-sm">
                                    {error}
                                </div>
                            )}

                            {!draft && !isGenerating ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center">
                                    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mb-4 border border-white/5">
                                        <Newspaper className="w-8 h-8 text-white/20" />
                                    </div>
                                    <h3 className="font-display text-lg text-white/60 mb-2">
                                        No Draft Yet
                                    </h3>
                                    <p className="text-sm text-white/40 max-w-md">
                                        Select research reports from the left panel and click "Generate Newsletter Draft" to create your newsletter.
                                    </p>
                                </div>
                            ) : isGenerating ? (
                                <div className="flex-1 flex flex-col items-center justify-center text-center">
                                    <div className="relative">
                                        <div className="absolute inset-0 bg-amber-500/20 blur-2xl animate-pulse-slow"></div>
                                        <Loader2 className="relative w-12 h-12 text-amber-400 animate-spin mb-4" />
                                    </div>
                                    <h3 className="font-display text-lg text-white/80 mb-2">
                                        Crafting Your Newsletter...
                                    </h3>
                                    <p className="text-sm text-white/40">
                                        AI is writing engaging content for your audience
                                    </p>
                                </div>
                            ) : draft && (
                                <ScrollArea className="flex-1 -mr-2 pr-2">
                                    {/* Editable Newsletter Draft */}
                                    <article className="space-y-6">
                                        {/* Title & Subtitle */}
                                        <div className="bg-black/30 rounded-xl p-5 border border-white/5 border-accent-left">
                                            <EditableSection
                                                title="Title"
                                                content={draft.title}
                                                onUpdate={(newContent) => updateDraft('title', newContent)}
                                                onRegenerate={(prompt, model) => regenerateSection('title', draft.title, prompt, model)}
                                            />
                                            <div className="mt-4">
                                                <EditableSection
                                                    title="Subtitle"
                                                    content={draft.subtitle}
                                                    onUpdate={(newContent) => updateDraft('subtitle', newContent)}
                                                    onRegenerate={(prompt, model) => regenerateSection('intro', draft.subtitle, prompt, model)}
                                                    placeholder="PLUS: teaser for other stories..."
                                                />
                                            </div>
                                        </div>

                                        {/* Meme Ideas */}
                                        {draft.memeIdeas && draft.memeIdeas.length > 0 && (
                                            <div className="bg-gradient-to-r from-purple-500/10 to-pink-500/10 rounded-xl p-5 border border-purple-500/20">
                                                <h3 className="text-sm font-semibold text-purple-400 mb-4 flex items-center gap-2">
                                                    🎭 Meme Ideas (for intro image)
                                                </h3>
                                                <div className="space-y-4">
                                                    {draft.memeIdeas.map((meme, idx) => (
                                                        <div key={idx} className="bg-black/30 rounded-lg p-4 border border-white/5">
                                                            <div className="flex items-start justify-between mb-2">
                                                                <span className="text-sm font-medium text-amber-400">
                                                                    #{idx + 1} {meme.templateName}
                                                                </span>
                                                            </div>
                                                            <div className="space-y-1 text-sm">
                                                                <p className="text-white/70">
                                                                    <span className="text-white/40">Top:</span> "{meme.topText}"
                                                                </p>
                                                                <p className="text-white/70">
                                                                    <span className="text-white/40">Bottom:</span> "{meme.bottomText}"
                                                                </p>
                                                                <p className="text-white/50 text-xs mt-2 italic">
                                                                    💡 {meme.angle}
                                                                </p>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </div>
                                        )}

                                        {/* Intro */}
                                        <div className="bg-black/30 rounded-xl p-5 border border-white/5">
                                            <EditableSection
                                                title="Introduction"
                                                content={draft.intro}
                                                onUpdate={(newContent) => updateDraft('intro', newContent)}
                                                onRegenerate={(prompt, model) => regenerateSection('intro', draft.intro, prompt, model)}
                                                placeholder="Opening paragraph that hooks readers..."
                                            />
                                        </div>

                                        {/* In Today's Post - TOC */}
                                        {draft.toc && draft.toc.length > 0 && (
                                            <div className="bg-black/30 rounded-xl p-5 border border-white/5">
                                                <h3 className="text-sm font-semibold text-white/70 mb-3">In today's post:</h3>
                                                <ul className="space-y-2">
                                                    {draft.toc.map((item, idx) => (
                                                        <li key={idx} className="flex items-start gap-2 text-white/80">
                                                            <span className="text-amber-400">•</span>
                                                            <span className="text-sm">{item}</span>
                                                        </li>
                                                    ))}
                                                </ul>
                                            </div>
                                        )}

                                        {/* Stories */}
                                        {draft.stories.map((story, storyIndex) => (
                                            <div key={storyIndex} className={`bg-black/30 rounded-xl p-5 border border-white/5 space-y-4 border-accent-left hover:border-amber-500/20 transition-colors relative ${regeneratingStoryIndex === storyIndex ? 'ring-2 ring-amber-500/50 animate-pulse' : ''}`}>

                                                {/* Story Controls Toolbar - REGENERATION UI */}
                                                <div className="absolute top-4 right-4 z-10">
                                                    <Popover open={storyPopoverOpen === storyIndex} onOpenChange={(open) => setStoryPopoverOpen(open ? storyIndex : null)}>
                                                        <PopoverTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-8 text-white/40 hover:text-amber-400 hover:bg-white/5 gap-2"
                                                            >
                                                                <Sparkles className="w-3.5 h-3.5" />
                                                                Regenerate Story
                                                            </Button>
                                                        </PopoverTrigger>
                                                        <PopoverContent className="w-80 bg-surface-elevated border-white/10 p-4" align="end">
                                                            <div className="space-y-3">
                                                                <h4 className="font-semibold text-white text-sm flex items-center gap-2">
                                                                    <Sparkles className="w-4 h-4 text-amber-400" />
                                                                    Regenerate Entire Story
                                                                </h4>

                                                                <p className="text-xs text-white/50">
                                                                    This will rewrite the Title, Hook, and all Bullet Points for this story.
                                                                </p>

                                                                {/* Prompt input */}
                                                                <Textarea
                                                                    value={storyRegenPrompt}
                                                                    onChange={(e) => setStoryRegenPrompt(e.target.value)}
                                                                    placeholder="e.g. 'Make it more enthusiastic' or 'Focus more on the financial impact'"
                                                                    className="bg-black/30 border-white/10 text-white text-sm min-h-[80px] resize-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20"
                                                                />

                                                                {/* Model selector */}
                                                                <Select value={storyRegenModel} onValueChange={(v) => setStoryRegenModel(v as DraftModelId)}>
                                                                    <SelectTrigger className="w-full bg-black/30 border-white/10 text-white text-sm h-9">
                                                                        <SelectValue placeholder="Select model" />
                                                                    </SelectTrigger>
                                                                    <SelectContent className="bg-surface-elevated border-white/10">
                                                                        {DRAFT_MODELS.map((model) => (
                                                                            <SelectItem
                                                                                key={model.id}
                                                                                value={model.id}
                                                                                className="text-white focus:bg-white/10 focus:text-white"
                                                                            >
                                                                                <span className="font-medium">{model.name}</span>
                                                                            </SelectItem>
                                                                        ))}
                                                                    </SelectContent>
                                                                </Select>

                                                                {/* Action buttons */}
                                                                <div className="flex gap-2">
                                                                    <Button
                                                                        onClick={() => setStoryPopoverOpen(null)}
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="flex-1 text-white/60 hover:text-white"
                                                                    >
                                                                        Cancel
                                                                    </Button>
                                                                    <Button
                                                                        onClick={() => handleRegenerateStory(storyIndex)}
                                                                        disabled={!storyRegenPrompt.trim() || regeneratingStoryIndex !== null}
                                                                        size="sm"
                                                                        className="flex-1 bg-amber-500 hover:bg-amber-600 text-[#0B0B0F] font-semibold"
                                                                    >
                                                                        {regeneratingStoryIndex === storyIndex ? (
                                                                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                                        ) : (
                                                                            'Regenerate'
                                                                        )}
                                                                    </Button>
                                                                </div>
                                                            </div>
                                                        </PopoverContent>
                                                    </Popover>
                                                </div>

                                                {/* Text content only */}

                                                {/* Story Title */}
                                                <div className="pr-12"> {/* Padding for absolute button */}
                                                    <EditableSection
                                                        title={`Story ${storyIndex + 1}: ${story.emoji}`}
                                                        content={story.title}
                                                        onUpdate={(newContent) => updateStory(storyIndex, 'title', newContent)}
                                                        onRegenerate={(prompt, model) => regenerateSection('title', story.title, prompt, model, getStoryContext(storyIndex))}
                                                        storyContext={getStoryContext(storyIndex)}
                                                    />
                                                </div>

                                                {/* Hook Paragraph */}
                                                <EditableSection
                                                    title="Hook"
                                                    content={story.hookParagraph}
                                                    onUpdate={(newContent) => updateStory(storyIndex, 'hookParagraph', newContent)}
                                                    onRegenerate={(prompt, model) => regenerateSection('hook', story.hookParagraph, prompt, model, getStoryContext(storyIndex))}
                                                    placeholder="Opening hook to grab attention..."
                                                    storyContext={getStoryContext(storyIndex)}
                                                />

                                                {/* Key Points */}
                                                <EditableBulletList
                                                    title="The Key Points"
                                                    emoji="🔍"
                                                    items={story.bulletPoints}
                                                    onUpdate={(items) => updateStory(storyIndex, 'bulletPoints', items)}
                                                    onRegenerate={(prompt, model) => regenerateBullets('bullets', story.bulletPoints, prompt, model, getStoryContext(storyIndex))}
                                                    storyContext={getStoryContext(storyIndex)}
                                                />

                                                {/* Why It Matters */}
                                                <EditableBulletList
                                                    title="Why This Matters"
                                                    emoji="🚨"
                                                    items={story.whyItMatters}
                                                    onUpdate={(items) => updateStory(storyIndex, 'whyItMatters', items)}
                                                    onRegenerate={(prompt, model) => regenerateBullets('whyMatters', story.whyItMatters, prompt, model, getStoryContext(storyIndex))}
                                                    storyContext={getStoryContext(storyIndex)}
                                                />

                                                {/* What's Next */}
                                                <EditableBulletList
                                                    title="What's Next"
                                                    emoji="⏭️"
                                                    items={story.whatsNext}
                                                    onUpdate={(items) => updateStory(storyIndex, 'whatsNext', items)}
                                                    onRegenerate={(prompt, model) => regenerateBullets('whatsNext', story.whatsNext, prompt, model, getStoryContext(storyIndex))}
                                                    storyContext={getStoryContext(storyIndex)}
                                                />
                                            </div>
                                        ))}

                                        {/* Quick Summary */}
                                        <div className="bg-black/30 rounded-xl p-5 border border-white/5">
                                            <EditableSection
                                                title="🚀 Quick Summary"
                                                content={draft.quickSummary}
                                                onUpdate={(newContent) => updateDraft('quickSummary', newContent)}
                                                onRegenerate={(prompt, model) => regenerateSection('summary', draft.quickSummary, prompt, model)}
                                                placeholder="Brief summary of all stories..."
                                            />
                                        </div>

                                        {/* Outro */}
                                        <div className="text-center text-white/60 py-6 bg-gradient-to-b from-black/30 to-transparent rounded-xl border border-white/5">
                                            <p className="font-display text-lg">Ithrollu innathe AI Update.</p>
                                            <p className="mt-2">appo adutha l8ril varam.. bie. ✌️</p>
                                        </div>
                                    </article>
                                </ScrollArea>
                            )}
                        </div>
                    </div>
                </div>
            </main>
        </div >
    );
}
