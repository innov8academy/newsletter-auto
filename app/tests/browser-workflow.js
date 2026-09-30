async (page) => {
  const clone = value => JSON.parse(JSON.stringify(value));
  const draftId='11111111-1111-4111-8111-111111111111';
  const storyId='22222222-2222-4222-8222-222222222222';
  const story={id:'one',headline:'A practical AI tool ships today',summary:'A fixture story for checking the newsletter workflow.',category:'AI',baseScore:7,finalScore:8.333333,entities:[],originalUrl:'https://example.com/story',sources:['HuggingNews'],publishedAt:new Date().toISOString(),crossSourceCount:1,boosts:['+1.5 (fresh)'],primaryLinks:['https://example.com/primary']};
  const report={story,deepResearch:'Verified fixture research',keyPoints:['One useful detail'],implications:'A useful implication',sources:['https://example.com/story']};
  const block={studioStoryId:storyId,sourceStoryId:'one',title:'A practical AI tool ships today',emoji:'AI',hookParagraph:'Original story body',bulletPoints:['A verified detail'],whyItMatters:'Useful for builders',l8rsTake:'Try the tool'};
  let state={sessionId:'fixture',revision:0,updatedAt:new Date().toISOString(),curatedStories:[story],selectedIds:['one'],researchReports:[report],draftChoices:[],
    currentDraft:{studioDraftId:draftId,storageSchemaVersion:3,studioServerRevision:1,title:'Saved newsletter title',subtitle:'A useful subtitle',date:'September 30, 2026',intro:'Original intro',toc:['One story'],stories:[block],quickSummary:'Original summary',memeIdeas:[],rawMarkdown:''},
    wizardState:{schemaVersion:2,currentStep:2,currentStoryIndex:0,selectedReports:[report],reportSignature:'one',completed:{hook:{title:'Saved newsletter title',subtitle:'A useful subtitle'},intro:'Original intro',toc:['One story'],stories:[block],summary:'Original summary',memeIdeas:[]}}};
  const archivedDraft=clone(state.currentDraft);
  let expired=false; let generationRequests=0; let writes=0;
  const route = async request => {
    const req=request.request(), path=new URL(req.url()).pathname, method=req.method();
    let status=200, data={success:true};
    if (path==='/api/shared-selection') {
      if(expired) {status=401;data={success:false,code:'unauthenticated',error:'Sign in again to continue.'};}
      else if(method==='PUT') {
        const body=req.postDataJSON();
        if(body.expectedRevision!==state.revision) {status=409;data={success:false,code:'conflict',error:'Changed elsewhere',state:clone(state)};}
        else {const {expectedRevision,...content}=body;state={...content,revision:state.revision+1,updatedAt:new Date().toISOString()};
          if(state.currentDraft) (state.currentDraft??archivedDraft).studioServerRevision=((state.currentDraft??archivedDraft).studioServerRevision??0)+1;
          writes++;data={success:true,state:clone(state)};}
      } else data={success:true,initialized:true,state:clone(state)};
    } else if(path==='/api/status') data={configured:true,passwordRequired:false};
    else if(path==='/api/x-news') data={success:true,items:[]};
    else if(path==='/api/curate') data={success:true,stories:[{...story,id:'two',originalUrl:'https://example.com/second-story',headline:'A satellite company announces new hardware'}],stats:{sourcesAnalyzed:1,feedHealth:[]}};
    else if(path==='/api/studio/capabilities') data={success:true,storage:{ready:true,error:''},planner:{configured:true,model:'fixture'},search:{configured:true,provider:'fixture'},style:{configured:true},presets:[]};
    else if(path==='/api/studio/drafts') data={success:true,drafts:[{id:draftId,title:(state.currentDraft??archivedDraft).title,date:'Today',storyCount:1,revision:(state.currentDraft??archivedDraft).studioServerRevision}]};
    else if(path==='/api/studio/styles') data={success:true,styles:[]};
    else if(path.endsWith('/images')) data={success:true,stories:[{storyId,selected:null,latest:null,revision:1}],assets:[]};
    else if(path==='/api/studio/drafts/'+draftId) data={success:true,draft:{id:draftId,payload:state.currentDraft,revision:(state.currentDraft??archivedDraft).studioServerRevision,updatedAt:state.updatedAt}};
    else if(path.startsWith('/api/studio/stories/')) data={success:true,work:{draftId,storyId,revision:1,direction:'',stylePackId:null,references:[],plan:null,manualPrompt:null,manualApprovedSignature:null,selectedGenerationId:null,presetId:'nano-pro-2k'},generations:[],assets:[],costs:[]};
    else if(path.includes('/generations') || path==='/api/generate-section') {generationRequests++;status=503;data={success:false,error:'Generation is disabled in local verification'};}
    else if(path==='/api/newsletter/versions') data={versions:[]};
    else {status=503;data={success:false,error:'This fixture does not permit this API action'};}
    await request.fulfill({status,json:data});
  };
  const context=page.context(); await context.unroute('**/api/**');
  for (const other of context.browser().contexts()) if(other!==context) await other.close();
  await context.route('**/api/**',route);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:3108/');
  await page.getByRole('heading',{name:/Top Stories/}).waitFor();
  await page.waitForTimeout(300);
  await page.screenshot({path:'output/playwright/find-news-desktop.png',fullPage:true});
  const savedBody=JSON.stringify(state.currentDraft);
  await page.getByRole('button',{name:'Find News',exact:true}).click();
  await page.getByText('2 items',{exact:true}).waitFor();
  await page.waitForFunction(()=>document.body.textContent.includes('Saved to cloud'));
  if(!state.curatedStories.some(item=>item.id==='one') || !state.selectedIds.includes('one')) throw new Error('Find News lost prior selection');
  if(JSON.stringify(state.currentDraft)!==savedBody.replace(/"studioServerRevision":1/, '"studioServerRevision":2')) {
    const before=JSON.parse(savedBody),after=clone(state.currentDraft);delete before.studioServerRevision;delete after.studioServerRevision;
    if(JSON.stringify(before)!==JSON.stringify(after)) throw new Error('Find News changed the writing');
  }
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/find-news-mobile.png',fullPage:true});
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>window.innerWidth);
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:3108/research');
  await page.getByRole('heading',{name:/Research/i}).first().waitFor();
  await page.screenshot({path:'output/playwright/research-desktop.png',fullPage:true});
  await page.goto('http://127.0.0.1:3108/draft');
  await page.getByRole('textbox',{name:'Generate Introduction'}).waitFor();
  await page.screenshot({path:'output/playwright/writing-desktop.png',fullPage:true});
  // Save in one browser, observe in an independent browser context.
  const editor=page.getByRole('textbox',{name:'Generate Introduction'}).first();
  await editor.fill('Alex revised intro');
  await page.waitForFunction(()=>document.body.textContent.includes('Saved to cloud'));
  if(state.currentDraft.intro!=='Alex revised intro') throw new Error('Autosave did not reach the shared fixture');
  const friendContext=await context.browser().newContext({viewport:{width:1440,height:1000}});
  await friendContext.route('**/api/**',route);const friend=await friendContext.newPage();
  await friend.goto('http://127.0.0.1:3108/draft');
  await friend.getByRole('textbox',{name:'Generate Introduction'}).waitFor();
  if(await friend.getByRole('textbox',{name:'Generate Introduction'}).inputValue()!=='Alex revised intro') throw new Error('Friend did not see Alex edit');
  await friend.getByRole('textbox',{name:/Introduction|Intro/}).first().fill('Friend finished intro');
  await friend.waitForFunction(()=>document.body.textContent.includes('Saved to cloud'));
  await page.reload();await page.getByRole('textbox',{name:'Generate Introduction'}).waitFor();
  if(await page.getByRole('textbox',{name:'Generate Introduction'}).inputValue()!=='Friend finished intro') throw new Error('Reload did not restore friend edit');
  expired=true;
  await friend.getByRole('textbox',{name:/Introduction|Intro/}).first().fill('Typing survives expired login');
  await friend.getByText('Sign in again to continue.',{exact:true}).waitFor();
  if(state.currentDraft.intro!=='Friend finished intro') throw new Error('Expired login wrote to the server');
  expired=false;
  await friend.getByRole('button',{name:'Retry save',exact:true}).click();
  await friend.waitForFunction(()=>document.body.textContent.includes('Saved to cloud'));
  if(state.currentDraft.intro!=='Typing survives expired login') throw new Error('Unsent typing was lost');
  await page.goto('http://127.0.0.1:3108/studio');
  await page.getByRole('heading',{name:'Image Studio',exact:true}).waitFor();
  await page.screenshot({path:'output/playwright/studio-desktop.png',fullPage:true});
  state={...state,sessionId:'new-fixture',revision:state.revision+1,currentDraft:null,wizardState:null,selectedIds:[],researchReports:[],curatedStories:[]};
  const freshContext=await context.browser().newContext();await freshContext.route('**/api/**',route);
  const fresh=await freshContext.newPage();await fresh.goto('http://127.0.0.1:3108/studio');
  await fresh.getByText('The current newsletter has no written draft yet. Continue writing, or deliberately open an older saved newsletter below.',{exact:true}).waitFor();
  if(await fresh.locator('#saved-draft').inputValue()!=='') throw new Error('Empty current newsletter opened an old draft');
  // Test contexts are closed by the scoped CLI session cleanup after the assertions.
  if(generationRequests) throw new Error('Loading/reloading sent a generation request');
  return {passed:true,writes,generationRequests,mobileOverflow:overflow,emptyNewsletterKeepsArchivesClosed:true};
}
