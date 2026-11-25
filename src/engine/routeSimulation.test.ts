import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCumulativeDistances,
  computeBearing,
  evaluateCornerSlowdown,
  findActiveStep,
  formatDistanceKr,
  formatDurationKr,
  haversineMeters,
  normalizeAngleDelta,
  samplePointAlongPath,
  stepVehiclePhysics,
  type RouteStepInfo,
  type VehiclePhysicsState,
} from './routeSimulation';

test('haversineMeters calculates realistic distance between Gangnam Station and COEX', () => {
  const gangnam = { lat: 37.4979, lng: 127.0276 };
  const coex = { lat: 37.5116, lng: 127.0592 };
  const dist = haversineMeters(gangnam, coex);
  assert.ok(dist > 3000 && dist < 3500, `Expected ~3.2km, got ${dist}`);
});

test('computeBearing returns cardinal compass bearings accurately', () => {
  const origin = { lat: 37.5, lng: 127.0 };
  const north = { lat: 37.51, lng: 127.0 };
  const east = { lat: 37.5, lng: 127.01 };
  const south = { lat: 37.49, lng: 127.0 };

  assert.ok(Math.abs(computeBearing(origin, north) - 0) < 0.5);
  assert.ok(Math.abs(computeBearing(origin, east) - 90) < 0.5);
  assert.ok(Math.abs(computeBearing(origin, south) - 180) < 0.5);
});

test('normalizeAngleDelta picks shortest signed turn angle', () => {
  assert.equal(normalizeAngleDelta(350, 10), 20);
  assert.equal(normalizeAngleDelta(10, 350), -20);
  assert.equal(normalizeAngleDelta(90, 180), 90);
});

test('samplePointAlongPath interpolates midpoints and clamps boundaries', () => {
  const path = [
    { lat: 37.5, lng: 127.0 },
    { lat: 37.5, lng: 127.01 },
    { lat: 37.51, lng: 127.01 },
  ];
  const cum = buildCumulativeDistances(path);
  const total = cum[cum.length - 1];

  const startSample = samplePointAlongPath(path, cum, -50);
  assert.equal(startSample.clampedDistanceMeters, 0);
  assert.equal(startSample.progress, 0);

  const midFirstLeg = samplePointAlongPath(path, cum, cum[1] / 2);
  assert.ok(Math.abs(midFirstLeg.position.lng - 127.005) < 1e-4);
  assert.ok(Math.abs(midFirstLeg.heading - 90) < 1);

  const endSample = samplePointAlongPath(path, cum, total + 500);
  assert.equal(endSample.clampedDistanceMeters, total);
  assert.equal(endSample.progress, 1);
});

test('findActiveStep locates current instruction and distance to next turn', () => {
  const steps: RouteStepInfo[] = [
    {
      index: 0,
      instructions: '테헤란로를 따라 직진',
      distanceMeters: 400,
      durationSeconds: 40,
      startDistanceMeters: 0,
      endDistanceMeters: 400,
      startLocation: { lat: 37.5, lng: 127.02 },
      endLocation: { lat: 37.5, lng: 127.03 },
    },
    {
      index: 1,
      instructions: '영동대로 방면 우회전',
      maneuver: 'TURN_RIGHT',
      distanceMeters: 300,
      durationSeconds: 30,
      startDistanceMeters: 400,
      endDistanceMeters: 700,
      startLocation: { lat: 37.5, lng: 127.03 },
      endLocation: { lat: 37.51, lng: 127.03 },
    },
  ];

  const lookup = findActiveStep(steps, 250);
  assert.equal(lookup.currentStep?.index, 0);
  assert.equal(lookup.nextStep?.index, 1);
  assert.equal(lookup.distanceToNextTurnMeters, 150);
});

