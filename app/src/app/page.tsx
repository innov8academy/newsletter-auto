'use client';
import { scoreLabel } from '@/lib/news-score';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { CuratedStory, ResearchReport, FeedHealth } from '@/lib/types';
import { currentNews, isFreshNews } from '@/lib/news-freshness';
import { newsSimilarity, canonicalNewsUrl } from '@/lib/news-identity';
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
import BeehiveImporter from '@/components/BeehiveImporter';
import { useSharedSession } from '@/components/SharedSessionProvider';

import {
  getApiKey,
  saveApiKey,
  clearShownHeadlines,
  MAX_NEWSLETTER_STORIES,
  loadCustomFeeds,
  saveCustomFeeds,
} from '@/lib/storage';
import { addCost } from '@/lib/cost-tracker';
import { MoveRight, Sparkles, Check, Play, Search, Clock, ExternalLink, BarChart3, Layers, FileText, ListChecks, ArrowRight, RefreshCw, Trash2, Plus, Settings2, X, Heart, Repeat2 } from 'lucide-react';

function formatCount(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

function getSourceBadge(method: string): { label: string; color: string } {
  switch (method) {
    case 'news_api': return { label: 'News', color: 'bg-blue-500/20 text-blue-300 border-blue-500/30' };
    case 'community': return { label: 'Community', color: 'bg-purple-500/20 text-purple-300 border-purple-500/30' };
    case 'context_search': return { label: 'Tech', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' };
    default: return { label: 'Trending', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' };
  }
}

interface RSSFeed {
  name: string;
  url: string;
  category: string;
  tier: number;
}

export default function Home() {
  const router = useRouter();
  const { client: sharedClient, snapshot: sharedSnapshot } = useSharedSession();
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

  // X/Twitter News State
  const [xNews, setXNews] = useState<any[]>([]);
  const [xLoading, setXLoading] = useState(false);

  // Research directions per story (lifted from ResearchPanel so cards can set it)
  const [directions, setDirections] = useState<Record<string, string>>({});

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
    const savedFeeds = loadCustomFeeds();

    if (savedKey) setApiKey(savedKey);
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

    // Load X news from Supabase
    fetchXNews();
  }, []);

  // The server session, including an empty one, is authoritative for this page.
  useEffect(() => {
    const shared = sharedSnapshot.state;
    if (!shared) return;
    setStories(currentNews(shared.curatedStories, shared.selectedIds));
    setSelectedIds(new Set(shared.selectedIds));
    setResearchReports(shared.researchReports);
    setHasSearched(shared.curatedStories.length > 0);
    setLastUpdated(shared.updatedAt ? new Date(shared.updatedAt) : null);
  }, [sharedSnapshot.state]);

  async function fetchXNews(refresh = false) {
    setXLoading(true);
    try {
      const res = await fetch('/api/x-news', refresh
        ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) }
        : {});
      if (res.ok) {
        const data = await res.json();
        const newItems = data.items || [];
        
        // Always deduplicate by normalized title
        const normalize = (t: string) => t?.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 60) || '';
        
        // ALWAYS replace with fresh data — never accumulate old items
        const seen = new Set<string>();
        setXNews(newItems.filter((i: any) => {
          const key = normalize(i.title);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }));
      }
    } catch (e) {
      console.error('Failed to fetch X news', e);
    } finally {
      setXLoading(false);
    }
  }

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

    const startedSessionId = sharedClient.getSnapshot().state?.sessionId;
    if (!startedSessionId || !await sharedClient.waitForSaved()) {
      setProgress('Save or resolve the cloud warning before finding news.'); return;
    }
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
        if (sharedClient.getSnapshot().state?.sessionId !== startedSessionId) {
          setProgress('The shared newsletter changed while news was being found. Start again from the latest session.');
          return;
        }
        const current = sharedClient.getSnapshot().state!;
        const existing = currentNews(current.curatedStories, current.selectedIds);
        const added: CuratedStory[] = [];
        for (const candidate of data.stories as CuratedStory[]) {
          const url = canonicalNewsUrl(candidate.originalUrl);
          if ([...existing, ...added].some(saved => saved.id === candidate.id ||
              (url && canonicalNewsUrl(saved.originalUrl) === url) ||
              newsSimilarity(saved.headline, candidate.headline) > 0.6)) continue;
          added.push(candidate);
        }
        const merged = currentNews([...existing, ...added], current.selectedIds);
        sharedClient.mutate({ curatedStories: merged });
        setStories(merged);
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
      setProgress(error instanceof Error ? error.message : 'Failed to connect to curation engine');
    } finally {
      setLoading(false);
    }
  }

  function selectXItem(item: any) {
    // Convert X item to CuratedStory format and add to stories + selection
    // The full tweet text goes in summary — researcher uses this content + headline to search
    const xStory: CuratedStory = {
      id: `x_${item.id}`,
      headline: item.title,
      summary: item.summary || item.title,
      category: 'x_twitter',
      baseScore: 7,
      finalScore: 7,
      entities: [],
      originalUrl: item.url,
      sources: [`X: @${item.author}`],
      publishedAt: item.publishedAt || new Date().toISOString(),
      crossSourceCount: 1,
      boosts: [],
    };

    const current = sharedClient.getSnapshot().state;
    if (!current) return;
    const nextIds = new Set(current.selectedIds);
    if (nextIds.has(xStory.id)) nextIds.delete(xStory.id);
    else {
      if (nextIds.size >= MAX_NEWSLETTER_STORIES) {
        setProgress(`A newsletter can contain at most ${MAX_NEWSLETTER_STORIES} stories.`);
        return;
      }
      nextIds.add(xStory.id);
    }
    const nextStories = current.curatedStories.some(story => story.id === xStory.id)
      ? current.curatedStories : [xStory, ...current.curatedStories];
    try {
      sharedClient.mutate({ curatedStories: nextStories, selectedIds: [...nextIds] });
      setStories(nextStories);
      setSelectedIds(nextIds);
    } catch (error) {
      setProgress(error instanceof Error ? error.message : 'Could not update the shared queue.');
    }
  }

  function toggleSelect(story: CuratedStory) {
    const current = sharedClient.getSnapshot().state;
    if (!current) return;
    const nextIds = new Set(current.selectedIds);
    if (nextIds.has(story.id)) nextIds.delete(story.id);
    else {
      if (nextIds.size >= MAX_NEWSLETTER_STORIES) {
        setProgress(`A newsletter can contain at most ${MAX_NEWSLETTER_STORIES} stories.`);
        return;
      }
      nextIds.add(story.id);
    }
    try {
      sharedClient.mutate({ selectedIds: [...nextIds] });
      setSelectedIds(nextIds);
    } catch (error) {
      setProgress(error instanceof Error ? error.message : 'Could not update the shared queue.');
    }
  }

  function handleSaveApiKey() {
    saveApiKey(apiKey);
    setShowApiInput(false);
  }

  async function goToResearchPage() {
    const saved = await sharedClient.waitForSaved();
    if (saved) router.push('/research');
    else setProgress('Save the shared newsletter or resolve its warning before continuing.');
  }

  function handleClearAll() {
    try {
      sharedClient.reset();
    } catch (error) {
      setProgress(error instanceof Error ? error.message : 'Could not clear the shared newsletter.');
      return;
    }
    clearShownHeadlines();
    setStories([]);
    setSelectedIds(new Set());
    setResearchReports([]);
    setCurationStats(null);
    setLastUpdated(null);
    setHasSearched(false);
    setShowClearConfirm(false);
  }

  // Find MORE news without clearing existing selections
  async function findMoreNews() {
    if (!await sharedClient.waitForSaved()) {
      setProgress('Save or resolve the shared newsletter warning before finding more news.');
      return;
    }
    const startedSessionId = sharedClient.getSnapshot().state?.sessionId;
    setLoading(true);
    setProgress('Finding more stories...');

    try {
      // Pass existing headlines so the backend can exclude already-shown stories
      const excludeHeadlines = stories.map(s => s.headline);

      const response = await fetch('/api/curate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey, customFeeds, excludeHeadlines }),
      });

      const data = await response.json();

      if (data.success) {
        const current = sharedClient.getSnapshot().state;
        if (!current || current.sessionId !== startedSessionId) {
          setProgress('The shared newsletter changed while news was being found. Start again from the latest session.');
          return;
        }
        const currentStories = currentNews(current.curatedStories, current.selectedIds);
        // Merge new stories with existing, avoiding duplicates by ID
        const existingIds = new Set(currentStories.map(s => s.id));
        const newStories = data.stories.filter((s: CuratedStory) => !existingIds.has(s.id));

        if (newStories.length > 0) {
          // Also filter by headline similarity to avoid near-duplicates
          const existingHeadlines = currentStories.map(s => s.headline.toLowerCase());
          const trulyNew = newStories.filter((s: CuratedStory) => {
            const normalized = s.headline.toLowerCase();
            const url = canonicalNewsUrl(s.originalUrl);
            if (url && currentStories.some(existing => canonicalNewsUrl(existing.originalUrl) === url)) return false;
            return !existingHeadlines.some(h => {
              const similarity = calculateHeadlineSimilarity(normalized, h);
              return similarity > 0.6;
            });
          });

          const merged = currentNews([...currentStories, ...trulyNew], current.selectedIds);
          sharedClient.mutate({ curatedStories: merged });
          setStories(merged);
          setProgress(`Found ${trulyNew.length} new stories`);
        } else {
          const fresh = currentNews(currentStories, current.selectedIds);
          sharedClient.mutate({ curatedStories: fresh });
          setStories(fresh);
          setProgress('No new stories found');
        }

        if (data.stats) setCurationStats(data.stats);
      } else {
        setProgress(`Error: ${data.error}`);
      }
    } catch (error) {
      setProgress(error instanceof Error ? error.message : 'Failed to find more news');
    } finally {
      setLoading(false);
    }
  }

  // Simple headline similarity check
  function calculateHeadlineSimilarity(a: string, b: string): number {
    return newsSimilarity(a, b);
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
                        aria-label="Source feed URL" placeholder="URL (e.g. reddit.com/r/LocalLLaMA)"
                        value={newFeedUrl}
                        onChange={(e) => setNewFeedUrl(e.target.value)}
                        className="bg-white/5 border-white/10"
                      />
                      <Input
                        aria-label="Source name (optional)" placeholder="Name (Optional)"
                        value={newFeedName}
                        onChange={(e) => setNewFeedName(e.target.value)}
                        className="bg-white/5 border-white/10"
                      />
                    </div>
                    <Button aria-label="Add news source" onClick={addCustomFeed} className="bg-amber-500 text-black h-auto">
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
                Provider key configured
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
            Find recent stories across your configured news sources.
            <br className="hidden md:block" />
            Review the signals, choose stories, then hand off the saved draft.
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
        <div className="container flex flex-wrap min-h-16 items-center justify-between gap-3 px-4 sm:px-6 py-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <div className="h-9 w-9 rounded-lg overflow-hidden">
              <Image src="/logo.jpg" alt="Innov8 AI" width={36} height={36} className="object-cover" />
            </div>
            <span className="font-display text-lg text-white/90">Innov8 AI</span>
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-4">
            <button
              onClick={() => setShowApiInput(true)}
              className="flex items-center gap-2 text-xs text-white/40 px-3 py-1.5 rounded-full bg-white/5 border border-white/5 hover:border-amber-500/30 hover:text-amber-400 transition-all cursor-pointer"
            >
              <span className={`w-2 h-2 rounded-full ${(apiKey || serverHasKey) ? 'bg-teal-400 animate-pulse' : 'bg-coral-400'}`}></span>
              {(apiKey || serverHasKey) ? 'Key configured' : 'Connect API'}
            </button>

            <Dialog open={showSourcesDialog} onOpenChange={setShowSourcesDialog}>
              <DialogTrigger asChild>
                <Button aria-label="Manage news sources" variant="ghost" size="sm" className="text-white/60 hover:text-white hover:bg-white/5">
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
                        aria-label="Source feed URL" placeholder="URL (e.g. reddit.com/r/LocalLLaMA)"
                        value={newFeedUrl}
                        onChange={(e) => setNewFeedUrl(e.target.value)}
                        className="bg-white/5 border-white/10"
                      />
                      <Input
                        aria-label="Source name (optional)" placeholder="Name (Optional)"
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

            {/* TRAIN AI BUTTON (RAG) */}
            <Dialog>
              <DialogTrigger asChild>
                <Button variant="ghost" size="sm" className="text-white/40 hover:text-purple-400 hover:bg-purple-500/10 transition-colors">
                  <Sparkles className="w-4 h-4 mr-2" />
                  Train Style
                </Button>
              </DialogTrigger>
              <DialogContent className="bg-[#0B0B0F] border border-white/10 text-white max-w-lg">
                <DialogHeader>
                  <DialogTitle>Train Your AI Writer</DialogTitle>
                  <DialogDescription>
                    Upload past newsletters so the AI mimics your voice perfectly.
                  </DialogDescription>
                </DialogHeader>
                <div className="pt-4">
                  <BeehiveImporter />
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
                    Found: {curationStats?.totalArticlesFound} | Analyzed: {curationStats?.articlesProcessed} | Returned: {curationStats?.finalCount ?? stories.length}
                  </DialogDescription>
                </DialogHeader>
                <div className="pt-4">
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-white/35">Mode</p>
                      <p className={`text-sm font-semibold ${curationStats?.curationMode === 'normal' ? 'text-green-400' : curationStats?.curationMode === 'relaxed' ? 'text-yellow-400' : 'text-amber-400'}`}>
                        {curationStats?.curationMode || 'unknown'}
                      </p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-white/35">Excluded</p>
                      <p className="text-sm font-semibold text-coral-300">{curationStats?.excludedCount ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-white/35">Used Filter</p>
                      <p className="text-sm font-semibold text-white/70">{curationStats?.usedStoryFilteredCount ?? 0}</p>
                    </div>
                    <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                      <p className="text-[10px] uppercase tracking-wider text-white/35">Safety Net</p>
                      <p className="text-sm font-semibold text-white/70">{curationStats?.safetyNetRecoveredCount ?? 0}</p>
                    </div>
                  </div>
                  <table className="w-full text-sm text-left">
                    <thead className="text-xs text-white/40 uppercase bg-white/5">
                      <tr>
                        <th className="px-4 py-3 rounded-tl-lg">Source</th>
                        <th className="px-4 py-3">Found</th>
                        <th className="px-4 py-3 rounded-tr-lg">Analyzed</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5">
                      {curationStats?.breakdown?.map((item: any, i: number) => (
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

                  {/* Feed Health Section */}
                  <div className="mt-6">
                    <h3 className="text-sm font-semibold text-white/60 uppercase mb-3">Feed Health</h3>
                    {curationStats?.feedHealth ? (
                      (() => {
                        const failed = curationStats.feedHealth.filter((f: any) => f.status === 'failed');
                        const empty = curationStats.feedHealth.filter((f: any) => f.status === 'empty');
                        const fallback = curationStats.feedHealth.filter((f: FeedHealth) => f.fallbackUsed);
                        const hasIssues = failed.length > 0 || empty.length > 0 || fallback.length > 0;
                        return hasIssues ? (
                          <div className="space-y-2">
                            {fallback.map((f: FeedHealth, i: number) => (
                              <div key={`fallback-${i}`} className="text-xs text-amber-300">{f.name}: {f.error}</div>
                            ))}
                            {failed.map((f: any, i: number) => (
                              <div key={`f-${i}`} className="flex items-center gap-2 text-sm">
                                <span className="w-2 h-2 rounded-full bg-red-500 shrink-0" />
                                <span className="text-red-400">{f.name}</span>
                                <span className="text-white/30 text-xs ml-auto">{f.error || 'Failed'}</span>
                              </div>
                            ))}
                            {empty.map((f: any, i: number) => (
                              <div key={`e-${i}`} className="flex items-center gap-2 text-sm">
                                <span className="w-2 h-2 rounded-full bg-yellow-500 shrink-0" />
                                <span className="text-yellow-400">{f.name}</span>
                                <span className="text-white/30 text-xs ml-auto">No recent dated items</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 text-sm text-green-400">
                            <span className="w-2 h-2 rounded-full bg-green-500" />
                            All feeds healthy
                          </div>
                        );
                      })()
                    ) : (
                      <span className="text-white/30 text-sm">No feed health data</span>
                    )}
                  </div>

                  {/* Curation Mode */}
                  {curationStats?.curationMode && (
                    <div className="mt-4 text-xs text-white/40">
                      Fallback ignored exclusions: <span className={curationStats.fallbackIgnoredExclusions ? 'text-red-400' : 'text-green-400'}>{String(!!curationStats.fallbackIgnoredExclusions)}</span>
                    </div>
                  )}
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
              New newsletter
            </Button>
            {stories.length > 0 && (
              <Button
                className="bg-teal-500/10 hover:bg-teal-500/20 text-teal-400 border border-teal-500/20 hover:border-teal-500/30"
                size="sm"
                onClick={findMoreNews}
                disabled={loading}
              >
                <Plus className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
                {loading ? 'Finding...' : 'Find More'}
              </Button>
            )}
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

      {
        loading ? (
          <div className="h-[calc(100vh-64px)] flex flex-col items-center justify-center relative overflow-hidden" >
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
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 lg:gap-8 lg:h-[calc(100vh-140px)]">
              {/* Main Feed */}
              <div className="lg:col-span-8 min-w-0 flex flex-col h-full">
                {/* X/Twitter AI News Section — always show so Refresh is accessible */}
                <div className="mb-6">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="flex items-center gap-2">
                        <span className="bg-white text-black px-2 py-1 rounded-md font-bold text-sm leading-none">𝕏</span>
                        <h2 className="font-display text-lg text-white tracking-tight">Trending on X</h2>
                      </div>
                      <span className="text-xs text-white/30 bg-white/5 px-2 py-0.5 rounded-full border border-white/5">
                        {xNews.length} posts
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="ml-auto text-white/30 hover:text-white text-xs h-7"
                        onClick={() => fetchXNews(true)}
                        disabled={xLoading}
                      >
                        <RefreshCw className={`w-3 h-3 mr-1 ${xLoading ? 'animate-spin' : ''}`} />
                        Refresh
                      </Button>
                    </div>
                    {xNews.length === 0 ? (
                      <div className="rounded-lg border border-white/5 bg-surface p-6 text-center">
                        <p className="text-sm text-white/30">
                          {xLoading ? 'Fetching trending AI posts...' : 'No X posts cached. Click Refresh to fetch trending AI content.'}
                        </p>
                      </div>
                    ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      {xNews.map((item: any) => {
                        const isSelected = selectedIds.has(`x_${item.id}`);
                        return (
                          <div
                            key={item.id}
                            onClick={() => selectXItem(item)}
                            className={`group rounded-lg border p-4 transition-all duration-200 cursor-pointer ${
                              isSelected
                                ? 'bg-amber-500/10 border-amber-500/30 shadow-glow-amber-sm'
                                : 'border-white/5 bg-surface hover:bg-surface-elevated hover:border-white/10'
                            }`}
                          >
                            <div className="flex items-start gap-3">
                              <div className="shrink-0 mt-0.5">
                                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-all ${
                                  isSelected ? 'bg-amber-500 text-black' : 'bg-white/10 text-white/60'
                                }`}>
                                  {isSelected ? <Check className="w-4 h-4" /> : '𝕏'}
                                </div>
                              </div>
                              <div className="flex-1 min-w-0">
                                <p className={`text-sm font-medium leading-snug line-clamp-2 transition-colors ${
                                  isSelected ? 'text-amber-300' : 'text-white/80 group-hover:text-amber-300'
                                }`}>
                                  {item.title}
                                </p>
                                <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                                  <span className="text-xs text-white/30">@{item.author}</span>
                                  {(item.likes > 0 || item.retweets > 0) && (
                                    <div className="flex items-center gap-2 text-xs text-white/25">
                                      {item.likes > 0 && (
                                        <span className="flex items-center gap-0.5">
                                          <Heart className="w-3 h-3" />{formatCount(item.likes)}
                                        </span>
                                      )}
                                      {item.retweets > 0 && (
                                        <span className="flex items-center gap-0.5">
                                          <Repeat2 className="w-3 h-3" />{formatCount(item.retweets)}
                                        </span>
                                      )}
                                    </div>
                                  )}
                                  {item.source_method && (() => {
                                    const badge = getSourceBadge(item.source_method);
                                    return (
                                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${badge.color}`}>
                                        {badge.label}
                                      </span>
                                    );
                                  })()}
                                </div>
                                {isSelected && (
                                  <input
                                    type="text"
                                    placeholder="Research angle... (optional)"
                                    value={directions[`x_${item.id}`] || ''}
                                    onChange={(e) => setDirections(prev => ({ ...prev, [`x_${item.id}`]: e.target.value }))}
                                    onClick={(e) => e.stopPropagation()}
                                    className="w-full mt-1.5 text-xs bg-white/5 border border-white/10 rounded px-2 py-1 text-white/70 placeholder:text-white/20 focus:outline-none focus:border-amber-500/50"
                                  />
                                )}
                              </div>
                              <a
                                href={item.url}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                className="shrink-0 mt-1"
                              >
                                <ExternalLink className="w-3.5 h-3.5 text-white/20 hover:text-white/60 transition-colors" />
                              </a>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                    )}
                    {/* All X items shown */}
                </div>

                <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
                  <div>
                    <h2 className="font-display text-2xl text-white tracking-tight flex items-center gap-3">
                      Top Stories
                      <span className="text-sm font-sans font-normal text-white/40 bg-white/5 px-2.5 py-0.5 rounded-full border border-white/5">
                        {stories.length} items
                      </span>
                    </h2>
                    <p className="text-xs text-white/40 mt-2">News from the last 24 hours, extending to 36 hours when quiet. Older selected stories stay in your queue.</p>
                    <details className="mt-2 text-xs text-white/60"><summary className="cursor-pointer text-amber-300">How priority scores work</summary><p className="mt-2 max-w-xl leading-relaxed">Scores combine the model's base importance, source coverage and recency, capped at 10. They guide selection; they are not confidence or fact checks. Stories sort by freshness bucket first, then score. Several strong recent stories can share 10/10.</p></details>
                    {curationStats?.feedHealth?.some((feed: { status: string; fallbackUsed?: boolean }) => feed.status === 'failed' || feed.fallbackUsed) && (
                      <p className="text-xs text-amber-300 mt-2">Some sources are unavailable or using an index fallback. See Source Stats for coverage.</p>
                    )}
                  </div>
                  <div className="flex gap-4 text-xs text-white/40">
                    <span className="flex items-center gap-1.5 cursor-help hover:text-white transition-colors">
                      <div className="w-2 h-2 bg-coral-500 rounded-full"></div> Priority 9+
                    </span>
                    <span className="flex items-center gap-1.5 cursor-help hover:text-white transition-colors">
                      <div className="w-2 h-2 bg-amber-500 rounded-full"></div> Priority 7+
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

                        <div className="flex gap-3 sm:gap-5">
                          {/* Score Indicator */}
                          <div className="shrink-0">
                            <div className={`w-12 h-12 rounded-lg flex flex-col items-center justify-center border font-mono font-bold text-lg ${story.finalScore >= 9 ? 'bg-coral-500/20 border-coral-500/30 text-coral-400' :
                              story.finalScore >= 7 ? 'bg-amber-500/20 border-amber-500/30 text-amber-400' :
                                'bg-white/5 border-white/10 text-white/60'
                              }`}>
                              {scoreLabel(story.finalScore)}<span className="text-[10px] font-normal text-white/60">/10</span>
                            </div>
                          </div>

                          {/* Content */}
                          <div className="flex-1 min-w-0 pt-0.5">
                            <h3 className="text-base font-semibold text-white/90 leading-snug mb-2 group-hover:text-amber-300 transition-colors">
                              <button className="text-left" onClick={event => { event.stopPropagation(); setViewingStory(story); }} aria-label={'Read ' + story.headline}>{story.headline}</button>
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

                              {story.sources.some(s => s.startsWith('X: @')) && (
                                <div className="flex items-center gap-1.5 text-xs font-medium">
                                  <span className="bg-white/90 text-black px-1.5 py-0.5 rounded font-bold text-[10px] leading-none">𝕏</span>
                                  <span className="text-white/50">{story.sources.find(s => s.startsWith('X: @'))?.replace('X: ', '')}</span>
                                </div>
                              )}

                              <div className="flex items-center gap-1.5 text-xs text-white/50">
                                  <Clock className="w-3 h-3" />
                                  {Number.isFinite(Date.parse(story.publishedAt)) ? new Date(story.publishedAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : 'Date unknown'}
                                  {story.dateBasis === 'source' ? ' · Source date' : story.dateBasis === 'linked-article' ? ' · Linked article date' : story.dateBasis === 'event' ? ' · Event date' : ' · Saved date'}
                                  {!isFreshNews(story.publishedAt) && ' · Older selected story'}
                              </div>
                            </div>

                            {selectedIds.has(story.id) && (
                              <input
                                type="text"
                                aria-label={'Research angle for ' + story.headline}
                                placeholder="Add research angle... (e.g. 'focus on the Chinese perspective')"
                                value={directions[story.id] || ''}
                                onChange={(e) => setDirections(prev => ({ ...prev, [story.id]: e.target.value }))}
                                onClick={(e) => e.stopPropagation()}
                                className="w-full mt-2 text-xs bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-white/70 placeholder:text-white/25 focus:outline-none focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/20"
                              />
                            )}
                          </div>

                          {/* Action Area */}
                          <div className="shrink-0 flex flex-col justify-start items-end gap-2">
                            <Button
                              aria-label={(selectedIds.has(story.id) ? 'Remove ' : 'Select ') + story.headline}
                              aria-pressed={selectedIds.has(story.id)}
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
              <div className="lg:col-span-4 min-w-0 h-full flex flex-col lg:pt-14">
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
                      directions={directions}
                      onDirectionChange={(id, val) => setDirections(prev => ({ ...prev, [id]: val }))}
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
        )
      }

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

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
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
                      {(viewingStory.primaryLinks ?? []).map(link => <a key={link} href={link} target="_blank" rel="noopener noreferrer" className="mt-2 block break-all text-xs text-amber-300 underline">Supporting source ↗</a>)}
                    </div>
                    <div>
                      <p className="mb-2 text-xs text-white/60">Base {scoreLabel(viewingStory.baseScore)} → priority {scoreLabel(viewingStory.finalScore)}/10</p>
                      <h4 className="text-sm font-medium text-white/60 mb-2">Score adjustments</h4>
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

      {/* API Key Dialog (accessible from dashboard) */}
      <Dialog open={showApiInput} onOpenChange={setShowApiInput}>
        <DialogContent className="bg-[#0B0B0F] border border-white/10 text-white max-w-sm">
          <DialogHeader>
            <DialogTitle>API Configuration</DialogTitle>
            <DialogDescription>
              {apiKey || serverHasKey 
                ? 'Update or replace your OpenRouter API key.'
                : 'Enter your OpenRouter API key to enable AI features.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <label className="text-xs uppercase tracking-wider text-white/50 font-medium block">OpenRouter API Key</label>
              <Input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-or-..."
                className="bg-black/40 border-white/10"
              />
              <p className="text-xs text-white/30">Get a key at <a href="https://openrouter.ai/keys" target="_blank" rel="noopener noreferrer" className="text-amber-400 hover:underline">openrouter.ai/keys</a></p>
            </div>
            {serverHasKey && (
              <div className="flex items-center gap-2 text-xs text-teal-400/80 bg-teal-400/5 px-3 py-2 rounded-lg border border-teal-400/10">
                <span className="w-1.5 h-1.5 rounded-full bg-teal-400"></span>
                Server key configured for writing. Image Studio uses its server key separately.
              </div>
            )}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" size="sm" onClick={() => setShowApiInput(false)}>Cancel</Button>
              <Button size="sm" className="bg-amber-500 text-black hover:bg-amber-600" onClick={handleSaveApiKey}>Save Key</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* New newsletter Confirmation Dialog */}
      <Dialog open={showClearConfirm} onOpenChange={setShowClearConfirm}>
        <DialogContent className="max-w-md bg-[#0B0B0F] border border-white/10 text-white">
          <DialogHeader>
            <DialogTitle className="font-display text-xl flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-coral-400" />
              Start a new newsletter?
            </DialogTitle>
            <DialogDescription className="text-white/60">
              Your current selections, research and draft will be archived in cloud history. Both people will see the new empty newsletter after it saves.
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
              Archive & start new
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div >
  );
}
