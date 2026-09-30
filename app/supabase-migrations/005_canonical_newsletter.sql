-- Apply only after backup and release approval. No provider calls or image changes.
BEGIN;
-- 004 was empty in the local checkout: safely supply its missing schema on fresh installs.
CREATE TABLE IF NOT EXISTS public.shared_news_selection (
  id text PRIMARY KEY, session_id text NOT NULL, revision integer NOT NULL DEFAULT 0,
  curated_stories jsonb NOT NULL DEFAULT '[]', selected_ids jsonb NOT NULL DEFAULT '[]',
  research_reports jsonb NOT NULL DEFAULT '[]', wizard_state jsonb, current_draft jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.shared_news_selection ADD COLUMN IF NOT EXISTS draft_id uuid;
ALTER TABLE public.shared_news_selection ADD COLUMN IF NOT EXISTS draft_choices jsonb NOT NULL DEFAULT '[]';
CREATE TABLE IF NOT EXISTS public.newsletter_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), source text NOT NULL,
  session_id text NOT NULL, draft_id uuid, snapshot jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS newsletter_versions_session_idx ON public.newsletter_versions(session_id, created_at DESC);
ALTER TABLE public.shared_news_selection ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.newsletter_versions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.shared_news_selection, public.newsletter_versions FROM anon, authenticated;
GRANT ALL ON public.shared_news_selection, public.newsletter_versions TO service_role;
INSERT INTO public.shared_news_selection(id,session_id) VALUES('default',gen_random_uuid()::text) ON CONFLICT DO NOTHING;

-- Preserve BOTH versions before any reconciliation. A divergent pair requires an explicit choice.
DO $$
DECLARE w public.shared_news_selection; d public.studio_drafts; shared_version uuid; studio_version uuid;
BEGIN
  SELECT * INTO w FROM public.shared_news_selection WHERE id='default' FOR UPDATE;
  IF w.current_draft IS NOT NULL AND w.draft_id IS NULL AND w.draft_choices='[]'::jsonb THEN
    INSERT INTO public.newsletter_versions(source,session_id,snapshot)
      VALUES('legacy-writing',w.session_id,to_jsonb(w)) RETURNING id INTO shared_version;
    IF w.current_draft->>'studioDraftId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
      SELECT * INTO d FROM public.studio_drafts WHERE id=(w.current_draft->>'studioDraftId')::uuid;
    END IF;
    IF d.id IS NOT NULL THEN
      INSERT INTO public.newsletter_versions(source,session_id,draft_id,snapshot)
        VALUES('legacy-studio',w.session_id,d.id,jsonb_build_object('current_draft',d.payload,'updated_at',d.updated_at)) RETURNING id INTO studio_version;
    END IF;
    -- Even identical legacy versions are explicitly reviewed. No implicit winner, no loss of IDs/assets.
    UPDATE public.shared_news_selection SET draft_choices=jsonb_build_array(
      jsonb_build_object('id',shared_version,'source','Writing','updatedAt',w.updated_at)
    ) || CASE WHEN studio_version IS NULL THEN '[]'::jsonb ELSE jsonb_build_array(
      jsonb_build_object('id',studio_version,'source','Image Studio','updatedAt',d.updated_at)
    ) END WHERE id='default';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.newsletter_state() RETURNS jsonb
LANGUAGE sql SECURITY INVOKER SET search_path='' AS $$
  SELECT to_jsonb(w) || jsonb_build_object('current_draft', CASE WHEN w.draft_id IS NULL THEN w.current_draft
    ELSE d.payload || jsonb_build_object('studioServerRevision',d.revision) END)
  FROM public.shared_news_selection w LEFT JOIN public.studio_drafts d ON d.id=w.draft_id WHERE w.id='default';
$$;

