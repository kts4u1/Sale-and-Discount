import path from 'node:path';
import type { LatLng, Store } from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { TtlCache, diskCached } from '../lib/cache.ts';
import { categoryFromOsm, detectBrand, osmCategoryDetail } from '../lib/category.ts';
import { fetchWithTimeout } from '../lib/http.ts';
import { safeHttpUrl } from '../lib/url.ts';

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

const AMENITIES = 'restaurant|fast_food|food_court|cafe|ice_cream|bar|pub|pharmacy|marketplace';

function joinAddress(tags: Record<string, string>): string | undefined {
  if (tags['addr:full']) return tags['addr:full'];
  const parts = [
    tags['addr:province'],
    tags['addr:city'],
    tags['addr:district'],
    tags['addr:suburb'],
    tags['addr:street'],
    tags['addr:housenumber'],
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : undefined;
}

export function parseOverpassElements(elements: OverpassElement[]): Store[] {
  const stores: Store[] = [];
  for (const el of elements) {
    const tags = el.tags ?? {};
    const lat = el.lat ?? el.center?.lat;
    const lng = el.lon ?? el.center?.lon;
    const name = tags['name:ko'] ?? tags.name;
    if (lat === undefined || lng === undefined || !name) continue;
    const category = categoryFromOsm(tags);
    if (!category) continue;
    const brand = tags['brand:ko'] ?? tags.brand ?? detectBrand(name)?.brand;
    const branch = tags.branch ?? tags['branch:ko'];
    stores.push({
      id: `osm:${el.type}/${el.id}`,
      name: branch && !name.includes(branch) ? `${name} ${branch}` : name,
      category,
      categoryDetail: osmCategoryDetail(tags),
      brand: detectBrand(brand)?.brand ?? brand,
      lat,
      lng,
      address: joinAddress(tags),
      phone: tags.phone ?? tags['contact:phone'],
      url: safeHttpUrl(tags.website ?? tags['contact:website']),
      openingHours: tags.opening_hours,
      sources: ['osm'],
    });
  }
  return stores;
}

/** 지도를 0.01° 격자(약 1.1km x 0.9km)로 나눠 칸마다 따로 받아 캐시한다 */
export const TILE_DEG = 0.01;

export function tilesForCircle(center: LatLng, radius: number): { lat: number; lng: number }[] {
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const y0 = Math.floor((center.lat - dLat) / TILE_DEG);
  const y1 = Math.floor((center.lat + dLat) / TILE_DEG);
  const x0 = Math.floor((center.lng - dLng) / TILE_DEG);
  const x1 = Math.floor((center.lng + dLng) / TILE_DEG);
  const tiles: { lat: number; lng: number }[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) tiles.push({ lat: y, lng: x });
  return tiles;
}

export function buildTileQuery(tile: { lat: number; lng: number }): string {
  const s = tile.lat * TILE_DEG;
  const w = tile.lng * TILE_DEG;
  const bbox = [s, w, s + TILE_DEG, w + TILE_DEG].map((v) => v.toFixed(5)).join(',');
  return `[out:json][timeout:40][bbox:${bbox}];(nw[shop][name];nw[amenity~"^(${AMENITIES})$"][name];);out center tags qt;`;
}

const TILE_DISK_TTL = 3 * 86_400_000;
const TILE_RETRY_MS = 2 * 60_000;
const ENDPOINT_COOLDOWN_MS = 5 * 60_000;

export class OsmSource {
  private tiles = new TtlCache<Store[]>(60 * 60_000, 2000);
  /** 실패한 칸은 잠시 다시 묻지 않는다 */
  private failedTiles = new TtlCache<true>(TILE_RETRY_MS, 2000);
  /** 실패한 서버는 잠시 뒤로 미룬다 */
  private endpointFailedAt = new Map<string, number>();
  /** 칸별 불러오기 시작 시각 (이미 오래 기다린 칸은 또 기다리지 않는다) */
  private startedAt = new Map<string, number>();
  /** 마지막으로 성공한 엔드포인트를 먼저 쓴다 */
  private preferred = 0;
  /** Overpass 는 IP 당 동시 요청 수가 적어서 2개씩만 보낸다 */
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(
    private readonly config: AppConfigEnv,
    private readonly budgetMs = 7000,
  ) {}

  get enabled(): boolean {
    return this.config.enableOsm && this.config.overpassEndpoints.length > 0;
  }

  /**
   * 반경을 덮는 격자 칸들의 매장을 모은다. budgetMs 안에 못 받은 칸은 뒤에서 계속 받고
   * pending=true 로 알려준다 (다음 검색 때 캐시에서 바로 나온다).
   */
  async nearbyStores(center: LatLng, radius: number): Promise<{ stores: Store[]; pending: boolean; failed: number }> {
    const tiles = tilesForCircle(center, radius);
    const done = new Map<string, Store[]>();
    let failed = 0;
    let deadline = 0;
    const tasks = tiles.map((t) => {
      const key = `${t.lat}:${t.lng}`;
      const cached = this.tiles.get(key);
      if (cached) {
        done.set(key, cached);
        return Promise.resolve();
      }
      if (this.failedTiles.has(key)) {
        failed++;
        return Promise.resolve();
      }
      const file = path.join(this.config.dataDir, 'cache', 'osm', `${key.replace(':', '_')}.json`);
      if (!this.startedAt.has(key)) this.startedAt.set(key, Date.now());
      deadline = Math.max(deadline, this.startedAt.get(key)! + this.budgetMs);
      return this.tiles
        .getOrLoad(key, () => diskCached(file, TILE_DISK_TTL, () => this.limited(() => this.fetchTile(t))))
        .then((stores) => void done.set(key, stores))
        .catch((err) => {
          failed++;
          this.failedTiles.set(key, true);
          console.warn(`[osm] 격자 ${key} 실패:`, (err as Error).message);
        })
        .finally(() => this.startedAt.delete(key));
    });
    // 새로 시작한 칸은 budgetMs 까지, 이전 요청에서 이미 받는 중인 칸은 남은 시간만큼만 기다린다
    const wait = Math.max(300, deadline - Date.now());
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([Promise.all(tasks), new Promise((r) => (timer = setTimeout(r, wait)))]);
    clearTimeout(timer);
    if (failed > 0 && failed === tiles.length) throw new Error('OpenStreetMap(Overpass) 서버에 연결하지 못했습니다');
    const stores = [...done.values()].flat();
    return { stores, pending: done.size + failed < tiles.length, failed };
  }

  private async limited<T>(fn: () => Promise<T>): Promise<T> {
    while (this.active >= 2) await new Promise<void>((r) => this.waiting.push(r));
    this.active++;
    try {
      return await fn();
    } finally {
      this.active--;
      this.waiting.shift()?.();
    }
  }

  private async fetchTile(tile: { lat: number; lng: number }): Promise<Store[]> {
    const query = buildTileQuery(tile);
    const endpoints = this.config.overpassEndpoints;
    const now = Date.now();
    const order = endpoints
      .map((_, i) => (this.preferred + i) % endpoints.length)
      .sort((a, b) => Number(this.coolingDown(endpoints[a], now)) - Number(this.coolingDown(endpoints[b], now)));
    let lastError: unknown;
    // 한 칸당 최대 두 서버까지만 시도
    for (const idx of order.slice(0, 2)) {
      try {
        const res = await fetchWithTimeout(endpoints[idx], {
          method: 'POST',
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            'User-Agent': this.config.userAgent,
          },
          body: new URLSearchParams({ data: query }).toString(),
          timeoutMs: 25_000,
        });
        const json = (await res.json()) as { elements?: OverpassElement[] };
        this.preferred = idx;
        this.endpointFailedAt.delete(endpoints[idx]);
        return parseOverpassElements(json.elements ?? []);
      } catch (err) {
        lastError = err;
        this.endpointFailedAt.set(endpoints[idx], Date.now());
      }
    }
    throw lastError instanceof Error ? lastError : new Error('Overpass API 호출 실패');
  }

  private coolingDown(endpoint: string, now: number): boolean {
    const at = this.endpointFailedAt.get(endpoint);
    return at !== undefined && now - at < ENDPOINT_COOLDOWN_MS;
  }
}
