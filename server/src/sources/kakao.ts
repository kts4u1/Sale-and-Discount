import {
  categoryFromKakao,
  detectBrand,
  safeHttpUrl,
  type GeocodeResult,
  type LatLng,
  type ReverseGeocodeResult,
  type Store,
} from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { TtlCache, gridKey } from '../lib/cache.ts';
import { fetchJson, mapLimit } from '../lib/http.ts';

const API = 'https://dapi.kakao.com/v2/local';

export interface KakaoPlace {
  id: string;
  place_name: string;
  category_name: string;
  category_group_code: string;
  category_group_name: string;
  phone: string;
  address_name: string;
  road_address_name: string;
  x: string;
  y: string;
  place_url: string;
  distance?: string;
}

interface KakaoPlaceResponse {
  meta: { total_count: number; pageable_count: number; is_end: boolean };
  documents: KakaoPlace[];
}

interface KakaoAddressDoc {
  address_name: string;
  x: string;
  y: string;
  road_address?: { address_name: string; building_name?: string } | null;
}

interface KakaoCoord2AddressDoc {
  address?: {
    address_name: string;
    region_1depth_name: string;
    region_2depth_name: string;
    region_3depth_name: string;
  } | null;
  road_address?: { address_name: string; building_name?: string } | null;
}

/** 할인 행사가 있을 만한 카카오 카테고리 */
const CATEGORY_CODES = ['FD6', 'CE7', 'CS2', 'MT1', 'PM9'] as const;

/** 카테고리 코드가 없는 업종은 키워드로 찾는다 */
const KEYWORD_QUERIES = ['올리브영', '다이소', '정육점', '과일가게', '화장품', '옷가게', '반찬가게', '전자제품'];

/** 반경을 몇 단계로 묶어 캐시 효율을 높인다 */
const RADIUS_BUCKETS = [300, 600, 1000];

export function kakaoPlaceToStore(p: KakaoPlace): Store {
  const brand = detectBrand(p.place_name);
  return {
    id: `kakao:${p.id}`,
    name: p.place_name,
    category: categoryFromKakao(p.category_group_code || undefined, p.category_name, p.place_name),
    categoryDetail: p.category_name || undefined,
    brand: brand?.brand,
    lat: Number(p.y),
    lng: Number(p.x),
    address: p.address_name || undefined,
    roadAddress: p.road_address_name || undefined,
    phone: p.phone || undefined,
    url: safeHttpUrl(p.place_url),
    sources: ['kakao'],
  };
}

export class KakaoSource {
  private storeCache = new TtlCache<{ stores: Store[]; truncated: boolean }>(30 * 60_000, 300);
  private geoCache = new TtlCache<GeocodeResult[]>(24 * 3_600_000, 1000);
  private reverseCache = new TtlCache<ReverseGeocodeResult>(24 * 3_600_000, 2000);
  private addressCache = new TtlCache<LatLng | null>(7 * 24 * 3_600_000, 5000);

  constructor(private readonly config: AppConfigEnv) {}

  get enabled(): boolean {
    return Boolean(this.config.kakaoKey);
  }

  private get<T>(path: string, params: Record<string, string | number>): Promise<T> {
    const qs = new URLSearchParams(Object.entries(params).map(([k, v]): [string, string] => [k, String(v)]));
    return fetchJson<T>(`${API}${path}?${qs}`, {
      headers: { Authorization: `KakaoAK ${this.config.kakaoKey}` },
      timeoutMs: 8000,
    });
  }

