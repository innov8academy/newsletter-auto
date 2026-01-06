'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { NewsletterDraft, StoryBlock } from '@/lib/draft-generator';
import { getApiKey } from '@/lib/storage';
import { addCost } from '@/lib/cost-tracker';
import { CostTracker } from '@/components/CostTracker';
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
    ArrowLeft,
    Check,
    Download,
    Eye,
    Image as ImageIcon,
    Loader2,
    Maximize2,
    RefreshCw,
    Sparkles,
    Trash2,
    Wand2,
    Upload,
} from 'lucide-react';

const IMAGE_MODELS = [
    { id: 'google/gemini-3-pro-image-preview', name: 'Gemini 3 Pro', description: 'Google Flagship (High Fidelity)' },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', description: 'Fastest Multimodal' },
    { id: 'bytedance-seed/seedream-4.5', name: 'SeedDream 4.5', description: 'Artistic consistency' },
    { id: 'black-forest-labs/flux-pro-1.1', name: 'Flux Pro 1.1', description: 'Reliable Fallback' },
];

export default function StudioPage() {
    const router = useRouter();
    const [draft, setDraft] = useState<NewsletterDraft | null>(null);
    const [apiKey, setApiKey] = useState('');
    const [selectedStoryIndex, setSelectedStoryIndex] = useState<number>(0);
    const [generatedPrompts, setGeneratedPrompts] = useState<{ [key: number]: string }>({});
    const [generatingStates, setGeneratingStates] = useState<{ [key: number]: boolean }>({});
    const [globalModel, setGlobalModel] = useState<string>('google/gemini-3-pro-image-preview');
    const [useStyleRefs, setUseStyleRefs] = useState(true); // NEW: Toggle for style references

    // Load draft from localStorage on mount
    useEffect(() => {
        const storedDraft = localStorage.getItem('currentDraft');
        const key = getApiKey();

        // Flow protection: redirect to Draft if no draft found
        if (!storedDraft) {
            router.push('/draft');
            return;
        }

        setDraft(JSON.parse(storedDraft));
        setApiKey(key || '');
    }, [router]);

    // Save draft update
    function updateDraft(newDraft: NewsletterDraft) {
        setDraft(newDraft);
        localStorage.setItem('currentDraft', JSON.stringify(newDraft));
    }

    // Update specific story image (stored in state only, not localStorage to avoid quota issues)
    const [storyImages, setStoryImages] = useState<{ [key: number]: string }>({});

    function updateStoryImage(index: number, url: string) {
        setStoryImages(prev => ({ ...prev, [index]: url }));
    }

    // Helper to get image for a story (from local state or draft)
    function getStoryImage(index: number): string {
        return storyImages[index] || (draft?.stories[index]?.imageUrl) || '';
    }

    // Download image via server-side API (Robust Strategy)
    // Download image via Smart Strategy
    async function downloadImage(imageUrl: string, storyIndex: number) {
        // Default filename
        let filename = `newsletter-story-${storyIndex + 1}.png`;

        try {
            console.log('Initiating smart download for:', filename);

            // STRATEGY 1: Client-side Base64/Blob check
            if (imageUrl.startsWith('data:')) {
                console.log('Strategy 1: Converting Data URI to Blob for safer download');

                // Extract content type and base64
                const [header, base64Data] = imageUrl.split(',');
                const mimeMatch = header.match(/:(.*?);/);
                const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                // Adjust extension based on actual mime type
                const ext = mimeType.split('/')[1];
                filename = `newsletter-story-${storyIndex + 1}.${ext}`;

                // Convert base64 to Blob
                const byteCharacters = atob(base64Data);
                const byteNumbers = new Array(byteCharacters.length);
                for (let i = 0; i < byteCharacters.length; i++) {
                    byteNumbers[i] = byteCharacters.charCodeAt(i);
                }
                const byteArray = new Uint8Array(byteNumbers);
                const blob = new Blob([byteArray], { type: mimeType });

                // Download Blob
                const url = URL.createObjectURL(blob);
                const link = document.createElement('a');
                link.href = url;
                link.download = filename;
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                return;
            }

            // STRATEGY 2: Direct Fetch (Client-side) for remote URLs
            if (!imageUrl.startsWith('blob:')) { // Don't fetch if it's already a blob URI (handled above? No waiting, blob: URIs usually navigate? actually blob: should use the anchor method too)
                try {
                    console.log('Strategy 2: Client-side Fetch');
                    const response = await fetch(imageUrl, { mode: 'cors' });
                    if (response.ok) {
                        const blob = await response.blob();

                        // Infer extension from blob type if possible
                        if (blob.type) {
                            const ext = blob.type.split('/')[1];
                            if (ext) filename = `newsletter-story-${storyIndex + 1}.${ext}`;
                        }

                        const url = URL.createObjectURL(blob);
                        const link = document.createElement('a');
                        link.href = url;
                        link.download = filename;
                        document.body.appendChild(link);
                        link.click();
                        document.body.removeChild(link);
                        URL.revokeObjectURL(url);
                        return;
                    }
                } catch (err) {
                    console.warn('Strategy 2 failed, falling back to server:', err);
                }
            }

            // STRATEGY 3: Server Proxy (Fallback)
            console.log('Strategy 3: Server Proxy Fallback');
            const response = await fetch('/api/download-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ imageUrl, filename })
            });

            if (!response.ok) {
                const err = await response.json();
                throw new Error(err.error || 'Server download failed');
            }

            const blob = await response.blob();
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = filename;
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);

        } catch (error) {
            console.error('All download strategies failed:', error);
            alert('Download failed. Trying to open in new tab.');
            window.open(imageUrl, '_blank');
        }
    }

    // Generate Prompt for a Story
    async function generatePrompt(index: number) {
        if (!draft) return;
        setGeneratingStates(prev => ({ ...prev, [index]: true }));

        const story = draft.stories[index];
        try {
            const promptRes = await fetch('/api/generate-image-prompt', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sectionText: `${story.title}\n\n${story.hookParagraph}\n\n${story.bulletPoints.join('\n')}`,
                    styleContext: 'Tech-forward, vibrant, minimal UI elements, cinematic lighting, 16:9 aspect ratio',
                    newsletterContext: 'L8R by Innov8 - Daily Tech Newsletter',
                    apiKey
                })
            });

            if (!promptRes.ok) throw new Error('Prompt API failed');
            const data = await promptRes.json();
            setGeneratedPrompts(prev => ({ ...prev, [index]: data.prompt }));

            // Track cost
            if (data.cost) {
                addCost({
                    source: data.costSource || 'image-prompt',
                    model: data.model || 'google/gemini-2.0-flash-001',
                    cost: data.cost,
                    description: `Prompt for story ${index + 1}`,
                });
            }
        } catch (err) {
            console.error(err);
            alert('Failed to generate prompt');
        } finally {
            setGeneratingStates(prev => ({ ...prev, [index]: false }));
        }
    }

    // Generate Image using STYLED pipeline
    async function generateImage(index: number) {
        if (!draft) return;

        setGeneratingStates(prev => ({ ...prev, [index]: true }));

        const story = draft.stories[index];
        const storyText = `${story.title}\n\n${story.hookParagraph}\n\n${story.bulletPoints.join('\n')}`;

        // Check if user already has a custom prompt
        const existingPrompt = generatedPrompts[index];
        const hasCustomPrompt = existingPrompt && existingPrompt.trim().length > 0;

        try {
            console.log(`Studio: Generating styled image with ${globalModel}, styleRefs: ${useStyleRefs}, hasCustomPrompt: ${hasCustomPrompt}`);

            const res = await fetch('/api/generate-styled-image', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    storyText,
                    model: globalModel,
                    apiKey,
                    useStyleRefs,
                    // If user has a custom prompt, use it directly and skip prompt generation
                    customPrompt: hasCustomPrompt ? existingPrompt : undefined,
                    useCreativePrompt: !hasCustomPrompt // Only generate if no custom prompt
                })
            });

            const data = await res.json();

            if (!res.ok || !data.success) {
                throw new Error(data.error || 'Image generation failed');
            }

            if (data.imageUrl) {
                updateStoryImage(index, data.imageUrl);
                // Only update prompt if we DIDN'T have a custom one (i.e., it was auto-generated)
                if (!hasCustomPrompt && data.prompt) {
                    setGeneratedPrompts(prev => ({ ...prev, [index]: data.prompt }));
                }

                // Track cost
                if (data.cost) {
                    addCost({
                        source: data.costSource || 'image-gen',
                        model: data.model || globalModel,
                        cost: data.cost,
                        description: `Image for story ${index + 1}`,
                    });
                }
            } else {
                throw new Error('No image URL returned');
            }

        } catch (err) {
            console.error(err);
            let msg = err instanceof Error ? err.message : 'Unknown error';
            alert(`Generation Error:\n${msg}`);
        } finally {
            setGeneratingStates(prev => ({ ...prev, [index]: false }));
        }
    }

    if (!draft) return <div className="min-h-screen bg-[#0B0B0F] flex items-center justify-center text-white">Loading Studio...</div>;

    const selectedStory = draft.stories[selectedStoryIndex];

    return (
        <div className="min-h-screen bg-[#0B0B0F] text-white flex flex-col noise-overlay">
            {/* Header */}
            <header className="h-16 border-b border-white/5 bg-[#0B0B0F]/80 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-50">
                <div className="flex items-center gap-4">
                    <Button variant="ghost" size="sm" onClick={() => router.push('/draft')} className="text-white/50 hover:text-white">
                        <ArrowLeft className="w-4 h-4 mr-2" />
                        Back to Draft
                    </Button>
                    <div className="h-6 w-px bg-white/10" />
                    <h1 className="font-display text-lg flex items-center gap-2">
                        <ImageIcon className="w-5 h-5 text-purple-400" />
                        Image Studio
                    </h1>
                </div>

                <div className="flex items-center gap-4">
                    {/* Model Selector */}
                    <Select value={globalModel} onValueChange={setGlobalModel}>
                        <SelectTrigger className="w-[200px] bg-white/5 border-white/10 text-white">
                            <SelectValue placeholder="Select Model" />
                        </SelectTrigger>
                        <SelectContent className="bg-zinc-900 border-white/10 text-white">
                            {IMAGE_MODELS.map(m => (
                                <SelectItem key={m.id} value={m.id}>
                                    <span className="font-medium">{m.name}</span>
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>

                    {/* Style References Toggle */}
                    <button
                        onClick={() => setUseStyleRefs(!useStyleRefs)}
                        className={`px-3 py-2 rounded-lg text-sm flex items-center gap-2 transition-all ${useStyleRefs
                            ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                            : 'bg-white/5 text-white/50 border border-white/10'
                            }`}
                    >
                        <Sparkles className="w-4 h-4" />
                        Style Refs {useStyleRefs ? 'ON' : 'OFF'}
                    </button>

                    <Button
                        onClick={() => router.push('/upload')}
                        className="bg-gradient-to-r from-purple-500 to-pink-500 text-white border-0 shadow-glow-purple"
                    >
                        <Upload className="w-4 h-4 mr-2" />
                        Finish & Upload
                    </Button>
                </div>
            </header>

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden">
                {/* Left: Story List */}
                <div className="w-80 border-r border-white/5 bg-black/20 flex flex-col">
                    <div className="p-4 border-b border-white/5">
                        <h2 className="text-xs font-semibold text-white/40 uppercase tracking-wider">Stories</h2>
                    </div>
                    <ScrollArea className="flex-1">
                        <div className="p-2 space-y-1">
                            {draft.stories.map((story, i) => (
                                <button
                                    key={i}
                                    onClick={() => setSelectedStoryIndex(i)}
                                    className={`w-full text-left p-3 rounded-lg text-sm transition-all ${selectedStoryIndex === i
                                        ? 'bg-purple-500/20 text-white border border-purple-500/30'
                                        : 'text-white/60 hover:bg-white/5 border border-transparent'
                                        }`}
                                >
                                    <div className="flex items-center justify-between mb-1">
                                        <span className="font-medium truncate">{story.emoji} Story {i + 1}</span>
                                        {story.imageUrl && <Check className="w-3 h-3 text-teal-400" />}
                                    </div>
                                    <p className="truncate text-xs opacity-70">{story.title}</p>
                                </button>
                            ))}
                        </div>
                    </ScrollArea>
                </div>

                {/* Center: Canvas */}
                <div className="flex-1 flex flex-col relative">
                    {/* Background Pattern */}
                    <div className="absolute inset-0 bg-[url('/grid-pattern.svg')] opacity-5 pointer-events-none" />

                    {/* Toolbar */}
                    <div className="p-6 pb-0 flex justify-between items-end z-10">
                        <div>
                            <h2 className="text-2xl font-display text-white">{selectedStory.title}</h2>
                            <p className="text-white/50 text-sm mt-1 max-w-2xl line-clamp-2">{selectedStory.hookParagraph}</p>
                        </div>
                    </div>

                    <div className="flex-1 p-8 flex items-center justify-center">
                        <div className="w-full max-w-4xl flex gap-8 h-[60vh]">

                            {/* Prompt Editor (Left Half) */}
                            <div className="flex-1 flex flex-col gap-4">
                                <div className="bg-black/40 rounded-xl border border-white/10 p-4 flex-1 flex flex-col">
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-xs font-semibold text-white/40 uppercase">Image Prompt</label>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => generatePrompt(selectedStoryIndex)}
                                            disabled={generatingStates[selectedStoryIndex]}
                                            className="h-6 text-xs text-purple-400 hover:text-purple-300 hover:bg-purple-500/10"
                                        >
                                            <Sparkles className="w-3 h-3 mr-1" />
                                            {generatedPrompts[selectedStoryIndex] ? 'Regenerate Prompt' : 'Auto-Generate Info'}
                                        </Button>
                                    </div>
                                    <Textarea
                                        value={generatedPrompts[selectedStoryIndex] || ''}
                                        onChange={(e) => setGeneratedPrompts(prev => ({ ...prev, [selectedStoryIndex]: e.target.value }))}
                                        placeholder="Enter a prompt or click Auto-Generate..."
                                        className="flex-1 bg-black/20 border-white/5 resize-none text-sm leading-relaxed focus:border-purple-500/50"
                                    />
                                    <div className="mt-4 pt-4 border-t border-white/5">
                                        <Button
                                            size="lg"
                                            className="w-full bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-900/20"
                                            onClick={() => generateImage(selectedStoryIndex)}
                                            disabled={generatingStates[selectedStoryIndex]}
                                        >
                                            {generatingStates[selectedStoryIndex] ? (
                                                <>
                                                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                                                    Generating Image...
                                                </>
                                            ) : (
                                                <>
                                                    <Wand2 className="w-4 h-4 mr-2" />
                                                    Generate Image
                                                </>
                                            )}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Result Preview (Right Half) */}
                            <div className="flex-1 bg-black/40 rounded-xl border border-white/10 p-1 flex items-center justify-center relative overflow-hidden group">
                                {getStoryImage(selectedStoryIndex) ? (
                                    <>
                                        {/* eslint-disable-next-line @next/next/no-img-element */}
                                        <img
                                            src={getStoryImage(selectedStoryIndex)}
                                            alt="Generated"
                                            className="w-full h-full object-contain rounded-lg shadow-2xl"
                                        />
                                        <div className="absolute top-4 right-4 flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                            <Button size="icon" variant="secondary" onClick={() => window.open(getStoryImage(selectedStoryIndex), '_blank')}>
                                                <Maximize2 className="w-4 h-4" />
                                            </Button>
                                            <Button
                                                size="icon"
                                                variant="secondary"
                                                onClick={() => downloadImage(getStoryImage(selectedStoryIndex), selectedStoryIndex)}
                                                title="Download Image"
                                            >
                                                <Download className="w-4 h-4" />
                                            </Button>
                                            <Button size="icon" variant="destructive" onClick={() => updateStoryImage(selectedStoryIndex, '')}>
                                                <Trash2 className="w-4 h-4" />
                                            </Button>
                                        </div>
                                    </>
                                ) : (
                                    <div className="text-center text-white/20">
                                        <ImageIcon className="w-16 h-16 mx-auto mb-4 opacity-20" />
                                        <p>No Image Generated</p>
                                    </div>
                                )}
                            </div>

                        </div>
                    </div>
                </div>
            </div>

            {/* Cost Tracker */}
            <CostTracker />
        </div>
    );
}
