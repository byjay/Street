# RoadWindow 360 — Engineering & API Setup Handoff

> **Target Audience**: Next engineering agent / developer taking over API provisioning, billing activation, optional LLM/Grok integration, and production deployment.  
> **Last Updated**: 2026-11-24

---

## 1. Current System Architecture

RoadWindow 360 is a full-stack React + Vite + Express TypeScript application (`server.ts` serving Vite middleware in dev and `dist/` in production on port `3000`).

### Implemented Core Engines & UI
| Module | Responsibility | Status |
| :--- | :--- | :--- |
| `src/engine/routeSimulation.ts` | Haversine distance, polyline interpolation, corner angle lookahead (`evaluateCornerSlowdown`), speed/gear/score physics (`stepVehiclePhysics`). | Complete + unit-tested |
| `src/engine/streetViewMotion.ts` | Speed-adaptive panorama dwell (`computeSpeedAdaptiveDwellMs`), optical dolly-zoom handover (`computeOpticalZoomHandover`), anti-ping-pong link selector (`selectNextConnectedLink`), exponential heading & suspension pitch damping (`computeDynamicCameraPose`). | Complete + unit-tested |
| `src/components/StreetViewViewer.tsx` | **Dual A/B `StreetViewPanorama` Engine**: pre-stages `N+1` panorama tiles onto hidden standby layer while active layer executes a 30Hz optical dolly-zoom, then dissolves seamlessly on `tilesloaded`. | Complete |
| `src/components/AerialMapViewer.tsx` | Photorealistic 3D (`Map3D` / `maps3d`) with `85ms` damped chase-camera sync + automatic 2D Vector/Satellite fallback when WebGL2 or billing is disabled. | Complete |
| `src/components/DriveHistoryDashboard.tsx` | Recharts analytics (`AreaChart`, `PieChart`, `BarChart`), visited region/corridor extraction (`src/utils/tripAnalytics.ts`), `localStorage` persistence, and **Challenge Courses Leaderboard**. | Complete |
| `src/data/presets.ts` | Global presets + 5 Korean regional **Challenge Courses** (`제주 애월 해안도로`, `강원 한계령 산악도로`, `강원 대관령 고갯길`, `부산 광안리 · 해운대 해안`, `서울 북악스카이웨이`). | Complete |
| `src/components/GroundGuideDrawer.tsx` | Calls `POST /api/grounding/guide` (Gemini + Google Maps Grounding) with automatic fallback to client-side `Places API (New)` (`searchNearby` / `searchByText`). | Complete |

---

## 2. Required API Connections & Setup Checklist (Action Items for Next Agent)

### A. Google Maps Platform (`VITE_GOOGLE_MAPS_API_KEY`) — **CRITICAL FOR VISUAL QUALITY**
Without an active Google Cloud Billing account linked to the project owning `VITE_GOOGLE_MAPS_API_KEY`, Google enforces development restrictions:
- Street View renders **inverted/greyed colors + `"For development purposes only"` watermark**.
- Photorealistic 3D Tiles (`maps3d`) trigger `gmp-billing-required` and fall back to 2D hybrid tiles.

**Next Agent Setup Steps**:
1. Ensure **Billing is enabled** on the Google Cloud project tied to `VITE_GOOGLE_MAPS_API_KEY` (Google Maps Platform provides free monthly usage credits—e.g. Dynamic Maps 10,000/mo & Dynamic Street View 5,000/mo tier / legacy $200 monthly credit structure depending on pricing plan).
2. Enable the following Google Cloud APIs in that project:
   - **Maps JavaScript API** (includes `StreetViewPanorama` & `Map3D` Photorealistic 3D Maps)
   - **Places API (New)** (`Place.searchByText`, `Place.searchNearby`)
   - **Routes API** (`Route.computeRoutes` with `HIGH_QUALITY` polylines)
   - **Geocoding API** (used server-side by `POST /api/geocode/regions` in `server.ts`)
3. Set HTTP referrer restrictions carefully in Google Cloud Console so both dev and Cloud Run preview URLs are allowed, and ensure the server-side Geocoding call in `server.ts` works (if HTTP referrer restriction blocks server-side `fetch` to `maps.googleapis.com/maps/api/geocode/json`, provision an unrestricted or IP-restricted `GOOGLE_MAPS_API_KEY` separately from `VITE_GOOGLE_MAPS_API_KEY`—`server.ts` already checks `VITE_GOOGLE_MAPS_API_KEY || GOOGLE_MAPS_API_KEY`).
4. Verify in browser: `window` should NOT receive `gmp-billing-required`, `"For development purposes only"` must disappear, and `Aerial` mode should render 3D Photorealistic Google Earth buildings.

