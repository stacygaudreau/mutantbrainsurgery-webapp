// Type declarations for mutantbrain-sysex.js (UMD: CommonJS / AMD / browser global `MutantBrainSysex`).

export type ByteInput = Uint8Array | ArrayBuffer | ArrayBufferView | number[];
/** [blockId, paramId, v1, v2] */
export type Param = [number, number, number, number];

export interface Globals { chanType: number; chanNumber: number; durationType: number; duration: number; }
export interface NoteInput {
  source: number; chanType: number; chanNumber: number; priority: number;
  minNote: number; maxNote: number; minVel: number; bendRange: number;
}
export interface CvOutput {
  source: number; inputEvent: number; transpose: number; chanType: number; chanNumber: number;
  cc: number; volts: number; pitchScheme: number;
}
export interface GateOutput {
  source: number; inputEvent: number; chanType: number; chanNumber: number;
  minNote: number; maxNote: number; minVel: number; cc: number; threshold: number;
  divider: number; offset: number; durationType: number; duration: number;
}
export interface PatchJSON { globals: Globals; inputs: NoteInput[]; cvOutputs: CvOutput[]; gates: GateOutput[]; }

/** Field name (e.g. "cv2.trans") -> option value (always a string, e.g. "64", "default"). */
export type FormValues = Record<string, string>;

export declare class MutantBrainPatch {
  constructor();
  globals: Globals;
  /** inputs[0] = "Input.1" */
  inputs: NoteInput[];
  /** cvOutputs[0] = "CV.A" */
  cvOutputs: CvOutput[];
  /** gates[0] = "Gate.1" */
  gates: GateOutput[];

  /** Decode a .syx message. Throws MutantBrainError. */
  static fromSysex(data: ByteInput): MutantBrainPatch;
  /** Split a .syx message into raw params (framing checks only). */
  static parseParams(data: ByteInput): Param[];
  /** Displayed form values -> patch, applying the page's enable rules and browser submission rules. */
  static fromFormValues(values?: Partial<FormValues>): MutantBrainPatch;
  /** Raw get_sysex.asp ReadForm semantics: absent fields read as 0. */
  static fromSubmittedForm(submitted: Partial<FormValues>): MutantBrainPatch;
  static fromJSON(json: Partial<PatchJSON>): MutantBrainPatch;

  /** Encode to F0 00 7F 15 ... F7. Throws MutantBrainError (INVALID_VALUE). */
  toSysex(): Uint8Array;
  toParams(): Param[];
  applyParam(block: number, param: number, v1: number, v2: number): this;
  /** What each form <select> shows for this patch. */
  toFormValues(): FormValues;
  /** What the original site saves after loading this patch and pressing the button. */
  normalize(): MutantBrainPatch;
  clone(): MutantBrainPatch;
  toJSON(): PatchJSON;
  encodesSameAs(other: MutantBrainPatch): boolean;
}

export type MutantBrainErrorCode =
  | 'BAD_INPUT' | 'BAD_HEADER' | 'TRUNCATED' | 'MISSING_END'
  | 'UNKNOWN_BLOCK' | 'INVALID_VALUE' | 'BAD_FORM_VALUE';

export interface MutantBrainError extends Error {
  name: 'MutantBrainError';
  code: MutantBrainErrorCode;
  details?: unknown;
}
export declare const MutantBrainError: {
  (code: MutantBrainErrorCode, message: string, details?: unknown): MutantBrainError;
  new (code: MutantBrainErrorCode, message: string, details?: unknown): MutantBrainError;
  prototype: MutantBrainError;
};

export interface FormOption { readonly value: string; readonly label: string; readonly disabled?: true; }
export interface FormColumn {
  readonly field: string;
  readonly kind: 'byte' | 'chan' | 'dur';
  readonly prop: string;
  readonly options: readonly FormOption[];
  readonly header: string;
  /** tooltip text from the original page ("\n" = line break) */
  readonly title: string;
  /** the original page had a blank spacer cell before this column */
  readonly gapBefore: boolean;
}
export interface FormSection {
  readonly key: 'globals' | 'inputs' | 'cvOutputs' | 'gates';
  readonly title: string;
  readonly count: number;
  readonly prefix: string;
  readonly firmwareNote?: boolean;
  rowLabel(index: number): string;
  readonly columns: readonly FormColumn[];
}
export interface FormField {
  readonly name: string;
  readonly section: FormSection['key'];
  readonly index: number;
  readonly column: FormColumn;
  readonly options: readonly FormOption[];
}

