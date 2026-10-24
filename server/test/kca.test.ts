import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { KcaManifest, KcaTileFile } from '@sale-radar/shared';
import { updateKcaSnapshot } from '../src/kca-update.ts';
import { KcaApiError, KcaSource, normalizeServiceKey } from '../src/sources/kca.ts';

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
  // 좌표가 다른 좌표계 → 주소로 찾는다
  {
    entpId: '2',
    entpName: 'GS25 강남점',
    entpTypeCode: 'CS',
    xMapCoord: '202345.1',
    yMapCoord: '444123.9',
    roadAddrBasic: '서울특별시 강남구 강남대로 2',
  },
  { entpId: '3', entpName: '부산 먼 마트', entpTypeCode: 'SM', xMapCoord: '129.07', yMapCoord: '35.17' },
];
const products: Record<string, string>[] = [
  { goodId: '10', goodName: '흰우유 1L', goodTotalCnt: '1000', goodTotalDivCode: 'ML' },
  { goodId: '20', goodName: '라면 5입' },
];

const TODAY = '2026-10-24'; // 토요일 → 최신 조사일 10/23(금)

/** 조사일 → 상품 → 판매점별 가격 */
const PRICES: Record<string, Record<string, [string, number, Record<string, string>?][]>> = {
  '20261023': {
    '10': [
      ['1', 2200, { goodDcYn: 'Y', goodDcStartDay: '20261020', goodDcEndDay: '20991231' }],
      ['2', 2900, { plusoneYn: 'Y' }],
      ['3', 2500],
    ],
    '20': [
      ['1', 4500],
      ['2', 4980],
    ],
  },
  '20261016': {
    '10': [
      ['1', 2800],
      ['2', 2900],
    ],
  },
};

