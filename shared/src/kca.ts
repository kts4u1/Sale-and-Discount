import { distanceMeters, normalizeText, walkMinutes } from './deal-utils.ts';
import { tilesForCircle } from './osm.ts';
import type { CategoryId, Deal, LatLng, PriceCompareGroup, Store, StoreWithDistance } from './types.ts';

/**
 * 한국소비자원 참가격 "하루 한 번 받아 둔 자료"(스냅샷)의 형식과 계산.
 *
 * 매일 GitHub Actions(또는 서버의 예약 작업)가 `npm run data:update` 로 전국 자료를 받아
 * 아래 파일을 만든다. 앱은 이 파일만 읽으므로 검색할 때마다 API 를 부르지 않는다.
 *
 *   data/kca/manifest.json      갱신 시각, 조사일, 건수, 격자 목록, 파일별 해시
 *   data/kca/products.json      상품 id → [상품명, 용량]
 *   data/kca/t/{격자}.json      약 2km 격자마다 판매점과 그 매장의 상품 가격
 */

export const KCA_SNAPSHOT_VERSION = 1;
/** 격자 크기 0.02° (약 2.2km x 1.8km) */
export const KCA_TILE_DEG = 0.02;

export const KCA_FLAG_DISCOUNT = 1;
export const KCA_FLAG_ONE_PLUS_ONE = 2;

/** [상품id, 가격, 표시(1=할인, 2=1+1), 할인 시작일, 할인 종료일, 지난주 정상가] */
export type KcaPriceTuple = [string, number, number, (string | null)?, (string | null)?, (number | null)?];

export interface KcaSnapshotStore {
  /** 참가격 업체 id */
  id: string;
  name: string;
  category: CategoryId;
  /** 대형마트, 편의점 등 */
  typeLabel?: string;
  brand?: string;
  lat: number;
  lng: number;
  address?: string;
  roadAddress?: string;
  phone?: string;
  prices: KcaPriceTuple[];
}

export interface KcaTileFile {
  tile: string;
  stores: KcaSnapshotStore[];
}

/** 상품 id → [상품명, 용량] */
export type KcaProductsFile = Record<string, [string, string?]>;

export interface KcaManifest {
  version: typeof KCA_SNAPSHOT_VERSION;
  /** 자료를 받은 시각 (ISO) */
  updatedAt: string;
  /** 참가격 조사일 (매주 금요일, YYYY-MM-DD) */
  inspectDay: string;
  /** 정상가 비교에 쓴 지난 조사일 */
  prevInspectDay?: string;
  source: string;
  totals: {
    stores: number;
    /** 좌표를 알아 지도에 올린 매장 */
    located: number;
    products: number;
    prices: number;
    discounts: number;
    onePlusOne: number;
  };
  /** 격자 → 매장 수 */
  tiles: Record<string, number>;
  /** 파일 → 내용 해시 (주소의 ?v= 에 붙여 바뀐 파일만 새로 받게) */
  versions: Record<string, string>;
}

export const kcaTileKey = (lat: number, lng: number) =>
  `${Math.floor(lat / KCA_TILE_DEG)}_${Math.floor(lng / KCA_TILE_DEG)}`;

export const kcaTileFile = (key: string) => `t/${key}.json`;

/** 반경을 덮는 격자 중 자료가 있는 것 */
export function kcaTilesForCircle(manifest: Pick<KcaManifest, 'tiles'>, center: LatLng, radius: number): string[] {
  return tilesForCircle(center, radius, KCA_TILE_DEG)
    .map((t) => `${t.lat}_${t.lng}`)
    .filter((key) => manifest.tiles[key] !== undefined);
}

export function kcaStoreToStore(s: KcaSnapshotStore): Store {
  return {
    id: `kca:${s.id}`,
    name: s.name,
    category: s.category,
    categoryDetail: `참가격 조사매장${s.typeLabel ? ` > ${s.typeLabel}` : ''}`,
    brand: s.brand,
    lat: s.lat,
    lng: s.lng,
    address: s.address,
    roadAddress: s.roadAddress,
    phone: s.phone,
    sources: ['kca'],
  };
}

export interface KcaNearbyStore {
  store: StoreWithDistance;
  raw: KcaSnapshotStore;
}

/** 격자 파일들에서 반경 안의 매장 (가까운 순) */
export function kcaNearbyStores(tiles: KcaTileFile[], center: LatLng, radius: number): KcaNearbyStore[] {
  const seen = new Set<string>();
  const out: KcaNearbyStore[] = [];
  for (const tile of tiles) {
    for (const raw of tile.stores) {
      if (seen.has(raw.id)) continue;
      seen.add(raw.id);
      const distance = Math.round(distanceMeters(center, raw));
      if (distance > radius) continue;
      out.push({ store: { ...kcaStoreToStore(raw), distance, walkMinutes: walkMinutes(distance), dealCount: 0 }, raw });
    }
  }
  return out.sort((a, b) => a.store.distance - b.store.distance);
}

