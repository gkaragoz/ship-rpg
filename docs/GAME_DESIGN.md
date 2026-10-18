# Game design

Pirates of the Caribbean (2003) feel: free sailing on an open sea map, islands with ports, ship-to-ship combat, trading, RPG progression.

- **Sailing:** wind direction/strength drives speed; sail trim changes with point of sail; ships turn at a rate set by class.
- **Combat:** broadside cannons (left/right arcs), crew and hull damage, boarding later.
- **Economy:** ports buy/sell goods with price differences; ship purchase from the 16 types.
- **RPG:** captain skills, crew, reputation, quests.
- **Camera:** third-person orbit around the ship; tactical zoom out.

Planned in phases, see `ROADMAP.md`.

## Implemented: open-sea sailing (phase 3)
- **Controls:** `A`/`D` (or ←/→) rudder, `W`/`S` (or ↑/↓) one sail step (furled / half / full), mouse drag orbits the chase camera, `Esc` back to the gallery.
- **Wind:** slowly shifting direction and strength (default from the north, ~8 m/s). The HUD compass shows the wind relative to the bow.
- **Point of sail:** drive depends on the angle to the wind (polar in `world/wind.ts`): 0 in irons, ~35% close-hauled, ~85% beam reach, best on a broad reach (~120°), ~80% dead downwind.
- **Speed:** top speed = original `speed` stat × 0.7 m/s, scaled by sail level, sail efficiency and wind strength (capped at 1.15×).
- **Turning:** `turn` stat × 0.006 rad/s at full rudder; the rudder only works with way on (full authority at 40% of top speed).
- **Sails:** trimmed to the wind (yards braced, fore-and-aft sails sheeted out and mirrored to leeward, reefed by sail level); the hull heels away from the wind and rides the waves.

### Tuning reference (all in `gameplay/sailing.ts`, `world/wind.ts`, `render/*`)
- Wind: 8 ± 3 ± 1 m/s (about 4–12), direction swings about ±37° (periods 97 s and 31 s). Wind factor is clamped to 0.3–1.5 and speed is capped at 1.15× top, so wind above ~9 m/s adds nothing on a good point of sail.
- Easing: sail change 0.5/s, rudder 2/s, acceleration 0.35/s, drag 0.15/s (about 3 s up, 7 s down). Rudder use costs 5% speed per second at full lock.
- Heel: 0.14 rad × sail level × sin(wind angle) × wind factor; lean out of turns 0.06 rad.
- Waves: amplitude scales 0.6–1.4× with wind; the ship takes 80% of the pitch and 60% of the wave roll.
- Camera: mouse drag and wheel orbit the ship (0.7–8× ship length); the camera swings with the ship's heading changes but is not pulled back behind it after a manual orbit.
- Names: `ShipView.knots` is the original game's speed unit, not real knots.
- Language: the in-game UI text is Turkish; docs and code are English. Localisation is not planned yet.
- Known simplifications: no tacking penalty, leeway or luffing in irons (sails brace but do not flap).
