import { stat } from 'node:fs/promises';
import { readJson } from './cache.ts';

/**
 * 파일이 바뀌면 다시 읽는 JSON 데이터 (서버를 끄지 않고 데이터 파일만 교체할 수 있게).
 */
export class WatchedJsonFile<T> {
  private value?: T;
  private mtime = 0;
  private checkedAt = 0;

  constructor(
    private readonly file: string,
    private readonly fallback: T,
    private readonly checkEveryMs = 10_000,
  ) {}

  async get(): Promise<T> {
    const now = Date.now();
    if (this.value !== undefined && now - this.checkedAt < this.checkEveryMs) return this.value;
    this.checkedAt = now;
    try {
      const s = await stat(this.file);
      if (this.value === undefined || s.mtimeMs !== this.mtime) {
        this.value = (await readJson<T>(this.file)) ?? this.fallback;
        this.mtime = s.mtimeMs;
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        console.warn(`[data] ${this.file} 읽기 실패:`, (err as Error).message);
      }
      this.value ??= this.fallback;
    }
    return this.value;
  }
}
