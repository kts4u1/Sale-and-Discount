export class HttpError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly body?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export interface FetchOptions extends RequestInit {
  timeoutMs?: number;
}

/** 시간 제한이 있는 fetch. 2xx 가 아니면 HttpError */
export async function fetchWithTimeout(url: string, options: FetchOptions = {}): Promise<Response> {
  const { timeoutMs = 10_000, signal, ...init } = options;
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: combined });
  } catch (err) {
    if (timeout.aborted) throw new HttpError(`요청 시간 초과 (${timeoutMs}ms): ${redact(url)}`);
    throw new HttpError(`요청 실패: ${redact(url)} - ${(err as Error).message}`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new HttpError(`HTTP ${res.status}: ${redact(url)}`, res.status, body.slice(0, 500));
  }
  return res;
}

export async function fetchJson<T>(url: string, options: FetchOptions = {}): Promise<T> {
  const res = await fetchWithTimeout(url, options);
  return (await res.json()) as T;
}

export async function fetchText(url: string, options: FetchOptions = {}): Promise<string> {
  const res = await fetchWithTimeout(url, options);
  return res.text();
}

/** 로그에 인증키가 찍히지 않도록 가린다 */
export function redact(url: string): string {
  return url.replace(/((?:service|Service)Key=)[^&]+/g, '$1***');
}

/** 동시에 최대 limit 개씩 실행 */
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

/** 실행 시간을 재며 실행 */
export async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
}
