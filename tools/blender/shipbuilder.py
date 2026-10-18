"""Generic ship builder: a Python port of src/ships (hullShape, hull, castles, rig, details).

Takes a ShipSpec dict from ships.json and builds LOD0/LOD1/LOD2 into a Blender scene (see
make_ships.py). Coordinates inside this file are GAME ship space (+x bow, +y up, +z starboard);
`B()` converts to Blender (x, -z, y) so the glTF Y-up export lands back in the same space.
Keep the formulas in step with the TypeScript originals; the procedural ship stays the reference.
"""
import math

from mathutils import Vector

from shipkit import MB

from hullmath import (DEPTH_EXPONENT, SECTION_FULLNESS, bulwark, clamp01, deck_height, half_beam, keel_height,  # noqa: F401
                      mast_base, section_point, side_point, smooth)


def B(p):
    """Game (x, y, z) -> Blender (x, -z, y)."""
    return (p[0], -p[2], p[1])


# --------------------------------------------------------------------------- LOD ladder
LOD_CFG = {
    0: dict(stations=28, segs=16, hero=True, rail=True, castle_stations=6, seg=6, caps=True, top=True, shrouds=True, pennant=True,
            stays=True, ports=True, oars=True, glass=True, sail_seg=8, jib_seg=6, bowsprit_seg=6),
    1: dict(stations=12, segs=12, hero=False, rail=False, castle_stations=2, seg=4, caps=False, top=False, shrouds=False, pennant=False,
            stays=False, ports=False, oars=False, glass=False, sail_seg=3, jib_seg=2, bowsprit_seg=4),
    2: dict(stations=5, segs=4, hero=False, rail=False, castle_stations=1, seg=3, caps=False, top=False, shrouds=False, pennant=False,
            stays=False, ports=False, oars=False, glass=False, sail_seg=2, jib_seg=1, bowsprit_seg=3),
}


def hull_swatch(lod, k, segs):
    """Colour of hull segment k (0 = deck edge) so the three LODs look alike from afar."""
    from_top = min(k, segs - 1 - k)
    if lod == 0:
        return 'trim' if from_top == 1 else ('hull_lower' if from_top >= 3 else 'hull')
    if lod == 1:   # 12 segments: the cream wale sits one ring below the rail, like LOD0
        return 'hull' if from_top == 0 else ('trim' if from_top == 1 else 'hull_lower')
    return 'hull' if from_top == 0 else 'hull_lower'   # LOD2: too far away for a wale


# --------------------------------------------------------------------------- parts
def v(mb, p):
    return mb.v(B(p))


def spar(mb, a, b, r0, r1, sw, seg, caps):
    mb.spar(B(a), B(b), r0, r1, sw, seg=seg, caps=caps)


def gbox(mb, c, size, sw):
    mb.box(B(c), (size[0], size[2], size[1]), sw)


def grid_sail(mb, at, bulge_dir, bulge, seg, sw):
    """Parametric sail surface; belly along `bulge_dir`, zero on the edges (gridSail in parts.ts)."""
    d = Vector(bulge_dir)
    idx = []
    for i in range(seg + 1):
        row = []
        for j in range(seg + 1):
            u, w = i / seg, j / seg
            p = Vector(at(u, w)) + d * (bulge * math.sin(math.pi * u) * math.sin(math.pi * w))
            row.append(v(mb, p))
        idx.append(row)
    for i in range(seg):
        for j in range(seg):
            mb.face((idx[i][j], idx[i + 1][j], idx[i + 1][j + 1], idx[i][j + 1]), sw)


def build_hull(mb, s, lod, cfg):
    st, sg = cfg['stations'], cfg['segs']
    rings = [[v(mb, section_point(s, i / st, j / sg)) for j in range(sg + 1)] for i in range(st + 1)]
    fs = []
    for i in range(st):
        for k in range(sg):
            fs.append(mb.face((rings[i][k], rings[i][k + 1], rings[i + 1][k + 1], rings[i + 1][k]), hull_swatch(lod, k, sg)))
    fs += [mb.face(rings[0], 'hull'), mb.face(rings[-1], 'hull')]
    mb.outward(fs)


