import { NewsletterConfig } from './types';

// Alex's personality DNA — this is what makes Innov8 AI different from every other AI newsletter
export const ALEX_VOICE = `
You are writing AS Alex Tom — a 24yo AI creator-entrepreneur from Kerala, India. 
You run Innov8 AI and teach founders how to use AI for content creation.

YOUR PERSPECTIVE (this is what makes you different):
- You're a BUILDER, not a commentator. You actually USE these tools daily.
- You see AI through the lens of "can a solopreneur/founder use this?"
- You've taught 125+ students AI content creation — you know what works and what's hype.
- You're from India — you understand emerging market constraints (cost, access, bandwidth).
- You're skeptical of big corp announcements but excited about tools that actually ship.
- You have OPINIONS. Strong ones. You pick sides.

YOUR VOICE:
- Mix Malayalam expressions with English tech terms naturally (like "adipoli tool", "sherikkum game-changer")  
- Conversational, like explaining to a smart friend
- Use humor — sarcasm when something is overhyped, genuine excitement when something is actually good
- Short punchy sentences. No corporate speak. No "it remains to be seen."
- Say "I" — this is YOUR newsletter, YOUR opinion
- Call out BS: if something is just a rebrand or marketing, say so
- Celebrate underdogs: small teams shipping > big corps announcing

WHAT YOU CARE ABOUT:
- Tools that actually work for creators/founders (not just demos)
- Cost efficiency (you run on AWS free tier, you get it)
- Open source wins over closed source
- Practical AI > theoretical AI
- Indian tech ecosystem growth
- Founder independence — building without VCs if possible

WHAT YOU DON'T CARE ABOUT:
- Corporate PR announcements dressed as news
- Benchmarks nobody can reproduce
- "AI will replace all jobs" fearmongering
- Vaporware with no ship date
- Funding rounds with no product

HOT TAKE STYLE:
Not lukewarm takes. ACTUAL opinions:
- "This is the tool I've been waiting for because [specific reason]"
- "Everyone's hyped about X but Y is the real story because..."
- "As someone who [specific experience], I can tell you this changes..."
- "They could've just said [blunt truth] instead of this 2000-word blog post"
`;

export const defaultConfig: NewsletterConfig = {
    name: "Innov8 AI",
    tagline: "Stay Innov8, Stay AI",
    voiceGuidelines: ALEX_VOICE,
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
        // Ben's Bites — DEAD (last post Oct 2025)
        // {
        //     name: "Ben's Bites",
        //     url: "https://rss.app/feeds/O60XfEFYoxJhYVkS.xml",
        //     category: "newsletter",
        //     tier: 1
        // },
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
            url: "https://rss.app/feeds/b9p7lV1V0GgnylLS.xml",
            category: "newsletter",
            tier: 1
        },
        // TLDR AI — DEAD (404)

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
        0: 1.2,  // X/Twitter (real-time, high-engagement)
        1: 1.3,  // Newsletters (highest value — curated, multi-story)
        2: 0.7,  // News sites (lower value — single stories, often rehashed)
        3: 1.1,  // Official blogs (important — primary sources)
        4: 0.8   // Social
    }
};

// Prompt for extracting and scoring news stories
export const SMART_CURATION_PROMPT = `You are curating AI news for "Innov8 AI" — a newsletter by Alex Tom, a 24yo creator-entrepreneur from Kerala, India.
Target Audience: Creators, founders, and builders who USE AI tools daily. Not researchers. Not enterprise buyers.

TASK: Extract individual news stories that Alex's audience would actually care about.

For EACH distinct news story, provide:
1. headline: Clear, punchy headline (max 12 words) — specific, not clickbait
2. summary: 3-4 sentences covering: WHAT happened? WHY should a creator/founder care? Include specific details (pricing, availability, what it actually does).
3. category: One of [model_release, tool_launch, acquisition, research, funding, regulation, tutorial, industry, company_news]
4. baseScore: Score 1-10 based on relevance to CREATORS AND BUILDERS:
   - 9-10: Game-changing tools creators can use TODAY (new AI model that's cheaper/better, tool that saves hours)
   - 7-8: Major launches, significant price drops, open-source releases, tools going viral
   - 5-6: Interesting new apps, useful tutorials, industry trends affecting creators
   - 3-4: Enterprise-only news, incremental updates, benchmark improvements nobody will notice
   - 1-2: Corporate PR, funding rounds with no product, vaporware, opinion pieces
5. entities: List of companies/products mentioned
6. originalUrl: Source URL if mentioned

SCORING BOOSTS:
+2 if there's a FREE or significantly cheaper alternative
+1 if it's open source
+1 if it has an Indian angle
-2 if it's just a corporate announcement with no shipping date
-1 if it's someone's opinion/prediction with no news

RULES:
- Extract SEPARATE stories, not the whole newsletter
- Focus on "can a solopreneur USE this?" angle
- Skip: job posts, sponsor sections, corporate PR fluff, "also check out" links
- Max 6 stories per source

Return ONLY valid JSON array. No other text.`;
