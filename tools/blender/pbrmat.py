"""Blender images and glTF-friendly PBR materials from numpy texture sets (runs inside Blender).

Material layout the glTF exporter understands (and three.js MeshStandardMaterial reads back): base colour =
albedo texture x vertex colour `Col`, normal map, and one ORM image (R occlusion via the `glTF Material Output`
group, G roughness, B metalness).
"""
import bpy
import numpy as np


def make_image(name, arr, colorspace):
    h, w, _ = arr.shape
    im = bpy.data.images.new(name, w, h, alpha=False)
    im.colorspace_settings.name = colorspace
    px = np.ones((h, w, 4), np.float32)
    px[..., :3] = arr
    im.pixels.foreach_set(px.ravel())
    im.pack()
    return im


def occlusion_group():
    g = bpy.data.node_groups.new('glTF Material Output', 'ShaderNodeTree')
    g.interface.new_socket('Occlusion', in_out='INPUT', socket_type='NodeSocketFloat')
    return g


def pbr_material(name, textures, group, extension='REPEAT', vertex_color=True):
    """`textures` = dict(albedo, normal, orm) of numpy arrays. Returns the material."""
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    imgs = dict(
        albedo=make_image(f"{name}_albedo", textures['albedo'], 'sRGB'),
        normal=make_image(f"{name}_normal", textures['normal'], 'Non-Color'),
        orm=make_image(f"{name}_orm", textures['orm'], 'Non-Color'),
    )

    def tex(key):
        n = nt.nodes.new("ShaderNodeTexImage")
        n.image = imgs[key]
        n.extension = extension
        return n

    ta = tex('albedo')
    if vertex_color:
        vc = nt.nodes.new("ShaderNodeVertexColor")
        vc.layer_name = "Col"
        mx = nt.nodes.new("ShaderNodeMix")
        mx.data_type = 'RGBA'
        mx.blend_type = 'MULTIPLY'
        mx.inputs[0].default_value = 1.0
        nt.links.new(ta.outputs['Color'], mx.inputs[6])
        nt.links.new(vc.outputs['Color'], mx.inputs[7])
        nt.links.new(mx.outputs[2], b.inputs['Base Color'])
    else:
        nt.links.new(ta.outputs['Color'], b.inputs['Base Color'])
    tn = tex('normal')
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nt.links.new(tn.outputs['Color'], nm.inputs['Color'])
    nt.links.new(nm.outputs['Normal'], b.inputs['Normal'])
    to = tex('orm')
    sp = nt.nodes.new("ShaderNodeSeparateColor")
    nt.links.new(to.outputs['Color'], sp.inputs['Color'])
    nt.links.new(sp.outputs['Green'], b.inputs['Roughness'])
    nt.links.new(sp.outputs['Blue'], b.inputs['Metallic'])
    gn = nt.nodes.new('ShaderNodeGroup')
    gn.node_tree = group
    nt.links.new(sp.outputs['Red'], gn.inputs['Occlusion'])
    return m
