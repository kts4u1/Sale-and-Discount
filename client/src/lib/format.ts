import { DEAL_TYPE_MAP, kstNow, type Deal, type DealView } from '@sale-radar/shared';

export const formatPrice = (v: number | undefined) => (v === undefined ? '' : `${v.toLocaleString('ko-KR')}원`);

export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

export function formatRadius(m: number): string {
  return m >= 1000 ? `${m / 1000}km` : `${m}m`;
}

export function formatDuration(minutes: number): string {
  if (minutes < 1) return '곧';
  if (minutes < 60) return `${Math.round(minutes)}분`;
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h < 24) return m ? `${h}시간 ${m}분` : `${h}시간`;
  const d = Math.floor(h / 24);
  return `${d}일`;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

export function formatDays(days: number[] | undefined): string | undefined {
  if (!days || days.length === 0 || days.length === 7) return undefined;
  const set = [...days].sort((a, b) => a - b).join(',');
  if (set === '1,2,3,4,5') return '평일';
  if (set === '0,6') return '주말';
  return days
    .slice()
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => WEEKDAYS[d])
    .join('·');
}

const md = (date: string) => {
  const [, m, d] = date.split('-').map(Number);
  return `${m}/${d}`;
};

/** 기간 텍스트: "10/20~10/31", "~11/3까지", "상시" */
export function formatPeriod(deal: Pick<Deal, 'startDate' | 'endDate'>): string {
  const today = kstNow().date;
  if (deal.startDate && deal.endDate) {
    if (deal.startDate === deal.endDate) return `${md(deal.startDate)} 하루`;
    return `${md(deal.startDate)}~${md(deal.endDate)}`;
  }
  if (deal.endDate) return deal.endDate === today ? '오늘까지' : `~${md(deal.endDate)}까지`;
  if (deal.startDate) return deal.startDate > today ? `${md(deal.startDate)}부터` : '진행 중';
  return '상시';
}

export function formatTimeWindow(deal: Pick<Deal, 'timeStart' | 'timeEnd' | 'days'>): string | undefined {
  const days = formatDays(deal.days);
  const time = deal.timeStart && deal.timeEnd ? `${deal.timeStart}~${deal.timeEnd}` : undefined;
  if (!days && !time) return undefined;
  return [days ?? (time ? '매일' : undefined), time].filter(Boolean).join(' ');
}

/** 카드에 보여줄 진행 상태 한 줄 */
export function statusText(d: DealView): { text: string; tone: 'live' | 'soon' | 'later' | 'muted' } {
  if (d.activeNow) {
    if (d.endsInMinutes !== undefined && d.endsInMinutes <= 24 * 60) {
      return { text: `${formatDuration(d.endsInMinutes)} 남음`, tone: d.endingSoon ? 'soon' : 'live' };
    }
    if (d.endDate) {
      const days = Math.ceil((d.endsInMinutes ?? 0) / 1440);
      return { text: `D-${Math.max(1, days - 1)}`, tone: 'live' };
    }
    return { text: '진행 중', tone: 'live' };
  }
  if (d.status === 'later_today' && d.startsInMinutes !== undefined) {
    return { text: `${d.timeStart ?? ''} 시작 (${formatDuration(d.startsInMinutes)} 후)`, tone: 'later' };
  }
  if (d.status === 'upcoming' && d.startsInMinutes !== undefined) {
    return { text: `${formatDuration(d.startsInMinutes)} 후 시작`, tone: 'muted' };
  }
  return { text: '종료', tone: 'muted' };
}

export function dealBadge(d: Pick<Deal, 'type'>): string {
  return DEAL_TYPE_MAP[d.type]?.label ?? d.type;
}

export function timeAgo(iso: string): string {
  const diff = (Date.now() - Date.parse(iso)) / 60_000;
  if (!Number.isFinite(diff)) return '';
  if (diff < 1) return '방금';
  if (diff < 60) return `${Math.round(diff)}분 전`;
  if (diff < 1440) return `${Math.round(diff / 60)}시간 전`;
  if (diff < 1440 * 30) return `${Math.round(diff / 1440)}일 전`;
  return iso.slice(0, 10);
}

/** 오늘 날짜 (YYYY-MM-DD, KST) */
export const todayKst = () => kstNow().date;
