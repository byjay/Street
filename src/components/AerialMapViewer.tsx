import React, { Component, useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  AltitudeMode,
  Map as GoogleMap,
  Map3D,
  MapMode,
  Marker3D,
  useMap,
  useMap3D,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import type { LatLngPoint } from '../engine/routeSimulation';
import { haversineMeters } from '../engine/routeSimulation';
import type { ComputedRouteData } from '../types/drive';

interface AerialMapViewerProps {
  routeData: ComputedRouteData | null;
  rawRoute: google.maps.routes.Route | null;
  vehiclePosition: LatLngPoint;
  vehicleHeading: number;
  mode: 'aerial' | 'map';
  interactive: boolean;
  disable3d?: boolean;
  compactZoom?: boolean;
  onJumpToDistance?: (distanceMeters: number) => void;
}

function detectWebGL2(): boolean {
  if (typeof document === 'undefined') return false;
  try {
    const canvas = document.createElement('canvas');
    return Boolean(canvas.getContext('webgl2'));
  } catch {
    return false;
  }
}

class Map3DErrorBoundary extends Component<
  { onError: () => void; children: React.ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };
  static getDerivedStateFromError() {
    return { hasError: true };
  }
  componentDidCatch() {
    this.props.onError();
  }
  render() {
    if (this.state.hasError) return null;
    return this.props.children;
  }
}

const Earth3DRouteLayer: React.FC<{
  routeData: ComputedRouteData | null;
  vehiclePosition: LatLngPoint;
  vehicleHeading: number;
  onFallback: () => void;
}> = ({ routeData, vehiclePosition, vehicleHeading, onFallback }) => {
  const map3d = useMap3D();
  const maps3dLib = useMapsLibrary('maps3d');
  const lastCameraSyncRef = useRef<number>(0);
  const smoothedHeadingRef = useRef<number>(vehicleHeading);

  // Render glowing 3D route polyline in Photorealistic 3D Earth view
  useEffect(() => {
    if (!map3d || !maps3dLib || !routeData || routeData.path.length < 2) {
      return;
    }

    let poly3d: google.maps.maps3d.Polyline3DElement | null = null;
    try {
      const { Polyline3DElement, AltitudeMode: LibAltitudeMode } = maps3dLib;
      poly3d = new Polyline3DElement({
        path: routeData.path.map((pt) => ({
          lat: pt.lat,
          lng: pt.lng,
          altitude: 4,
        })),
        altitudeMode: LibAltitudeMode.RELATIVE_TO_MESH,
        strokeColor: '#38BDF8',
        strokeWidth: 8,
        outerColor: '#0B1018',
        outerWidth: 0.35,
        drawsOccludedSegments: true,
      } as google.maps.maps3d.Polyline3DElementOptions);

      map3d.append(poly3d);
    } catch {
      onFallback();
      return;
    }

    return () => {
      poly3d?.remove();
    };
  }, [map3d, maps3dLib, routeData, onFallback]);

  // Smooth high-cadence chase camera follow with damped turn heading
  useEffect(() => {
    if (!map3d) return;
    const now = performance.now();
    if (now - lastCameraSyncRef.current < 45) return;
    lastCameraSyncRef.current = now;

    let delta = ((vehicleHeading - smoothedHeadingRef.current) % 360 + 540) % 360 - 180;
    if (delta < -180) delta += 360;
    smoothedHeadingRef.current =
      ((smoothedHeadingRef.current + delta * 0.28) % 360 + 360) % 360;

    map3d.center = {
      lat: vehiclePosition.lat,
      lng: vehiclePosition.lng,
      altitude: 12,
    };
    map3d.heading = smoothedHeadingRef.current;
  }, [map3d, vehiclePosition, vehicleHeading]);

  return null;
};

