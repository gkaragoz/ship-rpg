"""Build the world props: public/models/world/world.glb + world.meta.json.

Headless:  blender -b --factory-startup --python tools/blender/make_world.py
(also works exec()'d from an open Blender through the local LLM: the scene is left alone, everything is built in a Scratch scope;
the wrapper is in docs/BLENDER_PIPELINE.md).

One GLB, one flat-colour material (a 16-swatch atlas), 29 props as separate top-level meshes named `<Prop>_LOD0` (the whole
prop) and `<Prop>_LOD1` (the far version: boxes and cones only, under half the triangles). Real-world metres, origin on the
ground at the prop's centre, +Y up in the GLB (Blender +Z), the front of a building toward +x (glTF +x).
Contract: docs/WORLD_ASSETS.md.
"""
import math
import pathlib
import random
import sys

import bpy
import bmesh
from mathutils import Vector

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.modules.pop("shipkit", None)
from shipkit import MB, NAME_OK, Atlas, Scratch, export_glb, tri_count, write_json  # noqa: E402

OUT = HERE.parents[1] / "public" / "models" / "world"
MAX_BYTES = 600_000
LOD0_MAX = 900

SWATCHES = {
    "white": 0xEFE6D2, "cream": 0xE6D3A0, "ochre": 0xC9954A, "brick": 0x9C4A35,
    "dark_wood": 0x4D3523, "wood": 0x9A7549, "tile": 0xB4532F, "slate": 0x4B5662,
    "stone": 0x8D8A84, "black": 0x1C1712, "blue": 0x2F5F9A, "leaf": 0x4F8A35,
    "leaf_dark": 0x2F5C27, "trunk": 0x6E5033, "sand": 0xCDBF93, "red": 0xB8392D,
}


# --------------------------------------------------------------------------- helpers
def blob(mb, c, r, swatch, squash=(1, 1, 1), jitter=0.0, seed=0, sub=1):
    """A faceted lump (leaf mass, rock, bush): an icosphere squashed and jittered."""
    rnd = random.Random(seed)
    res = bmesh.ops.create_icosphere(mb.bm, subdivisions=sub, radius=1.0)
    for v in res["verts"]:
        p = v.co.copy()
        v.co = Vector((c[0] + p.x * r * squash[0] + (rnd.random() - 0.5) * jitter * r,
                       c[1] + p.y * r * squash[1] + (rnd.random() - 0.5) * jitter * r,
                       c[2] + p.z * r * squash[2] + (rnd.random() - 0.5) * jitter * r))
    uv = mb.atlas.uv(swatch)
    faces = {f for v in res["verts"] for f in v.link_faces}
    for f in faces:
        for loop in f.loops:
            loop[mb.uvl].uv = uv
    bmesh.ops.recalc_face_normals(mb.bm, faces=list(faces))


def cone(mb, c, r, h, swatch, seg=6):
    mb.spar((c[0], c[1], c[2]), (c[0], c[1], c[2] + h), r, 0.02, swatch, seg)


def post(mb, c, h, r, swatch, seg=5):
    mb.spar((c[0], c[1], c[2]), (c[0], c[1], c[2] + h), r, r, swatch, seg)


def gable(mb, c, size, swatch, ridge_x=True, ridge=0.25):
    """A gabled roof over a box: ridge along x (or y)."""
    top = (size[0], ridge) if ridge_x else (ridge, size[1])
    mb.box(c, size, swatch, top=top)


def windows(mb, lod, face_x, ys, zs, w, h, swatch="black"):
    """Dark window panes on the +x and -x walls (one box each; a tiny depth)."""
    if lod > 0:
        return
    for y in ys:
        for z in zs:
            for s in (1, -1):
                mb.box((s * face_x, y, z), (0.08, w, h), swatch)


# --------------------------------------------------------------------------- buildings
def house_english(mb, lod):
    mb.box((0, 0, 1.5), (6, 5, 3), "white")
    gable(mb, (0, 0, 3.9), (6.6, 5.6, 1.8), "slate")
    if lod == 0:
        mb.box((0, 0, 0.1), (6.2, 5.2, 0.2), "stone")
        mb.box((3.02, 0, 1.0), (0.12, 1.0, 2.0), "dark_wood")        # door on the front
        mb.box((-1.9, 1.9, 5.0), (0.8, 0.8, 1.6), "brick")           # chimney
        windows(mb, lod, 3.02, (-1.6, 1.6), (1.7,), 0.8, 0.9)
        windows(mb, lod, 3.02, (0,), (2.4,), 0.5, 0.5)


