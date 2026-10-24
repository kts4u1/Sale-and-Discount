import type { CategoryId } from '@sale-radar/shared';

/* ------------------------------ 브랜드 인식 ------------------------------ */

interface BrandRule {
  brand: string;
  category: CategoryId;
  patterns: RegExp[];
}

/** 순서 중요: 더 구체적인 이름(이마트24)을 먼저 */
const BRAND_RULES: BrandRule[] = [
  { brand: '이마트24', category: 'convenience', patterns: [/이마트\s*24/i, /emart\s*24/i] },
  { brand: 'GS25', category: 'convenience', patterns: [/gs\s*25/i, /지에스\s*25/] },
  { brand: 'CU', category: 'convenience', patterns: [/^cu(\s|$|\(|-)/i, /\bcu\b/i, /씨유/] },
  { brand: '세븐일레븐', category: 'convenience', patterns: [/세븐\s*일레븐/, /7[-\s]?eleven/i, /세븐일레븐/] },
  { brand: '미니스톱', category: 'convenience', patterns: [/미니스톱/, /ministop/i] },
  { brand: '이마트에브리데이', category: 'mart', patterns: [/이마트\s*에브리데이/] },
  { brand: '노브랜드', category: 'mart', patterns: [/노브랜드/, /no\s*brand/i] },
  { brand: '이마트', category: 'mart', patterns: [/이마트/, /^e-?mart/i] },
  { brand: '홈플러스', category: 'mart', patterns: [/홈플러스/, /homeplus/i] },
  { brand: '롯데마트', category: 'mart', patterns: [/롯데마트/, /lotte\s*mart/i] },
  { brand: '롯데슈퍼', category: 'mart', patterns: [/롯데슈퍼/] },
  { brand: 'GS더프레시', category: 'mart', patterns: [/gs\s*(더)?\s*프레시/i, /gs\s*the\s*fresh/i, /gs수퍼/i] },
  { brand: '하나로마트', category: 'mart', patterns: [/하나로\s*마트/, /농협\s*하나로/] },
  { brand: '코스트코', category: 'mart', patterns: [/코스트코/, /costco/i] },
  { brand: '트레이더스', category: 'mart', patterns: [/트레이더스/] },
  { brand: '올리브영', category: 'beauty', patterns: [/올리브\s*영/, /olive\s*young/i] },
  { brand: '다이소', category: 'living', patterns: [/다이소/, /daiso/i] },
  { brand: '파리바게뜨', category: 'bakery', patterns: [/파리바게[뜨트]/, /paris\s*baguette/i] },
  { brand: '뚜레쥬르', category: 'bakery', patterns: [/뚜레쥬르/, /tous\s*les\s*jours/i] },
  { brand: '스타벅스', category: 'cafe', patterns: [/스타벅스/, /starbucks/i] },
  { brand: '투썸플레이스', category: 'cafe', patterns: [/투썸/, /a\s*twosome/i] },
  { brand: '이디야커피', category: 'cafe', patterns: [/이디야/, /ediya/i] },
  { brand: '메가MGC커피', category: 'cafe', patterns: [/메가\s*(mgc)?\s*커피/i, /mega\s*coffee/i] },
  { brand: '컴포즈커피', category: 'cafe', patterns: [/컴포즈\s*커피/, /compose\s*coffee/i] },
  { brand: '빽다방', category: 'cafe', patterns: [/빽다방/] },
  { brand: '배스킨라빈스', category: 'cafe', patterns: [/배스킨/, /baskin/i] },
  { brand: '던킨', category: 'cafe', patterns: [/던킨/, /dunkin/i] },
  { brand: '맥도날드', category: 'food', patterns: [/맥도날드/, /mcdonald/i] },
  { brand: '롯데리아', category: 'food', patterns: [/롯데리아/, /lotteria/i] },
  { brand: '버거킹', category: 'food', patterns: [/버거킹/, /burger\s*king/i] },
  { brand: '맘스터치', category: 'food', patterns: [/맘스터치/] },
  { brand: 'KFC', category: 'food', patterns: [/\bkfc\b/i, /케이에프씨/] },
  { brand: '서브웨이', category: 'food', patterns: [/서브웨이/, /subway/i] },
  { brand: 'BBQ', category: 'food', patterns: [/\bbbq\b/i, /비비큐/] },
  { brand: '교촌치킨', category: 'food', patterns: [/교촌/] },
  { brand: 'bhc', category: 'food', patterns: [/\bbhc\b/i] },
];

export function detectBrand(name: string | undefined): { brand: string; category: CategoryId } | undefined {
  if (!name) return undefined;
  for (const rule of BRAND_RULES) {
    if (rule.patterns.some((p) => p.test(name))) return { brand: rule.brand, category: rule.category };
  }
  return undefined;
}

/** "GS25" 같은 브랜드명이 매장 이름/브랜드에 해당하는지 */
export function matchesBrand(storeName: string, storeBrand: string | undefined, brand: string): boolean {
  if (storeBrand && storeBrand === brand) return true;
  return detectBrand(storeName)?.brand === brand;
}

/* --------------------------- 이름/분류 문자열 기반 --------------------------- */

const KEYWORD_RULES: [RegExp, CategoryId][] = [
  [/편의점/, 'convenience'],
  [/베이커리|제과|빵|도넛|케이크/, 'bakery'],
  [/카페|커피|디저트|아이스크림|전통찻집|떡카페|빙수|coffee|cafe/i, 'cafe'],
  [/정육|축산|고기마트|수산|생선|횟감|청과|과일|채소|야채|농산물/, 'fresh'],
  [/대형마트|슈퍼마켓|마트|슈퍼|식자재|할인점|백화점|전통시장|시장/, 'mart'],
  [/화장품|코스메틱|뷰티|향수|올리브영/, 'beauty'],
  [/약국|드럭|의료기|안경|건강식품|영양제|한약/, 'health'],
  [/의류|패션|옷|신발|가방|잡화|아울렛|스포츠|아동복|속옷|액세서리|주얼리|시계/, 'fashion'],
  [/가전|전자|휴대폰|핸드폰|컴퓨터|디지털|카메라|게임/, 'electronics'],
  [/생활용품|문구|서점|책|완구|장난감|인테리어|가구|꽃|화원|반려|애견|펫|주방|철물|다이소/, 'living'],
  [
    /음식점|식당|한식|중식|일식|양식|분식|치킨|피자|햄버거|패스트푸드|술집|호프|주점|국밥|고기|구이|뷔페|반찬|도시락|떡볶이|김밥|족발|보쌈|면|라멘|초밥|회|찌개/,
    'food',
  ],
];

export function categoryFromText(text: string | undefined): CategoryId | undefined {
  if (!text) return undefined;
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(text)) return cat;
  }
  return undefined;
}

