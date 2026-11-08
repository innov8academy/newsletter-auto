// SQLite schema for the relational records in migrations 003 and 005.
// JSON values are stored as TEXT. Object bytes belong in a separate object store.
export const schema = [
  `PRAGMA foreign_keys = ON`,
  `CREATE TABLE IF NOT EXISTS studio_drafts (id TEXT PRIMARY KEY, payload TEXT NOT NULL CHECK(json_valid(payload)), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS studio_story_workspaces (draft_id TEXT NOT NULL REFERENCES studio_drafts(id) ON DELETE CASCADE, story_id TEXT NOT NULL, payload TEXT NOT NULL CHECK(json_valid(payload)), revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0), updated_at TEXT NOT NULL, PRIMARY KEY(draft_id,story_id))`,
  `CREATE TABLE IF NOT EXISTS studio_assets (id TEXT PRIMARY KEY, draft_id TEXT REFERENCES studio_drafts(id) ON DELETE CASCADE, role TEXT NOT NULL CHECK(role IN ('style','news','subject','edit-source','output','delivery')), checksum TEXT NOT NULL DEFAULT '', payload TEXT NOT NULL CHECK(json_valid(payload)), created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS studio_assets_draft_idx ON studio_assets(draft_id)`,
  `CREATE TABLE IF NOT EXISTS studio_style_packs (id TEXT PRIMARY KEY, slug TEXT NOT NULL, version INTEGER NOT NULL CHECK(version > 0), payload TEXT NOT NULL CHECK(json_valid(payload)), active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)), created_at TEXT NOT NULL, UNIQUE(slug,version))`,
  `CREATE UNIQUE INDEX IF NOT EXISTS studio_one_active_pack ON studio_style_packs(active) WHERE active=1`,
  `CREATE TABLE IF NOT EXISTS studio_generations (id TEXT PRIMARY KEY, draft_id TEXT NOT NULL REFERENCES studio_drafts(id) ON DELETE CASCADE, story_id TEXT NOT NULL, request_hash TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('running','complete','failed','interrupted','save_failed')), payload TEXT NOT NULL CHECK(json_valid(payload)), started_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS studio_generations_story_idx ON studio_generations(draft_id,story_id,started_at DESC)`,
  `CREATE TABLE IF NOT EXISTS studio_usage_events (id TEXT PRIMARY KEY, draft_id TEXT REFERENCES studio_drafts(id) ON DELETE CASCADE, story_id TEXT, stage TEXT NOT NULL, receipt TEXT NOT NULL CHECK(json_valid(receipt)), created_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS shared_news_selection (id TEXT PRIMARY KEY CHECK(id='default'), session_id TEXT NOT NULL, revision INTEGER NOT NULL DEFAULT 0 CHECK(revision >= 0), curated_stories TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(curated_stories)), selected_ids TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(selected_ids)), research_reports TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(research_reports)), wizard_state TEXT CHECK(wizard_state IS NULL OR json_valid(wizard_state)), current_draft TEXT CHECK(current_draft IS NULL OR json_valid(current_draft)), draft_id TEXT REFERENCES studio_drafts(id), draft_choices TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(draft_choices)), updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS newsletter_versions (id TEXT PRIMARY KEY, source TEXT NOT NULL, session_id TEXT NOT NULL, draft_id TEXT, snapshot TEXT NOT NULL CHECK(json_valid(snapshot)), created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS newsletter_versions_session_idx ON newsletter_versions(session_id,created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS newsletter_versions_expiry_idx ON newsletter_versions(created_at,id)`,
  `CREATE TABLE IF NOT EXISTS news_items (id TEXT PRIMARY KEY, source_id TEXT, url TEXT NOT NULL UNIQUE, title TEXT NOT NULL, published_at TEXT, created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')), raw_summary TEXT, is_processed INTEGER NOT NULL DEFAULT 0 CHECK(is_processed IN (0,1)))`,
  `CREATE INDEX IF NOT EXISTS news_items_source_created_idx ON news_items(source_id,created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS past_newsletters (id TEXT PRIMARY KEY, title TEXT, file_name TEXT, content_html TEXT, content_text TEXT, imported_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE INDEX IF NOT EXISTS past_newsletters_imported_idx ON past_newsletters(imported_at DESC,id DESC)`,
  `CREATE TABLE IF NOT EXISTS used_stories (id INTEGER PRIMARY KEY, headline TEXT NOT NULL, url TEXT, used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')))`,
  `CREATE INDEX IF NOT EXISTS used_stories_used_idx ON used_stories(used_at DESC)`,
];
