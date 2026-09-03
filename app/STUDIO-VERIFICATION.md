# Image Studio v2 verification

Verified locally on 2026-09-03. This is a code-readiness record, not approval of live image quality or production activation.

## Passed

- `npm run test:studio`: 35 tests passed. Coverage includes exact model settings, actual ordered reference bytes at both provider boundaries, all reference roles, explicit no-style behavior, stale/manual prompts, Unicode search, unsafe downloads, duplicate requests, failed saves, migration/reordering, revision conflicts, export selection, and signed-session security. Style-fix regressions cover missing-default rejection before paid calls, uploading exactly three references, stable ordering, prompt-version invalidation, generic web-result filtering, and an independent expected-style target for QA.
- TypeScript checking and `npm run build` passed. The production function trace now includes only the three selected references, not the full 40-image analysis collection.
- Focused ESLint checks passed for the new Studio code, scripts, and tests.
- Browser checks against the real Next app with a local fixture backend: saved-draft switching, direction autosave/reload, model selection persistence, signed subject upload, style None, manual-prompt reconciliation, complete clearing, and retained output history.
- Desktop and 390px mobile layouts were inspected. No horizontal overflow or browser-console errors were observed in the checked session.
- Local review corrected request claiming before paid planning, captured-reference consistency, manual-prompt reanalysis, origin handling, password-version signing, public-site compatibility, bounded database requests, and overlapping UI actions. Review was performed in the main task; no independent reviewer or external peer review was run.

## Not yet verified live

- Migration 003 and private storage are now present in the configured project. The reviewed style setup was applied through the app's server-side connection after explicit user approval for only three reference images; no schema changes were made by this repair.
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

## Three-reference style repair checkpoint

- Reanalyzed all 40 supplied images locally, with detailed examination of the five genuinely larger originals. Full observations and the selection rationale are in [STUDIO-STYLE.md](./STUDIO-STYLE.md).
- Uploaded exactly three style assets to private Supabase storage. Active pack: L8R Editorial, version 2, `c1022ff4-bd5e-4fbd-ad4d-ba6e129cba5c`. The other 37 analysis examples were not uploaded to Supabase.
- Selected order: energy landscape, lobster/paper hand, cloud collage. Their lesson captions transfer composition, color treatment and print grain, never their subjects or logos.
- Repaired the three previously unconfigured story workspaces in the diagnosed newsletter and cleared their machine-generated plans. Read-back verification preserved every selected output, original/delivery asset ID and cost receipt. The pre-change snapshot is retained privately in this task's artifacts.
- Using the actual stored bytes, each repaired story assembled exactly three style inputs plus two news inputs for both native image adapters. No AI provider request was made.
- Browser verification covered the ordered three-reference preview and explicit None selection surviving reload. Missing configuration is no longer represented as an intentional None choice.
- Code review: targeted manual due to unrelated branch work. Simplification consolidated art direction and fixed selection in one module and removed the unneeded 40-image uploader. Focused lint is clean. Existing whole-repository lint debt remains outside this repair.
- Live data configuration is verified; the updated system prompt/guards are local code at this checkpoint and require a separate push/deployment. No new paid sample or claim of visual-output acceptance is included.
