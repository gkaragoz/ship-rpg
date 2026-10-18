# Game design

Pirates of the Caribbean (2003) feel: free sailing on an open sea map, islands with ports, ship-to-ship combat, trading, RPG progression.

- **Sailing:** wind direction/strength drives speed; sail trim changes with point of sail; ships turn at a rate set by class.
- **Combat:** broadside cannons (left/right arcs, implemented in slice 5a), hull damage; boarding and crew later.
- **Economy:** ports buy/sell goods with price differences; ship purchase from the 16 types.
- **RPG:** captain skills, crew, reputation, quests.
- **Camera:** third-person orbit around the ship; tactical zoom out.

Planned in phases, see `ROADMAP.md`.

## Implemented: open-sea sailing (phase 3)
- **Controls:** `A`/`D` (or ←/→) rudder, `W`/`S` (or ↑/↓) one sail step (furled / half / full), `Q`/`E` port/starboard broadside, `G` aim zones, `N` mute, `F` dock/undock, `M` chart, `R` restart after sinking, mouse drag orbits the chase camera, `Esc` back to the gallery.
- **Wind:** slowly shifting direction and strength (default from the north, ~8 m/s). The HUD compass shows the wind relative to the bow.
- **Point of sail:** drive depends on the angle to the wind (polar in `world/wind.ts`): 0 in irons, ~35% close-hauled, ~85% beam reach, best on a broad reach (~120°), ~80% dead downwind.
- **Speed:** top speed = original `speed` stat × 0.7 m/s, scaled by sail level, sail efficiency and wind strength (capped at 1.15×).
- **Turning:** `turn` stat × 0.006 rad/s at full rudder; the rudder works fully only with way on (full authority at 40% of top speed) but never drops below 35% while any sail is set, and a ship head to wind drifts slowly astern, so it can always fall off the wind.
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

## Implemented: archipelago, ports, navigation (phase 4)
- **World:** 8 islands and the 11 ports of the original map (Redmond, Greenford, Oxbay, Falaise de Fleur, Conceicao, Conceicao Smugglers, Quebradas Costillas, Isla Muelle, Douwesen, Douwesen Pirates, Khoal Roa), laid out like the guide's map (north up, neighbours ~0.9 km apart, a minute or two of sailing). Islands are procedural (noisy cone + beach + peak) from `world/islands.ts`.
- **Run aground:** the hull is sampled at five points; any point over water shallower than `draft + 0.5 m` stops the ship, bounces it back stern-first for 1.5 s (sails useless, rudder works at half authority) and shows "Karaya oturdun!". Big keels cannot enter shoals, ports have a 9 m deep anchorage.
- **Docking:** within 80 m of a port's anchorage and under 2.5 m/s, `F` moors the ship (it cannot move, sails come down) and opens the harbour panel; `F` again casts off. Market, shipyard and tavern are placeholders for phase 5.
- **Navigation:** HUD shows the nearest port's name, distance and bearing plus a marker on the compass ring; the minimap (always on) and the chart (`M`) show only discovered islands and ports (fog of war): an island is discovered within its radius × 1.3 + 350 m, a port town within 500 m. Start: just off Douwesen, facing open water.
- **Looks:** low-poly terrain with sand/grass/rock colouring, cone trees, houses, a pier, flag and a floating name label per port; the sea tints to lagoon green and foams in the shallows (depth texture baked from the same height function) and extends to a hazy horizon (fine mesh near, coarse mesh far, short waves fade with distance).
- **Not yet:** NPC ships, day/night, landing on shore, discovery persistence (saves).

## Implemented: broadsides and one enemy (phase 5a)
- **Guns:** half of the `cannons` stat per side (max 24 balls a volley; a bigger broadside makes each ball hit harder so total firepower is kept); `Q` fires the port side, `E` starboard. A broadside reloads in 6 s (player) / 10 s (enemy) and cannot be fired while moored. An unarmed ship (Tartane) simply cannot shoot.
- **Ballistics:** muzzle speed 90 m/s, gravity 9.81, ±2° sideways spread (×1.6 for the enemy), 3–6° elevation (shots land about 90–200 m out); balls inherit the ship's speed, spread along the hull and fan out. Misses splash.
- **Damage:** a hit costs `shot calibre × 2.5` hull points (12 lb = 30). A ball hits if it is inside the hull footprint, below keel+rail height (+1.5 m rigging). At 0 hull points the ship sinks over 8 s: the player sees "Gemin battı", `R` restarts after a 2 s pause (full hull, kills reset); an enemy is removed after sinking and a new one arrives 25 s after the kill (the timer starts at the kill) about 650 m away.
- **Enemy handicap:** until the player has an aim aid (5a.1) the enemy has 70% of its type's hull points, reloads in 10 s and spreads its shots 1.6× wider. Runtime QA saw a Brig lose twice to an even Schooner, so this is a first tuning, to be replaced by a measured balance table (5a.4).
- **Enemy AI** (`gameplay/enemy.ts`): same sailing model as the player (wind, turning, grounding), fully rigged; it closes in, turns broadside at 130–300 m, fires when you are within ±20° of abeam and 180 m, stays out of the no-go zone (±43° of the wind) and turns away from shoals it sees 90 m ahead. Its type is the armed ship (8+ cannons) whose hull strength is closest to 80% of yours.
- **Repair and harbour:** a moored ship repairs 2% of its hull per second and is safe: enemies neither fire at nor hit a docked ship (the escape for a ship that cannot win, e.g. the unarmed Tartane). Restart (`R`) pressed while the ship is still going down is honoured once the sunk screen shows.
- **Aim aid (5a.1a):** each broadside shows its landing zone on the sea (`G` toggles): from `aimZone` in `gameplay/combat.ts`, the same ballistics the balls use (a test fires hundreds of balls and checks they land inside it). Near/far edges, a span of 60% of the hull length, shifted forward by the ship's speed. Gold when loaded, green when an enemy lies inside (the HUD gun bar glows green too), grey while reloading, plus a line from the hull to the far edge. The zones are 100–200 m abeam, so zoom the camera out (wheel, up to 14 ship lengths) to see them whole.
- **Hit feedback (5a.1b):** every `hit` event carries the hull points taken off. One floating number per target per volley (merged within 20 m; gold when we hit them, red when they hit us, readable at any distance); a ✕ marker flashes when our shot lands; a red screen-edge flash and a camera shake (stronger with more damage) when we are hit.
- **Sound (5a.1c):** all synthesised with Web Audio, no files: cannon (noise crack over a deep thump, rolling spread across a broadside), hit (wood crack), splash, a sinking groan with bubbles, and looping sea, wind and hull-water layers whose loudness follows the wind and your speed. Positioned by `spatialMix`: gain falls with distance (half at 120 m), pan follows the bearing, and a sound arrives after distance ÷ 340 m/s (up to 2.5 s) so a far broadside is seen before it is heard. At most 10 voices start per frame. Starts on the first key press (browser rule); `N` mutes.
- **HUD:** hull bar, left/right reload bars, nearest enemy name/distance/bearing/hull, kill toast; the minimap shows enemy ships as red triangles.
- **Not yet:** boarding and loot, crew, XP, damage to sails/rigging/speed, several enemies, enemy flags/nations, fleeing at low hull.