  async nearbyStores(center: LatLng, radius: number): Promise<{ stores: Store[]; truncated: boolean }> {
    const bucket = RADIUS_BUCKETS.find((r) => r >= radius) ?? RADIUS_BUCKETS[RADIUS_BUCKETS.length - 1];
    const key = `${gridKey(center.lat, center.lng)}:${bucket}`;
    return this.storeCache.getOrLoad(key, async () => {
      let truncated = false;
      const tasks: (() => Promise<KakaoPlace[]>)[] = [];
      for (const code of CATEGORY_CODES) {
        tasks.push(async () => {
          const all: KakaoPlace[] = [];
          for (let page = 1; page <= 3; page++) {
            const res = await this.get<KakaoPlaceResponse>('/search/category.json', {
              category_group_code: code,
              x: center.lng,
              y: center.lat,
              radius: bucket,
              sort: 'distance',
              size: 15,
              page,
            });
            all.push(...res.documents);
            if (res.meta.is_end) break;
            if (page === 3) truncated = true;
          }
          return all;
        });
      }
      for (const query of KEYWORD_QUERIES) {
        tasks.push(async () => {
          const res = await this.get<KakaoPlaceResponse>('/search/keyword.json', {
            query,
            x: center.lng,
            y: center.lat,
            radius: bucket,
            sort: 'distance',
            size: 15,
          });
          return res.documents;
        });
      }
      const results = await mapLimit(tasks, 4, (t) => t().catch(() => [] as KakaoPlace[]));
      const byId = new Map<string, Store>();
      for (const place of results.flat()) {
        if (!byId.has(place.id)) byId.set(place.id, kakaoPlaceToStore(place));
      }
      return { stores: [...byId.values()], truncated };
    });
  }

  /** 장소명/주소 검색 */
  async geocode(query: string, near?: LatLng): Promise<GeocodeResult[]> {
    const key = `${query}|${near ? gridKey(near.lat, near.lng, 2) : ''}`;
    return this.geoCache.getOrLoad(key, async () => {
      const [addr, places] = await Promise.all([
        this.get<{ documents: KakaoAddressDoc[] }>('/search/address.json', { query, size: 5 }).catch(() => ({
          documents: [],
        })),
        this.get<KakaoPlaceResponse>('/search/keyword.json', {
          query,
          size: 10,
          ...(near ? { x: near.lng, y: near.lat, sort: 'accuracy' } : {}),
        }).catch(() => ({ documents: [] as KakaoPlace[] })),
      ]);
      const results: GeocodeResult[] = [
        ...addr.documents.map((d) => ({
          name: d.road_address?.building_name || d.address_name,
          address: d.road_address?.address_name ?? d.address_name,
          lat: Number(d.y),
          lng: Number(d.x),
          source: 'kakao' as const,
        })),
        ...places.documents.map((p) => ({
          name: p.place_name,
          address: p.road_address_name || p.address_name,
          lat: Number(p.y),
          lng: Number(p.x),
          source: 'kakao' as const,
        })),
      ];
      return results.slice(0, 10);
    });
  }

  /** 주소 한 건을 좌표로 (참가격 매장 좌표 보정용) */
  async addressToLatLng(address: string): Promise<LatLng | null> {
    return this.addressCache.getOrLoad(address, async () => {
      const res = await this.get<{ documents: KakaoAddressDoc[] }>('/search/address.json', { query: address, size: 1 });
      const d = res.documents[0];
      return d ? { lat: Number(d.y), lng: Number(d.x) } : null;
    });
  }

  async reverse(center: LatLng): Promise<ReverseGeocodeResult> {
    const key = gridKey(center.lat, center.lng, 4);
    return this.reverseCache.getOrLoad(key, async () => {
      const res = await this.get<{ documents: KakaoCoord2AddressDoc[] }>('/geo/coord2address.json', {
        x: center.lng,
        y: center.lat,
      });
      const d = res.documents[0];
      if (!d) return { address: '', source: 'kakao' };
      const road = d.road_address?.address_name;
      const building = d.road_address?.building_name;
      return {
        address: road ? `${road}${building ? ` (${building})` : ''}` : (d.address?.address_name ?? ''),
        region1: d.address?.region_1depth_name,
        region2: d.address?.region_2depth_name,
        region3: d.address?.region_3depth_name,
        source: 'kakao',
      };
    });
  }
}
