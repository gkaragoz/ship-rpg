"""Masts, tops, shrouds, ratlines, stays, bowsprit and jibs (static, in the body meshes), flags, plus the
sail groups (cloth + yards + boltropes) that live under the game's trim pivots (inside Blender, game space)."""
import math

from mathutils import Vector

from hullmath import bulwark, section_point
from pbrmesh import PM, srgb_lin
from shipbuilder import shroud_layout

ROPE = srgb_lin(0x40322A)
SPAR = srgb_lin(0x6B4A2C)
IRON = srgb_lin(0x3A3A40)
CANVAS = (1.0, 0.97, 0.9)


def hn(a, b=0.0, c=0.0):
    """Deterministic pseudo-random 0..1 from numbers (no RNG state to keep in step)."""
    v = math.sin(a * 127.1 + b * 311.7 + c * 74.7) * 43758.5453
    return v - math.floor(v)


def line(pm, a, b, r, sag=0.0, n=6, tint=ROPE, seg=3):
    """Rope between two game points; `sag` is the mid-span drop in metres (a catenary-ish parabola)."""
    a, b = Vector(a), Vector(b)
    pts = [a.lerp(b, i / n) - Vector((0, sag * 4 * (i / n) * (1 - i / n), 0)) for i in range(n + 1)]
    pm.tube(pts, [r] * len(pts), tint, seg=seg, caps=False, smooth=False)


def flag_cloth(pm, origin, back, width, wave, n=6, taper=0.0):
    """Cloth hanging from `origin`, streaming along `back` (game vector), `width` metres tall, waving in z; double sided."""
    o, bk = Vector(origin), Vector(back)
    rows = []
    for i in range(n + 1):
        u = i / n
        z = wave * math.sin(u * 6.0) * u
        rows.append([o + bk * u + Vector((0, -width * v * (1 - taper * u), z + 0.05 * wave * v)) for v in (0.0, 1.0)])
    pm.grid(rows, None, smooth=False, swatch='white')


def mast_static(kit, mast, tallest):
    s, m, cfg = mast.s, mast.m, kit.cfg
    h = m['height']
    r = 0.1 + 0.006 * h
    w = mast.w
    seg = cfg['seg']
    square = m['rig'] == 'square' and h >= 16
    wood = kit.wood
    if square:
        wood.tube([w((0, y * h, 0)) for y in (0.0, 0.25, 0.5)], [r, r * 0.9, r * 0.78], SPAR, seg=seg)
        wood.tube([w((0, y * h, 0)) for y in (0.46, 0.64, 0.82)], [r * 0.62, r * 0.54, r * 0.45], SPAR, seg=seg)
        wood.tube([w((0, y * h, 0)) for y in (0.8, 0.9, 1.0)], [r * 0.4, r * 0.3, r * 0.16], SPAR, seg=max(seg - 2, 3))
    else:
        wood.tube([w((0, y * h, 0)) for y in (0.0, 0.5, 1.0)], [r, r * 0.75, r * 0.45], SPAR, seg=seg)
    if not cfg['detail']:
        return
    ax = Vector(w((0, 1, 0))) - Vector(w((0, 0, 0)))
    for f in (0.08, 0.2, 0.32, 0.44) if square else (0.15, 0.4):
        rr = r * (1 - 0.22 * f / 0.5) + 0.025
        kit.atlas.revolve(w((0, f * h - 0.07, 0)), ax, [(rr, 0), (rr, 0.14)], seg=8, swatch='iron', smooth=True)
    kit.atlas.revolve(w((0, 0, 0)), ax, [(r + 0.12, 0), (r + 0.12, 0.35), (r + 0.04, 0.4)], seg=8, swatch='wood')   # partners
    if square and cfg['top']:
        half = 0.6 + 0.014 * h
        y = 0.5 * h
        wood.box(w((0, y + 0.03, 0)), (2 * half * 0.9, 0.1, 2 * half), SPAR)
        for z in (-0.8, 0.8):
            wood.box(w((0, y - 0.1, z * half)), (2 * half, 0.13, 0.13), SPAR)
        wood.box(w((0, y - 0.1, 0)), (0.5, 0.2, 2 * half), SPAR)
        wood.box(w((0, y + 0.22, 0)), (r * 2.2, 0.4, r * 2.2), IRON)                    # mast cap
        loop = [(half * 0.9, -half), (-half * 0.9, -half), (-half * 0.9, half), (half * 0.9, half)]
        wood.tube([w((px, y + 0.5, pz)) for px, pz in loop], 0.022, ROPE, seg=3, caps=False, smooth=False)
        for px, pz in loop[1:3] + [(0, -half), (0, half)]:
            wood.tube([w((px, y + 0.04, pz)), w((px, y + 0.5, pz))], 0.02, SPAR, seg=3, caps=False, smooth=False)
        y2 = 0.8 * h
        for z in (-0.6, 0.6):
            wood.box(w((0, y2, z * half * 0.55)), (half * 1.1, 0.09, 0.09), SPAR)
        wood.box(w((0, y2 + 0.1, 0)), (r, 0.24, r), IRON)
    shrouds(kit, mast, square)
    # backstays from the topmast head to the rail aft of the shrouds
    hw, count, spread, head = shroud_layout(s, m)
    for side in (-1, 1):
        for k in (0, 1):
            top = w((0, h * (0.82 if square else 0.55), 0))
            foot = w((-1.2 - 0.9 * k - (count) * spread * 0.5, bulwark(s), side * hw * 1.02))
            line(wood, top, foot, 0.022, sag=0.25, n=6, seg=3)


