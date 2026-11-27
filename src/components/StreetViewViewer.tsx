import React, { useEffect, useRef, useState } from 'react';
import { useMapsLibrary } from '@vis.gl/react-google-maps';
import { Compass, Eye, Navigation } from 'lucide-react';
import {
  haversineMeters,
  normalizeAngleDelta,
  type LatLngPoint,
} from '../engine/routeSimulation';
import {
  computeCameraShakeOffset,
  computeCrossfadeDurationMs,
  computeDynamicCameraPose,
  computeOpticalZoomHandover,
  computeSpeedAdaptiveDwellMs,
  computeTransitionMotionBlur,
  ENTRY_OPTICAL_ZOOM,
  selectNextConnectedLink,
} from '../engine/streetViewMotion';
import { checkQuotaError, toLatLngLiteral } from '../utils/mapsHelpers';

interface StreetViewViewerProps {
  targetPosition: LatLngPoint;
  targetHeading: number;
  autoAlignHeading: boolean;
  onToggleAutoAlign: () => void;
  onSwitchToAerial: () => void;
  onPovChange?: (pov: { heading: number; pitch: number }) => void;
  isMainView: boolean;
  isMoving?: boolean;
  cruiseMultiplier?: number;
  speedKmh?: number;
  isCornering?: boolean;
  cornerAngleDeg?: number;
  lookaheadPosition?: LatLngPoint;
  stepNonce?: number;
}

interface StagedStandbyPano {
  panoId: string;
  description: string;
  ready: boolean;
  startedAt: number;
  targetHeading: number;
}

const MIN_STEP_DISTANCE_M = 8;
const PRELOAD_TIMEOUT_MS = 750;

