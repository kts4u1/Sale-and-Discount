import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  addDays,
  KCA_FLAG_DISCOUNT,
  KCA_FLAG_ONE_PLUS_ONE,
  KCA_SNAPSHOT_VERSION,
  kcaTileFile,
  kcaTileKey,
  computeChainPromotions,
  distanceMeters,
  kcaChainTileFile,
  type KcaBrandFile,
  type KcaBrandStore,
  type KcaChainStoreTuple,
  type KcaChainTileFile,
  type KcaManifest,
  type KcaPriceTuple,
  type KcaProductsFile,
  type KcaSnapshotStore,
  type KcaTileFile,
  type LatLng,
} from '@sale-radar/shared';
import { loadChainStores } from './chain-stores.ts';
import { readJson, writeJsonAtomic } from './lib/cache.ts';
import { mapLimit } from './lib/http.ts';
import {
  KcaApiError,
  KcaClient,
  recentFridays,
  toKcaPrice,
  toKcaProduct,
  toKcaStore,
  type KcaPrice,
  type KcaProductRaw,
  type KcaStore,
  type KcaStoreRaw,
} from './sources/kca.ts';

/**
 * 한국소비자원 참가격 전국 자료를 받아 앱이 읽는 스냅샷 파일을 만든다 (하루 한 번).
 *
 * 1) 판매점 목록, 상품 목록을 받는다.
 * 2) 자료가 올라온 가장 최근 조사일(금요일)을 찾는다.
 *    이미 받아 둔 조사일이면 다시 받지 않는다 → 매일 돌려도 API 호출은 몇 번뿐이다.
 * 3) 새 조사일이면 상품마다 전국 가격을 받는다 (상품 수만큼 호출).
 *    할인 상품은 지난주 가격도 받아 정상가로 쓴다.
 * 4) 좌표가 경위도가 아닌 판매점은 주소로 좌표를 찾는다 (결과는 보관해 다음에 다시 쓴다).
 * 5) 약 2km 격자로 나눠 파일을 만들고, 다 만든 뒤에 한 번에 바꿔 끼운다.
 *
 * 받다가 실패하면 기존 스냅샷을 그대로 둔다.
 */

export interface UpdateOptions {
  key: string;
  baseUrl: string;
  /** 스냅샷을 만들 폴더 (예: client/public/data/kca) */
  outDir: string;
  /** 원자료 보관 폴더 (예: .kca-raw) */
  rawDir: string;
  /** 주소 → 좌표 (없으면 좌표가 없는 판매점은 빠진다). address 를 돌려주면 시·군·구가 맞는지 확인한다 */
  geocode?: (address: string) => Promise<(LatLng & { address?: string }) | null>;
  /** 주소 변환기 이름. 바뀌면(예: OpenStreetMap → 카카오) 전에 못 찾은 주소를 다시 찾는다 */
  geocoderName?: string;
  /** 이번 실행에서 주소 변환에 쓸 최대 시간 */
  geocodeBudgetMs?: number;
  geocodeConcurrency?: number;
  /** 이미 받아 둔 조사일이어도 다시 받기 */
  force?: boolean;
  /** API 를 부르지 않고 보관해 둔 원자료로만 다시 만들기 (API 장애 때) */
  offline?: boolean;
  /** 오늘 (YYYY-MM-DD, 테스트용) */
  today?: string;
  concurrency?: number;
  retryDelayMs?: number;
  log?: (message: string) => void;
  /** 전국 체인 매장 위치를 받을 Overpass 서버 (비우면 받지 않음) */
  overpassEndpoints?: string[];
  userAgent?: string;
}

export interface UpdateResult {
  manifest: KcaManifest;
  /** 이번에 가격을 새로 받았는지 (false 면 보관한 원자료로 다시 만듦) */
  fetchedPrices: boolean;
  apiCalls: number;
  geocoded: number;
  unlocated: number;
}

interface RawPrices {
  inspectDay: string;
  fetchedAt: string;
  products: number;
  failed: string[];
  prices: KcaPrice[];
}

type GeocodeCache = Record<string, { address: string; pos: LatLng | null; by?: string; at?: string }>;

