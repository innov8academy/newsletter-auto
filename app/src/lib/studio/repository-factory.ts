import 'server-only';
import { cloudflareSelected } from '../cloudflare-data';
import { CloudflareStudioRepository } from './cloudflare-repository';
import { SupabaseStudioRepository, type StudioRepository } from './repository';

/** Select one backend explicitly so an incomplete migration never falls back silently. */
export function createStudioRepository(): StudioRepository {
  return cloudflareSelected()
    ? new CloudflareStudioRepository()
    : new SupabaseStudioRepository();
}
