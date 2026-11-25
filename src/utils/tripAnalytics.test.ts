import test from 'node:test';
import assert from 'node:assert/strict';
import {
  aggregateChallengeLeaderboard,
  aggregateDriveHistory,
  computeChallengeBestScoreMap,
  downsampleTelemetryForChart,
  extractRegionLabelFromAddress,
  extractRoadNamesFromSteps,
  sampleRouteCheckpoints,
  summarizeTripTelemetry,
} from './tripAnalytics';
import { CHALLENGE_COURSES } from '../data/presets';
import type { RouteStepInfo } from '../engine/routeSimulation';
import type { DriveTripRecord } from '../types/drive';

test('extractRegionLabelFromAddress parses Korean and international addresses cleanly', () => {
  assert.equal(
    extractRegionLabelFromAddress('대한민국 서울특별시 강남구 역삼동 테헤란로 152'),
    '강남구 역삼동'
  );
  assert.equal(
    extractRegionLabelFromAddress('대한민국 서울특별시 서초구 서초동 1318'),
    '서초구 서초동'
  );
  assert.equal(
    extractRegionLabelFromAddress('Times Square, Manhattan, New York, NY 10036, USA'),
    'Manhattan, New York'
  );
  assert.equal(extractRegionLabelFromAddress(''), null);
});

test('extractRoadNamesFromSteps collects real road corridors within driven distance', () => {
  const steps: RouteStepInfo[] = [
    {
      index: 0,
      instructions: '강남대로를 따라 직진',
      distanceMeters: 400,
      durationSeconds: 60,
      startDistanceMeters: 0,
      endDistanceMeters: 400,
      startLocation: { lat: 37.4979, lng: 127.0276 },
      endLocation: { lat: 37.499, lng: 127.028 },
    },
    {
      index: 1,
      instructions: '테헤란로 방면으로 우회전',
      distanceMeters: 2800,
      durationSeconds: 400,
      startDistanceMeters: 400,
      endDistanceMeters: 3200,
      startLocation: { lat: 37.499, lng: 127.028 },
      endLocation: { lat: 37.508, lng: 127.058 },
    },
    {
      index: 2,
      instructions: '영동대로로 좌회전',
      distanceMeters: 600,
      durationSeconds: 90,
      startDistanceMeters: 3200,
      endDistanceMeters: 3800,
      startLocation: { lat: 37.508, lng: 127.058 },
      endLocation: { lat: 37.511, lng: 127.059 },
    },
  ];

  const partialRoads = extractRoadNamesFromSteps(steps, 1000);
  assert.deepEqual(partialRoads, ['강남대로', '테헤란로']);

  const fullRoads = extractRoadNamesFromSteps(steps, 3800);
  assert.deepEqual(fullRoads, ['강남대로', '테헤란로', '영동대로']);
});

test('sampleRouteCheckpoints extracts distributed coordinates along driven distance', () => {
  const path = [
    { lat: 37.4979, lng: 127.0276 },
    { lat: 37.501, lng: 127.036 },
    { lat: 37.505, lng: 127.046 },
    { lat: 37.511, lng: 127.059 },
  ];
  const cum = [0, 900, 2000, 3800];
  const checkpoints = sampleRouteCheckpoints(path, cum, 3800, 4);
  assert.equal(checkpoints.length, 4);
  assert.deepEqual(checkpoints[0], path[0]);
  assert.deepEqual(checkpoints[3], path[3]);
});

