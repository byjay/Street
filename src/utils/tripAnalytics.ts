import type { LatLngPoint, RouteStepInfo } from '../engine/routeSimulation';
import type {
  CameraViewMode,
  ChallengeCourse,
  ChallengeCourseLeaderboard,
  ChallengeRankEntry,
  DriveHistorySummary,
  DriveTripRecord,
  TelemetrySample,
  ViewModeAggregate,
  VisitedRegionAggregate,
} from '../types/drive';

const STORAGE_KEY = 'roadwindow_trip_history_v1';
const MAX_STORED_TRIPS = 30;

export const VIEW_MODE_LABELS: Record<CameraViewMode, string> = {
  streetview: '360° 거리뷰',
  aerial: '항공뷰',
  split: '분할뷰',
  map: '로드맵',
};

/**
 * Extracts a concise district/neighborhood label from a Google Maps formatted address.
 * Examples:
 * - "대한민국 서울특별시 강남구 역삼동 테헤란로 152" -> "강남구 역삼동"
 * - "대한민국 서울특별시 강남구 삼성동 159" -> "강남구 삼성동"
 * - "Manhattan, New York, NY 10036, USA" -> "Manhattan, New York"
 * - "1 Chome-1-2 Oshiage, Sumida City, Tokyo" -> "Sumida City, Tokyo"
 */
export function extractRegionLabelFromAddress(address?: string): string | null {
  if (!address || typeof address !== 'string') return null;
  const cleaned = address.trim();
  if (!cleaned) return null;

  // Korean address pattern: strip leading metropolitan prefix so 구/군 + 동 is prioritized
  const krNormalized = cleaned.replace(
    /(?:^|\s)(?:대한민국|서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시)(?=\s|$)/g,
    ' '
  ).trim();

  const krMatch = krNormalized.match(
    /([가-힣]+(?:구|시|군))(?:\s+([가-힣0-9]+(?:동|읍|면|가|리)))?/
  );
  if (krMatch) {
    const primary = krMatch[1];
    const secondary = krMatch[2];
    return secondary ? `${primary} ${secondary}` : primary;
  }

  const dongOnlyMatch = krNormalized.match(/([가-힣0-9]+(?:동|읍|면|가))/);
  if (dongOnlyMatch) {
    return dongOnlyMatch[1];
  }

  const metroFallback = cleaned.match(
    /(서울특별시|부산광역시|대구광역시|인천광역시|광주광역시|대전광역시|울산광역시|세종특별자치시)/
  );
  if (metroFallback) {
    return metroFallback[1];
  }

  // Comma-separated international addresses (e.g. Tokyo, NYC, Paris, London)
  const parts = cleaned
    .split(',')
    .map((p) => p.replace(/\d{3,6}(-\d{3,4})?/g, '').trim())
    .filter((p) => p.length > 1 && !/^(대한민국|South Korea|USA|United States|Japan|France|UK)$/i.test(p));

  if (parts.length >= 3 && /^[A-Z]{2}$/.test(parts[parts.length - 1])) {
    parts.pop();
  }

  if (parts.length >= 2) {
    const candidateA = parts[parts.length - 2];
    const candidateB = parts[parts.length - 1];
    if (candidateA && candidateB && candidateA !== candidateB) {
      return `${candidateA}, ${candidateB}`.slice(0, 42);
    }
    return candidateA.slice(0, 42);
  }

  if (parts.length === 1) {
    return parts[0].slice(0, 42);
  }

  return null;
}

/**
 * Extracts real road / transit corridor names encountered in route steps up to `distanceMeters`.
 */
