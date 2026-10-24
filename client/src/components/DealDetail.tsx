import { useEffect, useState } from 'react';
import {
  CATEGORY_MAP,
  DEAL_TYPE_MAP,
  SOURCE_LABELS,
  type DealView,
  type NewsItem,
  type VoteAction,
} from '@sale-radar/shared';
import { api } from '../api.ts';
import { formatDistance, formatPeriod, formatPrice, formatTimeWindow, statusText, timeAgo } from '../lib/format.ts';
import { PriceLine } from './DealCard.tsx';
import { travelText } from './RadiusSelector.tsx';
import { Sheet } from './Sheet.tsx';

interface Props {
  deal: DealView | null;
  sameStore: DealView[];
  saved: boolean;
  naverEnabled: boolean;
  onClose: () => void;
  onToggleSave: (d: DealView) => void;
  onOpenDeal: (d: DealView) => void;
  /** 내 반응 하나를 화면 숫자에 더한다 */
  onVoted: (dealId: string, action: VoteAction) => void;
  onToast: (msg: string) => void;
}

export function directionLinks(name: string, lat: number, lng: number, address?: string) {
  const n = encodeURIComponent(name);
  return [
    { label: '카카오맵 길찾기', href: `https://map.kakao.com/link/to/${n},${lat},${lng}` },
    {
      label: '네이버지도',
      href: `https://map.naver.com/p/search/${encodeURIComponent(address ? `${name} ${address}` : name)}`,
    },
    { label: '구글 지도', href: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=walking` },
  ];
}

const VOTED_KEY = 'sale-radar:voted';
function loadVoted(): Record<string, VoteAction[]> {
  try {
    return JSON.parse(localStorage.getItem(VOTED_KEY) ?? '{}');
  } catch {
    return {};
  }
}

export function DealDetail({
  deal,
  sameStore,
  saved,
  naverEnabled,
  onClose,
  onToggleSave,
  onOpenDeal,
  onVoted,
  onToast,
}: Props) {
  const [news, setNews] = useState<NewsItem[] | null>(null);
  const [voted, setVoted] = useState<Record<string, VoteAction[]>>(loadVoted);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setNews(null);
    if (!deal || !naverEnabled || deal.isSample) return;
    let alive = true;
    api
      .news(deal.store.name)
      .then((r) => alive && setNews(r.items))
      .catch(() => alive && setNews([]));
    return () => {
      alive = false;
    };
  }, [deal, naverEnabled]);

  if (!deal) return null;
  const store = deal.store;
  const cat = CATEGORY_MAP[store.category] ?? CATEGORY_MAP.etc;
  const type = DEAL_TYPE_MAP[deal.type];
  const st = statusText(deal);
  const timeWindow = formatTimeWindow(deal);
  const pc = deal.priceCompare;
  const myVotes = voted[deal.id] ?? [];

  const vote = async (action: VoteAction) => {
    if (myVotes.includes(action) || busy) return;
    setBusy(true);
    try {
      const r = await api.vote(deal.id, action);
      const next = { ...voted, [deal.id]: [...myVotes, action] };
      setVoted(next);
      try {
        localStorage.setItem(VOTED_KEY, JSON.stringify(next));
      } catch {
        /* 저장 실패는 무시 */
      }
      if (!r.duplicate) onVoted(deal.id, action);
      onToast(action === 'expired' ? '신고해 주셔서 고마워요. 여러 명이 신고하면 목록에서 숨겨집니다.' : '반영됐어요!');
    } catch (err) {
      onToast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const share = async () => {
    const text = `[${type?.label}] ${deal.title}\n${store.name} (${formatDistance(deal.distance)})${
      deal.salePrice !== undefined ? `\n${formatPrice(deal.salePrice)}` : ''
    }\n${formatPeriod(deal)}${timeWindow ? ` · ${timeWindow}` : ''}`;
    try {
      if (navigator.share) await navigator.share({ title: deal.title, text });
      else {
        await navigator.clipboard.writeText(text);
        onToast('행사 정보를 복사했어요');
      }
    } catch {
      /* 사용자가 취소 */
    }
  };

  const copyAddress = async (addr: string) => {
    try {
      await navigator.clipboard.writeText(addr);
      onToast('주소를 복사했어요');
    } catch {
      onToast(addr);
    }
  };

  const others = sameStore.filter((d) => d.id !== deal.id);
  const address = store.roadAddress ?? store.address;

  return (
    <Sheet open title="행사 자세히 보기" onClose={onClose} wide>
      <div className="detail">
        {deal.isSample && <div className="notice warn">샘플 데이터입니다. 실제 매장·행사가 아니에요.</div>}

        <div className="badges">
          <span className={`badge type type-${deal.type}`}>{type?.label}</span>
          <span className={`badge status tone-${st.tone}`}>{st.text}</span>
          <span className={`badge source source-${deal.source}`}>{SOURCE_LABELS[deal.source]}</span>
        </div>
        <h2 className="detail-title">{deal.title}</h2>
        {deal.productName && deal.productName !== deal.title && <p className="muted">{deal.productName}</p>}

        <div className="detail-price">
          <PriceLine deal={deal} large />
          {deal.originalPrice !== undefined && deal.salePrice !== undefined && deal.originalPrice > deal.salePrice && (
            <p className="good">{formatPrice(deal.originalPrice - deal.salePrice)} 아껴요</p>
          )}
          {pc && deal.salePrice !== undefined && (
            <div className="compare-box">
              <p>
                주변 {pc.storeCount}개 매장 평균 <strong>{formatPrice(pc.avg)}</strong>
                {deal.salePrice < pc.avg && (
                  <span className="good"> · 평균보다 {formatPrice(pc.avg - deal.salePrice)} 저렴</span>
                )}
              </p>
              <div className="range-bar" aria-hidden="true">
                <span
                  className="range-dot"
                  style={{ left: `${pc.max > pc.min ? ((deal.salePrice - pc.min) / (pc.max - pc.min)) * 100 : 0}%` }}
                />
              </div>
              <p className="muted small">
                최저 {formatPrice(pc.min)} ~ 최고 {formatPrice(pc.max)}
              </p>
            </div>
          )}
        </div>

        <dl className="facts">
          <div>
            <dt>기간</dt>
            <dd>
              {formatPeriod(deal)}
              {deal.startDate && deal.endDate && (
                <span className="muted small">
                  {' '}
                  ({deal.startDate} ~ {deal.endDate})
                </span>
              )}
            </dd>
          </div>
          {timeWindow && (
            <div>
              <dt>시간</dt>
              <dd>{timeWindow}</dd>
            </div>
          )}
          <div>
            <dt>행사 종류</dt>
            <dd>
              {type?.label} <span className="muted small">— {type?.description}</span>
            </dd>
          </div>
          {deal.tags.length > 0 && (
            <div>
              <dt>태그</dt>
              <dd className="tag-list">
                {deal.tags.map((t) => (
                  <span key={t} className="tag">
                    #{t}
                  </span>
                ))}
              </dd>
            </div>
          )}
          <div>
            <dt>정보 출처</dt>
            <dd>
              {SOURCE_LABELS[deal.source]}
              {deal.sourceUrl && (
                <>
                  {' '}
                  <a href={deal.sourceUrl} target="_blank" rel="noreferrer">
                    바로가기
                  </a>
                </>
              )}
              <span className="muted small"> · {timeAgo(deal.updatedAt)} 갱신</span>
            </dd>
          </div>
        </dl>

        {deal.description && <p className="detail-desc">{deal.description}</p>}

        {deal.items && deal.items.length > 0 && (
          <section>
            <h3>메뉴·가격</h3>
            <ul className="menu-list">
              {deal.items.map((i) => (
                <li key={i.name}>
                  <span>{i.name}</span>
                  <strong>{formatPrice(i.price)}</strong>
                </li>
              ))}
            </ul>
          </section>
        )}

        <section className="store-box">
          <h3>
            <span aria-hidden="true">{cat.emoji}</span> {store.name}
          </h3>
          <p className="muted small">
            {store.categoryDetail ?? cat.label} · {formatDistance(deal.distance)} · {travelText(deal.distance)}
          </p>
          <ul className="store-info">
            {address && (
              <li>
                📍 {address}{' '}
                <button type="button" className="link-btn" onClick={() => copyAddress(address)}>
                  복사
                </button>
              </li>
            )}
            {store.phone && (
              <li>
                📞 <a href={`tel:${store.phone.replace(/[^\d+]/g, '')}`}>{store.phone}</a>
              </li>
            )}
            {store.openingHours && <li>🕘 {store.openingHours}</li>}
            {store.url && (
              <li>
                🔗{' '}
                <a href={store.url} target="_blank" rel="noreferrer">
                  매장 정보 보기
                </a>
              </li>
            )}
          </ul>
          {!deal.isSample && (
            <div className="btn-row">
              {directionLinks(store.name, store.lat, store.lng, address).map((l) => (
                <a key={l.label} className="btn small" href={l.href} target="_blank" rel="noreferrer">
                  {l.label}
                </a>
              ))}
            </div>
          )}
          {deal.otherStores && deal.otherStores.length > 0 && (
            <details className="other-stores">
              <summary>같은 행사를 하는 주변 매장 {deal.otherStores.length}곳 더 보기</summary>
              <ul>
                {deal.otherStores.map((s) => (
                  <li key={s.id}>
                    {s.name} <span className="muted">{formatDistance(s.distance)}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>

        <section>
          <h3>이 정보가 맞나요?</h3>
          <div className="btn-row">
            <button
              type="button"
              className={`btn ${myVotes.includes('like') ? 'on' : ''}`}
              onClick={() => vote('like')}
              disabled={busy}
            >
              👍 좋아요 {deal.likes}
            </button>
            <button
              type="button"
              className={`btn ${myVotes.includes('confirm') ? 'on' : ''}`}
              onClick={() => vote('confirm')}
              disabled={busy}
            >
              ✅ 아직 하고 있어요 {deal.confirms}
            </button>
            <button
              type="button"
              className={`btn danger ${myVotes.includes('expired') ? 'on' : ''}`}
              onClick={() => vote('expired')}
              disabled={busy}
            >
              🚫 끝났어요 {deal.expiredReports > 0 ? deal.expiredReports : ''}
            </button>
          </div>
        </section>

        <div className="btn-row">
          <button type="button" className={`btn primary ${saved ? 'on' : ''}`} onClick={() => onToggleSave(deal)}>
            {saved ? '♥ 찜 해제' : '♡ 찜하기'}
          </button>
          <button type="button" className="btn" onClick={share}>
            공유하기
          </button>
        </div>

        {others.length > 0 && (
          <section>
            <h3>이 매장의 다른 행사 {others.length}개</h3>
            <ul className="mini-list">
              {others.map((d) => (
                <li key={d.id}>
                  <button type="button" className="mini-deal" onClick={() => onOpenDeal(d)}>
                    <span className={`badge type type-${d.type}`}>{DEAL_TYPE_MAP[d.type]?.short}</span>
                    <span className="mini-title">{d.title}</span>
                    {d.salePrice !== undefined && <strong>{formatPrice(d.salePrice)}</strong>}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        {naverEnabled && !deal.isSample && (
          <section>
            <h3>최근 블로그 소식</h3>
            {news === null && <p className="muted small">불러오는 중…</p>}
            {news?.length === 0 && <p className="muted small">관련 소식이 없어요.</p>}
            <ul className="news-list">
              {news?.map((n) => (
                <li key={n.link}>
                  <a href={n.link} target="_blank" rel="noreferrer">
                    <strong>{n.title}</strong>
                    <span className="muted small">
                      {n.author} · {n.date}
                    </span>
                    <span className="small">{n.description}</span>
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Sheet>
  );
}
