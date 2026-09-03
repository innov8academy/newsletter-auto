# Image Studio v2 verification

Verified locally on 2026-09-03. This is a code-readiness record, not approval of live image quality or production activation.

## Passed

- `npm run test:studio`: 23 tests passed. Coverage includes exact model settings, actual ordered reference bytes at both provider boundaries, all reference roles, no-style behavior, stale/manual prompts, Unicode search, unsafe downloads, duplicate requests, failed saves, migration/reordering, revision conflicts, export selection, and signed-session security.
- TypeScript checking and `npm run build` passed. The production function trace includes all 40 supplied style-library images.
- Focused ESLint checks passed for the new Studio code, scripts, and tests.
- Browser checks against the real Next app with a local fixture backend: saved-draft switching, direction autosave/reload, model selection persistence, signed subject upload, style None, manual-prompt reconciliation, complete clearing, and retained output history.
- Desktop and 390px mobile layouts were inspected. No horizontal overflow or browser-console errors were observed in the checked session.
- Local review corrected request claiming before paid planning, captured-reference consistency, manual-prompt reanalysis, origin handling, password-version signing, public-site compatibility, bounded database requests, and overlapping UI actions. Review was performed in the main task; no independent reviewer or external peer review was run.

## Not yet verified live

- The configured Supabase project is missing migration `003_image_studio_v2.sql`. The connected Supabase account denied project access, so no migration was applied.
- Local OpenRouter, OpenAI, and image-search keys are absent. Production key availability has not been verified.
- No paid image generations, live provider quality benchmark, production draft migration, or actual Beehiiv export were run. Browser output images were explicitly labelled fixtures sourced from supplied references.
- Vercel environment configuration, function-duration support, and production activation require deployment review.

## Existing repository debt

The full repository lint command still reports 147 problems (59 errors and 88 warnings), primarily in existing curation, news, meme, and draft code. This change does not claim a clean whole-repository lint run. No broad dependency upgrades or unrelated cleanup were included.

See [STUDIO-SETUP.md](./STUDIO-SETUP.md) for migration, server configuration, style installation, and the user-run visual acceptance checklist.