test('stepVehiclePhysics accelerates, cruises, brakes, and triggers arrival', () => {
  let state: VehiclePhysicsState = {
    distanceMeters: 0,
    totalDistanceMeters: 100,
    speedKmh: 0,
    gear: 'P',
    score: 0,
    elapsedSeconds: 0,
    arrived: false,
  };

  for (let i = 0; i < 40; i += 1) {
    state = stepVehiclePhysics(
      state,
      {
        isCruising: true,
        cruiseMultiplier: 1,
        gasPressed: false,
        brakePressed: false,
        travelMode: 'DRIVING',
      },
      0.05
    );
  }

  assert.ok(state.speedKmh >= 18 && state.speedKmh <= 25);
  assert.equal(state.gear, 'D');
  assert.ok(state.distanceMeters > 0);
  assert.ok(state.score > 0);

  // Braking reduces speed
  const braked = stepVehiclePhysics(
    state,
    {
      isCruising: false,
      cruiseMultiplier: 1,
      gasPressed: false,
      brakePressed: true,
      travelMode: 'DRIVING',
    },
    0.05
  );
  assert.ok(braked.speedKmh < state.speedKmh);

  // Reaching end sets arrived and Park gear
  const nearEnd: VehiclePhysicsState = {
    ...state,
    distanceMeters: 99.8,
  };
  const finished = stepVehiclePhysics(
    nearEnd,
    {
      isCruising: true,
      cruiseMultiplier: 1,
      gasPressed: false,
      brakePressed: false,
      travelMode: 'DRIVING',
    },
    0.05
  );
  assert.equal(finished.arrived, true);
  assert.equal(finished.gear, 'P');
  assert.equal(finished.speedKmh, 0);
});

test('formatDistanceKr and formatDurationKr format Korean navigation units', () => {
  assert.equal(formatDistanceKr(240), '240m');
  assert.equal(formatDistanceKr(3250), '3.3km');
  assert.equal(formatDistanceKr(14800), '15km');
  assert.equal(formatDurationKr(45), '1분');
  assert.equal(formatDurationKr(4200), '1시간 10분');
});

test('evaluateCornerSlowdown and stepVehiclePhysics automatically decelerate on sharp corners and recover on straights', () => {
  // L-shaped route: ~440m East, then sharp 90° turn North for ~555m
  const path = [
    { lat: 37.5, lng: 127.0 },
    { lat: 37.5, lng: 127.005 },
    { lat: 37.505, lng: 127.005 },
  ];
  const cum = buildCumulativeDistances(path);
  const totalDist = cum[cum.length - 1];
  const cornerDist = cum[1]; // ~441m

  // Far from corner on straight segment -> full speed
  const straightCheck = evaluateCornerSlowdown(path, cum, 80, 48, 'DRIVING');
  assert.equal(straightCheck.isCornering, false);
  assert.equal(straightCheck.speedFactor, 1);

  // Approaching corner (25m before apex) -> automatic slowdown detected
  const approachCheck = evaluateCornerSlowdown(
    path,
    cum,
    cornerDist - 25,
    48,
    'DRIVING'
  );
  assert.equal(approachCheck.isCornering, true);
  assert.ok(approachCheck.cornerAngleDeg >= 80);
  assert.ok(approachCheck.speedFactor < 0.55);

  // Simulate driving from d=200m at 2x cruise (48 km/h) through the corner and onto the exit straight
  let state: VehiclePhysicsState = {
    distanceMeters: 200,
    totalDistanceMeters: totalDist,
    speedKmh: 48,
    gear: 'D',
    score: 0,
    elapsedSeconds: 0,
    arrived: false,
  };

  let minSpeedAroundCorner = Infinity;
  let sawCornerIndicator = false;
  let exitSpeed = 0;

  for (let i = 0; i < 950; i += 1) {
    state = stepVehiclePhysics(
      state,
      {
        isCruising: true,
        cruiseMultiplier: 2, // 48 km/h straight cruise target
        gasPressed: false,
        brakePressed: false,
        travelMode: 'DRIVING',
        routePath: path,
        cumDistances: cum,
      },
      0.05
    );

    if (
      state.distanceMeters >= cornerDist - 35 &&
      state.distanceMeters <= cornerDist + 35
    ) {
      if (state.speedKmh < minSpeedAroundCorner) {
        minSpeedAroundCorner = state.speedKmh;
      }
      if (state.isCornering) {
        sawCornerIndicator = true;
      }
    }

    if (state.distanceMeters >= cornerDist + 180 && !state.arrived) {
      exitSpeed = state.speedKmh;
      break;
    }
  }

  assert.equal(sawCornerIndicator, true);
  assert.ok(
    minSpeedAroundCorner < 32 && minSpeedAroundCorner >= 11,
    `Expected automatic corner slowdown to 11..32 km/h, got ${minSpeedAroundCorner}`
  );
  assert.ok(
    exitSpeed > minSpeedAroundCorner + 10,
    `Expected smooth re-acceleration on exit straight, got corner=${minSpeedAroundCorner}, exit=${exitSpeed}`
  );
});
