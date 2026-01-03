'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { DRAFT_MODELS, DraftModelId } from '@/lib/draft-generator';
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
    RefreshCw,
    Loader2,
    Sparkles,
    Edit3,
    Check,
    X,
} from 'lucide-react';

interface EditableSectionProps {
    title: string;
    content: string;
    onUpdate: (newContent: string) => void;
    onRegenerate: (prompt: string, model: DraftModelId) => Promise<string>;
    placeholder?: string;
    storyContext?: string; // Full story context for better regeneration
    className?: string;
}

export function EditableSection({
    title,
    content,
    onUpdate,
    onRegenerate,
    placeholder = 'Enter content...',
    storyContext = '',
    className = '',
}: EditableSectionProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(content);
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [regeneratePrompt, setRegeneratePrompt] = useState('');
    const [selectedModel, setSelectedModel] = useState<DraftModelId>('anthropic/claude-sonnet-4');
    const [popoverOpen, setPopoverOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Click outside to cancel edit
    useEffect(() => {
        if (!isEditing) return;

        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                cancelEdit();
            }
        }

        // Delay to prevent immediate trigger
        const timeoutId = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isEditing]);

    // Start editing
    function startEdit() {
        setEditValue(content);
        setIsEditing(true);
        setTimeout(() => textareaRef.current?.focus(), 50);
    }

    // Save edit
    function saveEdit() {
        onUpdate(editValue);
        setIsEditing(false);
    }

    // Cancel edit
    const cancelEdit = useCallback(() => {
        setEditValue(content);
        setIsEditing(false);
    }, [content]);

    // Handle regeneration with context
    async function handleRegenerate() {
        if (!regeneratePrompt.trim()) return;

        setIsRegenerating(true);
        try {
            const newContent = await onRegenerate(regeneratePrompt, selectedModel);
            onUpdate(newContent);
            setPopoverOpen(false);
            setRegeneratePrompt('');
        } catch (error) {
            console.error('Regeneration failed:', error);
        } finally {
            setIsRegenerating(false);
        }
    }

    // Handle keyboard shortcuts
    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Escape') {
            cancelEdit();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            saveEdit();
        }
    }

    return (
        <div
            ref={containerRef}
            className={`group relative ${isRegenerating ? 'ring-2 ring-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.3)] animate-pulse' : ''} ${className}`}
        >
            {/* Section Header */}
            <div className="flex items-center justify-between mb-2">
                <h3 className="text-sm font-semibold text-amber-400/80">{title}</h3>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isEditing && (
                        <>
                            <button
                                onClick={startEdit}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-amber-400 transition-colors"
                                title="Edit"
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <button
                                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-amber-400 transition-colors"
                                        title="Regenerate with prompt"
                                    >
                                        <Sparkles className="w-3.5 h-3.5" />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent
                                    className="w-80 bg-surface-elevated border-white/10 p-4"
                                    align="end"
                                >
                                    <div className="space-y-3">
                                        <h4 className="font-semibold text-white text-sm flex items-center gap-2">
                                            <Sparkles className="w-4 h-4 text-amber-400" />
                                            Regenerate {title}
                                        </h4>

                                        {/* Current content preview */}
                                        <div className="p-2 rounded-lg bg-black/30 text-xs text-white/50 max-h-20 overflow-auto border border-white/5">
                                            {content.slice(0, 150)}{content.length > 150 ? '...' : ''}
                                        </div>

                                        {/* Prompt input */}
                                        <Textarea
                                            value={regeneratePrompt}
                                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRegeneratePrompt(e.target.value)}
                                            placeholder="What changes do you want? e.g., 'Make it more casual' or 'Add more specific numbers'"
                                            className="bg-black/30 border-white/10 text-white text-sm min-h-[80px] resize-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20"
                                        />

                                        {/* Model selector */}
                                        <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as DraftModelId)}>
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
                                                        <div>
                                                            <span className="font-medium">{model.name}</span>
                                                            <span className="text-white/40 ml-2 text-xs">
                                                                {model.description}
                                                            </span>
                                                        </div>
                                                    </SelectItem>
                                                ))}
                                            </SelectContent>
                                        </Select>

                                        {/* Action buttons */}
                                        <div className="flex gap-2">
                                            <Button
                                                onClick={() => setPopoverOpen(false)}
                                                variant="ghost"
                                                size="sm"
                                                className="flex-1 text-white/60 hover:text-white"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                onClick={handleRegenerate}
                                                disabled={!regeneratePrompt.trim() || isRegenerating}
                                                size="sm"
                                                className="flex-1 bg-amber-500 hover:bg-amber-600 text-[#0B0B0F] font-semibold"
                                            >
                                                {isRegenerating ? (
                                                    <>
                                                        <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                                                        Generating...
                                                    </>
                                                ) : (
                                                    <>
                                                        <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                                                        Regenerate
                                                    </>
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </>
                    )}
                </div>
            </div>

            {/* Content Area */}
            {isEditing ? (
                <div className="space-y-2">
                    <Textarea
                        ref={textareaRef}
                        value={editValue}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder={placeholder}
                        className="bg-black/30 border-amber-500/30 text-white text-sm min-h-[100px] resize-y focus:ring-amber-500/30 focus:border-amber-500/50"
                    />
                    <div className="flex items-center gap-2 justify-between">
                        <span className="text-xs text-white/30">Esc to cancel • Ctrl+Enter to save</span>
                        <div className="flex gap-2">
                            <Button
                                onClick={cancelEdit}
                                variant="ghost"
                                size="sm"
                                className="text-white/60 h-8 hover:text-white"
                            >
                                <X className="w-3.5 h-3.5 mr-1" />
                                Cancel
                            </Button>
                            <Button
                                onClick={saveEdit}
                                size="sm"
                                className="bg-teal-500 hover:bg-teal-600 text-[#0B0B0F] font-semibold h-8"
                            >
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Save
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <div
                    className="whitespace-pre-wrap text-white/80 text-sm cursor-text hover:bg-white/5 rounded-lg p-2 -m-2 transition-colors border border-transparent hover:border-white/5"
                    onClick={startEdit}
                >
                    {content || <span className="text-white/30 italic">{placeholder}</span>}
                </div>
            )}
        </div>
    );
}

