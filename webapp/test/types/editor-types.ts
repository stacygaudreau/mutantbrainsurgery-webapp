/**
 * Compile-time tests for the Editor API's types (checked by `npm run typecheck`).
 * Every `@ts-expect-error` line MUST fail to compile; if one compiles, tsc
 * reports "Unused '@ts-expect-error' directive" and the check fails.
 */
import {
  Editor,
  type ChannelValue,
  type DurationValue,
  type FieldRef,
  type FieldView,
  type PatchState,
  type ValueOf,
} from '../../src/lib';

declare const bytes: Uint8Array;
const state: PatchState = Editor.fromSysex(bytes);

// --- valid usage --------------------------------------------------------------

Editor.set(state, { section: 'gates', index: 0, control: 'minNote' }, 36);
Editor.set(state, { section: 'gates', index: 0, control: 'channel' }, 'omni');
Editor.set(state, { section: 'gates', index: 0, control: 'channel' }, 10);
Editor.set(state, { section: 'gates', index: 0, control: 'duration' }, 'gate');
Editor.set(state, { section: 'gates', index: 0, control: 'duration' }, 45);
Editor.set(state, { section: 'cvOutputs', index: 3, control: 'transpose' }, 52);
Editor.set(state, { section: 'inputs', index: 1, control: 'priority' }, 9);
Editor.set(state, { section: 'globals', control: 'channel' }, 10);
const next: PatchState = Editor.set(state, { section: 'globals', control: 'duration' }, 120);

const transpose: number = Editor.get(next, { section: 'cvOutputs', index: 1, control: 'transpose' });
const channel: ChannelValue = Editor.get(next, { section: 'inputs', index: 0, control: 'channel' });
const length: DurationValue = Editor.view(next).get({ section: 'gates', index: 5, control: 'duration' }).value;
const minVel: FieldView<number> = Editor.field(next, { section: 'gates', index: 0, control: 'minVel' });
const anyRef: FieldRef = Editor.fieldsOf('gates', 0)[0];
const bytesOut: Uint8Array = Editor.toSysex(next);
type CcValue = ValueOf<{ section: 'gates'; index: 0; control: 'cc' }>;
const cc: CcValue = 1;

// generic UI code: any ref with a value taken from that field's own options
const view = Editor.view(next);
for (const f of view.fields) Editor.setValue(next, f.ref, f.options[0].value);
// @ts-expect-error setValue still only takes control values, not arbitrary strings
Editor.setValue(next, anyRef, '36');

// --- misuse that must not compile ---------------------------------------------

// @ts-expect-error a number control takes numbers, not strings
Editor.set(state, { section: 'gates', index: 0, control: 'minNote' }, '36');
// @ts-expect-error 'gate' is a duration value, not a channel value
Editor.set(state, { section: 'gates', index: 0, control: 'channel' }, 'gate');
// @ts-expect-error 'omni' is a channel value, not a duration value
Editor.set(state, { section: 'gates', index: 0, control: 'duration' }, 'omni');
// @ts-expect-error note inputs have no CC control
Editor.set(state, { section: 'inputs', index: 0, control: 'cc' }, 1);
// @ts-expect-error CV outputs have no duration control
Editor.set(state, { section: 'cvOutputs', index: 0, control: 'duration' }, 10);
// @ts-expect-error gates need an index (which gate)
Editor.set(state, { section: 'gates', control: 'minNote' }, 1);
// @ts-expect-error there is no positional `row`; it is `index`
Editor.set(state, { section: 'gates', row: 0, control: 'minNote' }, 1);
// @ts-expect-error the schema describes items, not a table layout
Editor.schema.sections[0].rows;
// @ts-expect-error there is no Editor.layout any more
Editor.layout;
// @ts-expect-error unknown section
Editor.set(state, { section: 'leds', index: 0, control: 'source' }, 1);
// @ts-expect-error states are read-only
state.gates[0].minNote = 3;
// @ts-expect-error item arrays are read-only
state.gates.push(state.gates[0]);
// @ts-expect-error a channel value is not always a number
const notANumber: number = channel;
// @ts-expect-error a duration value is not a channel value
const wrongKind: ChannelValue = length;

export { anyRef, bytesOut, cc, minVel, notANumber, transpose, wrongKind };
