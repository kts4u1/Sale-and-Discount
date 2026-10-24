import path from 'node:path';
import {
  addDays,
  distanceMeters,
  kstNow,
  normalizeDate,
  normalizeText,
  type CategoryId,
  type Deal,
  type LatLng,
  type PriceCompareGroup,
  type ReverseGeocodeResult,
  type Store,
} from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { TtlCache, diskCached, readJson, writeJsonAtomic } from '../lib/cache.ts';
import { categoryFromText, detectBrand } from '../lib/category.ts';
import { fetchText, mapLimit } from '../lib/http.ts';
import { parseOpenApiItems } from '../lib/xml.ts';

/**
 * 한국소비자원 참가격 (생필품 가격 정보) - 공공데이터포털
 * https://www.data.go.kr/data/15158701/openapi.do
 * 전국 대형마트·SSM·백화점·편의점·전통시장의 생필품 가격을 매주 금요일 기준으로 조사.
 * 각 가격에 할인 여부(goodDcYn), 할인 기간, 1+1 여부(plusoneYn)가 들어 있다.
 */

export interface KcaStoreRaw {
  entpId: string;
  entpName: string;
  entpTypeCode?: string;
  entpAreaCode?: string;
  areaDetailCode?: string;
  entpTelno?: string;
  postNo?: string;
  plmkAddrBasic?: string;
  plmkAddrDetail?: string;
  roadAddrBasic?: string;
  roadAddrDetail?: string;
  xMapCoord?: string;
  yMapCoord?: string;
}

export interface KcaProductRaw {
  goodId: string;
  goodName: string;
  productEntpCode?: string;
  goodUnitDivCode?: string;
  goodBaseCnt?: string;
  goodSmlclsCode?: string;
  goodTotalCnt?: string;
  goodTotalDivCode?: string;
  detailMean?: string;
  datailMean?: string;
}

export interface KcaPriceRaw {
  goodInspectDay?: string;
  entpId: string;
  goodId: string;
  goodPrice: string;
  plusoneYn?: string;
  goodDcYn?: string;
  goodDcStartDay?: string;
  goodDcEndDay?: string;
  inputDttm?: string;
}

export interface KcaStore extends Store {
  entpId: string;
  /** 좌표를 아직 모르면 undefined */
  located: boolean;
  typeLabel: string;
}

export interface KcaPrice {
  entpId: string;
  goodId: string;
  price: number;
  onePlusOne: boolean;
  discount: boolean;
  dcStart?: string;
  dcEnd?: string;
  inspectDay: string;
  inputAt?: string;
}

export interface KcaProduct {
  goodId: string;
  name: string;
  unit?: string;
}

/** 업태 코드 → 이름 (참가격 사이트 기준, 모르는 코드는 매장명으로 추정) */
const ENTP_TYPE: Record<string, { label: string; category: CategoryId }> = {
  LM: { label: '대형마트', category: 'mart' },
  SM: { label: '슈퍼마켓(SSM)', category: 'mart' },
  DP: { label: '백화점', category: 'mart' },
  TM: { label: '전통시장', category: 'fresh' },
  CS: { label: '편의점', category: 'convenience' },
};

const UNIT_LABELS: Record<string, string> = {
  G: 'g',
  KG: 'kg',
  ML: 'ml',
  L: 'L',
  EA: '개',
  M: 'm',
};

/** 좌표가 경위도(WGS84)인지 확인하고, 아니면 undefined (주소로 다시 찾는다) */
export function parseKcaCoords(x?: string, y?: string): LatLng | undefined {
  const xv = Number(x);
  const yv = Number(y);
  if (!Number.isFinite(xv) || !Number.isFinite(yv) || xv === 0 || yv === 0) return undefined;
  const isLng = (v: number) => v > 124 && v < 132.5;
  const isLat = (v: number) => v > 33 && v < 39.5;
  if (isLng(xv) && isLat(yv)) return { lat: yv, lng: xv };
  if (isLng(yv) && isLat(xv)) return { lat: xv, lng: yv };
  return undefined;
}

