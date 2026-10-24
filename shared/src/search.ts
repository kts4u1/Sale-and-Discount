import { brandPromotionDeals, type BrandPromotionFile } from './brand.ts';
import {
  computeDealTiming,
  distanceMeters,
  effectiveDiscount,
  normalizeText,
  walkMinutes,
  type KstNow,
} from './deal-utils.ts';
import { mergeStores } from './merge.ts';
import type {
  CategoryId,
  Deal,
  DealTypeId,
  DealView,
  SearchQuery,
  SearchResponse,
  SearchStats,
  SourceStatus,
  Store,
  StoreWithDistance,
} from './types.ts';

/**
 * 검색의 핵심 계산 (서버와 브라우저가 함께 쓴다).
 * 여러 출처의 매장·행사를 받아 합치고, 거리·진행 상태를 계산하고, 거르고, 정렬한다.
 */

/** 신고가 3건 이상이고 확인보다 많으면 끝난 행사로 본다 */
export const isReportedExpired = (d: Pick<Deal, 'expiredReports' | 'confirms'>) =>
  d.expiredReports >= 3 && d.expiredReports > d.confirms;

/** 추천 점수: 할인율 + 지금 진행 중 + 마감 임박 + 가까움 + 사용자 확인 */
export function recommendScore(d: DealView, radius: number): number {
  return (
    d.effectiveDiscount +
    (d.activeNow ? 15 : 0) +
    (d.endingSoon ? 10 : 0) -
    (d.distance / Math.max(radius, 1)) * 25 +
    Math.min(d.confirms, 20) * 0.8 +
    Math.min(d.likes, 50) * 0.2 +
    (d.salePrice !== undefined ? 3 : 0) +
    (d.status === 'later_today' ? 4 : 0)
  );
}

export function sortDeals(deals: DealView[], sort: SearchQuery['sort'], radius: number): DealView[] {
  const list = [...deals];
  const statusRank = (d: DealView) => (d.activeNow ? 0 : d.status === 'later_today' ? 1 : 2);
  switch (sort) {
    case 'distance':
      return list.sort((a, b) => a.distance - b.distance);
    case 'discount':
      return list.sort((a, b) => b.effectiveDiscount - a.effectiveDiscount || a.distance - b.distance);
    case 'ending': {
      const key = (d: DealView) =>
        d.activeNow
          ? (d.endsInMinutes ?? Number.MAX_SAFE_INTEGER / 2)
          : Number.MAX_SAFE_INTEGER / 2 + (d.startsInMinutes ?? 0);
      return list.sort((a, b) => key(a) - key(b) || a.distance - b.distance);
    }
    case 'price':
      return list.sort(
        (a, b) =>
          (a.salePrice ?? Number.MAX_SAFE_INTEGER) - (b.salePrice ?? Number.MAX_SAFE_INTEGER) ||
          a.distance - b.distance,
      );
    case 'newest':
      return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    case 'popular':
      return list.sort((a, b) => b.likes + b.confirms * 2 - (a.likes + a.confirms * 2) || a.distance - b.distance);
    default: {
      const score = new Map(list.map((d) => [d.id, recommendScore(d, radius)]));
      return list.sort((a, b) => statusRank(a) - statusRank(b) || score.get(b.id)! - score.get(a.id)!);
    }
  }
}

function matchesText(d: DealView, needle: string): boolean {
  const hay = normalizeText(
    [
      d.title,
      d.productName,
      d.description,
      d.store.name,
      d.store.categoryDetail,
      d.store.brand,
      ...d.tags,
      ...(d.items ?? []).map((i) => i.name),
    ]
      .filter(Boolean)
      .join(' '),
  );
  return needle
    .split(/\s+/)
    .map(normalizeText)
    .filter(Boolean)
    .every((word) => hay.includes(word));
}

type FilterKey = 'categories' | 'types';

export function filterDeals(deals: DealView[], q: SearchQuery, skip?: FilterKey): DealView[] {
  const cats = skip === 'categories' ? undefined : q.categories?.length ? new Set<CategoryId>(q.categories) : undefined;
  const types = skip === 'types' ? undefined : q.types?.length ? new Set<DealTypeId>(q.types) : undefined;
  const text = q.q?.trim();
  return deals.filter((d) => {
    if (cats && !cats.has(d.category) && !cats.has(d.store.category)) return false;
    if (types && !types.has(d.type)) return false;
    if (q.activeOnly && !d.activeNow) return false;
    if (q.minDiscount && d.effectiveDiscount < q.minDiscount) return false;
    if (q.maxPrice && (d.salePrice === undefined || d.salePrice > q.maxPrice)) return false;
    if (text && !matchesText(d, text)) return false;
    return true;
  });
}

