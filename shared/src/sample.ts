import { addDays, distanceMeters, kstNow } from './deal-utils.ts';
import type { CategoryId, Deal, DealTypeId, LatLng, Store } from './types.ts';

/**
 * 샘플 데이터 생성기.
 * API 키가 없어도 앱의 모든 기능을 바로 써 볼 수 있도록, 가상의 매장과 행사를 만든다.
 * - 매장 이름에는 모두 [샘플] 표시가 붙고, 실제 상호/브랜드는 쓰지 않는다.
 * - 같은 지역·같은 주에는 항상 같은 결과가 나오도록 시드를 고정한다.
 */

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** mulberry32 */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Template {
  type: DealTypeId;
  title: string;
  product?: string;
  original?: number;
  sale?: number;
  rate?: number;
  unit?: string;
  time?: [string, string];
  days?: number[];
  desc?: string;
  tags?: string[];
}

const STORE_NAMES: Record<CategoryId, string[]> = {
  food: [
    '한입분식',
    '할매국밥',
    '골목치킨',
    '화덕피자집',
    '온기식당',
    '바삭돈까스',
    '명가칼국수',
    '청춘떡볶이',
    '불향고깃집',
    '초밥공방',
    '마라공방',
    '수제버거하우스',
    '김밥나라',
    '도시락연구소',
    '족발명가',
    '쌀국수집',
    '중화반점 홍',
    '이자카야 달',
  ],
  cafe: ['카페 모퉁이', '커피정원', '달빛카페', '디저트연구소', '빙수당', '카페 한모금', '찻집 차향', '로스터리 오후'],
  bakery: ['동네빵집', '아침베이커리', '크루아상공방', '식빵연구소', '케이크하우스', '밀과버터'],
  convenience: ['24시 바로편의점', '골목편의점', '해피24', '우리편의점'],
  mart: ['행복마트', '알뜰슈퍼', '동네식자재마트', '싱싱마트', '우리동네슈퍼', '365할인마트'],
  fresh: ['싱싱청과', '한우정육점', '바다수산', '제철과일가게', '오늘반찬', '산지직송 농산물'],
  fashion: ['옷장 아울렛', '슈즈팩토리', '데일리룩', '가방가게 백앤백', '양말공장'],
  beauty: ['뷰티스토어', '코스메틱하우스', '향수공방', '네일&뷰티'],
  health: ['행복약국', '건강드럭스토어', '튼튼약국'],
  electronics: ['디지털하우스', '스마트폰상점', '생활가전마트'],
  living: ['천원생활용품', '문구나라', '리빙하우스', '꽃집 플로라', '반려동물용품점'],
  etc: ['동네상점'],
};

const CATEGORY_WEIGHTS: [CategoryId, number][] = [
  ['food', 30],
  ['cafe', 14],
  ['bakery', 7],
  ['convenience', 9],
  ['mart', 8],
  ['fresh', 7],
  ['fashion', 7],
  ['beauty', 5],
  ['health', 4],
  ['electronics', 3],
  ['living', 6],
];

