"""Build the Tartane ship with three LODs and export public/models/ships/tartane.glb (+ .meta.json).

Run inside Blender; see docs/BLENDER_PIPELINE.md. The ship is described by data (SHIP) and the
LOD ladder by LOD_CFG, so another ship is a new data block plus builders for its rig.

Node contract (checked by tests/assets.test.ts and by validate_ship here):
  tartane                      root empty
    LOD0 / LOD1 / LOD2         one empty per LOD; the game toggles .visible
      LODn_Body                static hull, deck, mast, rigging, jib ... (atlas material)
      LODn_trim-aft            pivot at the mast axis; the game rotates / scales it for sail trim
        LODn_AftSail           yard + lateen sail, pivot-local (atlas material)
      LOD0_LanternGlass        emissive lantern (LOD0 only)
"""
import importlib
import math
import pathlib
import sys

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import shipkit  # noqa: E402

importlib.reload(shipkit)  # Blender keeps modules alive between runs
from shipkit import Atlas, MB, Scratch, emissive_material, empty, export_glb, tri_count, validate_ship, write_json  # noqa: E402

REPO = HERE.parents[1]
OUT = REPO / "public" / "models" / "ships"

SHIP = dict(
    id="tartane", L=12.0, B=3.96, D=1.2, F=1.35, S=0.7,
    hb=[0.55, 0.72, 0.86, 0.95, 1.0, 1.0, 0.97, 0.9, 0.8, 0.68, 0.54, 0.4, 0.27, 0.15, 0.04],
    kd=[0.35, 0.55, 0.75, 0.9, 1.0, 1.0, 1.0, 0.95, 0.85, 0.7, 0.55, 0.4, 0.28, 0.18, 0.1],
    mast=(0.96, 1.3, 11.0), mast_r=(0.12, 0.06),
    yard=((5.0, 0.2, 2.6), (-3.2, 0.2, 11.4)), yard_r=(0.07, 0.04),
    clew=(-3.8, 0.2, 3.0), belly=0.7,
    bowsprit=((5.0, 0.0, 2.0), (8.0, 0.0, 2.9)),
    jib=((7.9, 0.0, 2.85), (1.1, 0.0, 8.6), (4.6, 0.0, 2.4)), jib_belly=-0.4,
    pivot=(0.96, 0.0, 1.35),
    lantern=(-5.9, 0.5, 2.93),
)
SWATCHES = dict(hull=0x5A3B20, deck=0x9C7A4E, seam=0x2E1E10, wood=0x7A5230,
                trim=0xD9C28A, iron=0x3A3A40, sail=0xE8D9B5, rope=0x2A1E14)
BUDGETS = {"LOD0": 2000, "LOD1": 450, "LOD2": 130}

LOD_CFG = {
    0: dict(stations=list(range(15)), us=[k / 6 for k in range(7)], wale_band=None, seg=6, caps=True,
            rail=True, seams=True, wale=True, rivets=True, props=True, anchor=True, lantern=True,
            stays=True, shrouds=(4, 4), sail_n=8, jib_n=6),
    1: dict(stations=[0, 2, 4, 6, 8, 10, 12, 14], us=[0, 0.4, 0.8, 0.9, 1.0], wale_band=(0.8, 0.9), seg=6, caps=True,
            rail=False, seams=False, wale=False, rivets=False, props='lite', anchor=False, lantern=False,
            stays=True, shrouds=(4, 3), sail_n=4, jib_n=3),
    2: dict(stations=[0, 3, 7, 11, 14], us=[0, 0.7, 0.88, 1.0], wale_band=(0.7, 0.88), seg=4, caps=False,
            rail=False, seams=False, wale=False, rivets=False, props=False, anchor=False, lantern=False,
            stays=False, shrouds=None, sail_n=2, jib_n=1),
}


def station(i):
    s = SHIP
    t = i / 14
    return -s['L'] / 2 + s['L'] * t, s['hb'][i] * s['B'] / 2, s['F'] + s['S'] * (2 * t - 1) ** 2, s['D'] * s['kd'][i]


