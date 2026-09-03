-- Additive L8R Image Studio schema. Existing newsletter records are unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS public.studio_drafts (
  id uuid PRIMARY KEY, payload jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.studio_story_workspaces (
  draft_id uuid NOT NULL REFERENCES public.studio_drafts(id) ON DELETE CASCADE,
  story_id uuid NOT NULL, payload jsonb NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0), updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (draft_id, story_id)
);
CREATE TABLE IF NOT EXISTS public.studio_assets (
  id uuid PRIMARY KEY, draft_id uuid REFERENCES public.studio_drafts(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('style','news','subject','edit-source','output','delivery')),
  checksum text NOT NULL DEFAULT '', payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_assets_draft_idx ON public.studio_assets(draft_id);
CREATE TABLE IF NOT EXISTS public.studio_style_packs (
  id uuid PRIMARY KEY, slug text NOT NULL, version integer NOT NULL CHECK (version > 0),
  payload jsonb NOT NULL, active boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);
CREATE UNIQUE INDEX IF NOT EXISTS studio_one_active_pack ON public.studio_style_packs(active) WHERE active;
CREATE TABLE IF NOT EXISTS public.studio_generations (
  id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES public.studio_drafts(id) ON DELETE CASCADE,
  story_id uuid NOT NULL, request_hash text NOT NULL,
  status text NOT NULL CHECK (status IN ('running','complete','failed','interrupted','save_failed')),
  payload jsonb NOT NULL, started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS studio_generations_story_idx ON public.studio_generations(draft_id, story_id, started_at DESC);
CREATE TABLE IF NOT EXISTS public.studio_usage_events (
  id uuid PRIMARY KEY, draft_id uuid REFERENCES public.studio_drafts(id) ON DELETE CASCADE,
  story_id uuid, stage text NOT NULL, receipt jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.studio_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_story_workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_assets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_style_packs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_generations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.studio_usage_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.studio_drafts, public.studio_story_workspaces, public.studio_assets,
  public.studio_style_packs, public.studio_generations, public.studio_usage_events FROM anon, authenticated;
GRANT ALL ON public.studio_drafts, public.studio_story_workspaces, public.studio_assets,
  public.studio_style_packs, public.studio_generations, public.studio_usage_events TO service_role;
CREATE OR REPLACE FUNCTION public.studio_activate_style_pack(pack_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY INVOKER SET search_path = '' AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(81260302);
  IF NOT EXISTS (SELECT 1 FROM public.studio_style_packs WHERE id = pack_id) THEN RAISE EXCEPTION 'Unknown style pack'; END IF;
  UPDATE public.studio_style_packs SET active = false WHERE active;
  UPDATE public.studio_style_packs SET active = true WHERE id = pack_id;
END;
$$;
REVOKE ALL ON FUNCTION public.studio_activate_style_pack(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.studio_activate_style_pack(uuid) TO service_role;
-- Only explicit newsletter export writes selected delivery images to the public bucket.
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('l8r-studio-private','l8r-studio-private',false,41943040,ARRAY['image/png','image/jpeg','image/webp'])
ON CONFLICT(id) DO NOTHING;
INSERT INTO storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
VALUES ('l8r-newsletter-images','l8r-newsletter-images',true,10485760,ARRAY['image/jpeg'])
ON CONFLICT(id) DO NOTHING;
COMMIT;
