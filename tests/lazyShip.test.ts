import * as THREE from 'three';
import { describe, expect, it, vi } from 'vitest';
import type { Condition } from '../src/core';
import type { Ship } from '../src/ships/factory';
import { createUpgradingShip } from '../src/ships/lazyShip';
import { getShipSpec, type ShipSpec } from '../src/ships';

function brig(): ShipSpec {
  const s = getShipSpec('brig');
  if (!s) throw new Error('no brig spec');
  return s;
}

function fakeShip(): Ship & { calls: string[] } {
  const calls: string[] = [];
  const root = new THREE.Group();
  return {
    spec: brig(),
    root,
    calls,
    setSailTrim: (w, l) => calls.push(`trim ${w} ${l}`),
    setCondition: (c: Condition, t: number) => calls.push(`cond ${c.rigging} ${t}`),
    setLod: (l) => calls.push(`lod ${l}`),
    dispose: () => {
      calls.push('dispose');
      root.removeFromParent();
    },
  };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('createUpgradingShip', () => {
  it('shows the placeholder, then swaps in the loaded model under the same root and replays the state', async () => {
    const placeholder = fakeShip();
    const real = fakeShip();
    let resolve: (s: Ship) => void = () => undefined;
    const ship = createUpgradingShip(placeholder, () => new Promise<Ship>((r) => (resolve = r)));
    const scene = new THREE.Group();
    scene.add(ship.root); // the caller keeps this root for good
    expect(ship.root.children).toEqual([placeholder.root]);

    ship.setSailTrim(0.5, 1);
    ship.setCondition({ rigging: 0.4, flooding: 0, fire: 0 }, 12);
    ship.setLod?.(2);
    expect(placeholder.calls).toEqual(['trim 0.5 1', 'cond 0.4 12', 'lod 2']);

    resolve(real);
    await flush();
    expect(ship.root.parent).toBe(scene);
    expect(ship.root.children).toEqual([real.root]);
    expect(placeholder.calls).toContain('dispose');
    expect(real.calls).toEqual(['trim 0.5 1', 'cond 0.4 12', 'lod 2']);

    ship.setSailTrim(-1, 0.2); // later calls go to the model
    expect(real.calls.at(-1)).toBe('trim -1 0.2');
  });

  it('keeps the placeholder when the model cannot be loaded', async () => {
    const placeholder = fakeShip();
    const ship = createUpgradingShip(placeholder, () => Promise.resolve(undefined));
    await flush();
    expect(ship.root.children).toEqual([placeholder.root]);
    expect(placeholder.calls).not.toContain('dispose');
  });

  it('disposes a model that arrives after the ship was disposed', async () => {
    const placeholder = fakeShip();
    const real = fakeShip();
    let resolve: (s: Ship) => void = () => undefined;
    const ship = createUpgradingShip(placeholder, () => new Promise<Ship>((r) => (resolve = r)));
    ship.dispose();
    expect(placeholder.calls).toEqual(['dispose']);
    const spy = vi.spyOn(real, 'dispose');
    resolve(real);
    await flush();
    expect(spy).toHaveBeenCalledOnce();
    expect(ship.root.children).toEqual([]);
  });

  it('keeps the placeholder when building the model throws', async () => {
    const placeholder = fakeShip();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const bad = fakeShip();
    bad.setSailTrim = () => {
      throw new Error('broken model');
    };
    const ship = createUpgradingShip(placeholder, () => Promise.resolve(bad));
    ship.setSailTrim(0, 1);
    await flush();
    expect(ship.root.children).toEqual([placeholder.root]);
    expect(placeholder.calls).not.toContain('dispose');
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it('ignores a second dispose', () => {
    const placeholder = fakeShip();
    const ship = createUpgradingShip(placeholder, () => Promise.resolve(undefined));
    ship.dispose();
    ship.dispose();
    expect(placeholder.calls.filter((c) => c === 'dispose')).toHaveLength(1);
  });
});
