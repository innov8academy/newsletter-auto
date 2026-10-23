/** Read-only Studio run inspection; --render explicitly makes one paid image request. */
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from 'dotenv';
import sharp from 'sharp';
import { StudioError, uuid } from '../src/lib/studio/errors';
import { prepareOutput } from '../src/lib/studio/media';
import { PRESETS } from '../src/lib/studio/models';
import { renderImage } from '../src/lib/studio/providers';
import { SupabaseStudioRepository } from '../src/lib/studio/repository';
import type { BufferedReference, GenerationRun, StudioAsset } from '../src/lib/studio/types';

config({ quiet: true, path: resolve(dirname(fileURLToPath(import.meta.url)), '../.env') });

function options() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log('Usage: node --conditions=react-server --import tsx scripts/studio-diagnose-output.ts --generation UUID [--render]');
    console.log('Default: read-only inspection. --render: ONE paid provider request and local output files; no Studio writes.');
    return null;
  }
  let generationId: string | null = null;
  let render = false;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--generation' && !generationId) generationId = uuid(args[++i]);
    else if (args[i] === '--render' && !render) render = true;
    else throw new Error('Use --generation UUID and optional --render. See --help.');
  }
  if (!generationId) throw new Error('A saved --generation UUID is required. See --help.');
  return { generationId, render };
}

function assetFor(run: GenerationRun, assets: StudioAsset[]) {
  return run.references.map((ref) => {
    const asset = assets.find((item) => item.id === ref.id);
    const expectedRole = ref.role === 'edit-source' ? 'output' : ref.role;
    if (!asset || asset.status !== 'ready' || asset.role !== expectedRole)
      throw new Error('A saved reference is missing, not ready, or has a changed role. No render was requested.');
    return { ref, asset };
  });
}

async function main() {
  const cli = options();
  if (!cli) return;
  const repo = new SupabaseStudioRepository();
  const run = await repo.getGeneration(cli.generationId);
  if (!run) throw new Error('Saved generation not found.');
  if (!Object.hasOwn(PRESETS, run.presetId)) throw new Error('The saved preset is unsupported.');
  const assets = await repo.getAssets(run.references.map((ref) => ref.id));
  const selected = assetFor(run, assets);
  const roles = selected.reduce<Record<string, number>>((counts, { ref }) => {
    counts[ref.role] = (counts[ref.role] || 0) + 1;
    return counts;
  }, {});
  console.log(JSON.stringify({
    generationId: run.id,
    status: run.status,
    stage: run.stage ?? null,
    errorCode: run.errorCode ?? null,
    preset: run.presetId,
    model: run.model,
    modelMatchesCurrentPreset: run.model === PRESETS[run.presetId].model,
    operation: run.operation,
    references: { count: selected.length, roles, dimensions: selected.map(({ ref, asset }) => ({ role: ref.role, width: asset.width || null, height: asset.height || null })) },
    configured: {
      storage: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      renderer: Boolean(process.env[PRESETS[run.presetId].key]),
    },
    mode: cli.render ? 'one-render' : 'read-only',
  }, null, 2));
  if (!cli.render) return;
  if (run.model !== PRESETS[run.presetId].model)
    throw new Error('The saved model differs from the current preset. No render was requested.');
  if (!run.prompt?.trim()) throw new Error('The saved run has no render prompt. No render was requested.');
  if (!process.env[PRESETS[run.presetId].key]) throw new Error('The selected renderer key is not configured. No render was requested.');

  const refs: BufferedReference[] = [];
  for (const { ref, asset } of selected) {
    const path = ref.role === 'edit-source' ? asset.originalPath : asset.conditioningPath || asset.originalPath;
    refs.push({
      ...ref,
      bytes: await repo.getObject(path),
      mimeType: ref.role === 'edit-source' ? asset.mimeType : asset.conditioningPath ? 'image/jpeg' : asset.mimeType,
    });
  }
  const directory = resolve(dirname(fileURLToPath(import.meta.url)), '../output/studio-image-diagnostics', `${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID()}`);
  await mkdir(directory, { recursive: true });
  const receipt: Record<string, unknown> = { sourceGenerationId: run.id, preset: run.presetId, model: run.model, referenceCount: refs.length, status: 'render_started' };
  try {
    // Exactly one provider call. Keep the raw bytes before any decoding or validation.
    const result = await renderImage(run.presetId, run.prompt, refs);
    await writeFile(resolve(directory, 'provider-output.bin'), result.bytes, { flag: 'wx' });
    receipt.status = 'provider_output_saved';
    receipt.provider = result.provider;
    receipt.providerMimeType = result.mimeType;
    receipt.providerBytes = result.bytes.length;
    receipt.providerSha256 = createHash('sha256').update(result.bytes).digest('hex');
    receipt.cost = { model: result.cost.model, amountUsd: result.cost.amountUsd, basis: result.cost.basis, outputEstimateUsd: result.cost.outputEstimateUsd ?? null };
    try {
      const meta = await sharp(result.bytes).metadata();
      receipt.decoded = { status: 'decoded', format: meta.format || null, width: meta.width || null, height: meta.height || null };
    } catch {
      receipt.decoded = { status: 'decode_failed' };
    }
    try {
      const output = await prepareOutput(result.bytes, run.presetId);
      await writeFile(resolve(directory, 'original.png'), output.original, { flag: 'wx' });
      await writeFile(resolve(directory, 'delivery.jpg'), output.delivery, { flag: 'wx' });
      receipt.status = 'prepared';
      receipt.prepareOutput = { status: 'valid' };
    } catch (error) {
      receipt.status = 'prepare_failed';
      receipt.prepareOutput = error instanceof StudioError
        ? { status: 'failed', code: error.code, message: error.message }
        : { status: 'failed', code: 'unexpected_error', message: 'Output preparation failed.' };
    }
  } catch (error) {
    receipt.status = 'render_failed';
    receipt.renderError = error instanceof StudioError
      ? { code: error.code, message: error.message }
      : { code: 'unexpected_error', message: 'The renderer or local file write failed.' };
  } finally {
    await writeFile(resolve(directory, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify({ diagnosticDirectory: directory, status: receipt.status, decoded: receipt.decoded ?? null, prepareOutput: receipt.prepareOutput ?? null }, null, 2));
  }
  if (receipt.status !== 'prepared') process.exitCode = 1;
}

void main().catch((error) => {
  console.error(error instanceof StudioError
    ? `${error.code}: ${error.message}`
    : error instanceof Error && /^(Use --|A saved|Saved generation|The saved|A saved reference|The selected renderer)/.test(error.message)
      ? error.message
      : 'Diagnostic failed before rendering. Check configuration and saved inputs.');
  process.exitCode = 1;
});
