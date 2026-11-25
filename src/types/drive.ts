import type { LatLngPoint, RouteStepInfo } from '../engine/routeSimulation';

export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export type CameraViewMode = 'streetview' | 'aerial' | 'split' | 'map';

export type TravelModeOption = 'DRIVING' | 'WALKING';

export interface SelectedPlaceInfo {
  name: string;
  address?: string;
  location: LatLngPoint;
  placeId?: string;
}

export interface ComputedRouteData {
  origin: SelectedPlaceInfo;
  destination: SelectedPlaceInfo;
  travelMode: TravelModeOption;
  path: LatLngPoint[];
  cumDistances: number[];
  totalDistanceMeters: number;
  estimatedDurationSeconds: number;
  steps: RouteStepInfo[];
  viewport?: google.maps.LatLngBoundsLiteral | google.maps.LatLngBounds;
  usedSurfaceTransitFallback?: boolean;
}

export interface GroundedPlaceLink {
  title: string;
  uri: string;
  placeId?: string;
  reviewSnippets: string[];
}

export interface GroundingGuideResponse {
  summary: string;
  places: GroundedPlaceLink[];
}

export interface GlobalRoutePreset {
  id: string;
  title: string;
  subtitle: string;
  regionTag: string;
  originQuery: string;
  destinationQuery: string;
  travelMode: TravelModeOption;
}

export interface ChallengeCourse {
  id: string;
  title: string;
  subtitle: string;
  regionTag: string;
  category: '해안도로' | '산악와인딩' | '도심야경';
  difficulty: '보통' | '도전' | '마스터';
  originQuery: string;
  destinationQuery: string;
  travelMode: TravelModeOption;
  targetScore: number;
}

export interface TelemetrySample {
  elapsedSeconds: number;
  distanceMeters: number;
  speedKmh: number;
  viewMode: CameraViewMode;
}

export interface DriveTripRecord {
  id: string;
  startedAtIso: string;
  endedAtIso: string;
  originName: string;
  destinationName: string;
  travelMode: TravelModeOption;
  distanceMeters: number;
  elapsedSeconds: number;
  avgSpeedKmh: number;
  maxSpeedKmh: number;
  score: number;
  completed: boolean;
  challengeId?: string;
  challengeTitle?: string;
  regions: string[];
  roadNames: string[];
  telemetry: TelemetrySample[];
  viewModeSeconds: Record<CameraViewMode, number>;
}

export interface ChallengeRankEntry {
  rank: number;
  tripId: string;
  score: number;
  distanceMeters: number;
  elapsedSeconds: number;
  avgSpeedKmh: number;
  completed: boolean;
  endedAtIso: string;
}

export interface ChallengeCourseLeaderboard {
  course: ChallengeCourse;
  bestScore: number;
  attemptCount: number;
  completedCount: number;
  completionRatePct: number;
  topRuns: ChallengeRankEntry[];
}

export interface VisitedRegionAggregate {
  region: string;
  visits: number;
  distanceMeters: number;
  durationSeconds: number;
}

export interface ViewModeAggregate {
  key: CameraViewMode;
  label: string;
  seconds: number;
  percent: number;
}

export interface DriveHistorySummary {
  totalTrips: number;
  completedTrips: number;
  totalDistanceMeters: number;
  totalElapsedSeconds: number;
  overallAvgSpeedKmh: number;
  totalScore: number;
  regionStats: VisitedRegionAggregate[];
  viewModeBreakdown: ViewModeAggregate[];
  tripTrendData: Array<{
    id: string;
    label: string;
    distanceKm: number;
    durationMin: number;
    avgSpeedKmh: number;
  }>;
}

