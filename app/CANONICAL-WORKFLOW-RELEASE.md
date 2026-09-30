# Canonical newsletter workflow

The current newsletter body is stored once in studio_drafts.payload. shared_news_selection stores its draft_id plus the selected news, research, writing progress and workspace revision. Writing and Image Studio consume that same body. Existing cloud image assets and story workspaces retain their stable IDs.

Visible tabs check the workspace every 3 seconds and image state every 5 seconds, also refreshing on focus. This is polling, not simultaneous Google Docs character editing. Saves compare both workspace and body revisions. Independent fields can merge; overlapping edits stop and offer the latest copy, a downloadable local copy, or an explicit replacement. A stale tab cannot silently overwrite newer work. Each accepted save preserves a prior cloud version.

Browser backups retain unsent typing while offline or signed out. Sign in opens another tab; return and Retry save. Authentication expiry/security settings were not changed. A browser backup is not an acknowledged cloud save.

Find News adds deduplicated candidates and preserves selections, research and writing. New newsletter explicitly archives the prior workspace. Cloud History offers reviewed restoration and retains recent archives separately from frequent typing snapshots. The standalone meme canvas remains an export tool; its unexported canvas is not a shared cloud document. Downloaded files remain on the user's device; existing Studio assets and uploaded newsletter records retain their existing cloud storage.

## Migration and release (not performed)

1. Back up shared_news_selection, studio_drafts, studio_story_workspaces, studio_assets, generation records and storage objects. Retain a database rollback backup.
2. Test this release on a non-production copy with the real schema and sanitized fixtures. Use existing migrations 001-003 as required, then 005_canonical_newsletter.sql. Migration 005 supplies the shared table on fresh installs; the pre-existing locally empty/modified 004 file is intentionally untouched.
3. Use a short maintenance window with both people out of the old app. Apply migration 005 and deploy this app as one coordinated release. Old app versions write duplicate draft fields and must not remain active during transition. Do not roll back to the old writer after new canonical saves without explicit data reconciliation.
4. Migration 005 archives both legacy Writing and Image Studio versions. Neither wins automatically. On first use, review both JSON copies and explicitly choose which body to continue. Both remain in cloud history, with existing assets unchanged.
5. Verify Alex selects and edits, friend sees/edits, both reload the same draft and image selection; verify overlapping edits, old tabs, expired-login retry, adding news, restoration, and zero generation on reload against staging. Production smoke checks require release approval and authorized existing access.
6. No provider credential, billing or authentication setting change is needed by this release. HuggingNews works anonymously for its recent public feed. Optional HUGGINGNEWS_API_KEY must be set separately through secure server environment configuration if later desired; no supplied key was configured or used.

## Local verification

- Node TypeScript regression suite: 80 tests passed (mocked provider and cloud requests).
- Migration and save transaction suite: 3 tests passed against PGlite, an actual PostgreSQL engine. Covers both legacy versions, partial progress, migration idempotency, revision conflicts, Studio/workspace ordering, archival restore, stable IDs and denied anonymous access.
- Two independent browser contexts: four cloud-fixture saves; edit handoff, reload, expired-login recovery, Find News preservation; zero generation requests. Desktop screenshots cover Find News, Research, Writing and Studio; mobile Find News has no overflow at 390px.
- Anonymous live HuggingNews adapter returned 12 recent stories with attributed primary links. No credentials sent.
- Full lint baseline has existing errors: original 60 errors / 78 warnings; revised 53 errors / 68 warnings, with no increased error counts by file/rule. This release does not claim a clean legacy repository.
- Production build passed with webpack, including TypeScript and page generation. Build uses webpack for the isolated verification checkout because its node_modules junction lies outside Turbopack's root. Runtime/provider integration and production database deployment remain unverified; no paid requests were issued.

Run: node --conditions=react-server --import tsx --test tests/*.test.ts; npm run test:database; npx tsc --noEmit; npm run build -- --webpack. The browser fixture tests/browser-workflow.js expects a local app on port 3108 and Playwright's run-code context. All API routes are mocked by the fixture.
