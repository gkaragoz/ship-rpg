# app

Composition layer: one `Mode` (`update`, `render`, `dispose`) per screen. May import every module; wires modules together and owns all create/dispose pairs for a screen.

- `galleryMode.ts`: ship gallery (view + panel); "Yelken aç" calls back with the chosen spec.
- `sailingMode.ts`: game + input + sailing view + HUD; `Esc` calls back to return.

`main.ts` keeps the single active mode and switches by disposing the old one first (one canvas at a time).
