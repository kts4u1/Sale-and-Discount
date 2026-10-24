import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  CATEGORIES,
  CATEGORY_MAP,
  DEAL_TYPES,
  addDays,
  type CategoryId,
  type CreateDealInput,
  type DealTypeId,
  type LatLng,
  type StoreWithDistance,
} from '@sale-radar/shared';
import { api } from '../api.ts';
import { useDebounced } from '../lib/hooks.ts';
import { formatDistance, todayKst } from '../lib/format.ts';
import { Sheet } from './Sheet.tsx';

interface Props {
  open: boolean;
  center: LatLng;
  centerLabel: string;
  /** 정적 배포: 서버가 없어 이 기기에만 저장 */
  localOnly?: boolean;
  presetStore?: StoreWithDistance;
  onClose: () => void;
  onCreated: () => void;
}

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
const SUBMIT_TYPES = DEAL_TYPES.filter((t) => t.id !== 'good_price');

export function SubmitDealSheet(p: Props) {
  const [storeQ, setStoreQ] = useState('');
  const [stores, setStores] = useState<StoreWithDistance[] | null>(null);
  const [storesError, setStoresError] = useState<string>();
  const [store, setStore] = useState<StoreWithDistance | null>(null);
  const [manual, setManual] = useState(false);
  const [manualName, setManualName] = useState('');
  const [manualCategory, setManualCategory] = useState<CategoryId>('food');
  const [manualAddress, setManualAddress] = useState('');

  const [type, setType] = useState<DealTypeId>('discount');
  const [title, setTitle] = useState('');
  const [productName, setProductName] = useState('');
  const [originalPrice, setOriginalPrice] = useState('');
  const [salePrice, setSalePrice] = useState('');
  const [discountRate, setDiscountRate] = useState('');
  const [startDate, setStartDate] = useState(todayKst());
  const [endDate, setEndDate] = useState(addDays(todayKst(), 6));
  const [useTime, setUseTime] = useState(false);
  const [timeStart, setTimeStart] = useState('18:00');
  const [timeEnd, setTimeEnd] = useState('21:00');
  const [days, setDays] = useState<number[]>([]);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string>();

  const debouncedQ = useDebounced(storeQ, 300);

  useEffect(() => {
    if (!p.open) return;
    if (p.presetStore) {
      setStore(p.presetStore);
      setManual(false);
    }
  }, [p.open, p.presetStore]);

  useEffect(() => {
    if (!p.open || manual) return;
    const ctrl = new AbortController();
    setStoresError(undefined);
    api
      .stores(p.center.lat, p.center.lng, 1000, debouncedQ || undefined, ctrl.signal)
      .then((r) => setStores(r.stores))
      .catch((err) => {
        if ((err as Error).name !== 'AbortError') setStoresError((err as Error).message);
      });
    return () => ctrl.abort();
  }, [p.open, p.center.lat, p.center.lng, debouncedQ, manual]);

  const autoRate = useMemo(() => {
    const o = Number(originalPrice);
    const s = Number(salePrice);
    return o > 0 && s >= 0 && s < o ? Math.round((1 - s / o) * 100) : undefined;
  }, [originalPrice, salePrice]);

  const reset = () => {
    setStore(null);
    setManual(false);
    setManualName('');
    setManualAddress('');
    setTitle('');
    setProductName('');
    setOriginalPrice('');
    setSalePrice('');
    setDiscountRate('');
    setDescription('');
    setUseTime(false);
    setDays([]);
    setError(undefined);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(undefined);
    const storeInput: CreateDealInput['store'] | undefined = manual
      ? manualName.trim()
        ? {
            name: manualName.trim(),
            category: manualCategory,
            lat: p.center.lat,
            lng: p.center.lng,
            address: manualAddress.trim() || undefined,
          }
        : undefined
      : store
        ? {
            id: store.id,
            name: store.name,
            category: store.category,
            lat: store.lat,
            lng: store.lng,
            address: store.roadAddress ?? store.address,
            phone: store.phone,
          }
        : undefined;
    if (!storeInput) {
      setError('행사하는 매장을 선택하거나 직접 입력해 주세요.');
      return;
    }
    const num = (v: string) => (v.trim() === '' ? undefined : Number(v));
    const input: CreateDealInput = {
      store: storeInput,
      title: title.trim(),
      type,
      productName: productName.trim() || undefined,
      originalPrice: num(originalPrice),
      salePrice: num(salePrice),
      discountRate: autoRate === undefined ? num(discountRate) : undefined,
      startDate: startDate || undefined,
      endDate: endDate || undefined,
      timeStart: useTime ? timeStart : undefined,
      timeEnd: useTime ? timeEnd : undefined,
      days: days.length ? days : undefined,
      description: description.trim() || undefined,
    };
    setSubmitting(true);
    try {
      await api.createDeal(input);
      reset();
      p.onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Sheet
      open={p.open}
      title="행사 제보하기"
      onClose={p.onClose}
      wide
      footer={
        <button type="submit" form="submit-deal" className="btn primary block" disabled={submitting}>
          {submitting ? '등록 중…' : '제보 등록'}
        </button>
      }
    >
      <form id="submit-deal" className="form" onSubmit={submit}>
        {p.localOnly ? (
          <p className="notice info">
            지금은 서버 없이 동작하는 버전이라 제보가 <strong>이 기기에만 저장</strong>돼요. 다른 사람과 함께 보려면
            서버(<code>npm start</code>)로 실행하세요.
          </p>
        ) : (
          <p className="muted small">
            동네 가게의 할인·마감세일·이벤트를 알려 주세요. 등록하면 주변 사람들에게 바로 보입니다.
          </p>
        )}

        <fieldset>
          <legend>1. 어느 매장인가요?</legend>
          {!manual && store && (
            <div className="picked-store">
              <span>
                {CATEGORY_MAP[store.category]?.emoji} <strong>{store.name}</strong>{' '}
                <span className="muted small">{formatDistance(store.distance)}</span>
              </span>
              <button type="button" className="link-btn" onClick={() => setStore(null)}>
                바꾸기
              </button>
            </div>
          )}
          {!manual && !store && (
            <>
              <input
                type="search"
                placeholder="매장 이름 검색 (내 주변 1km)"
                value={storeQ}
                onChange={(e) => setStoreQ(e.target.value)}
                aria-label="매장 이름 검색"
              />
              {storesError && <p className="notice error">{storesError}</p>}
              {stores === null && !storesError && <p className="muted small">주변 매장을 불러오는 중…</p>}
              {stores && stores.length === 0 && (
                <p className="muted small">주변에서 찾은 매장이 없어요. 아래에서 직접 입력해 주세요.</p>
              )}
              {stores && stores.length > 0 && (
                <ul className="store-pick-list">
                  {stores.slice(0, 40).map((s) => (
                    <li key={s.id}>
                      <button type="button" onClick={() => setStore(s)}>
                        <span>
                          {CATEGORY_MAP[s.category]?.emoji} {s.name}
                        </span>
                        <span className="muted small">{formatDistance(s.distance)}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
          <label className="toggle">
            <input type="checkbox" checked={manual} onChange={(e) => setManual(e.target.checked)} />
            <span>목록에 없어요 — 직접 입력</span>
          </label>
          {manual && (
            <div className="grid2">
              <label>
                매장 이름 *
                <input value={manualName} onChange={(e) => setManualName(e.target.value)} maxLength={60} required />
              </label>
              <label>
                업종
                <select value={manualCategory} onChange={(e) => setManualCategory(e.target.value as CategoryId)}>
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.emoji} {c.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="span2">
                주소 (선택)
                <input value={manualAddress} onChange={(e) => setManualAddress(e.target.value)} maxLength={120} />
              </label>
              <p className="muted small span2">위치는 현재 검색 위치({p.centerLabel || '선택한 위치'})로 등록돼요.</p>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend>2. 어떤 행사인가요?</legend>
          <div className="chip-row wrap" role="radiogroup" aria-label="행사 종류">
            {SUBMIT_TYPES.map((t) => (
              <button
                key={t.id}
                type="button"
                role="radio"
                aria-checked={type === t.id}
                className={`chip small ${type === t.id ? 'chip-on' : ''}`}
                onClick={() => setType(t.id)}
              >
                {t.label}
              </button>
            ))}
          </div>
          <label>
            행사 제목 *
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="예: 마감 1시간 전 빵 50% 할인"
              maxLength={80}
              required
              minLength={2}
            />
          </label>
          <label>
            상품/메뉴 이름
            <input
              value={productName}
              onChange={(e) => setProductName(e.target.value)}
              placeholder="예: 소금빵"
              maxLength={60}
            />
          </label>
          <div className="grid3">
            <label>
              정가(원)
              <input
                inputMode="numeric"
                value={originalPrice}
                onChange={(e) => setOriginalPrice(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label>
              할인가(원)
              <input
                inputMode="numeric"
                value={salePrice}
                onChange={(e) => setSalePrice(e.target.value.replace(/\D/g, ''))}
              />
            </label>
            <label>
              할인율(%)
              <input
                inputMode="numeric"
                value={autoRate !== undefined ? String(autoRate) : discountRate}
                onChange={(e) => setDiscountRate(e.target.value.replace(/\D/g, '').slice(0, 3))}
                disabled={autoRate !== undefined}
              />
            </label>
          </div>
        </fieldset>

        <fieldset>
          <legend>3. 언제 하나요?</legend>
          <div className="grid2">
            <label>
              시작일
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </label>
            <label>
              종료일
              <input type="date" value={endDate} min={startDate} onChange={(e) => setEndDate(e.target.value)} />
            </label>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={useTime} onChange={(e) => setUseTime(e.target.checked)} />
            <span>특정 시간에만 해요 (타임세일·마감할인·해피아워)</span>
          </label>
          {useTime && (
            <div className="grid2">
              <label>
                시작 시간
                <input type="time" value={timeStart} onChange={(e) => setTimeStart(e.target.value)} />
              </label>
              <label>
                종료 시간
                <input type="time" value={timeEnd} onChange={(e) => setTimeEnd(e.target.value)} />
              </label>
            </div>
          )}
          <div className="chip-row wrap" role="group" aria-label="진행 요일 (선택 안 하면 매일)">
            {WEEKDAYS.map((w, i) => (
              <button
                key={w}
                type="button"
                className={`chip small ${days.includes(i) ? 'chip-on' : ''}`}
                aria-pressed={days.includes(i)}
                onClick={() => setDays((d) => (d.includes(i) ? d.filter((x) => x !== i) : [...d, i]))}
              >
                {w}
              </button>
            ))}
            <span className="muted small">요일을 고르지 않으면 매일</span>
          </div>
          <label>
            자세한 내용
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="수량 한정, 조건(1인 2개), 결제 수단 등"
              maxLength={500}
            />
          </label>
        </fieldset>
        {error && <p className="notice error">{error}</p>}
      </form>
    </Sheet>
  );
}
