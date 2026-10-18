"""Mesh builder for the PBR ships (runs inside Blender). Everything is given in GAME ship space
(+x bow, +y up, +z starboard); `_b()` converts to Blender (x, -z, y), a proper rotation, so winding is preserved.

One `PM` per material: kind 'atlas' (the hull/deck/swatch atlas), 'wood' (tiling planked wood, tinted per vertex),
'sail' (tiling canvas), 'glass' (emissive) and 'flag'. Every vertex carries a linear colour in the `Col` layer
(part tint now, ambient occlusion multiplied in later by pbrao.py) which the glTF export writes as COLOR_0.
"""
import math

import bmesh
from mathutils import Matrix, Vector

import pbrlayout as LAY
from pbrtex import SPAR_ROW, WOOD_ROWS

WHITE = (1.0, 1.0, 1.0)
WOOD_M = 2.0           # metres per repeat of the wood tile


def _b(p):
    return (p[0], -p[2], p[1])


def srgb_lin(h):
    """sRGB hex -> linear tuple (vertex colours are linear in glTF)."""
    out = []
    for sh in (16, 8, 0):
        c = ((h >> sh) & 255) / 255.0
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return tuple(out)


def tri(c):
    """Triangle wave 0..1..0 (so a spar's circumference maps to mirrored, seamless texture)."""
    return 1 - abs(2 * (c % 1.0) - 1)


def spar_v(c):
    return (SPAR_ROW + 0.16 + 0.68 * tri(c)) / WOOD_ROWS


