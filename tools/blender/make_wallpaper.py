"""Menu wallpaper: a golden-hour harbour (island, town, quay, moored galleon/brig/frigate, anchored warship) rendered with Cycles.

Run INSIDE Blender 5.x, either from the open Blender through the local LLM (`execute_blender_code` with the wrapper in
docs/BLENDER_PIPELINE.md, with `STAGE = "build"`), or headless:

    blender -b --factory-startup --python tools/blender/make_wallpaper.py -- STAGE=preview      (960x540, 48 samples)
    blender -b --factory-startup --python tools/blender/make_wallpaper.py -- STAGE=final        (3840x2160)
    blender -b tools/blender/out/wallpaper.blend --python tools/blender/make_wallpaper.py -- STAGE=render

Stages: `build` (scene -> out/wallpaper.blend, the open scene is left as it was), `render` (open .blend -> images),
`preview` / `final` (build and render in one process). Outputs go to `out/` (previews) and `public/images/` (final).
"""
import math
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Vector

_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)
for _m in [m for m in sys.modules if m.startswith("wp_")]:
    del sys.modules[_m]  # an open Blender keeps imported modules between runs

import wp_common as C  # noqa: E402
import wp_harbour as H  # noqa: E402
import wp_shots as SH  # noqa: E402
import wp_sky as S  # noqa: E402
import wp_terrain as T  # noqa: E402
import wp_town as W  # noqa: E402
import wp_water as WA  # noqa: E402

CFG = {
    "seed": 11,
    "cam": (108.0, -52.0, 7.0),
    "target": (-6.0, 6.0, 17.0),
    "lens": 27.0,
    "fstop": 4.5,
    "sun_rot": 250.7,
    "sun_elev": 5.2,
    "ships": [  # id, x, y, yaw, side of the hull facing the quay (local y sign)
        ("galleon", 26.0, -8.0, math.pi, 1.0),
        ("brig", -26.0, -5.4, math.pi, 1.0),
        ("frigate", -88.0, -8.0, math.pi, 1.0),
    ],
    "anchored": [("battleship", -230.0, -70.0, 0.4), ("sloop", -52.0, -48.0, 2.9)],
    "jetty": (66.0, -27.0),
    "boats": [("Rowboat", 58.0, -17.0, 0.3), ("FishingBoat", 72.5, -14.0, 1.7), ("Canoe", 45.0, -24.0, -0.4), ("Rowboat", -48.0, -16.0, 2.2)],
}
QUALITY = {
    "preview": {"w": 1600, "h": 900, "samples": 96, "out": "wallpaper_preview"},
    "final": {"w": 3840, "h": 2160, "samples": 320, "out": "menu_bg_4k"},
    "shot": {"w": 256, "h": 256, "samples": 48},
}


def build(sc, cfg):
    rs, nrs = C.rng(cfg["seed"])
    props = C.world_props(sc)
    for name in ("Broadleaf", "Pine", "PalmA", "PalmB", "Bush"):
        for pl in props[name].data.polygons:
            pl.use_smooth = True
    leaf = bpy.data.textures.new("wp_leaf", "CLOUDS")
    leaf.noise_scale = 0.45
    leaf.noise_depth = 2
    for name, lvl, amount in (("Broadleaf", 2, 0.55), ("Bush", 2, 0.3), ("Pine", 1, 0.0)):
        sub = props[name].modifiers.new("sub", "SUBSURF")
        sub.levels = sub.render_levels = lvl
        if amount:
            dis = props[name].modifiers.new("leaf", "DISPLACE")
            dis.texture = leaf
            dis.strength = amount
            dis.mid_level = 0.5
    lod0 = props
    lod1 = {}
    ter, island = T.build_terrain(sc, nrs)
    stats = W.populate(sc, ter, lod0, lod1, rs, nrs)
    depth = WA.depth_image(ter)
    WA.build_sea(sc, depth)
    bollards, rope = H.build_quay(sc)
    H.build_jetty(sc, *cfg["jetty"])
    for ship_id, x, y, yaw, side in cfg["ships"]:
        root = H.place_ship(sc, ship_id, x, y, yaw)
        H.moor(sc, root, ship_id, bollards, rope, side)
    for ship_id, x, y, yaw in cfg["anchored"]:
        H.place_ship(sc, ship_id, x, y, yaw)
    H.place_boats(sc, lod0, cfg["boats"])
    S.build_world(sc, cfg["sun_rot"], cfg["sun_elev"])
    S.build_haze(sc)
    S.build_birds(sc, nrs)
    cam = camera(sc, cfg)
    return {"props": stats, "camera": tuple(cam.location)}


def camera(sc, cfg):
    cd = bpy.data.cameras.new("wp_cam")
    cd.lens = cfg["lens"]
    cd.sensor_width = 36.0
    cd.clip_start = 0.5
    cd.clip_end = 6000.0
    cam = bpy.data.objects.new("wp_cam", cd)
    sc.collection.objects.link(cam)
    cam.location = cfg["cam"]
    C.look_at(cam, cfg["target"])
    sc.camera = cam
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = cfg["fstop"]
    cd.dof.focus_distance = (Vector(cfg["target"]) - Vector(cfg["cam"])).length * 0.8
    return cam


