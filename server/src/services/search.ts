import {
  SOURCE_LABELS,
  computeDealTiming,
  distanceMeters,
  effectiveDiscount,
  kstNow,
  normalizeText,
  walkMinutes,
  type CategoryId,
  type Deal,
  type DealTypeId,
  type DealView,
  type KstNow,
  type LatLng,
  type PriceCompareResponse,
  type SearchQuery,
  type SearchResponse,
  type SearchStats,
  type SourceId,
  type SourceStatus,
  type Store,
  type StoreWithDistance,
} from '@sale-radar/shared';
import { sampleDefault, type AppConfigEnv } from '../config.ts';
import { timed } from '../lib/http.ts';
import type { BrandPromotionSource } from '../sources/brand.ts';
import type { GoodPriceSource } from '../sources/goodprice.ts';
import type { KakaoSource } from '../sources/kakao.ts';
import type { KcaSource } from '../sources/kca.ts';
import type { NaverSource } from '../sources/naver.ts';
import type { OsmSource } from '../sources/osm.ts';
import { generateSampleData } from '../sources/sample.ts';
import type { CommunityStore } from '../store/community.ts';
import { mergeStores } from './merge.ts';

export interface Sources {
  osm: OsmSource;
  kakao: KakaoSource;
  kca: KcaSource;
  naver: NaverSource;
  brand: BrandPromotionSource;
  goodprice: GoodPriceSource;
  community: CommunityStore;
}

const REQUIRES: Partial<Record<SourceId, string>> = {
  kca: 'DATA_GO_KR_SERVICE_KEY',
  kakao: 'KAKAO_REST_API_KEY',
  naver: 'NAVER_CLIENT_ID, NAVER_CLIENT_SECRET',
};

/** 신고가 3건 이상이고 확인보다 많으면 끝난 행사로 본다 */
export const isReportedExpired = (d: Pick<Deal, 'expiredReports' | 'confirms'>) =>
  d.expiredReports >= 3 && d.expiredReports > d.confirms;

function status(id: SourceId, enabled: boolean, extra: Partial<SourceStatus> = {}): SourceStatus {
  return { id, label: SOURCE_LABELS[id], enabled, ok: enabled, count: 0, requires: REQUIRES[id], ...extra };
}

const PENDING = Symbol('pending');

/** 소스별 기다릴 최대 시간. 넘으면 결과 없이 먼저 응답하고, 불러오기는 뒤에서 계속한다(캐시에 쌓임). */
export const SOURCE_BUDGET_MS: Partial<Record<SourceId, number>> = {
  // OSM 은 격자 칸 단위로 OsmSource 안에서 시간 제한을 처리한다
  kakao: 8000,
  kca: 15000,
};

/** 시간 제한을 넘겨 뒤에서 아직 불러오는 출처 (그동안은 짧게만 기다린다) */
const slowSince = new Map<SourceId, number>();

async function run<T>(id: SourceId, enabled: boolean, fn: () => Promise<T>, count: (v: T) => number) {
  if (!enabled) return { value: undefined, status: status(id, false) };
  const fullBudget = SOURCE_BUDGET_MS[id];
  const since = slowSince.get(id);
  const budget = fullBudget && since !== undefined && Date.now() - since < 5 * 60_000 ? 1500 : fullBudget;
  try {
    const task = timed(fn);
    let timer: NodeJS.Timeout | undefined;
    const raced = budget
      ? await Promise.race([
          task,
          new Promise<typeof PENDING>((resolve) => {
            timer = setTimeout(() => resolve(PENDING), budget);
          }),
        ])
      : await task;
    clearTimeout(timer);
    if (raced === PENDING) {
      if (!slowSince.has(id)) {
        slowSince.set(id, Date.now());
        task.then(
          () => slowSince.delete(id),
          () => slowSince.delete(id),
        );
      }
      task.catch((err) => console.warn(`[search] ${id} 백그라운드 실패:`, (err as Error).message));
      return {
        value: undefined,
        status: status(id, true, { pending: true, message: '불러오는 중이에요. 잠시 후 자동으로 다시 검색합니다.' }),
      };
    }
    const { value, ms } = raced;
    return { value, status: status(id, true, { count: count(value), durationMs: ms }) };
  } catch (err) {
    console.warn(`[search] ${id} 실패:`, (err as Error).message);
    return { value: undefined, status: status(id, true, { ok: false, message: (err as Error).message }) };
  }
}

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