test('summarizeTripTelemetry and aggregateDriveHistory compute totals, regions, and view modes', () => {
  const telemetry = [
    { elapsedSeconds: 2, distanceMeters: 15, speedKmh: 24, viewMode: 'streetview' as const },
    { elapsedSeconds: 4, distanceMeters: 40, speedKmh: 28, viewMode: 'aerial' as const },
    { elapsedSeconds: 6, distanceMeters: 65, speedKmh: 22, viewMode: 'streetview' as const },
  ];

  const summary = summarizeTripTelemetry(telemetry, 65, 6, {
    streetview: 4,
    aerial: 2,
    split: 0,
    map: 0,
  });

  assert.equal(summary.maxSpeedKmh, 28);
  assert.ok(summary.avgSpeedKmh > 20 && summary.avgSpeedKmh < 30);
  assert.equal(summary.viewModeSeconds.streetview, 4);
  assert.equal(summary.viewModeSeconds.aerial, 2);

  const downsampled = downsampleTelemetryForChart(telemetry, 2);
  assert.equal(downsampled.length, 2);

  const trips: DriveTripRecord[] = [
    {
      id: 'trip-1',
      startedAtIso: '2026-11-24T10:00:00Z',
      endedAtIso: '2026-11-24T10:08:00Z',
      originName: '강남역',
      destinationName: '코엑스',
      travelMode: 'DRIVING',
      distanceMeters: 3800,
      elapsedSeconds: 480,
      avgSpeedKmh: 28.5,
      maxSpeedKmh: 45,
      score: 950,
      completed: true,
      regions: ['강남구 역삼동', '강남구 삼성동'],
      roadNames: ['테헤란로', '영동대로'],
      telemetry,
      viewModeSeconds: { streetview: 360, aerial: 120, split: 0, map: 0 },
    },
    {
      id: 'trip-2',
      startedAtIso: '2026-11-24T11:00:00Z',
      endedAtIso: '2026-11-24T11:05:00Z',
      originName: '광화문',
      destinationName: '남산타워',
      travelMode: 'DRIVING',
      distanceMeters: 2200,
      elapsedSeconds: 300,
      avgSpeedKmh: 26.4,
      maxSpeedKmh: 38,
      score: 550,
      completed: false,
      regions: ['종로구 세종로', '중구 회현동'],
      roadNames: ['세종대로'],
      telemetry,
      viewModeSeconds: { streetview: 200, aerial: 50, split: 50, map: 0 },
    },
  ];

  const agg = aggregateDriveHistory(trips);
  assert.equal(agg.totalTrips, 2);
  assert.equal(agg.completedTrips, 1);
  assert.equal(agg.totalDistanceMeters, 6000);
  assert.equal(agg.totalElapsedSeconds, 780);
  assert.equal(agg.regionStats.length, 4);
  assert.equal(agg.viewModeBreakdown[0].key, 'streetview');
  assert.equal(agg.tripTrendData.length, 2);
});

test('aggregateChallengeLeaderboard ranks courses by best score and sorts per-course attempts', () => {
  const telemetry = [
    { elapsedSeconds: 2, distanceMeters: 20, speedKmh: 30, viewMode: 'streetview' as const },
  ];
  const baseTrip = {
    startedAtIso: '2026-11-24T10:00:00Z',
    originName: '출발',
    destinationName: '도착',
    travelMode: 'DRIVING' as const,
    distanceMeters: 5000,
    elapsedSeconds: 300,
    avgSpeedKmh: 40,
    maxSpeedKmh: 65,
    regions: ['제주'],
    roadNames: ['애월해안로'],
    telemetry,
    viewModeSeconds: { streetview: 300, aerial: 0, split: 0, map: 0 },
  };

  const trips: DriveTripRecord[] = [
    {
      ...baseTrip,
      id: 'c1',
      endedAtIso: '2026-11-24T10:05:00Z',
      score: 1450,
      completed: false,
      challengeId: CHALLENGE_COURSES[0].id,
      challengeTitle: CHALLENGE_COURSES[0].title,
    },
    {
      ...baseTrip,
      id: 'c2',
      endedAtIso: '2026-11-24T10:15:00Z',
      score: 2350,
      completed: true,
      challengeId: CHALLENGE_COURSES[0].id,
      challengeTitle: CHALLENGE_COURSES[0].title,
    },
    {
      ...baseTrip,
      id: 'c3',
      endedAtIso: '2026-11-24T10:25:00Z',
      score: 2780,
      completed: true,
      challengeId: CHALLENGE_COURSES[1].id,
      challengeTitle: CHALLENGE_COURSES[1].title,
    },
  ];

  const board = aggregateChallengeLeaderboard(trips, CHALLENGE_COURSES);
  assert.equal(board.length, CHALLENGE_COURSES.length);
  // Highest bestScore course ranks 1st overall
  assert.equal(board[0].course.id, CHALLENGE_COURSES[1].id);
  assert.equal(board[0].bestScore, 2780);
  assert.equal(board[1].course.id, CHALLENGE_COURSES[0].id);
  assert.equal(board[1].bestScore, 2350);
  assert.equal(board[1].attemptCount, 2);
  assert.equal(board[1].topRuns[0].tripId, 'c2');
  assert.equal(board[1].topRuns[0].rank, 1);
  assert.equal(board[1].topRuns[1].tripId, 'c1');
  assert.equal(board[1].topRuns[1].rank, 2);

  const bestMap = computeChallengeBestScoreMap(trips);
  assert.equal(bestMap[CHALLENGE_COURSES[0].id], 2350);
  assert.equal(bestMap[CHALLENGE_COURSES[1].id], 2780);
});
