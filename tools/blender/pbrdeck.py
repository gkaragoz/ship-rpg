"""Deck furniture, boats, lanterns and the ensign of a PBR ship (inside Blender, game space)."""
import math

from mathutils import Matrix, Vector

import pbrlayout as LAY
import pbrbow
from hullmath import bulwark, deck_height, half_beam, section_point
from pbrbody import deck_half, rail_xz
from pbrcastle import GILT, castle_levels
from pbrmesh import srgb_lin
from pbrrig import IRON, SPAR, flag_cloth, line

BOAT = srgb_lin(0x7A6446)
TIMBER = srgb_lin(0x3A2616)


def top_deck(s):
    """Height of the highest sterncastle roof above the main deck (0 without a sterncastle)."""
    return sum(lv[4] for lv in castle_levels(s) if lv[0] == 'stern')


def hatch(kit, masts):
    """Hatch coaming with a bar grating on the open waist; returns the matching deck obstacle for the crew."""
    s = kit.s
    L = s['length']
    if len(masts) >= 2:
        x = (masts[0].base[0] + masts[1].base[0]) / 2
    elif masts:
        x = masts[0].base[0] - 0.2 * L
    else:
        return None
    sx = min(0.07 * L + 0.6, 3.0)
    sz = min(s['beam'] * 0.4, 0.04 * L + 0.8)
    y = LAY.deck_y(s, x / L + 0.5)
    for dx, dz, ssx, ssz in ((0, sz / 2, sx, 0.1), (0, -sz / 2, sx, 0.1), (sx / 2, 0, 0.1, sz), (-sx / 2, 0, 0.1, sz)):
        kit.wood.box((x + dx, y + 0.14, dz), (ssx, 0.28, ssz), SPAR)
    n = max(int(sz / 0.16), 3)
    for i in range(n):
        z = -sz / 2 + 0.07 + (sz - 0.14) * i / (n - 1)
        kit.wood.box((x, y + 0.2, z), (sx - 0.1, 0.05, 0.05), TIMBER)
    for i in range(max(int(sx / 0.5), 3)):
        kit.wood.box((x - sx / 2 + 0.2 + (sx - 0.4) * i / max(int(sx / 0.5) - 1, 2), y + 0.22, 0), (0.05, 0.04, sz - 0.1), TIMBER)
    return dict(type="rect", x0=round(x - sx / 2, 3), x1=round(x + sx / 2, 3), z0=round(-sz / 2, 3), z1=round(sz / 2, 3))


def capstan(kit, masts):
    s = kit.s
    L = s['length']
    if len(masts) >= 2:
        x = masts[0].base[0] + 0.78 * (masts[1].base[0] - masts[0].base[0])
    elif masts:
        x = masts[0].base[0] - 0.08 * L
    else:
        return None
    y = LAY.deck_y(s, x / L + 0.5)
    r = 0.3 + 0.004 * L
    kit.wood.revolve((x, y, 0), (0, 1, 0), [(r * 1.1, 0), (r * 0.9, 0.15), (r * 0.7, 0.5), (r * 0.75, 0.9), (r * 1.05, 1.0), (r * 1.1, 1.1), (r * 0.9, 1.15), (0, 1.15)],
                     TIMBER, seg=10)
    for k in range(6):
        a = k * math.pi / 3
        d = Vector((math.cos(a), 0, math.sin(a)))
        c = Vector((x, y + 1.05, 0))
        kit.wood.tube([c, c + d * (r + 1.1)], [0.04, 0.035], SPAR, seg=4)
    kit.atlas.revolve((x, y + 1.15, 0), (0, 1, 0), [(0.05, 0), (0.05, 0.14), (0.0, 0.17)], seg=6, swatch='iron')
    return dict(type="circle", x=round(x, 3), z=0.0, r=round(r * 1.1 + 0.1, 3))


