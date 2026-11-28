import {
  buildCumulativeDistances,
  haversineMeters,
  type LatLngPoint,
  type RouteStepInfo,
} from '../engine/routeSimulation';
import type {
  ComputedRouteData,
  GroundedPlaceLink,
  GroundingGuideResponse,
  MapProviderMode,
  SelectedPlaceInfo,
  TravelModeOption,
} from '../types/drive';

export interface PhotonFeature {
  geometry?: {
    coordinates?: [number, number];
  };
  properties?: {
    osm_id?: number | string;
    name?: string;
    street?: string;
    district?: string;
    city?: string;
    state?: string;
    country?: string;
    postcode?: string;
  };
}

export interface NominatimItem {
  place_id?: number | string;
  lat?: string | number;
  lon?: string | number;
  name?: string;
  display_name?: string;
  address?: {
    road?: string;
    suburb?: string;
    borough?: string;
    city_district?: string;
    city?: string;
    town?: string;
    county?: string;
    state?: string;
    country?: string;
  };
}

export interface OsrmStepPayload {
  distance?: number;
  duration?: number;
  name?: string;
  maneuver?: {
    type?: string;
    modifier?: string;
    location?: [number, number];
  };
}

export interface OsrmRouteResponse {
  code?: string;
  routes?: Array<{
    distance?: number;
    duration?: number;
    geometry?: {
      type?: string;
      coordinates?: Array<[number, number]>;
    };
    legs?: Array<{
      steps?: OsrmStepPayload[];
    }>;
  }>;
}

