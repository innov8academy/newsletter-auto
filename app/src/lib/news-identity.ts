// Use the same event comparison in extraction, exclusions, and Find More.
const launch = /\b(launch\w*|releas\w*|debut\w*|introduc\w*|unveil\w*|announc\w*|rollout\w*|available)\b/i;
const filler = new Set('the a an as at by from has have into this that is now for with and of to in its model models new next gen public use general generally intelligence capabilities capability interaction multimodal real time advanced powered latest ai milestone'.split(' '));

function words(text: string): Set<string> {
  return new Set(text.toLowerCase().replace(/[’']s\b/g, '').replace(/[’']/g, '')
    .replace(/\bhijack\w*\b/g, 'hijack').replace(/\b(coordinat\w*|communicat\w*)\b/g, 'communicate')
    .replace(/[^a-z0-9.\s]/g, ' ')
    .split(/\s+/).filter(word => word.length > 1 && !filler.has(word) && !launch.test(word)));
}

export function newsSimilarity(a: string, b: string): number {
  const versions = (s: string): string[] => Array.from(s.match(/\b\d+(?:\.\d+)*\b/g) || []);
  const av = versions(a), bv = versions(b);
  // Version numbers distinguish releases even when almost every other word matches.
  if (av.length && bv.length && !av.some(v => bv.includes(v))) return 0;
  const aLaunch = launch.test(a), bLaunch = launch.test(b);
  if (aLaunch !== bLaunch) return 0;
  const aw = words(a.split(':')[0]), bw = words(b.split(':')[0]);
  const shared = [...aw].filter(word => bw.has(word));
  if (aLaunch && shared.filter(word => /[a-z]/.test(word)).length >= 2 &&
      shared.length / Math.min(aw.size, bw.size) >= 0.8) return 1;
  const allA = words(a), allB = words(b);
  const intersection = [...allA].filter(word => allB.has(word)).length;
  return intersection / (new Set([...allA, ...allB]).size || 1);
}

export function canonicalNewsUrl(value: string | null | undefined): string {
  try {
    const url = new URL(value || '');
    if (!['https:', 'http:'].includes(url.protocol) || url.pathname === '/') return '';
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    return url.toString().replace(/\/$/, '');
  } catch { return ''; }
}
