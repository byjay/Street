import React, { useState } from 'react';
import {
  ArrowUp,
  ChevronLeft,
  ChevronRight,
  Columns2,
  Compass,
  CornerUpLeft,
  CornerUpRight,
  Eye,
  Flag,
  Globe,
  Map as MapIcon,
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
import {
  formatDistanceKr,
  formatDurationKr,
  type LatLngPoint,
  type RouteStepInfo,
  type VehiclePhysicsState,
} from '../engine/routeSimulation';
import type { CameraViewMode, ComputedRouteData } from '../types/drive';

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
  autoAlignHeading?: boolean;
  onToggleAutoAlign?: () => void;
  showMinimapPip?: boolean;
  onToggleMinimap?: () => void;
}

function renderManeuverIcon(maneuver?: string) {
  const m = (maneuver || '').toUpperCase();
  if (m.includes('LEFT')) {
    return <CornerUpLeft className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />;
  }
  if (m.includes('RIGHT')) {
    return <CornerUpRight className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />;
  }
  if (m.includes('UTURN')) {
    return <RotateCcw className="w-5 h-5 sm:w-6 sm:h-6 text-amber-400" />;
  }
  if (m.includes('ARRIVE') || m.includes('DESTINATION')) {
    return <Flag className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400" />;
  }
  return <ArrowUp className="w-5 h-5 sm:w-6 sm:h-6 text-emerald-400" />;
}

