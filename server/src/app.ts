import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import {
  DEFAULT_RADIUS,
  RADIUS_OPTIONS,
  SOURCE_LABELS,
  type AppConfig,
  type GeocodeResult,
  type ReverseGeocodeResult,
  type SourceStatus,
} from '@sale-radar/shared';
import { sampleDefault, type AppConfigEnv } from './config.ts';
import { SearchService, kcaStatus, type Sources } from './services/search.ts';
import { BrandPromotionSource } from './sources/brand.ts';
import { GoodPriceSource } from './sources/goodprice.ts';
import { KakaoSource } from './sources/kakao.ts';
import { KcaSource } from './sources/kca.ts';
import { NaverSource } from './sources/naver.ts';
import { NominatimSource } from './sources/nominatim.ts';
import { OsmSource } from './sources/osm.ts';
import { CommunityStore } from './store/community.ts';
import {
  createDealSchema,
  formatZodError,
  pointSchema,
  searchQuerySchema,
  textQuerySchema,
  voteSchema,
} from './validation.ts';

export interface AppDeps {
  sources: Sources;
  nominatim: NominatimSource;
  search: SearchService;
}

export function createDeps(config: AppConfigEnv): AppDeps {
  const kakao = new KakaoSource(config);
  const nominatim = new NominatimSource(config);
  const sources: Sources = {
    osm: new OsmSource(config),
    kakao,
    kca: new KcaSource(config.kcaDataDir),
    naver: new NaverSource(config),
    brand: new BrandPromotionSource(config),
    goodprice: new GoodPriceSource(config),
    community: new CommunityStore(config.dataDir),
  };
  return { sources, nominatim, search: new SearchService(config, sources) };
}

/** 아주 단순한 IP 기준 요청 제한 */
function rateLimit(limit: number, windowMs: number) {
  const hits = new Map<string, number[]>();
  return (req: Request, res: Response, next: NextFunction) => {
    const key = req.ip ?? 'unknown';
    const now = Date.now();
    const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= limit) {
      res.status(429).json({ error: '요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.' });
      return;
    }
    list.push(now);
    hits.set(key, list);
    if (hits.size > 10_000) hits.clear();
    next();
  };
}

type Handler = (req: Request, res: Response) => Promise<unknown>;
const wrap = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  fn(req, res).catch(next);
};

function badRequest(res: Response, message: string) {
  res.status(400).json({ error: message });
}

