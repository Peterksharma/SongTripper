const { parseCoordinates, parseLimit, roundCoordinate, geoKey } = require('../utils/geo');
const ApiError = require('../utils/apiError');

describe('parseCoordinates', () => {
  it('parses valid numeric strings', () => {
    expect(parseCoordinates('30.267', '-97.743')).toEqual({ lat: 30.267, lng: -97.743 });
  });

  it('accepts the extreme corners of the valid range', () => {
    expect(parseCoordinates('90', '180')).toEqual({ lat: 90, lng: 180 });
    expect(parseCoordinates('-90', '-180')).toEqual({ lat: -90, lng: -180 });
  });

  it.each([
    [undefined, '-97', 'lat and lng query parameters are required'],
    ['30', undefined, 'lat and lng query parameters are required'],
    ['', '-97', 'lat and lng query parameters are required'],
    ['abc', '-97', 'lat and lng must be numbers'],
    ['30', 'xyz', 'lat and lng must be numbers'],
    ['Infinity', '-97', 'lat and lng must be numbers'],
    ['91', '-97', 'lat must be between -90 and 90'],
    ['-90.5', '-97', 'lat must be between -90 and 90'],
    ['30', '181', 'lng must be between -180 and 180'],
    ['30', '-180.1', 'lng must be between -180 and 180'],
  ])('rejects (%s, %s) with a 400', (lat, lng, message) => {
    expect(() => parseCoordinates(lat, lng)).toThrow(ApiError);
    expect(() => parseCoordinates(lat, lng)).toThrow(message);
    try {
      parseCoordinates(lat, lng);
    } catch (e) {
      expect(e.status).toBe(400);
    }
  });
});

describe('parseLimit', () => {
  it('defaults when absent', () => {
    expect(parseLimit(undefined)).toBe(10);
    expect(parseLimit('', { fallback: 25 })).toBe(25);
  });

  it('clamps into [1, max]', () => {
    expect(parseLimit('0')).toBe(1);
    expect(parseLimit('-3')).toBe(1);
    expect(parseLimit('999', { max: 50 })).toBe(50);
    expect(parseLimit('7')).toBe(7);
  });

  it('rejects non-integers with a 400', () => {
    for (const bad of ['abc', '1.5', 'NaN']) {
      expect(() => parseLimit(bad)).toThrow('limit must be an integer');
    }
  });
});

describe('coordinate rounding (the cache grid)', () => {
  it('rounds to two decimals', () => {
    expect(roundCoordinate(30.26715)).toBe(30.27);
    expect(roundCoordinate(-97.7431)).toBe(-97.74);
  });

  it('maps nearby readings to the same key — the reason the grid exists', () => {
    expect(geoKey(30.2671, -97.7431)).toBe(geoKey(30.2669, -97.7429));
  });

  it('separates readings a city apart', () => {
    expect(geoKey(30.27, -97.74)).not.toBe(geoKey(32.78, -96.8));
  });
});
