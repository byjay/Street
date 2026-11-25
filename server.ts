import 'dotenv/config';
import express from 'express';
import type { Request, Response } from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const IS_PROD = process.env.NODE_ENV === 'production';

interface GroundedPlaceLink {
  title: string;
  uri: string;
  placeId?: string;
  reviewSnippets: string[];
}

interface GroundingGuideBody {
  query?: string;
  placeName?: string;
  lat?: number;
  lng?: number;
  mode?: 'nearby' | 'destination' | 'search';
}

function getGenAIClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    return null;
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/config', (_req: Request, res: Response) => {
    const mapsApiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';
    res.json({ mapsApiKey });
  });

  app.post('/api/geocode/regions', async (req: Request, res: Response) => {
    const mapsApiKey =
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_API_KEY ||
      '';
    if (!mapsApiKey) {
      res.json({ regions: [], fallbackRequired: true });
      return;
    }

    const body = (req.body ?? {}) as {
      points?: Array<{ lat?: number; lng?: number }>;
    };
    const rawPoints = Array.isArray(body.points) ? body.points.slice(0, 5) : [];
    const validPoints = rawPoints.filter(
      (p): p is { lat: number; lng: number } =>
        typeof p?.lat === 'number' &&
        Number.isFinite(p.lat) &&
        typeof p?.lng === 'number' &&
        Number.isFinite(p.lng)
    );

    if (validPoints.length === 0) {
      res.json({ regions: [] });
      return;
    }

    const regions: string[] = [];
    const seen = new Set<string>();
    let fallbackRequired = false;

    try {
      const results = await Promise.all(
        validPoints.map(async (pt) => {
          const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
          url.searchParams.set('latlng', `${pt.lat},${pt.lng}`);
          url.searchParams.set('language', 'ko');
          url.searchParams.set(
            'result_type',
            'sublocality_level_2|sublocality_level_1|locality|administrative_area_level_2'
          );
          url.searchParams.set('key', mapsApiKey);

          const resp = await fetch(url.toString());
          if (!resp.ok) return null;
          return (await resp.json()) as {
            status?: string;
            results?: Array<{
              formatted_address?: string;
              address_components?: Array<{
                long_name?: string;
                types?: string[];
              }>;
            }>;
          };
        })
      );

      for (const data of results) {
        if (!data) continue;
        if (
          data.status === 'REQUEST_DENIED' ||
          data.status === 'OVER_QUERY_LIMIT'
        ) {
          fallbackRequired = true;
          continue;
        }
        const first = data.results?.[0];
        if (!first?.address_components) continue;

        const sub1 = first.address_components.find((c) =>
          c.types?.includes('sublocality_level_1')
        )?.long_name;
        const sub2 = first.address_components.find((c) =>
          c.types?.includes('sublocality_level_2')
        )?.long_name;
        const locality = first.address_components.find((c) =>
          c.types?.includes('locality')
        )?.long_name;
        const admin2 = first.address_components.find((c) =>
          c.types?.includes('administrative_area_level_2')
        )?.long_name;

        const labelParts = [sub1 || admin2 || locality, sub2].filter(Boolean);
        const label =
          labelParts.length > 0
            ? Array.from(new Set(labelParts)).join(' ')
            : first.formatted_address?.split(',')[0]?.trim() || '';

        if (label && !seen.has(label)) {
          seen.add(label);
          regions.push(label);
        }
      }
    } catch {
      fallbackRequired = true;
    }

    res.json({ regions, fallbackRequired });
  });

  app.post('/api/grounding/guide', async (req: Request, res: Response) => {
    const ai = getGenAIClient();
    if (!ai) {
      res.status(503).json({
        error: 'GEMINI_API_KEY가 설정되어 있지 않습니다. Settings > Secrets에서 확인해 주세요.',
      });
      return;
    }

    const body = (req.body ?? {}) as GroundingGuideBody;
    const lat = typeof body.lat === 'number' && Number.isFinite(body.lat) ? body.lat : null;
    const lng = typeof body.lng === 'number' && Number.isFinite(body.lng) ? body.lng : null;
    const mode = body.mode || 'nearby';
    const rawQuery = typeof body.query === 'string' ? body.query.trim() : '';
    const placeName = typeof body.placeName === 'string' ? body.placeName.trim() : '';

    if (!rawQuery && !placeName && (lat === null || lng === null)) {
      res.status(400).json({ error: '위치 좌표 또는 검색어가 필요합니다.' });
      return;
    }

    let prompt = '';
    if (mode === 'destination' && placeName) {
      prompt = `사용자가 택시 360도 가상 드라이브로 "${placeName}"에 가고 있거나 도착 예정입니다. 이 장소와 바로 근처의 핵심 볼거리, 분위기, 추천 들를 곳 3~4곳을 한국어로 간결하고 생생하게 안내해 주세요.`;
    } else if (mode === 'search' && rawQuery) {
      prompt = `사용자가 "${rawQuery}"에 대해 드라이브 목적지나 주변 명소/맛집을 찾고 있습니다. 실제 존재하는 추천 장소 3~4곳과 특징을 한국어로 간결하게 정리해 주세요.`;
    } else {
      const locationContext = placeName ? `(${placeName} 부근)` : '';
      prompt = `현재 차량이 지나가고 있는 위치 ${locationContext} 주변에서 창밖으로 보거나 들르기 좋은 실제 랜드마크, 명소, 카페·맛집 3~4곳을 한국어로 간결하게 브리핑해 주세요.`;
    }

    try {
      const config: {
        tools: Array<{ googleMaps: Record<string, never> }>;
        toolConfig?: {
          retrievalConfig: {
            latLng: { latitude: number; longitude: number };
          };
        };
      } = {
        tools: [{ googleMaps: {} }],
      };

      if (lat !== null && lng !== null) {
        config.toolConfig = {
          retrievalConfig: {
            latLng: {
              latitude: lat,
              longitude: lng,
            },
          },
        };
      }

      const response = await ai.models.generateContent({
        model: 'gemini-4-hydrogen',
        contents: prompt,
        config,
      });

      const chunks =
        response.candidates?.[0]?.groundingMetadata?.groundingChunks ?? [];
      const places: GroundedPlaceLink[] = [];
      const seenUris = new Set<string>();

      for (const chunk of chunks) {
        const mapsData = (chunk as {
          maps?: {
            uri?: string;
            title?: string;
            placeId?: string;
            placeAnswerSources?: {
              reviewSnippets?: Array<{ reviewText?: string } | string>;
            };
          };
        }).maps;

        if (!mapsData || !mapsData.uri || seenUris.has(mapsData.uri)) {
          continue;
        }
        seenUris.add(mapsData.uri);

        const rawSnippets = mapsData.placeAnswerSources?.reviewSnippets ?? [];
        const reviewSnippets: string[] = [];
        for (const snippet of rawSnippets) {
          if (typeof snippet === 'string' && snippet.trim()) {
            reviewSnippets.push(snippet.trim());
          } else if (
            snippet &&
            typeof snippet === 'object' &&
            typeof snippet.reviewText === 'string' &&
            snippet.reviewText.trim()
          ) {
            reviewSnippets.push(snippet.reviewText.trim());
          }
        }

        places.push({
          title: mapsData.title || 'Google 지도 장소',
          uri: mapsData.uri,
          placeId: mapsData.placeId,
          reviewSnippets: reviewSnippets.slice(0, 2),
        });
      }

      res.json({
        summary: response.text ?? '',
        places,
      });
    } catch (error) {
      const errObj = error as { status?: number; message?: string };
      const status = typeof errObj?.status === 'number' ? errObj.status : 500;
      console.error('Maps Grounding error:', errObj?.message || error);

      if (status === 429) {
        res.status(429).json({
          error: '요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.',
        });
        return;
      }
      if (status === 403 || status === 400) {
        res.status(status).json({
          error: errObj?.message || 'Maps Grounding 요청을 처리할 수 없습니다.',
        });
        return;
      }
      res.status(500).json({
        error: '주변 AI 가이드 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.',
      });
    }
  });

  if (!IS_PROD) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`RoadWindow 360 server listening on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