CREATE OR REPLACE FUNCTION public.newsletter_save(expected_revision integer, content jsonb, resolve_version uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.shared_news_selection; d public.studio_drafts; body jsonb; meta jsonb; selected jsonb; next_id uuid; flags jsonb;
BEGIN
  SELECT * INTO w FROM public.shared_news_selection WHERE id='default' FOR UPDATE;
  IF w.revision IS DISTINCT FROM expected_revision THEN RETURN jsonb_build_object('conflict',true,'state',public.newsletter_state()); END IF;
  body := NULLIF(content->'currentDraft','null'::jsonb); meta := NULLIF(content->'wizardState','null'::jsonb);
  IF resolve_version IS NOT NULL AND w.draft_choices='[]'::jsonb THEN
    SELECT snapshot INTO selected FROM public.newsletter_versions WHERE id=resolve_version;
    IF selected IS NULL OR NOT selected ? 'session_id' THEN RAISE EXCEPTION 'Not a recoverable workspace version'; END IF;
    content := jsonb_build_object('sessionId',selected->'session_id','curatedStories',selected->'curated_stories',
      'selectedIds',selected->'selected_ids','researchReports',selected->'research_reports');
    body := NULLIF(selected->'current_draft','null'::jsonb); meta := NULLIF(selected->'wizard_state','null'::jsonb);
  END IF;
  IF w.draft_choices <> '[]'::jsonb THEN
    IF resolve_version IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(w.draft_choices) c WHERE c->>'id'=resolve_version::text) THEN
      RETURN jsonb_build_object('choiceRequired',true,'state',public.newsletter_state());
    END IF;
    SELECT snapshot INTO selected FROM public.newsletter_versions WHERE id=resolve_version;
    body := selected->'current_draft';
    -- Selection of a recovered version retains the current reports/order and makes its body explicit.
    flags := jsonb_build_object('hook',true,'intro',true,'toc',true,'summary',true,'stories',
      COALESCE((SELECT jsonb_agg(s->>'sourceStoryId') FROM jsonb_array_elements(body->'stories') s),'[]'::jsonb));
    meta := COALESCE(selected->'wizard_state',(COALESCE(w.wizard_state,'{}'::jsonb)-'completed') || jsonb_build_object('completion',flags));
  END IF;
  IF meta ? 'completed' THEN
    flags := jsonb_build_object('hook',COALESCE(meta->'completed'->'hook','null'::jsonb)<>'null'::jsonb,
      'intro',COALESCE(meta->'completed'->'intro','null'::jsonb)<>'null'::jsonb,
      'toc',COALESCE(meta->'completed'->'toc','null'::jsonb)<>'null'::jsonb,
      'summary',COALESCE(meta->'completed'->'summary','null'::jsonb)<>'null'::jsonb,
      'stories',COALESCE((SELECT jsonb_agg(COALESCE(s->>'sourceStoryId',meta->'selectedReports'->((n-1)::integer)->'story'->>'id'))
        FROM jsonb_array_elements(COALESCE(meta->'completed'->'stories','[]'::jsonb)) WITH ORDINALITY AS stories(s,n) WHERE s<>'null'::jsonb),'[]'::jsonb));
    meta := (meta-'completed') || jsonb_build_object('completion',flags);
  END IF;
  IF body IS NOT NULL THEN
    next_id := (body->>'studioDraftId')::uuid;
    SELECT * INTO d FROM public.studio_drafts WHERE id=next_id FOR UPDATE;
    IF resolve_version IS NULL AND d.id IS NOT NULL AND (body->>'studioServerRevision')::integer IS DISTINCT FROM d.revision THEN
      RETURN jsonb_build_object('conflict',true,'state',public.newsletter_state());
    END IF;
    INSERT INTO public.newsletter_versions(source,session_id,draft_id,snapshot)
      VALUES('workspace-save',w.session_id,w.draft_id,public.newsletter_state());
    INSERT INTO public.studio_drafts(id,payload,revision,updated_at)
      VALUES(next_id,body-'studioServerRevision',COALESCE(d.revision,0)+1,now())
      ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at;
  ELSE
    INSERT INTO public.newsletter_versions(source,session_id,draft_id,snapshot)
      VALUES(CASE WHEN w.session_id<>content->>'sessionId' THEN 'new-newsletter' ELSE 'workspace-save' END,w.session_id,w.draft_id,public.newsletter_state());
  END IF;
  UPDATE public.shared_news_selection SET session_id=content->>'sessionId', revision=w.revision+1,
    curated_stories=content->'curatedStories',selected_ids=content->'selectedIds',research_reports=content->'researchReports',
    wizard_state=meta,current_draft=NULL,draft_id=next_id,draft_choices='[]',updated_at=now() WHERE id='default';
  RETURN jsonb_build_object('state',public.newsletter_state());
END $$;

-- Studio writes take the same lock first. The active body and workspace revision change together.
CREATE OR REPLACE FUNCTION public.newsletter_studio_save(body jsonb, expected_revision integer)
RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE w public.shared_news_selection; d public.studio_drafts; next_id uuid;
BEGIN
  SELECT * INTO w FROM public.shared_news_selection WHERE id='default' FOR UPDATE;
  IF w.draft_choices <> '[]'::jsonb THEN RETURN jsonb_build_object('choiceRequired',true); END IF;
  next_id := (body->>'studioDraftId')::uuid;
  SELECT * INTO d FROM public.studio_drafts WHERE id=next_id FOR UPDATE;
  IF d.revision IS DISTINCT FROM expected_revision THEN RETURN jsonb_build_object('conflict',true); END IF;
  INSERT INTO public.newsletter_versions(source,session_id,draft_id,snapshot)
    VALUES('studio-save',w.session_id,next_id,jsonb_build_object('current_draft',d.payload,'wizard_state',w.wizard_state));
  INSERT INTO public.studio_drafts(id,payload,revision,updated_at) VALUES(next_id,body-'studioServerRevision',COALESCE(d.revision,0)+1,now())
    ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at;
  IF w.draft_id=next_id THEN UPDATE public.shared_news_selection SET revision=revision+1,updated_at=now() WHERE id='default'; END IF;
  RETURN (SELECT to_jsonb(s) FROM public.studio_drafts s WHERE id=next_id);
END $$;
REVOKE ALL ON FUNCTION public.newsletter_state(), public.newsletter_save(integer,jsonb,uuid), public.newsletter_studio_save(jsonb,integer) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.newsletter_state(), public.newsletter_save(integer,jsonb,uuid), public.newsletter_studio_save(jsonb,integer) TO service_role;
COMMIT;
