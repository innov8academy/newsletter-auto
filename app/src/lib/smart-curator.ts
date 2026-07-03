import { NewsItem, CuratedStory, CurationProgress, FeedHealth } from './types';
import { defaultConfig, SCORING_CONFIG, SMART_CURATION_PROMPT } from './config';
import { fetchAllNews, filterByDate } from './news-fetcher';
import { supabaseAdmin, isSupabaseConfigured } from './supabase';
import { callGemini } from './gemini-client';

interface RawExtractedStory {
    headline: string;
    summary: string;
    category: string;
    baseScore: number;
    entities: string[];
    originalUrl: string | null;
}

// Generate unique ID
function generateId(text: string): string {
    let hash = 0;
    const str = `${text}-${Date.now()}-${Math.random()}`;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(36);
}

// Normalize text for comparison
function normalizeText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .replace(/\s+/g, ' ')
        .trim();
}

// Calculate similarity between two strings (Jaccard similarity)
function calculateSimilarity(text1: string, text2: string): number {
    const words1 = new Set(normalizeText(text1).split(' ').filter(w => w.length > 3));
    const words2 = new Set(normalizeText(text2).split(' ').filter(w => w.length > 3));

    if (words1.size === 0 || words2.size === 0) return 0;

    const intersection = new Set([...words1].filter(w => words2.has(w)));
    const union = new Set([...words1, ...words2]);

    return intersection.size / union.size;
}

const EXCLUDED_HEADLINE_SIMILARITY_THRESHOLD = 0.5;

export function isExcludedStory(
    story: Pick<CuratedStory, 'headline'>,
    excludeHeadlines: string[],
    threshold: number = EXCLUDED_HEADLINE_SIMILARITY_THRESHOLD
): boolean {
    if (excludeHeadlines.length === 0) return false;

    return excludeHeadlines.some(excluded =>
        calculateSimilarity(story.headline, excluded) > threshold
    );
}

export function filterExcludedStories<T extends Pick<CuratedStory, 'headline'>>(
    stories: T[],
    excludeHeadlines: string[]
): { stories: T[]; excludedCount: number } {
    if (excludeHeadlines.length === 0) {
        return { stories, excludedCount: 0 };
    }

    const filtered = stories.filter(story => !isExcludedStory(story, excludeHeadlines));
    return {
        stories: filtered,
        excludedCount: stories.length - filtered.length,
    };
}

// Fetch previously used story headlines from Supabase (last 30 days)
async function fetchUsedStoryHeadlines(): Promise<string[]> {
    if (!isSupabaseConfigured()) {
        console.log('[Duplicate Check] Supabase not configured, skipping');
        return [];
    }

    try {
        const sevenDaysAgo = new Date();
        sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

        const { data, error } = await supabaseAdmin
            .from('used_stories')
            .select('headline')
            .gte('used_at', sevenDaysAgo.toISOString())
            .order('used_at', { ascending: false });

        if (error) {
            console.error('[Duplicate Check] Error fetching used stories:', error);
            return [];
        }

        console.log(`[Duplicate Check] Found ${data?.length || 0} previously used stories`);
        return (data || []).map(s => s.headline);
    } catch (e) {
        console.error('[Duplicate Check] Exception:', e);
        return [];
    }
}

// Check if a story headline is too similar to previously used ones
function isStoryUsed(headline: string, usedHeadlines: string[], threshold: number = 0.7): boolean {
    for (const usedHeadline of usedHeadlines) {
        const similarity = calculateSimilarity(headline, usedHeadline);
        if (similarity >= threshold) {
            console.log(`[Duplicate Check] Skipping "${headline.substring(0, 40)}..." (${(similarity * 100).toFixed(0)}% similar to used)`);
            return true;
        }
    }
    return false;
}

import { scrapeUrl } from './firecrawl';

// [Deleted internal scrapeContent function]

