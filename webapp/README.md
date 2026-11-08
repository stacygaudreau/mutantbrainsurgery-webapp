# mutantbrain-sysex

SysEx patch codec for the Hexinverter **Mutant Brain**, written in TypeScript.
It converts between patches, SysEx bytes (`.syx` files) and the patch form, and its
output is byte-for-byte identical to the original ASP site's. It has no dependencies
and no DOM or platform code, so a desktop app (Electron, Tauri), a CLI or another web
UI can reuse it as-is. The Mutant Brain Surgery web page (`src/app`) is built on it.

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

## Deploy (any static host)

The website is plain static files with no server code. Pick a brand, build it,
and publish the folder:

```
npm ci
npm run build -- --brand mutantbrain   # -> dist/mutantbrain/
npm run build -- --brand cvocd         # -> dist/cvocd/
```

| Brand | Site |
| --- | --- |
| `mutantbrain` | Mutant Brain Surgery (Hexinverter) |
| `cvocd` | CV.OCD Patch Builder (Sixty Four Pixels) |

- **Upload it yourself:** copy the contents of `dist/<brand>/` to any web host.
- **Host builds from the repo** (Netlify, Cloudflare Pages, Vercel, ...): base
  directory `webapp`, build command `npm ci && npm run build -- --brand <brand>`,
  publish directory `dist/<brand>`.
- The `BRAND=<brand>` environment variable works instead of `--brand`, and
  `--out <folder>` builds into another folder (empty, or a previous build).
- Firebase is already set up for `mutantbrain`: `firebase deploy` from `webapp/`.

## Using it in another project

Either copy `src/lib/` into a TypeScript project, or build (`npm run build`) and
depend on this package, which exports `build/lib` with types:

```ts
import { MutantBrainPatch, Form, SOURCE, CHAN, DURATION, type PatchData } from 'mutantbrain-surgery';
// CommonJS: const { MutantBrainPatch } = require('mutantbrain-surgery');
```

## Read, change, write a .syx

```ts
const bytes = fs.readFileSync('patch.syx');        // or a File/Blob's ArrayBuffer in a browser
const patch = MutantBrainPatch.fromSysex(bytes);   // Uint8Array | ArrayBuffer | number[]
patch.gates[0].source = SOURCE.MIDI_NOTE;          // gates[0] = "Gate.1"
patch.gates[0].minNote = 36;
patch.gates[0].maxNote = 36;
const out = patch.toSysex();                       // Uint8Array: F0 00 7F 15 ... F7
```

## MutantBrainPatch

