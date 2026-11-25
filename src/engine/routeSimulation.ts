export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface RouteStepInfo {
  index: number;
  instructions: string;
  maneuver?: string;
  distanceMeters: number;
  durationSeconds: number;
  startDistanceMeters: number;
  endDistanceMeters: number;
  startLocation: LatLngPoint;
  endLocation: LatLngPoint;
}

export interface VehiclePhysicsState {
  distanceMeters: number;
  totalDistanceMeters: number;
  speedKmh: number;
  gear: 'P' | 'D' | 'R';
  score: number;
  elapsedSeconds: number;
  arrived: boolean;
  isCornering?: boolean;
  cornerAngleDeg?: number;
}

export interface DriveInput {
  isCruising: boolean;
  cruiseMultiplier: number; // 0.5, 1, 2, 3
  gasPressed: boolean;
  brakePressed: boolean;
  travelMode: 'DRIVING' | 'WALKING';
  routePath?: LatLngPoint[];
  cumDistances?: number[];
}

const EARTH_RADIUS_M = 6371000;

function toRadians(deg: number): number {
  return (deg * Math.PI) / 180;
}

function toDegrees(rad: number): number {
  return (rad * 180) / Math.PI;
}

/**
 * Computes great-circle distance in meters between two geographic points.
 */
export function haversineMeters(a: LatLngPoint, b: LatLngPoint): number {
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  const clamped = Math.min(1, Math.max(0, h));
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(clamped));
}

/**
 * Computes initial compass bearing in degrees [0, 360) clockwise from north.
 */
export function computeBearing(from: LatLngPoint, to: LatLngPoint): number {
  const lat1 = toRadians(from.lat);
  const lat2 = toRadians(to.lat);
  const dLng = toRadians(to.lng - from.lng);

  if (Math.abs(lat2 - lat1) < 1e-10 && Math.abs(dLng) < 1e-10) {
    return 0;
  }

  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  const bearing = toDegrees(Math.atan2(y, x));
  return ((bearing % 360) + 360) % 360;
}

/**
 * Shortest signed angular difference in degrees [-180, 180].
 */
export function normalizeAngleDelta(fromDeg: number, toDeg: number): number {
  let delta = ((toDeg - fromDeg) % 360 + 540) % 360 - 180;
  if (delta < -180) delta += 360;
  return delta;
}

/**
 * Builds cumulative distance array matching `path` indices.
 */
export function buildCumulativeDistances(path: LatLngPoint[]): number[] {
  if (path.length === 0) return [];
  const cum: number[] = [0];
  for (let i = 1; i < path.length; i += 1) {
    cum.push(cum[i - 1] + haversineMeters(path[i - 1], path[i]));
  }
  return cum;
}

export interface SampledPathPoint {
  position: LatLngPoint;
  heading: number;
  segmentIndex: number;
  progress: number; // 0..1
  clampedDistanceMeters: number;
}

/**
 * Samples an interpolated position and forward heading at `distanceMeters` along a polyline.
 */
export function samplePointAlongPath(
  path: LatLngPoint[],
  cumDistances: number[],
  distanceMeters: number
): SampledPathPoint {
  if (path.length === 0 || cumDistances.length === 0) {
    return {
      position: { lat: 37.5111, lng: 127.0592 },
      heading: 0,
      segmentIndex: 0,
      progress: 0,
      clampedDistanceMeters: 0,
    };
  }

  if (path.length === 1) {
    return {
      position: { lat: path[0].lat, lng: path[0].lng },
      heading: 0,
      segmentIndex: 0,
      progress: 1,
      clampedDistanceMeters: 0,
    };
  }

  const totalDist = cumDistances[cumDistances.length - 1];
  const clamped = Math.max(0, Math.min(totalDist, distanceMeters));

  if (totalDist <= 0) {
    return {
      position: { lat: path[0].lat, lng: path[0].lng },
      heading: computeBearing(path[0], path[1]),
      segmentIndex: 0,
      progress: 1,
      clampedDistanceMeters: 0,
    };
  }

  let low = 0;
  let high = cumDistances.length - 2;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (cumDistances[mid] <= clamped) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const segStart = cumDistances[low];
  const segEnd = cumDistances[low + 1];
  const segLen = segEnd - segStart;
  const t = segLen > 1e-6 ? Math.max(0, Math.min(1, (clamped - segStart) / segLen)) : 0;

  const p0 = path[low];
  const p1 = path[low + 1];
  const position: LatLngPoint = {
    lat: p0.lat + (p1.lat - p0.lat) * t,
    lng: p0.lng + (p1.lng - p0.lng) * t,
  };

  // Look ahead slightly for smoother heading across tiny segments
  let headingTarget = p1;
  if (segLen < 4 && low + 2 < path.length) {
    headingTarget = path[low + 2];
  }
  const heading = computeBearing(p0, headingTarget);

  return {
    position,
    heading,
    segmentIndex: low,
    progress: clamped / totalDist,
    clampedDistanceMeters: clamped,
  };
}

export interface ActiveStepLookup {
  currentStep: RouteStepInfo | null;
  nextStep: RouteStepInfo | null;
  distanceToNextTurnMeters: number;
}

