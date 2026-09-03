import { config } from 'dotenv';
import {
  capabilities,
  verifyNanoCapabilities,
} from '../src/lib/studio/capabilities';
import { SupabaseStudioRepository } from '../src/lib/studio/repository';

config({ quiet: true });
async function main() {
  let repo: SupabaseStudioRepository | null = null;
  try {
    repo = new SupabaseStudioRepository();
  } catch {}
  const state = await capabilities(repo);
  console.log(JSON.stringify(state, null, 2));
  if (process.argv.includes('--models')) {
    try {
      await verifyNanoCapabilities(10);
      console.log(
        'Nano Banana Pro 2K/reference capabilities verified. No generation was requested.',
      );
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'Model verification failed.',
      );
      process.exitCode = 1;
    }
  }
  if (
    !state.storage.ready ||
    !state.planner.configured ||
    !state.presets[0].configured
  )
    process.exitCode = 1;
}
void main().catch((error) => {
  console.error(error instanceof Error ? error.message : 'Preflight failed.');
  process.exitCode = 1;
});
