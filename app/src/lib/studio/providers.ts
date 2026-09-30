import 'server-only';
import { PLANNER_MODEL, PRESETS, imageCost, textCost } from './models';
import type { BufferedReference, CostReceipt, PresetId } from './types';
import { StudioError } from './errors';

export type Fetcher = typeof fetch;
export interface RenderedImage {
  bytes: Buffer;
  mimeType: string;
  requestId: string | null;
  cost: CostReceipt;
  provider: string;
}
const ORIGIN = 'https://openrouter.ai/api/v1';
export function dataUrl(ref: BufferedReference): string {
  return `data:${ref.mimeType};base64,${ref.bytes.toString('base64')}`;
}
function headers(key: string) {
  return {
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    'X-Title': 'L8R Image Studio',
  };
}
export function buildImageRequest(
  id: PresetId,
  prompt: string,
  references: BufferedReference[],
  key: string,
): { url: string; init: RequestInit } {
  if (references.length > 10)
    throw new StudioError(
      'too_many_references',
      'Use at most ten references including the edit source.',
    );
  if (id === 'nano-pro-2k')
    return {
      url: `${ORIGIN}/images`,
      init: {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({
          model: PRESETS[id].model,
          prompt,
          resolution: '2K',
          aspect_ratio: '16:9',
          n: 1,
          input_references: references.map((ref) => ({
            type: 'image_url',
            image_url: { url: dataUrl(ref) },
          })),
        }),
      },
    };
  const fields = {
    model: 'gpt-image-2',
    prompt,
    size: '2048x1152',
    quality: 'high',
    output_format: 'png',
    n: '1',
  };
  if (!references.length)
    return {
      url: 'https://api.openai.com/v1/images/generations',
      init: {
        method: 'POST',
        headers: headers(key),
        body: JSON.stringify({ ...fields, n: 1 }),
      },
    };
  const form = new FormData();
  for (const [name, value] of Object.entries(fields)) form.set(name, value);
  references.forEach((ref, index) =>
    form.append(
      'image[]',
      new Blob([new Uint8Array(ref.bytes)], { type: ref.mimeType }),
      `reference-${index + 1}.${ref.mimeType === 'image/png' ? 'png' : ref.mimeType === 'image/webp' ? 'webp' : 'jpg'}`,
    ),
  );
  return {
    url: 'https://api.openai.com/v1/images/edits',
    init: {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    },
  };
}
async function providerJson(
  url: string,
  init: RequestInit,
  deadline: number,
  fetcher: Fetcher,
): Promise<{ data: Record<string, unknown>; requestId: string | null }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deadline);
  try {
    const res = await fetcher(url, { ...init, signal: controller.signal });
    if (!res.ok) {
      let detail: Record<string, unknown> = {};
      try { const raw = await res.json(); detail = raw?.error ?? {}; } catch { /* Body omitted intentionally. */ }
      const limit = detail.limit_source ?? (detail.metadata as Record<string, unknown> | undefined)?.limit_source;
      const rawId = res.headers.get('x-request-id');
      const retry = Number(res.headers.get('retry-after'));
      const diagnostic = {
        upstreamStatus: res.status,
        ...(rawId && /^[a-zA-Z0-9_-]{1,128}$/.test(rawId) ? { requestId: rawId } : {}),
        ...(res.headers.has('retry-after') && Number.isFinite(retry) && retry >= 0 && retry <= 86400 ? { retryAfterSeconds: retry } : {}),
        ...(['account', 'key', 'provider'].includes(String(limit)) ? { limitSource: limit as 'account' | 'key' | 'provider' } : {}),
      };
      const message = res.status === 401 || res.status === 403
        ? 'The image provider rejected the server key or model access. Your app login and saved writing are separate; check the configured provider key.'
        : res.status === 402
          ? 'The provider could not fund this image request. Check the active key limit, account balance and pending requests; this does not establish an empty account.'
          : res.status === 429
            ? 'The provider rate limit was reached. Wait before explicitly retrying.'
            : 'The provider returned HTTP ' + res.status + '. No automatic retry or alternate model was requested.';
      throw new StudioError('provider_' + res.status, message, 502, diagnostic);
    }
    return {
      data: await res.json(),
      requestId: res.headers.get('x-request-id'),
    };
  } catch (error) {
    if (error instanceof StudioError) throw error;
    throw new StudioError(
      'outcome_unknown',
      'The provider connection ended before its outcome was confirmed. No automatic paid retry was made.',
      504,
    );
  } finally {
    clearTimeout(timer);
  }
}
export async function renderImage(
  id: PresetId,
  prompt: string,
  references: BufferedReference[],
  env: NodeJS.ProcessEnv = process.env,
  fetcher: Fetcher = fetch,
  deadline = 240_000,
): Promise<RenderedImage> {
  const preset = PRESETS[id];
  const key = env[preset.key];
  if (!key)
    throw new StudioError(
      'missing_provider_key',
      `${preset.key} must be configured on the server.`,
      503,
    );
  const request = buildImageRequest(id, prompt, references, key);
  const result = await providerJson(
    request.url,
    request.init,
    deadline,
    fetcher,
  );
  const images = result.data.data as
    | { b64_json?: string; media_type?: string }[]
    | undefined;
  if (!images?.[0]?.b64_json)
    throw new StudioError(
      'no_image',
      'The provider returned no image bytes.',
      502,
    );
  if (images[0].b64_json.length > 48 * 1024 * 1024)
    throw new StudioError(
      'oversized_output',
      'The provider output exceeded the storage limit.',
      502,
    );
  return {
    bytes: Buffer.from(images[0].b64_json, 'base64'),
    mimeType: images[0].media_type || 'image/png',
    requestId:
      result.requestId ||
      (typeof result.data.id === 'string' ? result.data.id : null),
    cost: {
      ...imageCost(id, (result.data.usage || {}) as Record<string, unknown>),
      id: crypto.randomUUID(),
    },
    provider:
      typeof result.data.provider === 'string'
        ? result.data.provider
        : preset.provider,
  };
}
export async function structuredCall<T>(
  options: {
    system: string;
    text: string;
    schema: Record<string, unknown>;
    schemaName: string;
    references?: BufferedReference[];
    effort?: 'low' | 'medium';
    maxTokens?: number;
    deadlineMs?: number;
  },
  env: NodeJS.ProcessEnv = process.env,
  fetcher: Fetcher = fetch,
): Promise<{ value: T; cost: CostReceipt }> {
  if (!env.OPENROUTER_API_KEY)
    throw new StudioError(
      'missing_provider_key',
      'OPENROUTER_API_KEY must be configured on the server.',
      503,
    );
  const content: unknown[] = [];
  for (const [i, ref] of (options.references || []).entries()) {
    content.push({
      type: 'text',
      text: `IMAGE ${i + 1}: ${ref.role.toUpperCase()} reference ${ref.id}. ${ref.name}. Use: ${ref.note}`,
    });
    content.push({ type: 'image_url', image_url: { url: dataUrl(ref) } });
  }
  content.push({ type: 'text', text: options.text });
  const result = await providerJson(
    `${ORIGIN}/chat/completions`,
    {
      method: 'POST',
      headers: headers(env.OPENROUTER_API_KEY),
      body: JSON.stringify({
        model: PLANNER_MODEL,
        reasoning: { effort: options.effort || 'medium', exclude: true },
        max_tokens: options.maxTokens || 4096,
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: options.schemaName,
            strict: true,
            schema: options.schema,
          },
        },
        messages: [
          { role: 'system', content: options.system },
          { role: 'user', content },
        ],
      }),
    },
    options.deadlineMs || 90_000,
    fetcher,
  );
  const choices = result.data.choices as
    | { message?: { content?: string }; finish_reason?: string }[]
    | undefined;
  if (choices?.[0]?.finish_reason === 'length')
    throw new StudioError(
      'incomplete_plan',
      'The planner reached its output limit. Simplify the brief and try again.',
      502,
    );
  try {
    return {
      value: JSON.parse(choices?.[0]?.message?.content || ''),
      cost: {
        ...textCost((result.data.usage || {}) as Record<string, unknown>),
        id: crypto.randomUUID(),
      },
    };
  } catch {
    throw new StudioError(
      'invalid_provider_json',
      'The planner returned an invalid structured response. Your edited prompt has been retained.',
      502,
    );
  }
}
