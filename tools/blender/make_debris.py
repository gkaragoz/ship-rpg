"""Build the cannon-hit debris props: public/models/props/debris.glb + debris.meta.json.

Headless:  blender -b --factory-startup --python tools/blender/make_debris.py
(also works exec()'d from an open Blender: the scene is left alone, everything is built in a Scratch scope).

Nine separate top-level meshes sharing ONE material (a 512 px atlas, WebP + meshopt): Plank_L/M/S, Splinter_A/B,
Barrel_Stave, Cloth_A/B, Rope_Coil. Real-world metres, origin at the piece centre, +Y up (glTF), long axis along x.
Atlas quadrants (u, v): weathered wood (0,0), tarred wood (.5,0), sailcloth (0,.5), hemp rope (.5,.5).
Contract: docs/SHIP_ASSETS.md "Props".
"""
import math
import pathlib
import random
import sys

import bpy
import bmesh
import numpy as np
from mathutils import Vector

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
for _name in ("shipkit", "pbrmesh", "pbrtex", "pbrmat", "pbrlayout"):
    sys.modules.pop(_name, None)
import pbrmat  # noqa: E402
import pbrtex as T  # noqa: E402
from pbrmesh import PM  # noqa: E402
from shipkit import NAME_OK, Scratch, export_glb, tri_count, write_json  # noqa: E402

OUT = HERE.parents[1] / "public" / "models" / "props"
RES = 256                      # per quadrant; the atlas is 2 x RES
TRI_MIN, TRI_MAX, MAX_BYTES = 40, 300, 400_000
REGION = dict(wood=(0.0, 0.0), tar=(0.5, 0.0), cloth=(0.0, 0.5), rope=(0.5, 0.5))

WEATHER = (0.72, 0.68, 0.62)   # tints multiply the albedo (linear)
FRESH = (1.0, 0.8, 0.52)       # freshly splintered wood on the torn ends
TAR = (1.0, 1.0, 1.0)


# --------------------------------------------------------------------------- textures
def _wood(seed, light, dark, rough, tar=False):
    rng = np.random.default_rng(seed)
    h = w = RES
    grain = T.fbm(h, w, 40, 3, rng, 4)
    fine = T.fbm(h, w, 110, 6, rng, 3)
    crack = T.smoothstep(0.62, 0.7, T.fbm(h, w, 16, 2, rng, 3))
    lum = np.clip(0.35 + 0.65 * grain, 0, 1) * (0.88 + 0.2 * fine)
    albedo = T.mix(T.rgb(dark), T.rgb(light), lum[..., None]) * (1 - 0.55 * crack[..., None])
    height = 0.5 * grain + 0.3 * fine - 0.8 * crack
    return dict(albedo=albedo.astype(np.float32), normal=T.normal_map(height, 6.0, 6.0, wrap=True),
                orm=T.orm(1 - 0.6 * crack, np.clip(rough + 0.2 * fine - (0.2 if tar else 0), 0, 1), np.zeros_like(fine)))


def _rope(seed=9):
    rng = np.random.default_rng(seed)
    h = w = RES
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    s = 0.5 + 0.5 * np.sin(2 * np.pi * (xs / w * 22 + ys / h * 2.0))
    fib = T.fbm(h, w, 64, 64, rng, 3, True)
    lum = 0.55 + 0.35 * s + 0.15 * fib
    albedo = np.clip(lum, 0, 1)[..., None] * T.rgb(0xB8A072) / 0.8
    height = 0.7 * s + 0.2 * fib
    return dict(albedo=np.clip(albedo, 0, 1).astype(np.float32), normal=T.normal_map(height, 3.5, 3.5, wrap=True),
                orm=T.orm(0.55 + 0.45 * s, np.full_like(s, 0.92), np.zeros_like(s)))


def build_atlas():
    parts = {'wood': _wood(3, 0xD9C7A8, 0x6E5E4A, 0.82), 'tar': _wood(4, 0x6A5A48, 0x2A2118, 0.6, True),
             'cloth': T.sail_tile(RES, seed=7), 'rope': _rope()}
    atlas = {k: np.zeros((2 * RES, 2 * RES, 3), np.float32) for k in ('albedo', 'normal', 'orm')}
    for name, (u, v) in REGION.items():
        r0, c0 = int(v * 2 * RES), int(u * 2 * RES)
        for k in atlas:
            atlas[k][r0:r0 + RES, c0:c0 + RES] = parts[name][k]
    return atlas


