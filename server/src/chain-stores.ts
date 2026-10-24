import path from 'node:path';
import { detectBrand, type KcaChainStoreTuple } from '@sale-radar/shared';
import { readJson, writeJsonAtomic } from './lib/cache.ts';
import { fetchText } from './lib/http.ts';

/**
 * 전국 편의점·마트 체인 매장 위치 (OpenStreetMap).
 * 참가격의 본사 가격(GS25·CU …)과 체인 공통 행사(이마트·GS더프레시 …)를 "내 주변 같은 체인 지점"에 붙이는 데 쓴다.
 * 휴대폰이 매번 지도 서버에 묻지 않도록, 업데이트 작업이 일주일에 한 번 전국 자료를 받아 둔다.
 */

export const CHAIN_STORES_QUERY =
  '[out:csv(::type,::id,::lat,::lon,name,brand,branch,"brand:ko";false;"\\t")][timeout:900][maxsize:1073741824];' +
  'area["ISO3166-1"="KR"][admin_level=2]->.kr;' +
  'nwr(area.kr)[shop~"^(convenience|supermarket|department_store)$"];' +
  'out center;';

/** 이보다 적게 오면 중간에 끊긴 것으로 본다 */
const MIN_EXPECTED = 1000;

/** Overpass CSV → 체인 매장 (편의점·마트 브랜드만) */
export function parseChainStoresCsv(text: string): KcaChainStoreTuple[] {
  const out: KcaChainStoreTuple[] = [];
  for (const line of text.split('\n')) {
    const [type, id, lat, lon, name = '', brand = '', branch = '', brandKo = ''] = line.replace(/\r$/, '').split('\t');
    const la = Number(lat);
    const lo = Number(lon);
    if (!type || !id || !Number.isFinite(la) || !Number.isFinite(lo) || la === 0) continue;
    const b = detectBrand(brandKo) ?? detectBrand(brand) ?? detectBrand(name);
    if (!b || (b.category !== 'convenience' && b.category !== 'mart')) continue;
    const base = name || b.brand;
    const fullName = branch && !base.includes(branch) ? `${base} ${branch}` : base;
    out.push([Math.round(la * 1e6) / 1e6, Math.round(lo * 1e6) / 1e6, b.brand, fullName, `${type}/${id}`]);
  }
  return out;
}

export interface ChainStoresCache {
  fetchedAt: string;
  stores: KcaChainStoreTuple[];
}

export interface LoadChainStoresOptions {
  rawDir: string;
  endpoints: string[];
  userAgent?: string;
  /** 이 기간 안에 받은 자료가 있으면 다시 받지 않는다 (기본 7일) */
  maxAgeMs?: number;
  timeoutMs?: number;
  log?: (m: string) => void;
}

/** 일주일에 한 번 새로 받고, 실패하면 지난번 자료를 쓴다 */
export async function loadChainStores(options: LoadChainStoresOptions): Promise<ChainStoresCache | null> {
  const log = options.log ?? (() => {});
  const file = path.join(options.rawDir, 'chain-stores.json');
  const saved = await readJson<ChainStoresCache>(file).catch(() => undefined);
  const maxAge = options.maxAgeMs ?? 7 * 86_400_000;
  if (saved && Date.now() - Date.parse(saved.fetchedAt) < maxAge) {
    log(`체인 매장 위치: ${saved.fetchedAt.slice(0, 10)}에 받은 ${saved.stores.length.toLocaleString()}곳 사용`);
    return saved;
  }
  for (const endpoint of options.endpoints) {
    try {
      log(`체인 매장 위치를 OpenStreetMap 에서 받습니다 (${new URL(endpoint).host})…`);
      const text = await fetchText(endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
        },
        body: new URLSearchParams({ data: CHAIN_STORES_QUERY }).toString(),
        timeoutMs: options.timeoutMs ?? 15 * 60_000,
      });
      const stores = parseChainStoresCsv(text);
      if (stores.length < MIN_EXPECTED) throw new Error(`${stores.length}곳만 받았습니다 (중간에 끊긴 것 같아요)`);
      const result = { fetchedAt: new Date().toISOString(), stores };
      await writeJsonAtomic(file, result);
      log(`체인 매장 위치 ${stores.length.toLocaleString()}곳을 받았습니다`);
      return result;
    } catch (err) {
      log(`  실패: ${(err as Error).message}`);
    }
  }
  if (saved) {
    log(`::warning::체인 매장 위치를 새로 받지 못해 ${saved.fetchedAt.slice(0, 10)} 자료를 씁니다`);
    return saved;
  }
  log('::warning::체인 매장 위치를 받지 못했습니다. 본사·체인 공통 행사는 브라우저가 찾은 주변 매장에만 붙습니다.');
  return null;
}
