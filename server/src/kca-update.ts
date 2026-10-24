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
  type KcaManifest,
  type KcaPriceTuple,
  type KcaProductsFile,
  type KcaSnapshotStore,
  type KcaTileFile,
  type LatLng,
} from '@sale-radar/shared';
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
  /** 주소 → 좌표 (없으면 좌표가 없는 판매점은 빠진다) */
  geocode?: (address: string) => Promise<LatLng | null>;
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

type GeocodeCache = Record<string, { address: string; pos: LatLng | null }>;

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
    // 앞쪽 상품 몇 개로 이 날 자료가 올라왔는지 확인
    let found = false;
    for (const goodId of goodIds.slice(0, 5)) {
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

  // 3) 할인 상품의 지난주 가격 (정상가)
  const prevDay = addDays(latest.inspectDay, -7);
  const discountedIds = [...new Set(latest.prices.filter((p) => p.discount).map((p) => p.goodId))];
  let prev = existsSync(rawFile(prevDay)) ? await readJson<RawPrices>(rawFile(prevDay)) : undefined;
  const prevHave = new Set(prev?.prices.map((p) => p.goodId));
  const prevNeed = options.offline ? [] : discountedIds.filter((id) => !prevHave.has(id) && !prev?.failed.includes(id));
  if (prevNeed.length > 0) {
    log(`지난 조사일 ${prevDay}: 할인 상품 ${prevNeed.length}개의 정상가를 받습니다…`);
    try {
      const got = await fetchDay(client, prevNeed, prevDay, concurrency, log);
      prev = {
        inspectDay: prevDay,
        fetchedAt: got.fetchedAt,
        products: (prev?.products ?? 0) + got.products,
        failed: got.failed,
        prices: [...(prev?.prices ?? []), ...got.prices],
      };
      await writeJsonAtomic(rawFile(prevDay), prev);
    } catch (err) {
      if (err instanceof KcaApiError && err.fatal) throw err;
      log(`::warning::지난주 가격을 받지 못해 정상가 없이 만듭니다: ${(err as Error).message}`);
    }
  }
  const prevPrice = new Map<string, number>();
  for (const p of prev?.prices ?? [])
    if (!p.discount && !p.onePlusOne) prevPrice.set(`${p.entpId}:${p.goodId}`, p.price);

  // 4) 좌표 보정
  const geoFile = path.join(options.rawDir, 'geocode.json');
  const geo = (await readJson<GeocodeCache>(geoFile)) ?? {};
  const addressOf = (s: KcaStore) => s.roadAddress ?? s.address ?? '';
  const pricedStores = new Set(latest.prices.map((p) => p.entpId));
  let geocoded = 0;
  for (const s of stores) {
    const cached = geo[s.entpId];
    if (!s.located && cached?.pos && cached.address === addressOf(s)) {
      Object.assign(s, { lat: cached.pos.lat, lng: cached.pos.lng, located: true });
    }
  }
  const todo = stores.filter(
    (s) => !s.located && pricedStores.has(s.entpId) && addressOf(s) && geo[s.entpId]?.address !== addressOf(s),
  );
  if (todo.length > 0 && options.geocode && !options.offline) {
    log(`좌표가 없는 판매점 ${todo.length}곳의 주소를 좌표로 바꿉니다…`);
    const deadline = Date.now() + (options.geocodeBudgetMs ?? 15 * 60_000);
    await mapLimit(todo, options.geocodeConcurrency ?? 1, async (s) => {
      if (Date.now() > deadline) return;
      try {
        const pos = await options.geocode!(addressOf(s));
        geo[s.entpId] = { address: addressOf(s), pos };
        if (pos) {
          Object.assign(s, { lat: pos.lat, lng: pos.lng, located: true });
          geocoded++;
        }
      } catch {
        // 일시적인 오류는 다음 실행에서 다시
      }
    });
    await writeJsonAtomic(geoFile, geo);
  }
  const unlocated = stores.filter((s) => !s.located && pricedStores.has(s.entpId)).length;
  if (unlocated > 0)
    log(`::warning::좌표를 모르는 판매점 ${unlocated}곳은 이번 자료에서 빠집니다 (다음 실행에서 다시 시도)`);

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
  for (const s of stores) {
    const prices = byStore.get(s.entpId);
    if (!s.located || !prices) continue;
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

  const files = new Map<string, string>();
  files.set('products.json', JSON.stringify(productsFile));
  for (const [key, list] of tiles) {
    const tile: KcaTileFile = { tile: key, stores: list.sort((a, b) => a.id.localeCompare(b.id)) };
    files.set(kcaTileFile(key), JSON.stringify(tile));
  }
  const located = [...tiles.values()].reduce((n, l) => n + l.length, 0);
  const manifest: KcaManifest = {
    version: KCA_SNAPSHOT_VERSION,
    updatedAt: new Date().toISOString(),
    inspectDay: latest.inspectDay,
    ...(prev ? { prevInspectDay: prevDay } : {}),
    source: '한국소비자원 참가격 (공공데이터포털)',
    totals: {
      stores: pricedStores.size,
      located,
      products: products.length,
      prices: latest.prices.length,
      discounts,
      onePlusOne,
    },
    tiles: Object.fromEntries([...tiles].map(([k, l]) => [k, l.length])),
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
  const keep = new Set([latest.inspectDay, prevDay, addDays(latest.inspectDay, 7)].map((d) => `prices-${d}.json`));
  for (const f of await readdir(options.rawDir)) {
    if (/^prices-\d{4}-\d{2}-\d{2}\.json$/.test(f) && !keep.has(f))
      await rm(path.join(options.rawDir, f), { force: true });
  }

  log(
    `완료: 조사일 ${manifest.inspectDay} · 매장 ${located.toLocaleString()}곳 · 가격 ${manifest.totals.prices.toLocaleString()}건 · ` +
      `할인 ${discounts.toLocaleString()} · 1+1 ${onePlusOne.toLocaleString()} · API 호출 ${client.calls.total}번`,
  );
  return { manifest, fetchedPrices, apiCalls: client.calls.total, geocoded, unlocated };
}
