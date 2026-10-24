import { useCallback, useEffect, useRef, useState } from 'react';

const PREFIX = 'sale-radar:';

/** 사생활 보호 모드 등에서 localStorage 가 막혀 있어도 앱이 멈추지 않게 감싼다 */
export function loadValue<T>(key: string, fallback: T): T {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function saveValue(key: string, value: unknown): void {
  try {
    window.localStorage.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // 저장 공간이 없거나 막혀 있으면 무시
  }
}

/** localStorage 에 저장되는 useState */
export function usePersistentState<T>(key: string, fallback: T): [T, (v: T | ((prev: T) => T)) => void] {
  const [value, setValue] = useState<T>(() => loadValue(key, fallback));
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    saveValue(key, value);
  }, [key, value]);
  const set = useCallback((v: T | ((prev: T) => T)) => setValue(v), []);
  return [value, set];
}