def barrels(kit, masts, hat):
    s = kit.s
    L, r = s['length'], min(max(s['length'] * 0.018, 0.16), 0.4)
    taken = [(m.base[0], 0.35 + 0.01 * m.m['height'] + r + 0.1) for m in masts]
    if hat:
        taken.append(((hat['x0'] + hat['x1']) / 2, (hat['x1'] - hat['x0']) / 2 + r + 0.1))
    out = []
    for fx, fz in ((-0.17, 0.35), (-0.17, -0.35), (-0.12, 0.0)):
        x = fx * L
        t = x / L + 0.5
        z = fz * half_beam(s, t) * 0.95
        if any(abs(x - tx) < tr for tx, tr in taken) or abs(z) + r > deck_half(s, t) - 0.1:
            continue
        y = LAY.deck_y(s, t)
        h = r * 2.2
        kit.wood.revolve((x, y, z), (0, 1, 0), [(r * 0.82, 0), (r, h * 0.5), (r * 0.82, h), (0, h)], BOAT, seg=10)
        for fy in (0.12, 0.35, 0.65, 0.88):
            rr = r * (0.82 + 0.18 * (1 - abs(2 * fy - 1) ** 2)) + 0.012
            kit.atlas.revolve((x, y + h * fy - 0.02, z), (0, 1, 0), [(rr, 0), (rr, 0.04)], seg=10, swatch='iron')
        out.append(dict(type="circle", x=round(x, 3), z=round(z, 3), r=round(r + 0.05, 3)))
    return out


def helm(kit):
    """Ship's wheel and binnacle on the highest stern deck, a tiller on small ships."""
    s = kit.s
    L = s['length']
    levels = [lv for lv in castle_levels(s) if lv[0] == 'stern']
    if not levels:
        x = rail_xz(s, 0)[0] + 1.2 + 0.02 * L
        y = LAY.deck_y(s, 0) + 0.3
        kit.wood.tube([(x - 0.3, y, 0), (x + 1.6 + 0.04 * L, y + 0.05, 0.0)], [0.05, 0.04], TIMBER, seg=5)
        return
    lv = levels[-1]
    y = LAY.deck_y(s, 0) + sum(l[4] for l in levels)
    x = rail_xz(s, 0)[0] + min(2.6 + 0.03 * L, 0.5 * lv[2] * L)
    R = 0.5 + 0.003 * L
    hub = Vector((x, y + 1.0 + R * 0.5, 0))
    ring = [hub + Vector((0, R * math.cos(a), R * math.sin(a))) for a in [i * math.tau / 20 for i in range(21)]]
    kit.wood.tube(ring, 0.035, SPAR, seg=5, caps=False)
    for k in range(8):
        a = k * math.tau / 8
        d = Vector((0, math.cos(a), math.sin(a)))
        kit.wood.tube([hub, hub + d * (R + 0.18)], [0.03, 0.022], SPAR, seg=4)
    kit.wood.box((x - 0.2, y + 0.5, 0), (0.6, 1.0, 0.7), TIMBER)                       # pedestal
    kit.atlas.revolve(hub - Vector((0.1, 0, 0)), (1, 0, 0), [(0.07, 0), (0.07, 0.3)], seg=6, swatch='brass')
    kit.wood.box((x + 0.7, y + 0.45, 0), (0.5, 0.9, 0.5), TIMBER)                      # binnacle
    kit.glass.face([(x + 0.46, y + 0.7, -0.17), (x + 0.46, y + 0.7, 0.17), (x + 0.46, y + 0.95, 0.17), (x + 0.46, y + 0.95, -0.17)],
                   swatch='white', ref=(x + 1, y + 0.8, 0))


def boat(kit, c, length, beam, depth, tint=BOAT, yaw=0.0, thwarts=4):
    """Open boat centred on c (hull bottom at c.y): planked shell, inner shell, gunwale, thwarts and two oars."""
    c = Vector(c)
    ns, nj = 9, 6
    def sec(i, j, scale):
        u = -1 + 2 * i / ns
        hb = 0.5 * beam * scale * max(1 - abs(u) ** 2.4, 0.05) ** 0.7
        a = math.pi * j / nj
        return Vector((c.x + u * length / 2, c.y + depth * (1 - math.sin(a)) * (1 + 0.2 * u * u), c.z + hb * math.cos(a)))

    outer = [[sec(i, j, 1.0) for j in range(nj + 1)] for i in range(ns + 1)]
    inner = [[sec(i, j, 0.9) + Vector((0, 0.07, 0)) for j in range(nj + 1)] for i in range(ns + 1)]
    cen = lambda m: Vector((m.x, c.y + depth, c.z))
    kit.wood.grid(outer, None, tint, smooth=True, ref=cen)
    kit.wood.grid(inner, None, tuple(0.7 * q for q in tint), smooth=True, ref=lambda m: Vector((m.x, c.y - 1, c.z)))
    for sd in (0, nj):
        kit.wood.tube([Vector(outer[i][sd]) + Vector((0, 0.03, 0)) for i in range(ns + 1)], 0.03, SPAR, seg=4, caps=False, smooth=False)
    for k in range(thwarts):
        x = c.x - length * 0.34 + length * 0.68 * k / max(thwarts - 1, 1)
        u = (x - c.x) / (length / 2)
        hb = 0.5 * beam * 0.88 * max(1 - abs(u) ** 2.4, 0.05) ** 0.7
        kit.wood.box((x, c.y + depth * 0.62, c.z), (0.28, 0.05, 2 * hb), SPAR)
    for sd in (-1, 1):
        kit.wood.tube([(c.x - length * 0.35, c.y + depth * 0.72, c.z + sd * beam * 0.18), (c.x + length * 0.42, c.y + depth * 0.82, c.z + sd * beam * 0.28)],
                      [0.03, 0.03], SPAR, seg=4)


