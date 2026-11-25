import type { ComputedRouteData } from '../types/drive';
import {
  extractRegionLabelFromAddress,
  extractRoadNamesFromSteps,
  sampleRouteCheckpoints,
} from './tripAnalytics';

export interface ResolvedTripRegions {
  regions: string[];
  roadNames: string[];
}

/**
 * Resolves visited regions and road corridors along the driven portion of a route
 * using real Google Maps Platform responses (Geocoding REST proxy + Places API New + route steps).
 */
export async function resolveVisitedRegionsForTrip(
  placesLib: google.maps.PlacesLibrary | null,
  routeData: ComputedRouteData,
  drivenDistanceMeters: number
): Promise<ResolvedTripRegions> {
  const orderedRegions: string[] = [];
  const seen = new Set<string>();

  const pushRegion = (label: string | null | undefined) => {
    const clean = label?.trim();
    if (!clean || seen.has(clean)) return;
    seen.add(clean);
    orderedRegions.push(clean);
  };

  // 1. Seed with real origin address
  pushRegion(extractRegionLabelFromAddress(routeData.origin.address));

  // 2. Collect real road corridors traversed
  const roadNames = extractRoadNamesFromSteps(
    routeData.steps,
    drivenDistanceMeters
  );

  // 3. Query server-side Geocoding REST proxy across checkpoints
  const checkpoints = sampleRouteCheckpoints(
    routeData.path,
    routeData.cumDistances,
    drivenDistanceMeters,
    4
  );

  if (checkpoints.length > 0) {
    try {
      const resp = await fetch('/api/geocode/regions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: checkpoints }),
      });
      if (resp.ok) {
        const text = await resp.text();
        if (text.trim().startsWith('{')) {
          const data = JSON.parse(text) as {
            regions?: string[];
            fallbackRequired?: boolean;
          };
          for (const r of data.regions ?? []) {
            pushRegion(r);
          }
        }
      }
    } catch {
      // Non-fatal; proceed to Places API fallback
    }
  }

  // 4. Fallback via Places API (New) if geocoding didn't yield intermediate districts
  if (orderedRegions.length <= 1 && placesLib && checkpoints.length > 0) {
    const midIdx = Math.floor(checkpoints.length / 2);
    const midPt = checkpoints[midIdx];
    try {
      const nearby = await placesLib.Place.searchNearby({
        fields: ['formattedAddress'],
        locationRestriction: {
          center: midPt,
          radius: 450,
        },
        maxResultCount: 3,
      });
      for (const place of nearby.places ?? []) {
        pushRegion(extractRegionLabelFromAddress(place.formattedAddress ?? ''));
      }
    } catch {
      // Ignore fallback failures cleanly
    }
  }

  // 5. Append destination region if reached or substantial distance covered
  if (
    drivenDistanceMeters >= routeData.totalDistanceMeters * 0.75 ||
    orderedRegions.length === 0
  ) {
    pushRegion(extractRegionLabelFromAddress(routeData.destination.address));
  }

  // Fallback to origin/destination place names if address metadata is unavailable
  if (orderedRegions.length === 0) {
    pushRegion(routeData.origin.name);
    if (drivenDistanceMeters > 200) {
      pushRegion(routeData.destination.name);
    }
  }

  return {
    regions: orderedRegions.slice(0, 6),
    roadNames,
  };
}