def uv(region, a, b):
    """Point (a, b in 0..1) inside an atlas quadrant, with a margin so filtering never bleeds into a neighbour."""
    ox, oy = REGION[region]
    a, b = min(max(a, 0.0), 1.0), min(max(b, 0.0), 1.0)
    return ox + 0.015 + a * 0.47, oy + 0.015 + b * 0.47


# --------------------------------------------------------------------------- shapes (game coords: x long, y up, z across)
def beam(name, length, width, thick, segs, region, seed, tint=WEATHER):
    """Splintered plank: 8-point cross-section rings, ragged torn ends fanned to a pushed-out centre, slight bow."""
    rnd = random.Random(seed)
    pm = PM('wood')
    sect = [(1, -1), (1, 0), (1, 1), (0, 1), (-1, 1), (-1, 0), (-1, -1), (0, -1)]
    rings = []
    for i in range(segs + 1):
        f = i / segs
        x = (f - 0.5) * length
        bow = 0.06 * width * math.sin(math.pi * f) * (1 if seed % 2 else -1)
        taper = 1 - 0.18 * abs(f - 0.5) * 2 * rnd.random()
        ring = []
        for k, (sy, sz) in enumerate(sect):
            xo = 0.0
            if i in (0, segs):                       # torn ends: alternating high/low teeth, one long spike
                jag = rnd.random() * 0.1 * length * (1 if k % 2 else 0.35)
                if k == rnd.randrange(8):
                    jag = -0.08 * length
                xo = jag if i == 0 else -jag
            ring.append((x + xo, sy * thick / 2 * (1 + 0.12 * (rnd.random() - 0.5)) + bow,
                         sz * width / 2 * taper * (1 + 0.06 * (rnd.random() - 0.5))))
        rings.append(ring)
    def tx(p):
        return uv(region, (p[0] / length + 0.5) * 0.9, 0.05 + 0.9 * (p[2] / width + 0.5) if abs(p[1]) < 1e-9 else 0.5 + p[1] / thick * 0.4)
    for i in range(segs):
        for k in range(8):
            q = [rings[i][k], rings[i][(k + 1) % 8], rings[i + 1][(k + 1) % 8], rings[i + 1][k]]
            pm.face(q, tint, uv=[tx(p) for p in q], ref=(q[0][0], 0, 0))
    for i, sgn in ((0, -1), (segs, 1)):
        c = (sgn * (length / 2 + 0.04 * length), 0.0, 0.0)
        for k in range(8):
            q = [c, rings[i][k], rings[i][(k + 1) % 8]]
            pm.face(q, FRESH, uv=[uv(region, 0.5, 0.5), uv(region, 0.1 * k / 8, 0.95), uv(region, 0.1 * (k + 1) / 8, 0.95)],
                    ref=(0, 0, 0))
    return pm


def shard(name, length, width, thick, region, seed):
    """Thin jagged splinter: pointed tip, broken fat end, star-shaped outline fanned top and bottom."""
    rnd = random.Random(seed)
    n = 6
    up, lo = [], []
    for i in range(n):
        s = (i + 1) / n
        x = (-0.5 + 0.1 + 0.9 * s) * length
        hw = width / 2 * (0.12 + 0.88 * s ** 0.8)
        up.append((x + (rnd.random() - 0.5) * 0.08 * length * (s > 0.9), hw * (0.55 + 0.45 * rnd.random())))
        lo.append((x + (rnd.random() - 0.5) * 0.08 * length * (s > 0.9), -hw * (0.55 + 0.45 * rnd.random())))
    outline = [(-0.5 * length, 0.0)] + up + lo[::-1]
    pm = PM('wood')
    ts = [thick / 2 * (0.5 + 0.7 * rnd.random()) for _ in outline]
    cx, tc = 0.12 * length, thick / 2 * 1.2
    m = len(outline)
    for i in range(m):
        a, b = outline[i], outline[(i + 1) % m]
        ta, tb = ts[i], ts[(i + 1) % m]
        top = [(a[0], ta, a[1]), (b[0], tb, b[1])]
        bot = [(b[0], -tb, b[1]), (a[0], -ta, a[1])]
        fuv = lambda p: uv(region, (p[0] / length + 0.5), p[2] / width + 0.5)
        pm.face(top + bot, WEATHER, uv=[fuv(p) for p in top + bot], ref=(cx, 0, 0))
        for sgn, cy in ((1, tc), (-1, -tc)):
            tri = [(cx, cy, 0.0), (a[0], sgn * ta, a[1]), (b[0], sgn * tb, b[1])]
            pm.face(tri, WEATHER, uv=[fuv(p) for p in tri], ref=(cx, 0, 0))
    return pm


