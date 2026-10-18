"""Procedural PBR texture synthesis (numpy only, no bpy): noise, plank patterns, the tiling wood and sail
materials. The ship-specific hull/deck atlas is in pbrhull.py.

Arrays are float32, shape (h, w, 3) unless noted, **row 0 = bottom** (the order Blender's image.pixels uses, so
array y == UV v). Albedo is painted directly in sRGB values; normal maps use the glTF/OpenGL convention
(+X right, +Y up in UV space); `orm` packs occlusion (R), roughness (G), metalness (B) like glTF.
"""
import struct
import zlib

import numpy as np


# --------------------------------------------------------------------------- noise
def vnoise(h, w, cy, cx, rng, tile=False):
    """Smooth value noise in 0..1 with cy x cx cells over an h x w image (tileable when `tile`)."""
    g = rng.random((cy + 1, cx + 1), dtype=np.float32)
    if tile:
        g[-1] = g[0]
        g[:, -1] = g[:, 0]
    y = np.arange(h, dtype=np.float32) * (cy / h)
    x = np.arange(w, dtype=np.float32) * (cx / w)
    y0, x0 = y.astype(np.int32), x.astype(np.int32)
    fy, fx = y - y0, x - x0
    fy = (fy * fy * (3 - 2 * fy))[:, None]
    fx = (fx * fx * (3 - 2 * fx))[None, :]
    y1, x1 = np.minimum(y0 + 1, cy), np.minimum(x0 + 1, cx)
    gy0, gy1 = g[y0], g[y1]
    top = gy0[:, x0] * (1 - fx) + gy0[:, x1] * fx
    bot = gy1[:, x0] * (1 - fx) + gy1[:, x1] * fx
    return top * (1 - fy) + bot * fy


def fbm(h, w, cy, cx, rng, octaves=4, tile=False):
    """Fractal noise in 0..1; `cy`/`cx` are the cell counts of the first octave."""
    out = np.zeros((h, w), np.float32)
    amp, tot = 1.0, 0.0
    for _ in range(octaves):
        out += amp * vnoise(h, w, cy, cx, rng, tile)
        tot += amp
        amp *= 0.5
        cy, cx = cy * 2, cx * 2
    return out / tot


