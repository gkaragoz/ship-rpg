import { describe, expect, it } from 'vitest';
import { DEFAULT_CLOCK, HOUR_PRESETS, formatHour, hourAt, startHourFor, sunState } from '../src/world';

describe('hourAt', () => {
  it('starts at the start hour and runs a day in dayMinutes', () => {
    expect(hourAt(0)).toBe(9);
    expect(hourAt(12 * 60)).toBeCloseTo(21); // half a 24-minute day later
    expect(hourAt(24 * 60)).toBeCloseTo(9); // a whole day later: back to the start
    expect(hourAt(60, { dayMinutes: 2, startHour: 0, frozen: false })).toBeCloseTo(12);
  });

  it('wraps past midnight, and stands still when frozen', () => {
    expect(hourAt(20 * 60)).toBeCloseTo(((9 + 20) % 24));
    expect(hourAt(5000, { ...DEFAULT_CLOCK, frozen: true })).toBe(9);
    for (let t = 0; t < 100000; t += 777) {
      const h = hourAt(t);
      expect(h).toBeGreaterThanOrEqual(0);
      expect(h).toBeLessThan(24);
    }
  });

  it('can be set to an hour at a given moment (startHourFor)', () => {
    const t = 500;
    const start = startHourFor(21, t, DEFAULT_CLOCK);
    expect(hourAt(t, { ...DEFAULT_CLOCK, startHour: start })).toBeCloseTo(21);
    expect(startHourFor(3, t, { ...DEFAULT_CLOCK, frozen: true })).toBe(3);
  });
});

describe('sunState', () => {
  it('is high and in the south at noon, below the horizon at midnight', () => {
    const noon = sunState(12);
    expect(noon.elevation).toBeGreaterThan(0.8);
    expect(noon.sun[2]).toBeGreaterThan(0); // z is south
    expect(noon.daylight).toBe(1);
    expect(noon.phase).toBe('day');
    const midnight = sunState(0);
    expect(midnight.elevation).toBeLessThan(0);
    expect(midnight.daylight).toBe(0);
    expect(midnight.phase).toBe('night');
    expect(midnight.moon[1]).toBeGreaterThan(0.3); // the moon stands high at midnight
  });

  it('rises in the east and sets in the west', () => {
    expect(sunState(7).sun[0]).toBeGreaterThan(0.3); // east is +x
    expect(sunState(17).sun[0]).toBeLessThan(-0.3);
    expect(sunState(7).sun[1]).toBeGreaterThan(0);
  });

  it('has unit vectors and smooth daylight that rises through the morning and falls through the evening', () => {
    let prev = sunState(0).daylight;
    for (let h = 0; h <= 12; h += 0.25) {
      const s = sunState(h);
      expect(Math.hypot(...s.sun)).toBeCloseTo(1, 5);
      expect(Math.hypot(...s.moon)).toBeCloseTo(1, 5);
      expect(s.daylight).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = s.daylight;
    }
    for (let h = 12; h <= 24; h += 0.25) {
      const s = sunState(h);
      expect(s.daylight).toBeLessThanOrEqual(prev + 1e-9);
      prev = s.daylight;
    }
  });

  it('names dawn and dusk around sunrise and sunset, and the presets land in their phases', () => {
    expect(sunState(HOUR_PRESETS.dawn).phase).toBe('dawn');
    expect(sunState(HOUR_PRESETS.dusk).phase).toBe('dusk');
    expect(sunState(HOUR_PRESETS.noon).phase).toBe('day');
    expect(sunState(HOUR_PRESETS.night).phase).toBe('night');
    expect(sunState(HOUR_PRESETS.dawn).twilight).toBeGreaterThan(0.3);
  });
});

describe('formatHour', () => {
  it('writes hours and minutes', () => {
    expect(formatHour(9)).toBe('09:00');
    expect(formatHour(18.5)).toBe('18:30');
    expect(formatHour(23.999)).toBe('23:59');
    expect(formatHour(24)).toBe('00:00');
    expect(formatHour(-1)).toBe('23:00');
  });
});
