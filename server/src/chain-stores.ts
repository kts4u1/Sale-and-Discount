import path from 'node:path';
import { detectBrand, type KcaChainStoreTuple } from '@sale-radar/shared';
import { readJson, writeJsonAtomic } from './lib/cache.ts';
import { fetchText } from './lib/http.ts';

/**
 * 전국 편의점·마트 체인 매장 위치 (OpenStreetMap).
 * 참가격의 본사 가격(GS25·CU …)과 체인 공통 행사(이마트·GS더프레시 …)를 "내 주변 같은 체인 지점"에 붙이는 데 쓴다.
 * 휴대폰이 매번 지도 서버에 묻지 않도록, 업데이트 작업이 일주일에 한 번 전국 자료를 받아 둔다.
 */

/** 한반도 남쪽(제주~강원 북단, 서해~울릉도)을 0.5° 칸으로 나눈다. 전국을 한 번에 물으면 서버가 시간 초과(504)를 낸다 */
export const CHAIN_BOX_DEG = 0.5;
export function koreaBoxes(): [number, number, number, number][] {
  const boxes: [number, number, number, number][] = [];
  for (let lat = 33.0; lat < 38.75; lat += CHAIN_BOX_DEG) {
    for (let lng = 124.5; lng < 131.0; lng += CHAIN_BOX_DEG) {
      boxes.push([lat, lng, lat + CHAIN_BOX_DEG, lng + CHAIN_BOX_DEG]);
    }
  }
  return boxes;
}

export function chainBoxQuery([s, w, n, e]: [number, number, number, number]): string {
  return (
    '[out:csv(::type,::id,::lat,::lon,name,brand,branch,"brand:ko";false;"\\t")][timeout:180]' +
    `[bbox:${s},${w},${n},${e}];` +
    'nwr[shop~"^(convenience|supermarket|department_store)$"];out center;'
  );
}

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
  /** 가장 오래된 칸을 받은 시각 */
  fetchedAt: string;
  stores: KcaChainStoreTuple[];
}

interface BoxCache {
  boxes: Record<string, { fetchedAt: string; stores: KcaChainStoreTuple[] }>;
}

export interface LoadChainStoresOptions {
  rawDir: string;
  endpoints: string[];
  userAgent?: string;
  /** 이 기간 안에 받은 칸은 다시 받지 않는다 (기본 7일) */
  maxAgeMs?: number;
  /** 이번 실행에서 칸을 받는 데 쓸 최대 시간 (기본 25분). 남은 칸은 다음 실행에서 */
  budgetMs?: number;
  /** 사람이 사는 곳 위주로: 이 좌표들이 있는 칸과 그 주변 칸만, 좌표가 많은 칸부터 받는다 */
  focusPoints?: { lat: number; lng: number }[];
  timeoutMs?: number;
  log?: (m: string) => void;
}

/**
 * 좌표(예: 참가격 조사 매장)가 있는 칸과 그 둘레 칸만 남기고, 좌표가 많은 칸부터 정렬한다.
 * 바다·산간 칸을 건너뛰어 서울·부산 같은 곳부터 채운다.
 */
export function prioritizeBoxes(
  boxes: [number, number, number, number][],
  points?: { lat: number; lng: number }[],
): [number, number, number, number][] {
  if (!points || points.length === 0) return boxes;
  const idx = (b: [number, number, number, number]) => [
    Math.round(b[0] / CHAIN_BOX_DEG),
    Math.round(b[1] / CHAIN_BOX_DEG),
  ];
  const count = new Map<string, number>();
  for (const p of points) {
    const y = Math.floor(p.lat / CHAIN_BOX_DEG);
    const x = Math.floor(p.lng / CHAIN_BOX_DEG);
    count.set(`${y}:${x}`, (count.get(`${y}:${x}`) ?? 0) + 1);
  }
  const score = (b: [number, number, number, number]) => {
    const [y, x] = idx(b);
    let own = count.get(`${y}:${x}`) ?? 0;
    let near = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) near += count.get(`${y + dy}:${x + dx}`) ?? 0;
    own = own * 10;
    return own + near;
  };
  return boxes
    .map((b) => ({ b, s: score(b) }))
    .filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s)
    .map((x) => x.b);
}