export function createApp(config: AppConfigEnv, deps: AppDeps = createDeps(config)) {
  const { sources, nominatim, search } = deps;
  const app = express();
  app.disable('x-powered-by');
  if (config.trustProxy) app.set('trust proxy', true);
  app.use(express.json({ limit: '32kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self)');
    next();
  });

  const voterKey = (req: Request) =>
    createHash('sha256')
      .update(`${req.ip ?? ''}|${req.get('user-agent') ?? ''}`)
      .digest('hex')
      .slice(0, 16);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, time: new Date().toISOString() });
  });

  app.get(
    '/api/config',
    wrap(async (_req, res) => {
      const s = (id: SourceStatus['id'], enabled: boolean, requires?: string): SourceStatus => ({
        id,
        label: SOURCE_LABELS[id],
        enabled,
        ok: enabled,
        count: 0,
        requires,
      });
      const body: AppConfig = {
        dataMode: 'server',
        radiusOptions: [...RADIUS_OPTIONS],
        defaultRadius: DEFAULT_RADIUS,
        sampleAvailable: config.sampleMode !== 'off',
        sampleDefault: sampleDefault(config),
        sources: [
          kcaStatus(await sources.kca.manifest()),
          s('community', true),
          s('brand', (await sources.brand.count()) > 0),
          s('goodprice', (await sources.goodprice.count()) > 0),
          s('sample', config.sampleMode !== 'off'),
          s('osm', sources.osm.enabled),
          s('kakao', sources.kakao.enabled, 'KAKAO_REST_API_KEY'),
          s('naver', sources.naver.enabled, 'NAVER_CLIENT_ID, NAVER_CLIENT_SECRET'),
        ],
        tileUrl: config.tileUrl,
        tileAttribution: config.tileAttribution,
      };
      res.json(body);
    }),
  );

  app.get(
    '/api/deals',
    wrap(async (req, res) => {
      const parsed = searchQuerySchema.safeParse(req.query);
      if (!parsed.success) return badRequest(res, formatZodError(parsed.error));
      const { sample, active, ...rest } = parsed.data;
      const result = await search.search({ ...rest, includeSample: sample, activeOnly: active });
      res.setHeader('Cache-Control', 'no-store');
      res.json(result);
    }),
  );

  app.post(
    '/api/deals',
    rateLimit(10, 10 * 60_000),
    wrap(async (req, res) => {
      const parsed = createDealSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, formatZodError(parsed.error));
      const created = await sources.community.create(parsed.data);
      res.status(201).json(created);
    }),
  );

  app.get(
    '/api/deals/:id',
    wrap(async (req, res) => {
      const deal = await sources.community.getDeal(String(req.params.id));
      if (!deal) {
        res.status(404).json({ error: '행사를 찾을 수 없습니다' });
        return;
      }
      res.json(deal);
    }),
  );

  app.post(
    '/api/deals/:id/vote',
    rateLimit(120, 10 * 60_000),
    wrap(async (req, res) => {
      const parsed = voteSchema.safeParse(req.body);
      if (!parsed.success) return badRequest(res, formatZodError(parsed.error));
      const id = String(req.params.id);
      if (id.length > 200) return badRequest(res, '잘못된 행사 id');
      res.json(await sources.community.vote(id, parsed.data.action, voterKey(req)));
    }),
  );

  app.get(
    '/api/stores',
    wrap(async (req, res) => {
      const parsed = pointSchema.extend({ q: textQuerySchema.shape.q.optional() }).safeParse(req.query);
      if (!parsed.success) return badRequest(res, formatZodError(parsed.error));
      const { lat, lng, radius, q } = parsed.data;
      res.json(await search.stores({ lat, lng }, radius, q));
    }),
  );

  app.get(
    '/api/prices',
    wrap(async (req, res) => {
      const parsed = textQuerySchema.safeParse(req.query);
      if (!parsed.success || parsed.data.lat === undefined || parsed.data.lng === undefined) {
        return badRequest(res, parsed.success ? '위치가 필요합니다' : formatZodError(parsed.error));
      }
      const { lat, lng, radius, q } = parsed.data;
      res.json(await search.compare({ lat, lng }, radius, q));
    }),
  );

  app.get(
    '/api/geocode',
    wrap(async (req, res) => {
      const parsed = textQuerySchema.safeParse(req.query);
      if (!parsed.success) return badRequest(res, formatZodError(parsed.error));
      const { q, lat, lng } = parsed.data;
      const near = lat !== undefined && lng !== undefined ? { lat, lng } : undefined;
      let results: GeocodeResult[] = [];
      if (sources.kakao.enabled) results = await sources.kakao.geocode(q, near).catch(() => []);
      if (results.length === 0) results = await nominatim.geocode(q, near).catch(() => []);
      res.json({ results });
    }),
  );

  app.get(
    '/api/reverse',
    wrap(async (req, res) => {
      const parsed = pointSchema.safeParse(req.query);
      if (!parsed.success) return badRequest(res, formatZodError(parsed.error));
      const center = { lat: parsed.data.lat, lng: parsed.data.lng };
      let result: ReverseGeocodeResult | undefined;
      if (sources.kakao.enabled) result = await sources.kakao.reverse(center).catch(() => undefined);
      if (!result?.address) result = await nominatim.reverse(center).catch(() => undefined);
      res.json(result ?? { address: '', source: 'none' });
    }),
  );

  app.get(
    '/api/news',
    wrap(async (req, res) => {
      const parsed = textQuerySchema.safeParse(req.query);
      if (!parsed.success) return badRequest(res, formatZodError(parsed.error));
      if (!sources.naver.enabled) {
        res.json({ enabled: false, items: [] });
        return;
      }
      const items = await sources.naver.blog(`${parsed.data.q} 할인 이벤트`).catch(() => []);
      res.json({ enabled: true, items });
    }),
  );

  app.use('/api', (_req, res) => {
    res.status(404).json({ error: '없는 API 입니다' });
  });

  // 빌드된 화면(client/dist)이 있으면 같이 서비스한다
  if (existsSync(path.join(config.clientDist, 'index.html'))) {
    app.use(express.static(config.clientDist, { maxAge: '1h', index: false }));
    app.get(/^\/(?!api\/).*/, (_req, res) => {
      res.sendFile(path.join(config.clientDist, 'index.html'));
    });
  }

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    console.error('[server] 처리 중 오류', err);
    if ((err as { type?: string }).type === 'entity.parse.failed') {
      res.status(400).json({ error: '요청 형식이 올바르지 않습니다' });
      return;
    }
    res.status(500).json({ error: '서버 오류가 발생했습니다' });
  });

  return app;
}