const TEMPLATES: Record<CategoryId, Template[]> = {
  food: [
    {
      type: 'happy_hour',
      title: '생맥주 해피아워 50%',
      product: '생맥주 500cc',
      original: 4500,
      rate: 50,
      time: ['17:00', '19:00'],
    },
    {
      type: 'discount',
      title: '평일 점심 특선 할인',
      product: '점심 정식',
      original: 11000,
      sale: 8900,
      time: ['11:00', '14:00'],
      days: [1, 2, 3, 4, 5],
    },
    {
      type: 'closing_sale',
      title: '마감 전 포장 30% 할인',
      product: '포장 메뉴 전체',
      rate: 30,
      time: ['20:30', '22:00'],
    },
    { type: 'opening', title: '오픈 기념 전 메뉴 20% 할인', rate: 20, desc: '신규 오픈 2주간 진행합니다.' },
    { type: 'gift', title: '2인 이상 방문 시 음료 1병 서비스', product: '음료 1병', desc: '테이블당 1회 제공' },
    {
      type: 'coupon',
      title: '리뷰 작성 시 사이드 메뉴 증정',
      desc: '방문 후 리뷰를 보여주시면 사이드 메뉴 1개를 드려요.',
    },
    { type: 'discount', title: '후라이드 치킨 3,000원 할인', product: '후라이드 치킨', original: 20000, sale: 17000 },
    { type: 'bundle', title: '떡볶이+튀김+순대 세트', product: '분식 세트', original: 14000, sale: 11000 },
    {
      type: 'time_sale',
      title: '오후 3~5시 국수 반값',
      product: '잔치국수',
      original: 7000,
      sale: 3500,
      time: ['15:00', '17:00'],
    },
    {
      type: 'discount',
      title: '주말 가족세트 15% 할인',
      product: '가족 세트 (3~4인)',
      original: 39000,
      rate: 15,
      days: [0, 6],
    },
  ],
  cafe: [
    {
      type: 'time_sale',
      title: '모닝 아메리카노 1,500원',
      product: '아메리카노',
      original: 3000,
      sale: 1500,
      time: ['07:00', '10:00'],
    },
    { type: 'one_plus_one', title: '카페라떼 1+1', product: '카페라떼', sale: 4500, time: ['14:00', '17:00'] },
    {
      type: 'closing_sale',
      title: '마감 조각케이크 40% 할인',
      product: '조각케이크',
      original: 6500,
      rate: 40,
      time: ['21:00', '22:00'],
    },
    { type: 'coupon', title: '스탬프 2배 적립 주간', desc: '음료 1잔당 스탬프 2개 적립' },
    { type: 'discount', title: '시즌 음료 출시 기념 20%', product: '시즌 라떼', original: 5500, sale: 4400 },
    { type: 'bundle', title: '음료 2잔 + 디저트 세트', product: '커플 세트', original: 16000, sale: 12900 },
  ],
  bakery: [
    {
      type: 'closing_sale',
      title: '마감 빵 최대 50% 할인',
      product: '당일 생산 빵',
      rate: 50,
      time: ['21:00', '22:30'],
    },
    { type: 'one_plus_one', title: '우유식빵 1+1', product: '우유식빵', sale: 4800, time: ['16:00', '19:00'] },
    { type: 'bundle', title: '크루아상 3개 7,500원', product: '크루아상 x3', original: 10500, sale: 7500 },
    { type: 'gift', title: '홀케이크 구매 시 캔들·카드 증정', product: '홀케이크' },
    {
      type: 'discount',
      title: '오전 갓 구운 바게트 할인',
      product: '바게트',
      original: 4000,
      sale: 3000,
      time: ['08:00', '11:00'],
    },
  ],
  convenience: [
    { type: 'one_plus_one', title: '컵라면 1+1', product: '컵라면 (큰컵)', sale: 1800 },
    { type: 'two_plus_one', title: '탄산음료 2+1', product: '탄산음료 500ml', sale: 2200 },
    { type: 'discount', title: '도시락 20% 할인', product: '정식 도시락', original: 5500, rate: 20 },
    {
      type: 'closing_sale',
      title: '유통기한 임박 샌드위치 50%',
      product: '샌드위치',
      original: 3600,
      rate: 50,
      time: ['21:00', '23:59'],
    },
    { type: 'bundle', title: '맥주 4캔 11,000원', product: '맥주 500ml x4', original: 16000, sale: 11000 },
    { type: 'two_plus_one', title: '과자 2+1', product: '봉지과자', sale: 1700 },
    { type: 'one_plus_one', title: '컵커피 1+1', product: '컵커피 250ml', sale: 2700 },
  ],
  mart: [
    {
      type: 'discount',
      title: '삼겹살 100g 1,290원',
      product: '국내산 삼겹살',
      unit: '100g',
      original: 2690,
      sale: 1290,
      days: [5, 6, 0],
      desc: '금·토·일 3일간, 1인 2kg 한정',
    },
    {
      type: 'time_sale',
      title: '타임세일: 특란 30구',
      product: '특란 30구',
      original: 8990,
      sale: 5990,
      time: ['17:00', '19:00'],
    },
    { type: 'one_plus_one', title: '흰우유 1+1', product: '흰우유', unit: '900ml', sale: 2980 },
    { type: 'discount', title: '라면 5입 번들 할인', product: '라면 5개입', original: 4980, sale: 3480 },
    { type: 'closing_sale', title: '마감 초밥·회 30% 할인', product: '초밥·회', rate: 30, time: ['20:00', '22:00'] },
    { type: 'two_plus_one', title: '세제·휴지 2+1', product: '생활용품 지정상품', sale: 6900 },
    { type: 'discount', title: '제철 사과 1봉 할인', product: '사과', unit: '1.5kg', original: 12900, sale: 8900 },
    { type: 'discount', title: '수입 바나나 한 송이', product: '바나나', unit: '1송이', original: 3980, sale: 2480 },
  ],
  fresh: [
    { type: 'discount', title: '한우 등심 30% 할인', product: '한우 등심', unit: '100g', original: 12000, rate: 30 },
    {
      type: 'time_sale',
      title: '오늘 들어온 고등어 2마리 5,000원',
      product: '생물 고등어 x2',
      original: 8000,
      sale: 5000,
      time: ['10:00', '13:00'],
    },
    { type: 'closing_sale', title: '마감 과일 떨이 할인', product: '제철 과일', rate: 40, time: ['19:30', '21:00'] },
    { type: 'bundle', title: '반찬 3팩 10,000원', product: '반찬 3팩', original: 13500, sale: 10000 },
    {
      type: 'discount',
      title: '감자·양파 한 봉지 균일가',
      product: '감자/양파',
      unit: '1봉',
      original: 4500,
      sale: 2900,
    },
  ],
  fashion: [
    { type: 'discount', title: '시즌오프 최대 50%', rate: 50, desc: '일부 품목 제외' },
    { type: 'coupon', title: '첫 구매 10% 쿠폰', rate: 10, desc: '회원 가입 시 즉시 사용 가능' },
    { type: 'bundle', title: '양말 5켤레 9,900원', product: '양말 5켤레', original: 15000, sale: 9900 },
    { type: 'gift', title: '5만원 이상 구매 시 에코백 증정', product: '에코백' },
    { type: 'discount', title: '운동화 전품목 20%', product: '운동화', rate: 20 },
  ],
  beauty: [
    { type: 'one_plus_one', title: '마스크팩 1+1', product: '시트 마스크팩', sale: 3000 },
    { type: 'discount', title: '선크림 30% 할인', product: '선크림 50ml', original: 22000, rate: 30 },
    { type: 'gift', title: '구매 금액별 샘플 증정', desc: '2만원 이상 구매 시 샘플 키트 증정' },
    { type: 'two_plus_one', title: '립밤 2+1', product: '립밤', sale: 5900 },
  ],
  health: [
    { type: 'discount', title: '종합비타민 20% 할인', product: '종합비타민 60정', original: 25000, rate: 20 },
    { type: 'two_plus_one', title: '파스 2+1', product: '파스 1팩', sale: 4000 },
    { type: 'gift', title: '3만원 이상 구매 시 건강음료 증정', product: '건강음료' },
  ],
  electronics: [
    { type: 'discount', title: '무선 이어폰 25% 할인', product: '무선 이어폰', original: 89000, rate: 25 },
    { type: 'coupon', title: '휴대폰 케이스 5천원 할인 쿠폰', product: '휴대폰 케이스', original: 15000, sale: 10000 },
    { type: 'gift', title: '충전기 구매 시 케이블 증정', product: '고속 충전기' },
  ],
  living: [
    { type: 'discount', title: '주방용품 최대 40%', rate: 40 },
    { type: 'two_plus_one', title: '문구류 2+1', product: '볼펜·노트', sale: 1500 },
    { type: 'bundle', title: '호텔수건 3장 9,900원', product: '수건 3장', original: 15000, sale: 9900 },
    { type: 'discount', title: '반려견 사료 15% 할인', product: '반려견 사료 2kg', original: 28000, rate: 15 },
    {
      type: 'time_sale',
      title: '꽃다발 오후 타임세일',
      product: '미니 꽃다발',
      original: 15000,
      sale: 9900,
      time: ['16:00', '19:00'],
    },
  ],
  etc: [{ type: 'discount', title: '전 품목 10% 할인', rate: 10 }],
};

