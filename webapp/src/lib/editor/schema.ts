/**
 * The editor's schema: what the module has (sections, how many items each,
 * and the settings of each item), with typed options and readable metadata.
 * It also converts between FieldRefs, field ids and form option values.
 */
import { MutantBrainError } from '../errors';
import type { SectionKey } from '../model';
import type { FormOption } from '../form/options';
import { SECTIONS, field, fieldName, type FormColumn, type FormField, type FormSection } from '../form/schema';
import type { Control, ControlInfo, ControlOption, EditorSchema, FieldRef, FieldValue, SectionInfo } from './types';

const SECTION_NAMES: { [S in SectionKey]: { name: string; itemName: (index: number) => string } } = {
  globals: { name: 'Global settings', itemName: () => 'Global settings' },
  inputs: { name: 'Note inputs', itemName: (i) => `Input ${i + 1}` },
  cvOutputs: { name: 'CV outputs', itemName: (i) => `CV ${String.fromCharCode(65 + i)}` },
  gates: { name: 'Gate outputs', itemName: (i) => `Gate ${i + 1}` },
};

/** Full name and group of every control, per section. */
const CONTROL_NAMES: { [S in SectionKey]: { [control: string]: { name: string; group: string } } } = {
  globals: {
    channel: { name: 'Default MIDI channel', group: 'channel' },
    duration: { name: 'Default trigger length', group: 'length' },
  },
  inputs: {
    source: { name: 'Enabled', group: 'input' },
    channel: { name: 'MIDI channel', group: 'input' },
    priority: { name: 'Note priority', group: 'input' },
    minNote: { name: 'Lowest note', group: 'input' },
    maxNote: { name: 'Highest note', group: 'input' },
    minVel: { name: 'Minimum velocity', group: 'input' },
    bendRange: { name: 'Pitch bend range', group: 'input' },
  },
  cvOutputs: {
    source: { name: 'CV source', group: 'source' },
    inputEvent: { name: 'Note input event', group: 'note' },
    transpose: { name: 'Transpose', group: 'note' },
    pitchScheme: { name: 'Pitch scheme', group: 'note' },
    channel: { name: 'MIDI channel', group: 'midi' },
    cc: { name: 'MIDI CC', group: 'midi' },
    volts: { name: 'Voltage range', group: 'midi' },
  },
  gates: {
    source: { name: 'Gate source', group: 'source' },
    inputEvent: { name: 'Note input event', group: 'note input' },
    channel: { name: 'MIDI channel', group: 'midi note' },
    minNote: { name: 'Lowest note', group: 'midi note' },
    maxNote: { name: 'Highest note', group: 'midi note' },
    minVel: { name: 'Minimum velocity', group: 'midi note' },
    cc: { name: 'MIDI CC', group: 'cc' },
    threshold: { name: 'CC threshold', group: 'cc' },
    divider: { name: 'Clock rate', group: 'clock' },
    offset: { name: 'Clock offset', group: 'clock' },
    duration: { name: 'Gate length', group: 'length' },
  },
};

const DAGGER = '†';

/** The control a form column edits. */
export function controlOf(column: FormColumn): Control {
  if (column.kind === 'channel') return 'channel';
  if (column.kind === 'duration') return 'duration';
  return column.prop as Control;
}

// ---------------------------------------------------------------------------
// Option values: typed (editor) <-> string (form)
// ---------------------------------------------------------------------------

/** Form option value -> typed value ("inf" -> "gate", "12" -> 12). */
export function typedValue(column: FormColumn, optionValue: string): FieldValue {
  if (column.kind === 'channel' && (optionValue === 'default' || optionValue === 'omni')) return optionValue;
  if (column.kind === 'duration') {
    if (optionValue === 'inf') return 'gate';
    if (optionValue === 'retrig' || optionValue === 'default') return optionValue;
  }
  return Number(optionValue);
}

/** Typed value -> form option value, or null if the value has the wrong type for the column. */
export function optionValueOf(column: FormColumn, value: unknown): string | null {
  if (typeof value === 'number') return Number.isInteger(value) ? String(value) : null;
  if (column.kind === 'channel' && (value === 'default' || value === 'omni')) return value;
  if (column.kind === 'duration') {
    if (value === 'gate') return 'inf';
    if (value === 'retrig' || value === 'default') return value;
  }
  return null;
}

