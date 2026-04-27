-- Shared selected-news handoff state for the single shared account.
-- Run this in Supabase SQL Editor after 001_used_stories.sql.

CREATE TABLE IF NOT EXISTS shared_news_selection (
    id TEXT PRIMARY KEY DEFAULT 'default',
    curated_stories JSONB NOT NULL DEFAULT '[]'::jsonb,
    selected_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shared_news_selection ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage shared_news_selection"
    ON shared_news_selection
    FOR ALL
    USING (true)
    WITH CHECK (true);
