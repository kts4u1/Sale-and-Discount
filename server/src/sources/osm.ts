import path from 'node:path';
import { OverpassStoreLoader, type LatLng, type Store } from '@sale-radar/shared';
import type { AppConfigEnv } from '../config.ts';
import { diskCached } from '../lib/cache.ts';

const TILE_DISK_TTL = 3 * 86_400_000;

/** 서버용 OpenStreetMap 매장: 받은 격자 칸을 3일 동안 디스크에 보관한다 */
export class OsmSource {
  private loader: OverpassStoreLoader;

  constructor(
    private readonly config: AppConfigEnv,
    budgetMs = 7000,
  ) {
    this.loader = new OverpassStoreLoader({
      endpoints: config.overpassEndpoints,
      budgetMs,
      headers: { 'User-Agent': config.userAgent },
      persist: (key, load) =>
        diskCached(path.join(config.dataDir, 'cache', 'osm', `${key.replace(':', '_')}.json`), TILE_DISK_TTL, load),
      onWarn: (msg) => console.warn(`[osm] ${msg}`),
    });
  }

  get enabled(): boolean {
    return this.config.enableOsm && this.config.overpassEndpoints.length > 0;
  }

  nearbyStores(center: LatLng, radius: number): Promise<{ stores: Store[]; pending: boolean; failed: number }> {
    return this.loader.nearbyStores(center, radius);
  }
}
