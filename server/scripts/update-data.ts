/**
 * 하루 한 번 도는 데이터 업데이트 (GitHub Actions 가 매일 실행: .github/workflows/update-data.yml)
 *
 *   DATA_GO_KR_KEY=인증키 npm run data:update          참가격 전국 자료 → client/public/data/kca/
 *   npm run data:update -- --force                      이미 받은 조사일이어도 다시 받기
 *   npm run data:update -- --offline                    API 를 부르지 않고 보관해 둔 원자료(.kca-raw)로 다시 만들기
 *
 * 인증키는 .env 파일 또는 GitHub 저장소 Secrets(DATA_GO_KR_KEY)에 넣는다. 코드에 직접 쓰지 않는다.
 * 인증키가 없으면 참가격은 건너뛰고(샘플·OpenStreetMap 으로 동작) 정상 종료한다.
 * 받다가 실패하면 기존 자료를 그대로 두고 실패로 끝난다.
 */
import { appendFileSync } from 'node:fs';
import { loadConfig } from '../src/config.ts';
import { copyStaticExtras, makeGeocoder, runKcaUpdate } from '../src/kca-runner.ts';

const args = process.argv.slice(2);
const force = args.includes('--force');
const offline = args.includes('--offline');
const config = loadConfig();

/** GitHub Actions 단계 출력 */
function output(name: string, value: string) {
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${name}=${value}\n`);
}

await copyStaticExtras(config);

if (!config.dataGoKrKey && !offline) {
  console.log(
    '::notice::인증키(DATA_GO_KR_KEY)가 없어 한국소비자원 참가격 자료는 건너뜁니다. ' +
      'GitHub 저장소 Settings → Secrets and variables → Actions 에 DATA_GO_KR_KEY 를 넣으면 매일 자동으로 받습니다.',
  );
  output('kca', 'skipped');
  process.exit(0);
}

try {
  if (!offline) console.log(`주소→좌표 변환: ${makeGeocoder(config).name}`);
  const r = await runKcaUpdate(config, { force, offline });
  output('kca', r.fetchedPrices ? 'fetched' : 'reused');
  output('inspect_day', r.manifest.inspectDay);
  if (process.env.GITHUB_STEP_SUMMARY) {
    const t = r.manifest.totals;
    appendFileSync(
      process.env.GITHUB_STEP_SUMMARY,
      `### 참가격 자료 ${r.fetchedPrices ? '새로 받음' : '보관본 사용'}\n\n` +
        `| 조사일 | 매장 | 가격 | 할인 | 1+1 | API 호출 |\n|---|---|---|---|---|---|\n` +
        `| ${r.manifest.inspectDay} | ${t.located.toLocaleString()} | ${t.prices.toLocaleString()} | ${t.discounts} | ${t.onePlusOne} | ${r.apiCalls} |\n`,
    );
  }
} catch (err) {
  console.log(`::error::참가격 자료를 만들지 못했습니다: ${(err as Error).message}`);
  output('kca', 'failed');
  process.exit(1);
}