export function toKcaStore(raw: KcaStoreRaw): KcaStore {
  const coords = parseKcaCoords(raw.xMapCoord, raw.yMapCoord);
  const type = raw.entpTypeCode ? ENTP_TYPE[raw.entpTypeCode] : undefined;
  const brand = detectBrand(raw.entpName);
  const address = [raw.plmkAddrBasic, raw.plmkAddrDetail].filter(Boolean).join(' ') || undefined;
  const roadAddress = [raw.roadAddrBasic, raw.roadAddrDetail].filter(Boolean).join(' ') || undefined;
  return {
    id: `kca:${raw.entpId}`,
    entpId: raw.entpId,
    name: raw.entpName,
    category: brand?.category ?? type?.category ?? categoryFromText(raw.entpName) ?? 'mart',
    categoryDetail: `참가격 조사매장${type ? ` > ${type.label}` : ''}`,
    typeLabel: type?.label ?? '',
    brand: brand?.brand,
    lat: coords?.lat ?? 0,
    lng: coords?.lng ?? 0,
    located: Boolean(coords),
    address,
    roadAddress,
    phone: raw.entpTelno || undefined,
    sources: ['kca'],
  };
}

export function toKcaProduct(raw: KcaProductRaw): KcaProduct {
  const cnt = raw.goodTotalCnt?.trim();
  const div = raw.goodTotalDivCode?.trim().toUpperCase();
  const unit = cnt && div && UNIT_LABELS[div] ? `${cnt}${UNIT_LABELS[div]}` : undefined;
  return { goodId: raw.goodId, name: raw.goodName.trim(), unit };
}

export function toKcaPrice(raw: KcaPriceRaw, inspectDay: string): KcaPrice | undefined {
  const price = Number(String(raw.goodPrice).replace(/[^\d.]/g, ''));
  if (!raw.goodId || !Number.isFinite(price) || price <= 0) return undefined;
  const discount = raw.goodDcYn === 'Y';
  return {
    entpId: raw.entpId,
    goodId: raw.goodId,
    price,
    onePlusOne: raw.plusoneYn === 'Y',
    discount,
    dcStart: discount ? normalizeDate(raw.goodDcStartDay) : undefined,
    dcEnd: discount ? normalizeDate(raw.goodDcEndDay) : undefined,
    inspectDay: normalizeDate(raw.goodInspectDay) ?? inspectDay,
    inputAt: raw.inputDttm,
  };
}

/** 오늘(포함) 이전의 금요일 n 개를 최신순으로 (YYYY-MM-DD) */
export function recentFridays(count: number, today = kstNow().date): string[] {
  const weekday = new Date(`${today}T00:00:00Z`).getUTCDay();
  const back = (weekday - 5 + 7) % 7;
  const latest = addDays(today, -back);
  return Array.from({ length: count }, (_, i) => addDays(latest, -7 * i));
}

export type KcaCompareGroup = Omit<PriceCompareGroup, 'entries'> & {
  entries: { store: KcaStore & { distance: number }; price: KcaPrice }[];
};

export interface Geocoder {
  addressToLatLng(address: string): Promise<LatLng | null>;
  reverse(center: LatLng): Promise<ReverseGeocodeResult>;
  /** 대량 변환이 가능한지 (카카오: 가능, Nominatim: 초당 1회라 불가) */
  bulk: boolean;
}

export interface KcaNearby {
  stores: (KcaStore & { distance: number })[];
  pendingGeocode: number;
}

export class KcaSource {
  private stores?: Promise<KcaStore[]>;
  private products?: Promise<Map<string, KcaProduct>>;
  private priceCache = new TtlCache<KcaPrice[]>(12 * 3_600_000, 3000);
  private latestDay = new TtlCache<string>(6 * 3_600_000, 1);
  private geocodeFile: string;
  private geocoded?: Promise<Record<string, LatLng | null>>;
  private geocodingRegions = new Set<string>();

  constructor(
    private readonly config: AppConfigEnv,
    private readonly geocoder?: Geocoder,
  ) {
    this.geocodeFile = path.join(config.dataDir, 'cache', 'kca-geocode.json');
  }

  get enabled(): boolean {
    return Boolean(this.config.dataGoKrKey);
  }

  private serviceKey(): string {
    const key = this.config.dataGoKrKey ?? '';
    // 포털의 "Encoding" 키를 넣어도 동작하도록 한 번 풀어 준다
    try {
      return key.includes('%') ? decodeURIComponent(key) : key;
    } catch {
      return key;
    }
  }

  private async call(
    op: string,
    params: Record<string, string>,
    keyParam = 'ServiceKey',
  ): Promise<Record<string, string>[]> {
    const qs = new URLSearchParams({ [keyParam]: this.serviceKey(), ...params });
    const xml = await fetchText(`${this.config.kcaBaseUrl}/${op}?${qs}`, { timeoutMs: 15_000 });
    return parseOpenApiItems(xml);
  }