const SPEED_MULTIPLIERS = [0.5, 1, 2, 3];

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
  autoAlignHeading = true,
  onToggleAutoAlign,
  showMinimapPip = false,
  onToggleMinimap,
}) => {
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);

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
    `${routeData.destination.name} 방면 주행`;

  const cycleSpeedMultiplier = () => {
    const currentIndex = SPEED_MULTIPLIERS.indexOf(cruiseMultiplier);
    const nextIndex =
      currentIndex === -1 ? 1 : (currentIndex + 1) % SPEED_MULTIPLIERS.length;
    onChangeMultiplier(SPEED_MULTIPLIERS[nextIndex]);
  };

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-2.5 sm:p-3 md:p-4">
      {/* Top Row: Compact Turn-by-Turn Navigation Banner + Minimal Pause on Mobile / Full Utility Bar on Desktop */}
      <div className="flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3.5 py-1.5 sm:py-2 rounded-2xl bg-[#0D131D]/90 border border-slate-700/80 shadow-xl flex-1 min-w-0 max-w-lg">
          <div className="w-8 h-8 sm:w-10 sm:h-10 rounded-xl bg-[#161E2C] border border-slate-700/70 flex items-center justify-center shrink-0">
            {renderManeuverIcon(nextStep?.maneuver || currentStep?.maneuver)}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 sm:gap-2 min-w-0">
              <span className="font-mono-tabular text-sm sm:text-base md:text-lg font-bold text-amber-400 whitespace-nowrap shrink-0">
                {formatDistanceKr(distanceToNextTurnMeters)}
              </span>
              <span className="text-[11px] sm:text-xs text-slate-400 truncate tabular-nums">
                <span className="hidden sm:inline">남은 거리 </span>
                {formatDistanceKr(remainingMeters)} ·{' '}
                {formatDurationKr(remainingEtaSeconds)}
              </span>
            </div>
            <p className="text-xs md:text-sm font-medium text-slate-100 truncate">
              {activeInstruction}
            </p>
          </div>
        </div>

        {/* Top-Right Controls: Mobile shows only Menu/Pause; Desktop shows full utilities */}
        <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
          <a
            href={`https://earth.google.com/web/@${vehiclePosition.lat.toFixed(6)},${vehiclePosition.lng.toFixed(6)},65a,420d,35y,${Math.round(vehicleHeading)}h,55t,0r`}
            target="_blank"
            rel="noopener noreferrer"
            aria-label="현재 위치를 Google Earth에서 열기"
            title="Google Earth 3D 연동 열기"
            className="hidden md:flex min-h-[44px] px-3 rounded-xl bg-[#0D131D]/92 border border-slate-700/80 hover:border-sky-400/70 text-xs font-semibold text-sky-300 items-center gap-1.5 shadow-lg whitespace-nowrap transition-colors"
          >
            <Globe className="w-4 h-4 shrink-0" />
            <span>Earth</span>
          </a>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenGuide();
            }}
            aria-label="AI 현지 가이드 열기"
            className="hidden md:flex min-h-[44px] px-3 rounded-xl bg-[#0D131D]/92 border border-slate-700/80 hover:border-amber-400/70 text-xs font-semibold text-amber-300 items-center gap-1.5 shadow-lg whitespace-nowrap transition-colors"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span>AI 가이드</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            tabIndex={-1}
            aria-label={isMuted ? '사운드 켜기 [M]' : '사운드 끄기 [M]'}
            className="hidden md:flex min-w-[44px] min-h-[44px] rounded-xl bg-[#0D131D]/92 border border-slate-700/80 hover:border-slate-500 text-slate-200 items-center justify-center shadow-lg transition-colors"
          >
            {isMuted ? (
              <VolumeX className="w-4 h-4 text-slate-400" />
            ) : (
              <Volume2 className="w-4 h-4 text-emerald-400" />
            )}
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onPause();
            }}
            tabIndex={-1}
            aria-label="메뉴 및 경로 설정 [P]"
            className="min-w-[42px] min-h-[42px] sm:min-w-[44px] sm:min-h-[44px] rounded-xl bg-[#0D131D]/90 border border-slate-700/80 hover:border-slate-500 text-slate-200 flex items-center justify-center shadow-lg transition-colors"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Mobile Compact Right-Edge Side Rail (keeps road center unobstructed) */}
      <div
        data-testid="mobile-side-rail"
        className="md:hidden pointer-events-none absolute right-2.5 bottom-[106px] z-30 flex items-end gap-2"
      >
        {mobileToolsOpen && (
          <div
            data-testid="mobile-tools-drawer"
            className="pointer-events-auto rounded-2xl bg-[#0D131D]/95 border border-slate-700/85 p-2 shadow-2xl flex flex-col gap-1.5 w-36"
          >
            <div className="flex items-center justify-between gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onStepBackward();
                }}
                aria-label="이전 장면으로 이동"
                className="flex-1 min-h-[36px] rounded-xl bg-[#151C28] border border-slate-800 text-slate-200 flex items-center justify-center gap-0.5 text-[11px] font-medium"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                <span>이전</span>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onStepForward();
                }}
                aria-label="다음 장면으로 이동"
                className="flex-1 min-h-[36px] rounded-xl bg-[#151C28] border border-slate-800 text-slate-200 flex items-center justify-center gap-0.5 text-[11px] font-medium"
              >
                <span>다음</span>
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            </div>

            <div className="flex items-center gap-1">
              <button
                type="button"
                onPointerDown={onBrakeStart}
                onPointerUp={onBrakeEnd}
                onPointerLeave={onBrakeEnd}
                onPointerCancel={onBrakeEnd}
                aria-label="브레이크 페달"
                className="flex-1 min-h-[36px] rounded-xl bg-rose-500/15 active:bg-rose-500/40 border border-rose-500/40 text-[11px] font-bold text-rose-300 select-none"
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
                className="flex-1 min-h-[36px] rounded-xl bg-amber-500/20 active:bg-amber-500/45 border border-amber-400/50 text-[11px] font-bold text-amber-200 select-none"
              >
                가속
              </button>
            </div>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMute();
              }}
              aria-label={isMuted ? '사운드 켜기' : '사운드 끄기'}
              className="min-h-[36px] px-2.5 rounded-xl bg-[#151C28] border border-slate-800 text-[11px] font-medium text-slate-200 flex items-center justify-between"
            >
              <span>{isMuted ? '음소거됨' : '주행 사운드'}</span>
              {isMuted ? (
                <VolumeX className="w-3.5 h-3.5 text-slate-400" />
              ) : (
                <Volume2 className="w-3.5 h-3.5 text-emerald-400" />
              )}
            </button>

            <a
              href={`https://earth.google.com/web/@${vehiclePosition.lat.toFixed(6)},${vehiclePosition.lng.toFixed(6)},65a,420d,35y,${Math.round(vehicleHeading)}h,55t,0r`}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Google Earth 3D 열기"
              className="min-h-[36px] px-2.5 rounded-xl bg-[#151C28] border border-slate-800 text-[11px] font-medium text-sky-300 flex items-center justify-between"
            >
              <span>Google Earth</span>
              <Globe className="w-3.5 h-3.5" />
            </a>
          </div>
        )}

        <div className="pointer-events-auto rounded-2xl bg-[#0D131D]/88 border border-slate-700/80 p-1 flex flex-col items-center gap-1 shadow-xl">
          {(viewMode === 'streetview' || viewMode === 'split') &&
            onToggleAutoAlign && (
              <button
                type="button"
                onClick={(e) => {
                  e.currentTarget.blur();
                  onToggleAutoAlign();
                }}
                aria-label={
                  autoAlignHeading
                    ? '시선 자동정렬 켜짐 (전환)'
                    : '360° 자유시점 (자동정렬 켜기)'
                }
                className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                  autoAlignHeading
                    ? 'bg-amber-500/20 text-amber-300 border border-amber-400/50'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
              >
                {autoAlignHeading ? (
                  <Navigation className="w-4 h-4" />
                ) : (
                  <Compass className="w-4 h-4" />
                )}
              </button>
            )}

          {viewMode === 'streetview' && onToggleMinimap && (
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleMinimap();
              }}
              aria-label={showMinimapPip ? '미니맵 닫기' : '미니맵 열기'}
              className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
                showMinimapPip
                  ? 'bg-sky-500/20 text-sky-300 border border-sky-400/50'
                  : 'text-slate-300 hover:bg-slate-800'
              }`}
            >
              <MapIcon className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              setMobileToolsOpen(false);
              onOpenGuide();
            }}
            aria-label="AI 현지 가이드 열기"
            className="w-10 h-10 rounded-xl text-amber-300 hover:bg-slate-800 flex items-center justify-center transition-colors"
          >
            <Sparkles className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              setMobileToolsOpen((prev) => !prev);
            }}
            aria-expanded={mobileToolsOpen}
            aria-label={mobileToolsOpen ? '추가 기능 닫기' : '추가 기능 열기'}
            className={`w-10 h-10 rounded-xl flex items-center justify-center transition-colors ${
              mobileToolsOpen
                ? 'bg-slate-700 text-white'
                : 'text-slate-300 hover:bg-slate-800'
            }`}
          >
            {mobileToolsOpen ? (
              <X className="w-4 h-4" />
            ) : (
              <SlidersHorizontal className="w-4 h-4" />
            )}
          </button>
        </div>
      </div>

      {/* Bottom Row: Minimal Single-Row Mobile Dock / Full Desktop Cockpit Console */}
      <div
        data-testid="cockpit-bottom-dock"
        className="pointer-events-auto w-full max-w-4xl mx-auto mb-1 sm:mb-2 rounded-2xl bg-[#0D131D]/90 border border-slate-700/80 shadow-2xl px-3 py-2 md:px-5 md:py-3 space-y-1.5 sm:space-y-2.5"
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
            className="flex-1 h-1.5 accent-amber-400 cursor-pointer bg-slate-800 rounded-lg"
          />
          <span className="hidden sm:inline text-[11px] font-semibold text-amber-300 truncate max-w-[160px]">
            {routeData.destination.name}
          </span>
        </div>

        {/* Main Single-Row Cockpit Bar */}
        <div className="flex items-center justify-between gap-2">
          {/* Left: Digital Speedometer + Gear */}
          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
            <div className="flex items-baseline gap-1 shrink-0">
              <span
                data-testid="speedometer-value"
                className="font-mono-tabular text-xl sm:text-2xl md:text-3xl font-bold text-slate-50 leading-none"
              >
                {Math.round(physics.speedKmh)}
              </span>
              <span className="text-[10px] sm:text-[11px] font-semibold text-slate-400">
                km/h
              </span>
            </div>

            <div className="h-5 sm:h-7 w-px bg-slate-800 shrink-0" aria-hidden="true" />

            <div className="flex items-center gap-1.5 text-xs shrink-0">
              <span
                className={`font-mono-tabular font-bold ${
                  physics.gear === 'P' ? 'text-rose-400' : 'text-emerald-400'
                }`}
              >
                {physics.gear}
              </span>
              <span className="hidden md:inline text-slate-600" aria-hidden="true">
                ·
              </span>
              <span className="hidden md:inline font-mono-tabular text-slate-300">
                {isCruising
                  ? `${(
                      cruiseMultiplier <= 0.6
                        ? 3.8
                        : cruiseMultiplier <= 1.2
                          ? 2.2
                          : cruiseMultiplier <= 2.2
                            ? 1.4
                            : 0.9
                    ).toFixed(1)}초/장`
                  : '일시정지'}
              </span>
              {physics.isCornering && (
                <span
                  data-testid="cornering-indicator"
                  className="text-amber-300 font-semibold whitespace-nowrap text-[11px] sm:text-xs"
                >
                  <span className="hidden sm:inline">· </span>코너 감속
                </span>
              )}
            </div>
          </div>

          {/* Center: Compact Camera View Switcher */}
          <div
            role="group"
            aria-label="카메라 시점 선택"
            className="flex items-center gap-0.5 sm:gap-1 p-0.5 sm:p-1 rounded-xl bg-[#151C28] border border-slate-800 shrink-0"
          >
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onChangeViewMode('streetview');
              }}
              aria-label="360° 뷰"
              className={`min-w-[34px] min-h-[34px] sm:min-h-[36px] px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                viewMode === 'streetview'
                  ? 'bg-amber-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">360° 뷰</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onChangeViewMode('aerial');
              }}
              aria-label="항공뷰"
              className={`min-w-[34px] min-h-[34px] sm:min-h-[36px] px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                viewMode === 'aerial'
                  ? 'bg-sky-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Plane className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">항공뷰</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onChangeViewMode('split');
              }}
              aria-label="분할뷰"
              className={`hidden md:flex min-h-[36px] px-2.5 py-1 rounded-lg text-xs font-semibold items-center gap-1 whitespace-nowrap transition-colors ${
                viewMode === 'split'
                  ? 'bg-emerald-500 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <Columns2 className="w-3.5 h-3.5" />
              <span>분할뷰</span>
            </button>

            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                onChangeViewMode('map');
              }}
              aria-label="지도"
              className={`min-w-[34px] min-h-[34px] sm:min-h-[36px] px-2 sm:px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                viewMode === 'map'
                  ? 'bg-slate-200 text-slate-950'
                  : 'text-slate-300 hover:text-white'
              }`}
            >
              <MapIcon className="w-3.5 h-3.5 shrink-0" />
              <span className="hidden sm:inline">지도</span>
            </button>
          </div>

          {/* Right: Minimal Mobile (Speed Cycle + Play/Stop) / Full Desktop Controls */}
          <div className="flex items-center gap-1.5 shrink-0">
            {/* Mobile single tap-to-cycle speed multiplier */}
            <button
              type="button"
              onClick={(e) => {
                e.currentTarget.blur();
                cycleSpeedMultiplier();
              }}
              aria-label={`주행 배속 변경 (현재 ${cruiseMultiplier}x)`}
              className="md:hidden min-w-[38px] min-h-[36px] px-2 rounded-xl bg-[#151C28] border border-slate-800 font-mono-tabular text-[11px] font-bold text-amber-400 flex items-center justify-center"
            >
              {cruiseMultiplier}x
            </button>

            <button
              type="button"
              data-testid="play-stop-btn"
              onClick={(e) => {
                e.currentTarget.blur();
                onToggleCruise();
              }}
              aria-label={isCruising ? '주행 정지 [Space]' : '주행 시작 [Space]'}
              className={`min-h-[36px] sm:min-h-[40px] px-2.5 sm:px-3.5 rounded-xl text-xs font-bold flex items-center gap-1 whitespace-nowrap shadow-md transition-colors ${
                isCruising
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
              }`}
            >
              {isCruising ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span>정지</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span>재생</span>
                </>
              )}
            </button>

            {/* Desktop Scene Step + Multiplier Strip + Pedals */}
            <div
              role="group"
              aria-label="1구간씩 이동"
              className="hidden md:flex items-center bg-[#151C28] rounded-xl p-0.5 border border-slate-800"
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
                  className={`min-w-[32px] min-h-[36px] px-1.5 rounded-lg font-mono-tabular text-[11px] font-bold transition-colors ${
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
              className="hidden md:inline-flex items-center min-h-[40px] px-2.5 rounded-xl bg-rose-500/15 hover:bg-rose-500/25 active:bg-rose-500/40 border border-rose-500/40 text-xs font-bold text-rose-300 select-none whitespace-nowrap"
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
              className="hidden md:inline-flex items-center min-h-[40px] px-3 rounded-xl bg-amber-500/20 hover:bg-amber-500/30 active:bg-amber-500/45 border border-amber-400/50 text-xs font-bold text-amber-200 select-none whitespace-nowrap"
            >
              가속
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
