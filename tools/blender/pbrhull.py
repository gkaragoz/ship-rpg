"""Hull, deck and swatch atlas of a PBR ship, painted with numpy (no bpy). See pbrlayout.atlas_layout for the regions.

The hull region is the unwrapped half hull (u = station, v = girth, rail at the top, keel at the bottom); both sides
share it. Everything is painted in hull coordinates (world x, arc length from the rail, height above the water), so
features such as the waterline, the copper plates and the gun ports land where the geometry puts them.
"""
import numpy as np

from hullmath import bulwark, deck_height, girth_at_drop, half_beam, section_point
from pbrlayout import PAD, SWATCHES, atlas_layout, gun_ports, has_copper, plank_width, wales
from pbrtex import fbm, mix, normal_map, orm, planks, rgb, smoothstep, vnoise


def srgb_to_lin(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def lin_to_srgb(c):
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(np.maximum(c, 1e-6), 1 / 2.4) - 0.055)


def darker(c, f):
    """Scale an sRGB colour in linear space (as the procedural ship's lower hull does)."""
    return lin_to_srgb(srgb_to_lin(c) * f)


def _grid(s, W, H):
    """Hull parameter grid of the half-hull region: x, y, z and the arc length from the rail, all (H, W)."""
    t = (np.arange(W) + 0.5) / W
    kp = 0.5 * (1 - (np.arange(H) + 0.5) / H)
    T, K = np.meshgrid(t, kp)
    x, y, z = section_point(s, T, K)
    seg = np.sqrt(np.diff(x, axis=0) ** 2 + np.diff(y, axis=0) ** 2 + np.diff(z, axis=0) ** 2)   # between rows j, j+1
    arc = np.zeros_like(x)
    arc[:-1] = np.cumsum(seg[::-1], axis=0)[::-1]            # metres from this row to the rail (top row = 0)
    arc[-1] = 0.0
    return T, K, x, y, z, arc


