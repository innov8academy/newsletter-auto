import assert from 'node:assert/strict';
import test from 'node:test';
import { createSafeStorage } from '../src/lib/browser-storage';
import { createUuid } from '../src/lib/uuid';

test('creates a v4 UUID when Web Crypto lacks randomUUID', () => {
  const cryptoWithoutRandomUUID = {
    getRandomValues(bytes: Uint8Array) {
      bytes.fill(0);
      return bytes;
    },
  } as unknown as Crypto;

  assert.equal(
    createUuid(cryptoWithoutRandomUUID),
    '00000000-0000-4000-8000-000000000000',
  );
});

test('keeps storage operations available when the browser blocks local storage', () => {
  const storage = createSafeStorage(() => {
    throw new Error('Storage access is blocked.');
  });

  storage.setItem('draft', 'saved in memory');
  assert.equal(storage.getItem('draft'), 'saved in memory');
  assert.equal(storage.length, 1);
  storage.removeItem('draft');
  assert.equal(storage.getItem('draft'), null);
});
