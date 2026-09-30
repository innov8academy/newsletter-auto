import assert from 'node:assert/strict';
import test from 'node:test';
import { mergeWorkspace } from '../src/lib/merge-workspace';
import type { SharedSelectionState } from '../src/lib/storage';
const base = {sessionId:'one',revision:1,updatedAt:null,curatedStories:[],selectedIds:[],researchReports:[],wizardState:null,
  currentDraft:{title:'Title',intro:'Intro',studioServerRevision:1,stories:[{studioStoryId:'stable',sourceStoryId:'source',title:'Story',hookParagraph:'body'}]}} as unknown as SharedSelectionState;
test('independent body fields and stable stories merge while the server revision remains authoritative',()=>{
  const local=structuredClone(base);local.currentDraft!.intro='Alex intro';
  const remote=structuredClone(base);remote.revision=2;remote.currentDraft!.stories[0].hookParagraph='Friend body';remote.currentDraft!.studioServerRevision=2;
  const result=mergeWorkspace(base,local,remote)!;
  assert.equal(result.currentDraft!.intro,'Alex intro');assert.equal(result.currentDraft!.stories[0].hookParagraph,'Friend body');assert.equal(result.currentDraft!.studioServerRevision,2);
});
test('overlapping fields and a new newsletter never silently merge',()=>{
  const local=structuredClone(base);local.currentDraft!.intro='Alex';
  const remote=structuredClone(base);remote.currentDraft!.intro='Friend';
  assert.equal(mergeWorkspace(base,local,remote),null);
  assert.equal(mergeWorkspace(base,local,{...base,sessionId:'new'}),null);
});
