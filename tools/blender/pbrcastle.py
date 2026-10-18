"""Castles (quarterdeck / forecastle blocks), the stern gallery, quarter galleries and balustrades (inside Blender)."""
import math

from mathutils import Matrix, Vector

import pbrlayout as LAY
from hullmath import bulwark, deck_height, half_beam, section_point
from pbrbody import INNER, rail_xz, side_half_width
from pbrmesh import srgb_lin

GILT = srgb_lin(0xD4AF37)
DARK = srgb_lin(0x140E08)
WINDOW_FRAME = srgb_lin(0xE9DFC0)


def balustrade(kit, pts, height=0.9, spacing=0.55, tint=None):
    """Top rail, lower rail and turned balusters along a polyline of game points (rail height = `height` above them)."""
    tint = tint or kit.trim_tint
    up = Vector((0, height, 0))
    pts = [Vector(p) for p in pts]
    kit.wood.tube([p + up for p in pts], 0.045, tint, seg=4, caps=False, smooth=False)
    kit.wood.tube([p + Vector((0, 0.14, 0)) for p in pts], 0.035, tint, seg=4, caps=False, smooth=False)
    if not kit.cfg['detail']:
        return
    carry = 0.0
    prev = pts[0]
    for p in pts[1:]:
        seg = p - prev
        ln = seg.length
        d = carry
        while d < ln:
            q = prev + seg * (d / ln)
            kit.wood.revolve(q + Vector((0, 0.14, 0)), (0, 1, 0), [(0.03, 0), (0.05, (height - 0.14) * 0.5), (0.03, height - 0.14)], tint,
                             seg=4, smooth=False)
            d += spacing
        carry = d - ln
        prev = p


def castle_levels(s):
    """[(end, t0, t1, bottom lift, height)] for every castle level."""
    out = []
    for key, end in (('sterncastle', 'stern'), ('forecastle', 'fore')):
        c = s.get(key)
        if not c:
            continue
        lift = 0.0
        for n in range(1 + c.get('stepped', 0)):
            length = c['length'] * (1 - 0.4 * n)
            height = c['height'] if n == 0 else c['height'] * 0.6
            t0, t1 = (0.0, length) if end == 'stern' else (1 - length, 1.0)
            out.append((end, t0, t1, lift, height, n))
            lift += height
    return out


def castle(kit, end, t0, t1, lift, height, level):
    s, cfg = kit.s, kit.cfg
    cs = cfg['castle_stations']
    L = s['length']
    pts_b, pts_t, roof = [], [], []
    for i in range(cs + 1):
        t = t0 + (t1 - t0) * i / cs
        x = rail_xz(s, t)[0]
        bottom = LAY.deck_y(s, t) + lift
        w = side_half_width(s, t) - 0.03
        pts_b.append((x, bottom, w))
        pts_t.append((x, bottom + height, w))
    for side in (1, -1):
        wall = [[(b[0], b[1], side * b[2]), (tp[0], tp[1], side * tp[2])] for b, tp in zip(pts_b, pts_t)]
        kit.wood.grid(wall, None, kit.hull_tint, smooth=False, ref=lambda m: Vector((m.x, m.y, 0)))
        if cfg['detail']:
            for pts, dy, th in ((pts_b, 0.14, 0.26), (pts_t, -0.1, 0.22)):
                strip = [[(p[0], p[1] + dy - th / 2, side * (p[2] + 0.04)), (p[0], p[1] + dy + th / 2, side * (p[2] + 0.04))] for p in pts]
                kit.wood.grid(strip, None, kit.trim_tint, smooth=False, ref=lambda m: Vector((m.x, m.y, 0)))
    if cfg['detail'] and height >= 2.2 and end == 'stern':          # cabin windows along the sides
        n = max(int((t1 - t0) * L / 3.2), 1)
        for q in range(n):
            tt = t0 + (t1 - t0) * (q + 0.5) / n
            x = rail_xz(s, tt)[0]
            wy = LAY.deck_y(s, tt) + lift + height * 0.55
            w = side_half_width(s, tt) - 0.03
            for side in (1, -1):
                kit.wood.box((x, wy, side * (w + 0.03)), (0.8, 0.8, 0.08), WINDOW_FRAME)
                kit.glass.face([(x - 0.3, wy - 0.3, side * (w + 0.075)), (x + 0.3, wy - 0.3, side * (w + 0.075)),
                                (x + 0.3, wy + 0.3, side * (w + 0.075)), (x - 0.3, wy + 0.3, side * (w + 0.075))], swatch='white', ref=(x, wy, 0))
    # roof (deck region texture), end walls
    roofP = []
    for tp in pts_t:
        roofP.append([(tp[0], tp[1], -tp[2] * (1 - 2 * j / 6) ) for j in range(7)])
    uv = [[LAY.deck_uv(kit.A, t0 + (t1 - t0) * i / cs, abs(1 - 2 * j / 6)) for j in range(7)] for i in range(cs + 1)]
    kit.atlas.grid(roofP, uv, smooth=False, ref=lambda m: m - Vector((0, 1, 0)))
    for idx in (0, cs):
        b, tp = pts_b[idx], pts_t[idx]
        quad = [(b[0], b[1], -b[2]), (b[0], b[1], b[2]), (tp[0], tp[1], tp[2]), (tp[0], tp[1], -tp[2])]
        sgn = -1 if idx == 0 else 1                       # the low-t end faces aft, the other forward
        waist = (end == 'stern') == (idx == cs)           # the wall that faces the open deck
        kit.wood.face(quad, INNER if waist and level == 0 else kit.hull_tint, ref=Vector(b) - Vector((sgn, 0, 0)))
        if waist and cfg['detail'] and level == 0:
            door = height * 0.62
            kit.wood.box((b[0] + sgn * 0.04, b[1] + door / 2 + 0.02, 0), (0.06, door, 0.9), DARK)
            kit.wood.box((b[0] + sgn * 0.06, b[1] + door + 0.06, 0), (0.08, 0.12, 1.1), kit.trim_tint)
    # balustrade around the roof edge: along both sides and across the break toward the waist
    if cfg['detail'] and height >= 1.2:
        inset = 0.16
        for side in (1, -1):
            balustrade(kit, [(tp[0], tp[1], side * (tp[2] - inset)) for tp in pts_t], 0.85)
        e = pts_t[-1] if end == 'stern' else pts_t[0]
        balustrade(kit, [(e[0] - inset * (1 if end == 'stern' else -1), e[1], -e[2] + inset), (e[0] - inset * (1 if end == 'stern' else -1), e[1], e[2] - inset)], 0.85)
    return pts_t


