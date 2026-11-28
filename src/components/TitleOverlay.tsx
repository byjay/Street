import React, { useState } from 'react';
import {
  BarChart3,
  CarFront,
  Columns2,
  Compass,
  Eye,
  Footprints,
  Globe,
  Layers,
  Map as MapIcon,
  MapPin,
  Navigation,
  Plane,
  PlaneTakeoff,
  Route,
  Sparkles,
  Trophy,
} from 'lucide-react';
import { CHALLENGE_COURSES, GLOBAL_ROUTE_PRESETS } from '../data/presets';
import {
  isFreeProvider,
  type CameraViewMode,
  type ChallengeCourse,
  type GlobalRoutePreset,
  type MapProviderMode,
  type SelectedPlaceInfo,
  type TransportMode,
} from '../types/drive';
import { PlaceSearchInput } from './PlaceSearchInput';

interface TitleOverlayProps {
  origin: SelectedPlaceInfo | null;
  destination: SelectedPlaceInfo | null;
  onSelectOrigin: (place: SelectedPlaceInfo) => void;
  onSelectDestination: (place: SelectedPlaceInfo) => void;
  onUseCurrentLocation: () => void;
  gpsLoading: boolean;
  activeTransport: TransportMode;
  onChangeTransport: (mode: TransportMode) => void;
  initialViewMode: CameraViewMode;
  onChangeInitialViewMode: (mode: CameraViewMode) => void;
  mapProvider: MapProviderMode;
  onChangeMapProvider: (mode: MapProviderMode) => void;
  placesLib?: google.maps.PlacesLibrary | null;
  hasGoogleKey: boolean;
  onStartDrive: () => void;
  onStartBusanSeoulFlight: () => void;
  onStartMultiLegJourney: () => void;
  onSelectPreset: (preset: GlobalRoutePreset) => void;
  onSelectChallenge: (course: ChallengeCourse) => void;
  challengeBestScores: Record<string, number>;
  isStarting: boolean;
  errorMessage: string | null;
  onOpenHistoryDashboard: () => void;
  tripCount: number;
}

const VIEW_MODE_OPTIONS: Array<{
  key: CameraViewMode;
  label: string;
  sub: string;
}> = [
  { key: 'streetview', label: '거리뷰', sub: '실사·360°' },
  { key: 'split', label: '듀얼', sub: '거리+항공' },
  { key: 'aerial', label: '항공', sub: '위성 45°' },
  { key: 'map', label: '지도', sub: '경로 2D' },
];

