-- Create used_stories table for duplicate prevention
-- Run this in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS used_stories (
    id SERIAL PRIMARY KEY,
    headline TEXT NOT NULL,
    url TEXT,
    used_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for faster headline lookups
CREATE INDEX IF NOT EXISTS idx_used_stories_headline ON used_stories USING gin (to_tsvector('english', headline));

-- Index for date filtering
CREATE INDEX IF NOT EXISTS idx_used_stories_used_at ON used_stories (used_at);

-- RLS policy (allow service role full access)
ALTER TABLE used_stories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can manage used_stories"
    ON used_stories
    FOR ALL
    USING (true)
    WITH CHECK (true);
