import { MAX_RADIUS, MIN_RADIUS, RADIUS_OPTIONS, walkMinutes } from '@sale-radar/shared';
import { formatRadius } from '../lib/format.ts';

interface Props {
  value: number;
  onChange: (v: number) => void;
}

const QUICK = [100, 200, 300, 500, 700, 1000];

export function RadiusSelector({ value, onChange }: Props) {
  const pct = ((value - MIN_RADIUS) / (MAX_RADIUS - MIN_RADIUS)) * 100;
  return (
    <div className="radius">
      <div className="radius-head">
        <label htmlFor="radius-range">
          검색 반경 <strong>{formatRadius(value)}</strong>
        </label>
        <span className="muted small">도보 약 {walkMinutes(value)}분 거리</span>
      </div>
      <input
        id="radius-range"
        type="range"
        min={MIN_RADIUS}
        max={MAX_RADIUS}
        step={100}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ ['--pct' as string]: `${pct}%` }}
        list="radius-ticks"
        aria-valuetext={formatRadius(value)}
      />
      <datalist id="radius-ticks">
        {RADIUS_OPTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
      <div className="radius-ticks" aria-hidden="true">
        {RADIUS_OPTIONS.map((r) => (
          <span key={r} className={r === value ? 'on' : ''}>
            {r === 1000 ? '1km' : r}
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
