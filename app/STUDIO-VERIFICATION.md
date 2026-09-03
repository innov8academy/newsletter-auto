# Image Studio v2 verification

Verified locally on 2026-09-03. This is a code-readiness record, not approval of live image quality or production activation.

## Passed

- `npm run test:studio`: 30 tests passed. Coverage includes exact model settings, actual ordered reference bytes at both provider boundaries, all reference roles, no-style behavior, stale/manual prompts, Unicode search, unsafe downloads, duplicate requests, failed saves, migration/reordering, revision conflicts, export selection, and signed-session security. New cases cover automatic search/render/attachment, explicit retry, read-only reloads, concurrent clicks, serialized draft revisions, and edits made during saving.
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

The latest full repository lint check reports 138 problems (59 errors and 79 warnings), primarily in existing curation, news, meme, and draft code. Focused checks have no errors; two existing unused-variable warnings remain in the draft page. This change does not claim a clean whole-repository lint run. No broad dependency upgrades or unrelated cleanup were included.

## Inline workflow verification

- One browser click wrote two bodies and started two independent image requests. The summary remained usable while images rendered; both first images attached automatically.
- An inline change made one additional fake render and kept the original selected until the replacement was approved.
- A separate existing-body case generated two missing images without rewriting either body. Text edited during generation survived reload.
- Fixture counters ended at two body calls, four searches, five plans, five renders, and one edit. Reloads and body edits did not increase generation counts. All provider boundaries in this browser harness were deterministic doubles, not paid calls.
- The mobile review measured 385px document width at a 390px viewport. Both delivery previews loaded at 2048x1152. Desktop and mobile screenshots are saved in this task's artifacts.
- The simplification pass removed duplicate body-batch generation logic, kept reference selection in the existing search module, and used the central price registry. The final scoped main-task review found no remaining actionable code findings. It did not provide independent-model corroboration.
- At the local validation checkpoint, this revision was uncommitted and unpushed. Git and deployment status must be checked separately; these checks do not establish live activation.

## Post-deploy validation

Before activation, apply the existing migration, verify server keys and duration support, and install the approved L8R style once. Then generate a small newsletter: each story should have one saved generation with ordered news/style references, a selected delivery asset, and recorded provider usage. Confirm reload and text edits do not add provider calls, and exported images use durable public URLs. Stop further generation if duplicate charges, missing selected assets, or revision conflicts appear; retain run records for diagnosis. The user owns live image-quality acceptance and deployment approval.

See [STUDIO-SETUP.md](./STUDIO-SETUP.md) for migration, server configuration, style installation, and the user-run visual acceptance checklist.
