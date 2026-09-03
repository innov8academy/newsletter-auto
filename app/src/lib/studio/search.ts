import 'server-only';
import { structuredCall } from './providers';
import { StudioError } from './errors';
import type {
  ReferenceSelection,
  SearchCandidate,
  StudioAsset,
  StudioStory,
} from './types';

// Keep story-query relevance order, but condition only on validated, distinct
// image bytes. Bound failed downloads so rendering still has time to finish.
export async function importNewsReferences(
  candidates: SearchCandidate[],
  importer: (candidate: SearchCandidate) => Promise<StudioAsset>,
  deadline: number,
  allowBrandReferences = false,
) {
  const selected: ReferenceSelection[] = [];
  const rejected: string[] = [];
  const substantive = candidates.filter((candidate) => {
    const title = candidate.title.trim();
    const generic =
      /^(?:sign[ -]?in|log[ -]?in)\b|^(?:home|homepage)\s*[\\|/–—-]/i.test(
        title,
      );
    const branding =
      /\b(?:logo|logotype|brand identity|brand guidelines|identity design)\b/i.test(
        title,
      );
    if (generic || (branding && !allowBrandReferences)) {
      rejected.push(title);
      return false;
    }
    return true;
  });
  for (const candidate of substantive.slice(0, 4)) {
    if (selected.length === 2 || Date.now() > deadline) break;
    try {
      const asset = await importer(candidate);
      if (!selected.some((ref) => ref.assetId === asset.id))
        selected.push({
          assetId: asset.id,
          role: 'news',
          note: candidate.title,
        });
    } catch {
      rejected.push(candidate.title || 'Web image');
    }
  }
  return { selected, rejected };
}

export function deduplicateCandidates(
  images: SearchCandidate[],
): SearchCandidate[] {
  const seen = new Set<string>();
  return images
    .filter((image) => {
      try {
        if (new URL(image.url).protocol !== 'https:') return false;
      } catch {
        return false;
      }
      const key = image.url.split('#')[0];
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 10);
}
async function searchProvider(
  query: string,
  provider: 'serper' | 'brave',
  env: NodeJS.ProcessEnv,
  fetcher: typeof fetch,
): Promise<SearchCandidate[]> {
  const key = provider === 'serper' ? env.SERPER_API_KEY : env.BRAVE_API_KEY;
  if (!key) return [];
  const url =
    provider === 'serper'
      ? 'https://google.serper.dev/images'
      : `https://api.search.brave.com/res/v1/images/search?q=${encodeURIComponent(query)}&count=5&safesearch=moderate`;
  const res = await fetcher(url, {
    method: provider === 'serper' ? 'POST' : 'GET',
    headers:
      provider === 'serper'
        ? { 'X-API-KEY': key, 'Content-Type': 'application/json' }
        : { 'X-Subscription-Token': key, Accept: 'application/json' },
    ...(provider === 'serper'
      ? { body: JSON.stringify({ q: query, num: 5 }) }
      : {}),
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok)
    throw new StudioError(
      'search_provider_failed',
      `${provider === 'serper' ? 'Serper' : 'Brave'} could not complete the search.`,
      502,
    );
  const data = await res.json();
  const images: Record<string, unknown>[] =
    provider === 'serper' ? data.images || [] : data.results || [];
  return images.slice(0, 5).map((item) => {
    const props = item.properties as Record<string, unknown> | undefined;
    const thumb = item.thumbnail as Record<string, unknown> | undefined;
    const original =
      provider === 'serper' ? item.imageUrl : props?.url || item.url;
    const page = provider === 'serper' ? item.link : item.url;
    return {
      url: String(original || ''),
      thumbnail: String(
        provider === 'serper'
          ? item.thumbnailUrl || original || ''
          : thumb?.src || original || '',
      ),
      title: String(item.title || 'News reference').slice(0, 500),
      source: String(item.source || '').slice(0, 300),
      sourcePageUrl:
        typeof page === 'string' && /^https?:\/\//i.test(page) ? page : null,
    };
  });
}
export async function findNewsReferences(
  story: StudioStory,
  direction: string,
  env: NodeJS.ProcessEnv = process.env,
  fetcher: typeof fetch = fetch,
) {
  if (!env.SERPER_API_KEY && !env.BRAVE_API_KEY)
    throw new StudioError(
      'search_not_configured',
      'Configure SERPER_API_KEY or BRAVE_API_KEY on the server to find web references.',
      503,
    );
  const queryPlan = await structuredCall<{ queries: string[] }>(
    {
      system:
        'Create exactly two concise image-search queries for factual subjects in this story and creative direction: the actual person, product, hardware, product screenshot or real setting. Prefer useful official/news imagery. Avoid login pages, generic homepages, brand-guideline galleries and logo-only results unless the story is explicitly about a logo or rebrand. These references identify subjects, not the editorial palette or style. Preserve Unicode and proper names; use English aliases only when supported by the story. Return JSON only.',
      schemaName: 'l8r_image_queries',
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          queries: {
            type: 'array',
            items: { type: 'string' },
            minItems: 2,
            maxItems: 2,
          },
        },
        required: ['queries'],
      },
      text: JSON.stringify({ story, direction }),
      effort: 'low',
      maxTokens: 700,
    },
    env,
    fetcher,
  );
  if (
    !Array.isArray(queryPlan.value.queries) ||
    queryPlan.value.queries.length !== 2 ||
    !queryPlan.value.queries.every(
      (q) => typeof q === 'string' && q.trim() && q.length <= 250,
    )
  )
    throw new StudioError(
      'invalid_queries',
      'The planner returned invalid search queries.',
      502,
    );
  const results = await Promise.allSettled(
    queryPlan.value.queries.map(async (query) => {
      let primary: SearchCandidate[] = [];
      if (env.SERPER_API_KEY)
        primary = await searchProvider(query, 'serper', env, fetcher).catch(
          () => [],
        );
      if (primary.length) return primary;
      if (env.BRAVE_API_KEY)
        return searchProvider(query, 'brave', env, fetcher);
      throw new StudioError(
        'search_provider_failed',
        'The image search provider returned no usable results. Try a different creative direction.',
        502,
      );
    }),
  );
  const images = deduplicateCandidates(
    results.flatMap((result) =>
      result.status === 'fulfilled' ? result.value : [],
    ),
  );
  return {
    images,
    queries: queryPlan.value.queries,
    cost: queryPlan.cost,
    warning: images.length
      ? null
      : 'No usable images were found. You can change the direction or upload a subject reference.',
  };
}
