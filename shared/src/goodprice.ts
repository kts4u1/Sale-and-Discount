import { distanceMeters } from './deal-utils.ts';
import type { CategoryId, Deal, LatLng, PriceItem, Store } from './types.ts';

/**
 * 착한가격업소 - 행정안전부 기준으로 지자체가 지정한 "물가안정 모범업소".
 * 지자체별 CSV(공공데이터포털)를 `npm run import -- goodprice 파일.csv` 로 불러와
 * server/data/goodprice.json 에 쌓아 둔다.
 */
export interface GoodPriceStore {
  id: string;
  name: string;
  category: CategoryId;
  categoryDetail?: string;
  lat: number;
  lng: number;
  address?: string;
  phone?: string;
  items: PriceItem[];
  region?: string;
  baseDate?: string;
}

export interface GoodPriceFile {
  updatedAt?: string;
  stores: GoodPriceStore[];
}

/** 반경 안의 착한가격업소를 매장·행사로 */
export function goodPriceDeals(
  data: GoodPriceFile,
  center: LatLng,
  radius: number,
): { deals: Deal[]; stores: Store[] } {
  const deals: Deal[] = [];
  const stores: Store[] = [];
  for (const s of data.stores) {
    if (distanceMeters(center, s) > radius) continue;
    const store: Store = {
      id: `goodprice:${s.id}`,
      name: s.name,
      category: s.category,
      categoryDetail: s.categoryDetail ? `착한가격업소 > ${s.categoryDetail}` : '착한가격업소',
      lat: s.lat,
      lng: s.lng,
      address: s.address,
      phone: s.phone,
      sources: ['goodprice'],
    };
    stores.push(store);
    const prices = s.items.map((i) => i.price).filter((p) => p > 0);
    const at = s.baseDate ? `${s.baseDate}T00:00:00+09:00` : (data.updatedAt ?? new Date().toISOString());
    const menuText = s.items
      .slice(0, 3)
      .map((i) => `${i.name} ${i.price.toLocaleString('ko-KR')}원`)
      .join(', ');
    deals.push({
      id: `goodprice:${s.id}`,
      storeId: store.id,
      title: s.items[0] ? `${s.items[0].name} ${s.items[0].price.toLocaleString('ko-KR')}원` : `${s.name} 착한가격`,
      productName: s.items[0]?.name,
      description: `지자체가 지정한 착한가격업소입니다.${menuText ? ` 대표 메뉴: ${menuText}` : ''}${
        s.baseDate ? ` (데이터 기준일 ${s.baseDate})` : ''
      }`,
      type: 'good_price',
      category: s.category,
      salePrice: prices.length ? Math.min(...prices) : undefined,
      items: s.items,
      tags: ['착한가격업소', s.region].filter((v): v is string => Boolean(v)),
      source: 'goodprice',
      sourceUrl: 'https://www.goodprice.go.kr',
      createdAt: at,
      updatedAt: at,
      likes: 0,
      confirms: 0,
      expiredReports: 0,
    });
  }
  return { deals, stores };
}