  /* ------------------------------ 기준 데이터 ------------------------------ */

  async allStores(): Promise<KcaStore[]> {
    this.stores ??= (async () => {
      const raw = await diskCached(path.join(this.config.dataDir, 'cache', 'kca-stores.json'), 3 * 86_400_000, () =>
        this.call('getStoreInfoSvc.do', {}),
      );
      const geocoded = await this.loadGeocoded();
      return (raw as unknown as KcaStoreRaw[])
        .filter((r) => r.entpId && r.entpName)
        .map((r) => {
          const store = toKcaStore(r);
          const fixed = geocoded[store.entpId];
          if (!store.located && fixed) Object.assign(store, { lat: fixed.lat, lng: fixed.lng, located: true });
          return store;
        });
    })().catch((err) => {
      this.stores = undefined; // 다음 요청에서 다시 시도
      throw err;
    });
    return this.stores;
  }

  async allProducts(): Promise<Map<string, KcaProduct>> {
    this.products ??= (async () => {
      const raw = await diskCached(path.join(this.config.dataDir, 'cache', 'kca-products.json'), 7 * 86_400_000, () =>
        this.call('getProductInfoSvc.do', {}),
      );
      return new Map(
        (raw as unknown as KcaProductRaw[])
          .filter((r) => r.goodId && r.goodName)
          .map((r) => [r.goodId, toKcaProduct(r)]),
      );
    })().catch((err) => {
      this.products = undefined;
      throw err;
    });
    return this.products;
  }

  async storePrices(entpId: string, inspectDay: string): Promise<KcaPrice[]> {
    return this.priceCache.getOrLoad(`${entpId}:${inspectDay}`, async () => {
      const items = await this.call(
        'getProductPriceInfoSvc',
        { goodInspectDay: inspectDay.replaceAll('-', ''), entpId },
        'serviceKey',
      );
      return (items as unknown as KcaPriceRaw[])
        .map((r) => toKcaPrice(r, inspectDay))
        .filter((p): p is KcaPrice => Boolean(p));
    });
  }

  /** 데이터가 올라온 가장 최근 조사일(금요일)을 찾는다 */
  async latestInspectDay(probeEntpIds: string[]): Promise<string | undefined> {
    const cached = this.latestDay.get('latest');
    if (cached) return cached;
    for (const day of recentFridays(5)) {
      for (const entpId of probeEntpIds.slice(0, 3)) {
        const prices = await this.storePrices(entpId, day).catch(() => []);
        if (prices.length > 0) {
          this.latestDay.set('latest', day);
          return day;
        }
      }
    }
    return undefined;
  }

  /* ------------------------------- 좌표 보정 ------------------------------- */

  private loadGeocoded(): Promise<Record<string, LatLng | null>> {
    this.geocoded ??= readJson<Record<string, LatLng | null>>(this.geocodeFile).then((v) => v ?? {});
    return this.geocoded;
  }

