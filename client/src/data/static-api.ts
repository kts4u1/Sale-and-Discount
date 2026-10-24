import {
  CATEGORY_IDS,
  DEAL_TYPE_IDS,
  DEFAULT_OVERPASS_ENDPOINTS,
  DEFAULT_RADIUS,
  MAX_RADIUS,
  MIN_RADIUS,
  OverpassStoreLoader,
  RADIUS_OPTIONS,
  SORT_IDS,
  assembleSearch,
  distanceMeters,
  formatKoreanAddress,
  generateSampleData,
  goodPriceDeals,
  chainTilesToStores,
  kcaBrandPromotions,
  kcaChainTileFile,
  kcaChainTilesForCircle,
  kcaCompare,
  kcaDeals,
  kcaNearbyStores,
  kcaStatus,
  kcaTileFile,
  kcaTilesForCircle,
  kstNow,
  mergeStores,
  normalizeText,
  regionsFromNominatim,
  sourceStatus,
  withDistance,
  KCA_SNAPSHOT_VERSION,
  type AppConfig,
  type BrandPromotionFile,
  type CategoryId,
  type CreateDealInput,
  type Deal,
  type DealTypeId,
  type GeocodeResult,
  type GoodPriceFile,
  type KcaBrandFile,
  type KcaChainTileFile,
  type KcaManifest,
  type KcaProductsFile,
  type KcaTileFile,
  type LatLng,
  type NewsItem,
  type NominatimPlace,
  type PriceCompareResponse,
  type Reaction,
  type ReverseGeocodeResult,
  type SearchQuery,
  type SearchResponse,
  type SortId,
  type SourceStatus,
  type Store,
  type StoreWithDistance,
  type VoteAction,
  type VoteResult,
} from '@sale-radar/shared';
import { loadValue, saveValue } from '../lib/storage.ts';
import { ApiError, qs, type SearchParams } from './server-api.ts';

/**
 * 서버 없이 동작하는 데이터 계층 (GitHub Pages 배포용).
 *
 * - 한국소비자원 참가격: GitHub Actions 가 매일 만들어 둔 data/kca/ 파일을 읽는다 (API 키가 브라우저에 오지 않음)
 * - 주변 매장: 브라우저가 OpenStreetMap(Overpass)에 직접 묻는다
 * - 주소 검색: OpenStreetMap Nominatim
 * - 행사 제보·투표: 이 기기(브라우저)에만 저장된다
 */

const DATA = `${import.meta.env.BASE_URL}data/`;

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, init);
  } catch {
    throw new ApiError('데이터를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.', 0);
  }
  if (res.status === 404) return null;
  if (!res.ok) throw new ApiError(`데이터를 불러오지 못했어요 (${res.status})`, res.status);
  return (await res.json()) as T;
}

/* ------------------------------ 받아 둔 파일 ------------------------------ */

let manifestP: Promise<KcaManifest | null> | null = null;
function kcaManifest(): Promise<KcaManifest | null> {
  manifestP ??= getJson<KcaManifest>(`${DATA}kca/manifest.json`, { cache: 'no-cache' })
    .then((m) => (m && m.version === KCA_SNAPSHOT_VERSION ? m : null))
    .catch((err) => {
      manifestP = null;
      throw err;
    });
  return manifestP;
}

const versioned = (m: KcaManifest, file: string) =>
  `${DATA}kca/${file}?v=${encodeURIComponent(m.versions[file] ?? m.updatedAt)}`;

const chainTileCache = new Map<string, Promise<KcaChainTileFile | null>>();
function kcaChainTile(m: KcaManifest, key: string): Promise<KcaChainTileFile | null> {
  const url = versioned(m, kcaChainTileFile(key));
  let p = chainTileCache.get(url);
  if (!p) {
    p = getJson<KcaChainTileFile>(url).catch(() => null);
    chainTileCache.set(url, p);
  }
  return p;
}

let brandsP: Promise<KcaBrandFile> | null = null;
function kcaBrands(m: KcaManifest): Promise<KcaBrandFile> {
  brandsP ??= getJson<KcaBrandFile>(versioned(m, 'brands.json')).then(
    (v) => v ?? { stores: [] },
    () => ({ stores: [] }),
  );
  return brandsP;
}

let productsP: Promise<KcaProductsFile> | null = null;
function kcaProducts(m: KcaManifest): Promise<KcaProductsFile> {
  productsP ??= getJson<KcaProductsFile>(versioned(m, 'products.json'))
    .then((p) => p ?? {})
    .catch((err) => {
      productsP = null;
      throw err;
    });
  return productsP;
}

