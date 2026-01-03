import { NewsItem } from './types';

interface RelevanceResult {
    id: string;
    relevanceScore: number;
    category: string;
    reason: string;
}

interface FilteredNews {
    item: NewsItem;
    relevanceScore: number;
    category: string;
    reason: string;
}

// AI-powered relevance filtering using OpenRouter
export async function filterNewsWithAI(
    items: NewsItem[],
    apiKey: string
): Promise<FilteredNews[]> {
    // Prepare news items for analysis
    const newsForAnalysis = items.slice(0, 30).map(item => ({
        id: item.id,
        title: item.title,
        summary: item.summary || '',
        source: item.sourceName,
    }));

    const prompt = `You are an AI news curator for the "Innovate AI" newsletter targeting AI enthusiasts.

Analyze these news items and rate their relevance (1-10 scale):

HIGHLY RELEVANT (8-10):
- New AI model releases (GPT, Claude, Gemini, Llama, Mistral, etc.)
- Major AI tool launches or significant updates
- AI company breaking news (OpenAI, Anthropic, Google, Meta AI, etc.)
- AI research breakthroughs and papers
- AI regulations and policy changes

RELEVANT (6-7):
- AI startup funding and acquisitions
- AI industry analysis and trends
- Practical AI tutorials and use cases

LOW RELEVANCE (1-5):
- Generic tech news without direct AI focus
- Job postings or promotional content
- Outdated or duplicate information
- Non-AI tech updates

NEWS ITEMS:
${JSON.stringify(newsForAnalysis, null, 2)}

Respond with a JSON array of objects, each containing:
- id: the news item id
- relevanceScore: number 1-10
- category: one of [model_release, tool_launch, research, industry, regulation, tutorial, company_news, other]
- reason: brief 10-word max explanation

ONLY output valid JSON array, nothing else.`;

    try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'http://localhost:3000',
                'X-Title': 'Innovate AI Newsletter',
            },
            body: JSON.stringify({
                model: 'google/gemini-2.0-flash-001',
                messages: [
                    {
                        role: 'user',
                        content: prompt,
                    },
                ],
                temperature: 0.3,
                max_tokens: 4000,
            }),
        });

        if (!response.ok) {
            console.error('OpenRouter API error:', response.status);
            // Return items without filtering if API fails
            return items.map(item => ({
                item,
                relevanceScore: 5,
                category: 'other',
                reason: 'API unavailable - unfiltered',
            }));
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content || '[]';

        // Parse the JSON response
        let results: RelevanceResult[];
        try {
            // Clean the content - remove markdown code blocks if present
            const cleanContent = content
                .replace(/```json\n?/g, '')
                .replace(/```\n?/g, '')
                .trim();
            results = JSON.parse(cleanContent);
        } catch (e) {
            console.error('Failed to parse AI response:', e);
            return items.map(item => ({
                item,
                relevanceScore: 5,
                category: 'other',
                reason: 'Parse error - unfiltered',
            }));
        }

        // Map results back to news items
        const resultMap = new Map(results.map(r => [r.id, r]));

        return items
            .map(item => {
                const result = resultMap.get(item.id);
                return {
                    item,
                    relevanceScore: result?.relevanceScore || 5,
                    category: result?.category || 'other',
                    reason: result?.reason || 'Not analyzed',
                };
            })
            .filter(r => r.relevanceScore >= 6)
            .sort((a, b) => b.relevanceScore - a.relevanceScore);

    } catch (error) {
        console.error('AI filtering error:', error);
        return items.map(item => ({
            item,
            relevanceScore: 5,
            category: 'other',
            reason: 'Error - unfiltered',
        }));
    }
}
