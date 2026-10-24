import { useState, type FormEvent } from 'react';
import type { GeocodeResult, LatLng } from '@sale-radar/shared';
import { api } from '../api.ts';
import { Sheet } from './Sheet.tsx';

export interface SavedPlace {
  name: string;
  lat: number;
  lng: number;
}

interface Props {
  open: boolean;
  center: LatLng;
  locating: boolean;
  geoError?: string;
  recentPlaces: SavedPlace[];
  onClose: () => void;
  onUseGps: () => void;
  onPickOnMap: () => void;
  onSelect: (place: SavedPlace) => void;
}

export function LocationSheet(p: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<GeocodeResult[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();

  const search = async (e: FormEvent) => {
    e.preventDefault();
    if (!q.trim()) return;
    setLoading(true);
    setError(undefined);
    try {
      const r = await api.geocode(q.trim(), p.center);
      setResults(r.results);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Sheet open={p.open} title="검색 위치 설정" onClose={p.onClose}>
      <div className="stack">
        <button type="button" className="btn primary block" onClick={p.onUseGps} disabled={p.locating}>
          {p.locating ? '현재 위치 찾는 중…' : '📍 현재 내 위치 사용'}
        </button>
        {p.geoError && <p className="notice warn">{p.geoError}</p>}
        <button type="button" className="btn block" onClick={p.onPickOnMap}>
          🗺️ 지도에서 직접 고르기
        </button>

        <form className="search-form" onSubmit={search} role="search">
          <label htmlFor="place-q" className="sr-only">
            주소나 장소 이름
          </label>
          <input
            id="place-q"
            type="search"
            placeholder="주소, 역 이름, 건물 이름 (예: 강남역, 역삼동)"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoComplete="off"
          />
          <button type="submit" className="btn" disabled={loading}>
            {loading ? '검색 중…' : '검색'}
          </button>
        </form>
        {error && <p className="notice error">{error}</p>}
        {results && results.length === 0 && <p className="muted">검색 결과가 없어요. 다른 이름으로 검색해 보세요.</p>}
        {results && results.length > 0 && (
          <ul className="place-list">
            {results.map((r, i) => (
              <li key={`${r.lat},${r.lng},${i}`}>
                <button type="button" onClick={() => p.onSelect({ name: r.name, lat: r.lat, lng: r.lng })}>
                  <strong>{r.name}</strong>
                  <span className="muted small">{r.address}</span>
                </button>
              </li>
            ))}
          </ul>
        )}

        {p.recentPlaces.length > 0 && (
          <>
            <h3 className="small-heading">최근 위치</h3>
            <ul className="place-list">
              {p.recentPlaces.map((r) => (
                <li key={`${r.lat},${r.lng}`}>
                  <button type="button" onClick={() => p.onSelect(r)}>
                    <strong>{r.name}</strong>
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </Sheet>
  );
}
