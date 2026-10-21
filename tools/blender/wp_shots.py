"""The photographer's shot list for the menu wallpaper scene: 40 compositions (two rolls of 20) (camera, lens, depth of field, light, weather).

Light: `sun_rot` is the direction the sun is in, in degrees (0 = towards +Y, inland; 90 = +X; 180 = -Y, out to sea; 270 = -X) and
`sun_elev` its height; `exposure` is the camera's stops, `haze` the density of the scattering box, `cover` the cloud thresholds
(lower = more cloud). Positions are in metres: the quay runs along y = 0 (x from -130 to 100), the galleon lies at x 3..49 (every ship's bow is towards +X, its port side to the quay), the brig
at -41..-11, the frigate at -114..-62, the jetty at x 66 reaching out to y -27, the lighthouse is on the right headland (350, 80),
the fort on the left one (-345, 70), the church at (6, 142).
"""
import bpy

import wp_sky as S
from wp_common import look_at

GOLD = dict(sun_rot=250.7, sun_elev=5.2, exposure=-0.55, haze=0.0005, cover=(0.5, 0.7))

SHOTS = [
    dict(name="golden_hero", cam=(96, -40, 6), target=(-12, 0, 15), lens=34, fstop=5.0, **GOLD),
    dict(name="bow_front_lit", cam=(72, -50, 3.4), target=(45, -8, 9), lens=32, fstop=5.6, sun_rot=75.0, sun_elev=6.0, exposure=-0.5, haze=0.0005, cover=(0.5, 0.7)),
    dict(name="stern_gallery_golden", cam=(-15, -19, 6.0), target=(6, -8, 10), lens=48, fstop=2.8, sun_rot=255.0, sun_elev=4.5, exposure=-0.5, haze=0.0006, cover=(0.5, 0.7)),
    dict(name="crane_quay_dusk", cam=(84, -15, 3.0), target=(66, 5, 12), lens=35, fstop=3.2, **GOLD),
    dict(name="jetty_lantern_bokeh", cam=(73, -38, 3.2), target=(67.4, -26.7, 4.8), lens=70, fstop=1.8, sun_rot=250.7, sun_elev=1.0, exposure=0.2, haze=0.0006, cover=(0.5, 0.7)),
    dict(name="hill_overlook", cam=(-20, 70, 42), target=(15, -28, 4), lens=28, fstop=8.0, **GOLD),
    dict(name="lighthouse_headland", cam=(245, -125, 5), target=(350, 80, 24), lens=40, fstop=6.3, sun_rot=250.7, sun_elev=5.2, exposure=-0.45, haze=0.0007, cover=(0.5, 0.7)),
    dict(name="fort_cliff", cam=(-215, -200, 4), target=(-345, 70, 24), lens=38, fstop=6.3, sun_rot=120.0, sun_elev=8.0, exposure=-0.4, haze=0.0007, cover=(0.5, 0.7)),
    dict(name="warship_silhouette_glare", cam=(60, -118, 3), target=(-230, -70, 20), lens=85, fstop=8.0, sun_rot=266.0, sun_elev=2.2, exposure=-0.9, haze=0.0008, cover=(0.5, 0.7)),
    dict(name="brig_midshot", cam=(-4, -46, 6), target=(-26, -5, 12), lens=48, fstop=4.0, **GOLD),
    dict(name="frigate_bow_leading_lines", cam=(-58, -30, 3.2), target=(-88, -8, 10), lens=35, fstop=5.6, **GOLD),
    dict(name="morning_fog", cam=(108, -52, 7), target=(-6, 6, 17), lens=27, fstop=5.6, sun_rot=100.0, sun_elev=11.0, exposure=-0.25, haze=0.0035, cover=(0.35, 0.6)),
    dict(name="midday_bright", cam=(-10, -80, 12), target=(10, 0, 12), lens=30, fstop=8.0, sun_rot=200.0, sun_elev=42.0, exposure=-2.3, haze=0.0001, cover=(0.62, 0.82)),
    dict(name="blue_hour_lanterns", cam=(96, -40, 4.5), target=(-12, 0, 14), lens=30, fstop=3.5, sun_rot=250.7, sun_elev=-1.6, exposure=1.7, haze=0.0005, cover=(0.5, 0.7)),
    dict(name="storm_front", cam=(95, -60, 6), target=(-40, 20, 20), lens=30, fstop=5.6, sun_rot=250.7, sun_elev=9.0, exposure=-0.1, haze=0.0028, cover=(0.18, 0.4)),
    dict(name="street_level_market", cam=(-20, 8, 4.2), target=(20, 16, 4), lens=30, fstop=3.2, sun_rot=250.7, sun_elev=5.2, exposure=-0.45, haze=0.0005, cover=(0.5, 0.7)),
    dict(name="quay_from_the_east", cam=(200, -30, 3.5), target=(60, -10, 12), lens=35, fstop=5.6, sun_rot=80.0, sun_elev=6.0, exposure=-0.5, haze=0.0006, cover=(0.5, 0.7)),
    dict(name="gulls_in_the_glow", cam=(-150, -60, 3), target=(-60, 160, 66), lens=50, fstop=8.0, sun_rot=250.7, sun_elev=4.5, exposure=-0.7, haze=0.0005, cover=(0.5, 0.7)),
    dict(name="waterline_reflections", cam=(32, -26, 0.9), target=(26, -8, 5), lens=35, fstop=2.8, **GOLD),
    dict(name="sloop_anchored_calm", cam=(20, -90, 4), target=(-52, -48, 9), lens=60, fstop=4.0, sun_rot=215.0, sun_elev=9.0, exposure=-0.6, haze=0.0005, cover=(0.45, 0.68)),
    # second roll of film
    dict(name="ratlines_closeup", cam=(21, -25, 11), target=(26, -8, 17), lens=45, fstop=2.8, sun_rot=255.0, sun_elev=4.5, exposure=0.1, haze=0.0005, cover=(0.5, 0.7), fill=0.5),
    dict(name="bowsprit_approach", cam=(76, -30, 5), target=(52, -9, 9), lens=40, fstop=4.0, sun_rot=80.0, sun_elev=7.0, exposure=-0.35, haze=0.0005, cover=(0.5, 0.7), fill=0.3),
    dict(name="dawn_front_lit", cam=(-60, -50, 6), target=(20, 0, 12), lens=32, fstop=5.6, sun_rot=270.0, sun_elev=3.0, exposure=0.0, haze=0.0007, cover=(0.45, 0.68), fill=0.6),
    dict(name="overcast_grey_harbour", cam=(100, -45, 8), target=(-10, 5, 14), lens=30, fstop=6.3, sun_rot=200.0, sun_elev=25.0, exposure=0.9, haze=0.0016, cover=(0.08, 0.3), fill=1.2, shade=(0.34, 0.37, 0.42), lit=(0.95, 0.97, 1.0)),
    dict(name="moonless_night_lanterns", cam=(96, -40, 4.5), target=(-12, 0, 14), lens=30, fstop=2.8, sun_rot=250.7, sun_elev=-2.6, exposure=3.2, haze=0.0005, cover=(0.5, 0.7)),
    dict(name="high_aerial_bay", cam=(-60, -150, 120), target=(10, -5, 0), lens=28, fstop=11.0, sun_rot=250.7, sun_elev=5.2, exposure=-0.1, haze=0.0005, cover=(0.64, 0.86), fill=0.5),
    dict(name="church_hillside_from_above", cam=(-40, 60, 30), target=(6, 142, 14), lens=35, fstop=8.0, sun_rot=250.7, sun_elev=5.2, exposure=0.2, haze=0.0005, cover=(0.5, 0.7), fill=0.6),
    dict(name="windmill_hill_dusk", cam=(80, 120, 55), target=(160, 215, 22), lens=40, fstop=8.0, sun_rot=250.7, sun_elev=4.0, exposure=1.2, haze=0.0006, cover=(0.5, 0.7), fill=1.0),
    dict(name="lighthouse_wide_from_sea", cam=(200, -200, 5), target=(350, 80, 30), lens=28, fstop=8.0, sun_rot=250.7, sun_elev=5.2, exposure=-0.45, haze=0.0007, cover=(0.5, 0.7)),
    dict(name="sloop_bow_close", cam=(-24, -62, 2.2), target=(-48, -48, 6), lens=50, fstop=3.2, sun_rot=250.7, sun_elev=5.2, exposure=-0.4, haze=0.0005, cover=(0.5, 0.7), fill=0.4),
    dict(name="battleship_gold_wide", cam=(-90, -110, 5), target=(-230, -70, 22), lens=50, fstop=8.0, sun_rot=266.0, sun_elev=2.5, exposure=-0.6, haze=0.0008, cover=(0.5, 0.7), fill=0.15),
    dict(name="storm_dramatic_dark", cam=(95, -60, 6), target=(-40, 20, 20), lens=24, fstop=5.6, sun_rot=250.7, sun_elev=14.0, exposure=0.9, haze=0.0009, cover=(0.08, 0.32), fill=0.8, shade=(0.09, 0.09, 0.13), lit=(2.6, 1.0, 0.4)),
    dict(name="waterline_bokeh_brig", cam=(8, -30, 1.2), target=(-26, -5, 5), lens=60, fstop=2.0, sun_rot=250.7, sun_elev=5.2, exposure=-0.4, haze=0.0005, cover=(0.5, 0.7), fill=0.4),
    dict(name="crane_cargo_golden", cam=(40, -14, 2.5), target=(66, 6, 10), lens=28, fstop=5.6, sun_rot=250.7, sun_elev=5.2, exposure=-0.2, haze=0.0005, cover=(0.5, 0.7), fill=0.5),
    dict(name="along_the_quay_leading_lines", cam=(-128, -14, 2.5), target=(-30, -6, 9), lens=28, fstop=5.6, sun_rot=250.7, sun_elev=5.2, exposure=-0.3, haze=0.0005, cover=(0.5, 0.7), fill=0.5),
    dict(name="fishing_boats_by_jetty", cam=(86, -34, 1.6), target=(66, -16, 2.5), lens=45, fstop=2.5, sun_rot=250.7, sun_elev=5.2, exposure=-0.3, haze=0.0005, cover=(0.5, 0.7), fill=0.5),
    dict(name="twilight_sky_masts", cam=(70, -45, 2.5), target=(-20, 60, 45), lens=22, fstop=8.0, sun_rot=250.7, sun_elev=1.5, exposure=0.5, haze=0.0005, cover=(0.45, 0.68), fill=0.5),
    dict(name="church_telephoto_over_ship", cam=(40, -50, 6), target=(6, 142, 24), lens=75, fstop=6.3, sun_rot=250.7, sun_elev=5.2, exposure=-0.3, haze=0.0005, cover=(0.5, 0.7), fill=0.5),
    dict(name="fog_lantern_glow", cam=(88, -52, 3.0), target=(40, -8, 8), lens=40, fstop=2.8, sun_rot=250.7, sun_elev=5.0, exposure=0.9, haze=0.003, cover=(0.3, 0.55), fill=0.4),
    dict(name="top_down_harbour", cam=(10, -5, 150), target=(10, -5, 0), rot=(0.0, 0.0, 0.0), lens=35, fstop=11.0, sun_rot=250.7, sun_elev=5.2, exposure=-0.1, haze=0.0003, cover=(0.64, 0.86), fill=0.6),
]


