import type {
  AppConfig,
  CreateDealInput,
  Deal,
  GeocodeResult,
  NewsItem,
  PriceCompareResponse,
  ReverseGeocodeResult,
  SearchResponse,
  SourceStatus,
  Store,
  StoreWithDistance,
  VoteAction,
  VoteResult,
} from '@sale-radar/shared';

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      ...init,
      headers: {
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
    });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new ApiError('서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요.', 0);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `요청 실패 (${res.status})`, res.status);
  return body as T;
}

const qs = (params: Record<string, string | number | boolean | undefined | null>) => {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    p.set(k, typeof v === 'boolean' ? (v ? '1' : '0') : String(v));
  }
  return p.toString();
};

export interface SearchParams {
  lat: number;
  lng: number;
  radius: number;
  q?: string;
  categories?: string[];
  types?: string[];
  sort?: string;
  sample?: boolean;
  active?: boolean;
  minDiscount?: number;
}

export const api = {
  config: () => request<AppConfig>('/api/config'),

  search: (p: SearchParams, signal?: AbortSignal) =>
    request<SearchResponse>(
      `/api/deals?${qs({
        lat: p.lat.toFixed(6),
        lng: p.lng.toFixed(6),
        radius: p.radius,
        q: p.q?.trim(),
        categories: p.categories?.join(','),
        types: p.types?.join(','),
        sort: p.sort,
        sample: p.sample,
        active: p.active || undefined,
        minDiscount: p.minDiscount || undefined,
      })}`,
      { signal },
    ),

  stores: (lat: number, lng: number, radius: number, q?: string, signal?: AbortSignal) =>
    request<{ stores: StoreWithDistance[]; sources: SourceStatus[] }>(
      `/api/stores?${qs({ lat: lat.toFixed(6), lng: lng.toFixed(6), radius, q: q?.trim() })}`,
      { signal },
    ),

  prices: (lat: number, lng: number, radius: number, q: string, signal?: AbortSignal) =>
    request<PriceCompareResponse>(`/api/prices?${qs({ lat: lat.toFixed(6), lng: lng.toFixed(6), radius, q })}`, {
      signal,
    }),

  geocode: (q: string, near?: { lat: number; lng: number }) =>
    request<{ results: GeocodeResult[] }>(`/api/geocode?${qs({ q, lat: near?.lat, lng: near?.lng })}`),

  reverse: (lat: number, lng: number) => request<ReverseGeocodeResult>(`/api/reverse?${qs({ lat, lng })}`),

  news: (q: string) => request<{ enabled: boolean; items: NewsItem[] }>(`/api/news?${qs({ q })}`),

  createDeal: (input: CreateDealInput) =>
    request<{ deal: Deal; store: Store }>('/api/deals', { method: 'POST', body: JSON.stringify(input) }),

  vote: (dealId: string, action: VoteAction) =>
    request<VoteResult & { duplicate: boolean }>(`/api/deals/${encodeURIComponent(dealId)}/vote`, {
      method: 'POST',
      body: JSON.stringify({ action }),
    }),
};
