"""Ship details that make a big hull read as a built ship: crow's nests, companion stairs, waist gangways and rails (inside Blender).

LOD0 gets all of it, LOD1 only the silhouette parts (nests, stairs as ramps), LOD2 nothing (see pbrship.CFG).
Game ship space: +x bow, +y up, +z starboard; masts are placed with `mast.w((x, y, z))`.
"""
import math

from mathutils import Vector

import pbrlayout as LAY
from pbrbody import rail_xz, side_half_width
from pbrcastle import balustrade, stair_spec
from pbrmesh import srgb_lin

SPAR = srgb_lin(0x5A4026)
ROPE = srgb_lin(0xB09A68)
PLANK = srgb_lin(0x7A5A36)


def _ring(r, y, n):
    return [(r * math.cos(i * math.tau / n), y, r * math.sin(i * math.tau / n)) for i in range(n + 1)]


def crows_nest(kit, mast, tallest):
    """A staved barrel nest on the topmast: floor, flared staves, hoops, a rope rail and a lubber's hole.

    Every square-rigged mast of 20 m and up carries one (the tallest the biggest); fore-and-aft masts of 12 m and up a small lookout tub.
    """
    m, cfg = mast.m, kit.cfg
    h = m['height']
    square = m['rig'] == 'square' and h >= 20
    big = h == tallest
    if not square and not (big and h >= 12):
        return
    r = (0.5 + 0.007 * h) * (1.0 if big else 0.8) if square else 0.32 + 0.004 * h
    y = (0.84 if square else 0.74) * h
    w = mast.w
    ax = Vector(w((0, 1, 0))) - Vector(w((0, 0, 0)))
    depth = 0.95 if square else 0.75
    seg = 12 if cfg['detail'] else 8
    kit.wood.revolve(w((0, y, 0)), ax, [(0.12, -0.1), (r * 0.94, -0.1), (r * 1.0, 0.0), (r * 1.1, depth * 0.55), (r * 1.14, depth)], SPAR, seg=seg, smooth=False)
    kit.atlas.revolve(w((0, y, 0)), ax, [(0.12, 0.0), (r * 0.96, 0.0)], seg=seg, swatch='deck')                      # floor
    if not cfg['detail']:
        return
    for k in (0.0, 0.5, 1.0):                                                                                            # iron hoops
        rr = r * (1.0 + 0.14 * k) + 0.03
        kit.atlas.tube([w(p) for p in _ring(rr, y + depth * k - 0.04 + 0.08 * (k == 0), 12)], 0.03, swatch='iron', seg=4, caps=False, smooth=False)
    top = y + depth + 0.5                                                                                                # rope rail on posts
    posts = 6
    for i in range(posts):
        a = i * math.tau / posts
        rr = r * 1.14
        kit.wood.tube([w((rr * math.cos(a), y + depth - 0.1, rr * math.sin(a))), w((rr * math.cos(a), top, rr * math.sin(a)))], 0.025, SPAR, seg=3, caps=False, smooth=False)
    kit.wood.tube([w(p) for p in _ring(r * 1.16, top, 12)], 0.028, ROPE, seg=3, caps=False, smooth=False)
    kit.wood.tube([w(p) for p in _ring(r * 1.16, (top + y + depth) / 2, 12)], 0.02, ROPE, seg=3, caps=False, smooth=False)
    kit.atlas.box(w((r * 0.55, y + 0.02, 0)), (0.5, 0.05, 0.5), swatch='dark')                                          # lubber's hole
    for sgn in (-1, 1):                                                                                                  # knees under the floor
        kit.wood.tube([w((0.1 * sgn, y - 0.1, 0.0)), w((r * 0.9 * sgn, y - 0.7, 0.0))], 0.045, SPAR, seg=4, caps=False, smooth=False)
        kit.wood.tube([w((0.0, y - 0.1, 0.1 * sgn)), w((0.0, y - 0.7, r * 0.9 * sgn))], 0.045, SPAR, seg=4, caps=False, smooth=False)


def _stair(kit, x_wall, y_top, y_bot, z, width, run, outward, rail):
    """One companion stair from the castle roof (x_wall, y_top) down toward the waist; `outward` is +1 when the waist lies at +x."""
    steps = max(3, int(round((y_top - y_bot) / 0.27)))
    wood = kit.wood
    top = Vector((x_wall, y_top, z))
    bot = Vector((x_wall + outward * run, y_bot, z))
    for dz in (-width / 2, width / 2):
        wood.tube([top + Vector((0, -0.1, dz)), bot + Vector((0, -0.1, dz))], 0.055, SPAR, seg=4, caps=True, smooth=False)
    if not kit.cfg['detail']:
        return
    for i in range(steps):
        f = (i + 0.5) / steps
        c = top + (bot - top) * f
        wood.box((c.x, c.y - 0.02, z), (run / steps * 1.05, 0.05, width), PLANK)
    if rail:
        for dz in (-width / 2, width / 2):
            a = top + Vector((0, 0.8, dz))
            b = bot + Vector((0, 0.8, dz))
            wood.tube([a, b], 0.03, SPAR, seg=4, caps=True, smooth=False)
            for f in (0.0, 0.5, 1.0):
                p = top + (bot - top) * f
                wood.tube([p + Vector((0, 0.0, dz)), p + Vector((0, 0.8, dz))], 0.025, SPAR, seg=3, caps=False, smooth=False)
        kit.wood.tube([top + Vector((0, 0.9, -width / 2)), top + Vector((0, 0.9, width / 2))], 0.03, SPAR, seg=3, caps=False, smooth=False)


