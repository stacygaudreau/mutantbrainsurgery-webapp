# mutantbrain-sysex.js

SysEx patch codec for the Hexinverter **Mutant Brain**, used by the Mutant Brain
Surgery web page (`public/`). The module is `public/lib/mutantbrain-sysex.js`: one
file with no dependencies and no UI code, so another app (desktop, CLI, a
different web UI) can reuse it as-is. Types are in `mutantbrain-sysex.d.ts`.
Its output is byte-for-byte identical to the original ASP site's.

## Loading

```html
<script src="lib/mutantbrain-sysex.js"></script>   <!-- window.MutantBrainSysex -->
```

```js
const MB = require('./mutantbrain-sysex.js');      // Node / Electron (CommonJS)
import MB from './mutantbrain-sysex.js';           // ESM / bundlers
const { MutantBrainPatch, Form, SOURCE, CHAN, DURATION } = MB;
```

## Read, change, write a .syx

```js
const patch = MutantBrainPatch.fromSysex(bytes);   // Uint8Array | ArrayBuffer | number[]
patch.gates[0].source = SOURCE.MIDI_NOTE;          // gates[0] = "Gate.1"
patch.gates[0].minNote = 36;
patch.gates[0].maxNote = 36;
const out = patch.toSysex();                       // Uint8Array: F0 00 7F 15 ... F7
```

## MutantBrainPatch

| Member | Description |
|---|---|
| `new MutantBrainPatch()` | Default patch (the original code's defaults) |
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

## Form helpers (for building a UI)

`Form.SECTIONS` and `Form.FIELDS` describe every dropdown: field names (`'gt1.src'`,
`'cv2.trans'`, …), option values and labels, disabled options, column headers and
tooltips.

```js
const values = patch.toFormValues();            // { 'gt1.src': '1', 'gt1.min_note': '36', ... }
const enabled = Form.enabledFields(values);     // { 'gt1.cc': false, ... }
const bytes = MutantBrainPatch.fromFormValues(values).toSysex();
```

Other helpers: `Form.field(name)`, `Form.submittedValues(values)`,
`Form.defaultFormValues()`, `Form.OPTIONS`, `Form.FIRMWARE_URL`.

## Errors

Everything throws `MutantBrainError` with a `code`:

- `BAD_INPUT`: the data isn't bytes
- `BAD_HEADER`: not a Mutant Brain SysEx
- `TRUNCATED`, `MISSING_END`: the message is cut short or has no F7
- `UNKNOWN_BLOCK`: a parameter for a block the module doesn't have
- `INVALID_VALUE`: a value can't be encoded
- `BAD_FORM_VALUE`: a form value isn't a valid option

## Constants

`SOURCE`, `CHAN`, `DURATION`, `PARAM`, `BLOCK`, `MANUFACTURER_ID`,
`LEGACY_MANUFACTURER_ID` (`00 7F 12`, accepted when loading), `CV_EVENT_VELOCITY`,
`NUM_INPUTS`, `NUM_CVS`, `NUM_GATES`, `DEFAULT_FILENAME`.

## Deploy / test

```
firebase deploy      # from webapp/, publishes public/ to Firebase Hosting
npm test             # test suites (npm install first for the browser tests)
```

## License

CC BY-NC-SA 4.0. See [`../LICENSE`](../LICENSE) for attribution and the full text.
