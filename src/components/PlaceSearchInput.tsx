import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { LocateFixed, MapPin, Search, X } from 'lucide-react';
import { isFreeProvider, type MapProviderMode, type SelectedPlaceInfo } from '../types/drive';
import { searchFreePlaces } from '../utils/freeMapsHelpers';
import { checkQuotaError, toLatLngLiteral } from '../utils/mapsHelpers';

interface PlaceSearchInputProps {
  label: string;
  placeholder: string;
  value: SelectedPlaceInfo | null;
  onSelect: (place: SelectedPlaceInfo) => void;
  mapProvider: MapProviderMode;
  placesLib?: google.maps.PlacesLibrary | null;
  showGpsButton?: boolean;
  onUseCurrentLocation?: () => void;
  gpsLoading?: boolean;
  accentColor?: 'amber' | 'emerald';
}

interface PlaceSuggestionItem {
  id: string;
  mainText: string;
  secondaryText: string;
  freePlace?: SelectedPlaceInfo;
  googleSuggestion?: google.maps.places.AutocompleteSuggestion;
}

export const PlaceSearchInput: React.FC<PlaceSearchInputProps> = ({
  label,
  placeholder,
  value,
  onSelect,
  mapProvider,
  placesLib = null,
  showGpsButton = false,
  onUseCurrentLocation,
  gpsLoading = false,
  accentColor = 'emerald',
}) => {
  const inputId = useId();

  const [query, setQuery] = useState(value?.name ?? '');
  const [isOpen, setIsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<PlaceSuggestionItem[]>([]);

  const sessionTokenRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isTypingRef = useRef(false);

  useEffect(() => {
    if (!isTypingRef.current) {
      setQuery(value?.name ?? '');
    }
  }, [value]);

  useEffect(() => {
    setSuggestions([]);
    setIsOpen(false);
  }, [mapProvider]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setIsOpen(false);
        isTypingRef.current = false;
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!isTypingRef.current) return;
    if (mapProvider === 'google' && !placesLib) return;

    const trimmed = query.trim();
    if (trimmed.length < 1) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(async () => {
      try {
        setIsLoading(true);

        if (isFreeProvider(mapProvider)) {
          const found = await searchFreePlaces(trimmed, 'autocomplete', 5, mapProvider);
          if (cancelled) return;
          setSuggestions(
            found.map((place, idx) => ({
              id: place.placeId || `free-${idx}-${place.name}`,
              mainText: place.name,
              secondaryText: place.address || '',
              freePlace: place,
            }))
          );
          setIsOpen(true);
          return;
        }

        if (!placesLib) return;
        const { AutocompleteSessionToken, AutocompleteSuggestion } = placesLib;
        if (!sessionTokenRef.current) {
          sessionTokenRef.current = new AutocompleteSessionToken();
        }
        const res = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
          input: trimmed,
          sessionToken: sessionTokenRef.current,
        });
        if (cancelled) return;

        const mapped: PlaceSuggestionItem[] = [];
        for (let idx = 0; idx < (res.suggestions ?? []).length; idx += 1) {
          const item = res.suggestions[idx];
          const pred = item.placePrediction;
          if (!pred) continue;
          mapped.push({
            id: pred.placeId || `google-${idx}`,
            mainText: pred.mainText?.text || pred.text.text,
            secondaryText: pred.secondaryText?.text || '',
            googleSuggestion: item,
          });
        }
        setSuggestions(mapped);
        setIsOpen(true);
      } catch (err) {
        if (mapProvider === 'google') {
          checkQuotaError(err);
        }
        if (!cancelled) {
          setSuggestions([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }, 240);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [mapProvider, placesLib, query]);

  const handleSelectSuggestion = useCallback(
    async (item: PlaceSuggestionItem) => {
      if (item.freePlace) {
        isTypingRef.current = false;
        setQuery(item.freePlace.name);
        setSuggestions([]);
        setIsOpen(false);
        onSelect(item.freePlace);
        return;
      }

      if (!placesLib || !item.googleSuggestion?.placePrediction) return;
      try {
        const place = item.googleSuggestion.placePrediction.toPlace();
        await place.fetchFields({
          fields: ['id', 'displayName', 'formattedAddress', 'location'],
        });
        const coords = toLatLngLiteral(place.location);
        if (!coords) return;

        const selected: SelectedPlaceInfo = {
          name:
            place.displayName ||
            item.googleSuggestion.placePrediction.text.text ||
            query,
          address: place.formattedAddress || undefined,
          location: coords,
          placeId: place.id || undefined,
        };

        isTypingRef.current = false;
        setQuery(selected.name);
        setSuggestions([]);
        setIsOpen(false);
        sessionTokenRef.current = null;
        onSelect(selected);
      } catch (err) {
        checkQuotaError(err);
      }
    },
    [placesLib, onSelect, query]
  );

  const dotClass =
    accentColor === 'amber' ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div ref={containerRef} className="relative w-full">
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-slate-400 mb-1.5"
      >
        {label}
      </label>

      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <span
            className={`pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 ${dotClass}`}
            aria-hidden="true"
          >
            {accentColor === 'amber' ? (
              <MapPin className="w-4 h-4" />
            ) : (
              <Search className="w-4 h-4" />
            )}
          </span>

          <input
            id={inputId}
            type="text"
            value={query}
            onChange={(e) => {
              isTypingRef.current = true;
              setQuery(e.target.value);
              setIsOpen(true);
            }}
            onFocus={() => {
              if (suggestions.length > 0) setIsOpen(true);
            }}
            placeholder={placeholder}
            autoComplete="off"
            className="w-full h-11 pl-9 pr-9 rounded-xl bg-[#161D29] border border-slate-700/80 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400/50 transition-colors"
          />

          {query && (
            <button
              type="button"
              aria-label={`${label} 입력 지우기`}
              onClick={() => {
                isTypingRef.current = true;
                setQuery('');
                setSuggestions([]);
                setIsOpen(false);
              }}
              className="absolute right-2 top-1/2 -translate-y-1/2 min-w-[32px] min-h-[32px] flex items-center justify-center rounded-lg text-slate-400 hover:text-slate-200 hover:bg-slate-800"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>

        {showGpsButton && onUseCurrentLocation && (
          <button
            type="button"
            onClick={() => {
              isTypingRef.current = false;
              setIsOpen(false);
              onUseCurrentLocation();
            }}
            disabled={gpsLoading}
            aria-label="현재 내 위치로 출발지 설정"
            className="min-h-[44px] px-3 rounded-xl bg-[#161D29] border border-slate-700/80 hover:border-emerald-400/70 text-xs font-medium text-emerald-300 flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors disabled:opacity-50"
          >
            <LocateFixed
              className={`w-4 h-4 ${gpsLoading ? 'animate-spin' : ''}`}
            />
            <span>내 위치</span>
          </button>
        )}
      </div>

      {isOpen && (isLoading || suggestions.length > 0) && (
        <ul
          role="listbox"
          aria-label={`${label} 자동완성 목록`}
          className="absolute z-50 left-0 right-0 mt-1.5 max-h-60 overflow-y-auto cockpit-scroll rounded-xl bg-[#121721] border border-slate-700 shadow-2xl divide-y divide-slate-800/80"
        >
          {isLoading && suggestions.length === 0 && (
            <li className="px-3.5 py-2.5 text-xs text-slate-400">
              장소를 검색하는 중...
            </li>
          )}
          {suggestions.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => void handleSelectSuggestion(item)}
                className="w-full text-left px-3.5 py-2.5 hover:bg-slate-800/70 focus:bg-slate-800/70 focus:outline-none transition-colors flex flex-col gap-0.5"
              >
                <span className="text-sm font-medium text-slate-100 truncate">
                  {item.mainText}
                </span>
                {item.secondaryText && (
                  <span className="text-xs text-slate-400 truncate">
                    {item.secondaryText}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
};
