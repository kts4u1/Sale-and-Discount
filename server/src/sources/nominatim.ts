import type { GeocodeResult, LatLng, ReverseGeocodeResult } from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { TtlCache, gridKey } from '../lib/cache.ts';
import { fetchJson } from '../lib/http.ts';

interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
}

/**
 * OpenStreetMap Nominatim (키 불필요). 사용 정책상 초당 1회로 제한한다.
 * https://operations.osmfoundation.org/policies/nominatim/
 */
export class NominatimSource {
  private queue: Promise<unknown> = Promise.resolve();
  private lastCall = 0;
  private searchCache = new TtlCache<GeocodeResult[]>(24 * 3_600_000, 1000);
  private reverseCache = new TtlCache<ReverseGeocodeResult>(24 * 3_600_000, 2000);

  constructor(private readonly config: AppConfigEnv) {}

  private throttled<T>(fn: () => Promise<T>): Promise<T> {
    const run = async () => {
      const wait = this.lastCall + 1100 - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      this.lastCall = Date.now();
      return fn();
    };
    const next = this.queue.then(run, run);
    this.queue = next.catch(() => undefined);
    return next;
  }

  private get<T>(path: string, params: Record<string, string>): Promise<T> {
    const qs = new URLSearchParams({ format: 'jsonv2', 'accept-language': 'ko', ...params });
    return this.throttled(() =>
      fetchJson<T>(`${this.config.nominatimUrl}${path}?${qs}`, {
        headers: { 'User-Agent': this.config.userAgent },
        timeoutMs: 8000,
      }),
    );
  }

  async geocode(query: string, near?: LatLng): Promise<GeocodeResult[]> {
    const key = `${query}|${near ? gridKey(near.lat, near.lng, 1) : ''}`;
    return this.searchCache.getOrLoad(key, async () => {
      const params: Record<string, string> = { q: query, countrycodes: 'kr', limit: '8', addressdetails: '1' };
      if (near) {
        // 현재 위치 주변(약 ±30km)을 우선
        params.viewbox = `${near.lng - 0.3},${near.lat + 0.3},${near.lng + 0.3},${near.lat - 0.3}`;
      }
      const places = await this.get<NominatimPlace[]>('/search', params);
      return places.map((p) => ({
        name: p.name || p.display_name.split(',')[0],
        address: formatKoreanAddress(p),
        lat: Number(p.lat),
        lng: Number(p.lon),
        source: 'nominatim' as const,
      }));
    });
  }

  async addressToLatLng(address: string): Promise<LatLng | null> {
    const results = await this.geocode(address);
    return results[0] ? { lat: results[0].lat, lng: results[0].lng } : null;
  }

  async reverse(center: LatLng): Promise<ReverseGeocodeResult> {
    const key = gridKey(center.lat, center.lng, 4);
    return this.reverseCache.getOrLoad(key, async () => {
      const p = await this.get<NominatimPlace>('/reverse', {
        lat: String(center.lat),
        lon: String(center.lng),
        zoom: '18',
        addressdetails: '1',
      });
      const a = p.address ?? {};
      return {
        address: formatKoreanAddress(p),
        region1: a.province ?? a.state ?? a.city,
        region2: a.city_district ?? a.borough ?? a.county ?? a.city,
        region3: a.quarter ?? a.suburb ?? a.neighbourhood,
        source: 'nominatim',
      };
    });
  }
}

/** Nominatim 의 "건물, 번지, 길, 동, 구, 시, 우편번호, 대한민국" 순서를 한국식으로 뒤집는다 */
export function formatKoreanAddress(p: NominatimPlace): string {
  const a = p.address;
  if (a) {
    const parts = [
      a.province ?? a.state,
      a.city,
      a.borough ?? a.city_district ?? a.county,
      a.quarter ?? a.suburb,
      a.road,
      a.house_number,
    ].filter((v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i);
    if (parts.length >= 2) return parts.join(' ');
  }
  return p.display_name
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== '대한민국' && !/^\d{5}$/.test(s))
    .reverse()
    .join(' ');
}
