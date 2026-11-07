/**
 * Types for the Editor API: typed references to the patch's settings, their
 * value types, and a description of what the module has (its schema). Nothing
 * here says how to lay a UI out: a client can present the data in any shape.
 */
import type { ReadonlyPatchData, SectionKey } from '../model';

// ---------------------------------------------------------------------------
// Controls: the settings of each part of the module
// ---------------------------------------------------------------------------

export type GlobalControl = 'channel' | 'duration';

export type InputControl = 'source' | 'channel' | 'priority' | 'minNote' | 'maxNote' | 'minVel' | 'bendRange';

export type CvControl = 'source' | 'inputEvent' | 'transpose' | 'pitchScheme' | 'channel' | 'cc' | 'volts';

export type GateControl =
  | 'source' | 'inputEvent' | 'channel' | 'minNote' | 'maxNote' | 'minVel'
  | 'cc' | 'threshold' | 'divider' | 'offset' | 'duration';

export type Control = GlobalControl | InputControl | CvControl | GateControl;

/**
 * Points at one setting of one part of the module, e.g. the lowest note of
 * Gate 3: `{ section: 'gates', index: 2, control: 'minNote' }`.
 * `index` says which input/output (0-based); the globals have no index.
 */
export type FieldRef =
  | { readonly section: 'globals'; readonly control: GlobalControl }
  | { readonly section: 'inputs'; readonly index: number; readonly control: InputControl }
  | { readonly section: 'cvOutputs'; readonly index: number; readonly control: CvControl }
  | { readonly section: 'gates'; readonly index: number; readonly control: GateControl };

// ---------------------------------------------------------------------------
// Values
// ---------------------------------------------------------------------------

/** MIDI channel: 1-16, or follow the global default channel, or omni. (The global channel is 1-16 only.) */
export type ChannelValue = number | 'default' | 'omni';

/**
 * Gate length: milliseconds, or 'gate' (open while the trigger condition holds),
 * 'retrig', or 'default' (use the global trigger length). (The global length is milliseconds only.)
 */
export type DurationValue = number | 'gate' | 'retrig' | 'default';

/** Any control value. Every other control is a plain number. */
export type FieldValue = number | 'default' | 'omni' | 'gate' | 'retrig';

/** The value type of the control a FieldRef points at. */
export type ValueOf<R extends FieldRef> = R['control'] extends 'channel'
  ? ChannelValue
  : R['control'] extends 'duration'
    ? DurationValue
    : number;

// ---------------------------------------------------------------------------
// Schema: what the module has
// ---------------------------------------------------------------------------

export interface ControlOption<V extends FieldValue = FieldValue> {
  readonly value: V;
  readonly label: string;
  /** Exists but cannot be chosen (MIDI CCs reserved for NRPN data). */
  readonly disabled: boolean;
  /** The setting needs a newer module firmware. */
  readonly needsNewerFirmware: boolean;
}

/** One kind of setting, e.g. a gate's clock rate. The same for every item of a section. */
export interface ControlInfo {
  readonly control: Control;
  /** Full name, e.g. "Clock rate". */
  readonly name: string;
  /** Short form, e.g. "Ck.Rate". */
  readonly abbreviation: string;
  /** Help text. */
  readonly description: string;
  /** Related settings share a group, e.g. "clock" for clock rate and clock offset. */
  readonly group: string;
  readonly options: readonly ControlOption[];
}

/** One part of the module: the global settings, or the note inputs, CV outputs or gate outputs. */
export interface SectionInfo {
  readonly key: SectionKey;
  /** e.g. "Gate outputs". */
  readonly name: string;
  /** How many items the section has (1 for the globals, 12 gate outputs, ...). */
  readonly count: number;
  /** The settings every item of this section has. */
  readonly controls: readonly ControlInfo[];
  /** Name of one item, e.g. "Gate 3" for index 2. */
  itemName(index: number): string;
}

export interface EditorSchema {
  readonly sections: readonly SectionInfo[];
  section(key: SectionKey): SectionInfo;
}

// ---------------------------------------------------------------------------
// Views of a state
// ---------------------------------------------------------------------------

/** Everything a UI needs to present one setting. */
export interface FieldView<V extends FieldValue = FieldValue> {
  readonly ref: FieldRef;
  /** Stable unique id, e.g. "gt3.min_note" (handy as a React key). */
  readonly id: string;
  /** The current value; always one of `options`. */
  readonly value: V;
  /** False when the setting does not apply to the current choices (e.g. a CC number while the source is a note). */
  readonly enabled: boolean;
  /** What the setting is. */
  readonly info: ControlInfo;
  readonly options: readonly ControlOption<V>[];
}

/** All field views of a state, computed once (e.g. per render). */
export interface EditorView {
  readonly fields: readonly FieldView[];
  get<R extends FieldRef>(ref: R): FieldView<ValueOf<R>>;
}

/**
 * Editor state: an immutable, deep-frozen patch whose values are always ones
 * the controls can show. Create it with Editor.create / fromSysex / fromPatch
 * and change it with Editor.set.
 */
export type PatchState = ReadonlyPatchData;
