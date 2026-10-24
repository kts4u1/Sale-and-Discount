/**
 * 작은 CSV 파서 (RFC 4180: 따옴표, 줄바꿈이 들어간 칸, "" 이스케이프 지원).
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"' && cell === '') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/** 첫 줄을 머리글로 보고 객체 목록으로 */
export function csvToObjects(text: string): Record<string, string>[] {
  const [header, ...rows] = parseCsv(text);
  if (!header) return [];
  const keys = header.map((h) => h.trim());
  return rows.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? '').trim()])));
}

/** 공공데이터 CSV 는 EUC-KR(CP949)인 경우가 많아 UTF-8 이 아니면 EUC-KR 로 읽는다 */
export function decodeKoreanText(buf: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    return new TextDecoder('euc-kr').decode(buf);
  }
}

/** 여러 후보 이름 중 앞쪽 후보부터 값이 있는 열을 찾는다 (공백·대소문자 무시) */
export function pickColumn(row: Record<string, string>, candidates: string[]): string | undefined {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const byKey = new Map(Object.entries(row).map(([k, v]) => [norm(k), v]));
  for (const c of candidates) {
    const v = byKey.get(norm(c));
    if (v) return v;
  }
  return undefined;
}
