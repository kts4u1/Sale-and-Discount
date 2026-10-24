import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  DEFAULT_CENTER,
  DEFAULT_RADIUS,
  computeDealTiming,
  type AppConfig,
  type CategoryId,
  type DealTypeId,
  type DealView,
  type LatLng,
  type SearchResponse,
  type SortId,
} from '@sale-radar/shared';
import { api } from './api.ts';
import { DealCard, DealSkeleton } from './components/DealCard.tsx';
import { DealDetail } from './components/DealDetail.tsx';
import { CategoryChips, DealTypeChips, FilterOptions } from './components/Filters.tsx';
import { LocationSheet, type SavedPlace } from './components/LocationSheet.tsx';
import { MapView } from './components/MapView.tsx';
import { PriceCompare } from './components/PriceCompare.tsx';
import { RadiusSelector } from './components/RadiusSelector.tsx';
import { SourcesSheet } from './components/SourcesSheet.tsx';
import { SubmitDealSheet } from './components/SubmitDealSheet.tsx';
import { formatRadius } from './lib/format.ts';
import { GEO_ERROR_TEXT, getCurrentPosition, useDebounced, useMediaQuery, type GeoError } from './lib/hooks.ts';
import { usePersistentState } from './lib/storage.ts';

type Tab = 'list' | 'map' | 'prices' | 'saved';
type SheetName = 'location' | 'sources' | 'submit' | null;