export const StreetViewViewer: React.FC<StreetViewViewerProps> = ({
  targetPosition,
  targetHeading,
  autoAlignHeading,
  onToggleAutoAlign,
  onSwitchToAerial,
  onPovChange,
  isMainView,
  isMoving = false,
  cruiseMultiplier = 1,
  speedKmh = 24,
  isCornering = false,
  cornerAngleDeg = 0,
  lookaheadPosition,
  stepNonce = 0,
}) => {
  const dwellMs = computeSpeedAdaptiveDwellMs(
    speedKmh,
    cruiseMultiplier,
    isCornering
  );
  const crossfadeMs = computeCrossfadeDurationMs(speedKmh);
  const useFastDissolve = crossfadeMs <= 420;

  const streetViewLib = useMapsLibrary('streetView');

  // Dual A/B panorama layers inside a micro-shake viewport wrapper
  const viewportShakeRef = useRef<HTMLDivElement>(null);
  const containerARef = useRef<HTMLDivElement>(null);
  const containerBRef = useRef<HTMLDivElement>(null);
  const panoramasRef = useRef<
    [google.maps.StreetViewPanorama | null, google.maps.StreetViewPanorama | null]
  >([null, null]);
  const serviceRef = useRef<google.maps.StreetViewService | null>(null);

  const [activeLayer, setActiveLayer] = useState<0 | 1>(0);
  const activeLayerRef = useRef<0 | 1>(0);
  const [outgoingLayer, setOutgoingLayer] = useState<0 | 1 | null>(null);
  const outgoingLayerRef = useRef<0 | 1 | null>(null);
  const [incomingBlurSweep, setIncomingBlurSweep] = useState<boolean>(false);

  const lastQueriedPosRef = useRef<LatLngPoint | null>(null);
  const lastPanoSwitchTimeRef = useRef<number>(0);
  const shakeOriginTimeRef = useRef<number>(performance.now());
  const lastStepNonceRef = useRef<number>(stepNonce);
  const recentPanoRingRef = useRef<string[]>([]);
  const lastPanoIdRef = useRef<string | null>(null);
  const currentHeadingRef = useRef<number>(targetHeading);
  const currentPitchRef = useRef<number>(2);
  const lastAppliedZoomRef = useRef<number>(ENTRY_OPTICAL_ZOOM);
  const prevSpeedKmhRef = useRef<number>(speedKmh);

  const pendingQueryRef = useRef<boolean>(false);
  const userDraggingRef = useRef<boolean>(false);
  const lastDragEndRef = useRef<number>(0);

  const swapTimerRef = useRef<number | null>(null);
  const fadeResetTimerRef = useRef<number | null>(null);
  const blurSweepTimerRef = useRef<number | null>(null);
  const tilesListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const stageTilesListenerRef = useRef<google.maps.MapsEventListener | null>(null);
  const stagedStandbyRef = useRef<StagedStandbyPano | null>(null);
  const stagingInFlightRef = useRef<boolean>(false);
  const onPovChangeRef = useRef(onPovChange);

  // Live motion refs for 30Hz optical-zoom & damping rAF loop without tearing down effects
  const liveMotionRef = useRef({
    targetHeading,
    autoAlignHeading,
    isMoving,
    speedKmh,
    isCornering,
    cornerAngleDeg,
    dwellMs,
    crossfadeMs,
    lookaheadPosition,
  });

  useEffect(() => {
    liveMotionRef.current = {
      targetHeading,
      autoAlignHeading,
      isMoving,
      speedKmh,
      isCornering,
      cornerAngleDeg,
      dwellMs,
      crossfadeMs,
      lookaheadPosition,
    };
  }, [
    targetHeading,
    autoAlignHeading,
    isMoving,
    speedKmh,
    isCornering,
    cornerAngleDeg,
    dwellMs,
    crossfadeMs,
    lookaheadPosition,
  ]);

  const [coverageStatus, setCoverageStatus] = useState<
    'loading' | 'ready' | 'unavailable'
  >('loading');
  const [panoAddress, setPanoAddress] = useState<string>('');

  useEffect(() => {
    onPovChangeRef.current = onPovChange;
  }, [onPovChange]);

  const pushRecentPano = (panoId: string) => {
    lastPanoIdRef.current = panoId;
    const next = [...recentPanoRingRef.current.filter((id) => id !== panoId), panoId];
    if (next.length > 4) next.shift();
    recentPanoRingRef.current = next;
  };

  // Pre-warm the next forward panorama onto the hidden standby buffer while active layer dwells
  const stageNextStandbyRef = useRef<() => void>(() => {});
  stageNextStandbyRef.current = () => {
    if (!isMainView || !streetViewLib || !serviceRef.current) return;
    if (outgoingLayerRef.current !== null || pendingQueryRef.current) return;
    if (stagedStandbyRef.current || stagingInFlightRef.current) return;
    if (!lastPanoIdRef.current) return;

    const activeIdx = activeLayerRef.current;
    const standbyIdx: 0 | 1 = activeIdx === 0 ? 1 : 0;
    const activePano = panoramasRef.current[activeIdx];
    const standbyPano = panoramasRef.current[standbyIdx];
    if (!activePano || !standbyPano) return;

    const motion = liveMotionRef.current;
    const links = activePano.getLinks() ?? [];
    const nextLink = selectNextConnectedLink(
      links,
      motion.targetHeading,
      recentPanoRingRef.current,
      50
    );

    const beginStandbyPreload = (
      panoId: string,
      description: string,
      heading: number
    ) => {
      if (!panoId || panoId === lastPanoIdRef.current) return;
      stageTilesListenerRef.current?.remove();
      stageTilesListenerRef.current = null;

      stagedStandbyRef.current = {
        panoId,
        description,
        ready: false,
        startedAt: performance.now(),
        targetHeading: heading,
      };

      const recentlyDragged = Date.now() - lastDragEndRef.current < 8000;
      const desiredHeading =
        motion.autoAlignHeading && !userDraggingRef.current && !recentlyDragged
          ? heading
          : currentHeadingRef.current;

      standbyPano.setZoom(ENTRY_OPTICAL_ZOOM);
      standbyPano.setPov({
        heading: desiredHeading,
        pitch: currentPitchRef.current,
      });

      stageTilesListenerRef.current = standbyPano.addListener(
        'tilesloaded',
        () => {
          if (stagedStandbyRef.current?.panoId === panoId) {
            stagedStandbyRef.current.ready = true;
          }
          stageTilesListenerRef.current?.remove();
          stageTilesListenerRef.current = null;
        }
      );
      standbyPano.setPano(panoId);
    };

    if (nextLink) {
      beginStandbyPreload(
        nextLink.pano,
        nextLink.description,
        motion.targetHeading
      );
      return;
    }

    if (!motion.isMoving || !motion.lookaheadPosition) return;
    stagingInFlightRef.current = true;
    void serviceRef.current
      .getPanorama({
        location: motion.lookaheadPosition,
        radius: 65,
        preference: streetViewLib.StreetViewPreference.BEST,
        sources: [
          streetViewLib.StreetViewSource.GOOGLE,
          streetViewLib.StreetViewSource.OUTDOOR,
        ],
      })
      .then((res) => {
        const loc = res.data.location;
        if (loc?.pano && loc.pano !== lastPanoIdRef.current && !stagedStandbyRef.current) {
          beginStandbyPreload(
            loc.pano,
            loc.description || '',
            motion.targetHeading
          );
        }
      })
      .catch(() => {})
      .finally(() => {
        stagingInFlightRef.current = false;
      });
  };

  // Initialize StreetViewPanorama buffer(s) once when library loads
  useEffect(() => {
    if (!streetViewLib || !containerARef.current) return;
    if (panoramasRef.current[0]) return;

    const { StreetViewPanorama, StreetViewService } = streetViewLib;
    const service = new StreetViewService();
    serviceRef.current = service;

    const sharedOptions: google.maps.StreetViewPanoramaOptions = {
      position: targetPosition,
      pov: {
        heading: targetHeading,
        pitch: 2,
      },
      zoom: ENTRY_OPTICAL_ZOOM,
      visible: true,
      addressControl: false,
      linksControl: isMainView,
      panControl: false,
      zoomControl: false,
      fullscreenControl: false,
      enableCloseButton: false,
      motionTracking: false,
      motionTrackingControl: false,
      showRoadLabels: isMainView,
    };

    const panoA = new StreetViewPanorama(containerARef.current, sharedOptions);
    const panoB =
      isMainView && containerBRef.current
        ? new StreetViewPanorama(containerBRef.current, sharedOptions)
        : null;

    panoramasRef.current = [panoA, panoB];
    activeLayerRef.current = 0;
    outgoingLayerRef.current = null;
    setActiveLayer(0);
    setOutgoingLayer(null);

    const listeners: google.maps.MapsEventListener[] = [];

    const bindListeners = (
      pano: google.maps.StreetViewPanorama,
      layerIndex: 0 | 1
    ) => {
      listeners.push(
        pano.addListener('pov_changed', () => {
          if (activeLayerRef.current !== layerIndex) return;
          const pov = pano.getPov();
          if (userDraggingRef.current) {
            currentHeadingRef.current = pov.heading;
            currentPitchRef.current = pov.pitch;
          }
          onPovChangeRef.current?.({ heading: pov.heading, pitch: pov.pitch });
        })
      );
      listeners.push(
        pano.addListener('pano_changed', () => {
          if (activeLayerRef.current !== layerIndex) return;
          const panoId = pano.getPano();
          if (panoId) {
            pushRecentPano(panoId);
            setCoverageStatus('ready');
            // Pre-stage N+1 panorama immediately after active pano resolves
            window.setTimeout(() => stageNextStandbyRef.current(), 80);
          }
        })
      );
      listeners.push(
        pano.addListener('links_changed', () => {
          if (activeLayerRef.current !== layerIndex) return;
          stageNextStandbyRef.current();
        })
      );
    };

    bindListeners(panoA, 0);
    if (panoB) {
      bindListeners(panoB, 1);
    }

    return () => {
      if (swapTimerRef.current !== null) {
        window.clearTimeout(swapTimerRef.current);
        swapTimerRef.current = null;
      }
      if (fadeResetTimerRef.current !== null) {
        window.clearTimeout(fadeResetTimerRef.current);
        fadeResetTimerRef.current = null;
      }
      if (blurSweepTimerRef.current !== null) {
        window.clearTimeout(blurSweepTimerRef.current);
        blurSweepTimerRef.current = null;
      }
      tilesListenerRef.current?.remove();
      tilesListenerRef.current = null;
      stageTilesListenerRef.current?.remove();
      stageTilesListenerRef.current = null;
      stagedStandbyRef.current = null;
      listeners.forEach((l) => l.remove());
      panoramasRef.current = [null, null];
      serviceRef.current = null;
    };
  }, [streetViewLib, isMainView]);

  // Continuous 60Hz camera micro-shake + 30Hz optical dolly-zoom & heading damping loop
  useEffect(() => {
    const shakeEl = viewportShakeRef.current;
    if (!isMainView || !isMoving) {
      if (shakeEl) {
        shakeEl.style.transform = 'translate3d(0px, 0px, 0) rotate(0deg) scale(1)';
      }
      return;
    }

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let rafId = 0;
    let lastPanoTick = performance.now();

    const loop = (now: number) => {
      const motion = liveMotionRef.current;

      // 1) Frame-synced Camera Shake on the viewport wrapper (zero React re-renders)
      const currentShakeEl = viewportShakeRef.current;
      if (currentShakeEl) {
        if (reducedMotion) {
          currentShakeEl.style.transform =
            'translate3d(0px, 0px, 0) rotate(0deg) scale(1)';
        } else {
          const msSinceTransition =
            lastPanoSwitchTimeRef.current > 0
              ? Date.now() - lastPanoSwitchTimeRef.current
              : 9999;
          const shake = computeCameraShakeOffset({
            elapsedSec: (now - shakeOriginTimeRef.current) / 1000,
            msSinceTransition,
            speedKmh: motion.speedKmh,
            isMoving: motion.isMoving,
            isCornering: motion.isCornering,
            userDragging: userDraggingRef.current,
          });
          currentShakeEl.style.transform = `translate3d(${shake.xPx}px, ${shake.yPx}px, 0) rotate(${shake.rotateDeg}deg) scale(${shake.scale})`;
        }
      }

      // 2) 30Hz Street View spherical optical dolly-zoom + smooth heading/pitch damping
      const elapsedTickMs = now - lastPanoTick;
      if (elapsedTickMs >= 32) {
        const dtSec = elapsedTickMs / 1000;
        lastPanoTick = now;

        const activePano = panoramasRef.current[activeLayerRef.current];

        if (activePano && lastPanoSwitchTimeRef.current > 0 && !userDraggingRef.current) {
          const progress01 =
            (Date.now() - lastPanoSwitchTimeRef.current) /
            Math.max(500, motion.dwellMs);
          const nextZoom = computeOpticalZoomHandover(
            progress01,
            motion.speedKmh,
            motion.isCornering
          );

          if (Math.abs(nextZoom - lastAppliedZoomRef.current) >= 0.008) {
            lastAppliedZoomRef.current = nextZoom;
            activePano.setZoom(nextZoom);
          }

          const recentlyDragged = Date.now() - lastDragEndRef.current < 8000;
          if (motion.autoAlignHeading && !recentlyDragged) {
            const pose = computeDynamicCameraPose({
              currentHeading: currentHeadingRef.current,
              targetHeading: motion.targetHeading,
              currentPitch: currentPitchRef.current,
              speedKmh: motion.speedKmh,
              prevSpeedKmh: prevSpeedKmhRef.current,
              cornerAngleDeg: motion.cornerAngleDeg,
              dtSeconds: dtSec,
            });
            prevSpeedKmhRef.current = motion.speedKmh;

            if (
              Math.abs(normalizeAngleDelta(currentHeadingRef.current, pose.heading)) >= 0.15 ||
              Math.abs(currentPitchRef.current - pose.pitch) >= 0.08
            ) {
              currentHeadingRef.current = pose.heading;
              currentPitchRef.current = pose.pitch;
              activePano.setPov({
                heading: pose.heading,
                pitch: pose.pitch,
              });
            }
          }
        }
      }

      rafId = window.requestAnimationFrame(loop);
    };

    rafId = window.requestAnimationFrame(loop);
    return () => {
      window.cancelAnimationFrame(rafId);
      if (viewportShakeRef.current) {
        viewportShakeRef.current.style.transform =
          'translate3d(0px, 0px, 0) rotate(0deg) scale(1)';
      }
    };
  }, [isMainView, isMoving]);

  // Trigger panorama advance when moving or scrubbed, consuming pre-staged standby buffer with 0ms lag
  useEffect(() => {
    const activeIdx = activeLayerRef.current;
    const activePano = panoramasRef.current[activeIdx];
    const standbyIdx: 0 | 1 = activeIdx === 0 ? 1 : 0;
    const standbyPano = panoramasRef.current[standbyIdx];
    const service = serviceRef.current;
    const svLib = streetViewLib;

    if (!activePano || !service || !svLib) return;

    const manualStepTriggered = stepNonce !== lastStepNonceRef.current;
    const lastPos = lastQueriedPosRef.current;
    const movedMeters = lastPos
      ? haversineMeters(lastPos, targetPosition)
      : Infinity;
    const elapsedSinceSwitch = Date.now() - lastPanoSwitchTimeRef.current;

    if (pendingQueryRef.current) return;

    if (!manualStepTriggered) {
      if (lastPos && movedMeters < MIN_STEP_DISTANCE_M) return;
      if (lastPos && elapsedSinceSwitch < dwellMs) return;
    }

    lastStepNonceRef.current = stepNonce;
    pendingQueryRef.current = true;
    lastQueriedPosRef.current = targetPosition;

    const commitSwapToStandby = (
      panoId: string,
      description: string | undefined,
      desiredHeading: number,
      desiredPitch: number
    ) => {
      tilesListenerRef.current?.remove();
      tilesListenerRef.current = null;
      stageTilesListenerRef.current?.remove();
      stageTilesListenerRef.current = null;
      if (swapTimerRef.current !== null) {
        window.clearTimeout(swapTimerRef.current);
        swapTimerRef.current = null;
      }

      pushRecentPano(panoId);
      lastPanoSwitchTimeRef.current = Date.now();
      lastAppliedZoomRef.current = ENTRY_OPTICAL_ZOOM;
      currentHeadingRef.current = desiredHeading;
      currentPitchRef.current = desiredPitch;
      if (description !== undefined) {
        setPanoAddress(description);
      }

      const previousActive = activeLayerRef.current;
      activeLayerRef.current = standbyIdx;
      outgoingLayerRef.current = previousActive;
      stagedStandbyRef.current = null;
      setOutgoingLayer(previousActive);
      setActiveLayer(standbyIdx);
      setIncomingBlurSweep(true);
      pendingQueryRef.current = false;

      if (blurSweepTimerRef.current !== null) {
        window.clearTimeout(blurSweepTimerRef.current);
      }
      blurSweepTimerRef.current = window.setTimeout(() => {
        setIncomingBlurSweep(false);
        blurSweepTimerRef.current = null;
      }, 95);

      const clearDelayMs = liveMotionRef.current.crossfadeMs + 70;
      if (fadeResetTimerRef.current !== null) {
        window.clearTimeout(fadeResetTimerRef.current);
      }
      fadeResetTimerRef.current = window.setTimeout(() => {
        outgoingLayerRef.current = null;
        setOutgoingLayer(null);
        fadeResetTimerRef.current = null;
        // Immediately pre-warm N+1 panorama on the newly freed standby layer
        stageNextStandbyRef.current();
      }, clearDelayMs);
    };

    const transitionToPano = (
      panoId: string,
      description?: string,
      alreadyPreloaded = false
    ) => {
      if (!panoId) {
        pendingQueryRef.current = false;
        return;
      }
      setCoverageStatus('ready');

      if (panoId === lastPanoIdRef.current) {
        pendingQueryRef.current = false;
        return;
      }

      const recentlyDragged = Date.now() - lastDragEndRef.current < 8000;
      const desiredHeading =
        autoAlignHeading && !userDraggingRef.current && !recentlyDragged
          ? targetHeading
          : currentHeadingRef.current;
      const desiredPitch =
        autoAlignHeading && !userDraggingRef.current && !recentlyDragged
          ? 2
          : currentPitchRef.current;

      // Single-buffer path for PiP mini window or initial cold boot
      if (!standbyPano || !lastPanoIdRef.current) {
        pushRecentPano(panoId);
        lastPanoSwitchTimeRef.current = Date.now();
        lastAppliedZoomRef.current = ENTRY_OPTICAL_ZOOM;
        activePano.setZoom(ENTRY_OPTICAL_ZOOM);
        activePano.setPov({
          heading: desiredHeading,
          pitch: desiredPitch,
        });
        activePano.setPano(panoId);
        if (description !== undefined) {
          setPanoAddress(description);
        }
        currentHeadingRef.current = desiredHeading;
        currentPitchRef.current = desiredPitch;
        pendingQueryRef.current = false;
        return;
      }

      // Fast path: standby buffer ALREADY preloaded tiles during the previous dwell!
      if (alreadyPreloaded) {
        standbyPano.setZoom(ENTRY_OPTICAL_ZOOM);
        standbyPano.setPov({
          heading: desiredHeading,
          pitch: desiredPitch,
        });
        commitSwapToStandby(panoId, description, desiredHeading, desiredPitch);
        return;
      }

      // Standard double-buffered preload into standby buffer, then crossfade on tilesloaded
      tilesListenerRef.current?.remove();
      tilesListenerRef.current = null;
      stageTilesListenerRef.current?.remove();
      stageTilesListenerRef.current = null;
      stagedStandbyRef.current = null;
      if (swapTimerRef.current !== null) {
        window.clearTimeout(swapTimerRef.current);
        swapTimerRef.current = null;
      }

      let committed = false;
      const onReady = () => {
        if (committed) return;
        committed = true;
        commitSwapToStandby(panoId, description, desiredHeading, desiredPitch);
      };

      standbyPano.setZoom(ENTRY_OPTICAL_ZOOM);
      standbyPano.setPov({
        heading: desiredHeading,
        pitch: desiredPitch,
      });
      tilesListenerRef.current = standbyPano.addListener('tilesloaded', onReady);
      standbyPano.setPano(panoId);

      const maxWaitMs = manualStepTriggered ? 260 : PRELOAD_TIMEOUT_MS;
      swapTimerRef.current = window.setTimeout(onReady, maxWaitMs);
    };

    const currentPanoPos = toLatLngLiteral(activePano.getPosition());
    const driftFromRoute = currentPanoPos
      ? haversineMeters(currentPanoPos, targetPosition)
      : Infinity;

    // 1) Zero-lag Pre-Staged Standby Fast Path (when moving continuously along the road)
    const staged = stagedStandbyRef.current;
    if (
      !manualStepTriggered &&
      isMoving &&
      staged &&
      driftFromRoute <= 75 &&
      (staged.ready || performance.now() - staged.startedAt >= 260)
    ) {
      transitionToPano(staged.panoId, staged.description, true);
      return;
    }

    // 2) Connected link fast path
    const links = activePano.getLinks() ?? [];
    if (!manualStepTriggered && isMoving && driftFromRoute <= 75 && links.length > 0) {
      const nextLink = selectNextConnectedLink(
        links,
        targetHeading,
        recentPanoRingRef.current,
        50
      );
      if (nextLink) {
        transitionToPano(nextLink.pano, nextLink.description, false);
        return;
      }
    }

    // 3) Geographic coordinate lookup fallback (scrubbing, manual jump, or intersection re-sync)
    const requestPano = async () => {
      try {
        const res = await service.getPanorama({
          location: targetPosition,
          radius: 75,
          preference: svLib.StreetViewPreference.BEST,
          sources: [
            svLib.StreetViewSource.GOOGLE,
            svLib.StreetViewSource.OUTDOOR,
          ],
        });
        if (res.data.location?.pano) {
          transitionToPano(
            res.data.location.pano,
            res.data.location.description || '',
            false
          );
          return;
        }
      } catch {
        try {
          const wideRes = await service.getPanorama({
            location: targetPosition,
            radius: 150,
            preference: svLib.StreetViewPreference.NEAREST,
            sources: [
              svLib.StreetViewSource.GOOGLE,
              svLib.StreetViewSource.OUTDOOR,
            ],
          });
          if (wideRes.data.location?.pano) {
            transitionToPano(
              wideRes.data.location.pano,
              wideRes.data.location.description || '',
              false
            );
            return;
          }
        } catch {
          try {
            const outdoorFallback = await service.getPanorama({
              location: targetPosition,
              radius: 130,
              preference: svLib.StreetViewPreference.NEAREST,
              sources: [svLib.StreetViewSource.OUTDOOR],
            });
            if (outdoorFallback.data.location?.pano) {
              transitionToPano(
                outdoorFallback.data.location.pano,
                outdoorFallback.data.location.description || '',
                false
              );
              return;
            }
          } catch (err) {
            const isQuota = checkQuotaError(err);
            if (!isQuota) {
              if (!lastPanoIdRef.current) {
                setCoverageStatus('unavailable');
              } else {
                const distFromPano = toLatLngLiteral(activePano.getPosition());
                if (
                  distFromPano &&
                  haversineMeters(distFromPano, targetPosition) > 280
                ) {
                  setCoverageStatus('unavailable');
                }
              }
            }
          }
        }
      }
      pendingQueryRef.current = false;
    };

    void requestPano();
  }, [
    streetViewLib,
    targetPosition,
    targetHeading,
    autoAlignHeading,
    isMoving,
    stepNonce,
    dwellMs,
  ]);

  const motionBlur = computeTransitionMotionBlur(
    speedKmh,
    outgoingLayer !== null,
    isMainView && isMoving
  );

  const outgoingBlurClass =
    motionBlur.outgoingBlurPx >= 3.8
      ? 'blur-[4.5px] brightness-[1.04] contrast-[1.04]'
      : motionBlur.outgoingBlurPx >= 2.4
        ? 'blur-[3px] brightness-[1.03]'
        : motionBlur.outgoingBlurPx >= 1.0
          ? 'blur-[1.5px]'
          : 'blur-none';

  const incomingBlurClass =
    incomingBlurSweep && motionBlur.incomingBlurPx >= 1.0
      ? 'blur-[1.5px] scale-[1.015]'
      : 'blur-none scale-100';

  const peripheralOpacityClass =
    motionBlur.peripheralOpacity >= 0.7
      ? 'opacity-85'
      : motionBlur.peripheralOpacity >= 0.45
        ? 'opacity-60'
        : motionBlur.peripheralOpacity > 0
          ? 'opacity-35'
          : 'opacity-0';

  const getLayerClassName = (layerIndex: 0 | 1) => {
    const isActive = activeLayer === layerIndex;
    const isOutgoing = outgoingLayer === layerIndex;
    const fadeDurationClass = useFastDissolve ? 'duration-300' : 'duration-500';

    if (isActive && outgoingLayer !== null) {
      return `absolute inset-0 w-full h-full z-20 opacity-100 ${incomingBlurClass} transition-[opacity,transform,filter] ${fadeDurationClass} ease-out pointer-events-auto`;
    }
    if (isActive) {
      return `absolute inset-0 w-full h-full z-10 opacity-100 ${incomingBlurClass} transition-[opacity,transform,filter] ${fadeDurationClass} ease-out pointer-events-auto`;
    }
    if (isOutgoing) {
      return `absolute inset-0 w-full h-full z-10 opacity-100 scale-[1.055] ${outgoingBlurClass} transition-[transform,filter] ${fadeDurationClass} ease-out pointer-events-none`;
    }
    return 'absolute inset-0 w-full h-full z-0 opacity-0 blur-none scale-100 transition-opacity duration-200 ease-out pointer-events-none';
  };

  return (
    <div
      className="relative w-full h-full bg-[#0A0D12] overflow-hidden"
      onPointerDown={() => {
        userDraggingRef.current = true;
        if (viewportShakeRef.current) {
          viewportShakeRef.current.style.transform =
            'translate3d(0px, 0px, 0) rotate(0deg) scale(1)';
        }
      }}
      onPointerUp={() => {
        userDraggingRef.current = false;
        lastDragEndRef.current = Date.now();
      }}
      onPointerCancel={() => {
        userDraggingRef.current = false;
        lastDragEndRef.current = Date.now();
      }}
    >
      {/* Frame-synced Camera Shake viewport wrapper (does not shake HUD overlays) */}
      <div
        ref={viewportShakeRef}
        data-testid="street-view-viewport"
        data-motion-blur-active={outgoingLayer !== null && isMoving ? 'true' : 'false'}
        data-motion-blur-px={motionBlur.outgoingBlurPx}
        data-camera-shake-active={isMainView && isMoving && speedKmh >= 2 ? 'true' : 'false'}
        className="relative w-full h-full will-change-transform origin-center"
      >
        <div
          ref={containerARef}
          data-testid="street-view-canvas"
          className={`${getLayerClassName(0)} min-h-[200px] min-w-[200px]`}
        />

        {isMainView && (
          <div
            ref={containerBRef}
            aria-hidden="true"
            className={`${getLayerClassName(1)} min-h-[200px] min-w-[200px]`}
          />
        )}
      </div>

      {/* Radial peripheral CSS Motion Blur & subtle speed framing at cruising speeds */}
      {isMainView && (
        <div
          aria-hidden="true"
          className={`pointer-events-none absolute inset-0 z-20 sv-radial-speed-blur shadow-[inset_0_0_95px_rgba(6,10,16,0.55)] transition-opacity duration-500 ${peripheralOpacityClass}`}
        />
      )}

      {/* Top-left Taxi Window Context Strip (desktop full strip; mobile shows only road name when present) */}
      {isMainView && (
        <div className="pointer-events-none absolute top-[72px] md:top-24 left-2.5 md:left-4 z-30 flex items-center gap-2">
          <div
            className={`pointer-events-auto items-center gap-2 px-2.5 md:px-3 py-1 md:py-1.5 rounded-lg bg-[#0B1018]/85 border border-slate-700/70 text-[11px] md:text-xs text-slate-200 shadow-lg ${
              panoAddress ? 'flex' : 'hidden md:flex'
            }`}
          >
            <Eye className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            <span className="truncate max-w-[160px] md:max-w-[280px]">
              {panoAddress || '360° 창밖 시점 (드래그 회전)'}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              const activePano = panoramasRef.current[activeLayerRef.current];
              if (activePano) {
                lastDragEndRef.current = 0;
                currentHeadingRef.current = targetHeading;
                currentPitchRef.current = 2;
                activePano.setPov({
                  heading: targetHeading,
                  pitch: 2,
                });
              }
              onToggleAutoAlign();
            }}
            aria-label={
              autoAlignHeading ? '진행방향 자동정렬 켜짐' : '자유 시점 모드'
            }
            className={`hidden md:flex pointer-events-auto min-h-[34px] px-2.5 py-1 rounded-lg border text-xs font-medium items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
              autoAlignHeading
                ? 'bg-amber-500/20 border-amber-400/60 text-amber-200'
                : 'bg-[#0B1018]/88 border-slate-700/70 text-slate-300 hover:text-white'
            }`}
          >
            {autoAlignHeading ? (
              <Navigation className="w-3.5 h-3.5" />
            ) : (
              <Compass className="w-3.5 h-3.5" />
            )}
            <span>{autoAlignHeading ? '시선 자동정렬' : '360° 자유시점'}</span>
          </button>
        </div>
      )}

      {/* Non-blocking coverage fallback when tunnel/bridge/rural road lacks Street View */}
      {coverageStatus === 'unavailable' && isMainView && (
        <div className="absolute inset-x-4 top-1/2 -translate-y-1/2 z-30 max-w-sm mx-auto rounded-2xl bg-[#101622]/95 border border-slate-700 p-5 text-center shadow-2xl">
          <p className="text-sm font-semibold text-slate-100 mb-1">
            이 구간에는 거리뷰 이미지가 없습니다
          </p>
          <p className="text-xs text-slate-400 mb-4 leading-relaxed">
            터널·교량 또는 미촬영 도로를 통과 중입니다. 항공뷰로 전환해 실시간 위성 주행을 계속 감상할 수 있습니다.
          </p>
          <button
            type="button"
            onClick={onSwitchToAerial}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold transition-colors"
          >
            항공뷰로 전환하기
          </button>
        </div>
      )}
    </div>
  );
};
