"""Build GLB ships (3 LODs each) from tools/blender/ships.json into public/models/ships.

Run inside Blender (see docs/BLENDER_PIPELINE.md). The wrapper may set `IDS` (a list of ship ids) in
the globals it passes to exec(); the default is all 16 ships (make_tartane.py is the legacy
hand-tuned tartane, kept as a reference only). Each ship is built in a scratch scope: nothing of the open scene is touched.

Node contract (docs/SHIP_ASSETS.md): `<id>` root > `LOD0|1|2` > `LODn_Body`, `LODn_m<i>_trim-square|aft`
pivots (sails as children), `LOD0_Glass` (emissive windows and lanterns).
"""
import importlib
import json
import pathlib
import sys

import bpy

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import shipkit  # noqa: E402
import shipbuilder  # noqa: E402
import shipdetails  # noqa: E402

importlib.reload(shipkit)
importlib.reload(shipbuilder)
importlib.reload(shipdetails)
from shipkit import Atlas, MB, Scratch, emissive_material, empty, export_glb, fnv1a, tri_count, validate_ship, write_json  # noqa: E402
from shipbuilder import B, LOD_CFG, Mast  # noqa: E402

REPO = HERE.parents[1]
OUT = REPO / "public" / "models" / "ships"
SPECS = {s['id']: s for s in json.loads((HERE / "ships.json").read_text(encoding="utf-8"))}


def budgets(length):
    """Triangle ceilings per LOD; they grow with the ship so a battleship may be richer than a yacht."""
    return {"LOD0": int(1700 + 140 * length), "LOD1": int(160 + 20 * length), "LOD2": int(60 + 6 * length)}


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def lin_to_srgb(c):
    return 12.92 * c if c <= 0.0031308 else 1.055 * (c ** (1 / 2.4)) - 0.055


def darker(hex_color, factor):
    """Scale a colour in linear space like THREE.Color.multiplyScalar, return an sRGB hex."""
    out = 0
    for shift in (16, 8, 0):
        c = srgb_to_lin(((hex_color >> shift) & 255) / 255)
        out |= round(min(max(lin_to_srgb(c * factor), 0), 1) * 255) << shift
    return out


def swatches(spec):
    return dict(hull=spec['hullColor'], hull_lower=darker(spec['hullColor'], 0.5), trim=spec['trimColor'],
                deck=0xB08A58, wood=0x4A3321, sail=0xEFE6CF, dark=0x140E08, flag=0xC0392B, iron=0x3A3A40)


def build_lod(level, spec, masts, atlas, mat, glass_mat, flag_mat, root):
    cfg = LOD_CFG[level]
    lod = empty(f"LOD{level}", root)
    body = MB(atlas)
    flags = MB(atlas)   # pennants and the ensign: their own mesh and material so the game can tint them per nation
    shipbuilder.build_hull(body, spec, level, cfg)
    shipbuilder.build_deck(body, spec, cfg)
    if cfg['rail']:
        shipbuilder.build_rail(body, spec, cfg)
    shipbuilder.build_castles(body, spec, cfg)
    tallest = max((m.m['height'] for m in masts), default=0)
    for mast in masts:
        shipbuilder.build_mast_static(body, mast, cfg, mast.m['height'] == tallest, flags)
    shipbuilder.build_stays(body, spec, masts, cfg)
    shipbuilder.build_bowsprit(body, spec, masts, cfg)
    if cfg['ports']:
        shipbuilder.build_ports(body, spec)
    if cfg['oars']:
        shipbuilder.build_oars(body, spec)
    extra = shipdetails.build_hero(body, spec, masts, cfg, flags) if cfg['hero'] else []
    body.to_object(f"LOD{level}_Body", mat, lod)
    if flags.bm.faces:
        flags.to_object(f"LOD{level}_Flag", flag_mat, lod)
    else:
        flags.bm.free()

    pivots = 0
    for i, mast in enumerate(masts):
        for kind, mb in shipbuilder.build_sails(mast, cfg, atlas):
            base = B(mast.base)
            pivot = empty(f"LOD{level}_m{i}_trim-{kind}", lod, base)
            mb.to_object(f"LOD{level}_m{i}_{kind.capitalize()}Sail", mat, pivot, shift=base, smooth=True)
            pivots += 1

    lantern = None
    if cfg['glass']:
        glass = MB(atlas)
        lantern = shipbuilder.build_glass(glass, spec)
        if glass.bm.faces:
            glass.to_object("LOD0_Glass", glass_mat, lod)
        else:
            glass.bm.free()
    return lantern, extra


