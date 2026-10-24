import { useEffect, useState } from 'react';

export function useDebounced<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(t);
  }, [value, delayMs]);
  return debounced;
}

export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mql = window.matchMedia(query);
    const onChange = () => setMatches(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [query]);
  return matches;
}

export interface Position {
  lat: number;
  lng: number;
  accuracy?: number;
}

export type GeoError = 'unsupported' | 'denied' | 'unavailable' | 'timeout' | 'insecure';

/** 브라우저 위치 한 번 가져오기 */
export function getCurrentPosition(): Promise<Position> {
  return new Promise((resolve, reject) => {
    if (!window.isSecureContext) return reject('insecure' satisfies GeoError);
    if (!('geolocation' in navigator)) return reject('unsupported' satisfies GeoError);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: pos.coords.accuracy }),
      (err) =>
        reject(
          (err.code === err.PERMISSION_DENIED
            ? 'denied'
            : err.code === err.TIMEOUT
              ? 'timeout'
              : 'unavailable') satisfies GeoError,
        ),
      { enableHighAccuracy: true, timeout: 12_000, maximumAge: 60_000 },
    );
  });
}

export const GEO_ERROR_TEXT: Record<GeoError, string> = {
  unsupported: '이 브라우저는 위치 기능을 지원하지 않습니다.',
  denied: '위치 권한이 꺼져 있어요. 브라우저 설정에서 위치 권한을 허용하거나 주소로 검색해 주세요.',
  unavailable: '현재 위치를 확인할 수 없습니다. 잠시 후 다시 시도하거나 주소로 검색해 주세요.',
  timeout: '위치 확인 시간이 초과됐어요. 다시 시도해 주세요.',
  insecure: '위치 기능은 https 주소(또는 localhost)에서만 동작합니다. 주소로 검색해 주세요.',
};