def smoothstep(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


def mix(a, b, t):
    return a + (b - a) * t


def rgb(hexcolor):
    return np.array([(hexcolor >> 16) & 255, (hexcolor >> 8) & 255, hexcolor & 255], np.float32) / 255.0


def normal_map(height, gx, gy=None, wrap=False):
    """RGB normal map (OpenGL) from a height field. `gx`/`gy` scale the slopes along u / v."""
    gy = gx if gy is None else gy
    if wrap:
        dx = (np.roll(height, -1, 1) - np.roll(height, 1, 1)) * 0.5
        dy = (np.roll(height, -1, 0) - np.roll(height, 1, 0)) * 0.5
    else:
        p = np.pad(height, 1, mode='edge')
        dx = (p[1:-1, 2:] - p[1:-1, :-2]) * 0.5
        dy = (p[2:, 1:-1] - p[:-2, 1:-1]) * 0.5
    n = np.stack([-dx * gx, -dy * gy, np.ones_like(height)], -1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return (n * 0.5 + 0.5).astype(np.float32)


def orm(ao, rough, metal):
    return np.stack([ao, rough, metal], -1).astype(np.float32)


# --------------------------------------------------------------------------- planks
def planks(xm, sm, plank_w, rng, mean_len=4.2, rows=4096, seam=0.07):
    """Plank pattern over coordinates in metres: `xm` along the planks, `sm` across them (same shape).

    Returns tone (0..1 per plank), groove (0..1, 1 on the caulked seams and butt joints) and the plank row index.
    """
    f = sm / plank_w
    row = np.floor(f).astype(np.int64)
    frac = f - row
    r = row % rows
    lens = (mean_len * (0.6 + 0.8 * rng.random(rows))).astype(np.float32)
    offs = (rng.random(rows) * 50).astype(np.float32)
    tones = rng.random((rows, 64), dtype=np.float32)
    px = (xm + offs[r]) / lens[r]
    col = np.floor(px).astype(np.int64)
    cf = px - col
    tone = tones[r, col % 64]
    edge = np.minimum(frac, 1 - frac)
    groove = 1 - smoothstep(seam * 0.4, seam, edge)
    jd = np.minimum(cf, 1 - cf) * lens[r]            # metres to the nearest butt joint
    groove = np.maximum(groove, 1 - smoothstep(0.012, 0.03, jd))
    return tone, groove, row


# --------------------------------------------------------------------------- tiling materials
WOOD_ROWS = 8
SPAR_ROW = 2          # plank row without seams; spars sample it for plain grain


def wood_tile(res=512, seed=3):
    """Neutral planked wood, 2 m x 2 m, rows of 0.25 m planks; the vertex colour tints it per part."""
    rng = np.random.default_rng(seed)
    h = w = res
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    xm, sm = xs / w * 2.0, ys / h * 2.0
    f = sm / 0.25
    row = np.floor(f).astype(np.int64) % WOOD_ROWS
    frac = f - np.floor(f)
    joint = rng.random(WOOD_ROWS) * 2.0
    d = np.abs(((xm - joint[row] + 1.0) % 2.0) - 1.0)           # metres to this row's butt joint (period 2 m)
    edge = np.minimum(frac, 1 - frac)
    seam = np.maximum(1 - smoothstep(0.012, 0.045, edge), 1 - smoothstep(0.004, 0.018, d))
    seam[row == SPAR_ROW] = 0.0
    tone = (0.78 + 0.22 * rng.random(WOOD_ROWS, dtype=np.float32))[row]
    grain = fbm(h, w, h // 3, 3, rng, 4, True)
    fine = fbm(h, w, h // 2, 6, rng, 3, True)
    lum = tone * (0.78 + 0.35 * grain) * (0.92 + 0.12 * fine) * (1 - 0.65 * seam)
    albedo = np.clip(lum, 0, 1)[..., None] * np.array([1.0, 0.97, 0.92], np.float32)
    height = 0.45 * grain + 0.25 * fine - 0.9 * seam
    return dict(albedo=albedo.astype(np.float32), normal=normal_map(height, 7.0, 7.0, wrap=True),
                orm=orm(1 - 0.7 * seam, 0.72 + 0.2 * fine, np.zeros_like(seam)))


SAIL_TILE_M = 1.1     # metres covered by one repeat of the sail texture (two cloths of 0.55 m)


def sail_tile(res=512, seed=5):
    """Sailcloth, 1.1 m x 1.1 m with two vertical cloths of 0.55 m (a stitched seam each); neutral cream-white."""
    rng = np.random.default_rng(seed)
    h = w = res
    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    um = xs / w * SAIL_TILE_M
    cloth = np.floor(um / 0.55)
    cu = um / 0.55 - cloth
    tone = (0.94 + 0.06 * rng.random(2, dtype=np.float32))[cloth.astype(np.int64)]
    warp = 0.5 + 0.5 * np.sin(xs * (2 * np.pi / 4.0) + 1.3 * vnoise(h, w, 8, 8, rng, True))
    weft = 0.5 + 0.5 * np.sin(ys * (2 * np.pi / 4.0) + 1.1 * vnoise(h, w, 8, 8, rng, True))
    weave = 0.55 * warp + 0.45 * weft
    seam_d = np.minimum(cu, 1 - cu) * 0.55
    seam = 1 - smoothstep(0.004, 0.02, seam_d)
    stitch = seam * (0.6 + 0.4 * (np.floor(ys / 4.0) % 2))
    mott = fbm(h, w, 6, 6, rng, 4, True)
    lum = tone * (0.86 + 0.1 * weave) * (0.9 + 0.2 * mott) * (1 - 0.18 * stitch)
    albedo = np.clip(lum, 0, 1)[..., None] * np.array([1.0, 0.96, 0.86], np.float32)
    height = 0.35 * weave + 0.4 * seam + 0.15 * mott
    return dict(albedo=albedo.astype(np.float32), normal=normal_map(height, 3.2, 3.2, wrap=True),
                orm=orm(1 - 0.35 * seam - 0.12 * (1 - weave), np.full_like(weave, 0.93), np.zeros_like(weave)))


# --------------------------------------------------------------------------- preview (debug aid)
def write_png(path, arr):
    """Write a float (0..1) or uint8 array, row 0 = bottom, as an RGB PNG (preview only)."""
    a = arr if arr.dtype == np.uint8 else (np.clip(arr, 0, 1) * 255 + 0.5).astype(np.uint8)
    a = a[::-1]
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, -1)
    h, w, c = a.shape
    raw = b''.join(b'\x00' + a[y].tobytes() for y in range(h))

    def chunk(tag, data):
        return struct.pack('>I', len(data)) + tag + data + struct.pack('>I', zlib.crc32(tag + data) & 0xFFFFFFFF)

    png = b'\x89PNG\r\n\x1a\n' + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 2 if c == 3 else 6, 0, 0, 0)) \
        + chunk(b'IDAT', zlib.compress(raw, 6)) + chunk(b'IEND', b'')
    with open(path, 'wb') as f:
        f.write(png)
