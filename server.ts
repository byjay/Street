import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

type ProviderSlug = 'free-kr' | 'free-global' | 'google';

interface GroundedPlaceLink {
  title: string;
  uri: string;
  placeId?: string;
  reviewSnippets: string[];
}

interface GroundingGuideBody {
  query?: string;
  placeName?: string;
  landmarkName?: string;
  altitudeMeters?: number;
  lat?: number;
  lng?: number;
  mode?: 'nearby' | 'destination' | 'search' | 'flight';
}

const FLIGHT_FALLBACK_BRIEFS: Record<string, { summary: string; highlights: string[] }> = {
  김해국제공항: {
    summary: '낙동강 삼각주와 을숙도, 서부산 평야를 뒤로하고 김해국제공항 활주로에서 북서쪽 서울 방면으로 이륙합니다.',
    highlights: ['낙동강 하구', '을숙도 생태공원', '가야산맥 원경'],
  },
  '밀양·청도': {
    summary: '영남알프스의 웅장한 산군과 밀양강·낙동강 물줄기가 어우러진 경남·경북 경계 산악 회랑을 따라 상승 중입니다.',
    highlights: ['영남알프스 가지산', '운문산 자연휴양림', '낙동강 본류'],
  },
  '대구 팔공산': {
    summary: '분지 지형의 대구광역시 북쪽을 병풍처럼 감싼 팔공산과 갓바위 능선 상공 7,200m를 통과합니다.',
    highlights: ['팔공산 비로봉', '금호강 도심', '동화사 계곡'],
  },
  '김천·추풍령': {
    summary: '백두대간의 허리인 소백산맥과 추풍령 고개를 넘어 영남에서 충청권으로 진입하는 순항 구간입니다.',
    highlights: ['소백산맥 능선', '추풍령 생태통로', '직지사 계곡'],
  },
  '청주·대청호': {
    summary: '금강이 빚어낸 거대한 내륙 호수 대청호와 청주·세종시 평야 지대가 발아래 펼쳐집니다.',
    highlights: ['대청호 호반', '청남대 반도', '금강 물줄기'],
  },
  '안성·수원': {
    summary: '고도를 서서히 낮추며 경기 남부 평야와 광교·수원화성, 한강 남쪽 수도권 스카이라인으로 접근 중입니다.',
    highlights: ['수원화성', '광교호수공원', '관악산 능선'],
  },
  김포국제공항: {
    summary: '한강 하류와 행주대교, 여의도·남산 스카이라인을 옆으로 바라보며 서울 김포국제공항 활주로에 최종 착륙합니다.',
    highlights: ['한강 아라뱃길', '여의도 한강공원', '북한산 스카이라인'],
  },
};

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function getValidGoogleMapsKey(): string {
  const key =
    process.env.VITE_GOOGLE_MAPS_API_KEY ||
    process.env.GOOGLE_MAPS_API_KEY ||
    '';
  return key && key !== 'MY_GOOGLE_MAPS_API_KEY' ? key : '';
}

const freeSearchCache = new Map<
  string,
  Array<{
    name: string;
    address?: string;
    location: { lat: number; lng: number };
    placeId?: string;
  }>
>();
const freeReverseCache = new Map<string, string>();
const streetPhotoCache = new Map<
  string,
  {
    imageUrl: string;
    headingDeg?: number;
    provider: 'mapillary' | 'kartaview' | 'wikimedia';
    lat: number;
    lng: number;
    capturedAt?: string;
    caption?: string;
  } | null
>();

