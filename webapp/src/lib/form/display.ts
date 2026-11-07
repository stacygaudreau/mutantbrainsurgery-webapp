/**
 * Patch -> form: which option each dropdown shows for a given patch.
 *
 * A value with no matching option shows the first selectable option, which is
 * what a browser does with a <select> whose value matches nothing. (So e.g. a
 * minVel of 0 shows, and later saves, as "(any)" = 1, as on the original site.)
 */
import { CHAN, DURATION } from '../constants';
import { MutantBrainError } from '../errors';
import { defaultPatchData, type Globals, type PatchItem, type ReadonlyPatchData } from '../model';
import type { OptionList } from './options';
import { FIELDS, field, getItemNumber, type FormField, type FormValues } from './schema';

/** The value every form field shows for this patch. */
export function patchToFormValues(patch: ReadonlyPatchData): FormValues {
  const values: FormValues = {};
  for (const f of FIELDS) values[f.name] = shownFieldValue(patch, f);
  return values;
}

/** The option value one field shows for this patch. */
export function shownFieldValue(patch: ReadonlyPatchData, f: FormField): string {
  return shownValue(f.options, wantedValue(f, itemOf(patch, f)));
}

/** The values of a freshly opened, empty form. */
export function defaultFormValues(): FormValues {
  return { ...FRESH_FORM };
}

/** Fill in missing fields with the fresh-form value; reject unknown field names. */
export function completeFormValues(values?: Partial<FormValues>): FormValues {
  const complete = defaultFormValues();
  if (values) {
    for (const name of Object.keys(values)) {
      if (!field(name)) throw new MutantBrainError('BAD_FORM_VALUE', `Unknown form field "${name}"`);
      complete[name] = String(values[name]);
    }
  }
  return complete;
}

/** The patch item (globals, input, CV output or gate) a field belongs to. */
export function itemOf(patch: ReadonlyPatchData, f: FormField): Readonly<PatchItem> {
  return f.section === 'globals' ? patch.globals : patch[f.section][f.index];
}

/** The option value matching the item's data, or null if it cannot be expressed. */
function wantedValue(f: FormField, item: Readonly<PatchItem>): string | null {
  const isGlobal = f.section === 'globals';
  switch (f.column.kind) {
    case 'number':
      return String(getItemNumber(item, f.column.prop));
    case 'channel':
      return channelValue(item as Globals, isGlobal);
    case 'duration':
      return durationValue(item as Globals, isGlobal);
  }
}

/** The globals have no "(default)"/"(OMNI)" channel and no "(gate)"/"(retrig)"/"(trigger)" length. */
function channelValue(item: Pick<Globals, 'chanType' | 'chanNumber'>, isGlobal: boolean): string | null {
  if (!isGlobal && item.chanType === CHAN.DEFAULT) return 'default';
  if (!isGlobal && item.chanType === CHAN.OMNI) return 'omni';
  if (item.chanType === CHAN.SPECIFIC && item.chanNumber >= 1 && item.chanNumber <= 16) return String(item.chanNumber);
  return null;
}

function durationValue(item: Pick<Globals, 'durationType' | 'duration'>, isGlobal: boolean): string | null {
  if (!isGlobal && item.durationType === DURATION.GATE) return 'inf';
  if (!isGlobal && item.durationType === DURATION.RETRIG) return 'retrig';
  if (!isGlobal && item.durationType === DURATION.DEFAULT) return 'default';
  if (item.durationType === DURATION.MS) return String(item.duration);
  return null;
}

/** `wanted` if it is one of the options, otherwise the first selectable option. */
function shownValue(options: OptionList, wanted: string | null): string {
  if (wanted !== null && options.some((o) => o.value === wanted)) return wanted;
  const firstSelectable = options.find((o) => !o.disabled) || options[0];
  return firstSelectable.value;
}

const FRESH_FORM: Readonly<FormValues> = Object.freeze(patchToFormValues(defaultPatchData()));