def house_french(mb, lod):
    mb.box((0, 0, 2.1), (5, 5, 4.2), "cream")
    mb.box((0, 0, 4.8), (5.6, 5.6, 1.6), "slate", top=(2.2, 2.2))      # hipped slate roof
    if lod == 0:
        mb.box((2.52, 0, 1.0), (0.12, 1.1, 2.0), "dark_wood")
        for y in (-1.6, 1.6):
            for z in (1.4, 3.2):
                mb.box((2.52, y, z), (0.1, 0.8, 1.0), "black")
                for s in (-1, 1):
                    mb.box((2.56, y + s * 0.62, z), (0.08, 0.4, 1.0), "blue")   # shutters
        mb.box((0, -1.5, 5.9), (0.7, 0.7, 1.2), "brick")
        mb.box((0, 0, 0.12), (5.2, 5.2, 0.24), "stone")


def house_spanish(mb, lod):
    mb.box((0, 0, 1.6), (6.5, 5.5, 3.2), "ochre")                       # adobe block
    mb.box((0, 0, 3.3), (6.9, 5.9, 0.3), "tile")                        # tiled parapet
    if lod == 0:
        mb.box((3.27, 0, 1.2), (0.12, 1.4, 2.4), "dark_wood")
        mb.box((3.27, -2.0, 1.9), (0.1, 0.9, 1.0), "black")
        mb.box((3.27, 2.0, 1.9), (0.1, 0.9, 1.0), "black")
        for y in (-2.2, -0.7, 0.8, 2.2):                                  # vigas: beam ends through the wall
            mb.box((3.4, y, 2.9), (0.4, 0.18, 0.18), "dark_wood")
        mb.box((3.7, 0, 3.0), (1.2, 4.2, 0.12), "wood")                 # awning
        post(mb, (4.2, -1.9, 0), 3.0, 0.1, "dark_wood")
        post(mb, (4.2, 1.9, 0), 3.0, 0.1, "dark_wood")


def house_dutch(mb, lod):
    mb.box((0, 0, 2.8), (4, 5.5, 5.6), "brick")
    mb.box((0, 0, 6.0), (4.0, 5.5, 0.8), "slate", top=(0.3, 5.5))       # roof along y
    steps = (4.0, 3.2, 2.4, 1.6) if lod == 0 else (4.0, 2.4)            # stepped gable on the front
    z = 5.9
    for i, w in enumerate(steps):
        mb.box((2.0, 0, z + 0.3 + 0.55 * i), (0.5, w * 1.1, 0.55), "brick")
    if lod == 0:
        mb.box((2.02, 0, 1.0), (0.12, 1.0, 2.0), "dark_wood")
        for z in (2.6, 4.4):
            for y in (-1.3, 1.3):
                mb.box((2.02, y, z), (0.1, 0.8, 1.1), "white")
                mb.box((2.06, y, z), (0.08, 0.6, 0.9), "black")
        mb.box((2.3, 0, 7.4), (0.3, 0.5, 0.5), "dark_wood")            # hoist beam


def shack(mb, lod):
    if lod == 0:
        for x in (-1.6, 1.6):
            for y in (-1.3, 1.3):
                post(mb, (x, y, 0), 1.2, 0.14, "dark_wood")
    else:
        mb.box((0, 0, 0.6), (3.6, 3.0, 1.2), "dark_wood")
    mb.box((0, 0, 2.0), (4, 3.4, 1.7), "wood")
    mb.box((0, 0, 3.0), (4.6, 4.0, 0.9), "dark_wood", top=(4.6, 0.6))
    if lod == 0:
        mb.box((2.02, 0, 1.7), (0.1, 0.8, 1.3), "black")
        mb.box((0, 0, 1.15), (4.6, 4.0, 0.14), "dark_wood")             # porch floor
        mb.box((3.2, 0, 0.5), (1.4, 1.0, 0.1), "wood")                  # steps


