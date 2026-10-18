# ui

DOM overlays (plain TypeScript + CSS, no framework). Depends on `core` types and static `world` data.

- `gallery.ts` / `gallery.css` ship list, details card, "Yelken aç" button; arrow keys switch ships; `insets()` reports covered screen area so the 3D view can frame around it
- `hud.ts` / `hud.css` sailing HUD (heading, speed, sails, wind compass, nearest port, hull, rigging (Arma), leak (Su) and fire (Yangın) rows, reload bars, target, kill toast, sunk screen, hit marker, hurt flash, gun bars that glow green when a target is in the landing zone, prompts)
- `map.ts` / `map.css` minimap + full chart (`M`), fog of war from `GameView.discoveredIslands/Ports`; island images are drawn lazily from `terrainHeight`
- `settings.ts` / `settings.css` / `settingsControls.ts` the settings menu (gear button + Esc) built from a declarative control list; reads and writes the `settings` store
- `portPanel.ts` / `portPanel.css` harbour panel while docked

UI text is Turkish. Use `textContent`, never `innerHTML`, for dynamic text. Note: the sailing screen has 3 canvases (WebGL, minimap, chart).
