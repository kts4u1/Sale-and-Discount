import L from 'leaflet';
import { useEffect, useMemo } from 'react';
import {
  Circle,
  CircleMarker,
  MapContainer,
  Marker,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  useMapEvents,
} from 'react-leaflet';
import { CATEGORY_MAP, DEAL_TYPE_MAP, type DealView, type LatLng, type StoreWithDistance } from '@sale-radar/shared';
import { formatDistance, formatPrice } from '../lib/format.ts';

interface Props {
  center: LatLng;
  radius: number;
  deals: DealView[];
  stores: StoreWithDistance[];
  showAllStores: boolean;
  pickMode: boolean;
  selectedStoreId?: string;
  tileUrl: string;
  tileAttribution: string;
  onPick: (p: LatLng) => void;
  onOpenDeal: (d: DealView) => void;
}

function FitToRadius({ center, radius }: { center: LatLng; radius: number }) {
  const map = useMap();
  useEffect(() => {
    const bounds = L.latLng(center.lat, center.lng).toBounds(radius * 2.2);
    map.fitBounds(bounds, { animate: true, padding: [12, 12] });
  }, [map, center.lat, center.lng, radius]);
  return null;
}

/** 지도가 들어 있는 영역의 크기가 바뀌면(탭 전환 등) 다시 그리기 */
function InvalidateOnResize() {
  const map = useMap();
  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => map.invalidateSize());
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);
  return null;
}

function PickHandler({ enabled, onPick }: { enabled: boolean; onPick: (p: LatLng) => void }) {
  useMapEvents({
    click(e) {
      if (enabled) onPick({ lat: e.latlng.lat, lng: e.latlng.lng });
    },
  });
  return null;
}

const iconCache = new Map<string, L.DivIcon>();
function storeIcon(
  emoji: string,
  color: string,
  count: number,
  maxDiscount: number,
  selected: boolean,
  sample: boolean,
): L.DivIcon {
  const key = `${emoji}|${color}|${count}|${maxDiscount}|${selected}|${sample}`;
  let icon = iconCache.get(key);
  if (!icon) {
    const badge =
      maxDiscount > 0
        ? `<span class="pin-badge">${maxDiscount}%</span>`
        : count > 1
          ? `<span class="pin-badge alt">${count}</span>`
          : '';
    icon = L.divIcon({
      className: '',
      html: `<div class="pin ${selected ? 'pin-selected' : ''} ${sample ? 'pin-sample' : ''}" style="--pin:${color}"><span class="pin-emoji">${emoji}</span>${badge}</div>`,
      iconSize: [36, 42],
      iconAnchor: [18, 40],
      popupAnchor: [0, -36],
    });
    iconCache.set(key, icon);
  }
  return icon;
}

export function MapView(p: Props) {
  const groups = useMemo(() => {
    const map = new Map<string, { store: StoreWithDistance; deals: DealView[] }>();
    for (const d of p.deals) {
      const g = map.get(d.storeId) ?? { store: d.store, deals: [] };
      g.deals.push(d);
      map.set(d.storeId, g);
    }
    return [...map.values()];
  }, [p.deals]);

  const dealStoreIds = useMemo(() => new Set(groups.map((g) => g.store.id)), [groups]);
  const plainStores = useMemo(
    () => (p.showAllStores ? p.stores.filter((s) => !dealStoreIds.has(s.id) && s.distance <= p.radius) : []),
    [p.showAllStores, p.stores, dealStoreIds, p.radius],
  );

  return (
    <div className={`map-wrap ${p.pickMode ? 'picking' : ''}`}>
      <MapContainer
        center={[p.center.lat, p.center.lng]}
        zoom={16}
        preferCanvas
        className="map"
        zoomControl
        attributionControl
      >
        <TileLayer url={p.tileUrl} attribution={p.tileAttribution} maxZoom={19} />
        <FitToRadius center={p.center} radius={p.radius} />
        <InvalidateOnResize />
        <PickHandler enabled={p.pickMode} onPick={p.onPick} />
        <Circle
          center={[p.center.lat, p.center.lng]}
          radius={p.radius}
          pathOptions={{ color: '#ff5a36', weight: 2, fillColor: '#ff5a36', fillOpacity: 0.06, dashArray: '6 6' }}
        />
        <CircleMarker
          center={[p.center.lat, p.center.lng]}
          radius={8}
          pathOptions={{ color: '#fff', weight: 3, fillColor: '#1c7ed6', fillOpacity: 1 }}
        >
          <Tooltip direction="top">검색 중심</Tooltip>
        </CircleMarker>

        {plainStores.map((s) => (
          <CircleMarker
            key={s.id}
            center={[s.lat, s.lng]}
            radius={4}
            pathOptions={{ color: CATEGORY_MAP[s.category]?.color ?? '#868e96', weight: 1, fillOpacity: 0.6 }}
          >
            <Tooltip>
              {s.name} · {formatDistance(s.distance)}
            </Tooltip>
          </CircleMarker>
        ))}

        {groups.map(({ store, deals }) => {
          const cat = CATEGORY_MAP[store.category] ?? CATEGORY_MAP.etc;
          const max = Math.max(0, ...deals.map((d) => d.effectiveDiscount));
          return (
            <Marker
              key={store.id}
              position={[store.lat, store.lng]}
              icon={storeIcon(
                cat.emoji,
                cat.color,
                deals.length,
                max,
                store.id === p.selectedStoreId,
                store.sources.includes('sample'),
              )}
              zIndexOffset={store.id === p.selectedStoreId ? 1000 : max}
            >
              <Popup>
                <div className="map-popup">
                  <strong>{store.name}</strong>
                  <span className="muted small">
                    {formatDistance(store.distance)} · 도보 {store.walkMinutes}분 · 행사 {deals.length}개
                  </span>
                  <ul>
                    {deals.slice(0, 6).map((d) => (
                      <li key={d.id}>
                        <button type="button" className="mini-deal" onClick={() => p.onOpenDeal(d)}>
                          <span className={`badge type type-${d.type}`}>{DEAL_TYPE_MAP[d.type]?.short}</span>
                          <span className="mini-title">{d.title}</span>
                          {d.salePrice !== undefined && <strong>{formatPrice(d.salePrice)}</strong>}
                        </button>
                      </li>
                    ))}
                  </ul>
                  {deals.length > 6 && <span className="muted small">외 {deals.length - 6}개</span>}
                </div>
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      {p.pickMode && <div className="map-hint">지도를 눌러 검색 위치를 정하세요</div>}
    </div>
  );
}
