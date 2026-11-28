import React from 'react';
import {
  ArrowDownToLine,
  Camera,
  CloudSun,
  Compass,
  Eye,
  Gauge,
  Moon,
  Navigation,
  Pause,
  Plane,
  PlaneLanding,
  PlaneTakeoff,
  Play,
  Sparkles,
  Square,
  Sun,
  Sunrise,
  Sunset,
  Volume2,
  VolumeX,
} from 'lucide-react';
import type {
  FlightCameraMode,
  FlightPhase,
  FlightTelemetry,
  FlightTimeOfDay,
} from '../types/drive';

interface FlightHudProps {
  telemetry: FlightTelemetry;
  cameraMode: FlightCameraMode;
  onChangeCameraMode: (mode: FlightCameraMode) => void;
  timeOfDay: FlightTimeOfDay;
  onCycleTimeOfDay: () => void;
  speedMultiplier: number;
  onChangeSpeedMultiplier: (mult: number) => void;
  isFlying: boolean;
  onToggleFly: () => void;
  onScrubProgress: (distanceMeters: number) => void;
  onDiveToStreetView: () => void;
  onOpenBriefing: () => void;
  onCapturePostcard: () => void;
  isMuted: boolean;
  onToggleMute: () => void;
  onPause: () => void;
  hasNextLeg?: boolean;
  onAdvanceNextLeg?: () => void;
}

const CAMERA_OPTIONS: Array<{
  key: FlightCameraMode;
  shortLabel: string;
  label: string;
}> = [
  { key: 'cockpit', shortLabel: '1 조종석', label: '1 조종석 시점' },
  { key: 'window-left', shortLabel: '2 좌창', label: '2 좌측 창가' },
  { key: 'window-right', shortLabel: '3 우창', label: '3 우측 창가' },
  { key: 'chase', shortLabel: '4 추적', label: '4 외부 추적' },
];

const FLIGHT_MULTIPLIERS = [1, 10, 25, 60];

const PHASE_META: Record<FlightPhase, { label: string; colorClass: string }> = {
  TAKEOFF: { label: '이륙', colorClass: 'text-amber-300 border-amber-400/40 bg-amber-500/15' },
  CLIMB: { label: '상승', colorClass: 'text-sky-300 border-sky-400/40 bg-sky-500/15' },
  CRUISE: { label: '순항', colorClass: 'text-emerald-300 border-emerald-400/40 bg-emerald-500/15' },
  DESCENT: { label: '강하', colorClass: 'text-amber-300 border-amber-400/40 bg-amber-500/15' },
  LANDING: { label: '착륙', colorClass: 'text-rose-300 border-rose-400/40 bg-rose-500/15' },
};

function renderPhaseIcon(phase: FlightPhase) {
  if (phase === 'TAKEOFF' || phase === 'CLIMB') {
    return <PlaneTakeoff className="w-3.5 h-3.5 shrink-0" />;
  }
  if (phase === 'DESCENT' || phase === 'LANDING') {
    return <PlaneLanding className="w-3.5 h-3.5 shrink-0" />;
  }
  return <Plane className="w-3.5 h-3.5 shrink-0" />;
}

function renderTimeIcon(timeOfDay: FlightTimeOfDay) {
  switch (timeOfDay) {
    case 'dawn':
      return <Sunrise className="w-4 h-4 text-orange-300" />;
    case 'sunset':
      return <Sunset className="w-4 h-4 text-rose-300" />;
    case 'night':
      return <Moon className="w-4 h-4 text-indigo-300" />;
    case 'day':
    default:
      return <Sun className="w-4 h-4 text-amber-300" />;
  }
}

const TIME_LABEL: Record<FlightTimeOfDay, string> = {
  dawn: '새벽',
  day: '주간',
  sunset: '노을',
  night: '야간',
};