def stern_wall(kit):
    """Transom: the back of the hull and of the sterncastle with windows and gilt mouldings (LOD0), plus quarter galleries."""
    s, cfg = kit.s, kit.cfg
    L = s['length']
    c = s.get('sterncastle')
    xr = rail_xz(s, 0)[0]
    w = side_half_width(s, 0) - 0.03
    y0 = LAY.deck_y(s, 0)
    levels = [lv for lv in castle_levels(s) if lv[0] == 'stern']
    top = y0 + (sum(lv[4] for lv in levels) if levels else 0.0)
    if not levels:
        # bulwark across the stern
        kit.wood.face([(xr, y0, -w), (xr, y0, w), (xr, y0 + bulwark(s), w), (xr, y0 + bulwark(s), -w)], kit.hull_tint, ref=(xr + 1, y0, 0))
        top = y0 + bulwark(s)
    if not cfg['detail'] or not levels:
        return top
    h0 = levels[0][4]
    wh = min(0.9, h0 * 0.3)
    count = min(5, max(2, round(s['beam'] / 2.4)))
    for tier, lv in enumerate(levels):
        base = y0 + sum(l[4] for l in levels[:tier])
        h = lv[4]
        if h < 1.0:
            continue
        ww = min(0.9, h * 0.3)
        wy = base + h * 0.5
        wx = xr - 0.03 * (1 + tier * 0)
        hw = (w if tier == 0 else w * (1 - 0.4 * 0)) * 0.78
        for n in range(count):
            z = (-hw + 2 * hw * n / (count - 1)) if count > 1 else 0.0
            kit.wood.box((wx - 0.03, wy, z), (0.08, ww + 0.16, ww * 0.78 + 0.16), WINDOW_FRAME)
            kit.glass.face([(wx - 0.09, wy - ww / 2, z - ww * 0.39), (wx - 0.09, wy - ww / 2, z + ww * 0.39),
                            (wx - 0.09, wy + ww / 2, z + ww * 0.39), (wx - 0.09, wy + ww / 2, z - ww * 0.39)], swatch='white',
                           ref=(wx + 1, wy, z))
            kit.wood.box((wx - 0.1, wy, z), (0.03, ww, 0.04), WINDOW_FRAME)                  # mullions
            kit.wood.box((wx - 0.1, wy, z), (0.03, 0.04, ww * 0.78), WINDOW_FRAME)
        kit.wood.box((wx - 0.04, base + h - 0.08, 0), (0.1, 0.16, 2 * w), GILT)          # gilt cornice
        kit.wood.box((wx - 0.04, base + 0.1, 0), (0.1, 0.16, 2 * w), GILT)
    return top


def quarter_galleries(kit):
    """A small windowed balcony on each aft quarter of the big ships."""
    s, cfg = kit.s, kit.cfg
    c = s.get('sterncastle')
    if not c or c['height'] < 2.5 or not cfg['detail']:
        return
    xr = rail_xz(s, 0)[0]
    w = side_half_width(s, 0) - 0.03
    y0 = LAY.deck_y(s, 0)
    h = c['height'] * 0.55
    for side in (1, -1):
        cx, cz = xr + 0.5, side * (w + 0.45)
        cy = y0 + c['height'] * 0.5
        kit.wood.box((cx, cy, cz), (2.0, h, 1.0), kit.hull_tint, taper=(0.9, 0.9))
        kit.wood.box((cx, cy + h / 2 + 0.07, cz), (2.3, 0.14, 1.25), kit.trim_tint)
        kit.wood.box((cx, cy - h / 2 - 0.07, cz), (2.1, 0.14, 1.1), kit.trim_tint)
        wz = cz + side * 0.52
        for dx in (-0.5, 0.5):
            kit.glass.face([(cx + dx - 0.3, cy - h * 0.25, wz), (cx + dx + 0.3, cy - h * 0.25, wz), (cx + dx + 0.3, cy + h * 0.25, wz),
                            (cx + dx - 0.3, cy + h * 0.25, wz)], swatch='white', ref=(cx + dx, cy, cz))
        kit.glass.face([(cx - 1.02, cy - h * 0.25, cz - 0.3), (cx - 1.02, cy - h * 0.25, cz + 0.3), (cx - 1.02, cy + h * 0.25, cz + 0.3),
                        (cx - 1.02, cy + h * 0.25, cz - 0.3)], swatch='white', ref=(cx, cy, cz))
