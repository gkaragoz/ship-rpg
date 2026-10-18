"""Hull geometry formulas (port of src/ships/hullShape.ts), pure Python + numpy so they work outside Blender.

Every function accepts floats or numpy arrays. Game ship space: +x bow, +y up, +z starboard, waterline y = 0.
Shared by shipbuilder.py (geometry) and pbrtex.py (textures painted in hull parameter space).
"""
import math

import numpy as np

SECTION_FULLNESS = 0.6
DEPTH_EXPONENT = 0.8


def _ret(x):
    return x.item() if isinstance(x, np.ndarray) and x.ndim == 0 else x


def clamp01(x):
    return _ret(np.clip(x, 0.0, 1.0))


def smooth(x):
    c = np.clip(x, 0.0, 1.0)
    return _ret(c * c * (3 - 2 * c))


def half_beam(s, t):
    t = np.asarray(t, float)
    base = s['beam'] / 2
    u = np.clip((t - 0.5) * 2, 0, 1)
    fore = base * np.maximum((1 - u ** 1.7) ** 0.75, 0.03)
    a = np.clip((0.5 - t) * 2, 0, 1)
    return _ret(np.where(t >= 0.5, fore, base * (1 - 0.22 * a * a)))


def deck_height(s, t):
    t = np.asarray(t, float)
    return _ret(s['freeboard'] + s['sheer'] * (0.6 * (1 - t) ** 2 + t ** 2.5))


def keel_height(s, t):
    t = np.asarray(t, float)
    bow = smooth((t - 0.6) / 0.4)
    stern = smooth((0.25 - t) / 0.25)
    return _ret(-s['draft'] * (1 - 0.7 * bow - 0.3 * stern))


def section_point(s, t, k):
    """Point on the hull at station t (0 stern .. 1 bow) and girth k (0 = port rail, .5 = keel, 1 = starboard rail)."""
    t = np.asarray(t, float)
    k = np.asarray(k, float)
    hw, top, keel = half_beam(s, t), deck_height(s, t), keel_height(s, t)
    theta = k * math.pi
    c, sn = np.cos(theta), np.sin(theta)
    z = -np.sign(c) * hw * np.abs(c) ** SECTION_FULLNESS
    y = top + (keel - top) * np.maximum(sn, 0.0) ** DEPTH_EXPONENT
    x = (t - 0.5) * s['length'] + s['length'] * (0.05 * t ** 3 - 0.02 * (1 - t) ** 3) * (1 - sn)
    return _ret(x), _ret(y), _ret(z)


def girth_at_drop(s, t, drop):
    """Girth parameter k' in (0, .5] of the point `drop` metres below the rail (starboard side is k = 1 - k')."""
    rng = deck_height(s, t) - keel_height(s, t)
    theta = np.arcsin(np.clip(drop / rng, 0, 1) ** (1 / DEPTH_EXPONENT))
    return _ret(theta / math.pi)


def side_point(s, t, drop):
    """Starboard hull point `drop` metres below the rail."""
    return section_point(s, t, 1 - girth_at_drop(s, t, drop))


def bulwark(s):
    return min(max(0.2 + 0.017 * s['length'], 0.5), 1.2)


def mast_base(s, m):
    return ((0.5 - m['at']) * s['length'], deck_height(s, 1 - m['at']) - bulwark(s), 0.0)
