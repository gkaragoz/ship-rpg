"""PBR ship builder: hull, deck, castles, rig, sails and details with baked textures (runs inside Blender).

`build_ship(spec, out_dir)` mirrors make_ships.build_ship for the flagship ids (see docs/BLENDER_PIPELINE.md):
unique hull/deck atlas + tiling wood and sail textures (numpy), vertex-baked AO, three LODs, one export.
Materials: `<id>_atlas`, `<id>_wood`, `<id>_sail`, `<id>_glass` (emissive), `<id>_flag` (tinted by the game).
"""
import random

import bmesh
import bpy
from mathutils import Vector

import pbrao
import pbrbody
import pbrcastle
import pbrdeck
import pbrdetail
import pbrguns
import pbrhull
import pbrlayout as LAY
import pbrmat
import pbrmesh
import pbrrig
import pbrsail
import pbrtex
from pbrmesh import PM
from shipbuilder import B, Mast
from shipkit import Scratch, emissive_material, empty, export_glb, tri_count, validate_ship

ATLAS_PX = {'tartane': 1024, 'brig': 1536}   # about 20 mm per texel along the hull on every ship (GPU memory: 3 maps x A^2 x 4 B x 1.33)
DEFAULT_ATLAS_PX = 2048
TILE_PX = 512

CFG = {
    0: dict(stations=48, segs=28, detail=True, shrouds=True, ratlines=True, top=True, stays=True, seg=8, castle_stations=8,
            sail_nx=14, sail_ny=10, jib_seg=8, ao_rays=10),
    1: dict(stations=22, segs=14, detail=False, shrouds=False, ratlines=False, top=False, stays=False, seg=5, castle_stations=3,
            sail_nx=5, sail_ny=4, jib_seg=3, ao_rays=6),
    2: dict(stations=8, segs=6, detail=False, shrouds=False, ratlines=False, top=False, stays=False, seg=3, castle_stations=1,
            sail_nx=2, sail_ny=2, jib_seg=1, ao_rays=0),
}


def budgets(length):
    """Triangle ceilings of the PBR ships (they grow with the ship); tests/assets.test.ts recomputes the same."""
    return {"LOD0": int(8000 + 700 * length), "LOD1": int(600 + 95 * length), "LOD2": int(300 + 35 * length)}


def to_object(pm, name, mat, parent, shift=(0, 0, 0)):
    bm = pm.bm
    if any(shift):
        bmesh.ops.translate(bm, vec=-Vector(shift), verts=bm.verts)
    me = bpy.data.meshes.new(name)
    bm.to_mesh(me)
    bm.free()
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    ob.parent = parent
    return ob


def _ntri(kit):
    return {k: sum(len(f.verts) - 2 for f in pm.bm.faces) for k, pm in (('atlas', kit.atlas), ('wood', kit.wood))}


def build_lod(level, spec, masts, mats, root, A, seed):
    cfg = CFG[level]
    if level == 0 and spec['length'] < 20:           # small ships have fewer parts, so give the hull more rings
        cfg = dict(cfg, stations=64, segs=36)
    rng = random.Random(seed)
    kit = pbrbody.Kit(spec, cfg, A, rng, PM)
    lod = empty(f"LOD{level}", root)
    detail = cfg['detail']
    prof = []

    def step(name, fn, *a):
        before = _ntri(kit)
        out = fn(*a)
        after = _ntri(kit)
        prof.append((name, after['atlas'] - before['atlas'], after['wood'] - before['wood']))
        return out

    kit.step = step
    step('hull', pbrbody.hull, kit)
    step('deck', pbrbody.deck, kit)
    step('bulwarks', pbrbody.bulwarks, kit)
    if detail:
        step('wales', pbrbody.wales, kit)
    step('keel', pbrbody.keel, kit)
    for lv in pbrcastle.castle_levels(spec):
        step('castle', pbrcastle.castle, kit, *lv)
    step('stern', pbrcastle.stern_wall, kit)
    step('quarter', pbrcastle.quarter_galleries, kit)
    tallest = max((m.m['height'] for m in masts), default=0)
    for mast in masts:
        step('mast', pbrrig.mast_static, kit, mast, mast.m['height'] == tallest)
        if mast.m['height'] == tallest and detail:
            h = mast.m['height']
            pbrrig.flag_cloth(kit.flag, mast.w((0, h, 0)), (-max(1.5, h * 0.14), -0.1, 0), max(0.5, h * 0.025), 0.2, taper=0.9)
    pbrdetail.build(kit, masts, tallest, level)
    step('stays', pbrrig.stays, kit, masts)
    step('bowsprit', pbrrig.bowsprit, kit, masts)
    lantern = pbrdeck.build(kit, masts, level)
    step('guns', pbrguns.build, kit)

    for pm in kit.pms():
        pm.weld()
    groups = []
    for i, mast in enumerate(masts):
        for kind, sail, spar in pbrsail.sail_groups(kit, mast):
            sail.weld()
            spar.weld()
            groups.append((i, kind, sail, spar))
    if cfg['ao_rays']:
        pbrao.bake_vertex_ao([kit.atlas, kit.wood], [g[2] for g in groups] + [g[3] for g in groups] + [kit.jib],
                             rays=cfg['ao_rays'], dist=2.0 + 0.04 * spec['length'])
    pbrdeck.stern_ensign(kit)
    if level == 0:
        print('  PROFILE', ' | '.join(f'{n}:{a}/{w}' for n, a, w in prof))
    to_object(kit.atlas, f"LOD{level}_Body", mats['atlas'], lod)
    if not kit.wood.empty:
        to_object(kit.wood, f"LOD{level}_Wood", mats['wood'], lod)
    else:
        kit.wood.bm.free()
    for pm, name, mat in ((kit.jib, f"LOD{level}_Jib", mats['sail']), (kit.flag, f"LOD{level}_Flag", mats['flag']),
                          (kit.glass, "LOD0_Glass", mats['glass'])):
        if not pm.empty:
            to_object(pm, name, mat, lod)
        else:
            pm.bm.free()
    for i, kind, sail, spar in groups:
        base = B(masts[i].base)
        pivot = empty(f"LOD{level}_m{i}_trim-{kind}", lod, base)
        to_object(sail, f"LOD{level}_m{i}_{kind.capitalize()}Sail", mats['sail'], pivot, shift=base)
        to_object(spar, f"LOD{level}_m{i}_{kind.capitalize()}Yards", mats['wood'], pivot, shift=base)
    return lantern, kit.extra