export const FlightHud: React.FC<FlightHudProps> = ({
  telemetry,
  cameraMode,
  onChangeCameraMode,
  timeOfDay,
  onCycleTimeOfDay,
  speedMultiplier,
  onChangeSpeedMultiplier,
  isFlying,
  onToggleFly,
  onScrubProgress,
  onDiveToStreetView,
  onOpenBriefing,
  onCapturePostcard,
  isMuted,
  onToggleMute,
  onPause,
  hasNextLeg = false,
  onAdvanceNextLeg,
}) => {
  const phaseMeta = PHASE_META[telemetry.phase];
  const altitudeFeet = Math.round(telemetry.altitudeMeters * 3.28084);
  const speedKnots = Math.round(telemetry.speedKmh * 0.539957);

  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-between p-2 sm:p-3 md:p-4">
      {/* Top Bar: Compact Telemetry Header + Icon Action Strip */}
      <div className="flex items-start justify-between gap-2">
        <div className="pointer-events-auto flex items-center gap-2 sm:gap-3 px-2.5 sm:px-3.5 py-2 rounded-2xl bg-[#0B1018]/88 backdrop-blur-md border border-slate-700/80 shadow-xl min-w-0 max-w-2xl">
          <div
            className={`px-2 py-1 rounded-xl border text-[11px] font-bold flex items-center gap-1 shrink-0 ${phaseMeta.colorClass}`}
          >
            {renderPhaseIcon(telemetry.phase)}
            <span>{phaseMeta.label}</span>
          </div>

          <div className="grid grid-cols-2 sm:flex sm:items-center gap-x-3 gap-y-0.5 text-xs min-w-0">
            <div className="flex items-baseline gap-1 font-mono-tabular whitespace-nowrap">
              <span className="text-[10px] text-slate-400">ALT</span>
              <span className="font-bold text-slate-100">
                {telemetry.altitudeMeters.toLocaleString()}m
              </span>
              <span className="hidden lg:inline text-[10px] text-slate-500">
                ({altitudeFeet.toLocaleString()}ft)
              </span>
            </div>

            <div className="flex items-baseline gap-1 font-mono-tabular whitespace-nowrap">
              <span className="text-[10px] text-slate-400">SPD</span>
              <span className="font-bold text-sky-300">
                {telemetry.speedKmh}km/h
              </span>
              <span className="hidden lg:inline text-[10px] text-slate-500">
                ({speedKnots}kt)
              </span>
            </div>

            <div className="hidden sm:flex items-baseline gap-1 font-mono-tabular whitespace-nowrap">
              <span className="text-[10px] text-slate-400">HDG</span>
              <span className="font-bold text-amber-300">
                {String(telemetry.headingDeg).padStart(3, '0')}°
              </span>
            </div>

            <div className="hidden md:flex items-baseline gap-1 font-mono-tabular whitespace-nowrap text-slate-300">
              <span>{telemetry.remainingKm}km</span>
              <span className="text-slate-500">·</span>
              <span>{telemetry.etaMinutes}분</span>
            </div>
          </div>
        </div>

        {/* Top-Right Icon Controls (44x44 touch targets) */}
        <div className="pointer-events-auto flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onOpenBriefing();
            }}
            aria-label="기장 상공 브리핑 열기"
            title="상공 랜드마크 브리핑"
            className="min-w-[44px] min-h-[44px] md:px-3 rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-amber-400/70 text-amber-300 flex items-center justify-center gap-1.5 text-xs font-semibold shadow-lg transition-colors"
          >
            <Sparkles className="w-4 h-4 shrink-0" />
            <span className="hidden md:inline">브리핑</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onCycleTimeOfDay();
            }}
            aria-label={`시간대 조명 변경 (${TIME_LABEL[timeOfDay]})`}
            title={`시간대: ${TIME_LABEL[timeOfDay]}`}
            className="min-w-[44px] min-h-[44px] md:px-2.5 rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-sky-400/60 text-slate-200 flex items-center justify-center gap-1 text-xs font-semibold shadow-lg transition-colors"
          >
            {renderTimeIcon(timeOfDay)}
            <span className="hidden lg:inline">{TIME_LABEL[timeOfDay]}</span>
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onCapturePostcard();
            }}
            aria-label="비행 엽서 PNG 저장"
            title="여행 엽서 저장 (PNG)"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-emerald-400/60 text-emerald-300 flex items-center justify-center shadow-lg transition-colors"
          >
            <Camera className="w-4 h-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.currentTarget.blur();
              onToggleMute();
            }}
            aria-label={isMuted ? '사운드 켜기 [M]' : '사운드 끄기 [M]'}
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-slate-500 text-slate-200 flex items-center justify-center shadow-lg transition-colors"
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
            aria-label="메뉴 및 일시정지 [P]"
            className="min-w-[44px] min-h-[44px] rounded-xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 hover:border-slate-500 text-slate-200 flex items-center justify-center shadow-lg transition-colors"
          >
            <Pause className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Middle Floating Landmark Caption */}
      <div className="pointer-events-none flex justify-center px-2">
        <div className="px-3.5 py-1.5 rounded-xl bg-[#0B1018]/78 backdrop-blur-md border border-slate-700/70 text-center max-w-md shadow-lg">
          <div className="flex items-center justify-center gap-1.5 text-xs font-bold text-sky-300">
            <Compass className="w-3.5 h-3.5 shrink-0" />
            <span>{telemetry.nearestLandmark}</span>
          </div>
          {telemetry.nearestLandmarkDescription && (
            <p className="text-[11px] text-slate-300 truncate mt-0.5">
              {telemetry.nearestLandmarkDescription}
            </p>
          )}
        </div>
      </div>

      {/* Bottom Aviation Thumb Dock */}
      <div className="pointer-events-auto w-full max-w-4xl mx-auto rounded-2xl bg-[#0B1018]/90 backdrop-blur-md border border-slate-700/80 shadow-2xl px-2.5 py-2 sm:px-4 sm:py-3 space-y-2">
        {/* Flight Progress Scrubber */}
        <div className="flex items-center gap-2 sm:gap-3">
          <span className="text-[11px] font-bold text-sky-300 whitespace-nowrap">
            김해 PUS
          </span>
          <input
            type="range"
            aria-label="항공 비행 구간 이동"
            min={0}
            max={Math.max(1, Math.round(telemetry.totalDistanceMeters))}
            value={Math.round(telemetry.distanceMeters)}
            onChange={(e) => onScrubProgress(Number(e.target.value))}
            className="flex-1 h-1.5 accent-sky-400 cursor-pointer bg-slate-800 rounded-lg"
          />
          <span className="text-[11px] font-bold text-amber-300 whitespace-nowrap">
            김포 GMP
          </span>
        </div>

        {/* Camera Presets + Speed + Dive CTA */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          {/* 4 Camera Presets */}
          <div
            role="group"
            aria-label="항공 카메라 시점"
            className="grid grid-cols-4 gap-1 p-1 rounded-xl bg-[#141B27] border border-slate-800"
          >
            {CAMERA_OPTIONS.map((cam) => (
              <button
                key={cam.key}
                type="button"
                data-testid={`flight-cam-${cam.key}`}
                onClick={() => onChangeCameraMode(cam.key)}
                aria-label={cam.label}
                className={`min-h-[36px] px-2 sm:px-2.5 rounded-lg text-[11px] sm:text-xs font-semibold flex items-center justify-center gap-1 whitespace-nowrap transition-colors ${
                  cameraMode === cam.key
                    ? 'bg-sky-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <CloudSun className="hidden sm:block w-3.5 h-3.5 shrink-0" />
                <span>{cam.shortLabel}</span>
              </button>
            ))}
          </div>

          {/* Right Controls: TimeWarp + Play + Dive to Street View */}
          <div className="flex items-center gap-1.5 ml-auto">
            <div className="hidden sm:flex items-center bg-[#141B27] rounded-xl p-0.5 border border-slate-800">
              <Gauge className="w-3.5 h-3.5 text-slate-400 mx-1.5" />
              {FLIGHT_MULTIPLIERS.map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => onChangeSpeedMultiplier(m)}
                  className={`min-w-[34px] min-h-[34px] px-1.5 rounded-lg font-mono-tabular text-[11px] font-bold transition-colors ${
                    speedMultiplier === m
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {m}x
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={onToggleFly}
              aria-label={isFlying ? '비행 일시정지' : '비행 재개'}
              className={`min-w-[44px] min-h-[38px] px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1 transition-colors ${
                isFlying
                  ? 'bg-rose-500 hover:bg-rose-400 text-white'
                  : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
              }`}
            >
              {isFlying ? (
                <>
                  <Square className="w-3.5 h-3.5 fill-current" />
                  <span className="hidden sm:inline">정지</span>
                </>
              ) : (
                <>
                  <Play className="w-3.5 h-3.5 fill-current" />
                  <span className="hidden sm:inline">비행</span>
                </>
              )}
            </button>

            <button
              type="button"
              data-testid="dive-to-street-btn"
              onClick={onDiveToStreetView}
              className="min-h-[38px] px-3 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1.5 whitespace-nowrap shadow-md transition-colors"
            >
              <Eye className="w-3.5 h-3.5 shrink-0" />
              <ArrowDownToLine className="w-3.5 h-3.5 shrink-0" />
              <span>거리뷰 다이브</span>
            </button>

            {hasNextLeg && onAdvanceNextLeg && (
              <button
                type="button"
                onClick={onAdvanceNextLeg}
                className="min-h-[38px] px-2.5 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold flex items-center gap-1 whitespace-nowrap shadow-md transition-colors"
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>다음 여정</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
