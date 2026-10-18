import { describe, expect, it } from 'vitest';
import { createGame } from '../src/gameplay';
import { createWeatherState } from '../src/gameplay/weatherState';
import { getShipSpec } from '../src/ships';
import { NEUTRAL_TUNING, WEATHER_PRESETS, autoLightning, autoRain, seaStateAt, weatherAt, windAt } from '../src/world';

describe('weatherAt', () => {
  it("is the game's own weather when nothing is overridden", () => {
    for (const t of [0, 100, 777, 4000]) {
      const w = weatherAt(t);
      expect(w.windSpeed).toBe(windAt(t).speed);
      expect(w.windFrom).toBe(windAt(t).from);
      expect(w.seaState).toBe(seaStateAt(t, windAt(t).speed));
      expect(w.cloud).toBeNull();
      expect(w.fog).toBeNull();
      expect(w.tuning).toEqual(NEUTRAL_TUNING);
    }
  });

  it('takes the overridden parts and keeps the rest, and a wind override changes the sea the wind builds', () => {
    const w = weatherAt(100, { windSpeed: 20, cloud: 0.7, tuning: { amp: 2 } });
    expect(w.windSpeed).toBe(20);
    expect(w.windFrom).toBe(windAt(100).from);
    expect(w.cloud).toBe(0.7);
    expect(w.tuning).toEqual({ ...NEUTRAL_TUNING, amp: 2 });
    expect(w.seaState).toBeGreaterThan(weatherAt(100, { windSpeed: 4 }).seaState);
    expect(weatherAt(100, { seaState: 0.2, windSpeed: 25 }).seaState).toBe(0.2);
  });

  it('clamps out-of-range values', () => {
    const w = weatherAt(0, { seaState: 4, rain: -1, cloud: 9, lightning: 3 });
    expect([w.seaState, w.rain, w.cloud, w.lightning]).toEqual([1, 0, 1, 1]);
  });

  it('rains and flashes only in a rough sea of its own', () => {
    expect(autoRain(0.3)).toBe(0);
    expect(autoRain(1)).toBeGreaterThan(0.5);
    expect(autoLightning(0.7)).toBe(0);
    expect(autoLightning(1)).toBeGreaterThan(0.3);
    expect(weatherAt(0, { seaState: 1 }).rain).toBeGreaterThan(0);
  });

  it('has presets that run from calm to a hurricane', () => {
    expect(Object.keys(WEATHER_PRESETS)).toContain('Fırtına');
    const calm = weatherAt(0, WEATHER_PRESETS['Durgun']);
    const hurricane = weatherAt(0, WEATHER_PRESETS['Kasırga']);
    expect(hurricane.windSpeed).toBeGreaterThan(calm.windSpeed * 4);
    expect(hurricane.seaState).toBeGreaterThan(calm.seaState);
    expect(hurricane.tuning.amp).toBeGreaterThan(1);
  });
});

describe('weather state', () => {
  const origin = { x: 0, z: 0 };

  it('patches overrides, takes them back with undefined, and clears with null', () => {
    const s = createWeatherState();
    s.patch({ windSpeed: 22, tuning: { amp: 2 } });
    s.patch({ tuning: { chop: 0.5 } });
    expect(s.update(0, 0, origin)).toMatchObject({ windSpeed: 22, tuning: { amp: 2, chop: 0.5, length: 1, speed: 1 } });
    s.patch({ windSpeed: undefined, tuning: { amp: undefined } });
    const w = s.update(0, 0, origin);
    expect(w.windSpeed).toBe(windAt(0).speed);
    expect(w.tuning.amp).toBe(1);
    expect(w.tuning.chop).toBe(0.5);
    s.patch(null);
    expect(s.update(0, 0, origin).tuning).toEqual(NEUTRAL_TUNING);
  });

  it('strikes lightning around the ship only when it is set, with a new id each time', () => {
    const s = createWeatherState();
    for (let t = 0; t < 60; t += 0.1) s.update(t, 0.1, origin);
    expect(s.view(s.update(60, 0, origin)).strike).toBeNull();
    s.patch({ lightning: 1 });
    const ids = new Set<number>();
    for (let t = 60; t < 200; t += 0.1) {
      const strike = s.view(s.update(t, 0.1, { x: 100, z: 200 })).strike;
      if (strike) {
        ids.add(strike.id);
        expect(Math.hypot(strike.x - 100, strike.z - 200)).toBeLessThanOrEqual(3000);
      }
    }
    expect(ids.size).toBeGreaterThanOrEqual(4);
  });
});

describe('the game in simulated weather', () => {
  const spec = getShipSpec('tartane');
  if (!spec) throw new Error('no tartane');

  it('sails to the simulated wind: a gale blows the ship faster than a calm', () => {
    const run = (windSpeed: number): number => {
      const g = createGame(spec);
      g.setWeather({ windSpeed, windFrom: Math.PI });
      for (let i = 0; i < 60 * 40; i++) g.update(1 / 60, { rudder: 0, sailStep: i === 0 ? 1 : 0 });
      return g.view().ship.speed;
    };
    expect(run(12)).toBeGreaterThan(run(1.5));
  });

  it('carries the weather in the view and gives it back on request', () => {
    const g = createGame(spec);
    g.setWeather({ rain: 0.8, cloud: 0.9, fog: 0.4, tuning: { amp: 2 } });
    g.update(1 / 60, { rudder: 0, sailStep: 0 });
    expect(g.view().weather).toMatchObject({ rain: 0.8, cloud: 0.9, fog: 0.4, tuning: { amp: 2 } });
    g.setWeather(null);
    g.update(1 / 60, { rudder: 0, sailStep: 0 });
    expect(g.view().weather).toMatchObject({ rain: 0, cloud: null, fog: null });
    g.dev.setSea(1);
    g.update(1 / 60, { rudder: 0, sailStep: 0 });
    expect(g.view().seaState).toBe(1);
    g.dev.setSea(null);
    g.update(1 / 60, { rudder: 0, sailStep: 0 });
    expect(g.view().seaState).toBeLessThan(1);
  });
});
