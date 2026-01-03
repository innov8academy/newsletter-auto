'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { CuratedStory, ResearchReport } from '@/lib/types';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import { ResearchPanel } from '@/components/ResearchPanel';
import {
  saveCuratedStories,
  loadCuratedStories,
  saveSelectedIds,
  loadSelectedIds,
  loadResearchReports,
  getApiKey,
  saveApiKey,
  getLastUpdated,
  clearPersistedState,
  loadCustomFeeds,
  saveCustomFeeds,
} from '@/lib/storage';
import { addCost } from '@/lib/cost-tracker';
import { MoveRight, Sparkles, Check, Play, Search, Clock, ExternalLink, BarChart3, Layers, FileText, ListChecks, ArrowRight, RefreshCw, Trash2, Plus, Settings2, X } from 'lucide-react';

interface RSSFeed {
  name: string;
  url: string;
  category: string;
  tier: number;
}

export default function Home() {
  const router = useRouter();
  const [stories, setStories] = useState<CuratedStory[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [apiKey, setApiKey] = useState('');
  const [serverHasKey, setServerHasKey] = useState(false);
  const [showApiInput, setShowApiInput] = useState(false);
  const [progress, setProgress] = useState('');
  const [hasSearched, setHasSearched] = useState(false);
  const [viewingStory, setViewingStory] = useState<CuratedStory | null>(null);
  const [sidebarTab, setSidebarTab] = useState<'queue' | 'research'>('queue');
  const [researchReports, setResearchReports] = useState<ResearchReport[]>([]);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [showClearConfirm, setShowClearConfirm] = useState(false);

  // Custom Feeds State
  const [customFeeds, setCustomFeeds] = useState<RSSFeed[]>([]);
  const [showSourcesDialog, setShowSourcesDialog] = useState(false);
  const [newFeedUrl, setNewFeedUrl] = useState('');
  const [newFeedName, setNewFeedName] = useState('');

  // Stats State
  const [curationStats, setCurationStats] = useState<any>(null);
  const [showStatsDialog, setShowStatsDialog] = useState(false);

  // Load persisted state on mount
  useEffect(() => {
    const savedKey = getApiKey();
    const savedStories = loadCuratedStories();
    const savedIds = loadSelectedIds();
    const savedReports = loadResearchReports();
    const savedTime = getLastUpdated();
    const savedFeeds = loadCustomFeeds();

    if (savedKey) setApiKey(savedKey);
    if (savedStories.length > 0) {
      setStories(savedStories);
      setHasSearched(true);
    }
    if (savedIds.length > 0) setSelectedIds(new Set(savedIds));
    if (savedReports.length > 0) setResearchReports(savedReports);
    if (savedTime) setLastUpdated(savedTime);
    if (savedFeeds.length > 0) setCustomFeeds(savedFeeds);

    // Check if server has API key configured
    fetch('/api/status')
      .then(res => res.json())
      .then(data => {
        if (data.configured) {
          setServerHasKey(true);
        }
      })
      .catch(err => console.error('Failed to check server status', err));
  }, []);

  // Persist stories when they change
  useEffect(() => {
    if (stories.length > 0) {
      saveCuratedStories(stories);
    }
  }, [stories]);

  // Persist selected IDs when they change
  useEffect(() => {
    saveSelectedIds(Array.from(selectedIds));
  }, [selectedIds]);

  // Persist custom feeds
  useEffect(() => {
    saveCustomFeeds(customFeeds);
  }, [customFeeds]);

  function addCustomFeed() {
    if (!newFeedUrl.trim()) return;

    let url = newFeedUrl.trim();
    let name = newFeedName.trim();

    // Auto-convert Reddit URLs
    if (url.includes('reddit.com/r/') && !url.includes('.rss')) {
      // Remove trailing slash if present
      url = url.replace(/\/$/, '');
      // If it doesn't have /hot or /top, default to /top
      if (!url.endsWith('/top') && !url.endsWith('/hot') && !url.endsWith('/new')) {
        url += '/top';
      }
      url += '/.rss?t=day';

      if (!name) {
        const match = url.match(/r\/([^/]+)/);
        if (match) name = `r/${match[1]}`;
      }
    }

    if (!name) name = new URL(url).hostname;

    const newFeed: RSSFeed = {
      name,
      url,
      category: 'custom',
      tier: 4
    };

    setCustomFeeds([...customFeeds, newFeed]);
    setNewFeedUrl('');
    setNewFeedName('');
  }

  function removeCustomFeed(index: number) {
    const newFeeds = [...customFeeds];
    newFeeds.splice(index, 1);
    setCustomFeeds(newFeeds);
  }

  async function findNews() {
    // We allow empty apiKey here because the server might have it in env vars

    setLoading(true);
    setProgress('Starting curation engine...');
    setHasSearched(true);

    // Simulate progressive loading steps for UX
    setTimeout(() => setProgress(`Scanning default + ${customFeeds.length} custom sources...`), 1000);
    setTimeout(() => setProgress('Extracting key narratives...'), 2500);
    setTimeout(() => setProgress('Scoring importance & impact...'), 4000);

    try {
      const response = await fetch('/api/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, customFeeds }),
      });

      const data = await response.json();

      if (data.success) {
        setStories(data.stories);
        if (data.stats) setCurationStats(data.stats);
        setProgress(`Curated ${data.stories.length} high-impact stories`);

        // Track cost
        if (data.cost) {
          addCost({
            source: data.costSource || 'curate',
            model: data.model || 'google/gemini-2.0-flash-001',
            cost: data.cost,
            description: `Curated ${data.stories.length} stories from ${data.stats?.sourcesAnalyzed || 'multiple'} sources`,
          });
        }
      } else {
        if (data.error === 'API key required') {
          setShowApiInput(true);
        }
        setProgress(`Error: ${data.error}`);
      }
    } catch (error) {
      setProgress('Failed to connect to curation engine');
    } finally {
      setLoading(false);
    }
  }

  function toggleSelect(story: CuratedStory) {
    setSelectedIds(prev => {
      const newSet = new Set(prev);
      if (newSet.has(story.id)) {
        newSet.delete(story.id);
      } else {
        newSet.add(story.id);
      }
      return newSet;
    });
  }

  function handleSaveApiKey() {
    saveApiKey(apiKey);
    setShowApiInput(false);
  }

  function goToResearchPage() {
    // Persist current state before navigating
    saveCuratedStories(stories);
    saveSelectedIds(Array.from(selectedIds));
    router.push('/research');
  }

  function handleClearAll() {
    clearPersistedState();
    setStories([]);
    setSelectedIds(new Set());
    setResearchReports([]);
    setHasSearched(false);
    setShowClearConfirm(false);
    setCustomFeeds([]); // Also clear custom feeds? Maybe keep them? Let's clear for "Clear All" semantic.
  }

  const selectedItems = stories.filter(s => selectedIds.has(s.id));

  // Premium Empty State - Editorial Noir
  if (!hasSearched && stories.length === 0) {
    return (
      <div className="min-h-screen bg-[#0B0B0F] text-white selection:bg-amber-500/20 overflow-hidden relative noise-overlay">
        {/* Atmospheric gradient */}
        <div className="absolute inset-0 bg-gradient-to-b from-amber-900/5 via-transparent to-transparent pointer-events-none"></div>
        <div className="absolute top-0 right-0 w-1/2 h-1/2 bg-gradient-radial from-coral-500/5 to-transparent pointer-events-none blur-3xl"></div>

        {/* Navigation */}
        <nav className="relative z-10 flex items-center justify-between px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg overflow-hidden shadow-glow-amber-sm">
              <Image src="/logo.jpg" alt="Innov8 AI" width={40} height={40} className="object-cover" />
            </div>
            <span className="font-display text-xl tracking-tight text-white/90">Innov8 AI</span>
          </div>
          <div className="flex gap-4">
            <Dialog open={showSourcesDialog} onOpenChange={setShowSourcesDialog}>
              <DialogTrigger asChild>
                <Button variant="ghost" className="text-white/50 hover:text-white hover:bg-white/5">
                  <Settings2 className="w-4 h-4 mr-2" />
                  Manage Sources
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#0B0B0F] border border-white/10 text-white max-w-md">
                <DialogHeader>
                  <DialogTitle>Manage Sources</DialogTitle>
                  <DialogDescription>Add custom RSS feeds or Subreddits</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-4">
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="URL (e.g. reddit.com/r/LocalLLaMA)"
                        value={newFeedUrl}
                        onChange={(e) => setNewFeedUrl(e.target.value)}
                        className="bg-white/5 border-white/10"
                      />
                      <Input
                        placeholder="Name (Optional)"
                        value={newFeedName}
                        onChange={(e) => setNewFeedName(e.target.value)}
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <Button onClick={addCustomFeed} className="bg-amber-500 text-black h-auto">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {customFeeds.length === 0 && (
                      <p className="text-white/30 text-center text-sm py-4">No custom sources added</p>
                    )}
                    {customFeeds.map((feed, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded bg-white/5 border border-white/5">
                        <div className="overflow-hidden">
                          <p className="font-medium text-sm truncate">{feed.name}</p>
                          <p className="text-xs text-white/40 truncate">{feed.url}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCustomFeed(i)}
                          className="hover:text-coral-500"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            {/* Only show Connect button if NO key is present (client or server) */}
            {(apiKey || serverHasKey) ? (
              <div className="flex items-center gap-2 text-xs text-teal-400 bg-teal-400/10 border border-teal-400/20 px-3 py-1.5 rounded-full">
                <div className="w-1.5 h-1.5 rounded-full bg-teal-400 animate-pulse"></div>
                System Online
              </div>
            ) : (
              <Button
                variant="ghost"
                className="text-white/50 hover:text-amber-400 hover:bg-white/5 transition-all text-sm font-medium tracking-wide"
                onClick={() => setShowApiInput(!showApiInput)}
              >
                Connect API
              </Button>
            )}
          </div>
        </nav>

        {/* API Input Overlay - Only usable if user explicitly wants to override or connect */}
        <Dialog open={showApiInput} onOpenChange={setShowApiInput}>
          <DialogContent className="bg-[#0B0B0F] border border-white/10 text-white max-w-sm">
            <DialogHeader>
              <DialogTitle>Connect API (Optional)</DialogTitle>
              <DialogDescription>
                Enter your OpenRouter key manually, or leave blank if you set it on the server.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 pt-2">
              <div className="space-y-2">
                <label className="text-xs uppercase tracking-wider text-white/50 font-medium block">API Key</label>
                <Input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-or-..."
                  className="bg-black/40 border-white/10"
                />
              </div>
              <div className="flex gap-2 justify-end">
                <Button variant="ghost" size="sm" onClick={() => setShowApiInput(false)}>Cancel</Button>
                <Button size="sm" className="bg-amber-500 text-black hover:bg-amber-600" onClick={handleSaveApiKey}>Save Key</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* Hero Section */}
        <main className="relative z-10 flex flex-col items-center justify-center h-[calc(100vh-100px)] text-center px-4">
          {/* Art deco decorative lines */}
          <div className="absolute top-1/4 left-8 w-px h-32 bg-gradient-to-b from-transparent via-amber-500/30 to-transparent"></div>
          <div className="absolute top-1/4 right-8 w-px h-32 bg-gradient-to-b from-transparent via-amber-500/30 to-transparent"></div>

          <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-amber-500/10 border border-amber-500/20 text-xs font-medium text-amber-400 mb-10 animate-in-up" style={{ animationDelay: '0.1s' }}>
            <Sparkles className="w-3.5 h-3.5" />
            <span className="tracking-wide uppercase">AI-Powered Curation</span>
          </div>

          <h1 className="font-display text-6xl md:text-8xl font-semibold tracking-tight mb-8 text-gradient-editorial leading-[0.95] animate-in-up" style={{ animationDelay: '0.2s' }}>
            Uncover the<br />
            <span className="text-gradient-warm">Signal</span> in the Noise.
          </h1>

          <p className="text-lg md:text-xl text-white/40 max-w-2xl mx-auto mb-12 leading-relaxed font-light animate-in-up" style={{ animationDelay: '0.3s' }}>
            Analyze thousands of newsletters and articles instantly.
            <br className="hidden md:block" />
            Curate high-impact stories with human-level understanding.
          </p>

          <div className="animate-in-up" style={{ animationDelay: '0.4s' }}>
            <Button
              size="lg"
              onClick={findNews}
              disabled={loading}
              className="h-14 px-10 rounded-full bg-gradient-to-r from-amber-500 to-coral-500 hover:from-amber-400 hover:to-coral-400 text-[#0B0B0F] font-semibold text-base shadow-glow-amber transition-all duration-300 hover:shadow-glow-amber hover:scale-[1.02]"
            >
              {loading ? (
                <span className="flex items-center gap-2">
                  <div className="w-4 h-4 border-2 border-black/30 border-t-black rounded-full animate-spin"></div>
                  Analyzing...
                </span>
              ) : (
                <span className="flex items-center gap-2">
                  <Search className="w-4 h-4" />
                  Find Today's News
                </span>
              )}
            </Button>
          </div>

          {/* Custom Feeds Indicator if any */}
          {customFeeds.length > 0 && (
            <p className="absolute bottom-32 text-xs text-white/30 animate-in-up" style={{ animationDelay: '0.5s' }}>
              Including {customFeeds.length} custom source{customFeeds.length !== 1 && 's'}
            </p>
          )}

          {/* Bottom decorative element */}
          <div className="absolute bottom-12 left-1/2 -translate-x-1/2 flex items-center gap-4 text-white/20 text-xs tracking-widest uppercase">
            <div className="w-12 h-px bg-gradient-to-r from-transparent to-white/20"></div>
            <span>Scroll to explore</span>
            <div className="w-12 h-px bg-gradient-to-l from-transparent to-white/20"></div>
          </div>
        </main>
      </div>
    );
  }

  // Dashboard View - Editorial Noir
  return (
    <div className="min-h-screen bg-[#0B0B0F] text-white selection:bg-amber-500/20 font-sans noise-overlay">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-white/5 bg-[#0B0B0F]/80 backdrop-blur-xl">
        <div className="container flex h-16 items-center justify-between px-6">
          <div className="flex items-center gap-4">
            <div className="h-9 w-9 rounded-lg overflow-hidden">
              <Image src="/logo.jpg" alt="Innov8 AI" width={36} height={36} className="object-cover" />
            </div>
            <span className="font-display text-lg text-white/90">Innov8 AI</span>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2 text-xs text-white/40 px-3 py-1.5 rounded-full bg-white/5 border border-white/5">
              <span className="w-2 h-2 rounded-full bg-teal-400 animate-pulse"></span>
              API Connected
            </div>

            <Dialog open={showSourcesDialog} onOpenChange={setShowSourcesDialog}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-white/40 hover:text-white hover:bg-white/5">
                  <Settings2 className="w-4 h-4" />
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#0B0B0F] border border-white/10 text-white max-w-md">
                <DialogHeader>
                  <DialogTitle>Manage Sources</DialogTitle>
                  <DialogDescription>Add custom RSS feeds or Subreddits</DialogDescription>
                </DialogHeader>

                <div className="space-y-4 pt-4">
                  <div className="flex gap-2">
                    <div className="flex-1 space-y-2">
                      <Input
                        placeholder="URL (e.g. reddit.com/r/LocalLLaMA)"
                        value={newFeedUrl}
                        onChange={(e) => setNewFeedUrl(e.target.value)}
                        className="bg-white/5 border-white/10"
                      />
                      <Input
                        placeholder="Name (Optional)"
                        value={newFeedName}
                        onChange={(e) => setNewFeedName(e.target.value)}
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <Button onClick={addCustomFeed} className="bg-amber-500 text-black h-auto">
                      <Plus className="w-4 h-4" />
                    </Button>
                  </div>

                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {customFeeds.length === 0 && (
                      <p className="text-white/30 text-center text-sm py-4">No custom sources added</p>
                    )}
                    {customFeeds.map((feed, i) => (
                      <div key={i} className="flex items-center justify-between p-3 rounded bg-white/5 border border-white/5">
                        <div className="overflow-hidden">
                          <p className="font-medium text-sm truncate">{feed.name}</p>
                          <p className="text-xs text-white/40 truncate">{feed.url}</p>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => removeCustomFeed(i)}
                          className="hover:text-coral-500"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              </DialogContent>
            </Dialog>

            <Dialog open={showStatsDialog} onOpenChange={setShowStatsDialog}>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className={`text-white/40 hover:text-white hover:bg-white/5 ${!curationStats ? 'hidden' : ''}`}>
                  <BarChart3 className="w-4 h-4 mr-2" />
                  Source Stats
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#0B0B0F] border border-white/10 text-white max-w-2xl max-h-[80vh] overflow-y-auto">
                <DialogHeader>
                  <DialogTitle>Curation Source Breakdown</DialogTitle>
                  <DialogDescription>
                    Total Articles Found: {curationStats?.totalArticlesFound} | Analyzed: {curationStats?.articlesProcessed}
                  </DialogDescription>
                </DialogHeader>
                <div className="pt-4">
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-white/40 uppercase bg-white/5">
                      <tr>
                        <th className="px-4 py-3 rounded-tl-lg">Source</th>
                        <th className="px-4 py-3">Found</th>
                        <th className="px-4 py-3 rounded-tr-lg">Analyzed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {curationStats?.breakdown.map((item: any, i: number) => (
                        <tr key={i} className="hover:bg-white/5">
                          <td className="px-4 py-3 font-medium text-white/80">{item.sourceName}</td>
                          <td className="px-4 py-3 text-white/50">{item.found}</td>
                          <td className="px-4 py-3">
                            {item.kept > 0 ? (
                              <span className="text-teal-400 font-bold">{item.kept}</span>
                            ) : (
                              <span className="text-white/20">-</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </DialogContent>
            </Dialog>

            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowClearConfirm(true)}
              className="text-white/40 hover:text-coral-400 hover:bg-coral-500/10"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Clear All
            </Button>
            <Button
              className="bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/20 hover:border-amber-500/30"
              size="sm"
              onClick={findNews}
              disabled={loading}
            >
              <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
              {loading ? 'Refreshing...' : 'Find News'}
            </Button>
          </div>
        </div>
      </header>

      {loading ? (
        <div className="h-[calc(100vh-64px)] flex flex-col items-center justify-center relative overflow-hidden">
          <div className="absolute inset-0 bg-amber-500/5 blur-3xl animate-pulse-slow"></div>
          <div className="relative z-10 text-center space-y-6">
            <div className="w-24 h-24 mx-auto relative">
              <div className="absolute inset-0 border-4 border-amber-500/20 rounded-full"></div>
              <div className="absolute inset-0 border-4 border-t-amber-500 rounded-full animate-spin"></div>
              <Sparkles className="absolute inset-0 m-auto text-amber-400 w-8 h-8 animate-pulse" />
            </div>
            <div>
              <h2 className="font-display text-2xl text-white mb-2 tracking-tight">Curating your feed</h2>
              <p className="text-white/40 font-mono text-sm">{progress}</p>
            </div>
          </div>
        </div>
      ) : (
        <div className="container px-6 py-8">
          <div className="grid grid-cols-12 gap-8 h-[calc(100vh-140px)]">
            {/* Main Feed */}
            <div className="col-span-8 flex flex-col h-full">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="font-display text-2xl text-white tracking-tight flex items-center gap-3">
                    Top Stories
                    <span className="text-sm font-sans font-normal text-white/40 bg-white/5 px-2.5 py-0.5 rounded-full border border-white/5">
                      {stories.length} items
                    </span>
                  </h2>
                </div>
                <div className="flex gap-4 text-xs text-white/40">
                  <span className="flex items-center gap-1.5 cursor-help hover:text-white transition-colors">
                    <div className="w-2 h-2 bg-coral-500 rounded-full"></div> Critical
                  </span>
                  <span className="flex items-center gap-1.5 cursor-help hover:text-white transition-colors">
                    <div className="w-2 h-2 bg-amber-500 rounded-full"></div> Important
                  </span>
                </div>
              </div>

              <ScrollArea className="flex-1 -mr-6 pr-6">
                <div className="space-y-3 pb-20">
                  {stories.map((story, index) => (
                    <div
                      key={story.id}
                      onClick={() => setViewingStory(story)}
                      className={`group relative overflow-hidden rounded-xl border p-5 transition-all duration-300 cursor-pointer hover-lift ${selectedIds.has(story.id)
                        ? 'bg-amber-500/10 border-amber-500/30 shadow-glow-amber-sm'
                        : 'bg-surface border-white/5 hover:bg-surface-elevated hover:border-white/10'
                        }`}
                      style={{ animationDelay: `${index * 0.05}s` }}
                    >
                      {/* Accent border on selected */}
                      {selectedIds.has(story.id) && (
                        <div className="absolute left-0 top-0 bottom-0 w-1 bg-gradient-to-b from-amber-400 to-coral-500"></div>
                      )}

                      <div className="flex gap-5">
                        {/* Score Indicator */}
                        <div className="shrink-0">
                          <div className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center border font-mono font-bold text-lg ${story.finalScore >= 9 ? 'bg-coral-500/20 border-coral-500/30 text-coral-400' :
                            story.finalScore >= 7 ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' :
                              'bg-white/5 border-white/10 text-white/60'
                            }`}>
                            {story.finalScore}
                          </div>
                        </div>

                        {/* Content */}
                        <div className="flex-1 min-w-0 pt-0.5">
                          <h3 className="text-base font-semibold text-white/90 leading-snug mb-2 group-hover:text-amber-300 transition-colors">
                            {story.headline}
                          </h3>
                          <p className="text-sm text-white/50 line-clamp-2 mb-3 font-light leading-relaxed">
                            {story.summary}
                          </p>

                          <div className="flex flex-wrap items-center gap-3">
                            <Badge variant="outline" className="bg-transparent border-white/10 text-white/50 hover:text-white transition-colors text-xs font-normal">
                              {story.category.replace('_', ' ')}
                            </Badge>

                            {story.crossSourceCount > 1 && (
                              <div className="flex items-center gap-1.5 text-xs text-white/40">
                                <Layers className="w-3 h-3" />
                                {story.crossSourceCount} sources
                              </div>
                            )}

                            {story.boosts.includes('+1 (recent)') && (
                              <div className="flex items-center gap-1.5 text-xs text-teal-400/80">
                                <Clock className="w-3 h-3" />
                                Fresh
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Action Area */}
                        <div className="shrink-0 flex flex-col justify-start items-end gap-2">
                          <Button
                            size="icon"
                            variant="ghost"
                            className={`rounded-full w-10 h-10 transition-all duration-300 ${selectedIds.has(story.id)
                              ? 'bg-amber-500 text-[#0B0B0F] hover:bg-amber-600'
                              : 'bg-white/5 text-white/30 hover:text-amber-400 hover:bg-white/10'
                              }`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleSelect(story);
                            }}
                          >
                            {selectedIds.has(story.id) ? <Check className="w-5 h-5" /> : <MoveRight className="w-5 h-5" />}
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            {/* Sidebar (Research Queue / Research Panel) */}
            <div className="col-span-4 h-full flex flex-col pt-14">
              <div className="sticky top-24 bg-surface/80 backdrop-blur-xl border border-white/10 transition-all duration-300 rounded-2xl flex flex-col p-6 h-[600px] deco-corner-br">
                {/* Tab Navigation */}
                <div className="flex gap-1 p-1 bg-black/30 rounded-lg mb-4">
                  <button
                    onClick={() => setSidebarTab('queue')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${sidebarTab === 'queue'
                      ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                      : 'text-white/40 hover:text-white/60'
                      }`}
                  >
                    <ListChecks className="w-4 h-4" />
                    Queue
                    {selectedItems.length > 0 && (
                      <span className="bg-amber-500/20 text-amber-300 text-xs px-1.5 py-0.5 rounded-full">
                        {selectedItems.length}
                      </span>
                    )}
                  </button>
                  <button
                    onClick={() => setSidebarTab('research')}
                    className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-md text-sm font-medium transition-all ${sidebarTab === 'research'
                      ? 'bg-teal-500/10 text-teal-400 border border-teal-500/20'
                      : 'text-white/40 hover:text-white/60'
                      }`}
                  >
                    <FileText className="w-4 h-4" />
                    Research
                    {researchReports.length > 0 && (
                      <span className="bg-teal-500/20 text-teal-300 text-xs px-1.5 py-0.5 rounded-full">
                        {researchReports.length}
                      </span>
                    )}
                  </button>
                </div>

                {/* Queue Tab Content */}
                {sidebarTab === 'queue' && (
                  <>
                    {selectedItems.length === 0 ? (
                      <div className="flex-1 flex flex-col items-center justify-center text-center p-4 border-2 border-dashed border-white/5 rounded-xl">
                        <div className="w-12 h-12 rounded-full bg-white/5 flex items-center justify-center mb-3">
                          <Layers className="w-5 h-5 text-white/20" />
                        </div>
                        <p className="text-sm text-white/40 font-light">
                          Select stories to verify facts <br />and generate content.
                        </p>
                      </div>
                    ) : (
                      <>
                        <ScrollArea className="flex-1 -mr-2 pr-2">
                          <div className="space-y-2">
                            {selectedItems.map((story, i) => (
                              <div key={story.id} className="group flex items-start gap-3 p-3 rounded-lg hover:bg-white/5 transition-colors border border-transparent hover:border-white/5 cursor-default relative">
                                <span className="text-amber-500/60 text-xs font-mono mt-1 w-4 text-right">{i + 1}</span>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm text-white/80 line-clamp-2 leading-snug">{story.headline}</p>
                                </div>
                                <button
                                  onClick={() => toggleSelect(story)}
                                  className="absolute right-2 top-2 opacity-0 group-hover:opacity-100 text-white/20 hover:text-coral-400 transition-all"
                                >
                                  <span className="sr-only">Remove</span>
                                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                                </button>
                              </div>
                            ))}
                          </div>
                        </ScrollArea>
                        <div className="pt-4 mt-4 border-t border-white/5">
                          <Button
                            onClick={goToResearchPage}
                            className="w-full bg-gradient-to-r from-amber-500 to-coral-500 hover:from-amber-400 hover:to-coral-400 text-[#0B0B0F] h-11 font-semibold text-sm border-0 shadow-glow-amber-sm"
                          >
                            <Sparkles className="w-4 h-4 mr-2" />
                            Open Research Lab
                            <ArrowRight className="w-4 h-4 ml-2" />
                          </Button>
                        </div>
                      </>
                    )}
                  </>
                )}

                {/* Research Tab Content */}
                {sidebarTab === 'research' && (
                  <ResearchPanel
                    selectedStories={selectedItems}
                    apiKey={apiKey}
                    onReportGenerated={(report) => {
                      setResearchReports(prev => {
                        // Avoid duplicates
                        if (prev.find(r => r.story.id === report.story.id)) {
                          return prev.map(r => r.story.id === report.story.id ? report : r);
                        }
                        return [...prev, report];
                      });
                    }}
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Modern Detail View */}
      <Dialog open={!!viewingStory} onOpenChange={(open) => !open && setViewingStory(null)}>
        <DialogContent className="max-w-2xl max-h-[90vh] bg-[#0B0B0F] border border-white/10 text-white p-0 overflow-hidden shadow-2xl">
          {viewingStory && (
            <div className="relative overflow-y-auto max-h-[90vh]">
              {/* Accessibility Title (Hidden) */}
              <DialogHeader className="sr-only">
                <DialogTitle>{viewingStory.headline}</DialogTitle>
                <DialogDescription>Detailed view of the news story</DialogDescription>
              </DialogHeader>

              {/* Gradient Header */}
              <div className="h-32 bg-gradient-to-br from-amber-900/30 via-surface to-surface-elevated p-8 relative noise-overlay deco-corner-tl">
                <Badge variant="outline" className="bg-black/30 backdrop-blur border-amber-500/30 text-amber-400 mb-4">
                  {viewingStory.category.replace('_', ' ')}
                </Badge>
              </div>

              <div className="p-8 -mt-12 relative z-10">
                <h2 className="font-display text-2xl font-semibold leading-tight mb-4 text-white tracking-tight">
                  {viewingStory.headline}
                </h2>

                <div className="flex items-center gap-4 mb-8 text-sm text-white/40">
                  <div className="flex items-center gap-1.5">
                    <Clock className="w-4 h-4" />
                    {new Date(viewingStory.publishedAt).toLocaleDateString()}
                  </div>
                  <div className="w-1 h-1 rounded-full bg-white/20"></div>
                  <div className="flex items-center gap-1.5">
                    <Layers className="w-4 h-4" />
                    {viewingStory.sources.length} sources
                  </div>
                </div>

                <div className="space-y-6">
                  <div className="bg-surface rounded-xl p-6 border border-white/5 border-accent-left">
                    <h3 className="text-sm uppercase tracking-wider text-white/40 font-semibold mb-3 flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-amber-400" />
                      Analysis
                    </h3>
                    <p className="text-base text-white/80 leading-relaxed font-light">
                      {viewingStory.summary}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-6">
                    <div>
                      <h4 className="text-sm font-medium text-white/60 mb-2">Sources</h4>
                      <ul className="space-y-1">
                        {viewingStory.sources.map(s => (
                          <li key={s} className="text-sm text-white/40 flex items-center gap-2">
                            <div className="w-1 h-1 bg-amber-500/50 rounded-full"></div>
                            {s}
                          </li>
                        ))}
                      </ul>
                    </div>
                    <div>
                      <h4 className="text-sm font-medium text-white/60 mb-2">Impact Drivers</h4>
                      <ul className="space-y-1">
                        {viewingStory.boosts.map((b, i) => (
                          <li key={i} className="text-sm text-teal-400/80 flex items-center gap-2">
                            <Check className="w-3 h-3" />
                            {b}
                          </li>
                        ))}
                      </ul>
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 mt-8 pt-8 border-t border-white/5">
                  <Button
                    className={`flex-1 h-12 text-base font-semibold transition-all ${selectedIds.has(viewingStory.id)
                      ? 'bg-teal-500 hover:bg-teal-600 text-[#0B0B0F]'
                      : 'bg-gradient-to-r from-amber-500 to-coral-500 hover:from-amber-400 hover:to-coral-400 text-[#0B0B0F]'
                      }`}
                    onClick={() => {
                      if (!selectedIds.has(viewingStory.id)) {
                        toggleSelect(viewingStory);
                      }
                      setViewingStory(null);
                    }}
                  >
                    {selectedIds.has(viewingStory.id) ? (
                      <>
                        <Check className="w-4 h-4 mr-2" /> Added to Queue
                      </>
                    ) : (
                      'Add to Research Queue'
                    )}
                  </Button>
                  {viewingStory.originalUrl && (
                    <Button variant="outline" className="h-12 border-white/10 text-white/70 hover:bg-white/5 font-normal" asChild>
                      <a href={viewingStory.originalUrl} target="_blank" rel="noopener noreferrer">
                        Original <ExternalLink className="w-4 h-4 ml-2 opacity-50" />
                      </a>
                    </Button>
                  )}
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Clear All Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-md bg-[#0B0B0F] border border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-coral-400" />
              Clear All Data?
            </DialogTitle>
            <DialogDescription className="text-white/60">
              This will permanently delete all your curated stories, research reports, and selections. You'll return to the landing page to start fresh.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="flex gap-3 mt-4">
            <Button
              variant="ghost"
              onClick={() => setShowClearConfirm(false)}
              className="flex-1 text-white/60 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
            <Button
              onClick={handleClearAll}
              className="flex-1 bg-coral-500 hover:bg-coral-600 text-white font-semibold"
            >
              <Trash2 className="w-4 h-4 mr-2" />
              Yes, Clear Everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
