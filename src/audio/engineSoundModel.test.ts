import test from 'node:test';
import assert from 'node:assert/strict';
import {
  computeDrivetrainAudioMix,
  computeFlightAudioMix,
  computeWalkAudioMix,
} from './engineSoundModel';

test('computeDrivetrainAudioMix returns silent mix when inactive', () => {
  const mix = computeDrivetrainAudioMix({
    speedKmh: 45,
    prevGearStep: 3,
    travelMode: 'DRIVING',
    isActive: false,
  });
  assert.equal(mix.engineGain, 0);
  assert.equal(mix.windGain, 0);
  assert.equal(mix.rpm, 0);
});

test('computeDrivetrainAudioMix shifts gears upward with speed and drops RPM on upshift', () => {
  const preShift = computeDrivetrainAudioMix({
    speedKmh: 17,
    prevGearStep: 1,
    travelMode: 'DRIVING',
    isActive: true,
  });
  assert.equal(preShift.gearStep, 1);
  assert.equal(preShift.shifted, null);

  const postShift = computeDrivetrainAudioMix({
    speedKmh: 19,
    prevGearStep: 1,
    travelMode: 'DRIVING',
    isActive: true,
  });
  assert.equal(postShift.gearStep, 2);
  assert.equal(postShift.shifted, 'up');
  assert.ok(
    postShift.rpm < preShift.rpm,
    `Expected RPM drop on upshift (${postShift.rpm} < ${preShift.rpm})`
  );
});

test('computeDrivetrainAudioMix applies downshift hysteresis so speed ripples do not chatter', () => {
  const holdGear2 = computeDrivetrainAudioMix({
    speedKmh: 16,
    prevGearStep: 2,
    travelMode: 'DRIVING',
    isActive: true,
  });
  assert.equal(holdGear2.gearStep, 2);
  assert.equal(holdGear2.shifted, null);

  const downshiftTo1 = computeDrivetrainAudioMix({
    speedKmh: 12,
    prevGearStep: 2,
    travelMode: 'DRIVING',
    isActive: true,
  });
  assert.equal(downshiftTo1.gearStep, 1);
  assert.equal(downshiftTo1.shifted, 'down');
});

test('computeDrivetrainAudioMix scales aerodynamic wind noise strongly at high speeds', () => {
  const slow = computeDrivetrainAudioMix({
    speedKmh: 15,
    prevGearStep: 1,
    travelMode: 'DRIVING',
    isActive: true,
  });
  const fast = computeDrivetrainAudioMix({
    speedKmh: 72,
    prevGearStep: 5,
    travelMode: 'DRIVING',
    isActive: true,
  });

  assert.ok(fast.windGain > slow.windGain * 5, 'Wind gain ramps sharply at highway speed');
  assert.ok(fast.windFilterHz > slow.windFilterHz, 'Wind cutoff brightens with speed');
});

test('computeDrivetrainAudioMix disables car engine sound in WALKING mode', () => {
  const walk = computeDrivetrainAudioMix({
    speedKmh: 5,
    prevGearStep: 1,
    travelMode: 'WALKING',
    isActive: true,
  });
  assert.equal(walk.engineGain, 0);
  assert.equal(walk.rpm, 0);
  assert.ok(walk.windGain > 0);
});

test('computeFlightAudioMix peaks thrust cutoff on TAKEOFF and softens on CRUISE/LANDING', () => {
  const takeoff = computeFlightAudioMix('TAKEOFF', 320, true);
  const cruise = computeFlightAudioMix('CRUISE', 800, true);
  const landing = computeFlightAudioMix('LANDING', 260, true);
  const idle = computeFlightAudioMix('CRUISE', 800, false);

  assert.ok(takeoff.lowpassHz > cruise.lowpassHz);
  assert.ok(takeoff.cabinGain > landing.cabinGain);
  assert.equal(idle.cabinGain, 0);
});

test('computeWalkAudioMix yields natural cadence interval 105..127 spm when walking', () => {
  const walk = computeWalkAudioMix(4.8, true);
  assert.ok(walk.cadenceSpm >= 105 && walk.cadenceSpm <= 128);
  assert.ok(walk.stepIntervalMs > 400 && walk.stepIntervalMs < 650);
  const paused = computeWalkAudioMix(0, true);
  assert.equal(paused.cadenceSpm, 0);
});
