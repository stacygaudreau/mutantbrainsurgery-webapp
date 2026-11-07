/**
 * Form -> patch: what a browser submits, and how the original site read it.
 *
 * Two quirks of the original site are reproduced on purpose, because they
 * shape the bytes users have been sending to their modules for years:
 *   1. Disabled fields are not submitted, and a missing field reads as 0.
 *   2. A field whose selected option is disabled (e.g. CC 6 loaded from a
 *      file) is not submitted either, so it also reads as 0.
 */
import { CHAN, DURATION } from '../constants';
import { MutantBrainError } from '../errors';
import { defaultPatchData, type Globals, type PatchData, type PatchItem } from '../model';
import { completeFormValues } from './display';
import { enabledFields } from './rules';
import { FIELDS, field, setItemNumber, type FormField, type FormValues } from './schema';

/**
 * The name/value pairs a browser would submit for these form values: disabled
 * fields and fields set to a disabled option are left out.
 */
export function submittedValues(values?: Partial<FormValues>): FormValues {
  const v = completeFormValues(values);
  const enabled = enabledFields(v);
  const submitted: FormValues = {};
  for (const f of FIELDS) {
    const selected = f.options.find((o) => o.value === v[f.name]);
    if (!selected) throw new MutantBrainError('BAD_FORM_VALUE', `Field "${f.name}" has no option "${v[f.name]}"`);
    if (enabled[f.name] && !selected.disabled) submitted[f.name] = selected.value;
  }
  return submitted;
}

/**
 * Read submitted fields into patch data, exactly as the original site's server
 * did. Fields that are absent were not submitted and read as 0.
 */
export function readSubmittedForm(submitted: Partial<FormValues>): PatchData {
  for (const name of Object.keys(submitted)) {
    if (!field(name)) throw new MutantBrainError('BAD_FORM_VALUE', `Unknown form field "${name}"`);
  }
  const patch = defaultPatchData();
  for (const f of FIELDS) {
    const raw = Object.prototype.hasOwnProperty.call(submitted, f.name) ? submitted[f.name] : undefined;
    const item = f.section === 'globals' ? patch.globals : patch[f.section][f.index];
    writeFieldValue(item, f, raw);
  }
  return patch;
}

/**
 * Store one field's option value into its patch item (mutates `item`).
 * `undefined` means "not submitted", which reads as 0.
 */
export function writeFieldValue(item: PatchItem, f: FormField, raw: string | undefined): void {
  switch (f.column.kind) {
    case 'number':
      setItemNumber(item, f.column.prop, readNumber(f.name, raw));
      break;
    case 'channel':
      Object.assign(item, readChannel(f.name, raw));
      break;
    case 'duration':
      Object.assign(item, readDuration(f.name, raw));
      break;
  }
}

function readChannel(name: string, raw: string | undefined): Pick<Globals, 'chanType' | 'chanNumber'> {
  if (raw === 'omni') return { chanType: CHAN.OMNI, chanNumber: 0 };
  if (raw === 'default') return { chanType: CHAN.DEFAULT, chanNumber: 0 };
  return { chanType: CHAN.SPECIFIC, chanNumber: readNumber(name, raw) };
}

function readDuration(name: string, raw: string | undefined): Pick<Globals, 'durationType' | 'duration'> {
  if (raw === 'inf') return { durationType: DURATION.GATE, duration: 0 };
  if (raw === 'default') return { durationType: DURATION.DEFAULT, duration: 0 };
  if (raw === 'retrig') return { durationType: DURATION.RETRIG, duration: 0 };
  return { durationType: DURATION.MS, duration: readNumber(name, raw) };
}

/** A submitted number; a missing field reads as 0 (like the original server). */
function readNumber(name: string, raw: string | undefined): number {
  if (raw === undefined) return 0;
  if (!/^\d{1,3}$/.test(raw) || Number(raw) > 255) {
    throw new MutantBrainError('BAD_FORM_VALUE', `Field "${name}" has invalid value "${raw}"`);
  }
  return Number(raw);
}