/* ------------------------------ 카카오 분류 ------------------------------ */

export function categoryFromKakao(
  groupCode: string | undefined,
  categoryName: string | undefined,
  name?: string,
): CategoryId {
  const detail = categoryName ?? '';
  // 카카오 분류의 마지막 단계가 가장 구체적
  const lastParts = detail.split('>').map((s) => s.trim());
  const tail = lastParts.slice(1).join(' ');
  switch (groupCode) {
    case 'CS2':
      return 'convenience';
    case 'MT1':
      return 'mart';
    case 'PM9':
      return 'health';
    case 'CE7':
      return /베이커리|제과|도넛/.test(detail) ? 'bakery' : 'cafe';
    case 'FD6':
      if (/제과|베이커리|도넛/.test(detail)) return 'bakery';
      if (/카페|아이스크림|디저트/.test(tail)) return 'cafe';
      return 'food';
    default:
      return categoryFromText(tail) ?? categoryFromText(detail) ?? detectBrand(name)?.category ?? 'etc';
  }
}

/* ------------------------------ OSM 태그 분류 ------------------------------ */

const OSM_AMENITY: Record<string, CategoryId> = {
  restaurant: 'food',
  fast_food: 'food',
  food_court: 'food',
  bar: 'food',
  pub: 'food',
  biergarten: 'food',
  cafe: 'cafe',
  ice_cream: 'cafe',
  pharmacy: 'health',
  marketplace: 'mart',
};

