/** OpenStreetMap Nominatim 응답 (주소 검색) */
export interface NominatimPlace {
  lat: string;
  lon: string;
  display_name: string;
  name?: string;
  address?: Record<string, string>;
}

/** Nominatim 의 "건물, 번지, 길, 동, 구, 시, 우편번호, 대한민국" 순서를 한국식으로 뒤집는다 */
export function formatKoreanAddress(p: NominatimPlace): string {
  const a = p.address;
  if (a) {
    const parts = [
      a.province ?? a.state,
      a.city,
      a.borough ?? a.city_district ?? a.county,
      a.quarter ?? a.suburb,
      a.road,
      a.house_number,
    ].filter((v, i, arr): v is string => Boolean(v) && arr.indexOf(v) === i);
    if (parts.length >= 2) return parts.join(' ');
  }
  return p.display_name
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s && s !== '대한민국' && !/^\d{5}$/.test(s))
    .reverse()
    .join(' ');
}

/** 역지오코딩 결과에서 시·도 / 시·군·구 / 동 */
export function regionsFromNominatim(a: Record<string, string> = {}) {
  return {
    region1: a.province ?? a.state ?? a.city,
    region2: a.city_district ?? a.borough ?? a.county ?? a.city,
    region3: a.quarter ?? a.suburb ?? a.neighbourhood,
  };
}