def spec_hash(spec):
    """Ties a GLB to the spec it was built from; tests/assets.test.ts recomputes it from specs.ts."""
    return fnv1a(json.dumps(spec, sort_keys=True, separators=(',', ':'), ensure_ascii=False))


def build_meta(spec, masts, report, lantern, budget, extra):
    L = spec['length']
    deck = []
    for i in range(15):
        t = i / 14
        deck.append([round((t - 0.5) * L, 3), round(shipbuilder.deck_height(spec, t) - shipbuilder.bulwark(spec), 3),
                     round(max(0.0, shipbuilder.half_beam(spec, t) * 0.95 - 0.3), 3)])
    obstacles = [dict(type="circle", x=round(m.base[0], 3), z=0.0, r=round(0.35 + 0.01 * m.m['height'], 3)) for m in masts]
    for key, sign in (('sterncastle', 1), ('forecastle', -1)):
        c = spec.get(key)
        if c:
            run = c['length'] * L + 0.3
            x0, x1 = (-L / 2 - 1, -L / 2 + run) if sign == 1 else (L / 2 - run, L / 2 + 1)
            obstacles.append(dict(type="rect", x0=round(x0, 3), x1=round(x1, 3), z0=-50, z1=50))
    obstacles += extra
    first = masts[0].base if masts else (0.0, 0.0, 0.0)
    lantern = lantern or (-L / 2, shipbuilder.deck_height(spec, 0), 0.0)
    return dict(id=spec['id'], length=L, beam=spec['beam'], lods=report['lods'], budgets=budget,
                specHash=spec_hash(spec), trimPivot=[round(first[0], 3), round(first[1], 3), 0.0], deckMargin=0.3,
                deck=dict(columns=["x", "y", "halfWidth"], stations=deck), obstacles=obstacles,
                lantern=[round(c, 3) + 0.0 for c in lantern])


def build_ship(spec_id):
    spec = SPECS[spec_id]
    OUT.mkdir(parents=True, exist_ok=True)
    budget = budgets(spec['length'])
    with Scratch() as sc:
        atlas = Atlas(f"{spec_id}_atlas", swatches(spec))
        mat = atlas.material(f"{spec_id}_atlas_mat")
        glass_mat = emissive_material(f"{spec_id}_glass", (1.0, 0.82, 0.48), 3.0)
        flag_mat = bpy.data.materials.new(f"{spec_id}_flag")
        flag_mat.diffuse_color = (0.75, 0.22, 0.17, 1)
        flag_mat.use_nodes = True
        flag_mat.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.75, 0.22, 0.17, 1)
        root = empty(spec_id)
        masts = [Mast(spec, m) for m in spec['masts']]
        lantern, extra = None, []
        for level in (0, 1, 2):
            got, more = build_lod(level, spec, masts, atlas, mat, glass_mat, flag_mat, root)
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
        validate_ship(report, budget, max_materials=3)
        atlas.save(OUT / f"{spec_id}_atlas.png")
        size = export_glb(OUT / f"{spec_id}.glb", objs, root)
        meta = build_meta(spec, masts, report, lantern, budget, extra)
        meta['bytes'] = size
        write_json(OUT / f"{spec_id}.meta.json", meta)
    return meta


IDS = globals().get("IDS") or list(SPECS)
BUILT = {}
for _id in IDS:
    BUILT[_id] = build_ship(_id)
RESULT = {i: {"bytes": m["bytes"], "tris": [m["lods"][f"LOD{l}"]["tris"] for l in (0, 1, 2)]} for i, m in BUILT.items()}
print("SHIPS_DONE", RESULT)
