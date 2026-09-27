-- Add a revisioned, single-row newsletter session to the existing shared queue.
-- Apply after 002_shared_news_selection.sql. Existing curated stories and IDs stay in place.
BEGIN;

ALTER TABLE public.shared_news_selection
  ADD COLUMN IF NOT EXISTS session_id text,
  ADD COLUMN IF NOT EXISTS revision integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS research_reports jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS wizard_state jsonb,
  ADD COLUMN IF NOT EXISTS current_draft jsonb;

UPDATE public.shared_news_selection
SET session_id = gen_random_uuid()::text
WHERE session_id IS NULL OR session_id = '';

ALTER TABLE public.shared_news_selection
  ALTER COLUMN session_id SET DEFAULT gen_random_uuid()::text,
  ALTER COLUMN session_id SET NOT NULL;

INSERT INTO public.shared_news_selection (id)
VALUES ('default')
ON CONFLICT (id) DO NOTHING;

-- The API reads and updates through a server-held service-role key only.
-- The old policy omitted TO service_role, so pair the scoped policy with grants.
ALTER TABLE public.shared_news_selection ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Service role can manage shared_news_selection" ON public.shared_news_selection;
CREATE POLICY "Service role can manage shared_news_selection"
  ON public.shared_news_selection FOR ALL TO service_role
  USING (true) WITH CHECK (true);
REVOKE ALL ON public.shared_news_selection FROM PUBLIC, anon, authenticated;
GRANT SELECT, UPDATE ON public.shared_news_selection TO service_role;

COMMIT;