def build_deck(mb, s, cfg):
    st = cfg['stations']
    rows = []
    for i in range(st + 1):
        t = i / st
        x, y, w = (t - 0.5) * s['length'], deck_height(s, t) - bulwark(s), half_beam(s, t) * 0.95
        rows.append((v(mb, (x, y, w)), v(mb, (x, y, -w))))   # (starboard, port)
    for i in range(st):
        (a0, b0), (a1, b1) = rows[i], rows[i + 1]
        mb.face((a0, a1, b1, b0), 'deck')


def build_rail(mb, s, cfg):
    st = cfg['stations']
    for sd in (1, -1):
        prev = None
        for i in range(st + 1):
            t = i / st
            x, y, z = section_point(s, t, 0 if sd < 0 else 1)
            inset = min(0.25, half_beam(s, t) * 0.8)
            cur = (v(mb, (x, y + 0.03, z)), v(mb, (x, y + 0.03, z - sd * inset)))
            if prev:
                f = mb.face((prev[0], cur[0], cur[1], prev[1]), 'trim')
                f.normal_update()
                if f.normal.z < 0:
                    f.normal_flip()
            prev = cur


def build_castles(mb, s, cfg):
    for key, end in (('sterncastle', 'stern'), ('forecastle', 'fore')):
        c = s.get(key)
        if not c:
            continue
        lift = 0.0
        for n in range(1 + c.get('stepped', 0)):
            length = c['length'] * (1 - 0.4 * n)
            height = c['height'] if n == 0 else c['height'] * 0.6
            t0, t1 = (0.0, length) if end == 'stern' else (1 - length, 1.0)
            cs = cfg['castle_stations']
            rings = []
            for i in range(cs + 1):
                t = t0 + (t1 - t0) * i / cs if cs else t0
                x = (t - 0.5) * s['length']
                bottom = deck_height(s, t) - bulwark(s) + lift
                w = half_beam(s, t) * 0.97
                rings.append([v(mb, (x, bottom, -w)), v(mb, (x, bottom + height, -w)),
                              v(mb, (x, bottom + height, w)), v(mb, (x, bottom, w))])
            if cs == 0:   # LOD2: a single box from the end ring pair
                t = (t0 + t1) / 2
                x0, x1 = (t0 - 0.5) * s['length'], (t1 - 0.5) * s['length']
                bottom = deck_height(s, t) - bulwark(s) + lift
                w = half_beam(s, t) * 0.97
                mb.box(B(((x0 + x1) / 2, bottom + height / 2, 0)), (abs(x1 - x0), 2 * w, height), 'hull')
            else:
                fs = []
                for i in range(cs):
                    fs += [mb.face((rings[i][0], rings[i][1], rings[i + 1][1], rings[i + 1][0]), 'hull'),
                           mb.face((rings[i][1], rings[i][2], rings[i + 1][2], rings[i + 1][1]), 'deck'),
                           mb.face((rings[i][2], rings[i][3], rings[i + 1][3], rings[i + 1][2]), 'hull'),
                           mb.face((rings[i][3], rings[i][0], rings[i + 1][0], rings[i + 1][3]), 'deck')]
                fs += [mb.face(rings[0], 'hull'), mb.face(rings[-1], 'hull')]
                mb.outward(fs)
            lift += height


# --------------------------------------------------------------------------- rig (rig.ts)
class Mast:
    """Mast-local -> ship space: rake about the base (about z), then translate to the base."""

    def __init__(self, s, m):
        self.s, self.m = s, m
        self.base = mast_base(s, m)
        self.rake = m.get('rake', 0.03)
        self.cr, self.sr = math.cos(self.rake), math.sin(self.rake)

    def w(self, p):
        x, y, z = p
        return (self.base[0] + x * self.cr - y * self.sr, self.base[1] + x * self.sr + y * self.cr, self.base[2] + z)


