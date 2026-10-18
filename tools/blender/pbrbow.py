"""Bow and stern timbers of a PBR ship: stem, beakhead with figurehead, cathead and hanging anchors, rudder (inside Blender)."""
import math

from mathutils import Matrix, Vector

import pbrlayout as LAY
from hullmath import bulwark, deck_height, keel_height, section_point, side_point
from pbrmesh import srgb_lin
from pbrrig import SPAR, line

TIMBER = srgb_lin(0x3A2616)


def anchor(kit, top, k):
    """Anchor hanging from `top` (game point), size `k` metres, in the plane z = top.z."""
    x, y, z = top
    iron = 'iron'
    kit.atlas.tube([(x, y, z), (x, y - k, z)], [0.035 * k] * 2, swatch=iron, seg=5)
    kit.atlas.tube([(x - 0.12 * k, y, z), (x + 0.12 * k, y, z)], [0.05 * k] * 2, swatch=iron, seg=5)                  # ring
    kit.wood.tube([(x, y - 0.12 * k, z - 0.45 * k), (x, y - 0.12 * k, z + 0.45 * k)], [0.04 * k] * 2, TIMBER, seg=5)  # stock
    arm = [(x - 0.45 * k, y - 0.62 * k, z), (x - 0.3 * k, y - 0.92 * k, z), (x, y - k, z), (x + 0.3 * k, y - 0.92 * k, z),
           (x + 0.45 * k, y - 0.62 * k, z)]
    kit.atlas.tube(arm, [0.035 * k] * 5, swatch=iron, seg=5)
    for sx in (-1, 1):
        kit.atlas.box((x + sx * 0.47 * k, y - 0.6 * k, z), (0.16 * k, 0.12 * k, 0.1 * k), swatch=iron,
                      rot=Matrix.Rotation(sx * 0.9, 3, 'Z'))


def figurehead(kit, base, f):
    """A gilt bust leaning out over the stem: torso, head, hair streaming aft, arms reaching forward, a curled scroll below."""
    x, y, z = base
    c = Vector((x, y, z))
    lean = Matrix.Rotation(-0.65, 3, 'Z')
    axis = Vector((math.sin(0.65), math.cos(0.65), 0))                           # torso direction: up and forward
    kit.atlas.ellipsoid(c, (0.3 * f, 0.62 * f, 0.34 * f), swatch='gilt', seg=10, rings=6, rot=lean)
    top = c + axis * 0.62 * f
    kit.atlas.tube([top - axis * 0.08 * f, top + axis * 0.16 * f], [0.12 * f, 0.1 * f], swatch='bone', seg=8, caps=False)
    head = top + axis * 0.38 * f
    kit.atlas.ellipsoid(head, (0.22 * f, 0.27 * f, 0.2 * f), swatch='bone', seg=10, rings=6, rot=lean)
    kit.atlas.ellipsoid(head + Vector((-0.1 * f, 0.07 * f, 0)), (0.27 * f, 0.26 * f, 0.24 * f), swatch='gilt', seg=10, rings=5, rot=lean)   # hair
    kit.atlas.ellipsoid(head + Vector((-0.45 * f, -0.1 * f, 0)), (0.4 * f, 0.1 * f, 0.15 * f), swatch='gilt', seg=8, rings=4)             # streaming aft
    for sd in (-1, 1):
        kit.atlas.tube([c + Vector((0.05 * f, 0.4 * f, sd * 0.3 * f)), c + Vector((0.38 * f, 0.22 * f, sd * 0.38 * f)),
                        c + Vector((0.7 * f, 0.3 * f, sd * 0.3 * f))], [0.1 * f, 0.08 * f, 0.07 * f], swatch='gilt', seg=6)
    sc = [(x - 0.3 * f + 0.45 * f * math.cos(a), y - 0.55 * f + 0.4 * f * math.sin(a) * (1 - a / 12), z) for a in [i * 0.7 for i in range(9)]]
    kit.atlas.tube(sc, [0.09 * f * (1 - i / 12) for i in range(9)], swatch='gilt', seg=6, caps=True)


def build(kit):
    s, cfg = kit.s, kit.cfg
    L = s['length']
    bow = section_point(s, 1.0, 0.0)
    r = 0.09 + 0.004 * L
    stem = []
    for i in range(9):
        k = 0.5 - 0.5 * i / 8
        x, y, z = section_point(s, 1.0, k)
        stem.append((x + 0.03, y, 0.0))
    kit.wood.tube(stem, [r] * len(stem), TIMBER, seg=cfg['seg'])
    if not cfg['detail']:
        return
    f = min(max(0.032 * L, 0.4), 1.6)
    if s['bowsprit'] > 0 and L >= 20:
        beak = [(bow[0] - 0.4, bow[1] - 0.6, 0.0), (bow[0] + 0.2 * f + 0.3, bow[1] - 0.45, 0.0), (bow[0] + 0.5 * f + 0.9, bow[1] - 0.1, 0.0)]
        kit.wood.tube(beak, [r * 1.2, r, r * 0.8], TIMBER, seg=6)
        figurehead(kit, (bow[0] + 0.3 * f + 0.45, bow[1] - 0.2 - 0.45 * f, 0.0), f)
    # cathead beams and anchors on both bows
    k = min(max(0.05 * L, 0.5), 1.6)
    t = 0.86
    for side in (1, -1):
        x, y, z = side_point(s, t, 0.0)
        kit.wood.tube([(x, y + 0.05, side * (abs(z) - 0.5)), (x + 0.1, y + 0.2, side * (abs(z) + 0.9))], [0.1, 0.07], TIMBER, seg=6)
        kit.atlas.tube([(x + 0.1, y + 0.2, side * (abs(z) + 0.9)), (x + 0.1, y - 0.1, side * (abs(z) + 0.9))], [0.03, 0.03], swatch='iron', seg=4)
        xa, ya, za = side_point(s, t + 0.02, 1.0 + 0.5 * k)
        anchor(kit, (xa, ya + 0.2 + k, side * (abs(za) + 0.22)), k)
        line(kit.wood, (x + 0.1, y + 0.2, side * (abs(z) + 0.9)), (xa, ya + 0.2 + k, side * (abs(za) + 0.22)), 0.03, sag=0.1, n=4)
    # rudder blade, pintles and the sternpost
    xs = section_point(s, 0.0, 0.5)[0] - 0.1 - 0.003 * L
    top = deck_height(s, 0) - bulwark(s) - 0.15
    bottom = keel_height(s, 0) * 0.95
    wide = 0.18 + 0.005 * L
    kit.wood.box((xs, (top + bottom) / 2, 0), (wide, top - bottom, 0.14 + 0.05 * s['beam']), TIMBER, taper=(0.7, 1.0))
    for fy in (0.25, 0.55, 0.85):
        kit.atlas.box((xs, bottom + (top - bottom) * fy, 0), (wide * 1.4, 0.1, 0.2 + 0.05 * s['beam']), swatch='iron')