---

### B. Gemini API (`GEMINI_API_KEY`) — Grounded Local Drive Guide
Already implemented on the backend in `server.ts` (`POST /api/grounding/guide`):
- Uses `@google/genai` with model `'gemini-4-hydrogen'` and `tools: [{ googleMaps: {} }]` + `retrievalConfig.latLng`.
- **Next Agent Setup Steps**:
  1. Set `GEMINI_API_KEY` in AI Studio **Settings > Secrets** (or `.env` locally; never commit real keys).
  2. Test `POST /api/grounding/guide` with `{ lat: 37.5111, lng: 127.0592, mode: 'nearby' }` and confirm HTTP `200` returning `{ summary, places: [{ title, uri, placeId, reviewSnippets }] }` instead of falling back to Places-only mode.

---

### C. Optional Grok (xAI) API (`XAI_API_KEY`) — Architectural Guidance & Spec
> **Important Technical Reality**:  
> Connecting a text LLM API (**Grok API** or **Gemini text**) **does NOT make Street View transitions look like 60fps video**. Text LLMs generate tokens at ~500ms–2000ms latency, not real-time optical flow or pixel frames. Real video-like smoothness comes from:
> 1. Client-side optical-zoom handover + N+1 pre-staging (`src/engine/streetViewMotion.ts` & `StreetViewViewer.tsx`),
> 2. Google **Photorealistic 3D Maps** (`Map3D`, unlocked once Billing is active), or
> 3. Dedicated video-frame interpolation / neural rendering (e.g., WebGL depth-reprojection shaders or cloud Video Diffusion models, which are too slow/costly for real-time interactive steering).

**Where an LLM API *does* make the driving experience noticeably richer**:
- **Keep Gemini (`GEMINI_API_KEY`) for Map/Location Facts**: Gemini natively supports `googleMaps` Grounding with verified `placeId` and `googleMapsURI` links (`server.ts`). Grok does not have native Google Maps Grounding.
- **Add Grok API (`XAI_API_KEY`) ONLY if you want a Conversational Radio Co-Pilot / Taxi-Driver Persona**:
  If the user wants witty local storytelling, regional trivia, or voice/radio commentary as the car passes landmarks:
  1. Add `XAI_API_KEY` to `.env.example` and environment secrets (server-side only—never `VITE_`).
  2. Create `POST /api/copilot/commentary` in `server.ts` calling `https://api.x.ai/v1/chat/completions` (`model: 'grok-3-mini'` or `'grok-3-fast'`) with `{ roadName, regionLabel, speedKmh, isCornering, challengeTitle }`.
  3. Trigger commentary **only on step/region changes** (throttled `>= 25s`) and optionally speak via Web Speech API (`speechSynthesis`) when unmuted.

---

## 3. Environment Variables Summary (`.env.example`)
```dotenv
# Required for AI Grounded Local Guide (server.ts -> /api/grounding/guide)
GEMINI_API_KEY="MY_GEMINI_API_KEY"

# Required for Google Maps JS SDK, Street View, Routes, Places, and 3D Earth
VITE_GOOGLE_MAPS_API_KEY="MY_GOOGLE_MAPS_API_KEY"

# Optional separate server-side key if VITE_GOOGLE_MAPS_API_KEY uses HTTP referrer restrictions
# GOOGLE_MAPS_API_KEY=""

# Optional if implementing Grok AI Radio Co-Pilot (/api/copilot/commentary)
# XAI_API_KEY=""

APP_URL="MY_APP_URL"
```

---

## 4. Verification Commands Before Shipping Changes
```bash
# 1. Pure engine & analytics unit tests
npx --yes tsx --test src/engine/routeSimulation.test.ts src/engine/streetViewMotion.test.ts src/utils/tripAnalytics.test.ts

# 2. TypeScript check & Vite production bundle
npm run lint
npm run build

# 3. Runtime server check
npm run dev
```

Also verify in headless Chromium (`playwright-cli`):
- Title Screen (`글로벌 추천 코스` & `챌린지 코스` tabs),
- Active Drive (`?autostart=1` or Challenge launch) verifying dual Street View layers (`[data-testid="street-view-canvas"]` + standby sibling) crossfade smoothly with zero console errors,
- Corner deceleration HUD badge (`코너 감속`) during turns,
- Driving History Dashboard (`이번 주행`, `전체 누적`, `챌린지 순위` tabs & Recharts SVGs).
