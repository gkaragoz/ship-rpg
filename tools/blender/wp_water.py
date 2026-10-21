"""The sea of the menu wallpaper: an Ocean-modifier surface (real swell geometry) with a glossy water shader whose colour follows
the depth under it (a baked depth map of the island's height field) and a lacy foam line on the beaches and the quay."""
import bpy
import numpy as np

from wp_terrain import X0, X1, Y0, Y1


def depth_image(ter, px=1024):
    """Water depth in 0..1 (1 = 30 m and deeper) over the whole scene, as a float image."""
    xs = np.linspace(X0, X1, px)
    ys = np.linspace(Y0, Y1, px // 2)
    gx, gy = np.meshgrid(xs, ys)
    depth = np.clip(-ter.height(gx, gy), 0.0, 30.0) / 30.0
    img = bpy.data.images.new("wp_depth", px, px // 2, alpha=False, float_buffer=True)
    rgba = np.stack([depth, depth, depth, np.ones_like(depth)], axis=-1)
    img.pixels.foreach_set(rgba.astype(np.float32).ravel())
    img.colorspace_settings.name = "Non-Color"
    img.pack()
    return img


def _n(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def water_material(depth_img, deep=(0.003, 0.03, 0.05), shallow=(0.06, 0.4, 0.36)):
    m = bpy.data.materials.new("wp_water")
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    geo = _n(nt, "ShaderNodeNewGeometry")
    mp = _n(nt, "ShaderNodeMapping", vector_type="POINT")
    mp.inputs["Location"].default_value = (-X0 / (X1 - X0), -Y0 / (Y1 - Y0), 0.0)
    mp.inputs["Scale"].default_value = (1 / (X1 - X0), 1 / (Y1 - Y0), 1.0)
    nt.links.new(geo.outputs["Position"], mp.inputs["Vector"])
    tex = _n(nt, "ShaderNodeTexImage", image=depth_img, extension="EXTEND", interpolation="Linear")
    nt.links.new(mp.outputs["Vector"], tex.inputs["Vector"])
    sep = _n(nt, "ShaderNodeSeparateColor")
    nt.links.new(tex.outputs["Color"], sep.inputs["Color"])

    # colour by depth: turquoise in the shallows, deep teal-black offshore
    sq = _n(nt, "ShaderNodeMath", operation="POWER")
    nt.links.new(sep.outputs["Red"], sq.inputs[0])
    sq.inputs[1].default_value = 0.45
    col = _n(nt, "ShaderNodeMix", data_type="RGBA")
    col.inputs[6].default_value = (*shallow, 1)
    col.inputs[7].default_value = (*deep, 1)
    nt.links.new(sq.outputs[0], col.inputs[0])

    # ripples: two scales of noise as a bump, a touch of stretch
    noise = _n(nt, "ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.1
    noise.inputs["Detail"].default_value = 6.0
    noise.inputs["Roughness"].default_value = 0.55
    nt.links.new(geo.outputs["Position"], noise.inputs["Vector"])
    noise2 = _n(nt, "ShaderNodeTexNoise")
    noise2.inputs["Scale"].default_value = 11.0
    noise2.inputs["Detail"].default_value = 3.0
    nt.links.new(geo.outputs["Position"], noise2.inputs["Vector"])
    add = _n(nt, "ShaderNodeMath", operation="ADD")
    nt.links.new(noise.outputs["Fac"], add.inputs[0])
    nt.links.new(noise2.outputs["Fac"], add.inputs[1])
    bump = _n(nt, "ShaderNodeBump")
    bump.inputs["Strength"].default_value = 0.22
    bump.inputs["Distance"].default_value = 0.4
    nt.links.new(add.outputs[0], bump.inputs["Height"])

    # foam where it is shallower than about a metre: a torn line that breathes
    shore = _n(nt, "ShaderNodeMath", operation="LESS_THAN")
    nt.links.new(sep.outputs["Red"], shore.inputs[0])
    shore.inputs[1].default_value = 0.045
    wob = _n(nt, "ShaderNodeMath", operation="MULTIPLY")
    nt.links.new(noise2.outputs["Fac"], wob.inputs[0])
    nt.links.new(shore.outputs[0], wob.inputs[1])
    foam_ramp = _n(nt, "ShaderNodeMath", operation="SMOOTH_MAX", use_clamp=True)
    foam_ramp.inputs[1].default_value = 0.0
    nt.links.new(wob.outputs[0], foam_ramp.inputs[0])
    foam_ramp.inputs[2].default_value = 0.2
    fcol = _n(nt, "ShaderNodeMix", data_type="RGBA")
    fcol.inputs[7].default_value = (0.8, 0.82, 0.8, 1)
    nt.links.new(foam_ramp.outputs[0], fcol.inputs[0])
    nt.links.new(col.outputs[2], fcol.inputs[6])
    nt.links.new(fcol.outputs[2], b.inputs["Base Color"])
    nt.links.new(bump.outputs["Normal"], b.inputs["Normal"])
    # body colour of the water: teal that shows where the surface is seen steeply (close to the camera) and fades at grazing angles
    lw = _n(nt, "ShaderNodeLayerWeight")
    lw.inputs["Blend"].default_value = 0.5
    nt.links.new(bump.outputs["Normal"], lw.inputs["Normal"])
    em = _n(nt, "ShaderNodeMath", operation="MULTIPLY")
    nt.links.new(lw.outputs["Facing"], em.inputs[0])
    nt.links.new(sq.outputs[0], em.inputs[1])
    b.inputs["Emission Color"].default_value = (0.02, 0.28, 0.3, 1)
    nt.links.new(em.outputs[0], b.inputs["Emission Strength"])
    b.inputs["Roughness"].default_value = 0.035
    b.inputs["IOR"].default_value = 1.333
    if "Specular Tint" in b.inputs:
        b.inputs["Specular Tint"].default_value = (0.78, 0.9, 1.0, 1)
    if "Specular IOR Level" in b.inputs:
        b.inputs["Specular IOR Level"].default_value = 0.3
    return m


def build_sea(sc, depth_img, size=260.0, tiles=7, seed=7, scale=2.2, wind=10.0):
    me = bpy.data.meshes.new("wp_sea")
    me.from_pydata([(-1, -1, 0), (1, -1, 0), (1, 1, 0), (-1, 1, 0)], [], [(0, 1, 2, 3)])
    me.update()
    o = bpy.data.objects.new("wp_sea", me)
    sc.collection.objects.link(o)
    mod = o.modifiers.new("Ocean", "OCEAN")
    mod.geometry_mode = "GENERATE"
    mod.resolution = 13
    mod.spatial_size = int(size)
    mod.repeat_x = tiles
    mod.repeat_y = tiles
    mod.wave_scale = scale
    mod.wave_scale_min = 0.04
    mod.choppiness = 1.2
    mod.wind_velocity = wind
    mod.damping = 0.6
    mod.depth = 200.0
    mod.random_seed = seed
    mod.use_normals = True
    mod.time = 3.0
    o.data.materials.append(water_material(depth_img))
    return o