class PM:
    def __init__(self, kind, A=2048):
        self.kind, self.A = kind, A
        self.bm = bmesh.new()
        self.uv = self.bm.loops.layers.uv.verify()
        self.col = self.bm.loops.layers.float_color.new('Col')

    # ---- primitives -----------------------------------------------------------------
    def _loopset(self, f, uvs, cols):
        for lp, uv, c in zip(f.loops, uvs, cols):
            lp[self.uv].uv = uv
            lp[self.col] = (c[0], c[1], c[2], 1.0)

    def _swatch(self, name):
        return LAY.swatch_uv(self.A, name)

    def _wood_uv(self, p, n):
        ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
        if ay >= ax and ay >= az:
            return (p[0] / WOOD_M, p[2] / WOOD_M)
        if az >= ax:
            return (p[0] / WOOD_M, p[1] / WOOD_M)
        return (p[2] / WOOD_M, p[1] / WOOD_M)

    def face(self, pts, tint=WHITE, swatch=None, uv=None, ref=None, smooth=False):
        """One polygon; `ref` (game coords) is a point the normal must point away from."""
        pts = [Vector(p) for p in pts]
        n = (pts[1] - pts[0]).cross(pts[2] - pts[0])
        order = list(range(len(pts)))
        if ref is not None and n.dot(pts[0] - Vector(ref)) < 0:
            order.reverse()
            n = -n
        pts = [pts[i] for i in order]
        if uv is not None:
            uvs = [uv[i] for i in order]
        elif swatch is not None:
            uvs = [self._swatch(swatch)] * len(pts)
        else:
            uvs = [self._wood_uv(p, n) for p in pts]
        try:
            f = self.bm.faces.new([self.bm.verts.new(_b(p)) for p in pts])
        except ValueError:
            return None
        f.smooth = smooth
        self._loopset(f, uvs, [tint] * len(pts))
        return f

    def box(self, c, size, tint=WHITE, swatch=None, rot=None, taper=None):
        """Box centred on c (game coords), size (x, y, z); `rot` a 3x3 Matrix about c; `taper` scales the +y face (x, z)."""
        hx, hy, hz = size[0] / 2, size[1] / 2, size[2] / 2
        tx, tz = (taper[0], taper[1]) if taper else (1, 1)
        corners = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, -hy, hz), (-hx, -hy, hz),
                   (-hx * tx, hy, -hz * tz), (hx * tx, hy, -hz * tz), (hx * tx, hy, hz * tz), (-hx * tx, hy, hz * tz)]
        pts = []
        for q in corners:
            v = Vector(q)
            if rot is not None:
                v = rot @ v
            pts.append(Vector(c) + v)
        for idx in ((0, 1, 2, 3), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)):
            self.face([pts[i] for i in idx], tint, swatch, ref=c)

    def grid(self, P, uv, tint=WHITE, cols=None, smooth=True, ref=None, swatch=None):
        """Quad grid over a 2D list of game points; `uv` the same shape (or None with `swatch`); `cols` per-vertex tints."""
        nu, nv = len(P), len(P[0])
        V = [[self.bm.verts.new(_b(p)) for p in row] for row in P]
        for i in range(nu - 1):
            for j in range(nv - 1):
                ids = ((i, j), (i + 1, j), (i + 1, j + 1), (i, j + 1))
                try:
                    f = self.bm.faces.new([V[a][b] for a, b in ids])
                except ValueError:
                    continue
                f.smooth = smooth
                n = (Vector(P[i + 1][j]) - Vector(P[i][j])).cross(Vector(P[i + 1][j + 1]) - Vector(P[i][j]))
                if ref is not None:
                    mid = (Vector(P[i][j]) + Vector(P[i + 1][j + 1])) / 2
                    r = ref(mid) if callable(ref) else Vector(ref)
                    if n.dot(mid - r) < 0:
                        f.normal_flip()
                        n = -n
                if uv:
                    uvs = [uv[a][b] for a, b in ids]
                elif swatch:
                    uvs = [self._swatch(swatch)] * 4
                else:
                    uvs = [self._wood_uv(P[a][b], n) for a, b in ids]
                cs = [cols[a][b] if cols else tint for a, b in ids]
                self._loopset(f, uvs, cs)

    def tube(self, pts, radii, tint=WHITE, seg=6, caps=True, swatch=None, smooth=True, taper_uv=True):
        """Tube along a polyline of game points with a radius per point (parallel-transport frames)."""
        pts = [Vector(p) for p in pts]
        n = len(pts)
        if n < 2:
            return
        rad = list(radii) if hasattr(radii, '__len__') else [radii] * n
        tans = []
        for i in range(n):
            a, b = pts[max(i - 1, 0)], pts[min(i + 1, n - 1)]
            d = b - a
            tans.append(d.normalized() if d.length > 1e-9 else Vector((1, 0, 0)))
        ref = Vector((0, 1, 0)) if abs(tans[0].y) < 0.9 else Vector((1, 0, 0))
        nrm = tans[0].cross(ref).normalized()
        rings, length, ls = [], 0.0, []
        for i in range(n):
            if i:
                length += (pts[i] - pts[i - 1]).length
                axis = tans[i - 1].cross(tans[i])
                if axis.length > 1e-6:
                    ang = math.asin(min(axis.length, 1.0))
                    nrm = Matrix.Rotation(ang, 3, axis.normalized()) @ nrm
            nrm = (nrm - tans[i] * nrm.dot(tans[i])).normalized()
            bin_ = tans[i].cross(nrm)
            ls.append(length)
            rings.append([pts[i] + (nrm * math.cos(2 * math.pi * k / seg) + bin_ * math.sin(2 * math.pi * k / seg)) * rad[i]
                          for k in range(seg + 1)])
        if swatch:
            uv = None
        else:
            uv = [[(ls[i] / WOOD_M, spar_v(k / seg)) for k in range(seg + 1)] for i in range(n)]
        self.grid(rings, uv, tint, smooth=smooth, swatch=swatch)     # ring winding is outward by construction
        if caps:
            for ring, other in ((rings[0], pts[-1]), (rings[-1], pts[0])):
                self.face(ring[:-1], tint, swatch, uv=None if swatch else [self._wood_uv(p, tans[0]) for p in ring[:-1]],
                          ref=other, smooth=False)

    def revolve(self, base, up, profile, tint=WHITE, seg=8, swatch=None, smooth=True):
        """Surface of revolution about the axis through `base` along `up`; `profile` = [(radius, height), ...] (height rising)."""
        up = Vector(up).normalized()
        side = up.cross(Vector((0, 1, 0)) if abs(up.y) < 0.9 else Vector((1, 0, 0))).normalized()
        fwd = up.cross(side)
        base = Vector(base)
        rows = [[base + up * h + (side * math.cos(2 * math.pi * k / seg) + fwd * math.sin(2 * math.pi * k / seg)) * r
                 for k in range(seg + 1)] for r, h in profile]
        uv = None if swatch else [[(h / WOOD_M, spar_v(k / seg)) for k in range(seg + 1)] for r, h in profile]
        self.grid(rows, uv, tint, smooth=smooth, swatch=swatch)

    def ellipsoid(self, c, radii, tint=WHITE, seg=8, rings=5, swatch=None, rot=None):
        c = Vector(c)
        pts = []
        for i in range(rings + 1):
            a = math.pi * i / rings
            row = []
            for k in range(seg + 1):
                b = 2 * math.pi * k / seg
                v = Vector((radii[0] * math.cos(a), radii[1] * math.sin(a) * math.cos(b), radii[2] * math.sin(a) * math.sin(b)))
                row.append(c + (rot @ v if rot is not None else v))
            pts.append(row)
        self.grid(pts, None, tint, smooth=True, ref=c, swatch=swatch)

    def weld(self, dist=1e-4):
        """Merge coincident vertices (smooth shading across ring seams, degenerate pole faces disappear)."""
        bmesh.ops.remove_doubles(self.bm, verts=self.bm.verts, dist=dist)

    # ---- finish ---------------------------------------------------------------------
    @property
    def empty(self):
        return not self.bm.faces
