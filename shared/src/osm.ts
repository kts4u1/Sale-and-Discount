import { categoryFromOsm, detectBrand, osmCategoryDetail } from './category.ts';
import { LIVE_STORE_RADIUS } from './constants.ts';
import type { LatLng, Store } from './types.ts';
import { safeHttpUrl } from './url.ts';

/**
 * OpenStreetMap(Overpass API) 매장 정보. 서버와 브라우저(GitHub Pages)가 함께 쓴다.
 */

export interface OverpassElement {
  type: 'node' | 'way' | 'relation';
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export const DEFAULT_OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.private.coffee/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
];

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

export function tilesForCircle(center: LatLng, radius: number, tileDeg = TILE_DEG): { lat: number; lng: number }[] {
  const dLat = radius / 111_320;
  const dLng = radius / (111_320 * Math.cos((center.lat * Math.PI) / 180));
  const y0 = Math.floor((center.lat - dLat) / tileDeg);
  const y1 = Math.floor((center.lat + dLat) / tileDeg);
  const x0 = Math.floor((center.lng - dLng) / tileDeg);
  const x1 = Math.floor((center.lng + dLng) / tileDeg);
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

export interface OverpassLoaderOptions {
  endpoints: string[];
  /** 새로 받기 시작한 칸을 기다리는 최대 시간 */
  budgetMs?: number;
  /** 한 서버에 보내는 요청의 시간 제한 */
  requestTimeoutMs?: number;
  /** 요청에 붙일 헤더 (서버: User-Agent) */
  headers?: Record<string, string>;
  /** 칸 하나를 영구 보관소(디스크·브라우저 저장소)에서 읽거나, 없으면 받아서 넣는다 */
  persist?: (key: string, load: () => Promise<Store[]>) => Promise<Store[]>;
  onWarn?: (message: string) => void;
}

const TILE_MEMORY_TTL = 60 * 60_000;
const TILE_RETRY_MS = 2 * 60_000;
const ENDPOINT_COOLDOWN_MS = 5 * 60_000;

/**
 * 격자 칸 단위로 Overpass 에서 매장을 받는다.
 * - 정해진 시간 안에 못 받은 칸은 뒤에서 계속 받고 pending 으로 알린다 (다음 검색 때 바로 나온다)
 * - 실패한 칸은 잠시 다시 묻지 않고, 실패한 서버는 잠시 뒤로 미룬다
 * - Overpass 는 동시 요청을 적게 받아서 2개씩만 보낸다
 */
export class OverpassStoreLoader {
  private tiles = new Map<string, { stores: Store[]; at: number }>();
  private inflight = new Map<string, Promise<Store[]>>();
  private failedAt = new Map<string, number>();
  private startedAt = new Map<string, number>();
  private endpointFailedAt = new Map<string, number>();
  private preferred = 0;
  private active = 0;
  private waiting: (() => void)[] = [];

  constructor(private readonly options: OverpassLoaderOptions) {}

  async nearbyStores(center: LatLng, radius: number): Promise<{ stores: Store[]; pending: boolean; failed: number }> {
    const budget = this.options.budgetMs ?? 7000;
    // 넓은 반경은 칸이 너무 많아져서 가까운 1km 까지만 실시간으로 묻는다 (체인 매장은 미리 받아 둔 자료로 채움)
    const tiles = tilesForCircle(center, Math.min(radius, LIVE_STORE_RADIUS));
    const done = new Map<string, Store[]>();
    let failed = 0;
    let deadline = 0;
    const now = Date.now();
    const tasks = tiles.map((t) => {
      const key = `${t.lat}:${t.lng}`;
      const cached = this.tiles.get(key);
      if (cached && now - cached.at < TILE_MEMORY_TTL) {
        done.set(key, cached.stores);
        return Promise.resolve();
      }
      const failedAt = this.failedAt.get(key);
      if (failedAt !== undefined && now - failedAt < TILE_RETRY_MS) {
        failed++;
        return Promise.resolve();
      }
      if (!this.startedAt.has(key)) this.startedAt.set(key, now);
      deadline = Math.max(deadline, this.startedAt.get(key)! + budget);
      let p = this.inflight.get(key);
      if (!p) {
        const load = () => this.limited(() => this.fetchTile(t));
        p = (this.options.persist ? this.options.persist(key, load) : load()).finally(() => {
          this.inflight.delete(key);
          this.startedAt.delete(key);
        });
        this.inflight.set(key, p);
      }
      return p
        .then((stores) => {
          this.tiles.set(key, { stores, at: Date.now() });
          this.failedAt.delete(key);
          done.set(key, stores);
        })
        .catch((err) => {
          failed++;
          this.failedAt.set(key, Date.now());
          this.options.onWarn?.(`격자 ${key} 실패: ${(err as Error).message}`);
        });
    });
    // 새로 시작한 칸은 budget 까지, 이전 검색에서 이미 받는 중인 칸은 남은 시간만큼만 기다린다
    const wait = Math.max(300, deadline - Date.now());
    let timer: ReturnType<typeof setTimeout> | undefined;
    await Promise.race([Promise.all(tasks), new Promise((r) => (timer = setTimeout(r, wait)))]);
    clearTimeout(timer);
    if (failed > 0 && failed === tiles.length) throw new Error('OpenStreetMap(Overpass) 서버에 연결하지 못했습니다');
    return { stores: [...done.values()].flat(), pending: done.size + failed < tiles.length, failed };
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

  private coolingDown(endpoint: string, now: number): boolean {
    const at = this.endpointFailedAt.get(endpoint);
    return at !== undefined && now - at < ENDPOINT_COOLDOWN_MS;
  }

  private async fetchTile(tile: { lat: number; lng: number }): Promise<Store[]> {
    const query = buildTileQuery(tile);
    const endpoints = this.options.endpoints;
    const now = Date.now();
    const order = endpoints
      .map((_, i) => (this.preferred + i) % endpoints.length)
      .sort((a, b) => Number(this.coolingDown(endpoints[a], now)) - Number(this.coolingDown(endpoints[b], now)));
    let lastError: unknown;
    // 한 칸당 최대 두 서버까지만 시도
    for (const idx of order.slice(0, 2)) {
      try {
        const res = await fetch(endpoints[idx], {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...this.options.headers },
          body: new URLSearchParams({ data: query }).toString(),
          signal: AbortSignal.timeout(this.options.requestTimeoutMs ?? 25_000),
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
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
}
