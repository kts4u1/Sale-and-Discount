import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_OVERPASS_ENDPOINTS } from '@sale-radar/shared';

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
  /** 공공데이터포털(data.go.kr) 인증키 - 한국소비자원 참가격 (하루 한 번 업데이트 작업만 사용) */
  dataGoKrKey?: string;
  kcaBaseUrl: string;
  /** 참가격 스냅샷 폴더 (업데이트 작업이 쓰고 검색이 읽는다) */
  kcaDataDir: string;
  /** 참가격 원자료 보관 폴더 */
  kcaRawDir: string;
  /** 서버가 하루 한 번 직접 업데이트할지 (인증키가 있을 때) */
  kcaAutoUpdate: boolean;
  /** 매일 업데이트 시각 (한국 시간 HH:MM) */
  kcaUpdateTime: string;
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
    // 학원 앱과 같은 이름(DATA_GO_KR_KEY)을 쓰고, 예전 이름도 받는다
    dataGoKrKey: env('DATA_GO_KR_KEY') ?? env('DATA_GO_KR_SERVICE_KEY'),
    kcaBaseUrl: env('KCA_API_BASE_URL') ?? 'https://apis.data.go.kr/B551919/ProductPriceInfoService',
    kcaDataDir: path.resolve(env('KCA_DATA_DIR') ?? path.join(PROJECT_ROOT, 'client', 'public', 'data', 'kca')),
    kcaRawDir: path.resolve(env('KCA_RAW_DIR') ?? path.join(PROJECT_ROOT, '.kca-raw')),
    kcaAutoUpdate: env('KCA_AUTO_UPDATE') !== 'false',
    kcaUpdateTime: /^\d{2}:\d{2}$/.test(env('KCA_UPDATE_TIME') ?? '') ? env('KCA_UPDATE_TIME')! : '06:10',
    kakaoKey: env('KAKAO_REST_API_KEY'),
    naverClientId: env('NAVER_CLIENT_ID'),
    naverClientSecret: env('NAVER_CLIENT_SECRET'),
    overpassEndpoints: list(env('OVERPASS_ENDPOINTS'), DEFAULT_OVERPASS_ENDPOINTS),
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

/** 참가격 스냅샷(하루 한 번 받아 둔 자료)이 있는지 */
export function hasKcaSnapshot(config: AppConfigEnv): boolean {
  return existsSync(path.join(config.kcaDataDir, 'manifest.json'));
}

/** 실제 행사 데이터가 있는지 */
export function hasRealDealSource(config: AppConfigEnv): boolean {
  return hasKcaSnapshot(config);
}

/** auto: 참가격 자료가 없으면 샘플을 기본으로 보여준다 */
export function sampleDefault(config: AppConfigEnv): boolean {
  if (config.sampleMode === 'on') return true;
  if (config.sampleMode === 'off') return false;
  return !hasRealDealSource(config);
}