const RouteOverlayLayer2D: React.FC<{
  routeData: ComputedRouteData | null;
  rawRoute: google.maps.routes.Route | null;
  vehiclePosition: LatLngPoint;
  vehicleHeading: number;
  mode: 'aerial' | 'map';
  onJumpToDistance?: (distanceMeters: number) => void;
  onMapHeadingChange?: (headingDeg: number) => void;
}> = ({
  routeData,
  rawRoute,
  vehiclePosition,
  vehicleHeading,
  mode,
  onJumpToDistance,
  onMapHeadingChange,
}) => {
  const map = useMap();
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const lastPanTimeRef = useRef<number>(0);

  useEffect(() => {
    if (!map || !onMapHeadingChange) return;
    onMapHeadingChange(map.getHeading() ?? 0);
    const listener = map.addListener('heading_changed', () => {
      onMapHeadingChange(map.getHeading() ?? 0);
    });
    return () => {
      listener.remove();
    };
  }, [map, onMapHeadingChange]);

  useEffect(() => {
    if (!map) return;

    polylinesRef.current.forEach((p) => p.setMap(null));
    polylinesRef.current = [];

    if (!rawRoute && !routeData) return;

    let polylines: google.maps.Polyline[] = [];
    if (rawRoute) {
      try {
        polylines = rawRoute.createPolylines() ?? [];
      } catch {
        polylines = [];
      }
    }
    if (polylines.length === 0) {
      polylines = [
        new google.maps.Polyline({
          path: routeData?.path ?? [],
          geodesic: true,
        }),
      ];
    }

    polylines.forEach((poly) => {
      poly.setOptions({
        strokeColor: mode === 'aerial' ? '#38BDF8' : '#10B981',
        strokeOpacity: 0.9,
        strokeWeight: mode === 'aerial' ? 7 : 6,
      });
      poly.setMap(map);
    });

    polylinesRef.current = polylines;

    return () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };
  }, [map, rawRoute, routeData, mode]);

  const smoothed2dHeadingRef = useRef<number>(vehicleHeading);

  useEffect(() => {
    if (!map) return;
    const now = performance.now();
    if (now - lastPanTimeRef.current < 48) return;
    lastPanTimeRef.current = now;

    map.panTo(vehiclePosition);
    const isVector =
      typeof google !== 'undefined' &&
      map.getRenderingType?.() === google.maps.RenderingType.VECTOR;
    if (isVector) {
      if (mode === 'aerial') {
        let delta = ((vehicleHeading - smoothed2dHeadingRef.current) % 360 + 540) % 360 - 180;
        if (delta < -180) delta += 360;
        smoothed2dHeadingRef.current =
          ((smoothed2dHeadingRef.current + delta * 0.32) % 360 + 360) % 360;
        map.setHeading(smoothed2dHeadingRef.current);
        map.setTilt(45);
      } else {
        map.setHeading(0);
        map.setTilt(0);
      }
    }
  }, [map, vehiclePosition, vehicleHeading, mode]);

  useEffect(() => {
    if (!map || !routeData || !onJumpToDistance) return;

    const clickListener = map.addListener(
      'click',
      (e: google.maps.MapMouseEvent) => {
        if (!e.latLng) return;
        const clickPt = { lat: e.latLng.lat(), lng: e.latLng.lng() };
        let bestIdx = 0;
        let bestDist = Infinity;

        for (let i = 0; i < routeData.path.length; i += 1) {
          const d = haversineMeters(clickPt, routeData.path[i]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }

        if (bestDist < 400 && routeData.cumDistances[bestIdx] !== undefined) {
          onJumpToDistance(routeData.cumDistances[bestIdx]);
        }
      }
    );

    return () => {
      clickListener.remove();
    };
  }, [map, routeData, onJumpToDistance]);

  return null;
};

