/**
 * The Editor API: an immutable, typed patch editor for building UIs (e.g.
 * React). It has no UI dependencies.
 *
 *   let state = Editor.fromSysex(bytes);                  // or Editor.create()
 *   state = Editor.set(state, { section: 'gates', index: 0, control: 'minNote' }, 36);
 *   const view = Editor.view(state);                      // values, options, enabled
 *   const out = Editor.toSysex(state);                    // bytes to send / save
 *
 * `Editor.schema` describes what the module has (sections, item counts,
 * settings) without prescribing any layout.
 *
 * Every state is deep-frozen and `set` returns a new state that shares every
 * unchanged item, so React can compare states and items by reference.
 *
 * States are canonical: every value is one the controls can show. `toSysex`
 * applies the original site's rules (settings that don't apply to the chosen
 * source are sent as 0), so it produces exactly the bytes the original web
 * page would produce for the same visible settings.
 */
import { MutantBrainError } from '../errors';
import { MutantBrainPatch } from '../MutantBrainPatch';
import { defaultPatchData, type PatchData, type PatchItem, type ReadonlyPatchData } from '../model';
import { patchToFormValues, itemOf, shownFieldValue } from '../form/display';
import { enabledFields } from '../form/rules';
import { FIELDS } from '../form/schema';
import { readSubmittedForm, writeFieldValue } from '../form/submit';
import { applyParam, sysexToParams, type ByteInput } from '../sysex';
import { SCHEMA, fieldsOf, idOf, optionValueOf, refOf, resolveRef, typedValue } from './schema';
import type { EditorView, FieldRef, FieldValue, FieldView, PatchState, ValueOf } from './types';

// ---------------------------------------------------------------------------
// Creating states
// ---------------------------------------------------------------------------

/** A fresh patch, as shown by an empty form. */
function create(): PatchState {
  return fromPatch(defaultPatchData());
}

/** Load a SysEx message (.syx file contents). Throws MutantBrainError on invalid data. */
function fromSysex(data: ByteInput): PatchState {
  const patch = defaultPatchData();
  for (const param of sysexToParams(data)) applyParam(patch, param);
  return fromPatch(patch);
}

/**
 * Make an editor state from any patch data: each value becomes the one its
 * control shows (e.g. a minimum velocity of 0, which has no option, becomes
 * "(any)" = 1). The input is not modified.
 */
function fromPatch(data: ReadonlyPatchData): PatchState {
  return deepFreeze(readSubmittedForm(patchToFormValues(data)));
}

// ---------------------------------------------------------------------------
// Changing a state
// ---------------------------------------------------------------------------

/**
 * Return a new state with one control changed. The value must be one of the
 * control's selectable options (throws BAD_FORM_VALUE otherwise, or
 * BAD_FIELD_REF for an unknown control). Returns `state` itself if nothing changes.
 */
function set<R extends FieldRef>(state: PatchState, ref: R, value: ValueOf<R>): PatchState {
  return setValue(state, ref, value);
}

/**
 * `set` for generic UI code that handles any control (e.g. one dropdown
 * component for all fields, passing back `option.value`). Same behaviour and
 * runtime validation; only the compile-time pairing of ref and value is looser.
 */
function setValue(state: PatchState, ref: FieldRef, value: FieldValue): PatchState {
  const { field: f } = resolveRef(ref);
  const optionValue = optionValueOf(f.column, value);
  const option = optionValue === null ? undefined : f.options.find((o) => o.value === optionValue);
  if (optionValue === null || !option || option.disabled) {
    throw new MutantBrainError('BAD_FORM_VALUE', `${String(value)} is not a selectable value for ${f.name}`, { ref, value });
  }
  if (shownFieldValue(state, f) === optionValue) return state;

  // Copy only the changed item (e.g. one gate); every other item is shared with `state`.
  const item = { ...itemOf(state, f) } as PatchItem;
  writeFieldValue(item, f, optionValue);
  Object.freeze(item);

  if (f.section === 'globals') return Object.freeze({ ...state, globals: item as PatchData['globals'] });
  const items: Readonly<PatchItem>[] = state[f.section].slice();
  items[f.index] = item;
  return Object.freeze({ ...state, [f.section]: Object.freeze(items) }) as PatchState;
}

// ---------------------------------------------------------------------------
// Reading a state
// ---------------------------------------------------------------------------

/** Per field, the parts of a view that never change. */
const STATIC_FIELDS = FIELDS.map((f) => {
  const ref = refOf(f.name);
  return { f, ref, info: resolveRef(ref).info };
});

/** Values, options and enabled flags of every setting, computed once. */
function view(state: PatchState): EditorView {
  const values = patchToFormValues(state);
  const enabled = enabledFields(values);
  const byId = new Map<string, FieldView>();
  const fields = STATIC_FIELDS.map(({ f, ref, info }) => {
    const fieldView: FieldView = Object.freeze({
      ref,
      id: f.name,
      value: typedValue(f.column, values[f.name]),
      enabled: enabled[f.name],
      info,
      options: info.options,
    });
    byId.set(f.name, fieldView);
    return fieldView;
  });
  return Object.freeze({
    fields: Object.freeze(fields),
    get<R extends FieldRef>(ref: R): FieldView<ValueOf<R>> {
      return byId.get(idOf(ref)) as unknown as FieldView<ValueOf<R>>;
    },
  });
}

/** One control's view. (For many controls, compute `view(state)` once instead.) */
function field<R extends FieldRef>(state: PatchState, ref: R): FieldView<ValueOf<R>> {
  return view(state).get(ref);
}

/** The current value of one control. */
function get<R extends FieldRef>(state: PatchState, ref: R): ValueOf<R> {
  const { field: f } = resolveRef(ref);
  return typedValue(f.column, shownFieldValue(state, f)) as ValueOf<R>;
}

/** Whether a control applies to the current settings. */
function isEnabled(state: PatchState, ref: FieldRef): boolean {
  return enabledFields(patchToFormValues(state))[idOf(ref)];
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

/**
 * The patch that is actually sent: settings that don't apply to the chosen
 * sources are 0 (exactly what the original site sent).
 */
function toPatch(state: PatchState): MutantBrainPatch {
  return MutantBrainPatch.fromFormValues(patchToFormValues(state));
}

/** The SysEx message for this state (F0 00 7F 15 ... F7). */
function toSysex(state: PatchState): Uint8Array {
  return toPatch(state).toSysex();
}

// ---------------------------------------------------------------------------

function deepFreeze(data: PatchData): PatchState {
  Object.freeze(data.globals);
  for (const items of [data.inputs, data.cvOutputs, data.gates]) {
    items.forEach((item) => Object.freeze(item));
    Object.freeze(items);
  }
  return Object.freeze(data);
}

/** The patch editor. All functions are pure; states are immutable. */
export const Editor = Object.freeze({
  /** What the module has: sections, item counts and settings (no layout). */
  schema: SCHEMA,
  /** Every setting of one item, e.g. all fields of Gate 3: `fieldsOf('gates', 2)`. */
  fieldsOf,
  create,
  fromSysex,
  fromPatch,
  set,
  setValue,
  get,
  view,
  field,
  isEnabled,
  toPatch,
  toSysex,
  /** Stable field id for a reference, e.g. "gt3.min_note". */
  idOf,
  /** Reference for a field id. */
  refOf,
});
