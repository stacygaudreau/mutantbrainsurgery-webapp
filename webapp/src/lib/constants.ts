/**
 * Protocol constants for Mutant Brain SysEx patches.
 *
 * A patch is a single SysEx message:
 *
 *     F0 00 7F 15   <param> <param> ...   F7
 *
 * Every <param> is four 7-bit bytes: [block, param, value1, value2].
 * "block" says which part of the module the setting belongs to (globals, a note
 * input, a CV output or a gate output) and "param" says which setting it is.
 *
 * Names in comments (NRPNH_*, NRPNL_*, NRPVH_*) are the firmware's own names.
 */

export const SYSEX_START = 0xf0;
export const SYSEX_END = 0xf7;

/** Device id that follows F0 in every patch written by this library. */
export const MANUFACTURER_ID: readonly number[] = Object.freeze([0x00, 0x7f, 0x15]);

/** Older device id that is still accepted when reading a patch. */
export const LEGACY_MANUFACTURER_ID: readonly number[] = Object.freeze([0x00, 0x7f, 0x12]);

export const NUM_INPUTS = 4;
export const NUM_CVS = 4;
export const NUM_GATES = 12;

/** Parameter block ids (NRPNH_*). */
export const BLOCK = Object.freeze({
  GLOBAL: 1,
  /** Note input n (1-4) is block INPUT_BASE + n, i.e. 11-14. */
  INPUT_BASE: 10,
  /** CV output n (1-4) is block CV_BASE + n, i.e. 21-24. */
  CV_BASE: 20,
  /** Gate output n (1-12) is block GATE_BASE + n, i.e. 31-42. */
  GATE_BASE: 30,
} as const);

/** Parameter ids within a block (NRPNL_*). */
export const PARAM = Object.freeze({
  SRC: 1,
  CHAN: 2,
  NOTE_MIN: 3,
  NOTE_MAX: 4,
  VEL_MIN: 5,
  PB_RANGE: 7,
  PRIORITY: 8,
  SPLIT: 9,
  TICK_OFS: 11,
  GATE_DUR: 12,
  THRESHOLD: 13,
  TRANSPOSE: 14,
  VOLTS: 15,
  PITCH_SCHEME: 16,
  CAL_SCALE: 98,
  CAL_OFS: 99,
  SAVE: 100,
} as const);

/** What drives an input or output (NRPVH_SRC_*). */
export const SOURCE = Object.freeze({
  DISABLE: 0,
  MIDI_NOTE: 1,
  MIDI_CC: 2,
  MIDI_CC_NEG: 3,
  MIDI_BEND: 4,
  MIDI_TOUCH: 5,
  INPUT1: 11,
  INPUT2: 12,
  INPUT3: 13,
  INPUT4: 14,
  MIDI_TICK: 20,
  MIDI_TICK_RUN: 21,
  MIDI_RUN: 22,
  MIDI_START: 23,
  MIDI_STOP: 25,
  MIDI_START_STOP: 26,
  TEST_VOLTAGE: 127,
  // aliases that read better in some contexts
  ENABLE: 1, // a note input's source: 1 = enabled
  BPM: 20, // CV output "BPM to CV"
  FIXED_VOLTAGE: 127, // CV output "Fixed Voltage"
} as const);

/** MIDI channel modes (NRPVH_CHAN_*). DEFAULT means "use the global default channel". */
export const CHAN = Object.freeze({ SPECIFIC: 0, OMNI: 1, DEFAULT: 2 } as const);

/** Gate duration modes (NRPVH_DUR_*). */
export const DURATION = Object.freeze({
  /** Gate stays open while the triggering condition holds. */
  GATE: 0,
  /** Fixed length in milliseconds. */
  MS: 1,
  /** Use the global default trigger length. */
  DEFAULT: 2,
  /** Retrigger. */
  RETRIG: 3,
} as const);

/** CV "note input event" meaning "most recent note velocity" (events 1-4 are note pitches). */
export const CV_EVENT_VELOCITY = 20;

/** True for the four "Note input #n" sources. */
export function isNoteInputSource(source: number): boolean {
  return source >= SOURCE.INPUT1 && source <= SOURCE.INPUT4;
}

/** True for both MIDI CC sources (above / below threshold). */
export function isMidiCcSource(source: number): boolean {
  return source === SOURCE.MIDI_CC || source === SOURCE.MIDI_CC_NEG;
}

/** True for both MIDI clock sources (tick / tick+run). */
export function isClockSource(source: number): boolean {
  return source === SOURCE.MIDI_TICK || source === SOURCE.MIDI_TICK_RUN;
}
