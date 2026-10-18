# app

Composition layer: one `Mode` (`update`, `render`, `dispose`) per screen. May import every module; wires modules together and owns all create/dispose pairs for a screen.

- `gameSettings.ts`: wires the settings store to a screen's view, audio and clock. `debugLines.ts`: the text of the debug overlay.
- `galleryMode.ts`: ship gallery (view + panel); "Yelken aç" calls back with the chosen spec.
- `sailingMode.ts`: game + input + sailing view + HUD + minimap/chart + harbour panel; keys A/D, W/S, Q/E (fire), F (dock), M (chart), G (aim zones), N (mute), R (restart), F3 (debug overlay), Esc / gear (settings menu, which pauses the game and holds the way back to the gallery); creates and disposes a ship model per enemy the game reports.

`main.ts` keeps the single active mode and switches by disposing the old one first (one canvas at a time).
