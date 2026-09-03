// Offline browser harness. The app uses its real Supabase adapter against this local REST fixture.
// No production fallback or test bypass is added to application code.
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { spawn, execFileSync, type ChildProcess } from 'node:child_process';
import path from 'node:path';
import { MemoryStudioRepository } from '../tests/helpers/studio-memory';
import { installSeedStyle } from '../src/lib/studio/seed-style';
import {
  upgradeDraft,
  emptyWorkspace,
  inputSignature,
} from '../src/lib/studio/state';
import { hash } from '../src/lib/studio/prompts';
import type {
  GenerationRun,
  ImagePlan,
  StudioAsset,
} from '../src/lib/studio/types';

type Row = Record<string, unknown>;
const tables: Record<string, Row[]> = {};
const repo = new MemoryStudioRepository();
let child: ChildProcess | null = null;
function stop() {
  if (child?.pid) {
    try {
      if (process.platform === 'win32')
        execFileSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
          windowsHide: true,
          stdio: 'ignore',
        });
      else child.kill('SIGTERM');
    } catch {}
  }
  server.close();
  setTimeout(() => process.exit(0), 100);
}
function json(res: ServerResponse, value: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(value));
}
async function body(req: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const part of req) chunks.push(Buffer.from(part));
  return Buffer.concat(chunks);
}
function matches(row: Row, url: URL) {
  return [...url.searchParams.entries()].every(([key, value]) => {
    if (['select', 'order', 'limit', 'offset', 'on_conflict'].includes(key))
      return true;
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
    if (value === 'is.null') return row[key] == null;
    if (value.startsWith('in.('))
      return value
        .slice(4, -1)
        .split(',')
        .map((v) => v.replace(/^"|"$/g, ''))
        .includes(String(row[key]));
    return true;
  });
}
const server = createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  res.setHeader(
    'Access-Control-Allow-Methods',
    'GET,HEAD,POST,PATCH,PUT,OPTIONS',
  );
  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }
  try {
    const url = new URL(req.url || '/', 'http://127.0.0.1:4319');
    const parts = url.pathname
      .split('/')
      .filter(Boolean)
      .map(decodeURIComponent);
    if (url.pathname === '/shutdown' && req.method === 'POST') {
      json(res, { stopping: true });
      stop();
      return;
    }
    if (parts[0] === 'storage' && parts[1] === 'v1') {
      if (parts[2] === 'bucket') {
        json(res, {
          id: parts[3],
          name: parts[3],
          public: parts[3] === 'l8r-newsletter-images',
        });
        return;
      }
      if (parts[2] === 'object') {
        const mode = parts[3];
        if (mode === 'sign' && req.method === 'POST') {
          json(res, {
            signedURL: `/object/sign/${parts.slice(4).join('/')}?token=fixture`,
          });
          return;
        }
        if (mode === 'upload' && parts[4] === 'sign') {
          const key = parts.slice(6).join('/');
          if (req.method === 'POST') {
            json(res, {
              url: `/object/upload/sign/${parts.slice(5).join('/')}?token=fixture`,
            });
            return;
          }
          repo.objects.set(key, await body(req));
          json(res, { Key: key });
          return;
        }
        const key = ['sign', 'public', 'authenticated'].includes(mode)
          ? parts.slice(5).join('/')
          : parts.slice(4).join('/');
        if (req.method === 'POST' || req.method === 'PUT') {
          repo.objects.set(key, await body(req));
          json(res, { Key: key });
          return;
        }
        const bytes = repo.objects.get(key) || repo.published.get(key);
        if (!bytes) {
          json(res, { error: 'Not found' }, 404);
          return;
        }
        res.writeHead(200, {
          'Content-Type': key.endsWith('.jpg') ? 'image/jpeg' : 'image/png',
        });
        res.end(bytes);
        return;
      }
    }
    if (parts[0] === 'rest' && parts[1] === 'v1') {
      if (parts[2] === 'rpc' && parts[3] === 'studio_activate_style_pack') {
        const data = JSON.parse((await body(req)).toString());
        tables.studio_style_packs.forEach((row) => {
          row.active = row.id === data.pack_id;
        });
        json(res, null);
        return;
      }
      const table = parts[2];
      const rows = tables[table];
      if (!rows) {
        json(res, { code: 'PGRST205', message: 'Missing fixture table' }, 404);
        return;
      }
      if (req.method === 'HEAD') {
        res.setHeader('Content-Range', `0-0/${rows.length}`);
        res.writeHead(200);
        res.end();
        return;
      }
      let selected = rows.filter((row) => matches(row, url));
      if (req.method === 'POST') {
        const data = JSON.parse((await body(req)).toString());
        const incoming: Row[] = Array.isArray(data) ? data : [data];
        selected = [];
        for (const item of incoming) {
          const found = rows.find((row) =>
            item.id
              ? row.id === item.id
              : row.draft_id === item.draft_id &&
                row.story_id === item.story_id,
          );
          if (found && !String(req.headers.prefer).includes('resolution=')) {
            json(res, { code: '23505', message: 'Duplicate' }, 409);
            return;
          }
          if (found) {
            Object.assign(found, item);
            selected.push(found);
          } else {
            const row = { created_at: new Date().toISOString(), ...item };
            rows.push(row);
            selected.push(row);
          }
        }
      } else if (req.method === 'PATCH') {
        const changes = JSON.parse((await body(req)).toString());
        selected.forEach((row) => Object.assign(row, changes));
      }
      json(
        res,
        String(req.headers.accept).includes('vnd.pgrst.object')
          ? selected[0] || null
          : selected,
      );
      return;
    }
    json(res, {
      fixture: true,
      message: 'No live provider calls are enabled.',
    });
  } catch (error) {
    json(
      res,
      { error: error instanceof Error ? error.message : 'Fixture error' },
      500,
    );
  }
});

