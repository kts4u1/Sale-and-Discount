import { describe, expect, it } from 'vitest';
import {
  buildTileQuery,
  categoryFromKakao,
  categoryFromOsm,
  detectBrand,
  matchesBrand,
  parseOverpassElements,
  tilesForCircle,
  TILE_DEG,
} from '@sale-radar/shared';
import { parseOpenApiItems, OpenApiError } from '../src/lib/xml.ts';
import { parseKcaCoords, recentFridays, toKcaPrice, toKcaProduct, toKcaStore } from '../src/sources/kca.ts';
import { kakaoPlaceToStore } from '../src/sources/kakao.ts';
import { formatKoreanAddress } from '../src/sources/nominatim.ts';

describe('브랜드·업종 인식', () => {
  it('편의점 브랜드', () => {
    expect(detectBrand('GS25 역삼점')?.brand).toBe('GS25');
    expect(detectBrand('CU 강남대로점')?.brand).toBe('CU');
    expect(detectBrand('씨유 서초점')?.brand).toBe('CU');
    expect(detectBrand('세븐일레븐 강남역점')?.brand).toBe('세븐일레븐');
    expect(detectBrand('이마트24 R강남점')?.brand).toBe('이마트24');
    expect(detectBrand('이마트 역삼점')?.brand).toBe('이마트');
    expect(detectBrand('Cucina 파스타')).toBeUndefined();
    expect(matchesBrand('GS25 테헤란점', undefined, 'GS25')).toBe(true);
    expect(matchesBrand('GS더프레시 역삼점', undefined, 'GS25')).toBe(false);
  });

  it('OSM 태그', () => {
    expect(categoryFromOsm({ amenity: 'restaurant' })).toBe('food');
    expect(categoryFromOsm({ amenity: 'cafe' })).toBe('cafe');
    expect(categoryFromOsm({ shop: 'convenience' })).toBe('convenience');
    expect(categoryFromOsm({ shop: 'bakery' })).toBe('bakery');
    expect(categoryFromOsm({ shop: 'cosmetics' })).toBe('beauty');
    expect(categoryFromOsm({ shop: 'hairdresser' })).toBeUndefined();
    expect(categoryFromOsm({ highway: 'bus_stop' })).toBeUndefined();
  });

  it('카카오 분류', () => {
    expect(categoryFromKakao('FD6', '음식점 > 간식 > 제과,베이커리')).toBe('bakery');
    expect(categoryFromKakao('FD6', '음식점 > 한식 > 국밥')).toBe('food');
    expect(categoryFromKakao('CE7', '음식점 > 카페 > 커피전문점')).toBe('cafe');
    expect(categoryFromKakao('CS2', '가정,생활 > 편의점 > GS25')).toBe('convenience');
    expect(categoryFromKakao('', '가정,생활 > 화장품', '올리브영 강남점')).toBe('beauty');
    expect(categoryFromKakao('', '가정,생활 > 생활용품점 > 다이소')).toBe('living');
  });
});

describe('OpenStreetMap', () => {
  it('Overpass 응답을 매장으로', () => {
    const stores = parseOverpassElements([
      {
        type: 'node',
        id: 1,
        lat: 37.5,
        lon: 127,
        tags: { amenity: 'cafe', name: '카페 A', opening_hours: 'Mo-Su 08:00-22:00' },
      },
      {
        type: 'way',
        id: 2,
        center: { lat: 37.51, lon: 127.01 },
        tags: { shop: 'convenience', name: 'GS25', branch: '역삼점' },
      },
      { type: 'node', id: 3, lat: 37.5, lon: 127, tags: { shop: 'car_repair', name: '정비소' } },
      { type: 'node', id: 4, lat: 37.5, lon: 127, tags: { amenity: 'restaurant' } },
    ]);
    expect(stores).toHaveLength(2);
    expect(stores[0]).toMatchObject({ id: 'osm:node/1', category: 'cafe', openingHours: 'Mo-Su 08:00-22:00' });
    expect(stores[1]).toMatchObject({ id: 'osm:way/2', name: 'GS25 역삼점', brand: 'GS25', lat: 37.51 });
  });

  it('반경을 덮는 격자 칸', () => {
    const tiles = tilesForCircle({ lat: 37.4979, lng: 127.0276 }, 1000);
    // 1km 반경 → 위도 3칸 x 경도 3~4칸
    expect(tiles.length).toBeGreaterThanOrEqual(6);
    expect(tiles.length).toBeLessThanOrEqual(12);
    const small = tilesForCircle({ lat: 37.4955, lng: 127.0255 }, 100);
    expect(small).toHaveLength(1);
    expect(buildTileQuery(small[0])).toContain(`[bbox:${(small[0].lat * TILE_DEG).toFixed(5)}`);
  });

  it('Nominatim 주소를 한국식 순서로', () => {
    expect(
      formatKoreanAddress({
        lat: '0',
        lon: '0',
        display_name: '강남역, 강남대로, 역삼동, 강남구, 서울특별시, 06232, 대한민국',
      }),
    ).toBe('서울특별시 강남구 역삼동 강남대로 강남역');
  });
});

