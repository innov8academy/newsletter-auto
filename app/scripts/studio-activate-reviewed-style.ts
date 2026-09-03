// Deliberate, scoped configuration repair. No planner or image-provider calls.
import { config } from 'dotenv';
import { readFile } from 'node:fs/promises';
import { SupabaseStudioRepository } from '../src/lib/studio/repository';
import { installSeedStyle } from '../src/lib/studio/seed-style';
import { StudioService } from '../src/lib/studio/service';
import { buildImageRequest } from '../src/lib/studio/providers';
import { uuid } from '../src/lib/studio/errors';

config({ quiet: true });
const arg = (name: string) => {
  const index = process.argv.indexOf(name);
  return index < 0 ? undefined : process.argv[index + 1];
};

async function main() {
  const project = arg('--project');
  const draftId = uuid(arg('--draft'));
  if (
    !project ||
    new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || '').hostname !==
      `${project}.supabase.co`
  )
    throw new Error(
      'The explicit project must match the configured Supabase project.',
    );
  const repo = new SupabaseStudioRepository();
  await repo.checkReady();
  const draft = await repo.getDraft(draftId);
  if (!draft) throw new Error('The requested draft is unavailable.');
  const before = await Promise.all(
    draft.payload.stories.map(async (story) => ({
      storyId: story.studioStoryId,
      work: await repo.getWorkspace(draftId, story.studioStoryId),
      runs: (await repo.listGenerations(draftId, story.studioStoryId)).map(
        (run) => ({
          id: run.id,
          status: run.status,
          originalAssetId: run.originalAssetId,
          deliveryAssetId: run.deliveryAssetId,
          costs: run.costs,
        }),
      ),
    })),
  );
  if (
    before.some((story) => story.runs.some((run) => run.status === 'running'))
  )
    throw new Error(
      'A generation is running in this draft. Finish it before changing style configuration.',
    );
  const snapshot = {
    project,
    draftId,
    activeStyleIds: (await repo.listStyles())
      .filter((pack) => pack.active)
      .map((pack) => pack.id),
    stories: before,
  };
  if (!process.argv.includes('--confirm')) {
    console.log(JSON.stringify(snapshot));
    return;
  }
  const snapshotPath = arg('--snapshot');
  if (!snapshotPath)
    throw new Error(
      'Capture and save the read-only snapshot first, then pass --snapshot with --confirm.',
    );
  const expected = JSON.parse(
    await readFile(snapshotPath, 'utf8'),
  ) as typeof snapshot;
  if (
    expected.project !== project ||
    expected.draftId !== draftId ||
    JSON.stringify(expected.activeStyleIds.toSorted()) !==
      JSON.stringify(snapshot.activeStyleIds.toSorted()) ||
    expected.stories.length !== before.length ||
    before.some(
      (story) =>
        !expected.stories.some(
          (old) =>
            old.storyId === story.storyId &&
            old.work?.revision === story.work?.revision,
        ),
    )
  )
    throw new Error(
      'The draft workspaces changed since the snapshot. Inspect again; nothing was updated.',
    );
  const pack = await installSeedStyle(repo);
  const repaired: string[] = [];
  const skipped: string[] = [];
  for (const story of before) {
    const work = story.work;
    if (!work || work.stylePackId || work.styleDisabled === true) {
      skipped.push(story.storyId);
      continue;
    }
    await repo.saveWorkspace(
      {
        ...work,
        stylePackId: pack.id,
        styleDisabled: false,
        plan: null,
        manualApprovedSignature: null,
      },
      work.revision,
    );
    repaired.push(story.storyId);
  }
  const service = new StudioService(repo);
  const verified = [];
  for (const story of before) {
    const work = await repo.getWorkspace(draftId, story.storyId);
    const runs = (await repo.listGenerations(draftId, story.storyId)).map(
      (run) => ({
        id: run.id,
        status: run.status,
        originalAssetId: run.originalAssetId,
        deliveryAssetId: run.deliveryAssetId,
        costs: run.costs,
      }),
    );
    const order = <T extends { id: string }>(items: T[]) =>
      items.toSorted((a, b) => a.id.localeCompare(b.id));
    if (
      JSON.stringify(order(runs)) !== JSON.stringify(order(story.runs)) ||
      work?.selectedGenerationId !== story.work?.selectedGenerationId
    )
      throw new Error(
        'Generation history changed during activation. Inspect the preserved snapshot before continuing.',
      );
    if (!work || work.stylePackId !== pack.id) {
      verified.push({ storyId: story.storyId, skipped: true });
      continue;
    }
    const { refs } = await service.references(
      await service.context(draftId, story.storyId),
    );
    if (
      JSON.stringify(
        refs.filter((ref) => ref.role === 'style').map((ref) => ref.id),
      ) !== JSON.stringify(pack.anchorIds)
    )
      throw new Error(
        'The saved style manifest does not match the selected three images.',
      );
    const nano = JSON.parse(
      buildImageRequest(
        'nano-pro-2k',
        'Offline payload verification only.',
        refs,
        'not-a-key',
      ).init.body as string,
    );
    const gpt = buildImageRequest(
      'gpt-image-2-high',
      'Offline payload verification only.',
      refs,
      'not-a-key',
    ).init.body as FormData;
    verified.push({
      storyId: story.storyId,
      styleReferences: refs.filter((ref) => ref.role === 'style').length,
      newsReferences: refs.filter((ref) => ref.role === 'news').length,
      readableBytes: refs.map((ref) => ref.bytes.length),
      nanoInputs: nano.input_references.length,
      gptInputs: gpt.getAll('image[]').length,
      selectedGenerationId: work.selectedGenerationId,
      generatedPlanCleared: work.plan === null,
      historyPreserved: true,
    });
  }
  const active = (await repo.listStyles()).find((item) => item.id === pack.id);
  if (!active?.active || active.anchorIds.length !== 3)
    throw new Error('Style activation could not be verified.');
  console.log(
    JSON.stringify(
      {
        project,
        draftId,
        style: {
          id: pack.id,
          name: pack.name,
          version: pack.version,
          active: active.active,
          referenceImages: pack.assetIds.length,
          referenceIds: pack.anchorIds,
        },
        repaired,
        skipped,
        verified,
        providerCalls: 0,
      },
      null,
      2,
    ),
  );
}
void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Style activation failed.',
  );
  process.exitCode = 1;
});