def shroud_layout(s, m):
    """Half beam at the mast, shroud count and spread, and the masthead point (mast-local) they meet at."""
    hw = half_beam(s, 1 - m['at']) * 0.92
    count = 3 if m['height'] >= 20 else 2
    spread = min(max(s['length'] * 0.03, 0.6), 2)
    return hw, count, spread, (0, m['height'] * (0.62 if m['rig'] == 'square' else 0.5), 0)


def build_mast_static(mb, mast, cfg, flag, flags=None):
    s, m = mast.s, mast.m
    r = 0.1 + 0.006 * m['height']
    spar(mb, mast.w((0, 0, 0)), mast.w((0, m['height'], 0)), r, r * 0.5, 'wood', cfg['seg'], cfg['caps'])
    if m['rig'] == 'square' and m['height'] >= 16 and cfg['top']:
        h = m['height']
        gbox(mb, mast.w((0, h * 0.46, 0)), (1.2 + 0.03 * h, 0.14, 1.0 + 0.025 * h), 'wood')
    if m['height'] >= 10 and cfg['shrouds']:
        hw, count, spread, head = shroud_layout(s, m)
        for side in (-1, 1):
            for k in range(count):
                dx = (k - (count - 1) / 2) * spread
                spar(mb, mast.w(head), mast.w((dx, bulwark(s), side * hw)), 0.03, 0.03, 'wood', 4, False)
    if flag and cfg['pennant'] and flags is not None:
        h = m['height']
        ln = max(1.2, h * 0.12)
        pts = [mast.w((0, h, 0)), mast.w((-ln, h - ln * 0.15, 0)), mast.w((0, h - ln * 0.35, 0))]
        flags.face([v(flags, p) for p in pts], 'flag')   # own mesh/material: the game tints it per nation


def square_sails(mb, mast, cfg):
    s, m = mast.s, mast.m
    tiers = m.get('tiers', 2)
    weights = [max(1.35 - 0.3 * k, 0.6) for k in range(tiers)]
    total = sum(weights)
    region = m['height'] * 0.81
    course = min(s['beam'] * 1.35, m['height'] * 0.55)
    y = m['height'] * 0.16
    for k, wt in enumerate(weights):
        h = region * wt / total
        yb, yt = y, y + h * 0.96
        y += h
        wb = course * 0.82 ** k
        wtop = wb * 0.82
        grid_sail(mb, lambda u, w, yb=yb, yt=yt, wb=wb, wtop=wtop: mast.w((0, yb + (yt - yb) * w, (u - 0.5) * (wb + (wtop - wb) * w))),
                  (1, 0, 0), wb * 0.1, cfg['sail_seg'], 'sail')
        spar(mb, mast.w((0, yt, -wtop * 0.54)), mast.w((0, yt, wtop * 0.54)), 0.08 + 0.004 * m['height'], 0.08 + 0.004 * m['height'],
             'wood', 4, False)


def gaff_sail(mb, mast, cfg, boom, low, high):
    m = mast.m
    yb, yt = m['height'] * low, m['height'] * high
    tack, clew = Vector((0, yb, 0)), Vector((-boom, yb, 0))
    throat, peak = Vector((0, yt, 0)), Vector((-boom * 0.6, yt + boom * 0.18, 0))
    grid_sail(mb, lambda u, w: mast.w(tuple(tack.lerp(clew, u).lerp(throat.lerp(peak, u), w))), (0, 0, 1), boom * 0.08, cfg['sail_seg'], 'sail')
    spar(mb, mast.w(tuple(tack)), mast.w(tuple(clew)), 0.1, 0.1, 'wood', 4, False)
    spar(mb, mast.w(tuple(throat)), mast.w(tuple(peak)), 0.08, 0.08, 'wood', 4, False)


