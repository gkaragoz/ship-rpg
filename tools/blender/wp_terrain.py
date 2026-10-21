"""The island of the menu wallpaper: a numpy height field (a main island, a mountain, two headlands that close the bay and a
flat reclaimed quay plateau), a vertex-coloured mesh with sand, grass, forest, rock and dirt paths, and its material."""
import math

import bpy
import numpy as np

from wp_common import fbm, principled_material, link_bump_noise, smooth

X0, X1 = -1300.0, 1300.0
Y0, Y1 = -60.0, 1000.0
QUAY_Z = 2.4
# the flat plateau of the harbour: x0, x1, y0, y1 (metres)
PLATEAU = (-130.0, 100.0, 0.0, 52.0)
# (cx, cy, ax, ay, peak, shape)
BLOBS = [
    (0.0, 330.0, 540.0, 330.0, 105.0, 1.25),
    (-240.0, 560.0, 300.0, 230.0, 170.0, 1.1),
    (340.0, 85.0, 190.0, 150.0, 58.0, 1.1),
    (-345.0, 70.0, 170.0, 130.0, 48.0, 1.1),
    (520.0, 330.0, 260.0, 220.0, 70.0, 1.2),
]


class Terrain:
    def __init__(self, rs):
        n = 1024
        self.n = n
        self.noise = fbm((n, n), 6, 6, rs)
        self.noise2 = fbm((n, n), 22, 4, rs)
        self.tint = fbm((n, n), 9, 5, rs)

    def _sample(self, grid, x, y):
        u = (np.asarray(x) - X0) / (X1 - X0) * (self.n - 1)
        v = (np.asarray(y) - Y0) / (Y1 - Y0) * (self.n - 1)
        u = np.clip(u, 0, self.n - 1.001)
        v = np.clip(v, 0, self.n - 1.001)
        i, j = u.astype(int), v.astype(int)
        fu, fv = u - i, v - j
        return (grid[j, i] * (1 - fu) * (1 - fv) + grid[j, i + 1] * fu * (1 - fv) + grid[j + 1, i] * (1 - fu) * fv + grid[j + 1, i + 1] * fu * fv)

    def height(self, x, y):
        x = np.asarray(x, dtype=float)
        y = np.asarray(y, dtype=float)
        h = np.zeros_like(x)
        rr = np.full_like(x, 9.0)
        for cx, cy, ax, ay, peak, shape in BLOBS:
            r = np.sqrt(((x - cx) / ax) ** 2 + ((y - cy) / ay) ** 2)
            rr = np.minimum(rr, r)
            h += peak * np.clip(1 - r, 0, 1) ** shape
        n1 = self._sample(self.noise, x, y) - 0.5
        n2 = self._sample(self.noise2, x, y) - 0.5
        land = smooth(0.0, 8.0, h)
        h = h + (n1 * (10 + 0.25 * h) + n2 * 4.0) * land
        px0, px1, py0, py1 = PLATEAU
        # the sea floor: shelves away from every coast, dredged deep in front of the quay
        h = np.where(rr > 1.0, -np.clip((rr - 1.0) * 300.0, 0.0, 45.0), h)
        harbour = (x > px0 - 40) & (x < px1 + 40) & (y < py0)
        h = np.where(harbour, np.minimum(h, -9.0 - 0.02 * np.clip(-y, 0, 300)), h)
        # the quay plateau: flat, blended into the land around it
        dx = np.maximum(np.maximum(px0 - x, x - px1), 0)
        dy = np.maximum(np.maximum(py0 - y, y - py1), 0)
        d = np.sqrt(dx * dx + dy * dy)
        w = (1 - smooth(0.0, 40.0, d)) * (y >= py0)
        h = h * (1 - w) + QUAY_Z * w
        return h

    def slope(self, x, y, e=2.0):
        gx = (self.height(x + e, y) - self.height(x - e, y)) / (2 * e)
        gy = (self.height(x, y + e) - self.height(x, y - e)) / (2 * e)
        return np.sqrt(gx * gx + gy * gy)

    def tint_at(self, x, y):
        return self._sample(self.tint, x, y)

    def fine_at(self, x, y):
        return self._sample(self.noise2, x, y)


def _stretch(n, lo, hi, power):
    t = np.linspace(0, 1, n)
    return lo + (hi - lo) * t**power


