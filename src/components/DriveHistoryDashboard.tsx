import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Award,
  BarChart3,
  Clock,
  Compass,
  Flag,
  Home,
  MapPin,
  Medal,
  Navigation,
  Play,
  RotateCcw,
  Sparkles,
  Trash2,
  Trophy,
  X,
} from 'lucide-react';
import { CHALLENGE_COURSES } from '../data/presets';
import { formatDistanceKr } from '../engine/routeSimulation';
import type {
  CameraViewMode,
  ChallengeCourse,
  DriveTripRecord,
} from '../types/drive';
import {
  aggregateChallengeLeaderboard,
  aggregateDriveHistory,
  downsampleTelemetryForChart,
  formatElapsedClock,
} from '../utils/tripAnalytics';

interface DriveHistoryDashboardProps {
  isOpen: boolean;
  trips: DriveTripRecord[];
  activeTripId: string | null;
  isResolvingRegions?: boolean;
  onSelectTrip: (tripId: string) => void;
  onClose: () => void;
  onClearHistory: () => void;
  onRestartDrive?: () => void;
  onReturnToTitle?: () => void;
  onOpenDestinationGuide?: () => void;
  onStartChallenge?: (course: ChallengeCourse) => void;
}

const VIEW_MODE_COLORS: Record<CameraViewMode, string> = {
  streetview: '#F59E0B',
  aerial: '#38BDF8',
  split: '#10B981',
  map: '#94A3B8',
};