function controlOption(column: FormColumn, o: FormOption): ControlOption {
  const needsNewerFirmware = o.label.endsWith(DAGGER);
  return Object.freeze({
    value: typedValue(column, o.value),
    label: needsNewerFirmware ? o.label.slice(0, -DAGGER.length).trim() : o.label,
    disabled: !!o.disabled,
    needsNewerFirmware,
  });
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

/** Tooltip text as plain help text (one paragraph, original typos fixed). */
function describe(title: string): string {
  return title.replace(/\n/g, ' ').replace('mapings', 'mappings').replace('should be be', 'should be');
}

function controlInfo(s: FormSection, column: FormColumn): ControlInfo {
  const control = controlOf(column);
  const names = CONTROL_NAMES[s.key][control];
  return Object.freeze({
    control,
    name: names.name,
    abbreviation: column.header,
    description: describe(column.title),
    group: names.group,
    options: Object.freeze(column.options.map((o) => controlOption(column, o))),
  });
}

function sectionInfo(s: FormSection): SectionInfo {
  const { name, itemName } = SECTION_NAMES[s.key];
  return Object.freeze({
    key: s.key,
    name,
    count: s.count,
    controls: Object.freeze(s.columns.map((c) => controlInfo(s, c))),
    itemName,
  });
}

const SECTION_INFOS: readonly SectionInfo[] = Object.freeze(SECTIONS.map(sectionInfo));

/** What the module has: its sections, their item counts and their settings. */
export const SCHEMA: EditorSchema = Object.freeze({
  sections: SECTION_INFOS,
  section(key: SectionKey): SectionInfo {
    const found = SECTION_INFOS.find((s) => s.key === key);
    if (!found) throw new MutantBrainError('BAD_FIELD_REF', `Unknown section "${String(key)}"`);
    return found;
  },
});

// ---------------------------------------------------------------------------
// FieldRef <-> field id <-> form field
// ---------------------------------------------------------------------------

export interface ResolvedField {
  readonly field: FormField;
  readonly info: ControlInfo;
}

function makeRef(section: SectionKey, index: number, control: Control): FieldRef {
  return Object.freeze(section === 'globals' ? { section, control } : { section, index, control }) as FieldRef;
}

const BY_ID = new Map<string, ResolvedField>();
SECTIONS.forEach((formSection, s) => {
  formSection.columns.forEach((column, c) => {
    for (let index = 0; index < formSection.count; index++) {
      const id = fieldName(formSection, index, column);
      BY_ID.set(id, { field: field(id) as FormField, info: SECTION_INFOS[s].controls[c] });
    }
  });
});

/** Every setting of one item, e.g. all fields of Gate 3 (`fieldsOf('gates', 2)`). */
export function fieldsOf(section: SectionKey, index = 0): readonly FieldRef[] {
  const info = SCHEMA.section(section);
  if (!Number.isInteger(index) || index < 0 || index >= info.count) {
    throw new MutantBrainError('BAD_FIELD_REF', `${info.name} has no item ${String(index)}`);
  }
  return Object.freeze(info.controls.map((c) => makeRef(section, index, c.control)));
}

/** Stable id of a field, e.g. { section: 'gates', index: 2, control: 'minNote' } -> "gt3.min_note". */
export function idOf(ref: FieldRef): string {
  return resolveRef(ref).field.name;
}

/** Reference for a field id (throws BAD_FIELD_REF for unknown ids). */
export function refOf(id: string): FieldRef {
  const resolved = BY_ID.get(id);
  if (!resolved) throw new MutantBrainError('BAD_FIELD_REF', `Unknown field "${id}"`);
  return makeRef(resolved.field.section, resolved.field.index, resolved.info.control);
}

/** Validate a reference and find its form field and control info (throws BAD_FIELD_REF). */
export function resolveRef(ref: FieldRef): ResolvedField {
  const bad = (why: string): never => {
    throw new MutantBrainError('BAD_FIELD_REF', `Invalid field reference ${safeJson(ref)}: ${why}`, { ref });
  };
  if (typeof ref !== 'object' || ref === null) return bad('not an object');
  const s = SECTIONS.findIndex((x) => x.key === ref.section);
  if (s < 0) return bad('unknown section');
  const formSection = SECTIONS[s];
  const index = ref.section === 'globals' ? 0 : ref.index;
  if (!Number.isInteger(index) || index < 0 || index >= formSection.count) return bad('index out of range');
  const c = SECTION_INFOS[s].controls.findIndex((info) => info.control === ref.control);
  if (c < 0) return bad(`no control "${String(ref.control)}" in ${ref.section}`);
  return BY_ID.get(fieldName(formSection, index, formSection.columns[c])) as ResolvedField;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
