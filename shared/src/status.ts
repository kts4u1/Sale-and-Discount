import { SOURCE_LABELS } from './constants.ts';
import type { KcaManifest } from './kca.ts';
import type { SourceId, SourceStatus } from './types.ts';

const REQUIRES: Partial<Record<SourceId, string>> = {
  kca: 'DATA_GO_KR_KEY',
  kakao: 'KAKAO_REST_API_KEY',
  naver: 'NAVER_CLIENT_ID, NAVER_CLIENT_SECRET',
};

export function sourceStatus(id: SourceId, enabled: boolean, extra: Partial<SourceStatus> = {}): SourceStatus {
  return { id, label: SOURCE_LABELS[id], enabled, ok: enabled, count: 0, requires: REQUIRES[id], ...extra };
}

/** 이 날수 이상 갱신되지 않으면 경고 */
export const STALE_DAYS = 3;

/** 참가격 스냅샷(하루 한 번 받아 둔 자료) 상태 */
export function kcaStatus(manifest: KcaManifest | null, count = 0, now = Date.now()): SourceStatus {
  if (!manifest) {
    return sourceStatus('kca', false, {
      message: '아직 받아 둔 참가격 자료가 없습니다. 인증키(DATA_GO_KR_KEY)를 넣고 데이터 업데이트를 한 번 실행하세요.',
    });
  }
  const ageDays = Math.floor((now - Date.parse(manifest.updatedAt)) / 86_400_000);
  return sourceStatus('kca', true, {
    count,
    updatedAt: manifest.updatedAt,
    baseDate: manifest.inspectDay,
    message:
      `${manifest.inspectDay} 조사 기준 · 하루 한 번 자동 갱신` +
      (ageDays >= STALE_DAYS ? ` · ⚠️ ${ageDays}일 동안 갱신되지 않았어요` : ''),
  });
}
