import { DurableObject } from 'cloudflare:workers';
import { initialize, execute, pruneExpiredHistory } from './core.mjs';
import { dispatch, response } from './gateway.mjs';
import { ensureHistoryAlarm } from './history-alarm.mjs';

export default { fetch: dispatch };

function mayChangeHistory(input) {
  if (input?.op === 'newsletter_save' || input?.op === 'newsletter_studio_save') return true;
  if (input?.op === 'query') return typeof input.sql === 'string' &&
    /newsletter_versions/i.test(input.sql) && !/^\s*SELECT\b/i.test(input.sql);
  if (input?.op === 'batch') return Array.isArray(input.statements) && input.statements.some(
    statement => typeof statement?.sql === 'string' && /newsletter_versions/i.test(statement.sql) && !/^\s*SELECT\b/i.test(statement.sql));
  return false;
}

export class L8RData extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      initialize(ctx.storage.sql);
      await ensureHistoryAlarm(ctx.storage);
    });
  }
  async fetch(request) {
    if (request.method !== 'POST' || new URL(request.url).pathname !== '/internal') return response(404, { ok: false, error: 'not_found' });
    try {
      const input = await request.json();
      const changesHistory = mayChangeHistory(input);
      if (changesHistory)
        await ensureHistoryAlarm(this.ctx.storage, Date.now() + 24 * 60 * 60 * 1000);
      const result = execute(this.ctx.storage, input);
      if (changesHistory) {
        // The pre-write alarm is already durable. A failed refinement must not
        // turn a committed save into an apparent failure and invite a retry.
        try { await ensureHistoryAlarm(this.ctx.storage); } catch { /* fallback alarm remains */ }
      }
      return response(200, { ok: true, result });
    } catch (error) {
      const code = error instanceof Error && /^(invalid_payload|invalid_query|unknown_operation|unknown_style_pack|missing_recovery_version|invalid_recovery_version)$/.test(error.message)
        ? error.message : 'storage_error';
      return response(code === 'storage_error' ? 503 : 400, { ok: false, error: code });
    }
  }
  async alarm() {
    pruneExpiredHistory(this.ctx.storage);
    await ensureHistoryAlarm(this.ctx.storage);
  }
}