def stave(length, width, thick, region, seed):
    """Curved barrel stave: bulges along its length (barrel belly) and curls across its width, torn ends."""
    rnd = random.Random(seed)
    nu, nv = 7, 3
    P = {}
    for side, yy in (('o', thick / 2), ('i', -thick / 2)):
        P[side] = []
        for i in range(nu):
            f = i / (nu - 1)
            x = (f - 0.5) * length
            if i in (0, nu - 1):
                x += (0.04 if i == 0 else -0.04) * length * rnd.random()
            row = []
            for j in range(nv):
                z = (j / (nv - 1) - 0.5) * width * (1 - 0.15 * abs(f - 0.5) * 2)
                y = 0.07 * length * (1 - (2 * f - 1) ** 2) + 0.35 * width * (z / width) ** 2 * 2 + yy
                row.append((x, y, z + (rnd.random() - 0.5) * 0.01))
            P[side].append(row)
    pm = PM('wood')
    tint = (0.8, 0.6, 0.45)
    cen = (0, 0.02, 0)
    def f_uv(p):
        return uv(region, (p[0] / length + 0.5), p[2] / width + 0.5)
    for side, sg in (('o', 1), ('i', -1)):
        for i in range(nu - 1):
            for j in range(nv - 1):
                q = [P[side][i][j], P[side][i + 1][j], P[side][i + 1][j + 1], P[side][i][j + 1]]
                pm.face(q, tint, uv=[f_uv(p) for p in q], ref=(q[0][0], q[0][1] - sg * 5, q[0][2]))
    def edge(a, b):
        q = [a[0], b[0], b[1], a[1]]
        pm.face(q, FRESH if q[0][0] * q[2][0] < 0 and False else tint, uv=[f_uv(p) for p in q], ref=cen)
    for i in range(nu - 1):
        for j in (0, nv - 1):
            q = [P['o'][i][j], P['o'][i + 1][j], P['i'][i + 1][j], P['i'][i][j]]
            pm.face(q, tint, uv=[f_uv(p) for p in q], ref=(0, q[0][1] - 0.05, 0))
    for i in (0, nu - 1):
        for j in range(nv - 1):
            q = [P['o'][i][j], P['o'][i][j + 1], P['i'][i][j + 1], P['i'][i][j]]
            pm.face(q, FRESH, uv=[uv(region, 0.5, 0.5)] * 4, ref=(0, q[0][1], 0))
    return pm


def cloth(w, d, nu, nv, seed, tear=False):
    """Torn sail scrap lying in the xz plane: ragged border, low crumple folds. Single sheet, material is double-sided."""
    rnd = random.Random(seed)
    ph = [rnd.random() * 6.28 for _ in range(4)]
    P, U = [], []
    for i in range(nu):
        row, urow = [], []
        for j in range(nv):
            a, b = i / (nu - 1), j / (nv - 1)
            x, z = (a - 0.5) * w, (b - 0.5) * d
            if i in (0, nu - 1) or j in (0, nv - 1):
                x += (rnd.random() - 0.5) * 0.06 * w
                z += (rnd.random() - 0.5) * 0.06 * d
            if tear and a + b > 1.45:                    # a corner torn clean off
                k = 1.45 / (a + b)
                x, z = (a * k - 0.5) * w, (b * k - 0.5) * d
            y = 0.035 * math.sin(a * 7 + ph[0]) * math.cos(b * 5 + ph[1]) + 0.02 * math.sin((a + b) * 11 + ph[2]) \
                + 0.012 * (rnd.random() - 0.5)
            row.append((x, y, z))
            urow.append(uv('cloth', (a + seed * 0.13) % 0.5 + 0.1, (b * 0.8 + 0.1)))
        P.append(row)
        U.append(urow)
    pm = PM('sail')
    pm.grid(P, U, (0.85, 0.82, 0.76), smooth=True, ref=(0, -5, 0))
    return pm


