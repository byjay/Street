import {
  buildCumulativeDistances,
  haversineMeters,
  type LatLngPoint,
  type RouteStepInfo,
} from '../engine/routeSimulation';
import type {
  ComputedRouteData,
  SelectedPlaceInfo,
  TravelModeOption,
} from '../types/drive';

export function checkQuotaError(err: unknown): boolean {
  if (!err) return false;
  const text =
    err instanceof Error
      ? `${err.name} ${err.message}`
      : typeof err === 'object'
        ? JSON.stringify(err)
        : String(err);

  const isQuota =
    text.includes('OVER_QUERY_LIMIT') ||
    text.includes('RESOURCE_EXHAUSTED') ||
    text.includes('OverQuotaMapError') ||
    text.includes('QuotaExceededError') ||
    text.includes('429');

  if (isQuota && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('gmp-quota-exceeded'));
  }
  return isQuota;
}

export function toLatLngLiteral(raw: unknown): LatLngPoint | null {
  if (!raw || typeof raw !== 'object') return null;

  const obj = raw as Record<string, unknown>;

  if ('latLng' in obj && obj.latLng) {
    return toLatLngLiteral(obj.latLng);
  }

  if (typeof obj.lat === 'function' && typeof obj.lng === 'function') {
    const lat = (obj.lat as () => number)();
    const lng = (obj.lng as () => number)();
    if (Number.isFinite(lat) && Number.isFinite(lng)) {
      return { lat, lng };
    }
  }

  if (typeof obj.lat === 'number' && typeof obj.lng === 'number') {
    if (Number.isFinite(obj.lat) && Number.isFinite(obj.lng)) {
      return { lat: obj.lat, lng: obj.lng };
    }
  }

  return null;
}

export async function resolvePlaceByQuery(
  placesLib: google.maps.PlacesLibrary,
  textQuery: string
): Promise<SelectedPlaceInfo | null> {
  try {
    const { places } = await placesLib.Place.searchByText({
      textQuery,
      fields: ['id', 'displayName', 'formattedAddress', 'location'],
      maxResultCount: 1,
    });
    const first = places?.[0];
    if (!first?.location) return null;
    const coords = toLatLngLiteral(first.location);
    if (!coords) return null;

    return {
      name: first.displayName || textQuery,
      address: first.formattedAddress || undefined,
      location: coords,
      placeId: first.id || undefined,
    };
  } catch (err) {
    checkQuotaError(err);
    throw err;
  }
}

export interface ComputedRouteBundle {
  data: ComputedRouteData;
  rawRoute: google.maps.routes.Route;
}

function extractStepPoints(route: google.maps.routes.Route): LatLngPoint[] {
  const stepPoints: LatLngPoint[] = [];
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const pts = (step as { path?: unknown[] }).path ?? [];
      for (const pt of pts) {
        const literal = toLatLngLiteral(pt);
        if (!literal) continue;
        const prev = stepPoints[stepPoints.length - 1];
        if (
          !prev ||
          Math.abs(prev.lat - literal.lat) > 1e-6 ||
          Math.abs(prev.lng - literal.lng) > 1e-6
        ) {
          stepPoints.push(literal);
        }
      }
    }
  }
  return stepPoints;
}

function scoreSurfaceTransitRoute(route: google.maps.routes.Route): number {
  const distKm = (route.distanceMeters ?? 5000) / 1000;
  let score = Math.min(40, route.path?.length ?? 0) - distKm * 35;
  for (const leg of route.legs ?? []) {
    for (const step of leg.steps ?? []) {
      const s = step as {
        travelMode?: string;
        instructions?: string;
        transitDetails?: {
          transitLine?: { vehicle?: { type?: string } };
        };
      };
      const vType = s.transitDetails?.transitLine?.vehicle?.type?.toUpperCase() || '';
      const instr = s.instructions || '';
      if (vType === 'BUS' || instr.includes('버스')) {
        score += 500;
      } else if (vType.includes('SUBWAY') || instr.includes('지하철')) {
        score -= 300;
      }
    }
  }
  return score;
}

