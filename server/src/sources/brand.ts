import path from 'node:path';
import { brandPromotionDeals, type BrandPromotionFile, type Deal, type StoreWithDistance } from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { WatchedJsonFile } from '../lib/json-file.ts';

export type { BrandPromotion, BrandPromotionFile } from '@sale-radar/shared';

/** server/data/brand-promotions.json 을 읽어 (바뀌면 다시 읽음) 주변 브랜드 매장에 붙인다 */
export class BrandPromotionSource {
  private file_: WatchedJsonFile<BrandPromotionFile>;

  constructor(config: AppConfigEnv) {
    this.file_ = new WatchedJsonFile(path.join(config.dataDir, 'brand-promotions.json'), { promotions: [] });
  }

  async count(): Promise<number> {
    return (await this.file_.get()).promotions.length;
  }

  file(): Promise<BrandPromotionFile> {
    return this.file_.get();
  }

  async deals(nearbyStores: StoreWithDistance[]): Promise<Deal[]> {
    return brandPromotionDeals(await this.file_.get(), nearbyStores);
  }
}
