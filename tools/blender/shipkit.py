"""Shared Blender helpers for the ship asset pipeline.

Runs INSIDE Blender (5.x). Normally started from the open Blender by the local LLM through
`execute_blender_code` with a short wrapper that exec()s a `make_*.py` file (see
docs/BLENDER_PIPELINE.md). Everything here is written to leave the user's open scene alone:
it only creates scratch datablocks, exports just those, then removes them and restores the
selection and frame range.

Conventions (match the game): ship local space +x bow, +y up, +z starboard, metres, waterline 0.
Blender is Z-up with +X bow, so Blender +Y is port and glTF z = -Blender y.
"""
import json
import math
from pathlib import Path

import bpy
import bmesh
import numpy as np
from mathutils import Vector

ATLAS_GRID = 4
ATLAS_PX = 256


# --------------------------------------------------------------------------- scratch scope
class Scratch:
    """Snapshot datablocks / selection / frame range; on exit remove everything created."""

    COLLS = ("objects", "meshes", "materials", "images", "actions", "armatures", "cameras", "lights")

    def __enter__(self):
        sc = bpy.context.scene
        self.sc = sc
        self.before = {k: set(getattr(bpy.data, k)) for k in self.COLLS}
        self.frames = (sc.frame_start, sc.frame_end, sc.render.fps)
        self.frame = sc.frame_current
        self.sel = list(bpy.context.selected_objects)
        self.active = bpy.context.view_layer.objects.active
        return self

    def new_objects(self):
        return [o for o in bpy.data.objects if o not in self.before["objects"]]

    def __exit__(self, *exc):
        self.sc.frame_start, self.sc.frame_end, self.sc.render.fps = self.frames
        self.sc.frame_current = self.frame
        for k in self.COLLS:
            coll = getattr(bpy.data, k)
            for d in [d for d in coll if d not in self.before[k]]:
                try:
                    coll.remove(d)
                except Exception:
                    pass
        bpy.ops.object.select_all(action='DESELECT')
        for o in self.sel:
            if o.name in bpy.data.objects:
                o.select_set(True)
        if self.active is not None and self.active.name in bpy.data.objects:
            bpy.context.view_layer.objects.active = self.active
        return False


# --------------------------------------------------------------------------- atlas + materials
def hex_rgb(h):
    return ((h >> 16) & 255) / 255.0, ((h >> 8) & 255) / 255.0, (h & 255) / 255.0