def ring_pt(i, u, sd, off=0.0):
    x, hw, dz, kl = station(i)
    a = u * math.pi / 2
    return (x, sd * (hw * math.sin(a) + off), -kl + (dz + kl) * (1 - math.cos(a)) ** 1.5)


def build_hull(mb, cfg):
    stas, us = cfg['stations'], cfg['us']
    K = len(us) - 1
    rings = [[mb.v(ring_pt(i, us[abs(j - K)], (j > K) - (j < K))) for j in range(2 * K + 1)] for i in stas]
    fs = []
    for a in range(len(stas) - 1):
        for j in range(2 * K):
            ka, kb = sorted((abs(j - K), abs(j + 1 - K)))
            wale = cfg['wale_band'] is not None and (us[ka], us[kb]) == cfg['wale_band']
            fs.append(mb.face((rings[a][j], rings[a][j + 1], rings[a + 1][j + 1], rings[a + 1][j]),
                              'trim' if wale else 'hull'))
    fs += [mb.face(rings[0], 'hull'), mb.face(rings[-1], 'hull')]
    mb.outward(fs)


def build_deck(mb, cfg):
    rows = []
    for i in cfg['stations']:
        x, hw, dz, _ = station(i)
        rows.append((mb.v((x, -hw * 0.97, dz - 0.04)), mb.v((x, hw * 0.97, dz - 0.04))))
    for a in range(len(rows) - 1):
        (l0, r0), (l1, r1) = rows[a], rows[a + 1]
        mb.face((l0, l1, r1, r0), 'deck')


def build_rail(mb):
    for sd in (1, -1):
        rr = []
        for i in range(15):
            x, hw, dz, _ = station(i)
            ins = hw - min(0.08, hw * 0.5)
            rr.append([mb.v((x, sd * ins, dz)), mb.v((x, sd * hw, dz)), mb.v((x, sd * hw, dz + 0.35)), mb.v((x, sd * ins, dz + 0.35))])
        fs = [mb.face((rr[i][k], rr[i][(k + 1) % 4], rr[i + 1][(k + 1) % 4], rr[i + 1][k]), 'trim')
              for i in range(14) for k in range(4)]
        fs += [mb.face(rr[0], 'trim'), mb.face(rr[14][::-1], 'trim')]
        mb.outward(fs)


def build_seams(mb):
    for fr in (-0.75, -0.5, -0.25, 0.0, 0.25, 0.5, 0.75):
        prev = None
        for i in range(15):
            x, hw, dz, _ = station(i)
            y, z = fr * hw * 0.97, dz - 0.03
            cur = (mb.v((x, y - 0.012, z)), mb.v((x, y + 0.012, z)))
            if prev:
                mb.face((prev[0], cur[0], cur[1], prev[1]), 'seam')
            prev = cur


def hull_band(mb, u0, u1, off, swatch):
    for sd in (1, -1):
        prev = None
        for i in range(15):
            cur = (mb.v(ring_pt(i, u0, sd, off)), mb.v(ring_pt(i, u1, sd, off)))
            if prev:
                f = (prev[0], cur[0], cur[1], prev[1])
                mb.face(f if sd < 0 else f[::-1], swatch)
            prev = cur


def build_props(mb, lite):
    mb.box((-6.15, 0, 0.7), (0.3, 0.08, 3.4), 'wood')                 # rudder
    mb.box((-5.65, 0, 2.4), (1.2, 0.07, 0.07), 'wood')                # tiller
    mb.box((1.0, 0, 1.48), (1.0, 0.9, 0.24), 'wood')                  # hatch coaming
    if not lite:
        for x, y in ((-2.0, 0.7), (-2.0, -0.7), (-1.4, 0.0)):         # barrels
            mb.spar((x, y, 1.43), (x, y, 1.93), 0.22, 0.22, 'wood', seg=10)


