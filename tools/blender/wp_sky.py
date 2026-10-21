"""Golden-hour sky of the menu wallpaper: physical sky with a low sun, a procedural cloud layer lit from below by the sun, and a
thin scattering volume for depth haze and light shafts."""
import math

import bpy


def _n(nt, kind, **kw):
    n = nt.nodes.new(kind)
    for k, v in kw.items():
        setattr(n, k, v)
    return n


def _math(nt, op, a=None, b=None, clamp=False):
    n = nt.nodes.new("ShaderNodeMath")
    n.operation = op
    n.use_clamp = clamp
    if a is not None and not hasattr(a, "node"):
        n.inputs[0].default_value = a
    if b is not None and not hasattr(b, "node"):
        n.inputs[1].default_value = b
    for i, s in enumerate((a, b)):
        if s is not None and hasattr(s, "node"):
            nt.links.new(s, n.inputs[i])
    return n


def sun_direction(rotation_deg, elevation_deg):
    r, e = math.radians(rotation_deg), math.radians(elevation_deg)
    return (math.sin(r) * math.cos(e), math.cos(r) * math.cos(e), math.sin(e))


def build_world(sc, rotation_deg, elevation_deg, cloud_seed=3.0, exposure=1.0, cover=(0.5, 0.7), shade=(0.26, 0.17, 0.27), lit=(3.2, 1.05, 0.34)):
    w = bpy.data.worlds.new("wp_world")
    sc.world = w
    w.use_nodes = True
    nt = w.node_tree
    nt.nodes.clear()
    sky = _n(nt, "ShaderNodeTexSky", sky_type="MULTIPLE_SCATTERING", sun_disc=True, sun_size=math.radians(0.9), sun_intensity=0.55,
             sun_elevation=math.radians(elevation_deg), sun_rotation=math.radians(rotation_deg), altitude=0.0,
             air_density=1.5, aerosol_density=0.9, ozone_density=2.6)
    bg = _n(nt, "ShaderNodeBackground")
    out = _n(nt, "ShaderNodeOutputWorld")

    # clouds: a plane of noise seen in perspective, thin near the zenith, lit orange towards the sun
    tc = _n(nt, "ShaderNodeTexCoord")
    sep = _n(nt, "ShaderNodeSeparateXYZ")
    nt.links.new(tc.outputs["Generated"], sep.inputs["Vector"])
    zc = _math(nt, "ADD", sep.outputs["Z"], 0.16)
    zc = _math(nt, "MAXIMUM", zc.outputs[0], 0.06)
    ux = _math(nt, "DIVIDE", sep.outputs["X"], zc.outputs[0])
    uy = _math(nt, "DIVIDE", sep.outputs["Y"], zc.outputs[0])
    comb = _n(nt, "ShaderNodeCombineXYZ")
    nt.links.new(ux.outputs[0], comb.inputs["X"])
    nt.links.new(uy.outputs[0], comb.inputs["Y"])
    comb.inputs["Z"].default_value = cloud_seed
    # long streaky sunset clouds: stretch the noise along one axis
    mapping = _n(nt, "ShaderNodeMapping")
    mapping.inputs["Scale"].default_value = (0.9, 2.4, 1.0)
    nt.links.new(comb.outputs["Vector"], mapping.inputs["Vector"])
    noise = _n(nt, "ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 1.7
    noise.inputs["Detail"].default_value = 9.0
    noise.inputs["Roughness"].default_value = 0.62
    nt.links.new(mapping.outputs["Vector"], noise.inputs["Vector"])
    ramp = _n(nt, "ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = cover[0]
    ramp.color_ramp.elements[1].position = cover[1]
    nt.links.new(noise.outputs["Fac"], ramp.inputs["Fac"])
    above = _math(nt, "GREATER_THAN", sep.outputs["Z"], 0.012)
    sep2 = _n(nt, "ShaderNodeSeparateColor")
    nt.links.new(ramp.outputs["Color"], sep2.inputs["Color"])
    mask = _math(nt, "MULTIPLY", sep2.outputs["Red"], above.outputs[0])

    sd = sun_direction(rotation_deg, elevation_deg)
    dirn = _n(nt, "ShaderNodeVectorMath", operation="DOT_PRODUCT")
    dirn.inputs[1].default_value = sd
    nt.links.new(tc.outputs["Generated"], dirn.inputs[0])
    near = _math(nt, "MAXIMUM", dirn.outputs["Value"], 0.0)
    near = _math(nt, "POWER", near.outputs[0], 3.0)
    ccol = _n(nt, "ShaderNodeMix", data_type="RGBA")
    ccol.inputs[6].default_value = (*shade, 1)  # shadowed underside: dusty violet
    ccol.inputs[7].default_value = (*lit, 1)   # sun-lit edge: hot orange
    nt.links.new(near.outputs[0], ccol.inputs[0])
    mixc = _n(nt, "ShaderNodeMix", data_type="RGBA")
    nt.links.new(mask.outputs[0], mixc.inputs[0])
    nt.links.new(sky.outputs["Color"], mixc.inputs[6])
    nt.links.new(ccol.outputs[2], mixc.inputs[7])
    nt.links.new(mixc.outputs[2], bg.inputs["Color"])
    bg.inputs["Strength"].default_value = exposure
    nt.links.new(bg.outputs[0], out.inputs["Surface"])

    return w


def build_haze(sc, density=0.0005, box=(-1400.0, 1400.0, -900.0, 1100.0, -6.0, 260.0)):
    """Thin low-lying haze as a bounded scattering volume (a world volume would swallow the sky it covers)."""
    x0, x1, y0, y1, z0, z1 = box
    verts = [(x, y, z) for x in (x0, x1) for y in (y0, y1) for z in (z0, z1)]
    faces = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
    me = bpy.data.meshes.new("wp_haze")
    me.from_pydata(verts, [], faces)
    me.update()
    o = bpy.data.objects.new("wp_haze", me)
    sc.collection.objects.link(o)
    m = bpy.data.materials.new("wp_haze")
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.clear()
    vol = _n(nt, "ShaderNodeVolumeScatter")
    vol.inputs["Density"].default_value = density
    vol.inputs["Anisotropy"].default_value = 0.62
    vol.inputs["Color"].default_value = (1.0, 0.86, 0.72, 1)
    out = _n(nt, "ShaderNodeOutputMaterial")
    nt.links.new(vol.outputs[0], out.inputs["Volume"])
    o.data.materials.append(m)
    o.visible_shadow = False
    return o


def build_birds(sc, nrs, count=11, centre=(-30.0, 140.0, 62.0)):
    """A loose flock of gulls in the glow: tiny bent wings (dark, a touch of sunlit edge)."""
    m = bpy.data.materials.new("wp_bird")
    m.use_nodes = True
    b = m.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.05, 0.04, 0.04, 1)
    b.inputs["Roughness"].default_value = 0.8
    for i in range(count):
        s = float(nrs.uniform(1.6, 2.6))
        flap = float(nrs.uniform(0.15, 0.6))
        verts = [(0, 0, 0), (-s, 0.9 * s, flap * s), (-s * 0.55, 0.0, 0.0), (-s, -0.9 * s, flap * s), (0.45 * s, 0, 0)]
        me = bpy.data.meshes.new("wp_gull")
        me.from_pydata(verts, [], [(0, 1, 2), (0, 2, 3), (0, 4, 1), (0, 3, 4)])
        me.update()
        o = bpy.data.objects.new("wp_gull", me)
        sc.collection.objects.link(o)
        o.location = (centre[0] + float(nrs.normal(0, 38)), centre[1] + float(nrs.normal(0, 20)), centre[2] + float(nrs.normal(0, 9)))
        o.rotation_euler = (0.0, float(nrs.normal(0, 0.12)), float(nrs.uniform(2.6, 3.3)))
        o.data.materials.append(m)
        o.visible_shadow = False


def build_fill(sc, sun_rot, sun_elev, strength):
    """A cool, shadowless fill from the side opposite the sun: the sky's light on the shaded faces (the world alone leaves them black)."""
    from mathutils import Vector
    old = bpy.data.objects.get("wp_fill")
    if old:
        bpy.data.objects.remove(old, do_unlink=True)
    if strength <= 0:
        return None
    sd = Vector(sun_direction(sun_rot, max(sun_elev, 2.0)))
    f = Vector((-sd.x, -sd.y, 0.55)).normalized()
    ld = bpy.data.lights.new("wp_fill", "SUN")
    ld.energy = strength
    ld.color = (0.55, 0.66, 1.0)
    ld.angle = math.radians(40)
    ld.use_shadow = False
    o = bpy.data.objects.new("wp_fill", ld)
    sc.collection.objects.link(o)
    o.rotation_euler = (-f).to_track_quat("-Z", "Y").to_euler()
    return o
