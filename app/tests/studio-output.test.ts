import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import { StudioError } from '../src/lib/studio/errors';
import { prepareOutput } from '../src/lib/studio/media';

async function image(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: '#2444cc' },
  }).png().toBuffer();
}

test('native Nano 2K landscape output keeps its dimensions and produces the newsletter image', async () => {
  const result = await prepareOutput(await image(2752, 1536), 'nano-pro-2k');
  const original = await sharp(result.original).metadata();
  const delivery = await sharp(result.delivery).metadata();
  assert.deepEqual([result.width, result.height], [2752, 1536]);
  assert.deepEqual([original.width, original.height, original.format], [2752, 1536, 'png']);
  assert.deepEqual([delivery.width, delivery.height, delivery.format], [2048, 1152, 'jpeg']);
});

test('undersized, square and portrait provider images report their actual dimensions', async () => {
  for (const [width, height] of [[1376, 768], [2048, 2048], [1152, 2048]]) {
    await assert.rejects(prepareOutput(await image(width, height), 'nano-pro-2k'), error => {
      assert.ok(error instanceof StudioError);
      assert.equal(error.code, 'invalid_output');
      assert.ok(error.message.includes(`${width}×${height}`));
      assert.match(error.message, /2K landscape/);
      return true;
    });
  }
});

test('unreadable provider bytes are distinguished from a dimension mismatch', async () => {
  await assert.rejects(prepareOutput(Buffer.from('not an image'), 'nano-pro-2k'), error => {
    assert.ok(error instanceof StudioError);
    assert.equal(error.code, 'unreadable_output');
    assert.match(error.message, /could not be read/);
    assert.doesNotMatch(error.message, /did not match.*2K/);
    return true;
  });
});

test('GPT high output still requires exactly 2048 by 1152', async () => {
  const accepted = await prepareOutput(await image(2048, 1152), 'gpt-image-2-high');
  assert.deepEqual([accepted.width, accepted.height], [2048, 1152]);
  await assert.rejects(prepareOutput(await image(2752, 1536), 'gpt-image-2-high'), error => {
    assert.ok(error instanceof StudioError);
    assert.equal(error.code, 'invalid_output');
    assert.match(error.message, /2752×1536/);
    assert.match(error.message, /2048×1152/);
    return true;
  });
});
