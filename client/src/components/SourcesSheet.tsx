import type { SourceStatus } from '@sale-radar/shared';
import { Sheet } from './Sheet.tsx';

interface Props {
  open: boolean;
  sources: SourceStatus[];
  onClose: () => void;
}

const HOW_TO: Record<string, { what: string; link?: { label: string; href: string } }> = {
  kca: {
    what: '전국 대형마트·슈퍼(SSM)·백화점·편의점·전통시장의 생필품 가격, 할인 여부·기간, 1+1 정보 (매주 금요일 조사)',
    link: { label: '공공데이터포털에서 무료 키 발급', href: 'https://www.data.go.kr/data/15158701/openapi.do' },
  },
  kakao: {
    what: '주변 음식점·카페·편의점·마트·약국 등 매장 정보와 주소 검색 (정확도가 가장 높음)',
    link: { label: '카카오 개발자 센터에서 REST 키 발급', href: 'https://developers.kakao.com/' },
  },
  naver: {
    what: '매장 상세 화면에서 최근 블로그 할인·이벤트 후기',
    link: { label: '네이버 개발자 센터에서 검색 API 신청', href: 'https://developers.naver.com/apps/' },
  },
  osm: { what: '오픈스트리트맵의 주변 매장 정보 (키 없이 사용)' },
  community: { what: '이 앱 사용자들이 직접 올린 동네 가게 행사' },
  brand: { what: '편의점·프랜차이즈 공통 행사 (운영자가 CSV로 등록)' },
  goodprice: {
    what: '지자체가 지정한 착한가격업소의 대표 메뉴·가격 (운영자가 CSV로 등록)',
    link: {
      label: '공공데이터포털에서 "착한가격업소" 찾기',
      href: 'https://www.data.go.kr/tcs/dss/selectDataSetList.do?keyword=%EC%B0%A9%ED%95%9C%EA%B0%80%EA%B2%A9%EC%97%85%EC%86%8C',
    },
  },
  sample: { what: '실제 데이터가 없을 때 앱을 체험해 볼 수 있는 가상의 매장·행사' },
};

function stateOf(s: SourceStatus): { icon: string; text: string; tone: string } {
  if (!s.enabled) return { icon: '⚪', text: '꺼짐', tone: 'muted' };
  if (s.pending) return { icon: '⏳', text: '불러오는 중', tone: 'later' };
  if (!s.ok) return { icon: '🔴', text: '오류', tone: 'error' };
  return { icon: '🟢', text: '사용 중', tone: 'live' };
}

export function SourcesSheet({ open, sources, onClose }: Props) {
  return (
    <Sheet open={open} title="데이터 출처" onClose={onClose}>
      <p className="muted small">
        여러 곳의 정보를 모아 보여줍니다. 꺼진 출처는 서버의 <code>.env</code> 파일에 키를 넣으면 켜집니다.
      </p>
      <ul className="source-list">
        {sources.map((s) => {
          const st = stateOf(s);
          const how = HOW_TO[s.id];
          return (
            <li key={s.id}>
              <div className="source-head">
                <strong>
                  {st.icon} {s.label}
                </strong>
                <span className={`badge status tone-${st.tone}`}>
                  {st.text}
                  {s.enabled && s.ok && !s.pending ? ` · ${s.count}건` : ''}
                </span>
              </div>
              {how && <p className="small">{how.what}</p>}
              {s.message && <p className="muted small">{s.message}</p>}
              {!s.enabled && s.requires && (
                <p className="small">
                  필요한 설정: <code>{s.requires}</code>
                  {how?.link && (
                    <>
                      {' '}
                      ·{' '}
                      <a href={how.link.href} target="_blank" rel="noreferrer">
                        {how.link.label}
                      </a>
                    </>
                  )}
                </p>
              )}
              {s.enabled && !s.requires && !s.count && how?.link && (
                <p className="small">
                  <a href={how.link.href} target="_blank" rel="noreferrer">
                    {how.link.label}
                  </a>
                </p>
              )}
              {s.durationMs !== undefined && s.durationMs >= 5 && s.enabled && (
                <p className="muted tiny">응답 {s.durationMs}ms</p>
              )}
            </li>
          );
        })}
      </ul>
    </Sheet>
  );
}
