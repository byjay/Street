import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider, useMapsLibrary } from '@vis.gl/react-google-maps';
import { Map as MapIcon, Maximize2, Minimize2, X } from 'lucide-react';
import { driveAudio } from './audio/driveAudio';
import { AerialMapViewer } from './components/AerialMapViewer';
import { DriveHistoryDashboard } from './components/DriveHistoryDashboard';
import { DriveHud } from './components/DriveHud';
import { GroundGuideDrawer } from './components/GroundGuideDrawer';
import { StatusModal } from './components/StatusModal';
import { StreetViewViewer } from './components/StreetViewViewer';
import { TitleOverlay } from './components/TitleOverlay';
import { GLOBAL_ROUTE_PRESETS } from './data/presets';
import {
  findActiveStep,
  samplePointAlongPath,
  stepVehiclePhysics,
  type VehiclePhysicsState,
} from './engine/routeSimulation';
import type {
  CameraViewMode,
  ChallengeCourse,
  ComputedRouteData,
  DriveTripRecord,
  GameState,
  GlobalRoutePreset,
  SelectedPlaceInfo,
  TelemetrySample,
  TravelModeOption,
} from './types/drive';
import { computeDrivingRoute, resolvePlaceByQuery } from './utils/mapsHelpers';
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

const RoadWindowWorkspace: React.FC<{ billingRequired?: boolean }> = ({
  billingRequired = false,
}) => {
  const placesLib = useMapsLibrary('places');
  const routesLib = useMapsLibrary('routes');

  const [gameState, setGameState] = useState<GameState>('title');
  const [viewMode, setViewMode] = useState<CameraViewMode>('streetview');
  const [travelMode, setTravelMode] = useState<TravelModeOption>('DRIVING');
  const [autoAlignHeading, setAutoAlignHeading] = useState(true);

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
    'nearby' | 'destination'
  >('destination');
  const [stepNonce, setStepNonce] = useState(0);
  const [showMinimapPip, setShowMinimapPip] = useState(false);

  const [tripHistory, setTripHistory] = useState<DriveTripRecord[]>(() =>
    loadTripHistory()
  );
  const [dashboardOpen, setDashboardOpen] = useState(false);
  const [activeTripId, setActiveTripId] = useState<string | null>(null);
  const [isResolvingRegions, setIsResolvingRegions] = useState(false);

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

  // Sync body[data-state] for state machine & automated testing
  useEffect(() => {
    document.body.dataset.state = gameState;
  }, [gameState]);

  useEffect(() => {
    isCruisingRef.current = isCruising;
  }, [isCruising]);

  useEffect(() => {
    cruiseMultiplierRef.current = cruiseMultiplier;
  }, [cruiseMultiplier]);

  useEffect(() => {
    viewModeRef.current = viewMode;
  }, [viewMode]);

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
        snap.distanceMeters
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
    [routeData, placesLib]
  );

  const startRouteDrive = useCallback(
    async (
      startOrigin: SelectedPlaceInfo,
      startDestination: SelectedPlaceInfo,
      mode: TravelModeOption,
      challengeCourse: ChallengeCourse | null = null
    ) => {
      if (!routesLib) {
        setRouteError('경로 탐색 라이브러리를 불러오는 중입니다. 잠시 후 다시 시도해 주세요.');
        return;
      }

      setIsStarting(true);
      setRouteError(null);

      try {
        const bundle = await computeDrivingRoute(
          routesLib,
          startOrigin,
          startDestination,
          mode
        );

        const initialPhysics: VehiclePhysicsState = {
          distanceMeters: 0,
          totalDistanceMeters: bundle.data.totalDistanceMeters,
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
        setRouteData(bundle.data);
        setRawRoute(bundle.rawRoute);
        setIsCruising(true);
        isCruisingRef.current = true;
        setGameState('playing');
        document.body.dataset.state = 'playing';

        if (document.activeElement instanceof HTMLElement) {
          document.activeElement.blur();
        }
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
    [routesLib]
  );

  // Resolve initial Gangnam -> COEX default places via Places API (New)
  useEffect(() => {
    if (!placesLib || defaultResolvedRef.current) return;
    defaultResolvedRef.current = true;

    const loadDefaults = async () => {
      try {
        const [orig, dest] = await Promise.all([
          resolvePlaceByQuery(placesLib, GLOBAL_ROUTE_PRESETS[0].originQuery),
          resolvePlaceByQuery(
            placesLib,
            GLOBAL_ROUTE_PRESETS[0].destinationQuery
          ),
        ]);
        if (orig) setOrigin((prev) => prev ?? orig);
        if (dest) setDestination((prev) => prev ?? dest);
      } catch {
        // Non-fatal if user searches manually
      }
    };

    void loadDefaults();
  }, [placesLib]);

  // Support ?autostart=1 to jump directly into active gameplay
  useEffect(() => {
    if (autostartTriggeredRef.current) return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('autostart') !== '1') return;
    if (!placesLib || !routesLib || !origin || !destination) return;

    autostartTriggeredRef.current = true;
    void startRouteDrive(origin, destination, travelMode);
  }, [placesLib, routesLib, origin, destination, travelMode, startRouteDrive]);

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
    if (!placesLib || !routesLib) {
      setRouteError('Google Maps API를 초기화하는 중입니다. 잠시만 기다려 주세요.');
      return;
    }

    let resolvedOrigin = origin;
    let resolvedDest = destination;

    if (!resolvedOrigin) {
      resolvedOrigin = await resolvePlaceByQuery(
        placesLib,
        GLOBAL_ROUTE_PRESETS[0].originQuery
      );
      if (resolvedOrigin) setOrigin(resolvedOrigin);
    }

    if (!resolvedDest) {
      resolvedDest = await resolvePlaceByQuery(
        placesLib,
        GLOBAL_ROUTE_PRESETS[0].destinationQuery
      );
      if (resolvedDest) setDestination(resolvedDest);
    }

    if (!resolvedOrigin || !resolvedDest) {
      setRouteError('출발지와 목적지를 모두 선택해 주세요.');
      return;
    }

    await startRouteDrive(resolvedOrigin, resolvedDest, travelMode, null);
  }, [placesLib, routesLib, origin, destination, travelMode, startRouteDrive]);

  const handleSelectPreset = useCallback(
    async (preset: GlobalRoutePreset) => {
      if (!placesLib || !routesLib) return;
      setIsStarting(true);
      setRouteError(null);
      setTravelMode(preset.travelMode);

      try {
        const [orig, dest] = await Promise.all([
          resolvePlaceByQuery(placesLib, preset.originQuery),
          resolvePlaceByQuery(placesLib, preset.destinationQuery),
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
    [placesLib, routesLib, startRouteDrive]
  );

  const handleSelectChallenge = useCallback(
    async (course: ChallengeCourse) => {
      if (!placesLib || !routesLib) {
        setRouteError('Google Maps API를 초기화하는 중입니다. 잠시만 기다려 주세요.');
        return;
      }
      setIsStarting(true);
      setRouteError(null);
      setTravelMode(course.travelMode);

      try {
        const [orig, dest] = await Promise.all([
          resolvePlaceByQuery(placesLib, course.originQuery),
          resolvePlaceByQuery(placesLib, course.destinationQuery),
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
    [placesLib, routesLib, startRouteDrive]
  );

  // 60Hz Vehicle Simulation Loop decoupled from high-frequency DOM thrashing
  useEffect(() => {
    if (gameState !== 'playing' || !routeData) return;

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

      // Check step transition for turn cue audio
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
        driveAudio.playArrivalChime();
        finalizeCurrentTrip(true, nextPhysics);
        return;
      }

      // Sync React HUD at ~15Hz for crisp gauges with zero overhead
      if (now - lastUiSync >= 66) {
        lastUiSync = now;
        setPhysics(nextPhysics);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(rafId);
  }, [gameState, routeData, finalizeCurrentTrip]);

  // Unified Keyboard Controls & Window Blur Input Release
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
          gasPressedRef.current = true;
        }
        if (e.key === 's' || e.key === 'S' || e.key === 'ArrowDown') {
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
      if (document.hidden) clearHeldInputs();
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
  }, [gameState, guideOpen, handleStartClick]);

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
  }, [routeData]);

  const handleEndDrive = useCallback(() => {
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
  }, [finalizeCurrentTrip]);

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
          travelMode={travelMode}
          onChangeTravelMode={setTravelMode}
          onStartDrive={() => void handleStartClick()}
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

  return (
    <div className="relative w-full h-full overflow-hidden bg-[#0A0D12]">
      {/* Primary Viewport Layer */}
      {viewMode === 'split' ? (
        <div className="w-full h-full grid grid-cols-1 md:grid-cols-2">
          <div className="relative w-full h-full border-b md:border-b-0 md:border-r border-slate-800">
            <StreetViewViewer
              targetPosition={sampledPose.position}
              targetHeading={sampledPose.heading}
              autoAlignHeading={autoAlignHeading}
              onToggleAutoAlign={() => setAutoAlignHeading((prev) => !prev)}
              onSwitchToAerial={() => setViewMode('aerial')}
              isMainView={true}
              isMoving={gameState === 'playing' && (isCruising || physics.speedKmh > 1)}
              cruiseMultiplier={cruiseMultiplier}
              speedKmh={physics.speedKmh}
              isCornering={Boolean(physics.isCornering)}
              cornerAngleDeg={physics.cornerAngleDeg ?? 0}
              lookaheadPosition={lookaheadPose}
              stepNonce={stepNonce}
            />
          </div>
          <div className="relative w-full h-full">
            <AerialMapViewer
              routeData={routeData}
              rawRoute={rawRoute}
              vehiclePosition={sampledPose.position}
              vehicleHeading={sampledPose.heading}
              mode="aerial"
              interactive={true}
              disable3d={billingRequired}
              onJumpToDistance={handleScrubProgress}
            />
          </div>
        </div>
      ) : viewMode === 'streetview' ? (
        <>
          <StreetViewViewer
            targetPosition={sampledPose.position}
            targetHeading={sampledPose.heading}
            autoAlignHeading={autoAlignHeading}
            onToggleAutoAlign={() => setAutoAlignHeading((prev) => !prev)}
            onSwitchToAerial={() => setViewMode('aerial')}
            isMainView={true}
            isMoving={gameState === 'playing' && (isCruising || physics.speedKmh > 1)}
            cruiseMultiplier={cruiseMultiplier}
            speedKmh={physics.speedKmh}
            isCornering={Boolean(physics.isCornering)}
            cornerAngleDeg={physics.cornerAngleDeg ?? 0}
            lookaheadPosition={lookaheadPose}
            stepNonce={stepNonce}
          />

          {/* Compact PiP Toggleable Aerial Minimap */}
          {showMinimapPip ? (
            <div className="absolute right-2.5 top-[72px] md:bottom-40 md:top-auto md:right-4 z-20 w-36 h-24 sm:w-56 sm:h-36 rounded-2xl overflow-hidden border border-slate-700/90 shadow-2xl bg-[#0D131D]">
              <AerialMapViewer
                routeData={routeData}
                rawRoute={rawRoute}
                vehiclePosition={sampledPose.position}
                vehicleHeading={sampledPose.heading}
                mode="aerial"
                interactive={false}
              />
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
                  <span>항공뷰</span>
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

          {/* Compact PiP Street View Window */}
          <div className="absolute right-2.5 top-[72px] md:bottom-40 md:top-auto md:right-4 z-20 w-32 h-24 sm:w-52 sm:h-36 rounded-2xl overflow-hidden border border-slate-700/90 shadow-2xl bg-[#0D131D]">
            <StreetViewViewer
              targetPosition={sampledPose.position}
              targetHeading={sampledPose.heading}
              autoAlignHeading={true}
              onToggleAutoAlign={() => {}}
              onSwitchToAerial={() => setViewMode('aerial')}
              isMainView={false}
              isMoving={false}
              stepNonce={stepNonce}
            />
            <button
              type="button"
              onClick={() => setViewMode('streetview')}
              aria-label="360° 거리뷰 전체화면으로 전환"
              className="absolute bottom-1.5 right-1.5 min-w-[28px] min-h-[28px] px-2 rounded-lg bg-[#0D131D]/90 border border-slate-700 text-[11px] font-semibold text-amber-300 flex items-center gap-1 hover:bg-slate-800 transition-colors"
            >
              <Maximize2 className="w-3 h-3" />
              <span>360° 뷰</span>
            </button>
          </div>
        </>
      )}

      {/* Cockpit HUD Overlay */}
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
            gasPressedRef.current = true;
          }}
          onGasEnd={() => {
            gasPressedRef.current = false;
          }}
          onBrakeStart={() => {
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
          autoAlignHeading={autoAlignHeading}
          onToggleAutoAlign={() => setAutoAlignHeading((prev) => !prev)}
          showMinimapPip={showMinimapPip}
          onToggleMinimap={() => setShowMinimapPip((prev) => !prev)}
        />
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

      {/* Gemini Maps Grounding Drawer */}
      <GroundGuideDrawer
        isOpen={guideOpen}
        onClose={() => setGuideOpen(false)}
        currentPosition={sampledPose.position}
        destination={destination}
        onSetNewDestination={(place) =>
          void handleSetNewDestinationFromGuide(place)
        }
        initialMode={guideInitialMode}
      />
    </div>
  );
};

export default function App() {
  const envKey = import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined;
  const [mapsApiKey, setMapsApiKey] = useState<string>(envKey || '');
  const [configLoaded, setConfigLoaded] = useState<boolean>(Boolean(envKey));
  const [quotaExceeded, setQuotaExceeded] = useState<boolean>(false);
  const [billingRequired, setBillingRequired] = useState<boolean>(false);
  const [billingDismissed, setBillingDismissed] = useState<boolean>(false);

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
    if (mapsApiKey) return;
    let cancelled = false;
    fetch('/api/config')
      .then((res) => res.json())
      .then((data: { mapsApiKey?: string }) => {
        if (!cancelled && data.mapsApiKey) {
          setMapsApiKey(data.mapsApiKey);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setConfigLoaded(true);
      });

    return () => {
      cancelled = true;
    };
  }, [mapsApiKey]);

  return (
    <div className="relative w-full h-full flex flex-col bg-[#0A0D12]">
      {quotaExceeded && (
        <div className="bg-amber-50 border-b border-amber-200 text-amber-900 px-4 py-2.5 text-xs md:text-sm text-center sticky top-0 z-50 shadow-sm">
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
        </div>
      )}

      {billingRequired && !billingDismissed && !quotaExceeded && (
        <div className="bg-[#151D2B] border-b border-amber-500/40 text-amber-100 px-4 py-2 text-xs text-center sticky top-0 z-50 shadow-sm flex items-center justify-center gap-3">
          <span className="[word-break:keep-all]">
            결제 미연결 키 상태여서 Google 정책상 거리뷰 색상이 반전·워터마크로 표시됩니다. Google Cloud 결제(동적 지도 월 10,000건·거리뷰 월 5,000건 무료 포함)를 연결하면 실제 원본 고화질로 표시됩니다.
          </span>
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
      ) : !mapsApiKey ? (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="max-w-md rounded-2xl bg-[#101622] border border-slate-800 p-6 text-center space-y-3">
            <h1 className="text-lg font-bold text-slate-100">
              Google Maps 설정이 필요합니다
            </h1>
            <p className="text-xs text-slate-400 leading-relaxed">
              Google Maps Platform API 키가 아직 로드되지 않았습니다. 환경 설정에서 Google Maps 설정을 완료한 뒤 앱을 새로고침해 주세요.
            </p>
          </div>
        </div>
      ) : (
        <div className="flex-1 min-h-0 relative">
          <APIProvider apiKey={mapsApiKey} language="ko" region="KR">
            <RoadWindowWorkspace billingRequired={billingRequired} />
          </APIProvider>
        </div>
      )}
    </div>
  );
}
