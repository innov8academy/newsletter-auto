# Image Studio v2 setup and live test

The default preset is Nano Banana Pro 2K through OpenRouter. GPT Image 2 uses the direct OpenAI Images API at 2048×1152/high. Gemini 3.7 Flash handles planning, reference analysis and advisory QA. No renderer silently falls back to another model.

## Activate the backend

1. Apply `supabase-migrations/003_image_studio_v2.sql` in the app project's SQL Editor or privileged migration pipeline. It adds Studio tables, an atomic style activation function, and two storage buckets. It does not alter existing newsletter records.
2. Configure the server variables listed in `.env.studio.example`. OpenRouter is required for planning and the default renderer. OpenAI enables the optional premium preset. Serper enables web references; Brave is an optional fallback.
3. In production, configure `SITE_PASSWORD`. Existing unsigned cookies will require one new login. A dedicated `SESSION_SECRET` is recommended; otherwise the service key is used only as HKDF input with a session-specific domain, never sent to the client.
4. Use Node functions with Fluid Compute enabled and a 300-second duration allowance. The Studio routes declare `maxDuration = 300`. The 50 MB Server Actions setting does not increase Vercel's route payload limit; uploads go directly to signed Storage URLs.
5. Run `npm run studio:preflight -- --models` from `app/`. This prints configuration booleans and capability metadata only. It does not generate images or print keys.
6. Open Studio → Style library → **Install and use L8R Editorial v2**. Alternatively run `node --conditions=react-server --import tsx scripts/studio-install-style.ts --confirm`. This uploads only the three selected references and activates the extracted version-2 style rules: energy landscape, lobster/paper hand, and cloud collage. All 40 examples informed the local analysis; the other 37 are not uploaded or sent to renderers. Installation is idempotent. See [the complete style analysis](./STUDIO-STYLE.md).

Missing default style now blocks planning/rendering before paid calls. It is distinct from explicitly choosing **None**, which stores `styleDisabled: true`. Installing a default does not rewrite already-created story workspaces. To repair a known draft, `scripts/studio-activate-reviewed-style.ts --project PROJECT_REF --draft DRAFT_ID` first prints a read-only snapshot; save that snapshot privately, review it, then rerun with `--snapshot SNAPSHOT_PATH --confirm` only after approval. The repair binds unconfigured workspaces, clears machine-generated plans, preserves manual prompts and every output/selection, and verifies actual reference bytes without calling an AI provider.

## Storage and workflow

- In the newsletter wizard, **Generate body + images** writes the pending stories and starts one image per story as its body finishes. Image search, reference selection, prompt preparation, saving, and first-image attachment are automatic. Continue writing the summary while images finish.
- Existing body content has one **Generate missing images** action. Opening a page, editing text, or regenerating existing body text never starts a replacement image. Failed attempts require an explicit retry; ambiguous outcomes warn about possible earlier charges.
- Each story has a compact preview and **Change image** field. A revision stays separate until **Use this version** is clicked; **Keep current** preserves the selected original. Prompts, uploads, model settings, and reference overrides remain in the optional advanced image editor.
- The summary ends at **Review newsletter**, with content, selected images, and the explicit Beehiiv draft export together. Going through Studio is no longer required.
- Drafts use stable UUIDs and revision checks. Version-2 drafts are imported without clearing their original content. Local drafts that conflict are retained as `studio_unsynced_draft` and can be imported as a separate copy.
- Studio assets are private. Display URLs expire after one hour and can be refreshed from each preview. The database stores object paths, never those expiring URLs.
- Original output and the 2048×1152 JPEG delivery image are saved before a generation is reported complete. The supplied seed examples are reference material, not generated output.
- **Use this image** selects an output for a story. **Beehiiv draft** is the explicit export action that copies selected delivery images to the public newsletter bucket and creates a draft. Reference images are never copied publicly.
- Inputs and generations use server IDs rather than large base64 request/response bodies. Original images can be downloaded directly using a refreshed signed URL.
- An interrupted request is never automatically resubmitted. Inspect provider history before requesting another paid render after an ambiguous timeout. Storage-save retries reuse the same bytes; they do not regenerate an image.
- Generation cost receipts are persisted even when saving an image fails. Unknown input costs are shown as unknown, not zero. Existing browser workflow cost history is not rewritten.

## Validation

Run `npm run test:studio`, `npx tsc --noEmit --incremental false`, and `npm run build`. Focused tests exercise the actual Studio service and image processing against a memory repository; no provider credentials are required and no paid calls occur.

For a full UI check without touching live data, run `node --conditions=react-server --import tsx scripts/studio-browser-fixture.ts`. It runs the app on port 3001 with a local Supabase-compatible fixture service on 4319. It overrides provider keys with empty values and uses supplied reference images as clearly labelled fixture output. Do not treat fixture screenshots as creative-quality evidence.

Add `--draft` to test the combined writing flow at `http://127.0.0.1:3001/fixture`. Its local proxy uses deterministic provider doubles with the real generation service and storage adapter; the Next app runs on 3002. The fixture page offers unwritten or existing body scenarios. `/fixture/counts` reports fake provider call counts so reloads and edits can be checked for duplicate work. This harness is never imported by the deployed application.

The user will test live image quality. Use the following five briefs, with identical selected references on both presets, two attempts each (20 outputs):

| Story type | Acceptance focus |
|---|---|
| Named person | Recognizable supplied person, no unrelated sample subjects |
| Product release | Accurate referenced product details, coherent editorial treatment |
| Financial news | Clear visual idea, no invented numbers or charts |
| Abstract policy | Relevant metaphor and readable composition |
| Explicit meme | Requested character preserved; meme dominance is not imposed elsewhere |

The proposed evaluation cap is $10 including inputs, planning and QA. Output-only baseline is about $3.04 for ten outputs from each preset; actual input costs vary. No automated benchmark runs on deployment.

Accept when at least eight of ten default-preset results score 4/5 or better for relevance, style, recognizability and readability, and the selected images survive reload/reordering and export with stable URLs. The advisory model scores do not replace human review.

Prices and provider capabilities were checked on 2026-09-02. Gemini 3.7 pricing doubles on 2027-01-01; the usage calculator accounts for that boundary. Model registry changes require the same regression and visual checks.