/** 셀 크기: 위도 0.01°(약 1.1km) */
const CELL = 0.01;
const STORES_PER_CELL = 28;

function pickWeighted<T>(rand: () => number, items: [T, number][]): T {
  const total = items.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [item, w] of items) {
    r -= w;
    if (r <= 0) return item;
  }
  return items[items.length - 1][0];
}

const pick = <T>(rand: () => number, arr: T[]): T => arr[Math.floor(rand() * arr.length)];

/** 이번 주 월요일 (KST) */
function weekStart(today: string): string {
  const wd = new Date(`${today}T00:00:00Z`).getUTCDay();
  return addDays(today, -((wd + 6) % 7));
}

function roundPrice(v: number): number {
  return v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);
}

export interface SampleResult {
  stores: Store[];
  deals: Deal[];
}

function cellStores(cellLat: number, cellLng: number): Store[] {
  const rand = seededRandom(hashString(`store:${cellLat}:${cellLng}`));
  const stores: Store[] = [];
  const used = new Map<string, number>();
  for (let i = 0; i < STORES_PER_CELL; i++) {
    const category = pickWeighted(rand, CATEGORY_WEIGHTS);
    let base = pick(rand, STORE_NAMES[category]);
    // 같은 셀 안에서 같은 이름이 겹치면 지점 번호를 붙인다
    const n = (used.get(base) ?? 0) + 1;
    used.set(base, n);
    if (n > 1) base = `${base} ${n}호점`;
    stores.push({
      id: `sample:${cellLat.toFixed(2)}:${cellLng.toFixed(2)}:${i}`,
      name: `[샘플] ${base}`,
      category,
      categoryDetail: '샘플 데이터 (실제 매장이 아닙니다)',
      lat: cellLat + rand() * CELL,
      lng: cellLng + rand() * CELL,
      address: '샘플 주소',
      phone: undefined,
      openingHours: category === 'convenience' ? '24/7' : 'Mo-Su 10:00-22:00',
      sources: ['sample'],
    });
  }
  return stores;
}