def rope_coil():
    """Small hemp coil: 2 helix turns of a 5-sided tube, last bit leaving as a tail."""
    pm = PM('wood')
    n, turns, seg, rr = 22, 2.0, 5, 0.017
    centres = []
    for i in range(n):
        f = i / (n - 1)
        th = f * turns * 2 * math.pi
        R = 0.13 - 0.02 * f
        centres.append((R * math.cos(th), 0.036 * turns * f, R * math.sin(th), th))
    last = Vector(centres[-1][:3])
    tang = Vector((-math.sin(centres[-1][3]), 0.0, math.cos(centres[-1][3])))
    for k in (1, 2):
        p = last + tang * 0.05 * k
        centres.append((p.x, p.y - 0.004 * k, p.z, centres[-1][3]))
    rows, uvs = [], []
    for i, (cx, cy, cz, th) in enumerate(centres):
        radial = Vector((math.cos(th), 0, math.sin(th)))
        row = [tuple(Vector((cx, cy, cz)) + (radial * math.cos(2 * math.pi * k / seg) + Vector((0, 1, 0)) * math.sin(2 * math.pi * k / seg)) * rr)
               for k in range(seg + 1)]
        rows.append(row)
        uvs.append([uv('rope', (i / (len(centres) - 1)), k / seg) for k in range(seg + 1)])
    # outward winding: test the first quad against its ring centre, flip the whole grid when it faces in
    p00, p10, p11 = (Vector(rows[0][0]), Vector(rows[1][0]), Vector(rows[1][1]))
    if (p10 - p00).cross(p11 - p00).dot(p00 - Vector(centres[0][:3])) < 0:
        rows = [r[::-1] for r in rows]
        uvs = [u[::-1] for u in uvs]
    pm.grid(rows, uvs, (0.95, 0.9, 0.8), smooth=True)
    for ring, other, ci in ((rows[0], rows[-1][0], 0), (rows[-1], rows[0][0], -1)):
        pm.face(ring[:-1], (0.95, 0.9, 0.8), uv=[uv('rope', 0.5, 0.5)] * seg, ref=other)
    pm.weld()
    return pm


# --------------------------------------------------------------------------- build + export
PIECES = [   # name, kind, builder
    ("Plank_L", "wood", lambda: beam("Plank_L", 1.08, 0.2, 0.045, 4, 'wood', 1)),
    ("Plank_M", "wood", lambda: beam("Plank_M", 0.54, 0.16, 0.04, 3, 'tar', 2)),
    ("Plank_S", "wood", lambda: beam("Plank_S", 0.27, 0.12, 0.035, 2, 'wood', 3)),
    ("Splinter_A", "wood", lambda: shard("Splinter_A", 0.55, 0.07, 0.025, 'wood', 4)),
    ("Splinter_B", "wood", lambda: shard("Splinter_B", 0.35, 0.05, 0.02, 'tar', 5)),
    ("Barrel_Stave", "wood", lambda: stave(0.8, 0.09, 0.022, 'wood', 6)),
    ("Cloth_A", "cloth", lambda: cloth(0.8, 0.6, 9, 7, 7)),
    ("Cloth_B", "cloth", lambda: cloth(0.5, 0.4, 7, 6, 8, tear=True)),
    ("Rope_Coil", "rope", rope_coil),
]


def to_object(pm, name, mat):
    """Mesh object centred on its bounding box. Returns (object, size in glTF axes x, y, z)."""
    bm = pm.bm
    co = [v.co for v in bm.verts]
    lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
    hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
    bmesh.ops.translate(bm, vec=-(lo + hi) / 2, verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    d = hi - lo                                    # blender (x, y, z) -> glTF (x, z, y)
    return ob, [round(d.x, 3), round(d.z, 3), round(d.y, 3)]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with Scratch() as sc:
        group = pbrmat.occlusion_group()
        mat = pbrmat.pbr_material("debris", build_atlas(), group, extension='EXTEND')
        objs, pieces = [], []
        for name, kind, fn in PIECES:
            ob, size = to_object(fn(), name, mat)
            tris = tri_count(ob)
            errs = []
            if not NAME_OK.match(name):
                errs.append("bad name")
            if not TRI_MIN <= tris <= TRI_MAX:
                errs.append(f"{tris} tris outside {TRI_MIN}-{TRI_MAX}")
            if errs:
                raise ValueError(f"{name}: " + "; ".join(errs))
            objs.append(ob)
            pieces.append(dict(name=name, kind=kind, size=size, tris=tris))
            print(f"  {name:13s} {kind:5s} {size} {tris} tris")
        size = export_glb(OUT / "debris.glb", objs, objs[0], pbr=True)
        if size > MAX_BYTES:
            raise ValueError(f"debris.glb is {size} bytes > {MAX_BYTES}")
        write_json(OUT / "debris.meta.json", dict(version=1, bytes=size, atlasPx=2 * RES, pieces=pieces))
        print(f"debris.glb {size} bytes")


main()
