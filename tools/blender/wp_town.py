"""Town, landmarks, trees and quay clutter of the menu wallpaper, scattered over the height field as linked duplicates of the
game's world props (`public/models/world/world.glb`)."""
import math

import numpy as np

from wp_common import place_copy, smooth
from wp_terrain import PLATEAU, QUAY_Z, ROADS, path_mask

# which way the game's props face in the wallpaper scene (yaw offset that turns a prop's front to -Y, towards the sea)
FRONT = math.pi / 2
CAMERA = (0.0, -75.0)


def _free(taken, x, y, r):
    return all((x - tx) ** 2 + (y - ty) ** 2 > (r + tr) ** 2 for tx, ty, tr in taken)


def populate(sc, ter, lod0, lod1, rs, nrs):
    taken = []
    stats = {}

    def put(name, x, y, yaw=0.0, scale=1.0, z=None, radius=4.0, track=True):
        dist = math.hypot(x - CAMERA[0], y - CAMERA[1])
        src = (lod1.get(name) if dist > 330 else None) or lod0[name]
        h = float(ter.height(np.array([x]), np.array([y]))[0]) if z is None else z
        o = place_copy(sc, src, (x, y, h), yaw, scale)
        if track:
            taken.append((x, y, radius * scale))
        stats[name] = stats.get(name, 0) + 1
        return o

    def top_of(cx, cy, r):
        """The highest point within r of (cx, cy)."""
        xs = np.linspace(cx - r, cx + r, 60)
        ys = np.linspace(cy - r, cy + r, 60)
        gx, gy = np.meshgrid(xs, ys)
        h = ter.height(gx, gy)
        k = np.unravel_index(h.argmax(), h.shape)
        return float(gx[k]), float(gy[k]), float(h[k])

    # landmarks
    lx, ly, lz = top_of(350, 80, 70)
    put("Lighthouse", lx, ly, 0.0, 2.2, z=lz - 0.5, radius=9)
    fx, fy, fz = top_of(-345, 70, 60)
    put("Fort", fx, fy, FRONT, 1.9, z=fz - 0.8, radius=30)
    put("Church", 6, 142, FRONT, 1.7, radius=14)
    for (wx, wy) in ((160, 215), (-70, 280)):
        put("Windmill", wx, wy, FRONT + 0.4, 1.8, radius=10)
    put("WatchTower", -190, 175, FRONT, 1.7, radius=6)
    put("WatchTower", 205, 130, FRONT, 1.7, radius=6)

    # the quay: warehouses and a tavern behind the water's edge, a crane, market stalls, barrels, crates, cannons
    for x in (-105, -78, -48, 52, 80):
        put("Warehouse", x, 24 + rs.uniform(-2, 2), FRONT + rs.uniform(-0.05, 0.05), 1.15, z=QUAY_Z, radius=9)
    put("Tavern", -12, 30, FRONT, 1.5, z=QUAY_Z, radius=7)
    put("Tavern", 32, 33, FRONT, 1.4, z=QUAY_Z, radius=7)
    put("Crane", -64, 4.8, FRONT, 2.2, z=QUAY_Z, radius=6)
    put("Crane", 66, 4.6, FRONT, 2.2, z=QUAY_Z, radius=6)
    for i in range(9):
        put("MarketStall", -26 + i * 6.3 + rs.uniform(-1, 1), 12 + rs.uniform(-1.5, 1.5), FRONT + rs.uniform(-0.25, 0.25), 1.2, z=QUAY_Z, radius=2.5)
    for _ in range(40):
        x = rs.uniform(-120, 95)
        y = rs.uniform(2.5, 9.0)
        if _free(taken, x, y, 1.0):
            put(rs.choice(("BarrelStack", "CrateStack", "CrateStack", "BarrelStack", "CannonProp")), x, y, rs.uniform(0, 6.28), rs.uniform(1.0, 1.4), z=QUAY_Z, radius=1.2)

    # houses on terraces up the slope, facing the sea, along the roads
    kinds = ["HouseEnglish", "HouseFrench", "HouseSpanish", "HouseDutch", "Shack", "HouseEnglish", "HouseSpanish", "HouseDutch"]
    for y in np.arange(58, 210, 11.0):
        for x in np.arange(-135, 140, 13.0):
            xx = x + rs.uniform(-4, 4)
            yy = y + rs.uniform(-3.5, 3.5)
            p = np.array([xx]), np.array([yy])
            h = float(ter.height(*p)[0])
            if h < 3.0 or h > 85 or float(ter.slope(*p)[0]) > 0.42:
                continue
            if float(path_mask(p[0], p[1], ROADS, 7.0)[0]) > 0.15 or not _free(taken, xx, yy, 5.5):
                continue
            density = 0.78 - 0.0035 * (y - 58) - 0.0016 * abs(xx)
            if rs.random() > density:
                continue
            put(rs.choice(kinds), xx, yy, FRONT + rs.uniform(-0.28, 0.28), rs.uniform(1.0, 1.45), radius=5.0)

    # trees: palms on the shore, broadleaf inland, pines high up, bushes and rocks between
    cam = np.array(CAMERA)
    for _ in range(11000):
        x = nrs.uniform(-760, 760)
        y = nrs.uniform(4, 760)
        p = np.array([x]), np.array([y])
        h = float(ter.height(*p)[0])
        sl = float(ter.slope(*p)[0])
        if h < 1.2 or sl > 0.85:
            continue
        if float(path_mask(p[0], p[1], ROADS, 8.0)[0]) > 0.1:
            continue
        if PLATEAU[0] - 8 < x < PLATEAU[1] + 8 and y < PLATEAU[3] + 6:
            continue
        near = math.hypot(x - cam[0], y - cam[1])
        if near > 520 and nrs.random() < 0.55:
            continue
        if not _free(taken, x, y, 2.2):
            continue
        r = nrs.random()
        if h < 12:
            if r < 0.5:
                put(nrs.choice(("PalmA", "PalmB")), x, y, nrs.uniform(0, 6.28), nrs.uniform(1.5, 2.4), radius=1.8)
            elif r < 0.62:
                put("Bush", x, y, nrs.uniform(0, 6.28), nrs.uniform(1.0, 2.0), radius=1.2)
        elif h < 60:
            if r < 0.6:
                put("Broadleaf", x, y, nrs.uniform(0, 6.28), nrs.uniform(1.5, 2.8), radius=2.2)
            elif r < 0.7:
                put(nrs.choice(("RockA", "RockB", "RockC")), x, y, nrs.uniform(0, 6.28), nrs.uniform(1.0, 2.6), radius=1.8)
            elif r < 0.78:
                put("Bush", x, y, nrs.uniform(0, 6.28), nrs.uniform(1.2, 2.4), radius=1.2)
        else:
            if r < 0.55:
                put("Pine", x, y, nrs.uniform(0, 6.28), nrs.uniform(1.8, 3.2), radius=2.2)
            elif r < 0.7:
                put(nrs.choice(("RockA", "RockB", "RockC")), x, y, nrs.uniform(0, 6.28), nrs.uniform(1.6, 4.0), radius=2.0)
    return stats
