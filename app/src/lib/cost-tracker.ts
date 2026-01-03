// Cost Tracking Utility
// Tracks API costs across the newsletter workflow with localStorage persistence

const STORAGE_KEY = 'newsletter_session_costs';

// Cost entry structure
export interface CostEntry {
    id: string;
    timestamp: string;
    source: CostSource;
    model: string;
    cost: number;
    description: string;
}

// Valid cost sources for tracking
export type CostSource =
    | 'curate'
    | 'research'
    | 'enhance'
    | 'draft'
    | 'regen-section'
    | 'regen-story'
    | 'image-prompt'
    | 'image-gen';

// OpenRouter model pricing (per 1M tokens for text, per image for image models)
// Updated pricing as of 2024 - verify at openrouter.ai/docs
export const MODEL_PRICING: Record<string, { input: number; output: number; perImage?: number }> = {
    // Google models
    'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
    'google/gemini-flash-1.5': { input: 0.075, output: 0.30 },
    'google/gemini-pro-1.5': { input: 1.25, output: 5.00 },
    'google/gemini-2.5-pro-preview-05-06': { input: 1.25, output: 10.00 },
    'google/gemini-3-pro-image-preview': { input: 0.50, output: 2.00, perImage: 0.039 },

    // Anthropic models
    'anthropic/claude-sonnet-4': { input: 3.00, output: 15.00 },
    'anthropic/claude-3.5-sonnet': { input: 3.00, output: 15.00 },
    'anthropic/claude-3-haiku': { input: 0.25, output: 1.25 },

    // OpenAI models
    'openai/gpt-4o': { input: 2.50, output: 10.00 },
    'openai/gpt-4o-mini': { input: 0.15, output: 0.60 },
    'openai/o1': { input: 15.00, output: 60.00 },
    'openai/o3-mini': { input: 1.10, output: 4.40 },

    // DeepSeek models
    'deepseek/deepseek-chat-v3-0324': { input: 0.14, output: 0.28 },
    'deepseek/deepseek-r1': { input: 0.55, output: 2.19 },

    // Perplexity/Research models
    'perplexity/sonar-deep-research': { input: 2.00, output: 8.00 },
    'perplexity/sonar-pro': { input: 3.00, output: 15.00 },
    'perplexity/sonar': { input: 1.00, output: 1.00 },

    // Image generation models (per image pricing)
    'google/imagen-3': { input: 0, output: 0, perImage: 0.03 },
    'google/imagen-3-fast': { input: 0, output: 0, perImage: 0.02 },
    'black-forest-labs/flux-pro-1.1': { input: 0, output: 0, perImage: 0.04 },
    'black-forest-labs/flux-1.1-pro': { input: 0, output: 0, perImage: 0.04 },
    'bytedance-seed/seedream-4.5': { input: 0, output: 0, perImage: 0.02 },

    // Default fallback
    'default': { input: 0.50, output: 2.00 },
};

/**
 * Get all cost entries from localStorage
 */
export function getCosts(): CostEntry[] {
    if (typeof window === 'undefined') return [];
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.error('Failed to load costs:', error);
        return [];
    }
}

/**
 * Add a new cost entry to localStorage
 */
export function addCost(entry: Omit<CostEntry, 'id' | 'timestamp'>): void {
    if (typeof window === 'undefined') return;
    try {
        const costs = getCosts();
        const newEntry: CostEntry = {
            ...entry,
            id: `cost_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            timestamp: new Date().toISOString(),
        };
        costs.push(newEntry);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(costs));

        // Dispatch custom event so CostTracker can update
        window.dispatchEvent(new CustomEvent('costUpdated'));
    } catch (error) {
        console.error('Failed to add cost:', error);
    }
}

/**
 * Clear all cost entries
 */
export function clearCosts(): void {
    if (typeof window === 'undefined') return;
    try {
        localStorage.removeItem(STORAGE_KEY);
        window.dispatchEvent(new CustomEvent('costUpdated'));
    } catch (error) {
        console.error('Failed to clear costs:', error);
    }
}

/**
 * Get total cost of all entries
 */
export function getTotalCost(): number {
    const costs = getCosts();
    return costs.reduce((sum, entry) => sum + entry.cost, 0);
}

/**
 * Calculate cost for a model based on token usage
 */
export function calculateCost(
    model: string,
    inputTokens: number,
    outputTokens: number,
    imageCount: number = 0
): number {
    const pricing = MODEL_PRICING[model] || MODEL_PRICING['default'];

    // Per-image pricing for image generation models
    if (imageCount > 0 && pricing.perImage) {
        return imageCount * pricing.perImage;
    }

    // Token-based pricing (per 1M tokens)
    const inputCost = (inputTokens / 1_000_000) * pricing.input;
    const outputCost = (outputTokens / 1_000_000) * pricing.output;

    return inputCost + outputCost;
}

/**
 * Get cost summary by source
 */
export function getCostSummary(): {
    total: number;
    bySource: Record<CostSource, number>;
    entries: CostEntry[];
} {
    const costs = getCosts();
    const bySource: Record<CostSource, number> = {
        'curate': 0,
        'research': 0,
        'enhance': 0,
        'draft': 0,
        'regen-section': 0,
        'regen-story': 0,
        'image-prompt': 0,
        'image-gen': 0,
    };

    let total = 0;
    for (const entry of costs) {
        total += entry.cost;
        if (bySource[entry.source] !== undefined) {
            bySource[entry.source] += entry.cost;
        }
    }

    return { total, bySource, entries: costs };
}

/**
 * Get profit/loss status based on target earnings
 */
export function getProfitStatus(totalCost: number, targetEarnings: number = 12.50): {
    status: 'profitable' | 'warning' | 'over-budget';
    margin: number;
    percentage: number;
} {
    const margin = targetEarnings - totalCost;
    const percentage = (totalCost / targetEarnings) * 100;

    if (percentage < 50) {
        return { status: 'profitable', margin, percentage };
    } else if (percentage < 80) {
        return { status: 'warning', margin, percentage };
    } else {
        return { status: 'over-budget', margin, percentage };
    }
}