const OSM_SHOP: Record<string, CategoryId> = {
  convenience: 'convenience',
  supermarket: 'mart',
  department_store: 'mart',
  general: 'mart',
  wholesale: 'mart',
  mall: 'mart',
  alcohol: 'mart',
  beverages: 'mart',
  wine: 'mart',
  bakery: 'bakery',
  pastry: 'bakery',
  confectionery: 'bakery',
  coffee: 'cafe',
  tea: 'cafe',
  butcher: 'fresh',
  seafood: 'fresh',
  greengrocer: 'fresh',
  farm: 'fresh',
  deli: 'fresh',
  cheese: 'fresh',
  dairy: 'fresh',
  frozen_food: 'fresh',
  rice: 'fresh',
  clothes: 'fashion',
  shoes: 'fashion',
  bag: 'fashion',
  boutique: 'fashion',
  fashion: 'fashion',
  fashion_accessories: 'fashion',
  jewelry: 'fashion',
  watches: 'fashion',
  sports: 'fashion',
  outdoor: 'fashion',
  leather: 'fashion',
  baby_goods: 'fashion',
  cosmetics: 'beauty',
  beauty: 'beauty',
  perfumery: 'beauty',
  chemist: 'beauty',
  medical_supply: 'health',
  optician: 'health',
  hearing_aids: 'health',
  nutrition_supplements: 'health',
  health_food: 'health',
  herbalist: 'health',
  electronics: 'electronics',
  mobile_phone: 'electronics',
  computer: 'electronics',
  hifi: 'electronics',
  appliance: 'electronics',
  camera: 'electronics',
  video_games: 'electronics',
  variety_store: 'living',
  houseware: 'living',
  hardware: 'living',
  doityourself: 'living',
  stationery: 'living',
  books: 'living',
  gift: 'living',
  toys: 'living',
  furniture: 'living',
  kitchen: 'living',
  interior_decoration: 'living',
  florist: 'living',
  pet: 'living',
  garden_centre: 'living',
  household_linen: 'living',
  bed: 'living',
  craft: 'living',
  second_hand: 'living',
  charity: 'living',
};

/** 할인 행사와 관계없는 서비스업 등은 제외 */
const OSM_SHOP_SKIP = new Set([
  'vacant',
  'car',
  'car_repair',
  'car_parts',
  'tyres',
  'hairdresser',
  'laundry',
  'dry_cleaning',
  'massage',
  'tattoo',
  'funeral_directors',
  'estate_agent',
  'money_lender',
  'pawnbroker',
  'travel_agency',
  'copyshop',
  'storage_rental',
  'motorcycle',
  'fuel',
  'lottery',
]);

export function categoryFromOsm(tags: Record<string, string>): CategoryId | undefined {
  const amenity = tags.amenity;
  if (amenity && OSM_AMENITY[amenity]) {
    if (amenity === 'cafe' && /bakery|빵|베이커리/.test(`${tags.cuisine ?? ''}${tags.name ?? ''}`)) return 'bakery';
    return OSM_AMENITY[amenity];
  }
  const shop = tags.shop;
  if (shop) {
    if (OSM_SHOP_SKIP.has(shop)) return undefined;
    return OSM_SHOP[shop] ?? detectBrand(tags.name)?.category ?? categoryFromText(tags.name) ?? 'etc';
  }
  return undefined;
}

/** OSM 태그를 사람이 읽을 수 있는 분류로 */
export function osmCategoryDetail(tags: Record<string, string>): string | undefined {
  const parts: string[] = [];
  if (tags.amenity) parts.push(OSM_LABELS[tags.amenity] ?? tags.amenity);
  if (tags.shop) parts.push(OSM_LABELS[tags.shop] ?? tags.shop);
  if (tags.cuisine)
    parts.push(
      tags.cuisine
        .split(';')
        .map((c) => CUISINE_LABELS[c] ?? c)
        .join(', '),
    );
  return parts.length ? parts.join(' > ') : undefined;
}

const OSM_LABELS: Record<string, string> = {
  restaurant: '음식점',
  fast_food: '패스트푸드',
  food_court: '푸드코트',
  bar: '바',
  pub: '주점',
  cafe: '카페',
  ice_cream: '아이스크림',
  pharmacy: '약국',
  marketplace: '시장',
  convenience: '편의점',
  supermarket: '슈퍼마켓',
  department_store: '백화점',
  bakery: '베이커리',
  butcher: '정육점',
  seafood: '수산물',
  greengrocer: '청과',
  clothes: '의류',
  shoes: '신발',
  cosmetics: '화장품',
  chemist: '드럭스토어',
  electronics: '전자제품',
  mobile_phone: '휴대폰',
  variety_store: '생활용품',
  stationery: '문구',
  books: '서점',
  optician: '안경',
  alcohol: '주류',
};

const CUISINE_LABELS: Record<string, string> = {
  korean: '한식',
  chinese: '중식',
  japanese: '일식',
  sushi: '초밥',
  ramen: '라멘',
  pizza: '피자',
  burger: '햄버거',
  chicken: '치킨',
  fried_chicken: '치킨',
  coffee_shop: '커피',
  noodle: '면',
  barbecue: '고기구이',
  korean_barbecue: '고기구이',
  bakery: '빵',
  dessert: '디저트',
  italian: '이탈리안',
  western: '양식',
  vietnamese: '베트남',
  thai: '태국',
  indian: '인도',
  sandwich: '샌드위치',
  ice_cream: '아이스크림',
  donut: '도넛',
  tea: '차',
};
