import * as THREE from 'three';
import type { MastSpec, ShipSpec } from './types';
import type { ShipMaterials } from './materials';
import { bulwark, deckHeight, halfBeam, sectionPoint } from './hullShape';
import { cylinderBetween, gridSail } from './parts';

const V = (x: number, y: number, z = 0): THREE.Vector3 => new THREE.Vector3(x, y, z);
const BILLOW_FORWARD = V(1, 0, 0);
const BILLOW_SIDE = V(0, 0, 1);

/** Mast base position in ship space. `at` runs bow (0) to stern (1). */
function mastBase(spec: ShipSpec, m: MastSpec): THREE.Vector3 {
  return V((0.5 - m.at) * spec.length, deckHeight(spec, 1 - m.at) - bulwark(spec), 0);
}

/** Masts, yards, sails, bowsprit, jibs and a pennant. */
export function buildRig(spec: ShipSpec, mats: ShipMaterials): THREE.Group {
  const rig = new THREE.Group();
  rig.name = 'rig';
  const tallest = spec.masts.reduce((a, m) => Math.max(a, m.height), 0);
  for (const m of spec.masts) rig.add(buildMast(spec, m, mats, m.height === tallest));
  spec.masts.forEach((m, i) => {
    const next = spec.masts[i + 1];
    if (!next) return;
    const a = mastBase(spec, m);
    const b = mastBase(spec, next);
    rig.add(cylinderBetween(V(a.x, a.y + m.height * 0.88), V(b.x, b.y + next.height * 0.5), 0.03, mats.wood));
  });
  if (spec.bowsprit > 0) rig.add(buildBowsprit(spec, mats));
  return rig;
}

function buildMast(spec: ShipSpec, m: MastSpec, mats: ShipMaterials, flag: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = 'mast';
  g.position.copy(mastBase(spec, m));
  g.rotation.z = m.rake ?? 0.03;

  const radius = 0.1 + 0.006 * m.height;
  const pole = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.5, radius, m.height, 6), mats.wood);
  pole.position.y = m.height / 2;
  g.add(pole);

  // Space abaft the mast before the sail would overhang the stern.
  const aft = (1 - m.at) * spec.length + 0.05 * spec.length;
  const fore = m.at * spec.length + 0.05 * spec.length;
  // Sails are trimmed for a wind from the port quarter: square yards braced round
  // to starboard, fore-and-aft sails sheeted out to starboard.
  if (m.rig === 'square') {
    addSquareSails(trimmed(g, SQUARE_BRACE), spec, m, mats);
    if (m.spanker) addGaffSail(trimmed(g, SHEET_ANGLE), m, mats, Math.min(spec.length * 0.2, aft), 0.12, 0.5);
    if (m.height >= 16) g.add(top(m, mats));
  } else if (m.rig === 'gaff') {
    addGaffSail(trimmed(g, SHEET_ANGLE), m, mats, Math.min(spec.length * 0.3, aft), 0.1, 0.62);
  } else if (m.rig === 'lug') {
    addLugSail(trimmed(g, SHEET_ANGLE), m, mats, Math.min(spec.length * 0.22, aft));
  } else {
    addLateenSail(trimmed(g, SHEET_ANGLE), spec, m, mats, aft, fore);
  }

  if (m.height >= 10) addShrouds(g, spec, m, mats);
  if (flag) {
    const p = pennant(m.height, mats);
    p.rotation.y = 0.3;
    g.add(p);
  }
  return g;
}

const SQUARE_BRACE = 0.2;
const SHEET_ANGLE = 0.28;

/** Child group rotated about the mast axis (positive swings the stern side to starboard). */
function trimmed(parent: THREE.Group, angle: number): THREE.Group {
  const t = new THREE.Group();
  t.rotation.y = angle;
  parent.add(t);
  return t;
}

/** Fighting top: a small platform part way up the mast. */
function top(m: MastSpec, mats: ShipMaterials): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2 + 0.03 * m.height, 0.14, 1.0 + 0.025 * m.height), mats.wood);
  mesh.position.y = m.height * 0.46;
  return mesh;
}

/** Shrouds: lines from the masthead down to the rail on both sides. */
function addShrouds(g: THREE.Group, spec: ShipSpec, m: MastSpec, mats: ShipMaterials): void {
  const hw = halfBeam(spec, 1 - m.at) * 0.92;
  const count = m.height >= 20 ? 3 : 2;
  const spread = Math.min(Math.max(spec.length * 0.03, 0.6), 2);
  const head = V(0, m.height * (m.rig === 'square' ? 0.62 : 0.5));
  for (const side of [-1, 1]) {
    for (let k = 0; k < count; k++) {
      const dx = (k - (count - 1) / 2) * spread;
      g.add(cylinderBetween(head, V(dx, bulwark(spec), side * hw), 0.03, mats.wood));
    }
  }
}