export const DriveHistoryDashboard: React.FC<DriveHistoryDashboardProps> = ({
  isOpen,
  trips,
  activeTripId,
  isResolvingRegions = false,
  onSelectTrip,
  onClose,
  onClearHistory,
  onRestartDrive,
  onReturnToTitle,
  onOpenDestinationGuide,
  onStartChallenge,
}) => {
  const [scope, setScope] = useState<'trip' | 'all' | 'challenge'>(
    activeTripId ? 'trip' : 'all'
  );
  const [selectedChallengeId, setSelectedChallengeId] = useState<string>(
    CHALLENGE_COURSES[0]?.id ?? ''
  );
  const [confirmClear, setConfirmClear] = useState(false);

  const selectedTrip = useMemo(() => {
    if (trips.length === 0) return null;
    return trips.find((t) => t.id === activeTripId) ?? trips[0];
  }, [trips, activeTripId]);

  useEffect(() => {
    if (isOpen) {
      setScope(activeTripId ? 'trip' : 'all');
      setConfirmClear(false);
    }
  }, [isOpen, activeTripId]);

  const effectiveScope: 'trip' | 'all' | 'challenge' =
    scope === 'challenge'
      ? 'challenge'
      : scope === 'trip' && selectedTrip
        ? 'trip'
        : 'all';

  const challengeLeaderboard = useMemo(
    () => aggregateChallengeLeaderboard(trips, CHALLENGE_COURSES),
    [trips]
  );

  useEffect(() => {
    if (selectedTrip?.challengeId) {
      setSelectedChallengeId(selectedTrip.challengeId);
    } else if (challengeLeaderboard[0]) {
      setSelectedChallengeId(challengeLeaderboard[0].course.id);
    }
  }, [selectedTrip, challengeLeaderboard]);

  const activeChallengeBoard = useMemo(
    () =>
      challengeLeaderboard.find((b) => b.course.id === selectedChallengeId) ??
      challengeLeaderboard[0] ??
      null,
    [challengeLeaderboard, selectedChallengeId]
  );

  const challengeChartData = useMemo(
    () =>
      challengeLeaderboard.map((item) => ({
        name:
          item.course.title.length > 10
            ? `${item.course.title.slice(0, 9)}…`
            : item.course.title,
        fullName: item.course.title,
        bestScore: item.bestScore,
        targetScore: item.course.targetScore,
      })),
    [challengeLeaderboard]
  );

  const challengeCompletedCourses = useMemo(
    () => challengeLeaderboard.filter((b) => b.completedCount > 0).length,
    [challengeLeaderboard]
  );
  const challengeTotalAttempts = useMemo(
    () => challengeLeaderboard.reduce((sum, b) => sum + b.attemptCount, 0),
    [challengeLeaderboard]
  );
  const topChallengeBoard =
    challengeLeaderboard.find((b) => b.bestScore > 0) ?? null;

  const scopedTrips = useMemo(() => {
    if (effectiveScope === 'trip' && selectedTrip) {
      return [selectedTrip];
    }
    return trips;
  }, [effectiveScope, selectedTrip, trips]);

  const summary = useMemo(
    () => aggregateDriveHistory(scopedTrips),
    [scopedTrips]
  );

  const speedChartData = useMemo((): Array<{
    xLabel: string;
    yValue: number;
  }> => {
    if (effectiveScope === 'trip' && selectedTrip) {
      return downsampleTelemetryForChart(selectedTrip.telemetry, 20).map(
        (pt) => ({
          xLabel: pt.stepLabel,
          yValue: pt.speedKmh,
        })
      );
    }
    return summary.tripTrendData.map((pt) => ({
      xLabel: pt.label,
      yValue: pt.distanceKm,
    }));
  }, [effectiveScope, selectedTrip, summary.tripTrendData]);

  const useMetersForRegions = useMemo(
    () =>
      summary.regionStats.length > 0 &&
      summary.regionStats.every((item) => item.distanceMeters < 1000),
    [summary.regionStats]
  );

  const regionChartData = useMemo(
    () =>
      summary.regionStats.slice(0, 6).map((item) => ({
        name:
          item.region.length > 14
            ? `${item.region.slice(0, 13)}…`
            : item.region,
        fullName: item.region,
        distanceValue: useMetersForRegions
          ? Math.max(1, Math.round(item.distanceMeters))
          : Number((item.distanceMeters / 1000).toFixed(2)),
        visits: item.visits,
      })),
    [summary.regionStats, useMetersForRegions]
  );

  if (!isOpen) return null;

  const primaryMode = summary.viewModeBreakdown[0];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="주행 기록 분석 대시보드"
      data-testid="drive-history-dashboard"
      className="fixed inset-0 z-[70] bg-[#070A0F]/90 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 overflow-y-auto"
    >
      <div className="w-full max-w-5xl rounded-2xl bg-[#0E131D] border border-slate-800 shadow-2xl overflow-hidden my-auto max-h-[92vh] flex flex-col">
        {/* Top Bar (Strict 3-zone header: Title · Scope Tabs · Actions) */}
        <header className="flex flex-wrap items-center justify-between gap-3 px-4 sm:px-6 py-4 border-b border-slate-800 bg-[#0B0F17] shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-lg bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center shrink-0">
              <BarChart3 className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-base sm:text-lg font-bold text-slate-50 truncate">
                주행 기록 대시보드
              </h2>
              <p className="text-xs text-slate-400 truncate">
                {effectiveScope === 'challenge'
                  ? `지역 명소 챌린지 ${CHALLENGE_COURSES.length}개 코스 최고 점수 & 순위`
                  : selectedTrip && effectiveScope === 'trip'
                    ? `${
                        selectedTrip.challengeTitle
                          ? `[챌린지] ${selectedTrip.challengeTitle} · ${selectedTrip.score.toLocaleString()} pts · `
                          : ''
                      }${selectedTrip.originName} → ${selectedTrip.destinationName} · ${
                        selectedTrip.completed ? '목적지 도착 완료' : '주행 종료 기록'
                      }`
                    : `전체 누적 주행 ${summary.totalTrips}건 분석`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div
              role="group"
              aria-label="분석 범위 선택"
              className="flex items-center gap-1 p-1 rounded-lg bg-[#141B28] border border-slate-800"
            >
              {selectedTrip && (
                <button
                  type="button"
                  onClick={() => setScope('trip')}
                  className={`min-h-[34px] px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                    effectiveScope === 'trip'
                      ? 'bg-amber-500 text-slate-950'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  이번 주행
                </button>
              )}
              <button
                type="button"
                onClick={() => setScope('all')}
                className={`min-h-[34px] px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold whitespace-nowrap transition-colors ${
                  effectiveScope === 'all'
                    ? 'bg-amber-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                전체 누적 ({trips.length})
              </button>
              <button
                type="button"
                onClick={() => setScope('challenge')}
                className={`min-h-[34px] px-2.5 sm:px-3 py-1 rounded-md text-xs font-semibold inline-flex items-center gap-1 whitespace-nowrap transition-colors ${
                  effectiveScope === 'challenge'
                    ? 'bg-emerald-500 text-slate-950'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                <Trophy className="w-3.5 h-3.5 shrink-0" />
                <span>챌린지 순위</span>
              </button>
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="대시보드 닫기"
              className="min-w-[40px] min-h-[40px] rounded-lg border border-slate-800 hover:border-slate-600 text-slate-300 hover:text-white flex items-center justify-center transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </header>

        {/* Scrollable Content */}
        <div className="flex-1 overflow-y-auto cockpit-scroll p-4 sm:p-6 space-y-6">
          {effectiveScope === 'challenge' ? (
            <>
              {/* Challenge KPI Strip */}
              <section
                aria-label="챌린지 핵심 지표"
                className="grid grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-xl bg-[#111723] divide-y lg:divide-y-0 lg:divide-x divide-slate-800 overflow-hidden"
              >
                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Trophy className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>완주한 챌린지</span>
                  </div>
                  <p
                    data-testid="challenge-completed-count"
                    className="font-mono-tabular text-2xl font-bold text-slate-50"
                  >
                    {challengeCompletedCourses} / {CHALLENGE_COURSES.length}
                  </p>
                  <p className="text-xs text-slate-400">등록된 명소 코스</p>
                </div>

                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Award className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>최고 챌린지 점수</span>
                  </div>
                  <p
                    data-testid="challenge-top-score"
                    className="font-mono-tabular text-2xl font-bold text-amber-400"
                  >
                    {topChallengeBoard
                      ? `${topChallengeBoard.bestScore.toLocaleString()} pts`
                      : '0 pts'}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {topChallengeBoard
                      ? topChallengeBoard.course.title
                      : '아직 챌린지 기록 없음'}
                  </p>
                </div>

                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Flag className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>총 챌린지 도전</span>
                  </div>
                  <p className="font-mono-tabular text-2xl font-bold text-slate-50">
                    {challengeTotalAttempts}회
                  </p>
                  <p className="text-xs text-slate-400">누적 시도 횟수</p>
                </div>

                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Medal className="w-3.5 h-3.5 text-emerald-300 shrink-0" />
                    <span>현재 종합 1위</span>
                  </div>
                  <p className="text-base font-bold text-slate-100 truncate pt-1">
                    {topChallengeBoard ? topChallengeBoard.course.title : '도전 대기'}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {topChallengeBoard
                      ? topChallengeBoard.course.regionTag
                      : '아래 코스에서 시작하세요'}
                  </p>
                </div>
              </section>

              {/* Challenge High-Score vs Target BarChart */}
              <section className="rounded-xl border border-slate-800 bg-[#111723] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      챌린지 코스별 최고 점수 비교
                    </h3>
                    <p className="text-xs text-slate-400">
                      코스별 달성 최고 점수(주황)와 권장 목표 점수(회색) 비교
                    </p>
                  </div>
                </div>

                <div className="w-full h-56" data-testid="chart-challenge-bar">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={challengeChartData}
                      margin={{ top: 8, right: 16, left: -12, bottom: 0 }}
                    >
                      <CartesianGrid
                        stroke="#1E293B"
                        strokeDasharray="3 3"
                        vertical={false}
                      />
                      <XAxis
                        dataKey="name"
                        stroke="#64748B"
                        tick={{ fill: '#E2E8F0', fontSize: 11 }}
                        tickLine={false}
                      />
                      <YAxis
                        stroke="#64748B"
                        tick={{ fill: '#94A3B8', fontSize: 11 }}
                        tickLine={false}
                      />
                      <Tooltip
                        contentStyle={{
                          backgroundColor: '#0B1018',
                          borderColor: '#334155',
                          borderRadius: '0.75rem',
                          fontSize: '12px',
                          color: '#F8FAFC',
                        }}
                        formatter={(val: unknown, name: unknown) => [
                          `${Number(val).toLocaleString()} pts`,
                          name === 'bestScore' ? '최고 점수' : '목표 점수',
                        ]}
                      />
                      <Bar
                        dataKey="targetScore"
                        name="targetScore"
                        fill="#334155"
                        radius={[4, 4, 0, 0]}
                        barSize={18}
                      />
                      <Bar
                        dataKey="bestScore"
                        name="bestScore"
                        fill="#F59E0B"
                        radius={[4, 4, 0, 0]}
                        barSize={18}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </section>

              {/* Challenge Course Ranking + Selected Course Top Runs */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <section
                  data-testid="challenge-ranking-list"
                  className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111723] p-4 space-y-3"
                >
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      챌린지 코스 종합 순위
                    </h3>
                    <p className="text-xs text-slate-400">
                      최고 점수 순으로 정렬된 코스 목록 · 클릭해 상세 순위를 확인하세요
                    </p>
                  </div>

                  <div className="divide-y divide-slate-800/80 border-t border-b border-slate-800/80">
                    {challengeLeaderboard.map((entry, idx) => {
                      const isSelected =
                        activeChallengeBoard?.course.id === entry.course.id;
                      const beatTarget =
                        entry.bestScore >= entry.course.targetScore;
                      return (
                        <div
                          key={entry.course.id}
                          className={`py-2.5 px-2 flex flex-wrap items-center justify-between gap-2 transition-colors ${
                            isSelected ? 'bg-amber-500/10' : ''
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setSelectedChallengeId(entry.course.id)
                            }
                            className="flex items-center gap-3 min-w-0 flex-1 text-left"
                          >
                            <span
                              className={`w-6 h-6 rounded-md font-mono-tabular text-xs font-bold flex items-center justify-center shrink-0 ${
                                idx === 0 && entry.bestScore > 0
                                  ? 'bg-amber-500 text-slate-950'
                                  : idx === 1 && entry.bestScore > 0
                                    ? 'bg-slate-300 text-slate-950'
                                    : idx === 2 && entry.bestScore > 0
                                      ? 'bg-amber-700 text-amber-50'
                                      : 'bg-slate-800 text-slate-400'
                              }`}
                            >
                              {idx + 1}
                            </span>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-bold text-slate-100 truncate">
                                  {entry.course.title}
                                </span>
                                <span className="text-[11px] text-slate-400 shrink-0">
                                  {entry.course.difficulty}
                                </span>
                              </div>
                              <p className="text-[11px] text-slate-400 truncate">
                                {entry.course.regionTag} · 도전 {entry.attemptCount}회 · 완주 {entry.completedCount}회
                              </p>
                            </div>
                          </button>

                          <div className="flex items-center gap-2.5 shrink-0">
                            <div className="text-right">
                              <span
                                className={`block font-mono-tabular text-xs font-bold ${
                                  beatTarget
                                    ? 'text-emerald-300'
                                    : entry.bestScore > 0
                                      ? 'text-amber-300'
                                      : 'text-slate-500'
                                }`}
                              >
                                {entry.bestScore > 0
                                  ? `${entry.bestScore.toLocaleString()} pts`
                                  : '미도전'}
                              </span>
                              <span className="block font-mono-tabular text-[11px] text-slate-500">
                                목표 {entry.course.targetScore.toLocaleString()}
                              </span>
                            </div>

                            {onStartChallenge && (
                              <button
                                type="button"
                                onClick={() => onStartChallenge(entry.course)}
                                className="min-h-[34px] px-2.5 rounded-lg bg-[#192232] hover:bg-emerald-500 hover:text-slate-950 border border-slate-700 text-xs font-semibold text-emerald-300 inline-flex items-center gap-1 transition-colors"
                              >
                                <Play className="w-3 h-3 fill-current" />
                                <span>도전</span>
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* Per-Course Top Runs Leaderboard */}
                <section
                  data-testid="challenge-course-runs"
                  className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111723] p-4 flex flex-col justify-between space-y-3"
                >
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100">
                        {activeChallengeBoard
                          ? `${activeChallengeBoard.course.title} 기록 순위`
                          : '코스 기록 순위'}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {activeChallengeBoard?.course.subtitle}
                      </p>
                    </div>

                    {activeChallengeBoard &&
                    activeChallengeBoard.topRuns.length > 0 ? (
                      <div className="divide-y divide-slate-800/80 border-t border-b border-slate-800/80">
                        {activeChallengeBoard.topRuns.map((run) => (
                          <div
                            key={run.tripId}
                            className="py-2.5 flex items-center justify-between gap-2 text-xs"
                          >
                            <div className="flex items-center gap-2.5 min-w-0">
                              <span className="font-mono-tabular font-bold text-amber-400 w-7 shrink-0">
                                {run.rank}위
                              </span>
                              <div className="min-w-0">
                                <span className="font-mono-tabular font-bold text-slate-100 block">
                                  {run.score.toLocaleString()} pts
                                </span>
                                <span className="text-[11px] text-slate-400">
                                  {formatDistanceKr(run.distanceMeters)} ·{' '}
                                  {formatElapsedClock(run.elapsedSeconds)} · 평균{' '}
                                  {run.avgSpeedKmh}km/h
                                </span>
                              </div>
                            </div>
                            <span
                              className={`text-[11px] font-semibold shrink-0 ${
                                run.completed
                                  ? 'text-emerald-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {run.completed ? '완주' : '중간 종료'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="rounded-lg border border-slate-800/80 bg-[#0D121B] p-5 text-center space-y-2">
                        <p className="text-xs text-slate-300 font-medium">
                          아직 이 코스의 주행 기록이 없습니다
                        </p>
                        <p className="text-[11px] text-slate-500">
                          코스를 완주하면 완주 보너스(+300 pts)와 함께 첫 번째 1위 기록이 등록됩니다.
                        </p>
                      </div>
                    )}
                  </div>

                  {activeChallengeBoard && onStartChallenge && (
                    <button
                      type="button"
                      onClick={() =>
                        onStartChallenge(activeChallengeBoard.course)
                      }
                      className="w-full min-h-[42px] px-4 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors"
                    >
                      <Trophy className="w-3.5 h-3.5" />
                      <span>
                        {activeChallengeBoard.course.title} 지금 도전하기
                      </span>
                    </button>
                  )}
                </section>
              </div>
            </>
          ) : trips.length === 0 ? (
            <div className="rounded-xl border border-slate-800 bg-[#121826] p-8 text-center space-y-3">
              <div className="w-12 h-12 rounded-xl bg-slate-800/80 text-amber-400 flex items-center justify-center mx-auto">
                <Compass className="w-6 h-6" />
              </div>
              <h3 className="text-base font-bold text-slate-100">
                아직 저장된 주행 기록이 없습니다
              </h3>
              <p className="text-xs sm:text-sm text-slate-400 max-w-md mx-auto leading-relaxed">
                목적지까지 주행을 완료하거나 주행을 종료하면 이동한 총 거리, 주행 시간, 통과한 실제 도로와 방문 지역 분석 차트가 이곳에 기록됩니다.
              </p>
              <div className="pt-2 flex flex-wrap items-center justify-center gap-2.5">
                <button
                  type="button"
                  onClick={() => setScope('challenge')}
                  className="min-h-[44px] px-4 py-2.5 rounded-xl bg-[#161D29] hover:bg-slate-800 border border-emerald-500/40 text-emerald-300 text-xs font-bold inline-flex items-center gap-2 transition-colors"
                >
                  <Trophy className="w-4 h-4" />
                  <span>챌린지 코스 순위 보기</span>
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  className="min-h-[44px] px-5 py-2.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-2 transition-colors"
                >
                  <Navigation className="w-4 h-4" />
                  <span>첫 드라이브 시작하기</span>
                </button>
              </div>
            </div>
          ) : (
            <>
              {/* 4-Column Flat KPI Summary Strip (Hairline Divided) */}
              <section
                aria-label="핵심 주행 지표"
                className="grid grid-cols-2 lg:grid-cols-4 border border-slate-800 rounded-xl bg-[#111723] divide-y lg:divide-y-0 lg:divide-x divide-slate-800 overflow-hidden"
              >
                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Flag className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                    <span>총 이동 거리</span>
                  </div>
                  <p
                    data-testid="dashboard-total-distance"
                    className="font-mono-tabular text-2xl font-bold text-slate-50"
                  >
                    {formatDistanceKr(summary.totalDistanceMeters)}
                  </p>
                  <p className="text-xs text-slate-400 tabular-nums">
                    {effectiveScope === 'trip' && selectedTrip
                      ? selectedTrip.travelMode === 'WALKING'
                        ? '도보 탐험 모드'
                        : '자동차 주행 모드'
                      : `총 ${summary.totalTrips}회 주행 · 완료 ${summary.completedTrips}회`}
                  </p>
                </div>

                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Clock className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                    <span>총 주행 시간</span>
                  </div>
                  <p
                    data-testid="dashboard-total-duration"
                    className="font-mono-tabular text-2xl font-bold text-slate-50"
                  >
                    {formatElapsedClock(summary.totalElapsedSeconds)}
                  </p>
                  <p className="text-xs text-slate-400 tabular-nums">
                    평균 속도 {summary.overallAvgSpeedKmh} km/h
                  </p>
                </div>

                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <MapPin className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                    <span>방문한 지역</span>
                  </div>
                  <p
                    data-testid="dashboard-region-count"
                    className="font-mono-tabular text-2xl font-bold text-slate-50"
                  >
                    {summary.regionStats.length}개 지역
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {isResolvingRegions
                      ? '방문 지역 주소 분석 중...'
                      : summary.regionStats
                          .slice(0, 2)
                          .map((r) => r.region)
                          .join(' · ') || '경로 지역 분석 완료'}
                  </p>
                </div>

                <div className="p-4 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs text-slate-400">
                    <Compass className="w-3.5 h-3.5 text-amber-300 shrink-0" />
                    <span>주요 감상 시점</span>
                  </div>
                  <p className="font-mono-tabular text-2xl font-bold text-slate-50">
                    {primaryMode ? `${primaryMode.percent}%` : '100%'}
                  </p>
                  <p className="text-xs text-slate-400 truncate">
                    {primaryMode ? primaryMode.label : '360° 거리뷰'}
                  </p>
                </div>
              </section>

              {/* Charts Row 1: Speed/Distance Profile (AreaChart) + Camera Mode PieChart */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                {/* Area Chart: Trip Speed Profile or Multi-Trip Distance Trend */}
                <section className="lg:col-span-8 rounded-xl border border-slate-800 bg-[#111723] p-4 space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100">
                        {effectiveScope === 'trip'
                          ? '구간별 주행 속도 변화 (km/h)'
                          : '최근 주행별 이동 거리 추이 (km)'}
                      </h3>
                      <p className="text-xs text-slate-400">
                        {effectiveScope === 'trip'
                          ? '주행 거리에 따른 실시간 차량 속도 흐름'
                          : '최근 주행 코스별 누적 이동 거리 비교'}
                      </p>
                    </div>
                  </div>

                  <div className="w-full h-56" data-testid="chart-speed-area">
                    {speedChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={speedChartData}
                          margin={{ top: 8, right: 12, left: -16, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient
                              id="amberSpeedFill"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor="#F59E0B"
                                stopOpacity={0.38}
                              />
                              <stop
                                offset="95%"
                                stopColor="#F59E0B"
                                stopOpacity={0.02}
                              />
                            </linearGradient>
                          </defs>
                          <CartesianGrid
                            stroke="#1E293B"
                            strokeDasharray="3 3"
                            vertical={false}
                          />
                          <XAxis
                            dataKey="xLabel"
                            stroke="#64748B"
                            tick={{ fill: '#94A3B8', fontSize: 11 }}
                            tickLine={false}
                          />
                          <YAxis
                            stroke="#64748B"
                            tick={{ fill: '#94A3B8', fontSize: 11 }}
                            tickLine={false}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0B1018',
                              borderColor: '#334155',
                              borderRadius: '0.75rem',
                              fontSize: '12px',
                              color: '#F8FAFC',
                            }}
                            formatter={(val: unknown) =>
                              effectiveScope === 'trip'
                                ? [`${val} km/h`, '주행 속도']
                                : [`${val} km`, '이동 거리']
                            }
                          />
                          <Area
                            type="monotone"
                            dataKey="yValue"
                            stroke="#F59E0B"
                            strokeWidth={2.5}
                            fill="url(#amberSpeedFill)"
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-500">
                        표시할 주행 속도 구간 데이터가 부족합니다.
                      </div>
                    )}
                  </div>
                </section>

                {/* Pie Chart: Camera View Mode Breakdown */}
                <section className="lg:col-span-4 rounded-xl border border-slate-800 bg-[#111723] p-4 flex flex-col justify-between space-y-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      카메라 시점 활용 비중
                    </h3>
                    <p className="text-xs text-slate-400">
                      360° 거리뷰 및 항공뷰 이용 비율
                    </p>
                  </div>

                  <div className="w-full h-40" data-testid="chart-viewmode-pie">
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie
                          data={summary.viewModeBreakdown}
                          dataKey="seconds"
                          nameKey="label"
                          cx="50%"
                          cy="50%"
                          innerRadius={42}
                          outerRadius={66}
                          paddingAngle={3}
                          stroke="#0E131D"
                          strokeWidth={2}
                        >
                          {summary.viewModeBreakdown.map((entry) => (
                            <Cell
                              key={entry.key}
                              fill={VIEW_MODE_COLORS[entry.key]}
                            />
                          ))}
                        </Pie>
                        <Tooltip
                          contentStyle={{
                            backgroundColor: '#0B1018',
                            borderColor: '#334155',
                            borderRadius: '0.75rem',
                            fontSize: '12px',
                            color: '#F8FAFC',
                          }}
                          formatter={(val: unknown) => [
                            formatElapsedClock(Number(val)),
                            '이용 시간',
                          ]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>

                  <div className="space-y-1.5 border-t border-slate-800 pt-2.5">
                    {summary.viewModeBreakdown.map((entry) => (
                      <div
                        key={entry.key}
                        className="flex items-center justify-between text-xs"
                      >
                        <span className="flex items-center gap-2 text-slate-300">
                          <span
                            className="w-2.5 h-2.5 rounded-sm shrink-0"
                            style={{
                              backgroundColor: VIEW_MODE_COLORS[entry.key],
                            }}
                          />
                          <span>{entry.label}</span>
                        </span>
                        <span className="font-mono-tabular text-slate-200">
                          {entry.percent}% · {formatElapsedClock(entry.seconds)}
                        </span>
                      </div>
                    ))}
                  </div>
                </section>
              </div>

              {/* Charts Row 2: Visited Regions BarChart + Road/Region Breakdown */}
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
                <section className="lg:col-span-7 rounded-xl border border-slate-800 bg-[#111723] p-4 space-y-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-100">
                      방문 지역별 주행 거리 분석
                    </h3>
                    <p className="text-xs text-slate-400">
                      Google 지도 주소 기반 통과 행정구역 및 구간 비중 (
                      {useMetersForRegions ? 'm' : 'km'})
                    </p>
                  </div>

                  <div className="w-full h-56" data-testid="chart-regions-bar">
                    {regionChartData.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart
                          data={regionChartData}
                          layout="vertical"
                          margin={{ top: 4, right: 20, left: 10, bottom: 4 }}
                        >
                          <CartesianGrid
                            stroke="#1E293B"
                            strokeDasharray="3 3"
                            horizontal={false}
                          />
                          <XAxis
                            type="number"
                            stroke="#64748B"
                            tick={{ fill: '#94A3B8', fontSize: 11 }}
                            tickLine={false}
                          />
                          <YAxis
                            type="category"
                            dataKey="name"
                            width={108}
                            stroke="#64748B"
                            tick={{ fill: '#E2E8F0', fontSize: 11 }}
                            tickLine={false}
                          />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: '#0B1018',
                              borderColor: '#334155',
                              borderRadius: '0.75rem',
                              fontSize: '12px',
                              color: '#F8FAFC',
                            }}
                            formatter={(val: unknown) => [
                              `${val} ${useMetersForRegions ? 'm' : 'km'}`,
                              '주행 거리',
                            ]}
                          />
                          <Bar
                            dataKey="distanceValue"
                            fill="#38BDF8"
                            radius={[0, 6, 6, 0]}
                            barSize={20}
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="h-full flex items-center justify-center text-xs text-slate-500">
                        방문 지역 데이터를 수집하고 있습니다.
                      </div>
                    )}
                  </div>
                </section>

                {/* Visited Regions & Traversed Corridors List */}
                <section className="lg:col-span-5 rounded-xl border border-slate-800 bg-[#111723] p-4 flex flex-col justify-between space-y-3">
                  <div className="space-y-3">
                    <div>
                      <h3 className="text-sm font-bold text-slate-100">
                        경유 지역 및 주요 도로
                      </h3>
                      <p className="text-xs text-slate-400">
                        {isResolvingRegions
                          ? '통과 좌표에서 행정구역 정보를 추출하는 중...'
                          : '이번 주행에서 실제로 지나간 구역과 도로명'}
                      </p>
                    </div>

                    <div className="divide-y divide-slate-800/80 border-t border-b border-slate-800/80">
                      {summary.regionStats.slice(0, 5).map((region) => (
                        <div
                          key={region.region}
                          className="h-10 flex items-center justify-between gap-3 text-xs"
                        >
                          <span className="text-slate-200 font-medium truncate">
                            {region.region}
                          </span>
                          <span className="font-mono-tabular text-slate-400 whitespace-nowrap shrink-0">
                            {formatDistanceKr(region.distanceMeters)} ·{' '}
                            {region.visits}회
                          </span>
                        </div>
                      ))}
                    </div>

                    {selectedTrip &&
                      effectiveScope === 'trip' &&
                      selectedTrip.roadNames.length > 0 && (
                        <div className="pt-1 space-y-1">
                          <span className="block text-xs font-semibold text-slate-400">
                            주행한 주요 도로
                          </span>
                          <p className="text-xs text-slate-200 leading-relaxed">
                            {selectedTrip.roadNames.join(' · ')}
                          </p>
                        </div>
                      )}
                  </div>

                  {/* Past Trips Switcher Table */}
                  {trips.length > 1 && (
                    <div className="pt-2 border-t border-slate-800 space-y-1.5">
                      <span className="block text-xs font-semibold text-slate-400">
                        최근 주행 선택
                      </span>
                      <div className="max-h-28 overflow-y-auto cockpit-scroll divide-y divide-slate-800/60">
                        {trips.slice(0, 5).map((trip) => (
                          <button
                            key={trip.id}
                            type="button"
                            onClick={() => {
                              onSelectTrip(trip.id);
                              setScope('trip');
                            }}
                            className={`w-full h-9 px-2 rounded-md flex items-center justify-between gap-2 text-xs text-left transition-colors ${
                              trip.id === selectedTrip?.id &&
                              effectiveScope === 'trip'
                                ? 'bg-amber-500/15 text-amber-200'
                                : 'text-slate-300 hover:bg-slate-800/60'
                            }`}
                          >
                            <span className="truncate">
                              {trip.originName} → {trip.destinationName}
                            </span>
                            <span className="font-mono-tabular text-slate-400 shrink-0">
                              {formatDistanceKr(trip.distanceMeters)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </section>
              </div>
            </>
          )}
        </div>

        {/* Footer Actions */}
        <footer className="flex flex-wrap items-center justify-between gap-2.5 px-4 sm:px-6 py-3.5 border-t border-slate-800 bg-[#0B0F17] shrink-0">
          <div>
            {trips.length > 0 && (
              <button
                type="button"
                onClick={() => {
                  if (!confirmClear) {
                    setConfirmClear(true);
                    return;
                  }
                  onClearHistory();
                  setConfirmClear(false);
                }}
                onBlur={() => setConfirmClear(false)}
                className={`min-h-[40px] px-3 rounded-lg border text-xs font-semibold inline-flex items-center gap-1.5 transition-colors ${
                  confirmClear
                    ? 'bg-rose-500/20 border-rose-500/50 text-rose-200'
                    : 'border-slate-800 hover:border-slate-700 text-slate-400 hover:text-rose-300'
                }`}
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>
                  {confirmClear ? '한 번 더 누르면 전체 삭제' : '기록 초기화'}
                </span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 ml-auto">
            {onOpenDestinationGuide && selectedTrip && (
              <button
                type="button"
                onClick={onOpenDestinationGuide}
                className="min-h-[42px] px-3.5 rounded-xl bg-[#161D29] hover:bg-slate-800 border border-amber-500/40 text-xs font-semibold text-amber-300 inline-flex items-center gap-1.5 transition-colors"
              >
                <Sparkles className="w-3.5 h-3.5" />
                <span>도착지 AI 가이드</span>
              </button>
            )}

            {onRestartDrive && selectedTrip && (
              <button
                type="button"
                onClick={onRestartDrive}
                className="min-h-[42px] px-3.5 rounded-xl bg-[#161D29] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-100 inline-flex items-center gap-1.5 transition-colors"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>다시 주행</span>
              </button>
            )}

            {onReturnToTitle ? (
              <button
                type="button"
                onClick={onReturnToTitle}
                className="min-h-[42px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
              >
                <Home className="w-3.5 h-3.5" />
                <span>새 목적지 설정</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={onClose}
                className="min-h-[42px] px-4 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold inline-flex items-center gap-1.5 transition-colors"
              >
                <span>확인</span>
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  );
};
