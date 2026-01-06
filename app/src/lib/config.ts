import { NewsletterConfig } from './types';

export const defaultConfig: NewsletterConfig = {
    name: "Innov8 AI",
    tagline: "Stay Innov8, Stay AI",
    voiceGuidelines: `
    - Write in Malayalam with English tech terms
    - Casual, conversational tone
    - Use emojis liberally
    - Be enthusiastic but informative
    - Focus on practical implications, not just announcements
    - Add commentary and analysis, not just facts
  `,
    imageStylePrompt: `
    Modern tech illustration style, vibrant gradients with purple and blue tones,
    minimalist geometric shapes, futuristic feel, clean and professional,
    suitable for AI/tech newsletter
  `,
    // Expanded RSS feeds - newsletters and news sources
    rssFeeds: [
        // =====================
        // TIER 1: AI NEWSLETTERS (contain multiple stories - need extraction)
        // =====================
        {
            name: "The Rundown AI",
            url: "https://rss.app/feeds/Kc554BCmk9PUValj.xml",
            category: "newsletter",
            tier: 1
        },
        {
            name: "Ben's Bites",
            url: "https://rss.app/feeds/O60XfEFYoxJhYVkS.xml",
            category: "newsletter",
            tier: 1
        },
        {
            name: "The Neuron",
            url: "https://rss.app/feeds/e2QjBpEDLPfVUeoI.xml",
            category: "newsletter",
            tier: 1
        },
        {
            name: "Superhuman AI",
            url: "https://rss.app/feeds/3tDyvQwHp8cgL7qs.xml",
            category: "newsletter",
            tier: 1
        },
        {
            name: "Techspresso",
            url: "https://www.dupple.com/techpresso-archives/rss.xml",
            category: "newsletter",
            tier: 1
        },
        {
            name: "TLDR AI",
            url: "https://tldr.tech/ai/rss",
            category: "newsletter",
            tier: 1
        },
        // =====================
        // TIER 2: TECH NEWS SITES (single stories per item)
        // =====================
        {
            name: "TechCrunch AI",
            url: "https://techcrunch.com/category/artificial-intelligence/feed/",
            category: "news",
            tier: 2
        },
        {
            name: "The Verge AI",
            url: "https://www.theverge.com/rss/ai-artificial-intelligence/index.xml",
            category: "news",
            tier: 2
        },
        {
            name: "VentureBeat AI",
            url: "https://venturebeat.com/category/ai/feed/",
            category: "news",
            tier: 2
        },
        {
            name: "Ars Technica AI",
            url: "https://feeds.arstechnica.com/arstechnica/technology-lab",
            category: "news",
            tier: 2
        },
        {
            name: "Wired AI",
            url: "https://www.wired.com/feed/tag/ai/latest/rss",
            category: "news",
            tier: 2
        },
        {
            name: "MIT News AI",
            url: "https://news.mit.edu/topic/artificial-intelligence2-rss.xml",
            category: "news",
            tier: 2
        },
        // =====================
        // TIER 3: RESEARCH & OFFICIAL BLOGS
        // =====================
        {
            name: "OpenAI Blog",
            url: "https://openai.com/blog/rss/",
            category: "blog",
            tier: 3
        },
        {
            name: "Google AI Blog",
            url: "https://blog.google/technology/ai/rss/",
            category: "blog",
            tier: 3
        },
        {
            name: "Anthropic News",
            url: "https://www.anthropic.com/news/rss",
            category: "blog",
            tier: 3
        },
        // =====================
        // TIER 4: COMMUNITY / SOCIAL
        // =====================
        {
            name: "Hacker News AI",
            url: "https://hnrss.org/newest?q=AI+OR+GPT+OR+LLM+OR+Claude+OR+OpenAI&points=50",
            category: "social",
            tier: 4
        },
        // =====================
        // REDDIT COMMUNITIES (Sorted by Top Daily to capture high engagement)
        // =====================
        {
            name: "r/ArtificialInteligence",
            url: "https://www.reddit.com/r/ArtificialInteligence/top/.rss?t=day",
            category: "social",
            tier: 4
        },
        {
            name: "r/LocalLLaMA",
            url: "https://www.reddit.com/r/LocalLLaMA/top/.rss?t=day",
            category: "social",
            tier: 4
        },
        {
            name: "r/MachineLearning",
            url: "https://www.reddit.com/r/MachineLearning/top/.rss?t=day",
            category: "social",
            tier: 4
        },
        {
            name: "r/OpenAI",
            url: "https://www.reddit.com/r/OpenAI/top/.rss?t=day",
            category: "social",
            tier: 4
        },
        {
            name: "r/Singularity",
            url: "https://www.reddit.com/r/singularity/top/.rss?t=day",
            category: "social",
            tier: 4
        }
    ]
};

// Scoring configuration
export const SCORING_CONFIG = {
    minScoreToShow: 6,
    crossSourceBoost: {
        twoSources: 1,
        threePlusSources: 2
    },
    categoryBoost: {
        model_release: 1,
        acquisition: 1,
        major_update: 1
    },
    recencyBoostHours: 12, // Stories newer than this get +1
    tierWeight: {
        1: 1.0,  // Newsletters
        2: 0.9,  // News sites
        3: 1.1,  // Official blogs (important)
        4: 0.8   // Social
    }
};

// Prompt for extracting and scoring news stories
export const SMART_CURATION_PROMPT = `You are an expert AI news curator for the "Innov8 AI" newsletter.
Target Audience: Normal people interested in AI (not just researchers). They want to know "what happened" and "why it matters".

TASK: Analyze this content and extract individual news stories.

For EACH distinct news story, provide:
1. headline: Clear, engaging headline (max 12 words) - specific and punchy
2. summary: A 3-4 sentence explanation covering: WHAT happened? and WHY it matters to a normal person? Avoid jargon.
3. category: One of [model_release, tool_launch, acquisition, research, funding, regulation, tutorial, industry, company_news]
4. baseScore: Score 1-10 based on importance to the general public:
   - 9-10: Mainstream news (GPT-5, deepfakes law, major job market shifts)
   - 7-8: Big tools normal people use (ChatGPT updates, heavy hitters), major breakthroughs
   - 5-6: Interesting new apps, useful tutorials, industry trends
   - 3-4: Niche developer tools, minor updates, enterprise-only news
   - 1-2: Spam, irrelevant, promotional only
5. entities: List of companies/products mentioned
6. originalUrl: Source URL if mentioned

RULES:
- Extract SEPARATE stories, not the whole newsletter
- Focus on the "Normal Person" angle in the summary
- Skip: job posts, sponsor sections, "also check out" links
- Max 6 stories per source

Return ONLY valid JSON array. No other text.`;