describe('참가격 하루 한 번 업데이트', () => {
  let dir: string;
  let outDir: string;
  let rawDir: string;
  const calls: string[] = [];
  let failKey = false;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'kca-'));
    outDir = path.join(dir, 'public', 'data', 'kca');
    rawDir = path.join(dir, '.kca-raw');
    calls.length = 0;
    failKey = false;
    vi.stubGlobal('fetch', async (input: string | URL) => {
      const url = new URL(String(input));
      const op = url.pathname.split('/').pop()!;
      calls.push(op);
      if (failKey) {
        return new Response(
          '<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>',
        );
      }
      if (op === 'getStoreInfoSvc.do') return new Response(wrap(STORE_TAG, stores));
      if (op === 'getProductInfoSvc.do') return new Response(wrap('item', products));
      if (op === 'getProductPriceInfoSvc') {
        const day = url.searchParams.get('goodInspectDay')!;
        const goodId = url.searchParams.get('goodId')!;
        const rows = (PRICES[day]?.[goodId] ?? []).map(([entpId, price, extra]) => ({
          goodInspectDay: day,
          entpId,
          goodId,
          goodPrice: String(price),
          plusoneYn: 'N',
          goodDcYn: 'N',
          ...extra,
        }));
        return new Response(wrap(PRICE_TAG, rows));
      }
      return new Response('not found', { status: 404 });
    });
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    await rm(dir, { recursive: true, force: true });
  });

  const run = (extra: Partial<Parameters<typeof updateKcaSnapshot>[0]> = {}) =>
    updateKcaSnapshot({
      key: 'abc%2Bdef',
      baseUrl: 'https://example.test/svc',
      outDir,
      rawDir,
      today: TODAY,
      retryDelayMs: 1,
      geocode: async (addr) => (addr.includes('강남대로') ? { lat: 37.499, lng: 127.029 } : null),
      log: () => {},
      ...extra,
    });

  it('전국 가격을 받아 격자 파일로 만든다', async () => {
    const r = await run();
    expect(r.fetchedPrices).toBe(true);
    expect(r.geocoded).toBe(1);
    expect(r.manifest).toMatchObject({
      inspectDay: '2026-10-23',
      prevInspectDay: '2026-10-16',
      totals: { stores: 3, located: 3, products: 2, prices: 5, discounts: 1, onePlusOne: 1 },
    });
    const saved = JSON.parse(await readFile(path.join(outDir, 'manifest.json'), 'utf8')) as KcaManifest;
    expect(saved.versions['products.json']).toMatch(/^[0-9a-f]{10}$/);
    // 강남 2곳은 같은 격자, 부산은 다른 격자
    expect(Object.keys(saved.tiles)).toHaveLength(2);
    const seoulKey = Object.entries(saved.tiles).find(([, n]) => n === 2)![0];
    const tile = JSON.parse(await readFile(path.join(outDir, 't', `${seoulKey}.json`), 'utf8')) as KcaTileFile;
    const emart = tile.stores.find((s) => s.id === '1')!;
    // [상품, 가격, 표시, 할인시작, 할인끝, 지난주 정상가]
    expect(emart.prices).toEqual([
      ['10', 2200, 1, '2026-10-20', '2099-12-31', 2800],
      ['20', 4500, 0],
    ]);
    expect(tile.stores.find((s) => s.id === '2')).toMatchObject({
      lat: 37.499,
      category: 'convenience',
      brand: 'GS25',
    });
    // 원자료 보관
    expect(existsSync(path.join(rawDir, 'prices-2026-10-23.json'))).toBe(true);
    expect(existsSync(path.join(rawDir, 'geocode.json'))).toBe(true);
  });

  it('이미 받아 둔 조사일이면 가격을 다시 받지 않는다', async () => {
    await run();
    const first = calls.filter((c) => c === 'getProductPriceInfoSvc').length;
    calls.length = 0;
    const r = await run();
    expect(r.fetchedPrices).toBe(false);
    // 다음 날 실행: 판매점·상품 목록 2번만 (조사일 확인도 보관본으로)
    expect(calls).toEqual(['getStoreInfoSvc.do', 'getProductInfoSvc.do']);
    expect(first).toBeGreaterThan(2);
  });

  it('새 조사일 자료가 아직 없으면 지난 조사일로 만든다', async () => {
    const r = await run({ today: '2026-10-31' }); // 10/30 자료 없음 → 10/23
    expect(r.manifest.inspectDay).toBe('2026-10-23');
  });

  it('인증키 오류면 기존 자료를 그대로 두고 실패한다', async () => {
    await run();
    const before = await readFile(path.join(outDir, 'manifest.json'), 'utf8');
    failKey = true;
    await expect(run({ force: true })).rejects.toThrow(KcaApiError);
    await expect(run({ force: true })).rejects.toThrow(/인증키/);
    expect(await readFile(path.join(outDir, 'manifest.json'), 'utf8')).toBe(before);
    // 인증 오류는 다시 시도하지 않는다
    expect(calls.filter((c) => c === 'getStoreInfoSvc.do').length).toBeLessThanOrEqual(3);
  });

  it('검색은 만들어 둔 파일만 읽는다 (API 호출 없음)', async () => {
    await run();
    calls.length = 0;
    const kca = new KcaSource(outDir);
    const r = (await kca.deals({ lat: 37.4979, lng: 127.0276 }, 500))!;
    expect(calls).toEqual([]);
    expect(r.manifest.inspectDay).toBe('2026-10-23');
    const byId = Object.fromEntries(r.deals.map((d) => [d.id, d]));
    expect(Object.keys(byId).sort()).toEqual(['kca:1:10', 'kca:2:10']);
    expect(byId['kca:1:10']).toMatchObject({
      type: 'discount',
      salePrice: 2200,
      originalPrice: 2800,
      unit: '1000ml',
      startDate: '2026-10-20',
      category: 'mart',
    });
    // 주변(500m) 두 곳 평균 — 부산 매장은 들어가지 않는다
    expect(byId['kca:1:10'].priceCompare).toEqual({ avg: 2550, min: 2200, max: 2900, storeCount: 2 });
    expect(byId['kca:2:10']).toMatchObject({ type: 'one_plus_one', title: '흰우유 1L 1+1' });

    const cmp = (await kca.compare({ lat: 37.4979, lng: 127.0276 }, 500, '우유'))!;
    expect(cmp.groups[0]).toMatchObject({ productName: '흰우유 1L', min: 2200, max: 2900 });
    expect(cmp.groups[0].entries.map((e) => e.price)).toEqual([2200, 2900]);
  });

  it('스냅샷이 없으면 비어 있다', async () => {
    const kca = new KcaSource(path.join(dir, 'none'));
    expect(await kca.manifest()).toBeNull();
    expect(await kca.deals({ lat: 37.5, lng: 127 }, 500)).toBeNull();
  });

  it('인증키는 Encoding/Decoding 어느 쪽이든', () => {
    expect(normalizeServiceKey('abc%2Bdef%3D%3D')).toBe('abc+def==');
    expect(normalizeServiceKey(' abc+def== ')).toBe('abc+def==');
  });
});
