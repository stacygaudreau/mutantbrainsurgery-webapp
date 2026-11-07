/**
 * SysEx encoding and decoding: PatchData <-> parameter list <-> bytes.
 *
 * The rules (which parameters are sent for which source, and how each one is
 * read back) are exactly those of the original Mutant Brain Surgery site, so a
 * patch round-trips byte-for-byte with files made by that site.
 */
import {
  BLOCK,
  CV_EVENT_VELOCITY,
  LEGACY_MANUFACTURER_ID,
  MANUFACTURER_ID,
  NUM_CVS,
  NUM_GATES,
  NUM_INPUTS,
  PARAM,
  SOURCE,
  SYSEX_END,
  SYSEX_START,
  isClockSource,
  isMidiCcSource,
  isNoteInputSource,
} from './constants';
import { MutantBrainError } from './errors';
import type { CvOutput, GateOutput, Globals, NoteInput, PatchData } from './model';

/** One SysEx parameter: [block, param, value1, value2]. */
export type Param = [block: number, param: number, value1: number, value2: number];

/** Anything that holds bytes: Uint8Array (incl. Node Buffer), ArrayBuffer, DataView, number[]. */
export type ByteInput = Uint8Array | ArrayBuffer | ArrayBufferView | readonly number[];

const HEADER = [SYSEX_START, ...MANUFACTURER_ID];
const PARAM_SIZE = 4;

// ---------------------------------------------------------------------------
// Blocks: which part of the patch a block id refers to
// ---------------------------------------------------------------------------

export type BlockTarget =
  | { section: 'globals' }
  | { section: 'inputs' | 'cvOutputs' | 'gates'; index: number };

/** Map a block id to the part of the patch it configures, or null if unknown. */
export function blockTarget(block: number): BlockTarget | null {
  if (block === BLOCK.GLOBAL) return { section: 'globals' };
  if (block > BLOCK.INPUT_BASE && block <= BLOCK.INPUT_BASE + NUM_INPUTS) {
    return { section: 'inputs', index: block - BLOCK.INPUT_BASE - 1 };
  }
  if (block > BLOCK.CV_BASE && block <= BLOCK.CV_BASE + NUM_CVS) {
    return { section: 'cvOutputs', index: block - BLOCK.CV_BASE - 1 };
  }
  if (block > BLOCK.GATE_BASE && block <= BLOCK.GATE_BASE + NUM_GATES) {
    return { section: 'gates', index: block - BLOCK.GATE_BASE - 1 };
  }
  return null;
}

/** Short human name for a block, matching the form field prefixes: global, in1, cv1, gt1. */
export function blockName(block: number): string {
  const target = blockTarget(block);
  if (!target) return `block ${block}`;
  if (target.section === 'globals') return 'global';
  const prefix = { inputs: 'in', cvOutputs: 'cv', gates: 'gt' }[target.section];
  return prefix + (target.index + 1);
}

const PARAM_NAMES: { [id: number]: string } = {};
for (const name of Object.keys(PARAM) as (keyof typeof PARAM)[]) PARAM_NAMES[PARAM[name]] = name;

// ---------------------------------------------------------------------------
// Encoding: PatchData -> parameters -> bytes
// ---------------------------------------------------------------------------

/** All parameters of a patch, in the order the module receives them. */
export function patchToParams(patch: PatchData): Param[] {
  const params: Param[] = globalParams(patch.globals);
  patch.inputs.forEach((input, i) => params.push(...inputParams(BLOCK.INPUT_BASE + 1 + i, input)));
  patch.cvOutputs.forEach((cv, i) => params.push(...cvParams(BLOCK.CV_BASE + 1 + i, cv)));
  patch.gates.forEach((gate, i) => params.push(...gateParams(BLOCK.GATE_BASE + 1 + i, gate)));
  return params;
}

function globalParams(g: Globals): Param[] {
  return [
    [BLOCK.GLOBAL, PARAM.CHAN, g.chanType, g.chanNumber],
    [BLOCK.GLOBAL, PARAM.GATE_DUR, g.durationType, g.duration],
  ];
}

/** Note inputs always send every setting, enabled or not. */
function inputParams(block: number, input: NoteInput): Param[] {
  return [
    [block, PARAM.SRC, input.source, 0],
    [block, PARAM.CHAN, input.chanType, input.chanNumber],
    [block, PARAM.NOTE_MIN, 0, input.minNote],
    [block, PARAM.NOTE_MAX, 0, input.maxNote],
    [block, PARAM.VEL_MIN, 0, input.minVel],
    [block, PARAM.PB_RANGE, 0, input.bendRange],
    [block, PARAM.PRIORITY, 0, input.priority],
  ];
}