def warehouse(mb, lod):
    mb.box((0, 0, 2.0), (12, 6, 4), "wood")
    gable(mb, (0, 0, 5.0), (12.6, 6.8, 2.0), "slate")
    if lod == 0:
        mb.box((6.02, 0, 1.5), (0.14, 2.6, 3.0), "dark_wood")           # big doors
        mb.box((6.04, 0, 1.5), (0.1, 0.12, 3.0), "black")
        for y in (-2.2, 2.2):
            mb.box((6.02, y, 2.8), (0.1, 0.8, 0.8), "black")
        mb.box((6.7, 0, 5.4), (0.4, 0.4, 0.4), "dark_wood")             # hoist
        mb.box((-6.02, 0, 1.5), (0.14, 2.0, 3.0), "dark_wood")


def tavern(mb, lod):
    house_english(mb, lod)
    post(mb, (3.6, -2.2, 0), 3.2, 0.08, "dark_wood")
    mb.box((3.6, -2.2, 3.1), (0.1, 1.1, 0.7), "red")                    # hanging sign
    if lod == 0:
        mb.box((3.6, 2.0, 0.45), (0.9, 0.9, 0.9), "wood")
        mb.box((3.6, 2.0, 0.95), (0.8, 0.8, 0.1), "dark_wood")


def church(mb, lod):
    mb.box((0, 0, 2.3), (8, 5, 4.6), "white")
    gable(mb, (0, 0, 5.6), (8.6, 5.6, 2.2), "tile")
    mb.box((-5.0, 0, 3.6), (3.2, 3.2, 7.2), "white")                    # bell tower at the back
    mb.box((-5.0, 0, 8.4), (3.6, 3.6, 2.4), "tile", top=(0.25, 0.25))   # spire
    if lod == 0:
        mb.box((4.02, 0, 1.4), (0.14, 1.6, 2.8), "dark_wood")
        for y in (-1.6, 1.6):
            mb.box((4.02, y, 2.9), (0.1, 0.6, 1.4), "blue")
        mb.box((-5.0, 0, 6.2), (3.3, 1.0, 1.2), "black")                # belfry opening
        mb.box((-5.0, 0, 6.2), (1.0, 3.3, 1.2), "black")
        mb.box((-5.0, 0, 10.0), (0.14, 0.14, 1.2), "wood")              # cross
        mb.box((-5.0, 0, 10.4), (0.14, 0.7, 0.14), "wood")


def fort(mb, lod):
    mb.box((0, 0, 2.0), (22, 18, 4), "stone")                           # curtain walls block
    mb.box((0, 0, 4.15), (18, 14, 0.3), "dark_wood")                    # parade
    for sx in (-1, 1):
        for sy in (-1, 1):
            mb.spar((sx * 10.5, sy * 8.5, 0), (sx * 10.5, sy * 8.5, 6.2), 2.3, 2.1, "stone", 8 if lod == 0 else 6)
            mb.spar((sx * 10.5, sy * 8.5, 6.2), (sx * 10.5, sy * 8.5, 7.8), 2.6, 2.6, "dark_wood", 8 if lod == 0 else 6)
    mb.box((11.02, 0, 1.4), (0.2, 3.0, 2.8), "black")                   # gate
    if lod == 0:
        for k in range(8):                                               # battlements
            x = -9 + k * 2.6
            for y in (-9.0, 9.0):
                mb.box((x, y, 4.6), (1.4, 0.8, 0.9), "stone")
        mb.box((0, 0, 5.6), (5, 5, 3.2), "ochre")                       # barracks
        mb.box((0, 0, 7.4), (5.6, 5.6, 0.6), "tile", top=(5.6, 0.3))
        post(mb, (0, 0, 7.4), 6.0, 0.1, "dark_wood")
        mb.box((0.9, 0, 13.0), (1.8, 0.04, 1.1), "red")                 # flag


