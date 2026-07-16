# CLAUDE.md — Creature Corner project rules

## Stack (do not change without being asked)

Static multi-page site: plain HTML pages at the repo root + one shared
`styles.css`. **No framework, no bundler, no build step.** Served with
`npx serve .` locally; deployed as static files (Cloudflare Pages). Clean
URLs: `/field-guide` → `field-guide.html`. Do not introduce React/Vite/etc.;
new interactive features are vanilla ES modules under `src/features/<name>/`.

## Field Guide feature

- Code: `src/features/field-guide/` (components / commands / data / state /
  styles / types). Keep it modular and isolated from the rest of the site.
- Single navigation system: physical controls and typed terminal commands
  dispatch the same actions through `commands/dispatch.js`. Never build a
  second parallel path.
- All device copy lives in `data/responses.js`; record data in
  `data/records.js`. Current records are clearly-marked prototypes
  (`TEST-CR-001` …) — not lore.
- Geometry comes from the PSD via `data/layout.js` (normalized 0–1 bounds of
  the 1086×1448 canvas). Artwork can be replaced without rebuilding the
  interaction system.
- Read `docs/LORE_RULES.md` before writing any device dialogue or lore. Key
  points: never confirm the device is alive/evil/possessed/a normal AI; never
  invent its creator, origin, or an ending; keep responses restrained.

## Artwork rules

- All artwork is original work by **Graham Payne** — never describe it as
  AI-generated or app-generated, and never redesign, "improve," or replace it
  with generic sci-fi UI.
- Source PSD (read-only, never modify/move/flatten):
  `D:\3dProjects\CREATURECORNER\FEILDGUIDE\FEILDGUID_MOCKUP.psd`
- Exported web assets: `public/assets/field-guide/`. Regenerate with
  `npm run fg:extract` (script: `scripts/extract-field-guide-psd.js`;
  note `.gitignore` currently excludes `scripts/`).
- Layer map: `docs/PSD_LAYER_MANIFEST.md`.

## Commands

- `npm start` — serve locally
- `npm test` — typecheck + unit (node:test) + e2e (Playwright, desktop+mobile)
- `npm run fg:extract` — re-export PSD assets

No production build exists; "build passes" means `npm test` passes.

## Other constraints

- No backend, no database, no live AI API in the Field Guide prototype; a
  future conversational provider would hook into the dispatcher's UNKNOWN
  fallthrough, server-side. Never put API keys in browser code.
- Respect `prefers-reduced-motion` in any new animation.
- Keep the Field Guide page dark, minimal, focused on the device.
