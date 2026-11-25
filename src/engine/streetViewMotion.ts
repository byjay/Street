import { normalizeAngleDelta } from './routeSimulation';

export interface StreetViewLinkCandidate {
  pano?: string | null;
  heading?: number | null;
  description?: string | null;
}

export interface SelectedStreetViewLink {
  pano: string;
  heading: number;
  description: string;
}

export interface DynamicCameraPoseInput {
  currentHeading: number;
  targetHeading: number;
  currentPitch: number;
  speedKmh: number;
  prevSpeedKmh: number;
  cornerAngleDeg: number;
  dtSeconds: number;
}

export interface DynamicCameraPose {
  heading: number;
  pitch: number;
}

export const ENTRY_OPTICAL_ZOOM = 0.08;

/**
 * Computes continuous speed-adaptive panorama dwell interval (ms) based on real vehicle speed,
 * multiplier, and cornering stability.
 */
export function computeSpeedAdaptiveDwellMs(
  speedKmh: number,
  cruiseMultiplier = 1,
  isCornering = false
): number {
  const safeSpeed = Math.max(4, Number.isFinite(speedKmh) ? speedKmh : 24);
  // Typical Street View capture spacing ~11.5m; compute natural travel interval in ms
  const rawTravelMs = (11.5 / (safeSpeed / 3.6)) * 1000;

  let multScale = 1;
  if (cruiseMultiplier <= 0.6) multScale = 1.18;
  else if (cruiseMultiplier >= 4) multScale = 0.78;
  else if (cruiseMultiplier >= 2) multScale = 0.88;

  const cornerPaddingMs = isCornering ? 220 : 0;
  const adaptive = rawTravelMs * multScale + cornerPaddingMs;

  return Math.round(Math.max(640, Math.min(3400, adaptive)));
}

/**
 * Computes smooth optical dolly-zoom value within a single Street View node so the road
 * rushes continuously toward the camera before crossfading into the next wide-angle node.
 */
export function computeOpticalZoomHandover(
  progress01: number,
  speedKmh: number,
  isCornering = false
): number {
  const t = Math.max(0, Math.min(1, Number.isFinite(progress01) ? progress01 : 0));
  // Smooth forward-accelerating curve so motion feels natural right into the cut
  const eased = 0.35 * t + 0.65 * t * t;

  const speedNorm = Math.max(0, Math.min(1, (speedKmh - 10) / 55));
  const rawSpan = 0.24 + speedNorm * 0.22; // +0.24 at slow speeds up to +0.46 at fast speeds
  const cornerDampedSpan = isCornering ? rawSpan * 0.76 : rawSpan;

  const zoom = ENTRY_OPTICAL_ZOOM + eased * cornerDampedSpan;
  return Number(Math.max(ENTRY_OPTICAL_ZOOM, Math.min(0.58, zoom)).toFixed(3));
}

/**
 * Computes optimal crossfade duration (ms): faster speeds use tighter dissolves to prevent ghosting.
 */
export function computeCrossfadeDurationMs(speedKmh: number): number {
  const safeSpeed = Math.max(0, Number.isFinite(speedKmh) ? speedKmh : 24);
  const t = Math.max(0, Math.min(1, (safeSpeed - 8) / 52));
  return Math.round(560 - t * 220); // 560ms slow -> 340ms fast
}

/**
 * Selects the best forward-aligned adjacent Street View link while preventing A<->B ping-ponging.
 */
export function selectNextConnectedLink(
  links: readonly (StreetViewLinkCandidate | null | undefined)[],
  targetHeadingDeg: number,
  recentPanoIds: readonly string[],
  maxAngleDiffDeg = 50
): SelectedStreetViewLink | null {
  if (!links || links.length === 0) return null;

  const recentSet = new Set(recentPanoIds);
  let bestLink: SelectedStreetViewLink | null = null;
  let bestDiff = Infinity;

  for (const link of links) {
    if (!link?.pano || typeof link.heading !== 'number' || !Number.isFinite(link.heading)) {
      continue;
    }
    if (recentSet.has(link.pano)) continue;

    const diff = Math.abs(normalizeAngleDelta(targetHeadingDeg, link.heading));
    if (diff <= maxAngleDiffDeg && diff < bestDiff) {
      bestDiff = diff;
      bestLink = {
        pano: link.pano,
        heading: link.heading,
        description: (link.description || '').trim(),
      };
    }
  }

  return bestLink;
}

/**
 * Computes frame-rate-independent damped heading and subtle longitudinal suspension pitch.
 */