const tileCache = new Map<string, Promise<KcaTileFile | null>>();
function kcaTile(m: KcaManifest, key: string): Promise<KcaTileFile | null> {
  const url = versioned(m, kcaTileFile(key));
  let p = tileCache.get(url);
  if (!p) {
    p = getJson<KcaTileFile>(url);
    p.catch(() => tileCache.delete(url));
    tileCache.set(url, p);
  }
  return p;
}

async function kcaNearby(center: LatLng, radius: number) {
  const m = await kcaManifest();
  if (!m) return null;
  const [products, brands, tiles] = await Promise.all([
    kcaProducts(m),
    kcaBrands(m),
    Promise.all(kcaTilesForCircle(m, center, radius).map((k) => kcaTile(m, k))),
  ]);
  const nearby = kcaNearbyStores(
    tiles.filter((t): t is KcaTileFile => Boolean(t)),
    center,
    radius,
  );
  const chainKeys = kcaChainTilesForCircle(m, center, radius);
  const chainTiles = await Promise.all(chainKeys.map((k) => kcaChainTile(m, k)));
  const chainStores = chainTilesToStores(
    chainTiles.filter((t): t is KcaChainTileFile => Boolean(t)),
    center,
    radius,
  );
  return {
    manifest: m,
    products,
    nearby,
    chainStores,
    brandPromotions: kcaBrandPromotions(brands, products, m.inspectDay),
  };
}

let brandP: Promise<BrandPromotionFile> | null = null;
const brandFile = () =>
  (brandP ??= getJson<BrandPromotionFile>(`${DATA}brand-promotions.json`).then(
    (v) => v ?? { promotions: [] },
    () => ({ promotions: [] }),
  ));

let goodP: Promise<GoodPriceFile> | null = null;
const goodFile = () =>
  (goodP ??= getJson<GoodPriceFile>(`${DATA}goodprice.json`).then(
    (v) => v ?? { stores: [] },
    () => ({ stores: [] }),
  ));

/* ------------------------------ OpenStreetMap ------------------------------ */

/** 받은 격자는 이 탭이 열려 있는 동안 sessionStorage 에 보관 (용량이 넘치면 그냥 메모리만) */
const osm = new OverpassStoreLoader({
  endpoints: DEFAULT_OVERPASS_ENDPOINTS,
  budgetMs: 6000,
  persist: async (key, load) => {
    const k = `sale-radar:osm:${key}`;
    try {
      const saved = sessionStorage.getItem(k);
      if (saved) return JSON.parse(saved) as Store[];
    } catch {
      /* 저장소를 못 쓰면 그냥 받는다 */
    }
    const stores = await load();
    try {
      sessionStorage.setItem(k, JSON.stringify(stores));
    } catch {
      /* 용량 초과 */
    }
    return stores;
  },
});

/* ------------------------------- Nominatim ------------------------------- */

const NOMINATIM = 'https://nominatim.openstreetmap.org';
let lastNominatim = 0;
async function nominatim<T>(path: string, params: Record<string, string>): Promise<T> {
  // 사용 정책: 초당 1회
  const wait = lastNominatim + 1100 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastNominatim = Date.now();
  const res = await fetch(`${NOMINATIM}${path}?${qs({ format: 'jsonv2', 'accept-language': 'ko', ...params })}`);
  if (!res.ok) throw new ApiError(`주소 검색 실패 (${res.status})`, res.status);
  return (await res.json()) as T;
}

/* ------------------------------ 이 기기 저장 ------------------------------ */

interface LocalData {
  stores: Store[];
  deals: Deal[];
}
const LOCAL_KEY = 'local-deals';
const VOTES_KEY = 'local-votes';
const localData = () => loadValue<LocalData>(LOCAL_KEY, { stores: [], deals: [] });
const localVotes = () => loadValue<Record<string, Reaction>>(VOTES_KEY, {});

/* -------------------------------- 검색 -------------------------------- */

function toQuery(p: SearchParams): SearchQuery {
  return {
    lat: p.lat,
    lng: p.lng,
    radius: Math.round(Math.min(MAX_RADIUS, Math.max(MIN_RADIUS, p.radius))),
    q: p.q?.trim() || undefined,
    categories: p.categories?.filter((c): c is CategoryId => (CATEGORY_IDS as string[]).includes(c)),
    types: p.types?.filter((t): t is DealTypeId => (DEAL_TYPE_IDS as string[]).includes(t)),
    sort: p.sort && (SORT_IDS as string[]).includes(p.sort) ? (p.sort as SortId) : undefined,
    includeSample: p.sample,
    activeOnly: p.active,
    minDiscount: p.minDiscount,
  };
}