function addSquareSails(g: THREE.Group, spec: ShipSpec, m: MastSpec, mats: ShipMaterials): void {
  const tiers = m.tiers ?? 2;
  const weights = Array.from({ length: tiers }, (_, k) => Math.max(1.35 - 0.3 * k, 0.6));
  const total = weights.reduce((a, b) => a + b, 0);
  const region = m.height * 0.81;
  const courseWidth = Math.min(spec.beam * 1.35, m.height * 0.55);
  let y = m.height * 0.16;
  weights.forEach((weight, k) => {
    const h = (region * weight) / total;
    const yb = y;
    const yt = y + h * 0.96;
    y += h;
    const wb = courseWidth * 0.82 ** k;
    const wt = wb * 0.82;
    g.add(
      gridSail((u, v) => V(0, yb + (yt - yb) * v, (u - 0.5) * (wb + (wt - wb) * v)), BILLOW_FORWARD, wb * 0.1, mats.sail),
      cylinderBetween(V(0, yt, -wt * 0.54), V(0, yt, wt * 0.54), 0.08 + 0.004 * m.height, mats.wood),
    );
  });
}

/** Quad sail with boom (bottom) and gaff (top) running aft from the mast. */
function addGaffSail(g: THREE.Group, m: MastSpec, mats: ShipMaterials, boom: number, lowFrac: number, highFrac: number): void {
  const yb = m.height * lowFrac;
  const yt = m.height * highFrac;
  const tack = V(0, yb);
  const clew = V(-boom, yb);
  const throat = V(0, yt);
  const peak = V(-boom * 0.6, yt + boom * 0.18);
  g.add(
    gridSail(
      (u, v) => tack.clone().lerp(clew, u).lerp(throat.clone().lerp(peak, u), v),
      BILLOW_SIDE,
      boom * 0.08,
      mats.sail,
    ),
    cylinderBetween(tack, clew, 0.1, mats.wood),
    cylinderBetween(throat, peak, 0.08, mats.wood),
  );
}

/** Lugsail: slanted yard crossing the mast, sail mostly abaft it. */
function addLugSail(g: THREE.Group, m: MastSpec, mats: ShipMaterials, boom: number): void {
  const yb = m.height * 0.1;
  const yt = m.height * 0.62;
  const bottomFore = V(boom * 0.3, yb);
  const bottomAft = V(-boom * 0.75, yb);
  const topFore = V(boom * 0.3, yt - m.height * 0.1);
  const topAft = V(-boom * 0.6, yt + m.height * 0.1);
  g.add(
    gridSail(
      (u, v) => bottomFore.clone().lerp(bottomAft, u).lerp(topFore.clone().lerp(topAft, u), v),
      BILLOW_SIDE,
      boom * 0.08,
      mats.sail,
    ),
    cylinderBetween(topFore, topAft, 0.08, mats.wood),
  );
}

/** Lateen: long yard sloping up toward the stern, triangular sail. */
function addLateenSail(g: THREE.Group, spec: ShipSpec, m: MastSpec, mats: ShipMaterials, aft: number, fore: number): void {
  const L = spec.length;
  const tack = V(Math.min(L * 0.18, fore), m.height * 0.2);
  const peak = V(-Math.min(L * 0.15, aft), m.height * 0.97);
  const clew = V(-Math.min(L * 0.36, aft), m.height * 0.2);
  g.add(
    gridSail(
      (u, v) => tack.clone().add(peak.clone().sub(tack).multiplyScalar(u)).add(clew.clone().sub(tack).multiplyScalar(v * (1 - u))),
      BILLOW_SIDE,
      L * 0.03,
      mats.sail,
    ),
    cylinderBetween(tack, peak, 0.1, mats.wood),
  );
}

function pennant(height: number, mats: ShipMaterials): THREE.Mesh {
  const len = Math.max(1.2, height * 0.12);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    'position',
    new THREE.Float32BufferAttribute([0, height, 0, -len, height - len * 0.15, 0, 0, height - len * 0.35, 0], 3),
  );
  geometry.setIndex([0, 1, 2]);
  return new THREE.Mesh(geometry, mats.flag);
}

function buildBowsprit(spec: ShipSpec, mats: ShipMaterials): THREE.Group {
  const g = new THREE.Group();
  g.name = 'bowsprit';
  const bow = sectionPoint(spec, 1, 0);
  const base = V(bow.x - spec.length * 0.15, bow.y - 0.2);
  const angle = 0.3;
  const tip = V(bow.x + spec.bowsprit * Math.cos(angle), bow.y - 0.2 + spec.bowsprit * Math.sin(angle));
  g.add(cylinderBetween(base, tip, 0.14, mats.wood));

  const foremast = spec.masts[0];
  if (!foremast || spec.jibs <= 0) return g;
  const foreBase = mastBase(spec, foremast);
  const head = V(foreBase.x, foreBase.y + foremast.height * 0.9);
  g.add(cylinderBetween(tip, head, 0.04, mats.wood));
  for (let i = 0; i < spec.jibs; i++) {
    const k = spec.jibs === 1 ? 0.5 : i / (spec.jibs - 1);
    const tack = tip.clone().lerp(base, 0.08 + 0.3 * k);
    const top = tip.clone().lerp(head, 0.4 + 0.5 * k);
    const clew = V(foreBase.x + 2.2, foreBase.y + 1 + 0.6 * k, 0.04 * i);
    g.add(
      gridSail(
        (u, v) => tack.clone().add(top.clone().sub(tack).multiplyScalar(u)).add(clew.clone().sub(tack).multiplyScalar(v * (1 - u))),
        BILLOW_SIDE,
        spec.length * 0.012,
        mats.sail,
        6,
      ),
    );
  }
  return g;
}