def lug_sail(mb, mast, cfg, boom):
    m = mast.m
    yb, yt = m['height'] * 0.1, m['height'] * 0.62
    bf, ba = Vector((boom * 0.3, yb, 0)), Vector((-boom * 0.75, yb, 0))
    tf, ta = Vector((boom * 0.3, yt - m['height'] * 0.1, 0)), Vector((-boom * 0.6, yt + m['height'] * 0.1, 0))
    grid_sail(mb, lambda u, w: mast.w(tuple(bf.lerp(ba, u).lerp(tf.lerp(ta, u), w))), (0, 0, 1), boom * 0.08, cfg['sail_seg'], 'sail')
    spar(mb, mast.w(tuple(tf)), mast.w(tuple(ta)), 0.08, 0.08, 'wood', 4, False)


def lateen_sail(mb, mast, cfg, aft, fore):
    s, m = mast.s, mast.m
    L = s['length']
    tack = Vector((min(L * 0.18, fore), m['height'] * 0.2, 0))
    peak = Vector((-min(L * 0.15, aft), m['height'] * 0.97, 0))
    clew = Vector((-min(L * 0.36, aft), m['height'] * 0.2, 0))
    grid_sail(mb, lambda u, w: mast.w(tuple(tack + (peak - tack) * u + (clew - tack) * (w * (1 - u)))), (0, 0, 1), L * 0.03,
              cfg['sail_seg'], 'sail')
    spar(mb, mast.w(tuple(tack)), mast.w(tuple(peak)), 0.1, 0.1, 'wood', 4, False)


def build_sails(mast, cfg, atlas):
    """Return [(kind, MB)] with one MB per trim pivot ('square' and/or 'aft') of this mast."""
    s, m = mast.s, mast.m
    aft = (1 - m['at']) * s['length'] + 0.05 * s['length']
    fore = m['at'] * s['length'] + 0.05 * s['length']
    out = []
    if m['rig'] == 'square':
        mb = MB(atlas)
        square_sails(mb, mast, cfg)
        out.append(('square', mb))
        if m.get('spanker'):
            mb = MB(atlas)
            gaff_sail(mb, mast, cfg, min(s['length'] * 0.2, aft), 0.12, 0.5)
            out.append(('aft', mb))
        return out
    mb = MB(atlas)
    if m['rig'] == 'gaff':
        gaff_sail(mb, mast, cfg, min(s['length'] * 0.3, aft), 0.1, 0.62)
    elif m['rig'] == 'lug':
        lug_sail(mb, mast, cfg, min(s['length'] * 0.22, aft))
    else:
        lateen_sail(mb, mast, cfg, aft, fore)
    out.append(('aft', mb))
    return out


def build_bowsprit(mb, s, masts, cfg):
    if s['bowsprit'] <= 0:
        return
    bow = section_point(s, 1, 0)
    base = (bow[0] - s['length'] * 0.15, bow[1] - 0.2, 0)
    angle = 0.3
    tip = (bow[0] + s['bowsprit'] * math.cos(angle), bow[1] - 0.2 + s['bowsprit'] * math.sin(angle), 0)
    spar(mb, base, tip, 0.14, 0.14, 'wood', cfg['bowsprit_seg'], False)
    if not masts or s['jibs'] <= 0:
        return
    fm = masts[0]
    fb = fm.base
    head = (fb[0], fb[1] + fm.m['height'] * 0.9, 0)
    if cfg['stays']:
        spar(mb, tip, head, 0.04, 0.04, 'wood', 4, False)
    tipv, basev, headv = Vector(tip), Vector(base), Vector(head)
    for i in range(s['jibs']):
        k = 0.5 if s['jibs'] == 1 else i / (s['jibs'] - 1)
        tack = tipv.lerp(basev, 0.08 + 0.3 * k)
        top = tipv.lerp(headv, 0.4 + 0.5 * k)
        clew = Vector((fb[0] + 2.2, fb[1] + 1 + 0.6 * k, 0.04 * i))
        grid_sail(mb, lambda u, w, tack=tack, top=top, clew=clew: tuple(tack + (top - tack) * u + (clew - tack) * (w * (1 - u))),
                  (0, 0, 1), s['length'] * 0.012, cfg['jib_seg'], 'sail')


