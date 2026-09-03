import assert from 'node:assert/strict';
import { afterEach, test } from 'node:test';
import { downloadStudioAsset } from '../src/components/studio/client-api';

const originalFetch = globalThis.fetch;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDocument) {
    Object.defineProperty(globalThis, 'document', originalDocument);
  } else {
    Reflect.deleteProperty(globalThis, 'document');
  }
});

function captureDownloads() {
  const downloads: { href: string; download: string }[] = [];
  Object.defineProperty(globalThis, 'document', {
    configurable: true,
    value: {
      createElement(tag: string) {
        assert.equal(tag, 'a');
        return {
          href: '',
          download: '',
          click() {
            downloads.push({ href: this.href, download: this.download });
          },
        };
      },
    },
  });
  return downloads;
}

test('downloads the requested asset with a fresh signed attachment URL every time', async () => {
  const downloads = captureDownloads();
  let requests = 0;
  globalThis.fetch = async (input, init) => {
    assert.equal(input, '/api/studio/assets/displayed-delivery?download=1');
    assert.equal(init?.method, 'GET');
    assert.equal(init?.cache, 'no-store');
    assert.equal(init?.body, undefined);
    requests += 1;
    return Response.json({
      asset: {
        id: 'displayed-delivery',
        mimeType: 'image/jpeg',
        previewUrl: `https://storage.example/image.jpg?token=${requests}&download=displayed-delivery.jpg`,
      },
    });
  };
  await downloadStudioAsset('displayed-delivery');
  await downloadStudioAsset('displayed-delivery');
  assert.equal(requests, 2);
  assert.deepEqual(downloads, [1, 2].map((token) => ({
    href: `https://storage.example/image.jpg?token=${token}&download=displayed-delivery.jpg`,
    download: 'displayed-delivery.jpg',
  })));
});

test('preserves PNG filenames and safely encodes the asset ID', async () => {
  const downloads = captureDownloads();
  globalThis.fetch = async (input) => {
    assert.equal(input, '/api/studio/assets/test%2Fasset?download=1');
    return Response.json({ asset: {
      id: 'png-asset', mimeType: 'image/png',
      previewUrl: 'http://localhost:4319/asset.png?download=png-asset.png',
    } });
  };
  await downloadStudioAsset('test/asset');
  assert.equal(downloads[0].download, 'png-asset.png');
});

test('missing, malformed and unsafe URLs do not start a download', async () => {
  const downloads = captureDownloads();
  for (const previewUrl of [undefined, '', 'not a URL', 'javascript:alert(1)', 'data:text/html,bad']) {
    globalThis.fetch = async () => Response.json({ asset: { previewUrl } });
    await assert.rejects(downloadStudioAsset('asset'), /download link/i);
  }
  assert.equal(downloads.length, 0);
});

test('authentication and network failures remain recoverable without downloading', async () => {
  const downloads = captureDownloads();
  globalThis.fetch = async () => Response.json(
    { success: false, error: 'Please sign in again.', code: 'unauthorized' },
    { status: 401 },
  );
  await assert.rejects(downloadStudioAsset('asset'), /Please sign in again/);
  globalThis.fetch = async () => { throw new Error('Connection lost'); };
  await assert.rejects(downloadStudioAsset('asset'), /Connection lost/);
  assert.equal(downloads.length, 0);
});