def path_mask(x, y, lines, width):
    """1 near any of the polylines (dirt roads), soft at the edge."""
    m = np.zeros_like(x)
    for pts in lines:
        for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
            abx, aby = bx - ax, by - ay
            t = np.clip(((x - ax) * abx + (y - ay) * aby) / (abx * abx + aby * aby), 0, 1)
            d = np.hypot(x - (ax + abx * t), y - (ay + aby * t))
            m = np.maximum(m, 1 - smooth(width * 0.5, width, d))
    return m


ROADS = [
    [(0, 50), (6, 80), (-8, 120), (-20, 170), (-18, 230)],
    [(-90, 50), (-70, 78), (-30, 96), (20, 104), (70, 98), (110, 70)],
    [(60, 52), (62, 80), (40, 120), (10, 150)],
]


def build_terrain(sc, rs):
    ter = Terrain(rs)
    nx, ny = 700, 520
    # coarse far away, fine around the harbour
    xs = np.sign(np.linspace(-1, 1, nx)) * np.abs(np.linspace(-1, 1, nx)) ** 1.55 * X1
    ys = _stretch(ny, Y0, Y1, 1.7)
    gx, gy = np.meshgrid(xs, ys)
    gz = ter.height(gx, gy)
    slope = ter.slope(gx, gy)
    tint = ter.tint_at(gx, gy)
    fine = ter.fine_at(gx, gy)
    roads = path_mask(gx, gy, ROADS, 7.0) * smooth(2.0, 3.5, gz)

    sand = np.array([0.62, 0.52, 0.34])
    wet = np.array([0.30, 0.25, 0.17])
    grass = np.array([0.20, 0.30, 0.08])
    grass2 = np.array([0.30, 0.34, 0.10])
    forest = np.array([0.07, 0.17, 0.06])
    rock = np.array([0.30, 0.27, 0.24])
    dirt = np.array([0.38, 0.28, 0.17])
    col = grass[None, None, :] * (1 - tint[..., None]) + grass2[None, None, :] * tint[..., None]
    col = col * (1 - smooth(0.15, 0.6, fine)[..., None] * 0.3)
    col = col * (1 - smooth(18, 70, gz)[..., None]) + forest * smooth(18, 70, gz)[..., None]
    col = col * (1 - smooth(0.55, 0.95, slope)[..., None]) + rock * smooth(0.55, 0.95, slope)[..., None]
    col = col * (1 - smooth(110, 150, gz + fine * 25)[..., None] * 0.7) + rock * smooth(110, 150, gz + fine * 25)[..., None] * 0.7
    beach = 1 - smooth(1.2, 5.5 + fine * 3, gz)
    col = col * (1 - beach[..., None]) + sand * beach[..., None]
    wetz = 1 - smooth(-0.6, 0.5, gz)
    col = col * (1 - wetz[..., None]) + wet * wetz[..., None]
    col = col * (1 - roads[..., None] * 0.8) + dirt * roads[..., None] * 0.8
    # the quay plateau is paved stone, drawn by the quay itself: keep the ground under it dark earth
    px0, px1, py0, py1 = (-130.0, 100.0, 0.0, 52.0)
    inside = ((gx > px0) & (gx < px1) & (gy > py0) & (gy < py1))[..., None]
    col = np.where(inside, np.array([0.28, 0.24, 0.2]), col)

    verts = np.stack([gx, gy, gz], axis=-1).reshape(-1, 3)
    idx = np.arange(nx * ny).reshape(ny, nx)
    quads = np.stack([idx[:-1, :-1], idx[:-1, 1:], idx[1:, 1:], idx[1:, :-1]], axis=-1).reshape(-1, 4)
    me = bpy.data.meshes.new("wp_island")
    me.from_pydata(verts.tolist(), [], quads.tolist())
    me.update()
    for p in me.polygons:
        p.use_smooth = True
    attr = me.color_attributes.new("Col", "FLOAT_COLOR", "POINT")
    rgba = np.concatenate([col.reshape(-1, 3), np.ones((nx * ny, 1))], axis=1)
    attr.data.foreach_set("color", rgba.ravel())
    obj = bpy.data.objects.new("wp_island", me)
    sc.collection.objects.link(obj)

    m = principled_material("wp_ground", (0.5, 0.5, 0.5), rough=0.92)
    nt = m.node_tree
    ca = nt.nodes.new("ShaderNodeVertexColor")
    ca.layer_name = "Col"
    nt.links.new(ca.outputs["Color"], nt.nodes["Principled BSDF"].inputs["Base Color"])
    link_bump_noise(m, 0.35, 0.35, detail=10)
    me.materials.append(m)
    return ter, obj
