# L8R data Worker

This directory contains the SQLite Durable Object backend for L8R. The app selects it with `L8R_STORAGE_BACKEND=cloudflare`. Migration does not clear existing Supabase data.

The Worker accepts only `POST /internal` with `Content-Type: application/json` and `Authorization: Bearer <INTERNAL_SECRET>`. Set a fresh random secret of at least 32 characters in the Worker and the app server. The route does not send CORS headers. Never expose the secret to browser code. All requests go to one named Durable Object (`l8r-primary`), which serializes synchronous transactions.

## Request and response contract

Every successful response is `{ "ok": true, "result": ... }`. Failures are `{ "ok": false, "error": "code" }` with HTTP 400, 401, 404, 413, 415, or 503. The Worker does not return SQL errors, tokens, or request bodies. It does not log payloads. The maximum JSON body is 16 MiB.

| Operation | Request body | Result |
| --- | --- | --- |
| `health` | `{ "op": "health" }` | `{ "ready": true }` |
| `query` | `{ "op": "query", "sql": "SELECT ... WHERE id=?", "params": ["..."] }` | `{ "rows": [...], "changes": 0 }` |
| `batch` | `{ "op": "batch", "statements": [{ "sql": "...", "params": [...] }] }` | Array of query results; all statements commit or roll back together |
| `newsletter_state` | `{ "op": "newsletter_state" }` | Database shaped shared workspace row, with parsed JSON and active draft payload plus `studioServerRevision` |
| `newsletter_save` | `{ "op": "newsletter_save", "expectedRevision": 0, "content": { "sessionId": "...", "curatedStories": [], "selectedIds": [], "researchReports": [], "wizardState": null, "currentDraft": null }, "resolveVersion": null }` | `{ "state": row }`, `{ "conflict": true, "state": row }`, or `{ "choiceRequired": true, "state": row }` |
| `newsletter_studio_save` | `{ "op": "newsletter_studio_save", "body": { "studioDraftId": "uuid", "stories": [] }, "expectedRevision": null }` | Parsed `studio_drafts` row, `{ "conflict": true }`, or `{ "choiceRequired": true }` |
| `activate_style` | `{ "op": "activate_style", "packId": "uuid" }` | `{ "activePackId": "uuid" }` |

`expectedRevision: null` is valid only for creating a new studio draft. A stale revision is a nonmutating conflict. `newsletter_save` archives the previous shared state before writing and increments the shared revision. A recovery choice is mandatory when `draft_choices` is nonempty. Selected choices replace the body while retaining the current story and report order, following migration 005. Version cleanup runs after successful saves and from a [Durable Object alarm](https://developers.cloudflare.com/durable-objects/api/alarms/) at the earliest unprotected version's 24-hour expiry. It never removes an ID referenced by the **current** `draft_choices`, or any draft, style, asset, writing example, or current newsletter content. A protected recovery version can remain older than one day until its choice is resolved. Alarms need no Cron Trigger configuration; their invocations count toward [Durable Object usage](https://developers.cloudflare.com/durable-objects/platform/pricing/). Cloudflare may deliver an alarm late, so physical deletion is best-effort near the one-day boundary; the app's history route filters unprotected versions at exactly 24 hours.

Alarm scheduling queries the `newsletter_versions_expiry_idx` index for one unprotected timestamp. Recovery choices are excluded in SQLite with `json_each`, so autosaves do not transfer the full history into Worker memory.

`query` and `batch` are administrative primitives for trusted server code only. They accept positional SQLite scalar parameters (`string`, finite `number`, `null`). JSON columns must be JSON encoded on write and decoded on read. They reject transaction control and `PRAGMA`; use `batch` for atomic groups. SQL responses return rows and `rowsWritten` as `changes`. The app server must enforce table and field level business validation before calling these primitives. The generic API is intentionally capable of changing or deleting rows, so only the app server may hold the bearer secret.

## Fresh-start migration

The Cloudflare workspace starts with its initialized empty newsletter. Do not import the old current newsletter, its active draft, story workspaces, generation records, usage events, or old edit history. The old Supabase records remain in place; this migration does not delete them.

The selective [importer](../../scripts/cloudflare-import.py) is dry run by default. It validates the source backup and prepares **seven records**: one active style pack, its three reusable style asset records, and three `past_newsletters` writing examples. It checks that the pack's `anchorIds` and `assetIds` exactly match those assets. `--apply` requires an explicit Worker URL and secret, refuses a nonempty target, and sends one atomic batch. It leaves the initialized shared newsletter state alone. System prompts remain in app code.

The [style seed tool](../../scripts/cloudflare-seed-style.ts) and [R2 adapter](../../src/lib/studio/r2-object-store.ts) handle image bytes separately from SQLite metadata. Copy private reference images to a private R2 bucket, check their hashes and read them back before switching the app. Public newsletter delivery images use a separate bucket.

The app's server routes call this Worker only when `L8R_STORAGE_BACKEND=cloudflare`. Keep the bearer secret on the server; the browser calls the app's routes, which retain request validation and origin checks. Set `CLOUDFLARE_ACCOUNT_ID` in the deployment environment, configure the Worker endpoint and matching secret in the app server, and use scoped R2 credentials. Keep the private bucket off public domains. Configure `R2_PUBLIC_BASE_URL` for the separate delivery bucket.

The 24-hour cleanup applies to edit snapshots. Old Studio drafts and private images are not automatically deleted; public delivery images may be referenced by sent newsletters and must not be removed by a blanket lifecycle rule. A safe cleanup needs coordinated draft retirement and reference checks. Cloudflare R2 usage beyond the free allowance may be billed.

Before a Git-based release, confirm that the deployment branch contains this migration and that its environment variables are configured. `SUPABASE_SERVICE_ROLE_KEY` can still be used as a fallback for signing site sessions; configure `SESSION_SECRET` before removing it.

The SQLite schema ports the relevant relational tables but cannot carry Supabase RLS, Postgres RPCs, or Supabase Storage bytes. JSON fields are stored as TEXT and style `active` is stored as 0 or 1. `query` and `batch` remain admin-only and require server-side validation.

Run `node --test core.test.mjs` from this directory with Node 24. These tests exercise the core against `node:sqlite`. Before release, also verify the alarm lookup, private image reads, upload CORS, public delivery URL, and deployed app in the target environment. Cloudflare's [SQLite API](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/) specifies synchronous `sql.exec` and `storage.transactionSync`; its [Durable Object guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/) recommends initializing schema inside `blockConcurrencyWhile`.