_TILES = {}


def tiles():
    if not _TILES:
        _TILES['wood'] = pbrtex.wood_tile(TILE_PX)
        _TILES['sail'] = pbrtex.sail_tile(TILE_PX)
    return _TILES


def seed_of(spec_id):
    return sum(ord(c) * (i + 3) for i, c in enumerate(spec_id)) % 9973


def build_ship(spec, make_meta, out_dir, budget_fn=budgets):
    """Build one PBR ship, export it and return the meta dict. `make_meta` is make_ships.build_meta."""
    sid = spec['id']
    A = ATLAS_PX.get(sid) or (1024 if spec['length'] <= 20 else 1536 if spec['length'] < 40 else DEFAULT_ATLAS_PX)
    budget = budget_fn(spec['length'])
    atlas_tex = pbrhull.build_atlas(spec, A, seed_of(sid))
    t = tiles()
    with Scratch() as sc:
        group = pbrmat.occlusion_group()
        mats = dict(
            atlas=pbrmat.pbr_material(f"{sid}_atlas", atlas_tex, group, extension='EXTEND'),
            wood=pbrmat.pbr_material(f"{sid}_wood", t['wood'], group),
            sail=pbrmat.pbr_material(f"{sid}_sail", t['sail'], group),
            glass=emissive_material(f"{sid}_glass", (1.0, 0.82, 0.48), 3.0),
        )
        flag = bpy.data.materials.new(f"{sid}_flag")
        flag.use_nodes = True
        flag.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.75, 0.22, 0.17, 1)
        mats['flag'] = flag
        root = empty(sid)
        masts = [Mast(spec, m) for m in spec['masts']]
        lantern, extra = None, []
        for level in (0, 1, 2):
            got, more = build_lod(level, spec, masts, mats, root, A, seed_of(sid) + level)
            lantern = lantern or got
            extra = extra or more
        objs = sc.new_objects()
        lods = {}
        for level in (0, 1, 2):
            meshes = [o for o in objs if o.type == 'MESH' and o.name.startswith(f"LOD{level}_")]
            lods[f"LOD{level}"] = dict(tris=sum(tri_count(o) for o in meshes), meshes=len(meshes), drawCalls=len(meshes))
        report = dict(
            lods=lods,
            materials=len({m.name for o in objs if o.type == 'MESH' for m in o.data.materials}),
            names=[o.name for o in objs],
            has_trim_pivot=all(any(o.name.startswith(f"LOD{l}_") and "_trim-" in o.name for o in objs) for l in (0, 1, 2)),
        )
        print("  LOD0 meshes", {o.name: tri_count(o) for o in objs if o.type == 'MESH' and o.name.startswith("LOD0_")})
        print(f"PBR {sid} tris", {k: v['tris'] for k, v in lods.items()}, "budget", budget)
        validate_ship(report, budget, max_materials=5)
        size = export_glb(out_dir / f"{sid}.glb", objs, root, pbr=True)
        meta = make_meta(spec, masts, report, lantern, budget, extra)
        meta.update(bytes=size, pbr=True, atlasPx=A, tilePx=TILE_PX)
    return meta