def build_anchor(mb):
    mb.spar((2.6, -0.3, 1.62), (3.9, -0.3, 1.62), 0.035, 0.035, 'iron')
    mb.spar((2.75, -0.65, 1.62), (2.75, 0.05, 1.62), 0.025, 0.025, 'iron')
    mb.spar((3.9, -0.3, 1.62), (3.6, -0.7, 1.62), 0.03, 0.03, 'iron')
    mb.spar((3.9, -0.3, 1.62), (3.6, 0.1, 1.62), 0.03, 0.03, 'iron')
    mb.box((3.55, -0.72, 1.62), (0.12, 0.12, 0.03), 'iron')
    mb.box((3.55, 0.12, 1.62), (0.12, 0.12, 0.03), 'iron')


def build_lantern_frame(mb):
    lx, ly, _ = SHIP['lantern']
    mb.spar((lx, ly, 2.0), (lx, ly, 2.75), 0.025, 0.025, 'iron')
    mb.box((lx, ly, 2.77), (0.24, 0.24, 0.04), 'iron')
    mb.box((lx, ly, 3.09), (0.24, 0.24, 0.04), 'iron')


def build_rigging(mb, cfg):
    mx, mz0, mz1 = SHIP['mast']
    seg = cfg['seg']
    mb.spar((mx, 0, mz0), (mx, 0, mz1), SHIP['mast_r'][0], SHIP['mast_r'][1], 'wood', seg=seg, caps=cfg['caps'])
    mb.spar(*SHIP['bowsprit'], 0.08, 0.05, 'wood', seg=seg, caps=cfg['caps'])
    if cfg['stays']:
        for a, b in (((mx, 0, 10.9), (7.9, 0, 2.85)), ((mx, 0, 10.9), (-5.9, 0, 2.3))):
            mb.spar(a, b, 0.015, 0.015, 'rope', seg=4)
    if cfg['shrouds']:
        n, sseg = cfg['shrouds']
        offs = (-0.3, 0.3) if n == 4 else (0.0,)
        for sd in (1, -1):
            for dx in offs:
                mb.spar((mx + dx, 0, 9.0), (mx - 0.06 + dx, sd * 1.6, 1.45), 0.015, 0.015, 'rope', seg=sseg)
    jib_n = cfg['jib_n']
    mb.tri_sail(*SHIP['jib'], jib_n, SHIP['jib_belly'], 'sail')


def build_aft_sail(mb, cfg):
    p0, p1 = SHIP['yard']
    from mathutils import Vector
    d = Vector(p1) - Vector(p0)
    mb.spar(p0, p1, SHIP['yard_r'][0], SHIP['yard_r'][1], 'wood', seg=cfg['seg'], caps=cfg['caps'])
    mb.tri_sail(Vector(p0) + 0.03 * d, Vector(p0) + 0.97 * d, SHIP['clew'], cfg['sail_n'], SHIP['belly'], 'sail')


def build_lod(level, atlas, mat, glass_mat, root):
    cfg = LOD_CFG[level]
    lod = empty(f"LOD{level}", root)
    body = MB(atlas)
    build_hull(body, cfg)
    build_deck(body, cfg)
    if cfg['rail']:
        build_rail(body)
    if cfg['seams']:
        build_seams(body)
    if cfg['wale']:
        hull_band(body, 0.80, 0.90, 0.02, 'trim')
        for u in (0.25, 0.45, 0.65):
            hull_band(body, u - 0.008, u + 0.008, 0.008, 'seam')
    if cfg['rivets']:
        for i in range(1, 14):
            for sd in (1, -1):
                body.box(ring_pt(i, 0.85, sd, 0.035), (0.045, 0.045, 0.045), 'iron')
    if cfg['props']:
        build_props(body, cfg['props'] == 'lite')
    if cfg['anchor']:
        build_anchor(body)
    if cfg['lantern']:
        build_lantern_frame(body)
    build_rigging(body, cfg)
    body.to_object(f"LOD{level}_Body", mat, lod)

    pivot = empty(f"LOD{level}_trim-aft", lod, SHIP['pivot'])
    sail = MB(atlas)
    build_aft_sail(sail, cfg)
    sail.to_object(f"LOD{level}_AftSail", mat, pivot, shift=SHIP['pivot'])

    if cfg['lantern']:
        glass = MB(atlas)
        lx, ly, lz = SHIP['lantern']
        glass.box((lx, ly, lz), (0.16, 0.16, 0.24), 'sail')
        glass.to_object("LOD0_LanternGlass", glass_mat, lod)
    return lod