// Extract stories from a single news item using AI
async function extractStories(
    item: NewsItem,
    apiKey: string
): Promise<RawExtractedStory[]> {
    let content = item.content || item.summary || '';

    // X/Twitter items — extract with dynamic engagement-based scoring
    if (item.source === 'x_twitter') {
        const tweetText = item.content || item.summary || item.title || '';
        // Clean the @handle prefix from title
        const cleanTitle = (item.title || '').replace(/^@\w+:\s*/, '').substring(0, 120);

        // Parse engagement data from enriched summary (format: "text [123 likes, 45 RTs]")
        let engagement = 0;
        let sourceMethod = 'search';
        const engMatch = (item.summary || '').match(/\[(\d+) likes?, (\d+) RTs?\]/);
        if (engMatch) {
            engagement = parseInt(engMatch[1]) + parseInt(engMatch[2]) * 2;
        }

        // Try parsing JSON engagement from raw data
        try {
            const meta = JSON.parse(item.content || '{}');
            if (meta.engagement_score) engagement = meta.engagement_score;
            if (meta.source_method) sourceMethod = meta.source_method;
        } catch { /* not JSON, that's fine */ }

        // Dynamic scoring based on engagement
        let baseScore: number;
        if (engagement > 10000) baseScore = 9;
        else if (engagement > 5000) baseScore = 8;
        else if (engagement > 1000) baseScore = 7;
        else baseScore = 6;

        // News API stories get +1 boost (already Grok-curated)
        if (sourceMethod === 'news_api') baseScore = Math.min(baseScore + 1, 10);

        return [{
            headline: cleanTitle || tweetText.split('\n')[0].substring(0, 120),
            summary: tweetText.substring(0, 500),
            category: 'news',
            baseScore,
            entities: [],
            originalUrl: item.url,
        }];
    }

    // INTELLIGENT UPGRADE:
    // Always attempt to get more context if the initial feed content is thin.
    // 600 chars is roughly 2 paragraphs. If less, we likely just have a teaser.
    if (!content || content.length < 600 && item.url) {
        const scrapeResult = await scrapeUrl(item.url);
        if (scrapeResult.content && scrapeResult.content.length > 500) {
            content = `[Full Content Retrieved via ${scrapeResult.method}]\n\n${scrapeResult.content}`;
        }
    }

    // If still no content, return as single story (fallback)
    // Threshold is 40 chars (not 100) — even a short title+source is enough for Gemini to categorize
    if (!content || content.length < 40) {
        return [{
            headline: item.title,
            summary: item.summary || item.title,
            category: 'other',
            baseScore: 5,
            entities: [],
            originalUrl: item.url,
        }];
    }

    const prompt = `${SMART_CURATION_PROMPT}

SOURCE: ${item.sourceName}
TITLE: ${item.title}
DATE: ${item.publishedAt}

CONTENT:
${content.substring(0, 15000)}

Return JSON array only.`;

    try {
        // Use Gemini API directly (free tier) instead of OpenRouter
        const response = await callGemini(prompt, {
            model: 'gemini-3.1-flash-lite-preview',
            temperature: 0.2,
            maxOutputTokens: 3000,
        });

        const cleanContent = response.text
            .replace(/```json\n?/g, '')
            .replace(/```\n?/g, '')
            .trim();

        const parsed = JSON.parse(cleanContent);
        if (Array.isArray(parsed)) return parsed;
        // Gemini sometimes wraps in an object like {stories: [...]} — unwrap it
        if (parsed && typeof parsed === 'object') {
            const arrValue = Object.values(parsed).find(v => Array.isArray(v));
            if (arrValue) return arrValue as RawExtractedStory[];
            // Single story object — wrap in array
            if (parsed.headline) return [parsed as RawExtractedStory];
        }
        console.warn(`[Extract] Unexpected Gemini response format for "${item.title.substring(0, 40)}...", using fallback`);
        return [{
            headline: item.title,
            summary: item.summary || '',
            category: 'other' as string,
            baseScore: 5,
            entities: [],
            originalUrl: item.url,
        }];
    } catch (error) {
        console.error(`[Extract] Failed for "${item.title.substring(0, 50)}..." [${item.sourceName}]:`,
            error instanceof Error ? error.message : error);
        return [{
            headline: item.title,
            summary: item.summary || '',
            category: 'other',
            baseScore: 5,
            entities: [],
            originalUrl: item.url,
        }];
    }
}