  private saveTimer?: NodeJS.Timeout;
  private scheduleSave(map: Record<string, LatLng | null>) {
    clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      writeJsonAtomic(this.geocodeFile, map).catch((err) => console.warn('[kca] 좌표 캐시 저장 실패', err));
    }, 2000);
    this.saveTimer.unref?.();
  }

  private async geocodeStores(stores: KcaStore[], budgetMs: number): Promise<void> {
    if (!this.geocoder || stores.length === 0) return;
    const map = await this.loadGeocoded();
    const todo = stores.filter((s) => !s.located && !(s.entpId in map));
    if (todo.length === 0) return;
    const deadline = Date.now() + budgetMs;
    await mapLimit(todo, this.geocoder.bulk ? 4 : 1, async (store) => {
      if (Date.now() > deadline) return;
      const address = store.roadAddress ?? store.address;
      if (!address) {
        map[store.entpId] = null;
        return;
      }
      try {
        const pos = await this.geocoder!.addressToLatLng(address);
        map[store.entpId] = pos;
        if (pos) Object.assign(store, { lat: pos.lat, lng: pos.lng, located: true });
      } catch {
        // 일시적인 오류는 다음에 다시 시도
      }
    });
    this.scheduleSave(map);
  }

  /**
   * 좌표가 없는 매장은 사용자의 시/군/구와 같은 주소만 골라 주소→좌표 변환을 한다.
   * 같은 시/도 전체는 백그라운드에서 천천히 채운다.
   */
  private async ensureLocated(all: KcaStore[], center: LatLng): Promise<number> {
    const unlocated = all.filter((s) => !s.located);
    if (unlocated.length === 0 || !this.geocoder) return 0;
    const region = await this.geocoder.reverse(center).catch(() => undefined);
    if (!region?.region2) return unlocated.length;
    const aliases = regionAliases(region.region1);
    const r2 = region.region2.split(' ')[0];
    const addrOf = (s: KcaStore) => `${s.roadAddress ?? ''} ${s.address ?? ''}`;
    const inRegion1 = (s: KcaStore) => aliases.length === 0 || aliases.some((a) => addrOf(s).includes(a));
    const inRegion = (s: KcaStore) => addrOf(s).includes(r2) && inRegion1(s);
    const local = unlocated.filter(inRegion);
    await this.geocodeStores(local, this.geocoder.bulk ? 8000 : 4000);

    const regionKey = region.region1 ?? '';
    if (this.geocoder.bulk && regionKey && aliases.length > 0 && !this.geocodingRegions.has(regionKey)) {
      this.geocodingRegions.add(regionKey);
      const wide = unlocated.filter(inRegion1);
      void this.geocodeStores(wide, 10 * 60_000);
    }
    return local.filter((s) => !s.located).length;
  }

  /* -------------------------------- 조회 -------------------------------- */

  async nearbyStores(center: LatLng, radius: number): Promise<KcaNearby> {
    const all = await this.allStores();
    const pendingGeocode = await this.ensureLocated(all, center);
    const stores = all
      .filter((s) => s.located)
      .map((s) => ({ ...s, distance: distanceMeters(center, s) }))
      .filter((s) => s.distance <= radius)
      .sort((a, b) => a.distance - b.distance)
      .slice(0, this.config.kcaMaxStores);
    return { stores, pendingGeocode };
  }

  private async pricesFor(stores: KcaStore[]): Promise<{ day?: string; byStore: Map<string, KcaPrice[]> }> {
    const byStore = new Map<string, KcaPrice[]>();
    if (stores.length === 0) return { byStore };
    const day = await this.latestInspectDay(stores.map((s) => s.entpId));
    if (!day) return { byStore };
    const previous = addDays(day, -7);
    await mapLimit(stores, 4, async (store) => {
      let prices = await this.storePrices(store.entpId, day).catch(() => []);
      if (prices.length === 0) prices = await this.storePrices(store.entpId, previous).catch(() => []);
      byStore.set(store.entpId, prices);
    });
    return { day, byStore };
  }

  async deals(
    center: LatLng,
    radius: number,
  ): Promise<{ deals: Deal[]; stores: KcaNearby['stores']; inspectDay?: string; pendingGeocode: number }> {
    const [{ stores, pendingGeocode }, products] = await Promise.all([
      this.nearbyStores(center, radius),
      this.allProducts(),
    ]);
    const { day, byStore } = await this.pricesFor(stores);

    // 같은 상품의 주변 가격 통계
    const stats = new Map<string, { sum: number; min: number; max: number; n: number }>();
    for (const prices of byStore.values()) {
      for (const p of prices) {
        const s = stats.get(p.goodId) ?? { sum: 0, min: Infinity, max: 0, n: 0 };
        s.sum += p.price;
        s.min = Math.min(s.min, p.price);
        s.max = Math.max(s.max, p.price);
        s.n += 1;
        stats.set(p.goodId, s);
      }
    }

    // 할인 상품은 지난주 가격을 정가로 본다 (지난주에 할인이 아니었을 때만)
    const prevPrice = new Map<string, number>();
    if (day) {
      const prevDay = addDays(day, -7);
      const withDiscount = stores.filter((s) => byStore.get(s.entpId)?.some((p) => p.discount && p.inspectDay === day));
      await mapLimit(withDiscount, 4, async (store) => {
        const prev = await this.storePrices(store.entpId, prevDay).catch(() => []);
        for (const p of prev) if (!p.discount && !p.onePlusOne) prevPrice.set(`${store.entpId}:${p.goodId}`, p.price);
      });
    }

    const deals: Deal[] = [];
    const storeById = new Map(stores.map((s) => [s.entpId, s]));
    for (const [entpId, prices] of byStore) {
      const store = storeById.get(entpId)!;
      for (const p of prices) {
        if (!p.discount && !p.onePlusOne) continue;
        const product = products.get(p.goodId);
        const name = product?.name ?? `상품 ${p.goodId}`;
        const st = stats.get(p.goodId);
        const original = prevPrice.get(`${entpId}:${p.goodId}`);
        const createdAt = parseInputDate(p.inputAt) ?? `${p.inspectDay}T00:00:00+09:00`;
        deals.push({
          id: `kca:${entpId}:${p.goodId}`,
          storeId: store.id,
          title: p.onePlusOne ? `${name} 1+1` : `${name} 할인`,
          productName: name,
          description: `한국소비자원 참가격 ${p.inspectDay} 조사 기준 가격입니다. 매장 사정에 따라 달라질 수 있어요.`,
          type: p.onePlusOne ? 'one_plus_one' : 'discount',
          category: store.category,
          salePrice: p.price,
          originalPrice: original && original > p.price ? original : undefined,
          unit: product?.unit,
          startDate: p.dcStart,
          endDate: p.dcEnd,
          tags: ['참가격', store.typeLabel].filter(Boolean),
          source: 'kca',
          sourceUrl: 'https://www.price.go.kr',
          priceCompare:
            st && st.n >= 2
              ? { avg: Math.round(st.sum / st.n), min: st.min, max: st.max, storeCount: st.n }
              : undefined,
          createdAt,
          updatedAt: createdAt,
          likes: 0,
          confirms: 0,
          expiredReports: 0,
        });
      }
    }
    return { deals, stores, inspectDay: day, pendingGeocode };
  }

  /** 검색어와 맞는 상품의 주변 매장 가격 비교 */
  async compare(
    center: LatLng,
    radius: number,
    q: string,
  ): Promise<{ groups: KcaCompareGroup[]; inspectDay?: string }> {
    const needle = normalizeText(q);
    const [{ stores }, products] = await Promise.all([this.nearbyStores(center, radius), this.allProducts()]);
    const matched = [...products.values()].filter((p) => normalizeText(p.name).includes(needle));
    if (matched.length === 0 || stores.length === 0) return { groups: [] };
    const { day, byStore } = await this.pricesFor(stores);
    const ids = new Set(matched.map((p) => p.goodId));
    const groups = new Map<string, { store: KcaStore & { distance: number }; price: KcaPrice }[]>();
    for (const store of stores) {
      for (const price of byStore.get(store.entpId) ?? []) {
        if (!ids.has(price.goodId)) continue;
        const list = groups.get(price.goodId) ?? [];
        list.push({ store, price });
        groups.set(price.goodId, list);
      }
    }
    const result = [...groups.entries()].map(([goodId, entries]) => {
      const product = products.get(goodId)!;
      const prices = entries.map((e) => e.price.price);
      entries.sort((a, b) => a.price.price - b.price.price || a.store.distance - b.store.distance);
      return {
        productId: goodId,
        productName: product.name,
        unit: product.unit,
        entries,
        min: Math.min(...prices),
        max: Math.max(...prices),
        avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
      };
    });
    result.sort((a, b) => b.entries.length - a.entries.length || a.productName.localeCompare(b.productName, 'ko'));
    return { groups: result.slice(0, 30), inspectDay: day };
  }
}

const PROVINCE_ABBR: Record<string, string> = {
  경상북도: '경북',
  경상남도: '경남',
  전라북도: '전북',
  전북특별자치도: '전북',
  전라남도: '전남',
  충청북도: '충북',
  충청남도: '충남',
};

/** "서울특별시" → ["서울특별시", "서울"], "경상북도" → ["경상북도", "경북"] */
export function regionAliases(region1: string | undefined): string[] {
  if (!region1) return [];
  const short = region1
    .replace(/특별자치시|특별자치도|특별시|광역시/, '')
    .replace(/도$/, '')
    .trim();
  return [...new Set([region1, short, PROVINCE_ABBR[region1]].filter((v): v is string => Boolean(v && v.length >= 2)))];
}

/** "20240105123000" / "2024-01-05 12:30:00" → ISO */
function parseInputDate(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const d = value.replace(/\D/g, '');
  if (d.length < 8) return undefined;
  const date = normalizeDate(d.slice(0, 8));
  if (!date) return undefined;
  const hh = d.slice(8, 10) || '00';
  const mm = d.slice(10, 12) || '00';
  return `${date}T${hh}:${mm}:00+09:00`;
}
