/**
 * PatchDocument: a patch being edited, as an application holds it in memory.
 * It pairs the patch settings (an Editor state) with a name, and remembers
 * whether the settings have changed since the patch was created, opened or
 * saved. Documents are immutable: every operation returns a new document, or
 * the same one when nothing changed, which suits React-style state.
 *
 *   let doc = PatchDocument.open('Roland TR-08.syx', bytes);
 *   doc = PatchDocument.set(doc, { section: 'gates', index: 0, control: 'minNote' }, 38);
 *   doc = PatchDocument.rename(doc, 'My TR-08');
 *   const { fileName, bytes } = PatchDocument.save(doc);   // "My TR-08.syx"
 */
import { Editor } from './editor/editor';
import type { FieldRef, FieldValue, PatchState, ValueOf } from './editor/types';
import type { ByteInput } from './sysex';

export interface PatchDocument {
  /** The patch name as the user entered it; the file name is derived from it (see PatchDocument.fileName). */
  readonly name: string;
  /** The patch settings. */
  readonly patch: PatchState;
  /** True if the settings changed since the document was created, opened or saved. */
  readonly modified: boolean;
}

/** The result of saving: what to write to disk, and the document marked as saved. */
export interface SavedPatch {
  /** e.g. "Roland TR-08.syx" */
  readonly fileName: string;
  /** The SysEx message (F0 00 7F 15 ... F7). */
  readonly bytes: Uint8Array;
  /** The same document with `modified` cleared. */
  readonly document: PatchDocument;
}

/** Name of a new patch. */
export const DEFAULT_PATCH_NAME = 'New Patch';

/** File name extension of a patch file. */
export const PATCH_FILE_EXTENSION = '.syx';

const MAX_NAME_LENGTH = 120;

function make(name: string, patch: PatchState, modified: boolean): PatchDocument {
  return Object.freeze({ name, patch, modified });
}

/** True if two (canonical) patch states hold the same settings. */
function sameSettings(a: PatchState, b: PatchState): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b);
}

/**
 * A name usable as a file name on any system: characters that are not
 * allowed in file names become "-", control characters, a trailing ".syx"
 * and leading dots are removed, and an empty result becomes "New Patch".
 */
function fileStem(name: string): string {
  const stem = name
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|]/g, '-')
    .trim()
    .replace(/\.syx$/i, '')
    .replace(/^\.+/, '')
    .slice(0, MAX_NAME_LENGTH)
    .trim();
  return stem || DEFAULT_PATCH_NAME;
}

/** Patch name for a file: its base name without any folder or ".syx" extension. */
function nameFromFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() || '';
  return base.replace(/\.syx$/i, '').trim() || DEFAULT_PATCH_NAME;
}

/** Functions for working with PatchDocuments (all pure; documents are never modified). */
export const PatchDocument = Object.freeze({
  /** A new patch with fresh settings. */
  create(name: string = DEFAULT_PATCH_NAME): PatchDocument {
    return make(name, Editor.create(), false);
  },

  /**
   * A document for a patch file: the name comes from the file name, the
   * settings from its bytes. Throws MutantBrainError if the bytes are not a
   * Mutant Brain patch.
   */
  open(fileName: string, data: ByteInput): PatchDocument {
    return make(nameFromFileName(fileName), Editor.fromSysex(data), false);
  },

  /** Rename the patch. Renaming does not count as changing the settings. */
  rename(doc: PatchDocument, name: string): PatchDocument {
    return name === doc.name ? doc : make(name, doc.patch, doc.modified);
  },

  /** Reset every setting to a fresh patch's, keeping the name. */
  clear(doc: PatchDocument): PatchDocument {
    const fresh = Editor.create();
    if (sameSettings(doc.patch, fresh)) return doc;
    return make(doc.name, fresh, true);
  },

  /** Change one setting (value type checked against the control). Throws for invalid values. */
  set<R extends FieldRef>(doc: PatchDocument, ref: R, value: ValueOf<R>): PatchDocument {
    return PatchDocument.setValue(doc, ref, value);
  },

  /** `set` for generic UI code that handles any control. */
  setValue(doc: PatchDocument, ref: FieldRef, value: FieldValue): PatchDocument {
    const patch = Editor.setValue(doc.patch, ref, value);
    return patch === doc.patch ? doc : make(doc.name, patch, true);
  },

  /** The file name the patch is saved under, e.g. "Roland TR-08.syx". */
  fileName(doc: PatchDocument): string {
    return fileStem(doc.name) + PATCH_FILE_EXTENSION;
  },

  /** The SysEx message for the current settings. */
  toSysex(doc: PatchDocument): Uint8Array {
    return Editor.toSysex(doc.patch);
  },

  /** Everything needed to write the patch to a file, plus the document marked as saved. */
  save(doc: PatchDocument): SavedPatch {
    return Object.freeze({
      fileName: PatchDocument.fileName(doc),
      bytes: PatchDocument.toSysex(doc),
      document: doc.modified ? make(doc.name, doc.patch, false) : doc,
    });
  },

  /** Patch name for a file name: without any folder or ".syx" extension. */
  nameFromFileName,
});