def stairs(kit):
    """A stair on each side from the waist up to every castle level (the gap in the break rail is left by pbrcastle)."""
    s, cfg = kit.s, kit.cfg
    for end, t0, t1, lift, height, level in _levels(s):
        if height < 1.0:
            continue
        sp = stair_spec(s, end, t0, t1, height, level)
        t_wall = t1 if end == 'stern' else t0
        x_wall = rail_xz(s, t_wall)[0]
        y_bot = LAY.deck_y(s, t_wall) + lift
        outward = 1 if end == 'stern' else -1
        for side in (-1, 1):
            _stair(kit, x_wall + outward * 0.18, y_bot + height, y_bot, side * sp['z'], sp['width'], sp['run'], outward, cfg['detail'])


def _levels(s):
    from pbrcastle import castle_levels
    return castle_levels(s)


def gangways(kit):
    """Raised side walkways joining the quarterdeck and the forecastle on ships with both and 40 m of hull or more."""
    s = kit.s
    if not (s.get('sterncastle') and s.get('forecastle')) or s['length'] < 40:
        return
    stern = [lv for lv in _levels(s) if lv[0] == 'stern' and lv[5] == 0][0]
    fore = [lv for lv in _levels(s) if lv[0] == 'fore' and lv[5] == 0][0]
    t_a, t_b = stern[2], fore[1]
    n = 8
    lift = min(stern[4], fore[4]) * 0.5
    for side in (-1, 1):
        pts = []
        for i in range(n + 1):
            t = t_a + (t_b - t_a) * i / n
            pts.append((rail_xz(s, t)[0], LAY.deck_y(s, t) + lift, side * (side_half_width(s, t) - 0.65)))
        kit.wood.tube(pts, 0.07, SPAR, seg=4, caps=True, smooth=False)
        for a, b in zip(pts, pts[1:]):                                                                                    # planks
            c = ((a[0] + b[0]) / 2, (a[1] + b[1]) / 2 - 0.04, (a[2] + b[2]) / 2)
            kit.wood.box(c, (abs(b[0] - a[0]) * 1.02, 0.07, 1.0), PLANK)
        for p in pts[::2]:                                                                                                # stanchions
            kit.wood.tube([(p[0], LAY.deck_y(s, 0.5), p[2] - side * 0.4), (p[0], p[1], p[2])], 0.05, SPAR, seg=4, caps=False, smooth=False)
        balustrade(kit, [(p[0], p[1], p[2] - side * 0.42) for p in pts], 0.8, spacing=0.7)


def stanchions(kit):
    """Rope rails on posts above the bulwark in the waist of ships of 24 m and up (the open rail of a merchantman)."""
    s = kit.s
    if s['length'] < 24:
        return
    t_a = 0.2 if not s.get('sterncastle') else 0.1 + s['sterncastle']['length']
    t_b = 0.82 if not s.get('forecastle') else 0.9 - s['forecastle']['length']
    count = max(4, int((t_b - t_a) * s['length'] / 2.4))
    for side in (-1, 1):
        pts = []
        for i in range(count + 1):
            t = t_a + (t_b - t_a) * i / count
            x, y, z = rail_xz(s, t, side)
            pts.append((x, y, z * 0.97))
        for p in pts[::2]:
            kit.wood.tube([p, (p[0], p[1] + 0.55, p[2])], 0.03, SPAR, seg=3, caps=False, smooth=False)
        kit.wood.tube([(p[0], p[1] + 0.55, p[2]) for p in pts], 0.022, ROPE, seg=3, caps=False, smooth=False)


def taffrail(kit):
    """A rail across the stern of ships with no sterncastle (their helm stands in the open)."""
    s = kit.s
    if s.get('sterncastle') or s['length'] < 12:
        return
    t = 0.04
    x, y, z = rail_xz(s, t)
    hw = abs(z) * 0.97
    pts = [(x, y, -hw), (x, y, 0), (x, y, hw)]
    balustrade(kit, pts, 0.7, spacing=0.5)


def build(kit, masts, tallest, level):
    if level >= 2:
        return
    for mast in masts:
        kit.step('nest', crows_nest, kit, mast, tallest)
    if level == 0:
        kit.step('stairs', stairs, kit)
        kit.step('gangways', gangways, kit)
        kit.step('stanchions', stanchions, kit)
        kit.step('taffrail', taffrail, kit)
    else:
        kit.step('stairs', stairs, kit)
