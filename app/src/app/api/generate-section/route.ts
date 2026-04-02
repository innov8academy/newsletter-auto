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
    storyIndex?: number;
    researchReports: ResearchReport[];
    modelId?: DraftModelId;
    userInput?: string;
}

interface StorySectionResponse {
    title: string;
    hookParagraph: string;
    bulletPoints: string[];
    whyItMatters: string;
    l8rsTake: string;
}

function stripCodeFences(content: string): string {
    return content
        .replace(/^```json\s*/i, '')
        .replace(/^```\s*/i, '')
        .replace(/\s*```$/i, '')
        .trim();
}

function parseStorySectionFromMarkdown(content: string): Partial<StorySectionResponse> {
    const cleaned = stripCodeFences(content);
    const lines = cleaned.split(/\r?\n/);
    const sections: Record<'details' | 'whyItMatters' | 'l8rsTake', string[]> = {
        details: [],
        whyItMatters: [],
        l8rsTake: [],
    };

    let title = '';
    const hookLines: string[] = [];
    let currentSection: keyof typeof sections | null = null;

    const detectSection = (line: string): { type: keyof typeof sections; inline: string } | null => {
        const normalized = line
            .replace(/^#+\s*/, '')
            .replace(/\*\*/g, '')
            .replace(/__/g, '')
            .replace(/^>\s*/, '')
            .trim()
            .replace(/^[^A-Za-z0-9]+/, '')
            .trim();
        const lower = normalized.toLowerCase();

        const candidates: Array<{ label: string; type: keyof typeof sections }> = [
            { label: 'the details', type: 'details' },
            { label: 'key points', type: 'details' },
            { label: 'why it matters', type: 'whyItMatters' },
            { label: 'why this matters', type: 'whyItMatters' },
            { label: "l8r's take", type: 'l8rsTake' },
            { label: 'l8rs take', type: 'l8rsTake' },
        ];

        for (const candidate of candidates) {
            if (lower.startsWith(candidate.label)) {
                const inline = normalized
                    .slice(candidate.label.length)
                    .replace(/^[:\-\s]+/, '')
                    .trim();
                return { type: candidate.type, inline };
            }
        }

        return null;
    };

    for (const rawLine of lines) {
        const line = rawLine.trim();
        if (!line) {
            continue;
        }

        if (!title) {
            const titleMatch = line.match(/^#{2,3}\s*(.+)$/);
            if (titleMatch) {
                title = titleMatch[1].replace(/^[^A-Za-z0-9]+/, '').trim();
                continue;
            }
        }

        const section = detectSection(line);
        if (section) {
            currentSection = section.type;
            if (section.inline) {
                sections[section.type].push(section.inline);
            }
            continue;
        }

        if (currentSection) {
            sections[currentSection].push(line);
        } else {
            hookLines.push(line);
        }
    }

    const bulletPoints = sections.details
        .flatMap((line) => line.split(/\s+(?=[*-]\s|[•]\s)/))
        .map((line) => line.replace(/^[•*-]\s*/, '').trim())
        .filter((line) => line.length > 0)
        .slice(0, 4);

    const joinParagraph = (linesToJoin: string[]) =>
        linesToJoin
            .map((line) => line.replace(/^[•*-]\s*/, '').trim())
            .filter((line) => line.length > 0)
            .join(' ');

    return {
        title,
        hookParagraph: hookLines.join(' ').trim(),
        bulletPoints,
        whyItMatters: joinParagraph(sections.whyItMatters),
        l8rsTake: joinParagraph(sections.l8rsTake),
    };
}

function normalizeStorySection(candidate: unknown): StorySectionResponse | null {
    if (!candidate || typeof candidate !== 'object') {
        return null;
    }

    const raw = candidate as Partial<StorySectionResponse> & { bulletPoints?: unknown };
    const title = typeof raw.title === 'string' ? raw.title.trim() : '';
    const hookParagraph = typeof raw.hookParagraph === 'string' ? raw.hookParagraph.trim() : '';
    const whyItMatters = typeof raw.whyItMatters === 'string' ? raw.whyItMatters.trim() : '';
    const l8rsTake = typeof raw.l8rsTake === 'string' ? raw.l8rsTake.trim() : '';

    const bulletPointsRaw: unknown = raw.bulletPoints;
    const bulletPoints = Array.isArray(bulletPointsRaw)
        ? bulletPointsRaw
            .map((item) => (typeof item === 'string' ? item.trim() : ''))
            .filter((item) => item.length > 0)
            .slice(0, 4)
        : typeof bulletPointsRaw === 'string'
            ? bulletPointsRaw
                .split(/\r?\n/)
                .map((line) => line.replace(/^[•*-]\s*/, '').trim())
                .filter((line) => line.length > 0)
                .slice(0, 4)
            : [];

    if (!title || !hookParagraph || bulletPoints.length === 0 || !whyItMatters || !l8rsTake) {
        return null;
    }

    return {
        title,
        hookParagraph,
        bulletPoints,
        whyItMatters,
        l8rsTake,
    };
}

async function getSectionRAG(sectionType: SectionType): Promise<string> {
    if (!supabaseAdmin) return '';

    try {
        const { data: pastNewsletters, error } = await supabaseAdmin
            .from('past_newsletters')
            .select('content_text, file_name')
            .order('imported_at', { ascending: false, nullsFirst: false })
            .limit(2);

        if (error || !pastNewsletters?.length) return '';

        const extractedSections = pastNewsletters
            .map((newsletter: { content_text?: string }) => {
                const content = newsletter.content_text || '';

                switch (sectionType) {
                    case 'title': {
                        const titleMatch = content.match(/^#\s+(.+?)(?:\n|$)/m);
                        const subtitleMatch = content.match(/PLUS:\s*(.+?)(?:\n|$)/i);
                        return titleMatch
                            ? `Title: ${titleMatch[1]}\n${subtitleMatch ? `Subtitle: ${subtitleMatch[1]}` : ''}`
                            : '';
                    }
                    case 'intro': {
                        const introMatch = content.match(/---\s*\n\n([\s\S]*?)I'm Alex/i);
                        return introMatch ? introMatch[1].trim() : '';
                    }
                    case 'story': {
                        const storyMatch = content.match(
                            /###\s*[^\n]+\n([\s\S]*?)(?=###\s*[^\n]+|###\s*Quick|$)/i
                        );
                        return storyMatch ? storyMatch[0].substring(0, 900) : '';
                    }
                    case 'summary': {
                        const summaryMatch = content.match(
                            /###?\s*Quick.*?Summary\s*([\s\S]*?)(?=---\s*\n\s*Ithrollu|$)/i
                        );
                        return summaryMatch ? summaryMatch[1].trim() : '';
                    }
                    default:
                        return '';
                }
            })
            .filter(Boolean);

        if (extractedSections.length === 0) return '';

        return `\n## PAST EXAMPLES (match this style):\n${extractedSections
            .map((section, index) => `--- Example ${index + 1} ---\n${section}`)
            .join('\n\n')}\n`;
    } catch (error) {
        console.error('[Section RAG] Error:', error);
        return '';
    }
}

function getCurrentDate(): string {
    return new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function getBaseSystemPrompt(dateContext: string): string {
    return `You are Alex, a 25-year-old AI creator from Kerala, India. You write "L8R by Innov8."

## CURRENT DATE: ${dateContext}
- Today is ${dateContext}.
- Do not reference outdated timelines.
- If something happened in the past, use a specific date.

## YOUR STYLE:
- Simple English. Grade 5-6 level.
- Short, punchy sentences.
- Talk to the reader.
- Strong opinions, no hedging.
- Avoid jargon and corporate speak.`;
}

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
# [CATCHY TITLE]
PLUS: [Short teaser for story 2] | [Short teaser for story 3]

Output ONLY these two lines.${userNote}`;

        case 'intro':
            return `Generate ONLY the introduction paragraph.

${researchSummaries}

## OUTPUT FORMAT:
[2-3 punchy sentences about the main story.]

But wait, there's more:
- [Tease story 2]
- [Tease story 3]

I'm Alex. Welcome to **L8R by Innov8**.
Let's dive deep.

Output ONLY the intro paragraph.${userNote}`;

        case 'toc':
            return `Generate ONLY the "In today's post" table of contents.

${researchSummaries}

## OUTPUT FORMAT:
**In today's post:**
- [Story 1 catchy title]
- [Story 2 catchy title]
- [Story 3 catchy title]

Output ONLY the TOC.${userNote}`;

        case 'story':
            return `Generate ONLY story section #${(storyIndex || 0) + 1}.

${researchSummaries}

## OUTPUT FORMAT:
Return ONLY a valid JSON object with this exact structure:
{
  "title": "Catchy Story Title",
  "hookParagraph": "2-3 sentences. What happened and why it matters.",
  "bulletPoints": [
    "Key fact with numbers or names",
    "Key fact about what is new or surprising",
    "Key fact that helps the reader understand the story"
  ],
  "whyItMatters": "2-4 sentence paragraph. Not bullets. Explain the bigger picture.",
  "l8rsTake": "2-3 sentence paragraph. Honest opinion, no hedging, one clear takeaway."
}

## RULES:
- Output JSON only. No markdown. No code fences. No extra keys.
- bulletPoints must be an array of 3-4 one-sentence strings.
- whyItMatters and l8rsTake must be plain strings, not arrays.
- Be specific with company names, numbers, and dates.

Output ONLY this JSON object.${userNote}`;

        case 'summary':
            return `Generate ONLY the Quick Summary section.

${researchSummaries}

## OUTPUT FORMAT:
### Quick L8R Summary
- **[Story 1 keyword]:** [1 punchy sentence]
- **[Story 2 keyword]:** [1 punchy sentence]
- **[Story 3 keyword]:** [1 punchy sentence]

---

Ithrollu innathe AI Update.
appo adutha l8ril varam.. bie.

Output ONLY the summary and outro.${userNote}`;

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

        const defaultModel =
            sectionType === 'title' || sectionType === 'intro' ? DEFAULT_INTRO_MODEL : DEFAULT_DRAFT_MODEL;
        const selectedModel = modelId || defaultModel;
        const dateContext = getCurrentDate();
        const ragContext = await getSectionRAG(sectionType);

        let researchSummaries: string;

        if (sectionType === 'story' && storyIndex !== undefined && researchReports[storyIndex]) {
            const targetReport = researchReports[storyIndex];
            researchSummaries = `
## TARGET STORY TO GENERATE (Story ${storyIndex + 1} of ${researchReports.length}):

Headline: ${targetReport.story.headline}
Category: ${targetReport.story.category}
Source: ${targetReport.story.sources?.[0] || 'Unknown'}

Full Research:
${targetReport.deepResearch || targetReport.story.summary}

IMPORTANT: Generate content ONLY for this story. Do not mix in other stories.
`;
            console.log(`[Section] Story ${storyIndex + 1} focus: "${targetReport.story.headline.substring(0, 50)}..."`);
        } else {
            researchSummaries = researchReports
                .map((report, index) => `
STORY ${index + 1}: ${report.story.headline}
Category: ${report.story.category}
Summary: ${(report.deepResearch || report.story.summary || '').substring(0, 500)}...
`)
                .join('\n---\n');
        }

        const systemPrompt = getBaseSystemPrompt(dateContext) + ragContext;
        const userPrompt = getSectionPrompt(sectionType, researchSummaries, storyIndex, userInput);

        console.log(
            `[Section] Generating ${sectionType}${storyIndex !== undefined ? ` #${storyIndex + 1}` : ''} with ${selectedModel}`
        );
        console.log(`[Section] RAG: ${ragContext.length > 0 ? `${ragContext.length} chars` : 'none'}`);
        if (userInput) console.log(`[Section] User input: "${userInput.substring(0, 50)}..."`);

        const requestBody: Record<string, unknown> = {
            model: selectedModel,
            messages: [
                { role: 'system', content: systemPrompt },
                { role: 'user', content: userPrompt },
            ],
            temperature: 0.7,
            max_tokens: sectionType === 'story' ? 4000 : 1000,
        };

        if (sectionType === 'story') {
            requestBody.response_format = { type: 'json_object' };
        }

        const fetchOptions = {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8ai.local',
                'X-Title': `Innov8 AI - ${sectionType}`,
            },
            body: JSON.stringify(requestBody),
        };

        const startTime = Date.now();
        let content: string | null = null;
        let parsedStory: StorySectionResponse | null = null;
        let lastError: string | null = null;

        for (let attempt = 1; attempt <= 2; attempt++) {
            try {
                console.log(`[Section] Attempt ${attempt}/2...`);

                const response = await fetch(OPENROUTER_API_URL, fetchOptions);

                if (!response.ok) {
                    const errorText = await response.text();
                    lastError = `API Error (${selectedModel}): ${response.status} - ${errorText.substring(0, 200)}`;
                    console.error(`[Section] Attempt ${attempt} failed: ${lastError}`);
                    continue;
                }

                const data = await response.json();
                content = data.choices?.[0]?.message?.content?.trim() || '';
                const finishReason = data.choices?.[0]?.finish_reason;

                if (finishReason === 'length') {
                    console.warn('[Section] Response may be truncated');
                }

                if (!content || content.length < 20) {
                    lastError = `Empty or too short response (${content?.length ?? 0} chars, finish: ${finishReason})`;
                    console.warn(`[Section] Attempt ${attempt}: ${lastError}`);
                    continue;
                }

                if (sectionType === 'story') {
                    const cleanedContent = stripCodeFences(content);
                    let jsonCandidate: unknown = null;

                    try {
                        jsonCandidate = JSON.parse(cleanedContent);
                    } catch {
                        jsonCandidate = null;
                    }

                    parsedStory =
                        normalizeStorySection(jsonCandidate) ??
                        normalizeStorySection(parseStorySectionFromMarkdown(cleanedContent));

                    if (!parsedStory) {
                        lastError = `Incomplete story payload (finish: ${finishReason})`;
                        console.warn(`[Section] Story parse failed on attempt ${attempt}`);
                        continue;
                    }
                }

                console.log(
                    `[Section] Success on attempt ${attempt}, ${content.length} chars, finish: ${finishReason}`
                );
                break;
            } catch (error) {
                lastError = error instanceof Error ? error.message : 'Network error';
                console.error(`[Section] Attempt ${attempt} error:`, lastError);
            }
        }

        if (!content || (sectionType === 'story' && !parsedStory)) {
            return NextResponse.json(
                {
                    success: false,
                    error: lastError || 'No content after retries',
                    debug: { lastError },
                },
                { status: 500 }
            );
        }

        const finalContent = content;
        const duration = ((Date.now() - startTime) / 1000).toFixed(1);
        const inputTokens = systemPrompt.length / 4 + userPrompt.length / 4;
        const outputTokens = finalContent.length / 4;
        const cost = calculateCost(selectedModel, inputTokens, outputTokens);

        return NextResponse.json({
            success: true,
            content: finalContent,
            story: parsedStory,
            sectionType,
            storyIndex,
            model: selectedModel,
            duration: parseFloat(duration),
            cost,
            costSource: `section-${sectionType}`,
            promptPreview: {
                systemPromptLength: systemPrompt.length,
                userPromptLength: userPrompt.length,
                ragIncluded: ragContext.length > 0,
                userInputIncluded: !!userInput,
            },
        });
    } catch (error) {
        console.error('[Section] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error',
            },
            { status: 500 }
        );
    }
}
