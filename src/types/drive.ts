import type { LatLngPoint, RouteStepInfo } from '../engine/routeSimulation';

export type GameState = 'title' | 'playing' | 'paused' | 'gameover';

export type CameraViewMode = 'streetview' | 'aerial' | 'split' | 'map';

export type CameraFollowMode = 'forward' | 'relative' | 'free';

export type MapProviderMode = 'free-kr' | 'free-global' | 'google';

export function isFreeProvider(provider: MapProviderMode): boolean {
  return provider !== 'google';
}

export type TravelModeOption = 'DRIVING' | 'WALKING';

export type TransportMode = 'walk' | 'drive' | 'flight';

export type FlightCameraMode = 'cockpit' | 'window-left' | 'window-right' | 'chase';

export type FlightTimeOfDay = 'dawn' | 'day' | 'sunset' | 'night';

export type FlightPhase = 'TAKEOFF' | 'CLIMB' | 'CRUISE' | 'DESCENT' | 'LANDING';

export interface AppRuntimeConfig {
  defaultProvider: MapProviderMode;
  availableProviders: MapProviderMode[];
  mapsApiKey: string;
  kakaoMapKey: string;
  mapillaryToken: string;
  vworldApiKey: string;
  hasGeminiGuide: boolean;
}

export interface FlightWaypoint {
  lat: number;
  lng: number;
  altitudeMeters: number;
  distanceFromStartMeters: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  landmarkName?: string;
}

export interface FlightTelemetry {
  progress: number; // 0..1
  distanceMeters: number;
  totalDistanceMeters: number;
  altitudeMeters: number;
  speedKmh: number;
  headingDeg: number;
  pitchDeg: number;
  rollDeg: number;
  remainingKm: number;
  etaMinutes: number;
  phase: FlightPhase;
  nearestLandmark: string;
  nearestLandmarkDescription: string;
}

export interface TripLeg {
  id: string;
  title: string;
  transportMode: TransportMode;
  originName: string;
  destinationName: string;
  origin: LatLngPoint;
  destination: LatLngPoint;
  autoTransitionToNext: boolean;
}

export interface SeamlessTransitionState {
  phase: 'IDLE' | 'DIVING_TO_STREET' | 'ASCENDING_TO_EARTH';
  label: string;
  overlayOpacity: number;
  targetCoord: { lat: number; lng: number; headingDeg: number } | null;
}

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
