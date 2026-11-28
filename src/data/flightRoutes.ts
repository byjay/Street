import type { TripLeg } from '../types/drive';

export interface RawFlightNode {
  lat: number;
  lng: number;
  altitudeMeters: number;
  landmarkName: string;
  description: string;
}

export const BUSAN_TO_SEOUL_NODES: RawFlightNode[] = [
  {
    lat: 35.1796,
    lng: 128.9382,
    altitudeMeters: 30,
    landmarkName: '김해국제공항 (PUS)',
    description: '낙동강 하구와 서부산 평야를 뒤로하고 활주로를 힘차게 이륙합니다.',
  },
  {
    lat: 35.5038,
    lng: 128.7465,
    altitudeMeters: 3800,
    landmarkName: '밀양·청도 상공',
    description: '영남알프스 산군과 낙동강 본류 물줄기를 가로질러 고도를 높입니다.',
  },
  {
    lat: 35.9890,
    lng: 128.6930,
    altitudeMeters: 7200,
    landmarkName: '대구 팔공산 상공',
    description: '대구 분지와 팔공산 비로봉 능선이 날개 아래로 시원하게 펼쳐집니다.',
  },
  {
    lat: 36.2080,
    lng: 128.0060,
    altitudeMeters: 8500,
    landmarkName: '김천·추풍령 상공',
    description: '백두대간 소백산맥의 능선을 넘어 영남에서 충청권 내륙으로 진입합니다.',
  },
  {
    lat: 36.6424,
    lng: 127.4890,
    altitudeMeters: 8500,
    landmarkName: '청주·대청호 상공',
    description: '내륙의 호수 대청호와 금강 수계를 순항 고도 8,500m에서 내려다봅니다.',
  },
  {
    lat: 37.2636,
    lng: 127.0286,
    altitudeMeters: 3200,
    landmarkName: '안성·수원 상공',
    description: '수도권 남부 평야와 광교·수원 일대로 진입하며 착륙 강하를 시작합니다.',
  },
  {
    lat: 37.5583,
    lng: 126.7906,
    altitudeMeters: 35,
    landmarkName: '김포국제공항 (GMP)',
    description: '한강 하류와 서울 서부 스카이라인을 조망한 뒤 김포공항 활주로에 착륙합니다.',
  },
];

export const MULTI_LEG_BUSAN_SEOUL_JOURNEY: TripLeg[] = [
  {
    id: 'leg-1-flight-pus-gmp',
    title: '1구간 · 부산(PUS) → 서울(GMP) 3D 비행',
    transportMode: 'flight',
    originName: '김해국제공항 (PUS)',
    destinationName: '김포국제공항 (GMP)',
    origin: { lat: 35.1796, lng: 128.9382 },
    destination: { lat: 37.5583, lng: 126.7906 },
    autoTransitionToNext: true,
  },
  {
    id: 'leg-2-drive-gmp-gwanghwamun',
    title: '2구간 · 김포공항 → 광화문 광장 도심 주행',
    transportMode: 'drive',
    originName: '김포국제공항',
    destinationName: '광화문 광장',
    origin: { lat: 37.5585, lng: 126.7945 },
    destination: { lat: 37.5759, lng: 126.9769 },
    autoTransitionToNext: true,
  },
  {
    id: 'leg-3-walk-gwanghwamun-bukchon',
    title: '3구간 · 광화문 → 경복궁·북촌 도보 산책',
    transportMode: 'walk',
    originName: '광화문 광장',
    destinationName: '북촌 한옥마을',
    origin: { lat: 37.5759, lng: 126.9769 },
    destination: { lat: 37.5826, lng: 126.9830 },
    autoTransitionToNext: false,
  },
];
