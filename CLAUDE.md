# Ship RPG

Browser-based 3D naval RPG in the spirit of Pirates of the Caribbean (2003) / Sea Dogs. Three.js + TypeScript (strict) + Vite. All ships are generated procedurally from data (no external models).

## Commands
- `npm run dev` — dev server
- `npm run check` — typecheck + lint + tests (must pass before "done")
- `npm run build` — production build
- `npm run balance` — duel simulator report (see `docs/BALANCE.md`); rerun it after changing combat or enemy numbers

## Architecture (read `docs/ARCHITECTURE.md` first)
- `src/core` loop/input/config · `render` three scene · `ships` specs+factory · `world` islands/wind · `gameplay` combat/trade · `ui` DOM HUD · `audio` procedural sound.
- Allowed imports: `ships`, `world`, `audio` → core · `render`, `gameplay` → core, ships, world · `ui` → core, gameplay, world (static map data) · `app`/`main` → all (`app` holds one `Mode` per screen). `render` never imports `gameplay`; it reads state through view types defined in `core` (see `docs/ARCHITECTURE.md`). Enforced by eslint.
- Import other modules only through their `index.ts`.
- Data (e.g. `ships/specs`) is separate from behaviour. `render` reads game state, never writes it.
- Keep files under ~300 lines. See `docs/CONVENTIONS.md`.

## Context docs
`docs/ARCHITECTURE.md`, `docs/SHIPS.md` (single source of truth for the 16 ship types), `docs/GAME_DESIGN.md`, `docs/BALANCE.md`, `docs/CONVENTIONS.md`, `docs/ROADMAP.md`. Update them in the same change that alters what they describe.

## Definition of done
1. `npm run check` passes.
2. Visible changes verified in the browser (no console errors).
3. Relevant docs and `docs/ROADMAP.md` updated.
4. QA agents run (below).

## QA agent (mandatory after every feature/change)
Use the `qa` agent (`.claude/agents/qa.md`, Sonnet, medium effort). Launch several **in parallel in one message**, each with a different focus:
1. static: typecheck, lint, unit tests, architecture rules (import direction, file size)
2. runtime: dev server in browser, console errors, frame-rate/perf sanity, visual check
3. requirements: does the change satisfy the request and the docs?
QA agents report; they do not edit code. Fix findings, then re-run the affected focus.
