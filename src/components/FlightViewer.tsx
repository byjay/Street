import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  setWorkerUrl,
  type GeoJSONSourceSpecification,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type {
  FlightCameraMode,
  FlightTelemetry,
  FlightTimeOfDay,
  FlightWaypoint,
} from '../types/drive';

setWorkerUrl(maplibreWorkerUrl);

interface FlightViewerProps {
  waypoints: readonly FlightWaypoint[];
  activeWaypoint: FlightWaypoint;
  telemetry: FlightTelemetry;
  cameraMode: FlightCameraMode;
  timeOfDay: FlightTimeOfDay;
  vworldApiKey?: string;
}

function detectWebGLSupport(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2') || canvas.getContext('webgl'));
  } catch {
    return false;
  }
}

function getCameraOffsets(mode: FlightCameraMode, altitudeMeters: number): {
  bearingOffset: number;
  pitch: number;
  zoom: number;
} {
  const altNorm = Math.max(0, Math.min(1, altitudeMeters / 8000));
  const baseZoom = 15.2 - altNorm * 5.2; // 15.2 low -> 10.0 cruise
  switch (mode) {
    case 'cockpit':
      return { bearingOffset: 0, pitch: 70, zoom: Math.min(15.5, baseZoom + 0.6) };
    case 'window-left':
      return { bearingOffset: -86, pitch: 60, zoom: Math.min(15.2, baseZoom + 0.3) };
    case 'window-right':
      return { bearingOffset: 86, pitch: 60, zoom: Math.min(15.2, baseZoom + 0.3) };
    case 'chase':
    default:
      return { bearingOffset: 0, pitch: 52, zoom: Math.max(9.2, baseZoom - 0.6) };
  }
}

function getTimeLightingFilter(timeOfDay: FlightTimeOfDay): {
  filter: string;
  tintBg: string;
  skyTop: string;
} {
  switch (timeOfDay) {
    case 'dawn':
      return {
        filter: 'brightness(0.88) contrast(1.06) saturate(1.12) sepia(0.14)',
        tintBg: 'linear-gradient(180deg, rgba(251,146,60,0.22) 0%, rgba(15,23,42,0.12) 45%, transparent 100%)',
        skyTop: 'from-[#F97316]/35 via-[#1E293B]/20 to-transparent',
      };
    case 'sunset':
      return {
        filter: 'brightness(0.85) contrast(1.12) saturate(1.22) sepia(0.2)',
        tintBg: 'linear-gradient(180deg, rgba(244,63,94,0.25) 0%, rgba(245,158,11,0.15) 40%, transparent 100%)',
        skyTop: 'from-[#E11D48]/35 via-[#F59E0B]/20 to-transparent',
      };
    case 'night':
      return {
        filter: 'brightness(0.42) contrast(1.32) saturate(0.85) hue-rotate(195deg)',
        tintBg: 'linear-gradient(180deg, rgba(2,6,23,0.68) 0%, rgba(15,23,42,0.35) 50%, rgba(2,6,23,0.25) 100%)',
        skyTop: 'from-[#020617]/80 via-[#0F172A]/45 to-transparent',
      };
    case 'day':
    default:
      return {
        filter: 'brightness(1) contrast(1.04) saturate(1.08)',
        tintBg: 'linear-gradient(180deg, rgba(56,189,248,0.18) 0%, transparent 45%)',
        skyTop: 'from-sky-400/20 via-transparent to-transparent',
      };
  }
}

function latLngToWorldPx(
  pt: { lat: number; lng: number },
  zoom: number
): { x: number; y: number } {
  const worldSize = 256 * Math.pow(2, zoom);
  const x = ((pt.lng + 180) / 360) * worldSize;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, pt.lat));
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

