import { describe, expect, it } from 'vitest';
import { type DealView, type Store, type StoreWithDistance } from '@sale-radar/shared';
import {
  assembleSearch,
  computeChainPromotions,
  generateSampleData,
  mergeStores,
  sameStoreName,
  type KcaPriceTuple,
} from '@sale-radar/shared';
import { parseChainStoresCsv } from '../src/chain-stores.ts';
import { computeStats, filterDeals, isReportedExpired, sortDeals } from '../src/services/search.ts';
import { distanceMeters } from '@sale-radar/shared';

const store = (id: string, name: string, lat: number, lng: number, extra: Partial<Store> = {}): Store => ({
  id,
  name,
  category: 'food',
  lat,
  lng,
  sources: [id.split(':')[0] as Store['sources'][number]],
  ...extra,
});

describe('매장 합치기', () => {
  it('이름 비교', () => {
    expect(sameStoreName('GS25 역삼점', 'GS25역삼점')).toBe(true);
    expect(sameStoreName('스타벅스 강남R점', '스타벅스 강남R')).toBe(true);
    expect(sameStoreName('CU', 'CU 역삼점')).toBe(true);
    expect(sameStoreName('카페', '카페모퉁이')).toBe(false);
    expect(sameStoreName('김밥천국', '홍콩반점')).toBe(false);
  });

  it('가까운 같은 이름 매장은 하나로, 정보는 채워 넣는다', () => {
    const { stores, alias } = mergeStores([
      [store('kakao:1', 'GS25 역삼점', 37.5, 127.0, { phone: '02-1', category: 'convenience' })],
      [store('osm:node/9', 'GS25 역삼점', 37.50005, 127.00005, { openingHours: '24/7', category: 'convenience' })],
      [store('osm:node/10', 'GS25 역삼점', 37.51, 127.0)], // 1km 떨어진 다른 지점
    ]);
    expect(stores).toHaveLength(2);
    expect(stores[0]).toMatchObject({ id: 'kakao:1', phone: '02-1', openingHours: '24/7', sources: ['kakao', 'osm'] });
    expect(alias.get('osm:node/9')).toBe('kakao:1');
  });

  it('샘플 매장은 합치지 않는다', () => {
    const { stores } = mergeStores([
      [store('kakao:1', '[샘플] 행복마트', 37.5, 127)],
      [store('sample:1', '[샘플] 행복마트', 37.5, 127, { sources: ['sample'] })],
    ]);
    expect(stores).toHaveLength(2);
  });
});

const view = (over: Partial<DealView>): DealView => {
  const s: StoreWithDistance = {
    ...store('kakao:1', '테스트 식당', 37.5, 127, { category: over.category ?? 'food' }),
    distance: over.distance ?? 100,
    walkMinutes: 2,
    dealCount: 1,
  };
  return {
    id: Math.random().toString(36),
    storeId: s.id,
    title: '행사',
    type: 'discount',
    category: 'food',
    tags: [],
    source: 'community',
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    likes: 0,
    confirms: 0,
    expiredReports: 0,
    store: s,
    distance: 100,
    walkMinutes: 2,
    status: 'active',
    activeNow: true,
    endingSoon: false,
    effectiveDiscount: 0,
    ...over,
  };
};

