import { haversineMeters } from './routeSimulation';
import type { RawFlightNode } from '../data/flightRoutes';
import type {
  FlightPhase,
  FlightTelemetry,
  FlightWaypoint,
} from '../types/drive';

function catmullRom(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number
): number {
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

/**
 * Computes initial great-circle bearing in degrees [0, 360) clockwise from north.
 */
export function computeBearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const toDeg = (r: number) => (r * 180) / Math.PI;
  const phi1 = toRad(a.lat);
  const phi2 = toRad(b.lat);
  const dLambda = toRad(b.lng - a.lng);
  if (Math.abs(phi2 - phi1) < 1e-10 && Math.abs(dLambda) < 1e-10) {
    return 0;
  }
  const y = Math.sin(dLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLambda);
  return ((toDeg(Math.atan2(y, x)) % 360) + 360) % 360;
}

/**
 * Interpolates a smooth 3D flight trajectory with >= 300 waypoints using Catmull-Rom splines.
 */
export function buildFlightTrajectory(
  nodes: readonly RawFlightNode[],
  samplesPerSegment = 60
): FlightWaypoint[] {
  if (nodes.length === 0) return [];
  if (nodes.length === 1) {
    return [
      {
        lat: nodes[0].lat,
        lng: nodes[0].lng,
        altitudeMeters: Math.max(30, nodes[0].altitudeMeters),
        distanceFromStartMeters: 0,
        headingDeg: 0,
        pitchDeg: 0,
        rollDeg: 0,
        landmarkName: nodes[0].landmarkName,
      },
    ];
  }

  const pts: Array<{
    lat: number;
    lng: number;
    alt: number;
    landmarkName?: string;
  }> = [];

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
        alt: Math.max(
          30,
          catmullRom(
            p0.altitudeMeters,
            p1.altitudeMeters,
            p2.altitudeMeters,
            p3.altitudeMeters,
            t
          )
        ),
        landmarkName: s === 0 ? p1.landmarkName : undefined,
      });
    }
  }

  const last = nodes[nodes.length - 1];
  pts.push({
    lat: last.lat,
    lng: last.lng,
    alt: Math.max(30, last.altitudeMeters),
    landmarkName: last.landmarkName,
  });

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
    const pitchDeg = Math.max(
      -12,
      Math.min(15, (Math.atan2(dAlt, segHoriz) * 180) / Math.PI)
    );
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

/**
 * Applies exponentially smoothed aircraft bank angle (roll in [-22, +22] deg) during turns.
 */
export function applyBankingRoll(
  waypoints: readonly FlightWaypoint[]
): FlightWaypoint[] {
  let smoothedRoll = 0;
  return waypoints.map((wp, idx) => {
    if (idx === 0 || idx === waypoints.length - 1) {
      return { ...wp, rollDeg: 0 };
    }
    const prevH = waypoints[idx - 1].headingDeg;
    const nextH = waypoints[idx + 1].headingDeg;
    let turnDelta = ((nextH - prevH) % 360 + 540) % 360 - 180;
    if (turnDelta < -180) turnDelta += 360;
    const targetRoll = Math.max(-22, Math.min(22, turnDelta * 3.5));
    smoothedRoll = smoothedRoll * 0.85 + targetRoll * 0.15;
    return {
      ...wp,
      rollDeg: Number(Math.max(-22, Math.min(22, smoothedRoll)).toFixed(2)),
    };
  });
}

export function resolveFlightPhaseAndSpeed(progress01: number): {
  phase: FlightPhase;
  speedKmh: number;
} {
  const p = Math.max(0, Math.min(1, progress01));
  if (p < 0.06) {
    const t = p / 0.06;
    return { phase: 'TAKEOFF', speedKmh: Math.round(260 + t * 160) };
  }
  if (p < 0.22) {
    const t = (p - 0.06) / 0.16;
    return { phase: 'CLIMB', speedKmh: Math.round(420 + t * 340) };
  }
  if (p < 0.78) {
    return { phase: 'CRUISE', speedKmh: 800 };
  }
  if (p < 0.94) {
    const t = (p - 0.78) / 0.16;
    return { phase: 'DESCENT', speedKmh: Math.round(760 - t * 360) };
  }
  const t = (p - 0.94) / 0.06;
  return { phase: 'LANDING', speedKmh: Math.round(400 - t * 160) };
}

