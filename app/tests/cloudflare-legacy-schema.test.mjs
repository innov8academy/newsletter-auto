import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { schema } from '../cloudflare/l8r-data/schema.mjs';

test('legacy tables preserve chronological reads and one URL per cached item', () => {
  const db = new DatabaseSync(':memory:');
  try {
    for (const statement of schema) db.exec(statement);
    db.prepare('INSERT INTO past_newsletters(id,title,file_name,content_text,imported_at) VALUES(?,?,?,?,?)').run('a', 'Old', 'old.html', 'old', '2026-11-07T00:00:00Z');
    db.prepare('INSERT INTO past_newsletters(id,title,file_name,content_text,imported_at) VALUES(?,?,?,?,?)').run('b', 'New', 'new.html', 'new', '2026-11-08T00:00:00Z');
    const names = db.prepare('SELECT file_name FROM past_newsletters ORDER BY imported_at DESC,id DESC LIMIT 2').all().map(row => row.file_name);
    assert.deepEqual(names, ['new.html', 'old.html']);
    db.prepare('INSERT INTO news_items(id,url,title) VALUES(?,?,?)').run('a', 'https://x.com/post', 'Post');
    assert.throws(() => db.prepare('INSERT INTO news_items(id,url,title) VALUES(?,?,?)').run('b', 'https://x.com/post', 'Duplicate'));
    db.prepare('INSERT INTO used_stories(headline) VALUES(?)').run('Story');
    assert.equal(db.prepare('SELECT headline FROM used_stories').get().headline, 'Story');
  } finally { db.close(); }
});
