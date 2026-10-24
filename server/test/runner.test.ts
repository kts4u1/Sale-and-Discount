import { describe, expect, it } from 'vitest';
import { kcaStatus, type KcaManifest } from '@sale-radar/shared';
import { msUntilNextKst } from '../src/kca-runner.ts';

describe('매일 자동 갱신 시각', () => {
  it('오늘 시각이 안 지났으면 오늘, 지났으면 내일', () => {
    // 2026-10-24 05:00 KST = 2026-10-23T20:00Z
    const before = Date.parse('2026-10-23T20:00:00Z');
    expect(msUntilNextKst('06:10', before)).toBe(70 * 60_000);
    // 07:00 KST → 다음 날 06:10 까지 23시간 10분
    const after = Date.parse('2026-10-23T22:00:00Z');
    expect(msUntilNextKst('06:10', after)).toBe((23 * 60 + 10) * 60_000);
  });
});

describe('참가격 자료 상태', () => {
  const m = { updatedAt: '2026-10-24T00:00:00Z', inspectDay: '2026-10-23' } as KcaManifest;
  it('갱신 시각과 조사일', () => {
    const s = kcaStatus(m, 12, Date.parse('2026-10-24T05:00:00Z'));
    expect(s).toMatchObject({ enabled: true, count: 12, baseDate: '2026-10-23', updatedAt: m.updatedAt });
    expect(s.message).not.toContain('⚠️');
  });
  it('3일 넘게 갱신되지 않으면 경고', () => {
    expect(kcaStatus(m, 0, Date.parse('2026-10-28T01:00:00Z')).message).toContain('4일 동안 갱신되지 않았어요');
  });
  it('자료가 없으면 꺼짐', () => {
    expect(kcaStatus(null)).toMatchObject({ enabled: false, requires: 'DATA_GO_KR_KEY' });
  });
});