export function extractRoadNamesFromSteps(
  steps: RouteStepInfo[],
  distanceMeters: number
): string[] {
  const found: string[] = [];
  const seen = new Set<string>();

  for (const step of steps) {
    if (step.startDistanceMeters > distanceMeters + 30 && found.length > 0) {
      break;
    }
    const text = step.instructions || '';
    // Match Korean street names ending in 로/길/대로/고개/다리/교 or English Ave/St/Blvd/Rd/Way/Quai/Rue
    const krRoads = text.match(/[가-힣0-9]+(?:대로|로|길|교|터널)/g) ?? [];
    const enRoads =
      text.match(
        /\b(?:[A-Z0-9][\w'-]*\s+){1,3}(?:Ave(?:nue)?|St(?:reet)?|Blvd|Boulevard|Rd|Road|Dr|Drive|Way|Dori)\b/g
      ) ?? [];

    for (const r of [...krRoads, ...enRoads]) {
      const normalized = r.trim().replace(/(대로|로|길)로$/, '$1');
      if (
        normalized.length >= 2 &&
        normalized !== '도로' &&
        normalized !== '지상 도로' &&
        !/(?:방면|방향|우측|좌측|안쪽|바깥쪽|시내|도심|출구|차선|지점)으로$/.test(
          normalized
        ) &&
        !seen.has(normalized)
      ) {
        seen.add(normalized);
        found.push(normalized);
      }
    }
  }

  return found.slice(0, 8);
}

/**
 * Samples evenly spaced geographic checkpoints along the actually driven distance of a route path.
 */
export function sampleRouteCheckpoints(
  path: LatLngPoint[],
  cumDistances: number[],
  drivenDistanceMeters: number,
  maxSamples = 4
): LatLngPoint[] {
  if (path.length === 0 || cumDistances.length === 0) return [];
  if (path.length === 1 || drivenDistanceMeters <= 10) {
    return [{ lat: path[0].lat, lng: path[0].lng }];
  }

  const maxDist = Math.min(
    cumDistances[cumDistances.length - 1],
    Math.max(0, drivenDistanceMeters)
  );
  const count = Math.max(2, maxSamples);
  const checkpoints: LatLngPoint[] = [];

  for (let i = 0; i < count; i += 1) {
    const targetDist = (maxDist * i) / (count - 1);
    let idx = 0;
    for (let j = 0; j < cumDistances.length; j += 1) {
      if (cumDistances[j] <= targetDist) {
        idx = j;
      } else {
        break;
      }
    }
    const pt = path[idx];
    const prev = checkpoints[checkpoints.length - 1];
    if (
      !prev ||
      Math.abs(prev.lat - pt.lat) > 0.0004 ||
      Math.abs(prev.lng - pt.lng) > 0.0004
    ) {
      checkpoints.push({ lat: pt.lat, lng: pt.lng });
    }
  }

  return checkpoints;
}

/**
 * Computes average speed, max speed, and time spent per camera view mode from telemetry samples.
 */
export function summarizeTripTelemetry(
  telemetry: TelemetrySample[],
  totalDistanceMeters: number,
  totalElapsedSeconds: number,
  viewModeSecondsInput?: Partial<Record<CameraViewMode, number>>
): {
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  viewModeSeconds: Record<CameraViewMode, number>;
} {
  const safeSeconds = Math.max(1, totalElapsedSeconds);
  const derivedAvgKmh =
    totalDistanceMeters > 0
      ? Math.round(((totalDistanceMeters / safeSeconds) * 3.6) * 10) / 10
      : 0;

  let maxSpeedKmh = 0;
  let sampleSpeedSum = 0;
  for (const sample of telemetry) {
    if (sample.speedKmh > maxSpeedKmh) {
      maxSpeedKmh = Math.round(sample.speedKmh);
    }
    sampleSpeedSum += sample.speedKmh;
  }

  const avgSpeedKmh =
    telemetry.length > 0 && sampleSpeedSum > 0
      ? Math.round((sampleSpeedSum / telemetry.length) * 10) / 10
      : derivedAvgKmh;

  const viewModeSeconds: Record<CameraViewMode, number> = {
    streetview: Math.max(0, Math.round(viewModeSecondsInput?.streetview ?? 0)),
    aerial: Math.max(0, Math.round(viewModeSecondsInput?.aerial ?? 0)),
    split: Math.max(0, Math.round(viewModeSecondsInput?.split ?? 0)),
    map: Math.max(0, Math.round(viewModeSecondsInput?.map ?? 0)),
  };

  const sumModes =
    viewModeSeconds.streetview +
    viewModeSeconds.aerial +
    viewModeSeconds.split +
    viewModeSeconds.map;

  if (sumModes === 0) {
    viewModeSeconds.streetview = Math.max(1, Math.round(totalElapsedSeconds));
  }

  return {
    avgSpeedKmh,
    maxSpeedKmh: Math.max(maxSpeedKmh, Math.round(avgSpeedKmh)),
    viewModeSeconds,
  };
}

/**
 * Downsamples telemetry snapshots cleanly for smooth chart plotting.
 */
export function downsampleTelemetryForChart(
  telemetry: TelemetrySample[],
  maxPoints = 24
): Array<{
  stepLabel: string;
  distanceKm: number;
  speedKmh: number;
  elapsedSec: number;
}> {
  if (telemetry.length === 0) return [];
  const stride = Math.max(1, Math.ceil(telemetry.length / maxPoints));
  const points: Array<{
    stepLabel: string;
    distanceKm: number;
    speedKmh: number;
    elapsedSec: number;
  }> = [];

  for (let i = 0; i < telemetry.length; i += stride) {
    const s = telemetry[i];
    points.push({
      stepLabel: `${(s.distanceMeters / 1000).toFixed(2)}km`,
      distanceKm: Number((s.distanceMeters / 1000).toFixed(2)),
      speedKmh: Math.round(s.speedKmh),
      elapsedSec: Math.round(s.elapsedSeconds),
    });
  }

  const last = telemetry[telemetry.length - 1];
  const lastKm = Number((last.distanceMeters / 1000).toFixed(2));
  if (
    points.length === 0 ||
    points[points.length - 1].elapsedSec !== Math.round(last.elapsedSeconds)
  ) {
    points.push({
      stepLabel: `${lastKm.toFixed(2)}km`,
      distanceKm: lastKm,
      speedKmh: Math.round(last.speedKmh),
      elapsedSec: Math.round(last.elapsedSeconds),
    });
  }

  return points;
}

/**
 * Aggregates one or more DriveTripRecord items into KPI summaries, region breakdowns,
 * view-mode proportions, and multi-trip trend data for the analytics dashboard.
 */
export function aggregateDriveHistory(
  trips: DriveTripRecord[]
): DriveHistorySummary {
  if (trips.length === 0) {
    return {
      totalTrips: 0,
      completedTrips: 0,
      totalDistanceMeters: 0,
      totalElapsedSeconds: 0,
      overallAvgSpeedKmh: 0,
      totalScore: 0,
      regionStats: [],
      viewModeBreakdown: [],
      tripTrendData: [],
    };
  }

  let totalDistanceMeters = 0;
  let totalElapsedSeconds = 0;
  let completedTrips = 0;
  let totalScore = 0;

  const regionMap = new Map<string, VisitedRegionAggregate>();
  const modeTotals: Record<CameraViewMode, number> = {
    streetview: 0,
    aerial: 0,
    split: 0,
    map: 0,
  };

  for (const trip of trips) {
    totalDistanceMeters += Math.max(0, trip.distanceMeters);
    totalElapsedSeconds += Math.max(0, trip.elapsedSeconds);
    if (trip.completed) completedTrips += 1;
    totalScore += Math.round(trip.score);

    const tripRegions =
      trip.regions.length > 0 ? trip.regions : [trip.destinationName || trip.originName];
    const perRegionDist = trip.distanceMeters / Math.max(1, tripRegions.length);
    const perRegionSec = trip.elapsedSeconds / Math.max(1, tripRegions.length);

    for (const regionName of tripRegions) {
      const cleanName = regionName.trim();
      if (!cleanName) continue;
      const existing = regionMap.get(cleanName);
      if (existing) {
        existing.visits += 1;
        existing.distanceMeters += perRegionDist;
        existing.durationSeconds += perRegionSec;
      } else {
        regionMap.set(cleanName, {
          region: cleanName,
          visits: 1,
          distanceMeters: perRegionDist,
          durationSeconds: perRegionSec,
        });
      }
    }

    modeTotals.streetview += trip.viewModeSeconds?.streetview ?? 0;
    modeTotals.aerial += trip.viewModeSeconds?.aerial ?? 0;
    modeTotals.split += trip.viewModeSeconds?.split ?? 0;
    modeTotals.map += trip.viewModeSeconds?.map ?? 0;
  }

  const totalModeSeconds =
    modeTotals.streetview +
    modeTotals.aerial +
    modeTotals.split +
    modeTotals.map;

  const viewModeBreakdown: ViewModeAggregate[] = (
    Object.keys(VIEW_MODE_LABELS) as CameraViewMode[]
  )
    .map((key) => {
      const seconds = Math.round(modeTotals[key]);
      const percent =
        totalModeSeconds > 0 ? Math.round((seconds / totalModeSeconds) * 100) : 0;
      return {
        key,
        label: VIEW_MODE_LABELS[key],
        seconds,
        percent,
      };
    })
    .filter((entry) => entry.seconds > 0)
    .sort((a, b) => b.seconds - a.seconds);

  const regionStats = Array.from(regionMap.values())
    .map((r) => ({
      ...r,
      distanceMeters: Math.round(r.distanceMeters),
      durationSeconds: Math.round(r.durationSeconds),
    }))
    .sort((a, b) => b.distanceMeters - a.distanceMeters);

  const overallAvgSpeedKmh =
    totalElapsedSeconds > 0
      ? Math.round(((totalDistanceMeters / totalElapsedSeconds) * 3.6) * 10) / 10
      : 0;

  const tripTrendData = [...trips]
    .slice(0, 10)
    .reverse()
    .map((t, index) => ({
      id: t.id,
      label: `#${index + 1} ${t.destinationName.slice(0, 10)}`,
      distanceKm: Number((t.distanceMeters / 1000).toFixed(2)),
      durationMin: Number(Math.max(0.1, t.elapsedSeconds / 60).toFixed(1)),
      avgSpeedKmh: Math.round(t.avgSpeedKmh),
    }));

  return {
    totalTrips: trips.length,
    completedTrips,
    totalDistanceMeters: Math.round(totalDistanceMeters),
    totalElapsedSeconds: Math.round(totalElapsedSeconds),
    overallAvgSpeedKmh,
    totalScore,
    regionStats,
    viewModeBreakdown,
    tripTrendData,
  };
}

export function loadTripHistory(): DriveTripRecord[] {
  if (typeof window === 'undefined' || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DriveTripRecord[]) : [];
  } catch {
    return [];
  }
}

export function saveTripRecord(record: DriveTripRecord): DriveTripRecord[] {
  const existing = loadTripHistory().filter((item) => item.id !== record.id);
  const next = [record, ...existing].slice(0, MAX_STORED_TRIPS);
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore quota errors cleanly
    }
  }
  return next;
}

