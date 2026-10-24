import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: true,
  // 상품/업체 ID 의 앞자리 0 이 사라지지 않도록 문자열 그대로 둔다
  parseTagValue: false,
  trimValues: true,
});

export class OpenApiError extends Error {
  constructor(
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'OpenApiError';
  }
}

type XmlNode = Record<string, unknown>;

const isObject = (v: unknown): v is XmlNode => typeof v === 'object' && v !== null && !Array.isArray(v);

/**
 * 공공데이터포털 형식의 XML 응답에서 항목 목록을 꺼낸다.
 * <response><result><항목태그>...</항목태그>...</result><resultCode/>...</response>
 * 오류 응답(<OpenAPI_ServiceResponse>)이면 OpenApiError 를 던진다.
 */
export function parseOpenApiItems(xml: string): Record<string, string>[] {
  let doc: XmlNode;
  try {
    doc = parser.parse(xml) as XmlNode;
  } catch (err) {
    throw new OpenApiError(`XML 해석 실패: ${(err as Error).message}`);
  }

  const gatewayError = doc.OpenAPI_ServiceResponse;
  if (isObject(gatewayError)) {
    const header = (gatewayError.cmmMsgHeader ?? {}) as XmlNode;
    const msg = [header.errMsg, header.returnAuthMsg].filter(Boolean).join(' / ');
    throw new OpenApiError(msg || '공공데이터포털 오류', String(header.returnReasonCode ?? ''));
  }

  const root = (isObject(doc.response) ? doc.response : doc) as XmlNode;
  const header = isObject(root.header) ? root.header : root;
  const resultCode = header.resultCode !== undefined ? String(header.resultCode) : undefined;
  const resultMsg = header.resultMsg !== undefined ? String(header.resultMsg) : undefined;

  const items: Record<string, string>[] = [];
  const collect = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const n of node) collect(n);
      return;
    }
    if (!isObject(node)) return;
    const values = Object.values(node);
    // 모든 값이 문자열이면 항목 하나로 본다
    if (values.length > 0 && values.every((v) => typeof v === 'string' || typeof v === 'number')) {
      items.push(Object.fromEntries(Object.entries(node).map(([k, v]) => [k, String(v)])));
      return;
    }
    for (const v of values) collect(v);
  };

  const result = root.result ?? (isObject(root.body) ? (root.body as XmlNode).items : undefined);
  collect(result);

  if (items.length === 0 && resultCode && !/^0+$/.test(resultCode) && !/NORMAL|정상|SUCCESS/i.test(resultMsg ?? '')) {
    throw new OpenApiError(resultMsg || `오류 코드 ${resultCode}`, resultCode);
  }
  return items;
}