async function main() {
  const style = await installSeedStyle(repo);
  const draft = upgradeDraft({
    title: 'Studio browser fixture',
    subtitle: 'Offline UI verification',
    date: '2026-09-02',
    intro: '',
    toc: [],
    quickSummary: '',
    rawMarkdown: '',
    memeIdeas: [],
    stories: [
      {
        title: 'Fixture review: AI infrastructure and energy',
        emoji: '',
        hookParagraph:
          'This is offline test data. The image is a supplied reference, not a model-generated result.',
        bulletPoints: [
          'Check references, prompts, history and saved selection.',
        ],
        whyItMatters: 'Reload recovery must preserve the selected image.',
        l8rsTake: 'No paid provider was called.',
      },
      {
        title: 'Fixture review: a new device',
        emoji: '',
        hookParagraph:
          'A second story verifies switching and separate saved state.',
        bulletPoints: ['The stories have distinct stable IDs.'],
        whyItMatters: 'Images must not follow array indexes.',
        l8rsTake: 'Keep the saved work associated with this story.',
      },
    ],
  });
  await repo.saveDraft(draft, null);
  await repo.saveDraft(
    upgradeDraft({
      ...draft,
      studioDraftId: crypto.randomUUID(),
      title: 'Second fixture newsletter',
      stories: draft.stories.map((story) => ({
        ...story,
        studioStoryId: crypto.randomUUID(),
      })),
    }),
    null,
  );
  const story = draft.stories[0];
  const work = emptyWorkspace(
    draft.studioDraftId,
    story.studioStoryId,
    style.id,
  );
  const source = repo.assets.get(style.anchorIds[0])!;
  const imageId = crypto.randomUUID();
  const image: StudioAsset = {
    ...source,
    id: imageId,
    draftId: draft.studioDraftId,
    role: 'output',
    name: 'Supplied reference used as fixture output',
    eligibleForConditioning: false,
  };
  await repo.putAsset(image);
  const plan: ImagePlan = {
    storyThesis: 'Infrastructure needs energy',
    entities: ['data center'],
    scene: 'An editorial landscape',
    metaphor: 'Infrastructure as a landscape',
    composition: 'A clear horizon and geometric fields',
    palette: ['blue', 'yellow', 'orange'],
    focalPoint: 'data center',
    mustInclude: ['energy infrastructure'],
    avoid: ['unrequested text'],
    referenceUsage: [],
    renderPrompt:
      'A photographic energy landscape cutout against bold blue, yellow and orange fields. Keep the main subject clear and the print texture restrained.',
    altText: 'Fixture editorial landscape reference',
    uncertainties: ['Fixture only; no model call.'],
    inputSignature: inputSignature(story, work),
    inputHash: hash(inputSignature(story, work)),
    references: [],
    model: 'fixture',
    cost: {
      model: 'fixture',
      amountUsd: 0,
      basis: 'provider',
      pricingDate: 'fixture',
      usage: {},
    },
    createdAt: new Date().toISOString(),
  };
  const run: GenerationRun = {
    id: crypto.randomUUID(),
    draftId: draft.studioDraftId,
    storyId: story.studioStoryId,
    requestHash: 'fixture',
    presetId: 'nano-pro-2k',
    operation: 'generate',
    status: 'complete',
    prompt: plan.renderPrompt,
    plan,
    references: [],
    originalAssetId: imageId,
    deliveryAssetId: imageId,
    providerRequestId: 'fixture',
    provider: 'offline fixture',
    model: 'fixture/reference-only',
    costs: [],
    quality: {
      status: 'unavailable',
      findings: ['Fixture data only. No model was called.'],
      suggestedEdit: '',
    },
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
  };
  await repo.claimGeneration(run);
  await repo.saveWorkspace(
    { ...work, plan, selectedGenerationId: run.id },
    null,
  );
  tables.studio_drafts = [...repo.drafts.values()].map((row) => ({
    id: row.id,
    payload: row.payload,
    revision: row.revision,
    updated_at: row.updatedAt,
  }));
  tables.studio_story_workspaces = [...repo.works.values()].map((row) => ({
    draft_id: row.draftId,
    story_id: row.storyId,
    payload: row,
    revision: row.revision,
  }));
  tables.studio_assets = [...repo.assets.values()].map((asset) => ({
    id: asset.id,
    draft_id: asset.draftId,
    role: asset.role,
    payload: asset,
    checksum: asset.checksum,
  }));
  tables.studio_style_packs = [...repo.styles.values()].map((pack) => ({
    id: pack.id,
    slug: pack.slug,
    version: pack.version,
    active: pack.active,
    payload: pack,
  }));
  tables.studio_generations = [...repo.runs.values()].map((item) => ({
    id: item.id,
    draft_id: item.draftId,
    story_id: item.storyId,
    request_hash: item.requestHash,
    status: item.status,
    payload: item,
    started_at: item.startedAt,
  }));
  tables.studio_usage_events = [];
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(4319, '127.0.0.1', resolve);
  });
  child = spawn(
    process.execPath,
    [
      path.join(process.cwd(), 'node_modules/next/dist/bin/next'),
      'dev',
      '--port',
      '3001',
      '--hostname',
      '127.0.0.1',
    ],
    {
      cwd: process.cwd(),
      stdio: 'inherit',
      windowsHide: true,
      env: {
        ...process.env,
        NODE_ENV: 'development',
        NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:4319',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: 'fixture-anon',
        SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
        SITE_PASSWORD: '',
        SESSION_SECRET: '',
        OPENROUTER_API_KEY: '',
        OPENAI_API_KEY: '',
        SERPER_API_KEY: '',
        BRAVE_API_KEY: '',
        BEEHIIV_API_KEY: '',
        BEEHIIV_PUBLICATION_ID: '',
      },
    },
  );
  console.log(
    JSON.stringify({
      fixtureUrl: 'http://127.0.0.1:3001/studio',
      shutdownUrl: 'http://127.0.0.1:4319/shutdown',
      appPid: child.pid,
      fixturePid: process.pid,
      paidProvidersEnabled: false,
    }),
  );
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
void main().catch((error) => {
  console.error(error);
  stop();
});