def boats(kit):
    """A longboat on skids over the waist of the big ships and a jolly boat on stern davits."""
    s = kit.s
    L = s['length']
    if L < 28:
        return
    if L >= 40:
        x = 0.02 * L
        y0 = LAY.deck_y(s, x / L + 0.5)
        hw = deck_half(s, x / L + 0.5)
        bl, bb = 0.2 * L, min(0.05 * L, hw * 0.7)
        for dx in (-bl * 0.3, bl * 0.3):
            kit.wood.box((x + dx, y0 + 2.2, 0), (0.25, 0.25, 2 * hw), SPAR)
            for sd in (-1, 1):
                kit.wood.box((x + dx, y0 + 1.1, sd * (hw - 0.1)), (0.22, 2.2, 0.22), SPAR)
        boat(kit, (x, y0 + 2.35, 0), bl, bb, 0.9, thwarts=5)
    # jolly boat on davits across the stern
    xr = rail_xz(s, 0)[0]
    top = LAY.deck_y(s, 0) + top_deck(s)
    bl, bb = 0.15 * L, 0.04 * L + 0.5
    cx, cy = xr - bl * 0.55, top + 0.5 + bb * 0.3
    for sd in (-1, 1):
        kit.wood.tube([(xr + 0.3, top, sd * bb * 0.55), (xr - 0.2, top + 1.6, sd * bb * 0.55), (cx - bl * 0.18, top + 2.1, sd * bb * 0.55)], [0.07, 0.06, 0.05], SPAR, seg=5)
    boat(kit, (cx, cy, 0), bl, bb, 0.55)


def lanterns(kit):
    """Two stern lanterns (iron frame + emissive glass) on the sterncastle, or one on a post; returns the first position."""
    s = kit.s
    L = s['length']
    size = max(0.3, L * 0.01)
    top = LAY.deck_y(s, 0) + top_deck(s)
    first = None
    xr = rail_xz(s, 0)[0]
    posts = [(xr + 0.5, top, side * (deck_half(s, 0) * 0.85)) for side in (-1, 1)] if top_deck(s) > 0 else [(xr + 0.4, top, 0.0)]
    for (x, y, z) in posts:
        h = 1.4 if top_deck(s) == 0 else 0.9
        kit.atlas.tube([(x, y, z), (x, y + h, z)], [0.03, 0.03], swatch='iron', seg=4)
        c = (x, y + h + size * 0.7, z)
        first = first or c
        kit.atlas.box((x, y + h + 0.02, z), (size * 1.6, 0.05, size * 1.6), swatch='iron')
        kit.atlas.box((x, y + h + size * 1.45, z), (size * 1.3, 0.05, size * 1.3), swatch='iron', taper=(0.5, 0.5))
        kit.glass.box(c, (size, size * 1.3, size), swatch='white')
        for dx, dz in ((1, 1), (-1, 1), (1, -1), (-1, -1)):
            kit.atlas.tube([(x + dx * size * 0.5, y + h, z + dz * size * 0.5), (x + dx * size * 0.5, y + h + size * 1.45, z + dz * size * 0.5)],
                           [0.015, 0.015], swatch='iron', seg=3, caps=False)
    return first


