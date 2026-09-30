import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
const { PGlite } = await import(process.env.PGLITE_MODULE ? pathToFileURL(process.env.PGLITE_MODULE + '/dist/index.js').href : '@electric-sql/pglite');
const draftId = '00000000-0000-4000-8000-000000000001';
const storyId = '00000000-0000-4000-8000-000000000002';
const body = title => ({ studioDraftId: draftId, storageSchemaVersion: 3, title, subtitle: '', intro: '', toc: [], quickSummary: '', date: 'Today', stories: [{studioStoryId: storyId, sourceStoryId:'s1', title, hookParagraph:title,bulletPoints:[],whyItMatters:'',l8rsTake:''}] });
const content = (draft=null) => ({sessionId:'first',curatedStories:[],selectedIds:['s1'],researchReports:[],wizardState:null,currentDraft:draft});
async function setup(legacy=false) {
  const db = new PGlite();
  await db.exec('CREATE ROLE anon; CREATE ROLE authenticated; CREATE ROLE service_role BYPASSRLS; CREATE TABLE public.studio_drafts(id uuid PRIMARY KEY,payload jsonb NOT NULL,revision integer NOT NULL DEFAULT 1,updated_at timestamptz NOT NULL DEFAULT now());');
  const sql = fs.readFileSync('supabase-migrations/005_canonical_newsletter.sql','utf8');
  if(legacy) {
    await db.exec(sql.slice(0,sql.indexOf('-- Preserve BOTH'))+'COMMIT;');
    await db.query('INSERT INTO studio_drafts(id,payload,revision) VALUES($1,$2,2)',[draftId,body('Studio copy')]);
    await db.query("UPDATE shared_news_selection SET current_draft=$1,wizard_state=$2 WHERE id='default'",[body('Writing copy'),{selectedReports:[{story:{id:'s1'}}],completed:{hook:null,intro:null,toc:null,summary:null,stories:[{sourceStoryId:'s1',title:'Writing copy'}]}}]);
  }
  await db.exec(sql); return db;
}
const state=async db => (await db.query('SELECT newsletter_state() AS value')).rows[0].value;
const save=async(db,revision,c,resolve=null)=>(await db.query('SELECT newsletter_save($1,$2,$3) AS value',[revision,c,resolve])).rows[0].value;
test('migration preserves divergent versions; deliberate choice creates a single body without losing either version',async()=>{
  const db=await setup(true);try{
    const before=await state(db);assert.equal(before.draft_choices.length,2);
    assert.equal((await save(db,0,content(body('Do not overwrite')))).choiceRequired,true);
    const versions=(await db.query('SELECT source,snapshot FROM newsletter_versions')).rows;
    assert.equal(versions.find(v=>v.source==='legacy-writing').snapshot.current_draft.title,'Writing copy');
    assert.equal(versions.find(v=>v.source==='legacy-studio').snapshot.current_draft.title,'Studio copy');
    const chosen=await save(db,0,content(),before.draft_choices[0].id);
    assert.equal(chosen.state.current_draft.title,'Writing copy');assert.equal(chosen.state.current_draft.studioServerRevision,3);
    const raw=(await db.query("SELECT current_draft,wizard_state,draft_id FROM shared_news_selection WHERE id='default'")).rows[0];
    assert.equal(raw.current_draft,null);assert.equal(raw.draft_id,draftId);assert.equal(raw.wizard_state.completed,undefined);
    assert.equal(raw.wizard_state.completion.hook,false);assert.deepEqual(raw.wizard_state.completion.stories,['s1']);
    await db.exec(fs.readFileSync('supabase-migrations/005_canonical_newsletter.sql','utf8'));
    assert.deepEqual((await state(db)).draft_choices,[]);
  } finally {await db.close();}
});
test('Alex saves, friend reads and edits; stale/repeated edits are rejected; Studio updates same body and invalidates older workspace saves',async()=>{
  const db=await setup();try{
    const initial=await state(db);let c={...content(body('Alex')),sessionId:initial.session_id};
    const a=await save(db,0,c);assert.equal(a.state.revision,1);
    const friend=await state(db);assert.equal(friend.current_draft.title,'Alex');
    c={...c,currentDraft:{...friend.current_draft,title:'Friend'}};
    const b=await save(db,1,c);assert.equal(b.state.current_draft.title,'Friend');
    assert.equal((await save(db,1,c)).conflict,true);
    assert.equal((await state(db)).current_draft.title,'Friend');
    const studio=await db.query('SELECT newsletter_studio_save($1,$2) AS value',[{...b.state.current_draft,title:'Studio friend'},b.state.current_draft.studioServerRevision]);
    assert.equal(studio.rows[0].value.payload.title,'Studio friend');
    assert.equal((await state(db)).current_draft.title,'Studio friend');
    assert.equal((await save(db,2,c)).conflict,true);
  }finally{await db.close();}
});
test('new newsletter archives the full workspace and can restore it without deleting drafts; anon cannot access history or RPCs',async()=>{
  const db=await setup();try{
    const start=await state(db);const saved=await save(db,0,{...content(body('Keep me')),sessionId:start.session_id});
    await save(db,1,{...content(),sessionId:'new',selectedIds:[]});
    const archive=(await db.query("SELECT id,snapshot FROM newsletter_versions WHERE source='new-newsletter'")).rows[0];
    assert.equal(archive.snapshot.current_draft.title,'Keep me');
    const restored=await save(db,2,{...content(),sessionId:'new'},archive.id);
    assert.equal(restored.state.current_draft.title,'Keep me');assert.equal(restored.state.current_draft.studioDraftId,draftId);
    assert.equal(saved.state.current_draft.studioServerRevision,1);
    await db.exec('SET ROLE anon');
    await assert.rejects(db.query('SELECT newsletter_state()'),/permission denied/);
    await assert.rejects(db.query('SELECT * FROM newsletter_versions'),/permission denied/);
  }finally{await db.close();}
});