/** CV outputs only send the settings that matter for their source. */
function cvParams(block: number, cv: CvOutput): Param[] {
  const { source } = cv;
  const channel: Param = [block, PARAM.CHAN, cv.chanType, cv.chanNumber];
  const volts: Param = [block, PARAM.VOLTS, 0, cv.volts];

  if (isNoteInputSource(source)) {
    const params: Param[] = [[block, PARAM.SRC, source, cv.inputEvent]];
    const isNotePitch = cv.inputEvent >= 1 && cv.inputEvent <= 4;
    if (isNotePitch) {
      params.push([block, PARAM.PITCH_SCHEME, 0, cv.pitchScheme], [block, PARAM.TRANSPOSE, 0, cv.transpose]);
    } else if (cv.inputEvent === CV_EVENT_VELOCITY) {
      params.push(volts);
    }
    return params;
  }
  if (isMidiCcSource(source)) {
    return [[block, PARAM.SRC, source, cv.cc], channel, volts];
  }
  if (source === SOURCE.MIDI_BEND || source === SOURCE.MIDI_TOUCH) {
    return [[block, PARAM.SRC, source, 0], channel, volts];
  }
  // Disabled, "BPM to CV" and "Fixed Voltage": the original site sends only the
  // source, even though its form lets you pick a range for the last two.
  return [[block, PARAM.SRC, source, 0]];
}

/** Gate outputs send the settings for their source, then always the duration. */
function gateParams(block: number, gate: GateOutput): Param[] {
  return [...gateSourceParams(block, gate), [block, PARAM.GATE_DUR, gate.durationType, gate.duration]];
}

function gateSourceParams(block: number, gate: GateOutput): Param[] {
  const { source } = gate;
  const channel: Param = [block, PARAM.CHAN, gate.chanType, gate.chanNumber];

  if (isNoteInputSource(source)) {
    return [[block, PARAM.SRC, source, gate.inputEvent]];
  }
  if (source === SOURCE.MIDI_NOTE) {
    return [
      [block, PARAM.SRC, source, gate.minNote],
      channel,
      [block, PARAM.NOTE_MAX, 0, gate.maxNote],
      [block, PARAM.VEL_MIN, 0, gate.minVel],
    ];
  }
  if (isMidiCcSource(source)) {
    return [[block, PARAM.SRC, source, gate.cc], channel, [block, PARAM.THRESHOLD, 0, gate.threshold]];
  }
  if (isClockSource(source)) {
    return [[block, PARAM.SRC, source, gate.divider], [block, PARAM.TICK_OFS, 0, gate.offset]];
  }
  return [[block, PARAM.SRC, source, 0]];
}

/**
 * Frame parameters as a complete SysEx message (F0 00 7F 15 ... F7).
 * Throws INVALID_VALUE if any value is not an integer 0..127.
 */
export function paramsToSysex(params: readonly Param[]): Uint8Array {
  const bytes = new Uint8Array(HEADER.length + params.length * PARAM_SIZE + 1);
  bytes.set(HEADER, 0);
  params.forEach((param, i) => {
    for (const value of param) assertDataByte(value, param);
    bytes.set(param, HEADER.length + i * PARAM_SIZE);
  });
  bytes[bytes.length - 1] = SYSEX_END;
  return bytes;
}

function assertDataByte(value: unknown, param: Param): void {
  const isDataByte = typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 127;
  if (isDataByte) return;
  const [block, id] = param;
  throw new MutantBrainError(
    'INVALID_VALUE',
    `Cannot encode ${String(value)} for ${blockName(block)} ${PARAM_NAMES[id] ?? id} (must be an integer 0..127)`,
    { param: param.slice() },
  );
}

// ---------------------------------------------------------------------------
// Decoding: bytes -> parameters -> PatchData
// ---------------------------------------------------------------------------

/**
 * Split a SysEx message into its parameters (framing checks only).
 * Accepts the legacy device id; ignores anything after the F7 terminator.
 */
export function sysexToParams(data: ByteInput): Param[] {
  const bytes = toBytes(data);
  if (!hasMutantBrainHeader(bytes)) {
    throw new MutantBrainError('BAD_HEADER', 'Not a Mutant Brain SysEx file (expected it to start with F0 00 7F 15)');
  }

  const params: Param[] = [];
  let pos = HEADER.length;
  while (bytes[pos] !== SYSEX_END) {
    if (pos >= bytes.length) throw new MutantBrainError('MISSING_END', 'SysEx data ends without an F7 terminator');
    if (pos + PARAM_SIZE > bytes.length) {
      throw new MutantBrainError('TRUNCATED', 'SysEx data ends in the middle of a parameter');
    }
    params.push([bytes[pos], bytes[pos + 1], bytes[pos + 2], bytes[pos + 3]]);
    pos += PARAM_SIZE;
  }
  return params;
}

