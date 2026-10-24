import { describe, expect, it } from 'vitest';
import type { DealView } from '@sale-radar/shared';
import {
  formatDays,
  formatDistance,
  formatDuration,
  formatPrice,
  formatRadius,
  formatTimeWindow,
  statusText,
} from './format.ts';
import { perItemPrice } from '../components/DealCard.tsx';

describe('표시 형식', () => {
  it('가격·거리·반경', () => {
    expect(formatPrice(12500)).toBe('12,500원');
    expect(formatDistance(230.4)).toBe('230m');
    expect(formatDistance(1234)).toBe('1.2km');
    expect(formatRadius(1000)).toBe('1km');
    expect(formatRadius(300)).toBe('300m');
  });

  it('남은 시간', () => {
    expect(formatDuration(45)).toBe('45분');
    expect(formatDuration(130)).toBe('2시간 10분');
    expect(formatDuration(60 * 50)).toBe('2일');
  });

  it('요일·시간대', () => {
    expect(formatDays([1, 2, 3, 4, 5])).toBe('평일');
    expect(formatDays([0, 6])).toBe('주말');
    expect(formatDays([5, 6, 0])).toBe('금·토·일');
    expect(formatDays([])).toBeUndefined();
    expect(formatTimeWindow({ timeStart: '17:00', timeEnd: '19:00' })).toBe('매일 17:00~19:00');
    expect(formatTimeWindow({ days: [0, 6], timeStart: '10:00', timeEnd: '12:00' })).toBe('주말 10:00~12:00');
    expect(formatTimeWindow({})).toBeUndefined();
  });

  it('상태 문구', () => {
    const base = { activeNow: true, status: 'active', endingSoon: true, endsInMinutes: 25 } as DealView;
    expect(statusText(base)).toEqual({ text: '25분 남음', tone: 'soon' });
    expect(statusText({ ...base, endingSoon: false, endsInMinutes: 3 * 1440 + 100, endDate: '2026-10-27' })).toEqual({
      text: 'D-3',
      tone: 'live',
    });
    expect(
      statusText({
        ...base,
        activeNow: false,
        status: 'later_today',
        startsInMinutes: 90,
        timeStart: '18:00',
      } as DealView).text,
    ).toBe('18:00 시작 (1시간 30분 후)');
  });

  it('1+1, 2+1 개당 가격', () => {
    expect(perItemPrice({ type: 'one_plus_one', salePrice: 3000 })).toBe(1500);
    expect(perItemPrice({ type: 'two_plus_one', salePrice: 1500 })).toBe(1000);
    expect(perItemPrice({ type: 'discount', salePrice: 1500 })).toBeUndefined();
  });
});
