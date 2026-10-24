import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  addDays,
  distanceMeters,
  kstNow,
  type CreateDealInput,
  type Deal,
  type LatLng,
  type Store,
  type VoteAction,
  type VoteResult,
} from '@sale-radar/shared';
import { readJson, writeJsonAtomic } from '../lib/cache.ts';

interface Reaction {
  likes: number;
  confirms: number;
  expiredReports: number;
  /** 투표자(해시) → 이미 한 행동 */
  voters: Record<string, VoteAction[]>;
  lastConfirmedAt?: string;
}

interface CommunityData {
  version: 1;
  stores: Store[];
  deals: Deal[];
  reactions: Record<string, Reaction>;
}

const EMPTY: CommunityData = { version: 1, stores: [], deals: [], reactions: {} };
const MAX_DEALS = 20_000;

/**
 * 사용자 제보 행사와 좋아요/확인/종료신고를 JSON 파일에 저장한다.
 * 규모가 커지면 같은 인터페이스로 DB(SQLite, PostgreSQL 등)로 바꾸면 된다.
 */
export class CommunityStore {
  private data: CommunityData = structuredClone(EMPTY);
  private loaded?: Promise<void>;
  private writeChain: Promise<void> = Promise.resolve();
  readonly file: string;

  constructor(dataDir: string) {
    this.file = path.join(dataDir, 'community.json');
  }

  private load(): Promise<void> {
    this.loaded ??= (async () => {
      const saved = await readJson<CommunityData>(this.file).catch((err) => {
        console.warn('[community] 데이터 파일을 읽지 못해 새로 시작합니다:', err);
        return undefined;
      });
      if (saved?.version === 1) this.data = { ...EMPTY, ...saved };
      this.prune();
    })();
    return this.loaded;
  }

  /** 끝난 지 30일 지난 제보는 정리 */
  private prune() {
    const cutoff = addDays(kstNow().date, -30);
    const before = this.data.deals.length;
    this.data.deals = this.data.deals.filter((d) => !d.endDate || d.endDate >= cutoff);
    if (this.data.deals.length > MAX_DEALS) {
      this.data.deals = this.data.deals.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, MAX_DEALS);
    }
    if (this.data.deals.length !== before) {
      const used = new Set(this.data.deals.map((d) => d.storeId));
      this.data.stores = this.data.stores.filter((s) => used.has(s.id));
    }
  }

  private save(): Promise<void> {
    const snapshot = JSON.parse(JSON.stringify(this.data)) as CommunityData;
    this.writeChain = this.writeChain
      .then(() => writeJsonAtomic(this.file, snapshot))
      .catch((err) => console.error('[community] 저장 실패', err));
    return this.writeChain;
  }

  async nearby(center: LatLng, radius: number): Promise<{ deals: Deal[]; stores: Store[] }> {
    await this.load();
    const stores = this.data.stores.filter((s) => distanceMeters(center, s) <= radius);
    const ids = new Set(stores.map((s) => s.id));
    const deals = this.data.deals.filter((d) => ids.has(d.storeId)).map((d) => this.withReaction(d));
    return { deals, stores };
  }

  async allStores(): Promise<Store[]> {
    await this.load();
    return this.data.stores;
  }

  async getDeal(id: string): Promise<Deal | undefined> {
    await this.load();
    const deal = this.data.deals.find((d) => d.id === id);
    return deal ? this.withReaction(deal) : undefined;
  }

  private withReaction(deal: Deal): Deal {
    const r = this.data.reactions[deal.id];
    if (!r) return deal;
    return {
      ...deal,
      likes: r.likes,
      confirms: r.confirms,
      expiredReports: r.expiredReports,
      updatedAt: r.lastConfirmedAt ?? deal.updatedAt,
    };
  }

  /** 다른 출처(참가격, 샘플 등) 행사에 대한 반응도 여기에 저장한다 */
  async reactions(ids: string[]): Promise<Map<string, Pick<Reaction, 'likes' | 'confirms' | 'expiredReports'>>> {
    await this.load();
    const map = new Map<string, Pick<Reaction, 'likes' | 'confirms' | 'expiredReports'>>();
    for (const id of ids) {
      const r = this.data.reactions[id];
      if (r) map.set(id, r);
    }
    return map;
  }

  async create(input: CreateDealInput): Promise<{ deal: Deal; store: Store }> {
    await this.load();
    const now = new Date().toISOString();

    // 이미 아는 매장(카카오/OSM 등)이면 같은 id 를 써서 지도에서 합쳐지게 한다
    const storeId =
      input.store.id && /^(kakao|osm|kca|community|goodprice):/.test(input.store.id)
        ? input.store.id
        : `community:${randomUUID()}`;
    let store = this.data.stores.find((s) => s.id === storeId);
    if (!store) {
      store = {
        id: storeId,
        name: input.store.name.trim(),
        category: input.store.category,
        lat: input.store.lat,
        lng: input.store.lng,
        address: input.store.address?.trim() || undefined,
        phone: input.store.phone?.trim() || undefined,
        sources: ['community'],
      };
      this.data.stores.push(store);
    }

    const deal: Deal = {
      id: `community:${randomUUID()}`,
      storeId,
      title: input.title.trim(),
      productName: input.productName?.trim() || undefined,
      description: input.description?.trim() || undefined,
      type: input.type,
      category: input.store.category,
      originalPrice: input.originalPrice,
      salePrice: input.salePrice,
      discountRate: input.discountRate,
      unit: input.unit?.trim() || undefined,
      startDate: input.startDate,
      endDate: input.endDate,
      timeStart: input.timeStart,
      timeEnd: input.timeEnd,
      days: input.days?.length ? [...new Set(input.days)].sort() : undefined,
      tags: (input.tags ?? [])
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8),
      source: 'community',
      createdAt: now,
      updatedAt: now,
      likes: 0,
      confirms: 0,
      expiredReports: 0,
    };
    this.data.deals.push(deal);
    await this.save();
    return { deal, store };
  }

  async vote(dealId: string, action: VoteAction, voter: string): Promise<VoteResult & { duplicate: boolean }> {
    await this.load();
    const r = (this.data.reactions[dealId] ??= { likes: 0, confirms: 0, expiredReports: 0, voters: {} });
    const done = (r.voters[voter] ??= []);
    const duplicate = done.includes(action);
    if (!duplicate) {
      done.push(action);
      if (action === 'like') r.likes += 1;
      if (action === 'confirm') {
        r.confirms += 1;
        r.lastConfirmedAt = new Date().toISOString();
      }
      if (action === 'expired') r.expiredReports += 1;
      await this.save();
    }
    return { dealId, likes: r.likes, confirms: r.confirms, expiredReports: r.expiredReports, duplicate };
  }

  /** 테스트·종료 시 저장 완료 대기 */
  async flush(): Promise<void> {
    await this.writeChain;
  }
}
