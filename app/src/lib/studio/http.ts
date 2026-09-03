import 'server-only';
import { NextRequest, NextResponse } from 'next/server';
import {
  SESSION_COOKIE,
  sameRequestOrigin,
  sessionConfigured,
  verifySession,
} from '../site-session';
import { StudioError, record, safeMessage, string, uuid } from './errors';
import { SupabaseStudioRepository } from './repository';
import { StudioService, recoverStatus } from './service';
import { capabilities, verifyNanoCapabilities } from './capabilities';
import { presetId, PRESETS } from './models';
import { findNewsReferences } from './search';
import { analyzeStyle, createStyleVersion } from './styles';
import { installSeedStyle } from './seed-style';
import type { NewsletterDraft } from '../draft-generator';

export async function requireStudioSession(request: NextRequest) {
  if (process.env.NODE_ENV === 'production' && !sessionConfigured())
    throw new StudioError(
      'session_not_configured',
      'Configure SITE_PASSWORD and a server session-signing secret before using Studio.',
      503,
    );
  if (!(await verifySession(request.cookies.get(SESSION_COOKIE)?.value)))
    throw new StudioError(
      'unauthenticated',
      'Sign in again to use Image Studio.',
      401,
    );
  const origin = request.headers.get('origin');
  if (
    !['GET', 'HEAD'].includes(request.method) &&
    !sameRequestOrigin(origin, request.url, request.headers.get('host'))
  )
    throw new StudioError(
      'invalid_origin',
      'This request must come from the Studio app.',
      403,
    );
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 1)
    throw new StudioError(
      'invalid_revision',
      'A current saved revision is required.',
    );
  return Number(value);
}
async function json(request: NextRequest) {
  if (Number(request.headers.get('content-length') || 0) > 3_700_000)
    throw new StudioError(
      'payload_too_large',
      'Upload images separately from Studio requests.',
      413,
    );
  return record(await request.json());
}
function success(value: object) {
  return NextResponse.json(
    { success: true, ...value },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
export function studioError(error: unknown) {
  return NextResponse.json(
    {
      success: false,
      code: error instanceof StudioError ? error.code : 'studio_error',
      error: safeMessage(error),
    },
    {
      status: error instanceof StudioError ? error.status : 500,
      headers: { 'Cache-Control': 'no-store' },
    },
  );
}
export async function studioRoute(
  request: NextRequest,
  segments: string[],
): Promise<NextResponse> {
  try {
    await requireStudioSession(request);
    const route = segments.join('/');
    if (route === 'capabilities' && request.method === 'GET') {
      let repo: SupabaseStudioRepository | null = null;
      try {
        repo = new SupabaseStudioRepository();
      } catch {}
      return success(await capabilities(repo));
    }
    const repo = new SupabaseStudioRepository();
    const service = new StudioService(repo);
    if (request.method === 'GET') {
      if (route === 'drafts')
        return success({
          drafts: (await repo.listDrafts()).map(
            ({ id, payload, revision, updatedAt }) => ({
              id,
              title: payload.title,
              date: payload.date,
              storyCount: payload.stories.length,
              revision,
              updatedAt,
            }),
          ),
        });
      if (segments[0] === 'drafts' && segments.length === 2) {
        const draft = await repo.getDraft(uuid(segments[1]));
        if (!draft)
          throw new StudioError(
            'draft_not_found',
            'The draft is unavailable.',
            404,
          );
        return success({ draft });
      }
      if (segments[0] === 'stories' && segments.length === 3) {
        const { work } = await service.context(segments[1], segments[2]);
        const generations = (
          await repo.listGenerations(work.draftId, work.storyId)
        ).map((run) => recoverStatus(run));
        const assets = await repo.listAssets(work.draftId);
        const costs = await repo.getCosts(work.draftId);
        return success({
          work,
          generations,
          assets: await service.previewAssets(assets),
          costs,
        });
      }
      if (route === 'styles')
        return success({ styles: await repo.listStyles() });
      if (segments[0] === 'styles' && segments.length === 2) {
        const style = (await repo.listStyles()).find(
          (pack) => pack.id === uuid(segments[1]),
        );
        if (!style)
          throw new StudioError(
            'style_not_found',
            'This style is unavailable.',
            404,
          );
        return success({
          style,
          assets: await service.previewAssets(
            await repo.getAssets(style.assetIds),
          ),
        });
      }
      if (segments[0] === 'assets' && segments.length === 2) {
        const [asset] = await repo.getAssets([uuid(segments[1])]);
        if (!asset || asset.status !== 'ready')
          throw new StudioError(
            'asset_not_found',
            'This saved asset is unavailable.',
            404,
          );
        return success({
          asset: {
            ...asset,
            previewUrl: await repo.signObject(
              asset.originalPath,
              request.nextUrl.searchParams.has('download')
                ? `${asset.id}.${asset.mimeType === 'image/png' ? 'png' : 'jpg'}`
                : undefined,
            ),
          },
        });
      }
      if (segments[0] === 'generations' && segments.length === 2) {
        const run = await repo.getGeneration(uuid(segments[1]));
        if (!run)
          throw new StudioError(
            'run_not_found',
            'That generation has not been recorded.',
            404,
          );
        return success({
          run: recoverStatus(run),
          assets: await service.previewAssets(
            await repo.getAssets(
              [run.originalAssetId, run.deliveryAssetId].filter(
                (id): id is string => Boolean(id),
              ),
            ),
          ),
        });
      }
    }
    if (
      request.method === 'PATCH' &&
      segments[0] === 'stories' &&
      segments.length === 3
    )
      return success({
        work: await service.saveWork(
          segments[1],
          segments[2],
          await json(request),
        ),
      });
    if (request.method === 'POST') {
      const body = await json(request);
      if (route === 'drafts')
        return success({
          draft: await service.importDraft(
            record(body.draft) as unknown as NewsletterDraft,
            body.revision == null ? null : revision(body.revision),
          ),
        });
      if (route === 'plans') {
        if (!process.env.OPENROUTER_API_KEY)
          throw new StudioError(
            'missing_provider_key',
            'Configure OPENROUTER_API_KEY to prepare image prompts.',
            503,
          );
        return success({
          work: await service.preparePlan(
            uuid(body.draftId),
            uuid(body.storyId),
          ),
        });
      }
      if (route === 'generations') {
        const preset = presetId(body.presetId);
        if (
          !process.env[PRESETS[preset].key] ||
          !process.env.OPENROUTER_API_KEY
        )
          throw new StudioError(
            'missing_provider_key',
            'Configure the selected image provider and OpenRouter planner keys on the server.',
            503,
          );
        if (preset === 'nano-pro-2k') await verifyNanoCapabilities(10);
        const run = await service.generate({
          draftId: uuid(body.draftId),
          storyId: uuid(body.storyId),
          requestId: uuid(body.requestId),
          presetId: preset,
          operation: body.operation,
          editSourceId: body.editSourceId ? uuid(body.editSourceId) : undefined,
          editInstruction: body.editInstruction,
        });
        return success({
          run,
          assets: await service.previewAssets(
            await repo.getAssets(
              [run.originalAssetId, run.deliveryAssetId].filter(
                (id): id is string => Boolean(id),
              ),
            ),
          ),
        });
      }
      if (route === 'selection')
        return success({
          work: await service.selectImage(
            uuid(body.draftId),
            uuid(body.storyId),
            uuid(body.generationId),
            revision(body.revision),
          ),
        });
      if (route === 'references/search') {
        const { story, work } = await service.context(
          uuid(body.draftId),
          uuid(body.storyId),
        );
        const result = await findNewsReferences(story, work.direction);
        await repo.recordCost(
          work.draftId,
          work.storyId,
          'search-queries',
          result.cost,
        );
        return success(result);
      }
      if (route === 'references/import')
        return success({
          asset: (
            await service.previewAssets([
              await service.importNews(uuid(body.draftId), body.candidate),
            ])
          )[0],
        });
      if (route === 'references/uploads') {
        if (body.role !== 'style' && body.role !== 'subject')
          throw new StudioError(
            'invalid_role',
            'Upload a style or subject reference.',
          );
        const draftId = body.role === 'style' ? null : uuid(body.draftId);
        return success(
          await service.createUpload(
            draftId,
            body.role,
            string(body.name, 'Filename', 255),
            Number(body.size),
            string(body.mimeType, 'File type', 100),
          ),
        );
      }
      if (route === 'references/finalize')
        return success({
          asset: (
            await service.previewAssets([
              await service.finalizeUpload(uuid(body.assetId)),
            ])
          )[0],
        });
      if (route === 'styles/install-seed')
        return success({ style: await installSeedStyle(repo) });
      if (route === 'styles/analyze') {
        if (!Array.isArray(body.assetIds))
          throw new StudioError(
            'invalid_assets',
            'Select style images to analyze.',
          );
        return success(await analyzeStyle(repo, body.assetIds.map(uuid)));
      }
      if (route === 'styles')
        return success({ style: await createStyleVersion(repo, body) });
      if (
        segments[0] === 'styles' &&
        segments.length === 3 &&
        segments[2] === 'activate'
      ) {
        await repo.activateStyle(uuid(segments[1]));
        return success({ activated: true });
      }
    }
    throw new StudioError(
      'route_not_found',
      'This Studio operation is unavailable.',
      404,
    );
  } catch (error) {
    return studioError(error);
  }
}