export declare const Form: {
  readonly SECTIONS: readonly FormSection[];
  readonly FIELDS: readonly FormField[];
  readonly OPTIONS: Readonly<Record<string, readonly FormOption[]>>;
  field(name: string): FormField | null;
  enabledFields(values?: Partial<FormValues>): Record<string, boolean>;
  submittedValues(values?: Partial<FormValues>): FormValues;
  defaultFormValues(): FormValues;
  readonly FIRMWARE_NOTE: string;
  readonly FIRMWARE_URL: string;
};

export declare const VERSION: string;
export declare const SYSEX_START: 0xF0;
export declare const SYSEX_END: 0xF7;
export declare const MANUFACTURER_ID: readonly [0x00, 0x7F, 0x15];
export declare const LEGACY_MANUFACTURER_ID: readonly [0x00, 0x7F, 0x12];
export declare const BLOCK: { readonly GLOBAL: 1; readonly INPUT_BASE: 10; readonly CV_BASE: 20; readonly GATE_BASE: 30; };
export declare const PARAM: Readonly<Record<
  'SRC' | 'CHAN' | 'NOTE_MIN' | 'NOTE_MAX' | 'VEL_MIN' | 'PB_RANGE' | 'PRIORITY' | 'SPLIT' | 'TICK_OFS' |
  'GATE_DUR' | 'THRESHOLD' | 'TRANSPOSE' | 'VOLTS' | 'PITCH_SCHEME' | 'CAL_SCALE' | 'CAL_OFS' | 'SAVE', number>>;
export declare const SOURCE: Readonly<Record<
  'DISABLE' | 'MIDI_NOTE' | 'MIDI_CC' | 'MIDI_CC_NEG' | 'MIDI_BEND' | 'MIDI_TOUCH' | 'INPUT1' | 'INPUT2' |
  'INPUT3' | 'INPUT4' | 'MIDI_TICK' | 'MIDI_TICK_RUN' | 'MIDI_RUN' | 'MIDI_START' | 'MIDI_STOP' |
  'MIDI_START_STOP' | 'TEST_VOLTAGE' | 'BPM' | 'FIXED_VOLTAGE' | 'ENABLE', number>>;
export declare const CHAN: { readonly SPECIFIC: 0; readonly OMNI: 1; readonly DEFAULT: 2; };
export declare const DURATION: { readonly GATE: 0; readonly MS: 1; readonly DEFAULT: 2; readonly RETRIG: 3; };
export declare const CV_EVENT_VELOCITY: 20;
export declare const NUM_INPUTS: 4;
export declare const NUM_CVS: 4;
export declare const NUM_GATES: 12;
export declare const DEFAULT_FILENAME: string;

declare const MutantBrainSysex: {
  VERSION: typeof VERSION; MutantBrainPatch: typeof MutantBrainPatch; MutantBrainError: typeof MutantBrainError;
  Form: typeof Form; SYSEX_START: typeof SYSEX_START; SYSEX_END: typeof SYSEX_END;
  MANUFACTURER_ID: typeof MANUFACTURER_ID; LEGACY_MANUFACTURER_ID: typeof LEGACY_MANUFACTURER_ID;
  BLOCK: typeof BLOCK; PARAM: typeof PARAM; SOURCE: typeof SOURCE; CHAN: typeof CHAN; DURATION: typeof DURATION;
  CV_EVENT_VELOCITY: typeof CV_EVENT_VELOCITY; NUM_INPUTS: typeof NUM_INPUTS; NUM_CVS: typeof NUM_CVS;
  NUM_GATES: typeof NUM_GATES; DEFAULT_FILENAME: typeof DEFAULT_FILENAME;
};
export default MutantBrainSysex;
