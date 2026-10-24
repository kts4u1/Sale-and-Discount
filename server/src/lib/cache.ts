import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

interface Entry<V> {
  value: V;
  expiresAt: number;
}

/**
 * 만료 시간이 있는 메모리 캐시. 같은 키를 동시에 요청하면 한 번만 불러온다.
 */
export class TtlCache<V> {
  private entries = new Map<string, Entry<V>>();
  private inflight = new Map<string, Promise<V>>();

  constructor(
    private readonly defaultTtlMs: number,
    private readonly maxEntries = 500,
  ) {}

  get(key: string): V | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    // LRU: 최근 사용한 항목을 뒤로
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry.value;
  }

  set(key: string, value: V, ttlMs = this.defaultTtlMs): void {
    this.entries.delete(key);
    this.entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    while (this.entries.size > this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) break;
      this.entries.delete(oldest);
    }
  }

  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  async getOrLoad(key: string, loader: () => Promise<V>, ttlMs = this.defaultTtlMs): Promise<V> {
    const cached = this.get(key);
    if (cached !== undefined) return cached;
    const pending = this.inflight.get(key);
    if (pending) return pending;
    const promise = loader()
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .finally(() => this.inflight.delete(key));
    this.inflight.set(key, promise);
    return promise;
  }
}

/** JSON 파일을 원자적으로 저장 (임시 파일에 쓰고 이름 바꾸기) */
export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tmp, JSON.stringify(data, null, 2), 'utf8');
  await rename(tmp, file);
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw err;
  }
}

interface DiskEnvelope<T> {
  savedAt: number;
  value: T;
}

/**
 * 디스크에 저장되는 캐시 (서버를 다시 켜도 유지). 큰 목록(참가격 매장 목록 등)에 쓴다.
 */
export async function diskCached<T>(file: string, ttlMs: number, loader: () => Promise<T>): Promise<T> {
  try {
    const saved = await readJson<DiskEnvelope<T>>(file);
    if (saved && Date.now() - saved.savedAt < ttlMs) return saved.value;
  } catch {
    // 손상된 캐시는 무시하고 다시 받는다
  }
  const value = await loader();
  try {
    await writeJsonAtomic(file, { savedAt: Date.now(), value } satisfies DiskEnvelope<T>);
  } catch (err) {
    console.warn(`[cache] ${file} 저장 실패`, err);
  }
  return value;
}

/** 좌표를 격자로 반올림해 캐시 키로 쓴다 (기본 약 110m) */
export function gridKey(lat: number, lng: number, decimals = 3): string {
  return `${lat.toFixed(decimals)},${lng.toFixed(decimals)}`;
}
