"""Sail cloth, yards and boltropes of a PBR ship: the groups that live under the game's trim pivots (inside Blender, game space).

`sail_groups` returns, per mast, a sail mesh (sail material) and a spar mesh (wood material) that the caller shifts to the
pivot at the mast base. Cloth UVs are metres / tile size so every sail has the same weave scale.
"""
import math

from mathutils import Vector

from pbrmesh import PM
from pbrrig import IRON, ROPE, SPAR, hn, line, sail_color


def sail_grid(sail, corners, nx, ny, belly, seed, uv_plane, detail, bulge_dir, tatter=0.08):
    """Sail surface from a corner function `corners(u, w) -> Vector` plus belly; returns grid rows for `sail.grid`."""
    P, UV, C = [], [], []
    for i in range(nx + 1):
        row, uvr, cr = [], [], []
        for j in range(ny + 1):
            u, w = i / nx, j / ny
            p = corners(u, w) + bulge_dir * (belly * math.sin(math.pi * u) * math.sin(math.pi * w))
            if detail and w < 0.2:
                p = p + Vector((0, tatter * (hn(seed, i) - 0.5) * (1 - w / 0.2) ** 2 + 0.0, 0))
            row.append(p)
            uvr.append((p.z / 1.1, p.y / 1.1) if uv_plane == 'zy' else (p.x / 1.1, p.y / 1.1))
            cr.append(sail_color(u, w, hn(seed, i, j)))
        P.append(row)
        UV.append(uvr)
        C.append(cr)
    sail.grid(P, UV, cols=C, smooth=True)
    return P


def boltrope(spars, P, edges, r=0.022):
    for e in edges:
        pts = e(P)
        spars.tube(pts, [r] * len(pts), ROPE, seg=3, caps=False, smooth=False)


def sail_groups(kit, mast):
    """[(kind, sail PM, spar PM)] for this mast, game space (the caller shifts them to the pivot)."""
    s, m, cfg = mast.s, mast.m, kit.cfg
    h = m['height']
    nx, ny = cfg['sail_nx'], cfg['sail_ny']
    out = []
    detail = cfg['detail']
    w = mast.w

    def new():
        return PM('sail', kit.A), PM('wood', kit.A)

    if m['rig'] == 'square':
        sail, spar = new()
        tiers = m.get('tiers', 2)
        weights = [max(1.35 - 0.3 * k, 0.6) for k in range(tiers)]
        total = sum(weights)
        region = h * 0.81
        course = min(s['beam'] * 1.35, h * 0.55)
        y = h * 0.16
        yr = 0.07 + 0.0045 * h
        for k, wt in enumerate(weights):
            hh = region * wt / total
            yb, yt = y, y + hh * 0.96
            y += hh
            wb = course * 0.82 ** k
            wtop = wb * 0.82

            def corner(u, ww, yb=yb, yt=yt, wb=wb, wtop=wtop):
                width = (wb + (wtop - wb) * ww) * (1 - 0.035 * math.sin(math.pi * ww))
                yy = yb + (yt - yb) * ww + 0.05 * (yt - yb) * math.sin(math.pi * u) * (1 - ww) ** 2
                return Vector(w((0, yy, (u - 0.5) * width)))
            bulge = Vector(w((1, 0, 0))) - Vector(w((0, 0, 0)))
            P = sail_grid(sail, corner, nx, ny, wb * 0.1, k * 7 + len(out) * 3 + int(h), 'zy', detail, bulge)
            half = wtop * 0.54
            spar.tube([w((0, yt + 0.02, -half * 1.04)), w((0, yt + 0.02, 0)), w((0, yt + 0.02, half * 1.04))], [yr * 0.5, yr, yr * 0.5],
                      SPAR, seg=cfg['seg'])
            if detail:
                for sd in (-1, 1):
                    spar.box(w((0, yt + 0.02, sd * half * 1.05)), (0.16, 0.2, 0.12), IRON)
                    line(spar, w((0, yt, sd * half * 0.85)), w((0, yt + hh * 0.5 + 0.8, sd * 0.2)), 0.014, sag=0.15, n=4)
                line(spar, w((0, yt - 0.35, -half)), w((0, yt - 0.35, half)), 0.016, sag=0.12, n=8)          # footrope
                boltrope(spar, P, (lambda P: [P[0][j] for j in range(len(P[0]))], lambda P: [P[-1][j] for j in range(len(P[0]))],
                                   lambda P: [P[i][0] for i in range(len(P))]))
        out.append(('square', sail, spar))
        if m.get('spanker'):
            out.append(('aft',) + gaff(kit, mast, min(s['length'] * 0.2, (1 - m['at']) * s['length'] + 0.05 * s['length']), 0.12, 0.5))
        return out
    if m['rig'] == 'gaff':
        out.append(('aft',) + gaff(kit, mast, min(s['length'] * 0.3, (1 - m['at']) * s['length'] + 0.05 * s['length']), 0.1, 0.62))
    elif m['rig'] == 'lug':
        out.append(('aft',) + lug(kit, mast, min(s['length'] * 0.22, (1 - m['at']) * s['length'] + 0.05 * s['length'])))
    else:
        out.append(('aft',) + lateen(kit, mast))
    return out


