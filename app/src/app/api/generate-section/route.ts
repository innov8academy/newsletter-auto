// API Route: Section-Specific Newsletter Generator
// POST /api/generate-section - Generate individual newsletter sections

import { NextRequest, NextResponse } from 'next/server';
import { DraftModelId, DEFAULT_DRAFT_MODEL, DEFAULT_INTRO_MODEL } from '@/lib/draft-generator';
import { ResearchReport } from '@/lib/types';
import { calculateCost } from '@/lib/cost-tracker';
import { supabaseAdmin } from '@/lib/supabase';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

type SectionType = 'title' | 'intro' | 'toc' | 'story' | 'summary';

interface GenerateSectionRequest {
    sectionType: SectionType;
    storyIndex?: number; // For 'story' type
    researchReports: ResearchReport[];
    modelId?: DraftModelId;
    userInput?: string; // Custom user instructions
}

// Extract section-specific content from past newsletters for optimized RAG
async function getSectionRAG(sectionType: SectionType): Promise<string> {
    if (!supabaseAdmin) return '';

    try {
        const { data: pastNewsletters, error } = await supabaseAdmin
            .from('past_newsletters')
            .select('content_text, file_name')
            .order('imported_at', { ascending: false, nullsFirst: false })
            .limit(2);

        if (error || !pastNewsletters?.length) return '';

        const extractedSections = pastNewsletters.map((nl: any) => {
            const content = nl.content_text || '';

            switch (sectionType) {
                case 'title':
                    // Extract first heading (title)
                    const titleMatch = content.match(/^#\s+(.+?)(?:\n|$)/m);
                    const subtitleMatch = content.match(/PLUS:\s*(.+?)(?:\n|$)/i);
                    return titleMatch ? `Title: ${titleMatch[1]}\n${subtitleMatch ? `Subtitle: ${subtitleMatch[1]}` : ''}` : '';

                case 'intro':
                    // Extract intro section (between title and "In today's post")
                    const introMatch = content.match(/---\s*\n\n([\s\S]*?)I'm Alex/i);
                    return introMatch ? introMatch[1].trim() : '';

                case 'story':
                    // Extract a sample story block
                    const storyMatch = content.match(/###\s*[🧠💰🤖🔥⚡🎯💡🚀🎬📰🏥]\s*([^\n]+)\n([\s\S]*?)(?=###\s*[🧠💰🤖🔥⚡🎯💡🚀🎬📰🏥]|###\s*🚀\s*Quick)/);
                    return storyMatch ? `${storyMatch[1]}\n${storyMatch[2].substring(0, 800)}` : '';

                case 'summary':
                    // Extract Quick Summary section
                    const summaryMatch = content.match(/###?\s*🚀\s*Quick.*?Summary\s*([\s\S]*?)(?=---\s*\n\s*Ithrollu|$)/i);
                    return summaryMatch ? summaryMatch[1].trim() : '';

                default:
                    return '';
            }
        }).filter(Boolean);

        if (extractedSections.length === 0) return '';

        return `\n## PAST EXAMPLES (match this style):\n${extractedSections.map((s, i) => `--- Example ${i + 1} ---\n${s}`).join('\n\n')}\n`;
    } catch (e) {
        console.error('[Section RAG] Error:', e);
        return '';
    }
}

// Get current date context
function getCurrentDate(): string {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// Base system prompt for Alex persona
function getBaseSystemPrompt(dateContext: string): string {
    return `You are Alex — a 25-year-old AI creator from Kerala, India. You write "L8R by Innov8."

## CURRENT DATE: ${dateContext}
⚠️ CRITICAL DATE RULES:
- Today is ${dateContext}. We are in January 2026.
- Do NOT reference "Q1 2025", "late 2024", or any outdated timelines
- All predictions should be from TODAY forward
- If something happened in the past, use specific dates like "in December 2025"
- NEVER say "upcoming 2025" or "next year 2025" — we're past that!

## YOUR STYLE:
- Simple English (Grade 5-6)
- Short, punchy sentences
- Scannable bullets (1-2 lines max)
- Use **bold** for key terms
- Emojis: 🧠 💰 🤖 🚨 ⏭️ 🔥 💀 🤯 😭
- Talk TO the reader ("You", "Your")
- Strong opinions, no hedging

## NEVER USE:
- Technical jargon
- Corporate speak
- Vague hedging
- Placeholder text
- Outdated date references`;
}

// Section-specific prompts
function getSectionPrompt(
    sectionType: SectionType,
    researchSummaries: string,
    storyIndex?: number,
    userInput?: string
): string {
    const userNote = userInput ? `\n\n## USER INSTRUCTIONS:\n${userInput}` : '';

    switch (sectionType) {
        case 'title':
            return `Generate ONLY the title and subtitle for this newsletter.

${researchSummaries}

## OUTPUT FORMAT:
# [CATCHY TITLE - punchy, not clickbait, based on main story]

PLUS: [Short teaser for story 2] | [Short teaser for story 3]

Output ONLY these two lines. Nothing else.${userNote}`;

        case 'intro':
            return `Generate ONLY the introduction paragraph.

${researchSummaries}

## OUTPUT FORMAT:
[2-3 punchy sentences about the MAIN story hook. What happened? Why should I care?]

But wait, there's more:
• [Tease story 2 with a question or exciting fact]
• [Tease story 3]
• [Tease story 4 if applicable]

I'm Alex. Welcome to **L8R by Innov8**.
Let's dive deep 🧠👇

Output ONLY the intro paragraph. Nothing else.${userNote}`;

        case 'toc':
            return `Generate ONLY the "In today's post" table of contents.

${researchSummaries}

## STRICT OUTPUT FORMAT - NO DEVIATIONS:
**In today's post:**
• 🎬 [Story 1 catchy title - MAX 6 words]
• 💰 [Story 2 catchy title - MAX 6 words]
• 📰 [Story 3 catchy title - MAX 6 words]

## CRITICAL RULES:
- Output EXACTLY 3 bullet points (or match number of stories)
- Each bullet = ONE emoji + short catchy title ONLY
- NO explanations, NO descriptions after the title
- NO "The details", NO "Why it matters", NO "L8R's Take"
- NO additional formatting or sections
- STOP immediately after the last bullet point

Output ONLY the TOC. Nothing else.${userNote}`;

        case 'story':
            return `Generate ONLY story section #${(storyIndex || 0) + 1}.

${researchSummaries}

## OUTPUT FORMAT:
### [Emoji] [Catchy Story Title]

[2-3 sentences. What happened and why it's a big deal. Simple words, grab attention.]

**The details:**
• [Key fact — specific numbers, names, context]
• [Key fact — what's new or surprising]
• [Key fact — something interesting from the research]

**Why it matters:** [2-4 sentence paragraph. NOT bullets. Connect the dots — how does this affect people? What's the bigger picture?]

**💡 L8R's Take:** [2-3 sentence paragraph. NOT bullets. Honest opinion, no hedging. One clear takeaway.]

## RULES:
- Each bullet in "The details" = 1 sentence MAX
- "Why it matters" and "L8R's Take" are PARAGRAPHS, not bullets
- Be specific with company names, numbers, dates
- All dates must be from January 2026 forward

Output ONLY this story section. Nothing else.${userNote}`;

        case 'summary':
            return `Generate ONLY the Quick Summary section.

${researchSummaries}

## OUTPUT FORMAT:
### 🚀 Quick L8R Summary

• **[Story 1 keyword]:** [1 punchy sentence with **bold** keywords]
• **[Story 2 keyword]:** [1 punchy sentence]
• **[Story 3 keyword]:** [1 punchy sentence]

---

Ithrollu innathe AI Update.
appo adutha l8ril varam.. bie. ✌️

Output ONLY the summary and outro. Nothing else.${userNote}`;

        default:
            return researchSummaries;
    }
}

export async function POST(request: NextRequest) {
    try {
        const body = await request.json() as GenerateSectionRequest;
        const { sectionType, storyIndex, researchReports, modelId, userInput } = body;

        const apiKey = process.env.OPENROUTER_API_KEY || '';

        if (!apiKey) {
            return NextResponse.json({ success: false, error: 'API key not configured' }, { status: 400 });
        }

        if (!researchReports?.length) {
            return NextResponse.json({ success: false, error: 'No research reports provided' }, { status: 400 });
        }

        // Choose model based on section type
        const defaultModel = (sectionType === 'title' || sectionType === 'intro')
            ? DEFAULT_INTRO_MODEL
            : DEFAULT_DRAFT_MODEL;
        const selectedModel = modelId || defaultModel;

        const dateContext = getCurrentDate();

        // Get section-specific RAG
        const ragContext = await getSectionRAG(sectionType);

        // Build research summaries - FOR STORY TYPE, FOCUS ON ONLY THE TARGET STORY
        let researchSummaries: string;

        if (sectionType === 'story' && storyIndex !== undefined && researchReports[storyIndex]) {
            // For story generation: Send ONLY the target story's research
            const targetReport = researchReports[storyIndex];
            researchSummaries = `
## TARGET STORY TO GENERATE (Story ${storyIndex + 1} of ${researchReports.length}):

**Headline:** ${targetReport.story.headline}
**Category:** ${targetReport.story.category}
**Source:** ${targetReport.story.sources?.[0] || 'Unknown'}

**Full Research:**
${targetReport.deepResearch || targetReport.story.summary}

---
IMPORTANT: Generate content ONLY for this specific story above. Do NOT mix content from other stories.
`;
            console.log(`[Section] Story ${storyIndex + 1} focus: "${targetReport.story.headline.substring(0, 50)}..."`);
        } else {
            // For other sections (title, intro, toc, summary): Send all stories for context
            researchSummaries = researchReports.map((r, i) => `
STORY ${i + 1}: ${r.story.headline}
Category: ${r.story.category}
Summary: ${(r.deepResearch || r.story.summary || '').substring(0, 500)}...
`).join('\n---\n');
        }

        // Build prompts
        const systemPrompt = getBaseSystemPrompt(dateContext) + ragContext;
        const userPrompt = getSectionPrompt(sectionType, researchSummaries, storyIndex, userInput);

        console.log(`[Section] Generating ${sectionType}${storyIndex !== undefined ? ` #${storyIndex + 1}` : ''} with ${selectedModel}`);
        console.log(`[Section] RAG: ${ragContext.length > 0 ? `${ragContext.length} chars` : 'none'}`);
        if (userInput) console.log(`[Section] User input: "${userInput.substring(0, 50)}..."`);

        const startTime = Date.now();

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8ai.local',
                'X-Title': `Innov8 AI - ${sectionType}`,
            },
            body: JSON.stringify({
                model: selectedModel,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userPrompt },
                ],
                temperature: 0.7,
                max_tokens: sectionType === 'story' ? 4000 : 1000, // Increased for full story content
            }),
        };

        // Retry logic - try up to 2 times for empty responses
        let content: string | null = null;
        let lastError: string | null = null;
        const maxRetries = 2;

        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            try {
                console.log(`[Section] Attempt ${attempt}/${maxRetries}...`);

                const response = await fetch(OPENROUTER_API_URL, fetchOptions);

                if (!response.ok) {
                    const errorText = await response.text();
                    lastError = `API Error (${selectedModel}): ${response.status} - ${errorText.substring(0, 200)}`;
                    console.error(`[Section] Attempt ${attempt} failed: ${lastError}`);
                    if (attempt < maxRetries) continue;
                    break;
                }

                const data = await response.json();
                content = data.choices?.[0]?.message?.content?.trim();
                const finishReason = data.choices?.[0]?.finish_reason;

                // Check for truncation
                if (finishReason === 'length') {
                    console.warn(`[Section] ⚠️ Response TRUNCATED (finish_reason: length)`);
                }

                if (!content || content.length < 50) {
                    lastError = `Empty or too short response (${content?.length || 0} chars, finish: ${finishReason})`;
                    console.warn(`[Section] Attempt ${attempt}: ${lastError}`);
                    if (attempt < maxRetries) continue;
                    break;
                }

                // For story type, validate we got all sections
                if (sectionType === 'story') {
                    const hasDetails = content.includes('The details') || content.includes('Key Points') || content.includes('🔍');
                    const hasWhyMatters = content.includes('Why it matters') || content.includes('Why This Matters') || content.includes('🚨');
                    const hasL8rsTake = content.includes("L8R's Take") || content.includes('💡');

                    if (!hasDetails || !hasWhyMatters || !hasL8rsTake) {
                        console.warn(`[Section] Story missing sections: Details=${hasDetails}, WhyMatters=${hasWhyMatters}, L8rsTake=${hasL8rsTake}`);
                        lastError = `Incomplete story - missing sections (finish: ${finishReason})`;
                        if (attempt < maxRetries) continue;
                    }
                }

                // Success!
                console.log(`[Section] Success on attempt ${attempt}, ${content.length} chars, finish: ${finishReason}`);
                break;

            } catch (err) {
                lastError = err instanceof Error ? err.message : 'Network error';
                console.error(`[Section] Attempt ${attempt} error:`, lastError);
                if (attempt < maxRetries) continue;
            }
        }

        if (!content) {
            return NextResponse.json({
                success: false,
                error: lastError || 'No content after retries',
                debug: { attempts: maxRetries, lastError }
            }, { status: 500 });
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        console.log(`[Section] ${sectionType} generated in ${duration}s`);

        // Estimate cost
        const inputTokens = systemPrompt.length / 4 + userPrompt.length / 4;
        const outputTokens = content.length / 4;
        const cost = calculateCost(selectedModel, inputTokens, outputTokens);

        return NextResponse.json({
            success: true,
            content,
            sectionType,
            storyIndex,
            model: selectedModel,
            duration: parseFloat(duration),
            cost,
            costSource: `section-${sectionType}`,
            // For debugging/preview
            promptPreview: {
                systemPromptLength: systemPrompt.length,
                userPromptLength: userPrompt.length,
                ragIncluded: ragContext.length > 0,
                userInputIncluded: !!userInput,
            },
        });

    } catch (error) {
        console.error('[Section] Error:', error);
        return NextResponse.json({
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        }, { status: 500 });
    }
}
