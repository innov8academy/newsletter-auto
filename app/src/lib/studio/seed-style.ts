import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  EDITORIAL_PROFILE,
  EDITORIAL_ANCHORS,
  EDITORIAL_STYLE_SLUG,
  EDITORIAL_STYLE_VERSION,
} from './editorial-style';
import { normalizeReference } from './media';
import { stableId } from './service';
import { StudioError } from './errors';
import type { StudioRepository } from './repository';
import type { StudioAsset, StylePack } from './types';

// The full 40-image analysis remains local in STUDIO-STYLE.md. Only these three
// chosen examples are ever read/uploaded by the runtime installer.
export async function installSeedStyle(repo: StudioRepository) {
  const existing = (await repo.listStyles()).find(
    (pack) =>
      pack.slug === EDITORIAL_STYLE_SLUG &&
      pack.version === EDITORIAL_STYLE_VERSION,
  );
  if (existing) {
    const profileKeys = [
      'description',
      'palette',
      'texture',
      'composition',
      'avoid',
    ] as const;
    const storedAnchors = await repo.getAssets(existing.anchorIds);
    if (
      existing.assetIds.length !== 3 ||
      existing.anchorIds.length !== 3 ||
      EDITORIAL_ANCHORS.some(
        (anchor, index) =>
          !storedAnchors
            .find((asset) => asset.id === existing.anchorIds[index])
            ?.name.includes(anchor.prefix),
      ) ||
      profileKeys.some(
        (key) =>
          JSON.stringify(existing.profile[key]) !==
          JSON.stringify(EDITORIAL_PROFILE[key]),
      )
    )
      throw new StudioError(
        'style_version_mismatch',
        'This style revision differs from the reviewed three-reference profile. Create a new version rather than overwriting it.',
      );
    await repo.activateStyle(existing.id);
    return { ...existing, active: true };
  }
  const assets: StudioAsset[] = [];
  const seen = new Set<string>();
  for (const anchor of EDITORIAL_ANCHORS) {
    let bytes: Buffer;
    try {
      bytes = await fs.readFile(
        path.join(process.cwd(), 'studio-seed', 'selected', anchor.file),
      );
    } catch {
      throw new StudioError(
        'seed_missing',
        'A selected L8R reference is missing from this deployment.',
        503,
      );
    }
    const normalized = await normalizeReference(bytes);
    if (!normalized.eligibleForConditioning || seen.has(normalized.checksum))
      throw new StudioError(
        'seed_incomplete',
        'The three selected references must be distinct, high-resolution images.',
      );
    seen.add(normalized.checksum);
    const id = stableId(`l8r-seed:${normalized.checksum}`);
    const originalPath = `styles/l8r-editorial-v2/${id}/original`;
    const conditioningPath = `styles/l8r-editorial-v2/${id}/conditioning.jpg`;
    await repo.putObject(originalPath, bytes, normalized.mimeType);
    await repo.putObject(
      conditioningPath,
      normalized.conditioning,
      'image/jpeg',
    );
    const asset: StudioAsset = {
      id,
      draftId: null,
      role: 'style',
      status: 'ready',
      name: `${anchor.title} · ${anchor.file}`,
      originalPath,
      conditioningPath,
      mimeType: normalized.mimeType,
      width: normalized.width,
      height: normalized.height,
      byteLength: bytes.length,
      checksum: normalized.checksum,
      eligibleForConditioning: true,
      tags: [...anchor.tags],
      palette: [...anchor.palette],
      texture: anchor.lesson,
      sourcePageUrl: null,
      originalUrl: null,
      createdAt: new Date().toISOString(),
    };
    await repo.putAsset(asset);
    assets.push(asset);
  }
  const ids = assets.map((asset) => asset.id);
  const pack: StylePack = {
    id: stableId(`${EDITORIAL_STYLE_SLUG}:${EDITORIAL_STYLE_VERSION}`),
    slug: EDITORIAL_STYLE_SLUG,
    version: EDITORIAL_STYLE_VERSION,
    name: 'L8R Editorial',
    profile: EDITORIAL_PROFILE,
    assetIds: ids,
    anchorIds: ids,
    active: false,
    createdAt: new Date().toISOString(),
  };
  await repo.insertStyle(pack);
  await repo.activateStyle(pack.id);
  return { ...pack, active: true };
}
