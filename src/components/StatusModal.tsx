import React from 'react';
import {
  BarChart3,
  Clock,
  Flag,
  Home,
  Navigation,
  Play,
  RotateCcw,
  Route,
  Sparkles,
  Trophy,
} from 'lucide-react';
import {
  formatDistanceKr,
  formatDurationKr,
  type VehiclePhysicsState,
} from '../engine/routeSimulation';
import type { ComputedRouteData, GameState } from '../types/drive';

interface StatusModalProps {
  gameState: GameState;
  routeData: ComputedRouteData | null;
  physics: VehiclePhysicsState;
  onResume: () => void;
  onRestartDrive: () => void;
  onReturnToTitle: () => void;
  onOpenDestinationGuide: () => void;
  onEndDrive: () => void;
  onOpenDashboard: () => void;
  hasNextLeg?: boolean;
  nextLegTitle?: string;
  onAdvanceNextLeg?: () => void;
}

export const StatusModal: React.FC<StatusModalProps> = ({
  gameState,
  routeData,
  physics,
  onResume,
  onRestartDrive,
  onReturnToTitle,
  onOpenDestinationGuide,
  onEndDrive,
  onOpenDashboard,
  hasNextLeg = false,
  nextLegTitle,
  onAdvanceNextLeg,
}) => {
  if (gameState !== 'paused' && gameState !== 'gameover') {
    return null;
  }

  const isVictory = gameState === 'gameover';

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isVictory ? '목적지 도착 완료' : '주행 일시정지'}
      className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
    >
      <div className="w-full max-w-md rounded-2xl bg-[#101622] border border-slate-700 p-6 shadow-2xl space-y-5">
        <div className="flex items-center gap-3">
          <div
            className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${
              isVictory
                ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40'
                : 'bg-amber-500/20 text-amber-400 border border-amber-500/40'
            }`}
          >
            {isVictory ? (
              <Flag className="w-5 h-5" />
            ) : (
              <Play className="w-5 h-5" />
            )}
          </div>
          <div className="min-w-0">
            <h2 className="text-lg font-bold text-slate-50">
              {isVictory ? '목적지에 도착했습니다!' : '주행 일시정지'}
            </h2>
            <p className="text-xs text-slate-400 truncate">
              {routeData
                ? `${routeData.origin.name} → ${routeData.destination.name}`
                : '여정 진행 중'}
            </p>
          </div>
        </div>

        {/* 3 Iconified Stat Tiles */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-[#161D29] border border-slate-800 p-3 text-center space-y-1">
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <Route className="w-3 h-3 text-sky-400" />
              <span>이동 거리</span>
            </div>
            <span className="font-mono-tabular text-base font-bold text-slate-100 block">
              {formatDistanceKr(physics.distanceMeters)}
            </span>
          </div>
          <div className="rounded-xl bg-[#161D29] border border-slate-800 p-3 text-center space-y-1">
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <Clock className="w-3 h-3 text-emerald-400" />
              <span>소요 시간</span>
            </div>
            <span className="font-mono-tabular text-base font-bold text-slate-100 block">
              {formatDurationKr(physics.elapsedSeconds)}
            </span>
          </div>
          <div className="rounded-xl bg-[#161D29] border border-slate-800 p-3 text-center space-y-1">
            <div className="flex items-center justify-center gap-1 text-[11px] text-slate-400">
              <Trophy className="w-3 h-3 text-amber-400" />
              <span>점수</span>
            </div>
            <span className="font-mono-tabular text-base font-bold text-amber-400 block">
              {Math.round(physics.score)}
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          {hasNextLeg && onAdvanceNextLeg && (
            <button
              type="button"
              onClick={onAdvanceNextLeg}
              className="w-full min-h-[46px] rounded-xl bg-sky-500 hover:bg-sky-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
            >
              <Navigation className="w-4 h-4" />
              <span>
                {nextLegTitle ? `다음 여정: ${nextLegTitle}` : '다음 여정으로 이어가기'}
              </span>
            </button>
          )}

          {!isVictory ? (
            <>
              <button
                type="button"
                onClick={onResume}
                className="w-full min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Play className="w-4 h-4" />
                <span>계속 진행하기</span>
              </button>
              <button
                type="button"
                onClick={onEndDrive}
                className="w-full min-h-[44px] rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/50 text-amber-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                <span>종료 및 주행 기록 대시보드 보기</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onOpenDashboard}
                className="w-full min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                <span>주행 기록 대시보드 보기</span>
              </button>
              <button
                type="button"
                onClick={onOpenDestinationGuide}
                className="w-full min-h-[44px] rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Sparkles className="w-4 h-4" />
                <span>도착지 주변 명소·맛집 가이드</span>
              </button>
            </>
          )}

          <div className="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              data-start={isVictory ? 'true' : undefined}
              onClick={onRestartDrive}
              className="min-h-[44px] rounded-xl bg-[#161D29] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-center gap-1.5 transition-colors"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>처음부터 다시</span>
            </button>

            <button
              type="button"
              onClick={onReturnToTitle}
              className="min-h-[44px] rounded-xl bg-[#161D29] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              <span>홈 / 새 경로</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