export function updateTripRegions(
  tripId: string,
  regions: string[],
  roadNames: string[]
): DriveTripRecord[] {
  const current = loadTripHistory();
  const next = current.map((item) =>
    item.id === tripId
      ? {
          ...item,
          regions: regions.length > 0 ? regions : item.regions,
          roadNames: roadNames.length > 0 ? roadNames : item.roadNames,
        }
      : item
  );
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore
    }
  }
  return next;
}

export function clearTripHistory(): void {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore
    }
  }
}

export function formatElapsedClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(safe / 3600);
  const mins = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hrs > 0) {
    return `${hrs}시간 ${mins}분 ${secs}초`;
  }
  if (mins > 0) {
    return `${mins}분 ${secs}초`;
  }
  return `${secs}초`;
}

/**
 * Aggregates Challenge Course high scores, completion rates, and per-course rankings sorted by best score.
 */
export function aggregateChallengeLeaderboard(
  trips: DriveTripRecord[],
  courses: ChallengeCourse[]
): ChallengeCourseLeaderboard[] {
  const boards: ChallengeCourseLeaderboard[] = courses.map((course) => {
    const courseTrips = trips.filter((t) => t.challengeId === course.id);

    const sorted = [...courseTrips].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (a.completed !== b.completed) return a.completed ? -1 : 1;
      if (a.elapsedSeconds !== b.elapsedSeconds) {
        return a.elapsedSeconds - b.elapsedSeconds;
      }
      return b.endedAtIso.localeCompare(a.endedAtIso);
    });

    const topRuns: ChallengeRankEntry[] = sorted.slice(0, 5).map((run, idx) => ({
      rank: idx + 1,
      tripId: run.id,
      score: Math.round(run.score),
      distanceMeters: Math.round(run.distanceMeters),
      elapsedSeconds: Math.max(1, Math.round(run.elapsedSeconds)),
      avgSpeedKmh: Math.round(run.avgSpeedKmh),
      completed: run.completed,
      endedAtIso: run.endedAtIso,
    }));

    const bestScore = topRuns[0]?.score ?? 0;
    const completedCount = courseTrips.filter((t) => t.completed).length;
    const completionRatePct =
      courseTrips.length > 0
        ? Math.round((completedCount / courseTrips.length) * 100)
        : 0;

    return {
      course,
      bestScore,
      attemptCount: courseTrips.length,
      completedCount,
      completionRatePct,
      topRuns,
    };
  });

  // Rank courses by highest achieved score first, then by attempt count and target score
  return boards.sort((a, b) => {
    if (b.bestScore !== a.bestScore) return b.bestScore - a.bestScore;
    if (b.attemptCount !== a.attemptCount) return b.attemptCount - a.attemptCount;
    return b.course.targetScore - a.course.targetScore;
  });
}

export function computeChallengeBestScoreMap(
  trips: DriveTripRecord[]
): Record<string, number> {
  const map: Record<string, number> = {};
  for (const trip of trips) {
    if (!trip.challengeId) continue;
    const rounded = Math.round(trip.score);
    if ((map[trip.challengeId] ?? 0) < rounded) {
      map[trip.challengeId] = rounded;
    }
  }
  return map;
}

