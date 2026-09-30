import type { SharedSelectionState } from './storage';

const equal = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
function merge(base: unknown, local: unknown, remote: unknown): unknown {
  if (equal(local, base)) return remote;
  if (equal(remote, base) || equal(local, remote)) return local;
  if (object(base) && object(local) && object(remote)) {
    const result: Record<string, unknown> = {};
    for (const key of new Set([...Object.keys(base), ...Object.keys(local), ...Object.keys(remote)])) {
      result[key] = key === 'studioServerRevision' ? remote[key] : merge(base[key], local[key], remote[key]);
    }
    return result;
  }
  if (Array.isArray(base) && Array.isArray(local) && Array.isArray(remote) &&
      base.length === local.length && base.length === remote.length) {
    const identity = (v: unknown) => object(v) ? v.studioStoryId ?? v.sourceStoryId ?? v.id ??
      (object(v.story) ? v.story.id : undefined) : undefined;
    // Only merge stable identities in identical order. Reorders/removals require review.
    if (base.every((v, i) => identity(v) && identity(v) === identity(local[i]) && identity(v) === identity(remote[i])))
      return base.map((v, i) => merge(v, local[i], remote[i]));
  }
  throw new Error('overlapping edit');
}

/** Conservative three-way merge. Ambiguous changes never win silently. */
export function mergeWorkspace(base: SharedSelectionState, local: SharedSelectionState, remote: SharedSelectionState): SharedSelectionState | null {
  if (base.sessionId !== remote.sessionId || local.sessionId !== base.sessionId) return null;
  try {
    const content = (s: SharedSelectionState) => {
      return Object.fromEntries(Object.entries(s).filter(([key]) => !['revision','updatedAt','draftChoices','resolveVersion'].includes(key)));
    };
    return { ...remote, ...merge(content(base), content(local), content(remote)) as SharedSelectionState,
      revision: remote.revision, updatedAt: remote.updatedAt };
  } catch { return null; }
}