def hull_region(s, W, H, rng):
    L = s['length']
    T, K, x, y, z, arc = _grid(s, W, H)
    top = deck_height(s, T)
    drop = top - y
    pw = plank_width(s)
    tone, groove, row = planks(x, arc, pw, rng, mean_len=2.5 + 0.06 * L, seam=0.09)
    hull, trim = rgb(s['hullColor']), rgb(s['trimColor'])
    lower = darker(hull, 0.5)
    wet = np.clip(1 - np.abs(y - 0.0) / 0.5, 0, 1)

    streak = fbm(H, W, 3, W // 6, rng, 3)                   # vertical weathering streaks (long along the hull height)
    big = fbm(H, W, 4, 10, rng, 4)
    base = np.broadcast_to(hull, (H, W, 3)).copy()
    base = mix(base, lower, smoothstep(1.6, 0.3, y)[..., None])
    col = base * (0.93 + 0.14 * tone)[..., None] * (1 - 0.6 * groove)[..., None]
    height = -0.012 * groove                                       # metres: caulked seams
    ao = 1 - 0.55 * groove
    rough = np.full((H, W), 0.72, np.float32)
    metal = np.zeros((H, W), np.float32)

    # wales: raised cream/trim bands (geometry strips sit on them too)
    for dc, th in wales(s):
        m = smoothstep(th * 0.6, th * 0.5, np.abs(drop - dc))
        col = mix(col, trim * (0.9 + 0.15 * tone)[..., None], m[..., None])
        height += 0.02 * m
        ao *= 1 - 0.3 * smoothstep(th * 0.5, th * 1.4, drop - dc) * (drop > dc) * (1 - smoothstep(th * 1.4, th * 2.6, drop - dc))
    # gunwale cap
    cap = smoothstep(0.2, 0.12, drop)
    col = mix(col, trim * 0.9, cap[..., None])

    # gun ports: dark recess with a trim frame; lids are geometry
    ports = gun_ports(s)
    for p in ports:
        xc = (p['t'] - 0.5) * L
        kp = girth_at_drop(s, p['t'], p['drop'])
        pj = int(np.clip((1 - 2 * kp) * H, 0, H - 1))
        pi = int(np.clip(p['t'] * W, 0, W - 1))
        sc = float(arc[pj, pi])
        win_x = slice(max(pi - int(p['w'] / (L / W) * 1.2) - 3, 0), min(pi + int(p['w'] / (L / W) * 1.2) + 4, W))
        sub = (slice(max(pj - int(p['h'] / 0.012) - 6, 0), min(pj + int(p['h'] / 0.012) + 7, H)), win_x)
        dx = np.abs(x[sub] - xc)
        ds = np.abs(arc[sub] - sc)
        inner = (dx < p['w'] * 0.5) & (ds < p['h'] * 0.5)
        frame = (dx < p['w'] * 0.5 + 0.07) & (ds < p['h'] * 0.5 + 0.07) & ~inner
        col[sub][frame] = trim * 0.85
        col[sub][inner] = np.array([0.025, 0.02, 0.018], np.float32)
        height[sub] = np.where(inner, -0.06, np.where(frame, 0.012, height[sub]))
        ao[sub] = np.where(inner, 0.1, np.where(frame, 0.8, ao[sub]))
        # weeping streak below the port
        below = (dx < p['w'] * 0.4) & (arc[sub] > sc) & (arc[sub] < sc + 1.6 + 1.5 * streak[sub])
        col[sub] = np.where(below[..., None], col[sub] * 0.82, col[sub])

    # weathering: streaks and large-scale tone
    col *= (0.88 + 0.2 * big)[..., None]
    col *= (1 - 0.18 * smoothstep(0.55, 0.9, streak) * smoothstep(0.0, 1.5, drop) )[..., None]
    salt = smoothstep(0.62, 0.85, fbm(H, W, 6, 20, rng, 4)) * smoothstep(1.2, 0.2, y) * smoothstep(0.1, 1.2, y)
    col = mix(col, np.array([0.72, 0.70, 0.64], np.float32), 0.25 * salt[..., None])

    # waterline: weed and algae band, barnacles, then copper (or tar) below
    wl = 0.1 + 0.07 * (vnoise(H, W, 2, 40, rng) - 0.5)
    weed = smoothstep(0.25, -0.15, y - wl) * smoothstep(-0.9, -0.1, y - wl) * (0.55 + 0.45 * fbm(H, W, 10, 60, rng, 3))
    algae = np.array([0.18, 0.27, 0.12], np.float32)
    below = y < wl
    if has_copper(s):
        ca = 0.36
        r = np.floor(arc / ca)
        px = (x + 0.6 * (r % 2)) / 1.2
        c_i = np.floor(px)
        cfx = px - c_i
        cfy = arc / ca - r
        pl_tone = rng.random((512, 64), dtype=np.float32)[(r.astype(np.int64)) % 512, c_i.astype(np.int64) % 64]
        edge = np.minimum(np.minimum(cfx * 1.2, (1 - cfx) * 1.2), np.minimum(cfy * ca, (1 - cfy) * ca))
        seam = 1 - smoothstep(0.004, 0.02, edge)
        new = np.array([0.50, 0.31, 0.22], np.float32)
        old = np.array([0.24, 0.17, 0.13], np.float32)
        age = np.clip(0.3 + 0.35 * pl_tone + 0.5 * big - 0.4 * smoothstep(-2.5, 0, y), 0, 1)
        cu = mix(old, new, age[..., None])
        verd = 0.7 * smoothstep(0.6, 0.85, fbm(H, W, 8, 30, rng, 4) + 0.2 * smoothstep(-1.5, 0.2, y))
        cu = mix(cu, np.array([0.22, 0.5, 0.42], np.float32), 0.7 * verd[..., None])
        cu *= (1 - 0.35 * seam)[..., None]
        nails = ((np.abs(((px * 1.2 * 8) % 1) - 0.5) < 0.12) & (cfy < 0.1)).astype(np.float32)
        cu = mix(cu, np.array([0.9, 0.75, 0.55], np.float32), 0.5 * nails[..., None])
        col = np.where(below[..., None], cu, col)
        height = np.where(below, -0.01 * seam + 0.004 * pl_tone, height)
        rough = np.where(below, 0.5 + 0.3 * verd + 0.1 * seam, rough)
        metal = np.where(below, 0.8 * (1 - verd) * (1 - 0.7 * seam), metal)
        ao = np.where(below, 1 - 0.5 * seam, ao)
    else:
        tar = np.array([0.07, 0.055, 0.045], np.float32)
        col = np.where(below[..., None], tar * (0.8 + 0.4 * tone)[..., None], col)
    col = mix(col, algae, 0.85 * np.clip(weed, 0, 1)[..., None])
    barn = smoothstep(0.55, 0.75, fbm(H, W, H // 6, W // 6, rng, 3)) * smoothstep(-0.7, 0.0, y - wl) * smoothstep(0.35, 0.0, y - wl)
    col = mix(col, np.array([0.62, 0.6, 0.55], np.float32), 0.7 * barn[..., None])
    height += 0.006 * barn
    rough = np.where(wet > 0.2, rough * 0.8, rough)
    return col, height, orm(ao, rough, metal), (x[0, 1] - x[0, 0])


def deck_region(s, W, H, rng):
    L = s['length']
    hw = float(half_beam(s, 0.5)) * 0.95
    xm = ((np.arange(W) + 0.5) / W - 0.5) * L
    vm = ((np.arange(H) + 0.5) / H) * hw
    X, Z = np.meshgrid(xm, vm)
    pw = min(0.12 + 0.0014 * L, 0.2)
    tone, groove, row = planks(X, Z, pw, rng, mean_len=2.8 + 0.05 * L, seam=0.11)
    grain = fbm(H, W, H // 2, 4, rng, 4)
    big = fbm(H, W, 3, 12, rng, 4)
    base = np.array([0.70, 0.55, 0.36], np.float32)
    col = base * (0.82 + 0.3 * tone)[..., None] * (0.86 + 0.24 * grain)[..., None] * (0.88 + 0.22 * big)[..., None]
    bleach = smoothstep(0.55, 0.8, fbm(H, W, 5, 10, rng, 3))
    col = mix(col, np.array([0.80, 0.72, 0.58], np.float32), 0.35 * bleach[..., None])
    edge = smoothstep(0.80, 1.0, Z / hw)                          # waterway and bulwark foot: dark and dirty
    col *= (1 - 0.45 * edge)[..., None]
    col = mix(col, np.array([0.05, 0.04, 0.03], np.float32), 0.85 * groove[..., None])
    nails = ((np.abs(((X / 0.35) % 1) - 0.5) < 0.04) & (groove > 0.0)).astype(np.float32)
    height = -0.01 * groove + 0.004 * grain
    ao = 1 - 0.6 * groove - 0.25 * edge
    rough = 0.82 + 0.12 * grain - 0.1 * bleach
    return col, height, orm(ao, rough, np.zeros_like(rough)), (L / W)


def swatch_block(s, A):
    """4x4 flat colour cells (A/16 px each): albedo, ORM."""
    n = A // 4
    cell = n // 4
    alb = np.zeros((n, n, 3), np.float32)
    o = np.zeros((n, n, 3), np.float32)
    for k, (name, hexc, r, m) in enumerate(SWATCHES):
        c = rgb(s['hullColor'] if name == 'hull' else s['trimColor'] if name == 'trim' else hexc)
        cx, cy = k % 4, k // 4
        alb[cy * cell:(cy + 1) * cell, cx * cell:(cx + 1) * cell] = c
        o[cy * cell:(cy + 1) * cell, cx * cell:(cx + 1) * cell] = (1.0, r, m)
    return alb, o


def build_atlas(s, A, seed):
    """Whole atlas for ship spec `s`: dict(albedo, normal, orm), float32 (A, A, 3), row 0 = bottom."""
    rng = np.random.default_rng(seed)
    lay = atlas_layout(A)
    alb = np.full((A, A, 3), 0.5, np.float32)
    nrm = np.zeros((A, A, 3), np.float32)
    nrm[...] = (0.5, 0.5, 1.0)
    o = np.zeros((A, A, 3), np.float32)
    o[...] = (1.0, 0.8, 0.0)
    for name, painter in (('hull', hull_region), ('deck', deck_region)):
        x0, y0, x1, y1 = lay[name]
        col, height, orm_, px = painter(s, x1 - x0, y1 - y0, rng)
        pxv = 0.012 if name == 'hull' else 0.012
        nm = normal_map(height, 1.0 / max(px, 1e-3), 1.0 / pxv)
        alb[y0:y1, x0:x1] = np.clip(col, 0, 1)
        nrm[y0:y1, x0:x1] = nm
        o[y0:y1, x0:x1] = orm_
    x0, y0, x1, y1 = lay['swatch']
    sa, so = swatch_block(s, A)
    alb[y0:y1, x0:x1] = sa
    o[y0:y1, x0:x1] = so
    for name in ('hull', 'deck'):                     # replicate region borders into the padding so mips do not bleed
        x0, y0, x1, y1 = lay[name]
        for arr in (alb, nrm, o):
            arr[y0 - PAD:y0] = arr[y0:y0 + 1]
            if y1 < A:
                arr[y1:y1 + PAD] = arr[y1 - 1:y1]
    return dict(albedo=alb, normal=nrm, orm=o)