describe('검색 필터·정렬', () => {
  const deals = [
    view({
      id: 'a',
      title: '치킨 3천원 할인',
      category: 'food',
      type: 'discount',
      effectiveDiscount: 15,
      salePrice: 17000,
      distance: 300,
      likes: 3,
    }),
    view({
      id: 'b',
      title: '우유 1+1',
      productName: '서울 흰우유',
      category: 'mart',
      type: 'one_plus_one',
      effectiveDiscount: 50,
      salePrice: 2980,
      distance: 600,
      endsInMinutes: 30,
      endingSoon: true,
    }),
    view({
      id: 'c',
      title: '마감 빵 할인',
      category: 'bakery',
      type: 'closing_sale',
      effectiveDiscount: 40,
      distance: 120,
      activeNow: false,
      status: 'later_today',
      startsInMinutes: 90,
    }),
    view({
      id: 'd',
      title: '아메리카노 1500원',
      category: 'cafe',
      type: 'time_sale',
      effectiveDiscount: 50,
      salePrice: 1500,
      distance: 900,
      confirms: 10,
      createdAt: '2026-10-20T00:00:00Z',
    }),
  ];
  const ids = (list: DealView[]) => list.map((d) => d.id);

  it('업종·종류·검색어·진행중·할인율', () => {
    expect(ids(filterDeals(deals, { lat: 0, lng: 0, radius: 1000, categories: ['food', 'cafe'] }))).toEqual(['a', 'd']);
    expect(ids(filterDeals(deals, { lat: 0, lng: 0, radius: 1000, types: ['one_plus_one', 'closing_sale'] }))).toEqual([
      'b',
      'c',
    ]);
    expect(ids(filterDeals(deals, { lat: 0, lng: 0, radius: 1000, q: '흰 우유' }))).toEqual(['b']);
    expect(ids(filterDeals(deals, { lat: 0, lng: 0, radius: 1000, q: '테스트 식당' }))).toHaveLength(4);
    expect(ids(filterDeals(deals, { lat: 0, lng: 0, radius: 1000, activeOnly: true }))).toEqual(['a', 'b', 'd']);
    expect(ids(filterDeals(deals, { lat: 0, lng: 0, radius: 1000, minDiscount: 45 }))).toEqual(['b', 'd']);
    expect(ids(filterDeals(deals, { lat: 0, lng: 0, radius: 1000, maxPrice: 3000 }))).toEqual(['b', 'd']);
  });

  it('정렬', () => {
    expect(ids(sortDeals(deals, 'distance', 1000))).toEqual(['c', 'a', 'b', 'd']);
    expect(ids(sortDeals(deals, 'discount', 1000))).toEqual(['b', 'd', 'c', 'a']);
    expect(ids(sortDeals(deals, 'ending', 1000))[0]).toBe('b');
    expect(ids(sortDeals(deals, 'price', 1000))).toEqual(['d', 'b', 'a', 'c']);
    expect(ids(sortDeals(deals, 'newest', 1000))[0]).toBe('d');
    expect(ids(sortDeals(deals, 'popular', 1000))[0]).toBe('d');
    // 추천순: 지금 진행 중인 행사가 먼저, 예정 행사는 뒤
    expect(ids(sortDeals(deals, 'recommended', 1000)).at(-1)).toBe('c');
  });

  it('통계: 업종 개수는 업종 필터와 무관하게 센다', () => {
    const q = { lat: 0, lng: 0, radius: 1000, categories: ['food' as const] };
    const filtered = filterDeals(deals, q);
    const stats = computeStats(deals, filtered, q, 10);
    expect(stats.totalDeals).toBe(1);
    expect(stats.byCategory).toEqual({ food: 1, mart: 1, bakery: 1, cafe: 1 });
    expect(stats.maxDiscount).toBe(15);
  });

  it('종료 신고가 많으면 숨김', () => {
    expect(isReportedExpired({ expiredReports: 3, confirms: 1 })).toBe(true);
    expect(isReportedExpired({ expiredReports: 3, confirms: 5 })).toBe(false);
    expect(isReportedExpired({ expiredReports: 2, confirms: 0 })).toBe(false);
  });
});

describe('샘플 데이터', () => {
  const center = { lat: 37.4979, lng: 127.0276 };
  const now = { date: '2026-10-24', time: '12:00', minutes: 720, weekday: 6 };

  it('반경 안에서만, 항상 같은 결과', () => {
    const a = generateSampleData(center, 500, now);
    const b = generateSampleData(center, 500, now);
    expect(a.deals.length).toBeGreaterThan(5);
    expect(a.deals.map((d) => d.id)).toEqual(b.deals.map((d) => d.id));
    for (const s of a.stores) expect(distanceMeters(center, s)).toBeLessThanOrEqual(500);
  });

  it('모두 샘플 표시가 있다', () => {
    const { stores, deals } = generateSampleData(center, 1000, now);
    expect(stores.every((s) => s.name.startsWith('[샘플]') && s.sources.includes('sample'))).toBe(true);
    expect(deals.every((d) => d.isSample && d.source === 'sample' && d.description?.includes('샘플'))).toBe(true);
  });

  it('반경이 넓을수록 더 많다', () => {
    expect(generateSampleData(center, 1000, now).stores.length).toBeGreaterThan(
      generateSampleData(center, 300, now).stores.length,
    );
  });
});

