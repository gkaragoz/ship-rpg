"""Quay, jetty, moored and anchored ships, mooring ropes and boats of the menu wallpaper."""
import json
import math

import bpy
import numpy as np
from mathutils import Vector

from wp_common import MODELS, REPO, box, cylinder, import_glb, place_copy, principled_material
from wp_terrain import PLATEAU, QUAY_Z

SPECS = {s["id"]: s for s in json.loads((REPO / "tools" / "blender" / "ships.json").read_text(encoding="utf-8"))}


def _tex_node(nt, kind):
    return nt.nodes.new(kind)


def stone_material():
    m = principled_material("wp_stone", (0.3, 0.28, 0.25), rough=0.85)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = _tex_node(nt, "ShaderNodeTexCoord")
    brick = _tex_node(nt, "ShaderNodeTexBrick")
    brick.inputs["Color1"].default_value = (0.36, 0.33, 0.29, 1)
    brick.inputs["Color2"].default_value = (0.24, 0.22, 0.2, 1)
    brick.inputs["Mortar"].default_value = (0.12, 0.11, 0.1, 1)
    brick.inputs["Scale"].default_value = 0.55
    brick.inputs["Mortar Size"].default_value = 0.03
    brick.inputs["Brick Width"].default_value = 1.8
    brick.inputs["Row Height"].default_value = 0.7
    bump = _tex_node(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.7
    nt.links.new(tc.outputs["Object"], brick.inputs["Vector"])
    nt.links.new(brick.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(brick.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def cobble_material():
    m = principled_material("wp_cobble", (0.3, 0.27, 0.23), rough=0.9)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = _tex_node(nt, "ShaderNodeTexCoord")
    vor = _tex_node(nt, "ShaderNodeTexVoronoi")
    vor.inputs["Scale"].default_value = 1.6
    ramp = _tex_node(nt, "ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (0.2, 0.18, 0.15, 1)
    ramp.color_ramp.elements[1].color = (0.42, 0.38, 0.32, 1)
    bump = _tex_node(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.9
    nt.links.new(tc.outputs["Object"], vor.inputs["Vector"])
    nt.links.new(vor.outputs["Distance"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(vor.outputs["Distance"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def wood_material(name, color, along="X", scale=9.0):
    m = principled_material(name, color, rough=0.7)
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tc = _tex_node(nt, "ShaderNodeTexCoord")
    wave = _tex_node(nt, "ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "Y" if along == "X" else "X"
    wave.inputs["Scale"].default_value = scale
    wave.inputs["Distortion"].default_value = 2.0
    wave.inputs["Detail"].default_value = 4.0
    ramp = _tex_node(nt, "ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].color = (color[0] * 0.55, color[1] * 0.55, color[2] * 0.55, 1)
    ramp.color_ramp.elements[1].color = (color[0] * 1.5, color[1] * 1.5, color[2] * 1.5, 1)
    bump = _tex_node(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.5
    nt.links.new(tc.outputs["Object"], wave.inputs["Vector"])
    nt.links.new(wave.outputs["Fac"], ramp.inputs["Fac"])
    nt.links.new(ramp.outputs["Color"], b.inputs["Base Color"])
    nt.links.new(wave.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    return m


def emissive(name, color, strength):
    m = principled_material(name, color, rough=0.3)
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Emission Color"].default_value = (*color, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m


def build_quay(sc):
    """Stone quay wall along y = 0 with a cobbled top and bollards; returns the bollards and the rope material."""
    stone = stone_material()
    cobble = cobble_material()
    x0, x1, y0, y1 = PLATEAU
    q = box(sc, "wp_quay", x0, x1, y0, y1, -9.0, QUAY_Z + 0.12, stone)
    q.data.materials.append(cobble)
    for p in q.data.polygons:
        p.material_index = 1 if p.normal.z > 0.5 else 0
    iron = principled_material("wp_iron", (0.03, 0.03, 0.035), rough=0.45, metallic=0.8)
    rope = principled_material("wp_rope", (0.35, 0.27, 0.15), rough=0.95)
    bollards = []
    for x in np.arange(x0 + 6, x1 - 4, 9.0):
        cylinder(sc, "wp_bollard", float(x), 1.1, QUAY_Z, QUAY_Z + 0.75, 0.28, iron, 10)
        bollards.append((float(x), 1.1, QUAY_Z + 0.65))
    return bollards, rope


def build_jetty(sc, x, y_end):
    """A wooden jetty from the quay edge (y = 0) out to y_end, with posts and a lantern post."""
    deck_z = 1.55
    plank = wood_material("wp_jetty", (0.22, 0.14, 0.08), along="Y", scale=7.0)
    post = wood_material("wp_post", (0.13, 0.09, 0.06), along="X", scale=4.0)
    w = 3.2
    box(sc, "wp_jetty_deck", x - w / 2, x + w / 2, y_end, 0.4, deck_z - 0.22, deck_z, plank)
    for y in np.arange(y_end, 0.0, 3.6):
        for sx in (-w / 2 + 0.15, w / 2 - 0.15):
            cylinder(sc, "wp_post", x + sx, float(y), -4.0, deck_z + 0.45, 0.2, post, 8)
    cylinder(sc, "wp_lamppost", x + w / 2 - 0.2, y_end + 0.3, deck_z, deck_z + 3.2, 0.07, post, 6)
    box(sc, "wp_lamp", x + w / 2 - 0.45, x + w / 2 + 0.05, y_end + 0.05, y_end + 0.55, deck_z + 3.2, deck_z + 3.75, emissive("wp_lantern", (1.0, 0.55, 0.18), 90.0))


def _ancestors(o):
    out = []
    while o.parent:
        o = o.parent
        out.append(o)
    return out


def _translucent_sails(obj):
    """Let the low sun glow through the canvas: a translucent layer mixed into the sail material."""
    for slot in obj.material_slots:
        m = slot.material
        if not m or not m.use_nodes:
            continue
        nt = m.node_tree
        b = nt.nodes.get("Principled BSDF")
        out = next((n for n in nt.nodes if n.type == "OUTPUT_MATERIAL"), None)
        if not b or not out or not b.inputs["Base Color"].links:
            continue
        tr = nt.nodes.new("ShaderNodeBsdfTranslucent")
        nt.links.new(b.inputs["Base Color"].links[0].from_socket, tr.inputs["Color"])
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs[0].default_value = 0.6
        nt.links.new(b.outputs[0], mix.inputs[1])
        nt.links.new(tr.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        # canvas weave: a fine bump so the sails catch the light instead of reading as flat paper
        tc = nt.nodes.new("ShaderNodeTexCoord")
        wv = nt.nodes.new("ShaderNodeTexNoise")
        wv.inputs["Scale"].default_value = 45.0
        wv.inputs["Detail"].default_value = 6.0
        bp = nt.nodes.new("ShaderNodeBump")
        bp.inputs["Strength"].default_value = 0.25
        nt.links.new(tc.outputs["Object"], wv.inputs["Vector"])
        nt.links.new(wv.outputs["Fac"], bp.inputs["Height"])
        nt.links.new(bp.outputs["Normal"], b.inputs["Normal"])


def place_ship(sc, ship_id, x, y, yaw, hide=()):
    """Import a ship GLB at LOD0 only, put it at (x, y) with the given yaw; sails glow, lanterns light up."""
    objs = import_glb(MODELS / "ships" / f"{ship_id}.glb", sc.collection)
    root = next(o for o in objs if o.parent is None)
    drop = [o for o in objs if o.name.split(".")[0].startswith(("LOD1", "LOD2")) or any(h in o.name.split(".")[0] for h in hide)]
    keep = [o for o in objs if o not in drop]
    for o in drop:
        bpy.data.objects.remove(o, do_unlink=True)
    root.location = (x, y, 0.0)
    root.rotation_euler = (0.0, 0.0, yaw)
    for o in keep:
        if o.type != "MESH":
            continue
        base = o.name.split(".")[0]
        if "Sail" in base or "Jib" in base:
            _translucent_sails(o)
        if "Glass" in base:
            for slot in o.material_slots:
                b = slot.material.node_tree.nodes.get("Principled BSDF")
                if b:
                    b.inputs["Emission Color"].default_value = (1.0, 0.62, 0.25, 1)
                    b.inputs["Emission Strength"].default_value = 22.0
    return root


def _rope(sc, a, b, sag, mat, radius=0.045, n=14):
    cu = bpy.data.curves.new("wp_rope", "CURVE")
    cu.dimensions = "3D"
    cu.bevel_depth = radius
    cu.bevel_resolution = 2
    sp = cu.splines.new("POLY")
    sp.points.add(n - 1)
    for i in range(n):
        t = i / (n - 1)
        p = Vector(a).lerp(Vector(b), t)
        p.z -= sag * 4 * t * (1 - t)
        sp.points[i].co = (p.x, p.y, p.z, 1)
    o = bpy.data.objects.new("wp_rope", cu)
    sc.collection.objects.link(o)
    o.data.materials.append(mat)
    return o


def moor(sc, root, ship_id, bollards, rope_mat, side):
    """Ropes from the ship's cleats on the quay side (`side` = local y sign) to the nearest bollards."""
    spec = SPECS[ship_id]
    m = root.matrix_basis
    n = 0
    for fx in (0.36, 0.12, -0.12, -0.36):
        a = m @ Vector((spec["length"] * fx, side * spec["beam"] * 0.44, spec["freeboard"] + 0.2))
        bx, by, bz = min(bollards, key=lambda p: (p[0] - a.x) ** 2)
        _rope(sc, a, (bx, by, bz), 0.5 + abs(fx) * 0.6, rope_mat)
        n += 1
    return n


def place_boats(sc, lod0, spots):
    for name, x, y, yaw in spots:
        place_copy(sc, lod0[name], (x, y, -0.12), yaw, 1.15)
