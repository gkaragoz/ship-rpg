"""Gun ports (lids), cannon muzzles and the weather deck battery of a PBR ship (inside Blender, game space).

The port openings and frames are painted into the hull texture (pbrhull.py) from the same `pbrlayout.gun_ports`
list, so the geometry here only adds the lids, the barrels and, for row 0, the carriages behind the bulwark.
"""
import math

from mathutils import Matrix, Vector

import pbrlayout as LAY
from hullmath import side_point
from pbrmesh import srgb_lin

CARRIAGE = srgb_lin(0x5A2A1E)
# barrel profile in units of the radius r: (radius, distance along the axis from the breech end)
BARREL = [(0.0, 0.0), (0.85, 0.0), (0.85, 3.2), (0.98, 3.7), (0.98, 4.1), (0.72, 4.3), (0.0, 4.3)]


def cannon(kit, x, y, z, side, r, inboard, lid=None):
    """Barrel along z (outward = `side`) whose muzzle ends at z; `inboard` metres of barrel behind the muzzle face."""
    k = max(inboard / 4.3, r)           # stretch the profile along the axis so the barrel is `inboard` long
    base = (x, y, z - side * inboard)
    prof = [(rr * r, d * (inboard / 4.3)) for rr, d in BARREL]
    kit.atlas.revolve(base, (0, 0, side), prof, seg=6, swatch='iron', smooth=True)


def carriage(kit, x, y, z, side, r, inboard):
    """Wooden truck carriage under a barrel: two cheeks, a bed and four small wheels."""
    z0 = z - side * inboard * 0.62
    L = inboard * 0.7
    for dx in (-r * 1.1, r * 1.1):
        kit.wood.box((x + dx, y - r * 0.95, z0), (r * 0.5, r * 1.3, L), CARRIAGE)
    kit.wood.box((x, y - r * 1.5, z0), (r * 2.6, r * 0.35, L * 0.95), CARRIAGE)
    for dz in (-0.38, 0.38):
        for dx in (-r * 1.45, r * 1.45):
            kit.atlas.revolve((x + dx - r * 0.2, y - r * 1.9, z0 + dz * L), (1, 0, 0), [(r * 0.55, 0), (r * 0.55, r * 0.4)],
                              seg=6, swatch='wood', smooth=False)


def build(kit):
    s, cfg = kit.s, kit.cfg
    if not cfg['detail']:
        return
    for p in LAY.gun_ports(s):
        x, y, z = side_point(s, p['t'], p['drop'])
        r = p['w'] * 0.32
        for side in (1, -1):
            zs = side * abs(z)
            if p['row'] == 0:
                cannon(kit, x, y, zs + side * 0.22, side, r, 2.1 + 1.2 * r)
                carriage(kit, x, y, zs, side, r, 2.1 + 1.2 * r)
            else:
                cannon(kit, x, y, zs + side * 0.3, side, r, 0.9)
                ang = -side * math.radians(58)
                rot = Matrix.Rotation(ang, 3, 'X')
                pivot = Vector((x, y + p['h'] / 2, zs + side * 0.05))
                c = pivot + rot @ Vector((0, -p['h'] / 2, 0))
                kit.wood.box(c, (p['w'] * 0.96, p['h'] * 0.98, 0.05), kit.hull_tint, rot=rot)
