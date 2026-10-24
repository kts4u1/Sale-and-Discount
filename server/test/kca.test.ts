import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.ts';
import { KcaSource, recentFridays } from '../src/sources/kca.ts';

const wrap = (tag: string, items: Record<string, string>[]) =>
  `<?xml version="1.0" encoding="UTF-8"?><response><result>${items
    .map(
      (i) =>
        `<${tag}>${Object.entries(i)
          .map(([k, v]) => `<${k}>${v}</${k}>`)
          .join('')}</${tag}>`,
    )
    .join('')}</result><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></response>`;

const STORE_TAG = 'iros.openapi.service.vo.entpInfoVO';
const PRICE_TAG = 'iros.openapi.service.vo.goodPriceVO';

const stores: Record<string, string>[] = [
  {
    entpId: '1',
    entpName: '이마트 역삼점',
    entpTypeCode: 'LM',
    xMapCoord: '127.0280',
    yMapCoord: '37.4985',
    roadAddrBasic: '서울특별시 강남구 역삼로 1',
  },
  {
    entpId: '2',
    entpName: 'GS25 강남점',
    entpTypeCode: 'CS',
    xMapCoord: '127.0290',
    yMapCoord: '37.4990',
    roadAddrBasic: '서울특별시 강남구 강남대로 2',
  },
  { entpId: '3', entpName: '부산 먼 마트', entpTypeCode: 'SM', xMapCoord: '129.07', yMapCoord: '35.17' },
];
const products: Record<string, string>[] = [
  { goodId: '10', goodName: '흰우유 1L', goodTotalCnt: '1000', goodTotalDivCode: 'ML' },
  { goodId: '20', goodName: '라면 5입' },
];

describe('참가격 소스', () => {
  let dir: string;
  const latest = recentFridays(1)[0].replaceAll('-', '');
  const prevDay = recentFridays(2)[1].replaceAll('-', '');
  const calls: string[] = [];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kca-'));
    calls.length = 0;
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input));
      calls.push(url.pathname + url.search);
      const op = url.pathname.split('/').pop();
      if (op === 'getStoreInfoSvc.do') return new Response(wrap(STORE_TAG, stores));
      if (op === 'getProductInfoSvc.do') return new Response(wrap('item', products));
      if (op === 'getProductPriceInfoSvc') {
        const day = url.searchParams.get('goodInspectDay');
        const entp = url.searchParams.get('entpId')!;
        const price = (goodId: string, goodPrice: number, extra: Record<string, string> = {}) => ({
          goodInspectDay: day!,
          entpId: entp,
          goodId,
          goodPrice: String(goodPrice),
          plusoneYn: 'N',
          goodDcYn: 'N',
          ...extra,
        });
        if (day === latest && entp === '1')
          return new Response(
            wrap(PRICE_TAG, [
              price('10', 2200, { goodDcYn: 'Y', goodDcStartDay: '20200101', goodDcEndDay: '20991231' }),
              price('20', 4500),
            ]),
          );
        if (day === latest && entp === '2')
          return new Response(wrap(PRICE_TAG, [price('10', 2900, { plusoneYn: 'Y' }), price('20', 4980)]));
        if (day === prevDay && entp === '1') return new Response(wrap(PRICE_TAG, [price('10', 2800)]));
        return new Response(wrap(PRICE_TAG, []));
      }
      return new Response('not found', { status: 404 });
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  const source = () =>
    new KcaSource(loadConfig({ dataDir: dir, dataGoKrKey: 'abc%2Bdef', kcaBaseUrl: 'https://example.test/svc' }));

  it('반경 안 매장의 할인·1+1 상품을 행사로 만든다', async () => {
    const result = await source().deals({ lat: 37.4979, lng: 127.0276 }, 500);
    expect(result.stores.map((s) => s.entpId).sort()).toEqual(['1', '2']);
    expect(result.inspectDay).toBe(recentFridays(1)[0]);
    const byId = Object.fromEntries(result.deals.map((d) => [d.id, d]));
    expect(Object.keys(byId).sort()).toEqual(['kca:1:10', 'kca:2:10']);

    const milk = byId['kca:1:10'];
    expect(milk).toMatchObject({
      type: 'discount',
      salePrice: 2200,
      originalPrice: 2800, // 지난주 가격
      unit: '1000ml',
      startDate: '2020-01-01',
      endDate: '2099-12-31',
      category: 'mart',
      source: 'kca',
    });
    expect(milk.priceCompare).toEqual({ avg: 2550, min: 2200, max: 2900, storeCount: 2 });
    expect(byId['kca:2:10']).toMatchObject({ type: 'one_plus_one', category: 'convenience', title: '흰우유 1L 1+1' });
  });

  it('인증키(Encoding 키)를 한 번만 인코딩해서 보낸다', async () => {
    await source().deals({ lat: 37.4979, lng: 127.0276 }, 500);
    const storeCall = calls.find((c) => c.includes('getStoreInfoSvc'))!;
    expect(storeCall).toContain('ServiceKey=abc%2Bdef');
    const priceCall = calls.find((c) => c.includes('getProductPriceInfoSvc'))!;
    expect(priceCall).toContain('serviceKey=abc%2Bdef');
  });

  it('가격 비교', async () => {
    const r = await source().compare({ lat: 37.4979, lng: 127.0276 }, 500, '우유');
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ productName: '흰우유 1L', min: 2200, max: 2900, avg: 2550 });
    expect(r.groups[0].entries.map((e) => e.price.price)).toEqual([2200, 2900]);
  });
});
