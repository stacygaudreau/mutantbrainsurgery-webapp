/**
 * The patch data model: plain objects holding the raw numbers sent to the
 * module. Field meanings follow the firmware; see constants.ts for the codes.
 */
import { CHAN, DURATION, NUM_CVS, NUM_GATES, NUM_INPUTS, SOURCE } from './constants';

export interface Globals {
  /** Default MIDI channel, used by everything set to "(default)". */
  chanType: number;
  chanNumber: number;
  /** Default trigger length, used by gates set to "(trigger)". */
  durationType: number;
  duration: number;
}

export interface NoteInput {
  source: number;
  chanType: number;
  chanNumber: number;
  /** Note priority / cycle / chord mode. */
  priority: number;
  minNote: number;
  maxNote: number;
  minVel: number;
  bendRange: number;
}

export interface CvOutput {
  source: number;
  /** For note-input sources: 1-4 = note pitch, 20 = velocity. */
  inputEvent: number;
  /** 64 = no transpose; 1 per semitone. */
  transpose: number;
  chanType: number;
  chanNumber: number;
  cc: number;
  /** Full-scale range in volts (1-8). */
  volts: number;
  /** 0 = V/Oct, 1 = Hz/V, 2 = 1.2V/Oct. */
  pitchScheme: number;
}

export interface GateOutput {
  source: number;
  /** For note-input sources: which note event opens the gate. */
  inputEvent: number;
  chanType: number;
  chanNumber: number;
  minNote: number;
  maxNote: number;
  minVel: number;
  cc: number;
  threshold: number;
  /** MIDI clock divider (ticks per pulse). */
  divider: number;
  /** MIDI clock offset in ticks. */
  offset: number;
  durationType: number;
  duration: number;
}

/** A complete configuration. Arrays are 0-based: inputs[0] is "Input.1". */
export interface PatchData {
  globals: Globals;
  inputs: NoteInput[];
  cvOutputs: CvOutput[];
  gates: GateOutput[];
}

/** Read-only view of a patch (what the immutable Editor API works with). */
export interface ReadonlyPatchData {
  readonly globals: Readonly<Globals>;
  readonly inputs: readonly Readonly<NoteInput>[];
  readonly cvOutputs: readonly Readonly<CvOutput>[];
  readonly gates: readonly Readonly<GateOutput>[];
}

/** The four parts of a patch, as used in the form schema. */
export type SectionKey = keyof PatchData;

/** One item of a patch: the globals, one note input, one CV output or one gate output. */
export type PatchItem = Globals | NoteInput | CvOutput | GateOutput;

// Defaults are the original firmware tool's initial values.

export function defaultGlobals(): Globals {
  return { chanType: CHAN.SPECIFIC, chanNumber: 1, durationType: DURATION.MS, duration: 15 };
}

export function defaultNoteInput(): NoteInput {
  return {
    source: SOURCE.DISABLE,
    chanType: CHAN.DEFAULT,
    chanNumber: 0,
    priority: 3,
    minNote: 0,
    maxNote: 127,
    minVel: 0,
    bendRange: 3,
  };
}

export function defaultCvOutput(): CvOutput {
  return {
    source: SOURCE.DISABLE,
    inputEvent: 0,
    transpose: 64,
    chanType: CHAN.DEFAULT,
    chanNumber: 0,
    cc: 1,
    volts: 5,
    pitchScheme: 0,
  };
}

export function defaultGateOutput(): GateOutput {
  return {
    source: SOURCE.DISABLE,
    inputEvent: 1,
    chanType: CHAN.DEFAULT,
    chanNumber: 0,
    minNote: 0,
    maxNote: 127,
    minVel: 0,
    cc: 0,
    threshold: 64,
    divider: 6,
    offset: 0,
    durationType: DURATION.DEFAULT,
    duration: 0,
  };
}

export function defaultPatchData(): PatchData {
  return {
    globals: defaultGlobals(),
    inputs: repeat(NUM_INPUTS, defaultNoteInput),
    cvOutputs: repeat(NUM_CVS, defaultCvOutput),
    gates: repeat(NUM_GATES, defaultGateOutput),
  };
}

/** Deep copy (every item is a flat object of numbers). */
export function copyPatchData(data: ReadonlyPatchData): PatchData {
  return {
    globals: { ...data.globals },
    inputs: data.inputs.map((item) => ({ ...item })),
    cvOutputs: data.cvOutputs.map((item) => ({ ...item })),
    gates: data.gates.map((item) => ({ ...item })),
  };
}

function repeat<T>(count: number, make: () => T): T[] {
  return Array.from({ length: count }, make);
}