def lighthouse(mb, lod):
    seg = 8 if lod == 0 else 6
    mb.spar((0, 0, 0), (0, 0, 6), 2.6, 2.3, "white", seg)
    mb.spar((0, 0, 6), (0, 0, 12), 2.3, 2.0, "red", seg)
    mb.spar((0, 0, 12), (0, 0, 18), 2.0, 1.7, "white", seg)
    mb.spar((0, 0, 18), (0, 0, 18.6), 2.4, 2.4, "dark_wood", seg)      # gallery
    mb.spar((0, 0, 18.6), (0, 0, 20.6), 1.2, 1.2, "cream", seg)         # lantern room
    mb.spar((0, 0, 20.6), (0, 0, 22.2), 1.7, 0.1, "slate", seg)
    if lod == 0:
        mb.box((2.35, 0, 1.0), (0.1, 1.0, 2.0), "dark_wood")
        for z in (5, 10, 15):
            mb.box((2.0, 0, z), (0.1, 0.5, 0.8), "black")


def windmill(mb, lod):
    seg = 8 if lod == 0 else 6
    mb.spar((0, 0, 0), (0, 0, 9), 3.2, 2.0, "white", seg)
    mb.spar((0, 0, 9), (0, 0, 10.2), 2.4, 2.4, "dark_wood", seg)
    mb.spar((0, 0, 10.2), (0, 0, 12.4), 2.5, 0.2, "wood", seg)         # cap
    for k in range(4):                                                   # four sails at the front
        a = k * math.pi / 2 + 0.4
        dy, dz = math.cos(a), math.sin(a)
        mb.spar((2.6, 0, 10.0), (2.6, dy * 7.2, 10.0 + dz * 7.2), 0.14, 0.1, "dark_wood", 4)
        if lod == 0:
            px, pz = -dz, dy
            c = (2.7, dy * 4.6 + px * 0.7, 10.0 + dz * 4.6 + pz * 0.7)
            mb.box(c, (0.06, 1.3 * abs(dz) + 0.35, 1.3 * abs(dy) + 0.35), "cream")
    if lod == 0:
        mb.box((2.8, 0, 1.0), (0.1, 1.0, 2.0), "dark_wood")


def crane(mb, lod):
    mb.box((0, 0, 0.4), (2.4, 2.4, 0.8), "stone")
    post(mb, (0, 0, 0.8), 7.0, 0.3, "dark_wood", 6)
    mb.spar((0, 0, 7.4), (4.8, 0, 8.6), 0.18, 0.12, "dark_wood", 5)       # jib
    mb.spar((0, 0, 7.4), (-2.2, 0, 6.4), 0.14, 0.14, "dark_wood", 4)      # counter-jib
    if lod == 0:
        mb.spar((4.8, 0, 8.6), (4.8, 0, 4.0), 0.04, 0.04, "black", 3)      # rope
        mb.box((4.8, 0, 3.7), (0.4, 0.4, 0.5), "dark_wood")               # hook block
        mb.spar((0, 0, 7.4), (3.0, 0, 5.0), 0.1, 0.1, "dark_wood", 4)     # brace
        mb.box((-2.4, 0, 6.0), (0.8, 0.8, 0.8), "stone")


def market_stall(mb, lod):
    for x in (-1.3, 1.3):
        for y in (-1.0, 1.0):
            post(mb, (x, y, 0), 2.2, 0.07, "dark_wood", 4)
    mb.box((0, 0, 2.35), (3.2, 2.6, 0.25), "red", top=(3.2, 2.0))
    mb.box((0, 0, 0.9), (2.6, 1.4, 0.12), "wood")
    if lod == 0:
        mb.box((0, 0, 0.45), (2.6, 1.4, 0.9), "dark_wood")
        for k in range(3):
            blob(mb, (-0.8 + k * 0.8, 0, 1.15), 0.2, ("leaf", "red", "ochre")[k], jitter=0.1, seed=k)


def watchtower(mb, lod):
    if lod == 0:
        for x in (-1.2, 1.2):
            for y in (-1.2, 1.2):
                mb.spar((x, y, 0), (x * 0.7, y * 0.7, 6.0), 0.14, 0.12, "dark_wood", 4)
    else:
        mb.box((0, 0, 3.0), (2.4, 2.4, 6.0), "dark_wood", top=(1.8, 1.8))
    mb.box((0, 0, 6.3), (3.2, 3.2, 0.3), "wood")
    mb.box((0, 0, 7.3), (2.9, 2.9, 1.7), "wood")
    mb.box((0, 0, 8.5), (3.6, 3.6, 0.8), "dark_wood", top=(0.4, 3.6))
    if lod == 0:
        mb.box((1.46, 0, 7.4), (0.1, 1.2, 0.8), "black")
        mb.box((0, 0, 3.0), (1.6, 0.14, 6.2), "wood")                    # ladder


