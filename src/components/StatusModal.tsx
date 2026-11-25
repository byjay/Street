import React from 'react';
import { BarChart3, Flag, Home, Play, RotateCcw, Sparkles } from 'lucide-react';
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
      className="fixed inset-0 z-50 bg-black/75 flex items-center justify-center p-4"
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
                : '경로 주행 중'}
            </p>
          </div>
        </div>

        {/* 3 Tabular Stat Tiles */}
        <div className="grid grid-cols-3 gap-2.5">
          <div className="rounded-xl bg-[#161D29] border border-slate-800 p-3 text-center">
            <span className="block text-[11px] text-slate-400">주행 거리</span>
            <span className="font-mono-tabular text-base font-bold text-slate-100 mt-0.5 block">
              {formatDistanceKr(physics.distanceMeters)}
            </span>
          </div>
          <div className="rounded-xl bg-[#161D29] border border-slate-800 p-3 text-center">
            <span className="block text-[11px] text-slate-400">소요 시간</span>
            <span className="font-mono-tabular text-base font-bold text-slate-100 mt-0.5 block">
              {formatDurationKr(physics.elapsedSeconds)}
            </span>
          </div>
          <div className="rounded-xl bg-[#161D29] border border-slate-800 p-3 text-center">
            <span className="block text-[11px] text-slate-400">드라이브 점수</span>
            <span className="font-mono-tabular text-base font-bold text-amber-400 mt-0.5 block">
              {Math.round(physics.score)}
            </span>
          </div>
        </div>

        <div className="space-y-2.5">
          {!isVictory ? (
            <>
              <button
                type="button"
                onClick={onResume}
                className="w-full min-h-[46px] rounded-xl bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-sm flex items-center justify-center gap-2 transition-colors"
              >
                <Play className="w-4 h-4" />
                <span>계속 주행하기</span>
              </button>
              <button
                type="button"
                onClick={onEndDrive}
                className="w-full min-h-[44px] rounded-xl bg-amber-500/15 hover:bg-amber-500/25 border border-amber-400/50 text-amber-200 font-semibold text-xs flex items-center justify-center gap-2 transition-colors"
              >
                <BarChart3 className="w-4 h-4" />
                <span>주행 종료 및 기록 대시보드 보기</span>
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
                <span>도착지 주변 명소·맛집 AI 가이드</span>
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
              <span>처음부터 다시 주행</span>
            </button>

            <button
              type="button"
              onClick={onReturnToTitle}
              className="min-h-[44px] rounded-xl bg-[#161D29] hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-100 flex items-center justify-center gap-1.5 transition-colors"
            >
              <Home className="w-3.5 h-3.5" />
              <span>새 목적지 설정</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