export async function computeDrivingRoute(
  routesLib: google.maps.RoutesLibrary,
  origin: SelectedPlaceInfo,
  destination: SelectedPlaceInfo,
  travelMode: TravelModeOption
): Promise<ComputedRouteBundle> {
  try {
    const request: google.maps.routes.ComputeRoutesRequest = {
      origin: origin.location,
      destination: destination.location,
      travelMode: travelMode as google.maps.TravelModeString,
      polylineQuality: 'HIGH_QUALITY' as google.maps.routes.PolylineQualityString,
      fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
      internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
    };

    let { routes } = await routesLib.Route.computeRoutes(request);
    let usedSurfaceTransitFallback = false;

    // Fallback for regions (e.g. South Korea) where DRIVING/WALKING routes are restricted
    if (!routes || routes.length === 0) {
      const transitRes = await routesLib.Route.computeRoutes({
        origin: origin.location,
        destination: destination.location,
        travelMode: 'TRANSIT' as google.maps.TravelModeString,
        computeAlternativeRoutes: true,
        polylineQuality: 'HIGH_QUALITY' as google.maps.routes.PolylineQualityString,
        fields: ['path', 'distanceMeters', 'durationMillis', 'viewport', 'legs'],
        internalUsageAttributionIds: ['gmp_mcp_codeassist_v1_aistudio'],
      });
      if (transitRes.routes && transitRes.routes.length > 0) {
        routes = [...transitRes.routes].sort(
          (a, b) => scoreSurfaceTransitRoute(b) - scoreSurfaceTransitRoute(a)
        );
        usedSurfaceTransitFallback = true;
      }
    }

    if (!routes || routes.length === 0) {
      throw new Error('선택한 출발지와 목적지 사이의 경로를 찾을 수 없습니다.');
    }

    const route = routes[0];

    const topPath: LatLngPoint[] = [];
    for (const pt of route.path ?? []) {
      const literal = toLatLngLiteral(pt);
      if (literal) topPath.push(literal);
    }

    const stepPath = extractStepPoints(route);
    const rawPath = stepPath.length > topPath.length ? stepPath : topPath;

    if (rawPath.length < 2 && route.legs) {
      for (const leg of route.legs) {
        for (const pt of leg.path ?? []) {
          const literal = toLatLngLiteral(pt);
          if (literal) rawPath.push(literal);
        }
      }
    }

    if (rawPath.length < 2) {
      rawPath.push(origin.location, destination.location);
    }

    const cumDistances = buildCumulativeDistances(rawPath);
    const totalDistanceMeters =
      route.distanceMeters && route.distanceMeters > 0
        ? route.distanceMeters
        : cumDistances[cumDistances.length - 1] || haversineMeters(origin.location, destination.location);

    const steps: RouteStepInfo[] = [];
    let runningDist = 0;

    if (route.legs) {
      for (const leg of route.legs) {
        for (const step of leg.steps ?? []) {
          const stepDist = step.distanceMeters ?? 0;
          const startLoc =
            toLatLngLiteral(step.startLocation) ??
            rawPath[0] ??
            origin.location;
          const endLoc =
            toLatLngLiteral(step.endLocation) ??
            rawPath[rawPath.length - 1] ??
            destination.location;

          const rawInstruction = (step.instructions || '').trim();
          const cleanInstruction = rawInstruction
            ? usedSurfaceTransitFallback && rawInstruction.startsWith('버스')
              ? `지상 도로 따라 이동 (${rawInstruction})`
              : rawInstruction
            : '도로를 따라 직진';

          steps.push({
            index: steps.length,
            instructions: cleanInstruction,
            maneuver: step.maneuver || undefined,
            distanceMeters: stepDist,
            durationSeconds: Math.round((step.staticDurationMillis ?? 0) / 1000),
            startDistanceMeters: runningDist,
            endDistanceMeters: runningDist + stepDist,
            startLocation: startLoc,
            endLocation: endLoc,
          });
          runningDist += stepDist;
        }
      }
    }

    const pathTotal = cumDistances[cumDistances.length - 1] || totalDistanceMeters;
    const estimatedDurationSeconds = Math.max(
      60,
      Math.round((route.durationMillis ?? 0) / 1000)
    );

    return {
      rawRoute: route,
      data: {
        origin,
        destination,
        travelMode,
        path: rawPath,
        cumDistances,
        totalDistanceMeters: pathTotal,
        estimatedDurationSeconds,
        steps,
        viewport: route.viewport ?? undefined,
        usedSurfaceTransitFallback,
      },
    };
  } catch (err) {
    checkQuotaError(err);
    throw err;
  }
}
