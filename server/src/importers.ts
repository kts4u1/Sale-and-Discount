import { createHash } from 'node:crypto';
import { normalizeDate, type CategoryId, type DealTypeId, type LatLng, type PriceItem } from '@sale-radar/shared';
import { categoryFromText } from './lib/category.ts';
import { csvToObjects, pickColumn } from './lib/csv.ts';
import { safeHttpUrl } from './lib/url.ts';
import type { BrandPromotion } from './sources/brand.ts';
import type { GoodPriceStore } from './sources/goodprice.ts';

const shortHash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 12);

const toNumber = (v: string | undefined) => {
  if (!v) return undefined;
  const n = Number(v.replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/* ------------------------------ 착한가격업소 ------------------------------ */

const COLS = {
  name: ['업소명', '상호', '상호명', '업체명', '가게명', '업소', '상호(업소명)', 'name'],
  category: ['업종', '업종명', '업태', '분류', '업종구분', 'category'],
  address: [
    '도로명주소',
    '소재지도로명주소',
    '주소',
    '소재지',
    '소재지주소',
    '도로명',
    '지번주소',
    '소재지지번주소',
    'address',
  ],
  lat: ['위도', 'lat', 'latitude', 'y좌표', 'y'],
  lng: ['경도', 'lng', 'lon', 'longitude', 'x좌표', 'x'],
  phone: ['전화번호', '연락처', '전화', '업소전화번호', 'phone'],
  baseDate: ['데이터기준일자', '기준일자', '기준일', '지정일자'],
};

export function goodPriceCategory(text: string | undefined): CategoryId {
  if (!text) return 'food';
  if (/미용|이용|헤어|네일|피부/.test(text)) return 'beauty';
  if (/세탁|목욕|숙박|사진|수선|열쇠|PC|노래/.test(text)) return 'etc';
  return categoryFromText(text) ?? (/식|음식|요리/.test(text) ? 'food' : 'etc');
}

/** "메뉴1/가격1", "품목1/가격1", "대표메뉴/가격" 같은 열 쌍에서 메뉴 목록을 만든다 */
export function extractMenuItems(row: Record<string, string>): PriceItem[] {
  const names = new Map<string, string>();
  const prices = new Map<string, number>();
  for (const [key, value] of Object.entries(row)) {
    const k = key.replace(/\s+/g, '');
    const nameMatch = k.match(/^(?:대표)?(?:메뉴|품목|품명|주요품목|취급품목)(?:명)?(\d*)$/);
    const priceMatch = k.match(/^(?:메뉴|품목)?(?:가격|요금|금액)(\d*)$/);
    if (nameMatch && value) names.set(nameMatch[1] || '1', value);
    else if (priceMatch) {
      const p = toNumber(value);
      if (p) prices.set(priceMatch[1] || '1', p);
    }
  }
  const items: PriceItem[] = [];
  for (const [idx, name] of [...names.entries()].sort((a, b) => Number(a[0]) - Number(b[0]))) {
    const price = prices.get(idx);
    if (price) items.push({ name, price });
  }
  return items;
}

export interface ParsedGoodPrice {
  store: Omit<GoodPriceStore, 'lat' | 'lng'> & Partial<LatLng>;
}

export function parseGoodPriceCsv(text: string, region?: string): ParsedGoodPrice[] {
  const rows = csvToObjects(text);
  const result: ParsedGoodPrice[] = [];
  for (const row of rows) {
    const name = pickColumn(row, COLS.name);
    if (!name) continue;
    const address = pickColumn(row, COLS.address);
    const lat = toNumber(pickColumn(row, COLS.lat));
    const lng = toNumber(pickColumn(row, COLS.lng));
    const categoryText = pickColumn(row, COLS.category);
    // 위도/경도가 바뀌어 들어온 파일 보정
    const [la, ln] = lat && lng && lat > 100 && lng < 90 ? [lng, lat] : [lat, lng];
    result.push({
      store: {
        id: shortHash(`${name}|${address ?? ''}`),
        name,
        category: goodPriceCategory(`${categoryText ?? ''} ${name}`),
        categoryDetail: categoryText,
        address,
        phone: pickColumn(row, COLS.phone),
        items: extractMenuItems(row),
        region,
        baseDate: normalizeDate(pickColumn(row, COLS.baseDate)),
        lat: la,
        lng: ln,
      },
    });
  }
  return result;
}

/* ------------------------------ 브랜드 행사 ------------------------------ */

const TYPE_ALIASES: Record<string, DealTypeId> = {
  '1+1': 'one_plus_one',
  '2+1': 'two_plus_one',
  할인: 'discount',
  가격할인: 'discount',
  증정: 'gift',
  덤: 'gift',
  덤증정: 'gift',
  묶음: 'bundle',
  세트: 'bundle',
  쿠폰: 'coupon',
  타임세일: 'time_sale',
};

export function parseDealType(value: string | undefined): DealTypeId | undefined {
  if (!value) return undefined;
  const v = value.trim();
  const known: DealTypeId[] = [
    'discount',
    'one_plus_one',
    'two_plus_one',
    'time_sale',
    'closing_sale',
    'happy_hour',
    'gift',
    'coupon',
    'bundle',
    'opening',
    'good_price',
  ];
  if ((known as string[]).includes(v)) return v as DealTypeId;
  return TYPE_ALIASES[v.replace(/\s+/g, '')];
}

export function parsePromotionsCsv(text: string): { promotions: BrandPromotion[]; skipped: number } {
  const rows = csvToObjects(text);
  const promotions: BrandPromotion[] = [];
  let skipped = 0;
  for (const row of rows) {
    const brand = pickColumn(row, ['brand', '브랜드']);
    const productName = pickColumn(row, ['productName', '상품명', '상품']);
    const type = parseDealType(pickColumn(row, ['type', '행사유형', '행사', '유형']));
    if (!brand || !productName || !type) {
      skipped++;
      continue;
    }
    const category = pickColumn(row, ['category', '분류']) as CategoryId | undefined;
    const startDate = normalizeDate(pickColumn(row, ['startDate', '시작일']));
    const endDate = normalizeDate(pickColumn(row, ['endDate', '종료일']));
    promotions.push({
      id: shortHash(`${brand}|${productName}|${type}|${startDate ?? ''}`),
      brand,
      productName,
      title: pickColumn(row, ['title', '제목']),
      type,
      category,
      price: toNumber(pickColumn(row, ['price', '가격', '판매가'])),
      originalPrice: toNumber(pickColumn(row, ['originalPrice', '정가'])),
      discountRate: toNumber(pickColumn(row, ['discountRate', '할인율'])),
      unit: pickColumn(row, ['unit', '규격', '용량']),
      startDate,
      endDate,
      description: pickColumn(row, ['description', '설명']),
      sourceUrl: safeHttpUrl(pickColumn(row, ['sourceUrl', '출처'])),
    });
  }
  return { promotions, skipped };
}
