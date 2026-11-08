/**
 * Compile-time tests for PatchDocument's types (checked by `npm run typecheck`).
 * Every `@ts-expect-error` line MUST fail to compile.
 */
import { DEFAULT_PATCH_NAME, Editor, PatchDocument, type PatchState, type SavedPatch } from '../../src/lib';

declare const bytes: Uint8Array;

// --- valid usage --------------------------------------------------------------

let doc: PatchDocument = PatchDocument.open('Roland TR-08.syx', bytes);
doc = PatchDocument.create();
doc = PatchDocument.create('Drums');
doc = PatchDocument.set(doc, { section: 'gates', index: 0, control: 'minNote' }, 38);
doc = PatchDocument.set(doc, { section: 'gates', index: 0, control: 'channel' }, 'omni');
doc = PatchDocument.set(doc, { section: 'gates', index: 0, control: 'duration' }, 'retrig');
doc = PatchDocument.rename(doc, 'My kit');
doc = PatchDocument.clear(doc);
// generic UI code: a ref and a value from that field's options
const field = Editor.view(doc.patch).fields[0];
doc = PatchDocument.setValue(doc, field.ref, field.options[0].value);

const saved: SavedPatch = PatchDocument.save(doc);
const fileName: string = saved.fileName;
const out: Uint8Array = saved.bytes;
doc = saved.document;
const patch: PatchState = doc.patch;
const modified: boolean = doc.modified;
const name: string = PatchDocument.fileName(doc) + DEFAULT_PATCH_NAME + PatchDocument.nameFromFileName('a.syx');
const sysex: Uint8Array = PatchDocument.toSysex(doc);

// a React-style reducer is plain typed code
type Action = { type: 'rename'; name: string } | { type: 'clear' } | { type: 'saved' };
const reducer = (state: PatchDocument, action: Action): PatchDocument => {
  switch (action.type) {
    case 'rename': return PatchDocument.rename(state, action.name);
    case 'clear': return PatchDocument.clear(state);
    case 'saved': return PatchDocument.save(state).document;
  }
};

// --- misuse that must not compile -----------------------------------------------

// @ts-expect-error documents are read-only
doc.name = 'x';
// @ts-expect-error documents are read-only
doc.modified = false;
// @ts-expect-error the settings are read-only
doc.patch.gates[0].minNote = 3;
// @ts-expect-error a note number is a number
PatchDocument.set(doc, { section: 'gates', index: 0, control: 'minNote' }, 'omni');
// @ts-expect-error a duration keyword is not a channel value
PatchDocument.set(doc, { section: 'gates', index: 0, control: 'channel' }, 'retrig');
// @ts-expect-error unknown section
PatchDocument.set(doc, { section: 'leds', index: 0, control: 'source' }, 1);
// @ts-expect-error open needs a file name and the bytes
PatchDocument.open(bytes);
// @ts-expect-error saved results are read-only
saved.fileName = 'x.syx';

export { fileName, modified, name, out, patch, reducer, sysex };
