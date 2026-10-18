"""Build the six rigged, animated crew GLBs into public/models/crew (see docs/CREW.md, docs/BLENDER_PIPELINE.md).
Run inside Blender; exports only its own scratch objects and restores the open scene."""
import bpy, bmesh, math, os, json
import numpy as np
from mathutils import Vector, Quaternion, Euler

from pathlib import Path

# <repo>/tools/blender/make_crew.py -> <repo>/public/models/crew
OUT = str(Path(__file__).resolve().parents[2] / "public" / "models" / "crew").replace("\\", "/")
os.makedirs(OUT, exist_ok=True)
FPS = 24


def lin(h):
    def c(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    return (c((h >> 16) & 255), c((h >> 8) & 255), c(h & 255))


# ------------------------------------------------------------------ atlas
W = 256
RECT = {  # pixel rects (x0, y0, x1, y1), image origin bottom-left
    'plain': (0, 250, 6, 256),
    'face': (8, 136, 120, 248),
    'shirt_stripe': (130, 130, 190, 250),
    'shirt_plain': (194, 130, 254, 250),
    'pants': (2, 66, 126, 126),
    'leather': (2, 2, 126, 62),
    'hair': (130, 2, 190, 126),
    'hat': (194, 2, 254, 126),
}


def make_atlas(path):
    rng = np.random.default_rng(3)
    a = np.full((W, W), 0.9, np.float32)
    a[128:256, 0:128] = 0.92 - 0.04 * rng.random((128, 128))          # skin
    a[136:248, 8:120] = 0.95
    a[200:214, 28:46] = 0.10; a[200:214, 82:100] = 0.10               # eyes
    a[216:220, 24:50] = 0.45; a[216:220, 78:104] = 0.45               # brows
    a[152:160, 44:84] = 0.30                                          # mouth
    a[168:184, 58:70] = 0.80                                          # nose shade
    a[250:256, 0:6] = 0.95                                            # plain skin patch
    for y in range(128, 256):                                         # striped shirt
        a[y, 128:192] = 0.52 if (y // 8) % 2 == 0 else 0.96
    yy, xx = np.mgrid[128:256, 192:256]
    a[128:256, 192:256] = 0.90 + 0.06 * ((xx + yy) % 2)               # plain weave
    yy, xx = np.mgrid[64:128, 0:128]
    a[64:128, 0:128] = 0.86 + 0.10 * ((xx // 4) % 2) - 0.03 * rng.random((64, 128))   # pants
    a[0:64, 0:128] = 0.78 + 0.18 * rng.random((64, 128))              # leather
    a[30:34, 0:128] = 0.55
    for x in range(128, 192):                                         # hair strands
        a[0:128, x] = 0.65 + 0.3 * rng.random()
    a[0:128, 192:256] = 0.84 + 0.12 * rng.random((128, 64))           # felt
    a[100:106, 192:256] = 0.62
    img = bpy.data.images.new("crew_atlas", W, W, alpha=False)
    img.colorspace_settings.name = 'sRGB'
    rgba = np.dstack([a, a, a, np.ones_like(a)]).astype(np.float32)
    img.pixels.foreach_set(rgba.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG'
    img.save()
    img.pack()
    return img


def make_mat(name, color, img):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes["Principled BSDF"]
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    tex.interpolation = 'Closest'
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = 'RGBA'
    mix.blend_type = 'MULTIPLY'
    mix.inputs[0].default_value = 1.0
    mix.inputs[7].default_value = (*color, 1)
    nt.links.new(tex.outputs["Color"], mix.inputs[6])
    nt.links.new(mix.outputs[2], b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = 0.9
    return m


# ------------------------------------------------------------------ bones
BONES = ["Root", "Hips", "Spine", "Head",
         "UpperArm.L", "LowerArm.L", "UpperArm.R", "LowerArm.R",
         "UpperLeg.L", "LowerLeg.L", "UpperLeg.R", "LowerLeg.R"]


def levels(P):
    hs = P['hs']
    z = dict(ankle=0.09 * hs, knee=0.47 * hs, hip=0.90 * hs, sh=1.42 * hs)
    z['elbow'] = z['sh'] - 0.30 * hs
    z['wrist'] = z['elbow'] - 0.27 * hs
    z['head0'] = z['sh'] + 0.04 * hs
    z['head1'] = z['head0'] + P['hd'] * 1.06
    return z


def build_armature(P):
    z = levels(P)
    ad = bpy.data.armatures.new("CrewArmature")
    arm = bpy.data.objects.new("CrewArmature", ad)
    bpy.context.scene.collection.objects.link(arm)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.object.mode_set(mode='EDIT')
    eb = ad.edit_bones

    def bone(name, head, tail, parent=None):
        b = eb.new(name)
        b.head, b.tail = head, tail
        if parent:
            b.parent = eb[parent]

    ax = P['sh_w'] / 2 + P['arm_w'] * 0.5 - 0.01
    lx = P['hip_w'] * 0.27
    bone("Root", (0, 0, 0), (0, 0, 0.12))
    bone("Hips", (0, 0, z['hip']), (0, 0, z['hip'] + 0.10), "Root")
    bone("Spine", (0, 0, z['hip'] + 0.10), (0, 0, z['sh']), "Hips")
    bone("Head", (0, 0, z['sh']), (0, 0, z['head1']), "Spine")
    for s, n in ((1, 'L'), (-1, 'R')):
        bone(f"UpperArm.{n}", (s * ax, 0, z['sh'] - 0.03), (s * ax, 0, z['elbow']), "Spine")
        bone(f"LowerArm.{n}", (s * ax, 0, z['elbow']), (s * ax, 0, z['wrist'] - 0.06), f"UpperArm.{n}")
        bone(f"UpperLeg.{n}", (s * lx, 0, z['hip']), (s * lx, 0, z['knee']), "Hips")
        bone(f"LowerLeg.{n}", (s * lx, 0, z['knee']), (s * lx, 0, z['ankle']), f"UpperLeg.{n}")
    bpy.ops.object.mode_set(mode='OBJECT')
    return arm


# ------------------------------------------------------------------ pieces
def S(bone, cx, cy, z0, wb, db, wt, dt, h, uv, front=None):
    return dict(bone=bone, cx=cx, cy=cy, z0=z0, wb=wb, db=db, wt=wt, dt=dt, h=h, uv=uv, front=front)


def specs_lod0(P):
    z = levels(P)
    hs, hd = P['hs'], P['hd']
    shw, waw, belly = P['sh_w'], P['wa_w'], P['belly']
    hipw, aw, lw = P['hip_w'], P['arm_w'], P['leg_w']
    ax = shw / 2 + aw * 0.5 - 0.01
    lx = hipw * 0.27
    dep = 0.21
    shirt_uv = 'shirt_stripe' if P['stripes'] else 'shirt_plain'
    parts = {k: [] for k in ("Skin", "Shirt", "Pants", "Boots", "Belt", "Hair", "Hat")}
    sk, sh, pa, bo, be, ha, ht = (parts[k] for k in ("Skin", "Shirt", "Pants", "Boots", "Belt", "Hair", "Hat"))
    # skin
    sk.append(S("Head", 0, 0, z['head0'], hd * .95, hd * .95, hd, hd, hd * 1.06, 'plain', front='face'))
    sk.append(S("Head", 0, 0, z['sh'] - 0.02, .10, .10, .09, .09, .09 * hs + .04, 'plain'))
    for s, n in ((1, 'L'), (-1, 'R')):
        sk.append(S(f"LowerArm.{n}", s * ax, 0, z['wrist'] - 0.07, aw * .78, aw * .78, aw * .88, aw * .88,
                    z['elbow'] - z['wrist'] + 0.07, 'plain'))
        sk.append(S(f"LowerArm.{n}", s * ax, 0, z['wrist'] - 0.16, .075, .06, .085, .07, .10, 'plain'))
    # shirt
    sh.append(S("Spine", 0, 0, z['hip'] + 0.08 * hs, waw, dep * belly, shw, dep, z['sh'] - z['hip'] - 0.08 * hs, shirt_uv))
    for s, n in ((1, 'L'), (-1, 'R')):
        sh.append(S(f"UpperArm.{n}", s * ax, 0, z['elbow'], aw * .92, aw * .92, aw * 1.05, aw * 1.05,
                    z['sh'] - z['elbow'] + 0.01, shirt_uv))
    # pants
    pa.append(S("Hips", 0, 0, z['hip'] - 0.10 * hs, hipw, 0.23 * belly ** .5, waw * 1.03, 0.22 * belly ** .5,
                0.22 * hs, 'pants'))
    for s, n in ((1, 'L'), (-1, 'R')):
        pa.append(S(f"UpperLeg.{n}", s * lx, 0, z['knee'] - 0.02, lw * .9, lw * .95, lw, lw * 1.05,
                    z['hip'] - z['knee'] + 0.0, 'pants'))
        pa.append(S(f"LowerLeg.{n}", s * lx, 0, z['ankle'] + 0.02, lw * .82, lw * .85, lw * .9, lw * .92,
                    z['knee'] - z['ankle'] + 0.0, 'pants'))
    # boots
    for s, n in ((1, 'L'), (-1, 'R')):
        bo.append(S(f"LowerLeg.{n}", s * lx, 0, 0.0, lw * .95, lw * .95, lw * 1.0, lw * 1.0, z['ankle'] + 0.17 * hs, 'leather'))
        bo.append(S(f"LowerLeg.{n}", s * lx, -0.06, 0.0, lw * .92, 0.30, lw * .92, 0.24, z['ankle'] * .9, 'leather'))
    # belt
    be.append(S("Hips", 0, 0, z['hip'] + 0.06 * hs, waw * 1.06, dep * belly * 1.08, waw * 1.06, dep * belly * 1.08, 0.07, 'leather'))
    be.append(S("Hips", 0, -dep * belly * .55, z['hip'] + 0.055 * hs, .07, .02, .07, .02, .08, 'leather'))
    # hair
    top = z['head1']
    ha.append(S("Head", 0, 0.01, top - 0.10, hd * 1.05, hd * 1.05, hd * 1.03, hd * 1.03, 0.115, 'hair'))                # cap (short)
    ha.append(S("Head", 0, hd * .55, top - 0.21, hd * .98, 0.06, hd * .98, 0.06, 0.22, 'hair'))                       # back (long)
    for s in (1, -1):
        ha.append(S("Head", s * hd * .53, hd * .1, top - 0.24, 0.05, hd * .75, 0.05, hd * .75, 0.19, 'hair'))         # sides (long)
    ha.append(S("Head", 0, -hd * .52, z['head0'] + 0.01, hd * .85, 0.045, hd * .8, 0.05, hd * .40, 'hair'))            # beard
    # hats
    ht.append(S("Head", 0, 0, top - 0.04, hd * 1.9, hd * 1.9, hd * 1.8, hd * 1.8, 0.035, 'hat'))                      # wide brim
    ht.append(S("Head", 0, 0, top - 0.01, hd * 1.08, hd * 1.08, hd * 1.0, hd * 1.0, 0.10, 'hat'))                     # wide crown
    ht.append(S("Head", 0, 0, top - 0.065, hd * 1.08, hd * 1.08, hd * 1.08, hd * 1.08, 0.075, 'hat'))                  # bandana
    ht.append(S("Head", 0, hd * .58, top - 0.08, 0.06, 0.06, 0.04, 0.04, 0.07, 'hat'))                                # bandana knot
    ht.append(S("Head", 0, 0, top - 0.03, hd * 1.08, hd * 1.08, hd * 1.0, hd * 1.0, 0.09, 'hat'))                     # cap
    ht.append(S("Head", 0, -hd * .62, top - 0.03, hd * .8, 0.14, hd * .8, 0.12, 0.02, 'hat'))                         # cap visor
    return parts


# hat/hair sub-part membership by piece index within their lists
HAIR_SETS = {"Hair_Short": [0], "Hair_Long": [0, 1, 2, 3], "Beard": [4]}
HAT_SETS = {"Hat_Wide": [0, 1], "Hat_Bandana": [2, 3], "Hat_Cap": [4, 5]}


def specs_lod1(P):
    z = levels(P)
    base = specs_lod0(P)
    parts = {k: [] for k in ("Skin", "Shirt", "Pants", "Boots")}
    parts["Skin"] = [base["Skin"][0]] + [p for p in base["Skin"] if p['bone'].startswith("LowerArm") and p['h'] > 0.2]
    parts["Shirt"] = base["Shirt"]
    parts["Pants"] = base["Pants"]
    parts["Boots"] = [p for i, p in enumerate(base["Boots"]) if i % 2 == 1]
    return parts


def specs_lod2(P):
    z = levels(P)
    hs, hd = P['hs'], P['hd']
    shw, waw = P['sh_w'], P['wa_w']
    aw, lw, hipw = P['arm_w'], P['leg_w'], P['hip_w']
    ax = shw / 2 + aw * 0.5 - 0.01
    lx = hipw * 0.27
    shirt_uv = 'shirt_stripe' if P['stripes'] else 'shirt_plain'
    parts = {k: [] for k in ("Skin", "Shirt", "Pants")}
    parts["Skin"].append(S("Head", 0, 0, z['head0'], hd, hd, hd, hd, hd * 1.06, 'plain', front='face'))
    parts["Shirt"].append(S("Spine", 0, 0, z['hip'], waw, 0.22 * P['belly'], shw, 0.21, z['sh'] - z['hip'], shirt_uv))
    parts["Pants"].append(S("Hips", 0, 0, z['hip'] - 0.10 * hs, hipw, 0.23, waw, 0.22, 0.22 * hs, 'pants'))
    for s, n in ((1, 'L'), (-1, 'R')):
        parts["Shirt"].append(S(f"UpperArm.{n}", s * ax, 0, z['wrist'] - 0.05, aw * .9, aw * .9, aw, aw,
                                z['sh'] - z['wrist'] + 0.05, shirt_uv))
        parts["Pants"].append(S(f"UpperLeg.{n}", s * lx, 0, 0.0, lw * .9, lw * .95, lw, lw * 1.05, z['hip'] - 0.02, 'pants'))
    return parts


def uv_rect(name):
    x0, y0, x1, y1 = RECT[name]
    return (x0 / W, y0 / W, x1 / W, y1 / W)


def build_mesh(name, pieces, mat, arm, parent_empty):
    bm = bmesh.new()
    dl = bm.verts.layers.deform.verify()
    uvl = bm.loops.layers.uv.verify()
    recs = []
    for sp in pieces:
        hx, hy = sp['wb'] / 2, sp['db'] / 2
        tx, ty = sp['wt'] / 2, sp['dt'] / 2
        cx, cy, z0, h = sp['cx'], sp['cy'], sp['z0'], sp['h']
        pts = [(-hx, -hy, 0), (hx, -hy, 0), (hx, hy, 0), (-hx, hy, 0),
               (-tx, -ty, h), (tx, -ty, h), (tx, ty, h), (-tx, ty, h)]
        vs = [bm.verts.new((cx + x, cy + y, z0 + zz)) for x, y, zz in pts]
        gi = BONES.index(sp['bone'])
        for v in vs:
            v[dl][gi] = 1.0
        fs = [bm.faces.new(q) for q in (
            (vs[0], vs[1], vs[2], vs[3]), (vs[4], vs[5], vs[6], vs[7]),
            (vs[0], vs[1], vs[5], vs[4]), (vs[1], vs[2], vs[6], vs[5]),
            (vs[2], vs[3], vs[7], vs[6]), (vs[3], vs[0], vs[4], vs[7]))]
        recs.append((sp, vs, fs))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.normal_update()
    for sp, vs, fs in recs:
        xs = [v.co.x for v in vs]; ys = [v.co.y for v in vs]; zs = [v.co.z for v in vs]
        bb = (min(xs), max(xs), min(ys), max(ys), min(zs), max(zs))
        for f in fs:
            n = f.normal
            front = sp['front'] is not None and n.y < -0.5
            rect = uv_rect(sp['front'] if front else sp['uv'])
            for loop in f.loops:
                p = loop.vert.co
                if sp['uv'] == 'plain' and not front:
                    u, v = 0.5, 0.5
                else:
                    ax_ = max(range(3), key=lambda i: abs(n[i]))
                    if ax_ == 1:
                        a, b, a0, a1, b0, b1 = p.x, p.z, bb[0], bb[1], bb[4], bb[5]
                    elif ax_ == 0:
                        a, b, a0, a1, b0, b1 = p.y, p.z, bb[2], bb[3], bb[4], bb[5]
                    else:
                        a, b, a0, a1, b0, b1 = p.x, p.y, bb[0], bb[1], bb[2], bb[3]
                    u = (a - a0) / (a1 - a0) if a1 - a0 > 1e-6 else 0.5
                    v = (b - b0) / (b1 - b0) if b1 - b0 > 1e-6 else 0.5
                loop[uvl].uv = (rect[0] + u * (rect[2] - rect[0]), rect[1] + v * (rect[3] - rect[1]))
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    for p_ in me.polygons:
        p_.use_smooth = False
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    for bn in BONES:
        ob.vertex_groups.new(name=bn)
    md = ob.modifiers.new("Armature", 'ARMATURE')
    md.object = arm
    ob.parent = parent_empty
    return ob


# ------------------------------------------------------------------ animation
def rest_quat(arm, bname):
    return arm.data.bones[bname].matrix_local.to_3x3().to_quaternion()


def key_pose(arm, frame, pose):
    for bn in BONES:
        pb = arm.pose.bones[bn]
        pb.rotation_mode = 'QUATERNION'
        rx, ry, rz, loc = pose.get(bn, (0, 0, 0, (0, 0, 0)))
        rw = Euler((math.radians(rx), math.radians(ry), math.radians(rz)), 'XYZ').to_quaternion()
        rq = rest_quat(arm, bn)
        pb.rotation_quaternion = rq.inverted() @ rw @ rq
        pb.keyframe_insert("rotation_quaternion", frame=frame, group=bn)
        if bn == "Hips":
            rest3 = arm.data.bones[bn].matrix_local.to_3x3()
            pb.location = rest3.inverted() @ Vector(loc)
            pb.keyframe_insert("location", frame=frame, group=bn)


def gait(t, hs, A, K, Aa, elbow0, elbow_k, lean, bob, twist):
    p = 2 * math.pi * t
    pose = {}
    for side, ph in (("L", p), ("R", p + math.pi)):
        thigh = A * math.sin(ph)
        knee = K * max(0.0, math.cos(ph)) ** 1.3 + 0.1 * K
        arm_f = -Aa * math.sin(ph)
        pose[f"UpperLeg.{side}"] = (-thigh, 0, 0, (0, 0, 0))
        pose[f"LowerLeg.{side}"] = (knee, 0, 0, (0, 0, 0))
        pose[f"UpperArm.{side}"] = (-arm_f, 0, 0, (0, 0, 0))
        pose[f"LowerArm.{side}"] = (-(elbow0 + elbow_k * max(0.0, arm_f) / Aa), 0, 0, (0, 0, 0))
    pose["Hips"] = (0, 2.0 * math.sin(p), twist * math.sin(p), (0, 0, bob * hs * math.cos(2 * p)))
    pose["Spine"] = (lean, 0, -twist * 1.6 * math.sin(p), (0, 0, 0))
    pose["Head"] = (-lean * 0.6, 0, 0.8 * twist * math.sin(p), (0, 0, 0))
    return pose


def idle(t, hs):
    p = 2 * math.pi * t
    s, c = math.sin(p), math.cos(p)
    pose = {}
    for side, sg in (("L", -1), ("R", 1)):          # sg: outward is -ry for L, +ry for R
        pose[f"UpperArm.{side}"] = (-(2 * s + 2), sg * (3 + 1.0 * c), 0, (0, 0, 0))
        pose[f"LowerArm.{side}"] = (-(8 + 2 * c), 0, 0, (0, 0, 0))
        pose[f"UpperLeg.{side}"] = (0, 0, 0, (0, 0, 0))
        pose[f"LowerLeg.{side}"] = (1.5, 0, 0, (0, 0, 0))
    pose["Hips"] = (0, 0.8 * c, 0.8 * s, (0, 0, 0.004 * hs * s))
    pose["Spine"] = (1.2 * s, 0, -1.0 * s, (0, 0, 0))
    pose["Head"] = (1.5 * math.sin(p - 0.8), 0, 2.0 * c, (0, 0, 0))
    return pose


def make_actions(arm, hs):
    arm.animation_data_create()
    specs = [
        ("Idle", 48, 4, lambda t: idle(t, hs)),
        ("Walk", 24, 2, lambda t: gait(t, hs, 26, 48, 22, 14, 14, 3, 0.022, 4)),
        ("Run", 16, 2, lambda t: gait(t, hs, 48, 88, 52, 80, 14, 13, 0.06, 6)),
    ]
    for name, n, step, fn in specs:
        act = bpy.data.actions.new(name)
        act.use_fake_user = True
        arm.animation_data.action = act
        for f in range(0, n + 1, step):
            key_pose(arm, 1 + f, fn((f % n) / n))
    arm.animation_data.action = bpy.data.actions["Idle"]


# ------------------------------------------------------------------ variants
VARIANTS = {
    "Male_Standard": dict(hs=1.00, hd=0.235, sh_w=.44, wa_w=.36, belly=1.00, hip_w=.35, arm_w=.115, leg_w=.15, stripes=True,
                          shirt=0xB03A2E, pants=0x3B3B5C, skin=0xE0A878, hair=0x5A3A1E, hat=0x1F1F2E, parts=["Hair_Short", "Beard", "Hat_Wide"]),
    "Male_Broad": dict(hs=1.03, hd=0.24, sh_w=.54, wa_w=.40, belly=1.05, hip_w=.37, arm_w=.14, leg_w=.16, stripes=False,
                       shirt=0x2E5EAA, pants=0x5A4632, skin=0xC68642, hair=0x1B1B1B, hat=0x8B1E1E, parts=["Hair_Short", "Hat_Bandana"]),
    "Male_Stout": dict(hs=0.98, hd=0.24, sh_w=.48, wa_w=.48, belly=1.45, hip_w=.40, arm_w=.13, leg_w=.16, stripes=True,
                       shirt=0xE8E0C8, pants=0x2F4F4F, skin=0xF2C9A0, hair=0xB0B0B0, hat=0x6B4423, parts=["Beard", "Hat_Cap"]),
    "Female_Standard": dict(hs=0.94, hd=0.225, sh_w=.37, wa_w=.30, belly=1.00, hip_w=.36, arm_w=.10, leg_w=.14, stripes=False,
                            shirt=0x3E7D4A, pants=0x6B2D2D, skin=0xF2C9A0, hair=0xD8B45A, hat=0x8B1E1E, parts=["Hair_Long", "Hat_Bandana"]),
    "Female_Sturdy": dict(hs=0.99, hd=0.23, sh_w=.44, wa_w=.36, belly=1.10, hip_w=.40, arm_w=.12, leg_w=.155, stripes=True,
                          shirt=0xD4A017, pants=0x3B3B5C, skin=0x8D5524, hair=0x1B1B1B, hat=0x2E5EAA, parts=["Hair_Long", "Hat_Wide"]),
    "Female_Stout": dict(hs=0.93, hd=0.23, sh_w=.42, wa_w=.44, belly=1.38, hip_w=.42, arm_w=.12, leg_w=.15, stripes=False,
                         shirt=0x7B3F8C, pants=0x5A4632, skin=0xE0A878, hair=0xC0392B, hat=0x1F1F2E, parts=["Hair_Short", "Hat_Cap"]),
}

PALETTE = {
    "skin": [0xF2C9A0, 0xE0A878, 0xC68642, 0x8D5524, 0x5C3A21],
    "shirt": [0xB03A2E, 0x2E5EAA, 0xE8E0C8, 0x3E7D4A, 0xD4A017, 0x7B3F8C, 0x2B2B2B, 0xC96A1B],
    "pants": [0x3B3B5C, 0x5A4632, 0x8B7D5A, 0x2F4F4F, 0x6B2D2D],
    "hair": [0x1B1B1B, 0x5A3A1E, 0xA0522D, 0xD8B45A, 0xB0B0B0, 0xC0392B],
    "hat": [0x1F1F2E, 0x6B4423, 0x8B1E1E, 0x2E5EAA],
    "boots": [0x3A2616], "belt": [0x5A3A1E],
}


COLLS = ("objects", "meshes", "materials", "images", "actions", "armatures", "scenes")


def set_scene(sc):
    wins = bpy.context.window_manager.windows
    if wins:
        wins[0].scene = sc
        return True
    return False


def _build_variant(name, P):
    sc = bpy.context.scene
    sc.render.fps = FPS
    img = make_atlas(f"{OUT}/crew_atlas.png")
    mats = {
        "Skin": make_mat("Skin", lin(P['skin']), img),
        "Shirt": make_mat("Shirt", lin(P['shirt']), img),
        "Pants": make_mat("Pants", lin(P['pants']), img),
        "Boots": make_mat("Boots", lin(0x3A2616), img),
        "Belt": make_mat("Belt", lin(0x5A3A1E), img),
        "Hair": make_mat("Hair", lin(P['hair']), img),
        "Hat": make_mat("Hat", lin(P['hat']), img),
    }
    arm = build_armature(P)
    tris = {}
    lods = {"LOD0": specs_lod0(P), "LOD1": specs_lod1(P), "LOD2": specs_lod2(P)}
    for lod, parts in lods.items():
        emp = bpy.data.objects.new(lod, None)
        bpy.context.scene.collection.objects.link(emp)
        tris[lod] = 0
        for part, pieces in parts.items():
            if part == "Hair":
                groups = {k: [pieces[i] for i in idx] for k, idx in HAIR_SETS.items()}
                matn = "Hair"
            elif part == "Hat":
                groups = {k: [pieces[i] for i in idx] for k, idx in HAT_SETS.items()}
                matn = "Hat"
            else:
                groups = {part: pieces}
                matn = part
            for gname, gp in groups.items():
                if not gp:
                    continue
                ob = build_mesh(f"{lod}_{gname}", gp, mats[matn], arm, emp)
                counted = gname in P['parts'] or part not in ("Hair", "Hat")
                if counted:
                    tris[lod] += len(ob.data.polygons) * 2
    make_actions(arm, P['hs'])
    bpy.context.scene.frame_start, bpy.context.scene.frame_end = 1, 49
    path = f"{OUT}/{name}.glb"
    bpy.ops.object.select_all(action='DESELECT')
    for o in [o for o in bpy.data.objects if o not in BEFORE_OBJ]:
        o.select_set(True)
    bpy.context.view_layer.objects.active = arm
    bpy.ops.export_scene.gltf(filepath=path, export_format='GLB', use_selection=True, export_animations=True,
                              export_animation_mode='ACTIONS', export_skins=True, export_yup=True,
                              export_apply=False)
    return dict(file=f"{name}.glb", tris=tris, bytes=os.path.getsize(path), parts=P['parts'],
                height=round(levels(P)['head1'], 2))


BEFORE_OBJ = set()


def build_variant(name, P):
    """Build in the current scene, export only the crew objects, then remove what this call created
    and restore the user's frame range, fps and selection."""
    global BEFORE_OBJ
    sc = bpy.context.scene
    before = {k: set(getattr(bpy.data, k)) for k in COLLS}
    BEFORE_OBJ = before["objects"]
    saved = (sc.frame_start, sc.frame_end, sc.render.fps)
    sel = [o for o in bpy.context.selected_objects]
    act = bpy.context.view_layer.objects.active
    try:
        return _build_variant(name, P)
    finally:
        sc.frame_start, sc.frame_end, sc.render.fps = saved
        for k in COLLS:
            coll = getattr(bpy.data, k)
            for d in [d for d in coll if d not in before[k]]:
                try:
                    coll.remove(d)
                except Exception:
                    pass
        bpy.ops.object.select_all(action='DESELECT')
        for o in sel:
            if o.name in bpy.data.objects:
                o.select_set(True)
        if act is not None and act.name in bpy.data.objects:
            bpy.context.view_layer.objects.active = act


if __name__ == "__main__":
    meta = {}
    for n, P in VARIANTS.items():
        meta[n] = build_variant(n, P)
        print("BUILT", n, meta[n])
    meta_all = dict(
        fps=FPS, forward="+Z (glTF), character faces +Z, up +Y",
        animations={"Idle": [1, 49], "Walk": [1, 25], "Run": [1, 17]},
        lods=["LOD0", "LOD1", "LOD2"],
        hair_parts=list(HAIR_SETS), hat_parts=list(HAT_SETS),
        materials=["Skin", "Shirt", "Pants", "Boots", "Belt", "Hair", "Hat"],
        palette={k: ["#%06X" % c for c in v] for k, v in PALETTE.items()},
        variants=meta,
    )
    with open(f"{OUT}/crew.json", "w") as f:
        json.dump(meta_all, f, indent=2)
    print("CREW_DONE")