def game_xz(x, y):
    """Blender (x, y) -> game ship-local (x, z); +z is starboard = Blender -y."""
    return round(x, 3), round(-y, 3) + 0.0   # + 0.0 turns -0.0 into 0.0


def build_meta(report):
    deck = []
    for i in range(15):
        x, hw, dz, _ = station(i)
        # Walkable half-width: deck edge minus the rail margin; 0 where the bow is too narrow to stand.
        deck.append([round(x, 3), round(dz - 0.04, 3), round(max(0.0, hw * 0.97 - 0.15), 3)])
    ob = []
    mx = SHIP['mast'][0]
    ob.append(dict(type="circle", x=mx, z=0.0, r=0.3))
    ob.append(dict(type="rect", x0=0.45, x1=1.55, z0=-0.55, z1=0.55))
    for bx, by in ((-2.0, 0.7), (-2.0, -0.7), (-1.4, 0.0)):
        x, z = game_xz(bx, by)
        ob.append(dict(type="circle", x=x, z=z, r=0.34))
    ob.append(dict(type="rect", x0=2.45, x1=4.05, z0=-0.25, z1=0.85))
    ob.append(dict(type="rect", x0=-6.45, x1=-4.95, z0=-0.25, z1=0.25))
    lx, lz = game_xz(SHIP['lantern'][0], SHIP['lantern'][1])
    ob.append(dict(type="circle", x=lx, z=lz, r=0.3))
    px, pz = game_xz(SHIP['pivot'][0], SHIP['pivot'][1])
    return dict(
        id=SHIP['id'], length=SHIP['L'], beam=SHIP['B'], lods=report['lods'],
        trimPivot=[px, SHIP['pivot'][2], pz + 0.0], deckMargin=0.15,
        deck=dict(columns=["x", "y", "halfWidth"], stations=deck), obstacles=ob,
        lantern=[lx, SHIP['lantern'][2], lz],
    )


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    with Scratch() as sc:
        atlas = Atlas("tartane_atlas", SWATCHES, OUT / "tartane_atlas.png")
        mat = atlas.material("tartane_atlas_mat")
        glass_mat = emissive_material("tartane_glass", (1.0, 0.75, 0.3), 3.0)
        root = empty(SHIP['id'])
        for level in (0, 1, 2):
            build_lod(level, atlas, mat, glass_mat, root)
        objs = sc.new_objects()
        lods = {}
        for level in (0, 1, 2):
            meshes = [o for o in objs if o.type == 'MESH' and o.name.startswith(f"LOD{level}_")]
            lods[f"LOD{level}"] = dict(tris=sum(tri_count(o) for o in meshes), meshes=len(meshes),
                                       drawCalls=len(meshes))
        report = dict(
            lods=lods,
            materials=len({m.name for o in objs if o.type == 'MESH' for m in o.data.materials}),
            names=[o.name for o in objs],
            has_trim_pivot=all(any(o.name == f"LOD{l}_trim-aft" for o in objs) for l in (0, 1, 2)),
        )
        validate_ship(report, BUDGETS)
        size = export_glb(OUT / f"{SHIP['id']}.glb", objs, root)
        meta = build_meta(report)
        meta['bytes'] = size
        write_json(OUT / f"{SHIP['id']}.meta.json", meta)
    return meta


META = main()
RESULT = {"id": META["id"], "bytes": META["bytes"], "lods": META["lods"]}
