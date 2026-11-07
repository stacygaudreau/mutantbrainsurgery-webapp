/**
 * The patch form, described as data: sections (globals, note inputs, CV
 * outputs, gate outputs), their columns, and the resulting field names such as
 * "gt3.min_note". Any UI can be built from this without knowing the protocol.
 */
import { NUM_CVS, NUM_GATES, NUM_INPUTS } from '../constants';
import type { CvOutput, GateOutput, Globals, NoteInput, PatchItem, SectionKey } from '../model';
import { OPTIONS, type OptionList } from './options';

/** Any numeric property of a patch item. */
export type ItemProp = keyof Globals | keyof NoteInput | keyof CvOutput | keyof GateOutput;

interface ColumnInfo {
  /** Field name suffix: "src", "chan", "min_note", ... */
  readonly field: string;
  readonly options: OptionList;
  /** Column heading. */
  readonly header: string;
  /** Tooltip text ("\n" = line break). */
  readonly title: string;
  /** The original page had a blank spacer cell before this column. */
  readonly gapBefore: boolean;
}

/** A dropdown holding one number of the row, e.g. minNote. */
export interface NumberColumn extends ColumnInfo {
  readonly kind: 'number';
  readonly prop: ItemProp;
}

/** The MIDI channel dropdown: "(default)", 1-16, "(OMNI)" -> chanType + chanNumber. */
export interface ChannelColumn extends ColumnInfo {
  readonly kind: 'channel';
}

/** The gate length dropdown: "(gate)", "(retrig)", "(trigger)", N ms -> durationType + duration. */
export interface DurationColumn extends ColumnInfo {
  readonly kind: 'duration';
}

export type FormColumn = NumberColumn | ChannelColumn | DurationColumn;

export interface FormSection {
  readonly key: SectionKey;
  /** Heading, e.g. "GATE OUTPUTS". */
  readonly title: string;
  /** Number of rows (1 for globals). */
  readonly count: number;
  /** Field name prefix: "global", "in", "cv", "gt". */
  readonly prefix: string;
  /** Show the "needs newer firmware" footnote under this section. */
  readonly firmwareNote: boolean;
  readonly columns: readonly FormColumn[];
  /** Row heading, e.g. "Gate.1" for index 0. */
  rowLabel(index: number): string;
}

/** One dropdown on the page. */
export interface FormField {
  /** Unique name, e.g. "global.chan", "in1.src", "gt12.dur". */
  readonly name: string;
  readonly section: SectionKey;
  /** Row index within the section (0-based). */
  readonly index: number;
  readonly column: FormColumn;
  readonly options: OptionList;
}

/** Field name -> selected option value. */
export type FormValues = { [fieldName: string]: string };

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

function numberColumn(
  field: string, prop: ItemProp, options: OptionList, header: string, title: string, gapBefore = false,
): NumberColumn {
  return Object.freeze({ kind: 'number', field, prop, options, header, title, gapBefore });
}

function channelColumn(options: OptionList, header: string, title: string, gapBefore = false): ChannelColumn {
  return Object.freeze({ kind: 'channel', field: 'chan', options, header, title, gapBefore });
}

function durationColumn(options: OptionList, header: string, title: string, gapBefore = false): DurationColumn {
  return Object.freeze({ kind: 'duration', field: 'dur', options, header, title, gapBefore });
}

const GLOBAL_COLUMNS = [
  channelColumn(OPTIONS.globalChannel, 'Default Channel',
    "Select the MIDI channel to use for all mapings that use MIDI channel '(default)'"),
  durationColumn(OPTIONS.globalDuration, 'Default Trigger',
    "Select the millisecond duration for gate outputs that are set as '(trig)'", true),
];

const INPUT_COLUMNS = [
  numberColumn('src', 'source', OPTIONS.inputSource, 'Enable',
    "Select whether this note input is enabled and listening to MIDI.\nYou should disable any inputs you don't need."),
  channelColumn(OPTIONS.channel, 'Channel', 'Select the MIDI channel that this note input will listen to'),
  numberColumn('prty', 'priority', OPTIONS.priority, 'Mode',
    'When multiple notes are held, this setting determines which of the notes should be be played on the outputs'),
  numberColumn('min_note', 'minNote', OPTIONS.minNote, 'Min.Note',
    'You can limit the range of notes that this note input will play (for example to split the keyboard between two outputs)\n' +
    'Select min note = 0 and max note = 127 to play any note on the selected MIDI channel'),
  numberColumn('max_note', 'maxNote', OPTIONS.maxNote, 'Max.Note',
    "Maximum note of the range. If you select 'single' then only the single note selected in min note will play."),
  numberColumn('min_vel', 'minVel', OPTIONS.minVel, 'Min Vel.',
    'You can filter notes that will play on the input based on their MIDI note velocity.\n' +
    'Only notes that are equal or higher in velocity can play.'),
  numberColumn('bend', 'bendRange', OPTIONS.bendRange, 'Pitch Bend', 'Select the pitch bend range for this note input.'),
];

