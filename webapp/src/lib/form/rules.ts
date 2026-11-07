/**
 * Which form fields are enabled, given the current values. A field only
 * applies to some sources (e.g. a gate's CC number only matters for CC
 * sources), so the others are disabled. These are the original page's rules.
 */
import { NUM_CVS, NUM_GATES, NUM_INPUTS } from '../constants';
import { completeFormValues } from './display';
import { FIELDS, type FormValues } from './schema';

const NOTE_INPUT_SOURCES = ['11', '12', '13', '14'];

/** Field name -> enabled, for the given (possibly partial) form values. */
export function enabledFields(values?: Partial<FormValues>): { [fieldName: string]: boolean } {
  const v = completeFormValues(values);
  const enabled: { [fieldName: string]: boolean } = {};
  for (const f of FIELDS) enabled[f.name] = true;

  const set = (prefix: string, fields: string[], on: boolean) => {
    for (const name of fields) enabled[`${prefix}.${name}`] = on;
  };

  // Note input: everything except "Enable" is off while the input is disabled.
  for (let n = 1; n <= NUM_INPUTS; n++) {
    const p = `in${n}`;
    set(p, ['chan', 'prty', 'min_note', 'max_note', 'min_vel', 'bend'], v[`${p}.src`] === '1');
  }

  // CV output
  for (let n = 1; n <= NUM_CVS; n++) {
    const p = `cv${n}`;
    const source = v[`${p}.src`];
    const fromNoteInput = NOTE_INPUT_SOURCES.indexOf(source) >= 0;
    const isVelocity = v[`${p}.event`] === '20';
    set(p, ['event'], fromNoteInput);
    set(p, ['trans', 'scheme'], fromNoteInput && !isVelocity); // pitch only
    set(p, ['chan'], ['2', '3', '4', '5'].indexOf(source) >= 0); // CC, bend, aftertouch
    set(p, ['cc'], source === '2');
    set(p, ['volts'], ['2', '4', '5', '20', '127'].indexOf(source) >= 0 || (fromNoteInput && isVelocity));
  }

  // Gate output
  for (let n = 1; n <= NUM_GATES; n++) {
    const p = `gt${n}`;
    const source = v[`${p}.src`];
    const isNote = source === '1';
    const isCc = source === '2' || source === '3';
    const isClock = source === '20' || source === '21';
    set(p, ['event'], NOTE_INPUT_SOURCES.indexOf(source) >= 0);
    set(p, ['chan'], isCc || isNote);
    set(p, ['min_note', 'max_note', 'min_vel'], isNote);
    set(p, ['cc', 'thrs'], isCc);
    set(p, ['div', 'ofs'], isClock);
    set(p, ['dur'], source !== '0');
  }

  return enabled;
}
