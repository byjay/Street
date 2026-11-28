# RoadWindow 360 (`byjay/Street`) Earth+Street View 심리스 결합 실제 여행 앱 통합 구현 지시서 (전 40장)

본 문서는 [byjay/Street](https://github.com/byjay/Street)를 기반으로 **3D 지구본(Earth View)과 360° 거리뷰(Street View)를 하나로 심리스(Seamless)하게 결합**해, **항공기 비행(부산→서울) → 차량 이동 → 도보 산책**까지 실제 여행처럼 끊김 없이 이어지는 웹앱을 구현하기 위한 40장 분량의 상세 기술 지시서입니다. 유료 Google Maps API는 선택 옵션으로 두고, **무료 API(`free-kr` 카카오맵·브이월드 / `free-global` MapLibre·Mapillary·OSRM·Nominatim·CesiumJS)**를 기본 공급자로 동작하도록 설계했습니다.

## Part 1. 프로젝트 개요 및 기존 저장소 분석

### 제1장. 프로젝트 목표 및 전체 아키텍처 개요

본 프로젝트의 핵심 목표는 세 가지입니다. 첫째, 기존 `byjay/Street`가 Google Maps API에만 종속되어 있던 구조를 **공급자 옵션 스위처(`free-kr` 무료-국내 / `free-global` 무료-글로벌 / `google` 선택 옵션)**로 재설계해 카드 등록이나 과금 없이 기본 무료 API만으로 바로 실행할 수 있게 합니다. 둘째, 사용자의 이동 경험을 **① 도보 거리뷰(걸어가기)**, **② 차량 주행(차 타기)**, **③ 항공기 비행(부산→서울 3D 항공뷰)**의 3대 모드로 명확히 분리·통합합니다. 셋째, 각 이동 모드에 맞는 경로 엔진(보행/자동차/항공 궤적), 카메라 모션, HUD 계기판, Web Audio 사운드를 일관된 어댑터 인터페이스로 묶습니다.

| 계층 | 주요 구성 요소 | 담당 역할 |
| --- | --- | --- |
| 이동 모드 뷰어 계층 | `StreetViewViewer`(도보·차량 360°), `AerialMapViewer`(2D/3D 지도), `FlightViewer`(3D 항공뷰) | 걸어가기·차 타기·비행기 3대 모드 렌더링 및 공급자 옵션 어댑터 호출 |
| 시뮬레이션 엔진 계층 | `routeSimulation.ts`(도보·차량), `streetViewMotion.ts`, `flightSimulation.ts`(항공), `driveAudio.ts` | 보행/주행/비행 속도·보간, 고도·자세(Heading/Pitch/Roll), 3종 사운드 합성 |
| 백엔드 프록시 계층 | `server.ts` (`/api/config`, `/api/geocode/regions`, `/api/routes`, `/api/places/search`, `/api/grounding/guide`) | 무료·유료 공급자별 API 키 은닉, 도보/차량 경로 분기, 응답 정규화 |


**핵심 사용자 경험 — Earth + Street View 심리스 결합 실제 여행 시퀀스**

| 여행 단계 | 뷰어 전환 | 실제 여행 연출 |
| --- | --- | --- |
| 1. 출발지 조망 (Earth) | 3D 지구본 (CesiumJS / Google Map3D) | 부산 상공에서 도시 전체를 내려다보며 여정 시작 |
| 2. 항공 이동 (`flight`) | 3D 항공 비행 뷰 (이륙→순항→착륙) | 김해공항 이륙 → 한반도 3D 산맥·강 상공 순항 → 김포공항 착륙 |
| 3. Earth→Street 다이브 | 고도 40m 이하 진입 시 400ms 크로스페이드 | 공항·도심 상공에서 지상 도로로 급강하(`flyTo`)하며 거리뷰로 자연 전환 |
| 4. 차량 이동 (`drive`) | 360° 거리뷰 + 미니맵 (카카오 로드뷰 / Mapillary) | 공항에서 서울 도심 목적지까지 차창 밖 360° 풍경 주행 |
| 5. 도보 산책 (`walk`) | 눈높이 360° 거리뷰 + 발걸음·환경음 | 하차 후 골목·명소를 걸어 다니며 AI 현지 가이드 브리핑 청취 |
| 6. 하늘로 복귀 (Ascend) | 거리뷰 → 3D 지구본 수직 상승 | 언제든 버튼 하나로 현재 위치에서 하늘로 솟아올라 지구본 탐색 |

### 제2장. 기존 `byjay/Street` 저장소 파일 구조 정밀 분석

[byjay/Street](https://github.com/byjay/Street) 저장소(커밋 `9367d18` 기준)는 React + TypeScript + Vite 프론트엔드와 Express 백엔드가 결합된 풀스택 프로젝트입니다. 무료 API 전환 시 수정 대상과 유지 대상을 명확히 구분해야 작업 범위를 최소화할 수 있습니다.

| 파일 경로 | 기존 역할 | 무료 전환 시 처리 방침 |
| --- | --- | --- |
| `.env.example` | `GEMINI_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY` 정의 | 무료 API 키 스키마로 확장 |
| `server.ts` | `/api/config`, `/api/geocode/regions`, `/api/grounding/guide`, Vite 미들웨어 | 지오코딩 교체 및 경로·장소 프록시 엔드포인트 추가 |
| `src/components/AerialMapViewer.tsx` | `@vis.gl/react-google-maps` 기반 3D/2D 지도 렌더링 | 카카오맵 / MapLibre 어댑터로 교체 |
| `src/components/StreetViewViewer.tsx` | Google Street View 파노라마 주행 뷰어 | 카카오맵 로드뷰 / MapillaryJS로 교체 |
| `src/utils/mapsHelpers.ts` | `Place.searchByText`, `Route.computeRoutes`, 쿼터 에러 감지 | 백엔드 프록시 호출(`fetch`) 기반으로 전면 교체 |
| `src/engine/routeSimulation.ts` | 하버사인 거리 계산, 누적 거리, 경로 보간 | **재사용** (Google 종속성 없음) |
| `src/engine/streetViewMotion.ts` | 주행 모션 보간 및 카메라 스무딩 | **재사용** (어댑터 인터페이스만 맞춤) |
| `src/audio/driveAudio.ts` | 차량 주행 오디오 합성 | 항공기 엔진음 프로파일 추가 확장 |
| `src/components/DriveHud.tsx` | 속도·거리·진행률 HUD | 유지 + 항공 전용 `FlightHud.tsx` 신설 |
| `src/components/GroundGuideDrawer.tsx` | AI 주변 명소 브리핑 서랍 UI | 항공 상공 랜드마크 브리핑 모드 추가 |

### 제3장. 기존 Google Maps Platform API 호출 지점 및 비용 구조 분석

기존 코드가 호출하는 Google API는 총 4종이며, 2025년 3월 1일부로 개편된 [Google Maps Platform 가격 정책](https://developers.google.com/maps/billing-and-pricing/overview)에 따라 기존 월 200달러 통합 크레딧 대신 **SKU별 월간 무료 호출 한도**가 개별 적용됩니다.

| 호출 API | 코드 내 호출 위치 | 무료 한도(월간) | 무료 전환이 필요한 이유 |
| --- | --- | --- | --- |
| Maps JavaScript API (2D/3D) | `AerialMapViewer.tsx` (`GoogleMap`, `Map3D`) | Essentials 10,000건 | 결제 계정 등록 필수, 3D 타일/동적 지도 초과 시 과금 |
| Street View (Maps JS) | `StreetViewViewer.tsx` | Pro 5,000건 | 연속 주행 시 파노라마 전환 호출이 빠르게 누적됨 |
| Places API (New) | `mapsHelpers.ts` (`Place.searchByText`) | Pro 5,000건 | 텍스트 검색 단가가 높음 |
| Routes API | `mapsHelpers.ts` (`Route.computeRoutes`) | Essentials 10,000건 (기본) | 한국 내 `DRIVING` 제한으로 `TRANSIT` 폴백까지 이중 호출 발생 |
| Geocoding API | `server.ts` (`/api/geocode/regions`) | Essentials 10,000건 | 리퍼러 제한 키 사용 시 서버 `fetch`에서 `REQUEST_DENIED` 발생 |

특히 `mapsHelpers.ts`에는 한국 지역에서 Google `DRIVING` 경로가 제한되는 문제를 우회하기 위해 `TRANSIT`(버스 우선)으로 재요청하는 폴백 로직이 들어 있습니다. 무료 API(카카오모빌리티·OSRM)로 전환하면 한국 도로 자동차 경로도 정상적으로 계산됩니다.

### 제4장. API 공급자 옵션 전략 비교 (무료 기본 2종 + Google 선택 옵션)

Google Maps API를 완전히 삭제하는 대신 **무료 API 2종을 기본 옵션**으로 제공하고, 사용자가 본인 키를 보유한 경우에만 설정에서 `google` 옵션을 켤 수 있는 3트랙 어댑터 구조를 채택합니다.

| 평가 항목 | 옵션 1: `free-kr` (국내 무료 기본) | 옵션 2: `free-global` (글로벌 무료 기본) | 옵션 3: `google` (선택 옵션) |
| --- | --- | --- | --- |
| 결제 카드 등록 | 불필요 | 불필요 | 필수 (월간 SKU 무료 한도 초과 시 과금) |
| 도보 거리뷰(걸어가기) | 카카오맵 로드뷰 + OSRM `foot` 경로 | MapillaryJS + OSRM `foot` 경로 | Google Street View + Routes |
| 차량 주행(차 타기) | 카카오맵 로드뷰 + 카카오모빌리티/OSRM `car` | MapillaryJS + MapLibre + OSRM `car` | Google Street View + Routes |
| 항공기 비행(부산→서울) | CesiumJS + 브이월드 고해상도 위성 WMTS | CesiumJS + Cesium ion 무료 / MapLibre 3D | Google Map3D (Photorealistic 3D) |
| 무료 호출량 | 카카오 지도 일 300,000건, REST 일 100,000건 | 자체 OSRM/MapLibre 무제한, Mapillary 무료 | Essentials 10,000 / Pro 5,000 (월) |

**권장 기본값**: 앱 최초 실행 시 `DEFAULT_MAP_PROVIDER="free-kr"`로 동작해 국내 도보·차량 거리뷰와 부산→서울 3D 항공뷰가 과금 없이 즉시 열리며, 상단 설정 메뉴에서 원클릭으로 `free-global` 또는 `google` 옵션으로 전환할 수 있습니다.

### 제5장. 통합 개발 환경 및 패키지 의존성 구성

무료 API만 사용할 경우 `@vis.gl/react-google-maps`를 제거해 번들을 줄일 수 있고, Google API를 선택 옵션으로 남겨둘 경우 동적 임포트(`React.lazy`)로 분리해 무료 모드에서는 Google SDK가 전혀 로드되지 않게 구성합니다.

```bash
# 무료 지도·거리뷰·3D 항공 지구본 엔진 설치
npm install maplibre-gl mapillary-js cesium
npm install -D vite-plugin-cesium

# (선택) Google 옵션을 아예 쓰지 않을 경우에만 제거
# npm uninstall @vis.gl/react-google-maps
```

`vite.config.ts`에 `vite-plugin-cesium`을 등록하면 CesiumJS의 Web Worker, 셰이더, 정적 에셋이 개발 서버와 프로덕션 빌드(`dist/`)에 자동으로 복사됩니다.

```ts
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import cesium from 'vite-plugin-cesium';

export default defineConfig({
  plugins: [react(), cesium()],
  server: {
    port: 3000,
  },
});
```

## Part 2. 무료 API 키 발급 및 환경 변수 설정 실무

### 제6장. 카카오디벨로퍼스 앱 생성 및 JavaScript/REST API 키 발급

국내 2D 지도, 360° 로드뷰, 장소·주소 검색을 무료로 쓰기 위해 [카카오디벨로퍼스](https://developers.kakao.com/)에서 앱 키를 발급받습니다.

1. [카카오디벨로퍼스](https://developers.kakao.com/)에 카카오 계정으로 로그인한 뒤 상단 **앱** 메뉴에서 새 앱을 생성합니다([앱 설정 공식 문서](https://developers.kakao.com/docs/ko/app-setting/app)).
2. 생성한 앱의 좌측 메뉴에서 **제품 설정 > 카카오맵**으로 이동해 사용 상태를 **활성화(ON)**로 변경합니다([카카오맵 이해하기](https://developers.kakao.com/docs/ko/kakaomap/common)).
3. **앱 설정 > 플랫폼 > Web**에서 사이트 도메인을 등록합니다. 로컬 개발 시 `http://localhost:3000`과 `http://127.0.0.1:3000`을 모두 추가하고, 배포 도메인이 생기면 해당 HTTPS 주소도 등록합니다.
4. **앱 설정 > 앱 키**에서 아래 두 키를 각각 복사합니다.
   - **JavaScript 키**: 브라우저에서 `kakao.maps` SDK(지도·로드뷰)를 불러올 때 사용합니다.
   - **REST API 키**: `server.ts`에서 주소·좌표 변환 및 장소 검색 REST API를 호출할 때 `Authorization: KakaoAK {REST_API_KEY}` 헤더로 사용합니다.
5. **주의사항**: JavaScript 지도 SDK에 REST API 키를 넣으면 인증 오류가 발생합니다. 무료 할당량은 [카카오디벨로퍼스 쿼터 문서](https://developers.kakao.com/docs/ko/getting-started/quota) 기준 개발자 계정당 첫 번째 활성화 앱에 지도 Web SDK 일 300,000건, 주소·좌표 변환 REST API 일 100,000건이 제공됩니다.

### 제7장. 카카오모빌리티 자동차 길찾기 API 연동 및 키 설정

카카오맵 Web SDK 자체에는 자동차 길찾기 경로 좌표 계산 기능이 포함되어 있지 않으므로, 국내 도로 경로 좌표를 얻으려면 [카카오모빌리티 디벨로퍼스](https://developers.kakaomobility.com/)의 길찾기 API를 함께 사용합니다.

1. [길찾기 API 시작하기 문서](https://developers.kakaomobility.com/guide/navi-api/start.html) 안내에 따라 카카오디벨로퍼스에 생성한 앱과 연동합니다.
2. 요청 도메인은 반드시 공식 도메인 `https://apis-navi.kakaomobility.com/`을 사용하며, 인증 헤더는 카카오 REST API 키(`Authorization: KakaoAK {REST_API_KEY}`)를 사용합니다.
3. 자동차 길찾기 상세 스펙은 [자동차 길찾기 API 가이드](https://developers.kakaomobility.com/guide/navi-api/directions.html)를 참고해 출발지(`origin=경도,위도`), 목적지(`destination=경도,위도`)를 전달하고 응답의 `routes[0].sections[].roads[].vertexes` 배열에서 `[lng, lat, lng, lat, ...]` 좌표를 추출합니다.
4. 만약 카카오모빌리티 API 승인이 지연되거나 무료 한도를 아끼고 싶다면, 제11장의 **OSRM**을 국내 자동차 경로 탐색 엔진으로 바로 대체할 수 있습니다.

### 제8장. Mapillary 개발자 대시보드 등록 및 Client Token 발급

전 세계 무료 거리뷰를 제공하기 위해 Meta가 운영하는 [Mapillary](https://www.mapillary.com/osm)의 API 토큰을 발급받습니다.

1. [Mapillary 개발자 대시보드](https://www.mapillary.com/dashboard/developers)에 접속해 계정을 생성하고 로그인합니다.
2. **Register application** 버튼을 클릭해 애플리케이션 등록 양식을 채웁니다.
   - **Application Name**: `RoadWindow360` (자유 입력)
   - **Callback URL**: 로컬 테스트용으로 `http://localhost:3000` 입력 (필수 항목)
   - **Permissions**: **READ** 체크 (이미지 및 메타데이터 조회 전용)
3. 등록 완료 후 앱 목록에서 **View** 버튼을 클릭하면 `MLY|`로 시작하는 **Client Token**이 표시됩니다.
4. 이 토큰은 복잡한 OAuth 흐름 없이 `MapillaryJS` 초기화(`accessToken`) 및 Graph API(`https://graph.mapillary.com/...`) 호출에 즉시 사용할 수 있습니다([Mapillary API 공식 문서](https://www.mapillary.com/developer/api-documentation)).
5. **라이선스 유의**: Mapillary 이미지는 CC BY-SA 4.0 오픈 라이선스로 제공되므로 화면 하단에 `Imagery © Mapillary` 출처 표기를 유지해야 합니다.

### 제9장. Cesium ion 무료 Community 계정 생성 및 Access Token 발급

부산→서울 3D 항공 비행 뷰에서 산맥·해안선 기복(World Terrain)과 위성영상·3D 건물을 띄우기 위해 [Cesium ion](https://cesium.com/platform/cesium-ion/) 토큰을 발급받습니다.

1. [Cesium ion 요금제 페이지](https://cesium.com/platform/cesium-ion/pricing/)에서 개인·비상업 프로젝트용 **Community(Free)** 플랜으로 가입합니다.
2. 로그인 후 상단 메뉴의 **Access Tokens**로 이동합니다([Cesium ion Access Tokens 가이드](https://cesium.com/learn/ion/cesium-ion-access-tokens/)).
3. 기본 생성된 `Default Token`을 복사하거나, 필요 시 **Create token**으로 도메인 제한을 건 전용 토큰을 생성합니다.
4. 상업적 서비스로 확장할 경우에는 Cesium ion 유료 플랜 대신 Apache 2.0 무료 엔진인 [CesiumJS](https://cesium.com/platform/cesiumjs/)만 단독 사용하고, 타일은 제10장의 브이월드 WMTS 및 오픈소스 DEM으로 교체하면 라이선스 비용이 0원이 됩니다.

### 제10장. 브이월드(VWorld) 오픈API 인증키 발급 및 WMTS 설정

한국(부산~서울) 상공을 비행할 때 해외 위성영상보다 훨씬 선명한 국토교통부 고해상도 항공사진을 무료로 쓰기 위해 브이월드 인증키를 발급받습니다.

1. [브이월드 공간정보 오픈플랫폼](https://www.vworld.kr/v4po_main.do)에 회원가입 및 로그인합니다.
2. 상단 메뉴 **오픈API > 인증키 발급**을 클릭하고 이용약관에 동의합니다.
3. 서비스명, 사용 목적, 서비스 URL(`http://localhost:3000` 등)을 입력하고 활용 API에서 **배경지도(WMTS)** 및 **3D 지도** 항목을 체크해 신청합니다.
4. 가입한 이메일로 발송되는 승인 메일에서 인증키 사용을 확정하면 즉시 활성화됩니다.
5. 발급된 인증키를 아래 WMTS 타일 URL 템플릿에 넣어 CesiumJS나 MapLibre의 위성 레이어로 연결합니다.

```text
# 위성(항공) 영상 타일
https://api.vworld.kr/req/wmts/1.0.0/{VWORLD_API_KEY}/Satellite/{z}/{y}/{x}.jpeg

# 하이브리드(도로명·지명 라벨 투명 오버레이)
https://api.vworld.kr/req/wmts/1.0.0/{VWORLD_API_KEY}/Hybrid/{z}/{y}/{x}.png
```

### 제11장. API 키 불필요 오픈소스 엔진 (MapLibre GL JS, OSRM, Nominatim) 준비

아래 세 가지 핵심 구성 요소는 별도의 API 키 발급 없이 즉시 사용할 수 있습니다.

- **MapLibre GL JS**: WebGL 기반 오픈소스 벡터·3D 지형 지도 라이브러리입니다([GitHub 저장소](https://github.com/maplibre/maplibre-gl-js), [공식 문서](https://maplibre.org/maplibre-gl-js/docs/)).
- **OSRM (Open Source Routing Machine)**: OpenStreetMap 도로망으로 초고속 자동차·자전거·도보 경로를 계산합니다([osrm-backend GitHub](https://github.com/project-osrm/osrm-backend), [HTTP API 명세](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md)). 프로덕션에서는 공용 데모 서버 대신 Docker로 한국 도로 데이터(`south-korea-latest.osm.pbf`)를 직접 띄우는 것을 권장합니다.

```bash
# 한국 도로 데이터 전처리 및 로컬 OSRM 라우팅 서버 실행 (포트 5000)
docker run -t -v "${PWD}/osrm-data:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-extract -p /opt/car.lua /data/south-korea-latest.osm.pbf
# 도보 거리뷰(걸어가기) 전용 라우팅 서버를 함께 띄울 때는 /opt/foot.lua 프로파일 사용 (예: 포트 5001)
# docker run -t -v "${PWD}/osrm-foot:/data" ghcr.io/project-osrm/osrm-backend osrm-extract -p /opt/foot.lua /data/south-korea-latest.osm.pbf
docker run -t -v "${PWD}/osrm-data:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-partition /data/south-korea-latest.osrm
docker run -t -v "${PWD}/osrm-data:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-customize /data/south-korea-latest.osrm
docker run -d -p 5000:5000 -v "${PWD}/osrm-data:/data" ghcr.io/project-osrm/osrm-backend \
  osrm-routed --algorithm mld /data/south-korea-latest.osrm
```

- **Nominatim**: OpenStreetMap 기반 장소 검색(`/search`) 및 좌표→주소 역지오코딩(`/reverse`) 엔진입니다([API 개요](https://nominatim.org/release-docs/latest/api/Overview/), [Search 명세](https://nominatim.org/release-docs/latest/api/Search/), [Reverse 명세](https://nominatim.org/release-docs/latest/api/Reverse/)). 공용 서버(`nominatim.openstreetmap.org`) 사용 시 반드시 고유한 `User-Agent` 헤더를 포함하고 초당 1회 이하 요청 정책을 준수해야 합니다.

### 제12장. 통합 `.env` 환경 변수 스키마 및 보안 분리 원칙

기존 `.env.example`을 아래 스키마로 확장합니다. 기본 공급자는 무료(`free-kr` 또는 `free-global`)로 두고, `GOOGLE_MAPS_API_KEY`는 사용자가 원할 때만 채워 넣는 **선택 옵션**으로 분리합니다.

```env
# === 서버 실행 설정 ===
PORT=3000
NODE_ENV=development

# === 기본 API 공급자 옵션: 'free-kr' (국내 무료) | 'free-global' (글로벌 무료) | 'google' (선택 옵션) ===
DEFAULT_MAP_PROVIDER="free-kr"

# === [무료 API - 프론트엔드 전달 가능 공개 키 (도메인 제한 필수)] ===
KAKAO_JS_KEY="여기에_카카오_JavaScript_키"
MAPILLARY_CLIENT_TOKEN="MLY|여기에_Mapillary_클라이언트_토큰"
CESIUM_ION_TOKEN="여기에_Cesium_ion_Access_토큰"
VWORLD_API_KEY="여기에_브이월드_인증키"

# === [무료 API - 서버 전용 (절대 프론트엔드 노출 금지)] ===
KAKAO_REST_API_KEY="여기에_카카오_REST_API_키"
OSRM_CAR_BASE_URL="https://router.project-osrm.org"
OSRM_FOOT_BASE_URL="https://routing.openstreetmap.de/routed-foot"
NOMINATIM_BASE_URL="https://nominatim.openstreetmap.org"
NOMINATIM_USER_AGENT="RoadWindow360/1.0 (contact@example.com)"

# === [선택 옵션] Google Maps API를 옵션으로 함께 쓰고 싶을 때만 입력 ===
VITE_GOOGLE_MAPS_API_KEY=""

# === [선택] AI 주변·상공 브리핑용 Gemini API 키 ===
GEMINI_API_KEY=""
```

## Part 3. 백엔드 서버(`server.ts`) 무료 API 전환 지시서

### 제13장. `/api/config` 엔드포인트 리팩토링

`/api/config`는 현재 설정된 무료·유료 키를 점검해 **실제로 사용 가능한 공급자 옵션 목록(`availableProviders`)**과 기본 공급자를 프론트엔드에 내려줍니다. UI 설정창은 이 목록을 보고 무료(국내/글로벌) 및 Google 옵션을 활성화합니다. 서버 전용 키(`KAKAO_REST_API_KEY`, `GEMINI_API_KEY`)는 절대 응답에 포함하지 않습니다.

```ts
app.get('/api/config', (_req: Request, res: Response) => {
  const kakaoJsKey = process.env.KAKAO_JS_KEY || '';
  const mapillaryToken = process.env.MAPILLARY_CLIENT_TOKEN || '';
  const googleMapsKey = process.env.VITE_GOOGLE_MAPS_API_KEY || '';

  const availableProviders: Array<'free-kr' | 'free-global' | 'google'> = [];
  if (kakaoJsKey) availableProviders.push('free-kr');
  availableProviders.push('free-global'); // MapLibre + OSRM + Nominatim은 키 없이도 동작
  if (googleMapsKey && googleMapsKey !== 'MY_GOOGLE_MAPS_API_KEY') {
    availableProviders.push('google');
  }

  res.json({
    defaultProvider: (process.env.DEFAULT_MAP_PROVIDER || 'free-kr') as 'free-kr' | 'free-global' | 'google',
    availableProviders,
    kakaoJsKey,
    mapillaryToken,
    cesiumIonToken: process.env.CESIUM_ION_TOKEN || '',
    vworldApiKey: process.env.VWORLD_API_KEY || '',
    googleMapsKey: googleMapsKey !== 'MY_GOOGLE_MAPS_API_KEY' ? googleMapsKey : '',
    hasGeminiGuide: Boolean(
      process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'
    ),
  });
});
```

### 제14장. 역지오코딩(`/api/geocode/regions`) 무료 전환 (카카오 REST & Nominatim)

기존 `server.ts`의 `/api/geocode/regions`는 최대 5개 경유 좌표를 받아 Google Geocoding REST API를 호출했습니다. 이를 `MAP_PROVIDER`에 따라 **카카오 좌표→행정구역 변환 API** 또는 **Nominatim `/reverse`**로 교체합니다.

```ts
app.post('/api/geocode/regions', async (req: Request, res: Response) => {
  const provider = process.env.MAP_PROVIDER || 'kakao';
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY || '';
  const body = (req.body ?? {}) as { points?: Array<{ lat?: number; lng?: number }> };
  const validPoints = (Array.isArray(body.points) ? body.points.slice(0, 5) : []).filter(
    (p): p is { lat: number; lng: number } =>
      typeof p?.lat === 'number' && Number.isFinite(p.lat) &&
      typeof p?.lng === 'number' && Number.isFinite(p.lng)
  );

  if (validPoints.length === 0) {
    res.json({ regions: [], fallbackRequired: false });
    return;
  }

  const regions: string[] = [];
  const seen = new Set<string>();
  let fallbackRequired = false;

  try {
    if (provider === 'kakao' && kakaoRestKey) {
      const results = await Promise.all(
        validPoints.map(async (pt) => {
          const url = new URL('https://dapi.kakao.com/v2/local/geo/coord2regioncode.json');
          url.searchParams.set('x', String(pt.lng));
          url.searchParams.set('y', String(pt.lat));
          const r = await fetch(url.toString(), {
            headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
          });
          if (!r.ok) return null;
          return (await r.json()) as {
            documents?: Array<{ region_2depth_name?: string; region_3depth_name?: string }>;
          };
        })
      );
      for (const data of results) {
        const doc = data?.documents?.[0];
        const label = [doc?.region_2depth_name, doc?.region_3depth_name].filter(Boolean).join(' ');
        if (label && !seen.has(label)) {
          seen.add(label);
          regions.push(label);
        }
      }
    } else {
      // Nominatim은 초당 1회 제한 정책 준수를 위해 순차 호출
      const baseUrl = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
      const ua = process.env.NOMINATIM_USER_AGENT || 'RoadWindow360/1.0';
      for (const pt of validPoints) {
        const url = new URL(`${baseUrl}/reverse`);
        url.searchParams.set('lat', String(pt.lat));
        url.searchParams.set('lon', String(pt.lng));
        url.searchParams.set('format', 'jsonv2');
        url.searchParams.set('accept-language', 'ko');
        const r = await fetch(url.toString(), { headers: { 'User-Agent': ua } });
        if (!r.ok) continue;
        const data = (await r.json()) as {
          address?: { borough?: string; city?: string; suburb?: string; town?: string; county?: string };
        };
        const addr = data.address;
        const label = [addr?.city || addr?.county, addr?.borough || addr?.suburb || addr?.town]
          .filter(Boolean)
          .join(' ');
        if (label && !seen.has(label)) {
          seen.add(label);
          regions.push(label);
        }
        await new Promise((resolve) => setTimeout(resolve, 1100));
      }
    }
  } catch {
    fallbackRequired = true;
  }

  res.json({ regions, fallbackRequired });
});
```

### 제15장. 도보·차량 통합 경로 탐색 프록시(`/api/routes`) 구축 (카카오모빌리티 & OSRM)

거리뷰 **도보(걸어가기)** 모드와 **차량(차 타기)** 모드는 도로망이 다릅니다(차량은 일방통행·고속도로 포함, 도보는 골목·산책로·횡단보도 포함). `server.ts`의 `/api/routes` 엔드포인트에서 `mode: 'walk' | 'drive'`를 받아 보행 경로는 OSRM `foot` 프로파일로, 차량 경로는 카카오모빌리티(국내 무료) 또는 OSRM `driving` 프로파일로 자동 분기합니다.

```ts
app.post('/api/routes', async (req: Request, res: Response) => {
  const { origin, destination, mode = 'drive', provider } = (req.body ?? {}) as {
    origin?: { lat: number; lng: number };
    destination?: { lat: number; lng: number };
    mode?: 'walk' | 'drive';
    provider?: 'free-kr' | 'free-global' | 'google';
  };
  if (!origin || !destination) {
    res.status(400).json({ error: '출발지와 목적지 좌표가 필요합니다.' });
    return;
  }

  const activeProvider = provider || process.env.DEFAULT_MAP_PROVIDER || 'free-kr';
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY || '';

  try {
    // 1. 국내 무료 차량 모드: 카카오모빌리티 길찾기 우선
    if (mode === 'drive' && activeProvider === 'free-kr' && kakaoRestKey) {
      const url = new URL('https://apis-navi.kakaomobility.com/v1/directions');
      url.searchParams.set('origin', `${origin.lng},${origin.lat}`);
      url.searchParams.set('destination', `${destination.lng},${destination.lat}`);
      url.searchParams.set('priority', 'RECOMMEND');
      const r = await fetch(url.toString(), {
        headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
      });
      if (r.ok) {
        const json = (await r.json()) as {
          routes?: Array<{
            summary?: { distance?: number; duration?: number };
            sections?: Array<{
              roads?: Array<{ name?: string; distance?: number; duration?: number; vertexes?: number[] }>;
            }>;
          }>;
        };
        const route = json.routes?.[0];
        if (route?.sections?.length) {
          const path: Array<{ lat: number; lng: number }> = [];
          const steps: Array<{ instructions: string; distanceMeters: number; durationSeconds: number }> = [];
          for (const sec of route.sections) {
            for (const road of sec.roads ?? []) {
              const v = road.vertexes ?? [];
              for (let i = 0; i < v.length - 1; i += 2) {
                path.push({ lng: v[i], lat: v[i + 1] });
              }
              if (road.name) {
                steps.push({
                  instructions: `${road.name} 방면 주행`,
                  distanceMeters: road.distance ?? 0,
                  durationSeconds: road.duration ?? 0,
                });
              }
            }
          }
          res.json({
            mode,
            path,
            distanceMeters: route.summary?.distance ?? 0,
            durationSeconds: route.summary?.duration ?? 60,
            steps,
            source: 'kakao-mobility',
          });
          return;
        }
      }
    }

    // 2. 도보 모드(foot) 및 글로벌 차량 모드(driving): OSRM HTTP API
    const osrmProfile = mode === 'walk' ? 'foot' : 'driving';
    const osrmBase =
      mode === 'walk'
        ? process.env.OSRM_FOOT_BASE_URL || 'https://routing.openstreetmap.de/routed-foot'
        : process.env.OSRM_CAR_BASE_URL || 'https://router.project-osrm.org';
    const osrmUrl = `${osrmBase}/route/v1/${osrmProfile}/${origin.lng},${origin.lat};${destination.lng},${destination.lat}?overview=full&geometries=geojson&steps=true`;
    const r = await fetch(osrmUrl);
    if (!r.ok) throw new Error('OSRM 경로 조회 실패');
    const osrm = (await r.json()) as {
      routes?: Array<{
        distance: number;
        duration: number;
        geometry: { coordinates: Array<[number, number]> };
        legs: Array<{ steps: Array<{ name?: string; distance: number; duration: number }> }>;
      }>;
    };
    const first = osrm.routes?.[0];
    if (!first) throw new Error('경로를 찾을 수 없습니다.');

    const path = first.geometry.coordinates.map(([lng, lat]) => ({ lat, lng }));
    const steps = (first.legs?.[0]?.steps ?? []).map((s) => ({
      instructions: s.name
        ? `${s.name} 따라 ${mode === 'walk' ? '도보 이동' : '주행'}`
        : mode === 'walk'
          ? '보행로를 따라 직진'
          : '도로를 따라 직진',
      distanceMeters: Math.round(s.distance),
      durationSeconds: Math.round(s.duration),
    }));

    res.json({
      mode,
      path,
      distanceMeters: Math.round(first.distance),
      durationSeconds: Math.max(60, Math.round(first.duration)),
      steps,
      source: `osrm-${osrmProfile}`,
    });
  } catch (err) {
    res.status(502).json({ error: err instanceof Error ? err.message : '경로 탐색 실패' });
  }
});
```

### 제16장. 장소 검색 프록시(`/api/places/search`) 구축 (카카오 로컬 & Nominatim)

기존 `Place.searchByText`를 대체합니다. 한국어 키워드 검색 정확도가 필요한 국내는 카카오 로컬 키워드 검색(`keyword.json`)을 우선 호출하고, 글로벌 모드나 키 미설정 시 Nominatim `/search`로 폴백합니다.

```ts
app.get('/api/places/search', async (req: Request, res: Response) => {
  const query = String(req.query.q || '').trim();
  if (!query) {
    res.json({ places: [] });
    return;
  }

  const provider = process.env.MAP_PROVIDER || 'kakao';
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY || '';

  try {
    if (provider === 'kakao' && kakaoRestKey) {
      const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
      url.searchParams.set('query', query);
      url.searchParams.set('size', '5');
      const r = await fetch(url.toString(), {
        headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
      });
      if (r.ok) {
        const data = (await r.json()) as {
          documents?: Array<{
            id: string;
            place_name: string;
            road_address_name?: string;
            address_name?: string;
            x: string;
            y: string;
          }>;
        };
        const places = (data.documents ?? []).map((d) => ({
          placeId: d.id,
          name: d.place_name,
          address: d.road_address_name || d.address_name || '',
          location: { lat: Number(d.y), lng: Number(d.x) },
        }));
        res.json({ places });
        return;
      }
    }

    const baseUrl = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
    const ua = process.env.NOMINATIM_USER_AGENT || 'RoadWindow360/1.0';
    const url = new URL(`${baseUrl}/search`);
    url.searchParams.set('q', query);
    url.searchParams.set('format', 'jsonv2');
    url.searchParams.set('limit', '5');
    url.searchParams.set('accept-language', 'ko');
    const r = await fetch(url.toString(), { headers: { 'User-Agent': ua } });
    const rows = (await r.json()) as Array<{
      place_id: number;
      display_name: string;
      lat: string;
      lon: string;
    }>;
    const places = rows.map((row) => ({
      placeId: String(row.place_id),
      name: row.display_name.split(',')[0].trim(),
      address: row.display_name,
      location: { lat: Number(row.lat), lng: Number(row.lon) },
    }));
    res.json({ places });
  } catch {
    res.status(502).json({ places: [], error: '장소 검색에 실패했습니다.' });
  }
});
```

### 제17장. AI 주변 가이드(`/api/grounding/guide`) 경량화 및 폴백 전략

기존 `server.ts`의 `/api/grounding/guide`는 Gemini API의 `googleMaps` 그라운딩 도구를 사용합니다. 무료 API 전환 시 다음 두 가지를 보완합니다.

1. **항공 상공 브리핑 모드(`mode: 'flight'`) 추가**: 부산→서울 상공에서 현재 통과 중인 지명(예: `소백산맥`, `충주호`, `한강`)과 고도(`altitudeMeters`)를 프롬프트에 주입해 기내 안내 방송 스타일의 3~4줄 브리핑을 생성합니다.
2. **무료/오프라인 폴백**: `GEMINI_API_KEY`가 비어 있는 경우 503 에러로 화면을 막지 않고, 사전에 정의한 부산→서울 랜드마크 해설 데이터(제24장)와 OpenStreetMap/카카오맵 바로가기 링크를 반환하도록 처리합니다.

## Part 4. 프론트엔드 도로 주행 모드(2D 지도 & 360° 거리뷰) 전환

### 제18장. `src/types/drive.ts` 통합 데이터 모델 확장

**도보(`walk`) · 차량(`drive`) · 항공기(`flight`)** 3대 이동 모드와 **무료/Google 공급자 옵션(`MapProviderOption`)**을 타입 레벨에서 명확히 정의합니다.

```ts
export type MapProviderOption = 'free-kr' | 'free-global' | 'google';
export type TransportMode = 'walk' | 'drive' | 'flight';
export type ViewMode = 'street' | 'aerial' | 'map' | 'flight';
export type FlightCameraMode = 'cockpit' | 'window-left' | 'window-right' | 'chase';

export interface AppRuntimeConfig {
  defaultProvider: MapProviderOption;
  availableProviders: MapProviderOption[];
  kakaoJsKey: string;
  mapillaryToken: string;
  cesiumIonToken: string;
  vworldApiKey: string;
  googleMapsKey: string;
  hasGeminiGuide: boolean;
}

export interface TransportMotionProfile {
  mode: TransportMode;
  baseSpeedKmh: number;         // 도보: 4.8, 차량: 50, 항공: 800
  panoRefreshMeters: number;    // 도보: 5m, 차량: 15m, 항공: 미사용
  cameraTiltDeg: number;        // 도보: +2° (눈높이), 차량: 0°, 항공: 동적 pitch
  enableWalkBobbing: boolean;   // 도보 모드 미세 보행 흔들림 옵션
}

export interface FlightWaypoint {
  lat: number;
  lng: number;
  altitudeMeters: number;
  distanceFromStartMeters: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  landmarkName?: string;
}

export interface FlightTelemetry {
  progress: number;
  altitudeMeters: number;
  speedKmh: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  remainingKm: number;
  etaMinutes: number;
  phase: 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'DESCENT' | 'LANDING';
  nearestLandmark: string;
}

export interface TripLeg {
  id: string;
  transportMode: TransportMode; // 'flight' | 'drive' | 'walk'
  originName: string;
  destinationName: string;
  origin: { lat: number; lng: number };
  destination: { lat: number; lng: number };
  autoTransitionToNext: boolean; // 구간 종료 시 Earth<->Street 심리스 자동 전환
}

export interface SeamlessTransitionState {
  phase: 'IDLE' | 'DIVING_TO_STREET' | 'ASCENDING_TO_EARTH';
  overlayOpacity: number;        // 0 -> 1 -> 0 크로스페이드 제어
  targetCoord: { lat: number; lng: number; headingDeg: number } | null;
}
```

### 제19장. `src/utils/mapsHelpers.ts` 완전 재작성 지시서

Google SDK(`google.maps.PlacesLibrary`, `google.maps.RoutesLibrary`) 의존성을 완전히 제거하고, Part 3에서 만든 Express 프록시(`/api/places/search`, `/api/routes/drive`)를 호출하도록 변경합니다. 기존의 `buildCumulativeDistances`와 `haversineMeters`(`src/engine/routeSimulation.ts`)는 그대로 재사용합니다.

```ts
import {
  buildCumulativeDistances,
  haversineMeters,
  type LatLngPoint,
  type RouteStepInfo,
} from '../engine/routeSimulation';
import type { ComputedRouteData, MapProvider, SelectedPlaceInfo, TravelModeOption } from '../types/drive';

export async function resolvePlaceByQuery(textQuery: string): Promise<SelectedPlaceInfo | null> {
  const resp = await fetch(`/api/places/search?q=${encodeURIComponent(textQuery)}`);
  if (!resp.ok) return null;
  const data = (await resp.json()) as { places?: SelectedPlaceInfo[] };
  return data.places?.[0] ?? null;
}

export async function computeDrivingRoute(
  origin: SelectedPlaceInfo,
  destination: SelectedPlaceInfo,
  travelMode: TravelModeOption,
  provider: MapProvider
): Promise<ComputedRouteData> {
  const resp = await fetch('/api/routes/drive', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: origin.location,
      destination: destination.location,
      provider,
    }),
  });
  if (!resp.ok) {
    throw new Error('무료 경로 API에서 경로를 계산하지 못했습니다.');
  }
  const raw = (await resp.json()) as {
    path: LatLngPoint[];
    distanceMeters: number;
    durationSeconds: number;
    steps: Array<{ instructions: string; distanceMeters: number; durationSeconds: number }>;
  };

  const path = raw.path.length >= 2 ? raw.path : [origin.location, destination.location];
  const cumDistances = buildCumulativeDistances(path);
  const totalDistanceMeters =
    cumDistances[cumDistances.length - 1] ||
    raw.distanceMeters ||
    haversineMeters(origin.location, destination.location);

  let runningDist = 0;
  const steps: RouteStepInfo[] = raw.steps.map((s, idx) => {
    const item: RouteStepInfo = {
      index: idx,
      instructions: s.instructions,
      distanceMeters: s.distanceMeters,
      durationSeconds: s.durationSeconds,
      startDistanceMeters: runningDist,
      endDistanceMeters: runningDist + s.distanceMeters,
      startLocation: path[0],
      endLocation: path[path.length - 1],
    };
    runningDist += s.distanceMeters;
    return item;
  });

  return {
    origin,
    destination,
    travelMode,
    path,
    cumDistances,
    totalDistanceMeters,
    estimatedDurationSeconds: Math.max(60, raw.durationSeconds),
    steps,
  };
}
```

### 제20장. `AerialMapViewer.tsx` — 카카오맵 2D 지도 뷰어 구현

카카오맵 JavaScript SDK는 `autoload=false` 쿼리로 동적 스크립트 로드한 뒤 `window.kakao.maps.load()` 콜백 안에서 지도를 초기화해야 React 환경에서 안정적으로 동작합니다([Kakao 지도 Web API 가이드](https://apis.map.kakao.com/web/guide/)).

1. **동적 SDK 로더**: `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${kakaoJsKey}&autoload=false`를 한 번만 `<script>`로 삽입합니다.
2. **경로 폴리라인**: `new kakao.maps.Polyline({ path, strokeWeight: 6, strokeColor: '#10B981', strokeOpacity: 0.9 })`로 주행 경로를 그립니다.
3. **차량 마커 회전**: `kakao.maps.CustomOverlay` 내부에 화살표 SVG를 넣고 `transform: rotate(${vehicleHeading}deg)`로 실시간 방향을 표시합니다.
4. **지도 클릭 시 거리 점프**: `kakao.maps.event.addListener(map, 'click', ...)`에서 클릭 좌표와 `routeData.path` 중 가장 가까운 점(`haversineMeters < 400`)을 찾아 `onJumpToDistance`를 호출합니다.

### 제21장. `AerialMapViewer.tsx` — MapLibre GL JS 벡터·3D 지도 뷰어 구현

글로벌 모드(`mapProvider === 'osm'`)에서는 [MapLibre GL JS](https://maplibre.org/maplibre-gl-js/docs/)로 2D·기울어진 3D 지도를 렌더링합니다.

```ts
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

// 초기화 예시 (OpenStreetMap 래스터 또는 오픈 벡터 스타일 사용)
const map = new maplibregl.Map({
  container: containerRef.current,
  style: {
    version: 8,
    sources: {
      osm: {
        type: 'raster',
        tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '© OpenStreetMap contributors',
      },
    },
    layers: [{ id: 'osm-tiles', type: 'raster', source: 'osm' }],
  },
  center: [vehiclePosition.lng, vehiclePosition.lat],
  zoom: mode === 'aerial' ? 17 : 15,
  pitch: mode === 'aerial' ? 55 : 0,
  bearing: mode === 'aerial' ? vehicleHeading : 0,
});
```

차량이 이동할 때마다 `map.easeTo({ center: [lng, lat], bearing: mode === 'aerial' ? heading : 0, duration: 120 })`를 95ms 쓰로틀링과 함께 호출하면 기존 Google Maps 추적 카메라와 동일한 부드러운 추종감을 얻을 수 있습니다.

### 제22장. `StreetViewViewer.tsx` — 카카오맵 로드뷰(Roadview) 도보·차량 연속 이동 구현

국내 거리뷰에서 **도보(걸어가기)**와 **차량(차 타기)**의 체감 차이를 살리기 위해 이동 모드(`transportMode`)에 따라 파노라마 갱신 간격, 속도, 시야각을 다르게 제어합니다([로드뷰 기본 생성 샘플](https://apis.map.kakao.com/web/sample/basicRoadview/), [로드뷰와 지도 토글 샘플](https://apis.map.kakao.com/web/sample/roadviewToggle/)).

| 제어 항목 | 도보 모드 (`walk` · 걸어가기) | 차량 모드 (`drive` · 차 타기) |
| --- | --- | --- |
| 기본 이동 속도 | 4.8 km/h (배속 1x~5x 지원) | 50 km/h (배속 1x~4x 지원) |
| 파노라마 갱신 간격 | 5m 이동마다 `getNearestPanoId` 호출 | 15m 이동마다 `getNearestPanoId` 호출 |
| 탐색 반경 | 30m (골목·보행로 정밀 매칭) | 60m (대로·고가도로 안정 매칭) |
| 기본 시야각 (`tilt`) | `+2°` (보행자 눈높이, 건물·간판 시야) | `-1°` (운전석 전방 도로 시야) |
| 보행 모션 연출 | CSS 미세 상하 흔들림(Walk Bobbing) 토글 | 수평 안정화 + 코너 회전 스무딩 |

1. **파노라마 ID 중복 방지**: 반환된 `panoId`가 `lastPanoIdRef.current`와 같으면 `setPanoId`를 생략하고 `roadview.setViewpoint({ pan: vehicleHeading, tilt, zoom: 0 })`만 업데이트해 화면 깜빡임과 불필요한 호출을 줄입니다.
2. **로드뷰 미지원 구간 폴백**: 공원 산책로나 터널 등에서 `panoId === null`이 반환되면 화면을 유지한 채 상단에 "로드뷰 미지원 구간 통과 중" 배지를 띄우고 미니맵을 자동 확대합니다.

### 제23장. `StreetViewViewer.tsx` — MapillaryJS 거리뷰 연동 및 자동 이동

글로벌 모드에서는 [MapillaryJS](https://github.com/mapillary/mapillary-js)와 [mapillary/api-demo](https://github.com/mapillary/api-demo/) 패턴을 그대로 적용합니다.

1. **근접 이미지 ID 검색**: 현재 차량 좌표 주변 바운딩 박스(`±0.0005°`)로 Graph API를 호출해 가장 가까운 `image_id`를 조회합니다.
   - `GET https://graph.mapillary.com/images?access_token=${token}&fields=id,computed_geometry,compass_angle&bbox=${minLng},${minLat},${maxLng},${maxLat}&limit=5`
2. **뷰어 이동**: 조회된 `image_id`가 이전 ID와 다르면 `viewer.moveTo(imageId)`를 호출합니다([MapillaryJS 빠른 시작](https://mapillary.github.io/mapillary-js/docs/intro/try/)).
3. **진행 방향 일치**: 후보 5개 중 차량 진행 방위각(`vehicleHeading`)과 `compass_angle`의 각도 차이가 가장 작은 이미지를 우선 선택하면 역방향 사진이 튀어나오는 현상을 방지할 수 있습니다.
4. **빈 구간 처리**: Mapillary는 크라우드소싱 특성상 사진이 없는 도로가 존재하므로, `data.length === 0`이면 자동으로 `AerialMapViewer`(MapLibre 3D 기울임 뷰)로 화면을 부드럽게 전환하고 사진이 다시 발견될 때 거리뷰로 복귀합니다.

## Part 5. 부산 → 서울 3D 비행기 항공뷰 아키텍처 및 수학 모델

### 제24장. 부산(김해공항) → 서울(김포공항) 항공 노선 데이터 설계

부산에서 서울로 비행하는 항공뷰를 실감 나게 구현하려면 직선 2점만 연결하는 대신, 실제 국내선(PUS → GMP) 항로와 유사한 주요 경유지(Waypoint)와 랜드마크 해설 데이터를 `src/data/flightRoutes.ts`에 정의합니다.

| 순서 | 지점명 | 위도 (lat) | 경도 (lng) | 목표 고도 (m) | 비행 단계 | 창밖 랜드마크 포인트 |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | 김해국제공항 (PUS) | 35.1796 | 128.9382 | 30 | TAKEOFF | 낙동강 하구 및 서부산 평야 이륙 |
| 2 | 밀양·청도 상공 | 35.5038 | 128.7465 | 3,800 | CLIMB | 영남알프스 산군 및 낙동강 물줄기 |
| 3 | 대구 팔공산 상공 | 35.9890 | 128.6930 | 7,200 | CLIMB | 대구 분지와 팔공산 능선 조망 |
| 4 | 김천·추풍령 상공 | 36.2080 | 128.0060 | 8,500 | CRUISE | 백두대간 소백산맥 횡단 구간 |
| 5 | 청주·대청호 상공 | 36.6424 | 127.4890 | 8,500 | CRUISE | 충북 내륙 분지 및 금강 수계 |
| 6 | 안성·수원 상공 | 37.2636 | 127.0286 | 3,200 | DESCENT | 수도권 남부 신도시 진입 및 하강 |
| 7 | 김포국제공항 (GMP) | 37.5583 | 126.7906 | 35 | LANDING | 한강 하류·서울 도심 조망 후 착륙 |

### 제25장. 대권항로(Great Circle) 및 스플라인 경로 보간 엔진 (`flightSimulation.ts`)

7개의 웨이포인트를 직선으로 연결하면 경유지마다 비행기가 각지게 꺾입니다. `src/engine/flightSimulation.ts`를 신설해 **Catmull-Rom 스플라인 보간**으로 400개 이상의 부드러운 비행 궤적 점을 생성합니다.

```ts
import { haversineMeters } from './routeSimulation';
import type { FlightWaypoint } from '../types/drive';

export interface RawFlightNode {
  lat: number;
  lng: number;
  altitudeMeters: number;
  landmarkName?: string;
}

function catmullRom(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

export function computeBearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lng - a.lng);
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

export function buildFlightTrajectory(
  nodes: RawFlightNode[],
  samplesPerSegment = 60
): FlightWaypoint[] {
  const pts: Array<{ lat: number; lng: number; alt: number; landmarkName?: string }> = [];
  for (let i = 0; i < nodes.length - 1; i += 1) {
    const p0 = nodes[Math.max(0, i - 1)];
    const p1 = nodes[i];
    const p2 = nodes[i + 1];
    const p3 = nodes[Math.min(nodes.length - 1, i + 2)];
    for (let s = 0; s < samplesPerSegment; s += 1) {
      const t = s / samplesPerSegment;
      pts.push({
        lat: catmullRom(p0.lat, p1.lat, p2.lat, p3.lat, t),
        lng: catmullRom(p0.lng, p1.lng, p2.lng, p3.lng, t),
        alt: Math.max(30, catmullRom(p0.altitudeMeters, p1.altitudeMeters, p2.altitudeMeters, p3.altitudeMeters, t)),
        landmarkName: s === 0 ? p1.landmarkName : undefined,
      });
    }
  }
  const last = nodes[nodes.length - 1];
  pts.push({ lat: last.lat, lng: last.lng, alt: last.altitudeMeters, landmarkName: last.landmarkName });

  let cumDist = 0;
  return pts.map((pt, idx) => {
    if (idx > 0) {
      cumDist += haversineMeters(pts[idx - 1], pt);
    }
    const next = pts[Math.min(pts.length - 1, idx + 1)];
    const prev = pts[Math.max(0, idx - 1)];
    const headingDeg = computeBearingDeg(prev, next);
    const segHoriz = Math.max(1, haversineMeters(prev, next));
    const dAlt = next.alt - prev.alt;
    const pitchDeg = Math.max(-12, Math.min(15, (Math.atan2(dAlt, segHoriz) * 180) / Math.PI));
    return {
      lat: pt.lat,
      lng: pt.lng,
      altitudeMeters: pt.alt,
      distanceFromStartMeters: cumDist,
      headingDeg,
      pitchDeg,
      rollDeg: 0,
      landmarkName: pt.landmarkName,
    };
  });
}
```

### 제26장. 이륙–순항–착륙 3단계 고도(Altitude) 및 속도 프로파일 설계

단순한 등속·등고도 이동은 비행기 느낌이 떨어집니다. 전체 진행률 `progress (0.0 ~ 1.0)`에 따라 물리적으로 자연스러운 5단계 프로파일을 적용합니다.

| 진행률 구간 | 비행 단계 (`phase`) | 고도 범위 | 시뮬레이션 속도(배속 1x 기준) | 카메라 연출 특징 |
| --- | --- | --- | --- | --- |
| `0.00 ~ 0.06` | `TAKEOFF` | 30m → 1,200m | 260 → 420 km/h | 기수 상향(`pitch +8°~+12°`), 활주로 이탈 |
| `0.06 ~ 0.22` | `CLIMB` | 1,200m → 8,500m | 420 → 760 km/h | 구름층 돌파, 부산·경남 전경 축소 |
| `0.22 ~ 0.78` | `CRUISE` | 8,500m 유지 | 780 ~ 820 km/h | 수평 비행(`pitch 0°`), 소백산맥·내륙 파노라마 |
| `0.78 ~ 0.94` | `DESCENT` | 8,500m → 1,200m | 760 → 400 km/h | 완만한 하강(`pitch -4°~-6°`), 수도권 진입 |
| `0.94 ~ 1.00` | `LANDING` | 1,200m → 35m | 400 → 240 km/h | 한강·김포 활주로 정렬 후 최종 접지 |

사용자가 330km 구간을 지루하지 않게 감상할 수 있도록 기본 시뮬레이션 배속은 **10x ~ 40x** (전체 비행 약 2~4분 완주)로 두고, HUD에서 `1x / 10x / 25x / 60x` 배속 버튼과 타임라인 슬라이더를 제공합니다.

### 제27장. 항공기 자세 제어(Heading, Pitch, Roll/Bank) 계산 로직

항공기가 좌우로 선회할 때 날개가 안쪽으로 기울어지는 **뱅크(Roll)** 효과를 넣으면 3D 항공뷰의 사실감이 크게 높아집니다.

```ts
export function applyBankingRoll(waypoints: FlightWaypoint[]): FlightWaypoint[] {
  let smoothedRoll = 0;
  return waypoints.map((wp, idx) => {
    if (idx === 0 || idx === waypoints.length - 1) return wp;
    const prevH = waypoints[idx - 1].headingDeg;
    const nextH = waypoints[idx + 1].headingDeg;
    let turnDelta = ((nextH - prevH) % 360 + 540) % 360 - 180;
    if (turnDelta < -180) turnDelta += 360;
    // 선회 각속도에 비례해 최대 ±22도 뱅크 적용 및 지수 평활(Damping)
    const targetRoll = Math.max(-22, Math.min(22, turnDelta * 3.5));
    smoothedRoll = smoothedRoll * 0.85 + targetRoll * 0.15;
    return { ...wp, rollDeg: smoothedRoll };
  });
}
```

### 제28장. CesiumJS 기반 3D 지구본 및 비행기 항공뷰 컴포넌트(`FlightViewer.tsx`) 구현

[CesiumJS 빠른 시작](https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart/)과 [cesium_flight_tracker](https://github.com/srothst1/cesium_flight_tracker) 구조를 React 컴포넌트 `src/components/FlightViewer.tsx`로 통합합니다.

```tsx
import React, { useEffect, useRef } from 'react';
import * as Cesium from 'cesium';
import type { FlightCameraMode, FlightWaypoint } from '../types/drive';

interface FlightViewerProps {
  cesiumIonToken: string;
  vworldApiKey?: string;
  waypoints: FlightWaypoint[];
  currentWaypoint: FlightWaypoint;
  cameraMode: FlightCameraMode;
}

export const FlightViewer: React.FC<FlightViewerProps> = ({
  cesiumIonToken,
  vworldApiKey,
  waypoints,
  currentWaypoint,
  cameraMode,
}) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<Cesium.Viewer | null>(null);
  const planeEntityRef = useRef<Cesium.Entity | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    if (cesiumIonToken) {
      Cesium.Ion.defaultAccessToken = cesiumIonToken;
    }

    const viewer = new Cesium.Viewer(containerRef.current, {
      terrain: cesiumIonToken ? Cesium.Terrain.fromWorldTerrain() : undefined,
      animation: false,
      timeline: false,
      baseLayerPicker: false,
      geocoder: false,
      homeButton: false,
      sceneModePicker: false,
      navigationHelpButton: false,
      fullscreenButton: false,
    });

    // 브이월드 한국 고해상도 위성 타일 추가 (제29장 상세)
    if (vworldApiKey) {
      viewer.imageryLayers.addImageryProvider(
        new Cesium.UrlTemplateImageryProvider({
          url: `https://api.vworld.kr/req/wmts/1.0.0/${vworldApiKey}/Satellite/{z}/{y}/{x}.jpeg`,
          maximumLevel: 18,
          credit: '공간정보 오픈플랫폼(VWorld)',
        })
      );
    }

    // 전체 부산->서울 3D 비행 항로 폴리라인
    const positions = waypoints.map((wp) =>
      Cesium.Cartesian3.fromDegrees(wp.lng, wp.lat, wp.altitudeMeters)
    );
    viewer.entities.add({
      name: 'PUS-GMP Flight Path',
      polyline: {
        positions,
        width: 4,
        material: new Cesium.PolylineGlowMaterialProperty({
          glowPower: 0.25,
          color: Cesium.Color.fromCssColorString('#38BDF8'),
        }),
      },
    });

    // 항공기 위치 마커 엔티티 (glTF 3D 항공기 모델로 교체 가능)
    planeEntityRef.current = viewer.entities.add({
      name: 'Flight PUS-GMP',
      position: positions[0],
      point: {
        pixelSize: 12,
        color: Cesium.Color.GOLD,
        outlineColor: Cesium.Color.BLACK,
        outlineWidth: 2,
      },
    });

    viewerRef.current = viewer;
    return () => {
      viewer.destroy();
      viewerRef.current = null;
    };
  }, [cesiumIonToken, vworldApiKey, waypoints]);

  useEffect(() => {
    const viewer = viewerRef.current;
    if (!viewer) return;
    const pos = Cesium.Cartesian3.fromDegrees(
      currentWaypoint.lng,
      currentWaypoint.lat,
      currentWaypoint.altitudeMeters
    );
    if (planeEntityRef.current) {
      planeEntityRef.current.position = new Cesium.ConstantPositionProperty(pos);
    }
    const heading = Cesium.Math.toRadians(currentWaypoint.headingDeg);
    const pitch = Cesium.Math.toRadians(currentWaypoint.pitchDeg - 18);
    const roll = Cesium.Math.toRadians(currentWaypoint.rollDeg);

    if (cameraMode === 'cockpit') {
      viewer.camera.setView({ destination: pos, orientation: { heading, pitch, roll } });
    } else if (cameraMode === 'window-left' || cameraMode === 'window-right') {
      const sideOffset = cameraMode === 'window-left' ? -90 : 90;
      viewer.camera.setView({
        destination: pos,
        orientation: {
          heading: Cesium.Math.toRadians((currentWaypoint.headingDeg + sideOffset + 360) % 360),
          pitch: Cesium.Math.toRadians(-24),
          roll: 0,
        },
      });
    } else {
      // 3인칭 후방 추적 카메라
      viewer.camera.lookAt(
        pos,
        new Cesium.HeadingPitchRange(heading, Cesium.Math.toRadians(-22), 2800)
      );
    }
  }, [currentWaypoint, cameraMode]);

  return <div ref={containerRef} className="w-full h-full bg-[#060A12]" />;
};
```

### 제29장. 브이월드(VWorld) 고해상도 항공사진 WMTS 타일을 CesiumJS에 결합하기

Cesium ion 기본 위성영상은 한반도 일부 구간에서 해상도가 낮거나 구름이 덮인 타일이 섞일 수 있습니다. 브이월드 `Satellite` 타일과 `Hybrid`(도로명·지명 투명 라벨) 타일을 2중 레이어로 올리면 부산 해운대·낙동강·소백산맥·한강 다리까지 선명하게 보입니다.

```ts
// 1. 고해상도 위성 항공사진 레이어
const satelliteLayer = viewer.imageryLayers.addImageryProvider(
  new Cesium.UrlTemplateImageryProvider({
    url: `https://api.vworld.kr/req/wmts/1.0.0/${vworldApiKey}/Satellite/{z}/{y}/{x}.jpeg`,
    maximumLevel: 18,
  })
);
satelliteLayer.alpha = 1.0;

// 2. 지명·도로명 하이브리드 투명 라벨 레이어 (옵션 토글 가능)
const hybridLayer = viewer.imageryLayers.addImageryProvider(
  new Cesium.UrlTemplateImageryProvider({
    url: `https://api.vworld.kr/req/wmts/1.0.0/${vworldApiKey}/Hybrid/{z}/{y}/{x}.png`,
    maximumLevel: 18,
  })
);
hybridLayer.alpha = 0.85;
```

**주의사항**: 브이월드 WMTS 타일은 반드시 발급 신청 시 등록한 도메인(`http://localhost:3000` 등)에서 요청해야 정상 응답합니다. 로컬 테스트 중 `403` 오류가 나면 브이월드 마이페이지에서 인증키 도메인 설정을 확인하세요.

### 제30장. MapLibre GL JS 3D Terrain 기반 경량 비행기 항공뷰 대안 구현

CesiumJS 번들 크기가 부담스럽거나 저사양 모바일 브라우저를 우선 지원해야 한다면, [MapLibre 3D Terrain 예제](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/)와 [Sky, Fog, Terrain 예제](https://maplibre.org/maplibre-gl-js/docs/examples/sky-fog-terrain/)를 조합해 경량 항공뷰를 구현할 수 있습니다.

1. `raster-dem` 소스로 지형 고도 타일을 등록하고 `map.setTerrain({ source: 'dem', exaggeration: 1.5 })`를 적용해 소백산맥과 태백산맥의 입체감을 강조합니다.
2. `map.setSky({ 'sky-color': '#199EF3', 'horizon-color': '#D4ECFF', 'fog-color': '#C5DFEE' })`로 고공 대기 원근감을 표현합니다.
3. 매 프레임 `const camera = map.getFreeCameraOptions(); camera.position = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], altitudeMeters); camera.lookAtPoint([lookLng, lookLat]); map.setFreeCameraOptions(camera);`로 비행기 시점을 갱신합니다.
4. 3D 비행기 동체까지 화면에 띄우고 싶다면 [MapLibre + Three.js 3D 모델 예제](https://maplibre.org/maplibre-gl-js/docs/examples/add-3d-tiles-3d-objects-and-models-using-threejs/)의 커스텀 레이어를 추가합니다.

### 제31장. 다중 카메라 시점(조종석 1인칭 / 창밖 측면 / 후방 추적 3인칭) 전환 시스템

사용자가 비행 중 단축키(`1`, `2`, `3`, `4`)나 HUD 버튼으로 시점을 즉시 바꿀 수 있도록 4가지 카메라 프리셋을 제공합니다.

| 시점 모드 | 단축키 | 카메라 위치 및 각도 설계 | 추천 감상 포인트 |
| --- | --- | --- | --- |
| `cockpit` (조종석 1인칭) | `1` | 기체 위치, `heading` 정면, `pitch -15° ~ -20°`, `roll` 반영 | 활주로 이착륙 및 산맥 정면 돌파 |
| `window-left` (좌측 창가) | `2` | 기체 위치, `heading - 90°`, `pitch -24°`, 창틀 오버레이 | 서해안·충청 서부·경기도 서부 조망 |
| `window-right` (우측 창가) | `3` | 기체 위치, `heading + 90°`, `pitch -24°`, 창틀 오버레이 | 영남알프스·팔공산·소백산맥·강원 방면 |
| `chase` (3인칭 후방 추적) | `4` | 기체 후방 2.8km, 상단 `-22°` 내려다보기 (`lookAt`) | 전체 비행 항로와 3D 지형 입체감 확인 |


**Earth ↔ Street View 심리스 다이브(Seamless Dive) 전환 알고리즘**

Google Earth에서 거리뷰로 빨려 들어가듯 전환되는 연출을 무료 스택(CesiumJS ↔ 카카오 로드뷰 / MapillaryJS)에서도 동일하게 구현합니다.

```ts
// 1. 3D 지구본/항공뷰 -> 지상 360° 거리뷰로 급강하 전환 (Dive-in)
export async function diveFromEarthToStreet(
  viewer: Cesium.Viewer,
  target: { lat: number; lng: number; headingDeg: number },
  onPreloadStreetView: () => Promise<void>,
  onCrossfadeComplete: () => void
) {
  // 백그라운드에서 거리뷰 파노라마를 미리 로딩(Preload)해 전환 시 흰 화면 방지
  const preloadPromise = onPreloadStreetView();

  await new Promise<void>((resolve) => {
    viewer.camera.flyTo({
      destination: Cesium.Cartesian3.fromDegrees(target.lng, target.lat, 45),
      orientation: {
        heading: Cesium.Math.toRadians(target.headingDeg),
        pitch: Cesium.Math.toRadians(-12),
        roll: 0,
      },
      duration: 2.2,
      easingFunction: Cesium.EasingFunction.CUBIC_IN_OUT,
      complete: () => resolve(),
    });
  });

  await preloadPromise;
  // 400ms CSS opacity 크로스페이드 후 360° 거리뷰 활성화
  onCrossfadeComplete();
}

// 2. 지상 360° 거리뷰 -> 3D 지구본으로 수직 상승 복귀 (Ascend)
export function ascendFromStreetToEarth(
  viewer: Cesium.Viewer,
  current: { lat: number; lng: number; headingDeg: number }
) {
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(current.lng, current.lat, 55),
    orientation: {
      heading: Cesium.Math.toRadians(current.headingDeg),
      pitch: Cesium.Math.toRadians(-15),
      roll: 0,
    },
  });
  viewer.camera.flyTo({
    destination: Cesium.Cartesian3.fromDegrees(current.lng, current.lat, 2500),
    orientation: {
      heading: Cesium.Math.toRadians(current.headingDeg),
      pitch: Cesium.Math.toRadians(-45),
      roll: 0,
    },
    duration: 2.0,
  });
}
```

## Part 6. UI/UX 통합, 오디오, 성능 최적화 및 배포 검증

### 제32장. `App.tsx` 통합 상태 관리 — 3대 이동 모드 및 API 공급자 옵션 스위처

`src/App.tsx`는 최초 마운트 시 `/api/config`를 1회 호출해 `AppRuntimeConfig`를 불러온 뒤, 사용자가 상단 헤더에서 **① 이동 모드(`걸어가기 walk` · `차 타기 drive` · `비행기 flight`)**와 **② 지도 API 공급자 옵션(`무료-국내 free-kr` · `무료-글로벌 free-global` · `Google 옵션 google`)**을 실시간으로 선택할 수 있게 구성합니다.

1. **이동 모드 전환 규칙**: `walk` ↔ `drive` 전환 시 현재 출발지·목적지를 유지한 채 `/api/routes`를 새 `mode`로 재요청해 보행로/차도 경로를 즉시 교체합니다. `flight` 전환 시에는 항공 프리셋(부산 김해공항→서울 김포공항)을 로드합니다.
2. **공급자 옵션 스위처**: 기본값은 무료 API(`free-kr` 또는 `free-global`)이며, Google 키가 설정된 환경에서만 `Google API (옵션)` 항목이 활성화됩니다. 공급자를 바꾸면 해당 어댑터 뷰어만 지연 로드(Lazy Load)됩니다.
3. **애니메이션 루프 및 WebGL 정리**: 모드나 공급자를 전환할 때 기존 `requestAnimationFrame`을 즉시 취소하고, `FlightViewer`(CesiumJS)는 조건부 렌더링 언마운트로 `viewer.destroy()`가확실히 실행되게 합니다.
4. **멀티 구간 실제 여행 체이닝(`TripLeg[]`)**: 예를 들어 `구간 1: 부산 김해공항→서울 김포공항(flight)` 완료 시 자동으로 착륙 후 `diveFromEarthToStreet`를 실행해 `구간 2: 김포공항→광화문(drive)` 거리뷰 주행으로 넘어가고, 도착하면 다시 `구간 3: 광화문→경복궁·북촌(walk)` 도보 산책으로 끊김 없이 이어지는 풀 여행 시나리오를 지원합니다.

### 제33장. 3대 이동 모드별 전용 HUD (`WalkHud` · `DriveHud` · `FlightHud`) UI 설계

기존 `DriveHud.tsx`의 다크 유리질(Glassmorphism) 디자인을 통일해 도보·차량·항공 각 모드에 맞는 전용 계기판을 제공합니다.

| 이동 모드 | 상단 정보 바 | 핵심 계기 카드 | 하단 전용 컨트롤 |
| --- | --- | --- | --- |
| 도보 (`WalkHud`) | 산책 경로명 · 현재 동네명 | 보행 속도(`4.8 km/h`), 누적 걸음 수(보폭 0.72m 환산), 남은 거리 | 배속(`1x~5x`), 보행 흔들림(Bobbing) 토글, 360° 시야 리셋 |
| 차량 (`DriveHud`) | 출발지→목적지 · 현재 도로명 | 주행 속도(`km/h`), 잔여 거리, 예상 소요 시간(ETA) | 배속(`1x~4x`), 거리뷰/2D지도/항공지도 전환, 경로 점프 슬라이더 |
| 항공 (`FlightHud`) | 편명(`RW-360 PUS→GMP`) · 비행 단계 | 고도(`m / ft`), 대지속도(`km/h · kt`), 방위각(`HDG`), 통과 상공 랜드마크 | 배속(`1x/10x/25x/60x`), 4종 카메라 시점(`조종석·좌/우 창가·추적`) |

### 제34장. 비행 구간 실시간 랜드마크 브리핑 및 AI 가이드 연동

비행기가 제24장의 주요 경유지(낙동강 하구, 팔공산, 소백산맥, 대청호, 한강) 반경 15km 이내에 진입할 때마다 `GroundGuideDrawer.tsx`에 자동 브리핑 트리거를 보냅니다.

1. **중복 호출 방지**: 이미 브리핑한 랜드마크 이름은 `announcedLandmarksRef: Set<string>`에 기록해 같은 상공에서 중복 요청이 나가지 않도록 합니다.
2. **하이브리드 브리핑**: `config.hasGeminiGuide`가 `true`이면 `/api/grounding/guide` (`mode: 'flight'`)를 호출해 실시간 AI 기내 방송 해설을 출력하고, `false`이면 `flightRoutes.ts`에 내장된 정적 랜드마크 해설을 즉시 표시합니다.
3. **실제 여행 몰입 연출 (시간대 조명 & 여행 포토카드)**: CesiumJS의 `viewer.clock.currentTime`과 대기 산란(`skyAtmosphere`)을 조절해 사용자가 **아침·낮·노을(골든아워)·야경** 시간대를 실시간으로 바꿀 수 있게 하고, 비행 중이나 거리뷰 산책 중 마음에 드는 풍경을 캡처해 좌표·지명·고도 스탬프가 찍힌 여행 포토카드(PNG)로 저장하는 기능을 제공합니다.

### 제35장. `driveAudio.ts` 확장 — 도보·차량·항공기 3종 사운드 합성

외부 음원 파일 없이 Web Audio API로 기내 사운드를 합성하는 `FlightAudioEngine` 클래스를 `src/audio/driveAudio.ts`에 추가합니다.

- **도보 모드(`walk`) 사운드**: 보행 속도(`km/h`)에 맞춘 리듬(분당 105~120보)으로 짧은 저주파 필터 임펄스(발걸음)와 부드러운 바람·도시 앰비언스(Bandpass 노이즈)를 합성합니다.
- **차량 모드(`drive`) 사운드**: 기존 `driveAudio.ts`의 차량 엔진·타이어 주행음을 유지합니다.
- **항공기 모드(`flight`) 제트 엔진 화이트/핑크 노이즈**: `AudioBuffer`에 무작위 노이즈를 생성하고 `BiquadFilterNode(type: 'lowpass')`를 통과시켜 기내 저주파 웅웅거림을 만듭니다.
- **비행 단계별 동적 변조**:
  - `TAKEOFF` / `CLIMB`: 로우패스 컷오프 주파수 `420Hz`, 게인 `0.22` (강한 추력음)
  - `CRUISE`: 컷오프 `180Hz`, 게인 `0.11` (안정적인 기내 순항 소음)
  - `DESCENT` / `LANDING`: 컷오프 `260Hz → 140Hz`, 게인 점진 감소
- **브라우저 정책 준수**: 모든 오디오 컨텍스트(`AudioContext`)는 사용자의 첫 재생 버튼 클릭 이벤트 내부에서 `resume()`을 호출하고, 상단 음소거(Mute) 토글을 제공합니다.

### 제36장. 프레임 드롭 방지 및 타일·메모리 성능 최적화 지시서

3D 지구본과 고해상도 위성 타일은 브라우저 메모리와 GPU를 빠르게 소모하므로 아래 4가지 최적화를 필수 적용합니다.

1. **WebGL 컨텍스트 정리**: `FlightViewer` 및 `AerialMapViewer`(MapLibre) 언마운트 시 `viewer.destroy()`, `map.remove()`를 반드시 호출합니다.
2. **React 리렌더링 분리**: 비행 애니메이션 루프(`requestAnimationFrame`)에서 매 16ms마다 React `setState`를 호출하면 UI 전체가 버벅입니다. CesiumJS 카메라 위치 갱신은 `ref` 기반으로 60fps 직접 업데이트하고, HUD 숫자(`FlightTelemetry`)만 **200ms(5fps) 간격**으로 React 상태에 반영합니다.
3. **타일 해상도 제어**: CesiumJS 초기화 시 `viewer.scene.globe.maximumScreenSpaceError = 2.5`로 설정해 고공 순항 시 불필요한 초고해상도 타일 로딩을 줄이고, 모바일 화면에서는 `viewer.resolutionScale = Math.min(window.devicePixelRatio, 1.5)`로 제한합니다.
4. **WebGL2 미지원 폴백**: 기존 `AerialMapViewer.tsx`의 `detectWebGL2()` 유틸을 재사용해 WebGL2가 차단된 환경에서는 3D 비행 뷰 대신 2D 지도 위 항공기 아이콘 이동 모드로 자동 폴백합니다.

### 제37장. API 쿼터 보호, 에러 핸들링 및 오프라인/폴백 복구 전략

무료 API는 서비스별 속도 제한이나 일시 장애가 발생할 수 있으므로 아래 장애 대응 매트릭스를 코드에 반영합니다.

| API / 서비스 | 발생 가능한 오류·제한 | 자동 복구 및 방어 전략 |
| --- | --- | --- |
| 카카오맵 Web SDK | 일 300,000건 초과 또는 도메인 미등록 | 로드뷰 갱신 15m 스로틀링, 오류 시 MapLibre 모드로 전환 안내 |
| 카카오모빌리티 길찾기 | 키 미승인 또는 한도 초과 | `server.ts`에서 즉시 OSRM(`/route/v1/driving`)으로 자동 폴백 |
| Nominatim 공용 서버 | 1 req/s 초과 시 `429 Too Many Requests` | 서버 측 인메모리 캐시(LRU) + 1.1초 순차 딜레이 적용 |
| Mapillary Graph API | 특정 도로에 거리뷰 이미지 없음 | 빈 배열 감지 시 3D 기울임 지도(`AerialMapViewer`)로 자동 전환 |
| 브이월드 WMTS | 도메인 불일치(`403`) 또는 일시 타임아웃 | 타일 에러 카운트 초과 시 Cesium 기본 위성 레이어 유지 |

### 제38장. 단위 테스트 및 통합 검증 체크리스트 (`*.test.ts`)

기존 `src/engine/routeSimulation.test.ts`와 동일한 테스트 러너 구조로 `src/engine/flightSimulation.test.ts`를 작성합니다.

```ts
import { describe, expect, it } from 'vitest';
import { applyBankingRoll, buildFlightTrajectory, computeBearingDeg } from './flightSimulation';

describe('flightSimulation (PUS -> GMP)', () => {
  it('부산에서 서울 방향 방위각은 북서쪽(300~350도) 범위여야 한다', () => {
    const bearing = computeBearingDeg(
      { lat: 35.1796, lng: 128.9382 },
      { lat: 37.5583, lng: 126.7906 }
    );
    expect(bearing).toBeGreaterThan(300);
    expect(bearing).toBeLessThan(350);
  });

  it('스플라인 보간 후 모든 웨이포인트 고도는 30m 이상이어야 한다', () => {
    const raw = [
      { lat: 35.1796, lng: 128.9382, altitudeMeters: 30 },
      { lat: 36.2080, lng: 128.0060, altitudeMeters: 8500 },
      { lat: 37.5583, lng: 126.7906, altitudeMeters: 35 },
    ];
    const traj = applyBankingRoll(buildFlightTrajectory(raw, 40));
    expect(traj.length).toBeGreaterThan(80);
    expect(traj.every((wp) => wp.altitudeMeters >= 30)).toBe(true);
    expect(traj.every((wp) => Math.abs(wp.rollDeg) <= 22)).toBe(true);
  });
});
```

**최종 수동 통합 검증 체크리스트**
- `/api/config` 응답에 `KAKAO_REST_API_KEY`, `GEMINI_API_KEY`가 포함되지 않았는지 브라우저 네트워크 탭에서 확인
- 국내 경로(예: 부산역 → 해운대) 검색 시 카카오맵 2D 지도 + 카카오 로드뷰 연속 이동 정상 동작 확인
- 해외 경로(예: 도쿄역 → 시부야) 검색 시 MapLibre + MapillaryJS 전환 및 빈 구간 폴백 동작 확인
- **부산 → 서울 비행기 모드** 진입 시 이륙→순항→착륙 고도 변화, 4종 카메라 시점 전환(`1~4`), 배속 변경, 슬라이더 탐색, 모드 종료 시 WebGL 메모리 해제 확인

### 제39장. 로컬 개발 실행, Docker(OSRM 포함) 및 프로덕션 빌드·배포 가이드

**1. 로컬 개발 실행 절차**
1. 루트에 `.env` 파일을 생성하고 Part 2에서 발급받은 무료 키를 입력합니다.
2. 의존성을 설치하고 통합 서버(`server.ts`)를 실행합니다.
   ```bash
   npm install
   npm run dev
   ```
3. 브라우저에서 `http://localhost:3000`에 접속해 도로 주행 모드와 부산→서울 항공 비행 모드를 테스트합니다.

**2. 프로덕션 빌드 및 배포**
1. `npm run build`를 실행해 Vite + `vite-plugin-cesium` 정적 번들을 `dist/` 디렉터리에 생성합니다.
2. `NODE_ENV=production PORT=3000 node --loader tsx server.ts` (또는 컴파일된 JS)로 실행하면 `server.ts`가 `dist/` 정적 파일과 `/api/*` 프록시를 단일 포트에서 서빙합니다.
3. 배포 도메인(HTTPS)이 확정되면 **카카오디벨로퍼스 Web 플랫폼 도메인**, **브이월드 인증키 서비스 URL**, **Cesium ion 토큰 허용 도메인** 3곳에 모두 배포 도메인을 등록해야 지도가 차단되지 않습니다.

### 제40장. 전체 공식 문서·오픈소스 저장소 레퍼런스 총람 및 구현 로드맵

본 지시서에서 참조한 검증된 공식 문서 및 오픈소스 저장소 링크 총정리입니다.

| 분류 | 서비스 / 프로젝트명 | 공식 문서 및 저장소 링크 |
| --- | --- | --- |
| 원본 프로젝트 | byjay/Street (RoadWindow 360) | [GitHub 저장소](https://github.com/byjay/Street) |
| 국내 지도·로드뷰 | 카카오디벨로퍼스 / 카카오맵 Web API | [카카오디벨로퍼스](https://developers.kakao.com/), [카카오맵 이해하기](https://developers.kakao.com/docs/ko/kakaomap/common), [무료 쿼터](https://developers.kakao.com/docs/ko/getting-started/quota), [Web API 가이드](https://apis.map.kakao.com/web/guide/) |
| 국내 로드뷰 샘플 | 카카오맵 로드뷰 공식 샘플 | [로드뷰 기본 생성](https://apis.map.kakao.com/web/sample/basicRoadview/), [지도·로드뷰 토글](https://apis.map.kakao.com/web/sample/roadviewToggle/), [로드뷰 도로 오버레이](https://apis.map.kakao.com/web/sample/addRoadviewOverlay/) |
| 국내 길찾기 | 카카오모빌리티 디벨로퍼스 | [길찾기 시작하기](https://developers.kakaomobility.com/guide/navi-api/start.html), [자동차 길찾기 가이드](https://developers.kakaomobility.com/guide/navi-api/directions.html) |
| 국내 항공사진·3D | 브이월드(VWorld) 오픈플랫폼 | [브이월드 메인](https://www.vworld.kr/v4po_main.do) |
| 글로벌 거리뷰 | Mapillary / MapillaryJS | [개발자 대시보드](https://www.mapillary.com/dashboard/developers), [API 문서](https://www.mapillary.com/developer/api-documentation), [MapillaryJS GitHub](https://github.com/mapillary/mapillary-js), [통합 데모 소스](https://github.com/mapillary/api-demo/) |
| 오픈소스 2D/3D 지도 | MapLibre GL JS | [GitHub](https://github.com/maplibre/maplibre-gl-js), [공식 문서](https://maplibre.org/maplibre-gl-js/docs/), [3D Terrain 예제](https://maplibre.org/maplibre-gl-js/docs/examples/3d-terrain/), [Sky/Fog/Terrain 예제](https://maplibre.org/maplibre-gl-js/docs/examples/sky-fog-terrain/) |
| 오픈소스 경로·검색 | OSRM & Nominatim | [OSRM Backend GitHub](https://github.com/project-osrm/osrm-backend), [OSRM HTTP 명세](https://github.com/Project-OSRM/osrm-backend/blob/master/docs/http.md), [Nominatim API](https://nominatim.org/release-docs/latest/api/Overview/), [openroute 통합 예제](https://github.com/Prateet-Github/openroute) |
| 3D 항공 비행 엔진 | CesiumJS & Cesium ion | [CesiumJS](https://cesium.com/platform/cesiumjs/), [Cesium ion 요금제](https://cesium.com/platform/cesium-ion/pricing/), [Quickstart](https://cesium.com/learn/cesiumjs-learn/cesiumjs-quickstart/), [비행 시뮬레이터 가이드](https://cesium.com/learn/cesiumjs-learn/build-a-flight-simulator-with-cesiumjs-using-ai/), [flight_tracker GitHub](https://github.com/srothst1/cesium_flight_tracker) |

**권장 4단계 구현 로드맵**
1. **1주차 (키 발급 & 백엔드 전환)**: Part 2 무료 키 발급 완료 → `server.ts` `/api/config`, `/api/geocode/regions`, `/api/routes/drive`, `/api/places/search` 구현 및 Postman/curl 검증
2. **2주차 (도로 주행 프론트엔드 전환)**: `mapsHelpers.ts` 교체 → `AerialMapViewer.tsx`(카카오맵·MapLibre) 및 `StreetViewViewer.tsx`(카카오 로드뷰·MapillaryJS) 연동 완료
3. **3주차 (부산→서울 3D 항공 비행 구현)**: `flightRoutes.ts`, `flightSimulation.ts`, `FlightViewer.tsx`(CesiumJS + 브이월드 WMTS), `FlightHud.tsx`, 4종 카메라 시점 및 기내 오디오 통합
4. **4주차 (최적화 & 배포)**: 60fps/5fps 렌더링 분리, API 쿼터·폴백 테스트, 단위 테스트(`flightSimulation.test.ts`) 통과 후 프로덕션 도메인 등록 및 배포
