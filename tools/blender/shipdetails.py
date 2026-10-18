"""LOD0-only details of the generic ships: rudder, bow anchors, hatch coaming, ratlines, deck seams,
hull plank lines, rivets, barrels, stern lantern post.

Split from shipbuilder.py to keep both files readable. Same coordinate convention (game ship space,
`B()` converts to Blender inside shipbuilder's helpers).
"""
from mathutils import Vector

from shipbuilder import B, bulwark, deck_height, half_beam, gbox, keel_height, section_point, shroud_layout, side_point, spar

def build_rudder(mb, s):
    """Rudder blade behind the transom."""
    x = section_point(s, 0, 0.5)[0] - 0.12 - 0.003 * s['length']
    top = deck_height(s, 0) - bulwark(s) - 0.15
    bottom = keel_height(s, 0) * 0.95
    gbox(mb, (x, (top + bottom) / 2, 0), (0.2 + 0.005 * s['length'], top - bottom, 0.15 + 0.05 * s['beam']), 'wood')


def build_anchors(mb, s):
    """One anchor hanging on each bow."""
    k = min(max(s['length'] * 0.05, 0.5), 1.6)
    for side in (1, -1):
        p = side_point(s, 0.8, 0.35)
        x, y, z = p[0], p[1], side * (p[2] + 0.1)
        spar(mb, (x, y, z), (x, y - k, z), 0.035 * k, 0.035 * k, 'iron', 5, True)
        spar(mb, (x - 0.35 * k, y - 0.08 * k, z), (x + 0.35 * k, y - 0.08 * k, z), 0.03 * k, 0.03 * k, 'iron', 5, True)
        spar(mb, (x, y - k, z), (x + 0.4 * k, y - 0.7 * k, z), 0.035 * k, 0.03 * k, 'iron', 5, True)
        spar(mb, (x, y - k, z), (x - 0.4 * k, y - 0.7 * k, z), 0.035 * k, 0.03 * k, 'iron', 5, True)


def build_hatch(mb, s, masts):
    """Hatch coaming on the open waist; returns the matching deck obstacle for the crew."""
    L = s['length']
    if len(masts) >= 2:
        x = (masts[0].base[0] + masts[1].base[0]) / 2
    elif masts:
        x = masts[0].base[0] - 0.2 * L
    else:
        return None
    sx = min(0.07 * L + 0.6, 3.0)
    sz = min(s['beam'] * 0.4, 0.04 * L + 0.8)
    y = deck_height(s, x / L + 0.5) - bulwark(s)
    gbox(mb, (x, y + 0.14, 0), (sx, 0.28, sz), 'wood')
    return dict(type="rect", x0=round(x - sx / 2, 3), x1=round(x + sx / 2, 3), z0=round(-sz / 2, 3), z1=round(sz / 2, 3))


def build_ratlines(mb, s, mast, cfg):
    """Rope rungs between neighbouring shrouds."""
    m = mast.m
    if m['height'] < 10 or not cfg['shrouds']:
        return
    hw, count, spread, head = shroud_layout(s, m)
    head = Vector(head)
    for side in (-1, 1):
        feet = [Vector(((k - (count - 1) / 2) * spread, bulwark(s), side * hw)) for k in range(count)]
        for k in range(count - 1):
            for r in (0.2, 0.35, 0.5, 0.65, 0.8):
                a = feet[k].lerp(head, r)
                b = feet[k + 1].lerp(head, r)
                spar(mb, mast.w(tuple(a)), mast.w(tuple(b)), 0.015, 0.015, 'wood', 3, False)


def _up_strip(mb, quad, swatch, want):
    """Add a thin quad and flip it when its normal points away from `want` (Blender space)."""
    f = mb.face(quad, swatch)
    f.normal_update()
    if f.normal.dot(Vector(want)) < 0:
        f.normal_flip()


def build_deck_seams(mb, s):
    """Dark plank seams along the deck (game +x, evenly across the width)."""
    st, count = 14, 2 + min(5, int(s['beam'] / 1.6))
    for n in range(1, count):
        f = -0.85 + 1.7 * n / count
        prev = None
        for i in range(st + 1):
            t = i / st
            x, y, w = (t - 0.5) * s['length'], deck_height(s, t) - bulwark(s) + 0.012, half_beam(s, t) * 0.95 * f
            cur = (mb.v(B((x, y, w - 0.012))), mb.v(B((x, y, w + 0.012))))
            if prev:
                _up_strip(mb, (prev[0], cur[0], cur[1], prev[1]), 'dark', (0, 0, 1))
            prev = cur