export function sampleFlightStateAtDistance(
  waypoints: readonly FlightWaypoint[],
  nodes: readonly RawFlightNode[],
  distanceMeters: number
): { waypoint: FlightWaypoint; telemetry: FlightTelemetry } {
  const totalDistanceMeters =
    waypoints[waypoints.length - 1]?.distanceFromStartMeters ?? 0;
  if (waypoints.length === 0 || totalDistanceMeters <= 0) {
    const fallbackWp: FlightWaypoint = {
      lat: nodes[0]?.lat ?? 35.1796,
      lng: nodes[0]?.lng ?? 128.9382,
      altitudeMeters: 30,
      distanceFromStartMeters: 0,
      headingDeg: 325,
      pitchDeg: 0,
      rollDeg: 0,
    };
    return {
      waypoint: fallbackWp,
      telemetry: {
        progress: 0,
        distanceMeters: 0,
        totalDistanceMeters: 0,
        altitudeMeters: 30,
        speedKmh: 260,
        headingDeg: 325,
        pitchDeg: 0,
        rollDeg: 0,
        remainingKm: 0,
        etaMinutes: 0,
        phase: 'TAKEOFF',
        nearestLandmark: nodes[0]?.landmarkName ?? '김해국제공항 (PUS)',
        nearestLandmarkDescription: nodes[0]?.description ?? '',
      },
    };
  }

  const clampedDist = Math.max(0, Math.min(totalDistanceMeters, distanceMeters));
  let low = 0;
  let high = waypoints.length - 2;
  while (low < high) {
    const mid = Math.floor((low + high + 1) / 2);
    if (waypoints[mid].distanceFromStartMeters <= clampedDist) {
      low = mid;
    } else {
      high = mid - 1;
    }
  }

  const w0 = waypoints[low];
  const w1 = waypoints[Math.min(waypoints.length - 1, low + 1)];
  const span = w1.distanceFromStartMeters - w0.distanceFromStartMeters;
  const t =
    span > 1e-6 ? Math.max(0, Math.min(1, (clampedDist - w0.distanceFromStartMeters) / span)) : 0;

  let headingDelta = ((w1.headingDeg - w0.headingDeg) % 360 + 540) % 360 - 180;
  if (headingDelta < -180) headingDelta += 360;

  const wp: FlightWaypoint = {
    lat: w0.lat + (w1.lat - w0.lat) * t,
    lng: w0.lng + (w1.lng - w0.lng) * t,
    altitudeMeters: Math.round(w0.altitudeMeters + (w1.altitudeMeters - w0.altitudeMeters) * t),
    distanceFromStartMeters: clampedDist,
    headingDeg: ((w0.headingDeg + headingDelta * t) % 360 + 360) % 360,
    pitchDeg: Number((w0.pitchDeg + (w1.pitchDeg - w0.pitchDeg) * t).toFixed(2)),
    rollDeg: Number((w0.rollDeg + (w1.rollDeg - w0.rollDeg) * t).toFixed(2)),
  };

  const progress = clampedDist / totalDistanceMeters;
  const { phase, speedKmh } = resolveFlightPhaseAndSpeed(progress);
  const remainingKm = Math.max(0, (totalDistanceMeters - clampedDist) / 1000);
  const etaMinutes = Math.max(0, Math.ceil((remainingKm / Math.max(180, speedKmh)) * 60));

  let nearestNode = nodes[0];
  let minNodeDist = Infinity;
  for (const node of nodes) {
    const d = haversineMeters({ lat: wp.lat, lng: wp.lng }, node);
    if (d < minNodeDist) {
      minNodeDist = d;
      nearestNode = node;
    }
  }

  return {
    waypoint: wp,
    telemetry: {
      progress,
      distanceMeters: clampedDist,
      totalDistanceMeters,
      altitudeMeters: wp.altitudeMeters,
      speedKmh,
      headingDeg: Math.round(wp.headingDeg),
      pitchDeg: wp.pitchDeg,
      rollDeg: wp.rollDeg,
      remainingKm: Number(remainingKm.toFixed(1)),
      etaMinutes,
      phase,
      nearestLandmark: nearestNode?.landmarkName ?? '한반도 상공',
      nearestLandmarkDescription: nearestNode?.description ?? '',
    },
  };
}