async function osmStores(center: LatLng, radius: number): Promise<{ stores: Store[]; status: SourceStatus }> {
  try {
    const r = await osm.nearbyStores(center, radius);
    const stores = r.stores.filter((s) => distanceMeters(center, s) <= radius);
    return {
      stores,
      status: sourceStatus('osm', true, {
        count: stores.length,
        pending: r.pending || undefined,
        message: r.pending ? '주변 매장 지도를 불러오는 중이에요. 잠시 후 자동으로 다시 검색합니다.' : undefined,
      }),
    };
  } catch (err) {
    return { stores: [], status: sourceStatus('osm', true, { ok: false, message: (err as Error).message }) };
  }
}

export const staticApi = {
  async config(): Promise<AppConfig> {
    const [m, brand, good] = await Promise.all([kcaManifest().catch(() => null), brandFile(), goodFile()]);
    return {
      dataMode: 'static',
      radiusOptions: [...RADIUS_OPTIONS],
      defaultRadius: DEFAULT_RADIUS,
      sampleAvailable: true,
      sampleDefault: !m,
      sources: [
        kcaStatus(m),
        sourceStatus('community', true, { message: '이 기기에만 저장돼요' }),
        sourceStatus('brand', brand.promotions.length > 0),
        sourceStatus('goodprice', good.stores.length > 0),
        sourceStatus('sample', true),
        sourceStatus('osm', true),
        sourceStatus('kakao', false, { message: '정적 배포에서는 쓰지 않습니다 (서버로 실행하면 사용 가능)' }),
        sourceStatus('naver', false, { message: '정적 배포에서는 쓰지 않습니다 (서버로 실행하면 사용 가능)' }),
      ],
      tileUrl: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
      tileAttribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    };
  },

  async search(p: SearchParams, signal?: AbortSignal): Promise<SearchResponse> {
    const query = toQuery(p);
    const center = { lat: query.lat, lng: query.lng };
    const radius = query.radius;
    const now = kstNow();

    const [kca, osmR, brand, good] = await Promise.all([
      kcaNearby(center, radius).catch((err: Error) => err),
      osmStores(center, radius),
      brandFile(),
      goodFile(),
    ]);
    if (signal?.aborted) throw new DOMException('aborted', 'AbortError');

    const kcaOk = kca && !(kca instanceof Error) ? kca : null;
    const includeSample = query.includeSample ?? !kcaOk;
    const sample = includeSample ? generateSampleData(center, radius, now) : { stores: [], deals: [] };
    const goodR = goodPriceDeals(good, center, radius);
    const local = localData();
    const kcaDealList = kcaOk ? kcaDeals(kcaOk.nearby, kcaOk.products, kcaOk.manifest.inspectDay) : [];

    const votes = localVotes();
    const reactions = new Map(Object.entries(votes));
    const localDeals = local.deals;
    const brandStatus = sourceStatus('brand', true, {
      message: brand.promotions.length === 0 ? '등록된 브랜드 행사가 없습니다' : undefined,
    });
    const sources: SourceStatus[] = [
      kca instanceof Error
        ? sourceStatus('kca', true, { ok: false, message: kca.message })
        : kcaStatus(kcaOk?.manifest ?? null, kcaDealList.length),
      sourceStatus('community', true, { count: localDeals.length, message: '이 기기에만 저장돼요' }),
      brandStatus,
      sourceStatus('goodprice', true, {
        count: goodR.deals.length,
        message: good.stores.length === 0 ? '불러온 착한가격업소 데이터가 없습니다' : undefined,
      }),
      sourceStatus('sample', true, {
        count: sample.deals.length,
        message: includeSample ? '가상의 매장·행사입니다' : '꺼짐',
      }),
      osmR.status,
    ];

    const { response, brandDealCount } = assembleSearch({
      query,
      now,
      includeSample,
      storeLists: [
        kcaOk?.nearby.map((n) => n.store) ?? [],
        osmR.stores,
        kcaOk?.chainStores ?? [],
        goodR.stores,
        local.stores,
        sample.stores,
      ],
      deals: [...kcaDealList, ...localDeals, ...goodR.deals, ...sample.deals],
      brand: { ...brand, promotions: [...brand.promotions, ...(kcaOk?.brandPromotions ?? [])] },
      reactions,
      sources,
    });
    brandStatus.count = brandDealCount;
    return response;
  },

  async stores(
    lat: number,
    lng: number,
    radius: number,
    q?: string,
  ): Promise<{ stores: StoreWithDistance[]; sources: SourceStatus[] }> {
    const center = { lat, lng };
    const [kca, osmR] = await Promise.all([kcaNearby(center, radius).catch(() => null), osmStores(center, radius)]);
    const local = localData().stores.filter((s) => distanceMeters(center, s) <= radius);
    const { stores } = mergeStores([kca?.nearby.map((n) => n.store) ?? [], osmR.stores, kca?.chainStores ?? [], local]);
    const needle = q ? normalizeText(q) : '';
    return {
      stores: stores
        .filter((s) => !needle || normalizeText(`${s.name} ${s.categoryDetail ?? ''}`).includes(needle))
        .map((s) => withDistance(s, center))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 300),
      sources: [osmR.status],
    };
  },

  async prices(lat: number, lng: number, radius: number, q: string): Promise<PriceCompareResponse> {
    const center = { lat, lng };
    const kca = await kcaNearby(center, radius);
    const groups = kca ? kcaCompare(kca.nearby, kca.products, q, kca.manifest.inspectDay) : [];
    return {
      q,
      center,
      radius,
      inspectDay: kca?.manifest.inspectDay,
      groups,
      source: kcaStatus(kca?.manifest ?? null, groups.length),
    };
  },

  async geocode(q: string, near?: LatLng): Promise<{ results: GeocodeResult[] }> {
    const params: Record<string, string> = { q, countrycodes: 'kr', limit: '8', addressdetails: '1' };
    if (near) params.viewbox = `${near.lng - 0.3},${near.lat + 0.3},${near.lng + 0.3},${near.lat - 0.3}`;
    const places = await nominatim<NominatimPlace[]>('/search', params);
    return {
      results: places.map((p) => ({
        name: p.name || p.display_name.split(',')[0],
        address: formatKoreanAddress(p),
        lat: Number(p.lat),
        lng: Number(p.lon),
        source: 'nominatim',
      })),
    };
  },

  async reverse(lat: number, lng: number): Promise<ReverseGeocodeResult> {
    const p = await nominatim<NominatimPlace>('/reverse', {
      lat: String(lat),
      lon: String(lng),
      zoom: '18',
      addressdetails: '1',
    });
    return { address: formatKoreanAddress(p), ...regionsFromNominatim(p.address), source: 'nominatim' };
  },

  async news(): Promise<{ enabled: boolean; items: NewsItem[] }> {
    return { enabled: false, items: [] };
  },

  /** 정적 배포에서는 이 기기에만 저장된다 */
  async createDeal(input: CreateDealInput): Promise<{ deal: Deal; store: Store }> {
    if (!input.store.name.trim() || input.title.trim().length < 2)
      throw new ApiError('매장 이름과 행사 제목을 입력해 주세요', 400);
    if (input.originalPrice && input.salePrice !== undefined && input.salePrice > input.originalPrice) {
      throw new ApiError('할인가가 정가보다 비쌉니다', 400);
    }
    const data = localData();
    const now = new Date().toISOString();
    const storeId = input.store.id ?? `local:${crypto.randomUUID()}`;
    let store = data.stores.find((s) => s.id === storeId);
    if (!store) {
      store = {
        id: storeId,
        name: input.store.name.trim(),
        category: input.store.category,
        lat: input.store.lat,
        lng: input.store.lng,
        address: input.store.address,
        phone: input.store.phone,
        sources: ['community'],
      };
      data.stores.push(store);
    }
    const deal: Deal = {
      id: `local:${crypto.randomUUID()}`,
      storeId,
      title: input.title.trim(),
      productName: input.productName,
      description: input.description,
      type: input.type,
      category: input.store.category,
      originalPrice: input.originalPrice,
      salePrice: input.salePrice,
      discountRate: input.discountRate,
      unit: input.unit,
      startDate: input.startDate,
      endDate: input.endDate,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      days: input.days,
      tags: input.tags ?? [],
      source: 'community',
      createdAt: now,
      updatedAt: now,
      likes: 0,
      confirms: 0,
      expiredReports: 0,
    };
    data.deals.push(deal);
    saveValue(LOCAL_KEY, data);
    return { deal, store };
  },

  async vote(dealId: string, action: VoteAction): Promise<VoteResult & { duplicate: boolean }> {
    const votes = localVotes();
    const r = (votes[dealId] ??= { likes: 0, confirms: 0, expiredReports: 0 });
    if (action === 'like') r.likes += 1;
    if (action === 'confirm') r.confirms += 1;
    if (action === 'expired') r.expiredReports += 1;
    saveValue(VOTES_KEY, votes);
    // 화면에 보이는 값은 원래 값 + 내 반응이라 원래 행사 값은 화면에서 더한다
    return { dealId, ...r, duplicate: false };
  },
};