const PAGE = 40;
const MAX_AUTO_REFRESH = 6;

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);

  // 위치
  const [center, setCenter] = usePersistentState<LatLng>('center', DEFAULT_CENTER);
  const [locMode, setLocMode] = usePersistentState<'gps' | 'manual' | 'default'>('locMode', 'default');
  const [centerLabel, setCenterLabel] = useState('');
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState<string>();
  const [recentPlaces, setRecentPlaces] = usePersistentState<SavedPlace[]>('recentPlaces', []);
  const [pickMode, setPickMode] = useState(false);

  // 검색 조건
  const [radius, setRadius] = usePersistentState('radius', DEFAULT_RADIUS);
  const [q, setQ] = useState('');
  const [recentQueries, setRecentQueries] = usePersistentState<string[]>('recentQueries', []);
  const [categories, setCategories] = usePersistentState<CategoryId[]>('categories', []);
  const [types, setTypes] = useState<DealTypeId[]>([]);
  const [sort, setSort] = usePersistentState<SortId>('sort', 'recommended');
  const [activeOnly, setActiveOnly] = useState(false);
  const [minDiscount, setMinDiscount] = useState(0);
  const [includeSample, setIncludeSample] = usePersistentState<boolean | null>('includeSample', null);
  const [showFilters, setShowFilters] = useState(false);

  // 결과
  const [data, setData] = useState<SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [refreshKey, setRefreshKey] = useState(0);
  const [visible, setVisible] = useState(PAGE);

  // 화면
  const [tab, setTab] = useState<Tab>('list');
  const [sheet, setSheet] = useState<SheetName>(null);
  const [selected, setSelected] = useState<DealView | null>(null);
  const [showAllStores, setShowAllStores] = usePersistentState('showAllStores', false);
  const [favorites, setFavorites] = usePersistentState<Record<string, DealView>>('favorites', {});
  const [toast, setToast] = useState<string>();
  const isWide = useMediaQuery('(min-width: 960px)');

  const dq = useDebounced(q, 400);
  const autoRefreshCount = useRef(0);

  /* ------------------------------ 초기화 ------------------------------ */

  useEffect(() => {
    api
      .config()
      .then(setConfig)
      .catch(() => setConfig(null));
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? undefined : t)), 3200);
  }, []);

  const locate = useCallback(async () => {
    setLocating(true);
    setGeoError(undefined);
    try {
      const pos = await getCurrentPosition();
      setCenter({ lat: pos.lat, lng: pos.lng });
      setLocMode('gps');
      setSheet((s) => (s === 'location' ? null : s));
    } catch (err) {
      setGeoError(GEO_ERROR_TEXT[err as GeoError] ?? GEO_ERROR_TEXT.unavailable);
    } finally {
      setLocating(false);
    }
  }, [setCenter, setLocMode]);

  useEffect(() => {
    if (locMode !== 'manual') void locate();
    // 처음 한 번만
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 좌표 → 주소
  const dCenter = useDebounced(center, 500);
  useEffect(() => {
    let alive = true;
    api
      .reverse(dCenter.lat, dCenter.lng)
      .then((r) => alive && setCenterLabel(r.address || `${dCenter.lat.toFixed(4)}, ${dCenter.lng.toFixed(4)}`))
      .catch(() => alive && setCenterLabel(`${dCenter.lat.toFixed(4)}, ${dCenter.lng.toFixed(4)}`));
    return () => {
      alive = false;
    };
  }, [dCenter.lat, dCenter.lng]);

  /* ------------------------------- 검색 ------------------------------- */

  const params = useMemo(
    () => ({
      lat: center.lat,
      lng: center.lng,
      radius,
      q: dq,
      categories,
      types,
      sort,
      active: activeOnly,
      minDiscount,
      sample: includeSample ?? undefined,
    }),
    [center.lat, center.lng, radius, dq, categories, types, sort, activeOnly, minDiscount, includeSample],
  );
  const paramsKey = JSON.stringify(params);
  const lastParamsKey = useRef('');

  useEffect(() => {
    const ctrl = new AbortController();
    if (lastParamsKey.current !== paramsKey) {
      autoRefreshCount.current = 0;
      lastParamsKey.current = paramsKey;
      setVisible(PAGE);
    }
    setLoading(true);
    setError(undefined);
    api
      .search(params, ctrl.signal)
      .then((res) => {
        setData(res);
        setLoading(false);
        if (params.q && params.q.trim().length >= 2 && res.deals.length > 0) {
          const term = params.q.trim();
          setRecentQueries((list) => [term, ...list.filter((x) => x !== term)].slice(0, 8));
        }
      })
      .catch((err) => {
        if ((err as Error).name === 'AbortError') return;
        setError((err as Error).message);
        setLoading(false);
      });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paramsKey, refreshKey]);

  // 아직 불러오는 출처가 있으면 잠시 뒤 다시 검색
  const pending = data?.sources.some((s) => s.pending) ?? false;
  useEffect(() => {
    if (!pending || autoRefreshCount.current >= MAX_AUTO_REFRESH) return;
    const t = window.setTimeout(() => {
      autoRefreshCount.current += 1;
      setRefreshKey((k) => k + 1);
    }, 8000);
    return () => window.clearTimeout(t);
  }, [pending, data]);

  /* ------------------------------- 동작 ------------------------------- */

  const selectPlace = (place: SavedPlace) => {
    setCenter({ lat: place.lat, lng: place.lng });
    setLocMode('manual');
    setRecentPlaces((list) => [place, ...list.filter((p) => p.name !== place.name)].slice(0, 6));
    setSheet(null);
  };

  const startPick = () => {
    setSheet(null);
    setPickMode(true);
    if (!isWide) setTab('map');
  };

  const onPick = (p: LatLng) => {
    setPickMode(false);
    setCenter(p);
    setLocMode('manual');
    showToast('검색 위치를 바꿨어요');
  };

  const toggleSave = useCallback(
    (d: DealView) => {
      setFavorites((f) => {
        const next = { ...f };
        if (next[d.id]) delete next[d.id];
        else next[d.id] = d;
        return next;
      });
    },
    [setFavorites],
  );

  const onVoted = (dealId: string, counts: { likes: number; confirms: number; expiredReports: number }) => {
    setData((prev) =>
      prev ? { ...prev, deals: prev.deals.map((d) => (d.id === dealId ? { ...d, ...counts } : d)) } : prev,
    );
    setSelected((s) => (s && s.id === dealId ? { ...s, ...counts } : s));
  };

  const resetFilters = () => {
    setCategories([]);
    setTypes([]);
    setActiveOnly(false);
    setMinDiscount(0);
    setQ('');
  };

  const deals = data?.deals ?? [];
  const stats = data?.stats;
  const sameStore = useMemo(
    () => (selected ? deals.filter((d) => d.storeId === selected.storeId) : []),
    [deals, selected],
  );
  const favoriteList = useMemo(
    () =>
      Object.values(favorites)
        .map((d) => ({ ...d, ...computeDealTiming(d) }))
        .sort((a, b) => Number(a.status === 'ended') - Number(b.status === 'ended')),
    [favorites],
  );
  const filtersActive = categories.length + types.length > 0 || activeOnly || minDiscount > 0 || q.trim() !== '';
  const naverEnabled = config?.sources.find((s) => s.id === 'naver')?.enabled ?? false;
  const kcaEnabled = config?.sources.find((s) => s.id === 'kca')?.enabled ?? false;
  const sampleAvailable = config?.sampleAvailable ?? true;
  const effectiveSample = includeSample ?? config?.sampleDefault ?? true;
  const enabledSources = (data?.sources ?? config?.sources ?? []).filter((s) => s.enabled && s.ok).length;

  const map = (
    <MapView
      center={center}
      radius={radius}
      deals={deals}
      stores={data?.stores ?? []}
      showAllStores={showAllStores}
      pickMode={pickMode}
      selectedStoreId={selected?.storeId}
      tileUrl={config?.tileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png'}
      tileAttribution={config?.tileAttribution ?? '&copy; OpenStreetMap contributors'}
      onPick={onPick}
      onOpenDeal={setSelected}
    />
  );

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden="true">
            🏷️
          </span>
          <div>
            <h1>세일레이더</h1>
            <p className="tagline">내 주변 할인·행사 한눈에</p>
          </div>
        </div>
        <button type="button" className="location-pill" onClick={() => setSheet('location')} title="검색 위치 바꾸기">
          <span aria-hidden="true">{locMode === 'gps' ? '📍' : '📌'}</span>
          <span className="loc-text">{locating ? '위치 찾는 중…' : centerLabel || '위치 설정'}</span>
          <span className="caret" aria-hidden="true">
            ▾
          </span>
        </button>
        <button type="button" className="icon-btn sources-btn" onClick={() => setSheet('sources')} title="데이터 출처">
          <span aria-hidden="true">🛰️</span>
          <span className="sources-count">{enabledSources}</span>
          <span className="sr-only">데이터 출처 보기</span>
        </button>
      </header>

      <div className="layout">
        <aside className="panel">
          <div className={`controls ${tab === 'map' && !isWide ? 'compact' : ''}`}>
            <div className="search-box">
              <span aria-hidden="true">🔍</span>
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="상품·음식·가게 검색 (예: 우유, 치킨, 커피)"
                aria-label="행사 검색"
                list="recent-queries"
              />
              <datalist id="recent-queries">
                {recentQueries.map((r) => (
                  <option key={r} value={r} />
                ))}
              </datalist>
              {q && (
                <button type="button" className="icon-btn small" onClick={() => setQ('')} aria-label="검색어 지우기">
                  ✕
                </button>
              )}
            </div>
            {!q && recentQueries.length > 0 && (
              <div className="chip-row scroll recent">
                <span className="muted tiny">최근</span>
                {recentQueries.map((r) => (
                  <button key={r} type="button" className="chip tiny" onClick={() => setQ(r)}>
                    {r}
                  </button>
                ))}
              </div>
            )}

            <RadiusSelector value={radius} onChange={setRadius} />
            <CategoryChips value={categories} onChange={setCategories} counts={stats?.byCategory} />

            <div className="filter-toggle-row">
              <button
                type="button"
                className={`btn small ${showFilters ? 'on' : ''}`}
                onClick={() => setShowFilters((v) => !v)}
                aria-expanded={showFilters}
              >
                ⚙️ 상세 필터
                {types.length + (activeOnly ? 1 : 0) + (minDiscount ? 1 : 0) > 0
                  ? ` (${types.length + (activeOnly ? 1 : 0) + (minDiscount ? 1 : 0)})`
                  : ''}
              </button>
              {filtersActive && (
                <button type="button" className="link-btn" onClick={resetFilters}>
                  필터 초기화
                </button>
              )}
            </div>
            {showFilters && (
              <div className="filter-panel">
                <DealTypeChips value={types} onChange={setTypes} counts={stats?.byType} />
                <FilterOptions
                  sort={sort}
                  onSort={setSort}
                  activeOnly={activeOnly}
                  onActiveOnly={setActiveOnly}
                  minDiscount={minDiscount}
                  onMinDiscount={setMinDiscount}
                  sampleAvailable={sampleAvailable}
                  includeSample={effectiveSample}
                  onIncludeSample={(v) => setIncludeSample(v)}
                />
              </div>
            )}
          </div>

          <nav className="tabs" role="tablist" aria-label="보기 선택">
            <TabButton id="list" tab={tab} setTab={setTab}>
              행사 {stats ? stats.totalDeals : ''}
            </TabButton>
            {!isWide && (
              <TabButton id="map" tab={tab} setTab={setTab}>
                지도
              </TabButton>
            )}
            <TabButton id="prices" tab={tab} setTab={setTab}>
              가격비교
            </TabButton>
            <TabButton id="saved" tab={tab} setTab={setTab}>
              찜 {favoriteList.length || ''}
            </TabButton>
          </nav>

          <div className={`loading-bar ${loading ? 'on' : ''}`} aria-hidden="true" />

          <main className="tab-content">
            {tab === 'list' && (
              <div className="list-pane">
                {geoError && locMode !== 'manual' && (
                  <div className="notice warn">
                    {geoError}{' '}
                    <button type="button" className="link-btn" onClick={() => setSheet('location')}>
                      위치 직접 정하기
                    </button>
                  </div>
                )}
                {data?.sampleIncluded && (
                  <div className="notice info">
                    <strong>샘플 데이터 포함</strong> — [샘플] 표시된 매장·행사는 체험용 가상 데이터예요.{' '}
                    <button type="button" className="link-btn" onClick={() => setSheet('sources')}>
                      실제 데이터 연결 방법
                    </button>
                  </div>
                )}
                {pending && (
                  <div className="notice">⏳ 주변 매장 정보를 더 불러오는 중이에요. 잠시 후 자동으로 갱신됩니다.</div>
                )}
                {error && (
                  <div className="notice error">
                    {error}{' '}
                    <button type="button" className="link-btn" onClick={() => setRefreshKey((k) => k + 1)}>
                      다시 시도
                    </button>
                  </div>
                )}

                {stats && (
                  <div className="summary">
                    <div>
                      <strong>{formatRadius(radius)}</strong> 안에서 <strong>{stats.totalDeals}</strong>개 행사
                    </div>
                    <div className="summary-stats">
                      <span>🟢 진행 중 {stats.activeNow}</span>
                      <span>⏰ 마감임박 {stats.endingSoon}</span>
                      {stats.maxDiscount > 0 && <span>🔥 최대 {stats.maxDiscount}%</span>}
                      <span>🏬 매장 {stats.totalStores}</span>
                    </div>
                  </div>
                )}

                {!data && loading && Array.from({ length: 5 }, (_, i) => <DealSkeleton key={i} />)}

                {data && deals.length === 0 && !loading && (
                  <div className="empty">
                    <div className="empty-emoji">🔎</div>
                    <h3>조건에 맞는 행사가 없어요</h3>
                    <p className="muted">반경을 넓히거나 필터를 바꿔 보세요. 알고 있는 행사가 있다면 제보해 주세요!</p>
                    <div className="btn-row center">
                      {radius < 1000 && (
                        <button type="button" className="btn" onClick={() => setRadius(Math.min(1000, radius + 300))}>
                          반경 넓히기
                        </button>
                      )}
                      {filtersActive && (
                        <button type="button" className="btn" onClick={resetFilters}>
                          필터 초기화
                        </button>
                      )}
                      <button type="button" className="btn primary" onClick={() => setSheet('submit')}>
                        행사 제보하기
                      </button>
                    </div>
                  </div>
                )}

                <div className="deal-list">
                  {deals.slice(0, visible).map((d) => (
                    <DealCard
                      key={d.id}
                      deal={d}
                      saved={Boolean(favorites[d.id])}
                      onOpen={setSelected}
                      onToggleSave={toggleSave}
                      highlighted={selected?.id === d.id}
                    />
                  ))}
                </div>
                {deals.length > visible && (
                  <button type="button" className="btn block" onClick={() => setVisible((v) => v + PAGE)}>
                    더 보기 ({deals.length - visible}개 남음)
                  </button>
                )}
              </div>
            )}

            {tab === 'map' && !isWide && (
              <div className="map-tab">
                <MapToolbar
                  showAll={showAllStores}
                  onShowAll={setShowAllStores}
                  pickMode={pickMode}
                  onPick={() => setPickMode((v) => !v)}
                />
                {map}
              </div>
            )}

            {tab === 'prices' && <PriceCompare center={center} radius={radius} kcaEnabled={kcaEnabled} />}

            {tab === 'saved' && (
              <div className="list-pane">
                {favoriteList.length === 0 && (
                  <div className="empty">
                    <div className="empty-emoji">♡</div>
                    <h3>찜한 행사가 없어요</h3>
                    <p className="muted">행사 카드의 ♡ 를 눌러 저장해 두면 여기서 다시 볼 수 있어요.</p>
                  </div>
                )}
                <div className="deal-list">
                  {favoriteList.map((d) => (
                    <div key={d.id} className={d.status === 'ended' ? 'ended' : ''}>
                      {d.status === 'ended' && <span className="badge status tone-muted ended-badge">종료된 행사</span>}
                      <DealCard deal={d} saved onOpen={setSelected} onToggleSave={toggleSave} />
                    </div>
                  ))}
                </div>
              </div>
            )}
          </main>
        </aside>

        {isWide && (
          <section className="map-pane" aria-label="지도">
            <MapToolbar
              showAll={showAllStores}
              onShowAll={setShowAllStores}
              pickMode={pickMode}
              onPick={() => setPickMode((v) => !v)}
            />
            {map}
          </section>
        )}
      </div>

      <button type="button" className="fab" onClick={() => setSheet('submit')}>
        ＋ 행사 제보
      </button>

      <LocationSheet
        open={sheet === 'location'}
        center={center}
        locating={locating}
        geoError={geoError}
        recentPlaces={recentPlaces}
        onClose={() => setSheet(null)}
        onUseGps={locate}
        onPickOnMap={startPick}
        onSelect={selectPlace}
      />
      <SourcesSheet
        open={sheet === 'sources'}
        sources={data?.sources ?? config?.sources ?? []}
        onClose={() => setSheet(null)}
      />
      <SubmitDealSheet
        open={sheet === 'submit'}
        center={center}
        centerLabel={centerLabel}
        presetStore={undefined}
        onClose={() => setSheet(null)}
        onCreated={() => {
          setSheet(null);
          showToast('제보해 주셔서 고마워요! 목록에 바로 반영했어요.');
          setRefreshKey((k) => k + 1);
        }}
      />
      <DealDetail
        deal={selected}
        sameStore={sameStore}
        saved={selected ? Boolean(favorites[selected.id]) : false}
        naverEnabled={naverEnabled}
        onClose={() => setSelected(null)}
        onToggleSave={toggleSave}
        onOpenDeal={setSelected}
        onVoted={onVoted}
        onToast={showToast}
      />

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}

function TabButton({
  id,
  tab,
  setTab,
  children,
}: {
  id: Tab;
  tab: Tab;
  setTab: (t: Tab) => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={tab === id}
      className={`tab ${tab === id ? 'on' : ''}`}
      onClick={() => setTab(id)}
    >
      {children}
    </button>
  );
}

function MapToolbar({
  showAll,
  onShowAll,
  pickMode,
  onPick,
}: {
  showAll: boolean;
  onShowAll: (v: boolean) => void;
  pickMode: boolean;
  onPick: () => void;
}) {
  return (
    <div className="map-toolbar">
      <label className="toggle">
        <input type="checkbox" checked={showAll} onChange={(e) => onShowAll(e.target.checked)} />
        <span>행사 없는 매장도 표시</span>
      </label>
      <button type="button" className={`btn small ${pickMode ? 'on' : ''}`} onClick={onPick}>
        {pickMode ? '위치 고르기 취소' : '📌 지도에서 위치 정하기'}
      </button>
    </div>
  );
}