/** 못 찾은 주소를 다시 찾아보는 간격 */
const GEOCODE_RETRY_MS = 7 * 86_400_000;

/** 목록에서 고르게 n 개 */
export function spreadSample<T>(list: T[], n: number): T[] {
  if (list.length <= n) return list;
  return Array.from({ length: n }, (_, i) => list[Math.floor((i * list.length) / n)]);
}

/** 본사(전국 공통 가격) 판매점인지: "GS25(본사)", "CU(본사)" */
export const isHeadquarters = (name: string) => /\(\s*본사\s*\)|본사$/.test(name);

/**
 * 주소 검색이 잘 되도록 주소를 몇 가지 모양으로 다듬는다.
 *   "서울특별시 서초구 서초중앙로 238 (반포동)" → "서울특별시 서초구 서초중앙로 238"
 *   "인천광역시 연수구 동춘동  926-9 이마트 이마트 연수점" → "인천광역시 연수구 동춘동 926-9"
 */
export function addressVariants(...addresses: (string | undefined)[]): string[] {
  const out: string[] = [];
  for (const raw of addresses) {
    if (!raw) continue;
    const a = raw.replace(/\s+/g, ' ').trim();
    const noParen = a.replace(/\s*\([^)]*\)/g, '').trim();
    const road = noParen.match(/^(.*?\S+(?:로|길)\s?\d+(?:-\d+)?)/)?.[1];
    const lot = noParen.match(/^(.*?\S+[동리가]\s(?:산\s?)?\d+(?:-\d+)?)/)?.[1];
    for (const v of [road, lot, noParen, a]) if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

/** 주소의 시·군·구 ("서울특별시 서초구 …" → "서초구") */
export function districtOf(address: string): string | undefined {
  return address
    .split(/\s+/)
    .slice(1, 3)
    .find((t) => /[시군구]$/.test(t) && t.length >= 2);
}

const hash = (s: string) => createHash('sha1').update(s).digest('hex').slice(0, 10);

/** 상품 수만큼 호출해서 한 조사일의 전국 가격을 받는다 */
async function fetchDay(
  client: KcaClient,
  goodIds: string[],
  day: string,
  concurrency: number,
  log: (m: string) => void,
): Promise<RawPrices> {
  const prices: KcaPrice[] = [];
  const failed: string[] = [];
  let done = 0;
  await mapLimit(goodIds, concurrency, async (goodId) => {
    try {
      const rows = await client.pricesByProduct(goodId, day);
      for (const r of rows) {
        const p = toKcaPrice(r, day);
        if (p && p.inspectDay === day) prices.push(p);
      }
    } catch (err) {
      if (err instanceof KcaApiError && err.fatal) throw err;
      failed.push(goodId);
    }
    done++;
    if (done % 50 === 0) log(`  ${day}: ${done}/${goodIds.length} 상품`);
  });
  return { inspectDay: day, fetchedAt: new Date().toISOString(), products: goodIds.length, failed, prices };
}

export async function updateKcaSnapshot(options: UpdateOptions): Promise<UpdateResult> {
  const log = options.log ?? ((m: string) => console.log(m));
  const concurrency = options.concurrency ?? 3;
  const client = new KcaClient({ key: options.key, baseUrl: options.baseUrl, retryDelayMs: options.retryDelayMs });
  await mkdir(options.rawDir, { recursive: true });
  const listsFile = path.join(options.rawDir, 'lists.json');

  // 1) 기준 자료 (판매점·상품 목록). 오프라인이면 보관본을 쓴다
  let storeRows: KcaStoreRaw[];
  let productRows: KcaProductRaw[];
  if (options.offline) {
    const saved = await readJson<{ stores: KcaStoreRaw[]; products: KcaProductRaw[] }>(listsFile);
    if (!saved) throw new Error(`보관해 둔 원자료가 없습니다 (${listsFile})`);
    ({ stores: storeRows, products: productRows } = saved);
  } else {
    storeRows = await client.stores();
    productRows = await client.products();
  }
  const stores = storeRows.filter((r) => r.entpId && r.entpName).map(toKcaStore);
  if (stores.length === 0) throw new Error('판매점 목록이 비어 있습니다 (API 응답 형식을 확인하세요)');
  const products = productRows.filter((r) => r.goodId && r.goodName).map(toKcaProduct);
  if (products.length === 0) throw new Error('상품 목록이 비어 있습니다 (API 응답 형식을 확인하세요)');
  if (!options.offline)
    await writeJsonAtomic(listsFile, { fetchedAt: new Date().toISOString(), stores: storeRows, products: productRows });
  log(`판매점 ${stores.length.toLocaleString()}곳, 상품 ${products.length.toLocaleString()}개`);
  const goodIds = products.map((p) => p.goodId);

  // 2) 가장 최근 조사일
  const rawFile = (day: string) => path.join(options.rawDir, `prices-${day}.json`);
  let latest: RawPrices | undefined;
  let fetchedPrices = false;
  if (options.offline) {
    const files = (await readdir(options.rawDir)).filter((f) => /^prices-\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort();
    const newest = files.at(-1);
    if (newest) latest = await readJson<RawPrices>(path.join(options.rawDir, newest));
    if (latest) log(`보관해 둔 ${latest.inspectDay} 원자료로 만듭니다 (API 호출 없음)`);
  }
  for (const day of options.offline ? [] : recentFridays(6, options.today)) {
    if (!options.force && existsSync(rawFile(day))) {
      latest = await readJson<RawPrices>(rawFile(day));
      if (latest && latest.prices.length > 0) {
        log(`조사일 ${day} 자료는 이미 받아 두었습니다 (다시 받지 않음)`);
        break;
      }
    }
    // 목록에서 고르게 고른 상품 몇 개로 이 날 자료가 올라왔는지 확인
    let found = false;
    for (const goodId of spreadSample(goodIds, 10)) {
      const rows = await client.pricesByProduct(goodId, day).catch((err) => {
        if (err instanceof KcaApiError && err.fatal) throw err;
        return [];
      });
      if (rows.length > 0) {
        found = true;
        break;
      }
    }
    if (!found) {
      log(`조사일 ${day}: 아직 자료가 없습니다`);
      continue;
    }
    log(`조사일 ${day} 가격을 받습니다 (상품 ${goodIds.length}개)…`);
    latest = await fetchDay(client, goodIds, day, concurrency, log);
    const failRate = latest.failed.length / goodIds.length;
    if (failRate > 0.05) {
      throw new Error(
        `상품 ${goodIds.length}개 중 ${latest.failed.length}개를 받지 못했습니다. 기존 자료를 그대로 둡니다.`,
      );
    }
    await writeJsonAtomic(rawFile(day), latest);
    fetchedPrices = true;
    break;
  }
  if (!latest) throw new Error('최근 6주 동안 조사 자료를 찾지 못했습니다');

  // 3) 할인 상품의 지난 조사 가격 (정상가). 조사가 매주가 아닐 수 있어 4주 전까지 찾아본다
  const discountedIds = [...new Set(latest.prices.filter((p) => p.discount).map((p) => p.goodId))];
  let prev: RawPrices | undefined;
  let prevDay: string | undefined;
  for (let week = 1; week <= 4 && discountedIds.length > 0; week++) {
    const day = addDays(latest.inspectDay, -7 * week);
    const saved = existsSync(rawFile(day)) ? await readJson<RawPrices>(rawFile(day)) : undefined;
    if (saved && saved.prices.length > 0) {
      prev = saved;
      prevDay = day;
      break;
    }
    if (options.offline) continue;
    let found = false;
    for (const goodId of spreadSample(discountedIds, 5)) {
      const rows = await client.pricesByProduct(goodId, day).catch((err) => {
        if (err instanceof KcaApiError && err.fatal) throw err;
        return [];
      });
      if (rows.length > 0) {
        found = true;
        break;
      }
    }
    if (!found) continue;
    log(`지난 조사일 ${day}: 할인 상품 ${discountedIds.length}개의 정상가를 받습니다…`);
    try {
      prev = await fetchDay(client, discountedIds, day, concurrency, log);
      prevDay = day;
      await writeJsonAtomic(rawFile(day), prev);
    } catch (err) {
      if (err instanceof KcaApiError && err.fatal) throw err;
      log(`::warning::지난 조사 가격을 받지 못해 정상가 없이 만듭니다: ${(err as Error).message}`);
    }
    break;
  }
  if (discountedIds.length > 0 && !prev) log('::notice::최근 4주 안에 지난 조사 자료가 없어 정상가 없이 만듭니다');
  const prevPrice = new Map<string, number>();
  for (const p of prev?.prices ?? [])
    if (!p.discount && !p.onePlusOne) prevPrice.set(`${p.entpId}:${p.goodId}`, p.price);

  // 4) 좌표 보정
  const geoFile = path.join(options.rawDir, 'geocode.json');
  const geo = (await readJson<GeocodeCache>(geoFile)) ?? {};
  const addressOf = (s: KcaStore) => s.roadAddress ?? s.address ?? '';
  const pricedStores = new Set(latest.prices.map((p) => p.entpId));
  // 본사(전국 공통 가격)는 지도에 올리지 않고 주변 같은 브랜드 매장에 붙인다
  const hq = stores.filter((s) => pricedStores.has(s.entpId) && isHeadquarters(s.name));
  const hqIds = new Set(hq.map((s) => s.entpId));
  const geocoderName = options.geocoderName ?? 'geocoder';
  let geocoded = 0;
  for (const s of stores) {
    const cached = geo[s.entpId];
    if (!s.located && cached?.pos && cached.address === addressOf(s)) {
      Object.assign(s, { lat: cached.pos.lat, lng: cached.pos.lng, located: true });
    }
  }
  const needsLookup = (s: KcaStore) => {
    const c = geo[s.entpId];
    if (!c || c.address !== addressOf(s)) return true;
    // 못 찾았던 주소: 변환기가 바뀌었거나 일주일 지나면 다시
    return !c.pos && (c.by !== geocoderName || !c.at || Date.now() - Date.parse(c.at) > GEOCODE_RETRY_MS);
  };
  const todo = stores.filter(
    (s) => !s.located && pricedStores.has(s.entpId) && !hqIds.has(s.entpId) && addressOf(s) && needsLookup(s),
  );
  const unlocatedSample = stores.filter((s) => !s.located && pricedStores.has(s.entpId) && !hqIds.has(s.entpId));
  if (unlocatedSample.length > 0) {
    const raw = new Map(storeRows.map((r) => [r.entpId, r]));
    log(
      `좌표가 경위도가 아닌 판매점 예: ` +
        unlocatedSample
          .slice(0, 3)
          .map((s) => `${s.name}(x=${raw.get(s.entpId)?.xMapCoord ?? ''}, y=${raw.get(s.entpId)?.yMapCoord ?? ''})`)
          .join(', '),
    );
  }
  if (todo.length > 0 && options.geocode && !options.offline) {
    log(`좌표가 없는 판매점 ${todo.length}곳의 주소를 좌표로 바꿉니다 (${geocoderName})…`);
    const deadline = Date.now() + (options.geocodeBudgetMs ?? 15 * 60_000);
    await mapLimit(todo, options.geocodeConcurrency ?? 1, async (s) => {
      if (Date.now() > deadline) return;
      const district = districtOf(addressOf(s));
      let pos: LatLng | null = null;
      try {
        for (const variant of addressVariants(s.roadAddress, s.address)) {
          const hit = await options.geocode!(variant);
          // 다른 시·군·구로 잘못 찾은 결과는 버린다
          if (hit && (!hit.address || !district || hit.address.includes(district))) {
            pos = { lat: hit.lat, lng: hit.lng };
            break;
          }
          if (Date.now() > deadline) break;
        }
      } catch {
        return; // 일시적인 오류는 다음 실행에서 다시
      }
      geo[s.entpId] = { address: addressOf(s), pos, by: geocoderName, at: new Date().toISOString() };
      if (pos) {
        Object.assign(s, { lat: pos.lat, lng: pos.lng, located: true });
        geocoded++;
      }
    });
    await writeJsonAtomic(geoFile, geo);
  }
  const unlocated = stores.filter((s) => !s.located && pricedStores.has(s.entpId) && !hqIds.has(s.entpId)).length;
  if (unlocated > 0)
    log(
      `::warning::좌표를 모르는 판매점 ${unlocated}곳은 이번 자료에서 빠집니다 (다음 실행에서 다시 시도. ` +
        `KAKAO_REST_API_KEY 를 넣으면 대부분 찾을 수 있어요)`,
    );

  // 5) 스냅샷 만들기
  const byStore = new Map<string, KcaPriceTuple[]>();
  let discounts = 0;
  let onePlusOne = 0;
  for (const p of latest.prices) {
    const flags = (p.discount ? KCA_FLAG_DISCOUNT : 0) | (p.onePlusOne ? KCA_FLAG_ONE_PLUS_ONE : 0);
    if (p.discount) discounts++;
    if (p.onePlusOne) onePlusOne++;
    const prevP = p.discount ? prevPrice.get(`${p.entpId}:${p.goodId}`) : undefined;
    const tuple: KcaPriceTuple = [p.goodId, p.price, flags];
    if (flags || prevP) tuple.push(p.dcStart ?? null, p.dcEnd ?? null);
    if (prevP) tuple.push(prevP);
    const list = byStore.get(p.entpId) ?? [];
    list.push(tuple);
    byStore.set(p.entpId, list);
  }

  const tiles = new Map<string, KcaSnapshotStore[]>();
  const brandStores: KcaBrandStore[] = [];
  for (const s of hq) {
    const prices = byStore.get(s.entpId);
    if (!prices) continue;
    brandStores.push({
      id: s.entpId,
      name: s.name,
      brand: s.brand ?? s.name.replace(/\(\s*본사\s*\)|본사$/g, '').trim(),
      category: s.category,
      ...(s.typeLabel ? { typeLabel: s.typeLabel } : {}),
      prices: prices.sort((a, b) => a[0].localeCompare(b[0])),
    });
  }
  for (const s of stores) {
    const prices = byStore.get(s.entpId);
    if (!s.located || !prices || hqIds.has(s.entpId)) continue;
    const snap: KcaSnapshotStore = {
      id: s.entpId,
      name: s.name,
      category: s.category,
      ...(s.typeLabel ? { typeLabel: s.typeLabel } : {}),
      ...(s.brand ? { brand: s.brand } : {}),
      lat: Math.round(s.lat * 1e6) / 1e6,
      lng: Math.round(s.lng * 1e6) / 1e6,
      ...(s.address ? { address: s.address } : {}),
      ...(s.roadAddress ? { roadAddress: s.roadAddress } : {}),
      ...(s.phone ? { phone: s.phone } : {}),
      prices: prices.sort((a, b) => a[0].localeCompare(b[0])),
    };
    const key = kcaTileKey(snap.lat, snap.lng);
    const list = tiles.get(key) ?? [];
    list.push(snap);
    tiles.set(key, list);
  }

  const productsFile: KcaProductsFile = Object.fromEntries(
    products.map((p) => [p.goodId, p.unit ? [p.name, p.unit] : [p.name]] as const),
  );

  // 체인 공통 행사: 같은 체인 조사 매장 대부분이 같은 할인을 하면 다른 지점에도 붙인다
  const chainCandidates = stores
    .filter((s) => byStore.has(s.entpId) && !hqIds.has(s.entpId))
    .map((s) => ({ name: s.name, brand: s.brand, category: s.category, prices: byStore.get(s.entpId)! }));
  const chains = computeChainPromotions(chainCandidates, productsFile, latest.inspectDay);
  if (chains.length > 0) {
    const brands = [...new Set(chains.map((c) => c.brand))];
    log(`체인 공통 행사 ${chains.length}건 (${brands.join(', ')})`);
  }

  // 전국 체인 매장 위치 (일주일에 한 번). 이미 조사 매장으로 올라간 지점은 뺀다
  const chainTiles = new Map<string, KcaChainStoreTuple[]>();
  let chainStoresUpdatedAt: string | undefined;
  if (options.overpassEndpoints?.length && !options.offline) {
    const chainData = await loadChainStores({
      rawDir: options.rawDir,
      endpoints: options.overpassEndpoints,
      userAgent: options.userAgent,
      // 참가격 조사 매장이 있는 곳(= 사람이 사는 곳)부터
      focusPoints: stores.filter((s) => s.located),
      log,
    });
    if (chainData) {
      chainStoresUpdatedAt = chainData.fetchedAt;
      const surveyed = stores.filter((s) => s.located && s.brand);
      for (const t of chainData.stores) {
        const [lat, lng, brand] = t;
        const dup = surveyed.some((s) => s.brand === brand && distanceMeters(s, { lat, lng }) < 150);
        if (dup) continue;
        const key = kcaTileKey(lat, lng);
        const list = chainTiles.get(key) ?? [];
        list.push(t);
        chainTiles.set(key, list);
      }
    }
  } else if (options.offline) {
    // 오프라인: 보관해 둔 칸만 쓴다 (새로 받지 않음)
    const saved = await loadChainStores({ rawDir: options.rawDir, endpoints: [], maxAgeMs: Infinity, log });
    if (saved) {
      chainStoresUpdatedAt = saved.fetchedAt;
      for (const t of saved.stores) {
        const key = kcaTileKey(t[0], t[1]);
        const list = chainTiles.get(key) ?? [];
        list.push(t);
        chainTiles.set(key, list);
      }
    }
  }

  const files = new Map<string, string>();
  files.set('products.json', JSON.stringify(productsFile));
  files.set('brands.json', JSON.stringify({ stores: brandStores, chains } satisfies KcaBrandFile));
  for (const [key, list] of chainTiles) {
    files.set(kcaChainTileFile(key), JSON.stringify({ tile: key, stores: list } satisfies KcaChainTileFile));
  }
  for (const [key, list] of tiles) {
    const tile: KcaTileFile = { tile: key, stores: list.sort((a, b) => a.id.localeCompare(b.id)) };
    files.set(kcaTileFile(key), JSON.stringify(tile));
  }
  const located = [...tiles.values()].reduce((n, l) => n + l.length, 0);
  const manifest: KcaManifest = {
    version: KCA_SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    inspectDay: latest.inspectDay,
    ...(prev && prevDay ? { prevInspectDay: prevDay } : {}),
    source: '한국소비자원 참가격 (공공데이터포털)',
    totals: {
      stores: pricedStores.size,
      located,
      brands: brandStores.length,
      products: products.length,
      prices: latest.prices.length,
      discounts,
      onePlusOne,
    },
    tiles: Object.fromEntries([...tiles].map(([k, l]) => [k, l.length])),
    ...(chainTiles.size > 0
      ? { chainTiles: Object.fromEntries([...chainTiles].map(([k, l]) => [k, l.length])), chainStoresUpdatedAt }
      : {}),
    versions: Object.fromEntries([...files].map(([f, content]) => [f, hash(content)])),
  };
  files.set('manifest.json', JSON.stringify(manifest, null, 1));

  // 다 만든 뒤에 한 번에 바꿔 끼운다
  const tmp = `${options.outDir}.tmp-${process.pid}`;
  await rm(tmp, { recursive: true, force: true });
  for (const [file, content] of files) {
    await mkdir(path.dirname(path.join(tmp, file)), { recursive: true });
    await writeFile(path.join(tmp, file), content);
  }
  const old = `${options.outDir}.old-${process.pid}`;
  if (existsSync(options.outDir)) await rename(options.outDir, old);
  await mkdir(path.dirname(options.outDir), { recursive: true });
  await rename(tmp, options.outDir);
  await rm(old, { recursive: true, force: true });

  // 오래된 원자료 정리 (최근 3주만 보관)
  const oldest = addDays(latest.inspectDay, -35);
  for (const f of await readdir(options.rawDir)) {
    const day = f.match(/^prices-(\d{4}-\d{2}-\d{2})\.json$/)?.[1];
    if (day && day < oldest) await rm(path.join(options.rawDir, f), { force: true });
  }

  log(
    `완료: 조사일 ${manifest.inspectDay} · 매장 ${located.toLocaleString()}곳 · 본사(브랜드 공통) ${brandStores.length}곳 · 가격 ${manifest.totals.prices.toLocaleString()}건 · ` +
      `할인 ${discounts.toLocaleString()} · 1+1 ${onePlusOne.toLocaleString()} · API 호출 ${client.calls.total}번`,
  );
  return { manifest, fetchedPrices, apiCalls: client.calls.total, geocoded, unlocated };
}