def _fore_aft(kit, mast, corner, belly, seed, spars_pts):
    sail, spar = PM('sail', kit.A), PM('wood', kit.A)
    P = sail_grid(sail, corner, kit.cfg['sail_nx'], kit.cfg['sail_ny'], belly, seed, 'xy', kit.cfg['detail'], Vector((0, 0, 1)))
    for a, b, r in spars_pts:
        spar.tube([a, a.lerp(b, 0.5), b], [r * 0.8, r, r * 0.6], SPAR, seg=kit.cfg['seg'])
    if kit.cfg['detail']:
        boltrope(spar, P, (lambda P: [P[0][j] for j in range(len(P[0]))], lambda P: [P[-1][j] for j in range(len(P[0]))],
                           lambda P: [P[i][0] for i in range(len(P))]))
    return sail, spar


def gaff(kit, mast, boom, low, high):
    m = mast.m
    h = m['height']
    yb, yt = h * low, h * high
    w = mast.w
    tack, clew = Vector(w((0, yb, 0))), Vector(w((-boom, yb, 0)))
    throat, peak = Vector(w((0, yt, 0))), Vector(w((-boom * 0.6, yt + boom * 0.18, 0)))
    return _fore_aft(kit, mast, lambda u, ww: tack.lerp(clew, u).lerp(throat.lerp(peak, u), ww), boom * 0.08, int(h) + 5,
                     [(tack, clew, 0.1), (throat, peak, 0.08)])


def lug(kit, mast, boom):
    h = mast.m['height']
    w = mast.w
    yb, yt = h * 0.1, h * 0.62
    bf, ba = Vector(w((boom * 0.3, yb, 0))), Vector(w((-boom * 0.75, yb, 0)))
    tf, ta = Vector(w((boom * 0.3, yt - h * 0.1, 0))), Vector(w((-boom * 0.6, yt + h * 0.1, 0)))
    return _fore_aft(kit, mast, lambda u, ww: bf.lerp(ba, u).lerp(tf.lerp(ta, u), ww), boom * 0.08, int(h) + 9, [(tf, ta, 0.08)])


def lateen(kit, mast):
    s, m = mast.s, mast.m
    L, h = s['length'], m['height']
    aft = (1 - m['at']) * L + 0.05 * L
    fore = m['at'] * L + 0.05 * L
    w = mast.w
    tack = Vector(w((min(L * 0.18, fore), h * 0.2, 0)))
    peak = Vector(w((-min(L * 0.15, aft), h * 0.97, 0)))
    clew = Vector(w((-min(L * 0.36, aft), h * 0.2, 0)))
    return _fore_aft(kit, mast, lambda u, ww: tack + (peak - tack) * u + (clew - tack) * (ww * (1 - u)), L * 0.03, int(h) + 13,
                     [(tack, peak, 0.1)])