def pier_plank(mb, lod):
    mb.box((0, 0, 1.0), (8, 3, 0.3), "wood")
    for x in (-3.5, 0, 3.5):
        for y in (-1.3, 1.3):
            post(mb, (x, y, -1.5), 3.1, 0.18, "dark_wood", 5)
    if lod == 0:
        for k in range(8):
            mb.box((-3.5 + k, 0, 1.18), (0.9, 2.9, 0.06), "dark_wood")


# --------------------------------------------------------------------------- nature
def palm(mb, lod, bend=1.0, seed=1):
    rnd = random.Random(seed)
    n = 4 if lod == 0 else 2
    pts = [(0, 0, 0)]
    for i in range(1, n + 1):
        f = i / n
        pts.append((bend * 1.4 * f * f, 0.25 * math.sin(f * 2), 6.8 * f))
    for a, b, r0, r1 in zip(pts, pts[1:], [0.3 - 0.04 * i for i in range(n)], [0.26 - 0.04 * i for i in range(n)]):
        mb.spar(a, b, r0, r1, "trunk", 5 if lod == 0 else 4)
    top = pts[-1]
    fronds = 7 if lod == 0 else 5
    for k in range(fronds):
        a = k * 2 * math.pi / fronds + rnd.random() * 0.3
        dx, dy = math.cos(a), math.sin(a)
        L = 3.0 + rnd.random() * 0.6
        tip = (top[0] + dx * L, top[1] + dy * L, top[2] - 1.3)
        mid = (top[0] + dx * L * 0.55, top[1] + dy * L * 0.55, top[2] + 0.45)
        px, py = -dy * 0.55, dx * 0.55
        vs = [mb.v(p) for p in ((top[0], top[1], top[2]), (mid[0] + px, mid[1] + py, mid[2]), (tip[0], tip[1], tip[2]), (mid[0] - px, mid[1] - py, mid[2]))]
        mb.face(vs, "leaf" if k % 2 else "leaf_dark")
    if lod == 0:
        blob(mb, (top[0], top[1], top[2] - 0.2), 0.35, "trunk", seed=seed)


def broadleaf(mb, lod):
    post(mb, (0, 0, 0), 3.2, 0.32, "trunk", 5 if lod == 0 else 4)
    blob(mb, (0, 0, 5.0), 2.6, "leaf", (1, 1, 0.85), 0.35, 3, 1 if lod == 0 else 0)
    if lod == 0:
        blob(mb, (1.5, 0.8, 4.2), 1.8, "leaf_dark", (1, 1, 0.8), 0.3, 4)
        blob(mb, (-1.2, -1.0, 4.4), 1.9, "leaf", (1, 1, 0.8), 0.3, 5)
        mb.spar((0, 0, 2.6), (1.4, 0.8, 3.9), 0.14, 0.1, "trunk", 4)


def pine(mb, lod):
    post(mb, (0, 0, 0), 1.6, 0.26, "trunk", 5 if lod == 0 else 4)
    layers = ((2.4, 1.4, 3.0), (1.9, 3.2, 2.8), (1.4, 5.0, 2.6)) if lod == 0 else ((2.3, 1.4, 5.0),)
    for r, z, h in layers:
        mb.spar((0, 0, z), (0, 0, z + h), r, 0.04, "leaf_dark", 7 if lod == 0 else 5)


def bush(mb, lod):
    blob(mb, (0, 0, 0.6), 0.9, "leaf", (1.2, 1.2, 0.8), 0.25, 8, 1 if lod == 0 else 0)
    if lod == 0:
        blob(mb, (0.9, 0.5, 0.45), 0.6, "leaf_dark", (1, 1, 0.8), 0.2, 9, 0)


