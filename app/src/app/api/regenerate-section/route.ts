// API Route: Regenerate Newsletter Section
// POST /api/regenerate-section - Regenerate a specific section with custom prompt

import { NextRequest, NextResponse } from 'next/server';
import { DraftModelId } from '@/lib/draft-generator';
import { calculateCost } from '@/lib/cost-tracker';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

function sanitizeHookParagraph(hook: string): string {
    const sanitized = hook
        .replace(/^\s*Yesterday\s*,?\s*on\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*,?\s*/i, '')
        .replace(/^\s*Today\s*,?\s*on\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*,?\s*/i, '')
        .replace(/^\s*On\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*,?\s*/i, '')
        .replace(/^\s*As of\s+[A-Z][a-z]+\s+\d{1,2},\s+\d{4}\s*,?\s*/i, '')
        .replace(/\s+/g, ' ')
        .trim();

    return sanitized || hook.trim();
}


export async function POST(request: NextRequest) {
    try {
        const body = await request.json();
        const { currentContent, userPrompt, sectionType, modelId, apiKey: clientApiKey, context } = body as {
            currentContent: string;
            userPrompt: string;
            sectionType: 'intro' | 'hook' | 'bullets' | 'whyMatters' | 'l8rsTake' | 'summary' | 'title';
            modelId: DraftModelId;
            apiKey: string;
            context?: string; // Full story context for better regeneration
        };

        const apiKey = clientApiKey || process.env.OPENROUTER_API_KEY || '';

        if (!apiKey) {
            return NextResponse.json(
                { success: false, error: 'API key is required' },
                { status: 400 }
            );
        }

        if (!currentContent || !userPrompt) {
            return NextResponse.json(
                { success: false, error: 'Current content and prompt are required' },
                { status: 400 }
            );
        }

        console.log(`[Regenerate] Section: ${sectionType}, Model: ${modelId}`);

        // Section-specific instructions to prevent duplication
        const sectionInstructions: Record<string, string> = {
            title: 'Rewrite the story TITLE only. Make it catchy, punchy, and informative. Not clickbait — just interesting.',
            hook: 'Rewrite the HOOK paragraph only. This is the opening that grabs attention. 2-3 sentences max. Use a rhetorical question if it fits. Make it scannable. Lead with the most interesting angle, not the date. Do NOT start with "Yesterday", "Today", "On [date]", or "As of [date]".',
            bullets: 'Rewrite "The details" only. These are the KEY FACTS. Give enough useful bullet points to cover the story properly, usually 3-6. Each bullet = ONE sentence. Be specific with numbers and company names.',
            whyMatters: 'Rewrite "Why it matters" only. Write a 2-4 sentence PARAGRAPH (not bullets). Focus on how this affects people and the bigger picture.',
            l8rsTake: 'Rewrite "L8R\'s Take" only. Write a 2-3 sentence PARAGRAPH (not bullets). Strong opinion, no hedging. One clear takeaway.',
            summary: 'Rewrite the QUICK SUMMARY only. One punchy sentence per story with **bold** keywords.',
            intro: 'Rewrite the INTRODUCTION only. Structure: 1) Main story hook (2-3 sentences), 2) Tease other stories with questions/bullets, 3) End with: "I\'m Alex. Welcome to **L8R by Innov8**. Let\'s dive deep 🧠👇"',
        };

        const systemPrompt = `You are Alex — a 25-year-old AI creator and entrepreneur from Kerala, India. You write "L8R by Innov8."

## WHO YOU ARE:
- CS grad turned content creator. You USE AI daily — you're in the trenches.
- Witty friend who explains things. Not a hype-man or journalist.
- Unbiased. If something is overhyped, say so. If it's genuinely groundbreaking, give it credit.

## YOUR READERS:
- 18-40 year old Malayalis curious about AI
- NOT technical experts — normal people
- Busy — they SCAN, they don't read. **SCANNABILITY IS CRITICAL.**

## YOUR STYLE:
- **Simple English.** Grade 5-6 level. No jargon.
- **Short sentences.** One idea per sentence. Punchy.
- **Scannable.** Bullet points = 1-2 lines MAX. No walls of text.
- Use **bold** for company names, numbers, key terms.
- Emojis: 🧠 💰 🤖 🚨 ⏭️ 🔥 💀 🤯 😭
- Talk TO the reader ("You", "Your").
- Self-deprecating humor ("I spent 5 hours testing this so you don't have to").
- Rhetorical questions ("Want to know the crazy part?").

## HYPE CALIBRATION:
- Default: Don't overhype. "Another day, another model."
- Exception: If a major benchmark is broken, match the energy.
- Always give YOUR opinion. Strong takes.

## CRITICAL RULES:
1. ${sectionInstructions[sectionType] || 'Rewrite the content.'}
2. Output ONLY the rewritten content. No explanations, no headers, no "Here's the rewritten version."
3. Do NOT include other sections in your output. Only rewrite what was asked.
4. Each bullet point must be UNIQUE. Never repeat information across bullets.
5. Keep bullet points SHORT — one sentence each. MAX 2 lines.
6. Be specific with facts, companies, and numbers.
7. Hooks must never open with date-first phrasing like "Yesterday", "Today", "On March 30, 2026", or "As of April 1, 2026".

## HUMANIZE (Kill AI patterns):
- NO "testament to" / "serves as" / "underscores" / "highlights"
- NO "evolving landscape" / "broader implications" / "crucial role"
- NO "Additionally" / "Moreover" / "Furthermore"
- NO "It's not just X, it's Y" patterns
- Use "is" directly — not "serves as" or "represents"
- VARY sentence length. Short. Then longer flowing ones.
- Have opinions. React to facts. Be Alex, not a press release.

${context ? `\nFOR CONTEXT, here is the full story this section belongs to:\n${context}\n\nUse this context to write better content, but ONLY output the specific section being rewritten.` : ''}`;

        const userMessage = `Current ${sectionType} content:
"""
${currentContent}
"""

User's request: ${userPrompt}

Rewrite the ${sectionType} according to the user's request. Return ONLY the rewritten content, nothing else.`;

        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8ai.local',
                'X-Title': 'Innov8 AI Section Regenerator',
            },
            body: JSON.stringify({
                model: modelId,
                messages: [
                    { role: 'system', content: systemPrompt },
                    { role: 'user', content: userMessage },
                ],
                temperature: 0.7,
                max_tokens: 2000,
            }),
        });

        if (!response.ok) {
            const errorText = await response.text();
            return NextResponse.json(
                { success: false, error: `API Error: ${response.status} - ${errorText}` },
                { status: 500 }
            );
        }

        const data = await response.json();
        let content = data.choices?.[0]?.message?.content;

        if (!content) {
            return NextResponse.json(
                { success: false, error: 'No content in API response' },
                { status: 500 }
            );
        }

        // Clean up common issues in AI output
        content = content
            .replace(/^(Here'?s?|The rewritten|Rewritten).*/gmi, '') // Remove intro phrases
            .replace(/\*\*🔍.*?:\*\*/gi, '') // Remove section headers in bullets
            .replace(/\*\*🚨.*?:\*\*/gi, '')
            .replace(/\*\*⏭️.*?:\*\*/gi, '')
            .trim();

        // For bullet lists, parse into array
        if (sectionType === 'bullets') {
            const items = content
                .split('\n')
                .map((line: string) => line.replace(/^[•\-\*\d\.]+\s*/, '').trim())
                .filter((line: string) => line.length > 0 && !line.match(/^(Key Points|The details|Why it matters)/i));

            // Estimate cost: ~1000 input tokens, ~500 output tokens
            const cost = calculateCost(modelId, 1000, 500);

            return NextResponse.json({
                success: true,
                content: items,
                isArray: true,
                cost,
                costSource: 'regen-section',
                model: modelId,
            });
        }

        // Estimate cost: ~1000 input tokens, ~500 output tokens
        const cost = calculateCost(modelId, 1000, 500);

        return NextResponse.json({
            success: true,
            content: sectionType === 'hook' ? sanitizeHookParagraph(content) : content.trim(),
            isArray: false,
            cost,
            costSource: 'regen-section',
            model: modelId,
        });

    } catch (error) {
        console.error('[Regenerate] Error:', error);
        return NextResponse.json(
            {
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            },
            { status: 500 }
        );
    }
}
