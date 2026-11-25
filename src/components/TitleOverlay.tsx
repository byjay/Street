import React, { useState } from 'react';
import {
  BarChart3,
  CarFront,
  Compass,
  Footprints,
  Navigation,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { CHALLENGE_COURSES, GLOBAL_ROUTE_PRESETS } from '../data/presets';
import type {
  ChallengeCourse,
  GlobalRoutePreset,
  SelectedPlaceInfo,
  TravelModeOption,
} from '../types/drive';
import { PlaceSearchInput } from './PlaceSearchInput';

interface TitleOverlayProps {
  origin: SelectedPlaceInfo | null;
  destination: SelectedPlaceInfo | null;
  onSelectOrigin: (place: SelectedPlaceInfo) => void;
  onSelectDestination: (place: SelectedPlaceInfo) => void;
  onUseCurrentLocation: () => void;
  gpsLoading: boolean;
  travelMode: TravelModeOption;
  onChangeTravelMode: (mode: TravelModeOption) => void;
  onStartDrive: () => void;
  onSelectPreset: (preset: GlobalRoutePreset) => void;
  onSelectChallenge: (course: ChallengeCourse) => void;
  challengeBestScores: Record<string, number>;
  isStarting: boolean;
  errorMessage: string | null;
  onOpenHistoryDashboard: () => void;
  tripCount: number;
}

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  origin,
  destination,
  onSelectOrigin,
  onSelectDestination,
  onUseCurrentLocation,
  gpsLoading,
  travelMode,
  onChangeTravelMode,
  onStartDrive,
  onSelectPreset,
  onSelectChallenge,
  challengeBestScores,
  isStarting,
  errorMessage,
  onOpenHistoryDashboard,
  tripCount,
}) => {
  const [courseTab, setCourseTab] = useState<'global' | 'challenge'>('global');
  return (
    <main className="relative w-full h-full min-h-screen overflow-y-auto cockpit-scroll bg-[#0A0D12] flex flex-col justify-between">
      {/* Generated Key-Art Backdrop with Measured Scrim */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src="/src/assets/images/title_cockpit_horizon_1795532370356.jpg"
          alt="야간 해안 고속도로를 주행하는 차량 실내 운전석 시점"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-55"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0A0D12]/95 via-[#0A0D12]/80 to-[#0A0D12]/50" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0D12] via-transparent to-[#0A0D12]/70" />
      </div>

      {/* Main Content Container */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-5 py-8 md:px-10 md:py-12 my-auto grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-10 items-center">
        {/* Left Column: Bespoke SVG Emblem + Editorial Headline */}
        <section className="lg:col-span-6 space-y-5">
          <div className="flex items-center gap-3">
            <svg
              viewBox="0 0 44 44"
              className="w-11 h-11 shrink-0"
              aria-hidden="true"
            >
              <rect
                x="2"
                y="2"
                width="40"
                height="40"
                rx="11"
                fill="#121824"
                stroke="#F59E0B"
                strokeWidth="2"
              />
              <path
                d="M12 31 L20 12 L24 12 L32 31"
                fill="none"
                stroke="#F4F6FA"
                strokeWidth="2.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <path
                d="M22 16 L22 28"
                stroke="#F59E0B"
                strokeWidth="2.5"
                strokeDasharray="3 3"
                strokeLinecap="round"
              />
              <circle cx="22" cy="11" r="2.2" fill="#10B981" />
            </svg>
            <div>
              <span className="text-lg font-extrabold tracking-tight text-slate-50">
                RoadWindow 360
              </span>
              <p className="text-xs text-slate-400">
                전 세계 거리뷰 & 항공뷰 내비게이션 드라이브
              </p>
            </div>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold tracking-tight text-slate-50 leading-[1.15] [text-wrap:balance] [word-break:keep-all]">
            택시 창밖 360°로 달리는
            <br />
            실제 도로 가상 드라이브
          </h1>

          <p className="text-sm sm:text-base text-slate-300 max-w-lg leading-relaxed [word-break:keep-all]">
            내 위치에서 삼성 코엑스부터 도쿄·뉴욕·파리까지. 실제 내비게이션 경로를 따라 360° 거리뷰와 45° 위성 항공뷰를 오가며 드라이브하세요.
          </p>

          {/* Curated Global Presets & Regional Challenge Courses */}
          <div className="pt-2 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div
                role="group"
                aria-label="코스 유형 선택"
                className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#121824]/95 border border-slate-800"
              >
                <button
                  type="button"
                  onClick={() => setCourseTab('global')}
                  className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    courseTab === 'global'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>글로벌 추천 코스</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCourseTab('challenge')}
                  className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    courseTab === 'challenge'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5" />
                  <span>챌린지 코스</span>
                </button>
              </div>
            </div>

            {courseTab === 'global' ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {GLOBAL_ROUTE_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    disabled={isStarting}
                    onClick={() => onSelectPreset(preset)}
                    className="text-left p-3 rounded-xl bg-[#121824]/90 hover:bg-[#192234] border border-slate-800 hover:border-amber-400/60 transition-colors group disabled:opacity-50"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-slate-100 group-hover:text-amber-300 truncate">
                        {preset.title}
                      </span>
                      <span className="text-[11px] text-slate-500 whitespace-nowrap shrink-0">
                        {preset.regionTag}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-1 truncate">
                      {preset.subtitle}
                    </p>
                  </button>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {CHALLENGE_COURSES.map((course) => {
                  const best = challengeBestScores[course.id] ?? 0;
                  return (
                    <button
                      key={course.id}
                      type="button"
                      disabled={isStarting}
                      onClick={() => onSelectChallenge(course)}
                      className="text-left p-3 rounded-xl bg-[#121824]/90 hover:bg-[#192234] border border-slate-800 hover:border-emerald-400/60 transition-colors group disabled:opacity-50"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-xs font-bold text-slate-100 group-hover:text-emerald-300 truncate">
                          {course.title}
                        </span>
                        <span className="text-[11px] text-slate-400 whitespace-nowrap shrink-0">
                          {course.difficulty}
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 mt-1 truncate">
                        {course.subtitle}
                      </p>
                      <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px] font-mono-tabular">
                        <span className="text-slate-500">{course.regionTag}</span>
                        <span
                          className={
                            best > 0
                              ? 'text-emerald-300 font-semibold'
                              : 'text-amber-300/80'
                          }
                        >
                          {best > 0
                            ? `최고 ${best.toLocaleString()} pts`
                            : `목표 ${course.targetScore.toLocaleString()} pts`}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Right Column: Route Planner Launch Card */}
        <section className="lg:col-span-6">
          <div className="rounded-2xl bg-[#101622]/95 border border-slate-800 p-5 sm:p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-bold text-slate-100">
                경로 설정 및 출발
              </h2>

              <div
                role="group"
                aria-label="이동 수단 선택"
                className="flex items-center gap-1 p-1 rounded-xl bg-[#161D29] border border-slate-800"
              >
                <button
                  type="button"
                  onClick={() => onChangeTravelMode('DRIVING')}
                  className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    travelMode === 'DRIVING'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <CarFront className="w-3.5 h-3.5" />
                  <span>자동차</span>
                </button>
                <button
                  type="button"
                  onClick={() => onChangeTravelMode('WALKING')}
                  className={`min-h-[34px] px-2.5 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap transition-colors ${
                    travelMode === 'WALKING'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Footprints className="w-3.5 h-3.5" />
                  <span>도보</span>
                </button>
              </div>
            </div>

            <div className="space-y-3.5">
              <PlaceSearchInput
                label="출발지"
                placeholder="예: 강남역, 내 위치, Times Square..."
                value={origin}
                onSelect={onSelectOrigin}
                showGpsButton={true}
                onUseCurrentLocation={onUseCurrentLocation}
                gpsLoading={gpsLoading}
                accentColor="emerald"
              />

              <PlaceSearchInput
                label="목적지"
                placeholder="예: 삼성 코엑스, 남산서울타워, 에펠탑..."
                value={destination}
                onSelect={onSelectDestination}
                accentColor="amber"
              />
            </div>

            {errorMessage && (
              <div
                role="alert"
                className="rounded-xl bg-rose-500/10 border border-rose-500/40 px-3.5 py-2.5 text-xs text-rose-200"
              >
                {errorMessage}
              </div>
            )}

            <button
              type="button"
              data-start="true"
              disabled={isStarting}
              onClick={onStartDrive}
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-60"
            >
              {isStarting ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                  <span>실제 도로 경로 계산 중...</span>
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4" />
                  <span>주행 시작하기 (거리뷰 · 항공뷰)</span>
                </>
              )}
            </button>

            <div className="pt-1 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400">
              <span className="flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>주행 중 Google 지도 기반 AI 주변 안내 지원</span>
              </span>

              <button
                type="button"
                onClick={onOpenHistoryDashboard}
                className="min-h-[36px] px-3 py-1 rounded-lg bg-[#161D29] hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-200 hover:text-amber-300 inline-flex items-center gap-1.5 whitespace-nowrap transition-colors"
              >
                <BarChart3 className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>
                  {tripCount > 0 ? `주행 기록 (${tripCount})` : '주행 기록 대시보드'}
                </span>
              </button>
            </div>
          </div>
        </section>
      </div>

      {/* Flat bottom control hint line */}
      <footer className="relative z-10 w-full text-center px-4 pb-5 text-xs text-slate-400">
        W/↑ 가속 · S/↓ 브레이크 · 화면 드래그 360° 시선 · M 음소거 · P 일시정지
      </footer>
    </main>
  );
};