export function computeDynamicCameraPose(
  input: DynamicCameraPoseInput
): DynamicCameraPose {
  const dt = Math.max(0.001, Math.min(0.1, input.dtSeconds));
  const headingDelta = normalizeAngleDelta(input.currentHeading, input.targetHeading);

  // Follow sharper corners briskly while keeping straight road tracking silky
  const headingRate = input.cornerAngleDeg >= 24 ? 6.8 : 4.2;
  const headingAlpha = 1 - Math.exp(-headingRate * dt);
  const nextHeading =
    ((input.currentHeading + headingDelta * headingAlpha) % 360 + 360) % 360;

  const accelKmhPerSec = (input.speedKmh - input.prevSpeedKmh) / dt;
  const pitchOffset = Math.max(-1.2, Math.min(1.4, accelKmhPerSec * 0.04));
  const targetPitch = 2.0 + pitchOffset;
  const pitchAlpha = 1 - Math.exp(-5.5 * dt);
  const nextPitch =
    input.currentPitch + (targetPitch - input.currentPitch) * pitchAlpha;

  return {
    heading: Number(nextHeading.toFixed(2)),
    pitch: Number(Math.max(-4, Math.min(8, nextPitch)).toFixed(2)),
  };
}

export interface MotionBlurProfile {
  outgoingBlurPx: number;
  incomingBlurPx: number;
  peripheralOpacity: number;
}

/**
 * Computes CSS filter blur levels (px) for Street View scene transitions and peripheral
 * high-speed rushing without blurring the settled center viewport.
 */
export function computeTransitionMotionBlur(
  speedKmh: number,
  isTransitioning: boolean,
  isMoving: boolean
): MotionBlurProfile {
  if (!isMoving || speedKmh < 3) {
    return { outgoingBlurPx: 0, incomingBlurPx: 0, peripheralOpacity: 0 };
  }

  const speedRatio = Math.max(0, Math.min(1, (speedKmh - 8) / 62));
  const peripheralOpacity =
    speedKmh >= 30 ? Number((0.25 + speedRatio * 0.65).toFixed(2)) : 0;

  if (!isTransitioning) {
    return {
      outgoingBlurPx: 0,
      incomingBlurPx: 0,
      peripheralOpacity,
    };
  }

  const outgoingBlurPx = Number((1.6 + speedRatio * 3.2).toFixed(1)); // 1.6px .. 4.8px
  const incomingBlurPx = Number((0.6 + speedRatio * 1.2).toFixed(1)); // 0.6px .. 1.8px

  return {
    outgoingBlurPx,
    incomingBlurPx,
    peripheralOpacity,
  };
}

export interface CameraShakeInput {
  elapsedSec: number;
  msSinceTransition: number;
  speedKmh: number;
  isMoving: boolean;
  isCornering: boolean;
  userDragging: boolean;
}

export interface CameraShakeOutput {
  xPx: number;
  yPx: number;
  rotateDeg: number;
  scale: number;
}

/**
 * Computes subtle multi-harmonic road vibration + damped transition suspension kick
 * synchronized with StreetViewViewer's frame update loop.
 */
export function computeCameraShakeOffset(
  input: CameraShakeInput
): CameraShakeOutput {
  if (!input.isMoving || input.speedKmh < 2 || input.userDragging) {
    return { xPx: 0, yPx: 0, rotateDeg: 0, scale: 1 };
  }

  const speedNorm = Math.max(0, Math.min(1, input.speedKmh / 68));
  const roadAmp = 0.45 + speedNorm * 1.75; // 0.45px .. 2.2px micro road rumble
  const cornerBoost = input.isCornering ? 1.35 : 1;

  // Multi-frequency road harmonics (non-integer ratio prevents repetitive robotic loop)
  const t = input.elapsedSec;
  const roadX =
    (Math.sin(t * 17.3) * 0.6 + Math.cos(t * 29.1) * 0.4) *
    roadAmp *
    0.7 *
    cornerBoost;
  const roadY =
    (Math.sin(t * 23.7 + 0.8) * 0.65 + Math.cos(t * 41.3) * 0.35) * roadAmp;

  // Damped frame-transition suspension thump over the first ~360ms after each pano swap
  let pulseY = 0;
  let pulseRoll = 0;
  if (input.msSinceTransition >= 0 && input.msSinceTransition < 380) {
    const dtTrans = input.msSinceTransition / 1000;
    const envelope = Math.exp(-dtTrans * 10.5) * (0.55 + speedNorm * 0.65);
    pulseY = Math.sin(dtTrans * 34) * 2.1 * envelope;
    pulseRoll = Math.cos(dtTrans * 26) * 0.24 * envelope;
  }

  const xPx = Number(Math.max(-3.6, Math.min(3.6, roadX)).toFixed(2));
  const yPx = Number(Math.max(-3.8, Math.min(3.8, roadY + pulseY)).toFixed(2));
  const roadRoll = Math.sin(t * 11.4) * (0.07 + speedNorm * 0.12) * cornerBoost;
  const rotateDeg = Number(
    Math.max(-0.38, Math.min(0.38, roadRoll + pulseRoll)).toFixed(3)
  );

  return {
    xPx,
    yPx,
    rotateDeg,
    scale: 1.016, // Slight overscan prevents edge gaps during micro-shake
  };
}