// Main curation function
export async function curateNews(
    apiKey: string,
    onProgress?: (progress: CurationProgress) => void,
    customFeeds: any[] = [],
    excludeHeadlines: string[] = []
): Promise<{ stories: CuratedStory[], stats: any }> { // Temporarily using any for stats to avoid import cycle issues if types verify slowly
    const stories: Map<string, CuratedStory> = new Map();
    const statsBreakdown: Record<string, { found: number, kept: number }> = {};

    // Stage 1: Fetch all RSS feeds
    // Merge default feeds with custom feeds
    const allFeeds = [...defaultConfig.rssFeeds, ...customFeeds];
    allFeeds.forEach(f => statsBreakdown[f.name] = { found: 0, kept: 0 });

    onProgress?.({ stage: 'fetching', current: 0, total: 1, message: `Fetching news from ${allFeeds.length} sources...` });

    const { items: allNews, feedHealth } = await fetchAllNews(allFeeds);

    // Track found counts
    allNews.forEach(item => {
        if (statsBreakdown[item.sourceName]) {
            statsBreakdown[item.sourceName].found++;
        }
    });

    // Build a tier lookup from feeds config
    const feedTierMap = new Map<string, number>();
    allFeeds.forEach(f => feedTierMap.set(f.name, f.tier ?? 2));

    // No artificial per-source budget — send all fresh items to AI extraction.
    // The 48h freshness filter + dedup in news-fetcher already limits volume.
    // AI scoring handles quality filtering.
    const SOFT_CAP = 80;

    const seenUrls = new Set<string>();
    const candidateItems: NewsItem[] = allNews
        .filter(item => {
            // Skip X items (handled separately in their own panel)
            if (item.sourceName.startsWith('X: @') || item.sourceName === 'X/Twitter AI') return false;
            // Deduplicate by URL
            if (seenUrls.has(item.url)) return false;
            seenUrls.add(item.url);
            return true;
        })
        .sort((a, b) => new Date(b.publishedAt).getTime() - new Date(a.publishedAt).getTime())
        .slice(0, SOFT_CAP);

    console.log(`[News] ${allNews.length} fresh items → ${candidateItems.length} candidates for extraction`);

    // Stage 2: Extract stories — parallel batches of 5 for speed
    const totalToProcess = candidateItems.length;
    const BATCH_SIZE = 5;

    for (let batchStart = 0; batchStart < totalToProcess; batchStart += BATCH_SIZE) {
        const batch = candidateItems.slice(batchStart, batchStart + BATCH_SIZE);

        onProgress?.({
            stage: 'extracting',
            current: Math.min(batchStart + BATCH_SIZE, totalToProcess),
            total: totalToProcess,
            message: `Analyzing batch ${Math.floor(batchStart / BATCH_SIZE) + 1}/${Math.ceil(totalToProcess / BATCH_SIZE)}...`
        });

        // Extract stories in parallel within each batch
        const batchResults = await Promise.all(
            batch.map(async (item) => {
                if (statsBreakdown[item.sourceName]) {
                    statsBreakdown[item.sourceName].kept++;
                }
                const extracted = await extractStories(item, apiKey);
                return { item, extracted };
            })
        );

        // Process extracted stories (sequential to handle dedup correctly)
        for (const { item, extracted } of batchResults) {
            for (const raw of extracted) {
                // Find if similar story exists (deduplication)
                let matchedKey: string | null = null;
                let maxSimilarity = 0;

                for (const [key, existing] of stories) {
                    const similarity = calculateSimilarity(raw.headline, existing.headline);
                    if (similarity > 0.5 && similarity > maxSimilarity) {
                        matchedKey = key;
                        maxSimilarity = similarity;
                    }
                }

                if (matchedKey) {
                    // Merge with existing story (cross-source boost)
                    const existing = stories.get(matchedKey)!;
                    if (!existing.sources.includes(item.sourceName)) {
                        existing.sources.push(item.sourceName);
                        existing.crossSourceCount++;
                    }

                    // Take higher base score
                    if (raw.baseScore > existing.baseScore) {
                        existing.baseScore = raw.baseScore;
                        existing.headline = raw.headline;
                        existing.summary = raw.summary;
                    }
                } else {
                    // New story
                    const id = generateId(raw.headline);
                    stories.set(id, {
                        id,
                        headline: raw.headline,
                        summary: raw.summary,
                        category: raw.category || 'other',
                        baseScore: raw.baseScore || 5,
                        finalScore: 0, // Calculate later
                        entities: raw.entities || [],
                        originalUrl: raw.originalUrl,
                        sources: [item.sourceName],
                        publishedAt: item.publishedAt,
                        crossSourceCount: 1,
                        boosts: [],
                    });
                }
            }
        }

        // Delay between batches to avoid rate limits
        if (batchStart + BATCH_SIZE < totalToProcess) {
            await new Promise(r => setTimeout(r, 500));
        }
    }

    // Stage 3: Calculate final scores
    onProgress?.({ stage: 'scoring', current: 0, total: 1, message: 'Calculating final scores...' });

    const now = new Date();

    for (const story of stories.values()) {
        let finalScore = story.baseScore;
        const boosts: string[] = [];

        // Tier weight — apply multiplier based on the highest-tier source
        const bestTier = Math.min(...story.sources.map(s => feedTierMap.get(s) ?? 2));
        const tierWeight = SCORING_CONFIG.tierWeight[bestTier] ?? 1.0;
        if (tierWeight !== 1.0) {
            finalScore = finalScore * tierWeight;
            boosts.push(`×${tierWeight} (tier ${bestTier})`);
        }

        // Cross-source boost
        if (story.crossSourceCount >= 3) {
            finalScore += SCORING_CONFIG.crossSourceBoost.threePlusSources;
            boosts.push(`+${SCORING_CONFIG.crossSourceBoost.threePlusSources} (3+ sources)`);
        } else if (story.crossSourceCount >= 2) {
            finalScore += SCORING_CONFIG.crossSourceBoost.twoSources;
            boosts.push(`+${SCORING_CONFIG.crossSourceBoost.twoSources} (2 sources)`);
        }

        // Category boost
        const categoryBoost = SCORING_CONFIG.categoryBoost[story.category];
        if (categoryBoost) {
            finalScore += categoryBoost;
            boosts.push(`+${categoryBoost} (${story.category})`);
        }

        // Recency scoring — fresh content gets additive boost, old content gets aggressive decay
        const publishedAt = new Date(story.publishedAt);
        const rawHoursAgo = (now.getTime() - publishedAt.getTime()) / (1000 * 60 * 60);
        // Newsletter pubDates reflect send time, not story time — cap to 12h minimum
        // so they never get "breaking" or "very fresh" boosts for stale aggregated content
        const isNewsletter = story.sources.some(s => (feedTierMap.get(s) ?? 2) === 1);
        const hoursAgo = isNewsletter ? Math.max(rawHoursAgo, 12) : rawHoursAgo;
        if (hoursAgo < 4) {
            finalScore += 3;
            boosts.push('+3 (breaking)');
        } else if (hoursAgo < 8) {
            finalScore += 2;
            boosts.push('+2 (very fresh)');
        } else if (hoursAgo < 16) {
            finalScore += 1.5;
            boosts.push('+1.5 (fresh)');
        } else if (hoursAgo < 24) {
            finalScore += 0.5;
            boosts.push('+0.5 (today)');
        }

        // Aggressive multiplicative decay for content older than 24 hours —
        // halves score within 12 hours past the 24h mark
        if (hoursAgo >= 24) {
            const decayFactor = Math.max(0.3, 1 - (hoursAgo - 24) / 24);
            finalScore *= decayFactor;
            boosts.push(`×${decayFactor.toFixed(2)} (${Math.round(hoursAgo)}h old)`);
        }

        story.finalScore = Math.min(finalScore, 10); // Cap at 10
        story.boosts = boosts;
    }

    // Filter and sort — freshness-first time-bucketed sorting
    // Stories are grouped by age bucket, then sorted by score within each bucket.
    // This ensures all fresh stories appear before older ones regardless of score.
    const now2 = new Date();
    const allScored = Array.from(stories.values()).sort((a, b) => {
        const aHours = (now2.getTime() - new Date(a.publishedAt).getTime()) / (1000 * 60 * 60);
        const bHours = (now2.getTime() - new Date(b.publishedAt).getTime()) / (1000 * 60 * 60);
        const aBucket = aHours < 12 ? 0 : aHours < 24 ? 1 : 2;
        const bBucket = bHours < 12 ? 0 : bHours < 24 ? 1 : 2;
        if (aBucket !== bBucket) return aBucket - bBucket; // fresher bucket first
        return b.finalScore - a.finalScore; // within bucket, higher score first
    });
    let result = allScored.filter(s => s.finalScore >= SCORING_CONFIG.minScoreToShow);
    let curationMode = 'normal';
    let excludedCount = 0;
    let usedStoryFilteredCount = 0;
    let safetyNetRecoveredCount = 0;
    const fallbackIgnoredExclusions = false;

    // Adaptive minimum guarantee: if below target, progressively relax threshold
    if (result.length < SCORING_CONFIG.targetMinStories) {
        const relaxed = allScored.filter(s => s.finalScore >= SCORING_CONFIG.hardFloorScore);
        if (relaxed.length > result.length) {
            result = relaxed.slice(0, Math.max(SCORING_CONFIG.targetMinStories, relaxed.length));
            curationMode = 'relaxed';
            console.log(`[Adaptive] Relaxed threshold to ${SCORING_CONFIG.hardFloorScore} — ${result.length} stories (target: ${SCORING_CONFIG.targetMinStories})`);
        }
    }

    // Stage 4: Filter out excluded headlines (already shown in "Find More" flows)
    if (excludeHeadlines.length > 0) {
        const filteredResult = filterExcludedStories(result, excludeHeadlines);
        result = filteredResult.stories;
        excludedCount = filteredResult.excludedCount;
        if (excludedCount > 0) {
            console.log(`[Find More] Excluded ${excludedCount} already-shown stories`);
        }
    }

    // Stage 5: Filter out previously used stories
    onProgress?.({ stage: 'scoring', current: 1, total: 1, message: 'Checking for duplicates...' });

    const usedHeadlines = await fetchUsedStoryHeadlines();
    if (usedHeadlines.length > 0) {
        const beforeCount = result.length;
        result = result.filter(story => !isStoryUsed(story.headline, usedHeadlines));
        usedStoryFilteredCount = beforeCount - result.length;
        if (usedStoryFilteredCount > 0) {
            console.log(`[Duplicate Check] Filtered out ${usedStoryFilteredCount} previously used stories`);
        }
    }

    // SAFETY NET: If aggressive filtering left us with 0 stories, progressively relax
    if (result.length === 0 && allScored.length > 0) {
        console.warn(`[Safety Net] 0 stories after filtering! allScored=${allScored.length}, relaxing dedup threshold...`);

        // Step 1: Re-apply used-story filter with stricter (higher) similarity threshold
        const fallbackCandidates = filterExcludedStories(
            allScored.filter(s => s.finalScore >= SCORING_CONFIG.hardFloorScore),
            excludeHeadlines
        ).stories;

        const usedRelaxed = fallbackCandidates
            .filter(story => !isStoryUsed(story.headline, usedHeadlines, 0.85)); // 85% instead of 70%

        if (usedRelaxed.length > 0) {
            result = usedRelaxed;
            curationMode = 'safety-net';
            safetyNetRecoveredCount = result.length;
            console.log(`[Safety Net] Recovered ${result.length} stories with relaxed dedup (0.85 threshold)`);
        } else {
            // Step 2: Skip used-story dedup, but still preserve current-run exclusions.
            result = fallbackCandidates.slice(0, SCORING_CONFIG.targetMinStories);
            curationMode = 'emergency';
            safetyNetRecoveredCount = result.length;
            console.warn(`[Safety Net] Emergency mode: returning ${result.length} stories after preserving current exclusions`);
        }
    }

    console.log(`[News] Final: ${result.length} stories (mode: ${curationMode})`);
    onProgress?.({ stage: 'done', current: 1, total: 1, message: `Found ${result.length} curated stories` });

    const stats = {
        sourcesAnalyzed: allFeeds.length,
        totalArticlesFound: allNews.length,
        articlesProcessed: totalToProcess,
        finalCount: result.length,
        curationMode,
        excludedCount,
        usedStoryFilteredCount,
        safetyNetRecoveredCount,
        fallbackIgnoredExclusions,
        feedHealth,
        breakdown: Object.entries(statsBreakdown).map(([name, counts]) => ({
            sourceName: name,
            found: counts.found,
            kept: counts.kept
        })).sort((a, b) => b.kept - a.kept)
    };

    return { stories: result, stats };
}
