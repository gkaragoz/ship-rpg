"""LOD0-only details of the generic ships: rudder, bow anchors, hatch coaming, ratlines.

Split from shipbuilder.py to keep both files readable. Same coordinate convention (game ship space,
`B()` converts to Blender inside shipbuilder's helpers).
"""
from mathutils import Vector

from shipbuilder import bulwark, deck_height, half_beam, gbox, keel_height, section_point, shroud_layout, side_point, spar

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


def build_hero(mb, s, masts, cfg):
    """Details only the full-quality model carries. Returns extra deck obstacles for the crew."""
    build_rudder(mb, s)
    build_anchors(mb, s)
    for mast in masts:
        build_ratlines(mb, s, mast, cfg)
    hatch = build_hatch(mb, s, masts)
    return [hatch] if hatch else []