def setup_render(sc, q):
    r = sc.render
    r.engine = "CYCLES"
    r.resolution_x, r.resolution_y, r.resolution_percentage = q["w"], q["h"], 100
    cy = sc.cycles
    cy.samples = q["samples"]
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.01
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.max_bounces = 8
    cy.volume_bounces = 2
    cy.transmission_bounces = 6
    cy.sample_clamp_indirect = 8.0
    cy.film_exposure = 1.0
    prefs = bpy.context.preferences.addons["cycles"].preferences
    cy.device = "CPU"
    for kind in ("OPTIX", "CUDA"):
        try:
            prefs.compute_device_type = kind
            prefs.get_devices()
            gpus = [d for d in prefs.devices if d.type == kind]
            if gpus:
                for d in prefs.devices:
                    d.use = d.type == kind
                cy.device = "GPU"
                break
        except Exception:
            continue
    vs = sc.view_settings
    vs.view_transform = "AgX"
    for look in ("AgX - Punchy", "Punchy", "None"):
        try:
            vs.look = look
            break
        except TypeError:
            continue
    r.image_settings.file_format = "PNG"
    r.image_settings.color_depth = "16"
    return cy.device


# ------------------------------------------------------------------ post: bloom, vignette, grade (display space)
def _blur(a, sigma):
    h, w = a.shape[:2]
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.rfftfreq(w)[None, :]
    k = np.exp(-2 * (np.pi * sigma) ** 2 * (fx * fx + fy * fy))
    out = np.empty_like(a)
    for c in range(a.shape[2]):
        out[..., c] = np.fft.irfft2(np.fft.rfft2(a[..., c]) * k, s=(h, w))
    return out


