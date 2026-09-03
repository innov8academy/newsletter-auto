import 'server-only';
import fs from 'node:fs/promises';
import path from 'node:path';
import { EDITORIAL_PROFILE } from './prompts';
import { normalizeReference } from './media';
import { stableId } from './service';
import { StudioError } from './errors';
import type { StudioRepository } from './repository';
import type { StudioAsset, StylePack } from './types';

// Catalog annotations from the supplied 40-image folder, inspected as a contact sheet.
const CATALOG: Record<string, [string, string[], string[]]> = {
  '0900cd75': [
    'Office workers and waveform',
    ['people', 'work', 'systems'],
    ['cobalt', 'yellow', 'red'],
  ],
  '14bb3153': [
    'Control-room monitors',
    ['systems', 'screens', 'data'],
    ['black', 'cyan', 'red'],
  ],
  '1e3187b5': [
    'Human and code hands',
    ['hands', 'code', 'interaction'],
    ['blue', 'black', 'off-white'],
  ],
  '2ba6b0b4': [
    'Workers behind a jagged chart',
    ['people', 'finance', 'jobs'],
    ['cyan', 'coral', 'yellow'],
  ],
  '2e571e46': [
    'Processor collage',
    ['chips', 'infrastructure', 'hardware'],
    ['blue', 'red', 'black'],
  ],
  '2e687283': [
    'Networked black cube',
    ['systems', 'compute', 'network'],
    ['black', 'blue', 'cyan'],
  ],
  '3681e596': [
    'Screens around a waveform',
    ['data', 'screens', 'audio'],
    ['navy', 'coral', 'white'],
  ],
  '4284b6b1': [
    'Falling coins',
    ['coins', 'finance', 'funding'],
    ['blue', 'white'],
  ],
  '5ff77fc7': [
    'Bull over city and charts',
    ['finance', 'markets', 'city'],
    ['cyan', 'coral', 'grey'],
  ],
  '6ceaa598': [
    'Operator at workstation',
    ['people', 'work', 'screens'],
    ['blue', 'orange', 'green'],
  ],
  '723d51b0': [
    'Blurred monitor wall',
    ['screens', 'systems', 'attention'],
    ['blue', 'red', 'white'],
  ],
  '8072db31': [
    'Coin rows in perspective',
    ['coins', 'finance', 'funding', 'depth'],
    ['cobalt', 'gold'],
  ],
  '84301eb2': [
    'Hands holding classical head',
    ['hands', 'sculpture', 'culture'],
    ['grey', 'black'],
  ],
  '845dd4f2': [
    'Globe and vertical data lights',
    ['global', 'data', 'systems'],
    ['blue', 'red', 'black'],
  ],
  '88f88572': [
    'Retro computer and cash',
    ['finance', 'computer', 'funding'],
    ['blue', 'green', 'red'],
  ],
  '8cef7c44': [
    'Conference table under network',
    ['people', 'business', 'network'],
    ['blue', 'black', 'white'],
  ],
  '9a319e99': [
    'Server corridor with charts',
    ['servers', 'infrastructure', 'compute'],
    ['blue', 'yellow', 'white'],
  ],
  aa9fc889: [
    'Energy landscape collage',
    ['landscape', 'energy', 'infrastructure'],
    ['orange', 'yellow', 'blue'],
  ],
  b5056cb2: [
    'Person holding smartphones',
    ['people', 'phone', 'product'],
    ['blue', 'off-white', 'black'],
  ],
  b51b5524: [
    'Portrait on a torn color field',
    ['portrait', 'people', 'cutout'],
    ['blue', 'coral', 'white'],
  ],
  bba4ed5b: [
    'Phone held against a jacket',
    ['phone', 'product', 'cutout'],
    ['blue', 'black', 'white'],
  ],
  bdc42d57: [
    'Cloud with product and geometric layers',
    ['cloud', 'product', 'systems'],
    ['black', 'orange', 'lavender'],
  ],
  c015ab97: [
    'Data corridor',
    ['data', 'systems', 'depth'],
    ['blue', 'black', 'white'],
  ],
  c8cde098: [
    'Capitol within a globe',
    ['policy', 'global', 'government'],
    ['coral', 'blue', 'yellow'],
  ],
  cd6061d1: [
    'Housing and code collage',
    ['city', 'policy', 'code'],
    ['blue', 'red', 'white'],
  ],
  d12fdb3d: [
    'Lobster and graphic hand',
    ['object', 'hands', 'surreal', 'product'],
    ['cobalt', 'magenta', 'yellow'],
  ],
  d92524b7: [
    'Soft-focus application icons',
    ['apps', 'product', 'interface'],
    ['grey', 'red', 'cyan'],
  ],
  d92d5186: [
    'Hand holding a world sphere',
    ['hands', 'global', 'environment'],
    ['yellow', 'red', 'blue'],
  ],
  e23919a1: [
    'Fragmented forms in a beam',
    ['abstract', 'systems', 'fracture'],
    ['black', 'pink', 'blue'],
  ],
  e635e32: [
    'Code flowing into a globe',
    ['global', 'code', 'data'],
    ['black', 'blue'],
  ],
  e75595fc: [
    'Open book and floating information',
    ['education', 'data', 'knowledge'],
    ['blue', 'green', 'red'],
  ],
  e9bfd05e: [
    'Conference crowd and graphic marks',
    ['people', 'conference', 'cutout'],
    ['yellow', 'black', 'magenta'],
  ],
  f3a4a8ca: [
    'Interview-stage photographic cutout',
    ['people', 'portrait', 'conference'],
    ['blue', 'white', 'magenta'],
  ],
  f6706a81: [
    'Seated silhouette with cloud backdrop',
    ['people', 'attention', 'abstract'],
    ['orange', 'blue', 'black'],
  ],
  faa9bafe: [
    'Open door and layered network',
    ['systems', 'access', 'abstract'],
    ['grey', 'cyan', 'white'],
  ],
  faad57b9: [
    'Light through server corridor',
    ['servers', 'network', 'depth'],
    ['black', 'blue', 'red'],
  ],
  fb0e8ffb: [
    'Document between data stacks',
    ['policy', 'data', 'documents'],
    ['blue', 'yellow', 'black'],
  ],
  fc4a02bc: [
    'DNA and code',
    ['biology', 'code', 'science'],
    ['black', 'blue', 'off-white'],
  ],
  feb4efde: [
    'Converging tracks',
    ['systems', 'network', 'depth'],
    ['black', 'cyan', 'green'],
  ],
  ff743872: [
    'Crowd under graphic horizon',
    ['people', 'landscape', 'society'],
    ['blue', 'yellow', 'orange'],
  ],
};
export async function installSeedStyle(repo: StudioRepository) {
  const existing = (await repo.listStyles()).find(
    (pack) => pack.slug === 'l8r-editorial-v2' && pack.version === 1,
  );
  if (existing) return existing;
  const directory = path.join(process.cwd(), 'studio-seed', 'editorial-v2');
  let files: string[];
  try {
    files = (await fs.readdir(directory))
      .filter((file) => /\.(png|jpg|jpeg)$/i.test(file))
      .sort();
  } catch {
    throw new StudioError(
      'seed_missing',
      'The bundled L8R reference catalog is missing from this deployment.',
      503,
    );
  }
  if (files.length !== 40)
    throw new StudioError(
      'seed_incomplete',
      'The bundled L8R catalog must contain all forty supplied images.',
      503,
    );
  const assets: StudioAsset[] = [];
  const seen = new Set<string>();
  for (const file of files) {
    const bytes = await fs.readFile(path.join(directory, file));
    const normalized = await normalizeReference(bytes);
    if (seen.has(normalized.checksum)) continue;
    seen.add(normalized.checksum);
    const id = stableId(`l8r-seed:${normalized.checksum}`);
    const originalPath = `styles/l8r-editorial-v2/${id}/original`;
    const conditioningPath = `styles/l8r-editorial-v2/${id}/conditioning.jpg`;
    const entry = Object.entries(CATALOG).find(([prefix]) =>
      file.startsWith(prefix),
    )?.[1];
    if (!entry)
      throw new StudioError(
        'seed_incomplete',
        `Missing catalog notes for ${file}.`,
        503,
      );
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
      name: `${entry[0]} · ${file}`,
      originalPath,
      conditioningPath,
      mimeType: normalized.mimeType,
      width: normalized.width,
      height: normalized.height,
      byteLength: bytes.length,
      checksum: normalized.checksum,
      eligibleForConditioning: normalized.eligibleForConditioning,
      tags: entry[1],
      palette: entry[2],
      texture:
        'Editorial photomontage, selective grain and halftone, geometric color fields; preserve subject detail.',
      sourcePageUrl: null,
      originalUrl: null,
      createdAt: new Date().toISOString(),
    };
    await repo.putAsset(asset);
    assets.push(asset);
  }
  const anchorOrder = [
    'aa9fc889',
    'bdc42d57',
    'd12fdb3d',
    '845dd4f2',
    '8072db31',
  ];
  const pack: StylePack = {
    id: stableId('l8r-editorial-v2:1'),
    slug: 'l8r-editorial-v2',
    version: 1,
    name: 'L8R Editorial v2',
    profile: EDITORIAL_PROFILE,
    assetIds: assets.map((a) => a.id),
    anchorIds: anchorOrder
      .map((prefix) => assets.find((a) => a.name.includes(prefix))?.id)
      .filter((id): id is string => Boolean(id)),
    active: false,
    createdAt: new Date().toISOString(),
  };
  await repo.insertStyle(pack);
  await repo.activateStyle(pack.id);
  return { ...pack, active: true };
}
