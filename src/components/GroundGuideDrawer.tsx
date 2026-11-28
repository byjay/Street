import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ExternalLink,
  MapPin,
  Navigation,
  Plane,
  Search,
  Sparkles,
  X,
} from 'lucide-react';
import type { LatLngPoint } from '../engine/routeSimulation';
import {
  isFreeProvider,
  type GroundedPlaceLink,
  type GroundingGuideResponse,
  type MapProviderMode,
  type SelectedPlaceInfo,
} from '../types/drive';
import {
  fetchFlightGuideBriefing,
  fetchFreeNearbyGuide,
  resolveFreePlaceByQuery,
} from '../utils/freeMapsHelpers';
import { checkQuotaError, resolvePlaceByQuery } from '../utils/mapsHelpers';

interface GroundGuideDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  currentPosition: LatLngPoint;
  destination: SelectedPlaceInfo | null;
  onSetNewDestination: (place: SelectedPlaceInfo) => void;
  mapProvider: MapProviderMode;
  placesLib?: google.maps.PlacesLibrary | null;
  initialMode?: 'nearby' | 'destination' | 'flight';
  flightLandmarkName?: string;
  flightAltitudeMeters?: number;
}

export const GroundGuideDrawer: React.FC<GroundGuideDrawerProps> = ({
  isOpen,
  onClose,
  currentPosition,
  destination,
  onSetNewDestination,
  mapProvider,
  placesLib = null,
  initialMode = 'destination',
  flightLandmarkName,
  flightAltitudeMeters = 5200,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [activeMode, setActiveMode] = useState<
    'nearby' | 'destination' | 'search' | 'flight'
  >(initialMode);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [guideData, setGuideData] = useState<GroundingGuideResponse | null>(
    null
  );
  const [navigatingTitle, setNavigatingTitle] = useState<string | null>(null);
  const fetchedThisOpenRef = useRef(false);
  const isFree = isFreeProvider(mapProvider);

  const fetchPlacesFallback = useCallback(
    async (
      mode: 'nearby' | 'destination' | 'search',
      targetPos: LatLngPoint,
      customQuery?: string
    ): Promise<GroundingGuideResponse> => {
      if (!placesLib) {
        throw new Error('Google 지도 장소 검색 모듈을 불러오는 중입니다.');
      }

      const fields = [
        'id',
        'displayName',
        'formattedAddress',
        'googleMapsURI',
        'rating',
        'userRatingCount',
      ];

      let foundPlaces: google.maps.places.Place[] = [];

      if (mode === 'search' && customQuery) {
        const res = await placesLib.Place.searchByText({
          textQuery: customQuery,
          locationBias: { center: targetPos, radius: 3000 },
          fields,
          maxResultCount: 6,
        });
        foundPlaces = res.places ?? [];
      } else if (mode === 'destination' && destination) {
        const res = await placesLib.Place.searchByText({
          textQuery: `${destination.name} 명소 맛집`,
          locationBias: { center: destination.location, radius: 1500 },
          fields,
          maxResultCount: 6,
        });
        foundPlaces = res.places ?? [];
      } else {
        try {
          const res = await placesLib.Place.searchNearby({
            fields,
            locationRestriction: {
              center: targetPos,
              radius: 1200,
            },
            includedPrimaryTypes: [
              'tourist_attraction',
              'restaurant',
              'cafe',
              'park',
              'shopping_mall',
            ],
            maxResultCount: 6,
          });
          foundPlaces = res.places ?? [];
        } catch {
          const textRes = await placesLib.Place.searchByText({
            textQuery: '주변 명소 맛집 카페',
            locationBias: { center: targetPos, radius: 1500 },
            fields,
            maxResultCount: 6,
          });
          foundPlaces = textRes.places ?? [];
        }
      }

      const mappedPlaces: GroundedPlaceLink[] = foundPlaces.map((p) => {
        const ratingText =
          typeof p.rating === 'number'
            ? `평점 ${p.rating.toFixed(1)} (${p.userRatingCount ?? 0}개 리뷰)`
            : '';
        const addrText = p.formattedAddress || '';
        const snippets = [addrText, ratingText].filter(Boolean);
        return {
          title: p.displayName || 'Google 지도 장소',
          uri:
            p.googleMapsURI ||
            `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
              p.displayName || `${targetPos.lat},${targetPos.lng}`
            )}`,
          placeId: p.id || undefined,
          reviewSnippets: snippets,
        };
      });

      const titleLabel =
        mode === 'destination' && destination
          ? `${destination.name} 주변`
          : mode === 'search' && customQuery
            ? `"${customQuery}"`
            : '현재 주행 위치 주변';

      return {
        summary:
          mappedPlaces.length > 0
            ? `${titleLabel}의 실제 Google 지도 등록 장소 ${mappedPlaces.length}곳을 불러왔습니다.`
            : `${titleLabel}에서 추천 장소를 찾지 못했습니다. 다른 검색어로 다시 시도해 주세요.`,
        places: mappedPlaces,
      };
    },
    [placesLib, destination]
  );

  const fetchGuide = useCallback(
    async (
      mode: 'nearby' | 'destination' | 'search' | 'flight',
      customQuery?: string
    ) => {
      setLoading(true);
      setError(null);
      setActiveMode(mode);

      if (mode === 'flight') {
        try {
          const flightRes = await fetchFlightGuideBriefing({
            landmarkName: flightLandmarkName || '한반도 상공',
            altitudeMeters: flightAltitudeMeters,
            lat: currentPosition.lat,
            lng: currentPosition.lng,
          });
          setGuideData(flightRes);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : '항공 브리핑을 불러오지 못했습니다.'
          );
        } finally {
          setLoading(false);
        }
        return;
      }

      const targetPos =
        mode === 'destination' && destination
          ? destination.location
          : currentPosition;

      if (isFree) {
        try {
          const freeQuery =
            mode === 'search'
              ? customQuery
              : mode === 'destination' && destination
                ? `${destination.name} 주변`
                : undefined;
          const freeResult = await fetchFreeNearbyGuide(
            targetPos.lat,
            targetPos.lng,
            freeQuery
          );
          setGuideData(freeResult);
        } catch (err) {
          setError(
            err instanceof Error
              ? err.message
              : '오픈소스 주변 장소 정보를 불러오지 못했습니다.'
          );
        } finally {
          setLoading(false);
        }
        return;
      }

      try {
        const res = await fetch('/api/grounding/guide', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            mode,
            query: customQuery,
            placeName: destination?.name || undefined,
            lat: targetPos.lat,
            lng: targetPos.lng,
          }),
        });

        const rawText = await res.text();
        let parsed: (GroundingGuideResponse & { error?: string }) | null = null;
        if (rawText.trim().startsWith('{')) {
          try {
            parsed = JSON.parse(rawText) as GroundingGuideResponse & {
              error?: string;
            };
          } catch {
            parsed = null;
          }
        }

        if (res.ok && parsed && (parsed.summary || parsed.places?.length)) {
          setGuideData({
            summary: parsed.summary || '',
            places: Array.isArray(parsed.places) ? parsed.places : [],
          });
          return;
        }

        const fallbackData = await fetchPlacesFallback(
          mode,
          targetPos,
          customQuery
        );
        setGuideData(fallbackData);
      } catch (err) {
        try {
          const fallbackData = await fetchPlacesFallback(
            mode,
            targetPos,
            customQuery
          );
          setGuideData(fallbackData);
        } catch (fallbackErr) {
          checkQuotaError(fallbackErr);
          setError(
            err instanceof Error
              ? err.message
              : '주변 장소 정보를 불러오지 못했습니다.'
          );
        }
      } finally {
        setLoading(false);
      }
    },
    [
      currentPosition,
      destination,
      fetchPlacesFallback,
      flightAltitudeMeters,
      flightLandmarkName,
      isFree,
    ]
  );

  useEffect(() => {
    if (!isOpen) {
      fetchedThisOpenRef.current = false;
      return;
    }
    if (!fetchedThisOpenRef.current) {
      fetchedThisOpenRef.current = true;
      const startMode =
        initialMode === 'flight'
          ? 'flight'
          : destination
            ? initialMode
            : 'nearby';
      void fetchGuide(startMode);
    }
  }, [isOpen, destination, initialMode, fetchGuide]);

  const handleDriveToPlace = async (title: string) => {
    setNavigatingTitle(title);
    try {
      const resolved = isFree
        ? await resolveFreePlaceByQuery(title, mapProvider)
        : placesLib
          ? await resolvePlaceByQuery(placesLib, title)
          : null;
      if (resolved) {
        onSetNewDestination(resolved);
        onClose();
      } else {
        setError(`"${title}"의 정확한 도로 좌표를 찾지 못했습니다.`);
      }
    } catch {
      setError('목적지 좌표를 불러오는 중 오류가 발생했습니다.');
    } finally {
      setNavigatingTitle(null);
    }
  };

  if (!isOpen) return null;

  return (
    <aside
      aria-label="실시간 현지 가이드"
      className="fixed inset-y-0 right-0 z-[60] w-full sm:w-[400px] bg-[#0F141E] border-l border-slate-800 shadow-2xl flex flex-col"
    >
      <div className="flex items-center justify-between px-4 py-3.5 border-b border-slate-800">
        <div className="flex items-center gap-2">
          {activeMode === 'flight' ? (
            <Plane className="w-4 h-4 text-sky-400 shrink-0" />
          ) : (
            <Sparkles className="w-4 h-4 text-amber-400 shrink-0" />
          )}
          <h2 className="text-sm font-bold text-slate-100">
            {activeMode === 'flight'
              ? '기내 상공 랜드마크 브리핑'
              : isFree
                ? '실시간 주변 가이드 (오픈소스 OSM)'
                : '실시간 현지 가이드 (Google Maps)'}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="가이드 닫기"
          className="min-w-[40px] min-h-[40px] flex items-center justify-center rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Mode Tabs & Search */}
      <div className="p-4 border-b border-slate-800/80 space-y-3">
        <div className="grid grid-cols-3 gap-1.5 p-1 bg-[#161D29] rounded-xl">
          <button
            type="button"
            onClick={() => void fetchGuide('destination')}
            disabled={!destination || loading}
            className={`min-h-[36px] px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
              activeMode === 'destination'
                ? 'bg-amber-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            } disabled:opacity-40`}
          >
            목적지
          </button>
          <button
            type="button"
            onClick={() => void fetchGuide('nearby')}
            disabled={loading}
            className={`min-h-[36px] px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
              activeMode === 'nearby'
                ? 'bg-emerald-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            주변 명소
          </button>
          <button
            type="button"
            onClick={() => void fetchGuide('flight')}
            disabled={loading}
            className={`min-h-[36px] px-2 rounded-lg text-[11px] font-semibold transition-colors whitespace-nowrap ${
              activeMode === 'flight'
                ? 'bg-sky-500 text-slate-950'
                : 'text-slate-300 hover:text-white'
            }`}
          >
            상공 브리핑
          </button>
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (searchQuery.trim()) {
              void fetchGuide('search', searchQuery.trim());
            }
          }}
          className="flex gap-2"
        >
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="예: 코엑스 근처 맛집, 전망 좋은 카페"
              aria-label="주변 명소 또는 목적지 질문"
              className="w-full h-10 pl-9 pr-3 rounded-xl bg-[#161D29] border border-slate-700/80 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400"
            />
          </div>
          <button
            type="submit"
            disabled={loading || !searchQuery.trim()}
            className="min-h-[40px] px-3.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-slate-100 whitespace-nowrap disabled:opacity-40 transition-colors"
          >
            탐색
          </button>
        </form>
      </div>

      {/* Results Body */}
      <div className="flex-1 overflow-y-auto cockpit-scroll p-4 space-y-5">
        {loading && (
          <div className="py-12 flex flex-col items-center justify-center gap-3 text-slate-400">
            <div className="w-7 h-7 border-2 border-amber-400/30 border-t-amber-400 rounded-full animate-spin" />
            <p className="text-xs">
              {activeMode === 'flight'
                ? '상공 랜드마크 브리핑을 생성 중...'
                : isFree
                  ? 'OpenStreetMap 주변 명소를 조회 중...'
                  : 'Google 지도 기반 최신 정보를 조회 중...'}
            </p>
          </div>
        )}

        {error && !loading && (
          <div className="rounded-xl bg-rose-500/10 border border-rose-500/30 p-3.5 text-xs text-rose-200 leading-relaxed">
            {error}
          </div>
        )}

        {guideData && !loading && (
          <>
            {guideData.summary && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-slate-400">
                  {activeMode === 'flight' ? '기내 안내 방송' : '경로 주변 요약'}
                </h3>
                <div className="text-sm text-slate-200 leading-relaxed whitespace-pre-line [word-break:keep-all]">
                  {guideData.summary}
                </div>
              </div>
            )}

            {guideData.places.length > 0 && (
              <div className="space-y-2.5">
                <h3 className="text-xs font-semibold text-slate-400">
                  {isFree
                    ? `OpenStreetMap 확인 장소 (${guideData.places.length})`
                    : `Google Maps 확인 장소 (${guideData.places.length})`}
                </h3>
                <ul className="space-y-2.5">
                  {guideData.places.map((place, idx) => (
                    <li
                      key={`${place.uri}-${idx}`}
                      className="rounded-xl bg-[#161D29] border border-slate-800 p-3.5 space-y-2"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex items-start gap-2 min-w-0">
                          <MapPin className="w-4 h-4 text-amber-400 mt-0.5 shrink-0" />
                          <span className="text-sm font-semibold text-slate-100 leading-snug">
                            {place.title}
                          </span>
                        </div>
                        <a
                          href={place.uri}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-medium text-sky-400 hover:text-sky-300 whitespace-nowrap shrink-0"
                        >
                          <span>지도</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      </div>

                      {place.reviewSnippets.length > 0 && (
                        <div className="space-y-1 pl-6">
                          {place.reviewSnippets.map((snippet, sIdx) => (
                            <p
                              key={sIdx}
                              className="text-xs text-slate-400 leading-relaxed line-clamp-2"
                            >
                              {snippet}
                            </p>
                          ))}
                        </div>
                      )}

                      {activeMode !== 'flight' && (
                        <div className="pl-6 pt-1">
                          <button
                            type="button"
                            onClick={() => void handleDriveToPlace(place.title)}
                            disabled={navigatingTitle === place.title}
                            className="min-h-[34px] px-3 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 border border-amber-500/40 text-xs font-semibold text-amber-300 inline-flex items-center gap-1.5 transition-colors disabled:opacity-50"
                          >
                            <Navigation className="w-3 h-3" />
                            <span>
                              {navigatingTitle === place.title
                                ? '경로 설정 중...'
                                : '여기로 주행하기'}
                            </span>
                          </button>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </>
        )}
      </div>
    </aside>
  );
};