def post(path_in, stem_out, sizes, scale=1.0):
    img = bpy.data.images.load(str(path_in))
    img.colorspace_settings.name = "Non-Color"
    w, h = img.size
    px = np.array(img.pixels[:], dtype=np.float32).reshape(h, w, 4)[..., :3]
    bpy.data.images.remove(img)
    lum = px @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
    hi = np.clip(lum - 0.62, 0, None)[..., None] * px / np.maximum(lum[..., None], 1e-3)
    s = 4
    small = hi[: h // s * s, : w // s * s].reshape(h // s, s, w // s, s, 3).mean(axis=(1, 3))
    bloom = _blur(small, 3.0 * scale) * 0.7 + _blur(small, 9.0 * scale) * 0.55 + _blur(small, 26.0 * scale) * 0.4
    bloom = np.kron(bloom, np.ones((s, s, 1), dtype=np.float32))
    bloom = np.pad(bloom, ((0, h - bloom.shape[0]), (0, w - bloom.shape[1]), (0, 0)), mode="edge")
    out = px + bloom * np.array([1.0, 0.82, 0.62], dtype=np.float32) * 0.55
    # vignette and a gentle S-curve with warm highlights and cool shadows
    yy, xx = np.mgrid[0:h, 0:w].astype(np.float32)
    d = np.hypot((xx / w - 0.5) * 1.15, (yy / h - 0.5) * 1.0)
    out *= (1 - 0.42 * np.clip(d - 0.28, 0, None) ** 1.5 * 2.2)[..., None]
    out = np.clip(out, 0, 1)
    out = out * out * (3 - 2 * out) * 0.35 + out * 0.65
    out[..., 2] += (0.5 - out[..., 2]) * 0.0
    out = out * np.array([1.03, 1.0, 0.95], dtype=np.float32) * (1 - np.clip(out, 0, 1) * 0.0) + np.array([0.0, 0.004, 0.012], dtype=np.float32) * (1 - out)
    rng = np.random.default_rng(1)
    out += (rng.standard_normal((h, w, 1)).astype(np.float32)) * 0.004
    out = np.clip(out, 0, 1)
    lin = np.where(out <= 0.04045, out / 12.92, ((out + 0.055) / 1.055) ** 2.4)  # display -> linear for the sRGB image saver
    paths = []
    for name, size, fmt, extra in sizes:
        im = bpy.data.images.new("wp_post", w, h, alpha=False, float_buffer=True)
        im.colorspace_settings.name = "sRGB"
        im.pixels.foreach_set(np.concatenate([lin, np.ones((h, w, 1), dtype=np.float32)], axis=2).ravel())
        sc = bpy.data.scenes.new("wp_save")
        sc.view_settings.view_transform = "Standard"
        sc.view_settings.look = "None"
        sc.render.image_settings.file_format = fmt
        sc.render.image_settings.color_mode = "RGB"
        if fmt == "PNG":
            sc.render.image_settings.color_depth = "16"
        if "quality" in extra:
            sc.render.image_settings.quality = extra["quality"]
        if size != (w, h):
            im.scale(*size)
        dst = Path(name)
        dst.parent.mkdir(parents=True, exist_ok=True)
        im.save_render(str(dst), scene=sc)
        paths.append(str(dst))
        bpy.data.scenes.remove(sc)
        bpy.data.images.remove(im)
    return paths


def render_scene(sc, q, final):
    sc.view_settings.exposure = -0.55  # the hero frame's exposure (the shot list sets its own per shot)
    device = setup_render(sc, q)
    C.OUT.mkdir(parents=True, exist_ok=True)
    raw = C.OUT / f"{q['out']}_raw.png"
    sc.render.filepath = str(raw)
    bpy.ops.render.render(write_still=True, scene=sc.name)
    if final:
        img = C.REPO / "public" / "images"
        sizes = [(img / "menu_bg_4k.png", (3840, 2160), "PNG", {}), (img / "menu_bg_4k.webp", (3840, 2160), "WEBP", {"quality": 90}), (img / "menu_bg_1080.webp", (1920, 1080), "WEBP", {"quality": 90})]
    else:
        sizes = [(C.OUT / f"{q['out']}.png", (q["w"], q["h"]), "PNG", {})]
    return device, post(raw, None, sizes)


def render_shots(sc, indices, size=256, samples=48, final=False):
    w, h = (size, size) if isinstance(size, int) else size
    """Render shots first..last (1-based) of the shot list as small square frames into out/shots/ (or a big one into out/shots_hi/)."""
    cam = sc.camera
    folder = "shots_hi" if final else "shots"
    done = []
    for i in indices:
        shot = SH.SHOTS[i - 1]
        SH.apply(sc, cam, shot)
        sc.camera.data.sensor_fit = "VERTICAL"  # the lens sets the vertical view: a wide frame shows more to the sides, as the square composition intended
        sc.camera.data.sensor_height = 36.0
        q = {"w": w, "h": h, "samples": samples, "out": f"{folder}/{i:02d}_{shot['name']}"}
        (C.OUT / folder).mkdir(parents=True, exist_ok=True)
        setup_render(sc, q)
        raw = C.OUT / f"{q['out']}_raw.png"
        sc.render.filepath = str(raw)
        bpy.ops.render.render(write_still=True, scene=sc.name)
        done += post(raw, None, [(C.OUT / f"{q['out']}.png", (w, h), "PNG", {})], scale=w / 1600)
        raw.unlink(missing_ok=True)
    return done


def _argv_stage():
    args = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    for a in args:
        if a.startswith("STAGE="):
            return a.split("=", 1)[1]
    return None


def run(stage):
    result = {"stage": stage}
    if stage in ("build", "preview", "final", "all"):
        if stage == "build":
            with C.Sandbox():
                sc = C.new_scene("Wallpaper")
                result.update(build(sc, CFG))
                C.OUT.mkdir(parents=True, exist_ok=True)
                bpy.ops.wm.save_as_mainfile(filepath=str(C.OUT / "wallpaper.blend"), copy=True)
        else:
            sc = bpy.context.scene  # headless: the factory scene, emptied
            for o in list(bpy.data.objects):
                bpy.data.objects.remove(o, do_unlink=True)
            sc.name = "Wallpaper"
            result.update(build(sc, CFG))
            q = QUALITY["final" if stage == "final" else "preview"]
            result["device"], result["files"] = render_scene(sc, q, stage == "final")
    elif stage == "shots":
        first, last = globals().get("SHOT_RANGE", (1, len(SH.SHOTS)))
        picks = list(globals().get("SHOT_LIST") or [])
        size = globals().get("SHOT_SIZE", 256)
        samples = globals().get("SHOT_SAMPLES", 48)
        if "--" in sys.argv:  # headless: SHOTS=1-20 SIZE=256 SAMPLES=48
            for a in sys.argv[sys.argv.index("--") + 1:]:
                k, _, v = a.partition("=")
                if k == "SHOTS":
                    picks = [int(n) for n in v.split(",")] if "," in v else []
                    if not picks:
                        first, _, last = v.partition("-")
                        first, last = int(first), int(last or first)
                elif k == "SIZE":
                    size = tuple(int(n) for n in v.split("x")) if "x" in v else int(v)
                elif k == "SAMPLES":
                    samples = int(v)
        final = (size if isinstance(size, int) else size[0]) > 512
        with C.Sandbox():
            sc = C.new_scene("Wallpaper")
            result.update(build(sc, CFG))
            result["files"] = render_shots(sc, picks or list(range(first, last + 1)), size, samples, final)
    elif stage == "render":
        sc = bpy.data.scenes["Wallpaper"]
        result["device"], result["files"] = render_scene(sc, QUALITY["final"], True)
    return result


STAGE = globals().get("STAGE") or _argv_stage() or "preview"
RESULT = run(STAGE)
print("RESULT", RESULT)
