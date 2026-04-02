// Draft Generator Module
// Converts deep research reports into newsletter-ready content
// Target: 18-40 year olds in Kerala who want to stay updated on AI

import { ResearchReport } from './types';
import { supabaseAdmin } from './supabase'; // RAG Support
import { callGemini } from './gemini-client';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Available models for draft generation
export const DRAFT_MODELS = [
    { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', description: 'Best writing quality' },
    { id: 'google/gemini-3.1-pro-preview', name: 'Gemini 3.1 Pro', description: 'Google flagship' },
    { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'OpenAI flagship' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', description: 'Powerful reasoning' },
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini Flash', description: 'Fast & reliable' },
] as const;

export type DraftModelId = typeof DRAFT_MODELS[number]['id'];
export const DEFAULT_DRAFT_MODEL: DraftModelId = 'google/gemini-3.1-pro-preview';
export const DEFAULT_INTRO_MODEL: DraftModelId = 'anthropic/claude-sonnet-4.5';

// Newsletter draft structure
export interface NewsletterDraft {
    title: string;
    subtitle: string;
    date: string;
    memeIdeas: MemeIdea[]; // Meme suggestions for the intro image
    intro: string;
    toc: string[];
    stories: StoryBlock[];
    quickSummary: string;
    rawMarkdown: string;
}

// Meme idea for intro image
export interface MemeIdea {
    templateName: string;     // e.g., "Distracted Boyfriend", "Drake Hotline Bling"
    topText: string;          // Text for top of meme
    bottomText: string;       // Text for bottom of meme
    angle: string;            // The comedic angle/approach
}

export interface StoryBlock {
    emoji: string;
    title: string;
    hookParagraph: string;
    bulletPoints: string[];      // The details — key facts
    whyItMatters: string;        // Why it matters — paragraph
    l8rsTake: string;            // 💡 L8R's Take — paragraph
    imageUrl?: string;           // Generated image URL for this story
}

interface DraftGenerationResult {
    success: boolean;
    draft?: NewsletterDraft;
    error?: string;
    ragInfo?: {
        used: boolean;
        newslettersFound: number;
        newsletterNames: string[];
    };
    modelsUsed?: {
        intro: DraftModelId;
        stories: DraftModelId;
    };
}

/**
 * Generate a complete newsletter draft from research reports.
 * The order of reports determines story priority (first = main story).
 */
export async function generateNewsletterDraft(
    reports: ResearchReport[],
    apiKey: string,
    modelId?: DraftModelId,
    introModelId?: DraftModelId,
    currentDate?: string
): Promise<DraftGenerationResult> {
    if (reports.length === 0) {
        return { success: false, error: 'No research reports provided' };
    }

    // Use different models: Claude Sonnet for intro/title, Gemini 3.1 Pro for stories
    const storyModel = modelId || DEFAULT_DRAFT_MODEL;
    const introModel = introModelId || DEFAULT_INTRO_MODEL;
    const dateContext = currentDate || new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

    // Create a clean summary of each research report to pass to AI
    const researchSummaries = reports.map((r, i) => {
        // Extract the actual research content
        const content = r.deepResearch || r.story.summary;
        return `
STORY ${i + 1}: ${r.story.headline}
Category: ${r.story.category}
Research Content:
${content}
`;
    }).join('\n---\n');



    const systemPrompt = `You are Alex — a 25-year-old AI creator and entrepreneur from Kerala, India. You write "L8R by Innov8," an AI newsletter for young Malayalis (18-40) who want to stay updated on AI.

## CURRENT DATE: ${dateContext}
⚠️ CRITICAL: Today is ${dateContext}. Verify ALL date references. Do NOT say "Q1 2025" or use outdated timelines. We are in 2026.

## WHO YOU ARE:
- CS grad turned content creator (YouTube, Instagram, Newsletter)
- You USE AI daily. You're not just reporting on it — you're in the trenches.
- You're a witty friend who explains things, not a hype-man or a journalist.
- You give straight, unbiased takes. If something is overhyped, you say so. If it's actually groundbreaking, you give it the credit.

## YOUR READERS:
- 18-40 year old Malayalis curious about AI
- NOT technical experts — normal people who want to know how AI affects THEM
- Busy — they SCAN, they don't read. Scannability is CRITICAL.
- They appreciate casual, fun writing with personality

## YOUR WRITING STYLE:
- **Simple English.** Grade 5-6 level. No jargon.
- **Short sentences.** One idea per sentence. Punchy.
- **Scannable.** Bullet points must be 1-2 lines MAX. No walls of text.
- Use **bold** for company names, numbers, key terms.
- Use emojis naturally: 🧠 💰 🤖 🚨 ⏭️ 🔥 💀 🤯 😭
- Be conversational. Talk TO the reader ("You", "Your").
- Self-deprecating humor is your thing ("I spent 5 hours testing this so you don't have to").
- Rhetorical questions are great ("Want to know the crazy part?").

## HYPE CALIBRATION:
- Default: "Another day, another model." Don't overhype.
- Exception: If a major benchmark is broken or something is genuinely huge, match the energy.
- Always give YOUR opinion. Strong takes. "This is clearly better than X."

## MANGLISH (Malayalam + English):
- Use Manglish ONLY for the outro and occasional casual asides.
- Example outro: "Ithrollu innathe AI Update. appo adutha l8ril varam.. bie."
- Don't force it. Keep it natural.

## NEVER USE:
- Technical jargon (tokens, parameters, fine-tuning, API, inference, etc.)
- Corporate speak (synergy, leverage, paradigm, ecosystem)
- Vague hedging (might, could potentially, remains to be seen)
- Placeholder text like "Point 1" or "Impact 1" — ALWAYS write real content
- Outdated date references (we are in ${dateContext}, not 2024 or early 2025)
- Overly formal language

## HUMANIZE YOUR WRITING (Kill AI patterns):

**BANNED WORDS & PHRASES:**
- "testament to" / "serves as" / "stands as" / "marks a pivotal"
- "underscores" / "highlights" / "emphasizes" / "showcases"
- "evolving landscape" / "broader implications" / "crucial role"
- "Additionally" / "Moreover" / "Furthermore" (use simpler connectors)
- "delve" / "foster" / "garner" / "interplay" / "intricate"
- "It's not just X, it's Y" (negative parallelisms)
- "vibrant" / "groundbreaking" / "breathtaking" / "nestled in"

**STRUCTURE RULES:**
- VARY sentence length. Short punchy ones. Then longer flowing ones.
- Use "is" and "are" directly. Not "serves as" or "represents".
- NO rule-of-three padding ("innovation, inspiration, and industry insights")
- NO em-dash overuse. One per section max.
- NO vague attributions ("experts say" / "industry reports")

**ADD SOUL:**
- Have opinions. React to facts. "This is wild because..." 
- Acknowledge mixed feelings. "Impressive but also kinda weird."
- Use first person when it fits. "Here's what gets me..."
- Be specific about feelings. Not "concerning" but "there's something unsettling about..."
- Let some personality in. You're Alex, not a press release.`;

    // RAG: Fetch past newsletters to use as style reference
    let ragContext = "";
    let ragInfo = { used: false, newslettersFound: 0, newsletterNames: [] as string[] };

    console.log('[RAG] Attempting to fetch past newsletters from Supabase...');

    if (supabaseAdmin) {
        try {
            // First try ordering by imported_at, fallback to created_at or id
            const { data: pastExamples, error: ragError } = await supabaseAdmin
                .from('past_newsletters')
                .select('content_text, file_name, imported_at')
                .order('imported_at', { ascending: false, nullsFirst: false })
                .limit(2);

            if (ragError) {
                console.error('[RAG] Supabase query error:', ragError);
            } else if (pastExamples && pastExamples.length > 0) {
                console.log(`[RAG] ✅ Found ${pastExamples.length} past newsletters to use as examples!`);
                pastExamples.forEach((ex: any, i: number) => {
                    console.log(`[RAG]   ${i + 1}. ${ex.file_name} (imported: ${ex.imported_at || 'NO DATE'})`);
                });

                ragInfo = {
                    used: true,
                    newslettersFound: pastExamples.length,
                    newsletterNames: pastExamples.map((ex: any) => ex.file_name || 'Unknown')
                };

                ragContext = `
## RECENT EXAMPLE (GOLD STANDARD):
Here is a recent newsletter you wrote. **MIMIC THIS VOICE, STRUCTURE, AND FORMATTING EXACTLY.**
Notice how short the sentences are. Notice the emojis. Notice the "Bottom Line" sections.

${pastExamples.map((ex: any, i: number) => `--- EXAMPLE ${i + 1} ---\n${ex.content_text.substring(0, 3000)}...`).join('\n\n')}
`;
                console.log(`[RAG] Added ${ragContext.length} characters of context to prompt`);
            } else {
                console.warn('[RAG] ⚠️ No past newsletters found in database!');
            }
        } catch (e) {
            console.error('[RAG] Failed to fetch past newsletters:', e);
        }
    } else {
        console.warn('[RAG] ⚠️ supabaseAdmin not configured - skipping RAG');
    }

    const finalSystemPrompt = systemPrompt + ragContext;


    const userPrompt = `Write a complete newsletter from these ${reports.length} AI stories:

${researchSummaries}

## NEWSLETTER FORMAT:

---

# [CATCHY TITLE BASED ON MAIN STORY - Make it punchy, not clickbait]

PLUS: [Short teaser for story 2] | [Short teaser for story 3]

---

## 🎭 MEME IDEAS (For intro image - based on main story)

Generate 3 DISTINCT meme concepts. Do not just use "Drake" or "Distracted Boyfriend" unless perfect.
Consider these templates: "Expanding Brain", "Two Buttons", "Change My Mind", "Buff Doge vs Cheems", "Leonardo DiCaprio Laughing", "They Don't Know", "Trade Offer", "Panik Kalm Panik", "Anakin Padme", "X, X Everywhere".

For each idea:
- **Template:** [Name of the meme template]
- **Top Text:** [Setup]
- **Bottom Text:** [Punchline]
- **Angle:** [Why it's funny/ironic]

Focus on: irony, relatable reactions, tech industry absurdity, or the "Alex" perspective.
Make them actually funny for a 25-year-old.

---

## INTRO (This is crucial - it hooks the reader)

**Structure:**
1. Start with the MAIN STORY hook. 2-3 punchy sentences. What happened? Why should I care?
2. Then, tease the OTHER stories with quick questions or bullet points to create curiosity.
3. End EXACTLY with:

I'm Alex. Welcome to **L8R by Innov8**.
Let's dive deep 🧠👇

---

**In today's post:**
• 🎬 [Story 1 short title with emoji]
• 💰 [Story 2 short title with emoji]
• 📰 [Story 3 short title with emoji]

---

## FOR EACH STORY:

### [Emoji] [Story Title - Catchy, not boring]

[2-3 sentences. What happened? Explain it simply. Make the reader instantly get why this is worth knowing. Rhetorical questions work great here.]

**The details:**
• [Important fact — be specific. Use numbers, company names, dollar amounts.]
• [Another fact the reader needs to know.]
• [Something surprising or interesting from the research.]
• [Optional 4th point — only if genuinely important.]

**Why it matters:** [2-4 sentence paragraph. NOT bullets. Explain the "so what" — how does this affect regular people? What's the bigger picture? Write it like you're explaining to a friend why they should care.]

**💡 L8R's Take:** [2-3 sentence paragraph. NOT bullets. Your honest opinion. Don't hedge. Is this overhyped or the real deal? Give one clear takeaway.]

---

## After all stories:

### 🚀 Quick L8R Summary

• **[Story 1 keyword]:** [1 punchy sentence with **bold** keywords]
• **[Story 2 keyword]:** [1 punchy sentence with **bold** keywords]
• **[Story 3 keyword]:** [1 punchy sentence with **bold** keywords]

---

Ithrollu innathe AI Update.
appo adutha l8ril varam.. bie. ✌️

---

## CRITICAL RULES - READ BEFORE WRITING:

1. **SCANNABILITY IS KING.** "The details" bullets = 1 sentence each. Max 2 lines.
2. **Write ACTUAL content.** Never use placeholder text.
3. **Each section is DIFFERENT.** Hook = What happened. The details = Facts. Why it matters = Impact paragraph. L8R's Take = Opinion paragraph.
4. **Be specific.** Use company names, numbers, dates from the research.
5. **Hook first.** Opening sentences must grab attention immediately.
6. **"Why it matters" is a PARAGRAPH.** 2-4 flowing sentences. NO bullet points.
7. **"L8R's Take" is a PARAGRAPH.** Strong opinion. 2-3 sentences. NO bullet points.
8. **Max 4 bullets in "The details".** Less is more.
9. **NO subsections in Intro/TOC/Summary.** Only stories get subsections.
10. **Use the Manglish outro.** "Ithrollu innathe AI Update. appo adutha l8ril varam.. bie."`;

    try {
        console.log(`[Draft] Phase 1: Generating intro with ${introModel}`);
        console.log(`[Draft] Phase 2: Will generate stories with ${storyModel}`);

        // PHASE 1: Generate intro content with Claude Sonnet
        const introPrompt = `Write ONLY the intro portion of the newsletter:

${researchSummaries}

## GENERATE THESE SECTIONS ONLY:

# [CATCHY TITLE BASED ON MAIN STORY]

PLUS: [Short teaser for story 2] | [Short teaser for story 3]

---

## 🎭 MEME IDEAS (3 distinct concepts based on main story)

For each:
- **Template:** [Meme template name]
- **Top Text:** [Setup]
- **Bottom Text:** [Punchline]  
- **Angle:** [Why it's funny]

---

## INTRO

Start with MAIN STORY hook (2-3 punchy sentences). Then tease other stories. End with:
"I'm Alex. Welcome to **L8R by Innov8**. Let's dive deep 🧠👇"

---

**In today's post:**
• 🎬 [Story 1 title]
• 💰 [Story 2 title]
• 📰 [Story 3 title]

---

STOP HERE. Do NOT write the story sections.`;

        const introResponse = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8ai.local',
                'X-Title': 'Innov8 AI Draft Generator - Intro',
            },
            body: JSON.stringify({
                model: introModel,
                messages: [
                    { role: 'system', content: finalSystemPrompt },
                    { role: 'user', content: introPrompt },
                ],
                temperature: 0.7,
                max_tokens: 2500,
            }),
        });

        if (!introResponse.ok) {
            const errorText = await introResponse.text();
            return { success: false, error: `Intro API Error (${introModel}): ${introResponse.status} - ${errorText}` };
        }

        const introData = await introResponse.json();
        const introContent = introData.choices?.[0]?.message?.content || '';

        console.log(`[Draft] Phase 1 complete. Intro generated.`);

        // PHASE 2: Generate story sections with Gemini 3.1 Pro
        const storiesPrompt = `Continue the newsletter. Write ONLY the story sections and summary:

${researchSummaries}

The intro has already been written. Now write:

## FOR EACH STORY:

### [Emoji] [Story Title]

[2-3 sentences. What happened? Make the reader get why this matters.]

**The details:**
• [Key fact — specific, interesting, use numbers]
• [Key fact — what's new or surprising]
• [Key fact — context that makes it land]

**Why it matters:** [2-4 sentence paragraph. NOT bullets. How does this affect people? What's the bigger picture?]

**💡 L8R's Take:** [2-3 sentence paragraph. NOT bullets. Honest opinion, no hedging. One clear takeaway.]

---

### 🚀 Quick L8R Summary

• **[Story 1]:** [1 punchy sentence]
• **[Story 2]:** [1 punchy sentence]
• **[Story 3]:** [1 punchy sentence]

---

Ithrollu innathe AI Update.
appo adutha l8ril varam.. bie. ✌️`;

        // Use Gemini API directly for stories (free tier) if it's a Gemini model
        let storiesContent: string;
        let finishReason: string | undefined;

        const isGeminiModel = storyModel.startsWith('google/gemini-');
        if (isGeminiModel) {
            // Direct Gemini API call (free tier, bypasses OpenRouter)
            const geminiModelId = storyModel.replace('google/', '');
            const geminiResponse = await callGemini(storiesPrompt, {
                model: geminiModelId,
                systemInstruction: finalSystemPrompt,
                temperature: 0.7,
                maxOutputTokens: 8000,
            });
            storiesContent = geminiResponse.text;
            finishReason = storiesContent ? 'stop' : 'error';
        } else {
            // Non-Gemini models go through OpenRouter
            const storiesResponse = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://innov8ai.local',
                    'X-Title': 'Innov8 AI Draft Generator - Stories',
                },
                body: JSON.stringify({
                    model: storyModel,
                    messages: [
                        { role: 'system', content: finalSystemPrompt },
                        { role: 'user', content: storiesPrompt },
                    ],
                    temperature: 0.7,
                    max_tokens: 8000,
                }),
            });

            if (!storiesResponse.ok) {
                const errorText = await storiesResponse.text();
                return { success: false, error: `Stories API Error (${storyModel}): ${storiesResponse.status} - ${errorText}` };
            }

            const storiesData = await storiesResponse.json();
            storiesContent = storiesData.choices?.[0]?.message?.content || '';
            finishReason = storiesData.choices?.[0]?.finish_reason;
        }

        console.log(`[Draft] Phase 2 complete. Stories generated. Finish reason: ${finishReason}`);

        // Check for truncation
        if (finishReason === 'length') {
            console.warn('[Draft] ⚠️ Stories response was TRUNCATED due to token limit!');
        }

        // Combine both responses
        const fullContent = introContent + '\n\n' + storiesContent;

        if (!fullContent.trim()) {
            return { success: false, error: 'No content in API responses' };
        }

        // Parse the generated content into structured format
        const draft = parseNewsletterDraft(fullContent, reports);
        return { success: true, draft, ragInfo, modelsUsed: { intro: introModel, stories: storyModel } };

    } catch (error) {
        console.error('Draft generation error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

// Helper to assign emojis to stories
function getEmoji(index: number): string {
    const emojis = ['🧠', '💰', '🤖', '🔥', '⚡', '🎯', '💡', '🚀'];
    return emojis[index % emojis.length];
}

// Parse the raw markdown into structured sections
// This is a simplified parser that just splits by sections
function parseNewsletterDraft(content: string, reports: ResearchReport[]): NewsletterDraft {
    // Extract title (first # heading)
    const titleMatch = content.match(/^#\s+(.+?)$/m);
    const title = titleMatch ? titleMatch[1].trim() : reports[0].story.headline;

    // Extract subtitle (PLUS: line)
    const subtitleMatch = content.match(/PLUS:\s*(.+?)(?:\n|$)/i);
    const subtitle = subtitleMatch ? subtitleMatch[1].trim() : '';

    // Extract intro - everything between first --- and "In today's post"
    const introMatch = content.match(/Let's dive in.*?\n\n([\s\S]*?)(?=\*\*In today|In today's post|---)/i);
    const introRaw = content.match(/---\s*\n\n([\s\S]*?)I'm Alex/i);
    const intro = introRaw
        ? introRaw[1].trim() + "\n\nI'm Alex. Welcome to **L8R by Innov8**.\nLet's dive in 🧠👇"
        : '';

    // Extract TOC
    const tocMatch = content.match(/In today's post:\*?\*?\s*([\s\S]*?)(?=\n---|\n##)/i);
    const tocText = tocMatch ? tocMatch[1] : '';
    const toc = tocText
        .split('\n')
        .filter(line => line.trim().match(/^[•\-\*]/))
        .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
        .filter(line => line.length > 0);

    // Extract story blocks - look for emoji headers
    const storyEmojis = ['🧠', '💰', '🤖', '🔥', '⚡', '🎯', '💡', '🚀'];
    const stories: StoryBlock[] = [];

    for (let i = 0; i < reports.length; i++) {
        const emoji = storyEmojis[i % storyEmojis.length];

        // Find this story's section
        const escapedEmoji = emoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const nextEmoji = storyEmojis[(i + 1) % storyEmojis.length];
        const escapedNextEmoji = nextEmoji.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        // Try to match the story section
        let storyPattern: RegExp;
        if (i < reports.length - 1) {
            storyPattern = new RegExp(
                `##\\s*${escapedEmoji}\\s*([^\\n]+)\\n([\\s\\S]*?)(?=##\\s*[${storyEmojis.join('')}]|##\\s*🚀\\s*Quick)`,
                'i'
            );
        } else {
            storyPattern = new RegExp(
                `##\\s*${escapedEmoji}\\s*([^\\n]+)\\n([\\s\\S]*?)(?=##\\s*🚀\\s*Quick|---\\s*\\n\\s*That's)`,
                'i'
            );
        }

        const storyMatch = content.match(storyPattern);

        if (storyMatch) {
            const storyTitle = storyMatch[1].trim();
            const storyContent = storyMatch[2];

            // Extract sections
            const hookMatch = storyContent.match(/^([^*#\n]+(?:\n[^*#\n]+)*)/);
            const hookParagraph = hookMatch ? hookMatch[1].trim() : reports[i].story.summary;

            const bulletPoints = extractBulletsFromSection(storyContent, 'details|Key Points');
            const whyItMatters = extractParagraphFromSection(storyContent, 'Why it matters|Why This Matters');
            const l8rsTake = extractParagraphFromSection(storyContent, "L8R's Take");

            stories.push({
                emoji,
                title: storyTitle || reports[i].story.headline,
                hookParagraph,
                bulletPoints,
                whyItMatters,
                l8rsTake,
            });
        } else {
            // Fallback - use report data
            stories.push({
                emoji,
                title: reports[i].story.headline,
                hookParagraph: reports[i].story.summary,
                bulletPoints: extractFromResearch(reports[i].deepResearch, 'key'),
                whyItMatters: '',
                l8rsTake: '',
            });
        }
    }

    // Extract quick summary (matches "Quick Summary" or "Quick L8R Summary")
    const summaryMatch = content.match(/(?:##|###)\s*🚀\s*Quick(?:\s+L8R)?\s+Summary\s*([\s\S]*?)(?=---\s*\n\s*Ithrollu|---\s*\n\s*That's|$)/i);
    const quickSummary = summaryMatch ? summaryMatch[1].trim() : '';

    // Extract meme ideas
    const memeIdeas = extractMemeIdeas(content);

    // Validate stories - ensure each has complete sections
    for (let i = 0; i < stories.length; i++) {
        const story = stories[i];

        // Fill in missing sections with fallback if research available
        if (story.bulletPoints.length === 0 && reports[i]) {
            console.warn(`[Draft] Story ${i + 1} missing bulletPoints, using fallback`);
            story.bulletPoints = extractFromResearch(reports[i].deepResearch, 'key');
        }

        // Ensure minimum content
        if (story.bulletPoints.length === 0) {
            story.bulletPoints = ['[Key points to be filled]'];
        }
    }

    return {
        title,
        subtitle,
        date: new Date().toLocaleDateString('en-US', {
            year: 'numeric',
            month: 'long',
            day: 'numeric'
        }),
        memeIdeas,
        intro,
        toc,
        stories,
        quickSummary,
        rawMarkdown: content,
    };
}

// Extract meme ideas from content
function extractMemeIdeas(content: string): { templateName: string; topText: string; bottomText: string; angle: string }[] {
    const memeSection = content.match(/##\s*🎭\s*MEME IDEAS[\s\S]*?(?=---\s*\n\s*##\s*INTRO|---\s*\n\s*\*\*In today)/i);
    if (!memeSection) return [];

    const memes: { templateName: string; topText: string; bottomText: string; angle: string }[] = [];

    // Match each meme block
    const templateMatches = memeSection[0].matchAll(/\*\*Template:\*\*\s*([^\n]+)/gi);
    const topTextMatches = memeSection[0].matchAll(/\*\*Top Text:\*\*\s*([^\n]+)/gi);
    const bottomTextMatches = memeSection[0].matchAll(/\*\*Bottom Text:\*\*\s*([^\n]+)/gi);
    const angleMatches = memeSection[0].matchAll(/\*\*Angle:\*\*\s*([^\n]+)/gi);

    const templates = [...templateMatches].map(m => m[1].trim());
    const topTexts = [...topTextMatches].map(m => m[1].trim());
    const bottomTexts = [...bottomTextMatches].map(m => m[1].trim());
    const angles = [...angleMatches].map(m => m[1].trim());

    for (let i = 0; i < templates.length; i++) {
        memes.push({
            templateName: templates[i] || '',
            topText: topTexts[i] || '',
            bottomText: bottomTexts[i] || '',
            angle: angles[i] || '',
        });
    }

    return memes;
}

// Extract bullets from a specific section
function extractBulletsFromSection(content: string, sectionName: string): string[] {
    const namePattern = sectionName.includes('|') ? `(?:${sectionName})` : sectionName;
    const pattern = new RegExp(
        `\\*\\*[^*]*${namePattern}[^*]*\\*\\*:?\\s*\\n([\\s\\S]*?)(?=\\*\\*[^*]+\\*\\*:|##|$)`,
        'i'
    );
    const match = content.match(pattern);
    if (!match) return [];

    // Section header emojis that should NOT appear in bullet content
    const sectionEmojis = ['🔍', '🚨'];

    return match[1]
        .split('\n')
        .filter(line => line.trim().match(/^[•\-\*]/))
        .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
        .filter(line => {
            if (line.length === 0) return false;
            // Filter out placeholder text
            if (line.match(/^(Point|Impact|Watch|Fact)\s*\d/i)) return false;
            // Filter out lines that are actually section headers embedded in bullets
            if (sectionEmojis.some(emoji => line.includes(emoji) && line.includes('**'))) return false;
            // Filter out lines that look like section headers
            if (line.match(/^(\*\*)?(Key Points|The details|Why.*[Mm]atters|L8R's Take)/i)) return false;
            return true;
        });
}

// Fallback: extract content from research when parsing fails
// Extract a paragraph (not bullets) from a section like "Why it matters" or "L8R's Take"
function extractParagraphFromSection(content: string, sectionName: string): string {
    const pattern = new RegExp(
        `\\*\\*[^*]*(?:${sectionName})[^*]*\\*\\*:?\\s*([\\s\\S]*?)(?=\\*\\*[^*]+\\*\\*:|##|$)`,
        'i'
    );
    const match = content.match(pattern);
    if (!match) return '';

    // Get the text after the header, strip bullet markers if the LLM used them anyway
    const raw = match[1]
        .split('\n')
        .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
        .filter(line => line.length > 0)
        .join(' ');

    return raw;
}

function extractFromResearch(research: string, type: 'key' | 'matters' | 'next'): string[] {
    // Try to extract from the research sections
    const patterns: Record<string, RegExp> = {
        key: /(?:The Story|Key Points?|What Happened)[\s\S]*?((?:[•\-\*]\s*.+\n?)+)/i,
        matters: /(?:The Context|Why.*Matters|The Hot Take)[\s\S]*?((?:[•\-\*]\s*.+\n?)+)/i,
        next: /(?:What's Next|Future|Watch For)[\s\S]*?((?:[•\-\*]\s*.+\n?)+)/i,
    };

    const match = research.match(patterns[type]);
    if (match) {
        return match[1]
            .split('\n')
            .filter(line => line.trim().match(/^[•\-\*]/))
            .map(line => line.replace(/^[•\-\*]\s*/, '').trim())
            .filter(line => line.length > 0)
            .slice(0, 4);
    }

    // If no bullets found, try to extract first few sentences
    const sentences = research.split(/[.!?]+/).filter(s => s.trim().length > 20);
    return sentences.slice(0, 3).map(s => s.trim());
}

// Helper for standalone meme generation (Regenerate button)
export async function generateStandaloneMemeIdeas(
    storyHeadline: string,
    storySummary: string,
    apiKey: string,
    modelId?: DraftModelId
) {
    const selectedModel = modelId || 'x-ai/grok-4.1-fast'; // Default to fast model for memes

    const prompt = `You are a viral meme generator for a Gen Z/Millennial AI newsletter.
    
    Story: ${storyHeadline}
    Context: ${storySummary}
    
    Task: Generate 3 DISTINCT meme concepts about this story.
    Target Audience: Tech-savvy 25-year-olds.
    Tone: Ironic, funny, maybe a bit cynical but ultimately excited about AI.
    
    Use these templates for inspiration: "Expanding Brain", "Two Buttons", "Change My Mind", "Buff Doge vs Cheems", "Leonardo DiCaprio Laughing", "They Don't Know", "Trade Offer", "Panik Kalm Panik", "Anakin Padme", "X, X Everywhere".

    Return ONLY a JSON array with this structure:
    [
      { "templateName": "string", "topText": "string", "bottomText": "string", "angle": "string" }
    ]
    `;

    try {
        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8ai.local',
                'X-Title': 'Innov8 AI Meme Gen',
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: [
                    { role: 'system', content: "You are a creative meme generator. Return JSON only." },
                    { role: 'user', content: prompt },
                ],
                temperature: 0.9, // High creativity
            }),
        });

        if (!response.ok) throw new Error('API Error');

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        // Clean markdown code blocks if present
        const cleanContent = content.replace(/```json\n?|\n?```/g, '').trim();

        const ideas = JSON.parse(cleanContent);
        return { success: true, ideas };

    } catch (error) {
        console.error('Meme generation error:', error);
        return { success: false, error: 'Failed to generate memes' };
    }
}