const productName = (products: KcaProductsFile, goodId: string) => products[goodId]?.[0] ?? `상품 ${goodId}`;
const productUnit = (products: KcaProductsFile, goodId: string) => products[goodId]?.[1] || undefined;

/** 반경 안 매장의 할인·1+1 상품을 행사로. 같은 상품의 주변 가격 통계도 붙인다. */
export function kcaDeals(nearby: KcaNearbyStore[], products: KcaProductsFile, inspectDay: string): Deal[] {
  const stats = new Map<string, { sum: number; min: number; max: number; n: number }>();
  for (const { raw } of nearby) {
    for (const [goodId, price] of raw.prices) {
      const s = stats.get(goodId) ?? { sum: 0, min: Infinity, max: 0, n: 0 };
      s.sum += price;
      s.min = Math.min(s.min, price);
      s.max = Math.max(s.max, price);
      s.n += 1;
      stats.set(goodId, s);
    }
  }

  const createdAt = `${inspectDay}T00:00:00+09:00`;
  const deals: Deal[] = [];
  for (const { store, raw } of nearby) {
    for (const [goodId, price, flags, dcStart, dcEnd, prevPrice] of raw.prices) {
      const discount = (flags & KCA_FLAG_DISCOUNT) !== 0;
      const onePlusOne = (flags & KCA_FLAG_ONE_PLUS_ONE) !== 0;
      if (!discount && !onePlusOne) continue;
      const name = productName(products, goodId);
      const st = stats.get(goodId);
      deals.push({
        id: `kca:${raw.id}:${goodId}`,
        storeId: store.id,
        title: onePlusOne ? `${name} 1+1` : `${name} 할인`,
        productName: name,
        description: `한국소비자원 참가격 ${inspectDay} 조사 기준 가격입니다. 매장 사정에 따라 달라질 수 있어요.`,
        type: onePlusOne ? 'one_plus_one' : 'discount',
        category: raw.category,
        salePrice: price,
        originalPrice: prevPrice && prevPrice > price ? prevPrice : undefined,
        unit: productUnit(products, goodId),
        // 할인 기간이 없으면(1+1 등) 조사일부터 확인된 행사로 본다
        startDate: dcStart ?? inspectDay,
        endDate: dcEnd ?? undefined,
        tags: ['참가격', raw.typeLabel].filter((v): v is string => Boolean(v)),
        source: 'kca',
        sourceUrl: 'https://www.price.go.kr',
        priceCompare:
          st && st.n >= 2 ? { avg: Math.round(st.sum / st.n), min: st.min, max: st.max, storeCount: st.n } : undefined,
        createdAt,
        updatedAt: createdAt,
        likes: 0,
        confirms: 0,
        expiredReports: 0,
      });
    }
  }
  return deals;
}

/** 검색어와 맞는 상품의 주변 매장 가격 비교 (싼 순) */
export function kcaCompare(
  nearby: KcaNearbyStore[],
  products: KcaProductsFile,
  q: string,
  inspectDay: string,
): PriceCompareGroup[] {
  const words = q.split(/\s+/).map(normalizeText).filter(Boolean);
  if (words.length === 0) return [];
  const matched = new Set(
    Object.entries(products)
      .filter(([, [name]]) => {
        const n = normalizeText(name);
        return words.every((w) => n.includes(w));
      })
      .map(([id]) => id),
  );
  const groups = new Map<string, PriceCompareGroup['entries']>();
  for (const { store, raw } of nearby) {
    for (const [goodId, price, flags, dcStart, dcEnd] of raw.prices) {
      if (!matched.has(goodId)) continue;
      const list = groups.get(goodId) ?? [];
      list.push({
        store,
        price,
        isDiscount: (flags & KCA_FLAG_DISCOUNT) !== 0,
        isOnePlusOne: (flags & KCA_FLAG_ONE_PLUS_ONE) !== 0,
        discountStart: dcStart ?? undefined,
        discountEnd: dcEnd ?? undefined,
        inspectDay,
      });
      groups.set(goodId, list);
    }
  }
  const result: PriceCompareGroup[] = [...groups.entries()].map(([goodId, entries]) => {
    const prices = entries.map((e) => e.price);
    entries.sort((a, b) => a.price - b.price || a.store.distance - b.store.distance);
    return {
      productId: goodId,
      productName: productName(products, goodId),
      unit: productUnit(products, goodId),
      entries,
      min: Math.min(...prices),
      max: Math.max(...prices),
      avg: Math.round(prices.reduce((a, b) => a + b, 0) / prices.length),
    };
  });
  result.sort((a, b) => b.entries.length - a.entries.length || a.productName.localeCompare(b.productName, 'ko'));
  return result.slice(0, 30);
}

/** 자료가 얼마나 오래됐는지 (일) */
export function snapshotAgeDays(updatedAt: string, now = Date.now()): number {
  return Math.floor((now - Date.parse(updatedAt)) / 86_400_000);
}
