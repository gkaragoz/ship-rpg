# ui

DOM overlays (plain TypeScript + CSS, no framework). Depends on `core` types only.

- `gallery.ts` / `gallery.css` ship list, details card, "Yelken aç" button; arrow keys switch ships; `insets()` reports covered screen area so the 3D view can frame around it
- `hud.ts` / `hud.css` sailing HUD (heading, speed, sails, wind compass, drive bar)

UI text is Turkish. Use `textContent`, never `innerHTML`, for dynamic text.
