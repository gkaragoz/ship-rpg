# audio

Procedural sound; depends on `core` only. No audio files: everything is synthesised with Web Audio from noise and oscillators.

- `mix.ts` pure `spatialMix(listener, x, z)` → gain (falls with distance), pan (bearing, starboard +) and delay (speed of sound); unit-tested
- `synth.ts` the effects: `cannon`, `hit` (hull), `riggingHit`, `waterlineHit` (chosen by `GameEvent.zone`), `splash`, `sinking`, and the looping sea/wind/hull-water ambience
- `condition.ts` damage ambience for the player's ship (timber creak, hold slosh, fire crackle) and the pure, tested mappings `creakGain`, `sloshGain`, `crackleDensity`, `crackleGain`; layers exist only while something is damaged
- `audio.ts` `createAudio()`: lazy engine (browsers need a key press or click first: call `resume()` from one), `play(events, listener)` for `GameView.events`, `ambience(wind, speed)`, `condition(c)` (retuned only on >0.03 change), `toggleMute()`. With no Web Audio available every call is a no-op.

Keys: `N` mutes (wired in `app/sailingMode.ts`).
