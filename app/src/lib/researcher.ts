// Deep Research Agent using OpenRouter
// Generates newsletter-ready content for news stories

import { CuratedStory, ResearchReport } from './types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Available models for research - user can select from these
// Updated 2025: Organized by specialty
export const RESEARCH_MODELS = [
    // Deep Research Specialists (have web access or agentic research capability)
    { id: 'openai/o4-mini-deep-research', name: 'OpenAI o4-mini Deep Research', description: '🧪 OpenAI deep research - test vs Perplexity', category: 'research' },
    { id: 'perplexity/sonar-deep-research', name: 'Perplexity Deep Research', description: '🔬 Best quality but $1+/call', category: 'research' },
    { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast (Reasoning)', description: '🚀 10x cheaper! Deep reasoning + 2M context', category: 'research', reasoning: true },
    { id: 'perplexity/sonar', name: 'Perplexity Sonar', description: '💰 Web search - $1/1M tokens', category: 'research' },
    { id: 'perplexity/sonar-pro', name: 'Perplexity Sonar Pro', description: '🔥 Advanced web research', category: 'research' },
    { id: 'google/gemini-3-pro-preview', name: 'Gemini 3 Pro', description: 'Google flagship - 1M context', category: 'research' },

    // Strong General Purpose (great writing quality)
    { id: 'anthropic/claude-sonnet-4.5', name: 'Claude Sonnet 4.5', description: 'Best writing quality', category: 'general' },
    { id: 'openai/gpt-4o', name: 'GPT-4o', description: 'OpenAI flagship', category: 'general' },
    { id: 'deepseek/deepseek-r1', name: 'DeepSeek R1', description: 'Powerful reasoning', category: 'general' },

    // Fast & Cheap
    { id: 'google/gemini-2.0-flash-001', name: 'Gemini 2.0 Flash', description: 'Fast & reliable', category: 'fast' },
    { id: 'anthropic/claude-3.5-haiku', name: 'Claude 3.5 Haiku', description: 'Fast & cheap', category: 'fast' },
] as const;

export type ResearchModelId = typeof RESEARCH_MODELS[number]['id'];

const DEFAULT_MODEL: ResearchModelId = 'x-ai/grok-4.1-fast';

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
    console.log('[generateResearchReport] Called with:', {
        storyId: story.id,
        headline: story.headline?.substring(0, 50),
        modelId,
        hasApiKey: !!apiKey
    });

    const selectedModel = modelId || DEFAULT_MODEL;
    console.log('[generateResearchReport] Selected model:', selectedModel);

    // Check if using Perplexity model - use cost-optimized prompt
    const isPerplexity = selectedModel.toLowerCase().includes('perplexity');

    const systemPrompt = isPerplexity
        ? getCostOptimizedPrompt()
        : getVerbosePrompt();

    const userPrompt = `Research and write about this story for the newsletter:

**Headline:** ${story.headline}

**Summary:** ${story.summary}

**Category:** ${story.category}

**Original Sources:** ${story.sources.join(', ')}

${story.originalUrl ? `**Source URL:** ${story.originalUrl}` : ''}

${isPerplexity ? 'Extract the key insights and thinking. Keep it under 800 words.' : 'Write this up for the newsletter. Make it engaging and newsletter-ready. Focus on what\'s actually interesting about this story.'}`;

    try {
        // Call the selected model
        console.log('[generateResearchReport] Calling callOpenRouter...');
        const response = await callOpenRouter(apiKey, selectedModel, systemPrompt, userPrompt, isPerplexity);
        console.log('[generateResearchReport] callOpenRouter returned, status:', response.status);

        if (!response.ok) {
            const errorText = await response.text();
            return { success: false, error: `API Error (${selectedModel}): ${response.status} - ${errorText}` };
        }

        const data = await response.json();

        // Debug logging for OpenAI deep research models
        if (selectedModel.includes('deep-research')) {
            console.log(`[Deep Research Debug] Model: ${selectedModel}`);
            console.log(`[Deep Research Debug] Response keys:`, Object.keys(data));
            console.log(`[Deep Research Debug] Choices count:`, data.choices?.length);
            if (data.choices?.[0]) {
                console.log(`[Deep Research Debug] Choice[0] keys:`, Object.keys(data.choices[0]));
                console.log(`[Deep Research Debug] Message keys:`, data.choices[0].message ? Object.keys(data.choices[0].message) : 'no message');
                console.log(`[Deep Research Debug] Content length:`, data.choices[0].message?.content?.length || 0);
                console.log(`[Deep Research Debug] Finish reason:`, data.choices[0].finish_reason);
            }
            // Check for alternative response formats
            if (data.output) {
                console.log(`[Deep Research Debug] Output field found:`, typeof data.output);
            }
            if (data.response) {
                console.log(`[Deep Research Debug] Response field found:`, typeof data.response);
            }
        }

        // Log the full response structure for deep research models
        if (selectedModel.includes('deep-research')) {
            console.log(`[Deep Research Debug] Full response:`, JSON.stringify(data, null, 2).substring(0, 3000));
        }

        // Try multiple extraction paths for content
        let content = data.choices?.[0]?.message?.content;

        // OpenAI Deep Research models use a different response format:
        // output array → find type: "message" → content array → find type: "output_text" → text
        if (!content && selectedModel.includes('deep-research')) {
            console.log('[Deep Research] Trying deep research specific extraction...');

            // Try the output array format (OpenAI Responses API format)
            if (Array.isArray(data.output)) {
                for (const item of data.output) {
                    if (item.type === 'message' && Array.isArray(item.content)) {
                        for (const contentItem of item.content) {
                            if (contentItem.type === 'output_text' && contentItem.text) {
                                content = contentItem.text;
                                console.log('[Deep Research] Found content via output[].content[].text');
                                break;
                            }
                            if (contentItem.type === 'text' && contentItem.text) {
                                content = contentItem.text;
                                console.log('[Deep Research] Found content via output[].content[].text (text type)');
                                break;
                            }
                        }
                    }
                    if (content) break;

                    // Also try direct text field on output items
                    if (item.text) {
                        content = item.text;
                        console.log('[Deep Research] Found content via output[].text');
                        break;
                    }
                }
            }

            // Try output_text field directly
            if (!content && data.output_text) {
                content = data.output_text;
                console.log('[Deep Research] Found content via output_text');
            }

            // Try choices with different structure
            if (!content && data.choices?.[0]) {
                const choice = data.choices[0];

                // Check if message.content is an array (OpenAI format)
                if (Array.isArray(choice.message?.content)) {
                    for (const item of choice.message.content) {
                        if (item.type === 'text' && item.text) {
                            content = item.text;
                            console.log('[Deep Research] Found content via choices[0].message.content[] array');
                            break;
                        }
                        if (item.type === 'output_text' && item.text) {
                            content = item.text;
                            console.log('[Deep Research] Found content via choices[0].message.content[] output_text');
                            break;
                        }
                    }
                }

                // Try other choice paths
                if (!content) {
                    content = choice.text ||
                              choice.content ||
                              choice.message?.text ||
                              choice.output?.content ||
                              choice.output?.text;

                    if (content) {
                        console.log('[Deep Research] Found content via alternative choice path');
                    }
                }
            }
        }

        // Alternative paths for non-deep-research models
        if (!content && data.choices?.[0]) {
            const choice = data.choices[0];
            content = choice.text ||
                      choice.content ||
                      choice.message?.text;

            if (content) {
                console.log('[Research] Found content via alternative choice path');
            }
        }

        // Try top-level alternative formats
        if (!content) {
            content = data.output?.text ||
                      data.output?.content ||
                      data.response?.text ||
                      data.response?.content ||
                      data.text ||
                      data.content;

            if (content) {
                console.log('[Research] Found content via top-level alternative');
            }
        }

        if (!content) {
            // Log more details about what we received
            const choiceKeys = data.choices?.[0] ? Object.keys(data.choices[0]) : [];
            const messageKeys = data.choices?.[0]?.message ? Object.keys(data.choices[0].message) : [];
            const outputInfo = Array.isArray(data.output) ? `output is array of ${data.output.length} items` : `output type: ${typeof data.output}`;
            return {
                success: false,
                error: `No content in API response. Model: ${selectedModel}. Keys: ${Object.keys(data).join(', ')}. Choice keys: ${choiceKeys.join(', ')}. Message keys: ${messageKeys.join(', ')}. ${outputInfo}`
            };
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

/**
 * Cost-optimized prompt for Perplexity models - structured bullets, no prose
 */
function getCostOptimizedPrompt(): string {
    return `You are a researcher preparing raw material for a newsletter writer.
Your job: Extract the THINKING and INSIGHTS, not just facts.

## OUTPUT FORMAT (bullet points only, NO prose):

### THE ANGLE (What makes this interesting?)
• Why should a 25yo tech enthusiast care about this?
• What's the surprising or counterintuitive element?
• One-line hook that grabs attention

### KEY FACTS (with specifics)
• Company names, $ amounts, dates, people quoted
• Technical details that matter
• Comparisons or benchmarks

### IMPLICATIONS (Who wins/loses?)
• Who benefits from this?
• Who gets hurt?
• What changes in the industry?

### PREDICTIONS (What happens next?)
• Short-term: next 3 months
• Medium-term: next 1 year
• What should readers watch for?

### HOT TAKE (Strong opinion)
• Is this overhyped or actually big?
• Contrarian view if any
• What others are missing

### QUOTABLES (if found)
• "[Exact quote]" — Person, Title

RULES:
- STRICT WORD LIMIT: Keep entire response under 800 words
- Each bullet = 1-2 sentences MAX
- Be specific: names, numbers, dates
- Skip sources/URLs (not needed)
- NO prose paragraphs`;
}

/**
 * Original verbose prompt for general models (Grok, Claude, etc.)
 */
function getVerbosePrompt(): string {
    return `You are a sharp, witty newsletter writer for "Innov8 AI" - a tech newsletter that explains AI news to curious people who want to understand what's ACTUALLY happening, not just the hype.

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
}

async function callOpenRouter(
    apiKey: string,
    model: string,
    systemPrompt: string,
    userPrompt: string,
    isCostOptimized: boolean = false
): Promise<Response> {
    console.log('[callOpenRouter] Starting request to model:', model);
    console.log('[callOpenRouter] API URL:', OPENROUTER_API_URL);

    // Check if the model supports reasoning (Grok models)
    const modelConfig = RESEARCH_MODELS.find(m => m.id === model);
    const enableReasoning = modelConfig && 'reasoning' in modelConfig && modelConfig.reasoning;

    // Check if model is OpenAI deep research or reasoning model
    // o4-mini-deep-research and o1/o3 do not support temperature
    const isOpenAIReasoning = model.includes('o4-mini') || model.includes('o1') || model.includes('o3');
    const isOpenAIDeepResearch = model.includes('deep-research');

    // Build request body - reduce max_tokens for cost-optimized calls
    // Deep research models need more output tokens
    const requestBody: Record<string, unknown> = {
        model,
        messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
        ],
        max_tokens: isOpenAIDeepResearch ? 16000 : (isCostOptimized ? 1500 : 4000),
        stream: false, // Explicitly disable streaming to ensure we get a full JSON response
    };

    // Only add temperature for models that support it (OpenAI reasoning models don't)
    if (!isOpenAIReasoning) {
        requestBody.temperature = 0.3;
    }

    // Enable reasoning for supported models (xAI Grok)
    if (enableReasoning) {
        requestBody.reasoning = { enabled: true };
    }

    // OpenAI deep research models require the web_search tool via OpenRouter plugins
    // Per OpenRouter docs: use plugins array with web search enabled
    if (isOpenAIDeepResearch) {
        requestBody.plugins = [
            { id: 'web', max_results: 10 }
        ];
        // Also add tools array for OpenAI's native web search format
        requestBody.tools = [
            { type: 'web_search_preview' }
        ];
        console.log(`[Deep Research] Enabling web search plugins for model: ${model}`);
    }

    console.log(`[OpenRouter] Request to ${model}:`, JSON.stringify(requestBody, null, 2));
    console.log('[callOpenRouter] About to call fetch...');

    try {
        const response = await fetch(OPENROUTER_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${apiKey}`,
                'HTTP-Referer': 'https://innov8ai.local',
                'X-Title': 'Innov8 AI Research Agent',
            },
            body: JSON.stringify(requestBody),
        });

        console.log('[callOpenRouter] Fetch completed, status:', response.status);

        // Log response status for debugging
        if (!response.ok) {
            const errorText = await response.text();
            console.error(`[OpenRouter] Error response (${response.status}):`, errorText);
            // Return a new Response with the error for proper handling upstream
            return new Response(JSON.stringify({
                error: { message: errorText, status: response.status }
            }), {
                status: response.status,
                headers: { 'Content-Type': 'application/json' }
            });
        }

        console.log('[callOpenRouter] Response OK, returning...');
        return response;
    } catch (fetchError) {
        console.error('[callOpenRouter] Fetch threw an error:', fetchError);
        throw fetchError;
    }
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