export const AerialMapViewer: React.FC<AerialMapViewerProps> = ({
  routeData,
  rawRoute,
  vehiclePosition,
  vehicleHeading,
  mode,
  interactive,
  disable3d = false,
  compactZoom = false,
  onJumpToDistance,
}) => {
  const hasWebGL2 = useMemo(() => detectWebGL2(), []);
  const [map3dFailed, setMap3dFailed] = useState(false);
  const [mapHeading, setMapHeading] = useState(0);

  const relativeArrowRotation = (vehicleHeading - mapHeading + 360) % 360;

  const usePhotorealistic3D =
    mode === 'aerial' && interactive && hasWebGL2 && !map3dFailed && !disable3d;

  return (
    <div
      data-testid={mode === 'aerial' ? 'aerial-map-canvas' : 'vector-map-canvas'}
      className="relative w-full h-full bg-[#0A0D12]"
    >
      {usePhotorealistic3D ? (
        <Map3DErrorBoundary onError={() => setMap3dFailed(true)}>
          <Map3D
            mode={MapMode.HYBRID}
            internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
            defaultCenter={{
              lat: vehiclePosition.lat,
              lng: vehiclePosition.lng,
              altitude: 12,
            }}
            defaultRange={compactZoom ? 280 : 340}
            defaultHeading={vehicleHeading}
            defaultTilt={60}
            onError={() => setMap3dFailed(true)}
            style={{ width: '100%', height: '100%' }}
          >
            <Earth3DRouteLayer
              routeData={routeData}
              vehiclePosition={vehiclePosition}
              vehicleHeading={vehicleHeading}
              onFallback={() => setMap3dFailed(true)}
            />
            {routeData && (
              <>
                <Marker3D
                  position={{
                    lat: routeData.origin.location.lat,
                    lng: routeData.origin.location.lng,
                    altitude: 8,
                  }}
                  altitudeMode={AltitudeMode.RELATIVE_TO_MESH}
                  label={`출발: ${routeData.origin.name}`}
                />
                <Marker3D
                  position={{
                    lat: routeData.destination.location.lat,
                    lng: routeData.destination.location.lng,
                    altitude: 12,
                  }}
                  altitudeMode={AltitudeMode.RELATIVE_TO_MESH}
                  label={`도착: ${routeData.destination.name}`}
                />
              </>
            )}
            <Marker3D
              position={{
                lat: vehiclePosition.lat,
                lng: vehiclePosition.lng,
                altitude: 10,
              }}
              altitudeMode={AltitudeMode.RELATIVE_TO_MESH}
              label="내 차량"
            />
          </Map3D>
        </Map3DErrorBoundary>
      ) : (
        <GoogleMap
          mapId="DEMO_MAP_ID"
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          defaultCenter={vehiclePosition}
          defaultZoom={mode === 'aerial' ? (compactZoom ? 17 : 18) : 16}
          mapTypeId={mode === 'aerial' ? 'hybrid' : 'roadmap'}
          disableDefaultUI={true}
          gestureHandling={interactive ? 'greedy' : 'none'}
          style={{ width: '100%', height: '100%' }}
        >
          <RouteOverlayLayer2D
            routeData={routeData}
            rawRoute={rawRoute}
            vehiclePosition={vehiclePosition}
            vehicleHeading={vehicleHeading}
            mode={mode}
            onJumpToDistance={onJumpToDistance}
            onMapHeadingChange={setMapHeading}
          />

          {routeData && (
            <>
              <AdvancedMarker
                position={routeData.origin.location}
                title={`출발: ${routeData.origin.name}`}
              >
                <div className="w-4 h-4 translate-y-1/2 rounded-full bg-emerald-400 border-2 border-slate-950 shadow-lg" />
              </AdvancedMarker>

              <AdvancedMarker
                position={routeData.destination.location}
                title={`도착: ${routeData.destination.name}`}
              >
                <div className="px-2 py-0.5 rounded-md bg-amber-400 text-slate-950 text-[11px] font-bold shadow-lg border border-amber-200 whitespace-nowrap">
                  도착
                </div>
              </AdvancedMarker>
            </>
          )}

          {/* Live Taxi Vehicle Marker (translate-y-1/2 centers marker over AdvancedMarker's bottom-center anchor) */}
          <AdvancedMarker position={vehiclePosition} title="내 차량 위치">
            <div className="w-8 h-8 translate-y-1/2 flex items-center justify-center pointer-events-none">
              <div
                style={{
                  transform: `rotate(${relativeArrowRotation}deg)`,
                }}
                className="w-8 h-8 flex items-center justify-center transition-transform duration-150"
              >
                <svg
                  viewBox="0 0 32 32"
                  className="w-7 h-7 drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)]"
                  aria-hidden="true"
                >
                  <polygon
                    points="16,2 27,27 16,21 5,27"
                    fill="#F59E0B"
                    stroke="#0B1018"
                    strokeWidth="2.5"
                    strokeLinejoin="round"
                  />
                </svg>
              </div>
            </div>
          </AdvancedMarker>
        </GoogleMap>
      )}
    </div>
  );
};
