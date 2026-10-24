import {
  assembleSearch,
  kcaStatus,
  sourceStatus,
  distanceMeters,
  generateSampleData,
  kstNow,
  mergeStores,
  normalizeText,
  withDistance,
  type KstNow,
  type LatLng,
  type PriceCompareResponse,
  type SearchQuery,
  type SearchResponse,
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
import type { CommunityStore } from '../store/community.ts';

// 검색 계산은 shared 에 있다 (브라우저도 같은 코드를 쓴다)
export { kcaStatus, sourceStatus } from '@sale-radar/shared';
export { computeStats, filterDeals, isReportedExpired, recommendScore, sortDeals } from '@sale-radar/shared';

export interface Sources {
  osm: OsmSource;
  kakao: KakaoSource;
  kca: KcaSource;
  naver: NaverSource;
  brand: BrandPromotionSource;
  goodprice: GoodPriceSource;
  community: CommunityStore;
}

const PENDING = Symbol('pending');

/** 소스별 기다릴 최대 시간. 넘으면 결과 없이 먼저 응답하고, 불러오기는 뒤에서 계속한다(캐시에 쌓임). */
export const SOURCE_BUDGET_MS: Partial<Record<SourceId, number>> = {
  // OSM 은 격자 칸 단위로 OverpassStoreLoader 안에서 시간 제한을 처리한다
  kakao: 8000,
};

/** 시간 제한을 넘겨 뒤에서 아직 불러오는 출처 (그동안은 짧게만 기다린다) */
const slowSince = new Map<SourceId, number>();

async function run<T>(id: SourceId, enabled: boolean, fn: () => Promise<T>, count: (v: T) => number) {
  if (!enabled) return { value: undefined, status: sourceStatus(id, false) };
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
        status: sourceStatus(id, true, {
          pending: true,
          message: '불러오는 중이에요. 잠시 후 자동으로 다시 검색합니다.',
        }),
      };
    }
    const { value, ms } = raced;
    return { value, status: sourceStatus(id, true, { count: count(value), durationMs: ms }) };
  } catch (err) {
    console.warn(`[search] ${id} 실패:`, (err as Error).message);
    return { value: undefined, status: sourceStatus(id, true, { ok: false, message: (err as Error).message }) };
  }
}

export class SearchService {
  constructor(
    private readonly config: AppConfigEnv,
    private readonly sources: Sources,
  ) {}

  async search(query: SearchQuery, now: KstNow = kstNow()): Promise<SearchResponse> {
    const { osm, kakao, kca, brand, goodprice, community, naver } = this.sources;
    const center = { lat: query.lat, lng: query.lng };
    const radius = query.radius;
    const sampleAllowed = this.config.sampleMode !== 'off';
    const includeSample = sampleAllowed && (query.includeSample ?? sampleDefault(this.config));

    const [osmR, kakaoR, kcaR, chainStores, communityR, goodR] = await Promise.all([
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
      // 참가격은 하루 한 번 받아 둔 파일을 읽는다 (검색할 때 API 를 부르지 않음)
      run(
        'kca',
        true,
        () => kca.deals(center, radius),
        (v) => v?.deals.length ?? 0,
      ),
      // 전국 체인 매장 위치 (본사·체인 공통 행사를 붙일 곳)
      kca.chainStores(center, radius).catch(() => [] as Store[]),
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

    const inRadius = (s: Store) => distanceMeters(center, s) <= radius;
    const kakaoStores = kakaoR.value?.stores.filter(inRadius) ?? [];
    const osmStores = osmR.value?.stores.filter(inRadius) ?? [];
    kakaoR.status.count = kakaoStores.length;
    osmR.status.count = osmStores.length;
    if (osmR.value?.pending) {
      osmR.status.pending = true;
      osmR.status.message = '주변 매장 지도를 불러오는 중이에요. 잠시 후 자동으로 다시 검색합니다.';
    }
    if (kakaoR.value?.truncated) kakaoR.status.message = '카테고리별 가까운 45곳까지만 제공됩니다';

    const deals = [
      ...(kcaR.value?.deals ?? []),
      ...(communityR.value?.deals ?? []),
      ...(goodR.value?.deals ?? []),
      ...sample.deals,
    ];
    // 참가격·샘플 등의 행사에도 사용자 반응(좋아요/확인/종료신고)을 붙인다
    const reactions = await community.reactions(deals.filter((d) => d.source !== 'community').map((d) => d.id));
    const ownBrand = await brand.file();
    // 참가격 본사(전국 공통) 가격의 할인·1+1 도 브랜드 행사처럼 주변 같은 브랜드 매장에 붙인다
    const brandFile = { ...ownBrand, promotions: [...ownBrand.promotions, ...(await kca.brandPromotions())] };

    const kcaS = kcaR.status.ok ? kcaStatus(kcaR.value?.manifest ?? null, kcaR.status.count) : kcaR.status;
    const brandStatus = sourceStatus('brand', true, {
      message: ownBrand.promotions.length === 0 ? '등록된 브랜드 행사가 없습니다 (CSV로 추가 가능)' : undefined,
    });
    const goodCount = await goodprice.count();
    const sources: SourceStatus[] = [
      kcaS,
      communityR.status,
      brandStatus,
      goodCount === 0
        ? { ...goodR.status, message: '불러온 착한가격업소 데이터가 없습니다 (CSV로 추가 가능)' }
        : goodR.status,
      sourceStatus('sample', sampleAllowed, {
        ok: true,
        count: sample.deals.length,
        message: includeSample ? '가상의 매장·행사입니다' : '꺼짐',
      }),
      osmR.status,
      kakaoR.status,
      sourceStatus('naver', naver.enabled, {
        message: naver.enabled ? '매장 상세 화면에서 최근 블로그 소식을 보여줍니다' : undefined,
      }),
    ];

    const { response, brandDealCount } = assembleSearch({
      query,
      now,
      includeSample,
      storeLists: [
        kakaoStores,
        kcaR.value?.stores ?? [],
        osmStores,
        chainStores,
        goodR.value?.stores ?? [],
        communityR.value?.stores ?? [],
        sample.stores,
      ],
      deals,
      brand: brandFile,
      reactions,
      sources,
    });
    brandStatus.count = brandDealCount;
    return response;
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
        true,
        () => kca.stores(center, radius),
        (v) => v.length,
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
      kcaR.value ?? [],
      osmR.value?.stores.filter(inRadius) ?? [],
      communityR.value?.filter(inRadius) ?? [],
    ]);
    const needle = q ? normalizeText(q) : '';
    const list = stores
      .filter((s) => !needle || normalizeText(`${s.name} ${s.categoryDetail ?? ''}`).includes(needle))
      .map((s) => withDistance(s, center))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, 300);
    return { stores: list, sources: [osmR.status, kakaoR.status, kcaR.status, communityR.status] };
  }

  async compare(center: LatLng, radius: number, q: string): Promise<PriceCompareResponse> {
    const r = await this.sources.kca.compare(center, radius, q).catch(() => null);
    const manifest = r?.manifest ?? (await this.sources.kca.manifest());
    return {
      q,
      center,
      radius,
      inspectDay: manifest?.inspectDay,
      groups: r?.groups ?? [],
      source: kcaStatus(manifest, r?.groups.length ?? 0),
    };
  }
}
