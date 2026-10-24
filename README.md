# 🏷️ 세일레이더 (Sale Radar)

**내 위치 주변 100m ~ 1km 안에서 진행 중인 할인·1+1·2+1·타임세일·마감할인·해피아워 행사를 한눈에 찾아 주는 위치 기반 웹앱**입니다.
휴대폰 브라우저에서 바로 쓸 수 있고(홈 화면에 추가 가능), PC에서는 목록과 지도를 나란히 보여줍니다.

여러 곳의 데이터를 모아서 보여줍니다.

| 출처 | 내용 | 필요한 것 |
| --- | --- | --- |
| **한국소비자원 참가격** | 전국 대형마트·SSM·백화점·편의점·전통시장의 생필품 가격, **할인 여부·할인 기간, 1+1 여부** (매주 금요일 조사) | 공공데이터포털 무료 인증키 |
| **카카오 로컬** | 주변 음식점·카페·편의점·마트·약국·올리브영·다이소·정육점 등 매장 정보, 주소 검색 | 카카오 REST API 키 (무료) |
| **OpenStreetMap** | 주변 매장(이름·업종·영업시간·전화번호) | 없음 |
| **사용자 제보** | 동네 가게의 마감할인·타임세일·오픈 이벤트 등을 사용자가 직접 등록, 👍/✅/🚫 투표로 검증 | 없음 |
| **브랜드 행사** | 편의점·프랜차이즈 공통 행사(1+1, 2+1 등)를 반경 안의 해당 브랜드 매장에 연결 | 운영자가 CSV 등록 |
| **착한가격업소** | 지자체 지정 착한가격업소의 대표 메뉴·가격 | 공공데이터포털 CSV 등록 |
| **네이버 블로그** | 매장 상세 화면에서 최근 할인·이벤트 후기 | 네이버 검색 API 키 (무료) |
| **샘플 데이터** | 키가 없어도 모든 기능을 체험할 수 있는 가상의 매장·행사 (`[샘플]` 표시) | 없음 |

## 주요 기능

- **위치**: GPS 현재 위치 / 주소·역 이름 검색 / 지도에서 직접 찍기, 최근 위치 기억
- **거리 설정**: 100m 단위로 **100m ~ 1km** 선택 (슬라이더 + 빠른 선택 버튼), 도보 예상 시간 표시
- **검색**: 상품·음식·가게 이름 검색 (예: 우유, 치킨, 커피), 최근 검색어
- **필터**: 업종 12종(음식점·카페·베이커리·편의점·마트·정육/수산/청과·패션·뷰티·약국·가전·생활·기타),
  행사 종류 11종(할인·1+1·2+1·타임세일·마감할인·해피아워·증정·쿠폰·묶음·오픈이벤트·착한가격),
  최소 할인율, "지금 진행 중만"
- **정렬**: 추천순 · 가까운순 · 할인율순 · 마감임박순 · 낮은가격순 · 최신순 · 인기순
- **행사 카드**: 할인율, 할인가/정가, 1+1·2+1은 개당 가격, 기간(D-day), 시간대·요일, 남은 시간, 거리·도보 시간
- **행사 상세**: 주변 매장 평균가 대비 가격(참가격), 같은 브랜드 행사 매장 목록, 매장 주소·전화·영업시간,
  카카오맵/네이버지도/구글지도 길찾기, 공유, 같은 매장의 다른 행사, 블로그 소식
- **지도**: 반경 원, 행사 매장 핀(업종 아이콘 + 최대 할인율), 행사 없는 매장 표시 옵션
- **가격 비교**: "우유"를 검색하면 주변 조사 매장의 같은 상품 가격을 싼 순서로 (참가격 키 필요)
- **행사 제보**: 주변 매장을 골라(또는 직접 입력) 할인 내용·가격·기간·시간대·요일 등록
- **찜**: 관심 행사 저장 (종료되면 표시)
- **다크 모드**, 모바일/PC 반응형, 홈 화면 설치(PWA manifest)

## 빠르게 실행하기

Node.js **22.12 이상**이 필요합니다.

