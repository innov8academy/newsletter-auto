// Deep Research Agent using OpenRouter
// Generates newsletter-ready content for news stories

import { CuratedStory, ResearchReport } from './types';

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions';

// Available models for research - user can select from these
// Updated 2025: Organized by specialty
export const RESEARCH_MODELS = [
    // Deep Research Specialists (have web access or agentic research capability)
    // NOTE: o4-mini-deep-research removed - takes 5-10min, exceeds Vercel timeout
    { id: 'perplexity/sonar-deep-research', name: 'Perplexity Deep Research', description: '🔬 Best deep research - fast & reliable', category: 'research' },
    { id: 'x-ai/grok-4.1-fast', name: 'Grok 4.1 Fast (Reasoning)', description: '🚀 10x cheaper! Deep reasoning + 2M context', category: 'research', reasoning: true },
    { id: 'moonshotai/kimi-k2.5', name: 'Kimi K2.5 (Agent)', description: '🤖 262K + web search + tool-calling', category: 'research', agentic: true },
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

    // Check model type for specialized handling
    const isPerplexity = selectedModel.toLowerCase().includes('perplexity');
    const isKimi = selectedModel.toLowerCase().includes('kimi');
    
    // Check if model supports agentic mode (tool-calling)
    const modelConfig = RESEARCH_MODELS.find(m => m.id === selectedModel);
    const isAgentic = modelConfig && 'agentic' in modelConfig && modelConfig.agentic;
    
    // Use agentic research for Kimi with tool-calling
    if (isKimi && isAgentic) {
        console.log('[generateResearchReport] Using agentic mode for Kimi');
        return await generateAgenticResearch(story, apiKey, selectedModel);
    }

    // Select appropriate prompt based on model
    let systemPrompt: string;
    if (isPerplexity) {
        systemPrompt = getCostOptimizedPrompt();
    } else if (isKimi) {
        systemPrompt = getKimiResearchPrompt();
    } else {
        systemPrompt = getVerbosePrompt();
    }

    const userPrompt = `Research and write about this story for the newsletter:

**Headline:** ${story.headline}

**Summary:** ${story.summary}

**Category:** ${story.category}

**Original Sources:** ${story.sources.join(', ')}

${story.originalUrl ? `**Source URL:** ${story.originalUrl}` : ''}

${isPerplexity ? 'Extract the key insights and thinking. Keep it under 800 words.' : isKimi ? 'Provide comprehensive research and analysis. Use your deep reasoning capabilities to uncover insights and connections. Be thorough but focused.' : 'Write this up for the newsletter. Make it engaging and newsletter-ready. Focus on what\'s actually interesting about this story.'}`;

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

        // Kimi K2.5 specific: content may be in reasoning or reasoning_details field
        if (!content && isKimi && data.choices?.[0]?.message) {
            const message = data.choices[0].message;
            console.log('[Kimi] Checking reasoning fields. Message keys:', Object.keys(message));
            
            // Try reasoning field (may be string or object)
            if (message.reasoning) {
                if (typeof message.reasoning === 'string') {
                    content = message.reasoning;
                    console.log('[Kimi] Found content in reasoning field (string)');
                } else if (message.reasoning.content) {
                    content = message.reasoning.content;
                    console.log('[Kimi] Found content in reasoning.content');
                } else if (message.reasoning.text) {
                    content = message.reasoning.text;
                    console.log('[Kimi] Found content in reasoning.text');
                }
            }
            
            // Try reasoning_details field
            if (!content && message.reasoning_details) {
                if (typeof message.reasoning_details === 'string') {
                    content = message.reasoning_details;
                    console.log('[Kimi] Found content in reasoning_details (string)');
                } else if (Array.isArray(message.reasoning_details)) {
                    // May be array of reasoning steps
                    content = message.reasoning_details
                        .map((r: any) => r.content || r.text || r)
                        .filter(Boolean)
                        .join('\n\n');
                    console.log('[Kimi] Found content in reasoning_details array');
                }
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
 * Agentic research using Kimi with tool-calling (web search)
 * Implements a multi-step agent loop that searches the web and synthesizes findings
 */
async function generateAgenticResearch(
    story: CuratedStory,
    apiKey: string,
    model: string
): Promise<ResearchResult> {
    console.log('[AgenticResearch] Starting with model:', model);
    
    // Define available tools
    const tools = [
        {
            type: 'function',
            function: {
                name: 'web_search',
                description: 'Search the web for current information, news, facts, and data. Use this to verify claims, find recent developments, get statistics, and gather source material.',
                parameters: {
                    type: 'object',
                    properties: {
                        query: {
                            type: 'string',
                            description: 'The search query. Be specific and include relevant keywords.'
                        }
                    },
                    required: ['query']
                }
            }
        }
    ];
    
    const systemPrompt = getKimiAgenticPrompt();
    
    const userPrompt = `Research this topic thoroughly for a newsletter article:

**Topic:** ${story.headline}

**Context:** ${story.summary}

**Category:** ${story.category}

${story.originalUrl ? `**Source URL:** ${story.originalUrl}` : ''}

Instructions:
1. Use web_search to find current, verified information about this topic
2. Search for: recent news, official announcements, expert opinions, statistics, and context
3. Verify key claims with multiple searches if needed
4. After gathering information, write a comprehensive newsletter-ready report

Start by searching for the most relevant and recent information.`;

    const messages: Array<{role: string; content?: string; tool_calls?: any[]; tool_call_id?: string; name?: string}> = [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt }
    ];
    
    const maxIterations = 8; // Prevent infinite loops
    let iteration = 0;
    let finalContent = '';
    
    while (iteration < maxIterations) {
        iteration++;
        console.log(`[AgenticResearch] Iteration ${iteration}/${maxIterations}`);
        
        try {
            const response = await fetch(OPENROUTER_API_URL, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${apiKey}`,
                    'HTTP-Referer': 'https://newsletter-auto.vercel.app',
                    'X-Title': 'Innov8 AI Newsletter - Agentic Research'
                },
                body: JSON.stringify({
                    model,
                    messages,
                    tools,
                    tool_choice: iteration === 1 ? 'auto' : 'auto', // Let model decide
                    max_tokens: 8000,
                    temperature: 0.3,
                })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('[AgenticResearch] API error:', errorText);
                return { success: false, error: `API error: ${response.status}` };
            }
            
            const data = await response.json();
            const choice = data.choices?.[0];
            const message = choice?.message;
            
            if (!message) {
                console.error('[AgenticResearch] No message in response');
                break;
            }
            
            // Check for tool calls
            if (message.tool_calls && message.tool_calls.length > 0) {
                console.log(`[AgenticResearch] Model requested ${message.tool_calls.length} tool calls`);
                
                // Add assistant message with tool calls
                messages.push({
                    role: 'assistant',
                    content: message.content || '',
                    tool_calls: message.tool_calls
                });
                
                // Execute each tool call
                for (const toolCall of message.tool_calls) {
                    const functionName = toolCall.function?.name;
                    const functionArgs = JSON.parse(toolCall.function?.arguments || '{}');
                    
                    console.log(`[AgenticResearch] Executing tool: ${functionName}`, functionArgs);
                    
                    let toolResult = '';
                    
                    if (functionName === 'web_search') {
                        try {
                            // Call our web search API
                            const searchResponse = await fetch(`${process.env.NEXT_PUBLIC_BASE_URL || 'https://newsletter-auto.vercel.app'}/api/web-search`, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ query: functionArgs.query, num: 5 })
                            });
                            
                            const searchData = await searchResponse.json();
                            
                            if (searchData.success && searchData.results) {
                                toolResult = formatSearchResults(searchData.results);
                                console.log(`[AgenticResearch] Search returned ${searchData.results.length} results`);
                            } else {
                                toolResult = `Search failed: ${searchData.error || 'Unknown error'}`;
                            }
                        } catch (searchError) {
                            console.error('[AgenticResearch] Search error:', searchError);
                            toolResult = `Search error: ${searchError instanceof Error ? searchError.message : 'Unknown'}`;
                        }
                    } else {
                        toolResult = `Unknown tool: ${functionName}`;
                    }
                    
                    // Add tool result to messages
                    messages.push({
                        role: 'tool',
                        tool_call_id: toolCall.id,
                        name: functionName,
                        content: toolResult
                    });
                }
                
                // Continue loop to get next response
                continue;
            }
            
            // No tool calls - this is the final response
            // Extract content from message (handle Kimi's reasoning field)
            finalContent = message.content || '';
            
            if (!finalContent && message.reasoning) {
                finalContent = typeof message.reasoning === 'string' 
                    ? message.reasoning 
                    : message.reasoning.content || message.reasoning.text || '';
            }
            
            if (!finalContent && message.reasoning_details) {
                if (typeof message.reasoning_details === 'string') {
                    finalContent = message.reasoning_details;
                } else if (Array.isArray(message.reasoning_details)) {
                    finalContent = message.reasoning_details
                        .map((r: any) => r.content || r.text || r)
                        .filter(Boolean)
                        .join('\n\n');
                }
            }
            
            if (finalContent) {
                console.log(`[AgenticResearch] Got final content (${finalContent.length} chars) after ${iteration} iterations`);
                break;
            }
            
        } catch (error) {
            console.error('[AgenticResearch] Error in iteration:', error);
            return { 
                success: false, 
                error: error instanceof Error ? error.message : 'Unknown error' 
            };
        }
    }
    
    if (!finalContent) {
        return { 
            success: false, 
            error: `No final content after ${iteration} iterations` 
        };
    }
    
    const report = parseResearchContent(story, finalContent);
    return { success: true, report };
}

/**
 * Format search results for the model
 */
function formatSearchResults(results: any[]): string {
    if (!results || results.length === 0) {
        return 'No results found.';
    }
    
    let formatted = 'Search Results:\n\n';
    
    for (const result of results) {
        if (result.type === 'knowledge') {
            formatted += `[Knowledge Panel] ${result.title}\n${result.description}\nSource: ${result.source}\n\n`;
        } else if (result.type === 'news') {
            formatted += `[News] ${result.title}\n${result.snippet}\nSource: ${result.source} | ${result.date || 'Recent'}\nURL: ${result.url}\n\n`;
        } else {
            formatted += `[Web] ${result.title}\n${result.snippet}\n${result.date ? `Date: ${result.date}\n` : ''}URL: ${result.url}\n\n`;
        }
    }
    
    return formatted;
}

/**
 * Specialized prompt for Kimi agentic mode with tool-calling
 */
function getKimiAgenticPrompt(): string {
    return `You are an elite AI research agent for "Innov8 AI" newsletter. You have access to web search to gather current, verified information.

YOUR MISSION: Produce thoroughly researched, fact-checked newsletter content.

RESEARCH APPROACH:
1. START with web searches to gather current information
2. Search for: official announcements, news coverage, expert opinions, statistics
3. VERIFY key claims with multiple searches when important
4. Cite your sources in the final report

TOOL USAGE:
- Use web_search to find current information
- Be specific in your queries (include names, dates, companies)
- Search multiple angles: news, official sources, expert analysis
- Do 3-6 searches to build comprehensive understanding

AFTER RESEARCH, write your report in this format:

## The Story
[3-4 paragraphs with VERIFIED facts from your searches. Include specific details: names, dates, numbers. Cite sources inline like (Source: TechCrunch).]

## The Context
[2-3 paragraphs analyzing the bigger picture. What does this mean for the industry? Who wins/loses? Historical context if relevant.]

## The Hot Take 🔥
[Your sharp analytical take in 2-3 sentences. What's the real story others are missing?]

## What's Next
[3-5 bullet points of specific things to watch, based on your research findings]

## Quotables
[Include 1-2 real quotes you found in your research, with proper attribution]

## Sources
[List the key sources you used]

QUALITY STANDARDS:
- Every fact must come from your web searches
- Include specific numbers, dates, and names
- Cite sources for major claims
- Be analytical, not just descriptive
- Ready to publish with minimal editing`;
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
 * Specialized prompt for Kimi K2.5 - optimized for its research and analysis strengths
 * Kimi excels at: deep analysis, structured reports, multi-perspective analysis, thorough research
 */
function getKimiResearchPrompt(): string {
    return `You are a senior technology analyst writing for "Innov8 AI", a newsletter that delivers deep, insightful analysis of AI news.

YOUR STRENGTHS TO LEVERAGE:
- Deep analytical reasoning and comprehensive research
- Structured, well-organized reporting
- Multi-perspective analysis
- Finding connections and implications others miss

WRITING APPROACH:
- Be thorough but concise - every point should add value
- Provide substantive analysis, not surface-level summaries
- Include specific facts, numbers, and names
- Draw connections to broader industry trends
- Offer unique insights from multiple angles

STRUCTURE YOUR RESPONSE AS:

## The Story
[3-4 paragraphs with comprehensive coverage of WHAT happened, WHO is involved, and WHY this matters. Include key facts, timeline if relevant, and immediate implications. Make it engaging and informative.]

## The Context
[2-3 paragraphs providing deeper analysis:
- How does this fit into the broader AI/tech landscape?
- What are the market/competitive implications?
- Historical context: what led to this?
- Who are the winners and losers?]

## The Hot Take 🔥
[Your sharp, analytical take in 2-3 sentences. What's the real story that headlines miss? Be bold and specific.]

## What's Next
[3-5 bullet points on concrete things to watch:
- Specific timelines or milestones
- Companies or people to track
- Potential second-order effects
- Risks or opportunities]

## Quotables
[Include 1-2 notable quotes from key figures if available. Format: "[Quote]" — Person Name, Title]

QUALITY STANDARDS:
- Ready to publish with minimal editing
- Substantive analysis, not generic observations
- Specific and actionable insights
- Professional but accessible tone`;
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

    // OpenAI deep research models (o4-mini-deep-research) have web search built-in
    // According to OpenRouter docs: "This model always uses the 'web_search' tool"
    // We should NOT add extra plugins/tools as they may conflict with the built-in behavior
    // The model handles web search internally - just send the request normally
    if (isOpenAIDeepResearch) {
        console.log(`[Deep Research] Model ${model} has built-in web search, not adding extra plugins`);
        // Remove max_tokens limit for deep research - let it use its default
        // Deep research models may have different token handling
        delete requestBody.max_tokens;
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
