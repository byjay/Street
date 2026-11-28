import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseNominatimResults,
  parseOsrmRouteResponse,
  parsePhotonFeatures,
} from './freeMapsHelpers';

test('parsePhotonFeatures extracts coordinates and deduplicated address labels', () => {
  const places = parsePhotonFeatures([
    {
      geometry: { coordinates: [127.0276, 37.4979] },
      properties: {
        osm_id: 12345,
        name: '강남역',
        street: '강남대로',
        district: '역삼동',
        city: '서울특별시',
        country: '대한민국',
      },
    },
    {
      geometry: { coordinates: [NaN, 37.5] },
      properties: { name: '잘못된 좌표' },
    },
  ]);

  assert.equal(places.length, 1);
  assert.equal(places[0].name, '강남역');
  assert.equal(places[0].location.lat, 37.4979);
  assert.equal(places[0].location.lng, 127.0276);
  assert.ok(places[0].address?.includes('강남대로'));
});

test('parseNominatimResults converts Nominatim search payload cleanly', () => {
  const places = parseNominatimResults([
    {
      place_id: 99,
      lat: '48.8582599',
      lon: '2.2945006',
      name: 'Tour Eiffel',
      display_name: 'Tour Eiffel, Paris, France',
    },
  ]);

  assert.equal(places.length, 1);
  assert.equal(places[0].name, 'Tour Eiffel');
  assert.equal(places[0].location.lat, 48.8582599);
  assert.equal(places[0].location.lng, 2.2945006);
});

test('parseOsrmRouteResponse maps GeoJSON path and Korean turn-by-turn steps', () => {
  const origin = { name: '강남역', location: { lat: 37.4979, lng: 127.0276 } };
  const dest = { name: '코엑스', location: { lat: 37.5118, lng: 127.0591 } };

  const routeData = parseOsrmRouteResponse(
    {
      code: 'Ok',
      routes: [
        {
          distance: 3400,
          duration: 420,
          geometry: {
            type: 'LineString',
            coordinates: [
              [127.0276, 37.4979],
              [127.043, 37.5045],
              [127.0591, 37.5118],
            ],
          },
          legs: [
            {
              steps: [
                {
                  distance: 1500,
                  duration: 180,
                  name: '테헤란로',
                  maneuver: {
                    type: 'depart',
                    location: [127.0276, 37.4979],
                  },
                },
                {
                  distance: 1900,
                  duration: 240,
                  name: '영동대로',
                  maneuver: {
                    type: 'turn',
                    modifier: 'left',
                    location: [127.043, 37.5045],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
    origin,
    dest,
    'DRIVING'
  );

  assert.equal(routeData.path.length, 3);
  assert.ok(routeData.totalDistanceMeters > 2500);
  assert.equal(routeData.steps.length, 2);
  assert.equal(routeData.steps[0].instructions, '테헤란로 따라 출발');
  assert.equal(routeData.steps[1].maneuver, 'LEFT');
  assert.equal(routeData.steps[1].instructions, '영동대로 방면으로 좌회전');
});
