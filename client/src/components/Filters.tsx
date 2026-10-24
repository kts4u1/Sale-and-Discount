import {
  CATEGORIES,
  DEAL_TYPES,
  SORT_OPTIONS,
  type CategoryId,
  type DealTypeId,
  type SearchStats,
  type SortId,
} from '@sale-radar/shared';

interface CategoryProps {
  value: CategoryId[];
  onChange: (v: CategoryId[]) => void;
  counts?: SearchStats['byCategory'];
}

const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);

export function CategoryChips({ value, onChange, counts }: CategoryProps) {
  return (
    <div className="chip-row scroll" role="group" aria-label="업종">
      <button
        type="button"
        className={`chip ${value.length === 0 ? 'chip-on' : ''}`}
        onClick={() => onChange([])}
        aria-pressed={value.length === 0}
      >
        전체
      </button>
      {CATEGORIES.map((c) => {
        const n = counts?.[c.id] ?? 0;
        const on = value.includes(c.id);
        return (
          <button
            key={c.id}
            type="button"
            className={`chip ${on ? 'chip-on' : ''} ${!on && counts && n === 0 ? 'chip-empty' : ''}`}
            aria-pressed={on}
            onClick={() => onChange(toggle(value, c.id))}
          >
            <span aria-hidden="true">{c.emoji}</span> {c.label}
            {counts && <span className="chip-count">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface TypeProps {
  value: DealTypeId[];
  onChange: (v: DealTypeId[]) => void;
  counts?: SearchStats['byType'];
}

export function DealTypeChips({ value, onChange, counts }: TypeProps) {
  return (
    <div className="chip-row scroll" role="group" aria-label="행사 종류">
      {DEAL_TYPES.map((t) => {
        const n = counts?.[t.id] ?? 0;
        const on = value.includes(t.id);
        if (counts && n === 0 && !on) return null;
        return (
          <button
            key={t.id}
            type="button"
            className={`chip small type-${t.id} ${on ? 'chip-on' : ''}`}
            aria-pressed={on}
            title={t.description}
            onClick={() => onChange(toggle(value, t.id))}
          >
            {t.label}
            {counts && <span className="chip-count">{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

interface OptionsProps {
  sort: SortId;
  onSort: (v: SortId) => void;
  activeOnly: boolean;
  onActiveOnly: (v: boolean) => void;
  minDiscount: number;
  onMinDiscount: (v: number) => void;
  sampleAvailable: boolean;
  includeSample: boolean;
  onIncludeSample: (v: boolean) => void;
}

export function FilterOptions(p: OptionsProps) {
  return (
    <div className="filter-options">
      <label className="select">
        <span className="sr-only">정렬</span>
        <select value={p.sort} onChange={(e) => p.onSort(e.target.value as SortId)}>
          {SORT_OPTIONS.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      <label className="select">
        <span className="sr-only">최소 할인율</span>
        <select value={p.minDiscount} onChange={(e) => p.onMinDiscount(Number(e.target.value))}>
          <option value={0}>할인율 전체</option>
          <option value={10}>10% 이상</option>
          <option value={20}>20% 이상</option>
          <option value={30}>30% 이상</option>
          <option value={50}>50% 이상</option>
        </select>
      </label>
      <label className="toggle">
        <input type="checkbox" checked={p.activeOnly} onChange={(e) => p.onActiveOnly(e.target.checked)} />
        <span>지금 진행 중만</span>
      </label>
      {p.sampleAvailable && (
        <label className="toggle">
          <input type="checkbox" checked={p.includeSample} onChange={(e) => p.onIncludeSample(e.target.checked)} />
          <span>샘플 데이터</span>
        </label>
      )}
    </div>
  );
}
