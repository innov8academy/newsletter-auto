/** Normalize model output at the boundary; the existing ranking policy stays unchanged. */
export function baseScore(value: unknown): number {
  const number = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isFinite(number) ? Math.min(10, Math.max(0, number)) : 5;
}
export function scoreLabel(value: unknown): string {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value.toFixed(1)).toString() : '—';
}
