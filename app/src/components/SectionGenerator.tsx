'use client';

import { useState } from 'react';
import { DRAFT_MODELS, DraftModelId, DEFAULT_DRAFT_MODEL, DEFAULT_INTRO_MODEL } from '@/lib/draft-generator';
import { ResearchReport } from '@/lib/types';
import { Button } from '@/components/ui/button';
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
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogTrigger,
} from '@/components/ui/dialog';
import {
    Sparkles,
    Loader2,
    Eye,
    ChevronDown,
    ChevronUp,
} from 'lucide-react';
import { addCost } from '@/lib/cost-tracker';

type SectionType = 'title' | 'intro' | 'toc' | 'story' | 'summary';

interface SectionGeneratorProps {
    sectionType: SectionType;
    storyIndex?: number;
    researchReports: ResearchReport[];
    onGenerated: (content: string) => void;
    children?: React.ReactNode;
    className?: string;
    label?: string;
}

export function SectionGenerator({
    sectionType,
    storyIndex,
    researchReports,
    onGenerated,
    children,
    className = '',
    label,
}: SectionGeneratorProps) {
    const [isGenerating, setIsGenerating] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const [userInput, setUserInput] = useState('');
    const [error, setError] = useState<string | null>(null);

    // Default models based on section type
    const defaultModel = (sectionType === 'title' || sectionType === 'intro')
        ? DEFAULT_INTRO_MODEL
        : DEFAULT_DRAFT_MODEL;
    const [selectedModel, setSelectedModel] = useState<DraftModelId>(defaultModel);

    const sectionLabels: Record<SectionType, string> = {
        title: '📝 Title & Subtitle',
        intro: '📖 Introduction',
        toc: '📋 In Today\'s Post',
        story: `📰 Story ${(storyIndex || 0) + 1}`,
        summary: '🚀 Quick Summary',
    };

    async function generateSection() {
        if (researchReports.length === 0) return;

        setIsGenerating(true);
        setError(null);

        try {
            const response = await fetch('/api/generate-section', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sectionType,
                    storyIndex,
                    researchReports,
                    modelId: selectedModel,
                    userInput: userInput.trim() || undefined,
                }),
            });

            const data = await response.json();

            if (data.success && data.content) {
                onGenerated(data.content);
                setIsOpen(false);
                setUserInput('');

                // Track cost
                if (data.cost) {
                    addCost({
                        source: data.costSource || `section-${sectionType}`,
                        model: data.model || selectedModel,
                        cost: data.cost,
                        description: `Generated ${sectionType}${storyIndex !== undefined ? ` #${storyIndex + 1}` : ''}`,
                    });
                }
            } else {
                setError(data.error || 'Failed to generate section');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Network error');
        } finally {
            setIsGenerating(false);
        }
    }

    return (
        <div className={`relative ${className}`}>
            {/* Section Header with Generate Controls */}
            <div className="flex items-center justify-between mb-3">
                <span className="text-xs font-semibold text-white/60 uppercase tracking-wider">
                    {label || sectionLabels[sectionType]}
                </span>

                <Popover open={isOpen} onOpenChange={setIsOpen}>
                    <PopoverTrigger asChild>
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1.5 text-white/50 hover:text-amber-400 hover:bg-white/5"
                        >
                            <Sparkles className="w-3 h-3" />
                            Generate
                            {isOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                        </Button>
                    </PopoverTrigger>
                    <PopoverContent
                        className="w-80 bg-[#1a1a22] border-white/10 p-4"
                        align="end"
                    >
                        <div className="space-y-4">
                            {/* Model Selector */}
                            <div>
                                <label className="text-xs text-white/50 mb-1.5 block">Model</label>
                                <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as DraftModelId)}>
                                    <SelectTrigger className="w-full bg-black/30 border-white/10 text-white text-sm h-9">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent className="bg-[#1a1a22] border-white/10">
                                        {DRAFT_MODELS.map((model) => (
                                            <SelectItem
                                                key={model.id}
                                                value={model.id}
                                                className="text-white focus:bg-amber-500/20 focus:text-amber-300"
                                            >
                                                {model.name}
                                            </SelectItem>
                                        ))}
                                    </SelectContent>
                                </Select>
                            </div>

                            {/* User Input */}
                            <div>
                                <label className="text-xs text-white/50 mb-1.5 block">
                                    Your Instructions (optional)
                                </label>
                                <Textarea
                                    value={userInput}
                                    onChange={(e) => setUserInput(e.target.value)}
                                    placeholder="e.g., Make it punchier, focus on India angle..."
                                    className="bg-black/30 border-white/10 text-white text-sm min-h-[60px] resize-none placeholder:text-white/30"
                                />
                            </div>

                            {/* Context Info */}
                            <div className="flex items-center gap-2 text-xs text-white/40">
                                <Eye className="w-3 h-3" />
                                <span>Using {researchReports.length} research reports</span>
                            </div>

                            {/* Error */}
                            {error && (
                                <div className="text-xs text-coral-400 bg-coral-500/10 p-2 rounded">
                                    {error}
                                </div>
                            )}

                            {/* Generate Button */}
                            <Button
                                onClick={generateSection}
                                disabled={isGenerating || researchReports.length === 0}
                                className="w-full bg-gradient-to-r from-amber-500 to-coral-500 hover:from-amber-400 hover:to-coral-400 text-[#0B0B0F] h-9 font-semibold text-sm"
                            >
                                {isGenerating ? (
                                    <>
                                        <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                        Generating...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4 mr-2" />
                                        Generate {sectionLabels[sectionType]}
                                    </>
                                )}
                            </Button>
                        </div>
                    </PopoverContent>
                </Popover>
            </div>

            {/* Section Content */}
            {children}
        </div>
    );
}

// Empty placeholder for sections not yet generated
export function EmptySectionPlaceholder({
    label,
    onGenerate
}: {
    label: string;
    onGenerate?: () => void;
}) {
    return (
        <div className="flex flex-col items-center justify-center py-8 text-center border-2 border-dashed border-white/10 rounded-xl bg-white/[0.02]">
            <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center mb-3">
                <Sparkles className="w-5 h-5 text-white/20" />
            </div>
            <p className="text-sm text-white/40 mb-1">{label} not generated yet</p>
            <p className="text-xs text-white/25">Use the Generate button above</p>
        </div>
    );
}