| Member | Description |
|---|---|
| `new MutantBrainPatch(data?)` | Default patch (the original code's defaults), or a deep copy of `data` |
| `MutantBrainPatch.fromSysex(bytes)` | Decode a .syx message; throws `MutantBrainError` |
| `MutantBrainPatch.parseParams(bytes)` | Raw `[block, param, v1, v2][]` (framing checks only) |
| `MutantBrainPatch.fromFormValues(values)` | Build from form values, applying the page's enable/disable and submission rules |
| `MutantBrainPatch.fromSubmittedForm(fields)` | Raw form read: fields that aren't present read as 0 |
| `MutantBrainPatch.fromJSON(json)` | Build from `toJSON()` output |
| `patch.toSysex()` | Encode; throws `INVALID_VALUE` for values outside 0..127 |
| `patch.toParams()` | Parameters in transmission order |
| `patch.applyParam(block, param, v1, v2)` | Apply one parameter (chainable) |
| `patch.toFormValues()` | Value each form dropdown shows for this patch |
| `patch.normalize()` | What loading this patch into the form and saving it again produces |
| `patch.clone()`, `patch.toJSON()`, `patch.encodesSameAs(other)` | Utilities |

### Data model (all values are the raw numbers sent to the module)

- `globals`: `chanType`, `chanNumber`, `durationType`, `duration`
- `inputs[0..3]` ("Input.1"-"Input.4"): `source`, `chanType`, `chanNumber`, `priority`, `minNote`, `maxNote`, `minVel`, `bendRange`
- `cvOutputs[0..3]` ("CV.A"-"CV.D"): `source`, `inputEvent`, `transpose`, `chanType`, `chanNumber`, `cc`, `volts`, `pitchScheme`
- `gates[0..11]` ("Gate.1"-"Gate.12"): `source`, `inputEvent`, `chanType`, `chanNumber`, `minNote`, `maxNote`, `minVel`, `cc`, `threshold`, `divider`, `offset`, `durationType`, `duration`

## Editor (for building a UI, e.g. React)

`Editor` is the recommended way to build a configurator. It is a set of pure
functions over an immutable, deep-frozen `PatchState`. It describes what the
module has and says nothing about layout, so a client can present it however it
likes: tables, cards per output, tabs, a patch-bay diagram, a single
"selected gate" panel, and so on.

- **Sections** are the parts of the module: `globals`, `inputs` (4), `cvOutputs` (4) and `gates` (12).
- **Items** are individual inputs and outputs, addressed by `index` (0-based: Gate 3 is index 2).
  The globals are a single item with no index.
- **Controls** are the settings each item has (`source`, `minNote`, `channel`, ...).
- **Fields** are one control of one item: `{ section: 'gates', index: 2, control: 'minNote' }`.
- **Values** are numbers, plus `'default' | 'omni'` for channels and `'gate' | 'retrig' | 'default'` for gate lengths.

`Editor.toSysex` produces exactly the bytes the original site would for the same
visible settings.

```tsx
import { Editor, type FieldRef, type FieldValue, type PatchState } from 'mutantbrain-surgery';

// setValue: for generic UI code (one component for every control); returns the same state if nothing changed
const reducer = (state: PatchState, action: { ref: FieldRef; value: FieldValue }) =>
  Editor.setValue(state, action.ref, action.value);

function GateCards({ bytes }: { bytes: Uint8Array }) {
  const [state, dispatch] = useReducer(reducer, bytes, Editor.fromSysex);
  const view = useMemo(() => Editor.view(state), [state]);
  const gates = Editor.schema.section('gates');
  return Array.from({ length: gates.count }, (_, index) => (
    <Card key={index} title={gates.itemName(index)}>                       {/* "Gate 3" */}
      {Editor.fieldsOf('gates', index).map((ref) => {
        const f = view.get(ref);   // { id, value, enabled, options, info: { name, description, group, ... } }
        return f.enabled && <Choice key={f.id} field={f} onChange={(value) => dispatch({ ref, value })} />;
      })}
    </Card>
  ));
}
// save: Editor.toSysex(state)
```

| Function | Description |
|---|---|
| `Editor.schema.sections`, `Editor.schema.section(key)` | Per section: `name`, `count` (number of items), `itemName(index)` ("Gate 3") and `controls` |
| `Editor.fieldsOf(section, index)` | Every field of one item, e.g. all settings of Gate 3 |
| `Editor.create()` / `fromSysex(bytes)` / `fromPatch(data)` | New state (fresh form / loaded file / any patch data) |
| `Editor.set(state, ref, value)` | New state with one setting changed (value type checked against the control). Unchanged items are shared, and `state` itself is returned if nothing changed. Throws `BAD_FIELD_REF` / `BAD_FORM_VALUE` |
| `Editor.setValue(state, ref, value)` | Same, for generic UI code handling any control |
| `Editor.view(state)` | Every field's `{ ref, id, value, enabled, info, options }`; `view.get(ref)` |
| `Editor.get(state, ref)`, `Editor.field(state, ref)`, `Editor.isEnabled(state, ref)` | Single-field helpers |
| `Editor.toSysex(state)` | Bytes to send or save |
| `Editor.toPatch(state)` | The `MutantBrainPatch` actually sent (settings that don't apply are 0) |
| `Editor.idOf(ref)` / `Editor.refOf(id)` | Stable field id (`"gt3.min_note"`, handy as a React key) and back |

A control's `info` is `{ control, name, abbreviation, description, group, options }`.
`group` links related settings (e.g. `"clock"` for clock rate and clock offset). Options
are `{ value, label, disabled, needsNewerFirmware }`; `disabled` marks the MIDI CCs
reserved for NRPN. States are always canonical: they hold exactly the values the
controls show. Values set on a control that doesn't currently apply are kept, and
used once it applies again.

## PatchDocument (the patch an app has open)

A `PatchDocument` is what an editor holds in memory: `{ name, patch, modified }`,
where `patch` is an Editor state and `modified` says whether the settings changed
since the patch was created, opened or saved. Documents are immutable (frozen);
every function returns a new document, or the same one when nothing changed, so
it can be React state or the subject of a reducer.

```ts
import { PatchDocument } from 'mutantbrain-sysex';

let doc = PatchDocument.open('Roland TR-08.syx', bytes);   // name "Roland TR-08"
doc = PatchDocument.set(doc, { section: 'gates', index: 0, control: 'minNote' }, 38);
doc.modified;                                               // true
doc = PatchDocument.rename(doc, 'My TR-08');
const { fileName, bytes: out, document } = PatchDocument.save(doc);
// fileName "My TR-08.syx", out = the SysEx, document = doc with modified false
```

| Function | |
| --- | --- |
| `PatchDocument.create(name = 'untitled')` | A new patch with fresh settings |
| `PatchDocument.open(fileName, bytes)` | Settings from a .syx, name from its file name; throws `MutantBrainError` for a bad file |
| `PatchDocument.set(doc, ref, value)` / `setValue` | Change one setting (typed / generic), marks the document modified |
| `PatchDocument.rename(doc, name)` | New name; the settings and `modified` are unchanged |
| `PatchDocument.clear(doc)` | Fresh settings, same name |
| `PatchDocument.fileName(doc)` | The name made safe as a file name, plus `.syx` |
| `PatchDocument.toSysex(doc)` | Bytes of the current settings |
| `PatchDocument.save(doc)` | `{ fileName, bytes, document }`; `document` is marked saved |
| `PatchDocument.nameFromFileName(fileName)` | Base name without folder or `.syx` |

The name is kept as typed; `fileName` replaces characters not allowed in file
names with `-` and falls back to `untitled`. As on the original site, settings that
don't apply are saved as 0, so they come back as 0 when the file is opened again.

## Form helpers (the web page's string-based form)

`Form.SECTIONS` and `Form.FIELDS` describe every dropdown: field names (`'gt1.src'`,
`'cv2.trans'`, …), option values and labels, disabled options, column headers and
tooltips.

```ts
const values = patch.toFormValues();            // { 'gt1.src': '1', 'gt1.min_note': '36', ... }
const enabled = Form.enabledFields(values);     // { 'gt1.cc': false, ... }
const bytes = MutantBrainPatch.fromFormValues(values).toSysex();
```

Other helpers: `Form.field(name)`, `Form.fieldName(section, row, column)`,
`Form.submittedValues(values)`, `Form.defaultFormValues()`,
`Form.completeFormValues(values)`, `Form.OPTIONS`, `Form.FIRMWARE_URL`.

## Errors

Everything throws `MutantBrainError` (a subclass of `Error`) with a `code`:

- `BAD_INPUT`: the data isn't bytes
- `BAD_HEADER`: not a Mutant Brain SysEx
- `TRUNCATED`, `MISSING_END`: the message is cut short or has no F7
- `UNKNOWN_BLOCK`: a parameter for a block the module doesn't have
- `INVALID_VALUE`: a value can't be encoded
- `BAD_FORM_VALUE`: a form value isn't a valid option
- `BAD_FIELD_REF`: an Editor reference to a section, item index or control that doesn't exist

## Constants

`SOURCE`, `CHAN`, `DURATION`, `PARAM`, `BLOCK`, `MANUFACTURER_ID`,
`LEGACY_MANUFACTURER_ID` (`00 7F 12`, accepted when loading), `CV_EVENT_VELOCITY`,
`NUM_INPUTS`, `NUM_CVS`, `NUM_GATES`, `DEFAULT_FILENAME` (the original site's
download name), `DEFAULT_PATCH_NAME`, `PATCH_FILE_EXTENSION`.

## Build, test, deploy

```
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
| `site/index.html` | The page, with slots: `{{title}}`, `{{description}}`, `{{themeColor}}`, `{{product}}`, `{{firmwareUrl}}` from `brand.json`; `{{> head}}`, `{{> header}}`, `{{> hero}}` from the brand's `.html` files |
| `site/base.css` | Shared layout and components, driven by CSS variables (listed at its top) |
| `brands/<name>/brand.json` | Title, description, theme colour, product name, firmware link |
| `brands/<name>/head.html`, `header.html`, `hero.html` | Fonts, top bar, heading and product image |
| `brands/<name>/theme.css` | The variables, plus colours, fonts and decoration; goes after `base.css` |
| `brands/<name>/img/`, `fonts/` | Assets, published as they are |

| Brand | Site |
| --- | --- |
| `mutantbrain` | Mutant Brain Surgery (Hexinverter), the default |
| `cvocd` | CV.OCD Patch Builder (Sixty Four Pixels) |

To add a brand, copy a brand folder and change it; `npm test` checks that the
folder is complete and that its theme sets every variable `base.css` uses.

Without `--brand`, `npm run build` builds every brand, each to `dist/<brand>/`
(see [Deploy](#deploy-any-static-host)).

The library is checked against the ES2017 standard library with no DOM types, and
the website bundle is compiled to ES2017 (Chrome/Edge 79+, Firefox 60+, Safari 12+).

## License

CC BY-NC-SA 4.0. See [`../LICENSE`](../LICENSE) for attribution and the full text.