export class SearchService {
  constructor(
    private readonly config: AppConfigEnv,
    private readonly sources: Sources,
  ) {}

  private withDistance(store: Store, center: LatLng): StoreWithDistance {
    const distance = Math.round(distanceMeters(center, store));
    return { ...store, distance, walkMinutes: walkMinutes(distance), dealCount: 0 };
  }

  async search(query: SearchQuery, now: KstNow = kstNow()): Promise<SearchResponse> {
    const { osm, kakao, kca, brand, goodprice, community, naver } = this.sources;
    const center = { lat: query.lat, lng: query.lng };
    const radius = query.radius;
    const sampleAllowed = this.config.sampleMode !== 'off';
    const includeSample = sampleAllowed && (query.includeSample ?? sampleDefault(this.config));

    const [osmR, kakaoR, kcaR, communityR, goodR] = await Promise.all([
      run(
        'osm',
        osm.enabled,
        () => osm.nearbyStores(center, radius),
        () => 0,
      ),
      run(
        'kakao',
        kakao.enabled,
        () => kakao.nearbyStores(center, radius),
        () => 0,
      ),
      run(
        'kca',
        kca.enabled,
        () => kca.deals(center, radius),
        (v) => v.deals.length,
      ),
      run(
        'community',
        true,
        () => community.nearby(center, radius),
        (v) => v.deals.length,
      ),
      run(
        'goodprice',
        true,
        () => goodprice.deals(center, radius),
        (v) => v.deals.length,
      ),
    ]);
    const sample = includeSample ? generateSampleData(center, radius, now) : { stores: [], deals: [] };

    // 매장 합치기 (카카오 > 참가격 > OSM > 착한가격 > 제보 > 샘플 순으로 정보 우선)
    const inRadius = (s: Store) => distanceMeters(center, s) <= radius;
    const kakaoStores = kakaoR.value?.stores.filter(inRadius) ?? [];
    const osmStores = osmR.value?.stores.filter(inRadius) ?? [];
    kakaoR.status.count = kakaoStores.length;
    osmR.status.count = osmStores.length;
    if (osmR.value?.pending) {
      osmR.status.pending = true;
      osmR.status.message = '주변 매장 지도를 불러오는 중이에요. 잠시 후 자동으로 다시 검색합니다.';
    }
    const { stores: merged, alias } = mergeStores([
      kakaoStores,
      kcaR.value?.stores ?? [],
      osmStores,
      goodR.value?.stores ?? [],
      communityR.value?.stores ?? [],
      sample.stores,
    ]);
    const storeMap = new Map<string, StoreWithDistance>();
    for (const s of merged) storeMap.set(s.id, this.withDistance(s, center));
    const resolveStore = (id: string) => storeMap.get(alias.get(id) ?? id);

    // 브랜드 공통 행사는 주변 실제 매장(샘플 제외)에 붙인다
    const realStores = [...storeMap.values()].filter((s) => !s.sources.includes('sample'));
    const brandR = await run(
      'brand',
      true,
      () => brand.deals(realStores),
      (v) => v.length,
    );

    const rawDeals: Deal[] = [
      ...(kcaR.value?.deals ?? []),
      ...(communityR.value?.deals ?? []),
      ...(goodR.value?.deals ?? []),
      ...(brandR.value ?? []),
      ...sample.deals,
    ];

    // 참가격·샘플 등의 행사에도 사용자 반응(좋아요/확인/종료신고)을 붙인다
    const reactions = await community.reactions(rawDeals.filter((d) => d.source !== 'community').map((d) => d.id));

    const views: DealView[] = [];
    for (const raw of rawDeals) {
      const store = resolveStore(raw.storeId);
      if (!store || store.distance > radius) continue;
      const r = reactions.get(raw.id);
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

    // 매장별 행사 수
    for (const v of views) {
      const s = storeMap.get(v.storeId);
      if (s) s.dealCount += 1;
    }
    for (const v of views) v.store = storeMap.get(v.storeId)!;

    const filtered = sortDeals(filterDeals(views, query), query.sort, radius);
    const stores = [...storeMap.values()].sort((a, b) => a.distance - b.distance).slice(0, 600);

    const sourceStatuses: SourceStatus[] = [
      withMessage(
        kcaR.status,
        kcaR.value ? kcaMessage(kcaR.value.inspectDay, kcaR.value.pendingGeocode, kcaR.value.stores.length) : undefined,
      ),
      communityR.status,
      withMessage(
        brandR.status,
        (await brand.count()) === 0 ? '등록된 브랜드 행사가 없습니다 (CSV로 추가 가능)' : undefined,
      ),
      withMessage(
        goodR.status,
        (await goodprice.count()) === 0 ? '불러온 착한가격업소 데이터가 없습니다 (CSV로 추가 가능)' : undefined,
      ),
      status('sample', sampleAllowed, {
        ok: true,
        count: sample.deals.length,
        message: includeSample ? '가상의 매장·행사입니다' : '꺼짐',
      }),
      osmR.status,
      withMessage(kakaoR.status, kakaoR.value?.truncated ? '카테고리별 가까운 45곳까지만 제공됩니다' : undefined),
      status('naver', naver.enabled, {
        message: naver.enabled ? '매장 상세 화면에서 최근 블로그 소식을 보여줍니다' : undefined,
      }),
    ];

    return {
      center,
      radius,
      generatedAt: new Date().toISOString(),
      deals: filtered,
      stores,
      sources: sourceStatuses,
      stats: computeStats(views, filtered, query, storeMap.size),
      sampleIncluded: includeSample,
    };
  }

  /** 행사 제보 화면용: 주변 실제 매장 목록 (샘플 제외) */
  async stores(
    center: LatLng,
    radius: number,
    q?: string,
  ): Promise<{ stores: StoreWithDistance[]; sources: SourceStatus[] }> {
    const { osm, kakao, kca, community } = this.sources;
    const [osmR, kakaoR, kcaR, communityR] = await Promise.all([
      run(
        'osm',
        osm.enabled,
        () => osm.nearbyStores(center, radius),
        (v) => v.stores.length,
      ),
      run(
        'kakao',
        kakao.enabled,
        () => kakao.nearbyStores(center, radius),
        (v) => v.stores.length,
      ),
      run(
        'kca',
        kca.enabled,
        () => kca.nearbyStores(center, radius),
        (v) => v.stores.length,
      ),
      run(
        'community',
        true,
        () => community.allStores(),
        (v) => v.length,
      ),
    ]);
    const inRadius = (s: Store) => distanceMeters(center, s) <= radius;
    const { stores } = mergeStores([
      kakaoR.value?.stores.filter(inRadius) ?? [],
      kcaR.value?.stores ?? [],
      osmR.value?.stores.filter(inRadius) ?? [],
      communityR.value?.filter(inRadius) ?? [],
    ]);
    const needle = q ? normalizeText(q) : '';
    const list = stores
      .filter((s) => !needle || normalizeText(`${s.name} ${s.categoryDetail ?? ''}`).includes(needle))
      .map((s) => this.withDistance(s, center))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 300);
    return { stores: list, sources: [osmR.status, kakaoR.status, kcaR.status, communityR.status] };
  }

