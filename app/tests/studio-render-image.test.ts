import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { StudioError } from '../src/lib/studio/errors';
import { prepareOutput } from '../src/lib/studio/media';
import { buildImageRequest, renderImage } from '../src/lib/studio/providers';
import type { BufferedReference } from '../src/lib/studio/types';

const env = {
  OPENROUTER_API_KEY: 'fixture',
  OPENAI_API_KEY: 'fixture',
  NODE_ENV: 'test' as const,
};
const image = () => sharp({
  create: { width: 2752, height: 1536, channels: 3, background: '#336699' },
}).png().toBuffer();
const reference = (id: string, role: BufferedReference['role']): BufferedReference => ({
  id,
  role,
  name: id,
  note: 'fixture',
  bytes: Buffer.from(id),
  mimeType: 'image/png',
});
function response(data: unknown, status = 200) {
  return {
    ok: status === 200,
    status,
    headers: new Headers({ 'x-request-id': 'request_safe' }),
    json: async () => data,
  } as Response;
}
function errorCode(code: string) {
  return (error: unknown) => {
    assert.ok(error instanceof StudioError);
    assert.equal(error.code, code);
    return true;
  };
}

test('Nano request preserves reference order and chat image response reaches real output preparation', async () => {
  const bytes = await image();
  const refs = [
    reference('style', 'style'),
    reference('news', 'news'),
    reference('subject', 'subject'),
  ];
  let calls = 0;
  const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'https://openrouter.ai/api/v1/chat/completions');
    const payload = JSON.parse(init?.body as string);
    assert.deepEqual(payload.modalities, ['image', 'text']);
    assert.deepEqual(payload.image_config, { aspect_ratio: '16:9', image_size: '2K' });
    assert.deepEqual(
      payload.messages[0].content.slice(1).map((part: { image_url: { url: string } }) => part.image_url.url),
      refs.map((ref) => `data:image/png;base64,${ref.bytes.toString('base64')}`),
    );
    return response({
      id: 'fallback_id',
      provider: 'Google Vertex',
      usage: { cost: 0.14353 },
      choices: [{ message: {
        content: '',
        images: [{ type: 'image_url', image_url: { url: `data:image/png;base64,${bytes.toString('base64')}` } }],
      } }],
    });
  }) as typeof fetch;
  const rendered = await renderImage('nano-pro-2k', 'fixture prompt', refs, env, fetcher);
  assert.equal(calls, 1);
  assert.deepEqual(rendered.bytes, bytes);
  assert.equal(rendered.mimeType, 'image/png');
  assert.equal(rendered.requestId, 'request_safe');
  assert.equal(rendered.provider, 'Google Vertex');
  assert.equal(rendered.cost.amountUsd, 0.14353);
  const output = await prepareOutput(rendered.bytes, 'nano-pro-2k');
  assert.deepEqual([output.width, output.height], [2752, 1536]);
  const delivered = await sharp(output.delivery).metadata();
  assert.deepEqual([delivered.width, delivered.height, delivered.format], [2048, 1152, 'jpeg']);
});

test('Nano text-only response reports no image', async () => {
  let calls = 0;
  const fetcher = (async () => {
    calls++;
    return response({ choices: [{ message: { content: 'No image' } }] });
  }) as typeof fetch;
  await assert.rejects(renderImage('nano-pro-2k', 'fixture', [], env, fetcher), errorCode('no_image'));
  assert.equal(calls, 1);
});

test('Nano rejects remote and malformed image URLs without fetching them', async () => {
  for (const url of [
    'https://example.com/image.png',
    'data:image/svg+xml;base64,AAAA',
    'data:image/png;base64,ab??',
  ]) {
    let calls = 0;
    const fetcher = (async () => {
      calls++;
      return response({ choices: [{ message: { images: [{ image_url: { url } }] } }] });
    }) as typeof fetch;
    await assert.rejects(renderImage('nano-pro-2k', 'fixture', [], env, fetcher), errorCode('unreadable_output'));
    assert.equal(calls, 1);
  }
});

test('Nano rejects oversized encoded output after one request', async () => {
  let calls = 0;
  const url = `data:image/png;base64,${'A'.repeat(48 * 1024 * 1024 + 4)}`;
  const fetcher = (async () => {
    calls++;
    return response({ choices: [{ message: { images: [{ image_url: { url } }] } }] });
  }) as typeof fetch;
  await assert.rejects(renderImage('nano-pro-2k', 'fixture', [], env, fetcher), errorCode('oversized_output'));
  assert.equal(calls, 1);
});

test('provider error and direct OpenAI response retain existing contracts', async () => {
  let failures = 0;
  const failing = (async () => {
    failures++;
    return response({ error: { message: 'private' } }, 429);
  }) as typeof fetch;
  await assert.rejects(renderImage('nano-pro-2k', 'fixture', [], env, failing), errorCode('provider_429'));
  assert.equal(failures, 1);
  const direct = buildImageRequest('gpt-image-2-high', 'fixture', [], 'fixture');
  assert.equal(direct.url, 'https://api.openai.com/v1/images/generations');
  assert.deepEqual(JSON.parse(direct.init.body as string), {
    model: 'gpt-image-2',
    prompt: 'fixture',
    size: '2048x1152',
    quality: 'high',
    output_format: 'png',
    n: 1,
  });
  const bytes = await image();
  const gptFetcher = (async () => response({
    data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }],
    usage: { cost: 0.18 },
  })) as typeof fetch;
  const gpt = await renderImage('gpt-image-2-high', 'fixture', [], env, gptFetcher);
  assert.deepEqual(gpt.bytes, bytes);
  assert.equal(gpt.cost.amountUsd, 0.18);
});