/**
 * Finds the active navigation step and distance until the next turn maneuver.
 */
export function findActiveStep(
  steps: RouteStepInfo[],
  distanceAlongRoute: number
): ActiveStepLookup {
  if (steps.length === 0) {
    return {
      currentStep: null,
      nextStep: null,
      distanceToNextTurnMeters: 0,
    };
  }

  const d = Math.max(0, distanceAlongRoute);
  let activeIndex = steps.length - 1;
  for (let i = 0; i < steps.length; i += 1) {
    if (d < steps[i].endDistanceMeters) {
      activeIndex = i;
      break;
    }
  }

  const currentStep = steps[activeIndex];
  const nextStep = activeIndex + 1 < steps.length ? steps[activeIndex + 1] : null;
  const distanceToNextTurnMeters = Math.max(
    0,
    Math.round(currentStep.endDistanceMeters - d)
  );

  return {
    currentStep,
    nextStep,
    distanceToNextTurnMeters,
  };
}

export interface CornerAnalysis {
  cornerAngleDeg: number;
  speedFactor: number; // 0.36..1.0 multiplier applied to cruise/gas target speed
  isCornering: boolean;
}

/**
 * Samples a smoothed road tangent bearing at `distanceMeters` using a 12m chord
 * to ignore tiny polyline digitization jitter while capturing real curves & turns.
 */
function sampleSmoothedHeading(
  path: LatLngPoint[],
  cumDistances: number[],
  distanceMeters: number
): number {
  const totalDist = cumDistances[cumDistances.length - 1] ?? 0;
  if (totalDist <= 1 || path.length < 2) return 0;

  const backDist = Math.max(0, distanceMeters - 6);
  const aheadDist = Math.min(totalDist, distanceMeters + 6);
  if (aheadDist - backDist < 1) {
    return samplePointAlongPath(path, cumDistances, distanceMeters).heading;
  }

  const pBack = samplePointAlongPath(path, cumDistances, backDist).position;
  const pAhead = samplePointAlongPath(path, cumDistances, aheadDist).position;
  return computeBearing(pBack, pAhead);
}

/**
 * Evaluates current corner apex pivot and upcoming curves within a speed-scaled lookahead window,
 * returning a realistic speed reduction factor (1.0 on straight roads, down to ~0.38 on sharp 90° turns).
 */
export function evaluateCornerSlowdown(
  path: LatLngPoint[] | undefined,
  cumDistances: number[] | undefined,
  distanceMeters: number,
  speedKmh: number,
  travelMode: 'DRIVING' | 'WALKING'
): CornerAnalysis {
  if (
    !path ||
    !cumDistances ||
    path.length < 3 ||
    cumDistances.length !== path.length
  ) {
    return { cornerAngleDeg: 0, speedFactor: 1, isCornering: false };
  }

  const totalDist = cumDistances[cumDistances.length - 1] ?? 0;
  if (totalDist <= 20) {
    return { cornerAngleDeg: 0, speedFactor: 1, isCornering: false };
  }

  const currentHeading = sampleSmoothedHeading(path, cumDistances, distanceMeters);
  const entryHeading = sampleSmoothedHeading(
    path,
    cumDistances,
    Math.max(0, distanceMeters - 16)
  );

  // Measure whether the vehicle is currently pivoting through a turn apex/exit
  const apexPivotDeg = Math.abs(
    normalizeAngleDelta(entryHeading, currentHeading)
  );

  // Look ahead farther at higher speeds so braking initiates before entering the turn
  const maxLookahead =
    travelMode === 'WALKING'
      ? 18
      : Math.max(40, Math.min(115, 32 + speedKmh * 1.25));

  const probeOffsets =
    travelMode === 'WALKING' ? [6, 12, 18] : [14, 28, 46, 68, 92, 115];

  let weightedUpcomingDeg = 0;
  let rawMaxUpcomingDeg = 0;

  for (const offset of probeOffsets) {
    if (offset > maxLookahead) break;
    const probeDist = Math.min(totalDist, distanceMeters + offset);
    if (probeDist - distanceMeters < 3) continue;

    const aheadHeading = sampleSmoothedHeading(path, cumDistances, probeDist);
    const turnDeg = Math.abs(
      normalizeAngleDelta(currentHeading, aheadHeading)
    );
    if (turnDeg > rawMaxUpcomingDeg) {
      rawMaxUpcomingDeg = turnDeg;
    }

    // Weight closer corners strongly while still gently anticipating distant sharp turns
    const proximityWeight = Math.max(
      0.45,
      1 - (offset / maxLookahead) * 0.55
    );
    const effective = turnDeg * proximityWeight;
    if (effective > weightedUpcomingDeg) {
      weightedUpcomingDeg = effective;
    }
  }

  const cornerAngleDeg = Math.round(Math.max(apexPivotDeg, rawMaxUpcomingDeg));
  const effectiveTurnDeg = Math.max(apexPivotDeg, weightedUpcomingDeg);

  // Ignore gentle road drift under 16°
  if (effectiveTurnDeg < 16) {
    return {
      cornerAngleDeg,
      speedFactor: 1,
      isCornering: false,
    };
  }

  // Map [16° .. 90°+] smoothly onto cornering speed multiplier
  const severity = Math.min(1, (effectiveTurnDeg - 16) / (82 - 16));
  const minFactor = travelMode === 'WALKING' ? 0.78 : 0.36;
  const speedFactor = Number((1 - severity * (1 - minFactor)).toFixed(3));

  return {
    cornerAngleDeg,
    speedFactor,
    isCornering: speedFactor < 0.92,
  };
}

