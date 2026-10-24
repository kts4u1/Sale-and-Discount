import { MAX_SELECTABLE_RADIUS, RADIUS_OPTIONS, walkMinutes } from '@sale-radar/shared';
import { formatRadius } from '../lib/format.ts';

interface Props {
  value: number;
  onChange: (v: number) => void;
}

/** 1km 까지는 100m 단위, 그 위로는 1.5·2·3·5km */
const OPTIONS = RADIUS_OPTIONS.filter((r) => r <= MAX_SELECTABLE_RADIUS);
const QUICK = [300, 500, 1000, 2000, 3000, 5000];
const TICKS = new Set([100, 500, 1000, 2000, 5000]);

/** 이동 시간 안내: 가까우면 도보, 멀면 거리만 */
export function travelText(distance: number): string {
  const walk = walkMinutes(distance);
  return walk <= 40 ? `도보 약 ${walk}분` : `차로 약 ${Math.max(5, Math.round((distance * 1.3) / 400))}분`;
}

export function RadiusSelector({ value, onChange }: Props) {
  // 목록에 없는 값(예: 예전에 저장된 값)은 가장 가까운 단계로
  const index = OPTIONS.reduce((best, r, i) => (Math.abs(r - value) < Math.abs(OPTIONS[best] - value) ? i : best), 0);
  const pct = (index / (OPTIONS.length - 1)) * 100;
  return (
    <div className="radius">
      <div className="radius-head">
        <label htmlFor="radius-range">
          검색 반경 <strong>{formatRadius(value)}</strong>
        </label>
        <span className="muted small">{travelText(value)} 거리</span>
      </div>
      <input
        id="radius-range"
        type="range"
        min={0}
        max={OPTIONS.length - 1}
        step={1}
        value={index}
        onChange={(e) => onChange(OPTIONS[Number(e.target.value)])}
        style={{ ['--pct' as string]: `${pct}%` }}
        aria-valuetext={formatRadius(value)}
      />
      <div className="radius-ticks" aria-hidden="true">
        {OPTIONS.map((r, i) => (
          <span key={r} className={i === index ? 'on' : ''}>
            {TICKS.has(r) || i === index ? formatRadius(r) : '·'}
          </span>
        ))}
      </div>
      <div className="chip-row compact" role="group" aria-label="빠른 반경 선택">
        {QUICK.map((r) => (
          <button
            key={r}
            type="button"
            className={`chip small ${r === value ? 'chip-on' : ''}`}
            aria-pressed={r === value}
            onClick={() => onChange(r)}
          >
            {formatRadius(r)}
          </button>
        ))}
      </div>
    </div>
  );
}