const CV_COLUMNS = [
  numberColumn('src', 'source', OPTIONS.cvSource, 'CV Source',
    'Select the source of the note or voltage level that this CV output will play.'),
  numberColumn('event', 'inputEvent', OPTIONS.cvEvent, 'Note input',
    'If you select a note input, this decides which note (or other parameter)\nfrom that note input will be mapped to the CV output', true),
  numberColumn('trans', 'transpose', OPTIONS.transpose, 'Transpose',
    'If you select a note input, you can transpose the output note CV.\nThis only works for notes (not velocity, bend etc)'),
  numberColumn('scheme', 'pitchScheme', OPTIONS.pitchScheme, 'Scheme', 'For note pitch CV this is the voltage scaling scheme'),
  channelColumn(OPTIONS.channel, 'Chan', 'If you select a MIDI CC as input, you specify the channel here', true),
  numberColumn('cc', 'cc', OPTIONS.cc, 'CC#', 'If you select a MIDI CC as input, you specify the CC number here'),
  numberColumn('volts', 'volts', OPTIONS.volts, 'Range', 'For non-musical note CV this is the full voltage range'),
];

const GATE_COLUMNS = [
  numberColumn('src', 'source', OPTIONS.gateSource, 'Source', 'Select the source of event that will activate this gate output'),
  numberColumn('event', 'inputEvent', OPTIONS.gateEvent, 'Note input event',
    'If you select a note input, the gate can activate when\na note is played from that input', true),
  channelColumn(OPTIONS.channel, 'Chan',
    'If you select MIDI note or MIDI CC to activate the gate output\nthen you can select the MIDI channel here', true),
  numberColumn('min_note', 'minNote', OPTIONS.minNote, 'Min.Note',
    'If you select MIDI note to activate the output, select the note value here'),
  numberColumn('max_note', 'maxNote', OPTIONS.maxNote, 'Max.Note',
    'Select a single note, or upper limit of a range of notes to activate the output when received'),
  numberColumn('min_vel', 'minVel', OPTIONS.minVel, 'Min Vel.',
    'The output can activate only when notes are received that are equal or higher than this velocity'),
  numberColumn('cc', 'cc', OPTIONS.cc, 'CC#', 'If you select MIDI CC to activate the output, select the CC number here', true),
  numberColumn('thrs', 'threshold', OPTIONS.threshold, 'Switch@',
    'If you select MIDI CC to activate the output, select the switching threshold here'),
  numberColumn('div', 'divider', OPTIONS.clockDivider, 'Ck.Rate',
    'If you select MIDI clock to activate the output, select the clock rate (divider) here', true),
  numberColumn('ofs', 'offset', OPTIONS.clockOffset, 'Tk.Ofs',
    "You can also offset MIDI clock outputs so they activate 'late' by a number of ticks (There are 24 ticks per beat)"),
  durationColumn(OPTIONS.gateDuration, 'Trig',
    'Select (trig) to pulse output with the default trigger time or\n' +
    'select (gate) to have the output switch on until the activating condition is over (e.g. note released)\n' +
    'You can also set a specific trigger time for this output', true),
];

// ---------------------------------------------------------------------------
// Sections and fields
// ---------------------------------------------------------------------------

export const SECTIONS: readonly FormSection[] = Object.freeze([
  section('globals', 'GLOBALS', 1, 'global', false, GLOBAL_COLUMNS, () => ''),
  section('inputs', 'NOTE INPUTS', NUM_INPUTS, 'in', false, INPUT_COLUMNS, (i) => `Input.${i + 1}`),
  section('cvOutputs', 'CV OUTPUTS', NUM_CVS, 'cv', true, CV_COLUMNS, (i) => `CV.${String.fromCharCode(65 + i)}`),
  section('gates', 'GATE OUTPUTS', NUM_GATES, 'gt', true, GATE_COLUMNS, (i) => `Gate.${i + 1}`),
]);

function section(
  key: SectionKey, title: string, count: number, prefix: string, firmwareNote: boolean,
  columns: FormColumn[], rowLabel: (index: number) => string,
): FormSection {
  return Object.freeze({ key, title, count, prefix, firmwareNote, columns: Object.freeze(columns), rowLabel });
}

/** Field name for a section row and column: "global.chan", "in1.src", "gt12.dur". */
export function fieldName(s: FormSection, index: number, column: FormColumn): string {
  const row = s.key === 'globals' ? s.prefix : s.prefix + (index + 1);
  return `${row}.${column.field}`;
}

/** Every field, in page order. */
export const FIELDS: readonly FormField[] = Object.freeze(
  SECTIONS.reduce<FormField[]>((fields, s) => {
    for (let index = 0; index < s.count; index++) {
      for (const column of s.columns) {
        fields.push(Object.freeze({ name: fieldName(s, index, column), section: s.key, index, column, options: column.options }));
      }
    }
    return fields;
  }, []),
);

const FIELDS_BY_NAME: { [name: string]: FormField } = {};
for (const f of FIELDS) FIELDS_BY_NAME[f.name] = f;

/** Look up a field by name (null if there is no such field). */
export function field(name: string): FormField | null {
  return FIELDS_BY_NAME[name] || null;
}

// ---------------------------------------------------------------------------
// Reading and writing numeric row properties by name
// ---------------------------------------------------------------------------

type NumberRecord = { [prop: string]: number };

export function getItemNumber(row: Readonly<PatchItem>, prop: ItemProp): number {
  return (row as unknown as NumberRecord)[prop];
}

export function setItemNumber(row: PatchItem, prop: ItemProp, value: number): void {
  (row as unknown as NumberRecord)[prop] = value;
}
