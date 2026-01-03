import { NextResponse } from 'next/server';
import { fetchAllNews, filterByDate } from '@/lib/news-fetcher';
import { extractAllStories } from '@/lib/news-extractor';
import { defaultConfig } from '@/lib/config';

export async function GET(request: Request) {
    try {
        const { searchParams } = new URL(request.url);
        const days = parseInt(searchParams.get('days') || '3');
        const extractStories = searchParams.get('extract') === 'true';
        const apiKey = searchParams.get('apiKey') || process.env.OPENROUTER_API_KEY || '';

        // Fetch newsletters from all configured feeds
        const allNews = await fetchAllNews(defaultConfig.rssFeeds);

        // Filter by date
        const filteredByDate = filterByDate(allNews, days);

        // If story extraction requested and API key available
        if (extractStories && apiKey) {
            // Only extract from newsletter sources (not direct news)
            const newsletters = filteredByDate.filter(item =>
                defaultConfig.rssFeeds.find(f =>
                    f.url === item.source && f.category === 'newsletter'
                )
            );

            const directNews = filteredByDate.filter(item =>
                defaultConfig.rssFeeds.find(f =>
                    f.url === item.source && f.category === 'news'
                )
            );

            // Extract stories from newsletters
            const extractedStories = await extractAllStories(newsletters.slice(0, 10), apiKey);

            // Convert direct news to extracted story format
            const directStories = directNews.map(item => ({
                id: item.id,
                headline: item.title,
                summary: item.summary || '',
                category: 'news',
                importance: 6, // Default importance for direct news
                originalUrl: item.url,
                sourceNewsletter: item.sourceName,
                sourceNewsletterUrl: item.url,
                publishedAt: item.publishedAt,
            }));

            // Combine and sort by importance
            const allStories = [...extractedStories, ...directStories]
                .sort((a, b) => b.importance - a.importance);

            return NextResponse.json({
                success: true,
                count: allStories.length,
                newslettersProcessed: newsletters.slice(0, 10).length,
                directNewsCount: directNews.length,
                extracted: true,
                items: allStories,
            });
        }

        // Return raw news items (not extracted)
        return NextResponse.json({
            success: true,
            count: filteredByDate.length,
            extracted: false,
            items: filteredByDate.map(item => ({
                id: item.id,
                headline: item.title,
                summary: item.summary || '',
                category: 'unknown',
                importance: null,
                originalUrl: item.url,
                sourceNewsletter: item.sourceName,
                sourceNewsletterUrl: item.url,
                publishedAt: item.publishedAt,
            })),
        });
    } catch (error) {
        console.error('Error fetching news:', error);
        return NextResponse.json(
            { success: false, error: 'Failed to fetch news' },
            { status: 500 }
        );
    }
}
