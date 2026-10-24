import path from 'node:path';
import type { CategoryId, Deal, DealTypeId, StoreWithDistance } from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { matchesBrand } from '../lib/category.ts';
import { WatchedJsonFile } from '../lib/json-file.ts';

/**
 * 브랜드 단위 행사 (예: 편의점 1+1·2+1, 프랜차이즈 할인).
 * 같은 브랜드의 모든 매장에 적용되므로, 반경 안에 그 브랜드 매장이 있을 때만 보여준다.
 * 데이터는 server/data/brand-promotions.json (CSV 에서 `npm run import -- promotions 파일.csv` 로 만든다).
 */
export interface BrandPromotion {
  id: string;
  brand: string;
  productName: string;
  title?: string;
  type: DealTypeId;
  category?: CategoryId;
  price?: number;
  originalPrice?: number;
  discountRate?: number;
  unit?: string;
  startDate?: string;
  endDate?: string;
  description?: string;
  sourceUrl?: string;
  tags?: string[];
}

export interface BrandPromotionFile {
  updatedAt?: string;
  notice?: string;
  promotions: BrandPromotion[];
}

const TYPE_TITLE: Partial<Record<DealTypeId, string>> = {
  one_plus_one: '1+1',
  two_plus_one: '2+1',
  discount: '할인',
  gift: '증정',
  bundle: '묶음할인',
  coupon: '쿠폰',
};

export class BrandPromotionSource {
  private file: WatchedJsonFile<BrandPromotionFile>;

  constructor(config: AppConfigEnv) {
    this.file = new WatchedJsonFile(path.join(config.dataDir, 'brand-promotions.json'), { promotions: [] });
  }

  async count(): Promise<number> {
    return (await this.file.get()).promotions.length;
  }

  /** 주변 매장 목록을 받아, 브랜드가 맞는 매장에 행사를 붙인다 */
  async deals(nearbyStores: StoreWithDistance[]): Promise<Deal[]> {
    const data = await this.file.get();
    if (data.promotions.length === 0) return [];
    const sorted = [...nearbyStores].sort((a, b) => a.distance - b.distance);
    const byBrand = new Map<string, StoreWithDistance[]>();
    const storesFor = (brand: string) => {
      let list = byBrand.get(brand);
      if (!list) {
        list = sorted.filter((s) => matchesBrand(s.name, s.brand, brand));
        byBrand.set(brand, list);
      }
      return list;
    };

    const updatedAt = data.updatedAt ? `${data.updatedAt}T00:00:00+09:00` : new Date().toISOString();
    const deals: Deal[] = [];
    for (const promo of data.promotions) {
      const stores = storesFor(promo.brand);
      if (stores.length === 0) continue;
      const [nearest, ...others] = stores;
      deals.push({
        id: `brand:${promo.id}`,
        storeId: nearest.id,
        title: promo.title ?? `${promo.productName} ${TYPE_TITLE[promo.type] ?? ''}`.trim(),
        productName: promo.productName,
        description:
          promo.description ?? `${promo.brand} 브랜드 공통 행사입니다. 매장별로 재고·참여 여부가 다를 수 있어요.`,
        type: promo.type,
        category: promo.category ?? nearest.category,
        salePrice: promo.price,
        originalPrice: promo.originalPrice,
        discountRate: promo.discountRate,
        unit: promo.unit,
        startDate: promo.startDate,
        endDate: promo.endDate,
        tags: [promo.brand, ...(promo.tags ?? [])],
        source: 'brand',
        sourceUrl: promo.sourceUrl,
        otherStoreIds: others.map((s) => s.id),
        createdAt: updatedAt,
        updatedAt,
        likes: 0,
        confirms: 0,
        expiredReports: 0,
      });
    }
    return deals;
  }
}
