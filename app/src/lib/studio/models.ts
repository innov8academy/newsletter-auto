import type { CostReceipt, PresetId } from './types';
import { StudioError } from './errors';

export const REGISTRY_VERSION = '2026-09-02.1';
export const PLANNER_MODEL = 'google/gemini-3.7-flash';
export const PRESETS = {
  'nano-pro-2k': {
    id: 'nano-pro-2k',
    name: 'Nano Banana Pro · 2K',
    model: 'google/gemini-3-pro-image',
    provider: 'openrouter',
    key: 'OPENROUTER_API_KEY',
    width: 2752,
    height: 1536,
    outputEstimateUsd: 0.1344,
  },
  'gpt-image-2-high': {
    id: 'gpt-image-2-high',
    name: 'GPT Image 2 · 2K High',
    model: 'gpt-image-2',
    provider: 'openai',
    key: 'OPENAI_API_KEY',
    width: 2048,
    height: 1152,
    outputEstimateUsd: 0.1695,
  },
} as const;
export const DEFAULT_PRESET: PresetId = 'nano-pro-2k';
export function presetId(value: unknown): PresetId {
  if (value !== 'nano-pro-2k' && value !== 'gpt-image-2-high')
    throw new StudioError(
      'unsupported_preset',
      'Choose a supported image preset.',
    );
  return value;
}
function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}
const round = (value: number) => Math.round(value * 1e9) / 1e9;
export function textCost(
  usage: Record<string, unknown>,
  at = new Date(),
): CostReceipt {
  const reported = number(usage.cost);
  const input = number(usage.prompt_tokens);
  const output = number(usage.completion_tokens);
  const factor = at >= new Date('2027-01-01T00:00:00Z') ? 2 : 1;
  const amount =
    input !== null && output !== null
      ? round(((input * 0.75 + output * 3.75) * factor) / 1e6)
      : null;
  return {
    model: PLANNER_MODEL,
    amountUsd: reported ?? amount,
    basis:
      reported !== null ? 'provider' : amount !== null ? 'usage' : 'unknown',
    pricingDate: REGISTRY_VERSION,
    usage,
  };
}
export function imageCost(
  id: PresetId,
  usage: Record<string, unknown>,
): CostReceipt {
  const reported = number(usage.cost);
  let amount: number | null = null;
  if (id === 'gpt-image-2-high') {
    const details = usage.input_tokens_details as
      | Record<string, unknown>
      | undefined;
    const image = number(details?.image_tokens);
    const text = number(details?.text_tokens);
    const output = number(usage.output_tokens);
    if (image !== null && text !== null && output !== null)
      amount = round((image * 8 + text * 5 + output * 30) / 1e6);
  }
  return {
    model: PRESETS[id].model,
    amountUsd: reported ?? amount,
    basis:
      reported !== null ? 'provider' : amount !== null ? 'usage' : 'unknown',
    outputEstimateUsd: PRESETS[id].outputEstimateUsd,
    pricingDate: REGISTRY_VERSION,
    usage,
  };
}
