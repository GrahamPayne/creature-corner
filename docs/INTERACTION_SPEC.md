# Field Guide Prototype — Interaction Specification

Route: `/field-guide` (static page `field-guide.html`).
Code: `src/features/field-guide/` (vanilla ES modules — the site has no framework or build step, so the feature matches the existing stack).

## Device states

`poweredOff → booting → mainMenu ⇄ browsingIndex ⇄ viewingRecord`, plus the
transients `returning` (brief blank between screens) and `shuttingDown`.
`terminalActive` is a parallel flag set while the terminal input has focus.
The page always loads in `poweredOff`.

## One navigation system

Every input path produces the same action objects, executed by a single
dispatcher (`commands/dispatch.js`):

| Input | Action |
|---|---|
| Typed command (terminal) | parsed by `commands/parser.js` |
| Orange button 1 | `CATEGORY creatures` (same as typing `CREATURES`) |
| Orange button 2 | `CATEGORY artifacts` |
| Orange button 3 | `CATEGORY memories` |
| Orange button 4 | `HOME` |
| Cyan side button 1 | `PREV` |
| Cyan side button 2 | `NEXT` |
| Jog wheel (scroll / drag / arrow keys) | `PREV` / `NEXT` per detent |
| Power button | `POWER_TOGGLE` |
| Escape (focus inside device, not typing) | `BACK` |

## Terminal commands

Case-insensitive; extra spaces ignored.

`HELP`, `INDEX`, `CREATURES`, `ARTIFACTS`, `MEMORIES`, `OPEN <record-id>`,
`NEXT`, `PREVIOUS`/`PREV`, `BACK`, `HOME`, `STATUS`, `CLEAR`, `POWER OFF`.

Aliases: `LIST/SHOW <category>`, `<category> INDEX`, `GO BACK`, `RETURN`,
`MAIN MENU`.

Chat phrases with restrained answers (see `data/responses.js`):
`HELLO`, `WHO ARE YOU`, `ARE YOU ALIVE`, `WHAT IS THIS`, `WHAT CAN YOU DO`.

Unknown input rotates through three controlled refusal lines.

## Power sequence

Press power → pressed artwork flashes (~260 ms) → green light on →
upper screen flickers (~550 ms in) → main menu + boot text (~1.3 s total).
`POWER OFF` prints a closing line, darkens both screens (~850 ms), clears the
terminal history. While powered off all other controls give only a subtle
brightness dip. Durations collapse under `prefers-reduced-motion`.

## Screens

- **Upper (main) screen** — menu, category indexes, record details. Content is
  HTML positioned over the drawn screen face; long content scrolls inside it.
- **Lower (terminal) screen** — real HTML input + scrolling history
  (`role="log"`, `aria-live="polite"`). Clicking anywhere on the drawn
  terminal focuses the input. On viewports ≤ 700 px, focusing the input
  temporarily enlarges the terminal into a fixed overlay so the on-screen
  keyboard doesn't hide it; it returns to the illustrated layout on submit
  or blur.

## Records

Prototype-only data in `data/records.js`:
`TEST-CR-001…003`, `TEST-AR-001…002`, `TEST-ME-001…002`, each with
placeholder body text. Not lore.

## Accessibility

- All controls are real `<button>` elements with `aria-label`s and visible
  `:focus-visible` outlines; small drawn controls get padded hit areas.
- Jog wheel is keyboard-operable (`role="slider"`, arrow keys).
- Hidden long description of the interface (`#fg-device-description`).
- `prefers-reduced-motion` disables flicker/blink/rotation and shortens
  all timed transitions.

## Testing

- `npm run fg:typecheck` — JSDoc typecheck (tsc, `jsconfig.json`)
- `npm run test:unit` — parser + dispatcher unit tests (node:test)
- `npm run test:e2e` — Playwright, desktop + mobile projects
- `npm test` — all of the above

## Future AI hook

The dispatcher is the seam for a future conversational provider: unmatched
input currently falls through to `UNKNOWN`; a later version can route it to a
server-side endpoint instead. No API keys belong in browser code.
