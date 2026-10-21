"""Shared helpers of the menu wallpaper scene (`make_wallpaper.py`): a sandbox that removes what it created,
GLB prop loading, procedural noise on numpy arrays, and small material builders.

Runs inside Blender 5.x. World coordinates of the wallpaper scene: metres, +Z up, the camera looks towards +Y,
sea level z = 0. Imported ships keep their own space (+X bow, +Y port, waterline 0), props stand on z = 0.
"""
import math
import random
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

REPO = Path(__file__).resolve().parents[2]
MODELS = REPO / "public" / "models"
OUT = Path(__file__).resolve().parent / "out"

DATA_KINDS = ("objects", "meshes", "materials", "images", "cameras", "lights", "node_groups", "curves", "collections", "worlds", "scenes", "textures")


class Sandbox:
    """Everything created inside is removed on exit, so the user's open Blender scene is left as it was."""

    def __enter__(self):
        self.before = {k: set(getattr(bpy.data, k)) for k in DATA_KINDS}
        self.window_scene = bpy.context.window.scene if bpy.context.window else None
        return self

    def __exit__(self, *exc):
        if self.window_scene is not None:
            bpy.context.window.scene = self.window_scene
        for k in ("scenes", "objects", "collections", "meshes", "curves", "materials", "images", "cameras", "lights", "worlds", "node_groups", "textures"):
            coll = getattr(bpy.data, k)
            for d in [d for d in coll if d not in self.before[k]]:
                try:
                    coll.remove(d)
                except Exception:
                    pass
        return False


def new_scene(name):
    sc = bpy.data.scenes.new(name)
    if bpy.context.window:
        bpy.context.window.scene = sc
    return sc


def rng(seed):
    return random.Random(seed), np.random.default_rng(seed)


# ------------------------------------------------------------------ props from GLB
def import_glb(path, collection):
    """Import a GLB and return its new objects, moved into `collection`."""
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path), loglevel=50)
    new = [o for o in bpy.data.objects if o not in before]
    for o in new:
        for c in list(o.users_collection):
            c.objects.unlink(o)
        collection.objects.link(o)
    return new


def hidden_collection(name):
    c = bpy.data.collections.new(name)
    return c


def world_props(sc):
    """Import `world.glb` once and return {prop name: [LOD0 mesh objects]} (templates are not rendered)."""
    tmpl = bpy.data.collections.new("wp_templates")
    sc.collection.children.link(tmpl)
    objs = import_glb(MODELS / "world" / "world.glb", tmpl)
    props = {}
    for o in objs:
        if o.type == "MESH" and o.name.endswith("_LOD0"):
            props[o.name[:-5]] = o
    tmpl.hide_render = True
    tmpl.hide_viewport = True
    return props


def place_copy(sc, src, loc, yaw=0.0, scale=1.0, collection=None):
    """A linked duplicate of a template mesh object (shares the mesh and materials)."""
    o = src.copy()
    o.parent = None
    o.matrix_parent_inverse.identity()
    o.location = loc
    o.rotation_euler = (0.0, 0.0, yaw)
    o.scale = (scale, scale, scale)
    (collection or sc.collection).objects.link(o)
    return o


# ------------------------------------------------------------------ noise on numpy grids
def value_noise(shape, cells, rs):
    """Smooth value noise in 0..1 over an (h, w) grid with `cells` lattice cells across the width."""
    h, w = shape
    gw = int(cells) + 2
    gh = int(cells * h / w) + 2
    g = rs.random((gh, gw))
    ys = np.linspace(0, gh - 2, h)
    xs = np.linspace(0, gw - 2, w)
    y0 = ys.astype(int)
    x0 = xs.astype(int)
    fy = ys - y0
    fx = xs - x0
    fy = fy * fy * (3 - 2 * fy)
    fx = fx * fx * (3 - 2 * fx)
    a = g[np.ix_(y0, x0)]
    b = g[np.ix_(y0, x0 + 1)]
    c = g[np.ix_(y0 + 1, x0)]
    d = g[np.ix_(y0 + 1, x0 + 1)]
    top = a + (b - a) * fx[None, :]
    bot = c + (d - c) * fx[None, :]
    return top + (bot - top) * fy[:, None]


def fbm(shape, base, octaves, rs, gain=0.5):
    out = np.zeros(shape)
    amp = 1.0
    tot = 0.0
    for i in range(octaves):
        out += amp * value_noise(shape, base * 2**i, rs)
        tot += amp
        amp *= gain
    return out / tot


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0.0, 1.0)
    return t * t * (3 - 2 * t)


# ------------------------------------------------------------------ materials
def principled_material(name, color, rough=0.6, metallic=0.0, **extra):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*color, 1.0)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = metallic
    for k, v in extra.items():
        if k in b.inputs:
            b.inputs[k].default_value = v
    return m


def link_bump_noise(m, scale, strength, detail=8.0, rough=0.55):
    """Add a noise bump to a Principled material (surface relief without geometry)."""
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = nt.nodes.new("ShaderNodeTexCoord")
    n = nt.nodes.new("ShaderNodeTexNoise")
    n.inputs["Scale"].default_value = scale
    n.inputs["Detail"].default_value = detail
    n.inputs["Roughness"].default_value = rough
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    nt.links.new(tc.outputs["Object"], n.inputs["Vector"])
    nt.links.new(n.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return n


def box(sc, name, x0, x1, y0, y1, z0, z1, mat, collection=None):
    """An axis-aligned box mesh object between the given extents."""
    verts = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    (collection or sc.collection).objects.link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def cylinder(sc, name, x, y, z0, z1, radius, mat, sides=10, collection=None):
    verts = []
    for z in (z0, z1):
        for i in range(sides):
            a = 2 * math.pi * i / sides
            verts.append((x + radius * math.cos(a), y + radius * math.sin(a), z))
    faces = [(i, (i + 1) % sides, sides + (i + 1) % sides, sides + i) for i in range(sides)]
    faces.append(tuple(range(sides - 1, -1, -1)))
    faces.append(tuple(range(sides, 2 * sides)))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new(name, me)
    (collection or sc.collection).objects.link(o)
    if mat:
        o.data.materials.append(mat)
    return o


def look_at(obj, target):
    d = Vector(target) - obj.location
    obj.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
