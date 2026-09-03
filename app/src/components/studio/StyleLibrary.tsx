'use client';
import { useState } from 'react';
import { FolderOpen, Upload, Sparkles, Check, X } from 'lucide-react';
import type { StudioAsset, StylePack, StyleProfile } from '@/lib/studio/types';
import AssetPreview from './AssetPreview';
import {
  buttonClass,
  fieldClass,
  primaryClass,
  studioApi,
  uploadReference,
} from './client-api';

export default function StyleLibrary({
  styles,
  canAnalyze,
  onChanged,
  onClose,
}: {
  styles: StylePack[];
  canAnalyze: boolean;
  onChanged: (style?: StylePack) => Promise<void>;
  onClose: () => void;
}) {
  const [assets, setAssets] = useState<StudioAsset[]>([]);
  const [anchors, setAnchors] = useState<string[]>([]);
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');
  const [profile, setProfile] = useState<StyleProfile | null>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  async function task(label: string, action: () => Promise<void>) {
    setBusy(label);
    setError('');
    try {
      await action();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : 'The style operation failed.',
      );
    } finally {
      setBusy('');
    }
  }
  async function load(style: StylePack) {
    await task('Loading catalog', async () => {
      const data = await studioApi<{ style: StylePack; assets: StudioAsset[] }>(
        `styles/${style.id}`,
      );
      setAssets(data.assets);
      setAnchors(style.anchorIds);
      setName(style.name);
      setSlug(style.slug);
      setProfile(style.profile);
      setNotice(
        `Editing creates a new version. ${style.name} v${style.version} remains available for past images.`,
      );
    });
  }
  async function upload(files: FileList | null) {
    if (!files?.length) return;
    const selected = Array.from(files).filter((file) =>
      ['image/png', 'image/jpeg', 'image/webp'].includes(file.type),
    );
    if (!selected.length || selected.length > 40) {
      setError('Select one to forty JPEG, PNG or WebP images.');
      return;
    }
    await task('Importing references', async () => {
      const accepted: StudioAsset[] = [];
      const failures: string[] = [];
      setProfile(null);
      setSlug('');
      setName('New editorial style');
      setAnchors([]);
      for (let i = 0; i < selected.length; i++) {
        setBusy(`Importing ${i + 1} of ${selected.length}`);
        try {
          const asset = await uploadReference(selected[i], 'style', null);
          if (!accepted.some((old) => old.checksum === asset.checksum))
            accepted.push(asset);
        } catch (error) {
          failures.push(
            `${selected[i].name}: ${error instanceof Error ? error.message : 'Upload failed'}`,
          );
        }
        setAssets([...accepted]);
      }
      setNotice(
        `${accepted.length} unique images imported. ${accepted.filter((a) => a.eligibleForConditioning).length} can be used as high-resolution anchors.`,
      );
      if (failures.length) setError(failures.join('\n'));
    });
  }
  async function analyze() {
    await task('Analyzing visual style', async () => {
      const data = await studioApi<{
        profile: StyleProfile;
        anchorIds: string[];
      }>('styles/analyze', 'POST', { assetIds: assets.map((a) => a.id) });
      setProfile(data.profile);
      setAnchors(data.anchorIds);
      setNotice(
        'Review the rules and anchors before saving and activating this style.',
      );
    });
  }
  async function save() {
    await task('Saving style version', async () => {
      const data = await studioApi<{ style: StylePack }>('styles', 'POST', {
        name,
        slug: slug || undefined,
        profile,
        assetIds: assets.map((a) => a.id),
        anchorIds: anchors,
        activate: true,
      });
      await onChanged(data.style);
      setNotice(
        `${data.style.name} v${data.style.version} is now the default for new Studio work.`,
      );
    });
  }
  const set = (key: keyof StyleProfile, value: string | string[]) =>
    setProfile((old) => (old ? { ...old, [key]: value } : old));
  return (
    <section
      aria-label="Style library"
      className="mb-6 rounded-xl border border-purple-400/25 bg-[#14121C] p-4 sm:p-6"
    >
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Style library</h2>
          <p className="text-sm text-white/50">
            Versioned art direction and the images that define it.
          </p>
        </div>
        <button
          className={buttonClass}
          onClick={onClose}
          disabled={!!busy}
          aria-label="Close style library"
        >
          <X size={16} />
        </button>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {styles.map((style) => (
          <button
            className={buttonClass}
            disabled={!!busy}
            key={style.id}
            onClick={() => void load(style)}
          >
            {style.active && <Check size={14} />}
            {style.name} · v{style.version}
          </button>
        ))}
        <label className={`${buttonClass} cursor-pointer`}>
          <Upload size={14} />
          Import images
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            multiple
            className="sr-only"
            disabled={!!busy}
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <label className={`${buttonClass} cursor-pointer`}>
          <FolderOpen size={14} />
          Import folder
          <input
            ref={(node) => {
              node?.setAttribute('webkitdirectory', '');
            }}
            type="file"
            multiple
            className="sr-only"
            disabled={!!busy}
            onChange={(e) => {
              void upload(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {!styles.length && (
        <button
          className={primaryClass}
          disabled={!!busy}
          onClick={() =>
            void task('Installing the supplied catalog', async () => {
              const data = await studioApi<{ style: StylePack }>(
                'styles/install-seed',
                'POST',
                {},
              );
              await onChanged(data.style);
              const catalog = await studioApi<{ assets: StudioAsset[] }>(
                `styles/${data.style.id}`,
              );
              setAssets(catalog.assets);
              setName(data.style.name);
              setSlug(data.style.slug);
              setProfile(data.style.profile);
              setAnchors(data.style.anchorIds);
            })
          }
        >
          Install and use L8R Editorial v2 · 40 examples
        </button>
      )}
      {busy && (
        <p role="status" className="my-3 text-sm text-purple-200">
          {busy}…
        </p>
      )}
      {error && (
        <p
          role="alert"
          className="my-3 whitespace-pre-wrap text-sm text-rose-300"
        >
          {error}
        </p>
      )}
      {notice && <p className="my-3 text-sm text-white/60">{notice}</p>}
      {assets.length > 0 && (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <button
              className={buttonClass}
              disabled={!!busy || !canAnalyze}
              onClick={() => void analyze()}
            >
              <Sparkles size={14} />
              Analyze these examples
            </button>
            <span className="text-xs text-white/50">
              {anchors.length}/5 candidate anchors · at most 3 used per image
            </span>
          </div>
          {profile && (
            <fieldset
              disabled={!!busy}
              className="mb-5 grid gap-3 sm:grid-cols-2"
            >
              <label className="text-sm">
                Style name
                <input
                  className={`${fieldClass} mt-1`}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </label>
              <label className="text-sm">
                Palette, separated by commas
                <input
                  className={`${fieldClass} mt-1`}
                  value={profile.palette.join(', ')}
                  onChange={(e) =>
                    set(
                      'palette',
                      e.target.value
                        .split(',')
                        .map((v) => v.trim())
                        .filter(Boolean),
                    )
                  }
                />
              </label>
              <label className="text-sm">
                Art direction
                <textarea
                  className={`${fieldClass} mt-1 min-h-24`}
                  value={profile.description}
                  onChange={(e) => set('description', e.target.value)}
                />
              </label>
              <label className="text-sm">
                Texture and detail
                <textarea
                  className={`${fieldClass} mt-1 min-h-24`}
                  value={profile.texture}
                  onChange={(e) => set('texture', e.target.value)}
                />
              </label>
              <label className="text-sm">
                Composition principles, one per line
                <textarea
                  className={`${fieldClass} mt-1 min-h-24`}
                  value={profile.composition.join('\n')}
                  onChange={(e) =>
                    set(
                      'composition',
                      e.target.value.split('\n').filter(Boolean),
                    )
                  }
                />
              </label>
              <label className="text-sm">
                Avoid, one per line
                <textarea
                  className={`${fieldClass} mt-1 min-h-24`}
                  value={profile.avoid.join('\n')}
                  onChange={(e) =>
                    set('avoid', e.target.value.split('\n').filter(Boolean))
                  }
                />
              </label>
            </fieldset>
          )}
          <div className="grid max-h-[30rem] grid-cols-2 gap-3 overflow-y-auto sm:grid-cols-3 lg:grid-cols-5">
            {assets.map((asset) => (
              <article
                key={asset.id}
                className={`rounded-lg border p-2 ${anchors.includes(asset.id) ? 'border-purple-400 bg-purple-500/10' : 'border-white/10'}`}
              >
                <AssetPreview asset={asset} />
                <p
                  className="mt-2 line-clamp-2 break-words text-xs text-white/80"
                  title={asset.name}
                >
                  {asset.name}
                </p>
                <p className="my-1 text-[11px] text-white/45">
                  {asset.width}×{asset.height} ·{' '}
                  {asset.eligibleForConditioning
                    ? 'Anchor eligible'
                    : 'Analysis only'}
                </p>
                <label className="flex items-center gap-2 text-xs">
                  <input
                    type="checkbox"
                    checked={anchors.includes(asset.id)}
                    disabled={
                      !!busy ||
                      !asset.eligibleForConditioning ||
                      (!anchors.includes(asset.id) && anchors.length >= 5)
                    }
                    onChange={() =>
                      setAnchors((old) =>
                        old.includes(asset.id)
                          ? old.filter((id) => id !== asset.id)
                          : [...old, asset.id],
                      )
                    }
                  />
                  Use as style anchor
                </label>
              </article>
            ))}
          </div>
          {profile && (
            <button
              className={`${primaryClass} mt-4`}
              disabled={!!busy || !name.trim() || !anchors.length}
              onClick={() => void save()}
            >
              Save new version and activate
            </button>
          )}
        </>
      )}
    </section>
  );
}