def apply(sc, cam, shot):
    """Point the camera, set the lens and focus, and rebuild the sky for the shot's light and weather."""
    cam.location = shot["cam"]
    if "rot" in shot:
        cam.rotation_euler = shot["rot"]  # explicit: a camera looking straight down has no up-vector to track
    else:
        look_at(cam, shot["target"])
    cd = cam.data
    cd.lens = shot["lens"]
    cd.dof.use_dof = True
    cd.dof.aperture_fstop = shot["fstop"]
    focus = shot.get("focus", shot["target"])
    d = _vec(focus) - cam.location
    cd.dof.focus_distance = d.length * (1.0 if "focus" in shot else 0.85)
    old = sc.world
    S.build_world(sc, shot["sun_rot"], shot["sun_elev"], cover=shot["cover"], shade=shot.get("shade", (0.26, 0.17, 0.27)), lit=shot.get("lit", (3.2, 1.05, 0.34)))
    S.build_fill(sc, shot["sun_rot"], shot["sun_elev"], shot.get("fill", 0.45))
    if old:
        bpy.data.worlds.remove(old)
    haze = bpy.data.materials.get("wp_haze")
    if haze:
        haze.node_tree.nodes["Volume Scatter"].inputs["Density"].default_value = shot["haze"]
    sc.view_settings.exposure = shot["exposure"]


def _vec(v):
    from mathutils import Vector
    return Vector(v)
