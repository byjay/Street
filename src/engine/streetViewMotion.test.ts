import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeCameraShakeOffset,
  computeCrossfadeDurationMs,
  computeDynamicCameraPose,
  computeOpticalZoomHandover,
  computeRelativeHeadingOffset,
  computeSpeedAdaptiveDwellMs,
  computeTransitionMotionBlur,
  ENTRY_OPTICAL_ZOOM,
  resolveTargetCameraHeading,
  selectNextConnectedLink,
} from './streetViewMotion';

test('computeSpeedAdaptiveDwellMs shortens cleanly at higher speeds and pads corners', () => {
  const slowDwell = computeSpeedAdaptiveDwellMs(12, 1, false);
  const fastDwell = computeSpeedAdaptiveDwellMs(60, 2, false);
  const cornerDwell = computeSpeedAdaptiveDwellMs(24, 1, true);
  const straightDwell = computeSpeedAdaptiveDwellMs(24, 1, false);

  assert.ok(slowDwell > fastDwell, `Expected slow (${slowDwell}) > fast (${fastDwell})`);
  assert.ok(fastDwell >= 640 && fastDwell <= 1200);
  assert.equal(cornerDwell - straightDwell, 220);
});

test('computeOpticalZoomHandover ramps smoothly from wide entry zoom to forward zoom', () => {
  const startZoom = computeOpticalZoomHandover(0, 40, false);
  const midZoom = computeOpticalZoomHandover(0.5, 40, false);
  const endZoom = computeOpticalZoomHandover(1, 40, false);
  const cornerEndZoom = computeOpticalZoomHandover(1, 40, true);

  assert.equal(startZoom, ENTRY_OPTICAL_ZOOM);
  assert.ok(midZoom > startZoom && endZoom > midZoom);
  assert.ok(cornerEndZoom < endZoom, 'Corners keep slightly wider peripheral FOV');
});

test('computeCrossfadeDurationMs tightens transition window at high speed', () => {
  const slowFade = computeCrossfadeDurationMs(8);
  const fastFade = computeCrossfadeDurationMs(65);

  assert.ok(slowFade > fastFade);
  assert.ok(fastFade >= 340 && slowFade <= 520);
});

test('selectNextConnectedLink picks closest forward link and skips recently visited panos', () => {
  const links = [
    { pano: 'pano-prev', heading: 92, description: 'Backwards or visited' },
    { pano: 'pano-side', heading: 185, description: 'Cross street' },
    { pano: 'pano-fwd', heading: 95, description: 'Teheran-ro' },
  ];

  const selected = selectNextConnectedLink(links, 90, ['pano-prev']);
  assert.ok(selected);
  assert.equal(selected.pano, 'pano-fwd');
  assert.equal(selected.description, 'Teheran-ro');

  const none = selectNextConnectedLink(
    [{ pano: 'pano-side', heading: 180 }],
    0,
    []
  );
  assert.equal(none, null);
});

test('computeDynamicCameraPose damps heading and applies subtle suspension pitch on braking', () => {
  const pose = computeDynamicCameraPose({
    currentHeading: 350,
    targetHeading: 20,
    currentPitch: 2.0,
    speedKmh: 20,
    prevSpeedKmh: 28,
    cornerAngleDeg: 35,
    dtSeconds: 0.05,
  });

  // Shortest turn from 350 -> 20 is +30 deg, so damped heading crosses 0 into [350..20]
  assert.ok(pose.heading > 350 || pose.heading < 20);
  // Braking (28 -> 20) pitches nose slightly downward below resting +2.0 deg
  assert.ok(pose.pitch < 2.0 && pose.pitch >= 0.8);
});

test('resolveTargetCameraHeading preserves forward, relative window offset, or free compass view', () => {
  const offset = computeRelativeHeadingOffset(350, 35); // +45 deg right window
  assert.equal(offset, 45);

  assert.equal(resolveTargetCameraHeading('forward', 120, offset, 210), 120);
  assert.equal(resolveTargetCameraHeading('relative', 120, offset, 210), 165);
  assert.equal(resolveTargetCameraHeading('free', 120, offset, 210), 210);
});

test('computeTransitionMotionBlur keeps incoming sharp (0px) and applies subtle outgoing feathering', () => {
  const parked = computeTransitionMotionBlur(0, true, false);
  assert.equal(parked.outgoingBlurPx, 0);
  assert.equal(parked.peripheralOpacity, 0);

  const slowTrans = computeTransitionMotionBlur(18, true, true);
  const fastTrans = computeTransitionMotionBlur(65, true, true);
  assert.ok(fastTrans.outgoingBlurPx > slowTrans.outgoingBlurPx);
  assert.ok(fastTrans.outgoingBlurPx <= 1.5, 'Avoid heavy blur smearing');
  assert.equal(fastTrans.incomingBlurPx, 0, 'Incoming frame stays sharp');
  assert.ok(fastTrans.peripheralOpacity > 0.3 && fastTrans.peripheralOpacity <= 0.55);

  const settledFast = computeTransitionMotionBlur(65, false, true);
  assert.equal(settledFast.outgoingBlurPx, 0);
  assert.ok(settledFast.peripheralOpacity > 0.3);
});

test('computeCameraShakeOffset vibrates subtly with speed/transition pulse and stabilizes when stopped or dragging', () => {
  const stopped = computeCameraShakeOffset({
    elapsedSec: 1.5,
    msSinceTransition: 50,
    speedKmh: 0,
    isMoving: false,
    isCornering: false,
    userDragging: false,
  });
  assert.deepEqual(stopped, { xPx: 0, yPx: 0, rotateDeg: 0, scale: 1 });

  const dragging = computeCameraShakeOffset({
    elapsedSec: 1.5,
    msSinceTransition: 50,
    speedKmh: 50,
    isMoving: true,
    isCornering: false,
    userDragging: true,
  });
  assert.deepEqual(dragging, { xPx: 0, yPx: 0, rotateDeg: 0, scale: 1 });

  const drivingPulse = computeCameraShakeOffset({
    elapsedSec: 0.27,
    msSinceTransition: 45,
    speedKmh: 58,
    isMoving: true,
    isCornering: true,
    userDragging: false,
  });
  assert.equal(drivingPulse.scale, 1.016);
  assert.ok(Math.abs(drivingPulse.xPx) > 0 || Math.abs(drivingPulse.yPx) > 0);
  assert.ok(Math.abs(drivingPulse.xPx) <= 3.6 && Math.abs(drivingPulse.yPx) <= 3.8);
});

