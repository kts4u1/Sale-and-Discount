/**
 * 데이터 불러오기 도구
 *
 *   npm run import -- goodprice <파일.csv> [--region 가평군] [--replace]
 *       지자체 "착한가격업소" CSV(공공데이터포털)를 불러와 server/data/goodprice.json 에 합친다.
 *       위도/경도가 없으면 주소로 좌표를 찾는다 (카카오 키가 있으면 카카오, 없으면 OpenStreetMap).
 *
 *   npm run import -- promotions <파일.csv> [--append]
 *       편의점·프랜차이즈 공통 행사 CSV 를 server/data/brand-promotions.json 으로 만든다.
 *       형식: server/data/examples/brand-promotions.example.csv
 */
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { LatLng } from '@sale-radar/shared';
import { loadConfig } from '../src/config.ts';
import { parseGoodPriceCsv, parsePromotionsCsv } from '../src/importers.ts';
import { readJson, writeJsonAtomic } from '../src/lib/cache.ts';
import { decodeKoreanText } from '../src/lib/csv.ts';
import type { BrandPromotionFile } from '../src/sources/brand.ts';
import type { GoodPriceFile, GoodPriceStore } from '../src/sources/goodprice.ts';
import { KakaoSource } from '../src/sources/kakao.ts';
import { NominatimSource } from '../src/sources/nominatim.ts';

function usage(): never {
  console.log(`사용법:
  npm run import -- goodprice <파일.csv> [--region 지역명] [--replace]
  npm run import -- promotions <파일.csv> [--append]`);
  process.exit(1);
}

function resolveInput(file: string): string {
  // npm 워크스페이스로 실행하면 현재 폴더가 server/ 라서, 처음 실행한 폴더 기준으로도 찾는다
  const candidates = [path.resolve(file), process.env.INIT_CWD ? path.resolve(process.env.INIT_CWD, file) : ''];
  const found = candidates.find((p) => p && existsSync(p));
  if (!found) {
    console.error(`파일을 찾을 수 없습니다: ${file}`);
    process.exit(1);
  }
  return found;
}

function flag(args: string[], name: string): string | true | undefined {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const next = args[i + 1];
  return next && !next.startsWith('--') ? next : true;
}

async function importGoodPrice(file: string, args: string[]) {
  const config = loadConfig();
  const regionFlag = flag(args, 'region');
  const region = typeof regionFlag === 'string' ? regionFlag : undefined;
  const text = decodeKoreanText(await readFile(file));
  const parsed = parseGoodPriceCsv(text, region);
  console.log(`CSV 에서 ${parsed.length}개 업소를 읽었습니다.`);

  const kakao = new KakaoSource(config);
  const nominatim = new NominatimSource(config);
  const geocode = async (address: string): Promise<LatLng | null> =>
    kakao.enabled ? kakao.addressToLatLng(address) : nominatim.addressToLatLng(address);
  if (!kakao.enabled)
    console.log('카카오 키가 없어 OpenStreetMap 으로 주소를 변환합니다 (1초에 1건, 시간이 걸릴 수 있어요).');

  const stores: GoodPriceStore[] = [];
  let failed = 0;
  for (const [i, { store }] of parsed.entries()) {
    let { lat, lng } = store;
    if ((lat === undefined || lng === undefined) && store.address) {
      const pos = await geocode(store.address).catch(() => null);
      if (pos) ({ lat, lng } = pos);
    }
    if (lat === undefined || lng === undefined) {
      failed++;
      continue;
    }
    stores.push({ ...store, lat, lng });
    if ((i + 1) % 20 === 0) console.log(`  ${i + 1}/${parsed.length} 처리 중...`);
  }

  const out = path.join(config.dataDir, 'goodprice.json');
  const existing = (await readJson<GoodPriceFile>(out)) ?? { stores: [] };
  const ids = new Set(stores.map((s) => s.id));
  const kept = existing.stores.filter(
    (s) => !ids.has(s.id) && !(flag(args, 'replace') && region && s.region === region),
  );
  const merged: GoodPriceFile = { updatedAt: new Date().toISOString(), stores: [...kept, ...stores] };
  await writeJsonAtomic(out, merged);
  console.log(
    `완료: ${stores.length}개 추가/갱신, 좌표를 못 찾은 업소 ${failed}개, 전체 ${merged.stores.length}개 → ${out}`,
  );
}

async function importPromotions(file: string, args: string[]) {
  const config = loadConfig();
  const text = decodeKoreanText(await readFile(file));
  const { promotions, skipped } = parsePromotionsCsv(text);
  const out = path.join(config.dataDir, 'brand-promotions.json');
  const existing = (await readJson<BrandPromotionFile>(out)) ?? { promotions: [] };
  const base = flag(args, 'append') ? existing.promotions.filter((p) => !promotions.some((n) => n.id === p.id)) : [];
  const result: BrandPromotionFile = {
    updatedAt: new Date().toISOString().slice(0, 10),
    notice: existing.notice,
    promotions: [...base, ...promotions],
  };
  await writeJsonAtomic(out, result);
  console.log(`완료: 행사 ${promotions.length}개 저장 (형식 오류로 건너뜀 ${skipped}개) → ${out}`);
}

const [kind, file, ...rest] = process.argv.slice(2);
if (!kind || !file) usage();
const input = resolveInput(file);
if (kind === 'goodprice') await importGoodPrice(input, rest);
else if (kind === 'promotions') await importPromotions(input, rest);
else usage();