```bash
git clone https://github.com/kts4u1/Sale-and-Discount.git
cd Sale-and-Discount
npm install

# (선택) API 키 설정 - 없어도 실행됩니다
cp .env.example .env

# 개발 모드: 서버(8787) + 화면(5173) 동시 실행
npm run dev
# → 브라우저에서 http://localhost:5173
```

배포(운영) 모드:

```bash
npm run build   # 화면을 client/dist 로 빌드
npm start       # 서버 하나로 화면 + API 제공 → http://localhost:8787
```

Docker:

```bash
docker build -t sale-radar .
docker run -p 8787:8787 --env-file .env -v sale-radar-data:/app/server/data sale-radar
```

> 📍 **휴대폰에서 GPS 위치를 쓰려면 https 주소가 필요합니다.** (브라우저 정책, `localhost`는 예외)
> 같은 와이파이의 휴대폰으로 테스트할 때는 주소 검색이나 "지도에서 직접 고르기"를 쓰거나,
> 배포 시 https(예: Nginx + Let's Encrypt, Cloudflare Tunnel 등)를 적용하세요.

## API 키 발급 방법

### 1. 한국소비자원 참가격 (가장 중요 — 실제 할인·1+1 데이터)

1. [공공데이터포털](https://www.data.go.kr) 회원가입
2. [한국소비자원_생필품 가격 정보](https://www.data.go.kr/data/15158701/openapi.do) 페이지에서 **활용신청** (보통 자동 승인)
3. 마이페이지 → 개발계정 → 인증키(Encoding 또는 Decoding) 복사
4. `.env`의 `DATA_GO_KR_SERVICE_KEY=` 에 붙여넣고 서버 재시작

- 조사일은 매주 금요일이며, 앱은 데이터가 올라온 가장 최근 조사일을 자동으로 찾습니다.
- 할인 상품은 지난주 같은 매장 가격을 정가로 보고 할인율을 계산하고, 주변 매장 평균가와 비교해 보여줍니다.
- 매장 좌표가 경위도가 아니면 주소로 좌표를 찾아 `server/data/cache/kca-geocode.json`에 저장합니다
  (카카오 키가 있으면 훨씬 빠릅니다).
- 개발계정은 하루 호출 수 제한이 있습니다. `KCA_MAX_STORES`(기본 25)로 한 번에 조회할 매장 수를 조절하세요.
  조회 결과는 12시간 캐시됩니다.

### 2. 카카오 로컬 (매장 정보·주소 검색 정확도 향상)

1. [카카오 개발자 센터](https://developers.kakao.com) → 내 애플리케이션 → 애플리케이션 추가
2. 앱 설정 → 앱 키 → **REST API 키** 복사, 제품 설정에서 **카카오맵** 사용 설정 ON
3. `.env`의 `KAKAO_REST_API_KEY=` 에 입력

### 3. 네이버 검색 (선택 — 매장 블로그 소식)

1. [네이버 개발자 센터](https://developers.naver.com/apps) → 애플리케이션 등록 → 사용 API: **검색**
2. Client ID / Secret 을 `.env`의 `NAVER_CLIENT_ID`, `NAVER_CLIENT_SECRET`에 입력

## 데이터 추가하기

### 착한가격업소 (지자체 CSV)

공공데이터포털에서 "착한가격업소"를 검색하면 시·군·구별 CSV가 있습니다. 지자체마다 열 이름이 달라도
(업소명/상호, 도로명주소/소재지, 위도/경도, 메뉴1·가격1 …) 자동으로 알아봅니다. 위도·경도가 없으면 주소로 좌표를 찾습니다.

```bash
npm run import -- goodprice ~/Downloads/가평군_착한가격업소.csv --region 가평군
# 같은 지역 데이터를 새로 바꿀 때: --replace
```

형식 예시: [`server/data/examples/goodprice.example.csv`](server/data/examples/goodprice.example.csv)

### 편의점·프랜차이즈 공통 행사

```bash
npm run import -- promotions 행사목록.csv          # 전체 교체
npm run import -- promotions 추가행사.csv --append # 기존에 추가
```

형식: [`server/data/examples/brand-promotions.example.csv`](server/data/examples/brand-promotions.example.csv)

```csv
brand,productName,type,price,originalPrice,unit,startDate,endDate,category,description
GS25,탄산음료,2+1,2200,,500ml,2026-11-01,2026-11-30,convenience,
```

- `type`: `1+1`, `2+1`, `할인`, `증정`, `묶음`, `쿠폰` (또는 `one_plus_one` 같은 영문 id)
- 반경 안에 해당 브랜드 매장(GS25, CU, 세븐일레븐, 이마트24 …)이 있을 때만 가장 가까운 매장에 표시되고,
  같은 브랜드의 다른 주변 매장도 함께 알려 줍니다.
- 서버를 끄지 않아도 파일이 바뀌면 자동으로 다시 읽습니다.

## 구조

```
├── shared/   공통 타입·상수·계산 (거리, 한국시간, 행사 진행 상태, 할인율)
├── server/   Express API 서버 (TypeScript, tsx 로 실행)
│   ├── src/sources/   데이터 출처별 연동 (kca, kakao, osm, nominatim, naver, brand, goodprice, sample)
│   ├── src/services/  검색(합치기·필터·정렬·통계), 매장 중복 합치기
│   ├── src/store/     사용자 제보·투표 저장 (JSON 파일)
│   ├── scripts/       CSV 불러오기 도구
│   ├── data/          제보·캐시·불러온 데이터 저장 위치
│   └── test/          테스트
└── client/   React + Vite + Leaflet 화면
```

### API

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/api/deals?lat&lng&radius&q&categories&types&sort&active&minDiscount&sample` | 주변 행사 검색 (radius 100~1000) |
| POST | `/api/deals` | 행사 제보 |
| POST | `/api/deals/:id/vote` | `{"action":"like"\|"confirm"\|"expired"}` |
| GET | `/api/stores?lat&lng&radius&q` | 주변 매장 목록 |
| GET | `/api/prices?lat&lng&radius&q` | 참가격 가격 비교 |
| GET | `/api/geocode?q` / `/api/reverse?lat&lng` | 주소 ↔ 좌표 |
| GET | `/api/news?q` | 네이버 블로그 소식 |
| GET | `/api/config` | 반경 옵션, 켜진 데이터 출처 |

### 동작 방식 메모

- 느린 외부 서버 때문에 화면이 멈추지 않도록 출처마다 기다리는 시간을 정해 두고, 늦으면 먼저 결과를 보여준 뒤
  뒤에서 계속 받아 캐시에 쌓습니다. 화면은 몇 초 뒤 자동으로 다시 검색합니다.
- OpenStreetMap 매장은 지도를 약 1km 격자로 나눠 칸마다 받아 3일간 디스크에 캐시합니다.
- 여러 출처의 같은 매장(60m 이내 + 이름 일치)은 하나로 합칩니다.
- 사용자 제보는 `server/data/community.json`에 저장됩니다. 종료 신고가 3건 이상이고 "아직 하고 있어요"보다 많으면 숨깁니다.
- 시간 계산은 모두 한국 시간(KST) 기준이며, 자정을 넘기는 시간대(예: 22:00~02:00)와 요일 제한을 처리합니다.

## 개발

```bash
npm test           # 테스트 (vitest)
npm run typecheck  # 타입 검사
npm run format     # 코드 정리 (prettier)
npm run check      # 타입 검사 + 테스트 + 빌드
```

## 앞으로 붙이면 좋은 것

- 관심 키워드·매장 **푸시 알림** (예: "반경 300m 안에 치킨 할인 시작")
- 사용자 로그인과 제보 신뢰도(제보자 등급), 사진 첨부
- 편의점 행사 목록 자동 갱신 (각 사 제휴/공식 데이터 확보 시)
- 지역화폐·카드사 할인 정보 연동
- 앱스토어 배포용 래핑 (Capacitor 등)

## 데이터 출처 표기

- 한국소비자원 참가격 가격정보 (공공누리 제1유형: 출처표시)
- © OpenStreetMap contributors (ODbL)
- 카카오 로컬 API, 네이버 검색 API
