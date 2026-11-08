# Mutant Brain Surgery

A SysEx patch builder for the Hexinverter **Mutant Brain** Eurorack module, as a
static web page that also comes branded for the **CV.OCD** MIDI to CV interface.
Its SysEx library (`mutantbrain-surgery`, TypeScript, no dependencies) writes
byte-for-byte the same patch files as the original ASP site, and can be reused in
other apps.

## Maintainers

- Stacy Gaudreau, [Hexinverter Électronique](https://www.hexinverter.net/)

## License

[![CC BY-NC-SA 4.0](https://licensebuttons.net/l/by-nc-sa/4.0/88x31.png)](https://creativecommons.org/licenses/by-nc-sa/4.0/)

Licensed under [CC BY-NC-SA 4.0](https://creativecommons.org/licenses/by-nc-sa/4.0/).
Based on [CV.OCD](https://github.com/hotchk155/cvocd.a) by Jason Hotchkiss, licensed
with permission. See [`LICENSE`](LICENSE) for the full text.

## Deploy (any static host)

The website is plain static files with no server code. Pick a brand, build it,
and publish the folder:

```
cd webapp
npm ci
npm run build -- --brand mutantbrain   # -> webapp/dist/mutantbrain/
npm run build -- --brand cvocd         # -> webapp/dist/cvocd/
```

| Brand | Site |
| --- | --- |
| `mutantbrain` | Mutant Brain Surgery (Hexinverter) |
| `cvocd` | CV.OCD Patch Builder (Sixty Four Pixels) |

- **Upload it yourself:** copy the contents of `webapp/dist/<brand>/` to any web host.
- **Host builds from the repo** (Netlify, Cloudflare Pages, Vercel, ...): base
  directory `webapp`, build command `npm ci && npm run build -- --brand <brand>`,
  publish directory `dist/<brand>`.
- The `BRAND=<brand>` environment variable works instead of `--brand`, and
  `--out <folder>` builds into another folder (empty, or a previous build).
- Link previews (social cards) need the site's public address. Each brand's
  `brand.json` has its own; at another address, add `--url https://your.site`
  (or set `SITE_URL`).

## Build and test

The app lives in `webapp/`; the commands and paths from here on are relative to it.

```
cd webapp
npm install
npm run build        # type-check, then build every website and build/lib/ (library)
npm test             # builds, then runs all test suites
npm run serve        # preview Mutant Brain Surgery at http://127.0.0.1:8765/
npm run serve:cvocd  # preview the CV.OCD site at http://127.0.0.1:8766/
```

### Brands: one app, several websites

Each website is the same app (`app.js`, built from `src/app`) under a different
brand. The page and the layout are shared; a brand supplies only what differs.

| Path | Contents |
| --- | --- |
| `site/index.html` | The page, with slots: `{{title}}`, `{{description}}`, `{{themeColor}}`, `{{product}}`, `{{url}}` and the other values from `brand.json`; `{{> head}}`, `{{> header}}`, `{{> hero}}` from the brand's `.html` files |
| `site/base.css` | Shared layout and components, driven by CSS variables (listed at its top) |
| `brands/<name>/brand.json` | Site name, search title, home-screen name, description, theme colour, product name, firmware link, public address, preview image alt text, author |
| `brands/<name>/head.html`, `header.html`, `hero.html` | Icons and fonts, top bar, heading and product image |
| `brands/<name>/theme.css` | The variables, plus colours, fonts and decoration; goes after `base.css` |
| `brands/<name>/img/`, `fonts/`, `favicon.*`, `apple-touch-icon.png` | Assets, published as they are |
| `brands/<name>/art/` | Sources of the link preview image (`img/social.png`) and icons; `node tools/make-brand-images.mjs` renders them (needs Chrome) |

| Brand | Site |
| --- | --- |
| `mutantbrain` | Mutant Brain Surgery (Hexinverter), the default |
| `cvocd` | CV.OCD Patch Builder (Sixty Four Pixels) |

To add a brand, copy a brand folder and change it; `npm test` checks that the
folder is complete and that its theme sets every variable `base.css` uses.

The build also writes each site's `robots.txt`, `sitemap.xml` and
`site.webmanifest` from `brand.json`.

Without `--brand`, `npm run build` builds every brand, each to `dist/<brand>/`
(see [Deploy](#deploy-any-static-host)).

The library is checked against the ES2017 standard library with no DOM types, and
the website bundle is compiled to ES2017 (Chrome/Edge 79+, Firefox 60+, Safari 12+).

## Project layout

| Path | Contents |
|---|---|
| `src/lib/` | Library source (`index.ts` is the public API) |
| `src/app/` | Web page script |
| `build/lib/` | Built library: `index.mjs` (ESM), `index.cjs` (CommonJS), `types/*.d.ts` |
| `site/`, `brands/` | The websites: shared page and styles, and one folder per brand (see below) |
| `dist/<brand>/` | Built website of each brand (with the bundled `app.js`, compiled to ES2017) |

| `src/lib/` file | Purpose |
|---|---|
| `constants.ts` | SysEx ids: blocks, parameters, sources, channel/duration modes |
| `model.ts` | Patch data types and defaults |
| `sysex.ts` | Encode/decode: patch, parameters and bytes |
| `errors.ts` | `MutantBrainError` and its codes |
| `form/options.ts` | Dropdown option lists |
| `form/schema.ts` | Form sections, columns and field names |
| `form/display.ts`, `rules.ts`, `submit.ts` | Patch to form, enabled fields, form to patch |
| `MutantBrainPatch.ts` | The main class |
| `editor/` | `Editor`: typed, immutable API for building UIs (e.g. React) |
| `document.ts` | `PatchDocument`: the patch an app has open |

## Library

`src/lib/` is a dependency-free, DOM-free TypeScript library, built to
`build/lib/` as ESM, CommonJS and type declarations. Copy `src/lib/` into a
project, or depend on this package:

```ts
import { MutantBrainPatch, Editor, PatchDocument, SOURCE } from 'mutantbrain-surgery';
```

| API | Use it for |
|---|---|
| `MutantBrainPatch` | Raw patch data: read, change and write `.syx` files |
| `Editor` | Building a configurator UI: typed, immutable, says nothing about layout |
| `PatchDocument` | The patch an app has open: name, settings, modified flag, save |

```ts
// MutantBrainPatch: plain data (globals, inputs[4], cvOutputs[4], gates[12]; see model.ts)
const patch = MutantBrainPatch.fromSysex(bytes);   // Uint8Array | ArrayBuffer | number[]
patch.gates[0].source = SOURCE.MIDI_NOTE;          // gates[0] is Gate 1
const out = patch.toSysex();                       // F0 00 7F 15 ... F7

// Editor: pure functions over an immutable state
let state = Editor.fromSysex(bytes);
state = Editor.set(state, { section: 'gates', index: 2, control: 'minNote' }, 36);  // Gate 3
const view = Editor.view(state);                   // per field: value, enabled, options, name, description
Editor.toSysex(state);

// PatchDocument: an Editor state with a name and a modified flag
let doc = PatchDocument.open('TR-08.syx', bytes);  // name "TR-08"
doc = PatchDocument.rename(doc, 'My kit');
const { fileName, bytes: saved } = PatchDocument.save(doc);   // "My kit.syx"
```

The output is byte-for-byte what the original site wrote for the same settings
(settings that don't apply are saved as 0). Errors are thrown as
`MutantBrainError` with a `code` (`BAD_HEADER`, `TRUNCATED`, `BAD_FIELD_REF`, ...).
The rest of the API (schema, field ids for React keys, the web page's `Form`
helpers, constants) is documented in `src/lib/index.ts` and the type declarations.