describe('카카오 장소', () => {
  it('장소를 매장으로', () => {
    const s = kakaoPlaceToStore({
      id: '123',
      place_name: 'CU 역삼점',
      category_name: '가정,생활 > 편의점 > CU',
      category_group_code: 'CS2',
      category_group_name: '편의점',
      phone: '02-123-4567',
      address_name: '서울 강남구 역삼동 1',
      road_address_name: '서울 강남구 테헤란로 1',
      x: '127.03',
      y: '37.5',
      place_url: 'http://place.map.kakao.com/123',
    });
    expect(s).toMatchObject({
      id: 'kakao:123',
      category: 'convenience',
      brand: 'CU',
      lat: 37.5,
      lng: 127.03,
      phone: '02-123-4567',
    });
  });
});

describe('공공데이터 XML (참가격)', () => {
  it('항목 목록 읽기', () => {
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<response><result>
<iros.openapi.service.vo.goodPriceVO><goodInspectDay>20261023</goodInspectDay><entpId>0100</entpId><goodId>007</goodId><goodPrice>2980</goodPrice><plusoneYn>Y</plusoneYn><goodDcYn>N</goodDcYn><goodDcStartDay/><goodDcEndDay/><inputDttm>20261023093000</inputDttm></iros.openapi.service.vo.goodPriceVO>
<iros.openapi.service.vo.goodPriceVO><goodInspectDay>20261023</goodInspectDay><entpId>0100</entpId><goodId>008</goodId><goodPrice>1500</goodPrice><plusoneYn>N</plusoneYn><goodDcYn>Y</goodDcYn><goodDcStartDay>20261020</goodDcStartDay><goodDcEndDay>20261102</goodDcEndDay></iros.openapi.service.vo.goodPriceVO>
</result><resultCode>00</resultCode><resultMsg>NORMAL SERVICE.</resultMsg></response>`;
    const items = parseOpenApiItems(xml);
    expect(items).toHaveLength(2);
    expect(items[0].entpId).toBe('0100'); // 앞자리 0 유지
    expect(items[0].goodId).toBe('007');
    expect(items[0].goodDcStartDay).toBe('');
    const p = toKcaPrice(items[1] as never, '2026-10-23')!;
    expect(p).toMatchObject({
      price: 1500,
      discount: true,
      onePlusOne: false,
      dcStart: '2026-10-20',
      dcEnd: '2026-11-02',
    });
  });

  it('항목이 하나뿐이어도 목록으로', () => {
    const xml = `<response><result><item><goodId>1</goodId><goodName>우유 1L</goodName></item></result></response>`;
    expect(parseOpenApiItems(xml)).toEqual([{ goodId: '1', goodName: '우유 1L' }]);
  });

  it('게이트웨이 오류', () => {
    const xml = `<OpenAPI_ServiceResponse><cmmMsgHeader><errMsg>SERVICE ERROR</errMsg><returnAuthMsg>SERVICE_KEY_IS_NOT_REGISTERED_ERROR</returnAuthMsg><returnReasonCode>30</returnReasonCode></cmmMsgHeader></OpenAPI_ServiceResponse>`;
    expect(() => parseOpenApiItems(xml)).toThrow(OpenApiError);
    expect(() => parseOpenApiItems(xml)).toThrow(/SERVICE_KEY_IS_NOT_REGISTERED/);
  });

  it('빈 결과는 오류가 아님', () => {
    expect(parseOpenApiItems('<response><result></result><resultCode>00</resultCode></response>')).toEqual([]);
  });

  it('좌표: 경위도면 그대로, 뒤바뀌면 바로잡고, 다른 좌표계면 주소로 다시 찾도록', () => {
    expect(parseKcaCoords('127.0276', '37.4979')).toEqual({ lat: 37.4979, lng: 127.0276 });
    expect(parseKcaCoords('37.4979', '127.0276')).toEqual({ lat: 37.4979, lng: 127.0276 });
    expect(parseKcaCoords('202345.1', '444123.9')).toBeUndefined();
    expect(parseKcaCoords('', '')).toBeUndefined();
  });

  it('판매점·상품 변환', () => {
    const s = toKcaStore({
      entpId: '77',
      entpName: '롯데마트 서초점',
      entpTypeCode: 'LM',
      roadAddrBasic: '서울특별시 서초구 서초대로 1',
      xMapCoord: '127.01',
      yMapCoord: '37.49',
    });
    expect(s).toMatchObject({
      id: 'kca:77',
      category: 'mart',
      brand: '롯데마트',
      located: true,
      typeLabel: '대형마트',
    });
    const s2 = toKcaStore({ entpId: '78', entpName: 'GS25 역삼점', entpTypeCode: 'CS' });
    expect(s2).toMatchObject({ category: 'convenience', located: false });
    expect(toKcaProduct({ goodId: '1', goodName: ' 서울우유 ', goodTotalCnt: '1000', goodTotalDivCode: 'ML' })).toEqual(
      { goodId: '1', name: '서울우유', unit: '1000ml' },
    );
  });

  it('최근 금요일 목록', () => {
    // 2026-10-24 토요일 → 10/23(금)부터
    expect(recentFridays(3, '2026-10-24')).toEqual(['2026-10-23', '2026-10-16', '2026-10-09']);
    expect(recentFridays(1, '2026-10-23')).toEqual(['2026-10-23']);
  });
});