export function parsePhotonFeatures(
  features: PhotonFeature[] | undefined
): SelectedPlaceInfo[] {
  if (!Array.isArray(features)) return [];
  const results: SelectedPlaceInfo[] = [];

  for (const f of features) {
    const coords = f?.geometry?.coordinates;
    if (!Array.isArray(coords) || coords.length < 2) continue;
    const lng = Number(coords[0]);
    const lat = Number(coords[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const p = f.properties ?? {};
    const name =
      p.name?.trim() ||
      p.street?.trim() ||
      p.district?.trim() ||
      p.city?.trim() ||
      `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    const addressParts = [
      p.country,
      p.state,
      p.city,
      p.district,
      p.street,
    ]
      .map((s) => (typeof s === 'string' ? s.trim() : ''))
      .filter(Boolean);

    results.push({
      name,
      address:
        addressParts.length > 0
          ? Array.from(new Set(addressParts)).join(' ')
          : undefined,
      location: { lat, lng },
      placeId: p.osm_id ? `osm:${String(p.osm_id)}` : undefined,
    });
  }

  return results;
}

export function parseNominatimResults(
  items: NominatimItem[] | undefined
): SelectedPlaceInfo[] {
  if (!Array.isArray(items)) return [];
  const results: SelectedPlaceInfo[] = [];

  for (const item of items) {
    const lat = Number(item?.lat);
    const lng = Number(item?.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;

    const display = (item.display_name || '').trim();
    const fallbackFirst = display.split(',')[0]?.trim() || '';
    const name = item.name?.trim() || fallbackFirst || `${lat.toFixed(4)}, ${lng.toFixed(4)}`;

    results.push({
      name,
      address: display || undefined,
      location: { lat, lng },
      placeId: item.place_id ? `nominatim:${String(item.place_id)}` : undefined,
    });
  }

  return results;
}

function mapOsrmManeuverCode(type?: string, modifier?: string): string | undefined {
  const t = (type || '').toLowerCase();
  const m = (modifier || '').toLowerCase();
  if (t === 'arrive') return 'ARRIVE';
  if (m.includes('uturn')) return 'UTURN';
  if (m.includes('left')) return 'LEFT';
  if (m.includes('right')) return 'RIGHT';
  return undefined;
}

function formatOsrmKoreanInstruction(step: OsrmStepPayload): string {
  const type = (step.maneuver?.type || '').toLowerCase();
  const mod = (step.maneuver?.modifier || '').toLowerCase();
  const road = (step.name || '').trim();
  const roadPrefix = road ? `${road} 방면으로 ` : '';

  if (type === 'arrive') {
    return road ? `${road} 목적지 도착` : '목적지 부근 도착';
  }
  if (type === 'depart') {
    return road ? `${road} 따라 출발` : '경로를 따라 출발';
  }
  if (mod.includes('uturn')) {
    return `${roadPrefix}유턴`;
  }
  if (mod === 'sharp left' || mod === 'left') {
    return `${roadPrefix}좌회전`;
  }
  if (mod === 'slight left') {
    return `${roadPrefix}왼쪽 방향 주행`;
  }
  if (mod === 'sharp right' || mod === 'right') {
    return `${roadPrefix}우회전`;
  }
  if (mod === 'slight right') {
    return `${roadPrefix}오른쪽 방향 주행`;
  }
  if (type === 'roundabout' || type === 'rotary') {
    return road ? `회전교차로에서 ${road} 방면 진출` : '회전교차로 통과';
  }
  return road ? `${road} 따라 직진` : '도로를 따라 직진';
}

export function parseOsrmRouteResponse(
  payload: OsrmRouteResponse,
  origin: SelectedPlaceInfo,
  destination: SelectedPlaceInfo,
  travelMode: TravelModeOption
): ComputedRouteData {
  const route = payload?.routes?.[0];
  if (!route || payload.code !== 'Ok') {
    throw new Error('무료 경로 엔진(OSRM)에서 출발지와 목적지 간 경로를 찾지 못했습니다.');
  }

  const rawCoords = route.geometry?.coordinates ?? [];
  const path: LatLngPoint[] = [];
  for (const coord of rawCoords) {
    if (!Array.isArray(coord) || coord.length < 2) continue;
    const lng = Number(coord[0]);
    const lat = Number(coord[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const prev = path[path.length - 1];
    if (
      !prev ||
      Math.abs(prev.lat - lat) > 1e-6 ||
      Math.abs(prev.lng - lng) > 1e-6
    ) {
      path.push({ lat, lng });
    }
  }

  if (path.length < 2) {
    path.push(origin.location, destination.location);
  }

  const cumDistances = buildCumulativeDistances(path);
  const pathTotal =
    cumDistances[cumDistances.length - 1] ||
    route.distance ||
    haversineMeters(origin.location, destination.location);

  const steps: RouteStepInfo[] = [];
  let runningDist = 0;

  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const dist = Math.max(0, Number(step.distance ?? 0));
      const dur = Math.max(0, Math.round(Number(step.duration ?? 0)));
      const loc = step.maneuver?.location;
      const startLocation: LatLngPoint =
        Array.isArray(loc) &&
        loc.length >= 2 &&
        Number.isFinite(Number(loc[1])) &&
        Number.isFinite(Number(loc[0]))
          ? { lat: Number(loc[1]), lng: Number(loc[0]) }
          : path[0] ?? origin.location;

      steps.push({
        index: steps.length,
        instructions: formatOsrmKoreanInstruction(step),
        maneuver: mapOsrmManeuverCode(
          step.maneuver?.type,
          step.maneuver?.modifier
        ),
        distanceMeters: dist,
        durationSeconds: dur,
        startDistanceMeters: runningDist,
        endDistanceMeters: runningDist + dist,
        startLocation,
        endLocation: destination.location,
      });
      runningDist += dist;
    }
  }

  const estimatedDurationSeconds = Math.max(
    60,
    Math.round(Number(route.duration ?? 0))
  );

  return {
    origin,
    destination,
    travelMode,
    path,
    cumDistances,
    totalDistanceMeters: pathTotal,
    estimatedDurationSeconds,
    steps,
  };
}

export async function searchFreePlaces(
  query: string,
  mode: 'autocomplete' | 'exact' = 'autocomplete',
  limit = 5,
  provider: MapProviderMode = 'free-kr'
): Promise<SelectedPlaceInfo[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const resp = await fetch('/api/free/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: trimmed, mode, limit, provider }),
  });

  if (!resp.ok) {
    throw new Error('무료 장소 검색 서버 응답을 받지 못했습니다.');
  }
  const data = (await resp.json()) as { places?: SelectedPlaceInfo[] };
  return Array.isArray(data.places) ? data.places : [];
}

export async function resolveFreePlaceByQuery(
  query: string,
  provider: MapProviderMode = 'free-kr'
): Promise<SelectedPlaceInfo | null> {
  const places = await searchFreePlaces(query, 'exact', 1, provider);
  return places[0] ?? null;
}

export async function computeFreeDrivingRoute(
  origin: SelectedPlaceInfo,
  destination: SelectedPlaceInfo,
  travelMode: TravelModeOption,
  provider: MapProviderMode = 'free-kr'
): Promise<ComputedRouteData> {
  const resp = await fetch('/api/free/route', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      origin: origin.location,
      destination: destination.location,
      travelMode,
      provider,
    }),
  });

  const payload = (await resp.json()) as OsrmRouteResponse & { error?: string };
  if (!resp.ok) {
    throw new Error(
      payload?.error || '무료 경로 엔진(OSRM) 요청에 실패했습니다.'
    );
  }
  return parseOsrmRouteResponse(payload, origin, destination, travelMode);
}

export async function fetchFreeNearbyGuide(
  lat: number,
  lng: number,
  query?: string
): Promise<GroundingGuideResponse> {
  const resp = await fetch('/api/free/nearby', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lat, lng, query }),
  });
  if (!resp.ok) {
    throw new Error('무료 주변 장소 검색에 실패했습니다.');
  }
  const data = (await resp.json()) as {
    summary?: string;
    places?: GroundedPlaceLink[];
  };
  return {
    summary: data.summary || '',
    places: Array.isArray(data.places) ? data.places : [],
  };
}

export interface FreeStreetPhotoResult {
  imageUrl: string;
  headingDeg?: number;
  provider: 'mapillary' | 'kartaview' | 'wikimedia';
  lat: number;
  lng: number;
  capturedAt?: string;
  caption?: string;
}

export async function fetchFreeStreetPhoto(
  lat: number,
  lng: number,
  heading: number
): Promise<FreeStreetPhotoResult | null> {
  try {
    const url = `/api/free/streetphoto?lat=${encodeURIComponent(String(lat))}&lng=${encodeURIComponent(String(lng))}&heading=${encodeURIComponent(String(Math.round(heading)))}`;
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const data = (await resp.json()) as { photo?: FreeStreetPhotoResult | null };
    return data.photo ?? null;
  } catch {
    return null;
  }
}

export async function fetchFlightGuideBriefing(params: {
  landmarkName: string;
  altitudeMeters: number;
  lat: number;
  lng: number;
}): Promise<GroundingGuideResponse> {
  const resp = await fetch('/api/grounding/guide', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      mode: 'flight',
      landmarkName: params.landmarkName,
      placeName: params.landmarkName,
      altitudeMeters: params.altitudeMeters,
      lat: params.lat,
      lng: params.lng,
    }),
  });
  if (!resp.ok) {
    return {
      summary: `${params.landmarkName} 상공 ${Math.round(params.altitudeMeters).toLocaleString()}m를 통과하고 있습니다.`,
      places: [],
    };
  }
  const data = (await resp.json()) as GroundingGuideResponse;
  return {
    summary: data.summary || '',
    places: Array.isArray(data.places) ? data.places : [],
  };
}
