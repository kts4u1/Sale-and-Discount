import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, '..');
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, '..');

/** 프로젝트 루트 또는 server 폴더의 .env 를 읽는다 (이미 설정된 값은 덮어쓰지 않음). */
for (const file of [path.join(PROJECT_ROOT, '.env'), path.join(SERVER_ROOT, '.env')]) {
  if (existsSync(file)) {
    try {
      process.loadEnvFile(file);
    } catch (err) {
      console.warn(`[config] ${file} 를 읽지 못했습니다:`, err);
    }
  }
}

const env = (name: string) => {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
};

const list = (value: string | undefined, fallback: string[]) =>
  value
    ? value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : fallback;

export type SampleMode = 'auto' | 'on' | 'off';

export interface AppConfigEnv {
  port: number;
  host: string;
  dataDir: string;
  clientDist: string;
  /** 공공데이터포털(data.go.kr) 인증키 - 한국소비자원 참가격 */
  dataGoKrKey?: string;
  kcaBaseUrl: string;
  /** 참가격 API 에서 한 번에 조회할 최대 매장 수 */
  kcaMaxStores: number;
  kakaoKey?: string;
  naverClientId?: string;
  naverClientSecret?: string;
  overpassEndpoints: string[];
  enableOsm: boolean;
  nominatimUrl: string;
  userAgent: string;
  sampleMode: SampleMode;
  tileUrl: string;
  tileAttribution: string;
  trustProxy: boolean;
}

function parseSampleMode(v: string | undefined): SampleMode {
  return v === 'on' || v === 'off' ? v : 'auto';
}

export function loadConfig(overrides: Partial<AppConfigEnv> = {}): AppConfigEnv {
  const base: AppConfigEnv = {
    port: Number(env('PORT') ?? 8787),
    host: env('HOST') ?? '0.0.0.0',
    dataDir: path.resolve(env('DATA_DIR') ?? path.join(SERVER_ROOT, 'data')),
    clientDist: path.resolve(env('CLIENT_DIST') ?? path.join(PROJECT_ROOT, 'client', 'dist')),
    dataGoKrKey: env('DATA_GO_KR_SERVICE_KEY'),
    kcaBaseUrl: env('KCA_API_BASE_URL') ?? 'https://apis.data.go.kr/B551919/ProductPriceInfoService',
    kcaMaxStores: Number(env('KCA_MAX_STORES') ?? 25),
    kakaoKey: env('KAKAO_REST_API_KEY'),
    naverClientId: env('NAVER_CLIENT_ID'),
    naverClientSecret: env('NAVER_CLIENT_SECRET'),
    overpassEndpoints: list(env('OVERPASS_ENDPOINTS'), [
      'https://overpass-api.de/api/interpreter',
      'https://overpass.private.coffee/api/interpreter',
      'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
    ]),
    enableOsm: env('ENABLE_OSM') !== 'false',
    nominatimUrl: env('NOMINATIM_URL') ?? 'https://nominatim.openstreetmap.org',
    userAgent: env('USER_AGENT') ?? 'SaleRadar/0.1 (+https://github.com/kts4u1/Sale-and-Discount)',
    sampleMode: parseSampleMode(env('SAMPLE_DATA')),
    tileUrl: env('MAP_TILE_URL') ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    tileAttribution:
      env('MAP_TILE_ATTRIBUTION') ??
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    trustProxy: env('TRUST_PROXY') === 'true',
  };
  return { ...base, ...overrides };
}

/** 실제 행사 데이터를 주는 외부 소스가 하나라도 켜져 있는지 */
export function hasRealDealSource(config: AppConfigEnv): boolean {
  return Boolean(config.dataGoKrKey);
}

/** auto: 참가격 키가 없으면 샘플을 기본으로 보여준다 */
export function sampleDefault(config: AppConfigEnv): boolean {
  if (config.sampleMode === 'on') return true;
  if (config.sampleMode === 'off') return false;
  return !hasRealDealSource(config);
}
