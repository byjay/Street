import test from 'node:test';
import assert from 'node:assert/strict';
import { BUSAN_TO_SEOUL_NODES } from '../data/flightRoutes';
import {
  applyBankingRoll,
  buildFlightTrajectory,
  computeBearingDeg,
  resolveFlightPhaseAndSpeed,
  sampleFlightStateAtDistance,
} from './flightSimulation';

test('PUS -> GMP great-circle bearing points northwest (300..350 deg)', () => {
  const bearing = computeBearingDeg(
    { lat: 35.1796, lng: 128.9382 },
    { lat: 37.5583, lng: 126.7906 }
  );
  assert.ok(bearing > 300 && bearing < 350, `Expected 300..350, got ${bearing}`);
});

test('Catmull-Rom flight trajectory generates >= 300 smooth waypoints with altitude >= 30m and bounded bank roll', () => {
  const raw = buildFlightTrajectory(BUSAN_TO_SEOUL_NODES, 60);
  const traj = applyBankingRoll(raw);

  assert.ok(traj.length >= 300, `Expected >= 300 points, got ${traj.length}`);
  assert.ok(
    traj.every((wp) => wp.altitudeMeters >= 30),
    'All waypoints must maintain >= 30m altitude'
  );
  assert.ok(
    traj.every((wp) => Math.abs(wp.rollDeg) <= 22),
    'All banking angles must stay within +/-22 deg'
  );
});

test('5 flight phases progress chronologically across normalized route progress', () => {
  assert.equal(resolveFlightPhaseAndSpeed(0.02).phase, 'TAKEOFF');
  assert.equal(resolveFlightPhaseAndSpeed(0.12).phase, 'CLIMB');
  assert.equal(resolveFlightPhaseAndSpeed(0.5).phase, 'CRUISE');
  assert.equal(resolveFlightPhaseAndSpeed(0.85).phase, 'DESCENT');
  assert.equal(resolveFlightPhaseAndSpeed(0.97).phase, 'LANDING');
});

test('sampleFlightStateAtDistance returns cruise altitude and nearest landmark mid-flight', () => {
  const traj = applyBankingRoll(buildFlightTrajectory(BUSAN_TO_SEOUL_NODES, 60));
  const total = traj[traj.length - 1].distanceFromStartMeters;
  const mid = sampleFlightStateAtDistance(traj, BUSAN_TO_SEOUL_NODES, total * 0.55);

  assert.equal(mid.telemetry.phase, 'CRUISE');
  assert.ok(mid.telemetry.altitudeMeters > 6000);
  assert.ok(mid.telemetry.nearestLandmark.length > 0);
});
