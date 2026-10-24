import { createApp } from './app.ts';
import { hasKcaSnapshot, loadConfig, sampleDefault } from './config.ts';
import { startKcaScheduler } from './kca-runner.ts';

const config = loadConfig();
const app = createApp(config);

const server = app.listen(config.port, config.host, () => {
  const on = (v: unknown) => (v ? '켜짐' : '꺼짐 (키 없음)');
  console.log(`\n세일레이더 서버: http://localhost:${config.port}`);
  console.log(
    `  · 한국소비자원 참가격 : ${hasKcaSnapshot(config) ? '받아 둔 자료 사용' : '자료 없음'}` +
      (config.dataGoKrKey
        ? config.kcaAutoUpdate
          ? ` (매일 ${config.kcaUpdateTime} 자동 갱신)`
          : ' (자동 갱신 꺼짐)'
        : ' (인증키 없음)'),
  );
  console.log(`  · 카카오 로컬        : ${on(config.kakaoKey)}`);
  console.log(`  · 네이버 블로그      : ${on(config.naverClientId && config.naverClientSecret)}`);
  console.log(`  · OpenStreetMap      : ${config.enableOsm ? '켜짐' : '꺼짐'}`);
  console.log(
    `  · 샘플 데이터        : ${config.sampleMode === 'off' ? '꺼짐' : sampleDefault(config) ? '기본 표시' : '선택 시 표시'}`,
  );
  console.log(`  · 데이터 폴더        : ${config.dataDir}\n`);
});

const scheduler = startKcaScheduler(config);

const shutdown = () => {
  scheduler.stop();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000).unref();
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
