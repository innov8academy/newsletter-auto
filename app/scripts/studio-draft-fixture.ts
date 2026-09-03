// Local-only test front door: real app, service and REST storage adapter;
// deterministic provider doubles. Never imported by application code.
import { createServer } from 'node:http';
import sharp from 'sharp';
import { SupabaseStudioRepository } from '../src/lib/studio/repository';
import { StudioService } from '../src/lib/studio/service';
import { inputSignature } from '../src/lib/studio/state';
import { hash, manifest } from '../src/lib/studio/prompts';
import type { ImagePlan, StudioDraft } from '../src/lib/studio/types';

export async function startDraftFixture(
  draft: StudioDraft,
  plan: ImagePlan,
  reference: Buffer,
) {
  const storage = new SupabaseStudioRepository({
    NODE_ENV: 'development',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4319',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
  });
  const output = await sharp(reference)
    .resize(2048, 1152, { fit: 'cover' })
    .png()
    .toBuffer();
  const counts = { bodies: 0, searches: 0, plans: 0, renders: 0, edits: 0 };
  const receipt = () => ({
    id: crypto.randomUUID(),
    model: 'offline-fixture',
    amountUsd: 0,
    basis: 'provider' as const,
    pricingDate: 'fixture',
    usage: {},
  });
  const service = new StudioService(storage, {
    findNewsReferences: async () => {
      counts.searches++;
      return {
        images: [
          {
            url: 'https://fixture.example/reference.png',
            title: 'Offline news reference',
            thumbnail: '',
            source: 'Fixture',
            sourcePageUrl: null,
          },
        ],
        queries: ['fixture'],
        cost: receipt(),
        warning: null,
      };
    },
    downloadPublicImage: async () => reference,
    planImage: async (story, work, _style, refs) => {
      counts.plans++;
      return {
        ...plan,
        inputSignature: inputSignature(story, work),
        inputHash: hash(inputSignature(story, work)),
        referenceUsage: refs.map((ref) => ({ id: ref.id, use: ref.role })),
        references: manifest(refs),
        cost: receipt(),
      };
    },
    renderImage: async (_preset, _prompt, refs) => {
      counts.renders++;
      if (refs.some((ref) => ref.role === 'edit-source')) counts.edits++;
      await new Promise((resolve) => setTimeout(resolve, 15000));
      return {
        bytes: output,
        mimeType: 'image/png',
        requestId: 'offline-fixture',
        provider: 'offline-fixture',
        cost: receipt(),
      };
    },
    inspectImage: async () => ({
      status: 'unavailable',
      findings: ['Offline fixture image. No paid provider was called.'],
      suggestedEdit: '',
    }),
  });
  const reports = draft.stories.map((story, index) => ({
    story: {
      id: story.sourceStoryId || `fixture-news-${index}`,
      headline: story.title,
      summary: story.hookParagraph,
      category: 'AI',
      baseScore: 5,
      finalScore: 5,
      entities: [],
      originalUrl: 'https://example.com',
      sources: ['fixture'],
      publishedAt: new Date().toISOString(),
      crossSourceCount: 1,
      boosts: [],
    },
    deepResearch: story.hookParagraph,
    keyPoints: story.bulletPoints,
    implications: story.whyItMatters,
    sources: [],
  }));
  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://127.0.0.1:3001');
    const send = (value: unknown, status = 200) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    try {
      if (url.pathname === '/fixture') {
        const seed = { reports, draft };
        res.writeHead(200, { 'Content-Type': 'text/html' });
        res.end(
          `<!doctype html><meta charset="utf-8"><title>Offline draft fixture</title><main><h1>Offline newsletter test</h1><p>This origin uses fake providers. No paid calls.</p><button id="empty">Start with unwritten body</button><button id="ready">Start with saved body</button><script>const seed=${JSON.stringify(seed).replace(/</g, '\\u003c')};function start(ready){const reports=seed.reports;const draft={...seed.draft,studioDraftId:crypto.randomUUID(),date:new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'}),stories:seed.draft.stories.map((story,i)=>({...story,sourceStoryId:reports[i].story.id,studioStoryId:crypto.randomUUID()}))};const completed={hook:{title:draft.title,subtitle:draft.subtitle},intro:'Offline fixture introduction.',toc:reports.map(r=>r.story.headline),stories:ready?draft.stories:[],summary:'Offline summary.',memeIdeas:[]};localStorage.setItem('innov8_research_reports',JSON.stringify(reports));localStorage.setItem('newsletter-wizard-state',JSON.stringify({schemaVersion:2,currentStep:4,currentStoryIndex:0,selectedReports:reports,reportSignature:reports.map(r=>r.story.id).join('|'),completed}));localStorage.setItem('currentDraft',JSON.stringify(draft));localStorage.removeItem('studio_unsynced_draft');location.href='/draft';}document.getElementById('empty').onclick=()=>start(false);document.getElementById('ready').onclick=()=>start(true);</script></main>`,
        );
        return;
      }
      if (url.pathname === '/fixture/counts') {
        send(counts);
        return;
      }
      const chunks: Buffer[] = [];
      if (!['GET', 'HEAD'].includes(req.method || 'GET'))
        for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const bytes = Buffer.concat(chunks);
      if (url.pathname === '/api/generate-section' && req.method === 'POST') {
        const input = JSON.parse(bytes.toString());
        counts.bodies++;
        await new Promise((resolve) => setTimeout(resolve, 600));
        send({
          success: true,
          story: {
            ...draft.stories[input.storyIndex || 0],
            title: input.researchReports[input.storyIndex || 0].story.headline,
            hookParagraph:
              'Newly written fixture body. No paid provider was called.',
          },
          content: 'Offline section content.',
        });
        return;
      }
      if (
        url.pathname === '/api/studio/generations/missing' &&
        req.method === 'POST'
      ) {
        const run = await service.generateMissing(JSON.parse(bytes.toString()));
        send({ success: true, run });
        return;
      }
      if (url.pathname === '/api/studio/generations' && req.method === 'POST') {
        const run = await service.generate(JSON.parse(bytes.toString()));
        send({ success: true, run });
        return;
      }
      // Do not allow real exports or other paid routes from the fixture.
      if (
        req.method === 'POST' &&
        url.pathname.startsWith('/api/') &&
        !url.pathname.startsWith('/api/studio/')
      ) {
        send(
          {
            success: false,
            error: 'External actions are disabled in this fixture.',
          },
          403,
        );
        return;
      }
      const headers = new Headers();
      for (const [key, value] of Object.entries(req.headers))
        if (
          value &&
          !['connection', 'content-length', 'transfer-encoding'].includes(key)
        )
          headers.set(key, Array.isArray(value) ? value.join(', ') : value);
      if (headers.has('origin')) {
        if (headers.get('origin') !== 'http://127.0.0.1:3001') {
          send({ error: 'Foreign fixture origin' }, 403);
          return;
        }
        headers.set('origin', 'http://127.0.0.1:3002');
      }
      const upstream = await fetch(`http://127.0.0.1:3002${req.url}`, {
        method: req.method,
        headers,
        body: bytes.length ? bytes : undefined,
        redirect: 'manual',
      });
      if (url.pathname === '/api/studio/capabilities') {
        const caps = await upstream.json();
        caps.planner.configured = true;
        caps.search.configured = true;
        caps.presets.forEach(
          (preset: { configured: boolean; reason: string | null }) => {
            preset.configured = true;
            preset.reason = null;
          },
        );
        send(caps, upstream.status);
        return;
      }
      upstream.headers.forEach((value, key) => {
        if (
          ![
            'content-encoding',
            'content-length',
            'transfer-encoding',
            'connection',
          ].includes(key)
        )
          res.setHeader(key, value);
      });
      res.writeHead(upstream.status);
      if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
          for (;;) {
            const next = await reader.read();
            if (next.done) break;
            res.write(next.value);
          }
        } finally {
          reader.releaseLock();
        }
      }
      res.end();
    } catch (error) {
      send(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Fixture failed',
        },
        500,
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(3001, '127.0.0.1', resolve);
  });
  return server;
}
