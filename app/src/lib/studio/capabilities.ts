import 'server-only';
import { PLANNER_MODEL, PRESETS, REGISTRY_VERSION } from './models';
import { sessionConfigured, localDevelopment } from '../site-session';
import { StudioError } from './errors';
import type { StudioRepository } from './repository';

export async function capabilities(
  repo: StudioRepository | null,
  env: NodeJS.ProcessEnv = process.env,
) {
  let ready = false;
  let storageError = 'Configure Supabase to save Studio work.';
  let activeStyle: {
    id: string;
    name: string;
    version: number;
    references: number;
  } | null = null;
  if (repo)
    try {
      await repo.checkReady();
      ready = true;
      storageError = '';
      const pack = (await repo.listStyles()).find((style) => style.active);
      if (pack)
        activeStyle = {
          id: pack.id,
          name: pack.name,
          version: pack.version,
          references: pack.anchorIds.length,
        };
    } catch (error) {
      ready = false;
      storageError =
        error instanceof StudioError
          ? error.message
          : 'Studio storage is unavailable.';
    }
  return {
    registryVersion: REGISTRY_VERSION,
    storage: { ready, error: storageError },
    style: { configured: Boolean(activeStyle), active: activeStyle },
    sessionReady: sessionConfigured(env) || localDevelopment(env),
    planner: {
      model: PLANNER_MODEL,
      configured: Boolean(env.OPENROUTER_API_KEY),
    },
    search: {
      configured: Boolean(env.SERPER_API_KEY || env.BRAVE_API_KEY),
      provider: env.SERPER_API_KEY
        ? 'Serper'
        : env.BRAVE_API_KEY
          ? 'Brave'
          : null,
    },
    presets: Object.values(PRESETS).map((preset) => ({
      ...preset,
      configured: Boolean(env[preset.key]),
      reason: env[preset.key]
        ? null
        : `${preset.key} is not configured on the server.`,
    })),
  };
}
let nanoCheckedAt = 0;
export async function verifyNanoCapabilities(
  referenceCount: number,
  fetcher: typeof fetch = fetch,
) {
  if (Date.now() - nanoCheckedAt < 300_000) return;
  const res = await fetcher(
    'https://openrouter.ai/api/v1/images/models/google/gemini-3-pro-image/endpoints',
    { signal: AbortSignal.timeout(10_000) },
  );
  if (!res.ok)
    throw new StudioError(
      'model_unavailable',
      'Could not verify Nano Banana Pro availability. No image request was sent.',
      503,
    );
  const data = await res.json();
  const supported = (data.endpoints || []).some(
    (endpoint: {
      supported_parameters?: Record<
        string,
        { values?: string[]; max?: number }
      >;
    }) => {
      const params = endpoint.supported_parameters;
      return (
        params?.resolution?.values?.includes('2K') &&
        params?.aspect_ratio?.values?.includes('16:9') &&
        (params?.input_references?.max || 0) >= Math.max(10, referenceCount)
      );
    },
  );
  if (!supported)
    throw new StudioError(
      'unsupported_preset',
      'The provider no longer advertises the required 2K/reference settings. Update the model registry before generating.',
      503,
    );
  nanoCheckedAt = Date.now();
}
