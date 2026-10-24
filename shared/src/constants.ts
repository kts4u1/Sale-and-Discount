import type { CategoryId, DealSource, DealTypeId, SortId, SourceId } from './types.ts';

/** 100m 단위로 1km 까지 선택 */
export const RADIUS_OPTIONS = [100, 200, 300, 400, 500, 600, 700, 800, 900, 1000] as const;
export const MIN_RADIUS = 100;
export const MAX_RADIUS = 1000;
export const DEFAULT_RADIUS = 500;

/** 성인 평균 보행 속도 약 4km/h */
export const WALK_METERS_PER_MINUTE = 67;

/** 위치를 못 받을 때 쓰는 기본 위치 (서울시청) */
export const DEFAULT_CENTER = { lat: 37.5666, lng: 126.9784 };

export interface CategoryInfo {
  id: CategoryId;
  label: string;
  emoji: string;
  color: string;
}

export const CATEGORIES: CategoryInfo[] = [
  { id: 'food', label: '음식점', emoji: '🍜', color: '#e8590c' },
  { id: 'cafe', label: '카페·디저트', emoji: '☕', color: '#8d5524' },
  { id: 'bakery', label: '베이커리', emoji: '🥐', color: '#d9a404' },
  { id: 'convenience', label: '편의점', emoji: '🏪', color: '#1c7ed6' },
  { id: 'mart', label: '마트·슈퍼', emoji: '🛒', color: '#2f9e44' },
  { id: 'fresh', label: '정육·수산·청과', emoji: '🥩', color: '#c92a2a' },
  { id: 'fashion', label: '패션·잡화', emoji: '👕', color: '#7048e8' },
  { id: 'beauty', label: '뷰티·화장품', emoji: '💄', color: '#d6336c' },
  { id: 'health', label: '약국·건강', emoji: '💊', color: '#0ca678' },
  { id: 'electronics', label: '가전·디지털', emoji: '📱', color: '#495057' },
  { id: 'living', label: '생활·문구', emoji: '🧺', color: '#1098ad' },
  { id: 'etc', label: '기타', emoji: '🏷️', color: '#868e96' },
];

export const CATEGORY_MAP: Record<CategoryId, CategoryInfo> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c]),
) as Record<CategoryId, CategoryInfo>;

export interface DealTypeInfo {
  id: DealTypeId;
  label: string;
  short: string;
  description: string;
}

export const DEAL_TYPES: DealTypeInfo[] = [
  { id: 'discount', label: '가격할인', short: '할인', description: '정가보다 싸게 판매' },
  { id: 'one_plus_one', label: '1+1', short: '1+1', description: '하나 사면 하나 더' },
  { id: 'two_plus_one', label: '2+1', short: '2+1', description: '두 개 사면 하나 더' },
  { id: 'time_sale', label: '타임세일', short: '타임', description: '정해진 시간에만 할인' },
  { id: 'closing_sale', label: '마감할인', short: '마감', description: '영업 마감 전 떨이 할인' },
  { id: 'happy_hour', label: '해피아워', short: '해피', description: '특정 시간대 음료·주류 할인' },
  { id: 'gift', label: '사은품·증정', short: '증정', description: '구매 시 상품 증정' },
  { id: 'coupon', label: '쿠폰·적립', short: '쿠폰', description: '쿠폰, 포인트 추가 적립' },
  { id: 'bundle', label: '묶음·세트', short: '세트', description: '세트/묶음 구매 할인' },
  { id: 'opening', label: '오픈이벤트', short: '오픈', description: '신규 오픈 기념 행사' },
  { id: 'good_price', label: '착한가격', short: '착한', description: '지자체 지정 착한가격업소' },
];

export const DEAL_TYPE_MAP: Record<DealTypeId, DealTypeInfo> = Object.fromEntries(
  DEAL_TYPES.map((t) => [t.id, t]),
) as Record<DealTypeId, DealTypeInfo>;

export const SORT_OPTIONS: { id: SortId; label: string }[] = [
  { id: 'recommended', label: '추천순' },
  { id: 'distance', label: '가까운순' },
  { id: 'discount', label: '할인율순' },
  { id: 'ending', label: '마감임박순' },
  { id: 'price', label: '낮은가격순' },
  { id: 'newest', label: '최신순' },
  { id: 'popular', label: '인기순' },
];

export const SOURCE_LABELS: Record<SourceId, string> = {
  kca: '한국소비자원 참가격',
  community: '사용자 제보',
  brand: '브랜드 행사',
  goodprice: '착한가격업소',
  sample: '샘플 데이터',
  osm: 'OpenStreetMap 매장',
  kakao: '카카오 로컬 매장',
  naver: '네이버 블로그 소식',
};

export const DEAL_SOURCE_SHORT: Record<DealSource, string> = {
  kca: '참가격',
  community: '제보',
  brand: '브랜드',
  goodprice: '착한가격',
  sample: '샘플',
};

export const DEAL_TYPE_IDS = DEAL_TYPES.map((t) => t.id);
export const CATEGORY_IDS = CATEGORIES.map((c) => c.id);
export const SORT_IDS = SORT_OPTIONS.map((s) => s.id);
