import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { buildToolCacheKey, PersistentToolCache, TtlLruCache } from '../src/tool-cache.ts';

test('TtlLruCache enforces capacity with LRU eviction', () => {
  const cache = new TtlLruCache<string>(60_000, 2);

  cache.set('a', 'A', 1);
  cache.set('b', 'B', 2);

  assert.equal(cache.get('a', 3), 'A');
  cache.set('c', 'C', 4);

  assert.equal(cache.get('b', 5), undefined);
  assert.equal(cache.get('a', 5), 'A');
  assert.equal(cache.get('c', 5), 'C');
});

test('TtlLruCache expires by ttl', () => {
  const cache = new TtlLruCache<string>(100, 10);

  cache.set('x', 'X', 1_000);
  assert.equal(cache.get('x', 1_050), 'X');
  assert.equal(cache.get('x', 1_101), undefined);
});

test('PersistentToolCache persists entries and respects ttl and capacity', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'codegb-tool-cache-'));
  const filePath = path.join(root, 'mcp-tool-cache.json');

  const first = new PersistentToolCache<Record<string, unknown>>({
    filePath,
    ttlMs: 1_000,
    maxEntries: 2,
  });

  await first.set('k1', { value: 'one' });
  await first.set('k2', { value: 'two' });
  await first.set('k3', { value: 'three' });

  const second = new PersistentToolCache<Record<string, unknown>>({
    filePath,
    ttlMs: 1_000,
    maxEntries: 2,
  });

  assert.equal((await second.get('k1'))?.value, undefined);
  assert.equal((await second.get('k2'))?.value, 'two');
  assert.equal((await second.get('k3'))?.value, 'three');

  const expiredFilePath = path.join(root, 'expired-cache.json');
  await fs.writeFile(
    expiredFilePath,
    JSON.stringify({
      version: 1,
      entries: [
        {
          key: 'expired',
          value: { value: 'stale' },
          expiresAt: 1,
          touchedAt: 1,
        },
      ],
    }),
    'utf8',
  );

  const expired = new PersistentToolCache<Record<string, unknown>>({
    filePath: expiredFilePath,
    ttlMs: 1_000,
    maxEntries: 10,
  });

  assert.equal(await expired.get('expired'), undefined);
});

test('buildToolCacheKey is stable for equivalent args', () => {
  const key1 = buildToolCacheKey({
    repo: '/tmp/repo',
    commit: 'abc123',
    tool: 'query',
    args: {
      query: 'payment',
      limit: 10,
      repo: 'demo',
    },
  });

  const key2 = buildToolCacheKey({
    repo: '/tmp/repo',
    commit: 'abc123',
    tool: 'query',
    args: {
      repo: 'demo',
      limit: 10,
      query: 'payment',
    },
  });

  const key3 = buildToolCacheKey({
    repo: '/tmp/repo',
    commit: 'abc123',
    tool: 'context',
    args: {
      symbol: 'A',
      include_calls: true,
      repo: 'demo',
    },
  });

  assert.equal(key1, key2);
  assert.notEqual(key1, key3);
});
