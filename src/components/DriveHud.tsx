import React, { useMemo, useState } from 'react';
import {
  ArrowUp,
  ArrowUpFromLine,
  Camera,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Eye,
  Flag,
  Footprints,
  Globe,
  Lock,
  Map as MapIcon,
  MapPin,
  Navigation,
  Pause,
  Plane,
  Play,
  RotateCcw,
  SlidersHorizontal,
  Sparkles,
  Square,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { computeDrivetrainAudioMix, computeWalkAudioMix } from '../audio/engineSoundModel';
import {
  formatDistanceKr,
  formatDurationKr,
  type LatLngPoint,
  type RouteStepInfo,
  type VehiclePhysicsState,
} from '../engine/routeSimulation';
import type {
  CameraFollowMode,
  CameraViewMode,
  ComputedRouteData,
} from '../types/drive';

interface DriveHudProps {
  routeData: ComputedRouteData;
  physics: VehiclePhysicsState;
  vehiclePosition: LatLngPoint;
  vehicleHeading: number;
  currentStep: RouteStepInfo | null;
  nextStep: RouteStepInfo | null;
  distanceToNextTurnMeters: number;
  viewMode: CameraViewMode;
  onChangeViewMode: (mode: CameraViewMode) => void;
  isCruising: boolean;
  onToggleCruise: () => void;
  onStepBackward: () => void;
  onStepForward: () => void;
  cruiseMultiplier: number;
  onChangeMultiplier: (mult: number) => void;
  onGasStart: () => void;
  onGasEnd: () => void;
  onBrakeStart: () => void;
  onBrakeEnd: () => void;
  onScrubProgress: (distanceMeters: number) => void;
  onOpenGuide: () => void;
  onPause: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  cameraFollowMode?: CameraFollowMode;
  onChangeCameraMode?: (mode: CameraFollowMode) => void;
  showMinimapPip?: boolean;
  onToggleMinimap?: () => void;
  onAscendToSky?: () => void;
  onCapturePostcard?: () => void;
  walkBobbingEnabled?: boolean;
  onToggleWalkBobbing?: () => void;
  preferStreetPhoto?: boolean;
  onToggleStreetPhoto?: (next: boolean) => void;
  isFreeEngine?: boolean;
  hasNextLeg?: boolean;
  onAdvanceNextLeg?: () => void;
}

function renderManeuverIcon(maneuver?: string) {
  const m = (maneuver || '').toUpperCase();
  if (m.includes('LEFT')) {
    return <CornerUpLeft className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />;
  }
  if (m.includes('RIGHT')) {
    return <CornerUpRight className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />;
  }
  if (m.includes('UTURN')) {
    return <RotateCcw className="w-4 h-4 sm:w-5 sm:h-5 text-amber-400" />;
  }
  if (m.includes('ARRIVE') || m.includes('DESTINATION')) {
    return <Flag className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />;
  }
  return <ArrowUp className="w-4 h-4 sm:w-5 sm:h-5 text-emerald-400" />;
}

const SPEED_MULTIPLIERS = [0.5, 1, 2, 3];

const CAMERA_MODES: Array<{ key: CameraFollowMode; label: string }> = [
  { key: 'forward', label: '진행방향' },
  { key: 'relative', label: '창밖시선' },
  { key: 'free', label: '시선고정' },
];

const GEAR_SLOTS = ['P', '1', '2', '3', '4', '5'] as const;

export const DriveHud: React.FC<DriveHudProps> = ({
  routeData,
  physics,
  vehiclePosition,
  vehicleHeading,
  currentStep,
  nextStep,
  distanceToNextTurnMeters,
  viewMode,
  onChangeViewMode,
  isCruising,
  onToggleCruise,
  onStepBackward,
  onStepForward,
  cruiseMultiplier,
  onChangeMultiplier,
  onGasStart,
  onGasEnd,
  onBrakeStart,
  onBrakeEnd,
  onScrubProgress,
  onOpenGuide,
  onPause,
  isMuted,
  onToggleMute,
  cameraFollowMode = 'forward',
  onChangeCameraMode,
  showMinimapPip = false,
  onToggleMinimap,
  onAscendToSky,
  onCapturePostcard,
  walkBobbingEnabled = true,
  onToggleWalkBobbing,
  preferStreetPhoto = true,
  onToggleStreetPhoto,
  isFreeEngine = false,
  hasNextLeg = false,
  onAdvanceNextLeg,
}) => {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

  const isWalking = routeData.travelMode === 'WALKING';
  const isVehicleActive =
    !physics.arrived && (isCruising || physics.speedKmh > 0.8);

  const drivetrain = useMemo(() => {
    return computeDrivetrainAudioMix({
      speedKmh: physics.speedKmh,
      prevGearStep: Math.max(1, Math.min(5, Math.ceil(physics.speedKmh / 14) || 1)),
      travelMode: routeData.travelMode,
      isActive: isVehicleActive,
    });
  }, [physics.speedKmh, routeData.travelMode, isVehicleActive]);

  const walkMix = useMemo(
    () => computeWalkAudioMix(physics.speedKmh, isWalking && isVehicleActive),
    [physics.speedKmh, isWalking, isVehicleActive]
  );

  const rpmRatio = Math.max(0, Math.min(1, drivetrain.rpm / 5600));
  const activeGearSlot =
    physics.gear === 'P' || !isVehicleActive
      ? 'P'
      : String(Math.max(1, Math.min(5, drivetrain.gearStep)));

  const remainingMeters = Math.max(
    0,
    routeData.totalDistanceMeters - physics.distanceMeters
  );
  const progressFraction =
    routeData.totalDistanceMeters > 0
      ? Math.min(1, physics.distanceMeters / routeData.totalDistanceMeters)
      : 0;
  const remainingEtaSeconds = Math.max(
    60,
    Math.round(routeData.estimatedDurationSeconds * (1 - progressFraction))
  );

  const activeInstruction =
    nextStep?.instructions ||
    currentStep?.instructions ||
    `${routeData.destination.name} 방면 ${isWalking ? '도보' : '주행'}`;

  const cycleCameraMode = () => {
    if (!onChangeCameraMode) return;
    if (cameraFollowMode === 'forward') onChangeCameraMode('relative');
    else if (cameraFollowMode === 'relative') onChangeCameraMode('free');
    else onChangeCameraMode('forward');
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-2 sm:p-3 md:p-4">
      {/* Top Row: Compact Turn Banner + Iconified Top-Right Strip */}
      <div className="relative flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-2xl bg-[#0B1018]/88 backdrop-blur-md border border-slate-700/80 shadow-xl flex-1 min-w-0 max-w-lg">
          <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-[#151D2B] border border-slate-700/70 flex items-center justify-center shrink-0">
            {renderManeuverIcon(nextStep?.maneuver || currentStep?.maneuver)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <span className="font-mono-tabular text-sm sm:text-base md:text-lg font-bold text-amber-400 whitespace-nowrap shrink-0">
                {formatDistanceKr(distanceToNextTurnMeters)}
              </span>
              <span className="text-[11px] sm:text-xs text-slate-400 truncate tabular-nums">
                {formatDistanceKr(remainingMeters)} ·{' '}
                {formatDurationKr(remainingEtaSeconds)}
              </span>
            </div>
            <p className="text-xs md:text-sm font-medium text-slate-100 truncate">
              {activeInstruction}
            </p>
          </div>
        </div>

        {/* Top-Right Controls: Mobile = [시선] + [도구] + [일시정지]; Desktop = Iconified Bar */}
        <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
          {onAscendToSky && (
            <button
              type="button"
              data-testid="ascend-to-sky-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                onAscendToSky();
              }}
              aria-label="3D 하늘로 상승"
              title="3D 항공 모드로 상승"
              className="hidden md:flex min-h-[44px] px-2.5 rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-sky-400/70 text-xs font-semibold text-sky-300 items-center gap-1.5 shadow-lg whitespace-nowrap transition-colors"
            >
              <ArrowUpFromLine className="w-4 h-4 shrink-0" />
              <span>하늘 상승</span>
            </button>
          )}

          {onCapturePostcard && (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onCapturePostcard();
              }}
              aria-label="여행 엽서 PNG 저장"
              title="여행 엽서 저장 (PNG)"
              className="hidden md:flex min-w-[44px] min-h-[44px] rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-emerald-400/70 text-emerald-300 items-center justify-center shadow-lg transition-colors"
            >
              <Camera className="w-4 h-4" />
            </button>
          )}

          <a
            href={`https://earth.google.com/web/@${vehiclePosition.lat.toFixed(6)},${vehiclePosition.lng.toFixed(6)},65a,420d,35y,${Math.round(vehicleHeading)}h,55t,0r`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="현재 위치를 Google Earth에서 열기"
            title="Google Earth 3D 연동"
            className="hidden lg:flex min-w-[44px] min-h-[44px] rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-sky-400/70 text-sky-300 items-center justify-center shadow-lg transition-colors"
          >
            <Globe className="w-4 h-4 shrink-0" />
          </a>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenGuide();
            }}
            aria-label="AI 현지 가이드 열기"
            title="AI 주변 명소 가이드"
            className="hidden md:flex min-h-[44px] px-2.5 rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-amber-400/70 text-xs font-semibold text-amber-300 items-center gap-1.5 shadow-lg whitespace-nowrap transition-colors"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>가이드</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            tabIndex={-1}
            aria-label={isMuted ? '사운드 켜기 [M]' : '사운드 끄기 [M]'}
            className="hidden md:flex min-w-[44px] min-h-[44px] rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-slate-500 text-slate-200 items-center justify-center shadow-lg transition-colors"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-slate-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-emerald-400" />
            )}
          </button>

          {/* Mobile Camera Follow quick icon */}
          {onChangeCameraMode && (viewMode === 'streetview' || viewMode === 'split') && (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                cycleCameraMode();
              }}
              aria-label={`시선 모드 전환 (${cameraFollowMode})`}
              className="md:hidden min-w-[44px] min-h-[44px] rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 text-amber-300 flex items-center justify-center shadow-lg"
            >
              {cameraFollowMode === 'forward' ? (
                <Navigation className="w-4 h-4" />
              ) : cameraFollowMode === 'relative' ? (
                <Compass className="w-4 h-4 text-emerald-300" />
              ) : (
                <Lock className="w-4 h-4 text-slate-200" />
              )}
            </button>
          )}

          {/* Mobile Tools Drawer Trigger */}
          <button
            type="button"
            data-testid="mobile-tools-toggle"
            onClick={(e) => {
              e.currentTarget.blur();
              setMobileToolsOpen((prev) => !prev);
            }}
            aria-expanded={mobileToolsOpen}
            aria-label={mobileToolsOpen ? '주행 도구 닫기' : '주행 도구 열기'}
            className={`md:hidden min-w-[44px] min-h-[44px] rounded-xl border flex items-center justify-center shadow-lg transition-colors ${
              mobileToolsOpen
                ? 'bg-slate-700 border-slate-500 text-white'
                : 'bg-[#0B1018]/90 backdrop-blur-md border-slate-700/80 text-slate-200'
            }`}
          >
            {mobileToolsOpen ? (
              <X className="w-4 h-4" />
            ) : (
              <SlidersHorizontal className="w-4 h-4" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              setMobileToolsOpen(false);
              onPause();
            }}
            tabIndex={-1}
            aria-label="메뉴 및 경로 설정 [P]"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-slate-500 text-slate-200 flex items-center justify-center shadow-lg transition-colors"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>

        {/* Collapsible Mobile Cockpit Tools Popover */}
        {mobileToolsOpen && (
          <div
            data-testid="mobile-tools-drawer"
            className="md:hidden pointer-events-auto absolute right-0 top-[52px] z-40 rounded-2xl bg-[#0B1018]/96 backdrop-blur-md border border-slate-700/85 p-2.5 shadow-2xl flex flex-col gap-2 w-60"
          >
            {(viewMode === 'streetview' || viewMode === 'split') &&
              onChangeCameraMode && (
                <div className="space-y-1">
                  <span className="text-[10px] font-medium text-slate-400 px-1">
                    시선 유지 방식
                  </span>
                  <div className="grid grid-cols-3 gap-1 p-0.5 rounded-xl bg-[#151C28] border border-slate-800">
                    {CAMERA_MODES.map((m) => (
                      <button
                        key={m.key}
                        type="button"
                        onClick={() => onChangeCameraMode(m.key)}
                        className={`min-h-[34px] px-1 rounded-lg text-[11px] font-semibold whitespace-nowrap transition-colors ${
                          cameraFollowMode === m.key
                            ? 'bg-amber-500 text-slate-950'
                            : 'text-slate-300 hover:text-white'
                        }`}
                      >
                        {m.label}
                      </button>
                    ))}
                  </div>
                </div>
              )}

            <div className="space-y-1">
              <span className="text-[10px] font-medium text-slate-400 px-1">
                주행 배속
              </span>
              <div className="grid grid-cols-4 gap-1 p-0.5 rounded-xl bg-[#151C28] border border-slate-800">
                {SPEED_MULTIPLIERS.map((mult) => (
                  <button
                    key={mult}
                    type="button"
                    onClick={() => onChangeMultiplier(mult)}
                    className={`min-h-[32px] rounded-lg font-mono-tabular text-[11px] font-bold transition-colors ${
                      cruiseMultiplier === mult
                        ? 'bg-amber-500 text-slate-950'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    {mult}x
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={onStepBackward}
                className="min-h-[36px] rounded-xl bg-[#151C28] border border-slate-800 text-slate-200 flex items-center justify-center gap-1 text-[11px] font-medium"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>이전 구간</span>
              </button>
              <button
                type="button"
                onClick={onStepForward}
                className="min-h-[36px] rounded-xl bg-[#151C28] border border-slate-800 text-slate-200 flex items-center justify-center gap-1 text-[11px] font-medium"
              >
                <span>다음 구간</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onPointerDown={onBrakeStart}
                onPointerUp={onBrakeEnd}
                onPointerLeave={onBrakeEnd}
                onPointerCancel={onBrakeEnd}
                className="min-h-[36px] rounded-xl bg-rose-500/15 active:bg-rose-500/40 border border-rose-500/40 text-[11px] font-bold text-rose-300 select-none"
              >
                감속 페달
              </button>
              <button
                type="button"
                onPointerDown={onGasStart}
                onPointerUp={onGasEnd}
                onPointerLeave={onGasEnd}
                onPointerCancel={onGasEnd}
                className="min-h-[36px] rounded-xl bg-amber-500/20 active:bg-amber-500/45 border border-amber-400/50 text-[11px] font-bold text-amber-200 select-none"
              >
                가속 페달
              </button>
            </div>

            <div className="grid grid-cols-2 gap-1.5">
              {isFreeEngine && onToggleStreetPhoto && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleStreetPhoto(!preferStreetPhoto);
                    setMobileToolsOpen(false);
                  }}
                  className="min-h-[36px] px-2 rounded-xl bg-[#151C28] border border-amber-400/40 text-[11px] font-semibold text-amber-300 flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>{preferStreetPhoto ? '3D 지도로' : '실사 사진으로'}</span>
                </button>
              )}

              {viewMode === 'streetview' && onToggleMinimap && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleMinimap();
                    setMobileToolsOpen(false);
                  }}
                  className={`min-h-[36px] px-2 rounded-xl border text-[11px] font-medium flex items-center justify-center gap-1 whitespace-nowrap ${
                    showMinimapPip
                      ? 'bg-sky-500/20 border-sky-400/50 text-sky-300'
                      : 'bg-[#151C28] border-slate-800 text-slate-200'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5" />
                  <span>{showMinimapPip ? '미니맵 닫기' : '미니맵 열기'}</span>
                </button>
              )}

              <button
                type="button"
                onClick={onToggleMute}
                className="min-h-[36px] px-2 rounded-xl bg-[#151C28] border border-slate-800 text-[11px] font-medium text-slate-200 flex items-center justify-center gap-1 whitespace-nowrap"
              >
                {isMuted ? (
                  <VolumeX className="w-3.5 h-3.5 text-slate-400" />
                ) : (
                  <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
                )}
                <span>{isMuted ? '음소거 해제' : '사운드 켜짐'}</span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setMobileToolsOpen(false);
                  onOpenGuide();
                }}
                className="min-h-[36px] px-2 rounded-xl bg-amber-500/15 border border-amber-400/40 text-[11px] font-semibold text-amber-300 flex items-center justify-center gap-1 whitespace-nowrap"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>AI 가이드</span>
              </button>

              {onAscendToSky && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileToolsOpen(false);
                    onAscendToSky();
                  }}
                  className="min-h-[36px] px-2 rounded-xl bg-sky-500/15 border border-sky-400/40 text-[11px] font-semibold text-sky-300 flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <ArrowUpFromLine className="w-3.5 h-3.5" />
                  <span>하늘로 상승</span>
                </button>
              )}

              {onCapturePostcard && (
                <button
                  type="button"
                  onClick={() => {
                    setMobileToolsOpen(false);
                    onCapturePostcard();
                  }}
                  className="min-h-[36px] px-2 rounded-xl bg-emerald-500/15 border border-emerald-400/40 text-[11px] font-semibold text-emerald-300 flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span>엽서 저장</span>
                </button>
              )}

              {isWalking && onToggleWalkBobbing && (
                <button
                  type="button"
                  onClick={onToggleWalkBobbing}
                  className="min-h-[36px] px-2 rounded-xl bg-[#151C28] border border-slate-800 text-[11px] font-medium text-emerald-300 flex items-center justify-center gap-1 whitespace-nowrap"
                >
                  <Footprints className="w-3.5 h-3.5" />
                  <span>{walkBobbingEnabled ? '보행 흔들림 ON' : '보행 흔들림 OFF'}</span>
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Bottom Row: Tactile App Dock */}
      <div
        data-testid="cockpit-bottom-dock"
        className="pointer-events-auto w-full max-w-5xl mx-auto mb-0.5 sm:mb-2 rounded-2xl bg-[#0B1018]/92 backdrop-blur-md border border-slate-700/80 shadow-2xl px-2 py-1.5 sm:px-3.5 sm:py-2 md:px-5 md:py-2.5 space-y-1.5"
      >
        {/* Route Progress Scrubber */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="hidden sm:inline text-[11px] font-medium text-slate-400 truncate max-w-[160px]">
            {routeData.origin.name}
          </span>
          <input
            type="range"
            aria-label="경로 주행 위치 이동"
            min={0}
            max={Math.max(1, Math.round(routeData.totalDistanceMeters))}
            value={Math.round(physics.distanceMeters)}
            onChange={(e) => onScrubProgress(Number(e.target.value))}
            className="flex-1 h-1 sm:h-1.5 accent-amber-400 cursor-pointer bg-slate-800 rounded-lg"
          />
          <span className="hidden sm:inline text-[11px] font-semibold text-amber-300 truncate max-w-[160px]">
            {routeData.destination.name}
          </span>
        </div>

        {/* Main Single-Row Cockpit Bar */}
        <div className="flex items-center justify-between gap-1 sm:gap-2">
          {/* Left: Digital Speedometer + Graphic Gear Cassette / Walk Cadence */}
          <div className="flex items-center gap-1.5 sm:gap-3 min-w-0 shrink-0">
            <div className="flex items-baseline gap-0.5 sm:gap-1 shrink-0">
              <span
                data-testid="speedometer-value"
                className="font-mono-tabular text-base sm:text-2xl md:text-3xl font-bold text-slate-50 leading-none"
              >
                {Math.round(physics.speedKmh)}
              </span>
              <span className="text-[9px] sm:text-[11px] font-semibold text-slate-400">
                km/h
              </span>
            </div>

            <div className="h-5 sm:h-8 w-px bg-slate-800 shrink-0" aria-hidden="true" />

            {isWalking ? (
              <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
                <Footprints className="w-3.5 h-3.5 text-emerald-400" />
                <div className="leading-tight">
                  <div className="font-mono-tabular text-[10px] sm:text-xs font-bold text-emerald-300">
                    {walkMix.cadenceSpm > 0 ? `${walkMix.cadenceSpm}` : '정지'}
                    <span className="hidden sm:inline"> spm</span>
                  </div>
                </div>
                {onToggleWalkBobbing && (
                  <button
                    type="button"
                    onClick={onToggleWalkBobbing}
                    title="보행 흔들림 전환"
                    className={`hidden md:inline-flex px-1.5 py-0.5 rounded-md border text-[10px] font-semibold ${
                      walkBobbingEnabled
                        ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-300'
                        : 'border-slate-700 text-slate-400'
                    }`}
                  >
                    흔들림
                  </button>
                )}
              </div>
            ) : (
              <div
                data-testid="gear-rpm-cluster"
                className="flex flex-col gap-1 shrink-0"
              >
                {/* Compact Active Gear Pill on Mobile (< sm) */}
                <span
                  className={`sm:hidden font-mono-tabular text-[10px] font-bold px-1.5 py-0.5 rounded-md border ${
                    activeGearSlot === 'P'
                      ? 'bg-rose-500/20 border-rose-400/50 text-rose-300'
                      : 'bg-emerald-500/20 border-emerald-400/50 text-emerald-300'
                  }`}
                >
                  {activeGearSlot === 'P' ? 'P' : `D${activeGearSlot}`}
                </span>

                {/* Full Graphic P | D1..D5 Cassette on sm+ */}
                <div className="hidden sm:flex items-center gap-0.5 bg-[#141B27] px-1 py-0.5 rounded-md border border-slate-800">
                  {GEAR_SLOTS.map((slot) => {
                    const isActiveSlot = activeGearSlot === slot;
                    const label = slot === 'P' ? 'P' : `D${slot}`;
                    return (
                      <span
                        key={slot}
                        className={`font-mono-tabular text-[10px] font-bold px-1 rounded transition-colors ${
                          isActiveSlot
                            ? slot === 'P'
                              ? 'bg-rose-500 text-white'
                              : 'bg-emerald-500 text-slate-950'
                            : 'text-slate-500'
                        }`}
                      >
                        {label}
                      </span>
                    );
                  })}
                </div>

                {/* Graphic RPM Progress Bar */}
                <div className="hidden sm:flex items-center gap-1.5">
                  <div className="w-20 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-100 ${
                        rpmRatio > 0.78
                          ? 'bg-rose-400'
                          : rpmRatio > 0.52
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                      }`}
                      style={{ width: `${Math.round(rpmRatio * 100)}%` }}
                    />
                  </div>
                  <span className="font-mono-tabular text-[10px] text-slate-400">
                    {drivetrain.rpm > 0 ? `${drivetrain.rpm}` : 'IDLE'}
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Center: Camera View Switcher (Always Icon + Label on ALL Screens) */}
          <div
            role="group"
            aria-label="카메라 시점 선택"
            className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 rounded-xl bg-[#151C28] border border-slate-800 shrink-0"
          >
            <button
              type="button"
              data-testid="view-mode-streetview"
              onClick={(e) => {
                e.currentTarget.blur();
                onChangeViewMode('streetview');
              }}
              aria-label="거리뷰"
              className={`min-h-[38px] sm:min-h-[36px] px-1.5 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-semibold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                viewMode === 'streetview'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span>거리뷰</span>
            </button>

            <button
              type="button"
              data-testid="view-mode-split"
              onClick={(e) => {
                e.currentTarget.blur();
                onChangeViewMode('split');
              }}
              aria-label="듀얼뷰"
              className={`min-h-[38px] sm:min-h-[36px] px-1.5 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-semibold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                viewMode === 'split'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5 shrink-0" />
              <span>듀얼</span>
            </button>

            <button
              type="button"
              data-testid="view-mode-aerial"
              onClick={(e) => {
                e.currentTarget.blur();
                onChangeViewMode('aerial');
              }}
              aria-label="항공뷰"
              className={`min-h-[38px] sm:min-h-[36px] px-1.5 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-semibold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                viewMode === 'aerial'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Plane className="w-3.5 h-3.5 shrink-0" />
              <span>항공</span>
            </button>

            <button
              type="button"
              data-testid="view-mode-map"
              onClick={(e) => {
                e.currentTarget.blur();
                onChangeViewMode('map');
              }}
              aria-label="지도"
              className={`min-h-[38px] sm:min-h-[36px] px-1.5 sm:px-2.5 py-1 rounded-lg text-[10px] sm:text-xs font-semibold flex flex-col sm:flex-row items-center justify-center gap-0.5 sm:gap-1.5 whitespace-nowrap shrink-0 transition-colors ${
                viewMode === 'map'
                  ? 'bg-slate-200 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5 shrink-0" />
              <span>지도</span>
            </button>
          </div>

          {/* Right: Play/Stop + Desktop Extras */}
          <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
            <button
              type="button"
              data-testid="play-stop-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleCruise();
              }}
              aria-label={isCruising ? '주행 정지 [Space]' : '주행 시작 [Space]'}
              className={`min-w-[40px] min-h-[38px] sm:min-h-[40px] px-2 sm:px-3.5 rounded-xl text-xs font-bold flex items-center justify-center gap-1 whitespace-nowrap shrink-0 shadow-md transition-colors ${
                isCruising
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
              }`}
            >
              {isCruising ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="hidden sm:inline">정지</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span className="hidden sm:inline">재생</span>
                </>
              )}
            </button>

            {hasNextLeg && onAdvanceNextLeg && (
              <button
                type="button"
                onClick={onAdvanceNextLeg}
                className="hidden sm:inline-flex min-h-[40px] px-2.5 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 text-xs font-bold items-center gap-1 whitespace-nowrap"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>다음 여정</span>
              </button>
            )}

            <div
              role="group"
              aria-label="1구간씩 이동"
              className="hidden lg:flex items-center bg-[#151C28] rounded-xl p-0.5 border border-slate-800"
            >
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onStepBackward();
                }}
                aria-label="이전 장면으로 이동"
                title="이전 장면 (-35m)"
                className="min-w-[34px] min-h-[36px] px-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onStepForward();
                }}
                aria-label="다음 장면으로 이동"
                title="다음 장면 (+35m)"
                className="min-w-[34px] min-h-[36px] px-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-slate-800 flex items-center justify-center transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>

            <div className="hidden md:flex items-center bg-[#151C28] rounded-xl p-0.5 border border-slate-800">
              {SPEED_MULTIPLIERS.map((mult) => (
                <button
                  key={mult}
                  type="button"
                  onClick={(e) => {
                    e.currentTarget.blur();
                    onChangeMultiplier(mult);
                  }}
                  className={`min-w-[30px] min-h-[36px] px-1.5 rounded-lg font-mono-tabular text-[11px] font-bold transition-colors ${
                    cruiseMultiplier === mult
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {mult}x
                </button>
              ))}
            </div>

            <button
              type="button"
              onPointerDown={onBrakeStart}
              onPointerUp={onBrakeEnd}
              onPointerLeave={onBrakeEnd}
              onPointerCancel={onBrakeEnd}
              aria-label="브레이크 페달"
              className="hidden lg:inline-flex items-center min-h-[40px] px-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 active:bg-rose-500/40 border border-rose-500/40 text-xs font-bold text-rose-300 select-none whitespace-nowrap"
            >
              감속
            </button>

            <button
              type="button"
              onPointerDown={onGasStart}
              onPointerUp={onGasEnd}
              onPointerLeave={onGasEnd}
              onPointerCancel={onGasEnd}
              aria-label="가속 페달"
              className="hidden lg:inline-flex items-center min-h-[40px] px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/45 border border-amber-400/50 text-xs font-bold text-amber-200 select-none whitespace-nowrap"
            >
              가속
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
