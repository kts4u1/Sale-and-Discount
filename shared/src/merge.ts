import { detectBrand } from './category.ts';
import { distanceMeters } from './deal-utils.ts';
import type { Store } from './types.ts';

const SAME_PLACE_METERS = 60;
const GRID = 0.0006; // 약 60m

/** 이름 비교용: [샘플]·공백·괄호·특수문자 제거, "점"으로 끝나는 지점명 단순화 */
export function normalizeStoreName(name: string): string {
  return name
    .toLowerCase()
    .replace(/\[[^\]]*\]|\([^)]*\)/g, '')
    .replace(/[\s·.,\-_'"!&/]+/g, '')
    .trim();
}

export function sameStoreName(a: string, b: string): boolean {
  const na = normalizeStoreName(a);
  const nb = normalizeStoreName(b);
  if (!na || !nb) return false;
  if (na === nb) return true;
  const [short, long] = na.length <= nb.length ? [na, nb] : [nb, na];
  if (short.length >= 3) return long.includes(short);
  // "CU" 처럼 짧은 이름은 같은 브랜드로 인식될 때만 같은 매장으로 본다 ("카페" ≠ "카페모퉁이")
  const brand = detectBrand(a)?.brand;
  return short.length === 2 && brand !== undefined && brand === detectBrand(b)?.brand && long.startsWith(short);
}

function mergeInto(target: Store, other: Store): void {
  for (const src of other.sources) if (!target.sources.includes(src)) target.sources.push(src);
  target.address ??= other.address;
  target.roadAddress ??= other.roadAddress;
  target.phone ??= other.phone;
  target.url ??= other.url;
  target.openingHours ??= other.openingHours;
  target.brand ??= other.brand;
  target.categoryDetail ??= other.categoryDetail;
  if (target.category === 'etc' && other.category !== 'etc') target.category = other.category;
}

/**
 * 여러 출처의 매장 목록을 합친다. 가까이(60m 이내) 있고 이름이 같은 매장은 하나로 만들고,
 * 사라진 id → 남은 id 대응표(alias)를 돌려준다. 먼저 들어온 목록이 우선한다.
 */
export function mergeStores(lists: Store[][]): { stores: Store[]; alias: Map<string, string> } {
  const result: Store[] = [];
  const byId = new Map<string, Store>();
  const alias = new Map<string, string>();
  const grid = new Map<string, Store[]>();
  const cellOf = (s: Store) => [Math.floor(s.lat / GRID), Math.floor(s.lng / GRID)] as const;

  for (const list of lists) {
    for (const original of list) {
      if (byId.has(original.id)) {
        const existing = byId.get(original.id)!;
        if (existing !== original) mergeInto(existing, original);
        continue;
      }
      if (alias.has(original.id)) continue;
      const store: Store = { ...original, sources: [...original.sources] };
      let match: Store | undefined;
      if (!store.sources.includes('sample')) {
        const [cy, cx] = cellOf(store);
        outer: for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            for (const cand of grid.get(`${cy + dy}:${cx + dx}`) ?? []) {
              if (distanceMeters(cand, store) <= SAME_PLACE_METERS && sameStoreName(cand.name, store.name)) {
                match = cand;
                break outer;
              }
            }
          }
        }
      }
      if (match) {
        mergeInto(match, store);
        alias.set(store.id, match.id);
        continue;
      }
      result.push(store);
      byId.set(store.id, store);
      const [cy, cx] = cellOf(store);
      const key = `${cy}:${cx}`;
      const bucket = grid.get(key) ?? [];
      bucket.push(store);
      grid.set(key, bucket);
    }
  }
  return { stores: result, alias };
}
