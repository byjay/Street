import React, { useEffect, useMemo, useRef, useState } from 'react';
import maplibreWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import {
  Map as MapLibreMap,
  Marker as MapLibreMarker,
  setWorkerUrl,
  type GeoJSONSourceSpecification,
  type MapMouseEvent,
  type StyleSpecification,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import {
  Box,
  Camera,
  Compass,
  Eye,
  Lock,
  Navigation,
} from 'lucide-react';
import {
  haversineMeters,
  type LatLngPoint,
} from '../engine/routeSimulation';
import {
  computeCameraShakeOffset,
  computeDynamicCameraPose,
  computeRelativeHeadingOffset,
  resolveTargetCameraHeading,
} from '../engine/streetViewMotion';
import type {
  CameraFollowMode,
  ComputedRouteData,
  MapProviderMode,
  TravelModeOption,
} from '../types/drive';
import {
  fetchFreeStreetPhoto,
  type FreeStreetPhotoResult,
} from '../utils/freeMapsHelpers';

setWorkerUrl(maplibreWorkerUrl);

export type FreeViewerMode = 'chase3d' | 'aerial' | 'map';

interface FreeMapViewerProps {
  routeData: ComputedRouteData | null;
  vehiclePosition: LatLngPoint;
  vehicleHeading: number;
  mode: FreeViewerMode;
  interactive: boolean;
  isMainView?: boolean;
  isMoving?: boolean;
  speedKmh?: number;
  isCornering?: boolean;
  cornerAngleDeg?: number;
  compactZoom?: boolean;
  cameraFollowMode?: CameraFollowMode;
  onChangeCameraMode?: (mode: CameraFollowMode) => void;
  onJumpToDistance?: (distanceMeters: number) => void;
  kakaoMapKey?: string;
  providerMode?: MapProviderMode;
  vworldApiKey?: string;
  preferStreetPhoto?: boolean;
  onToggleStreetPhoto?: (next: boolean) => void;
  travelMode?: TravelModeOption;
  walkBobbingEnabled?: boolean;
  hasGoogleKey?: boolean;
  onSwitchToGoogleStreetView?: () => void;
}

const CAMERA_MODE_LABEL: Record<CameraFollowMode, string> = {
  forward: '진행방향',
  relative: '창밖시선 유지',
  free: '현재뷰 고정',
};

function buildAerialStyle(vworldApiKey: string, useVworld: boolean): StyleSpecification {
  if (useVworld && vworldApiKey) {
    return {
      version: 8,
      sources: {
        'vworld-sat': {
          type: 'raster',
          tiles: [
            `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(vworldApiKey)}/Satellite/{z}/{y}/{x}.jpeg`,
          ],
          tileSize: 256,
          maxzoom: 19,
          attribution: 'VWorld Satellite',
        },
        'vworld-hybrid': {
          type: 'raster',
          tiles: [
            `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(vworldApiKey)}/Hybrid/{z}/{y}/{x}.png`,
          ],
          tileSize: 256,
          maxzoom: 19,
        },
      },
      layers: [
        {
          id: 'vworld-sat-layer',
          type: 'raster',
          source: 'vworld-sat',
          minzoom: 0,
          maxzoom: 22,
        },
        {
          id: 'vworld-hybrid-layer',
          type: 'raster',
          source: 'vworld-hybrid',
          minzoom: 6,
          maxzoom: 20,
        },
      ],
    };
  }

  return {
    version: 8,
    sources: {
      esri: {
        type: 'raster',
        tiles: [
          'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
        ],
        tileSize: 256,
        maxzoom: 19,
        attribution: 'Esri World Imagery',
      },
    },
    layers: [
      {
        id: 'esri-world-imagery',
        type: 'raster',
        source: 'esri',
        minzoom: 0,
        maxzoom: 22,
      },
    ],
  };
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

function latLngToWorldPx(pt: LatLngPoint, zoom: number): { x: number; y: number } {
  const worldSize = 256 * Math.pow(2, zoom);
  const x = ((pt.lng + 180) / 360) * worldSize;
  const clampedLat = Math.max(-85.0511, Math.min(85.0511, pt.lat));
  const sinLat = Math.sin((clampedLat * Math.PI) / 180);
  const y =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * worldSize;
  return { x, y };
}

interface SlippyFallbackProps {
  routeData: ComputedRouteData | null;
  vehiclePosition: LatLngPoint;
  vehicleHeading: number;
  cameraHeading: number;
  mode: FreeViewerMode;
  compactZoom?: boolean;
  vworldApiKey?: string;
  useVworld?: boolean;
  onJumpToDistance?: (distanceMeters: number) => void;
}

const SlippyFreeMapFallback: React.FC<SlippyFallbackProps> = ({
  routeData,
  vehiclePosition,
  vehicleHeading,
  cameraHeading,
  mode,
  compactZoom = false,
  vworldApiKey = '',
  useVworld = false,
  onJumpToDistance,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 640, height: 480 });

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

  const zoom =
    mode === 'chase3d' ? 18 : mode === 'aerial' ? (compactZoom ? 16 : 17) : 16;
  const centerPx = useMemo(
    () => latLngToWorldPx(vehiclePosition, zoom),
    [vehiclePosition, zoom]
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

      const left = size.width / 2 + (centerTileX + dx) * 256 - centerPx.x;
      const top = size.height / 2 + ty * 256 - centerPx.y;
      const url =
        mode === 'map'
          ? `https://tile.openstreetmap.org/${zoom}/${tx}/${ty}.png`
          : mode === 'aerial' && useVworld && vworldApiKey
            ? `https://api.vworld.kr/req/wmts/1.0.0/${encodeURIComponent(vworldApiKey)}/Satellite/${zoom}/${ty}/${tx}.jpeg`
            : `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${zoom}/${ty}/${tx}`;

      tiles.push({
        key: `${zoom}-${tx}-${ty}-${dx}-${dy}`,
        url,
        left,
        top,
      });
    }
  }

  const polylinePoints = useMemo(() => {
    if (!routeData || routeData.path.length < 2) return '';
    return routeData.path
      .map((pt) => {
        const p = latLngToWorldPx(pt, zoom);
        const sx = size.width / 2 + (p.x - centerPx.x);
        const sy = size.height / 2 + (p.y - centerPx.y);
        return `${sx.toFixed(1)},${sy.toFixed(1)}`;
      })
      .join(' ');
  }, [routeData, zoom, size.width, size.height, centerPx.x, centerPx.y]);

  const rotationDeg = mode === 'map' ? 0 : -cameraHeading;
  const arrowRot = (vehicleHeading + rotationDeg + 360) % 360;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#0A0D12] select-none"
      onClick={(e) => {
        if (!routeData || !onJumpToDistance || !containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const dx = e.clientX - rect.left - rect.width / 2;
        const dy = e.clientY - rect.top - rect.height / 2;
        const rad = (-rotationDeg * Math.PI) / 180;
        const rx = dx * Math.cos(rad) - dy * Math.sin(rad);
        const ry = dx * Math.sin(rad) + dy * Math.cos(rad);
        const worldSize = 256 * Math.pow(2, zoom);
        const targetX = centerPx.x + rx;
        const targetY = centerPx.y + ry;
        const lng = (targetX / worldSize) * 360 - 180;
        const n = Math.PI - (2 * Math.PI * targetY) / worldSize;
        const lat =
          (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));
        let bestIdx = 0;
        let bestDist = Infinity;
        for (let i = 0; i < routeData.path.length; i += 1) {
          const d = haversineMeters({ lat, lng }, routeData.path[i]);
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        if (bestDist < 400 && routeData.cumDistances[bestIdx] !== undefined) {
          onJumpToDistance(routeData.cumDistances[bestIdx]);
        }
      }}
    >
      <div
        className="absolute inset-0 transition-transform duration-150 ease-out"
        style={{
          transform:
            mode === 'chase3d'
              ? `perspective(700px) rotateX(34deg) scale(1.38) rotate(${rotationDeg}deg)`
              : mode === 'aerial'
                ? `scale(1.16) rotate(${rotationDeg}deg)`
                : undefined,
        }}
      >
        {tiles.map((tile) => (
          <img
            key={tile.key}
            src={tile.url}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            className="absolute w-[256px] h-[256px] max-w-none pointer-events-none"
            style={{ left: tile.left, top: tile.top }}
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
              stroke="#0B1018"
              strokeWidth={9}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeOpacity={0.75}
            />
            <polyline
              points={polylinePoints}
              fill="none"
              stroke={mode === 'map' ? '#10B981' : '#38BDF8'}
              strokeWidth={5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        )}
      </div>

      {/* Centered Vehicle Directional Arrow */}
      <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
        <div
          style={{ transform: `rotate(${arrowRot}deg)` }}
          className="w-8 h-8 flex items-center justify-center transition-transform duration-150"
        >
          <svg
            viewBox="0 0 32 32"
            className="w-7 h-7 drop-shadow-[0_2px_6px_rgba(0,0,0,0.9)]"
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
    </div>
  );
};

interface KakaoRoadviewInstance {
  setPanoId: (panoId: number, position: unknown) => void;
  setViewpoint: (vp: { pan: number; tilt: number; zoom: number }) => void;
  getViewpoint: () => { pan: number; tilt: number; zoom: number };
}

interface KakaoRoadviewClientInstance {
  getNearestPanoId: (
    position: unknown,
    radius: number,
    cb: (panoId: number | null) => void
  ) => void;
}

interface KakaoRoadviewApi {
  maps: {
    load: (cb: () => void) => void;
    LatLng: new (lat: number, lng: number) => unknown;
    Roadview: new (container: HTMLElement) => KakaoRoadviewInstance;
    RoadviewClient: new () => KakaoRoadviewClientInstance;
    event: {
      addListener: (target: unknown, type: string, cb: () => void) => void;
    };
  };
}

function isInsideKorea(pt: LatLngPoint): boolean {
  return pt.lat >= 33.0 && pt.lat <= 38.9 && pt.lng >= 124.5 && pt.lng <= 132.0;
}

export const FreeMapViewer: React.FC<FreeMapViewerProps> = ({
  routeData,
  vehiclePosition,
  vehicleHeading,
  mode,
  interactive,
  isMainView = false,
  isMoving = false,
  speedKmh = 24,
  isCornering = false,
  cornerAngleDeg = 0,
  compactZoom = false,
  cameraFollowMode = 'forward',
  onChangeCameraMode,
  onJumpToDistance,
  kakaoMapKey = '',
  providerMode = 'free-kr',
  vworldApiKey = '',
  preferStreetPhoto = true,
  onToggleStreetPhoto,
  travelMode = 'DRIVING',
  walkBobbingEnabled = true,
  hasGoogleKey = false,
  onSwitchToGoogleStreetView,
}) => {
  const hasWebGL = useMemo(() => detectWebGLSupport(), []);
  const [webglFailed, setWebglFailed] = useState(false);

  const useKakaoRoadview =
    mode === 'chase3d' &&
    isMainView &&
    preferStreetPhoto &&
    Boolean(kakaoMapKey) &&
    isInsideKorea(vehiclePosition);

  const [kakaoReady, setKakaoReady] = useState(false);
  const [kakaoUnavailable, setKakaoUnavailable] = useState(false);

  // Real street-level photo stream state (Mapillary / KartaView / Wikimedia fallback)
  const [activePhoto, setActivePhoto] = useState<FreeStreetPhotoResult | null>(null);
  const [prevPhotoUrl, setPrevPhotoUrl] = useState<string | null>(null);
  const [photoStatus, setPhotoStatus] = useState<'idle' | 'loading' | 'ready' | 'none'>('idle');
  const [photoPan, setPhotoPan] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const photoDragOriginRef = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const lastPhotoQueryRef = useRef<{
    lat: number;
    lng: number;
    heading: number;
    at: number;
  } | null>(null);

  const viewportShakeRef = useRef<HTMLDivElement>(null);
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const kakaoContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const vehicleMarkerRef = useRef<MapLibreMarker | null>(null);
  const vehicleArrowElRef = useRef<HTMLDivElement | null>(null);

  const currentHeadingRef = useRef<number>(vehicleHeading);
  const currentPitchRef = useRef<number>(
    mode === 'chase3d' ? 72 : mode === 'aerial' ? 45 : 0
  );
  const userRelativeOffsetRef = useRef<number>(0);
  const userFreeHeadingRef = useRef<number>(vehicleHeading);
  const userDraggingRef = useRef<boolean>(false);
  const shakeOriginTimeRef = useRef<number>(performance.now());
  const prevSpeedKmhRef = useRef<number>(speedKmh);
  const prevCameraModeRef = useRef<CameraFollowMode>(cameraFollowMode);
  const onChangeCameraModeRef = useRef(onChangeCameraMode);
  const [fallbackHeading, setFallbackHeading] = useState<number>(vehicleHeading);

  useEffect(() => {
    onChangeCameraModeRef.current = onChangeCameraMode;
  }, [onChangeCameraMode]);

  const liveRef = useRef({
    vehiclePosition,
    vehicleHeading,
    cameraFollowMode,
    isMoving,
    speedKmh,
    isCornering,
    cornerAngleDeg,
    mode,
    compactZoom,
    travelMode,
    walkBobbingEnabled,
  });

  useEffect(() => {
    liveRef.current = {
      vehiclePosition,
      vehicleHeading,
      cameraFollowMode,
      isMoving,
      speedKmh,
      isCornering,
      cornerAngleDeg,
      mode,
      compactZoom,
      travelMode,
      walkBobbingEnabled,
    };
  }, [
    vehiclePosition,
    vehicleHeading,
    cameraFollowMode,
    isMoving,
    speedKmh,
    isCornering,
    cornerAngleDeg,
    mode,
    compactZoom,
    travelMode,
    walkBobbingEnabled,
  ]);

  // Fetch free street-level photos (Mapillary / KartaView / Wikimedia) when preferStreetPhoto is enabled
  const shouldUseStreetPhotoStream =
    mode === 'chase3d' &&
    preferStreetPhoto &&
    !(useKakaoRoadview && kakaoReady && !kakaoUnavailable);

  const streetPhotoActiveRef = useRef(shouldUseStreetPhotoStream);
  const photoFetchInFlightRef = useRef(false);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    streetPhotoActiveRef.current = shouldUseStreetPhotoStream;
  }, [shouldUseStreetPhotoStream]);

  useEffect(() => {
    if (!shouldUseStreetPhotoStream) {
      return;
    }
    if (photoFetchInFlightRef.current) {
      return;
    }

    const now = Date.now();
    const last = lastPhotoQueryRef.current;
    if (last) {
      const dist = haversineMeters(last, vehiclePosition);
      const hDiff = Math.abs((((vehicleHeading - last.heading) % 360) + 540) % 360 - 180);
      if (dist < 22 && hDiff < 38 && now - last.at < 8000) {
        return;
      }
      if (now - last.at < 1200) {
        return;
      }
    }

    lastPhotoQueryRef.current = {
      lat: vehiclePosition.lat,
      lng: vehiclePosition.lng,
      heading: vehicleHeading,
      at: now,
    };
    photoFetchInFlightRef.current = true;
    setPhotoStatus((prev) => (prev === 'ready' ? 'ready' : 'loading'));

    void fetchFreeStreetPhoto(
      vehiclePosition.lat,
      vehiclePosition.lng,
      vehicleHeading
    )
      .then((photo) => {
        if (!mountedRef.current || !streetPhotoActiveRef.current) return;
        if (!photo?.imageUrl) {
          setPhotoStatus((prev) => (prev === 'ready' ? 'ready' : 'none'));
          return;
        }

        const img = new Image();
        img.referrerPolicy = 'no-referrer';
        img.onload = () => {
          if (!mountedRef.current || !streetPhotoActiveRef.current) return;
          setActivePhoto((curr) => {
            if (curr && curr.imageUrl !== photo.imageUrl) {
              setPrevPhotoUrl(curr.imageUrl);
            }
            return photo;
          });
          setPhotoPan({ x: 0, y: 0 });
          setPhotoStatus('ready');
        };
        img.onerror = () => {
          if (!mountedRef.current || !streetPhotoActiveRef.current) return;
          setPhotoStatus((prev) => (prev === 'ready' ? 'ready' : 'none'));
        };
        img.src = photo.imageUrl;
      })
      .finally(() => {
        photoFetchInFlightRef.current = false;
      });
  }, [shouldUseStreetPhotoStream, vehiclePosition, vehicleHeading]);

  // Sync camera mode UI switches
  useEffect(() => {
    const prev = prevCameraModeRef.current;
    prevCameraModeRef.current = cameraFollowMode;
    if (prev === cameraFollowMode) return;

    if (cameraFollowMode === 'forward') {
      userRelativeOffsetRef.current = 0;
      currentHeadingRef.current = vehicleHeading;
      setPhotoPan({ x: 0, y: 0 });
      if (mode === 'chase3d') {
        currentPitchRef.current = 72;
      }
    } else if (cameraFollowMode === 'relative') {
      userRelativeOffsetRef.current = computeRelativeHeadingOffset(
        vehicleHeading,
        currentHeadingRef.current
      );
    } else if (cameraFollowMode === 'free') {
      userFreeHeadingRef.current = currentHeadingRef.current;
    }
  }, [cameraFollowMode, vehicleHeading, mode]);

  // Optional Kakao Roadview dynamic SDK loader when VITE_KAKAO_MAP_KEY is provided
  useEffect(() => {
    if (!useKakaoRoadview) return;
    const win = window as unknown as { kakao?: KakaoRoadviewApi };
    if (win.kakao?.maps) {
      win.kakao.maps.load(() => setKakaoReady(true));
      return;
    }
    const existing = document.getElementById('kakao-maps-sdk');
    if (existing) return;

    const script = document.createElement('script');
    script.id = 'kakao-maps-sdk';
    script.async = true;
    script.src = `//dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(kakaoMapKey)}&autoload=false`;
    script.onload = () => {
      win.kakao?.maps?.load(() => setKakaoReady(true));
    };
    script.onerror = () => setKakaoUnavailable(true);
    document.head.appendChild(script);
  }, [useKakaoRoadview, kakaoMapKey]);

  const kakaoRvRef = useRef<KakaoRoadviewInstance | null>(null);
  const kakaoClientRef = useRef<KakaoRoadviewClientInstance | null>(null);
  const lastKakaoPosRef = useRef<LatLngPoint | null>(null);

  useEffect(() => {
    if (!useKakaoRoadview || !kakaoReady || !kakaoContainerRef.current) return;
    if (kakaoRvRef.current) return;

    const kakao = (window as unknown as { kakao: KakaoRoadviewApi }).kakao;
    const rv = new kakao.maps.Roadview(kakaoContainerRef.current);
    const client = new kakao.maps.RoadviewClient();
    kakaoRvRef.current = rv;
    kakaoClientRef.current = client;

    kakao.maps.event.addListener(rv, 'viewpoint_changed', () => {
      if (!userDraggingRef.current) return;
      const vp = rv.getViewpoint();
      currentHeadingRef.current = vp.pan;
      userFreeHeadingRef.current = vp.pan;
      const rel = computeRelativeHeadingOffset(
        liveRef.current.vehicleHeading,
        vp.pan
      );
      userRelativeOffsetRef.current = rel;
      if (liveRef.current.cameraFollowMode === 'forward' && Math.abs(rel) >= 7) {
        onChangeCameraModeRef.current?.('relative');
      }
    });
  }, [useKakaoRoadview, kakaoReady]);

  useEffect(() => {
    if (
      !useKakaoRoadview ||
      !kakaoReady ||
      !kakaoRvRef.current ||
      !kakaoClientRef.current
    ) {
      return;
    }
    const last = lastKakaoPosRef.current;
    if (last && haversineMeters(last, vehiclePosition) < 12) return;
    lastKakaoPosRef.current = vehiclePosition;

    const kakao = (window as unknown as { kakao: KakaoRoadviewApi }).kakao;
    const pos = new kakao.maps.LatLng(vehiclePosition.lat, vehiclePosition.lng);
    kakaoClientRef.current.getNearestPanoId(pos, 60, (panoId: number | null) => {
      if (!panoId) {
        setKakaoUnavailable(true);
        return;
      }
      setKakaoUnavailable(false);
      const desired = resolveTargetCameraHeading(
        liveRef.current.cameraFollowMode,
        liveRef.current.vehicleHeading,
        userRelativeOffsetRef.current,
        userFreeHeadingRef.current
      );
      kakaoRvRef.current?.setPanoId(panoId, pos);
      kakaoRvRef.current?.setViewpoint({ pan: desired, tilt: 2, zoom: 0 });
    });
  }, [useKakaoRoadview, kakaoReady, vehiclePosition]);

  const useVworldAerial =
    mode === 'aerial' &&
    providerMode === 'free-kr' &&
    Boolean(vworldApiKey) &&
    isInsideKorea(vehiclePosition);

  // Initialize MapLibre GL instance when WebGL is available
  useEffect(() => {
    if (!hasWebGL || webglFailed || !mapContainerRef.current) return;
    if (useKakaoRoadview && kakaoReady && !kakaoUnavailable) return;

    const styleOrUrl =
      mode === 'aerial'
        ? buildAerialStyle(vworldApiKey, useVworldAerial)
        : 'https://tiles.openfreemap.org/styles/liberty';

    let map: MapLibreMap;
    try {
      map = new MapLibreMap({
        container: mapContainerRef.current,
        style: styleOrUrl,
        center: [vehiclePosition.lng, vehiclePosition.lat],
        zoom:
          mode === 'chase3d'
            ? 18.4
            : mode === 'aerial'
              ? compactZoom
                ? 16.6
                : 17.4
              : 15.8,
        pitch: mode === 'chase3d' ? 72 : mode === 'aerial' ? 45 : 0,
        bearing: mode === 'map' ? 0 : vehicleHeading,
        interactive,
        attributionControl: false,
      });
    } catch {
      setWebglFailed(true);
      return;
    }

    mapRef.current = map;

    const onDragStart = () => {
      userDraggingRef.current = true;
    };
    const onDragEnd = () => {
      userDraggingRef.current = false;
      const b = ((map.getBearing() % 360) + 360) % 360;
      currentHeadingRef.current = b;
      userFreeHeadingRef.current = b;
      const rel = computeRelativeHeadingOffset(liveRef.current.vehicleHeading, b);
      userRelativeOffsetRef.current = rel;
      if (
        liveRef.current.mode === 'chase3d' &&
        liveRef.current.cameraFollowMode === 'forward' &&
        Math.abs(rel) >= 7
      ) {
        onChangeCameraModeRef.current?.('relative');
      }
    };

    map.on('dragstart', onDragStart);
    map.on('rotatestart', onDragStart);
    map.on('dragend', onDragEnd);
    map.on('rotateend', onDragEnd);
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

    const addRouteLayers = () => {
      const route = routeData;
      if (!route || route.path.length < 2) return;

      const geojson: GeoJSONSourceSpecification['data'] = {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'LineString',
          coordinates: route.path.map((p) => [p.lng, p.lat]),
        },
      };

      if (!map.getSource('drive-route')) {
        map.addSource('drive-route', { type: 'geojson', data: geojson });
        map.addLayer({
          id: 'drive-route-casing',
          type: 'line',
          source: 'drive-route',
          paint: {
            'line-color': '#0B1018',
            'line-width': mode === 'chase3d' ? 11 : 9,
            'line-opacity': 0.85,
          },
        });
        map.addLayer({
          id: 'drive-route-line',
          type: 'line',
          source: 'drive-route',
          paint: {
            'line-color': mode === 'map' ? '#10B981' : '#38BDF8',
            'line-width': mode === 'chase3d' ? 6 : 5,
            'line-opacity': 0.95,
          },
        });
      }

      if (
        mode === 'chase3d' &&
        map.getSource('openmaptiles') &&
        !map.getLayer('rw-3d-buildings')
      ) {
        try {
          map.addLayer({
            id: 'rw-3d-buildings',
            source: 'openmaptiles',
            'source-layer': 'building',
            type: 'fill-extrusion',
            minzoom: 14,
            paint: {
              'fill-extrusion-color': '#CBD5E1',
              'fill-extrusion-height': ['coalesce', ['get', 'render_height'], 14],
              'fill-extrusion-base': ['coalesce', ['get', 'render_min_height'], 0],
              'fill-extrusion-opacity': 0.72,
            },
          });
        } catch {
          // Optional enhancement
        }
      }
    };

    map.on('load', addRouteLayers);

    if (mode !== 'chase3d') {
      const wrapper = document.createElement('div');
      wrapper.className = 'w-8 h-8 flex items-center justify-center pointer-events-none';
      const arrow = document.createElement('div');
      arrow.className = 'w-8 h-8 flex items-center justify-center';
      arrow.innerHTML = `<svg viewBox="0 0 32 32" class="w-7 h-7 drop-shadow-[0_2px_6px_rgba(0,0,0,0.85)]"><polygon points="16,2 27,27 16,21 5,27" fill="#F59E0B" stroke="#0B1018" stroke-width="2.5" stroke-linejoin="round" /></svg>`;
      wrapper.appendChild(arrow);
      vehicleArrowElRef.current = arrow;

      vehicleMarkerRef.current = new MapLibreMarker({
        element: wrapper,
        anchor: 'center',
      })
        .setLngLat([vehiclePosition.lng, vehiclePosition.lat])
        .addTo(map);
    }

    if (onJumpToDistance && routeData) {
      map.on('click', (e: MapMouseEvent) => {
        const clickPt = { lat: e.lngLat.lat, lng: e.lngLat.lng };
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
      });
    }

    return () => {
      vehicleMarkerRef.current?.remove();
      vehicleMarkerRef.current = null;
      vehicleArrowElRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [
    hasWebGL,
    webglFailed,
    mode,
    interactive,
    compactZoom,
    routeData,
    useKakaoRoadview,
    kakaoReady,
    kakaoUnavailable,
    vworldApiKey,
    useVworldAerial,
  ]);

  // Continuous 60Hz smooth camera tracking + micro camera shake + walk bobbing
  useEffect(() => {
    let rafId = 0;
    let lastTick = performance.now();

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const tick = (now: number) => {
      const dt = Math.max(0.008, Math.min(0.08, (now - lastTick) / 1000));
      lastTick = now;
      const live = liveRef.current;

      if (viewportShakeRef.current) {
        if (live.mode === 'chase3d' && isMainView && live.isMoving && !reducedMotion) {
          const elapsedSec = (now - shakeOriginTimeRef.current) / 1000;
          const shake = computeCameraShakeOffset({
            elapsedSec,
            msSinceTransition: 9999,
            speedKmh: live.speedKmh,
            isMoving: live.isMoving,
            isCornering: live.isCornering,
            userDragging: userDraggingRef.current,
          });
          const walkBobY =
            live.travelMode === 'WALKING' && live.walkBobbingEnabled
              ? Math.sin(elapsedSec * 9.5) * 2.2
              : 0;
          viewportShakeRef.current.style.transform = `translate3d(${shake.xPx}px, ${(shake.yPx + walkBobY).toFixed(2)}px, 0) rotate(${shake.rotateDeg}deg) scale(${shake.scale})`;
        } else {
          viewportShakeRef.current.style.transform =
            'translate3d(0px, 0px, 0) rotate(0deg) scale(1)';
        }
      }

      const desiredHeading =
        live.mode === 'map'
          ? 0
          : live.mode === 'aerial'
            ? live.vehicleHeading
            : resolveTargetCameraHeading(
                live.cameraFollowMode,
                live.vehicleHeading,
                userRelativeOffsetRef.current,
                userFreeHeadingRef.current
              );

      if (
        !userDraggingRef.current &&
        (live.cameraFollowMode !== 'free' || live.mode !== 'chase3d')
      ) {
        const pose = computeDynamicCameraPose({
          currentHeading: currentHeadingRef.current,
          targetHeading: desiredHeading,
          currentPitch: currentPitchRef.current,
          targetPitch:
            live.mode === 'chase3d' ? 72 : live.mode === 'aerial' ? 45 : 0,
          speedKmh: live.speedKmh,
          prevSpeedKmh: prevSpeedKmhRef.current,
          cornerAngleDeg: live.cornerAngleDeg,
          dtSeconds: dt,
        });
        prevSpeedKmhRef.current = live.speedKmh;
        currentHeadingRef.current = pose.heading;
      }

      const map = mapRef.current;
      if (map) {
        if (!userDraggingRef.current) {
          map.jumpTo({
            center: [live.vehiclePosition.lng, live.vehiclePosition.lat],
            bearing: live.mode === 'map' ? 0 : currentHeadingRef.current,
          });
        }
        if (vehicleMarkerRef.current) {
          vehicleMarkerRef.current.setLngLat([
            live.vehiclePosition.lng,
            live.vehiclePosition.lat,
          ]);
        }
        if (vehicleArrowElRef.current) {
          const mapBearing = map.getBearing();
          const relRot = (live.vehicleHeading - mapBearing + 360) % 360;
          vehicleArrowElRef.current.style.transform = `rotate(${relRot}deg)`;
        }
      } else {
        setFallbackHeading(currentHeadingRef.current);
      }

      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
    };
  }, [isMainView]);

  const cycleNextCameraMode = () => {
    if (!onChangeCameraMode) return;
    if (cameraFollowMode === 'forward') {
      userRelativeOffsetRef.current = computeRelativeHeadingOffset(
        vehicleHeading,
        currentHeadingRef.current
      );
      onChangeCameraMode('relative');
    } else if (cameraFollowMode === 'relative') {
      userFreeHeadingRef.current = currentHeadingRef.current;
      onChangeCameraMode('free');
    } else {
      onChangeCameraMode('forward');
    }
  };

  const showFallbackTiles = !hasWebGL || webglFailed;
  const isShowingStreetPhoto =
    shouldUseStreetPhotoStream && Boolean(activePhoto?.imageUrl);
  const photoSourceLabel = activePhoto
    ? activePhoto.provider === 'mapillary'
      ? 'Mapillary 실사'
      : activePhoto.provider === 'kartaview'
        ? 'KartaView 실사'
        : 'Wikimedia 실사'
    : photoStatus === 'loading'
      ? '실사 거리뷰 탐색 중...'
      : '3D 도로뷰';

  return (
    <div
      data-testid={
        mode === 'chase3d'
          ? 'street-view-viewport'
          : mode === 'aerial'
            ? 'aerial-map-canvas'
            : 'vector-map-canvas'
      }
      data-camera-mode={cameraFollowMode}
      data-free-provider={
        useKakaoRoadview && kakaoReady && !kakaoUnavailable
          ? 'kakao'
          : isShowingStreetPhoto
            ? activePhoto?.provider ?? 'streetphoto'
            : 'osm-free'
      }
      data-camera-shake-active={
        mode === 'chase3d' && isMainView && isMoving && speedKmh >= 2
          ? 'true'
          : 'false'
      }
      className="relative w-full h-full overflow-hidden bg-[#0A0D12]"
      onPointerDown={(e) => {
        userDraggingRef.current = true;
        if (isShowingStreetPhoto) {
          photoDragOriginRef.current = {
            x: e.clientX,
            y: e.clientY,
            startX: photoPan.x,
            startY: photoPan.y,
          };
        }
      }}
      onPointerMove={(e) => {
        if (isShowingStreetPhoto && photoDragOriginRef.current) {
          const dx = e.clientX - photoDragOriginRef.current.x;
          const dy = e.clientY - photoDragOriginRef.current.y;
          setPhotoPan({
            x: Math.max(-10, Math.min(10, photoDragOriginRef.current.startX + dx * 0.04)),
            y: Math.max(-6, Math.min(6, photoDragOriginRef.current.startY + dy * 0.03)),
          });
        }
      }}
      onPointerUp={() => {
        userDraggingRef.current = false;
        photoDragOriginRef.current = null;
      }}
      onPointerCancel={() => {
        userDraggingRef.current = false;
        photoDragOriginRef.current = null;
      }}
    >
      <div
        ref={viewportShakeRef}
        className="relative w-full h-full will-change-transform origin-center"
      >
        {useKakaoRoadview && kakaoReady && !kakaoUnavailable ? (
          <div ref={kakaoContainerRef} className="w-full h-full" />
        ) : showFallbackTiles ? (
          <SlippyFreeMapFallback
            routeData={routeData}
            vehiclePosition={vehiclePosition}
            vehicleHeading={vehicleHeading}
            cameraHeading={fallbackHeading}
            mode={mode}
            compactZoom={compactZoom}
            vworldApiKey={vworldApiKey}
            useVworld={useVworldAerial}
            onJumpToDistance={onJumpToDistance}
          />
        ) : (
          <div ref={mapContainerRef} className="w-full h-full" />
        )}

        {/* Real Street-Level Photo Overlay (Mapillary / KartaView / Wikimedia) */}
        {isShowingStreetPhoto && activePhoto && (
          <div
            data-testid="street-photo-layer"
            className="absolute inset-0 z-10 overflow-hidden bg-[#080B10] pointer-events-none"
          >
            {prevPhotoUrl && prevPhotoUrl !== activePhoto.imageUrl && (
              <img
                src={prevPhotoUrl}
                alt=""
                referrerPolicy="no-referrer"
                className="absolute inset-0 w-full h-full object-cover opacity-55 scale-105"
              />
            )}
            <img
              key={activePhoto.imageUrl}
              src={activePhoto.imageUrl}
              alt={activePhoto.caption || '실제 거리 사진'}
              referrerPolicy="no-referrer"
              className="w-full h-full object-cover transition-transform duration-500 ease-out"
              style={{
                transform: `scale(${isMoving ? 1.09 : 1.04}) translate3d(${photoPan.x}%, ${photoPan.y}%, 0)`,
                filter:
                  isMoving && speedKmh > 38
                    ? 'blur(0.45px) contrast(1.04)'
                    : 'contrast(1.03)',
              }}
            />
            <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-[#0A0D12]/65 to-transparent" />
            <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#0A0D12]/75 to-transparent" />
          </div>
        )}
      </div>

      {/* Top-left Context Chip & Street-Photo Switcher in Main Chase View */}
      {mode === 'chase3d' && isMainView && (
        <div className="pointer-events-none absolute top-[64px] md:top-20 left-2.5 md:left-4 z-30 flex flex-wrap items-center gap-1.5">
          <div className="pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-[#0B1018]/88 backdrop-blur-md border border-slate-700/75 text-[11px] md:text-xs text-slate-200 shadow-lg">
            {useKakaoRoadview && kakaoReady && !kakaoUnavailable ? (
              <Eye className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            ) : isShowingStreetPhoto ? (
              <Camera className="w-3.5 h-3.5 text-amber-400 shrink-0" />
            ) : (
              <Box className="w-3.5 h-3.5 text-sky-400 shrink-0" />
            )}
            <span className="truncate max-w-[160px] md:max-w-[240px] font-medium">
              {useKakaoRoadview && kakaoReady && !kakaoUnavailable
                ? '카카오 로드뷰 360°'
                : photoSourceLabel}
            </span>
          </div>

          {onToggleStreetPhoto && !(useKakaoRoadview && kakaoReady && !kakaoUnavailable) && (
            <div
              role="group"
              aria-label="실사 거리뷰 사진 또는 3D 지도 전환"
              className="pointer-events-auto inline-flex items-center p-0.5 rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/75 shadow-lg"
            >
              <button
                type="button"
                data-testid="toggle-street-photo-btn"
                onClick={() => onToggleStreetPhoto(true)}
                className={`min-h-[30px] px-2 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                  preferStreetPhoto
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Camera className="w-3 h-3" />
                <span>실사 사진</span>
              </button>
              <button
                type="button"
                data-testid="toggle-3d-map-btn"
                onClick={() => onToggleStreetPhoto(false)}
                className={`min-h-[30px] px-2 rounded-lg text-[11px] font-semibold flex items-center gap-1 transition-colors ${
                  !preferStreetPhoto
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Box className="w-3 h-3" />
                <span>3D 지도</span>
              </button>
            </div>
          )}

          {hasGoogleKey && onSwitchToGoogleStreetView && (
            <button
              type="button"
              onClick={onSwitchToGoogleStreetView}
              className="pointer-events-auto min-h-[32px] px-2.5 rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-amber-400/50 hover:border-amber-300 text-[11px] font-bold text-amber-300 flex items-center gap-1 shadow-lg transition-colors"
            >
              <Eye className="w-3.5 h-3.5" />
              <span>Google 360°</span>
            </button>
          )}

          {onChangeCameraMode && (
            <button
              type="button"
              data-testid="camera-mode-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                cycleNextCameraMode();
              }}
              aria-label={`시선 모드: ${CAMERA_MODE_LABEL[cameraFollowMode]}`}
              className={`hidden md:flex pointer-events-auto min-h-[32px] px-2.5 py-1 rounded-xl border text-xs font-semibold items-center gap-1.5 whitespace-nowrap shrink-0 shadow-lg transition-colors ${
                cameraFollowMode === 'forward'
                  ? 'bg-[#0B1018]/90 border-amber-400/80 text-amber-300 hover:bg-[#111927]'
                  : cameraFollowMode === 'relative'
                    ? 'bg-[#0B1018]/90 border-emerald-400/80 text-emerald-300 hover:bg-[#111927]'
                    : 'bg-[#0B1018]/90 border-slate-600 text-slate-100 hover:text-white hover:bg-[#111927]'
              }`}
            >
              {cameraFollowMode === 'forward' ? (
                <Navigation className="w-3.5 h-3.5" />
              ) : cameraFollowMode === 'relative' ? (
                <Compass className="w-3.5 h-3.5" />
              ) : (
                <Lock className="w-3.5 h-3.5" />
              )}
              <span>{CAMERA_MODE_LABEL[cameraFollowMode]}</span>
            </button>
          )}
        </div>
      )}
    </div>
  );
};
