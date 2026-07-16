# Creature Corner

Website for Creature Corner — handmade creatures, masks, and sci-fi art by
Graham Payne. Static multi-page site (plain HTML + `styles.css`), no framework
and no build step.

## Run locally

```
npm install
npm start          # npx serve .  → http://localhost:3000 (clean URLs)
```

## Pages

`index.html`, `gallery.html`, `field-guide.html`, `exhibition.html`,
`about.html`, `contact.html`, `commissions.html`

## Field Guide prototype (`/field-guide`)

An interactive illustrated device: two screens, a typed terminal, physical
controls, and prototype records. Feature code is self-contained in
`src/features/field-guide/` (vanilla ES modules) and does not touch the other
pages.

- Interaction spec: `docs/INTERACTION_SPEC.md`
- Lore rules: `docs/LORE_RULES.md`
- PSD layer manifest: `docs/PSD_LAYER_MANIFEST.md`
- Exported artwork assets: `public/assets/field-guide/`
- Source art (read-only, not in this repo):
  `D:\3dProjects\CREATURECORNER\FEILDGUIDE\FEILDGUID_MOCKUP.psd`

Regenerate the web assets after the PSD changes:

```
npm run fg:extract
```

## Tests

```
npm test              # typecheck + unit + e2e
npm run test:unit     # command parser / dispatcher (node:test)
npm run test:e2e      # Playwright user flows, desktop + mobile
npm run fg:typecheck  # JSDoc typecheck via tsc
```

There is no production build step — deploy serves the repository as-is.

## Artwork

All artwork on this site is original work by Graham Payne.
