"""Masts, tops, shrouds, ratlines, stays, bowsprit and jibs (static, in the body meshes), flags, plus the
sail groups (cloth + yards + boltropes) that live under the game's trim pivots (inside Blender, game space)."""
import math

from mathutils import Vector

from hullmath import bulwark, section_point
from pbrmesh import PM, srgb_lin
from pbrbody import rail_xz
from shipbuilder import shroud_layout

ROPE = srgb_lin(0x40322A)
SPAR = srgb_lin(0x6B4A2C)
TIMBER = srgb_lin(0x3A2616)
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
        if h >= 34:                                                                         # crow's nest on the topmast
            kit.wood.revolve(w((0, y2 + 0.35, 0)), ax, [(0.62, 0), (0.7, 0.55), (0.72, 0.95)], SPAR, seg=10, smooth=False)
            kit.atlas.revolve(w((0, y2 + 0.5, 0)), ax, [(0.65, 0), (0.65, 0.07)], seg=10, swatch='iron')
    fife_rail(kit, mast)
    shrouds(kit, mast, square)
    # backstays from the topmast head to the rail aft of the shrouds
    hw, count, spread, head = shroud_layout(s, m)
    for side in (-1, 1):
        for k in (0, 1):
            top = w((0, h * (0.82 if square else 0.55), 0))
            foot = w((-1.2 - 0.9 * k - (count) * spread * 0.5, bulwark(s), side * hw * 1.02))
            line(wood, top, foot, 0.022, sag=0.25, n=6, seg=3)


def shroud_feet(mast, side, count, spread):
    """Where the shrouds of one side end: on the channel, a wooden plank that sticks out of the hull below the rail."""
    s, m = mast.s, mast.m
    rail = abs(rail_xz(s, 1 - m['at'])[2])
    y = bulwark(s) - 0.4
    return [Vector(mast.w(((k - (count - 1) / 2) * spread, y, side * (rail + 0.4)))) for k in range(count)]


def channels(kit, mast, count, spread):
    """Channels and deadeyes where the shrouds meet the hull."""
    s = kit.s
    for side in (-1, 1):
        feet = shroud_feet(mast, side, count, spread)
        mid = sum(feet, Vector()) / len(feet)
        kit.wood.box(mid - Vector((0, 0.08, side * 0.12)), (spread * count + 0.9, 0.12, 0.75), TIMBER)
        for f in feet:
            kit.atlas.revolve(f - Vector((0, 0.06, 0)), (0, 1, 0), [(0.09, 0), (0.09, 0.07), (0.0, 0.07)], seg=6, swatch='wood')
            kit.atlas.tube([f - Vector((0, 0.05, 0)), f - Vector((0, 0.9, side * -0.35))], [0.012, 0.012], swatch='iron', seg=3, caps=False)


def fife_rail(kit, mast):
    """Belaying rail around the foot of a mast: a rail on four posts with pins."""
    m = mast.m
    r = 0.1 + 0.006 * m['height'] + 0.55
    y = 0.95
    loop = [mast.w((r * math.cos(a), y, r * math.sin(a))) for a in [i * math.tau / 12 for i in range(13)]]
    kit.wood.tube(loop, 0.035, SPAR, seg=4, caps=False, smooth=False)
    for i in range(0, 12, 3):
        a = i * math.tau / 12
        kit.wood.tube([mast.w((r * math.cos(a), 0.0, r * math.sin(a))), mast.w((r * math.cos(a), y, r * math.sin(a)))], 0.03, SPAR, seg=4)
    for i in range(12):
        a = (i + 0.5) * math.tau / 12
        p = mast.w((r * math.cos(a), y - 0.05, r * math.sin(a)))
        kit.atlas.box(p, (0.03, 0.2, 0.03), swatch='bone')


def shrouds(kit, mast, square):
    s, m, cfg = mast.s, mast.m, kit.cfg
    if m['height'] < 10 or not cfg['shrouds']:
        return
    h = m['height']
    hw, count, spread, head = shroud_layout(s, m)
    count = max(count, min(5, round(h / 9)))
    half = 0.6 + 0.014 * h
    top_y = 0.5 * h
    channels(kit, mast, count, spread)
    for side in (-1, 1):
        feet, tops = shroud_feet(mast, side, count, spread), []
        for k in range(count):
            f = (k - (count - 1) / 2) / max((count - 1) / 2, 1)
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