const SlippyFlightFallback: React.FC<{
  waypoints: readonly FlightWaypoint[];
  activeWaypoint: FlightWaypoint;
  cameraMode: FlightCameraMode;
}> = ({ waypoints, activeWaypoint, cameraMode }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setSize({ width: rect.width, height: rect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const zoom = activeWaypoint.altitudeMeters > 4500 ? 10 : activeWaypoint.altitudeMeters > 1800 ? 11 : 13;
  const centerPx = useMemo(
    () => latLngToWorldPx(activeWaypoint, zoom),
    [activeWaypoint, zoom]
  );

  const tilesCount = Math.pow(2, zoom);
  const tileRadiusX = Math.ceil(size.width / 512) + 1;
  const tileRadiusY = Math.ceil(size.height / 512) + 1;
  const centerTileX = Math.floor(centerPx.x / 256);
  const centerTileY = Math.floor(centerPx.y / 256);

  const tiles: Array<{ key: string; url: string; left: number; top: number }> = [];
  for (let dx = -tileRadiusX; dx <= tileRadiusX; dx += 1) {
    for (let dy = -tileRadiusY; dy <= tileRadiusY; dy += 1) {
      const tx = ((centerTileX + dx) % tilesCount + tilesCount) % tilesCount;
      const ty = centerTileY + dy;
      if (ty < 0 || ty >= tilesCount) continue;
      tiles.push({
        key: `${zoom}-${tx}-${ty}-${dx}-${dy}`,
        url: `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`,
        left: size.width / 2 + (centerTileX + dx) * 256 - centerPx.x,
        top: size.height / 2 + ty * 256 - centerPx.y,
      });
    }
  }

  const polylinePoints = useMemo(() => {
    if (waypoints.length < 2) return '';
    return waypoints
      .filter((_, idx) => idx % 4 === 0 || idx === waypoints.length - 1)
      .map((pt) => {
        const p = latLngToWorldPx(pt, zoom);
        return `${(size.width / 2 + (p.x - centerPx.x)).toFixed(1)},${(size.height / 2 + (p.y - centerPx.y)).toFixed(1)}`;
      })
      .join(' ');
  }, [waypoints, zoom, size.width, size.height, centerPx.x, centerPx.y]);

  const camOffsets = getCameraOffsets(cameraMode, activeWaypoint.altitudeMeters);
  const viewBearing = (activeWaypoint.headingDeg + camOffsets.bearingOffset + 360) % 360;
  const planeRelRot = (activeWaypoint.headingDeg - viewBearing + 360) % 360;

  return (
    <div ref={containerRef} className="relative w-full h-full overflow-hidden bg-[#060A12]">
      <div
        className="absolute inset-0 transition-transform duration-150 ease-out"
        style={{
          transform: `perspective(900px) rotateX(${cameraMode === 'chase' ? 24 : 34}deg) scale(1.38) rotate(${-viewBearing}deg)`,
        }}
      >
        {tiles.map((t) => (
          <img
            key={t.key}
            src={t.url}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            className="absolute w-[256px] h-[256px] max-w-none pointer-events-none"
            style={{ left: t.left, top: t.top }}
          />
        ))}
        {polylinePoints && (
          <svg
            width={size.width}
            height={size.height}
            className="absolute inset-0 pointer-events-none overflow-visible"
          >
            <polyline
              points={polylinePoints}
              fill="none"
              stroke="#38BDF8"
              strokeWidth={4}
              strokeDasharray="10 6"
              strokeOpacity={0.85}
            />
          </svg>
        )}
      </div>

      {cameraMode === 'chase' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            style={{ transform: `rotate(${planeRelRot}deg)` }}
            className="w-11 h-11 flex items-center justify-center drop-shadow-[0_4px_12px_rgba(0,0,0,0.9)]"
          >
            <svg viewBox="0 0 36 36" className="w-10 h-10" aria-hidden="true">
              <path
                d="M18 2 L21.5 13 L33 19 L33 22.5 L21.5 19.5 L21 28 L25.5 31.5 L25.5 34 L18 32 L10.5 34 L10.5 31.5 L15 28 L14.5 19.5 L3 22.5 L3 19 L14.5 13 Z"
                fill="#F8FAFC"
                stroke="#0F172A"
                strokeWidth="1.6"
                strokeLinejoin="round"
              />
            </svg>
          </div>
        </div>
      )}
    </div>
  );
};

export const FlightViewer: React.FC<FlightViewerProps> = ({
  waypoints,
  activeWaypoint,
  telemetry,
  cameraMode,
  timeOfDay,
  vworldApiKey = '',
}) => {
  const hasWebGL = useMemo(() => detectWebGLSupport(), []);
  const [webglFailed, setWebglFailed] = useState(false);

  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const planeMarkerRef = useRef<MapLibreMarker | null>(null);
  const planeIconRef = useRef<HTMLDivElement | null>(null);

  const liveRef = useRef({ activeWaypoint, cameraMode });
  useEffect(() => {
    liveRef.current = { activeWaypoint, cameraMode };
  }, [activeWaypoint, cameraMode]);

  const lighting = useMemo(() => getTimeLightingFilter(timeOfDay), [timeOfDay]);

  useEffect(() => {
    if (!hasWebGL || webglFailed || !mapContainerRef.current) return;

    const satelliteTiles = vworldApiKey
      ? [
          `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(vworldApiKey)}/Satellite/{z}/{y}/{x}.jpeg`,
        ]
      : [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ];

    const styleSpec: StyleSpecification = {
      version: 8,
      sources: {
        'flight-sat': {
          type: 'raster',
          tiles: satelliteTiles,
          tileSize: 256,
          maxzoom: 19,
          attribution: vworldApiKey ? 'VWorld Satellite' : 'Esri World Imagery',
        },
        ...(vworldApiKey
          ? {
              'flight-hybrid': {
                type: 'raster',
                tiles: [
                  `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(vworldApiKey)}/Hybrid/{z}/{y}/{x}.png`,
                ],
                tileSize: 256,
                maxzoom: 19,
              },
            }
          : {}),
      },
      layers: [
        {
          id: 'flight-sat-layer',
          type: 'raster',
          source: 'flight-sat',
          minzoom: 0,
          maxzoom: 22,
        },
        ...(vworldApiKey
          ? [
              {
                id: 'flight-hybrid-layer',
                type: 'raster' as const,
                source: 'flight-hybrid',
                minzoom: 6,
                maxzoom: 20,
              },
            ]
          : []),
      ],
    };

    const initialPose = getCameraOffsets(
      liveRef.current.cameraMode,
      liveRef.current.activeWaypoint.altitudeMeters
    );

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: mapContainerRef.current,
        style: styleSpec,
        center: [liveRef.current.activeWaypoint.lng, liveRef.current.activeWaypoint.lat],
        zoom: initialPose.zoom,
        pitch: initialPose.pitch,
        bearing:
          (liveRef.current.activeWaypoint.headingDeg + initialPose.bearingOffset + 360) %
          360,
        interactive: false,
        attributionControl: false,
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    mapRef.current = map;

    map.on('error', (ev: unknown) => {
      const errObj = (ev as { error?: { message?: string } } | null)?.error;
      const msg = typeof errObj?.message === 'string' ? errObj.message : '';
      if (
        msg.includes('Worker failed') ||
        msg.includes('WebGL') ||
        msg.includes('Failed to initialize')
      ) {
        setWebglFailed(true);
      }
    });

    map.on('load', () => {
      if (waypoints.length < 2 || map.getSource('flight-path')) return;
      const geojson: GeoJSONSourceSpecification['data'] = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: waypoints.map((wp) => [wp.lng, wp.lat]),
        },
      };
      map.addSource('flight-path', { type: 'geojson', data: geojson });
      map.addLayer({
        id: 'flight-path-glow',
        type: 'line',
        source: 'flight-path',
        paint: {
          'line-color': '#38BDF8',
          'line-width': 6,
          'line-opacity': 0.35,
        },
      });
      map.addLayer({
        id: 'flight-path-line',
        type: 'line',
        source: 'flight-path',
        paint: {
          'line-color': '#7DD3FC',
          'line-width': 2.5,
          'line-dasharray': [2, 2],
          'line-opacity': 0.9,
        },
      });
    });

    const wrapper = document.createElement('div');
    wrapper.className = 'w-11 h-11 flex items-center justify-center pointer-events-none';
    const icon = document.createElement('div');
    icon.className = 'w-10 h-10 flex items-center justify-center';
    icon.innerHTML = `<svg viewBox="0 0 36 36" class="w-9 h-9 drop-shadow-[0_3px_10px_rgba(0,0,0,0.9)]"><path d="M18 2 L21.5 13 L33 19 L33 22.5 L21.5 19.5 L21 28 L25.5 31.5 L25.5 34 L18 32 L10.5 34 L10.5 31.5 L15 28 L14.5 19.5 L3 22.5 L3 19 L14.5 13 Z" fill="#F8FAFC" stroke="#0B1018" stroke-width="1.8" stroke-linejoin="round" /></svg>`;
    wrapper.appendChild(icon);
    planeIconRef.current = icon;

    planeMarkerRef.current = new MapLibreMarker({
      element: wrapper,
      anchor: 'center',
    })
      .setLngLat([
        liveRef.current.activeWaypoint.lng,
        liveRef.current.activeWaypoint.lat,
      ])
      .addTo(map);

    return () => {
      planeMarkerRef.current?.remove();
      planeMarkerRef.current = null;
      planeIconRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [hasWebGL, webglFailed, vworldApiKey, waypoints]);

  // Smooth camera + plane marker sync
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const offsets = getCameraOffsets(cameraMode, activeWaypoint.altitudeMeters);
    const bearing = (activeWaypoint.headingDeg + offsets.bearingOffset + 360) % 360;

    map.jumpTo({
      center: [activeWaypoint.lng, activeWaypoint.lat],
      zoom: offsets.zoom,
      pitch: offsets.pitch,
      bearing,
    });

    if (planeMarkerRef.current) {
      planeMarkerRef.current.setLngLat([activeWaypoint.lng, activeWaypoint.lat]);
      planeMarkerRef.current.getElement().style.opacity =
        cameraMode === 'chase' ? '1' : '0';
    }
    if (planeIconRef.current) {
      const mapBearing = map.getBearing();
      const rel = (activeWaypoint.headingDeg - mapBearing + 360) % 360;
      planeIconRef.current.style.transform = `rotate(${rel}deg)`;
    }
  }, [activeWaypoint, cameraMode]);

  const showFallback = !hasWebGL || webglFailed;
  const isWindowView = cameraMode === 'window-left' || cameraMode === 'window-right';
  const rollBankStyle =
    cameraMode === 'cockpit' || isWindowView
      ? { transform: `rotate(${(activeWaypoint.rollDeg * 0.35).toFixed(2)}deg) scale(1.04)` }
      : undefined;

  return (
    <div
      data-testid="flight-viewport"
      data-camera-mode={cameraMode}
      data-flight-phase={telemetry.phase}
      data-time-of-day={timeOfDay}
      className="relative w-full h-full overflow-hidden bg-[#060A12] select-none"
    >
      {/* Dynamic Time-of-Day Filter + Roll Container */}
      <div
        className="w-full h-full transition-transform duration-150 ease-out origin-center"
        style={{
          filter: lighting.filter,
          ...rollBankStyle,
        }}
      >
        {showFallback ? (
          <SlippyFlightFallback
            waypoints={waypoints}
            activeWaypoint={activeWaypoint}
            cameraMode={cameraMode}
          />
        ) : (
          <div ref={mapContainerRef} className="w-full h-full" />
        )}
      </div>

      {/* Atmospheric Horizon Tint Overlay */}
      <div
        className="pointer-events-none absolute inset-0 transition-opacity duration-500"
        style={{ background: lighting.tintBg }}
      />
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b ${lighting.skyTop}`}
      />

      {/* Cockpit Subtle Horizon Pitch/Roll Crosshair */}
      {cameraMode === 'cockpit' && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div
            className="w-40 h-20 border-x border-sky-400/25 flex items-center justify-center transition-transform duration-150"
            style={{ transform: `rotate(${(-activeWaypoint.rollDeg).toFixed(1)}deg)` }}
          >
            <div className="w-16 h-px bg-sky-300/45" />
            <div className="w-2.5 h-2.5 rounded-full border border-amber-300/75 mx-2" />
            <div className="w-16 h-px bg-sky-300/45" />
          </div>
        </div>
      )}

      {/* Aircraft Cabin Oval Window Frame for Window Seats */}
      {isWindowView && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center p-4 sm:p-8"
        >
          <div
            className="w-full h-full max-w-5xl rounded-[56px] sm:rounded-[84px] border-[10px] sm:border-[16px] border-[#0A0F18]/85 shadow-[inset_0_0_60px_rgba(0,0,0,0.75)]"
          />
        </div>
      )}
    </div>
  );
};
