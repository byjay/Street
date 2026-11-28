import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Map as MapIcon, Maximize2, Minimize2, Plane, X } from 'lucide-react';
import { driveAudio } from './audio/driveAudio';
import { AerialMapViewer } from './components/AerialMapViewer';
import { DriveHistoryDashboard } from './components/DriveHistoryDashboard';
import { DriveHud } from './components/DriveHud';
import { FlightHud } from './components/FlightHud';
import { FlightViewer } from './components/FlightViewer';
import { FreeMapViewer } from './components/FreeMapViewer';
import { GroundGuideDrawer } from './components/GroundGuideDrawer';
import { StatusModal } from './components/StatusModal';
import { StreetViewViewer } from './components/StreetViewViewer';
import { TitleOverlay } from './components/TitleOverlay';
import {
  BUSAN_TO_SEOUL_NODES,
  MULTI_LEG_BUSAN_SEOUL_JOURNEY,
} from './data/flightRoutes';
import { GLOBAL_ROUTE_PRESETS } from './data/presets';
import {
  applyBankingRoll,
  buildFlightTrajectory,
  sampleFlightStateAtDistance,
} from './engine/flightSimulation';
import {
  findActiveStep,
  haversineMeters,
  samplePointAlongPath,
  stepVehiclePhysics,
  type VehiclePhysicsState,
} from './engine/routeSimulation';
import {
  isFreeProvider,
  type AppRuntimeConfig,
  type CameraFollowMode,
  type CameraViewMode,
  type ChallengeCourse,
  type ComputedRouteData,
  type DriveTripRecord,
  type FlightCameraMode,
  type FlightTelemetry,
  type FlightTimeOfDay,
  type GameState,
  type GlobalRoutePreset,
  type MapProviderMode,
  type SeamlessTransitionState,
  type SelectedPlaceInfo,
  type TelemetrySample,
  type TransportMode,
  type TravelModeOption,
  type TripLeg,
} from './types/drive';
import {
  computeFreeDrivingRoute,
  resolveFreePlaceByQuery,
} from './utils/freeMapsHelpers';
import { computeDrivingRoute, resolvePlaceByQuery } from './utils/mapsHelpers';
import { downloadTravelPostcard } from './utils/postcardCapture';
import { resolveVisitedRegionsForTrip } from './utils/regionResolver';
import {
  clearTripHistory,
  computeChallengeBestScoreMap,
  extractRegionLabelFromAddress,
  extractRoadNamesFromSteps,
  loadTripHistory,
  saveTripRecord,
  summarizeTripTelemetry,
  updateTripRegions,
} from './utils/tripAnalytics';

const INITIAL_FALLBACK_POS = { lat: 37.4979, lng: 127.0276 };

const INITIAL_PHYSICS: VehiclePhysicsState = {
  distanceMeters: 0,
  totalDistanceMeters: 0,
  speedKmh: 0,
  gear: 'P',
  score: 0,
  elapsedSeconds: 0,
  arrived: false,
};

const TIME_OF_DAY_ORDER: FlightTimeOfDay[] = ['day', 'sunset', 'night', 'dawn'];

const GoogleMapsBridge: React.FC<{
  onLibrariesChange: (
    places: google.maps.PlacesLibrary | null,
    routes: google.maps.RoutesLibrary | null
  ) => void;
}> = ({ onLibrariesChange }) => {
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');

  useEffect(() => {
    onLibrariesChange(placesLib ?? null, routesLib ?? null);
  }, [placesLib, routesLib, onLibrariesChange]);

  useEffect(() => {
    return () => {
      onLibrariesChange(null, null);
    };
  }, [onLibrariesChange]);

  return null;
};

interface RoadWindowWorkspaceProps {
  mapProvider: MapProviderMode;
  onChangeMapProvider: (mode: MapProviderMode) => void;
  placesLib: google.maps.PlacesLibrary | null;
  routesLib: google.maps.RoutesLibrary | null;
  hasGoogleKey: boolean;
  kakaoMapKey: string;
  vworldApiKey: string;
  billingRequired?: boolean;
}