function hasMutantBrainHeader(bytes: Uint8Array): boolean {
  if (bytes.length < HEADER.length || bytes[0] !== SYSEX_START) return false;
  const id = [bytes[1], bytes[2], bytes[3]];
  return sameBytes(id, MANUFACTURER_ID) || sameBytes(id, LEGACY_MANUFACTURER_ID);
}

function sameBytes(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, i) => value === b[i]);
}

/** Normalise any supported byte container to a Uint8Array (throws BAD_INPUT). */
export function toBytes(data: ByteInput): Uint8Array {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (Array.isArray(data)) {
    data.forEach((value: unknown, i) => {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 255) {
        throw new MutantBrainError('BAD_INPUT', `Byte array contains a non-byte value at index ${i}`);
      }
    });
    return Uint8Array.from(data);
  }
  throw new MutantBrainError('BAD_INPUT', 'Expected SysEx bytes (Uint8Array, ArrayBuffer or number[])');
}

/**
 * Apply one received parameter to a patch.
 * Unknown parameter ids are ignored (as the original site did); an unknown
 * block id throws UNKNOWN_BLOCK.
 */
export function applyParam(patch: PatchData, [block, id, value1, value2]: Param): void {
  const target = blockTarget(block);
  if (!target) {
    throw new MutantBrainError('UNKNOWN_BLOCK', `Unknown parameter block 0x${hex(block)} in SysEx data`, {
      block,
      param: id,
    });
  }
  switch (target.section) {
    case 'globals':
      return applyGlobalParam(patch.globals, id, value1, value2);
    case 'inputs':
      return applyInputParam(patch.inputs[target.index], id, value1, value2);
    case 'cvOutputs':
      return applyCvParam(patch.cvOutputs[target.index], id, value1, value2);
    case 'gates':
      return applyGateParam(patch.gates[target.index], id, value1, value2);
  }
}

function applyGlobalParam(g: Globals, id: number, value1: number, value2: number): void {
  switch (id) {
    case PARAM.CHAN:
      g.chanType = value1;
      g.chanNumber = value2;
      break;
    case PARAM.GATE_DUR:
      g.durationType = value1;
      g.duration = value2;
      break;
  }
}

function applyInputParam(input: NoteInput, id: number, value1: number, value2: number): void {
  switch (id) {
    case PARAM.SRC:
      input.source = value1;
      break;
    case PARAM.CHAN:
      input.chanType = value1;
      input.chanNumber = value2;
      break;
    case PARAM.NOTE_MIN:
      input.minNote = value2;
      break;
    case PARAM.NOTE_MAX:
      input.maxNote = value2;
      break;
    case PARAM.VEL_MIN:
      input.minVel = value2;
      break;
    case PARAM.PB_RANGE:
      input.bendRange = value2;
      break;
    case PARAM.PRIORITY:
      input.priority = value2;
      break;
  }
}

function applyCvParam(cv: CvOutput, id: number, value1: number, value2: number): void {
  switch (id) {
    case PARAM.SRC:
      // The source parameter's second value depends on the source.
      cv.source = value1;
      if (isNoteInputSource(value1)) cv.inputEvent = value2;
      else if (isMidiCcSource(value1)) cv.cc = value2;
      break;
    case PARAM.CHAN:
      cv.chanType = value1;
      cv.chanNumber = value2;
      break;
    case PARAM.VOLTS:
      cv.volts = value2;
      break;
    case PARAM.PITCH_SCHEME:
      cv.pitchScheme = value2;
      break;
    case PARAM.TRANSPOSE:
      cv.transpose = value2;
      break;
  }
}

function applyGateParam(gate: GateOutput, id: number, value1: number, value2: number): void {
  switch (id) {
    case PARAM.SRC:
      // The source parameter's second value depends on the source.
      gate.source = value1;
      if (isNoteInputSource(value1)) gate.inputEvent = value2;
      else if (value1 === SOURCE.MIDI_NOTE) gate.minNote = value2;
      else if (isMidiCcSource(value1)) gate.cc = value2;
      else if (isClockSource(value1)) gate.divider = value2;
      break;
    case PARAM.CHAN:
      gate.chanType = value1;
      gate.chanNumber = value2;
      break;
    case PARAM.NOTE_MAX:
      gate.maxNote = value2;
      break;
    case PARAM.VEL_MIN:
      gate.minVel = value2;
      break;
    case PARAM.GATE_DUR:
      gate.durationType = value1;
      gate.duration = value2;
      break;
    case PARAM.TICK_OFS:
      gate.offset = value2;
      break;
    case PARAM.THRESHOLD:
      gate.threshold = value2;
      break;
  }
}

function hex(byte: number): string {
  return (byte < 16 ? '0' : '') + byte.toString(16).toUpperCase();
}