def rock(mb, lod, seed):
    s = (1.3 + (seed % 3) * 0.25, 1.0 + (seed % 2) * 0.4, 0.8 + (seed % 3) * 0.2)
    blob(mb, (0, 0, 0.7 * s[2]), 1.6, "stone", s, 0.45, seed, 1 if lod == 0 else 0)
    if lod == 0:
        blob(mb, (1.5, 0.7, 0.35), 0.8, "stone", (1, 1, 0.7), 0.4, seed + 5, 0)


# --------------------------------------------------------------------------- boats and props
def boat_hull(mb, L, B, D, swatch, rim_swatch, n):
    """A pointed small-boat hull: n+1 stations, five points each, bow toward +x; an inner shell (lighter wood) just inside it."""
    rings, inner = [], []
    for i in range(n + 1):
        f = i / n
        x = (f - 0.5) * L
        w = B / 2 * math.sin(math.pi * (0.04 + 0.92 * f) ** 0.8) ** 0.7
        d = D * (1 - 0.35 * abs(2 * f - 1) ** 2)
        pts = [(x, -w, d), (x, -w * 0.8, d * 0.35), (x, 0, 0), (x, w * 0.8, d * 0.35), (x, w, d)]
        rings.append([mb.v(p) for p in pts])
        inner.append([mb.v((px, py * 0.93, pz * 0.93 + (0.06 if k == 2 else 0.0) - (0.0 if k != 0 and k != 4 else 0.03))) for k, (px, py, pz) in enumerate(pts)])
    for r, q in ((rings, False), (inner, True)):
        for a, b in zip(r, r[1:]):
            for k in range(4):
                quad = (a[k], b[k], b[k + 1], a[k + 1])
                mb.face(quad[::-1] if q else quad, rim_swatch if q else swatch)


def rowboat(mb, lod):
    boat_hull(mb, 4.2, 1.5, 0.7, "wood", "dark_wood", 6 if lod == 0 else 3)
    if lod == 0:
        for x in (-0.8, 0.5):
            mb.box((x, 0, 0.45), (0.3, 1.2, 0.08), "dark_wood")          # thwarts
        mb.spar((0.2, -0.7, 0.8), (-0.6, -1.9, 0.5), 0.04, 0.05, "wood", 4)   # oar


def canoe(mb, lod):
    boat_hull(mb, 3.6, 0.8, 0.45, "dark_wood", "wood", 6 if lod == 0 else 3)
    if lod == 0:
        mb.spar((-0.3, 0.3, 0.4), (-1.0, 1.2, 0.2), 0.03, 0.04, "wood", 4)


def fishing_boat(mb, lod):
    boat_hull(mb, 6.5, 2.2, 1.0, "blue", "wood", 7 if lod == 0 else 3)
    post(mb, (0.8, 0, 0.3), 5.0, 0.1, "dark_wood", 5)
    mb.box((0.8, 0, 3.2), (0.04, 1.6, 3.0), "cream", top=(0.04, 0.2))      # a small sail
    if lod == 0:
        mb.box((-2.0, 0, 0.75), (1.0, 1.4, 0.12), "wood")
        mb.box((2.0, 0, 0.8), (0.8, 0.8, 0.3), "dark_wood")
        mb.spar((3.2, 0, 0.8), (4.4, 0, 1.4), 0.08, 0.05, "dark_wood", 4)  # bowsprit stub


def barrel_stack(mb, lod):
    seg = 8 if lod == 0 else 5
    for (x, y, z) in ((0, 0, 0), (0.85, 0.2, 0), (0.4, -0.7, 0), (0.4, -0.05, 0.85)):
        mb.spar((x, y, z), (x, y, z + 0.9), 0.38, 0.38, "wood", seg)
        if lod == 0:
            for dz in (0.25, 0.65):
                mb.spar((x, y, z + dz), (x, y, z + dz + 0.06), 0.4, 0.4, "dark_wood", seg)


def crate_stack(mb, lod):
    mb.box((0, 0, 0.4), (1.0, 1.0, 0.8), "wood")
    mb.box((1.1, 0.1, 0.35), (0.9, 0.9, 0.7), "wood")
    mb.box((0.2, 0.0, 1.15), (0.8, 0.8, 0.7), "dark_wood")
    if lod == 0:
        for x, y, z in ((0, 0, 0.82), (1.1, 0.1, 0.72)):
            mb.box((x, y, z), (1.04, 0.2, 0.04), "dark_wood")