async function queryKakaoKeywordSearch(query: string, limit: number) {
  const kakaoRestKey = process.env.KAKAO_REST_API_KEY || '';
  if (!kakaoRestKey) return [];
  const url = new URL('https://dapi.kakao.com/v2/local/search/keyword.json');
  url.searchParams.set('query', query);
  url.searchParams.set('size', String(limit));

  const resp = await fetch(url.toString(), {
    headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as {
    documents?: Array<{
      id?: string;
      place_name?: string;
      road_address_name?: string;
      address_name?: string;
      x?: string;
      y?: string;
    }>;
  };
  return (data.documents ?? [])
    .map((d) => {
      const lat = Number(d.y);
      const lng = Number(d.x);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return {
        name: (d.place_name || '').trim() || `${lat.toFixed(4)}, ${lng.toFixed(4)}`,
        address: d.road_address_name || d.address_name || undefined,
        location: { lat, lng },
        placeId: d.id ? `kakao:${d.id}` : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

async function queryNominatimSearch(query: string, limit: number) {
  const baseUrl = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
  const ua = process.env.NOMINATIM_USER_AGENT || 'RoadWindow360/1.0 (free-nav-proxy)';
  const url = new URL(`${baseUrl}/search`);
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('accept-language', 'ko,en');
  url.searchParams.set('limit', String(limit));

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': ua },
    signal: AbortSignal.timeout(7000),
  });
  if (!resp.ok) return [];
  const items = (await resp.json()) as Array<{
    place_id?: number | string;
    lat?: string | number;
    lon?: string | number;
    name?: string;
    display_name?: string;
  }>;
  if (!Array.isArray(items)) return [];

  return items
    .map((item) => {
      const lat = Number(item?.lat);
      const lng = Number(item?.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const display = (item.display_name || '').trim();
      const name =
        item.name?.trim() ||
        display.split(',')[0]?.trim() ||
        `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      return {
        name,
        address: display || undefined,
        location: { lat, lng },
        placeId: item.place_id ? `nominatim:${String(item.place_id)}` : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

async function queryPhotonSearch(
  query: string,
  limit: number,
  biasLat?: number,
  biasLng?: number
) {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', String(limit));
  if (
    typeof biasLat === 'number' &&
    Number.isFinite(biasLat) &&
    typeof biasLng === 'number' &&
    Number.isFinite(biasLng)
  ) {
    url.searchParams.set('lat', String(biasLat));
    url.searchParams.set('lon', String(biasLng));
  }

  const resp = await fetch(url.toString(), {
    headers: { 'User-Agent': 'RoadWindow360/1.0' },
    signal: AbortSignal.timeout(7000),
  });
  if (!resp.ok) return [];
  const data = (await resp.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] };
      properties?: {
        osm_id?: number | string;
        name?: string;
        street?: string;
        district?: string;
        city?: string;
        state?: string;
        country?: string;
      };
    }>;
  };
  const features = Array.isArray(data?.features) ? data.features : [];
  return features
    .map((f) => {
      const coords = f?.geometry?.coordinates;
      if (!Array.isArray(coords) || coords.length < 2) return null;
      const lng = Number(coords[0]);
      const lat = Number(coords[1]);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      const p = f.properties ?? {};
      const name =
        p.name?.trim() ||
        p.street?.trim() ||
        p.district?.trim() ||
        p.city?.trim() ||
        `${lat.toFixed(4)}, ${lng.toFixed(4)}`;
      const parts = [p.country, p.state, p.city, p.district, p.street]
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean);
      return {
        name,
        address: parts.length > 0 ? Array.from(new Set(parts)).join(' ') : undefined,
        location: { lat, lng },
        placeId: p.osm_id ? `osm:${String(p.osm_id)}` : undefined,
      };
    })
    .filter((x): x is NonNullable<typeof x> => Boolean(x));
}

function angularDiffDeg(a: number, b: number): number {
  const diff = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return diff;
}

function toHttpsUrl(url?: string): string {
  if (!url) return '';
  return url.startsWith('http://') ? `https://${url.slice(7)}` : url;
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/config', (_req: Request, res: Response) => {
    const mapsApiKey = getValidGoogleMapsKey();
    const kakaoMapKey =
      process.env.KAKAO_JS_KEY ||
      process.env.VITE_KAKAO_MAP_KEY ||
      process.env.KAKAO_MAP_JS_KEY ||
      '';
    const mapillaryToken = process.env.MAPILLARY_CLIENT_TOKEN || '';
    const vworldApiKey = process.env.VWORLD_API_KEY || '';
    const rawDefault = process.env.DEFAULT_MAP_PROVIDER;
    const defaultProvider: ProviderSlug =
      rawDefault === 'free-global' || rawDefault === 'google' || rawDefault === 'free-kr'
        ? rawDefault
        : 'free-kr';

    const availableProviders: ProviderSlug[] = ['free-kr', 'free-global'];
    if (mapsApiKey) {
      availableProviders.push('google');
    }

    res.json({
      defaultProvider,
      availableProviders,
      mapsApiKey,
      kakaoMapKey,
      mapillaryToken,
      vworldApiKey,
      hasGeminiGuide: Boolean(getGenAIClient()),
    });
  });

  app.post('/api/free/search', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      query?: string;
      mode?: 'autocomplete' | 'exact';
      limit?: number;
      lat?: number;
      lng?: number;
      provider?: ProviderSlug;
    };
    const query = typeof body.query === 'string' ? body.query.trim() : '';
    if (!query) {
      res.json({ places: [] });
      return;
    }

    const mode = body.mode === 'exact' ? 'exact' : 'autocomplete';
    const limit = Math.max(1, Math.min(8, Number(body.limit || 5)));
    const provider = body.provider || 'free-kr';
    const cacheKey = `${provider}:${mode}:${limit}:${query.toLowerCase()}`;
    const cached = freeSearchCache.get(cacheKey);
    if (cached) {
      res.json({ places: cached });
      return;
    }

    try {
      let places: Array<{
        name: string;
        address?: string;
        location: { lat: number; lng: number };
        placeId?: string;
      }> = [];

      if (provider === 'free-kr' && process.env.KAKAO_REST_API_KEY) {
        places = await queryKakaoKeywordSearch(query, limit);
      }

      if (places.length === 0) {
        const preferNominatim =
          mode === 'exact' && (query.includes(',') || /[a-zA-Z]/.test(query));

        places = preferNominatim
          ? await queryNominatimSearch(query, limit)
          : await queryPhotonSearch(query, limit, body.lat, body.lng);

        if (places.length === 0) {
          places = preferNominatim
            ? await queryPhotonSearch(query, limit, body.lat, body.lng)
            : await queryNominatimSearch(query, limit);
        }
      }

      if (places.length > 0) {
        if (freeSearchCache.size > 200) freeSearchCache.clear();
        freeSearchCache.set(cacheKey, places);
      }

      res.json({ places });
    } catch (err) {
      console.error('Free search error:', err);
      res.status(502).json({ error: '무료 장소 검색 서버 응답에 실패했습니다.', places: [] });
    }
  });

  app.post('/api/free/route', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      origin?: { lat?: number; lng?: number };
      destination?: { lat?: number; lng?: number };
      travelMode?: 'DRIVING' | 'WALKING';
      provider?: ProviderSlug;
    };

    const oLat = Number(body.origin?.lat);
    const oLng = Number(body.origin?.lng);
    const dLat = Number(body.destination?.lat);
    const dLng = Number(body.destination?.lng);

    if (
      !Number.isFinite(oLat) ||
      !Number.isFinite(oLng) ||
      !Number.isFinite(dLat) ||
      !Number.isFinite(dLng)
    ) {
      res.status(400).json({ error: '유효한 출발지/목적지 좌표가 필요합니다.' });
      return;
    }

    const travelMode = body.travelMode === 'WALKING' ? 'WALKING' : 'DRIVING';
    const provider = body.provider || 'free-kr';
    const kakaoRestKey = process.env.KAKAO_REST_API_KEY || '';

    // 1. Optional Kakao Mobility car routing when in free-kr with REST key
    if (travelMode === 'DRIVING' && provider === 'free-kr' && kakaoRestKey) {
      try {
        const kakaoUrl = new URL('https://apis-navi.kakaomobility.com/v1/directions');
        kakaoUrl.searchParams.set('origin', `${oLng},${oLat}`);
        kakaoUrl.searchParams.set('destination', `${dLng},${dLat}`);
        kakaoUrl.searchParams.set('priority', 'RECOMMEND');
        const kr = await fetch(kakaoUrl.toString(), {
          headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
          signal: AbortSignal.timeout(6500),
        });
        if (kr.ok) {
          const json = (await kr.json()) as {
            routes?: Array<{
              summary?: { distance?: number; duration?: number };
              sections?: Array<{
                roads?: Array<{
                  name?: string;
                  distance?: number;
                  duration?: number;
                  vertexes?: number[];
                }>;
              }>;
            }>;
          };
          const route = json.routes?.[0];
          if (route?.sections?.length) {
            const coordinates: Array<[number, number]> = [];
            const steps: Array<{
              distance: number;
              duration: number;
              name: string;
              maneuver: { type: string; location: [number, number] };
            }> = [];

            for (const sec of route.sections) {
              for (const road of sec.roads ?? []) {
                const v = road.vertexes ?? [];
                const firstLon = v[0];
                const firstLat = v[1];
                for (let i = 0; i < v.length - 1; i += 2) {
                  coordinates.push([v[i], v[i + 1]]);
                }
                if (road.name && Number.isFinite(firstLon) && Number.isFinite(firstLat)) {
                  steps.push({
                    name: road.name,
                    distance: road.distance ?? 0,
                    duration: road.duration ?? 0,
                    maneuver: {
                      type: steps.length === 0 ? 'depart' : 'continue',
                      location: [firstLon, firstLat],
                    },
                  });
                }
              }
            }

            if (coordinates.length >= 2) {
              res.json({
                code: 'Ok',
                source: 'kakao-mobility',
                routes: [
                  {
                    distance: route.summary?.distance ?? 0,
                    duration: route.summary?.duration ?? 60,
                    geometry: { type: 'LineString', coordinates },
                    legs: [{ steps }],
                  },
                ],
              });
              return;
            }
          }
        }
      } catch {
        // Fall through cleanly to OSRM
      }
    }

    // 2. Free OSRM Car / Foot routing
    const osrmProfile = travelMode === 'WALKING' ? 'foot' : 'driving';
    const primaryBase =
      travelMode === 'WALKING'
        ? process.env.OSRM_FOOT_BASE_URL || 'https://routing.openstreetmap.de/routed-foot'
        : process.env.OSRM_CAR_BASE_URL || 'https://router.project-osrm.org';

    const candidateUrls =
      travelMode === 'WALKING'
        ? [
            `${primaryBase}/route/v1/foot/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`,
            `https://router.project-osrm.org/route/v1/foot/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`,
          ]
        : [
            `${primaryBase}/route/v1/${osrmProfile}/${oLng},${oLat};${dLng},${dLat}?overview=full&geometries=geojson&steps=true`,
          ];

    try {
      for (const url of candidateUrls) {
        try {
          const resp = await fetch(url, {
            headers: { 'User-Agent': 'RoadWindow360/1.0' },
            signal: AbortSignal.timeout(8500),
          });
          if (!resp.ok) continue;
          const payload = (await resp.json()) as { code?: string };
          if (payload.code === 'Ok') {
            res.json(payload);
            return;
          }
        } catch {
          // Try next mirror
        }
      }
      res.status(404).json({ error: '출발지와 목적지 사이의 도로 경로를 찾지 못했습니다.' });
    } catch (err) {
      console.error('OSRM route error:', err);
      res.status(502).json({ error: '무료 경로 계산 중 시간 초과 또는 오류가 발생했습니다.' });
    }
  });

  app.post('/api/free/regions', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      points?: Array<{ lat?: number; lng?: number }>;
      provider?: ProviderSlug;
    };
    const rawPoints = Array.isArray(body.points) ? body.points.slice(0, 3) : [];
    const validPoints = rawPoints.filter(
      (p): p is { lat: number; lng: number } =>
        typeof p?.lat === 'number' &&
        Number.isFinite(p.lat) &&
        typeof p?.lng === 'number' &&
        Number.isFinite(p.lng)
    );

    const regions: string[] = [];
    const seen = new Set<string>();
    const kakaoRestKey = process.env.KAKAO_REST_API_KEY || '';
    const baseUrl = process.env.NOMINATIM_BASE_URL || 'https://nominatim.openstreetmap.org';
    const ua = process.env.NOMINATIM_USER_AGENT || 'RoadWindow360/1.0 (free-nav-proxy)';

    for (const pt of validPoints) {
      const key = `${pt.lat.toFixed(3)},${pt.lng.toFixed(3)}`;
      let label = freeReverseCache.get(key);

      if (!label && kakaoRestKey) {
        try {
          const kUrl = new URL('https://dapi.kakao.com/v2/local/geo/coord2regioncode.json');
          kUrl.searchParams.set('x', String(pt.lng));
          kUrl.searchParams.set('y', String(pt.lat));
          const kr = await fetch(kUrl.toString(), {
            headers: { Authorization: `KakaoAK ${kakaoRestKey}` },
            signal: AbortSignal.timeout(4000),
          });
          if (kr.ok) {
            const kData = (await kr.json()) as {
              documents?: Array<{ region_2depth_name?: string; region_3depth_name?: string }>;
            };
            const doc = kData.documents?.[0];
            const kLabel = [doc?.region_2depth_name, doc?.region_3depth_name]
              .filter(Boolean)
              .join(' ')
              .trim();
            if (kLabel) {
              label = kLabel;
              freeReverseCache.set(key, label);
            }
          }
        } catch {
          // Non-fatal fallback
        }
      }

      if (!label) {
        try {
          const url = new URL(`${baseUrl}/reverse`);
          url.searchParams.set('lat', String(pt.lat));
          url.searchParams.set('lon', String(pt.lng));
          url.searchParams.set('format', 'jsonv2');
          url.searchParams.set('accept-language', 'ko,en');

          const resp = await fetch(url.toString(), {
            headers: { 'User-Agent': ua },
            signal: AbortSignal.timeout(5000),
          });
          if (resp.ok) {
            const data = (await resp.json()) as {
              address?: {
                borough?: string;
                city_district?: string;
                suburb?: string;
                quarter?: string;
                neighbourhood?: string;
                city?: string;
                town?: string;
                county?: string;
              };
            };
            const a = data.address ?? {};
            const district = a.borough || a.city_district || a.city || a.town || a.county || '';
            const sub = a.suburb || a.quarter || a.neighbourhood || '';
            const parts = [district, sub].filter(Boolean);
            label = Array.from(new Set(parts)).join(' ').trim();
            if (label) {
              if (freeReverseCache.size > 300) freeReverseCache.clear();
              freeReverseCache.set(key, label);
            }
          }
        } catch {
          // Non-fatal
        }
      }

      if (label && !seen.has(label)) {
        seen.add(label);
        regions.push(label);
      }
    }

    res.json({ regions });
  });

  app.post('/api/free/nearby', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as {
      lat?: number;
      lng?: number;
      query?: string;
    };
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    const customQuery = typeof body.query === 'string' ? body.query.trim() : '';

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ error: '유효한 좌표가 필요합니다.' });
      return;
    }

    try {
      const searchQ = customQuery || 'cafe restaurant park';
      const photonItems = await queryPhotonSearch(searchQ, 6, lat, lng);
      const places: GroundedPlaceLink[] = photonItems.map((item) => ({
        title: item.name,
        uri: `https://www.openstreetmap.org/?mlat=${item.location.lat.toFixed(5)}&mlon=${item.location.lng.toFixed(5)}#map=17/${item.location.lat.toFixed(5)}/${item.location.lng.toFixed(5)}`,
        placeId: item.placeId,
        reviewSnippets: item.address ? [item.address] : [],
      }));

      const summary =
        places.length > 0
          ? `OpenStreetMap 무료 위치 데이터 기준으로 주변 장소 ${places.length}곳을 조회했습니다.`
          : '현재 반경에서 등록된 주변 장소를 찾지 못했습니다. 검색어를 입력해 탐색해 보세요.';

      res.json({ summary, places });
    } catch {
      res.status(502).json({ error: '무료 주변 장소 검색에 실패했습니다.' });
    }
  });

  // Free street-level photo lookup proxy (Mapillary -> KartaView -> Wikimedia Commons geotagged photo)
  app.get('/api/free/streetphoto', async (req: Request, res: Response) => {
    const lat = Number(req.query.lat);
    const lng = Number(req.query.lng);
    const heading = Number(req.query.heading ?? 0);

    if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
      res.status(400).json({ photo: null });
      return;
    }

    const cacheKey = `${lat.toFixed(4)},${lng.toFixed(4)},${Math.round(heading / 30)}`;
    if (streetPhotoCache.has(cacheKey)) {
      res.json({ photo: streetPhotoCache.get(cacheKey) ?? null });
      return;
    }

    let found: {
      imageUrl: string;
      headingDeg?: number;
      provider: 'mapillary' | 'kartaview' | 'wikimedia';
      lat: number;
      lng: number;
      capturedAt?: string;
      caption?: string;
    } | null = null;

    const mapillaryToken = process.env.MAPILLARY_CLIENT_TOKEN || '';
    if (mapillaryToken) {
      try {
        const d = 0.0009;
        const mUrl = new URL('https://graph.mapillary.com/images');
        mUrl.searchParams.set('access_token', mapillaryToken);
        mUrl.searchParams.set(
          'fields',
          'id,thumb_1024_url,computed_geometry,compass_angle,captured_at'
        );
        mUrl.searchParams.set('bbox', `${lng - d},${lat - d},${lng + d},${lat + d}`);
        mUrl.searchParams.set('limit', '8');

        const mr = await fetch(mUrl.toString(), { signal: AbortSignal.timeout(4500) });
        if (mr.ok) {
          const mj = (await mr.json()) as {
            data?: Array<{
              id?: string;
              thumb_1024_url?: string;
              compass_angle?: number;
              captured_at?: number;
              computed_geometry?: { coordinates?: [number, number] };
            }>;
          };
          const candidates = (mj.data ?? []).filter((item) => Boolean(item.thumb_1024_url));
          if (candidates.length > 0) {
            candidates.sort((a, b) => {
              const da =
                typeof a.compass_angle === 'number'
                  ? angularDiffDeg(heading, a.compass_angle)
                  : 90;
              const db =
                typeof b.compass_angle === 'number'
                  ? angularDiffDeg(heading, b.compass_angle)
                  : 90;
              return da - db;
            });
            const best = candidates[0];
            found = {
              imageUrl: best.thumb_1024_url!,
              headingDeg: best.compass_angle,
              provider: 'mapillary',
              lat: best.computed_geometry?.coordinates?.[1] ?? lat,
              lng: best.computed_geometry?.coordinates?.[0] ?? lng,
              capturedAt: best.captured_at
                ? new Date(best.captured_at).toISOString().slice(0, 10)
                : undefined,
            };
          }
        }
      } catch {
        // Non-fatal fallback to KartaView
      }
    }

    if (!found) {
      try {
        const kUrl = new URL('https://api.openstreetcam.org/2.0/photo/');
        kUrl.searchParams.set('lat', String(lat));
        kUrl.searchParams.set('lng', String(lng));
        kUrl.searchParams.set('radius', '450');
        kUrl.searchParams.set('ipp', '10');

        const kr = await fetch(kUrl.toString(), {
          headers: { 'User-Agent': 'RoadWindow360/1.0' },
          signal: AbortSignal.timeout(4500),
        });
        if (kr.ok) {
          const kj = (await kr.json()) as {
            result?: {
              data?: Array<{
                lat?: string | number;
                lng?: string | number;
                heading?: string | number;
                fileurlLTh?: string;
                fileurlProc?: string;
                shotDate?: string;
              }>;
            };
          };
          const rows = (kj.result?.data ?? []).filter(
            (r) => Boolean(r.fileurlProc || r.fileurlLTh)
          );
          if (rows.length > 0) {
            rows.sort((a, b) => {
              const ha = Number(a.heading);
              const hb = Number(b.heading);
              const da = Number.isFinite(ha) ? angularDiffDeg(heading, ha) : 90;
              const db = Number.isFinite(hb) ? angularDiffDeg(heading, hb) : 90;
              return da - db;
            });
            const best = rows[0];
            found = {
              imageUrl: toHttpsUrl(best.fileurlProc || best.fileurlLTh),
              headingDeg: Number.isFinite(Number(best.heading))
                ? Number(best.heading)
                : undefined,
              provider: 'kartaview',
              lat: Number(best.lat) || lat,
              lng: Number(best.lng) || lng,
              capturedAt: best.shotDate?.slice(0, 10),
            };
          }
        }
      } catch {
        // Non-fatal fallback to Wikimedia Commons
      }
    }

    if (!found) {
      try {
        const wUrl = new URL('https://commons.wikimedia.org/w/api.php');
        wUrl.searchParams.set('action', 'query');
        wUrl.searchParams.set('generator', 'geosearch');
        wUrl.searchParams.set('ggscoord', `${lat}|${lng}`);
        wUrl.searchParams.set('ggsradius', '4000');
        wUrl.searchParams.set('ggslimit', '12');
        wUrl.searchParams.set('ggsnamespace', '6');
        wUrl.searchParams.set('prop', 'imageinfo|coordinates');
        wUrl.searchParams.set('iiprop', 'url|mime|timestamp');
        wUrl.searchParams.set('iiurlwidth', '1280');
        wUrl.searchParams.set('format', 'json');

        const wr = await fetch(wUrl.toString(), {
          headers: { 'User-Agent': 'RoadWindow360/1.0 (street-photo-fallback)' },
          signal: AbortSignal.timeout(4500),
        });
        if (wr.ok) {
          const wj = (await wr.json()) as {
            query?: {
              pages?: Record<
                string,
                {
                  title?: string;
                  coordinates?: Array<{ lat?: number; lon?: number }>;
                  imageinfo?: Array<{
                    thumburl?: string;
                    url?: string;
                    mime?: string;
                    timestamp?: string;
                  }>;
                }
              >;
            };
          };
          const pages = Object.values(wj.query?.pages ?? {});
          const valid = pages
            .map((p) => {
              const info = p.imageinfo?.[0];
              const coord = p.coordinates?.[0];
              const mime = info?.mime || '';
              const imgUrl = toHttpsUrl(info?.thumburl || info?.url);
              if (
                !imgUrl ||
                (!mime.startsWith('image/jpeg') &&
                  !mime.startsWith('image/png') &&
                  !mime.startsWith('image/webp'))
              ) {
                return null;
              }
              const pLat = coord?.lat ?? lat;
              const pLng = coord?.lon ?? lng;
              const distApprox = Math.hypot(pLat - lat, pLng - lng);
              return {
                imageUrl: imgUrl,
                lat: pLat,
                lng: pLng,
                distApprox,
                capturedAt: info?.timestamp?.slice(0, 10),
                caption: p.title?.replace(/^File:/i, '').replace(/\.[^.]+$/, ''),
              };
            })
            .filter((x): x is NonNullable<typeof x> => Boolean(x))
            .sort((a, b) => a.distApprox - b.distApprox);

          if (valid.length > 0) {
            const best = valid[0];
            found = {
              imageUrl: best.imageUrl,
              provider: 'wikimedia',
              lat: best.lat,
              lng: best.lng,
              capturedAt: best.capturedAt,
              caption: best.caption,
            };
          }
        }
      } catch {
        // Non-fatal
      }
    }

    if (streetPhotoCache.size > 240) streetPhotoCache.clear();
    streetPhotoCache.set(cacheKey, found);
    res.json({ photo: found });
  });

  app.post('/api/geocode/regions', async (req: Request, res: Response) => {
    const mapsApiKey = getValidGoogleMapsKey();
    if (!mapsApiKey) {
      res.json({ regions: [], fallbackRequired: true });
      return;
    }

    const body = (req.body ?? {}) as {
      points?: Array<{ lat?: number; lng?: number }>;
    };
    const rawPoints = Array.isArray(body.points) ? body.points.slice(0, 5) : [];
    const validPoints = rawPoints.filter(
      (p): p is { lat: number; lng: number } =>
        typeof p?.lat === 'number' &&
        Number.isFinite(p.lat) &&
        typeof p?.lng === 'number' &&
        Number.isFinite(p.lng)
    );

    if (validPoints.length === 0) {
      res.json({ regions: [] });
      return;
    }

    const regions: string[] = [];
    const seen = new Set<string>();
    let fallbackRequired = false;

    try {
      const results = await Promise.all(
        validPoints.map(async (pt) => {
          const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
          url.searchParams.set('latlng', `${pt.lat},${pt.lng}`);
          url.searchParams.set('language', 'ko');
          url.searchParams.set(
            'result_type',
            'sublocality_level_2|sublocality_level_1|locality|administrative_area_level_2'
          );
          url.searchParams.set('key', mapsApiKey);

          const resp = await fetch(url.toString());
          if (!resp.ok) return null;
          return (await resp.json()) as {
            status?: string;
            results?: Array<{
              formatted_address?: string;
              address_components?: Array<{
                long_name?: string;
                types?: string[];
              }>;
            }>;
          };
        })
      );

      for (const data of results) {
        if (!data) continue;
        if (
          data.status === 'REQUEST_DENIED' ||
          data.status === 'OVER_QUERY_LIMIT'
        ) {
          fallbackRequired = true;
          continue;
        }
        const first = data.results?.[0];
        if (!first?.address_components) continue;

        const sub1 = first.address_components.find((c) =>
          c.types?.includes('sublocality_level_1')
        )?.long_name;
        const sub2 = first.address_components.find((c) =>
          c.types?.includes('sublocality_level_2')
        )?.long_name;
        const locality = first.address_components.find((c) =>
          c.types?.includes('locality')
        )?.long_name;
        const admin2 = first.address_components.find((c) =>
          c.types?.includes('administrative_area_level_2')
        )?.long_name;

        const labelParts = [sub1 || admin2 || locality, sub2].filter(Boolean);
        const label =
          labelParts.length > 0
            ? Array.from(new Set(labelParts)).join(' ')
            : first.formatted_address?.split(',')[0]?.trim() || '';

        if (label && !seen.has(label)) {
          seen.add(label);
          regions.push(label);
        }
      }
    } catch {
      fallbackRequired = true;
    }

    res.json({ regions, fallbackRequired });
  });

  app.post('/api/grounding/guide', async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as GroundingGuideBody;
    const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
    const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;
    const mode = body.mode || 'nearby';
    const rawQuery = typeof body.query === 'string' ? body.query.trim() : '';
    const placeName = typeof body.placeName === 'string' ? body.placeName.trim() : '';
    const landmarkName =
      typeof body.landmarkName === 'string' ? body.landmarkName.trim() : '';
    const altitudeMeters =
      typeof body.altitudeMeters === 'number' && Number.isFinite(body.altitudeMeters)
        ? Math.round(body.altitudeMeters)
        : 3200;

    if (!rawQuery && !placeName && !landmarkName && (lat === null || lng === null)) {
      res.status(400).json({ error: '위치 좌표 또는 검색어가 필요합니다.' });
      return;
    }

    const ai = getGenAIClient();
    if (!ai) {
      // Static curated flight landmark + OSM link fallback so guide never blocks when GEMINI_API_KEY is unset
      if (mode === 'flight') {
        const matchedEntry = Object.entries(FLIGHT_FALLBACK_BRIEFS).find(([key]) =>
          (landmarkName || placeName).includes(key)
        );
        const brief = matchedEntry?.[1] ?? {
          summary: `${landmarkName || placeName || '한반도 상공'} 고도 ${altitudeMeters.toLocaleString()}m 비행 중입니다. 아래 창밖 지형 지점을 눌러 지도로 자세히 확인할 수 있습니다.`,
          highlights: ['한반도 주요 산맥', '수계 경관'],
        };
        const places: GroundedPlaceLink[] = brief.highlights.map((title) => ({
          title,
          uri:
            lat !== null && lng !== null
              ? `https://www.openstreetmap.org/?mlat=${lat.toFixed(4)}&mlon=${lng.toFixed(4)}#map=11/${lat.toFixed(4)}/${lng.toFixed(4)}`
              : 'https://www.openstreetmap.org',
          reviewSnippets: [`현재 고도 ${altitudeMeters.toLocaleString()}m 상공 조망`],
        }));
        res.json({ summary: brief.summary, places });
        return;
      }

      if (lat !== null && lng !== null) {
        try {
          const searchQ = rawQuery || (placeName ? `${placeName} 주변` : 'cafe restaurant park');
          const items = await queryPhotonSearch(searchQ, 5, lat, lng);
          const places: GroundedPlaceLink[] = items.map((item) => ({
            title: item.name,
            uri: `https://www.openstreetmap.org/?mlat=${item.location.lat.toFixed(5)}&mlon=${item.location.lng.toFixed(5)}#map=17/${item.location.lat.toFixed(5)}/${item.location.lng.toFixed(5)}`,
            placeId: item.placeId,
            reviewSnippets: item.address ? [item.address] : [],
          }));
          res.json({
            summary:
              places.length > 0
                ? `OpenStreetMap 무료 위치 데이터 기준으로 주변 추천 장소 ${places.length}곳을 안내합니다.`
                : '근처에서 등록된 장소를 찾지 못했습니다.',
            places,
          });
          return;
        } catch {
          // Fall through cleanly
        }
      }

      res.json({
        summary: '실시간 AI 가이드 키가 설정되어 있지 않아 기본 오픈소스 지도 안내를 사용합니다.',
        places: [],
      });
      return;
    }

    let prompt = '';
    if (mode === 'flight') {
      const targetName = landmarkName || placeName || '한반도 상공';
      prompt = `부산(PUS)에서 서울(GMP)로 향하는 국내선 항공기가 고도 ${altitudeMeters}m에서 "${targetName}" 상공을 통과하고 있습니다. 기장/승무원 기내 안내 방송 스타일로 창밖 지형·산맥·강·도시 포인트를 3~4줄 한국어로 생생하게 브리핑해 주세요.`;
    } else if (mode === 'destination' && placeName) {
      prompt = `사용자가 360도 가상 여행으로 "${placeName}"에 가고 있거나 도착 예정입니다. 이 장소와 바로 근처의 핵심 볼거리, 분위기, 추천 들를 곳 3~4곳을 한국어로 간결하고 생생하게 안내해 주세요.`;
    } else if (mode === 'search' && rawQuery) {
      prompt = `사용자가 "${rawQuery}"에 대해 드라이브 목적지나 주변 명소/맛집을 찾고 있습니다. 실제 존재하는 추천 장소 3~4곳과 특징을 한국어로 간결하게 정리해 주세요.`;
    } else {
      const locationContext = placeName ? `(${placeName} 부근)` : '';
      prompt = `현재 위치 ${locationContext} 주변에서 창밖으로 보거나 들르기 좋은 실제 랜드마크, 명소, 카페·맛집 3~4곳을 한국어로 간결하게 브리핑해 주세요.`;
    }

    try {
      const config: {
        tools: Array<{ googleMaps: Record<string, never> }>;
        toolConfig?: {
          retrievalConfig: {
            latLng: { latitude: number; longitude: number };
          };
        };
      } = {
        tools: [{ googleMaps: {} }],
      };

      if (lat !== null && lng !== null) {
        config.toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng,
            },
          },
        };
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config,
      });

      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const places: GroundedPlaceLink[] = [];
      const seenUris = new Set<string>();

      for (const chunk of chunks) {
        const mapsData = (chunk as {
          maps?: {
            uri?: string;
            title?: string;
            placeId?: string;
            placeAnswerSources?: {
              reviewSnippets?: Array<{ reviewText?: string } | string>;
            };
          };
        }).maps;

        if (!mapsData || !mapsData.uri || seenUris.has(mapsData.uri)) {
          continue;
        }
        seenUris.add(mapsData.uri);

        const rawSnippets = mapsData.placeAnswerSources?.reviewSnippets ?? [];
        const reviewSnippets: string[] = [];
        for (const snippet of rawSnippets) {
          if (typeof snippet === 'string' && snippet.trim()) {
            reviewSnippets.push(snippet.trim());
          } else if (
            snippet &&
            typeof snippet === 'object' &&
            typeof snippet.reviewText === 'string' &&
            snippet.reviewText.trim()
          ) {
            reviewSnippets.push(snippet.reviewText.trim());
          }
        }

        places.push({
          title: mapsData.title || 'Google 지도 장소',
          uri: mapsData.uri,
          placeId: mapsData.placeId,
          reviewSnippets: reviewSnippets.slice(0, 2),
        });
      }

      res.json({
        summary: response.text ?? '',
        places,
      });
    } catch (error) {
      const errObj = error as { status?: number; message?: string };
      const status = typeof errObj?.status === 'number' ? errObj.status : 500;
      console.error('Maps Grounding error:', errObj?.message || error);

      if (status === 429) {
        res.status(429).json({
          error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
        });
        return;
      }
      if (status === 403 || status === 400) {
        res.status(status).json({
          error: errObj?.message || 'Maps Grounding 요청을 처리할 수 없습니다.',
        });
        return;
      }
      res.status(500).json({
        error: '주변 AI 가이드 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RoadWindow 360 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
