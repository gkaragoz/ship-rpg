"""Hull shell, deck, bulwark, wales and keel of a PBR ship (runs inside Blender). Game space, see pbrmesh.py.

The hull and the deck use the unique atlas regions (pbrhull.py); the planked walls, rails and timbers use the tiling
wood material tinted per vertex.
"""
import math

from mathutils import Vector

import pbrlayout as LAY
from hullmath import bulwark, deck_height, girth_at_drop, half_beam, keel_height, section_point, side_point
from pbrmesh import WHITE, srgb_lin

INNER = srgb_lin(0x6A2A20)          # painted inside of the bulwarks


class Kit:
    """The meshes of one LOD (one PM per material) plus the spec, LOD config and a deterministic RNG."""

    def __init__(self, spec, cfg, A, rng, PM):
        self.s, self.cfg, self.A, self.rng = spec, cfg, A, rng
        self.atlas, self.wood, self.glass, self.flag, self.jib = PM('atlas', A), PM('wood', A), PM('glass', A), PM('flag', A), PM('sail', A)
        self.hull_tint = srgb_lin(spec['hullColor'])
        self.trim_tint = srgb_lin(spec['trimColor'])
        self.extra = []          # deck obstacles for the crew (meta.json)

    def pms(self):
        return [self.atlas, self.wood, self.glass, self.flag, self.jib]


def rail_xz(s, t, side=1):
    """Rail line point (x, y, z) at station t on the starboard (+1) or port (-1) side."""
    x, y, z = section_point(s, t, 1.0 if side > 0 else 0.0)
    return x, y, z


def side_half_width(s, t):
    """Hull half width at deck level (just under the bulwark top)."""
    return abs(side_point(s, t, bulwark(s))[2])


def thickness(s):
    return 0.12 + 0.004 * s['length']


def deck_half(s, t):
    return max(side_half_width(s, t) - thickness(s), 0.08)


def hull(kit):
    s, cfg = kit.s, kit.cfg
    st, sg = cfg['stations'], cfg['segs']
    P, UV = [], []
    for i in range(st + 1):
        t = i / st
        row, uvr = [], []
        for j in range(sg + 1):
            k = j / sg
            row.append(section_point(s, t, k))
            uvr.append(LAY.hull_uv(kit.A, t, min(k, 1 - k)))
        P.append(row)
        UV.append(uvr)

    def centre(mid):
        t = min(max(mid.x / s['length'] + 0.5, 0.0), 1.0)
        return Vector((mid.x, (deck_height(s, t) + keel_height(s, t)) / 2, 0))

    kit.atlas.grid(P, UV, ref=centre)
    cap_tint = tuple(0.8 * c for c in kit.hull_tint)
    for ring, away in ((P[0], (-s['length'], 0, 0)), (P[-1], (s['length'], 0, 0))):    # end caps: transom and stem
        c = Vector((sum(p[0] for p in ring) / len(ring), sum(p[1] for p in ring) / len(ring), 0))
        kit.wood.face(ring, cap_tint, ref=c - Vector(away))


def deck(kit):
    s, cfg = kit.s, kit.cfg
    st, cs = cfg['stations'], 3
    P, UV = [], []
    for i in range(st + 1):
        t = i / st
        w = deck_half(s, t)
        y = LAY.deck_y(s, t)
        row, uvr = [], []
        for j in range(2 * cs + 1):
            f = -1 + j / cs
            row.append((section_point(s, t, 0.0)[0], y + 0.07 * (1 - f * f), f * w))
            uvr.append(LAY.deck_uv(kit.A, t, abs(f)))
        P.append(row)
        UV.append(uvr)
    kit.atlas.grid(P, UV, smooth=False, ref=lambda m: m - Vector((0, 1, 0)))


def bulwarks(kit):
    """Inner bulwark walls, stanchions and the rail cap along both sides."""
    s, cfg = kit.s, kit.cfg
    st = cfg['stations']
    tb = thickness(s)
    for side in (1, -1):
        wall, cap = [], []
        for i in range(st + 1):
            t = i / st
            x, ytop, ztop = rail_xz(s, t, side)
            w = deck_half(s, t)
            xin = x
            wall.append([(xin, LAY.deck_y(s, t), side * w), (xin, ytop, side * (abs(ztop) - tb))])
            cap.append([(x, ytop + 0.03, side * abs(ztop)), (x, ytop + 0.03, side * (abs(ztop) - tb))])
        kit.wood.grid(wall, None, INNER, smooth=False, ref=lambda m: Vector((m.x, m.y, math.copysign(abs(m.z) + 1, m.z))))
        kit.wood.grid(cap, None, kit.trim_tint, smooth=False, ref=lambda m: m - Vector((0, 1, 0)))
        if cfg['detail']:
            n = max(int(s['length'] / (0.9 if s['length'] < 20 else 2.2)), 6)
            for i in range(1, n):
                t = i / n
                x, ytop, ztop = rail_xz(s, t, side)
                y0 = LAY.deck_y(s, t)
                kit.wood.box((x, (y0 + ytop) / 2, side * (abs(ztop) - tb - 0.05)), (0.12, ytop - y0, 0.1), kit.trim_tint)


def wales(kit):
    """Raised wale strips on both sides (geometry on top of the painted bands)."""
    s, cfg = kit.s, kit.cfg
    st = cfg['stations']
    for dc, th in LAY.wales(s):
        for side in (1, -1):
            rows = []
            for i in range(st + 1):
                t = i / st
                pts = []
                for drop, off in ((dc - th / 2, 0.0), (dc - th / 2, 0.05), (dc + th / 2, 0.05), (dc + th / 2, 0.0)):
                    kp = girth_at_drop(s, t, drop)
                    k = 1 - kp if side > 0 else kp
                    x, y, z = section_point(s, t, k)
                    # outward offset in the section plane: horizontal is a good approximation for the near-vertical topsides
                    pts.append((x, y, z + side * off))
                rows.append(pts)
            kit.atlas.grid(rows, None, swatch='trim', smooth=False, ref=lambda m: Vector((m.x, m.y, 0)))


def keel(kit):
    """Keel timber, stem and sternpost: tubes along the centre line."""
    s = kit.s
    pts = []
    for i in range(0, 13):
        t = i / 12
        x, y, z = section_point(s, t, 0.5)
        pts.append((x, y - 0.04, 0))
    r = 0.07 + 0.003 * s['length']
    kit.wood.tube(pts, [r] * len(pts), srgb_lin(0x2A1C12), seg=6, caps=False)
