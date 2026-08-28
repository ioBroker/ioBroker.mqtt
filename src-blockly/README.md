# Blockly blocks

Source of `admin/blockly.js`, the file the Blockly editor of ioBroker.javascript loads to add the
mqtt blocks to its "sendTo" category.

**`admin/blockly.js` is generated — do not edit it.** Change the sources here and run:

```bash
npm run build:blockly
```

which type-checks (`tsc -p src-blockly/tsconfig.json`) and bundles (`src-blockly/build.mjs`).
`npm run build` does both this and the adapter build.

## Layout

| File | |
|---|---|
| `blockly.ts` | entry point, installs the words and every block |
| `blocks/*.ts` | one file per block: toolbox XML, block definition, code generator |
| `helpers.ts` | shared pieces (instance dropdown, generator registration) |
| `words.ts` | turns `i18n/*.json` into the `Blockly.Words` table |
| `i18n/*.json` | the translations, one file per language |
| `iobroker-blockly.d.ts` | the globals the editor provides |

## Two things that are easy to get wrong

**Never import the Blockly runtime.** The block files take it from `window.Blockly` and use the
`blockly` package for types only (`import type`). An `import { ... } from 'blockly/core'` would
bundle a second, private Blockly instance into `admin/blockly.js`, and every block registered on it
would be invisible to the editor's own instance.

**Register generators through `registerGenerator()`.** Blockly 10 moved generator lookup to
`Blockly.JavaScript.forBlock`, and the editor migrates its own generators into it *before* it loads
any adapter's `blockly.js`. An adapter that assigns to `Blockly.JavaScript['<type>']` directly is
therefore never migrated and its block silently produces no code. `registerGenerator()` writes to
whichever of the two the editor offers.

## Translations

The words live in `i18n/`, English is the source:

```bash
npm run translate:blockly
```

A language that is missing a word falls back to English, so the files may be incomplete. URLs (the
`*_help` entries) are not words — they are set in `words.ts` and must not go through the translator.
