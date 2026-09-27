# Shared newsletter session rollout

Local preparation only. No database or deployment has been changed.

1. Take a database backup or export the `public.shared_news_selection` row.
2. Apply `004_shared_news_session.sql` after `002_shared_news_selection.sql`.
3. Verify the `default` row has a nonempty `session_id`, revision `0`, and its previous `curated_stories` and `selected_ids` unchanged against the export. The new reports start as `[]`; wizard and draft start as `NULL`:

   ```sql
   SELECT id, session_id, revision, curated_stories, selected_ids,
          research_reports, wizard_state, current_draft
   FROM public.shared_news_selection WHERE id = 'default';
   ```
4. Deploy the API and client together. The server must have `SUPABASE_SERVICE_ROLE_KEY`. Check GET shows `initialized: true` and a full state, then use two devices to check stale PUT returns 409 with the latest state. Reset must advance revision and reject the old device's write.

For an application rollback, restore the earlier app while retaining the additive columns so newsletter data is not deleted. Its old unconditional writes do not enforce revision, so suspend editing until the new app is restored. A schema rollback that drops the columns deletes reports, wizard progress, and drafts; export that data first if such a rollback is unavoidable.
