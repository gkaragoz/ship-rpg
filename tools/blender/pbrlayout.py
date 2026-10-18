"""Where things are on a PBR ship: the texture atlas layout and the hull features (wales, gun ports, copper).

Pure Python/numpy (no bpy) so the textures (pbrhull.py) and the geometry (pbrship*.py) read one source of truth.
Game ship space: +x bow, +y up, +z starboard; hull features are positioned by station t (0 stern .. 1 bow)
and `drop`, the metres below the rail line.
"""
from hullmath import bulwark, deck_height, half_beam

PAD = 8    # texels between atlas regions, filled by edge replication (mip bleeding)

# Colour swatches: name -> (sRGB hex or None for a spec colour, roughness, metalness). 4x4 cells in the atlas corner.
SWATCHES = [
    ('wood', 0x4A3321, 0.80, 0.0), ('dark', 0x140E08, 0.90, 0.0), ('iron', 0x3A3A40, 0.50, 0.75),
    ('brass', 0xB08D3A, 0.35, 0.80), ('rope', 0x9C8559, 0.95, 0.0), ('trim', None, 0.70, 0.0),
    ('hull', None, 0.70, 0.0), ('copper', 0xB5683F, 0.45, 0.80), ('gilt', 0xD4AF37, 0.35, 0.60),
    ('canvas', 0xD9CDB0, 0.95, 0.0), ('tar', 0x1B1612, 0.60, 0.0), ('red', 0x7A2E22, 0.80, 0.0),
    ('white', 0xEEE8D8, 0.80, 0.0), ('bone', 0xC9B79A, 0.85, 0.0), ('leaf', 0x3F5A3A, 0.80, 0.0),
    ('deck', 0xB08A58, 0.85, 0.0),
]
SWATCH_NAMES = [s[0] for s in SWATCHES]


def atlas_layout(A):
    """Pixel rectangles (x0, y0, x1, y1; y from the bottom) of the atlas regions for an A x A atlas."""
    return dict(
        hull=(0, A // 2 + PAD, A, A),                     # port and starboard share it (mirrored UV)
        deck=(0, A // 4 + PAD, A, A // 2 - PAD),         # u = station, v = |z| / half width (0 = centre line)
        swatch=(0, 0, A // 4, A // 4),                    # 4x4 cells of A/16 px
    )


def hull_uv(A, t, kp):
    """Atlas UV of the hull point at station t and girth kp in [0, .5] (0 = rail, .5 = keel)."""
    x0, y0, x1, y1 = atlas_layout(A)['hull']
    return t, (y0 + (1 - 2 * kp) * (y1 - y0)) / A


def deck_uv(A, t, v):
    x0, y0, x1, y1 = atlas_layout(A)['deck']
    return t, (y0 + v * (y1 - y0)) / A


def swatch_uv(A, name):
    k = SWATCH_NAMES.index(name)
    cell = 1 / 16
    return ((k % 4) + 0.5) * cell, ((k // 4) + 0.5) * cell


# --------------------------------------------------------------------------- hull features
def plank_width(s):
    return min(max(0.1 + 0.0022 * s['length'], 0.1), 0.26)


def has_copper(s):
    return s['draft'] >= 2.5


def wales(s):
    """(drop of the centre, thickness) of the raised wale strips, from the rail down."""
    L, bw = s['length'], bulwark(s)
    th = min(max(0.012 * L, 0.12), 0.38)
    out = [(bw + 0.05, th)]
    rows = max(1, s['gunDecks'])
    if rows >= 2:
        out.append((bw + 0.05 + (s['freeboard'] - bw) * 0.5, th * 0.8))
    return out


def port_size(s, per_row):
    spacing = 0.5 * s['length'] / max(per_row, 1)
    return min(0.35 + 0.006 * s['length'], spacing * 0.6, 0.8)


def gun_ports(s):
    """List of dicts (t, drop, w, h, row) for one side (mirror for the other). Row 0 is the weather deck battery."""
    total = s['stats']['cannons']
    if total <= 0:
        return []
    rows = max(1, s['gunDecks'])
    per_row = max(1, round(total / 2 / rows))
    size = port_size(s, per_row)
    bw = bulwark(s)
    first = bw + 0.3 + size * 0.5
    gap = max(size * 1.5, 1.0)
    if rows > 1:
        gap = min(gap, max((s['freeboard'] - 0.9 - first) / (rows - 1), size * 1.25))
    out = []
    for r in range(rows):
        drop = bw * 0.5 + size * 0.1 if r == 0 else first + (r - 1) * gap + size * 0.4
        for n in range(per_row):
            t = 0.22 + 0.5 * ((n + 0.5) / per_row)
            out.append(dict(t=t, drop=drop, w=size, h=size * 0.85, row=r))
    return out


def deck_edge(s, t):
    """Walkable half width of the main deck at station t (what the deck mesh covers)."""
    return half_beam(s, t) * 0.95


def deck_y(s, t):
    return deck_height(s, t) - bulwark(s)
