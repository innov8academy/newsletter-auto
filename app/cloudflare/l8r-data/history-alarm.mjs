import { nextHistoryExpiry } from './core.mjs';

// A fallback can be reserved before a write. If the write succeeds, the exact
// expiry can move the alarm earlier; if it fails, an extra harmless wakeup occurs.
export async function ensureHistoryAlarm(storage, fallbackTime = null) {
  const expiry = nextHistoryExpiry(storage);
  const due = expiry === null ? fallbackTime : Math.min(expiry, fallbackTime ?? Infinity);
  if (due === null) return;
  const current = await storage.getAlarm();
  if (current === null || current > due) await storage.setAlarm(Math.max(Date.now(), due));
}