  async compare(center: LatLng, radius: number, q: string): Promise<PriceCompareResponse> {
    const { kca } = this.sources;
    if (!kca.enabled) {
      return { q, center, radius, groups: [], source: status('kca', false) };
    }
    const r = await run(
      'kca',
      true,
      () => kca.compare(center, radius, q),
      (v) => v.groups.length,
    );
    const groups =
      r.value?.groups.map((g) => ({
        ...g,
        entries: g.entries.map(({ store, price }) => ({
          store: { ...this.withDistance(store, center), dealCount: 0 },
          price: price.price,
          isDiscount: price.discount,
          isOnePlusOne: price.onePlusOne,
          discountStart: price.dcStart,
          discountEnd: price.dcEnd,
          inspectDay: price.inspectDay,
        })),
      })) ?? [];
    return { q, center, radius, inspectDay: r.value?.inspectDay, groups, source: r.status };
  }
}

function withMessage(s: SourceStatus, message: string | undefined): SourceStatus {
  return message && s.ok ? { ...s, message } : s;
}

function kcaMessage(day: string | undefined, pending: number, storeCount: number): string {
  const parts = [day ? `${day} 조사 기준` : '조사 데이터를 찾지 못했습니다', `반경 내 조사매장 ${storeCount}곳`];
  if (pending > 0) parts.push(`좌표 확인 중인 매장 ${pending}곳`);
  return parts.join(' · ');
}
