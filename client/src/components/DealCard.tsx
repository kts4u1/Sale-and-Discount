import { CATEGORY_MAP, DEAL_SOURCE_SHORT, type DealView } from '@sale-radar/shared';
import { travelText } from './RadiusSelector.tsx';
import { dealBadge, formatDistance, formatPeriod, formatPrice, formatTimeWindow, statusText } from '../lib/format.ts';

interface Props {
  deal: DealView;
  saved: boolean;
  onOpen: (d: DealView) => void;
  onToggleSave: (d: DealView) => void;
  highlighted?: boolean;
}

/** 1+1, 2+1 은 "개당 가격"으로 실제 혜택을 보여준다 */
export function perItemPrice(deal: Pick<DealView, 'type' | 'salePrice'>): number | undefined {
  if (deal.salePrice === undefined) return undefined;
  if (deal.type === 'one_plus_one') return Math.round(deal.salePrice / 2);
  if (deal.type === 'two_plus_one') return Math.round((deal.salePrice * 2) / 3);
  return undefined;
}

export function PriceLine({
  deal,
  large,
}: {
  deal: Pick<DealView, 'originalPrice' | 'salePrice' | 'effectiveDiscount' | 'unit' | 'type'>;
  large?: boolean;
}) {
  const hasSale = deal.salePrice !== undefined;
  const perItem = deal.originalPrice === undefined ? perItemPrice(deal) : undefined;
  const showPct = deal.effectiveDiscount > 0 && perItem === undefined && (hasSale || deal.originalPrice === undefined);
  return (
    <div className={`price-line ${large ? 'large' : ''}`}>
      {showPct && <span className="discount-pct">{deal.effectiveDiscount}%</span>}
      {hasSale && <span className="sale-price">{formatPrice(deal.salePrice)}</span>}
      {deal.originalPrice !== undefined && deal.originalPrice !== deal.salePrice && (
        <span className="original-price">{formatPrice(deal.originalPrice)}</span>
      )}
      {deal.unit && <span className="unit">/ {deal.unit}</span>}
      {perItem !== undefined && <span className="per-item">개당 {formatPrice(perItem)}</span>}
      {!hasSale && deal.effectiveDiscount === 0 && <span className="muted small">가격 정보 없음</span>}
    </div>
  );
}

export function DealCard({ deal, saved, onOpen, onToggleSave, highlighted }: Props) {
  const cat = CATEGORY_MAP[deal.category] ?? CATEGORY_MAP.etc;
  const st = statusText(deal);
  const timeWindow = formatTimeWindow(deal);
  return (
    <article className={`deal-card ${highlighted ? 'highlighted' : ''} ${deal.isSample ? 'is-sample' : ''}`}>
      <button type="button" className="deal-main" onClick={() => onOpen(deal)} aria-label={`${deal.title} 자세히 보기`}>
        <div className="deal-icon" style={{ background: `${cat.color}1f`, color: cat.color }} aria-hidden="true">
          {cat.emoji}
        </div>
        <div className="deal-body">
          <div className="badges">
            <span className={`badge type type-${deal.type}`}>{dealBadge(deal)}</span>
            <span className={`badge status tone-${st.tone}`}>{st.text}</span>
            <span className={`badge source source-${deal.source}`}>{DEAL_SOURCE_SHORT[deal.source]}</span>
          </div>
          <h3 className="deal-title">{deal.title}</h3>
          <p className="deal-store">
            <span className="store-name">{deal.store.name}</span>
            <span className="dot">·</span>
            <span>{formatDistance(deal.distance)}</span>
            <span className="dot">·</span>
            <span>{travelText(deal.distance)}</span>
            {deal.otherStores && deal.otherStores.length > 0 && (
              <span className="muted"> 외 {deal.otherStores.length}곳</span>
            )}
          </p>
          <PriceLine deal={deal} />
          <p className="deal-meta">
            <span>📅 {formatPeriod(deal)}</span>
            {timeWindow && <span>⏰ {timeWindow}</span>}
            {deal.priceCompare && deal.salePrice !== undefined && deal.salePrice <= deal.priceCompare.min && (
              <span className="good">주변 최저가</span>
            )}
          </p>
        </div>
      </button>
      <div className="deal-side">
        <button
          type="button"
          className={`icon-btn save ${saved ? 'on' : ''}`}
          aria-pressed={saved}
          aria-label={saved ? '찜 해제' : '찜하기'}
          onClick={() => onToggleSave(deal)}
        >
          {saved ? '♥' : '♡'}
        </button>
        {(deal.likes > 0 || deal.confirms > 0) && (
          <span className="reactions" title="좋아요 · 진행 확인">
            👍 {deal.likes} · ✅ {deal.confirms}
          </span>
        )}
      </div>
    </article>
  );
}

export function DealSkeleton() {
  return (
    <div className="deal-card skeleton" aria-hidden="true">
      <div className="deal-icon" />
      <div className="deal-body">
        <div className="sk-line w30" />
        <div className="sk-line w80" />
        <div className="sk-line w60" />
        <div className="sk-line w40" />
      </div>
    </div>
  );
}
