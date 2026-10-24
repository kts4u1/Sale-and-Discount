import path from 'node:path';
import { goodPriceDeals, type Deal, type GoodPriceFile, type LatLng, type Store } from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { WatchedJsonFile } from '../lib/json-file.ts';

export type { GoodPriceFile, GoodPriceStore } from '@sale-radar/shared';

/** server/data/goodprice.json 을 읽어 (바뀌면 다시 읽음) 반경 안의 업소를 돌려준다 */
export class GoodPriceSource {
  private file: WatchedJsonFile<GoodPriceFile>;

  constructor(config: AppConfigEnv) {
    this.file = new WatchedJsonFile(path.join(config.dataDir, 'goodprice.json'), { stores: [] });
  }

  async count(): Promise<number> {
    return (await this.file.get()).stores.length;
  }

  async deals(center: LatLng, radius: number): Promise<{ deals: Deal[]; stores: Store[] }> {
    return goodPriceDeals(await this.file.get(), center, radius);
  }
}
