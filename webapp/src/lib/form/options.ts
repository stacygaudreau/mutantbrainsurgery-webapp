/**
 * The dropdown option lists of the patch form, exactly as the original site
 * rendered them (values are strings, as in an HTML <select>).
 */

export interface FormOption {
  readonly value: string;
  readonly label: string;
  /** Shown but not selectable (and not submitted if selected by a loaded patch). */
  readonly disabled?: true;
}

export type OptionList = readonly FormOption[];

const DAGGER = '†'; // marks settings that need a newer firmware

function option(value: string | number, label: string, disabled = false): FormOption {
  return Object.freeze(disabled ? { value: String(value), label, disabled: true as const } : { value: String(value), label });
}

/** Options for every integer from `from` to `to` (inclusive). */
function numberRange(from: number, to: number, label: (n: number) => string = String): FormOption[] {
  const list: FormOption[] = [];
  for (let n = from; n <= to; n++) list.push(option(n, label(n)));
  return list;
}

/** Options from [value, label] pairs. */
function labelled(pairs: [string | number, string][]): FormOption[] {
  return pairs.map(([value, label]) => option(value, label));
}

function freeze(list: FormOption[]): OptionList {
  return Object.freeze(list);
}

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

/** "60 C4": MIDI note number plus name (middle C = C4). */
function noteLabel(note: number): string {
  return `${note} ${NOTE_NAMES[note % 12]}${Math.floor(note / 12) - 1}`;
}

const channelNumbers = () => numberRange(1, 16, (n) => `Chan.${n}`);

/** Trigger lengths: 1-15 ms in steps of 1, then 20-120 ms in steps of 5. */
function triggerLengths(): FormOption[] {
  const list: FormOption[] = [];
  for (let ms = 1; ms < 125; ms = ms < 15 ? ms + 1 : ms + 5) list.push(option(ms, `${ms}ms`));
  return list;
}

/** Transpose: octave shortcuts, then +11..-11 semitones. 64 = no transpose. */
function transposeOptions(): FormOption[] {
  const list = labelled([[100, '+3oct'], [88, '+2oct'], [76, '+1oct']]);
  for (let semitones = 11; semitones >= -11; semitones--) {
    list.push(option(64 + semitones, semitones === 0 ? '(none)' : String(semitones)));
  }
  list.push(...labelled([[52, '-1oct'], [40, '-2oct'], [28, '-3oct']]));
  return list;
}

/** CCs 6, 38, 98 and 99 carry NRPN data, so they cannot be mapped. */
const RESERVED_CCS: { [cc: number]: string } = {
  6: 'Data Entry MSB',
  38: 'Data Entry LSB',
  98: 'NRPN LSB',
  99: 'NRPN MSB',
};

function ccOptions(): FormOption[] {
  return numberRange(1, 127).map((o) => {
    const cc = Number(o.value);
    if (RESERVED_CCS[cc]) return option(cc, RESERVED_CCS[cc], true);
    return option(cc, cc === 1 ? 'Mod Wheel' : `cc#${cc}`);
  });
}

export const OPTIONS = Object.freeze({
  channel: freeze([option('default', '(default)'), ...channelNumbers(), option('omni', '(OMNI)')]),
  globalChannel: freeze(channelNumbers()),

  minNote: freeze(numberRange(0, 127, noteLabel)),
  // Starts at 1: the original's "(single)" option (value 0) was never rendered.
  maxNote: freeze(numberRange(1, 127, noteLabel)),
  minVel: freeze(numberRange(1, 127, (n) => (n === 1 ? '(any)' : String(n)))),

  cc: freeze(ccOptions()),
  threshold: freeze(numberRange(1, 127)),
  clockOffset: freeze(numberRange(0, 127, (n) => (n === 0 ? '(none)' : `+${n}`))),
  clockDivider: freeze(labelled([
    [3, '1/32'], [4, '1/16T'], [6, '1/16'], [8, '1/8T'], [9, '1/16D'], [12, '1/8'], [16, '1/4T'],
    [18, '1/8D'], [24, '1/4'], [32, '1/2T'], [36, '1/4D'], [48, '1/2'], [72, '1/2D'], [96, '1'],
    [1, '24ppqn'],
  ])),

  gateDuration: freeze([
    option('inf', '(gate)'),
    option('retrig', '(retrig)'),
    option('default', '(trigger)'),
    ...triggerLengths(),
  ]),
  globalDuration: freeze(triggerLengths()),

  inputSource: freeze(labelled([[0, '(disable)'], [1, 'ENABLE']])),
  priority: freeze(labelled([
    [0, 'Last note priority'], [1, 'Lowest note priority'], [3, 'Highest note priority'],
    [6, '2 note cycle'], [7, '3 note cycle'], [8, '4 note cycle'],
    [9, '2 note chord'], [10, '3 note chord'], [11, '4 note chord'],
  ])),
  bendRange: freeze(numberRange(0, 24, (n) => `+/-${n}`)),

  cvSource: freeze(labelled([
    [0, '(disable)'], [11, 'Note input #1'], [12, 'Note input #2'], [13, 'Note input #3'],
    [14, 'Note input #4'], [2, 'MIDI CC'], [4, 'Pitch Bend'], [5, 'Channel Aftertouch'],
    [20, 'BPM to CV'], [127, 'Fixed Voltage'],
  ])),
  cvEvent: freeze(labelled([
    [1, 'First note pitch'], [2, 'Second note pitch'], [3, 'Third note pitch'],
    [4, 'Fourth note pitch'], [20, 'Most recent note velocity'],
  ])),
  transpose: freeze(transposeOptions()),
  pitchScheme: freeze(labelled([[0, 'V/Oct'], [1, `Hz/V ${DAGGER}`], [2, `1.2V/Oct ${DAGGER}`]])),
  volts: freeze(numberRange(1, 8, (n) => `${n}V`)),

  gateSource: freeze(labelled([
    [0, '(disable)'], [11, 'Note input #1'], [12, 'Note input #2'], [13, 'Note input #3'],
    [14, 'Note input #4'], [1, 'MIDI note'], [2, 'CC above threshold'], [3, 'CC below threshold'],
    [20, 'Clock Tick'], [21, 'Clock Tick+Run'], [22, 'Transport Run'], [23, 'Transport Restart'],
    [25, 'Transport Stop'], [26, `Trans. Start/Stop ${DAGGER}`],
  ])),
  gateEvent: freeze(labelled([
    [1, 'First note on'], [2, 'Second note on'], [3, 'Third note on'],
    [4, 'Fourth note on'], [5, 'Any note on'], [0, 'All notes off'],
  ])),
});

export type OptionListName = keyof typeof OPTIONS;
