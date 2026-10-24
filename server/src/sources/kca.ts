import path from 'node:path';
import {
  addDays,
  categoryFromText,
  detectBrand,
  chainTilesToStores,
  kcaBrandPromotions,
  kcaChainTileFile,
  kcaChainTilesForCircle,
  kcaCompare,
  kcaDeals,
  kcaNearbyStores,
  kcaTileFile,
  kcaTilesForCircle,
  kstNow,
  normalizeDate,
  KCA_SNAPSHOT_VERSION,
  type CategoryId,
  type Deal,
  type BrandPromotion,
  type KcaBrandFile,
  type KcaChainTileFile,
  type KcaManifest,
  type KcaProductsFile,
  type KcaTileFile,
  type LatLng,
  type PriceCompareGroup,
  type Store,
  type StoreWithDistance,
} from '@sale-radar/shared';
import { readJson } from '../lib/cache.ts';
import { HttpError, fetchText } from '../lib/http.ts';
import { OpenApiError, parseOpenApiItems } from '../lib/xml.ts';

/**
 * 한국소비자원 참가격 (생필품 가격 정보) - 공공데이터포털
 * https://www.data.go.kr/data/15158701/openapi.do
 * 전국 대형마트·SSM·백화점·편의점·전통시장의 생필품 가격을 매주 금요일 기준으로 조사.
 * 각 가격에 할인 여부(goodDcYn), 할인 기간, 1+1 여부(plusoneYn)가 들어 있다.
 *
 * - KcaClient : API 호출 (하루 한 번 도는 업데이트 작업만 쓴다, src/kca-update.ts)
 * - KcaSource : 업데이트 작업이 만든 스냅샷 파일을 읽어 검색에 쓴다 (검색할 때 API 를 부르지 않음)
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

/* -------------------------------- API 호출 -------------------------------- */

/** 다시 시도해도 소용없는 오류 (인증키·활용신청 문제) */
const FATAL =
  /SERVICE_KEY_IS_NOT_REGISTERED|SERVICE_ACCESS_DENIED|DEADLINE_HAS_EXPIRED|UNREGISTERED_IP|SERVICE_KEY_IS_NULL|NO_OPENAPI_SERVICE|^(20|30|31|32|33|12)$/;

export class KcaApiError extends Error {
  constructor(
    message: string,
    readonly fatal: boolean,
  ) {
    super(message);
    this.name = 'KcaApiError';
  }
}

/** 공공데이터포털 키는 Encoding(%인코딩됨)·Decoding 두 모양이 있어 어느 쪽을 넣어도 되게 원래 값으로 돌린다 */
export function normalizeServiceKey(key: string): string {
  const k = key.trim();
  if (!/%[0-9A-Fa-f]{2}/.test(k)) return k;
  try {
    return decodeURIComponent(k);
  } catch {
    return k;
  }
}

export interface KcaClientOptions {
  key: string;
  baseUrl: string;
  retries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
}

export class KcaClient {
  readonly calls = { total: 0, failed: 0 };

  constructor(private readonly options: KcaClientOptions) {}

  private async call(
    op: string,
    params: Record<string, string>,
    keyParam = 'ServiceKey',
  ): Promise<Record<string, string>[]> {
    const qs = new URLSearchParams({ [keyParam]: normalizeServiceKey(this.options.key), ...params });
    const url = `${this.options.baseUrl}/${op}?${qs}`;
    const retries = this.options.retries ?? 3;
    let lastErr: unknown;
    for (let attempt = 0; attempt <= retries; attempt++) {
      this.calls.total++;
      try {
        const xml = await fetchText(url, { timeoutMs: this.options.timeoutMs ?? 60_000 });
        return parseOpenApiItems(xml);
      } catch (err) {
        this.calls.failed++;
        const msg = err instanceof Error ? err.message : String(err);
        const code = err instanceof OpenApiError ? (err.code ?? '') : '';
        if (FATAL.test(msg) || FATAL.test(code)) {
          throw new KcaApiError(
            `인증키 또는 활용신청 문제: ${msg} (공공데이터포털에서 활용신청 승인 여부와 인증키를 확인하세요. 승인 직후에는 1~2시간 걸릴 수 있어요)`,
            true,
          );
        }
        if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
          throw new KcaApiError(`HTTP ${err.status}: 인증키를 확인하세요`, true);
        }
        lastErr = err;
        if (attempt < retries)
          await new Promise((r) => setTimeout(r, (this.options.retryDelayMs ?? 2000) * 2 ** attempt));
      }
    }
    throw new KcaApiError(lastErr instanceof Error ? lastErr.message : String(lastErr), false);
  }

  async stores(): Promise<KcaStoreRaw[]> {
    return (await this.call('getStoreInfoSvc.do', {})) as unknown as KcaStoreRaw[];
  }

  async products(): Promise<KcaProductRaw[]> {
    return (await this.call('getProductInfoSvc.do', {})) as unknown as KcaProductRaw[];
  }

  /** 한 상품의 전국 판매점 가격 (조사일 YYYY-MM-DD) */
  async pricesByProduct(goodId: string, inspectDay: string): Promise<KcaPriceRaw[]> {
    return (await this.call(
      'getProductPriceInfoSvc',
      { goodInspectDay: inspectDay.replaceAll('-', ''), goodId },
      'serviceKey',
    )) as unknown as KcaPriceRaw[];
  }
}