class Atlas:
    """Flat colour swatches in a 4x4 grid (256 px). Every face maps to one swatch centre, so
    meshes of any LOD merge into one mesh/one material and colours stay editable in the PNG."""

    def __init__(self, name, swatches, png_path=None, grain=0.0):
        self.name = name
        self.names = list(swatches)
        if len(self.names) > ATLAS_GRID * ATLAS_GRID:
            raise ValueError("atlas holds at most 16 swatches")
        cell = ATLAS_PX // ATLAS_GRID
        rng = np.random.default_rng(11)
        px = np.ones((ATLAS_PX, ATLAS_PX, 4), np.float32)
        px[..., :3] = 0.5
        for k, n in enumerate(self.names):
            cx, cy = k % ATLAS_GRID, k // ATLAS_GRID
            r, g, b = hex_rgb(swatches[n])
            shade = 1.0 - grain * rng.random((cell, cell, 1))
            px[cy * cell:(cy + 1) * cell, cx * cell:(cx + 1) * cell, :3] = np.array([r, g, b], np.float32) * shade
        self.image = bpy.data.images.new(name, ATLAS_PX, ATLAS_PX, alpha=False)
        self.image.colorspace_settings.name = 'sRGB'
        self.image.pixels.foreach_set(px.ravel())
        self.image.pack()
        if png_path:
            self.save(png_path)

    def save(self, png_path):
        """Write the editable PNG next to the GLB (call after validation so a failed ship leaves no files)."""
        self.image.filepath_raw = str(png_path)
        self.image.file_format = 'PNG'
        self.image.save()

    def uv(self, swatch):
        k = self.names.index(swatch)
        return ((k % ATLAS_GRID) + 0.5) / ATLAS_GRID, ((k // ATLAS_GRID) + 0.5) / ATLAS_GRID

    def material(self, name, roughness=0.85):
        m = bpy.data.materials.new(name)
        m.use_nodes = True
        nt = m.node_tree
        b = nt.nodes["Principled BSDF"]
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = self.image
        tex.interpolation = 'Closest'
        nt.links.new(tex.outputs["Color"], b.inputs["Base Color"])
        b.inputs["Roughness"].default_value = roughness
        return m


def emissive_material(name, rgb, strength=3.0):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = 0.3
    b.inputs["Emission Color"].default_value = (*rgb, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m


# --------------------------------------------------------------------------- mesh builder
class MB:
    """Collects faces from many parts into one bmesh; each face carries an atlas swatch."""

    def __init__(self, atlas):
        self.atlas = atlas
        self.bm = bmesh.new()
        self.uvl = self.bm.loops.layers.uv.verify()

    def v(self, p):
        return self.bm.verts.new(p)

    def face(self, verts, swatch):
        f = self.bm.faces.new(verts)
        u, w = self.atlas.uv(swatch)
        for loop in f.loops:
            loop[self.uvl].uv = (u, w)
        return f

    def outward(self, faces):
        """Fix winding of a closed part so normals point out."""
        bmesh.ops.recalc_face_normals(self.bm, faces=list(faces))

    def box(self, c, s, swatch, top=None):
        """Axis-aligned box centred on c with size s=(x,y,z); `top` = (x,y) size of the top face."""
        hx, hy, hz = s[0] / 2, s[1] / 2, s[2] / 2
        tx, ty = (top[0] / 2, top[1] / 2) if top else (hx, hy)
        pts = [(-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
               (-tx, -ty, hz), (tx, -ty, hz), (tx, ty, hz), (-tx, ty, hz)]
        vs = [self.v((c[0] + x, c[1] + y, c[2] + z)) for x, y, z in pts]
        fs = [self.face(q, swatch) for q in (
            (vs[0], vs[1], vs[2], vs[3]), (vs[4], vs[5], vs[6], vs[7]),
            (vs[0], vs[1], vs[5], vs[4]), (vs[1], vs[2], vs[6], vs[5]),
            (vs[2], vs[3], vs[7], vs[6]), (vs[3], vs[0], vs[4], vs[7]))]
        self.outward(fs)
        return fs

    def spar(self, p0, p1, r0, r1, swatch, seg=6, caps=True):
        p0, p1 = Vector(p0), Vector(p1)
        d = p1 - p0
        q = Vector((0, 0, 1)).rotation_difference(d)
        mid = (p0 + p1) / 2
        h = d.length / 2
        rings = []
        for z, r in ((-h, r0), (h, r1)):
            rings.append([self.v(q @ Vector((r * math.cos(2 * math.pi * i / seg), r * math.sin(2 * math.pi * i / seg), z)) + mid)
                          for i in range(seg)])
        fs = [self.face((rings[0][i], rings[0][(i + 1) % seg], rings[1][(i + 1) % seg], rings[1][i]), swatch)
              for i in range(seg)]
        if caps:
            fs += [self.face(rings[0][::-1], swatch), self.face(rings[1], swatch)]
        self.outward(fs)
        return fs

    def tri_sail(self, a, b, c, n, bulge, swatch):
        """Triangle a-b-c as an n x n grid; belly (Blender +y) peaks mid-sail, zero on the edges."""
        a, b, c = Vector(a), Vector(b), Vector(c)
        idx = {}
        for i in range(n + 1):
            for j in range(n + 1 - i):
                u, w = i / n, j / n
                p = a + u * (b - a) + w * (c - a)
                p.y += bulge * 27 * u * w * (1 - u - w)
                idx[(i, j)] = self.v(p)
        fs = []
        for i in range(n):
            for j in range(n - i):
                fs.append(self.face((idx[(i, j)], idx[(i + 1, j)], idx[(i, j + 1)]), swatch))
                if j < n - i - 1:
                    fs.append(self.face((idx[(i + 1, j)], idx[(i + 1, j + 1)], idx[(i, j + 1)]), swatch))
        return fs

    def to_object(self, name, material, parent=None, shift=(0, 0, 0), smooth=False):
        """Turn the bmesh into an object. `shift` is subtracted from every vertex (pivot-local mesh);
        `smooth` shades the surface smoothly (sails), otherwise it stays faceted like the hull."""
        if any(shift):
            bmesh.ops.translate(self.bm, vec=-Vector(shift), verts=self.bm.verts)
        me = bpy.data.meshes.new(name)
        self.bm.to_mesh(me)
        self.bm.free()
        for p in me.polygons:
            p.use_smooth = smooth
        me.materials.append(material)
        ob = bpy.data.objects.new(name, me)
        bpy.context.scene.collection.objects.link(ob)
        ob.parent = parent
        return ob


def empty(name, parent=None, loc=(0, 0, 0)):
    e = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(e)
    e.parent = parent
    e.location = loc
    return e


def tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


# --------------------------------------------------------------------------- export + checks
def export_glb(path, objects, active):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action='DESELECT')
    for o in objects:
        o.select_set(True)
    bpy.context.view_layer.objects.active = active
    bpy.ops.export_scene.gltf(filepath=str(path), export_format='GLB', use_selection=True,
                              export_animations=False, export_yup=True, export_apply=False)
    return path.stat().st_size


NAME_OK = __import__("re").compile(r"^[A-Za-z0-9_\-]+$")


def validate_ship(report, budgets, max_materials=2):
    """Raise ValueError with every problem found, so the LLM can report one clear message."""
    errs = []
    for lod, limit in budgets.items():
        n = report["lods"][lod]["tris"]
        if n > limit:
            errs.append(f"{lod}: {n} tris > budget {limit}")
        if n < 1:
            errs.append(f"{lod}: empty")
    t = [report["lods"][f"LOD{i}"]["tris"] for i in range(3)]
    if t[1] >= 0.3 * t[0]:
        errs.append(f"LOD1 has {t[1]} tris, not under 30% of LOD0 ({t[0]})")
    if t[2] >= 0.6 * t[1]:
        errs.append(f"LOD2 has {t[2]} tris, not under 60% of LOD1 ({t[1]})")
    if report["materials"] > max_materials:
        errs.append(f"{report['materials']} materials > {max_materials}")
    for n in report["names"]:
        if not NAME_OK.match(n):
            errs.append(f"bad node name {n!r} (use letters, digits, _ and - only; no dots/spaces)")
    if not report["has_trim_pivot"]:
        errs.append("no *_trim-aft pivot")
    if errs:
        raise ValueError("; ".join(errs))


def fnv1a(text):
    """32-bit FNV-1a of the UTF-8 text as 8 hex digits (tests/assets.test.ts computes the same)."""
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h = ((h ^ b) * 0x01000193) & 0xFFFFFFFF
    return f"{h:08x}"


def write_json(path, data):
    Path(path).write_text(json.dumps(data, indent=2), encoding="utf-8")