export const TitleOverlay: React.FC<TitleOverlayProps> = ({
  origin,
  destination,
  onSelectOrigin,
  onSelectDestination,
  onUseCurrentLocation,
  gpsLoading,
  activeTransport,
  onChangeTransport,
  initialViewMode,
  onChangeInitialViewMode,
  mapProvider,
  onChangeMapProvider,
  placesLib = null,
  hasGoogleKey,
  onStartDrive,
  onStartBusanSeoulFlight,
  onStartMultiLegJourney,
  onSelectPreset,
  onSelectChallenge,
  challengeBestScores,
  isStarting,
  errorMessage,
  onOpenHistoryDashboard,
  tripCount,
}) => {
  const [courseTab, setCourseTab] = useState<'global' | 'challenge'>('global');
  const isFree = isFreeProvider(mapProvider);

  return (
    <main className="relative w-full h-full min-h-screen overflow-y-auto cockpit-scroll bg-[#0A0D12] flex flex-col justify-between">
      {/* Generated Key-Art Backdrop with Measured Scrim */}
      <div className="fixed inset-0 z-0 pointer-events-none">
        <img
          src="/src/assets/images/title_cockpit_horizon_1795532370356.jpg"
          alt="야간 해안 고속도로를 주행하는 차량 실내 운전석 시점"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover opacity-50"
        />
        <div className="absolute inset-0 bg-gradient-to-r from-[#0A0D12]/96 via-[#0A0D12]/82 to-[#0A0D12]/58" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#0A0D12] via-transparent to-[#0A0D12]/75" />
      </div>

      {/* App-Style Top Navigation Bar */}
      <header className="relative z-10 w-full max-w-6xl mx-auto px-4 pt-4 sm:px-8 sm:pt-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <svg
            viewBox="0 0 44 44"
            className="w-10 h-10 shrink-0"
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
          <div className="min-w-0">
            <span className="text-base sm:text-lg font-extrabold tracking-tight text-slate-50 block truncate">
              RoadWindow 360
            </span>
            <p className="text-[11px] text-slate-400 truncate">
              실사 거리뷰 · 3D 항공 비행 · 무료 & Google 듀얼 내비게이션
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onStartBusanSeoulFlight}
            className="min-h-[40px] px-3 rounded-xl bg-sky-500/15 hover:bg-sky-500/25 border border-sky-400/50 text-xs font-bold text-sky-300 flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <PlaneTakeoff className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline">부산→서울 비행</span>
          </button>

          <button
            type="button"
            onClick={onOpenHistoryDashboard}
            className="min-h-[40px] px-3 rounded-xl bg-[#121824]/95 hover:bg-slate-800 border border-slate-700/80 text-xs font-semibold text-slate-200 hover:text-amber-300 flex items-center gap-1.5 whitespace-nowrap transition-colors"
          >
            <BarChart3 className="w-4 h-4 text-amber-400 shrink-0" />
            <span>{tripCount > 0 ? `기록 ${tripCount}` : '주행 기록'}</span>
          </button>
        </div>
      </header>

      {/* Main Content Container */}
      <div className="relative z-10 w-full max-w-6xl mx-auto px-4 py-6 sm:px-8 md:py-8 my-auto grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
        {/* Left Column: Editorial Headline + Sky-to-Ground Journey + Curated Presets */}
        <section className="lg:col-span-6 space-y-5">
          <div className="space-y-3">
            <h1 className="text-2xl sm:text-4xl lg:text-[42px] font-extrabold tracking-tight text-slate-50 leading-[1.15] [text-wrap:balance] [word-break:keep-all]">
              하늘에서 도로까지
              <br />
              실제 거리뷰 & 3D 비행
            </h1>

            <p className="text-xs sm:text-sm text-slate-300 max-w-lg leading-relaxed [word-break:keep-all]">
              김해(PUS)에서 김포(GMP)까지 3D 항공 비행 후, 실제 도로 위 실사 거리뷰·도보·드라이브로 매끄럽게 이어지는 가상 여행을 떠나보세요.
            </p>
          </div>

          {/* Busan -> Seoul Featured Multi-Leg Journey Card */}
          <div className="rounded-2xl bg-[#111826]/92 backdrop-blur-md border border-sky-500/35 p-4 space-y-3 shadow-xl">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-sky-500/15 border border-sky-400/40 flex items-center justify-center text-sky-300">
                  <PlaneTakeoff className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-bold text-slate-100">
                    부산 김해 PUS → 서울 김포 GMP
                  </h2>
                  <p className="text-[11px] text-slate-400">
                    7개 랜드마크 3D 비행 + 김포공항→광화문→북촌 연속 여정
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                data-testid="launch-flight-btn"
                onClick={onStartBusanSeoulFlight}
                className="min-h-[42px] px-3 rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <Plane className="w-4 h-4 shrink-0" />
                <span>3D 항공 비행 시작</span>
              </button>
              <button
                type="button"
                data-testid="launch-multileg-btn"
                onClick={onStartMultiLegJourney}
                className="min-h-[42px] px-3 rounded-xl bg-[#182235] hover:bg-[#1E2B42] border border-emerald-400/45 text-emerald-300 font-bold text-xs flex items-center justify-center gap-1.5 transition-colors"
              >
                <Route className="w-4 h-4 shrink-0" />
                <span>풀 여정 (비행+차+도보)</span>
              </button>
            </div>
          </div>

          {/* Curated Global Presets & Regional Challenge Courses */}
          <div className="space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <div
                role="group"
                aria-label="코스 유형 선택"
                className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#121824]/95 border border-slate-800"
              >
                <button
                  type="button"
                  onClick={() => setCourseTab('global')}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    courseTab === 'global'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Compass className="w-3.5 h-3.5" />
                  <span>추천 코스</span>
                </button>
                <button
                  type="button"
                  onClick={() => setCourseTab('challenge')}
                  className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-colors ${
                    courseTab === 'challenge'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Trophy className="w-3.5 h-3.5" />
                  <span>챌린지</span>
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
                      <span className="text-xs font-bold text-slate-100 group-hover:text-amber-300 flex items-center gap-1.5 truncate">
                        {preset.travelMode === 'WALKING' ? (
                          <Footprints className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                        ) : (
                          <CarFront className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                        )}
                        <span className="truncate">{preset.title}</span>
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
                        <span className="text-xs font-bold text-slate-100 group-hover:text-emerald-300 flex items-center gap-1.5 truncate">
                          <Trophy className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                          <span className="truncate">{course.title}</span>
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

        {/* Right Column: Iconified Route & View Planner Launch Card */}
        <section className="lg:col-span-6">
          <div className="rounded-2xl bg-[#101622]/95 backdrop-blur-md border border-slate-800 p-4 sm:p-6 shadow-2xl space-y-4">
            {/* 3 Transport Mode Icon Tiles */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                <Navigation className="w-3.5 h-3.5 text-amber-400" />
                <span>이동 수단</span>
              </span>
              <div
                role="group"
                aria-label="이동 수단 선택"
                className="grid grid-cols-3 gap-1.5 p-1 rounded-xl bg-[#151D2B] border border-slate-800"
              >
                <button
                  type="button"
                  data-testid="transport-drive-btn"
                  onClick={() => onChangeTransport('drive')}
                  className={`min-h-[42px] px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                    activeTransport === 'drive'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <CarFront className="w-4 h-4 shrink-0" />
                  <span>차량</span>
                </button>
                <button
                  type="button"
                  data-testid="transport-walk-btn"
                  onClick={() => onChangeTransport('walk')}
                  className={`min-h-[42px] px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                    activeTransport === 'walk'
                      ? 'bg-emerald-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Footprints className="w-4 h-4 shrink-0" />
                  <span>도보</span>
                </button>
                <button
                  type="button"
                  data-testid="transport-flight-btn"
                  onClick={() => onChangeTransport('flight')}
                  className={`min-h-[42px] px-2 py-1.5 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors ${
                    activeTransport === 'flight'
                      ? 'bg-sky-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  <Plane className="w-4 h-4 shrink-0" />
                  <span>비행기</span>
                </button>
              </div>
            </div>

            {/* 3-Provider Engine Switcher (Google 360° ALWAYS clickable) */}
            <div className="rounded-xl bg-[#141B27] border border-slate-800/90 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                  <Layers className="w-3.5 h-3.5 text-emerald-400" />
                  <span>지도·거리뷰 엔진</span>
                </span>
                {!hasGoogleKey && (
                  <span className="text-[10px] text-amber-300/80">
                    Google 키 미설정 시 안내 표시
                  </span>
                )}
              </div>

              <div
                role="group"
                aria-label="지도 API 엔진 선택"
                className="grid grid-cols-3 gap-1.5"
              >
                <button
                  type="button"
                  data-testid="provider-free-kr-btn"
                  onClick={() => onChangeMapProvider('free-kr')}
                  className={`min-h-[38px] px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border ${
                    mapProvider === 'free-kr'
                      ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                      : 'bg-[#0D121A] text-slate-300 border-slate-800 hover:text-white'
                  }`}
                >
                  <MapPin className="w-3.5 h-3.5 shrink-0" />
                  <span>무료·국내</span>
                </button>

                <button
                  type="button"
                  data-testid="provider-free-global-btn"
                  onClick={() => onChangeMapProvider('free-global')}
                  className={`min-h-[38px] px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border ${
                    mapProvider === 'free-global'
                      ? 'bg-sky-500 text-slate-950 border-sky-400'
                      : 'bg-[#0D121A] text-slate-300 border-slate-800 hover:text-white'
                  }`}
                >
                  <Globe className="w-3.5 h-3.5 shrink-0" />
                  <span>무료·글로벌</span>
                </button>

                <button
                  type="button"
                  data-testid="provider-google-btn"
                  onClick={() => onChangeMapProvider('google')}
                  className={`min-h-[38px] px-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition-colors border ${
                    mapProvider === 'google'
                      ? 'bg-amber-500 text-slate-950 border-amber-400'
                      : 'bg-[#0D121A] text-slate-200 border-slate-700 hover:border-amber-400/60 hover:text-amber-300'
                  }`}
                >
                  <Eye className="w-3.5 h-3.5 shrink-0" />
                  <span>Google 360°</span>
                </button>
              </div>

              <p className="text-[11px] text-slate-400 leading-snug [word-break:keep-all]">
                {mapProvider === 'free-kr'
                  ? '실사 거리뷰 사진(카카오·KartaView·Wikimedia) + OSRM/카카오 경로 + 위성 항공뷰'
                  : mapProvider === 'free-global'
                    ? '전 세계 무료 실사 거리뷰 사진(Mapillary·KartaView·Wikimedia) + OSRM 경로'
                    : hasGoogleKey
                      ? 'Google 공식 360° 실사 거리뷰 파노라마 & 3D Earth 항공뷰 사용 중'
                      : 'Google 360° 실사 파노라마는 Google Maps API 키 설정 시 활성화됩니다'}
              </p>
            </div>

            {activeTransport === 'flight' ? (
              <div className="rounded-xl bg-[#151D2B] border border-sky-500/40 p-4 space-y-2.5">
                <div className="flex items-center gap-2 text-sky-300 font-bold text-sm">
                  <PlaneTakeoff className="w-4 h-4 shrink-0" />
                  <span>김해(PUS) → 김포(GMP) 3D 항공 항로</span>
                </div>
                <p className="text-xs text-slate-300 leading-relaxed [word-break:keep-all]">
                  김해국제공항을 이륙해 영남알프스·팔공산·추풍령·대청호를 거쳐 서울 김포공항에 착륙합니다. 비행 중 언제든 <strong className="text-amber-300">거리뷰 다이브</strong>로 지상 실사 도로에 착지할 수 있습니다.
                </p>
              </div>
            ) : (
              <>
                {/* Explicit Initial View Mode / Street View Selector */}
                <div className="space-y-1.5">
                  <span className="text-[11px] font-semibold text-slate-400 flex items-center gap-1.5">
                    <Eye className="w-3.5 h-3.5 text-amber-400" />
                    <span>출발 시 화면 시점 (실사 거리뷰 옵션)</span>
                  </span>
                  <div
                    role="group"
                    aria-label="출발 시 카메라 뷰 선택"
                    className="grid grid-cols-4 gap-1.5"
                  >
                    {VIEW_MODE_OPTIONS.map((opt) => {
                      const active = initialViewMode === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          data-testid={`initial-view-${opt.key}`}
                          onClick={() => onChangeInitialViewMode(opt.key)}
                          className={`min-h-[48px] px-1.5 py-1.5 rounded-xl border flex flex-col items-center justify-center gap-0.5 transition-colors ${
                            active
                              ? 'bg-amber-500 text-slate-950 border-amber-400 font-bold'
                              : 'bg-[#151D2B] text-slate-300 border-slate-800 hover:border-slate-600'
                          }`}
                        >
                          {opt.key === 'streetview' ? (
                            <Eye className="w-4 h-4" />
                          ) : opt.key === 'split' ? (
                            <Columns2 className="w-4 h-4" />
                          ) : opt.key === 'aerial' ? (
                            <Plane className="w-4 h-4" />
                          ) : (
                            <MapIcon className="w-4 h-4" />
                          )}
                          <span className="text-[11px] leading-tight">
                            {opt.label}
                          </span>
                          <span
                            className={`text-[9px] leading-none ${
                              active ? 'text-slate-900/80' : 'text-slate-500'
                            }`}
                          >
                            {opt.sub}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-3">
                  <PlaceSearchInput
                    label="출발지"
                    placeholder="예: 강남역, 내 위치, Times Square..."
                    value={origin}
                    onSelect={onSelectOrigin}
                    mapProvider={mapProvider}
                    placesLib={placesLib}
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
                    mapProvider={mapProvider}
                    placesLib={placesLib}
                    accentColor="amber"
                  />
                </div>
              </>
            )}

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
              onClick={
                activeTransport === 'flight'
                  ? onStartBusanSeoulFlight
                  : onStartDrive
              }
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-amber-500 hover:bg-amber-400 active:scale-[0.99] text-slate-950 font-bold text-sm flex items-center justify-center gap-2 shadow-lg transition-all disabled:opacity-60"
            >
              {isStarting ? (
                <>
                  <div className="w-4 h-4 border-2 border-slate-950/30 border-t-slate-950 rounded-full animate-spin" />
                  <span>경로 계산 중...</span>
                </>
              ) : activeTransport === 'flight' ? (
                <>
                  <PlaneTakeoff className="w-4 h-4" />
                  <span>김해→김포 3D 비행 이륙하기</span>
                </>
              ) : (
                <>
                  <Navigation className="w-4 h-4" />
                  <span>
                    {activeTransport === 'walk'
                      ? '도보 거리뷰 출발하기'
                      : isFree
                        ? '실사 거리뷰 · 3D 드라이브 시작'
                        : 'Google 360° 드라이브 시작'}
                  </span>
                </>
              )}
            </button>

            <div className="pt-0.5 flex items-center gap-2 text-xs text-slate-400">
              <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
              <span className="truncate">
                {isFree
                  ? '실사 거리뷰 사진과 OSM 주변 명소 AI 안내 기본 탑재'
                  : 'Google 지도 기반 실시간 AI 주변 가이드 지원'}
              </span>
            </div>
          </div>
        </section>
      </div>

      {/* Bottom Hint Bar */}
      <footer className="relative z-10 w-full text-center px-4 pb-4 text-[11px] text-slate-400">
        W/↑ 가속 · S/↓ 감속 · 드래그 시선 이동 · 비행 시 1~4 카메라 전환 · M 음소거 · P 일시정지
      </footer>
    </main>
  );
};