export function computeStats(all: DealView[], filtered: DealView[], q: SearchQuery, storeCount: number): SearchStats {
  const byCategory: SearchStats['byCategory'] = {};
  for (const d of filterDeals(all, q, 'categories')) byCategory[d.category] = (byCategory[d.category] ?? 0) + 1;
  const byType: SearchStats['byType'] = {};
  for (const d of filterDeals(all, q, 'types')) byType[d.type] = (byType[d.type] ?? 0) + 1;
  const bySource: SearchStats['bySource'] = {};
  for (const d of filtered) bySource[d.source] = (bySource[d.source] ?? 0) + 1;
  const discounts = filtered.map((d) => d.effectiveDiscount).filter((v) => v > 0);
  return {
    totalDeals: filtered.length,
    totalStores: storeCount,
    activeNow: filtered.filter((d) => d.activeNow).length,
    endingSoon: filtered.filter((d) => d.endingSoon).length,
    byCategory,
    byType,
    bySource,
    maxDiscount: discounts.length ? Math.max(...discounts) : 0,
    avgDiscount: discounts.length ? Math.round(discounts.reduce((a, b) => a + b, 0) / discounts.length) : 0,
  };
}

export interface Reaction {
  likes: number;
  confirms: number;
  expiredReports: number;
}

export interface AssembleInput {
  query: SearchQuery;
  now: KstNow;
  includeSample: boolean;
  /** 매장 목록들. 앞의 목록일수록 정보가 우선한다 (카카오 > 참가격 > OSM > 착한가격 > 제보 > 샘플) */
  storeLists: Store[][];
  /** 브랜드 행사를 뺀 모든 행사 */
  deals: Deal[];
  /** 브랜드 공통 행사 (반경 안의 실제 브랜드 매장에 붙인다) */
  brand?: BrandPromotionFile;
  /** 사용자 반응 (좋아요·확인·종료 신고). 행사에 이미 들어 있는 값에 더한다 */
  reactions?: Map<string, Reaction>;
  sources: SourceStatus[];
  /** 응답에 담을 최대 매장 수 */
  maxStores?: number;
}

export function withDistance(store: Store, center: { lat: number; lng: number }): StoreWithDistance {
  const distance = Math.round(distanceMeters(center, store));
  return { ...store, distance, walkMinutes: walkMinutes(distance), dealCount: 0 };
}

export function assembleSearch(input: AssembleInput): { response: SearchResponse; brandDealCount: number } {
  const { query, now } = input;
  const center = { lat: query.lat, lng: query.lng };
  const radius = query.radius;
  const inRadius = (s: Store) => distanceMeters(center, s) <= radius;

  const { stores: merged, alias } = mergeStores(input.storeLists.map((list) => list.filter(inRadius)));
  const storeMap = new Map<string, StoreWithDistance>();
  for (const s of merged) storeMap.set(s.id, withDistance(s, center));
  const resolveStore = (id: string) => storeMap.get(alias.get(id) ?? id);

  // 브랜드 공통 행사는 주변 실제 매장(샘플 제외)에 붙인다
  const realStores = [...storeMap.values()].filter((s) => !s.sources.includes('sample'));
  const brandDeals = input.brand ? brandPromotionDeals(input.brand, realStores) : [];

  const views: DealView[] = [];
  for (const raw of [...input.deals, ...brandDeals]) {
    const store = resolveStore(raw.storeId);
    if (!store || store.distance > radius) continue;
    const r = input.reactions?.get(raw.id);
    const deal: Deal = r
      ? {
          ...raw,
          likes: raw.likes + r.likes,
          confirms: raw.confirms + r.confirms,
          expiredReports: raw.expiredReports + r.expiredReports,
        }
      : raw;
    if (isReportedExpired(deal)) continue;
    const timing = computeDealTiming(deal, now);
    if (timing.status === 'ended') continue;
    const otherStores = deal.otherStoreIds
      ?.map(resolveStore)
      .filter((s): s is StoreWithDistance => Boolean(s))
      .map((s) => ({ id: s.id, name: s.name, distance: s.distance }));
    views.push({
      ...deal,
      storeId: store.id,
      store,
      distance: store.distance,
      walkMinutes: store.walkMinutes,
      ...timing,
      effectiveDiscount: effectiveDiscount(deal),
      otherStores,
    });
  }
  for (const v of views) storeMap.get(v.storeId)!.dealCount += 1;

  const filtered = sortDeals(filterDeals(views, query), query.sort, radius);
  const stores = [...storeMap.values()].sort((a, b) => a.distance - b.distance).slice(0, input.maxStores ?? 600);
  return {
    brandDealCount: brandDeals.length,
    response: {
      center,
      radius,
      generatedAt: new Date().toISOString(),
      deals: filtered,
      stores,
      sources: input.sources,
      stats: computeStats(views, filtered, query, storeMap.size),
      sampleIncluded: input.includeSample,
    },
  };
}