const inBox = (t: KcaChainStoreTuple, [s, w, n, e]: [number, number, number, number]) =>
  t[0] >= s && t[0] < n && t[1] >= w && t[1] < e;

/**
 * 0.5° 칸마다 받아서 칸별로 7일 동안 보관한다. 실패한 칸은 지난번 자료를 쓰고 다음 실행에서 다시 받는다.
 */
export async function loadChainStores(options: LoadChainStoresOptions): Promise<ChainStoresCache | null> {
  const log = options.log ?? (() => {});
  const file = path.join(options.rawDir, 'chain-stores.json');
  const cache: BoxCache = (await readJson<BoxCache>(file).catch(() => undefined)) ?? { boxes: {} };
  if (!cache.boxes) cache.boxes = {};
  const maxAge = options.maxAgeMs ?? 7 * 86_400_000;
  const deadline = Date.now() + (options.budgetMs ?? 25 * 60_000);
  const keyOf = (b: [number, number, number, number]) => `${b[0]}_${b[1]}`;
  const boxes = prioritizeBoxes(koreaBoxes(), options.focusPoints);
  const stale = boxes.filter((b) => {
    const c = cache.boxes[keyOf(b)];
    return !c || Date.now() - Date.parse(c.fetchedAt) > maxAge;
  });

  if (stale.length > 0 && options.endpoints.length > 0) {
    log(`체인 매장 위치: ${boxes.length}칸 중 ${stale.length}칸을 OpenStreetMap 에서 받습니다…`);
    let ok = 0;
    let failed = 0;
    let preferred = 0;
    for (const box of stale) {
      if (Date.now() > deadline) break;
      const query = chainBoxQuery(box);
      let done = false;
      for (let i = 0; i < options.endpoints.length && !done; i++) {
        const idx = (preferred + i) % options.endpoints.length;
        try {
          const text = await fetchText(options.endpoints[idx], {
            method: 'POST',
            headers: {
              'Content-Type': 'application/x-www-form-urlencoded',
              ...(options.userAgent ? { 'User-Agent': options.userAgent } : {}),
            },
            body: new URLSearchParams({ data: query }).toString(),
            timeoutMs: options.timeoutMs ?? 90_000,
          });
          // 서버가 실패를 HTML/오류문으로 돌려주는 경우
          if (/^\s*</.test(text) || /runtime error|Dispatcher/i.test(text.slice(0, 500))) {
            throw new Error(text.slice(0, 120));
          }
          cache.boxes[keyOf(box)] = {
            fetchedAt: new Date().toISOString(),
            stores: parseChainStoresCsv(text).filter((t) => inBox(t, box)),
          };
          preferred = idx;
          done = true;
          ok++;
        } catch (err) {
          if (i === options.endpoints.length - 1) log(`  칸 ${keyOf(box)} 실패: ${(err as Error).message}`);
        }
      }
      if (!done) failed++;
      if ((ok + failed) % 20 === 0) {
        log(`  ${ok + failed}/${stale.length}칸 (실패 ${failed})`);
        await writeJsonAtomic(file, cache);
      }
    }
    await writeJsonAtomic(file, cache);
    const left = stale.length - ok - failed;
    log(
      `체인 매장 위치: ${ok}칸 받음` +
        (failed ? `, ${failed}칸 실패(지난 자료 사용)` : '') +
        (left > 0 ? `, ${left}칸은 다음 실행에서` : ''),
    );
  }

  const byId = new Map<string, KcaChainStoreTuple>();
  let oldest = '';
  for (const c of Object.values(cache.boxes)) {
    if (!oldest || c.fetchedAt < oldest) oldest = c.fetchedAt;
    for (const t of c.stores) byId.set(t[4], t);
  }
  if (byId.size === 0) {
    log('::warning::체인 매장 위치를 받지 못했습니다. 본사·체인 공통 행사는 브라우저가 찾은 주변 매장에만 붙습니다.');
    return null;
  }
  log(`체인 매장 위치 ${byId.size.toLocaleString()}곳 사용`);
  return { fetchedAt: oldest, stores: [...byId.values()] };
}
