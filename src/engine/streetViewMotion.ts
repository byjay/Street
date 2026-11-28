import { normalizeAngleDelta } from './routeSimulation';
import type { CameraFollowMode } from '../types/drive';

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
  targetPitch?: number;
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
 * Normalizes any compass angle into [0, 360).
 */
export function normalizeCompassHeading(deg: number): number {
  if (!Number.isFinite(deg)) return 0;
  return ((deg % 360) + 360) % 360;
}

/**
 * Computes signed relative viewing offset from the road's travel direction in [-180, 180].
 */
export function computeRelativeHeadingOffset(
  roadHeadingDeg: number,
  viewerHeadingDeg: number
): number {
  return Number(normalizeAngleDelta(roadHeadingDeg, viewerHeadingDeg).toFixed(2));
}

/**
 * Resolves the target Street View heading based on camera follow mode:
 * - 'forward': aligned to travel direction
 * - 'relative': preserves the user's chosen angle relative to travel direction
 * - 'free': preserves the exact compass direction the user is looking at
 */
export function resolveTargetCameraHeading(
  mode: CameraFollowMode,
  roadHeadingDeg: number,
  userRelativeOffsetDeg: number,
  userFreeHeadingDeg: number
): number {
  if (mode === 'free') {
    return normalizeCompassHeading(userFreeHeadingDeg);
  }
  if (mode === 'relative') {
    return normalizeCompassHeading(roadHeadingDeg + userRelativeOffsetDeg);
  }
  return normalizeCompassHeading(roadHeadingDeg);
}

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
  const eased = 0.42 * t + 0.58 * t * t;

  const speedNorm = Math.max(0, Math.min(1, (speedKmh - 10) / 55));
  const rawSpan = 0.20 + speedNorm * 0.18; // +0.20 slow up to +0.38 fast (matches scale 1.055 dissolve)
  const cornerDampedSpan = isCornering ? rawSpan * 0.78 : rawSpan;

  const zoom = ENTRY_OPTICAL_ZOOM + eased * cornerDampedSpan;
  return Number(Math.max(ENTRY_OPTICAL_ZOOM, Math.min(0.48, zoom)).toFixed(3));
}

/**
 * Computes optimal crossfade duration (ms): silky dissolve without ghosting.
 */
export function computeCrossfadeDurationMs(speedKmh: number): number {
  const safeSpeed = Math.max(0, Number.isFinite(speedKmh) ? speedKmh : 24);
  const t = Math.max(0, Math.min(1, (safeSpeed - 8) / 52));
  return Math.round(520 - t * 180); // 520ms slow -> 340ms fast
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
  const headingRate = input.cornerAngleDeg >= 24 ? 7.2 : 4.8;
  const headingAlpha = 1 - Math.exp(-headingRate * dt);
  const nextHeading = normalizeCompassHeading(
    input.currentHeading + headingDelta * headingAlpha
  );

  const basePitch = input.targetPitch ?? 2.0;
  const accelKmhPerSec = (input.speedKmh - input.prevSpeedKmh) / dt;
  const pitchOffset = Math.max(-1.0, Math.min(1.2, accelKmhPerSec * 0.035));
  const targetPitch = basePitch + pitchOffset;
  const pitchAlpha = 1 - Math.exp(-5.5 * dt);
  const nextPitch =
    input.currentPitch + (targetPitch - input.currentPitch) * pitchAlpha;

  return {
    heading: Number(nextHeading.toFixed(2)),
    pitch: Number(Math.max(-25, Math.min(30, nextPitch)).toFixed(2)),
  };
}

export interface MotionBlurProfile {
  outgoingBlurPx: number;
  incomingBlurPx: number;
  peripheralOpacity: number;
}

/**
 * Computes light CSS filter blur levels (px) so transitions feel smooth without smearing tiles.
 * Incoming frame always remains 0px blur for razor-sharp forward clarity.
 */
export function computeTransitionMotionBlur(
  speedKmh: number,
  isTransitioning: boolean,
  isMoving: boolean
): MotionBlurProfile {
  if (!isMoving || speedKmh < 3) {
    return { outgoingBlurPx: 0, incomingBlurPx: 0, peripheralOpacity: 0 };
  }

  const speedRatio = Math.max(0, Math.min(1, (speedKmh - 12) / 58));
  const peripheralOpacity =
    speedKmh >= 42 ? Number((0.15 + speedRatio * 0.35).toFixed(2)) : 0;

  if (!isTransitioning) {
    return {
      outgoingBlurPx: 0,
      incomingBlurPx: 0,
      peripheralOpacity,
    };
  }

  const outgoingBlurPx = Number((0.4 + speedRatio * 0.9).toFixed(1)); // 0.4px .. 1.3px feathering only
  return {
    outgoingBlurPx,
    incomingBlurPx: 0,
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

