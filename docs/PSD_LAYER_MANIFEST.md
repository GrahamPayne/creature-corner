# PSD Layer Manifest — Field Guide Mockup

Source art (read-only, never modified by tooling):
`D:\3dProjects\CREATURECORNER\FEILDGUIDE\FEILDGUID_MOCKUP.psd`

Canvas: **1086 × 1448 px**. All normalized bounds are fractions of the canvas
(left/top/width/height), used directly by the web layout so controls stay
aligned at any scale.

Extraction script: `scripts/extract-field-guide-psd.js`
(re-run with `node scripts/extract-field-guide-psd.js` after the PSD changes).
Machine-readable copy of this data: `public/assets/field-guide/layer-manifest.json`.

## Layers (bottom → top, as stacked in the PSD)

| PSD layer | Exported file | Pixel bounds (L,T → R,B) | Normalized (L, T, W, H) | Interaction | Off state | On state |
|---|---|---|---|---|---|---|
| Layer 1 (black background) | *(not exported — page background is already dark)* | 0,0 → 1086,1448 | 0, 0, 1, 1 | none | visible | visible |
| Terminal body | `sprites/terminal-body.png` | 162,713 → 779,1314 | 0.14917, 0.4924, 0.56814, 0.41506 | none (chassis) | visible | visible |
| terminal Screen | `sprites/terminal-screen.png` | 291,891 → 743,1115 | 0.26796, 0.61533, 0.41621, 0.1547 | click focuses terminal input; HTML terminal renders over it | visible (dark) | visible (live terminal) |
| JOG_WHEEL | `jog-wheel.png` | 754,421 → 1044,697 | 0.69429, 0.29075, 0.26703, 0.19061 | scroll / drag / arrow keys → PREV/NEXT; rotates slightly. Sits **behind** Main Body, so it is rendered as its own layer under the body image | visible | visible |
| Main Body | `sprites/main-body.png` | 167,57 → 947,723 | 0.15378, 0.03936, 0.71823, 0.45994 | contains power button region (see below) | visible | visible |
| Main Screen | `sprites/main-screen.png` | 356,283 → 743,578 | 0.32781, 0.19544, 0.35635, 0.20373 | HTML main screen renders over it | visible (dark) | visible (live content) |
| DEVICE ON/OFF button_pressed *(has layer effects; duplicated twice in PSD — treated as one)* | `power-button-pressed.png` (cropped from composite, effects preserved) | layer 218,530 → 297,601; crop 194,506 → 321,625 | crop: 0.17864, 0.34945, 0.11694, 0.08218 | shown briefly while power button is pressed | hidden | hidden (flashes on press) |
| SIDEBUTTON_1 | `sprites/sidebutton-1.png` | 829,272 → 871,312 | 0.76335, 0.18785, 0.03867, 0.02762 | PREVIOUS / move up | visible | visible |
| SIDEBUTTON_2 | `sprites/sidebutton-2.png` | 834,339 → 876,379 | 0.76796, 0.23412, 0.03867, 0.02762 | NEXT / move down | visible | visible |
| BUTTON_01 | `sprites/button-01.png` | 393,259 → 452,275 | 0.36188, 0.17887, 0.05433, 0.01105 | open creature records | visible | visible |
| BUTTON_02 | `sprites/button-02.png` | 478,258 → 537,274 | 0.44015, 0.17818, 0.05433, 0.01105 | open artifact records | visible | visible |
| BUTTON_03 | `sprites/button-03.png` | 567,259 → 626,275 | 0.5221, 0.17887, 0.05433, 0.01105 | open memory / environment records | visible | visible |
| BUTTON_04 | `sprites/button-04.png` | 652,259 → 711,275 | 0.60037, 0.17887, 0.05433, 0.01105 | return to main menu | visible | visible |
| POWERLIGHT_OFF | `sprites/powerlight-off.png` | 216,202 → 253,239 | 0.1989, 0.1395, 0.03407, 0.02555 | power indicator, dark | visible | hidden |
| POWERLIGHT_on *(has layer effects — glow)* | `powerlight-on.png` (cropped from composite, glow preserved) | layer 216,202 → 253,239; crop 192,178 → 277,263 | crop: 0.1768, 0.12293, 0.07827, 0.0587 | power indicator, lit | hidden | visible |

## Additional exports

| File | Purpose |
|---|---|
| `device-base.png` | Full self-composite of the powered-off device (reference / fallback; not used by the live DOM) |
| `psd-composite.png` | Photoshop's flattened composite with all effects (visual comparison reference) |
| `sprites/powerlight-on.png`, `sprites/device-on-off-button-pressed.png` | Raw layer pixels **without** layer effects (reference only — the live app uses the composite crops above) |

## Notes / layers that would need manual Photoshop export

- **Layer effects cannot be rendered by the extraction tooling** (ag-psd reads
  raw pixels only). The two effect-bearing layers (`POWERLIGHT_on`,
  `DEVICE ON/OFF button_pressed`) were recovered by cropping Photoshop's own
  flattened composite, so the current exports are pixel-accurate. If those
  layers are ever repositioned so their glow overlaps another *changing*
  element, export them manually from Photoshop instead.
- The power button in its **unpressed** state is drawn inside `Main Body`
  (no separate layer); the pressed layer overlays it.
- `DEVICE ON/OFF button_pressed` appears twice in the PSD with identical
  bounds; the duplicate is exported as `sprites/device-on-off-button-pressed-2.png`
  and otherwise ignored.
- There is no artwork for pressed states of BUTTON_01–04 or the side buttons;
  the app uses a subtle CSS brightness/offset on the existing sprites instead.
