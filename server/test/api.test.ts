import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppConfig, SearchResponse } from '@sale-radar/shared';
import { createApp } from '../src/app.ts';
import { loadConfig } from '../src/config.ts';

let server: Server;
let base: string;
let dir: string;

beforeAll(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'api-'));
  const config = loadConfig({
    dataDir: dir,
    clientDist: path.join(dir, 'no-client'),
    enableOsm: false,
    sampleMode: 'auto',
    dataGoKrKey: undefined,
    kakaoKey: undefined,
    naverClientId: undefined,
    naverClientSecret: undefined,
  });
  server = createApp(config).listen(0);
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((r) => server.close(r));
  await rm(dir, { recursive: true, force: true });
});

const get = async <T>(p: string) => {
  const res = await fetch(base + p);
  return { status: res.status, body: (await res.json()) as T };
};
const post = async <T>(p: string, body: unknown) => {
  const res = await fetch(base + p, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as T };
};

const CENTER = 'lat=37.4979&lng=127.0276';

describe('API', () => {
  it('설정: 키가 없으면 샘플을 기본으로', async () => {
    const { body } = await get<AppConfig>('/api/config');
    expect(body.radiusOptions).toEqual([100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]);
    expect(body.sampleDefault).toBe(true);
    expect(body.sources.find((s) => s.id === 'kca')).toMatchObject({
      enabled: false,
      requires: 'DATA_GO_KR_SERVICE_KEY',
    });
  });

  it('반경 안의 행사만, 반경을 넓히면 더 많이', async () => {
    const small = await get<SearchResponse>(`/api/deals?${CENTER}&radius=200`);
    const large = await get<SearchResponse>(`/api/deals?${CENTER}&radius=1000`);
    expect(small.status).toBe(200);
    expect(small.body.sampleIncluded).toBe(true);
    expect(small.body.deals.every((d) => d.distance <= 200)).toBe(true);
    expect(large.body.deals.length).toBeGreaterThan(small.body.deals.length);
    expect(large.body.stats.totalDeals).toBe(large.body.deals.length);
    expect(large.body.sources.map((s) => s.id)).toContain('osm');
  });

  it('반경은 100m~1km 로 맞춘다', async () => {
    expect((await get<SearchResponse>(`/api/deals?${CENTER}&radius=5000`)).body.radius).toBe(1000);
    expect((await get<SearchResponse>(`/api/deals?${CENTER}&radius=10`)).body.radius).toBe(100);
  });

  it('필터와 샘플 끄기', async () => {
    const r = await get<SearchResponse>(
      `/api/deals?${CENTER}&radius=1000&categories=cafe&types=one_plus_one,time_sale`,
    );
    expect(r.body.deals.every((d) => d.category === 'cafe' || d.store.category === 'cafe')).toBe(true);
    expect(r.body.deals.every((d) => ['one_plus_one', 'time_sale'].includes(d.type))).toBe(true);
    const off = await get<SearchResponse>(`/api/deals?${CENTER}&radius=1000&sample=0`);
    expect(off.body.sampleIncluded).toBe(false);
    expect(off.body.deals).toHaveLength(0);
  });

  it('잘못된 요청은 400', async () => {
    expect((await get(`/api/deals?lat=abc&lng=127`)).status).toBe(400);
    expect((await get(`/api/deals`)).status).toBe(400);
    expect((await get(`/api/nothing`)).status).toBe(404);
  });

  it('제보 → 검색 결과에 나오고 투표가 반영된다', async () => {
    const bad = await post<{ error: string }>('/api/deals', { title: 'x' });
    expect(bad.status).toBe(400);

    const wrongPrice = await post<{ error: string }>('/api/deals', {
      store: { name: '테스트 분식', lat: 37.498, lng: 127.0277, category: 'food' },
      title: '떡볶이 할인',
      type: 'discount',
      originalPrice: 3000,
      salePrice: 5000,
    });
    expect(wrongPrice.status).toBe(400);
    expect(wrongPrice.body.error).toContain('정가');

    const created = await post<{ deal: { id: string } }>('/api/deals', {
      store: { name: '테스트 분식', lat: 37.498, lng: 127.0277, category: 'food' },
      title: '떡볶이 1인분 3,000원',
      type: 'discount',
      originalPrice: 4500,
      salePrice: 3000,
      timeStart: '00:00',
      timeEnd: '23:59',
    });
    expect(created.status).toBe(201);

    const found = await get<SearchResponse>(`/api/deals?${CENTER}&radius=100&sample=0&q=떡볶이`);
    expect(found.body.deals).toHaveLength(1);
    expect(found.body.deals[0]).toMatchObject({ source: 'community', effectiveDiscount: 33, salePrice: 3000 });

    const vote = await post<{ likes: number }>(`/api/deals/${encodeURIComponent(created.body.deal.id)}/vote`, {
      action: 'like',
    });
    expect(vote.body.likes).toBe(1);
    const again = await get<SearchResponse>(`/api/deals?${CENTER}&radius=100&sample=0&q=떡볶이`);
    expect(again.body.deals[0].likes).toBe(1);
  });

  it('주변 매장 목록 (제보 매장 포함)', async () => {
    const r = await get<{ stores: { name: string }[] }>(`/api/stores?${CENTER}&radius=300`);
    expect(r.body.stores.map((s) => s.name)).toContain('테스트 분식');
  });

  it('가격 비교: 참가격 키가 없으면 꺼짐 상태', async () => {
    const r = await get<{ source: { enabled: boolean }; groups: unknown[] }>(`/api/prices?${CENTER}&q=우유`);
    expect(r.body.source.enabled).toBe(false);
    expect(r.body.groups).toEqual([]);
  });
});
