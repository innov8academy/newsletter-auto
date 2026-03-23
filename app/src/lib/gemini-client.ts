// Direct Gemini API client — bypasses OpenRouter for Google models
// Uses the free tier: gemini-3.1-flash-lite-preview with Google Search grounding

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

export interface GeminiResponse {
    text: string;
    groundingMetadata?: {
        searchEntryPoint?: { renderedContent: string };
        groundingChunks?: Array<{ web?: { uri: string; title: string } }>;
        webSearchQueries?: string[];
    };
    usageMetadata?: {
        promptTokenCount: number;
        candidatesTokenCount: number;
        totalTokenCount: number;
    };
}

interface GeminiRequestOptions {
    model?: string;
    systemInstruction?: string;
    temperature?: number;
    maxOutputTokens?: number;
    useGoogleSearch?: boolean;
    responseJsonSchema?: Record<string, unknown>;
}

/**
 * Get the Gemini API key from environment
 */
function getApiKey(): string {
    const key = process.env.GEMINI_API_KEY;
    if (!key) {
        throw new Error('GEMINI_API_KEY not configured. Add it to your .env file.');
    }
    return key;
}

/**
 * Call Gemini API directly with optional Google Search grounding.
 * Free tier: gemini-3.1-flash-lite-preview (input + output free, 5K grounded prompts/month free)
 */
export async function callGemini(
    prompt: string,
    options: GeminiRequestOptions = {}
): Promise<GeminiResponse> {
    const {
        model = 'gemini-3.1-flash-lite-preview',
        systemInstruction,
        temperature = 0.3,
        maxOutputTokens = 4000,
        useGoogleSearch = false,
        responseJsonSchema,
    } = options;

    const apiKey = getApiKey();
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

    // Build request body
    const body: Record<string, unknown> = {
        contents: [{
            parts: [{ text: prompt }],
        }],
        generationConfig: {
            temperature,
            maxOutputTokens,
        },
    };

    // Add system instruction if provided
    if (systemInstruction) {
        body.systemInstruction = {
            parts: [{ text: systemInstruction }],
        };
    }

    // Add Google Search grounding
    if (useGoogleSearch) {
        body.tools = [{ googleSearch: {} }];
    }

    // Add JSON schema for structured output
    if (responseJsonSchema) {
        (body.generationConfig as Record<string, unknown>).responseMimeType = 'application/json';
        (body.generationConfig as Record<string, unknown>).responseSchema = responseJsonSchema;
    }

    console.log(`[Gemini] Calling ${model} (search: ${useGoogleSearch})`);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30000); // 30s timeout
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!response.ok) {
        const errorText = await response.text();
        console.error(`[Gemini] Error ${response.status}:`, errorText);
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();

    // Extract text from response
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
        ?.map((p: { text?: string }) => p.text || '')
        .join('') || '';

    if (!text) {
        const finishReason = candidate?.finishReason;

        // RECITATION = Gemini thinks output is too close to copyrighted content
        // Retry with higher temperature to encourage more original phrasing
        if (finishReason === 'RECITATION') {
            console.warn(`[Gemini] RECITATION block — retrying with higher temperature...`);
            const retryBody = JSON.parse(JSON.stringify(body));
            (retryBody.generationConfig as Record<string, unknown>).temperature = 0.7;

            const retryController = new AbortController();
            const retryTimeout = setTimeout(() => retryController.abort(), 30000);
            const retryResponse = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(retryBody),
                signal: retryController.signal,
            });
            clearTimeout(retryTimeout);

            if (retryResponse.ok) {
                const retryData = await retryResponse.json();
                const retryCandidate = retryData.candidates?.[0];
                const retryText = retryCandidate?.content?.parts
                    ?.map((p: { text?: string }) => p.text || '')
                    .join('') || '';

                if (retryText) {
                    console.log(`[Gemini] RECITATION retry succeeded`);
                    return {
                        text: retryText,
                        groundingMetadata: retryCandidate?.groundingMetadata,
                        usageMetadata: retryData.usageMetadata,
                    };
                }
            }
        }

        throw new Error(`Gemini returned empty response. Finish reason: ${finishReason}`);
    }

    return {
        text,
        groundingMetadata: candidate?.groundingMetadata,
        usageMetadata: data.usageMetadata,
    };
}

/**
 * Call Gemini for chat-style interactions (multi-turn)
 */
export async function callGeminiChat(
    messages: Array<{ role: 'user' | 'model'; text: string }>,
    options: GeminiRequestOptions = {}
): Promise<GeminiResponse> {
    const {
        model = 'gemini-3.1-flash-lite-preview',
        systemInstruction,
        temperature = 0.3,
        maxOutputTokens = 4000,
        useGoogleSearch = false,
    } = options;

    const apiKey = getApiKey();
    const url = `${GEMINI_API_BASE}/${model}:generateContent?key=${apiKey}`;

    const body: Record<string, unknown> = {
        contents: messages.map(m => ({
            role: m.role,
            parts: [{ text: m.text }],
        })),
        generationConfig: {
            temperature,
            maxOutputTokens,
        },
    };

    if (systemInstruction) {
        body.systemInstruction = {
            parts: [{ text: systemInstruction }],
        };
    }

    if (useGoogleSearch) {
        body.tools = [{ googleSearch: {} }];
    }

    console.log(`[Gemini Chat] Calling ${model} with ${messages.length} messages`);

    const chatController = new AbortController();
    const chatTimeout = setTimeout(() => chatController.abort(), 30000); // 30s timeout
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: chatController.signal,
    });
    clearTimeout(chatTimeout);

    if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Gemini API error (${response.status}): ${errorText}`);
    }

    const data = await response.json();
    const candidate = data.candidates?.[0];
    const text = candidate?.content?.parts
        ?.map((p: { text?: string }) => p.text || '')
        .join('') || '';

    return {
        text,
        groundingMetadata: candidate?.groundingMetadata,
        usageMetadata: data.usageMetadata,
    };
}
