# ui

DOM overlays (plain TypeScript + CSS, no framework). Depends on `core` types and static `world` data.

- `gallery.ts` / `gallery.css` ship list, details card, "Yelken aç" button; arrow keys switch ships; `insets()` reports covered screen area so the 3D view can frame around it
- `hud.ts` / `hud.css` sailing HUD (game speed badge, the consorts' hull bars, heading, speed, sails, wind compass, nearest port, hull, rigging (Arma), leak (Su) and fire (Yangın) rows, reload bars, target, kill toast, sunk screen, hit marker, hurt flash, gun bars that glow green when a target is in the landing zone, prompts)
- `map.ts` / `map.css` the minimap (ports as anchors, enemies, the entry zone highlight) and the hand of the full chart; `chart/` is the old-parchment sea chart (`M`): `chartView.ts` (zoom with the wheel or the buttons, drag to pan, fog of war lifted around discovered islands/ports and the sailed route, letter-number grid, route trail, label placement), `landart.ts` (hand-tinted islands lit from the north-west, ink coast, trees, hachures, shallows and depth contours, drawn lazily from `terrainHeight`), `parchment.ts` (paper), `ornaments.ts` (compass rose, frame, cartouche, scale bar, sea serpent, ship glyph); `anchorIcon.ts` the anchor port marker
- `settings.ts` / `settings.css` / `settingsControls.ts` the settings menu (gear button + Esc) built from a declarative control list; reads and writes the `settings` store
- `debugOverlay.ts` / `.css` the frame profiler panel (F3): FPS, 1 % low, section times, a frame-time graph, plus the lines a screen adds (`app/debugLines.ts`)
- `weatherPanel.ts` the "Hava & Zaman" tab of the settings menu: hour slider and quick hours, weather presets, a slider per weather field with an "Oto" button
- `portPanel.ts` / `portPanel.css` harbour panel while docked: tabs for the market (`portMarket.ts`), the shipyard (`portYard.ts`) and the tavern (`portTavern.ts`); sends `PortCommand`s through the `onCommand` it is given
- `portQuests.ts` the Görevler tab (standing with each nation, the errands carried, the tavern's board)
- `portFleet.ts` the Filo tab of the harbour panel (the consorts: move the flag, mend, sell)
- `hudCaptain.ts` gold, level + XP bar, crew and hold rows of the HUD panel, and the boarding / loot / level-up messages
- `dom.ts` the shared `el()` element helper

UI text is Turkish. Use `textContent`, never `innerHTML`, for dynamic text. Note: the sailing screen has 3 canvases (WebGL, minimap, chart).
