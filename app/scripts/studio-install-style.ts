import { config } from 'dotenv';
import { SupabaseStudioRepository } from '../src/lib/studio/repository';
import { installSeedStyle } from '../src/lib/studio/seed-style';

config({ quiet: true });
async function main() {
  if (!process.argv.includes('--confirm'))
    throw new Error(
      'This imports the supplied images into private Supabase storage. Pass --confirm to run.',
    );
  const repo = new SupabaseStudioRepository();
  await repo.checkReady();
  const pack = await installSeedStyle(repo);
  console.log(
    JSON.stringify({
      id: pack.id,
      name: pack.name,
      version: pack.version,
      catalogImages: pack.assetIds.length,
      eligibleAnchors: pack.anchorIds.length,
      active: pack.active,
    }),
  );
}
void main().catch((error) => {
  console.error(
    error instanceof Error ? error.message : 'Style installation failed.',
  );
  process.exitCode = 1;
});