def stern_ensign(kit):
    s = kit.s
    if not kit.cfg['detail']:
        return
    L = s['length']
    top = LAY.deck_y(s, 0) + top_deck(s)
    x = rail_xz(s, 0)[0] + 0.5
    pole = max(3.0, L * 0.12)
    kit.wood.tube([(x, top, 0), (x - 0.5, top + pole, 0)], [0.07, 0.04], SPAR, seg=5)
    w = max(2.2, L * 0.1)
    flag_cloth(kit.flag, (x - 0.5, top + pole - 0.1, 0), (-w, 0, 0), w * 0.62, 0.35, n=8)


def small_extras(kit, masts):
    """Fishing-boat clutter of the small ships: sweeps along the rails, baskets, a heap of net, a coil of rope and a cuddy."""
    s = kit.s
    L = s['length']
    for side in (-1, 1):
        t0, t1 = 0.3, 0.78
        x0, x1 = (t0 - 0.5) * L, (t1 - 0.5) * L
        z = side * (deck_half(s, 0.55) - 0.35)
        y = LAY.deck_y(s, 0.55) + 0.25
        kit.wood.tube([(x0, y, z), (x1 - 0.7, y + 0.05, z)], [0.04, 0.035], SPAR, seg=5)
        kit.wood.box((x1 - 0.35, y + 0.05, z), (0.75, 0.04, 0.2), SPAR)
    base = LAY.deck_y(s, 0.25)
    for dz, dx in ((0.7, 0.0), (-0.6, 0.5), (0.2, -0.7)):
        kit.wood.revolve((-0.25 * L + dx, base, dz), (0, 1, 0), [(0.2, 0), (0.3, 0.2), (0.34, 0.38), (0.0, 0.38)], BOAT, seg=8)
    bx = 0.18 * L
    for k, (dx, dz) in enumerate(((0, 0), (0.5, 0.3), (-0.4, -0.25))):
        kit.atlas.ellipsoid((bx + dx, LAY.deck_y(s, 0.68) + 0.12, dz), (0.55, 0.14, 0.42), swatch='rope', seg=7, rings=4)
    kit.atlas.revolve((-0.12 * L, LAY.deck_y(s, 0.38), -0.8), (0, 1, 0), [(0.28, 0), (0.34, 0.07), (0.28, 0.14), (0.14, 0.14)], seg=10, swatch='rope')
    cx = -0.38 * L
    y = LAY.deck_y(s, 0.12)
    kit.wood.box((cx, y + 0.3, 0), (1.5, 0.6, 1.3), SPAR, taper=(0.92, 0.9))
    kit.wood.box((cx + 0.76, y + 0.28, 0), (0.05, 0.42, 0.55), TIMBER)
    return None


def oars(kit):
    """Sweeps run out through the rail (xebec, galeoth): shaft, grip and blade, both sides."""
    s = kit.s
    n = s['oars']
    if n <= 0:
        return
    length = s['length'] * 0.18
    d0 = Vector((0.15, -0.55, 0.8)).normalized()
    for k in range(n):
        t = 0.28 + 0.5 * ((k + 0.5) / n)
        x, ytop, z = rail_xz(s, t)
        y = ytop - bulwark(s) / 2
        for side in (1, -1):
            d = Vector((d0.x, d0.y, d0.z * side))
            start = Vector((x, y, side * abs(z))) - d * (length * 0.25)
            end = start + d * length * 1.25
            kit.wood.tube([start, start.lerp(end, 0.7), end], [0.045, 0.04, 0.03], SPAR, seg=5)
            kit.wood.box(end - d * 0.45, (0.08, 0.04, 0.9), SPAR, rot=None)


def build(kit, masts, level):
    cfg = kit.cfg
    st = getattr(kit, 'step', lambda name, fn, *a: fn(*a))
    st('bow', pbrbow.build, kit)
    if not cfg['detail']:
        return None
    hat = st('hatch', hatch, kit, masts)
    cap = st('capstan', capstan, kit, masts)
    bar = st('barrels', barrels, kit, masts, hat)
    kit.extra.extend([o for o in [hat, cap] if o] + bar)
    st('helm', helm, kit)
    st('oars', oars, kit)
    if kit.s['length'] < 20:
        st('extras', small_extras, kit, masts)
    st('boats', boats, kit)
    return st('lanterns', lanterns, kit)
