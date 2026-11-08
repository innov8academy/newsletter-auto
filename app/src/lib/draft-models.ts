// Model choices are shared by the browser UI and server generation routes.
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
