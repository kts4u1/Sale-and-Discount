import { copyFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { kstNow, type LatLng } from '@sale-radar/shared';
import { PROJECT_ROOT, type AppConfigEnv } from './config.ts';
import { readJson } from './lib/cache.ts';
import { updateKcaSnapshot, type UpdateResult } from './kca-update.ts';
import { KakaoSource } from './sources/kakao.ts';
import { NominatimSource } from './sources/nominatim.ts';
import type { KcaManifest } from '@sale-radar/shared';

/** 주소 → 좌표: 카카오 키가 있으면 카카오(빠름), 없으면 OpenStreetMap(초당 1건) */
export function makeGeocoder(config: AppConfigEnv): {
  geocode: (a: string) => Promise<LatLng | null>;
  concurrency: number;
  name: string;
} {
  const kakao = new KakaoSource(config);
  if (kakao.enabled) return { geocode: (a) => kakao.addressToLatLng(a), concurrency: 4, name: '카카오' };
  const nominatim = new NominatimSource(config);
  return { geocode: (a) => nominatim.addressToLatLng(a), concurrency: 1, name: 'OpenStreetMap' };
}

export interface RunOptions {
  force?: boolean;
  offline?: boolean;
  log?: (m: string) => void;
}

/** 설정대로 참가격 스냅샷을 만든다 */
export async function runKcaUpdate(config: AppConfigEnv, options: RunOptions = {}): Promise<UpdateResult> {
  if (!config.dataGoKrKey && !options.offline) throw new Error('인증키(DATA_GO_KR_KEY)가 없습니다');
  const geo = makeGeocoder(config);
  return updateKcaSnapshot({
    key: config.dataGoKrKey ?? '',
    baseUrl: config.kcaBaseUrl,
    outDir: config.kcaDataDir,
    rawDir: config.kcaRawDir,
    geocode: geo.geocode,
    geocodeConcurrency: geo.concurrency,
    force: options.force,
    offline: options.offline,
    log: options.log,
  });
}

/**
 * 정적 배포(GitHub Pages)용: 브랜드 행사·착한가격업소 파일을 화면 폴더(client/public/data)로 복사한다.
 */
export async function copyStaticExtras(
  config: AppConfigEnv,
  publicDataDir = path.join(PROJECT_ROOT, 'client', 'public', 'data'),
) {
  await mkdir(publicDataDir, { recursive: true });
  for (const file of ['brand-promotions.json', 'goodprice.json']) {
    const src = path.join(config.dataDir, file);
    if (existsSync(src)) await copyFile(src, path.join(publicDataDir, file));
  }
}

/** 다음 "매일 HH:MM (한국 시간)"까지 남은 밀리초 */
export function msUntilNextKst(time: string, now = Date.now()): number {
  const [h, m] = time.split(':').map(Number);
  const k = kstNow(new Date(now));
  let diff = (h * 60 + m - k.minutes) * 60_000 - (now % 60_000);
  if (diff <= 0) diff += 24 * 60 * 60_000;
  return diff;
}

/**
 * 서버로 운영할 때: 인증키가 있으면 하루 한 번(기본 06:10) 참가격 자료를 새로 받는다.
 * 서버를 켰을 때 자료가 없거나 20시간 넘게 지났으면 바로 한 번 받는다.
 */
export function startKcaScheduler(config: AppConfigEnv): { stop: () => void } {
  if (!config.dataGoKrKey || !config.kcaAutoUpdate) return { stop: () => {} };
  let running = false;
  let timer: NodeJS.Timeout | undefined;
  const log = (m: string) => console.log(`[참가격] ${m}`);

  const runOnce = async () => {
    if (running) return;
    running = true;
    try {
      await runKcaUpdate(config, { log });
    } catch (err) {
      console.error(`[참가격] 업데이트 실패 (기존 자료를 그대로 씁니다): ${(err as Error).message}`);
    } finally {
      running = false;
    }
  };

  const scheduleNext = () => {
    timer = setTimeout(() => {
      void runOnce().finally(scheduleNext);
    }, msUntilNextKst(config.kcaUpdateTime));
    timer.unref();
  };

  void (async () => {
    const manifest = await readJson<KcaManifest>(path.join(config.kcaDataDir, 'manifest.json')).catch(() => undefined);
    const age = manifest ? Date.now() - Date.parse(manifest.updatedAt) : Infinity;
    if (age > 20 * 3_600_000) {
      log(manifest ? '자료가 오래되어 지금 새로 받습니다' : '받아 둔 자료가 없어 지금 받습니다');
      await runOnce();
    }
    scheduleNext();
    log(`매일 ${config.kcaUpdateTime}(한국 시간)에 자동으로 갱신합니다`);
  })();

  return { stop: () => clearTimeout(timer) };
}
