import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  extractMenuItems,
  goodPriceCategory,
  parseDealType,
  parseGoodPriceCsv,
  parsePromotionsCsv,
} from '../src/importers.ts';
import { csvToObjects, decodeKoreanText, parseCsv } from '../src/lib/csv.ts';
import { CommunityStore } from '../src/store/community.ts';

describe('CSV', () => {
  it('따옴표, 쉼표, 줄바꿈이 들어간 칸', () => {
    const rows = parseCsv('a,b,c\r\n"1,000","줄\n바꿈","따옴표 ""안"""\n\n4,5,6');
    expect(rows).toEqual([
      ['a', 'b', 'c'],
      ['1,000', '줄\n바꿈', '따옴표 "안"'],
      ['4', '5', '6'],
    ]);
  });

  it('BOM 제거 후 머리글로 객체', () => {
    expect(csvToObjects('﻿이름,가격\n우유,2000')).toEqual([{ 이름: '우유', 가격: '2000' }]);
  });

  it('EUC-KR 파일 읽기', () => {
    // "가격" in EUC-KR
    const euckr = new Uint8Array([0xb0, 0xa1, 0xb0, 0xdd]);
    expect(decodeKoreanText(euckr)).toBe('가격');
    expect(decodeKoreanText(new TextEncoder().encode('가격'))).toBe('가격');
  });
});

describe('착한가격업소 불러오기', () => {
  it('지자체마다 다른 열 이름을 알아본다', () => {
    const csv = `업소명,업종,소재지도로명주소,위도,경도,연락처,메뉴1,가격1,메뉴2,가격2,데이터기준일자
착한국밥,한식,경기도 가평군 가평읍 1,37.83,127.51,031-000-0000,국밥,"7,000",수육,15000,2026-09-01
행복미용실,미용업,경기도 가평군 가평읍 2,,,,커트,8000,,,20260901`;
    const parsed = parseGoodPriceCsv(csv, '가평군');
    expect(parsed).toHaveLength(2);
    expect(parsed[0].store).toMatchObject({
      name: '착한국밥',
      category: 'food',
      address: '경기도 가평군 가평읍 1',
      lat: 37.83,
      lng: 127.51,
      phone: '031-000-0000',
      region: '가평군',
      baseDate: '2026-09-01',
      items: [
        { name: '국밥', price: 7000 },
        { name: '수육', price: 15000 },
      ],
    });
    expect(parsed[1].store).toMatchObject({
      category: 'beauty',
      lat: undefined,
      items: [{ name: '커트', price: 8000 }],
    });
  });

  it('다른 메뉴 열 이름', () => {
    expect(extractMenuItems({ 대표메뉴: '짜장면', 가격: '6000' })).toEqual([{ name: '짜장면', price: 6000 }]);
    expect(extractMenuItems({ 주요품목1: '세탁', 가격1: '3000' })).toEqual([{ name: '세탁', price: 3000 }]);
    expect(goodPriceCategory('세탁업')).toBe('etc');
    expect(goodPriceCategory('중식')).toBe('food');
  });
});

describe('브랜드 행사 불러오기', () => {
  it('한글 행사 이름도 인식', () => {
    expect(parseDealType('1+1')).toBe('one_plus_one');
    expect(parseDealType('2 + 1')).toBe('two_plus_one');
    expect(parseDealType('증정')).toBe('gift');
    expect(parseDealType('two_plus_one')).toBe('two_plus_one');
    expect(parseDealType('???')).toBeUndefined();
  });

  it('CSV → 행사', () => {
    const { promotions, skipped } = parsePromotionsCsv(`brand,productName,type,price,startDate,endDate
GS25,탄산음료 500ml,2+1,2200,2026-11-01,2026-11-30
CU,컵라면,1+1,1800,20261101,20261130
,빠진 브랜드,1+1,1000,,`);
    expect(skipped).toBe(1);
    expect(promotions).toHaveLength(2);
    expect(promotions[0]).toMatchObject({
      brand: 'GS25',
      type: 'two_plus_one',
      price: 2200,
      startDate: '2026-11-01',
      endDate: '2026-11-30',
    });
    expect(promotions[1]).toMatchObject({ brand: 'CU', startDate: '2026-11-01' });
  });
});

describe('사용자 제보 저장소', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'community-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const input = {
    store: { name: '동네빵집', lat: 37.5, lng: 127.0, category: 'bakery' as const },
    title: '마감 빵 50% 할인',
    type: 'closing_sale' as const,
    timeStart: '21:00',
    timeEnd: '22:00',
  };

  it('등록하면 파일에 저장되고 다시 읽힌다', async () => {
    const a = new CommunityStore(dir);
    const { deal, store } = await a.create(input);
    expect(store.id).toMatch(/^community:/);
    expect(deal).toMatchObject({ source: 'community', title: '마감 빵 50% 할인', storeId: store.id });
    await a.flush();

    const saved = JSON.parse(await readFile(path.join(dir, 'community.json'), 'utf8'));
    expect(saved.deals).toHaveLength(1);

    const b = new CommunityStore(dir);
    const near = await b.nearby({ lat: 37.5005, lng: 127.0 }, 100);
    expect(near.deals).toHaveLength(1);
    const far = await b.nearby({ lat: 37.52, lng: 127.0 }, 1000);
    expect(far.deals).toHaveLength(0);
  });

  it('기존 매장 id 를 쓰면 같은 매장에 붙는다', async () => {
    const a = new CommunityStore(dir);
    const r1 = await a.create({ ...input, store: { ...input.store, id: 'kakao:42' } });
    const r2 = await a.create({ ...input, title: '두 번째 행사', store: { ...input.store, id: 'kakao:42' } });
    expect(r1.store.id).toBe('kakao:42');
    expect(r2.store.id).toBe('kakao:42');
    expect(await a.allStores()).toHaveLength(1);
    // 엉뚱한 id 는 무시하고 새로 만든다
    const r3 = await a.create({ ...input, store: { ...input.store, id: 'javascript:alert(1)' } });
    expect(r3.store.id).toMatch(/^community:/);
  });

  it('같은 사람의 중복 투표는 한 번만', async () => {
    const a = new CommunityStore(dir);
    const { deal } = await a.create(input);
    await a.vote(deal.id, 'like', 'user1');
    const dup = await a.vote(deal.id, 'like', 'user1');
    expect(dup).toMatchObject({ likes: 1, duplicate: true });
    await a.vote(deal.id, 'like', 'user2');
    await a.vote(deal.id, 'confirm', 'user2');
    const r = await a.vote(deal.id, 'expired', 'user3');
    expect(r).toMatchObject({ likes: 2, confirms: 1, expiredReports: 1, duplicate: false });
    // 다른 출처 행사에도 반응을 저장할 수 있다
    await a.vote('kca:1:10', 'confirm', 'user1');
    expect((await a.reactions(['kca:1:10'])).get('kca:1:10')).toMatchObject({ confirms: 1 });
  });
});
