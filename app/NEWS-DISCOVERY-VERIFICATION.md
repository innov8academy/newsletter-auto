# News discovery repair — 2026-09-07

Scope: main RSS/news curation only. X refresh and its cache were not changed.

## Changes

- Reject missing, invalid, and future publication dates. Filter and sort before limiting a source's entries.
- Parse Atom content and alternate links. Preserve article evidence links in RSS and scraped newsletters.
- Use OpenAI's working RSS endpoint and Anthropic's dated news index. Lower the Hacker News discovery threshold to 10 points.
- Report HTTP/source errors as failures. Use explicitly labelled Google News index fallbacks for VentureBeat and MarkTechPost.
- Give every source with fresh content an extraction slot before filling the remaining 80-item budget by recency.
- Do not inherit a newsletter's send date for its extracted events. Require an explicit supported event date or a linked article's publication date; otherwise withhold the item. Reader lookups of model-selected links use Jina rather than fetching those hosts directly from the app server.
- Share duplicate matching between extraction, exclusions, and Find More; recognize paraphrased releases while distinguishing versions and separate events. Deduplication remains heuristic, not a guarantee of perfect event clustering.
- Never resurrect used stories to fill an empty result set.
- Prune old unselected cards on restore and Find More, preserve selected work, and display dates and degraded coverage.

## Verification

- 54 tests passed: 15 news regression tests and all 39 existing Studio tests.
- TypeScript check passed. Production build passed with network access for the existing Google Fonts imports.
- New helper/test/script lint passed. Existing files retain pre-existing lint violations; comparison against HEAD found no added errors (page: 12 unchanged, fetcher: 2 to 1, curator: 2 unchanged, scraper: 0).
- Two read-only full curation runs used live feeds and the configured Gemini service. No publishing or selected-queue writes occurred.
- The second run collected 111 articles within 24 hours and processed 80, including OpenAI's available official article. It returned 55 candidates with timestamps no older than about 20.5 hours. Further duplicate wording from this run was added to the passing regression tests; that count is not a claim about the final patched output or independent verification of every event date.
- Verified VentureBeat and MarkTechPost index fallbacks returned 4 and 3 recent items respectively in a live run.

## Remaining external limits

Techspresso's RSS service returned HTTP 402. Reddit intermittently returned 429. These remain provider access limits and are surfaced rather than silently described as empty/healthy. Anthropic's adapter parsed dated entries but had no item within the configured window in the source audit.

Saved legacy story timestamps cannot establish original event dates. Find News replaces that batch with newly checked results. Selected older work is preserved and labelled.

The live website has not been deployed by this repair. Local verification does not prove Vercel source access, whose network can receive different provider responses.

## Review scope

Targeted manual reuse, quality, efficiency, and correctness review of fix-owned files, following the workspace's sequential review rule. Existing edits to `.gitignore` and `app/src/app/api/status/route.ts`, and unrelated documents/artifacts, were excluded. No database schema, X API, or publishing changes.