def cannon_prop(mb, lod):
    mb.spar((-0.8, 0, 0.62), (0.9, 0, 0.7), 0.26, 0.17, "black", 8 if lod == 0 else 5)
    mb.box((-0.2, 0, 0.3), (1.2, 0.7, 0.3), "dark_wood")
    for y in (-0.38, 0.38):
        mb.spar((-0.2, y, 0.28), (-0.2, y * 1.05, 0.28), 0.28, 0.28, "dark_wood", 8 if lod == 0 else 5)


PROPS = [
    # name, kind, builder
    ("HouseEnglish", "building", house_english), ("HouseFrench", "building", house_french),
    ("HouseSpanish", "building", house_spanish), ("HouseDutch", "building", house_dutch),
    ("Shack", "building", shack), ("Warehouse", "building", warehouse), ("Tavern", "building", tavern),
    ("Church", "building", church), ("Fort", "building", fort), ("Lighthouse", "building", lighthouse),
    ("Windmill", "building", windmill), ("Crane", "building", crane), ("MarketStall", "building", market_stall),
    ("WatchTower", "building", watchtower), ("PierPlank", "building", pier_plank),
    ("PalmA", "nature", lambda mb, lod: palm(mb, lod, 1.0, 1)), ("PalmB", "nature", lambda mb, lod: palm(mb, lod, -0.7, 2)),
    ("Broadleaf", "nature", broadleaf), ("Pine", "nature", pine), ("Bush", "nature", bush),
    ("RockA", "nature", lambda mb, lod: rock(mb, lod, 1)), ("RockB", "nature", lambda mb, lod: rock(mb, lod, 2)),
    ("RockC", "nature", lambda mb, lod: rock(mb, lod, 3)),
    ("Rowboat", "boat", rowboat), ("Canoe", "boat", canoe), ("FishingBoat", "boat", fishing_boat),
    ("BarrelStack", "prop", barrel_stack), ("CrateStack", "prop", crate_stack), ("CannonProp", "prop", cannon_prop),
]


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with Scratch():
        atlas = Atlas("world_atlas", SWATCHES, grain=0.05)
        mat = atlas.material("world", roughness=0.9)
        objs, props = [], []
        for name, kind, fn in PROPS:
            tris = []
            size = None
            for lod in (0, 1):
                mb = MB(atlas)
                fn(mb, lod)
                co = [v.co.copy() for v in mb.bm.verts]
                if lod == 0:
                    lo = Vector((min(c.x for c in co), min(c.y for c in co), min(c.z for c in co)))
                    hi = Vector((max(c.x for c in co), max(c.y for c in co), max(c.z for c in co)))
                    size = [round(hi.x - lo.x, 2), round(hi.z - lo.z, 2), round(hi.y - lo.y, 2)]  # glTF x, y, z
                    foot = [round(lo.x, 2), round(hi.x, 2), round(-hi.y, 2), round(-lo.y, 2), round(lo.z, 2), round(hi.z, 2)]
                ob = mb.to_object(f"{name}_LOD{lod}", mat)
                tris.append(tri_count(ob))
                objs.append(ob)
            errs = []
            if not NAME_OK.match(name):
                errs.append("bad name")
            if tris[0] > LOD0_MAX or tris[0] < 12:
                errs.append(f"LOD0 {tris[0]} tris outside 12-{LOD0_MAX}")
            if tris[1] > 0.65 * tris[0] and tris[0] > 40:
                errs.append(f"LOD1 {tris[1]} tris is not well under LOD0 ({tris[0]})")
            if errs:
                raise ValueError(f"{name}: " + "; ".join(errs))
            props.append(dict(name=name, kind=kind, size=size, bounds=foot, tris=tris))
            print(f"  {name:13s} {kind:8s} {size} {tris}")
        size = export_glb(OUT / "world.glb", objs, objs[0])
        atlas.save(OUT / "world_atlas.png")
        if size > MAX_BYTES:
            raise ValueError(f"world.glb is {size} bytes > {MAX_BYTES}")
        write_json(OUT / "world.meta.json", dict(version=1, bytes=size, props=props))
        print(f"world.glb {size} bytes, {len(props)} props")


main()
