import { useState, type FormEvent } from 'react';
import type { LatLng, PriceCompareResponse } from '@sale-radar/shared';
import { api } from '../api.ts';
import { formatDistance, formatPrice, formatRadius } from '../lib/format.ts';

interface Props {
  center: LatLng;
  radius: number;
  kcaEnabled: boolean;
}

const SUGGESTIONS = ['우유', '라면', '계란', '두부', '생수', '쌀', '식용유', '참치', '세제', '휴지', '콜라', '커피'];

export function PriceCompare({ center, radius, kcaEnabled }: Props) {
  const [q, setQ] = useState('');
  const [data, setData] = useState<PriceCompareResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const run = async (term: string) => {
    if (!term.trim()) return;
    setQ(term);
    setLoading(true);
    setError(undefined);
    try {
      setData(await api.prices(center.lat, center.lng, Math.max(radius, 300), term.trim()));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(q);
  };

  if (!kcaEnabled) {
    return (
      <div className="panel-pad">
        <div className="empty">
          <div className="empty-emoji">🧾</div>
          <h3>생필품 가격 비교</h3>
          <p>
            한국소비자원 <strong>참가격</strong> 데이터를 쓰면 주변 마트·편의점·전통시장의 같은 상품 가격을 한눈에
            비교할 수 있어요.
          </p>
          <ol className="steps">
            <li>
              <a href="https://www.data.go.kr/data/15158701/openapi.do" target="_blank" rel="noreferrer">
                공공데이터포털
              </a>
              에서 "한국소비자원_생필품 가격 정보" 활용신청 (무료)
            </li>
            <li>
              발급받은 인증키를 서버 <code>.env</code>의 <code>DATA_GO_KR_SERVICE_KEY</code>에 입력
            </li>
            <li>서버를 다시 시작</li>
          </ol>
        </div>
      </div>
    );
  }

  return (
    <div className="panel-pad">
      <form className="search-form" onSubmit={submit} role="search">
        <label htmlFor="price-q" className="sr-only">
          상품 이름
        </label>
        <input
          id="price-q"
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="상품 이름 (예: 우유, 라면)"
        />
        <button type="submit" className="btn primary" disabled={loading}>
          {loading ? '비교 중…' : '가격 비교'}
        </button>
      </form>
      <div className="chip-row wrap">
        {SUGGESTIONS.map((s) => (
          <button key={s} type="button" className="chip small" onClick={() => run(s)}>
            {s}
          </button>
        ))}
      </div>
      <p className="muted small">반경 {formatRadius(Math.max(radius, 300))} 안의 참가격 조사 매장 기준이에요.</p>
      {error && <p className="notice error">{error}</p>}
      {data && !data.source.ok && (
        <p className="notice error">{data.source.message ?? '참가격 데이터를 불러오지 못했어요.'}</p>
      )}
      {data?.source.pending && <p className="notice">{data.source.message}</p>}
      {data && data.source.ok && !data.source.pending && data.groups.length === 0 && (
        <p className="muted">
          주변 조사 매장에서 "{data.q}" 상품을 찾지 못했어요. 반경을 넓히거나 다른 이름으로 검색해 보세요.
        </p>
      )}
      {data?.inspectDay && <p className="muted small">{data.inspectDay} 조사 가격</p>}
      <div className="compare-groups">
        {data?.groups.map((g) => (
          <section key={g.productId} className="compare-group">
            <header>
              <h3>
                {g.productName} {g.unit && <span className="muted small">{g.unit}</span>}
              </h3>
              <span className="muted small">
                {g.entries.length}곳 · 평균 {formatPrice(g.avg)} · 차이 {formatPrice(g.max - g.min)}
              </span>
            </header>
            <ol className="compare-list">
              {g.entries.map((e, i) => (
                <li key={e.store.id} className={e.price === g.min ? 'lowest' : ''}>
                  <span className="rank">{i + 1}</span>
                  <span className="name">
                    {e.store.name}
                    <span className="muted small"> {formatDistance(e.store.distance)}</span>
                  </span>
                  <span className="tags">
                    {e.isOnePlusOne && <span className="badge type type-one_plus_one">1+1</span>}
                    {e.isDiscount && <span className="badge type type-discount">할인</span>}
                    {e.price === g.min && <span className="badge good-badge">최저</span>}
                  </span>
                  <strong className="price">{formatPrice(e.price)}</strong>
                </li>
              ))}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