function storeDeals(store: Store, week: string, today: string): Deal[] {
  const rand = seededRandom(hashString(`deal:${store.id}:${week}`));
  const templates = TEMPLATES[store.category];
  const count = 1 + Math.floor(rand() * 2.6); // 1~3개
  const chosen = new Set<number>();
  const deals: Deal[] = [];
  for (let n = 0; n < count && chosen.size < templates.length; n++) {
    let idx = Math.floor(rand() * templates.length);
    while (chosen.has(idx)) idx = (idx + 1) % templates.length;
    chosen.add(idx);
    const t = templates[idx];

    // 기간: 이번 주 근처에서 시작, 2~21일 진행. 일부는 오늘/내일 끝난다.
    const startOffset = -Math.floor(rand() * 10);
    const start = addDays(week, startOffset);
    const roll = rand();
    let end: string | undefined;
    if (t.type === 'opening') end = addDays(start, 13);
    else if (roll < 0.15) end = today;
    else if (roll < 0.3) end = addDays(today, 1);
    else if (roll < 0.85) end = addDays(start, 7 + Math.floor(rand() * 21));
    else end = undefined; // 상시
    if (end && end < today) end = addDays(today, Math.floor(rand() * 5));

    let original = t.original;
    let sale = t.sale;
    if (original && sale === undefined && t.rate) sale = roundPrice(original * (1 - t.rate / 100));
    // 가격에 약간의 변화를 줘서 매장마다 다르게
    const jitter = 1 + (rand() - 0.5) * 0.12;
    if (original) original = roundPrice(original * jitter);
    if (sale) sale = roundPrice(sale * jitter);

    const createdAt = new Date(
      Date.parse(`${start}T09:00:00+09:00`) + Math.floor(rand() * 10 * 3600_000),
    ).toISOString();
    deals.push({
      id: `${store.id}:${week}:${idx}`,
      storeId: store.id,
      title: t.title,
      productName: t.product,
      description: `${t.desc ? `${t.desc} ` : ''}※ 샘플 데이터입니다. 실제 행사가 아닙니다.`,
      type: t.type,
      category: store.category,
      originalPrice: original,
      salePrice: sale,
      discountRate: t.rate && !(original && sale) ? t.rate : undefined,
      unit: t.unit,
      startDate: start,
      endDate: end,
      timeStart: t.time?.[0],
      timeEnd: t.time?.[1],
      days: t.days,
      tags: [...(t.tags ?? []), '샘플'],
      source: 'sample',
      createdAt,
      updatedAt: createdAt,
      likes: Math.floor(rand() * 60),
      confirms: Math.floor(rand() * 25),
      expiredReports: 0,
      isSample: true,
    });
  }
  return deals;
}

export function generateSampleData(center: LatLng, radius: number, now = kstNow()): SampleResult {
  const baseLat = Math.floor(center.lat / CELL) * CELL;
  const baseLng = Math.floor(center.lng / CELL) * CELL;
  const week = weekStart(now.date);
  const stores: Store[] = [];
  const deals: Deal[] = [];
  // 경도 1칸은 약 0.88km 라서 좌우로 2칸씩 본다
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const cellLat = Number((baseLat + dy * CELL).toFixed(2));
      const cellLng = Number((baseLng + dx * CELL).toFixed(2));
      for (const store of cellStores(cellLat, cellLng)) {
        if (distanceMeters(center, store) > radius) continue;
        stores.push(store);
        deals.push(...storeDeals(store, week, now.date));
      }
    }
  }
  return { stores, deals };
}
