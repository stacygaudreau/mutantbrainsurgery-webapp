/**
 * mutantbrain-sysex: SysEx patch codec for the Hexinverter Mutant Brain.
 *
 * Converts between Mutant Brain patches, SysEx bytes (.syx files) and the
 * patch form of the Mutant Brain Surgery web page. Byte-for-byte compatible
 * with the original site. No DOM or platform dependencies.
 */
import { completeFormValues, defaultFormValues } from './form/display';
import { OPTIONS } from './form/options';
import { enabledFields } from './form/rules';
import { FIELDS, SECTIONS, field, fieldName } from './form/schema';
import { submittedValues } from './form/submit';

export { MutantBrainPatch } from './MutantBrainPatch';
export { Editor } from './editor/editor';
export type {
  ChannelValue,
  Control,
  ControlInfo,
  ControlOption,
  CvControl,
  DurationValue,
  EditorSchema,
  EditorView,
  FieldRef,
  FieldValue,
  FieldView,
  GateControl,
  GlobalControl,
  InputControl,
  PatchState,
  SectionInfo,
  ValueOf,
} from './editor/types';
export { MutantBrainError, type MutantBrainErrorCode } from './errors';
export {
  BLOCK,
  CHAN,
  CV_EVENT_VELOCITY,
  DURATION,
  LEGACY_MANUFACTURER_ID,
  MANUFACTURER_ID,
  NUM_CVS,
  NUM_GATES,
  NUM_INPUTS,
  PARAM,
  SOURCE,
  SYSEX_END,
  SYSEX_START,
} from './constants';
export type { CvOutput, GateOutput, Globals, NoteInput, PatchData, PatchItem, ReadonlyPatchData, SectionKey } from './model';
export type { ByteInput, Param } from './sysex';
export type { FormOption, OptionList } from './form/options';
export type { ChannelColumn, DurationColumn, FormColumn, FormField, FormSection, FormValues, NumberColumn, ItemProp } from './form/schema';

export const VERSION = '2.0.0';

/** Suggested file name for a downloaded patch (the original site's). */
export const DEFAULT_FILENAME = 'mutantbrain.syx';

/** Everything needed to build a patch form UI. */
export const Form = Object.freeze({
  /** Sections of the form, with their columns and row labels. */
  SECTIONS,
  /** Every field in page order. */
  FIELDS,
  /** All option lists by name. */
  OPTIONS,
  /** Look up a field by name. */
  field,
  /** Field name for a section, row index and column, e.g. "gt12.dur". */
  fieldName,
  /** Which fields are enabled for the given values. */
  enabledFields,
  /** The fields a browser submits for the given values. */
  submittedValues,
  /** Values of a freshly opened form. */
  defaultFormValues,
  /** Fill in missing fields with fresh-form values. */
  completeFormValues,
  FIRMWARE_NOTE:
    'Some settings have specific firmware requirements. Make sure you have an appropriate firmware version to use settings marked with the † symbol',
  FIRMWARE_URL: 'https://www.ericasynths.lv/hexinverter-mutant-brain-2515/',
});