// Editable bullet list section
interface EditableBulletListProps {
    title: string;
    emoji: string;
    items: string[];
    onUpdate: (items: string[]) => void;
    onRegenerate: (prompt: string, model: DraftModelId) => Promise<string[]>;
    storyContext?: string; // Full story context for better regeneration
    className?: string;
}

export function EditableBulletList({
    title,
    emoji,
    items,
    onUpdate,
    onRegenerate,
    storyContext = '',
    className = '',
}: EditableBulletListProps) {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(items.join('\n'));
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [regeneratePrompt, setRegeneratePrompt] = useState('');
    const [selectedModel, setSelectedModel] = useState<DraftModelId>('anthropic/claude-sonnet-4');
    const [popoverOpen, setPopoverOpen] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    // Click outside to cancel edit
    useEffect(() => {
        if (!isEditing) return;

        function handleClickOutside(event: MouseEvent) {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                cancelEdit();
            }
        }

        const timeoutId = setTimeout(() => {
            document.addEventListener('mousedown', handleClickOutside);
        }, 100);

        return () => {
            clearTimeout(timeoutId);
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isEditing]);

    function startEdit() {
        setEditValue(items.join('\n'));
        setIsEditing(true);
    }

    function saveEdit() {
        const newItems = editValue.split('\n').filter(line => line.trim().length > 0);
        onUpdate(newItems);
        setIsEditing(false);
    }

    const cancelEdit = useCallback(() => {
        setEditValue(items.join('\n'));
        setIsEditing(false);
    }, [items]);

    async function handleRegenerate() {
        if (!regeneratePrompt.trim()) return;

        setIsRegenerating(true);
        try {
            const newItems = await onRegenerate(regeneratePrompt, selectedModel);
            onUpdate(newItems);
            setPopoverOpen(false);
            setRegeneratePrompt('');
        } catch (error) {
            console.error('Regeneration failed:', error);
        } finally {
            setIsRegenerating(false);
        }
    }

    function handleKeyDown(e: React.KeyboardEvent) {
        if (e.key === 'Escape') {
            cancelEdit();
        } else if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
            saveEdit();
        }
    }

    return (
        <div
            ref={containerRef}
            className={`group relative ${isRegenerating ? 'ring-2 ring-amber-500/50 shadow-[0_0_20px_rgba(245,158,11,0.3)] animate-pulse' : ''} ${className}`}
        >
            {/* Section Header */}
            <div className="flex items-center justify-between mb-2">
                <h4 className="text-sm font-semibold text-white/80">{emoji} {title}</h4>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {!isEditing && (
                        <>
                            <button
                                onClick={startEdit}
                                className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-amber-400 transition-colors"
                                title="Edit"
                            >
                                <Edit3 className="w-3.5 h-3.5" />
                            </button>
                            <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
                                <PopoverTrigger asChild>
                                    <button
                                        className="p-1.5 rounded-lg hover:bg-white/10 text-white/40 hover:text-amber-400 transition-colors"
                                        title="Regenerate with prompt"
                                    >
                                        <Sparkles className="w-3.5 h-3.5" />
                                    </button>
                                </PopoverTrigger>
                                <PopoverContent
                                    className="w-80 bg-surface-elevated border-white/10 p-4"
                                    align="end"
                                >
                                    <div className="space-y-3">
                                        <h4 className="font-semibold text-white text-sm flex items-center gap-2">
                                            <Sparkles className="w-4 h-4 text-amber-400" />
                                            Regenerate {title}
                                        </h4>

                                        {/* Current items preview */}
                                        <div className="p-2 rounded-lg bg-black/30 text-xs text-white/50 max-h-20 overflow-auto border border-white/5">
                                            {items.map((item, i) => (
                                                <div key={i}>• {item}</div>
                                            ))}
                                        </div>

                                        {/* Prompt input */}
                                        <Textarea
                                            value={regeneratePrompt}
                                            onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setRegeneratePrompt(e.target.value)}
                                            placeholder="What changes do you want?"
                                            className="bg-black/30 border-white/10 text-white text-sm min-h-[80px] resize-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20"
                                        />

                                        {/* Model selector */}
                                        <Select value={selectedModel} onValueChange={(v) => setSelectedModel(v as DraftModelId)}>
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
                                                onClick={() => setPopoverOpen(false)}
                                                variant="ghost"
                                                size="sm"
                                                className="flex-1 text-white/60 hover:text-white"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                onClick={handleRegenerate}
                                                disabled={!regeneratePrompt.trim() || isRegenerating}
                                                size="sm"
                                                className="flex-1 bg-amber-500 hover:bg-amber-600 text-[#0B0B0F] font-semibold"
                                            >
                                                {isRegenerating ? (
                                                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                                ) : (
                                                    'Regenerate'
                                                )}
                                            </Button>
                                        </div>
                                    </div>
                                </PopoverContent>
                            </Popover>
                        </>
                    )}
                </div>
            </div>

            {/* Content Area */}
            {isEditing ? (
                <div className="space-y-2">
                    <Textarea
                        value={editValue}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setEditValue(e.target.value)}
                        onKeyDown={handleKeyDown}
                        placeholder="One item per line"
                        className="bg-black/30 border-amber-500/30 text-white text-sm min-h-[100px] resize-y focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20"
                    />
                    <div className="flex items-center gap-2 justify-between">
                        <span className="text-xs text-white/30">One bullet per line • Esc to cancel</span>
                        <div className="flex gap-2">
                            <Button onClick={cancelEdit} variant="ghost" size="sm" className="text-white/60 h-8 hover:text-white">
                                <X className="w-3.5 h-3.5 mr-1" />
                                Cancel
                            </Button>
                            <Button onClick={saveEdit} size="sm" className="bg-teal-500 hover:bg-teal-600 text-[#0B0B0F] font-semibold h-8">
                                <Check className="w-3.5 h-3.5 mr-1" />
                                Save
                            </Button>
                        </div>
                    </div>
                </div>
            ) : (
                <ul
                    className="space-y-1.5 cursor-text hover:bg-white/5 rounded-lg p-2 -m-2 transition-colors border border-transparent hover:border-white/5"
                    onClick={startEdit}
                >
                    {items.length > 0 ? items.map((item, i) => (
                        <li key={i} className="text-sm text-white/70 flex items-start gap-2">
                            <span className="text-amber-400/60 mt-0.5">•</span>
                            <span>{item}</span>
                        </li>
                    )) : (
                        <li className="text-sm text-white/30 italic">No items yet</li>
                    )}
                </ul>
            )}
        </div>
    );
}
