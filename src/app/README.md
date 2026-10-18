# app

Composition layer: one `Mode` (`update`, `render`, `dispose`) per screen. May import every module; wires modules together and owns all create/dispose pairs for a screen.

- `gameSettings.ts`: wires the settings store to a screen's view, audio and clock. `debugLines.ts`: the text of the debug overlay.
- `galleryMode.ts`: ship gallery (view + panel); "Yelken aç" calls back with the chosen spec.
- `sailingMode.ts`: game + input + sailing view + HUD + minimap/chart + harbour panel; keys A/D, W/S, Q/E (fire), B (board), Z/X (lay the guns lower/higher), F (dock), M (chart), G (aim zones), N (mute), +/- (game speed, see `timeScale.ts`: extra game steps per fixed update, held at 1× when it is dangerous), R (restart), F3 (debug overlay), Esc / gear (settings menu, which pauses the game and holds the way back to the gallery); saves to the autosave and five slots through the Kayıt tab (`saves.ts`: `whyNoSave` refuses in a fight), creates and disposes a ship model per enemy and consort the game reports, swaps the player's model when a ship is bought (`swapPlayer`, after `requestShipAsset`), hands the port panel its commands, and autosaves (on mooring and every minute).
- `saves.ts`: the browser's save slot (`createGameSaves`) and `describeSave`, the line the gallery and the Kayıt tab show.

`main.ts` keeps the single active mode and switches by disposing the old one first (one canvas at a time).