describe('체인 공통 행사', () => {
  const p = (goodId: string, price: number, flags = 1, end = '2026-10-31', prev?: number): KcaPriceTuple =>
    prev ? [goodId, price, flags, '2026-10-01', end, prev] : [goodId, price, flags, '2026-10-01', end];
  const products = { '1': ['햇반 210g', '210g'] as [string, string], '2': ['라면'] as [string] };

  it('같은 체인 조사 매장 대부분이 같은 할인을 하면 체인 공통 행사', () => {
    const stores = [
      { name: 'GS더프레시 A점', category: 'mart' as const, prices: [p('1', 3990, 1, '2026-10-31', 4980), p('2', 900)] },
      { name: 'GS더프레시 B점', category: 'mart' as const, prices: [p('1', 3990, 1, '2026-10-31', 4980)] },
      { name: 'GS더프레시 C점', category: 'mart' as const, prices: [p('1', 4100)] },
      { name: '롯데슈퍼 D점', category: 'mart' as const, prices: [p('1', 3000)] },
    ];
    const promos = computeChainPromotions(stores, products, '2026-10-09');
    expect(promos).toHaveLength(1);
    expect(promos[0]).toMatchObject({
      brand: 'GS더프레시',
      productName: '햇반 210g',
      price: 3990,
      originalPrice: 4980,
      endDate: '2026-10-31',
      source: 'kca',
    });
    // 3곳 미만인 체인은 판단하지 않는다
    expect(computeChainPromotions(stores.slice(0, 2), products, '2026-10-09')).toHaveLength(0);
  });

  it('주변 같은 체인 지점에 붙고, 조사 매장 자체 행사와는 겹치지 않는다', () => {
    const promo = computeChainPromotions(
      [1, 2, 3].map((i) => ({ name: `GS더프레시 ${i}점`, category: 'mart' as const, prices: [p('1', 3990)] })),
      products,
      '2026-10-09',
    );
    const branch = {
      id: 'osm:node/1',
      name: 'GS더프레시 우리동네점',
      brand: 'GS더프레시',
      category: 'mart' as const,
      lat: 37.5,
      lng: 127.0,
      sources: ['osm' as const],
    };
    const now = { date: '2026-10-24', time: '12:00', minutes: 720, weekday: 6 };
    const { response } = assembleSearch({
      query: { lat: 37.501, lng: 127.0, radius: 1000 },
      now,
      includeSample: false,
      storeLists: [[branch]],
      deals: [],
      brand: { promotions: promo },
      sources: [],
    });
    expect(response.deals).toHaveLength(1);
    expect(response.deals[0]).toMatchObject({ storeId: 'osm:node/1', title: '햇반 210g 할인', salePrice: 3990 });
  });
});

describe('전국 체인 매장 CSV', () => {
  it('편의점·마트 브랜드만, 지점명 붙이기', () => {
    const csv = [
      'node\t1\t37.5\t127.0\tGS25\tGS25\t역삼점\t',
      'way\t2\t37.6\t127.1\t다이소\t다이소\t\t',
      'node\t3\t37.7\t127.2\t씨유 강남점\t\t\t',
      'bad line',
    ].join('\n');
    expect(parseChainStoresCsv(csv)).toEqual([
      [37.5, 127, 'GS25', 'GS25 역삼점', 'node/1'],
      [37.7, 127.2, 'CU', '씨유 강남점', 'node/3'],
    ]);
  });
});