def build_stays(mb, s, masts, cfg):
    if not cfg['stays']:
        return
    for a, b in zip(masts, masts[1:]):
        spar(mb, (a.base[0], a.base[1] + a.m['height'] * 0.88, 0), (b.base[0], b.base[1] + b.m['height'] * 0.5, 0),
             0.03, 0.03, 'wood', 4, False)


# --------------------------------------------------------------------------- details (details.ts)
def build_ports(mb, s):
    total = s['stats']['cannons']
    if total <= 0:
        return
    rows = max(1, s['gunDecks'])
    per_row = max(1, round(total / 2 / rows))
    span = 0.5
    spacing = span * s['length'] / per_row
    size = min(0.55, spacing * 0.7, 0.9)
    gap = min(1.3, max(size * 1.3, (s['freeboard'] - 1) / rows))
    for r in range(rows):
        for n in range(per_row):
            t = 0.22 + span * ((n + 0.5) / per_row)
            p = side_point(s, t, 0.9 + r * gap)
            for side in (1, -1):
                gbox(mb, (p[0], p[1], side * (p[2] + 0.03)), (size, size * 0.8, 0.12), 'dark')
                # a short cannon muzzle poking out of the port
                out = side * (p[2] + 0.03)
                spar(mb, (p[0], p[1], out), (p[0], p[1], out + side * 0.45), size * 0.3, size * 0.26, 'iron', 5, True)


def build_oars(mb, s):
    if s['oars'] <= 0:
        return
    length = s['length'] * 0.18
    d0 = Vector((0.15, -0.55, 0.8)).normalized()
    for n in range(s['oars']):
        t = 0.28 + 0.5 * ((n + 0.5) / s['oars'])
        rx, _, _ = section_point(s, t, 1)
        ry = deck_height(s, t) - bulwark(s) / 2
        for side in (1, -1):
            d = Vector((d0.x, d0.y, d0.z * side))
            start = Vector((rx, ry, side * half_beam(s, t))) - d * (length * 0.25)
            spar(mb, tuple(start), tuple(start + d * length * 1.25), 0.05, 0.05, 'wood', 5, False)


def build_glass(mb, s):
    """Stern windows and lanterns (emissive); returns the first lantern position for the meta."""
    c = s.get('sterncastle')
    first = None
    if c:
        if c['height'] >= 1.2:
            count = min(5, max(2, round(s['beam'] / 2.4)))
            w = min(0.9, c['height'] * 0.25)
            hw = half_beam(s, 0)
            y = deck_height(s, 0) - bulwark(s) + c['height'] * 0.55
            for n in range(count):
                z = -hw * 0.65 + hw * 1.3 * n / (count - 1) if count > 1 else 0
                gbox(mb, (-s['length'] / 2 - 0.02, y, z), (0.12, w, w * 0.8), 'dark')
        tiers = 1 + c.get('stepped', 0)
        height = c['height'] * (1 + 0.6 * (tiers - 1))
        y = deck_height(s, 0) - bulwark(s) + height + 0.5
        size = max(0.3, s['length'] * 0.01)
        for side in (-1, 1):
            p = (-s['length'] / 2 + size, y, side * half_beam(s, 0) * 0.8)
            first = first or p
            gbox(mb, p, (size, size * 1.4, size), 'dark')
    else:
        # no sterncastle: one lantern on the post that shipdetails.build_lantern_pole raises
        size = max(0.3, s['length'] * 0.01)
        p = (-s['length'] / 2 + 0.3, deck_height(s, 0) - bulwark(s) + 1.5 + size * 0.85, 0.0)
        first = p
        gbox(mb, p, (size * 1.2, size * 1.4, size * 1.2), 'dark')
    return first
