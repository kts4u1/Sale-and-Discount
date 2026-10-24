/**
 * 서버와 클라이언트가 함께 쓰는 데이터 타입.
 */

export type CategoryId =
  | 'food'
  | 'cafe'
  | 'bakery'
  | 'convenience'
  | 'mart'
  | 'fresh'
  | 'fashion'
  | 'beauty'
  | 'health'
  | 'electronics'
  | 'living'
  | 'etc';

export type DealTypeId =
  | 'discount'
  | 'one_plus_one'
  | 'two_plus_one'
  | 'time_sale'
  | 'closing_sale'
  | 'happy_hour'
  | 'gift'
  | 'coupon'
  | 'bundle'
  | 'opening'
  | 'good_price';

export type SortId = 'recommended' | 'distance' | 'discount' | 'ending' | 'price' | 'newest' | 'popular';

/** 행사 정보의 출처 */
export type DealSource = 'kca' | 'community' | 'brand' | 'goodprice' | 'sample';

/** 매장 정보의 출처 */
export type StoreSource = 'osm' | 'kakao' | 'kca' | 'community' | 'goodprice' | 'sample';

export type SourceId = DealSource | 'osm' | 'kakao' | 'naver';

export interface LatLng {
  lat: number;
  lng: number;
}

export interface Store {
  id: string;
  name: string;
  category: CategoryId;
  /** 예: "음식점 > 한식 > 국밥" */
  categoryDetail?: string;
  brand?: string;
  lat: number;
  lng: number;
  address?: string;
  roadAddress?: string;
  phone?: string;
  url?: string;
  openingHours?: string;
  sources: StoreSource[];
}

export interface StoreWithDistance extends Store {
  /** 검색 중심에서의 직선거리(m) */
  distance: number;
  /** 도보 예상 시간(분) */
  walkMinutes: number;
  dealCount: number;
}

export interface PriceItem {
  name: string;
  price: number;
}

export interface PriceCompare {
  /** 같은 상품의 주변 매장 평균가 */
  avg: number;
  min: number;
  max: number;
  storeCount: number;
}

export interface Deal {
  id: string;
  storeId: string;
  title: string;
  description?: string;
  productName?: string;
  type: DealTypeId;
  category: CategoryId;
  originalPrice?: number;
  salePrice?: number;
  /** 0~100. 비워 두면 가격으로 계산 */
  discountRate?: number;
  /** 용량/규격. 예: "1L", "500g x 2" */
  unit?: string;
  /** YYYY-MM-DD (한국 시간, 포함) */
  startDate?: string;
  endDate?: string;
  /** HH:MM, 매일 반복되는 시간대 (예: 마감할인 20:00~22:00) */
  timeStart?: string;
  timeEnd?: string;
  /** 진행 요일 (0=일 ... 6=토). 비우면 매일 */
  days?: number[];
  /** 메뉴/상품별 가격 목록 (착한가격업소 등) */
  items?: PriceItem[];
  tags: string[];
  source: DealSource;
  sourceUrl?: string;
  /** 같은 브랜드 행사를 하는 다른 주변 매장 */
  otherStoreIds?: string[];
  priceCompare?: PriceCompare;
  createdAt: string;
  updatedAt: string;
  likes: number;
  confirms: number;
  expiredReports: number;
  isSample?: boolean;
}

export type DealStatus = 'active' | 'later_today' | 'upcoming' | 'ended';

export interface DealView extends Deal {
  store: StoreWithDistance;
  distance: number;
  walkMinutes: number;
  status: DealStatus;
  /** 지금 이 순간 혜택을 받을 수 있는지 */
  activeNow: boolean;
  /** 오늘 종료/마감 임박 (1시간 이내 또는 종료일이 오늘) */
  endingSoon: boolean;
  /** 남은 시간(분). 시간대 행사는 오늘 마감까지, 기간 행사는 종료일 자정까지 */
  endsInMinutes?: number;
  /** 시작까지 남은 시간(분) */
  startsInMinutes?: number;
  /** 정렬·비교용 실질 할인율 (1+1=50, 2+1=33) */
  effectiveDiscount: number;
  otherStores?: { id: string; name: string; distance: number }[];
}

export interface SearchQuery {
  lat: number;
  lng: number;
  radius: number;
  categories?: CategoryId[];
  types?: DealTypeId[];
  q?: string;
  sort?: SortId;
  includeSample?: boolean;
  activeOnly?: boolean;
  minDiscount?: number;
  maxPrice?: number;
}

export interface SourceStatus {
  id: SourceId;
  label: string;
  enabled: boolean;
  ok: boolean;
  /** 이 소스에서 가져온 항목 수 */
  count: number;
  message?: string;
  durationMs?: number;
  /** 아직 불러오는 중 (잠시 후 다시 검색하면 채워짐) */
  pending?: boolean;
  /** 활성화에 필요한 환경변수 */
  requires?: string;
}

export interface SearchStats {
  totalDeals: number;
  totalStores: number;
  activeNow: number;
  endingSoon: number;
  byCategory: Partial<Record<CategoryId, number>>;
  byType: Partial<Record<DealTypeId, number>>;
  bySource: Partial<Record<DealSource, number>>;
  maxDiscount: number;
  avgDiscount: number;
}

export interface SearchResponse {
  center: LatLng;
  radius: number;
  generatedAt: string;
  deals: DealView[];
  stores: StoreWithDistance[];
  sources: SourceStatus[];
  stats: SearchStats;
  sampleIncluded: boolean;
}

export interface PriceEntry {
  store: StoreWithDistance;
  price: number;
  isDiscount: boolean;
  isOnePlusOne: boolean;
  discountStart?: string;
  discountEnd?: string;
  inspectDay: string;
}

export interface PriceCompareGroup {
  productId: string;
  productName: string;
  unit?: string;
  entries: PriceEntry[];
  min: number;
  max: number;
  avg: number;
}

export interface PriceCompareResponse {
  q: string;
  center: LatLng;
  radius: number;
  inspectDay?: string;
  groups: PriceCompareGroup[];
  source: SourceStatus;
}

export interface GeocodeResult {
  name: string;
  address: string;
  lat: number;
  lng: number;
  source: 'kakao' | 'nominatim';
}

export interface ReverseGeocodeResult {
  address: string;
  region1?: string;
  region2?: string;
  region3?: string;
  source: 'kakao' | 'nominatim' | 'none';
}

export interface NewsItem {
  title: string;
  link: string;
  description: string;
  author?: string;
  date?: string;
}

export interface CreateDealInput {
  store: {
    id?: string;
    name: string;
    lat: number;
    lng: number;
    category: CategoryId;
    address?: string;
    phone?: string;
  };
  title: string;
  type: DealTypeId;
  productName?: string;
  description?: string;
  originalPrice?: number;
  salePrice?: number;
  discountRate?: number;
  unit?: string;
  startDate?: string;
  endDate?: string;
  timeStart?: string;
  timeEnd?: string;
  days?: number[];
  tags?: string[];
}

export type VoteAction = 'like' | 'confirm' | 'expired';

export interface VoteResult {
  dealId: string;
  likes: number;
  confirms: number;
  expiredReports: number;
}

export interface AppConfig {
  radiusOptions: number[];
  defaultRadius: number;
  sampleAvailable: boolean;
  sampleDefault: boolean;
  sources: SourceStatus[];
  tileUrl: string;
  tileAttribution: string;
}
