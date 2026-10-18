"""Baked vertex ambient occlusion for the PBR ships (runs inside Blender).

Rays are cast from every vertex of the solid parts (atlas and wood meshes) into the whole ship (those meshes plus the
sails), the occluded fraction darkens the vertex colour that the glTF export writes as COLOR_0. The textures carry
their own cavity AO (ORM red); this adds the large-scale contact shadows (under the castles, around the masts, in the
waist) that texture space cannot know about.
"""
import math
import random

from mathutils import Vector
from mathutils.bvhtree import BVHTree


def _dirs(n, rng):
    """Stratified cosine-weighted hemisphere directions about +Z."""
    out = []
    rings = max(int(math.sqrt(n / 2)), 1)
    per = max(n // rings, 1)
    for i in range(rings):
        for j in range(per):
            u = (i + rng.random()) / rings
            phi = 2 * math.pi * (j + rng.random()) / per
            r = math.sqrt(u)
            out.append(Vector((r * math.cos(phi), r * math.sin(phi), math.sqrt(max(1 - u, 0.0)))))
    return out


def bake_vertex_ao(solid, blockers, rays=12, dist=3.0, strength=0.8, seed=4):
    """Multiply the `Col` layer of every PM in `solid` by an AO term; `blockers` are extra PMs that only occlude."""
    rng = random.Random(seed)
    verts, polys = [], []
    for pm in solid + blockers:
        pm.bm.verts.index_update()
        pm.bm.verts.ensure_lookup_table()
        base = len(verts)
        verts.extend(v.co.copy() for v in pm.bm.verts)
        polys.extend(tuple(base + v.index for v in f.verts) for f in pm.bm.faces)
    tree = BVHTree.FromPolygons(verts, polys, all_triangles=False, epsilon=0.0)
    dirs = _dirs(rays, rng)
    for pm in solid:
        pm.bm.normal_update()
        pm.bm.verts.ensure_lookup_table()
        occ = {}
        for v in pm.bm.verts:
            n = v.normal
            if n.length < 1e-6:
                continue
            q = n.to_track_quat('Z', 'Y')
            o = v.co + n * 0.04
            hit = 0.0
            for d in dirs:
                r = tree.ray_cast(o, q @ d, dist)
                if r[0] is not None:
                    hit += 1.0 - r[3] / dist
            occ[v.index] = 1.0 - strength * hit / len(dirs)
        for f in pm.bm.faces:
            for lp in f.loops:
                a = occ.get(lp.vert.index, 1.0)
                c = lp[pm.col]
                lp[pm.col] = (c[0] * a, c[1] * a, c[2] * a, 1.0)