def build_plank_lines(mb, s):
    """Thin dark lines along the hull sides between the rail and the keel."""
    st = 14
    for k in (0.14, 0.24, 0.34):
        for kk in (k, 1 - k):
            prev = None
            for i in range(st + 1):
                t = i / st
                x, y, z = section_point(s, t, kk)
                out = 1 if z > 0 else -1
                z += out * 0.012
                cur = (mb.v(B((x, y - 0.012, z))), mb.v(B((x, y + 0.012, z))))
                if prev:
                    _up_strip(mb, (prev[0], cur[0], cur[1], prev[1]), 'dark', (0, -out, 0))
                prev = cur


def build_rivets(mb, s):
    """Iron rivet heads on the wale, one per hull station (a few for small ships)."""
    size = min(max(s['length'] * 0.004, 0.035), 0.07)
    for i in range(1, 14):
        t = i / 14
        for k in (0.1, 0.9):
            x, y, z = section_point(s, t, k)
            gbox(mb, (x, y, z + (0.03 if z > 0 else -0.03)), (size, size, size), 'iron')


def build_barrels(mb, s, masts, hatch):
    """Cargo barrels on the quarterdeck side; returns circular deck obstacles."""
    L, r = s['length'], min(max(s['length'] * 0.018, 0.16), 0.4)
    taken = [(m.base[0], 0.35 + 0.01 * m.m['height'] + r + 0.1) for m in masts]
    if hatch:
        taken.append(((hatch['x0'] + hatch['x1']) / 2, (hatch['x1'] - hatch['x0']) / 2 + r + 0.1))
    out = []
    for fx, fz in ((-0.17, 0.35), (-0.17, -0.35), (-0.12, 0.0)):
        x = fx * L
        t = x / L + 0.5
        z = fz * half_beam(s, t) * 0.95
        if any(abs(x - tx) < tr for tx, tr in taken) or abs(z) + r > half_beam(s, t) * 0.95 - 0.1:
            continue
        y = deck_height(s, t) - bulwark(s)
        spar(mb, (x, y, z), (x, y + r * 2.2, z), r, r, 'wood', 8, True)
        out.append(dict(type="circle", x=round(x, 3), z=round(z, 3), r=round(r + 0.05, 3)))
    return out


def build_lantern_pole(mb, s):
    """Iron lantern post on the stern post for ships without a sterncastle (the glass is in shipbuilder.build_glass)."""
    if s.get('sterncastle'):
        return
    x, y0 = -s['length'] / 2 + 0.3, deck_height(s, 0) - bulwark(s)
    size = max(0.3, s['length'] * 0.01)
    spar(mb, (x, y0, 0), (x, y0 + 1.5 + size, 0), 0.025, 0.025, 'iron', 4, True)
    gbox(mb, (x, y0 + 1.5 + size * 1.7, 0), (size * 1.6, 0.04, size * 1.6), 'iron')
    gbox(mb, (x, y0 + 1.5 - 0.02, 0), (size * 1.6, 0.04, size * 1.6), 'iron')


def build_ensign(mb, flags, s):
    """Stern ensign: a wooden pole in the body mesh and the cloth in the flag mesh (see details.ts buildSternFlag)."""
    castle = s.get('sterncastle')
    tiers = 1 + (castle.get('stepped', 0) if castle else 0)
    base = deck_height(s, 0) - bulwark(s) + (castle['height'] * (1 + 0.6 * (tiers - 1)) if castle else 0)
    pole = max(3.0, s['length'] * 0.12)
    w = max(2.2, s['length'] * 0.1)
    h = w * 0.62
    x = -s['length'] / 2 + 0.4
    spar(mb, (x, base, 0), (x, base + pole, 0), 0.07, 0.06, 'wood', 4, True)
    top = base + pole
    pts = [(x, top, 0), (x - w, top, 0), (x - w, top - h, 0), (x, top - h, 0)]
    flags.face([flags.v(B(p)) for p in pts], 'flag')


def build_hero(mb, s, masts, cfg, flags):
    """Details only the full-quality model carries. Returns extra deck obstacles for the crew."""
    build_rudder(mb, s)
    build_anchors(mb, s)
    for mast in masts:
        build_ratlines(mb, s, mast, cfg)
    hatch = build_hatch(mb, s, masts)
    build_deck_seams(mb, s)
    build_plank_lines(mb, s)
    build_rivets(mb, s)
    build_lantern_pole(mb, s)
    build_ensign(mb, flags, s)
    return ([hatch] if hatch else []) + build_barrels(mb, s, masts, hatch)