/* ------------------------------ 스냅샷 읽기 ------------------------------ */

interface Loaded {
  manifest: KcaManifest;
  products: KcaProductsFile;
  brands: BrandPromotion[];
  mtime: number;
}

/**
 * 하루 한 번 만든 참가격 스냅샷(data/kca)을 읽는다. 파일이 바뀌면 다시 읽는다.
 */
export class KcaSource {
  private loaded?: Promise<Loaded | null>;
  private checkedAt = 0;
  private tiles = new Map<string, Promise<KcaTileFile | null>>();

  constructor(private readonly dir: string) {}

  /** 스냅샷이 있으면 manifest, 없으면 null */
  async manifest(): Promise<KcaManifest | null> {
    return (await this.load())?.manifest ?? null;
  }

  private async load(): Promise<Loaded | null> {
    const now = Date.now();
    if (this.loaded && now - this.checkedAt < 30_000) return this.loaded;
    this.checkedAt = now;
    const current = await this.loaded;
    const manifestPath = path.join(this.dir, 'manifest.json');
    const { stat } = await import('node:fs/promises');
    const mtime = await stat(manifestPath).then(
      (s) => s.mtimeMs,
      () => 0,
    );
    if (current && current.mtime === mtime) return this.loaded!;
    this.tiles.clear();
    this.chainTileCache.clear();
    this.loaded = (async () => {
      if (!mtime) return null;
      const manifest = await readJson<KcaManifest>(manifestPath);
      if (!manifest || manifest.version !== KCA_SNAPSHOT_VERSION) return null;
      const products = (await readJson<KcaProductsFile>(path.join(this.dir, 'products.json'))) ?? {};
      const brandFile = (await readJson<KcaBrandFile>(path.join(this.dir, 'brands.json'))) ?? { stores: [] };
      const brands = kcaBrandPromotions(brandFile, products, manifest.inspectDay);
      return { manifest, products, brands, mtime };
    })().catch((err) => {
      console.warn('[kca] 스냅샷을 읽지 못했습니다:', (err as Error).message);
      return null;
    });
    return this.loaded;
  }

  private chainTileCache = new Map<string, Promise<KcaChainTileFile | null>>();

  /** 반경 안의 체인 매장 (편의점·마트, 전국 위치를 미리 받아 둔 것) */
  async chainStores(center: LatLng, radius: number): Promise<Store[]> {
    const loaded = await this.load();
    if (!loaded) return [];
    const keys = kcaChainTilesForCircle(loaded.manifest, center, radius);
    const tiles = await Promise.all(
      keys.map((key) => {
        let p = this.chainTileCache.get(key);
        if (!p) {
          p = readJson<KcaChainTileFile>(path.join(this.dir, kcaChainTileFile(key))).then((v) => v ?? null);
          this.chainTileCache.set(key, p);
        }
        return p;
      }),
    );
    return chainTilesToStores(
      tiles.filter((t): t is KcaChainTileFile => Boolean(t)),
      center,
      radius,
    );
  }

  private tile(key: string): Promise<KcaTileFile | null> {
    let p = this.tiles.get(key);
    if (!p) {
      p = readJson<KcaTileFile>(path.join(this.dir, kcaTileFile(key))).then((v) => v ?? null);
      this.tiles.set(key, p);
    }
    return p;
  }

  private async nearby(center: LatLng, radius: number) {
    const loaded = await this.load();
    if (!loaded) return null;
    const keys = kcaTilesForCircle(loaded.manifest, center, radius);
    const tiles = (await Promise.all(keys.map((k) => this.tile(k)))).filter((t): t is KcaTileFile => Boolean(t));
    return { loaded, nearby: kcaNearbyStores(tiles, center, radius) };
  }

  async deals(
    center: LatLng,
    radius: number,
  ): Promise<{ deals: Deal[]; stores: StoreWithDistance[]; manifest: KcaManifest } | null> {
    const r = await this.nearby(center, radius);
    if (!r) return null;
    return {
      deals: kcaDeals(r.nearby, r.loaded.products, r.loaded.manifest.inspectDay),
      stores: r.nearby.map((n) => n.store),
      manifest: r.loaded.manifest,
    };
  }

  /** 본사(전국 공통) 가격의 할인·1+1 → 브랜드 행사 */
  async brandPromotions(): Promise<BrandPromotion[]> {
    return (await this.load())?.brands ?? [];
  }

  async stores(center: LatLng, radius: number): Promise<Store[]> {
    return (await this.nearby(center, radius))?.nearby.map((n) => n.store) ?? [];
  }

  async compare(
    center: LatLng,
    radius: number,
    q: string,
  ): Promise<{ groups: PriceCompareGroup[]; manifest: KcaManifest } | null> {
    const r = await this.nearby(center, radius);
    if (!r) return null;
    return {
      groups: kcaCompare(r.nearby, r.loaded.products, q, r.loaded.manifest.inspectDay),
      manifest: r.loaded.manifest,
    };
  }
}