const RoadWindowWorkspace: React.FC<RoadWindowWorkspaceProps> = ({
  mapProvider,
  onChangeMapProvider,
  placesLib,
  routesLib,
  hasGoogleKey,
  kakaoMapKey,
  vworldApiKey,
  billingRequired = false,
}) => {
  const isFree = isFreeProvider(mapProvider);

  const [gameState, setGameState] = useState<GameState>('title');
  const [activeTransport, setActiveTransport] = useState<TransportMode>('drive');
  const [travelMode, setTravelMode] = useState<TravelModeOption>('DRIVING');
  const [initialViewMode, setInitialViewMode] =
    useState<CameraViewMode>('streetview');
  const [viewMode, setViewMode] = useState<CameraViewMode>('streetview');
  const [cameraFollowMode, setCameraFollowMode] =
    useState<CameraFollowMode>('forward');
  const [preferStreetPhoto, setPreferStreetPhoto] = useState<boolean>(true);
  const [walkBobbingEnabled, setWalkBobbingEnabled] = useState<boolean>(true);

  const [origin, setOrigin] = useState<SelectedPlaceInfo | null>(null);
  const [destination, setDestination] = useState<SelectedPlaceInfo | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [isStarting, setIsStarting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);

  const [routeData, setRouteData] = useState<ComputedRouteData | null>(null);
  const [rawRoute, setRawRoute] = useState<google.maps.routes.Route | null>(
    null
  );

  const [physics, setPhysics] = useState<VehiclePhysicsState>(INITIAL_PHYSICS);
  const physicsRef = useRef<VehiclePhysicsState>(INITIAL_PHYSICS);

  const [isCruising, setIsCruising] = useState(true);
  const isCruisingRef = useRef(true);
  const [cruiseMultiplier, setCruiseMultiplier] = useState(1);
  const cruiseMultiplierRef = useRef(1);
  const gasPressedRef = useRef(false);
  const brakePressedRef = useRef(false);

  const [isMuted, setIsMuted] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [guideInitialMode, setGuideInitialMode] = useState<
    'nearby' | 'destination' | 'flight'
  >('destination');
  const [stepNonce, setStepNonce] = useState(0);
  const [showMinimapPip, setShowMinimapPip] = useState(false);

  const [tripHistory, setTripHistory] = useState<DriveTripRecord[]>(() =>
    loadTripHistory()
  );
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [isResolvingRegions, setIsResolvingRegions] = useState(false);

  // Flight state
  const flightWaypoints = useMemo(
    () => applyBankingRoll(buildFlightTrajectory(BUSAN_TO_SEOUL_NODES, 60)),
    []
  );
  const totalFlightDistance =
    flightWaypoints[flightWaypoints.length - 1]?.distanceFromStartMeters ?? 0;

  const flightDistanceRef = useRef<number>(0);
  const isFlyingRef = useRef<boolean>(true);
  const flightSpeedMultRef = useRef<number>(10);
  const [isFlying, setIsFlying] = useState(true);
  const [flightSpeedMult, setFlightSpeedMult] = useState(10);
  const [flightCameraMode, setFlightCameraMode] =
    useState<FlightCameraMode>('cockpit');
  const [flightTimeOfDay, setFlightTimeOfDay] = useState<FlightTimeOfDay>('day');
  const [flightSample, setFlightSample] = useState(() =>
    sampleFlightStateAtDistance(flightWaypoints, BUSAN_TO_SEOUL_NODES, 0)
  );

  // Multi-leg journey & Earth<->Street seamless crossfade state
  const [tripLegs, setTripLegs] = useState<TripLeg[]>([]);
  const [activeLegIndex, setActiveLegIndex] = useState<number>(0);
  const [seamlessTransition, setSeamlessTransition] =
    useState<SeamlessTransitionState>({
      phase: 'IDLE',
      label: '',
      overlayOpacity: 0,
      targetCoord: null,
    });

  const lastStepIndexRef = useRef<number>(-1);
  const autostartTriggeredRef = useRef(false);
  const defaultResolvedRef = useRef(false);
  const telemetrySamplesRef = useRef<TelemetrySample[]>([]);
  const viewModeSecondsRef = useRef<Record<CameraViewMode, number>>({
    streetview: 0,
    aerial: 0,
    split: 0,
    map: 0,
  });
  const lastTelemetryAtRef = useRef<number>(0);
  const tripStartedAtRef = useRef<string>(new Date().toISOString());
  const tripFinalizedRef = useRef<boolean>(false);
  const viewModeRef = useRef<CameraViewMode>(viewMode);
  const activeChallengeRef = useRef<ChallengeCourse | null>(null);

  const challengeBestScores = useMemo(
    () => computeChallengeBestScoreMap(tripHistory),
    [tripHistory]
  );

  useEffect(() => {
    document.body.dataset.state = gameState;
    document.body.dataset.provider = mapProvider;
    document.body.dataset.transport = activeTransport;
  }, [gameState, mapProvider, activeTransport]);

  useEffect(() => {
    isCruisingRef.current = isCruising;
  }, [isCruising]);

  useEffect(() => {
    cruiseMultiplierRef.current = cruiseMultiplier;
  }, [cruiseMultiplier]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

  useEffect(() => {
    isFlyingRef.current = isFlying;
  }, [isFlying]);

  useEffect(() => {
    flightSpeedMultRef.current = flightSpeedMult;
  }, [flightSpeedMult]);

  const handleChangeTransport = useCallback((mode: TransportMode) => {
    setActiveTransport(mode);
    setRouteError(null);
    if (mode === 'walk') {
      setTravelMode('WALKING');
    } else if (mode === 'drive') {
      setTravelMode('DRIVING');
    }
  }, []);

  const finalizeCurrentTrip = useCallback(
    (completed: boolean, finalPhysics?: VehiclePhysicsState) => {
      if (!routeData || tripFinalizedRef.current) return;
      tripFinalizedRef.current = true;

      const snap = finalPhysics ?? physicsRef.current;
      const samples = [...telemetrySamplesRef.current];

      if (samples.length === 0 && snap.distanceMeters > 0) {
        samples.push({
          elapsedSeconds: 0,
          distanceMeters: 0,
          speedKmh: Math.round(snap.speedKmh),
          viewMode: viewModeRef.current,
        });
      }

      if (
        samples.length === 0 ||
        Math.abs(
          samples[samples.length - 1].distanceMeters - snap.distanceMeters
        ) > 5
      ) {
        samples.push({
          elapsedSeconds: Number(snap.elapsedSeconds.toFixed(1)),
          distanceMeters: Math.round(snap.distanceMeters),
          speedKmh: Math.round(snap.speedKmh),
          viewMode: viewModeRef.current,
        });
      }

      const { avgSpeedKmh, maxSpeedKmh, viewModeSeconds } =
        summarizeTripTelemetry(
          samples,
          snap.distanceMeters,
          snap.elapsedSeconds,
          viewModeSecondsRef.current
        );

      const initialRegions: string[] = [];
      const originRegion = extractRegionLabelFromAddress(
        routeData.origin.address
      );
      const destRegion = extractRegionLabelFromAddress(
        routeData.destination.address
      );
      if (originRegion) initialRegions.push(originRegion);
      if (
        destRegion &&
        !initialRegions.includes(destRegion) &&
        (completed ||
          snap.distanceMeters >= routeData.totalDistanceMeters * 0.5)
      ) {
        initialRegions.push(destRegion);
      }
      if (initialRegions.length === 0) {
        initialRegions.push(routeData.origin.name);
        if (
          completed &&
          routeData.destination.name !== routeData.origin.name
        ) {
          initialRegions.push(routeData.destination.name);
        }
      }

      const initialRoads = extractRoadNamesFromSteps(
        routeData.steps,
        snap.distanceMeters
      );

      const tripId = `trip_${Date.now()}_${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const activeChallenge = activeChallengeRef.current;
      const finalScore =
        Math.round(snap.score) + (activeChallenge && completed ? 300 : 0);

      const record: DriveTripRecord = {
        id: tripId,
        startedAtIso: tripStartedAtRef.current,
        endedAtIso: new Date().toISOString(),
        originName: routeData.origin.name,
        destinationName: routeData.destination.name,
        travelMode: routeData.travelMode,
        distanceMeters: Math.round(snap.distanceMeters),
        elapsedSeconds: Math.max(1, Math.round(snap.elapsedSeconds)),
        avgSpeedKmh,
        maxSpeedKmh,
        score: finalScore,
        completed,
        challengeId: activeChallenge?.id,
        challengeTitle: activeChallenge?.title,
        regions: initialRegions,
        roadNames: initialRoads,
        telemetry: samples,
        viewModeSeconds,
      };

      const updatedHistory = saveTripRecord(record);
      setTripHistory(updatedHistory);
      setActiveTripId(tripId);
      setGameState('gameover');
      document.body.dataset.state = 'gameover';
      setDashboardOpen(true);

      setIsResolvingRegions(true);
      void resolveVisitedRegionsForTrip(
        placesLib,
        routeData,
        snap.distanceMeters,
        mapProvider
      )
        .then(({ regions, roadNames }) => {
          const merged = updateTripRegions(tripId, regions, roadNames);
          setTripHistory(merged);
        })
        .catch(() => {})
        .finally(() => {
          setIsResolvingRegions(false);
        });
    },
    [routeData, placesLib, mapProvider]
  );

  const resolveByCurrentProvider = useCallback(
    async (query: string): Promise<SelectedPlaceInfo | null> => {
      if (isFree) {
        return resolveFreePlaceByQuery(query, mapProvider);
      }
      if (!placesLib) return null;
      return resolvePlaceByQuery(placesLib, query);
    },
    [isFree, mapProvider, placesLib]
  );

  const startRouteDrive = useCallback(
    async (
      startOrigin: SelectedPlaceInfo,
      startDestination: SelectedPlaceInfo,
      mode: TravelModeOption,
      challengeCourse: ChallengeCourse | null = null,
      targetViewMode?: CameraViewMode
    ) => {
      if (mapProvider === 'google' && !routesLib) {
        setRouteError(
          '경로 탐색 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.'
        );
        return;
      }

      setIsStarting(true);
      setRouteError(null);

      try {
        let computedData: ComputedRouteData;
        let nextRawRoute: google.maps.routes.Route | null = null;

        if (isFree) {
          computedData = await computeFreeDrivingRoute(
            startOrigin,
            startDestination,
            mode,
            mapProvider
          );
        } else {
          if (!routesLib) {
            throw new Error('Google 경로 탐색 모듈이 준비되지 않았습니다.');
          }
          const bundle = await computeDrivingRoute(
            routesLib,
            startOrigin,
            startDestination,
            mode
          );
          computedData = bundle.data;
          nextRawRoute = bundle.rawRoute;
        }

        const initialPhysics: VehiclePhysicsState = {
          distanceMeters: 0,
          totalDistanceMeters: computedData.totalDistanceMeters,
          speedKmh: 0,
          gear: 'D',
          score: 0,
          elapsedSeconds: 0,
          arrived: false,
        };

        activeChallengeRef.current = challengeCourse;
        physicsRef.current = initialPhysics;
        lastStepIndexRef.current = -1;
        telemetrySamplesRef.current = [];
        viewModeSecondsRef.current = {
          streetview: 0,
          aerial: 0,
          split: 0,
          map: 0,
        };
        lastTelemetryAtRef.current = 0;
        tripStartedAtRef.current = new Date().toISOString();
        tripFinalizedRef.current = false;
        setDashboardOpen(false);
        setPhysics(initialPhysics);
        setRouteData(computedData);
        setRawRoute(nextRawRoute);
        setTravelMode(mode);
        setActiveTransport(mode === 'WALKING' ? 'walk' : 'drive');
        setViewMode(targetViewMode ?? initialViewMode);
        setIsCruising(true);
        isCruisingRef.current = true;
        setGameState('playing');
        document.body.dataset.state = 'playing';

        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
        driveAudio.unlock();
        driveAudio.playSoftClick();
      } catch (err) {
        setRouteError(
          err instanceof Error
            ? err.message
            : '경로를 계산하지 못했습니다. 다른 출발지나 목적지를 선택해 주세요.'
        );
      } finally {
        setIsStarting(false);
      }
    },
    [isFree, mapProvider, routesLib, initialViewMode]
  );

  const startBusanSeoulFlight = useCallback(
    (startDistMeters = 0, legs: TripLeg[] = [], legIdx = 0) => {
      driveAudio.stopDriveLoop();
      driveAudio.unlock();
      driveAudio.playSoftClick();

      const clamped = Math.max(0, Math.min(totalFlightDistance, startDistMeters));
      flightDistanceRef.current = clamped;
      setFlightSample(
        sampleFlightStateAtDistance(flightWaypoints, BUSAN_TO_SEOUL_NODES, clamped)
      );
      setTripLegs(legs);
      setActiveLegIndex(legIdx);
      setIsFlying(true);
      isFlyingRef.current = true;
      setActiveTransport('flight');
      setDashboardOpen(false);
      setRouteError(null);
      setGameState('playing');
      document.body.dataset.state = 'playing';
      document.body.dataset.transport = 'flight';
    },
    [flightWaypoints, totalFlightDistance]
  );

  const handleStartMultiLegJourney = useCallback(() => {
    startBusanSeoulFlight(0, MULTI_LEG_BUSAN_SEOUL_JOURNEY, 0);
  }, [startBusanSeoulFlight]);

  const handleAdvanceNextLeg = useCallback(async () => {
    const nextIdx = activeLegIndex + 1;
    const leg = tripLegs[nextIdx];
    if (!leg) return;
    setActiveLegIndex(nextIdx);
    const legOrig: SelectedPlaceInfo = {
      name: leg.originName,
      location: leg.origin,
    };
    const legDest: SelectedPlaceInfo = {
      name: leg.destinationName,
      location: leg.destination,
    };
    setOrigin(legOrig);
    setDestination(legDest);
    await startRouteDrive(
      legOrig,
      legDest,
      leg.transportMode === 'walk' ? 'WALKING' : 'DRIVING',
      null,
      'streetview'
    );
  }, [activeLegIndex, tripLegs, startRouteDrive]);

  const handleDiveToStreetView = useCallback(async () => {
    const wp = flightSample.waypoint;
    setSeamlessTransition({
      phase: 'DIVING_TO_STREET',
      label: `${flightSample.telemetry.nearestLandmark} 지상으로 다이브 중...`,
      overlayOpacity: 1,
      targetCoord: {
        lat: wp.lat,
        lng: wp.lng,
        headingDeg: wp.headingDeg,
      },
    });
    driveAudio.stopDriveLoop();
    driveAudio.playSoftClick();

    await new Promise((r) => window.setTimeout(r, 380));

    // If part of multi-leg journey, advance directly into Leg 1 (Kimpo -> Gwanghwamun)
    if (tripLegs.length > 0 && activeLegIndex === 0 && tripLegs[1]) {
      await handleAdvanceNextLeg();
    } else {
      const diveOrigin: SelectedPlaceInfo = {
        name: `${flightSample.telemetry.nearestLandmark} 부근 도로`,
        location: { lat: wp.lat, lng: wp.lng },
      };
      const diveDest: SelectedPlaceInfo = {
        name: `${flightSample.telemetry.nearestLandmark} 주변 탐방`,
        location: {
          lat: wp.lat + 0.011,
          lng: wp.lng + 0.012,
        },
      };
      setOrigin(diveOrigin);
      setDestination(diveDest);
      await startRouteDrive(diveOrigin, diveDest, 'DRIVING', null, 'streetview');
    }

    setSeamlessTransition({
      phase: 'IDLE',
      label: '',
      overlayOpacity: 0,
      targetCoord: null,
    });
  }, [flightSample, tripLegs, activeLegIndex, handleAdvanceNextLeg, startRouteDrive]);

  // Resolve initial Gangnam -> COEX default places
  useEffect(() => {
    if (defaultResolvedRef.current) return;
    if (mapProvider === 'google' && !placesLib) return;
    defaultResolvedRef.current = true;

    const loadDefaults = async () => {
      try {
        const [orig, dest] = await Promise.all([
          resolveByCurrentProvider(GLOBAL_ROUTE_PRESETS[0].originQuery),
          resolveByCurrentProvider(GLOBAL_ROUTE_PRESETS[0].destinationQuery),
        ]);
        if (orig) setOrigin((prev) => prev ?? orig);
        if (dest) setDestination((prev) => prev ?? dest);
      } catch {
        // Non-fatal
      }
    };

    void loadDefaults();
  }, [mapProvider, placesLib, resolveByCurrentProvider]);

  // Support ?autostart=1
  useEffect(() => {
    if (autostartTriggeredRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') !== '1') return;
    if (mapProvider === 'google' && (!placesLib || !routesLib)) return;
    if (!origin || !destination) return;

    autostartTriggeredRef.current = true;
    void startRouteDrive(origin, destination, travelMode);
  }, [
    mapProvider,
    placesLib,
    routesLib,
    origin,
    destination,
    travelMode,
    startRouteDrive,
  ]);

  const handleUseCurrentLocation = useCallback(() => {
    if (!navigator.geolocation) {
      setRouteError('이 브라우저에서는 위치 정보(GPS)를 지원하지 않습니다.');
      return;
    }

    setGpsLoading(true);
    setRouteError(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setGpsLoading(false);
        setOrigin({
          name: '현재 내 위치',
          location: {
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          },
        });
      },
      () => {
        setGpsLoading(false);
        setRouteError(
          '현재 위치를 가져오지 못했습니다. 브라우저 위치 권한을 허용하거나 출발지를 검색해 주세요.'
        );
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  }, []);

  const handleStartClick = useCallback(async () => {
    if (activeTransport === 'flight') {
      startBusanSeoulFlight();
      return;
    }
    if (mapProvider === 'google' && (!placesLib || !routesLib)) {
      setRouteError('Google Maps API를 초기화하는 중입니다. 잠시만 기다려 주세요.');
      return;
    }

    let resolvedOrigin = origin;
    let resolvedDest = destination;

    if (!resolvedOrigin) {
      resolvedOrigin = await resolveByCurrentProvider(
        GLOBAL_ROUTE_PRESETS[0].originQuery
      );
      if (resolvedOrigin) setOrigin(resolvedOrigin);
    }

    if (!resolvedDest) {
      resolvedDest = await resolveByCurrentProvider(
        GLOBAL_ROUTE_PRESETS[0].destinationQuery
      );
      if (resolvedDest) setDestination(resolvedDest);
    }

    if (!resolvedOrigin || !resolvedDest) {
      setRouteError('출발지와 목적지를 모두 선택해 주세요.');
      return;
    }

    const mode: TravelModeOption =
      activeTransport === 'walk' ? 'WALKING' : 'DRIVING';
    await startRouteDrive(resolvedOrigin, resolvedDest, mode, null);
  }, [
    activeTransport,
    startBusanSeoulFlight,
    mapProvider,
    placesLib,
    routesLib,
    origin,
    destination,
    resolveByCurrentProvider,
    startRouteDrive,
  ]);

  const handleSelectPreset = useCallback(
    async (preset: GlobalRoutePreset) => {
      if (mapProvider === 'google' && (!placesLib || !routesLib)) {
        setRouteError(
          'Google Maps API(결제 활성화 필요)를 불러오지 못했습니다. 무료·국내 또는 무료·글로벌 엔진으로 바로 주행할 수 있습니다.'
        );
        return;
      }
      setIsStarting(true);
      setRouteError(null);
      setTravelMode(preset.travelMode);
      setActiveTransport(preset.travelMode === 'WALKING' ? 'walk' : 'drive');

      try {
        const [orig, dest] = await Promise.all([
          resolveByCurrentProvider(preset.originQuery),
          resolveByCurrentProvider(preset.destinationQuery),
        ]);
        if (!orig || !dest) {
          throw new Error('추천 코스의 위치 정보를 불러오지 못했습니다.');
        }
        setOrigin(orig);
        setDestination(dest);
        await startRouteDrive(orig, dest, preset.travelMode, null);
      } catch (err) {
        setIsStarting(false);
        setRouteError(
          err instanceof Error
            ? err.message
            : '추천 코스를 시작하는 중 오류가 발생했습니다.'
        );
      }
    },
    [mapProvider, placesLib, routesLib, resolveByCurrentProvider, startRouteDrive]
  );

  const handleSelectChallenge = useCallback(
    async (course: ChallengeCourse) => {
      if (mapProvider === 'google' && (!placesLib || !routesLib)) {
        setRouteError('Google Maps API를 초기화하는 중입니다. 잠시만 기다려 주세요.');
        return;
      }
      setIsStarting(true);
      setRouteError(null);
      setTravelMode(course.travelMode);
      setActiveTransport(course.travelMode === 'WALKING' ? 'walk' : 'drive');

      try {
        const [orig, dest] = await Promise.all([
          resolveByCurrentProvider(course.originQuery),
          resolveByCurrentProvider(course.destinationQuery),
        ]);
        if (!orig || !dest) {
          throw new Error('챌린지 코스의 위치 정보를 불러오지 못했습니다.');
        }
        setOrigin(orig);
        setDestination(dest);
        await startRouteDrive(orig, dest, course.travelMode, course);
      } catch (err) {
        setIsStarting(false);
        setRouteError(
          err instanceof Error
            ? err.message
            : '챌린지 코스를 시작하는 중 오류가 발생했습니다.'
        );
      }
    },
    [mapProvider, placesLib, routesLib, resolveByCurrentProvider, startRouteDrive]
  );

  // Ground 60Hz Vehicle/Walk Simulation Loop
  useEffect(() => {
    if (gameState !== 'playing' || activeTransport === 'flight' || !routeData) {
      if (activeTransport !== 'flight') {
        driveAudio.stopDriveLoop();
      }
      return;
    }

    let rafId = 0;
    let lastTime = performance.now();
    let lastUiSync = lastTime;

    const tick = (now: number) => {
      const rawDt = (now - lastTime) / 1000;
      lastTime = now;
      const clampedDt = Math.min(0.05, Math.max(0, rawDt));

      viewModeSecondsRef.current[viewModeRef.current] =
        (viewModeSecondsRef.current[viewModeRef.current] ?? 0) + clampedDt;

      const nextPhysics = stepVehiclePhysics(
        physicsRef.current,
        {
          isCruising: isCruisingRef.current,
          cruiseMultiplier: cruiseMultiplierRef.current,
          gasPressed: gasPressedRef.current,
          brakePressed: brakePressedRef.current,
          travelMode: routeData.travelMode,
          routePath: routeData.path,
          cumDistances: routeData.cumDistances,
        },
        rawDt
      );

      physicsRef.current = nextPhysics;

      driveAudio.updateDriveTelemetry({
        speedKmh: nextPhysics.speedKmh,
        travelMode: routeData.travelMode,
        isActive:
          !nextPhysics.arrived &&
          (isCruisingRef.current ||
            nextPhysics.speedKmh > 0.8 ||
            gasPressedRef.current),
        gasPressed: gasPressedRef.current,
        brakePressed: brakePressedRef.current,
      });

      if (
        telemetrySamplesRef.current.length === 0 ||
        now - lastTelemetryAtRef.current >= 1400
      ) {
        lastTelemetryAtRef.current = now;
        if (telemetrySamplesRef.current.length < 120) {
          telemetrySamplesRef.current.push({
            elapsedSeconds: Number(nextPhysics.elapsedSeconds.toFixed(1)),
            distanceMeters: Math.round(nextPhysics.distanceMeters),
            speedKmh: Math.round(nextPhysics.speedKmh),
            viewMode: viewModeRef.current,
          });
        }
      }

      const stepLookup = findActiveStep(
        routeData.steps,
        nextPhysics.distanceMeters
      );
      if (
        stepLookup.currentStep &&
        stepLookup.currentStep.index !== lastStepIndexRef.current
      ) {
        if (lastStepIndexRef.current !== -1) {
          driveAudio.playTurnCue();
        }
        lastStepIndexRef.current = stepLookup.currentStep.index;
      }

      if (nextPhysics.arrived) {
        setPhysics(nextPhysics);
        driveAudio.stopDriveLoop();
        driveAudio.playArrivalChime();
        finalizeCurrentTrip(true, nextPhysics);
        return;
      }

      if (now - lastUiSync >= 66) {
        lastUiSync = now;
        setPhysics(nextPhysics);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      driveAudio.stopDriveLoop();
    };
  }, [gameState, activeTransport, routeData, finalizeCurrentTrip]);

  // 3D Flight Simulation Loop (with 5Hz HUD telemetry sync)
  useEffect(() => {
    if (gameState !== 'playing' || activeTransport !== 'flight') {
      return;
    }

    let rafId = 0;
    let lastTime = performance.now();
    let lastUiSync = lastTime;

    const tick = (now: number) => {
      const dt = Math.min(0.05, Math.max(0.008, (now - lastTime) / 1000));
      lastTime = now;

      const currentSample = sampleFlightStateAtDistance(
        flightWaypoints,
        BUSAN_TO_SEOUL_NODES,
        flightDistanceRef.current
      );

      if (isFlyingRef.current) {
        const speedMps = (currentSample.telemetry.speedKmh / 3.6) * flightSpeedMultRef.current;
        flightDistanceRef.current = Math.min(
          totalFlightDistance,
          flightDistanceRef.current + speedMps * dt
        );
      }

      const nextSample = sampleFlightStateAtDistance(
        flightWaypoints,
        BUSAN_TO_SEOUL_NODES,
        flightDistanceRef.current
      );

      driveAudio.updateFlightTelemetry({
        phase: nextSample.telemetry.phase,
        speedKmh: nextSample.telemetry.speedKmh,
        isActive: isFlyingRef.current,
      });

      if (flightDistanceRef.current >= totalFlightDistance - 5) {
        setFlightSample(nextSample);
        setIsFlying(false);
        isFlyingRef.current = false;
        driveAudio.stopDriveLoop();
        driveAudio.playArrivalChime();
        if (tripLegs.length > 0 && activeLegIndex === 0) {
          void handleDiveToStreetView();
        }
        return;
      }

      if (now - lastUiSync >= 120) {
        lastUiSync = now;
        setFlightSample(nextSample);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      driveAudio.stopDriveLoop();
    };
  }, [
    gameState,
    activeTransport,
    flightWaypoints,
    totalFlightDistance,
    tripLegs.length,
    activeLegIndex,
    handleDiveToStreetView,
  ]);

  // Unified Keyboard Controls
  useEffect(() => {
    const clearHeldInputs = () => {
      gasPressedRef.current = false;
      brakePressedRef.current = false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inInput =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.isContentEditable;

      if (inInput) return;

      if (gameState === 'title') {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          void handleStartClick();
        }
        return;
      }

      if (e.key === 'm' || e.key === 'M') {
        const nextMuted = driveAudio.toggleMute();
        setIsMuted(nextMuted);
        return;
      }

      if (e.key === 'Escape' || e.key === 'p' || e.key === 'P') {
        if (guideOpen) {
          setGuideOpen(false);
          return;
        }
        if (gameState === 'playing') {
          clearHeldInputs();
          setGameState('paused');
        } else if (gameState === 'paused') {
          setGameState('playing');
        }
        return;
      }

      if (gameState === 'playing' && activeTransport === 'flight') {
        if (e.key === '1') setFlightCameraMode('cockpit');
        if (e.key === '2') setFlightCameraMode('window-left');
        if (e.key === '3') setFlightCameraMode('window-right');
        if (e.key === '4') setFlightCameraMode('chase');
        if (e.key === ' ') {
          e.preventDefault();
          const next = !isFlyingRef.current;
          isFlyingRef.current = next;
          setIsFlying(next);
          driveAudio.playSoftClick();
        }
        return;
      }

      if (gameState === 'playing') {
        if (e.key === ' ') {
          e.preventDefault();
          const next = !isCruisingRef.current;
          isCruisingRef.current = next;
          setIsCruising(next);
          if (!next) {
            gasPressedRef.current = false;
            brakePressedRef.current = false;
            const halted: VehiclePhysicsState = {
              ...physicsRef.current,
              speedKmh: 0,
              gear: 'P',
            };
            physicsRef.current = halted;
            setPhysics(halted);
          }
          driveAudio.playSoftClick();
          return;
        }
        if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
          driveAudio.unlock();
          gasPressedRef.current = true;
        }
        if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
          driveAudio.unlock();
          brakePressedRef.current = true;
        }
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'W' || e.key === 'ArrowUp') {
        gasPressedRef.current = false;
      }
      if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
        brakePressedRef.current = false;
      }
    };

    const handleVisibility = () => {
      if (document.hidden) {
        clearHeldInputs();
        driveAudio.stopDriveLoop();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', clearHeldInputs);
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', clearHeldInputs);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [gameState, guideOpen, activeTransport, handleStartClick]);

  const sampledPose = useMemo(() => {
    if (!routeData) {
      return {
        position: origin?.location ?? INITIAL_FALLBACK_POS,
        heading: 65,
        segmentIndex: 0,
        progress: 0,
        clampedDistanceMeters: 0,
      };
    }
    return samplePointAlongPath(
      routeData.path,
      routeData.cumDistances,
      physics.distanceMeters
    );
  }, [routeData, origin, physics.distanceMeters]);

  const lookaheadPose = useMemo(() => {
    if (!routeData) return undefined;
    return samplePointAlongPath(
      routeData.path,
      routeData.cumDistances,
      Math.min(routeData.totalDistanceMeters, physics.distanceMeters + 26)
    ).position;
  }, [routeData, physics.distanceMeters]);

  const activeStepLookup = useMemo(() => {
    if (!routeData) {
      return {
        currentStep: null,
        nextStep: null,
        distanceToNextTurnMeters: 0,
      };
    }
    return findActiveStep(routeData.steps, physics.distanceMeters);
  }, [routeData, physics.distanceMeters]);

  const handleAscendToSky = useCallback(async () => {
    setSeamlessTransition({
      phase: 'ASCENDING_TO_EARTH',
      label: '3D 상공 항공 뷰로 상승 중...',
      overlayOpacity: 1,
      targetCoord: {
        lat: sampledPose.position.lat,
        lng: sampledPose.position.lng,
        headingDeg: sampledPose.heading,
      },
    });
    driveAudio.stopDriveLoop();
    driveAudio.playSoftClick();

    await new Promise((r) => window.setTimeout(r, 380));

    let bestDist = 0;
    let minGap = Infinity;
    for (const wp of flightWaypoints) {
      const d = haversineMeters(sampledPose.position, wp);
      if (d < minGap) {
        minGap = d;
        bestDist = wp.distanceFromStartMeters;
      }
    }

    startBusanSeoulFlight(bestDist, tripLegs, 0);
    setSeamlessTransition({
      phase: 'IDLE',
      label: '',
      overlayOpacity: 0,
      targetCoord: null,
    });
  }, [sampledPose, flightWaypoints, startBusanSeoulFlight, tripLegs]);

  const handleTogglePlayStop = useCallback(() => {
    const next = !isCruisingRef.current;
    isCruisingRef.current = next;
    setIsCruising(next);
    if (!next) {
      gasPressedRef.current = false;
      brakePressedRef.current = false;
      const halted: VehiclePhysicsState = {
        ...physicsRef.current,
        speedKmh: 0,
        gear: 'P',
      };
      physicsRef.current = halted;
      setPhysics(halted);
      driveAudio.stopDriveLoop();
    } else {
      driveAudio.unlock();
    }
    driveAudio.playSoftClick();
  }, []);

  const handleStepScene = useCallback(
    (deltaMeters: number) => {
      if (!routeData) return;
      const nextDist = Math.max(
        0,
        Math.min(
          routeData.totalDistanceMeters,
          physicsRef.current.distanceMeters + deltaMeters
        )
      );
      const updated: VehiclePhysicsState = {
        ...physicsRef.current,
        distanceMeters: nextDist,
        arrived: nextDist >= routeData.totalDistanceMeters - 0.5,
      };
      physicsRef.current = updated;
      setPhysics(updated);
      setStepNonce((n) => n + 1);
      driveAudio.playSoftClick();
      if (updated.arrived) {
        driveAudio.playArrivalChime();
        finalizeCurrentTrip(true, updated);
      }
    },
    [routeData, finalizeCurrentTrip]
  );

  const handleScrubProgress = useCallback(
    (nextDistance: number) => {
      if (!routeData) return;
      const clamped = Math.max(
        0,
        Math.min(routeData.totalDistanceMeters, nextDistance)
      );
      const updated: VehiclePhysicsState = {
        ...physicsRef.current,
        distanceMeters: clamped,
        arrived: clamped >= routeData.totalDistanceMeters - 0.5,
      };
      physicsRef.current = updated;
      setPhysics(updated);
      setStepNonce((n) => n + 1);
      if (updated.arrived) {
        driveAudio.playArrivalChime();
        finalizeCurrentTrip(true, updated);
      }
    },
    [routeData, finalizeCurrentTrip]
  );

  const handleRestartDrive = useCallback(() => {
    if (activeTransport === 'flight') {
      startBusanSeoulFlight(0, tripLegs, activeLegIndex);
      return;
    }
    if (!routeData) return;
    const reset: VehiclePhysicsState = {
      distanceMeters: 0,
      totalDistanceMeters: routeData.totalDistanceMeters,
      speedKmh: 0,
      gear: 'D',
      score: 0,
      elapsedSeconds: 0,
      arrived: false,
    };
    physicsRef.current = reset;
    lastStepIndexRef.current = -1;
    telemetrySamplesRef.current = [];
    viewModeSecondsRef.current = {
      streetview: 0,
      aerial: 0,
      split: 0,
      map: 0,
    };
    lastTelemetryAtRef.current = 0;
    tripStartedAtRef.current = new Date().toISOString();
    tripFinalizedRef.current = false;
    setDashboardOpen(false);
    setPhysics(reset);
    setIsCruising(true);
    isCruisingRef.current = true;
    setGameState('playing');
  }, [activeTransport, routeData, startBusanSeoulFlight, tripLegs, activeLegIndex]);

  const handleEndDrive = useCallback(() => {
    if (activeTransport === 'flight') {
      setTripLegs([]);
      setGameState('title');
      return;
    }
    gasPressedRef.current = false;
    brakePressedRef.current = false;
    const halted: VehiclePhysicsState = {
      ...physicsRef.current,
      speedKmh: 0,
      gear: 'P',
    };
    physicsRef.current = halted;
    setPhysics(halted);
    finalizeCurrentTrip(false, halted);
  }, [activeTransport, finalizeCurrentTrip]);

  const handleClearTripHistory = useCallback(() => {
    clearTripHistory();
    setTripHistory([]);
    setActiveTripId(null);
  }, []);

  const handleSetNewDestinationFromGuide = useCallback(
    async (newDest: SelectedPlaceInfo) => {
      const currentOrigin: SelectedPlaceInfo = {
        name: '현재 주행 위치',
        location: sampledPose.position,
      };
      setOrigin(currentOrigin);
      setDestination(newDest);
      await startRouteDrive(currentOrigin, newDest, travelMode, null);
    },
    [sampledPose.position, startRouteDrive, travelMode]
  );

  const handleCapturePostcard = useCallback(() => {
    const isFlight = activeTransport === 'flight';
    const canvasEl = document.querySelector('canvas');
    downloadTravelPostcard({
      title: isFlight
        ? '부산 김해(PUS) → 서울 김포(GMP)'
        : `${routeData?.origin.name || '출발지'} → ${routeData?.destination.name || '목적지'}`,
      subtitle: isFlight
        ? `${flightSample.telemetry.nearestLandmark} · ${flightSample.telemetry.phase}`
        : activeTransport === 'walk'
          ? 'RoadWindow 360 도보 거리뷰'
          : 'RoadWindow 360 드라이브',
      lat: isFlight ? flightSample.waypoint.lat : sampledPose.position.lat,
      lng: isFlight ? flightSample.waypoint.lng : sampledPose.position.lng,
      altitudeMeters: isFlight ? flightSample.telemetry.altitudeMeters : 2,
      speedKmh: isFlight
        ? flightSample.telemetry.speedKmh
        : Math.round(physics.speedKmh),
      headingDeg: isFlight
        ? flightSample.telemetry.headingDeg
        : Math.round(sampledPose.heading),
      modeLabel: isFlight
        ? '3D FLIGHT'
        : activeTransport === 'walk'
          ? 'WALK VIEW'
          : 'ROAD DRIVE',
      sourceCanvas: canvasEl instanceof HTMLCanvasElement ? canvasEl : null,
    });
    driveAudio.playSoftClick();
  }, [activeTransport, routeData, flightSample, sampledPose, physics.speedKmh]);

  const hasNextLeg =
    tripLegs.length > 0 && activeLegIndex < tripLegs.length - 1;
  const nextLeg = hasNextLeg ? tripLegs[activeLegIndex + 1] : undefined;

  if (gameState === 'title') {
    return (
      <>
        <TitleOverlay
          origin={origin}
          destination={destination}
          onSelectOrigin={setOrigin}
          onSelectDestination={setDestination}
          onUseCurrentLocation={handleUseCurrentLocation}
          gpsLoading={gpsLoading}
          activeTransport={activeTransport}
          onChangeTransport={handleChangeTransport}
          initialViewMode={initialViewMode}
          onChangeInitialViewMode={(m) => {
            setInitialViewMode(m);
            setViewMode(m);
          }}
          mapProvider={mapProvider}
          onChangeMapProvider={(mode) => {
            setRouteError(null);
            onChangeMapProvider(mode);
          }}
          placesLib={placesLib}
          hasGoogleKey={hasGoogleKey}
          onStartDrive={() => void handleStartClick()}
          onStartBusanSeoulFlight={() => startBusanSeoulFlight()}
          onStartMultiLegJourney={handleStartMultiLegJourney}
          onSelectPreset={(preset) => void handleSelectPreset(preset)}
          onSelectChallenge={(course) => void handleSelectChallenge(course)}
          challengeBestScores={challengeBestScores}
          isStarting={isStarting}
          errorMessage={routeError}
          onOpenHistoryDashboard={() => {
            setActiveTripId(tripHistory[0]?.id ?? null);
            setDashboardOpen(true);
          }}
          tripCount={tripHistory.length}
        />

        <DriveHistoryDashboard
          isOpen={dashboardOpen}
          trips={tripHistory}
          activeTripId={activeTripId}
          isResolvingRegions={isResolvingRegions}
          onSelectTrip={setActiveTripId}
          onClose={() => setDashboardOpen(false)}
          onClearHistory={handleClearTripHistory}
          onStartChallenge={(course) => {
            setDashboardOpen(false);
            void handleSelectChallenge(course);
          }}
        />
      </>
    );
  }

  const isVehicleMoving =
    gameState === 'playing' && (isCruising || physics.speedKmh > 1);

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0A0D12]">
      {/* Seamless Dive / Ascend Crossfade Overlay */}
      {seamlessTransition.phase !== 'IDLE' && (
        <div
          className="fixed inset-0 z-[70] bg-[#060911]/92 backdrop-blur-md flex flex-col items-center justify-center gap-3 text-slate-100 transition-opacity duration-300"
          style={{ opacity: seamlessTransition.overlayOpacity }}
        >
          <div className="w-12 h-12 rounded-2xl bg-sky-500/20 border border-sky-400/50 flex items-center justify-center text-sky-300 animate-pulse">
            <Plane className="w-6 h-6" />
          </div>
          <p className="text-sm font-bold">{seamlessTransition.label}</p>
        </div>
      )}

      {activeTransport === 'flight' ? (
        <>
          <FlightViewer
            waypoints={flightWaypoints}
            activeWaypoint={flightSample.waypoint}
            telemetry={flightSample.telemetry}
            cameraMode={flightCameraMode}
            timeOfDay={flightTimeOfDay}
            vworldApiKey={vworldApiKey}
          />
          <FlightHud
            telemetry={flightSample.telemetry}
            cameraMode={flightCameraMode}
            onChangeCameraMode={setFlightCameraMode}
            timeOfDay={flightTimeOfDay}
            onCycleTimeOfDay={() =>
              setFlightTimeOfDay((curr) => {
                const idx = TIME_OF_DAY_ORDER.indexOf(curr);
                return TIME_OF_DAY_ORDER[(idx + 1) % TIME_OF_DAY_ORDER.length];
              })
            }
            speedMultiplier={flightSpeedMult}
            onChangeSpeedMultiplier={setFlightSpeedMult}
            isFlying={isFlying}
            onToggleFly={() => {
              const next = !isFlyingRef.current;
              isFlyingRef.current = next;
              setIsFlying(next);
              driveAudio.playSoftClick();
            }}
            onScrubProgress={(dist) => {
              const clamped = Math.max(0, Math.min(totalFlightDistance, dist));
              flightDistanceRef.current = clamped;
              setFlightSample(
                sampleFlightStateAtDistance(
                  flightWaypoints,
                  BUSAN_TO_SEOUL_NODES,
                  clamped
                )
              );
            }}
            onDiveToStreetView={() => void handleDiveToStreetView()}
            onOpenBriefing={() => {
              setGuideInitialMode('flight');
              setGuideOpen(true);
            }}
            onCapturePostcard={handleCapturePostcard}
            isMuted={isMuted}
            onToggleMute={() => setIsMuted(driveAudio.toggleMute())}
            onPause={() => setGameState('paused')}
            hasNextLeg={hasNextLeg}
            onAdvanceNextLeg={() => void handleAdvanceNextLeg()}
          />
        </>
      ) : (
        <>
          {/* Ground / Aerial Primary Viewport Layer */}
          {viewMode === 'split' ? (
            <div
              data-testid="dual-view-container"
              className="w-full h-full flex flex-col md:grid md:grid-cols-2"
            >
              <div className="relative flex-[1.35] md:flex-none w-full min-h-0 md:h-full border-b md:border-b-0 md:border-r border-slate-800">
                {isFree ? (
                  <FreeMapViewer
                    routeData={routeData}
                    vehiclePosition={sampledPose.position}
                    vehicleHeading={sampledPose.heading}
                    mode="chase3d"
                    interactive={true}
                    isMainView={true}
                    isMoving={isVehicleMoving}
                    speedKmh={physics.speedKmh}
                    isCornering={Boolean(physics.isCornering)}
                    cornerAngleDeg={physics.cornerAngleDeg ?? 0}
                    cameraFollowMode={cameraFollowMode}
                    onChangeCameraMode={setCameraFollowMode}
                    kakaoMapKey={kakaoMapKey}
                    providerMode={mapProvider}
                    vworldApiKey={vworldApiKey}
                    preferStreetPhoto={preferStreetPhoto}
                    onToggleStreetPhoto={setPreferStreetPhoto}
                    travelMode={routeData?.travelMode}
                    walkBobbingEnabled={walkBobbingEnabled}
                    hasGoogleKey={hasGoogleKey}
                    onSwitchToGoogleStreetView={() =>
                      onChangeMapProvider('google')
                    }
                  />
                ) : (
                  <StreetViewViewer
                    targetPosition={sampledPose.position}
                    targetHeading={sampledPose.heading}
                    cameraFollowMode={cameraFollowMode}
                    onChangeCameraMode={setCameraFollowMode}
                    onSwitchToAerial={() => setViewMode('aerial')}
                    isMainView={true}
                    isMoving={isVehicleMoving}
                    cruiseMultiplier={cruiseMultiplier}
                    speedKmh={physics.speedKmh}
                    isCornering={Boolean(physics.isCornering)}
                    cornerAngleDeg={physics.cornerAngleDeg ?? 0}
                    lookaheadPosition={lookaheadPose}
                    stepNonce={stepNonce}
                  />
                )}
              </div>
              <div className="relative flex-1 md:flex-none w-full min-h-0 md:h-full pb-[68px] md:pb-0 bg-[#0A0D12]">
                {isFree ? (
                  <FreeMapViewer
                    routeData={routeData}
                    vehiclePosition={sampledPose.position}
                    vehicleHeading={sampledPose.heading}
                    mode="aerial"
                    interactive={true}
                    compactZoom={true}
                    providerMode={mapProvider}
                    vworldApiKey={vworldApiKey}
                    onJumpToDistance={handleScrubProgress}
                  />
                ) : (
                  <AerialMapViewer
                    routeData={routeData}
                    rawRoute={rawRoute}
                    vehiclePosition={sampledPose.position}
                    vehicleHeading={sampledPose.heading}
                    mode="aerial"
                    interactive={true}
                    compactZoom={true}
                    disable3d={billingRequired}
                    onJumpToDistance={handleScrubProgress}
                  />
                )}
              </div>
            </div>
          ) : viewMode === 'streetview' ? (
            <>
              {isFree ? (
                <FreeMapViewer
                  routeData={routeData}
                  vehiclePosition={sampledPose.position}
                  vehicleHeading={sampledPose.heading}
                  mode="chase3d"
                  interactive={true}
                  isMainView={true}
                  isMoving={isVehicleMoving}
                  speedKmh={physics.speedKmh}
                  isCornering={Boolean(physics.isCornering)}
                  cornerAngleDeg={physics.cornerAngleDeg ?? 0}
                  cameraFollowMode={cameraFollowMode}
                  onChangeCameraMode={setCameraFollowMode}
                  kakaoMapKey={kakaoMapKey}
                  providerMode={mapProvider}
                  vworldApiKey={vworldApiKey}
                  preferStreetPhoto={preferStreetPhoto}
                  onToggleStreetPhoto={setPreferStreetPhoto}
                  travelMode={routeData?.travelMode}
                  walkBobbingEnabled={walkBobbingEnabled}
                  hasGoogleKey={hasGoogleKey}
                  onSwitchToGoogleStreetView={() =>
                    onChangeMapProvider('google')
                  }
                />
              ) : (
                <StreetViewViewer
                  targetPosition={sampledPose.position}
                  targetHeading={sampledPose.heading}
                  cameraFollowMode={cameraFollowMode}
                  onChangeCameraMode={setCameraFollowMode}
                  onSwitchToAerial={() => setViewMode('aerial')}
                  isMainView={true}
                  isMoving={isVehicleMoving}
                  cruiseMultiplier={cruiseMultiplier}
                  speedKmh={physics.speedKmh}
                  isCornering={Boolean(physics.isCornering)}
                  cornerAngleDeg={physics.cornerAngleDeg ?? 0}
                  lookaheadPosition={lookaheadPose}
                  stepNonce={stepNonce}
                />
              )}

              {/* Compact PiP Toggleable Aerial Minimap */}
              {showMinimapPip ? (
                <div className="absolute right-2.5 top-[68px] md:bottom-40 md:top-auto md:right-4 z-20 w-36 h-24 sm:w-56 sm:h-36 rounded-2xl overflow-hidden border border-slate-700/90 shadow-2xl bg-[#0D131D]">
                  {isFree ? (
                    <FreeMapViewer
                      routeData={routeData}
                      vehiclePosition={sampledPose.position}
                      vehicleHeading={sampledPose.heading}
                      mode="aerial"
                      interactive={false}
                      compactZoom={true}
                      providerMode={mapProvider}
                      vworldApiKey={vworldApiKey}
                    />
                  ) : (
                    <AerialMapViewer
                      routeData={routeData}
                      rawRoute={rawRoute}
                      vehiclePosition={sampledPose.position}
                      vehicleHeading={sampledPose.heading}
                      mode="aerial"
                      interactive={false}
                      compactZoom={true}
                    />
                  )}
                  <div className="absolute bottom-1.5 right-1.5 flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setShowMinimapPip(false)}
                      aria-label="미니맵 접기"
                      className="min-w-[28px] min-h-[28px] px-1.5 rounded-lg bg-[#0D131D]/90 border border-slate-700 text-[11px] text-slate-300 flex items-center justify-center hover:bg-slate-800 transition-colors"
                    >
                      <Minimize2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => setViewMode('aerial')}
                      aria-label="항공뷰 전체화면으로 전환"
                      className="min-h-[28px] px-2 rounded-lg bg-[#0D131D]/90 border border-slate-700 text-[11px] font-semibold text-sky-300 flex items-center gap-1 hover:bg-slate-800 transition-colors"
                    >
                      <Maximize2 className="w-3 h-3" />
                      <span>항공</span>
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowMinimapPip(true)}
                  aria-label="경로 미니맵 열기"
                  className="hidden md:flex absolute bottom-40 right-4 z-20 min-h-[38px] px-3 rounded-xl bg-[#0D131D]/92 border border-slate-700/80 hover:border-sky-400/70 text-xs font-semibold text-sky-300 items-center gap-1.5 shadow-xl transition-colors"
                >
                  <MapIcon className="w-3.5 h-3.5" />
                  <span>미니맵</span>
                </button>
              )}
            </>
          ) : (
            <>
              {isFree ? (
                <FreeMapViewer
                  routeData={routeData}
                  vehiclePosition={sampledPose.position}
                  vehicleHeading={sampledPose.heading}
                  mode={viewMode === 'aerial' ? 'aerial' : 'map'}
                  interactive={true}
                  providerMode={mapProvider}
                  vworldApiKey={vworldApiKey}
                  onJumpToDistance={handleScrubProgress}
                />
              ) : (
                <AerialMapViewer
                  routeData={routeData}
                  rawRoute={rawRoute}
                  vehiclePosition={sampledPose.position}
                  vehicleHeading={sampledPose.heading}
                  mode={viewMode === 'aerial' ? 'aerial' : 'map'}
                  interactive={true}
                  disable3d={billingRequired}
                  onJumpToDistance={handleScrubProgress}
                />
              )}

              {/* Compact PiP Street View Window */}
              <div className="absolute right-2.5 top-[68px] md:bottom-40 md:top-auto md:right-4 z-20 w-32 h-24 sm:w-52 sm:h-36 rounded-2xl overflow-hidden border border-slate-700/90 shadow-2xl bg-[#0D131D]">
                {isFree ? (
                  <FreeMapViewer
                    routeData={routeData}
                    vehiclePosition={sampledPose.position}
                    vehicleHeading={sampledPose.heading}
                    mode="chase3d"
                    interactive={false}
                    isMainView={false}
                    isMoving={false}
                    cameraFollowMode={cameraFollowMode}
                    providerMode={mapProvider}
                    preferStreetPhoto={preferStreetPhoto}
                  />
                ) : (
                  <StreetViewViewer
                    targetPosition={sampledPose.position}
                    targetHeading={sampledPose.heading}
                    cameraFollowMode={cameraFollowMode}
                    onChangeCameraMode={setCameraFollowMode}
                    onSwitchToAerial={() => setViewMode('aerial')}
                    isMainView={false}
                    isMoving={false}
                    stepNonce={stepNonce}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setViewMode('streetview')}
                  aria-label="거리뷰 전체화면으로 전환"
                  className="absolute bottom-1.5 right-1.5 min-w-[28px] min-h-[28px] px-2 rounded-lg bg-[#0D131D]/90 border border-slate-700 text-[11px] font-semibold text-amber-300 flex items-center gap-1 hover:bg-slate-800 transition-colors"
                >
                  <Maximize2 className="w-3 h-3" />
                  <span>거리뷰</span>
                </button>
              </div>
            </>
          )}

          {routeData && (
            <DriveHud
              routeData={routeData}
              physics={physics}
              vehiclePosition={sampledPose.position}
              vehicleHeading={sampledPose.heading}
              currentStep={activeStepLookup.currentStep}
              nextStep={activeStepLookup.nextStep}
              distanceToNextTurnMeters={activeStepLookup.distanceToNextTurnMeters}
              viewMode={viewMode}
              onChangeViewMode={setViewMode}
              isCruising={isCruising}
              onToggleCruise={handleTogglePlayStop}
              onStepBackward={() => handleStepScene(-35)}
              onStepForward={() => handleStepScene(35)}
              cruiseMultiplier={cruiseMultiplier}
              onChangeMultiplier={setCruiseMultiplier}
              onGasStart={() => {
                driveAudio.unlock();
                gasPressedRef.current = true;
              }}
              onGasEnd={() => {
                gasPressedRef.current = false;
              }}
              onBrakeStart={() => {
                driveAudio.unlock();
                brakePressedRef.current = true;
              }}
              onBrakeEnd={() => {
                brakePressedRef.current = false;
              }}
              onScrubProgress={handleScrubProgress}
              onOpenGuide={() => {
                setGuideInitialMode('nearby');
                setGuideOpen(true);
              }}
              onPause={() => setGameState('paused')}
              isMuted={isMuted}
              onToggleMute={() => setIsMuted(driveAudio.toggleMute())}
              cameraFollowMode={cameraFollowMode}
              onChangeCameraMode={setCameraFollowMode}
              showMinimapPip={showMinimapPip}
              onToggleMinimap={() => setShowMinimapPip((prev) => !prev)}
              onAscendToSky={() => void handleAscendToSky()}
              onCapturePostcard={handleCapturePostcard}
              walkBobbingEnabled={walkBobbingEnabled}
              onToggleWalkBobbing={() => setWalkBobbingEnabled((p) => !p)}
              preferStreetPhoto={preferStreetPhoto}
              onToggleStreetPhoto={setPreferStreetPhoto}
              isFreeEngine={isFree}
              hasNextLeg={hasNextLeg}
              onAdvanceNextLeg={() => void handleAdvanceNextLeg()}
            />
          )}
        </>
      )}

      {/* Pause & Arrival Modals */}
      {!(gameState === 'gameover' && dashboardOpen) && (
        <StatusModal
          gameState={gameState}
          routeData={routeData}
          physics={physics}
          onResume={() => setGameState('playing')}
          onRestartDrive={handleRestartDrive}
          onReturnToTitle={() => {
            activeChallengeRef.current = null;
            setTripLegs([]);
            setDashboardOpen(false);
            setGameState('title');
            setGuideOpen(false);
          }}
          onOpenDestinationGuide={() => {
            setGuideInitialMode('destination');
            setGuideOpen(true);
          }}
          onEndDrive={handleEndDrive}
          onOpenDashboard={() => {
            setActiveTripId(tripHistory[0]?.id ?? null);
            setDashboardOpen(true);
          }}
          hasNextLeg={hasNextLeg}
          nextLegTitle={nextLeg?.title}
          onAdvanceNextLeg={() => void handleAdvanceNextLeg()}
        />
      )}

      {/* Driving History Analytics Dashboard */}
      <DriveHistoryDashboard
        isOpen={dashboardOpen}
        trips={tripHistory}
        activeTripId={activeTripId}
        isResolvingRegions={isResolvingRegions}
        onSelectTrip={setActiveTripId}
        onClose={() => setDashboardOpen(false)}
        onClearHistory={handleClearTripHistory}
        onRestartDrive={handleRestartDrive}
        onReturnToTitle={() => {
          activeChallengeRef.current = null;
          setTripLegs([]);
          setDashboardOpen(false);
          setGameState('title');
          setGuideOpen(false);
        }}
        onOpenDestinationGuide={() => {
          setDashboardOpen(false);
          setGuideInitialMode('destination');
          setGuideOpen(true);
        }}
        onStartChallenge={(course) => {
          setDashboardOpen(false);
          void handleSelectChallenge(course);
        }}
      />

      {/* Gemini Maps Grounding / OSM / Flight Landmark Guide Drawer */}
      <GroundGuideDrawer
        isOpen={guideOpen}
        onClose={() => setGuideOpen(false)}
        currentPosition={
          activeTransport === 'flight'
            ? {
                lat: flightSample.waypoint.lat,
                lng: flightSample.waypoint.lng,
              }
            : sampledPose.position
        }
        destination={destination}
        onSetNewDestination={(place) =>
          void handleSetNewDestinationFromGuide(place)
        }
        mapProvider={mapProvider}
        placesLib={placesLib}
        initialMode={guideInitialMode}
        flightLandmarkName={flightSample.telemetry.nearestLandmark}
        flightAltitudeMeters={flightSample.telemetry.altitudeMeters}
      />
    </div>
  );
};

export default function App() {
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const envKakaoKey = import.meta.env.VITE_KAKAO_MAP_KEY as string | undefined;

  const [mapProvider, setMapProvider] = useState<MapProviderMode>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search).get('provider');
      if (p === 'google' || p === 'free-kr' || p === 'free-global') return p;
    }
    return 'free-kr';
  });

  const [mapsApiKey, setMapsApiKey] = useState<string>(envKey || '');
  const [kakaoMapKey, setKakaoMapKey] = useState<string>(envKakaoKey || '');
  const [vworldApiKey, setVworldApiKey] = useState<string>('');
  const [configLoaded, setConfigLoaded] = useState<boolean>(false);
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);
  const [billingRequired, setBillingRequired] = useState<boolean>(false);
  const [billingDismissed, setBillingDismissed] = useState<boolean>(false);

  const [placesLib, setPlacesLib] = useState<google.maps.PlacesLibrary | null>(
    null
  );
  const [routesLib, setRoutesLib] = useState<google.maps.RoutesLibrary | null>(
    null
  );

  const handleLibrariesChange = useCallback(
    (
      nextPlaces: google.maps.PlacesLibrary | null,
      nextRoutes: google.maps.RoutesLibrary | null
    ) => {
      setPlacesLib(nextPlaces);
      setRoutesLib(nextRoutes);
    },
    []
  );

  useEffect(() => {
    const onQuota = () => setQuotaExceeded(true);
    const onBilling = () => setBillingRequired(true);
    window.addEventListener('gmp-quota-exceeded', onQuota);
    window.addEventListener('gmp-billing-required', onBilling);
    return () => {
      window.removeEventListener('gmp-quota-exceeded', onQuota);
      window.removeEventListener('gmp-billing-required', onBilling);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/config')
      .then((res) => res.json())
      .then((data: Partial<AppRuntimeConfig>) => {
        if (cancelled) return;
        if (data.mapsApiKey && !mapsApiKey) {
          setMapsApiKey(data.mapsApiKey);
        }
        if (data.kakaoMapKey && !kakaoMapKey) {
          setKakaoMapKey(data.kakaoMapKey);
        }
        if (data.vworldApiKey) {
          setVworldApiKey(data.vworldApiKey);
        }
        const urlParam = new URLSearchParams(window.location.search).get('provider');
        if (
          !urlParam &&
          (data.defaultProvider === 'free-kr' ||
            data.defaultProvider === 'free-global' ||
            (data.defaultProvider === 'google' && data.mapsApiKey))
        ) {
          setMapProvider(data.defaultProvider);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setConfigLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mapsApiKey, kakaoMapKey]);

  const isGoogleActive = mapProvider === 'google';

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0A0D12]">
      {isGoogleActive && quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm flex flex-wrap items-center justify-center gap-3">
          <span>
            Google Maps Platform quota reached. If you are the app owner, visit{' '}
            <a
              href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
              target="_blank"
              rel="noopener noreferrer"
              className="underline font-semibold text-amber-950 hover:text-amber-800"
            >
              maps developer site
            </a>{' '}
            for instructions to update your account.
          </span>
          <button
            type="button"
            onClick={() => setMapProvider('free-kr')}
            className="px-2.5 py-1 rounded-md bg-emerald-600 text-white text-xs font-semibold hover:bg-emerald-500 shrink-0"
          >
            무료 오픈소스 API로 전환
          </button>
        </div>
      )}

      {isGoogleActive &&
        billingRequired &&
        !billingDismissed &&
        !quotaExceeded && (
          <div className="bg-[#151D2B] border-b border-amber-500/40 text-amber-100 px-4 py-2 text-xs text-center sticky top-0 z-50 shadow-sm flex flex-wrap items-center justify-center gap-3">
            <span className="[word-break:keep-all]">
              결제 미연결 키 상태여서 Google 정책상 거리뷰 색상이 반전·워터마크로 표시됩니다. 무료 오픈소스 모드로 전환하면 워터마크 없이 즉시 이용할 수 있습니다.
            </span>
            <button
              type="button"
              onClick={() => setMapProvider('free-kr')}
              className="px-2.5 py-1 rounded-md bg-emerald-500 text-slate-950 font-bold hover:bg-emerald-400 shrink-0"
            >
              무료 오픈소스 API로 전환
            </button>
            <button
              type="button"
              onClick={() => setBillingDismissed(true)}
              aria-label="안내 닫기"
              className="p-1 rounded-md text-amber-300 hover:text-white hover:bg-slate-800 shrink-0"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

      {!configLoaded ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-3 text-slate-300">
          <div className="w-8 h-8 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
          <p className="text-sm">RoadWindow 360 초기화 중...</p>
        </div>
      ) : isGoogleActive && !mapsApiKey ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md rounded-2xl bg-[#101622] border border-slate-800 p-6 text-center space-y-4">
            <h1 className="text-lg font-bold text-slate-100">
              Google 360° API 키 설정 안내
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed [word-break:keep-all]">
              Google 공식 360° 스트리트 뷰 파노라마를 사용하려면 환경 변수(VITE_GOOGLE_MAPS_API_KEY)가 필요합니다. 무료 모드에서도 실사 거리뷰 사진과 3D 항공 비행을 즉시 이용할 수 있습니다.
            </p>
            <button
              type="button"
              onClick={() => setMapProvider('free-kr')}
              className="w-full min-h-[44px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold transition-colors"
            >
              무료 실사 거리뷰 & 3D 항공 모드로 돌아가기
            </button>
          </div>
        </div>
      ) : isGoogleActive && mapsApiKey ? (
        <div className="flex-1 min-h-0 relative">
          <APIProvider apiKey={mapsApiKey} language="ko" region="KR">
            <GoogleMapsBridge onLibrariesChange={handleLibrariesChange} />
            <RoadWindowWorkspace
              mapProvider={mapProvider}
              onChangeMapProvider={setMapProvider}
              placesLib={placesLib}
              routesLib={routesLib}
              hasGoogleKey={Boolean(mapsApiKey)}
              kakaoMapKey={kakaoMapKey}
              vworldApiKey={vworldApiKey}
              billingRequired={billingRequired}
            />
          </APIProvider>
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative">
          <RoadWindowWorkspace
            mapProvider={mapProvider}
            onChangeMapProvider={setMapProvider}
            placesLib={null}
            routesLib={null}
            hasGoogleKey={Boolean(mapsApiKey)}
            kakaoMapKey={kakaoMapKey}
            vworldApiKey={vworldApiKey}
            billingRequired={false}
          />
        </div>
      )}
    </div>
  );
}
