export type MutantBrainErrorCode =
  /** The input is not byte data. */
  | 'BAD_INPUT'
  /** Not a Mutant Brain SysEx (wrong start byte or device id). */
  | 'BAD_HEADER'
  /** The data ends in the middle of a 4-byte parameter. */
  | 'TRUNCATED'
  /** No F7 terminator. */
  | 'MISSING_END'
  /** A parameter for a block id the module does not have. */
  | 'UNKNOWN_BLOCK'
  /** A value that cannot be sent as a 7-bit SysEx data byte. */
  | 'INVALID_VALUE'
  /** A form field name or value that the form does not have. */
  | 'BAD_FORM_VALUE'
  /** An Editor field reference to a section, item index or control that does not exist. */
  | 'BAD_FIELD_REF'
  /** Text that is not a saved PatchDocument (see PatchDocument.serialize). */
  | 'BAD_DOCUMENT';

/** The only error type this library throws. Check `code` to tell cases apart. */
export class MutantBrainError extends Error {
  readonly code: MutantBrainErrorCode;
  readonly details?: unknown;

  constructor(code: MutantBrainErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'MutantBrainError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}