/**
 * Advances vehicle speed, position along route, gear, and driving score.
 */
export function stepVehiclePhysics(
  state: VehiclePhysicsState,
  input: DriveInput,
  rawDt: number
): VehiclePhysicsState {
  const dt = Math.min(0.05, Math.max(0, rawDt));
  if (state.totalDistanceMeters <= 0 || state.arrived) {
    return state;
  }

  const baseTargetKmh = input.travelMode === 'WALKING' ? 5 : 24;
  const maxSpeedKmh = input.travelMode === 'WALKING' ? 18 : 75;

  const corner = evaluateCornerSlowdown(
    input.routePath,
    input.cumDistances,
    state.distanceMeters,
    state.speedKmh,
    input.travelMode
  );

  let targetSpeed = 0;
  let accelRate = 24;

  if (input.brakePressed) {
    targetSpeed = 0;
    accelRate = 85;
  } else if (input.gasPressed) {
    const rawGasTarget = Math.min(
      maxSpeedKmh,
      baseTargetKmh * Math.max(1.4, input.cruiseMultiplier)
    );
    const gasCornerFactor = Math.min(1, corner.speedFactor + 0.08);
    const minCornerFloor = input.travelMode === 'WALKING' ? 3.5 : 13;
    targetSpeed = corner.isCornering
      ? Math.max(minCornerFloor, rawGasTarget * gasCornerFactor)
      : rawGasTarget;
    accelRate = targetSpeed < state.speedKmh ? 42 : 36;
  } else if (input.isCruising) {
    const rawCruiseTarget = Math.min(
      maxSpeedKmh,
      baseTargetKmh * Math.max(0.5, input.cruiseMultiplier)
    );
    const minCornerFloor = input.travelMode === 'WALKING' ? 3 : 11;
    targetSpeed = corner.isCornering
      ? Math.max(minCornerFloor, rawCruiseTarget * corner.speedFactor)
      : rawCruiseTarget;
    // Decelerate decisively when approaching a sharp bend, accelerate smoothly on corner exit
    accelRate =
      targetSpeed < state.speedKmh
        ? Math.max(26, 26 + (1 - corner.speedFactor) * 44)
        : 22;
  } else {
    targetSpeed = 0;
    accelRate = 48; // Smooth decisive stop
  }

  let nextSpeedKmh = state.speedKmh;
  if (nextSpeedKmh < targetSpeed) {
    nextSpeedKmh = Math.min(targetSpeed, nextSpeedKmh + accelRate * dt);
  } else if (nextSpeedKmh > targetSpeed) {
    nextSpeedKmh = Math.max(targetSpeed, nextSpeedKmh - accelRate * dt);
  }

  // Distance traveled in meters (speedKmh / 3.6 = m/s)
  const metersPerSecond = nextSpeedKmh / 3.6;
  const nextDistance = Math.min(
    state.totalDistanceMeters,
    state.distanceMeters + metersPerSecond * dt
  );

  const arrived = nextDistance >= state.totalDistanceMeters - 0.5;
  const finalSpeed = arrived ? 0 : nextSpeedKmh;
  const gear: 'P' | 'D' | 'R' = arrived || finalSpeed < 0.5 ? 'P' : 'D';

  // Smooth cruising earns exploration score (10 pts per 100m driven smoothly)
  const deltaMeters = Math.max(0, nextDistance - state.distanceMeters);
  const scoreGain = deltaMeters * 0.25;

  return {
    distanceMeters: arrived ? state.totalDistanceMeters : nextDistance,
    totalDistanceMeters: state.totalDistanceMeters,
    speedKmh: finalSpeed,
    gear,
    score: state.score + scoreGain,
    elapsedSeconds: state.elapsedSeconds + dt,
    arrived,
    isCornering: !arrived && corner.isCornering && (input.isCruising || input.gasPressed) && !input.brakePressed,
    cornerAngleDeg: corner.cornerAngleDeg,
  };
}

export function formatDistanceKr(meters: number): string {
  const safe = Math.max(0, Math.round(meters));
  if (safe < 1000) {
    return `${safe}m`;
  }
  const km = safe / 1000;
  return km >= 10 ? `${km.toFixed(0)}km` : `${km.toFixed(1)}km`;
}

export function formatDurationKr(seconds: number): string {
  const safeMins = Math.max(1, Math.round(seconds / 60));
  if (safeMins < 60) {
    return `${safeMins}분`;
  }
  const hours = Math.floor(safeMins / 60);
  const mins = safeMins % 60;
  return mins === 0 ? `${hours}시간` : `${hours}시간 ${mins}분`;
}
