import { patchToFormValues } from './form/display';
import type { FormValues } from './form/schema';
import { readSubmittedForm, submittedValues } from './form/submit';
import {
  copyPatchData,
  defaultPatchData,
  type CvOutput,
  type GateOutput,
  type Globals,
  type NoteInput,
  type PatchData,
  type ReadonlyPatchData,
} from './model';
import { applyParam, patchToParams, paramsToSysex, sysexToParams, type ByteInput, type Param } from './sysex';

/**
 * A complete Mutant Brain configuration, with conversion to and from SysEx
 * bytes and the web form.
 *
 * ```ts
 * const patch = MutantBrainPatch.fromSysex(bytes);
 * patch.gates[0].minNote = 36;          // gates[0] is "Gate.1"
 * const out = patch.toSysex();          // Uint8Array, F0 00 7F 15 ... F7
 * ```
 *
 * A new patch has the original tool's defaults. These differ slightly from
 * what an untouched web form submits (e.g. minVel 0 has no dropdown option, so
 * the form sends "(any)" = 1); use `normalize()` for the form's view.
 */
export class MutantBrainPatch implements PatchData {
  globals: Globals;
  /** inputs[0] is "Input.1". */
  inputs: NoteInput[];
  /** cvOutputs[0] is "CV.A". */
  cvOutputs: CvOutput[];
  /** gates[0] is "Gate.1". */
  gates: GateOutput[];

  /** A default patch, or a deep copy of `data` (any patch data, including an Editor state). */
  constructor(data: ReadonlyPatchData = defaultPatchData()) {
    const copy = copyPatchData(data);
    this.globals = copy.globals;
    this.inputs = copy.inputs;
    this.cvOutputs = copy.cvOutputs;
    this.gates = copy.gates;
  }

  // ---- SysEx --------------------------------------------------------------

  /**
   * Decode a SysEx message (the contents of a .syx file).
   * Settings missing from the file keep their defaults; anything after the
   * F7 terminator is ignored. Throws MutantBrainError on invalid data.
   */
  static fromSysex(data: ByteInput): MutantBrainPatch {
    const patch = new MutantBrainPatch();
    for (const param of sysexToParams(data)) applyParam(patch, param);
    return patch;
  }

  /** Split a SysEx message into raw [block, param, value1, value2] parameters. */
  static parseParams(data: ByteInput): Param[] {
    return sysexToParams(data);
  }

  /** Encode as a SysEx message. Throws INVALID_VALUE for values outside 0..127. */
  toSysex(): Uint8Array {
    return paramsToSysex(this.toParams());
  }

  /** The parameters this patch sends, in transmission order. */
  toParams(): Param[] {
    return patchToParams(this);
  }

  /** Apply one parameter, as if received in a SysEx message. Chainable. */
  applyParam(block: number, param: number, value1: number, value2: number): this {
    applyParam(this, [block, param, value1, value2]);
    return this;
  }

  // ---- Web form -----------------------------------------------------------

  /** The value each form dropdown shows for this patch. */
  toFormValues(): FormValues {
    return patchToFormValues(this);
  }

  /**
   * Build a patch from form values (missing fields take the fresh-form value),
   * applying the form's enable/disable rules and browser submission rules.
   * This is what pressing the page's "Generate SysEx" button does.
   */
  static fromFormValues(values?: Partial<FormValues>): MutantBrainPatch {
    return MutantBrainPatch.fromSubmittedForm(submittedValues(values));
  }

  /** Build a patch from already-submitted fields; absent fields read as 0. */
  static fromSubmittedForm(submitted: Partial<FormValues>): MutantBrainPatch {
    return new MutantBrainPatch(readSubmittedForm(submitted));
  }

  /** What loading this patch into the form and saving it again produces. */
  normalize(): MutantBrainPatch {
    return MutantBrainPatch.fromFormValues(this.toFormValues());
  }

  // ---- Utilities ----------------------------------------------------------

  clone(): MutantBrainPatch {
    return new MutantBrainPatch(this);
  }

  /** A plain-object copy (also what JSON.stringify uses). */
  toJSON(): PatchData {
    return copyPatchData(this);
  }

  /**
   * Build from toJSON() output. Missing or non-numeric values keep their
   * defaults and unknown keys are ignored, so partial or older data is safe.
   */
  static fromJSON(json: unknown): MutantBrainPatch {
    const patch = new MutantBrainPatch();
    if (!isObject(json)) return patch;
    mergeNumbers(patch.globals, json.globals);
    for (const key of ['inputs', 'cvOutputs', 'gates'] as const) {
      const items = json[key];
      if (Array.isArray(items)) patch[key].forEach((item, i) => mergeNumbers(item, items[i]));
    }
    return patch;
  }

  /** True if both patches encode to exactly the same bytes. */
  encodesSameAs(other: MutantBrainPatch): boolean {
    const a = this.toSysex();
    const b = other.toSysex();
    return a.length === b.length && a.every((byte, i) => byte === b[i]);
  }
}

function isObject(value: unknown): value is { [key: string]: unknown } {
  return typeof value === 'object' && value !== null;
}

/** Copy the numeric properties of `source` that `target` already has. */
function mergeNumbers(target: object, source: unknown): void {
  if (!isObject(source)) return;
  const record = target as { [key: string]: number };
  for (const key of Object.keys(record)) {
    const value = source[key];
    if (typeof value === 'number') record[key] = value;
  }
}
