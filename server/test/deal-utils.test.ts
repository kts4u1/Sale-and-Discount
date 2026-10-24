import { describe, expect, it } from 'vitest';
import {
  addDays,
  computeDealTiming,
  daysBetween,
  destinationPoint,
  distanceMeters,
  effectiveDiscount,
  kstNow,
  normalizeDate,
  walkMinutes,
  type KstNow,
} from '@sale-radar/shared';

const at = (date: string, time: string): KstNow => {
  const [h, m] = time.split(':').map(Number);
  return { date, time, minutes: h * 60 + m, weekday: new Date(`${date}T00:00:00Z`).getUTCDay() };
};

describe('거리 계산', () => {
  it('강남역-역삼역 약 800m', () => {
    const d = distanceMeters({ lat: 37.4979, lng: 127.0276 }, { lat: 37.5006, lng: 127.0364 });
    expect(d).toBeGreaterThan(780);
    expect(d).toBeLessThan(860);
  });

  it('destinationPoint 로 간 거리만큼 다시 잰다', () => {
    const origin = { lat: 37.5, lng: 127 };
    for (const bearing of [0, 90, 180, 270, 45]) {
      const p = destinationPoint(origin, bearing, 500);
      expect(distanceMeters(origin, p)).toBeCloseTo(500, 0);
    }
  });

  it('도보 시간은 최소 1분, 1km 는 약 19분', () => {
    expect(walkMinutes(10)).toBe(1);
    expect(walkMinutes(1000)).toBe(19);
  });
});

describe('한국 시간', () => {
  it('UTC 15:30 은 다음날 00:30 KST', () => {
    const k = kstNow(new Date('2026-10-23T15:30:00Z'));
    expect(k.date).toBe('2026-10-24');
    expect(k.time).toBe('00:30');
    expect(k.weekday).toBe(6); // 토요일
  });

  it('날짜 계산', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(daysBetween('2026-10-24', '2026-11-03')).toBe(10);
    expect(normalizeDate('20261024')).toBe('2026-10-24');
    expect(normalizeDate('2026.10.24')).toBe('2026-10-24');
    expect(normalizeDate('20261340')).toBeUndefined();
    expect(normalizeDate('')).toBeUndefined();
  });
});

describe('행사 진행 상태', () => {
  it('기간 안이면 진행 중, 종료일까지 남은 분', () => {
    const t = computeDealTiming({ startDate: '2026-10-20', endDate: '2026-10-25' }, at('2026-10-24', '12:00'));
    expect(t.status).toBe('active');
    expect(t.activeNow).toBe(true);
    expect(t.endsInMinutes).toBe(1440 + 720);
    expect(t.endingSoon).toBe(false);
  });

  it('종료일이 오늘이면 마감 임박', () => {
    const t = computeDealTiming({ endDate: '2026-10-24' }, at('2026-10-24', '20:00'));
    expect(t.activeNow).toBe(true);
    expect(t.endingSoon).toBe(true);
  });

  it('종료일이 지나면 종료', () => {
    expect(computeDealTiming({ endDate: '2026-10-23' }, at('2026-10-24', '00:01')).status).toBe('ended');
  });

  it('시작 전이면 upcoming + 시작까지 남은 시간', () => {
    const t = computeDealTiming({ startDate: '2026-10-26' }, at('2026-10-24', '12:00'));
    expect(t.status).toBe('upcoming');
    expect(t.startsInMinutes).toBe(2 * 1440 - 720);
  });

  it('타임세일: 시간 안이면 진행 중, 전이면 오늘 예정, 후면 내일', () => {
    const deal = { timeStart: '17:00', timeEnd: '19:00' };
    expect(computeDealTiming(deal, at('2026-10-24', '18:30'))).toMatchObject({
      status: 'active',
      endsInMinutes: 30,
      endingSoon: true,
    });
    expect(computeDealTiming(deal, at('2026-10-24', '15:00'))).toMatchObject({
      status: 'later_today',
      startsInMinutes: 120,
    });
    expect(computeDealTiming(deal, at('2026-10-24', '20:00'))).toMatchObject({
      status: 'upcoming',
      startsInMinutes: 21 * 60,
    });
  });

  it('자정을 넘기는 시간대 (22:00~02:00)', () => {
    const deal = { timeStart: '22:00', timeEnd: '02:00' };
    expect(computeDealTiming(deal, at('2026-10-24', '23:00'))).toMatchObject({ activeNow: true, endsInMinutes: 180 });
    expect(computeDealTiming(deal, at('2026-10-24', '01:00'))).toMatchObject({ activeNow: true, endsInMinutes: 60 });
    expect(computeDealTiming(deal, at('2026-10-24', '03:00'))).toMatchObject({ status: 'later_today' });
  });

  it('마지막 날 시간대가 지나면 종료', () => {
    const t = computeDealTiming(
      { endDate: '2026-10-24', timeStart: '17:00', timeEnd: '19:00' },
      at('2026-10-24', '19:30'),
    );
    expect(t.status).toBe('ended');
  });

  it('요일 제한: 평일 행사는 토요일에 다음 월요일 시작', () => {
    // 2026-10-24 는 토요일
    const t = computeDealTiming(
      { days: [1, 2, 3, 4, 5], timeStart: '11:00', timeEnd: '14:00' },
      at('2026-10-24', '12:00'),
    );
    expect(t.status).toBe('upcoming');
    expect(t.startsInMinutes).toBe(2 * 1440 + 660 - 720);
  });
});

describe('실질 할인율', () => {
  it('가격으로 계산', () => {
    expect(effectiveDiscount({ type: 'discount', originalPrice: 10000, salePrice: 7000 })).toBe(30);
  });
  it('직접 입력한 할인율 우선', () => {
    expect(effectiveDiscount({ type: 'discount', discountRate: 15, originalPrice: 10000, salePrice: 7000 })).toBe(15);
  });
  it('1+1 = 50, 2+1 = 33', () => {
    expect(effectiveDiscount({ type: 'one_plus_one', salePrice: 2000 })).toBe(50);
    expect(effectiveDiscount({ type: 'two_plus_one' })).toBe(33);
  });
  it('정보가 없으면 0', () => {
    expect(effectiveDiscount({ type: 'gift' })).toBe(0);
  });
});
