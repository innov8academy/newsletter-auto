// Deep Research Agent using OpenRouter
// Generates newsletter-ready content for news stories

import { CuratedStory, ResearchReport } from './types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Available models for research - user can select from these
// Updated 2025: Organized by specialty
export const RESEARCH_MODELS = [
    // Deep Research Specialists (have web access or agentic research capability)
    { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast (Reasoning)', description: '🚀 10x cheaper! Deep reasoning + 2M context', category: 'research', reasoning: true },
    { id: 'perplexity/sonar-deep-research', name: 'Perplexity Sonar Deep Research', description: '🔥 Best for deep web research', category: 'research' },
    { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', description: 'Google flagship - 1M context', category: 'research' },
    { id: 'alibaba/tongyi-deepresearch-30b-a3b', name: 'Tongyi DeepResearch', description: 'Alibaba deep research agent', category: 'research' },

    // Strong General Purpose (great writing quality)
    { id: 'anthropic/claude-sonnet-4', name: 'Claude Sonnet 4', description: 'Best writing quality', category: 'general' },
    { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'OpenAI flagship', category: 'general' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', description: 'Powerful reasoning', category: 'general' },

    // Fast & Cheap
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', description: 'Fast & reliable', category: 'fast' },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', description: 'Fast & cheap', category: 'fast' },
] as const;

export type ResearchModelId = typeof RESEARCH_MODELS[number]['id'];

const DEFAULT_MODEL: ResearchModelId = 'perplexity/sonar-deep-research';

interface ResearchResult {
    success: boolean;
    report?: ResearchReport;
    error?: string;
}

/**
 * Generate newsletter-ready research content for a curated news story.
 * @param story - The curated story to research
 * @param apiKey - OpenRouter API key
 * @param modelId - Optional model override (defaults to Claude Sonnet 4)
 */
export async function generateResearchReport(
    story: CuratedStory,
    apiKey: string,
    modelId?: ResearchModelId
): Promise<ResearchResult> {
    const selectedModel = modelId || DEFAULT_MODEL;
    const systemPrompt = `You are a sharp, witty newsletter writer for "Innov8 AI" - a tech newsletter that explains AI news to curious people who want to understand what's ACTUALLY happening, not just the hype.

Your writing style:
- CONVERSATIONAL: Write like you're explaining this to a smart friend over coffee
- PUNCHY: Short paragraphs. No filler. Every sentence earns its place.
- OPINIONATED: Take a stance. Say what YOU think matters.
- CLEAR: Explain technical concepts without dumbing them down
- ENGAGING: Start with a hook. End with something memorable.

Structure your response EXACTLY as follows:

## The Story
[A 2-3 paragraph narrative that explains WHAT happened and WHY anyone should care. This should read like the opening of a great article - hook them immediately. Include the key facts but make them interesting.]

## The Context
[1-2 paragraphs explaining the bigger picture. What's this really about? Who wins/loses? How does this fit into the AI landscape? Be specific.]

## The Hot Take 🔥
[Your bold, opinionated take in 2-3 sentences. Don't be wishy-washy. What's the real story here that others are missing?]

## What's Next
[2-3 bullet points on what to watch for. Make these specific and actionable, not generic predictions.]

## Quotables
[If you found any notable quotes from key people involved, include 1-2 of the best ones. If none exist, skip this section.]

Remember: You're writing content that will be used in an actual newsletter. It should be ready to publish with minimal editing. No hedging, no "it remains to be seen", no corporate speak.`;

    const userPrompt = `Research and write about this story for the newsletter:

**Headline:** ${story.headline}

**Summary:** ${story.summary}

**Category:** ${story.category}

**Original Sources:** ${story.sources.join(', ')}

${story.originalUrl ? `**Source URL:** ${story.originalUrl}` : ''}

Write this up for the newsletter. Make it engaging and newsletter-ready. Focus on what's actually interesting about this story.`;

    try {
        // Call the selected model
        const response = await callOpenRouter(apiKey, selectedModel, systemPrompt, userPrompt);

        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: `API Error (${selectedModel}): ${response.status} - ${errorText}` };
        }

        const data = await response.json();
        const content = data.choices?.[0]?.message?.content;

        if (!content) {
            return { success: false, error: 'No content in API response' };
        }

        // Parse the structured response
        const report = parseResearchContent(story, content);
        return { success: true, report };

    } catch (error) {
        console.error('Research generation error:', error);
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error'
        };
    }
}

async function callOpenRouter(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string
): Promise<Response> {
    // Check if the model supports reasoning (Grok models)
    const modelConfig = RESEARCH_MODELS.find(m => m.id === model);
    const enableReasoning = modelConfig && 'reasoning' in modelConfig && modelConfig.reasoning;

    // Build request body
    const requestBody: Record<string, unknown> = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        temperature: 0.3, // Lower for more factual output
        max_tokens: 4000,
    };

    // Enable reasoning for supported models (xAI Grok)
    if (enableReasoning) {
        requestBody.reasoning = { enabled: true };
    }

    return fetch(OPENROUTER_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
            'HTTP-Referer': 'https://innov8ai.local',
            'X-Title': 'Innov8 AI Research Agent',
        },
        body: JSON.stringify(requestBody),
    });
}

/**
 * Parse the markdown research content into structured fields
 */
function parseResearchContent(story: CuratedStory, content: string): ResearchReport {
    // Extract key sections using regex
    const sections: Record<string, string> = {};

    // New newsletter-style section patterns
    const sectionPatterns = [
        'The Story',
        'The Context',
        'The Hot Take',
        "What's Next",
        'Quotables',
    ];

    for (let i = 0; i < sectionPatterns.length; i++) {
        const current = sectionPatterns[i];
        const next = sectionPatterns[i + 1];

        // Escape special regex characters in section name
        const escapedCurrent = current.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const escapedNext = next ? next.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null;

        const startPattern = new RegExp(`##\\s*${escapedCurrent}[^\\n]*\\n`, 'i');
        const endPattern = escapedNext
            ? new RegExp(`##\\s*${escapedNext}`, 'i')
            : null;

        const startMatch = content.match(startPattern);
        if (startMatch) {
            const startIndex = startMatch.index! + startMatch[0].length;
            const endIndex = endPattern
                ? content.slice(startIndex).search(endPattern) + startIndex
                : content.length;

            sections[current] = content.slice(startIndex, endIndex).trim();
        }
    }

    // Extract key points from "What's Next" section
    const keyPoints = extractBulletPoints(sections["What's Next"] || '');

    return {
        story,
        deepResearch: content, // Full markdown content
        keyPoints,
        implications: sections['The Context'] || '',
        sources: story.sources, // Keep original sources
    };
}

function extractBulletPoints(text: string): string[] {
    return text
        .split('\n')
        .filter(line => /^[-*•]\s+/.test(line.trim()) || /^\d+\.\s+/.test(line.trim()))
        .map(line => line.replace(/^[-*•\d.]+\s*/, '').trim())
        .filter(point => point.length > 0);
}
