# app

Composition layer: one `Mode` (`update`, `render`, `dispose`) per screen. May import every module; wires modules together and owns all create/dispose pairs for a screen.

- `galleryMode.ts`: ship gallery (view + panel); "Yelken aç" calls back with the chosen spec.
- `sailingMode.ts`: game + input + sailing view + HUD + minimap/chart + harbour panel; keys A/D, W/S, Q/E (fire), F (dock), M (chart), R (restart), Esc (return); creates and disposes a ship model per enemy the game reports.

`main.ts` keeps the single active mode and switches by disposing the old one first (one canvas at a time).
