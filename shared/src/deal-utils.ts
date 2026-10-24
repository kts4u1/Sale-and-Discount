import { WALK_METERS_PER_MINUTE } from './constants.ts';
import type { Deal, DealStatus, LatLng } from './types.ts';

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** 두 좌표 사이 직선거리(m), haversine 공식 */
export function distanceMeters(a: LatLng, b: LatLng): number {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * 직선거리로 도보 시간을 추정한다. 실제 길은 직선보다 길어서 1.3배를 곱한다.
 */
export function walkMinutes(distance: number): number {
  return Math.max(1, Math.round((distance * 1.3) / WALK_METERS_PER_MINUTE));
}

/** 중심점에서 bearing(도) 방향으로 distance(m) 떨어진 좌표 */
export function destinationPoint(origin: LatLng, bearingDeg: number, distance: number): LatLng {
  const delta = distance / EARTH_RADIUS_M;
  const theta = toRad(bearingDeg);
  const phi1 = toRad(origin.lat);
  const lambda1 = toRad(origin.lng);
  const phi2 = Math.asin(Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta));
  const lambda2 =
    lambda1 +
    Math.atan2(Math.sin(theta) * Math.sin(delta) * Math.cos(phi1), Math.cos(delta) - Math.sin(phi1) * Math.sin(phi2));
  return { lat: (phi2 * 180) / Math.PI, lng: (((lambda2 * 180) / Math.PI + 540) % 360) - 180 };
}

/* ----------------------------- 한국 시간(KST) ----------------------------- */

export interface KstNow {
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  time: string;
  /** 자정부터 지난 분 */
  minutes: number;
  /** 0=일 ... 6=토 */
  weekday: number;
}

const pad2 = (n: number) => String(n).padStart(2, '0');

/** 한국은 서머타임이 없어 UTC+9 고정 */
export function kstNow(now: Date = new Date()): KstNow {
  const t = new Date(now.getTime() + 9 * 3_600_000);
  const hh = t.getUTCHours();
  const mm = t.getUTCMinutes();
  return {
    date: t.toISOString().slice(0, 10),
    time: `${pad2(hh)}:${pad2(mm)}`,
    minutes: hh * 60 + mm,
    weekday: t.getUTCDay(),
  };
}

function dateToUtcMs(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

export function addDays(date: string, days: number): string {
  return new Date(dateToUtcMs(date) + days * 86_400_000).toISOString().slice(0, 10);
}

/** b - a (일) */
export function daysBetween(a: string, b: string): number {
  return Math.round((dateToUtcMs(b) - dateToUtcMs(a)) / 86_400_000);
}

export function weekdayOf(date: string): number {
  return new Date(dateToUtcMs(date)).getUTCDay();
}

export function isValidDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = dateToUtcMs(value);
  return !Number.isNaN(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

export function isValidTime(value: string | undefined): value is string {
  return !!value && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function timeToMinutes(value: string): number {
  const [h, m] = value.split(':').map(Number);
  return h * 60 + m;
}

/** "20240105" 또는 "2024.01.05" 같은 값을 YYYY-MM-DD 로 */
export function normalizeDate(value: string | undefined | null): string | undefined {
  if (!value) return undefined;
  const digits = String(value).replace(/\D/g, '');
  if (digits.length < 8) return undefined;
  const iso = `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
  return isValidDate(iso) ? iso : undefined;
}

/* ------------------------------ 행사 상태 계산 ------------------------------ */

export interface DealTiming {
  status: DealStatus;
  activeNow: boolean;
  endingSoon: boolean;
  endsInMinutes?: number;
  startsInMinutes?: number;
}

type TimingFields = Pick<Deal, 'startDate' | 'endDate' | 'timeStart' | 'timeEnd' | 'days'>;

/**
 * 행사 기간·요일·시간대를 보고 지금 진행 중인지, 언제 끝나는지 계산한다.
 */
export function computeDealTiming(deal: TimingFields, now: KstNow = kstNow()): DealTiming {
  const today = now.date;
  const m = now.minutes;
  const days = deal.days && deal.days.length > 0 ? deal.days : undefined;
  const dayOk = (date: string) => !days || days.includes(weekdayOf(date));
  const inPeriod = (date: string) =>
    (!deal.startDate || date >= deal.startDate) && (!deal.endDate || date <= deal.endDate);

  if (deal.endDate && deal.endDate < today) {
    return { status: 'ended', activeNow: false, endingSoon: false };
  }

  const hasWindow = isValidTime(deal.timeStart) && isValidTime(deal.timeEnd);
  const s = hasWindow ? timeToMinutes(deal.timeStart!) : 0;
  const e = hasWindow ? timeToMinutes(deal.timeEnd!) : 1440;
  const overnight = hasWindow && e <= s;

  // 1) 지금 진행 중인가?
  if (hasWindow) {
    // 오늘 시작한 시간대
    if (inPeriod(today) && dayOk(today) && m >= s && (overnight || m < e)) {
      const endsIn = overnight ? 1440 - m + e : e - m;
      return { status: 'active', activeNow: true, endingSoon: endsIn <= 60, endsInMinutes: endsIn };
    }
    // 어제 시작해서 자정을 넘긴 시간대
    const yesterday = addDays(today, -1);
    if (overnight && m < e && inPeriod(yesterday) && dayOk(yesterday)) {
      const endsIn = e - m;
      return { status: 'active', activeNow: true, endingSoon: endsIn <= 60, endsInMinutes: endsIn };
    }
  } else if (inPeriod(today) && dayOk(today)) {
    const endsIn = deal.endDate ? daysBetween(today, deal.endDate) * 1440 + (1440 - m) : undefined;
    return {
      status: 'active',
      activeNow: true,
      endingSoon: deal.endDate === today,
      endsInMinutes: endsIn,
    };
  }

  // 2) 다음 진행 시점 찾기 (최대 2주)
  for (let k = 0; k <= 14; k++) {
    const date = addDays(today, k);
    if (deal.endDate && date > deal.endDate) break;
    if (!inPeriod(date) || !dayOk(date)) continue;
    const startsAt = k * 1440 + s - m;
    if (startsAt <= 0) continue; // 오늘 시간대가 이미 지남
    return {
      status: k === 0 ? 'later_today' : 'upcoming',
      activeNow: false,
      endingSoon: false,
      startsInMinutes: startsAt,
    };
  }

  return { status: 'ended', activeNow: false, endingSoon: false };
}

/** 정렬·비교용 실질 할인율(%) */
export function effectiveDiscount(deal: Pick<Deal, 'discountRate' | 'originalPrice' | 'salePrice' | 'type'>): number {
  if (typeof deal.discountRate === 'number' && deal.discountRate > 0) {
    return Math.min(100, Math.round(deal.discountRate));
  }
  if (deal.originalPrice && deal.salePrice !== undefined && deal.originalPrice > deal.salePrice) {
    return Math.round((1 - deal.salePrice / deal.originalPrice) * 100);
  }
  if (deal.type === 'one_plus_one') return 50;
  if (deal.type === 'two_plus_one') return 33;
  return 0;
}

/** 검색어 비교용: 공백 제거 + 소문자 */
export function normalizeText(value: string): string {
  return value.toLowerCase().replace(/\s+/g, '');
}