def shrouds(kit, mast, square):
    s, m, cfg = mast.s, mast.m, kit.cfg
    if m['height'] < 10 or not cfg['shrouds']:
        return
    h = m['height']
    hw, count, spread, head = shroud_layout(s, m)
    count = max(count, min(5, round(h / 9)))
    half = 0.6 + 0.014 * h
    top_y = 0.5 * h
    for side in (-1, 1):
        feet, tops = [], []
        for k in range(count):
            f = (k - (count - 1) / 2) / max((count - 1) / 2, 1)
            feet.append(Vector(mast.w((f * spread * (count - 1) / 2, bulwark(s), side * hw))))
            tops.append(Vector(mast.w((f * (half * 0.8 if square else 0.05), top_y, side * (half * 0.85 if square else 0.05)))))
        for k in range(count):
            kit.wood.tube([feet[k], tops[k]], 0.026, ROPE, seg=4, caps=False, smooth=False)
        if not cfg['ratlines']:
            continue
        length = (tops[0] - feet[0]).length
        n = int((length - 1.6) / 0.5)
        for i in range(n):
            f = (1.2 + 0.5 * i) / length
            for k in range(count - 1):
                a, b = feet[k].lerp(tops[k], f), feet[k + 1].lerp(tops[k + 1], f)
                kit.wood.tube([a, b], 0.011, ROPE, seg=3, caps=False, smooth=False)


def stays(kit, masts):
    if not kit.cfg['stays']:
        return
    for a, b in zip(masts, masts[1:]):
        pa, pb = a.w((0, a.m['height'] * 0.88, 0)), b.w((0, b.m['height'] * 0.5, 0))
        line(kit.wood, pa, pb, 0.03, sag=0.5, n=8)
        line(kit.wood, a.w((0, a.m['height'] * 0.55, 0)), b.w((0, b.m['height'] * 0.18, 0)), 0.025, sag=0.4, n=8)


def bowsprit(kit, masts):
    s, cfg = kit.s, kit.cfg
    if s['bowsprit'] <= 0:
        return None
    bow = section_point(s, 1, 0.0)
    base = Vector((bow[0] - s['length'] * 0.15, bow[1] - 0.2, 0))
    ang = 0.3
    tip = Vector((bow[0] + s['bowsprit'] * math.cos(ang), bow[1] - 0.2 + s['bowsprit'] * math.sin(ang), 0))
    r0 = 0.12 + 0.004 * s['length']
    kit.wood.tube([base, base.lerp(tip, 0.5), tip], [r0, r0 * 0.8, r0 * 0.55], SPAR, seg=cfg['seg'])
    if cfg['detail']:
        kit.wood.box(tip, (0.28, 0.2, 0.28), IRON)
        line(kit.wood, tip, Vector((bow[0] - 0.4, bow[1] - 1.6, 0)), 0.03, sag=0.2, n=6)      # bobstay
    if not masts or s['jibs'] <= 0:
        return tip
    fb = masts[0].base
    head = Vector((fb[0], fb[1] + masts[0].m['height'] * 0.9, 0))
    if cfg['stays']:
        line(kit.wood, tip, head, 0.03, sag=0.35, n=8)
    n = cfg['jib_seg']
    for i in range(s['jibs']):
        k = 0.5 if s['jibs'] == 1 else i / (s['jibs'] - 1)
        tack = tip.lerp(base, 0.08 + 0.3 * k)
        top = tip.lerp(head, 0.4 + 0.5 * k)
        clew = Vector((fb[0] + 2.2, fb[1] + 1 + 0.6 * k, 0.04 * i))
        P, UV, C = [], [], []
        for a in range(n + 1):
            row, uvr, cr = [], [], []
            for b in range(n + 1):
                u, w = a / n, b / n
                p = tack + (top - tack) * u + (clew - tack) * (w * (1 - u))
                p = p + Vector((0, 0, s['length'] * 0.012 * math.sin(math.pi * u) * math.sin(math.pi * min(w, 1)) * (1 - 0.3 * u)))
                row.append(p)
                uvr.append((p.x / 1.1 + i * 0.37, p.y / 1.1))
                cr.append(sail_color(u, 1 - w * (1 - u), hn(i, a, b)))
            P.append(row)
            UV.append(uvr)
            C.append(cr)
        kit.jib.grid(P, UV, cols=C, smooth=True)
    return tip


def sail_color(u, v, noise, patch=1.0):
    """Linear vertex colour for a point of a sail: dirty foot, darker leeches, reef bands, mildew patches."""
    g = 0.78 + 0.22 * min(v / 0.3, 1.0)
    g *= 1 - 0.12 * max(0.0, abs(u - 0.5) - 0.38) / 0.12
    for rb in (0.38, 0.7):
        g *= 1 - 0.07 * max(0.0, 1 - abs(v - rb) / 0.025)
    g *= 0.94 + 0.1 * noise
    g *= 1 - 0.12 * max(0.0, noise - 0.82) / 0.18 * patch
    return (g * CANVAS[0], g * CANVAS[1], g * CANVAS[2])


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
