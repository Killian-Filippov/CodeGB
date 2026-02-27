import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const CACHE_FILE_VERSION = 1;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  touchedAt: number;
}

export interface SerializedCacheEntry<T> {
  key: string;
  value: T;
  expiresAt: number;
  touchedAt: number;
}

interface SerializedCacheFile<T> {
  version: number;
  entries: SerializedCacheEntry<T>[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === 'object' && value !== null;
};

const isSerializedCacheEntry = <T>(value: unknown): value is SerializedCacheEntry<T> => {
  if (!isRecord(value)) {
    return false;
  }
  return (
    typeof value.key === 'string' &&
    typeof value.expiresAt === 'number' &&
    Number.isFinite(value.expiresAt) &&
    typeof value.touchedAt === 'number' &&
    Number.isFinite(value.touchedAt)
  );
};

const parseCacheFile = <T>(value: unknown): SerializedCacheFile<T> | null => {
  if (!isRecord(value)) {
    return null;
  }
  if (value.version !== CACHE_FILE_VERSION || !Array.isArray(value.entries)) {
    return null;
  }
  const entries = value.entries.filter((entry): entry is SerializedCacheEntry<T> => isSerializedCacheEntry<T>(entry));
  return {
    version: CACHE_FILE_VERSION,
    entries,
  };
};

export class TtlLruCache<T> {
  private readonly entries = new Map<string, CacheEntry<T>>();

  constructor(
    private readonly ttlMs: number,
    private readonly maxEntries: number,
  ) {}

  get(key: string, now = Date.now()): T | undefined {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) {
      return undefined;
    }

    const entry = this.entries.get(key);
    if (!entry) {
      return undefined;
    }

    if (entry.expiresAt <= now) {
      this.entries.delete(key);
      return undefined;
    }

    entry.touchedAt = now;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: T, now = Date.now()): void {
    if (this.ttlMs <= 0 || this.maxEntries <= 0) {
      this.entries.clear();
      return;
    }

    const entry: CacheEntry<T> = {
      value,
      expiresAt: now + this.ttlMs,
      touchedAt: now,
    };

    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    this.entries.set(key, entry);
    this.enforceLimits(now);
  }

  import(serializedEntries: SerializedCacheEntry<T>[], now = Date.now()): void {
    this.entries.clear();

    if (this.ttlMs <= 0 || this.maxEntries <= 0) {
      return;
    }

    const sorted = [...serializedEntries].sort((left, right) => left.touchedAt - right.touchedAt);
    for (const entry of sorted) {
      if (entry.expiresAt <= now) {
        continue;
      }
      this.entries.set(entry.key, {
        value: entry.value,
        expiresAt: entry.expiresAt,
        touchedAt: entry.touchedAt,
      });
    }

    this.enforceLimits(now);
  }

  snapshot(now = Date.now()): SerializedCacheEntry<T>[] {
    this.enforceLimits(now);
    const serialized: SerializedCacheEntry<T>[] = [];
    for (const [key, entry] of this.entries) {
      serialized.push({
        key,
        value: entry.value,
        expiresAt: entry.expiresAt,
        touchedAt: entry.touchedAt,
      });
    }
    return serialized;
  }

  private enforceLimits(now: number): void {
    this.removeExpired(now);

    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (!oldest) {
        break;
      }
      this.entries.delete(oldest);
    }
  }

  private removeExpired(now: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= now) {
        this.entries.delete(key);
      }
    }
  }
}

export interface PersistentToolCacheOptions {
  filePath: string;
  ttlMs: number;
  maxEntries: number;
}

export class PersistentToolCache<T> {
  private readonly cache: TtlLruCache<T>;
  private loaded = false;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly options: PersistentToolCacheOptions) {
    this.cache = new TtlLruCache<T>(options.ttlMs, options.maxEntries);
  }

  async get(key: string): Promise<T | undefined> {
    return this.withLock(async () => {
      await this.loadFromDisk();
      return this.cache.get(key);
    });
  }

  async set(key: string, value: T): Promise<void> {
    await this.withLock(async () => {
      await this.loadFromDisk();
      this.cache.set(key, value);
      await this.flushToDisk();
    });
  }

  private async withLock<R>(operation: () => Promise<R>): Promise<R> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private async loadFromDisk(): Promise<void> {
    if (this.loaded) {
      return;
    }
    this.loaded = true;

    try {
      const raw = await fs.readFile(this.options.filePath, 'utf8');
      const parsed = parseCacheFile<T>(JSON.parse(raw));
      if (!parsed) {
        return;
      }
      this.cache.import(parsed.entries);
    } catch {
      // Ignore cache file errors and continue without persisted data.
    }
  }

  private async flushToDisk(): Promise<void> {
    const payload: SerializedCacheFile<T> = {
      version: CACHE_FILE_VERSION,
      entries: this.cache.snapshot(),
    };

    await fs.mkdir(path.dirname(this.options.filePath), { recursive: true });
    const tempPath = `${this.options.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tempPath, JSON.stringify(payload), 'utf8');
    await fs.rename(tempPath, this.options.filePath);
  }
}

const normalizeValue = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }

  if (isRecord(value)) {
    const normalized: Record<string, unknown> = {};
    const keys = Object.keys(value).sort((left, right) => left.localeCompare(right));
    for (const key of keys) {
      normalized[key] = normalizeValue(value[key]);
    }
    return normalized;
  }

  return value;
};

export const stableStringify = (value: unknown): string => {
  return JSON.stringify(normalizeValue(value));
};

export const buildToolCacheKey = (input: {
  repo: string;
  commit: string;
  tool: string;
  args: Record<string, unknown>;
}): string => {
  const canonical = stableStringify({
    repo: input.repo,
    commit: input.commit,
    tool: input.tool,
    args: input.args,
  });
  return createHash('sha256').update(canonical).digest('hex');
};
