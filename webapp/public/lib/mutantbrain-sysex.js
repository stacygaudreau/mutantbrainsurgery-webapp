/*!
 * mutantbrain-sysex.js
 * SysEx patch codec for the Hexinverter Mutant Brain Eurorack module.
 *
 * A dependency-free, UI-free port of the "Mutant Brain Surgery" Classic ASP
 * site (sysex.inc, render.inc and the inline JavaScript of patch.asp). It is
 * byte-for-byte compatible with the original site and is verified against the
 * original VBScript executed under Windows Script Host (see webapp/test).
 *
 * Usable as:
 *   - a plain <script> in a browser       -> window.MutantBrainSysex
 *   - CommonJS (Node, Electron)           -> require('./mutantbrain-sysex.js')
 *   - ESM via interop / bundlers           -> import MB from './mutantbrain-sysex.js'
 *   - AMD                                  -> define([...])
 *
 * Two layers:
 *   1. CODEC   - MutantBrainPatch <-> SysEx bytes (sysex.inc WriteSysex/ReadSysex)
 *   2. FORM    - the web form's option lists, enable/disable rules and
 *                submission semantics (render.inc + patch.asp + browser rules),
 *                so any UI can reproduce exactly what the old site produced.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else if (typeof define === 'function' && define.amd) define([], factory); // eslint-disable-line no-undef
  else root.MutantBrainSysex = factory();
}(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // ===========================================================================
  // CONSTANTS (names in comments are the original sysex.inc constants)
  // ===========================================================================

  var SYSEX_START = 0xF0;
  var SYSEX_END = 0xF7;
  /** Manufacturer/device id written to every SysEx (MANUF_ID_0..2). */
  var MANUFACTURER_ID = Object.freeze([0x00, 0x7F, 0x15]);
  /** Older id (00 7F 12) that the original loader also accepted. */
  var LEGACY_MANUFACTURER_ID = Object.freeze([0x00, 0x7F, 0x12]);

  /** Parameter block ids (NRPNH_*). */
  var BLOCK = Object.freeze({
    GLOBAL: 1,                // NRPNH_GLOBAL
    INPUT_BASE: 10,           // input n (1..4)  => 10 + n  (NRPNH_STACK1..4 = 11..14)
    CV_BASE: 20,              // cv n (1..4)     => 20 + n  (NRPNH_CV1..4 = 21..24)
    GATE_BASE: 30,            // gate n (1..12)  => 30 + n  (NRPNH_GATE1..12 = 31..42)
  });

  /** Parameter ids within a block (NRPNL_*). */
  var PARAM = Object.freeze({
    SRC: 1, CHAN: 2, NOTE_MIN: 3, NOTE_MAX: 4, VEL_MIN: 5, PB_RANGE: 7, PRIORITY: 8,
    SPLIT: 9, TICK_OFS: 11, GATE_DUR: 12, THRESHOLD: 13, TRANSPOSE: 14, VOLTS: 15,
    PITCH_SCHEME: 16, CAL_SCALE: 98, CAL_OFS: 99, SAVE: 100,
  });

  /** Source values (NRPVH_SRC_*). */
  var SOURCE = Object.freeze({
    DISABLE: 0, MIDI_NOTE: 1, MIDI_CC: 2, MIDI_CC_NEG: 3, MIDI_BEND: 4, MIDI_TOUCH: 5,
    INPUT1: 11, INPUT2: 12, INPUT3: 13, INPUT4: 14,
    MIDI_TICK: 20, MIDI_TICK_RUN: 21, MIDI_RUN: 22, MIDI_START: 23, MIDI_STOP: 25,
    MIDI_START_STOP: 26, TEST_VOLTAGE: 127,
    // aliases that read better for CV outputs / note inputs
    BPM: 20, FIXED_VOLTAGE: 127, ENABLE: 1,
  });

  /** Channel types (NRPVH_CHAN_*). DEFAULT = "use the global default channel". */
  var CHAN = Object.freeze({ SPECIFIC: 0, OMNI: 1, DEFAULT: 2 });

  /** Gate duration types (NRPVH_DUR_*). */
  var DURATION = Object.freeze({ GATE: 0, MS: 1, DEFAULT: 2, RETRIG: 3 });

  /** CV "note input event" value meaning "most recent note velocity". */
  var CV_EVENT_VELOCITY = 20;

  var NUM_INPUTS = 4;
  var NUM_CVS = 4;
  var NUM_GATES = 12;

  // ===========================================================================
  // ERRORS
  // ===========================================================================

  /**
   * All errors thrown by this module. `code` is one of:
   *   BAD_INPUT      - argument is not byte data
   *   BAD_HEADER     - not a Mutant Brain SysEx (F0 00 7F 15 / F0 00 7F 12)
   *   TRUNCATED      - data ends in the middle of a 4-byte parameter
   *   MISSING_END    - no F7 terminator
   *   UNKNOWN_BLOCK  - parameter for a block id the module does not have
   *   INVALID_VALUE  - a value cannot be encoded as a 7-bit SysEx data byte
   *   BAD_FORM_VALUE - a form value is not a valid option value
   */
  function MutantBrainError(code, message, details) {
    var err = new Error(message);
    Object.setPrototypeOf(err, MutantBrainError.prototype);
    err.name = 'MutantBrainError';
    err.code = code;
    if (details) err.details = details;
    return err;
  }
  MutantBrainError.prototype = Object.create(Error.prototype, {
    constructor: { value: MutantBrainError, writable: true, configurable: true },
  });

  // ===========================================================================
  // HELPERS
  // ===========================================================================

  function isInputSource(src) { return src >= SOURCE.INPUT1 && src <= SOURCE.INPUT4; }

  function hex2(n) { return (n < 16 ? '0' : '') + n.toString(16).toUpperCase(); }

  function blockName(id) {
    if (id === BLOCK.GLOBAL) return 'global';
    if (id > BLOCK.INPUT_BASE && id <= BLOCK.INPUT_BASE + NUM_INPUTS) return 'in' + (id - BLOCK.INPUT_BASE);
    if (id > BLOCK.CV_BASE && id <= BLOCK.CV_BASE + NUM_CVS) return 'cv' + (id - BLOCK.CV_BASE);
    if (id > BLOCK.GATE_BASE && id <= BLOCK.GATE_BASE + NUM_GATES) return 'gt' + (id - BLOCK.GATE_BASE);
    return null;
  }

  var PARAM_NAMES = {};
  Object.keys(PARAM).forEach(function (k) { PARAM_NAMES[PARAM[k]] = k; });

  /** Accepts Uint8Array / Buffer / ArrayBuffer / DataView / array of numbers. */
  function toBytes(data) {
    if (data instanceof Uint8Array) return data;
    if (typeof ArrayBuffer !== 'undefined') {
      if (data instanceof ArrayBuffer) return new Uint8Array(data);
      if (ArrayBuffer.isView && ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    }
    if (Array.isArray(data)) {
      for (var i = 0; i < data.length; i++) {
        var b = data[i];
        if (typeof b !== 'number' || b !== Math.floor(b) || b < 0 || b > 255) {
          throw MutantBrainError('BAD_INPUT', 'Byte array contains a non-byte value at index ' + i);
        }
      }
      return Uint8Array.from(data);
    }
    throw MutantBrainError('BAD_INPUT', 'Expected SysEx bytes (Uint8Array, ArrayBuffer or number[])');
  }

  // ===========================================================================
  // MODEL DEFAULTS (Class_Initialize in sysex.inc)
  // ===========================================================================

  function defaultGlobals() {
    return { chanType: CHAN.SPECIFIC, chanNumber: 1, durationType: DURATION.MS, duration: 15 };
  }
  function defaultInput() {
    return {
      source: SOURCE.DISABLE, chanType: CHAN.DEFAULT, chanNumber: 0, priority: 3,
      minNote: 0, maxNote: 127, minVel: 0, bendRange: 3,
    };
  }
  function defaultCv() {
    return {
      source: SOURCE.DISABLE, inputEvent: 0, transpose: 64, chanType: CHAN.DEFAULT, chanNumber: 0,
      cc: 1, volts: 5, pitchScheme: 0,
    };
  }
  function defaultGate() {
    return {
      source: SOURCE.DISABLE, inputEvent: 1, chanType: CHAN.DEFAULT, chanNumber: 0,
      minNote: 0, maxNote: 127, minVel: 0, cc: 0, threshold: 64, divider: 6, offset: 0,
      durationType: DURATION.DEFAULT, duration: 0,
    };
  }
  function times(n, fn) { var a = []; for (var i = 0; i < n; i++) a.push(fn()); return a; }

  // ===========================================================================
  // MutantBrainPatch
  // ===========================================================================

  /**
   * A complete Mutant Brain configuration.
   *
   * Arrays are 0-based: inputs[0] is "Input.1", cvOutputs[0] is "CV.A",
   * gates[0] is "Gate.1". All values are the raw numbers sent to the module.
   *
   * NOTE: the constructor defaults are those of the original VBScript classes,
   * which are NOT quite what a fresh web form submits (e.g. minVel 0 has no
   * dropdown option, so the form shows and sends "(any)" = 1). Use
   * `normalize()` to get exactly what the web form would produce.
   */
  function MutantBrainPatch() {
    if (!(this instanceof MutantBrainPatch)) return new MutantBrainPatch();
    this.globals = defaultGlobals();
    this.inputs = times(NUM_INPUTS, defaultInput);
    this.cvOutputs = times(NUM_CVS, defaultCv);
    this.gates = times(NUM_GATES, defaultGate);
  }

  // ---------------------------------------------------------------- encoding

  /**
   * The parameter list in transmission order: [blockId, paramId, v1, v2][].
   * (sysex.inc: each class's WriteSysex, in dictMappings order.)
   */
  MutantBrainPatch.prototype.toParams = function () {
    var out = [];
    var g = this.globals, id, i;
    out.push([BLOCK.GLOBAL, PARAM.CHAN, g.chanType, g.chanNumber]);
    out.push([BLOCK.GLOBAL, PARAM.GATE_DUR, g.durationType, g.duration]);

    for (i = 0; i < NUM_INPUTS; i++) {
      var n = this.inputs[i];
      id = BLOCK.INPUT_BASE + 1 + i;
      out.push([id, PARAM.SRC, n.source, 0]);
      out.push([id, PARAM.CHAN, n.chanType, n.chanNumber]);
      out.push([id, PARAM.NOTE_MIN, 0, n.minNote]);
      out.push([id, PARAM.NOTE_MAX, 0, n.maxNote]);
      out.push([id, PARAM.VEL_MIN, 0, n.minVel]);
      out.push([id, PARAM.PB_RANGE, 0, n.bendRange]);
      out.push([id, PARAM.PRIORITY, 0, n.priority]);
    }

    for (i = 0; i < NUM_CVS; i++) {
      var c = this.cvOutputs[i];
      id = BLOCK.CV_BASE + 1 + i;
      switch (c.source) {
        case SOURCE.INPUT1: case SOURCE.INPUT2: case SOURCE.INPUT3: case SOURCE.INPUT4:
          out.push([id, PARAM.SRC, c.source, c.inputEvent]);
          if (c.inputEvent >= 1 && c.inputEvent <= 4) {          // note pitch
            out.push([id, PARAM.PITCH_SCHEME, 0, c.pitchScheme]);
            out.push([id, PARAM.TRANSPOSE, 0, c.transpose]);
          } else if (c.inputEvent === CV_EVENT_VELOCITY) {      // velocity
            out.push([id, PARAM.VOLTS, 0, c.volts]);
          }
          break;
        case SOURCE.MIDI_CC: case SOURCE.MIDI_CC_NEG:
          out.push([id, PARAM.SRC, c.source, c.cc]);
          out.push([id, PARAM.CHAN, c.chanType, c.chanNumber]);
          out.push([id, PARAM.VOLTS, 0, c.volts]);
          break;
        case SOURCE.MIDI_BEND: case SOURCE.MIDI_TOUCH:
          out.push([id, PARAM.SRC, c.source, 0]);
          out.push([id, PARAM.CHAN, c.chanType, c.chanNumber]);
          out.push([id, PARAM.VOLTS, 0, c.volts]);
          break;
        default:
          // includes disabled, BPM (20) and Fixed Voltage (127): the original
          // site never sends a range for those, even though the form enables it.
          out.push([id, PARAM.SRC, c.source, 0]);
      }
    }

    for (i = 0; i < NUM_GATES; i++) {
      var t = this.gates[i];
      id = BLOCK.GATE_BASE + 1 + i;
      switch (t.source) {
        case SOURCE.INPUT1: case SOURCE.INPUT2: case SOURCE.INPUT3: case SOURCE.INPUT4:
          out.push([id, PARAM.SRC, t.source, t.inputEvent]);
          break;
        case SOURCE.MIDI_NOTE:
          out.push([id, PARAM.SRC, SOURCE.MIDI_NOTE, t.minNote]);
          out.push([id, PARAM.CHAN, t.chanType, t.chanNumber]);
          out.push([id, PARAM.NOTE_MAX, 0, t.maxNote]);
          out.push([id, PARAM.VEL_MIN, 0, t.minVel]);
          break;
        case SOURCE.MIDI_CC: case SOURCE.MIDI_CC_NEG:
          out.push([id, PARAM.SRC, t.source, t.cc]);
          out.push([id, PARAM.CHAN, t.chanType, t.chanNumber]);
          out.push([id, PARAM.THRESHOLD, 0, t.threshold]);
          break;
        case SOURCE.MIDI_TICK: case SOURCE.MIDI_TICK_RUN:
          out.push([id, PARAM.SRC, t.source, t.divider]);
          out.push([id, PARAM.TICK_OFS, 0, t.offset]);
          break;
        default:
          out.push([id, PARAM.SRC, t.source, 0]);
      }
      out.push([id, PARAM.GATE_DUR, t.durationType, t.duration]);
    }
    return out;
  };

  /**
   * Encode to a complete SysEx message (F0 00 7F 15 ... F7).
   * Throws MutantBrainError INVALID_VALUE if any transmitted value is not an
   * integer 0..127 (SysEx data bytes are 7-bit).
   * @returns {Uint8Array}
   */
  MutantBrainPatch.prototype.toSysex = function () {
    var params = this.toParams();
    var bytes = new Uint8Array(4 + params.length * 4 + 1);
    bytes[0] = SYSEX_START;
    bytes[1] = MANUFACTURER_ID[0]; bytes[2] = MANUFACTURER_ID[1]; bytes[3] = MANUFACTURER_ID[2];
    var pos = 4;
    for (var i = 0; i < params.length; i++) {
      for (var j = 0; j < 4; j++) {
        var v = params[i][j];
        if (typeof v !== 'number' || v !== Math.floor(v) || v < 0 || v > 127) {
          throw MutantBrainError('INVALID_VALUE',
            'Cannot encode ' + String(v) + ' for ' + blockName(params[i][0]) + ' ' +
            (PARAM_NAMES[params[i][1]] || params[i][1]) + ' (must be an integer 0..127)',
            { param: params[i].slice() });
        }
        bytes[pos++] = v;
      }
    }
    bytes[pos] = SYSEX_END;
    return bytes;
  };

  // ---------------------------------------------------------------- decoding

  /**
   * Apply one received parameter (sysex.inc: each class's ReadSysex).
   * Unknown parameter ids for a known block are ignored, as originally.
   * Throws UNKNOWN_BLOCK for a block id the module does not have (the original
   * page crashed with an HTTP 500 in that case).
   */
  MutantBrainPatch.prototype.applyParam = function (block, param, v1, v2) {
    var o;
    if (block === BLOCK.GLOBAL) {
      o = this.globals;
      if (param === PARAM.CHAN) { o.chanType = v1; o.chanNumber = v2; }
      else if (param === PARAM.GATE_DUR) { o.durationType = v1; o.duration = v2; }
      return this;
    }
    if (block > BLOCK.INPUT_BASE && block <= BLOCK.INPUT_BASE + NUM_INPUTS) {
      o = this.inputs[block - BLOCK.INPUT_BASE - 1];
      switch (param) {
        case PARAM.SRC: o.source = v1; break;
        case PARAM.CHAN: o.chanType = v1; o.chanNumber = v2; break;
        case PARAM.NOTE_MIN: o.minNote = v2; break;
        case PARAM.NOTE_MAX: o.maxNote = v2; break;
        case PARAM.VEL_MIN: o.minVel = v2; break;
        case PARAM.PB_RANGE: o.bendRange = v2; break;
        case PARAM.PRIORITY: o.priority = v2; break;
        default: break;
      }
      return this;
    }
    if (block > BLOCK.CV_BASE && block <= BLOCK.CV_BASE + NUM_CVS) {
      o = this.cvOutputs[block - BLOCK.CV_BASE - 1];
      switch (param) {
        case PARAM.SRC:
          o.source = v1;
          if (isInputSource(v1)) o.inputEvent = v2;
          else if (v1 === SOURCE.MIDI_CC || v1 === SOURCE.MIDI_CC_NEG) o.cc = v2;
          break;
        case PARAM.CHAN: o.chanType = v1; o.chanNumber = v2; break;
        case PARAM.VOLTS: o.volts = v2; break;
        case PARAM.PITCH_SCHEME: o.pitchScheme = v2; break;
        case PARAM.TRANSPOSE: o.transpose = v2; break;
        default: break;
      }
      return this;
    }
    if (block > BLOCK.GATE_BASE && block <= BLOCK.GATE_BASE + NUM_GATES) {
      o = this.gates[block - BLOCK.GATE_BASE - 1];
      switch (param) {
        case PARAM.SRC:
          o.source = v1;
          if (isInputSource(v1)) o.inputEvent = v2;
          else if (v1 === SOURCE.MIDI_NOTE) o.minNote = v2;
          else if (v1 === SOURCE.MIDI_CC || v1 === SOURCE.MIDI_CC_NEG) o.cc = v2;
          else if (v1 === SOURCE.MIDI_TICK || v1 === SOURCE.MIDI_TICK_RUN) o.divider = v2;
          break;
        case PARAM.CHAN: o.chanType = v1; o.chanNumber = v2; break;
        case PARAM.NOTE_MAX: o.maxNote = v2; break;
        case PARAM.VEL_MIN: o.minVel = v2; break;
        case PARAM.GATE_DUR: o.durationType = v1; o.duration = v2; break;
        case PARAM.TICK_OFS: o.offset = v2; break;
        case PARAM.THRESHOLD: o.threshold = v2; break;
        default: break;
      }
      return this;
    }
    throw MutantBrainError('UNKNOWN_BLOCK',
      'Unknown parameter block 0x' + hex2(block) + ' in SysEx data', { block: block, param: param });
  };

  /**
   * Split a SysEx message into its parameters without interpreting them.
   * Same framing rules as fromSysex.
   * @returns {number[][]} [blockId, paramId, v1, v2][]
   */
  MutantBrainPatch.parseParams = function (data) {
    var b = toBytes(data);
    if (b.length < 4 || b[0] !== SYSEX_START || b[1] !== MANUFACTURER_ID[0] || b[2] !== MANUFACTURER_ID[1] ||
        (b[3] !== MANUFACTURER_ID[2] && b[3] !== LEGACY_MANUFACTURER_ID[2])) {
      throw MutantBrainError('BAD_HEADER', 'Not a Mutant Brain SysEx file (expected it to start with F0 00 7F 15)');
    }
    var out = [];
    var i = 4;
    for (;;) {
      if (i >= b.length) throw MutantBrainError('MISSING_END', 'SysEx data ends without an F7 terminator');
      if (b[i] === SYSEX_END) break;
      if (i + 4 > b.length) throw MutantBrainError('TRUNCATED', 'SysEx data ends in the middle of a parameter');
      out.push([b[i], b[i + 1], b[i + 2], b[i + 3]]);
      i += 4;
    }
    return out;
  };

  /**
   * Decode a Mutant Brain SysEx message (as saved in a .syx file).
   * Parameters missing from the file keep their default values; bytes after
   * the F7 terminator are ignored (both as in the original loader).
   * @returns {MutantBrainPatch}
   */
  MutantBrainPatch.fromSysex = function (data) {
    var params = MutantBrainPatch.parseParams(data);
    var patch = new MutantBrainPatch();
    for (var i = 0; i < params.length; i++) {
      patch.applyParam(params[i][0], params[i][1], params[i][2], params[i][3]);
    }
    return patch;
  };

  // ---------------------------------------------------------------- utilities

  MutantBrainPatch.prototype.clone = function () {
    return MutantBrainPatch.fromJSON(this.toJSON());
  };

  MutantBrainPatch.prototype.toJSON = function () {
    var copy = function (o) { return Object.assign({}, o); };
    return {
      globals: copy(this.globals),
      inputs: this.inputs.map(copy),
      cvOutputs: this.cvOutputs.map(copy),
      gates: this.gates.map(copy),
    };
  };

  /** Build from toJSON() output; missing fields keep defaults, unknown keys are ignored. */
  MutantBrainPatch.fromJSON = function (json) {
    var p = new MutantBrainPatch();
    if (!json || typeof json !== 'object') return p;
    var merge = function (target, src) {
      if (!src || typeof src !== 'object') return;
      Object.keys(target).forEach(function (k) { if (typeof src[k] === 'number') target[k] = src[k]; });
    };
    merge(p.globals, json.globals);
    ['inputs', 'cvOutputs', 'gates'].forEach(function (key) {
      if (Array.isArray(json[key])) p[key].forEach(function (o, i) { merge(o, json[key][i]); });
    });
    return p;
  };

  /** True if both patches encode to identical SysEx bytes. */
  MutantBrainPatch.prototype.encodesSameAs = function (other) {
    var a = this.toSysex(), b = other.toSysex();
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  };

  // ===========================================================================
  // FORM LAYER (render.inc option lists, patch.asp enable rules, browser rules)
  // ===========================================================================

  function opt(value, label, disabled) {
    var o = { value: String(value), label: label };
    if (disabled) o.disabled = true;
    return o;
  }
  function range(from, to, labelFn) {
    var a = [];
    for (var i = from; i <= to; i++) a.push(opt(i, labelFn(i)));
    return a;
  }
  function pairs(list) { return list.map(function (p) { return opt(p[0], p[1]); }); }

  var NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  function noteLabel(i) { return i + ' ' + NOTE_NAMES[i % 12] + (Math.floor(i / 12) - 1); }

  function msDurations() {
    var a = [];
    var i = 1;
    while (i < 125) { a.push(opt(i, i + 'ms')); i = i < 15 ? i + 1 : i + 5; }
    return a;
  }

  /** Option lists exactly as rendered by render.inc (values are strings). */
  var OPTIONS = (function () {
    var o = {};
    o.channel = [opt('default', '(default)')].concat(range(1, 16, function (i) { return 'Chan.' + i; }), [opt('omni', '(OMNI)')]);
    o.globalChannel = range(1, 16, function (i) { return 'Chan.' + i; });
    o.minNote = range(0, 127, noteLabel);
    o.maxNote = range(1, 127, noteLabel); // original loop starts at 1: "(single)" never shown
    o.minVel = range(1, 127, function (i) { return i === 1 ? '(any)' : String(i); });
    o.cc = range(1, 127, function (i) {
      return i === 1 ? 'Mod Wheel' : 'cc#' + i;
    }).map(function (x) {
      var dis = { 6: 'Data Entry MSB', 38: 'Data Entry LSB', 98: 'NRPN LSB', 99: 'NRPN MSB' }[x.value];
      return dis ? opt(x.value, dis, true) : x;
    });
    o.threshold = range(1, 127, String);
    o.clockOffset = range(0, 127, function (i) { return i === 0 ? '(none)' : '+' + i; });
    o.gateDuration = [opt('inf', '(gate)'), opt('retrig', '(retrig)'), opt('default', '(trigger)')].concat(msDurations());
    o.globalDuration = msDurations();
    o.inputSource = pairs([[0, '(disable)'], [1, 'ENABLE']]);
    o.priority = pairs([[0, 'Last note priority'], [1, 'Lowest note priority'], [3, 'Highest note priority'],
      [6, '2 note cycle'], [7, '3 note cycle'], [8, '4 note cycle'],
      [9, '2 note chord'], [10, '3 note chord'], [11, '4 note chord']]);
    o.bendRange = range(0, 24, function (i) { return '+/-' + i; });
    o.cvSource = pairs([[0, '(disable)'], [11, 'Note input #1'], [12, 'Note input #2'], [13, 'Note input #3'],
      [14, 'Note input #4'], [2, 'MIDI CC'], [4, 'Pitch Bend'], [5, 'Channel Aftertouch'],
      [20, 'BPM to CV'], [127, 'Fixed Voltage']]);
    o.cvEvent = pairs([[1, 'First note pitch'], [2, 'Second note pitch'], [3, 'Third note pitch'],
      [4, 'Fourth note pitch'], [20, 'Most recent note velocity']]);
    var tr = [[100, '+3oct'], [88, '+2oct'], [76, '+1oct']];
    for (var i = 11; i >= 1; i--) tr.push([64 + i, String(i)]);
    tr.push([64, '(none)']);
    for (i = -1; i >= -11; i--) tr.push([64 + i, String(i)]);
    tr.push([52, '-1oct'], [40, '-2oct'], [28, '-3oct']);
    o.transpose = pairs(tr);
    o.gateSource = pairs([[0, '(disable)'], [11, 'Note input #1'], [12, 'Note input #2'], [13, 'Note input #3'],
      [14, 'Note input #4'], [1, 'MIDI note'], [2, 'CC above threshold'], [3, 'CC below threshold'],
      [20, 'Clock Tick'], [21, 'Clock Tick+Run'], [22, 'Transport Run'], [23, 'Transport Restart'],
      [25, 'Transport Stop'], [26, 'Trans. Start/Stop \u2020']]);
    o.gateEvent = pairs([[1, 'First note on'], [2, 'Second note on'], [3, 'Third note on'],
      [4, 'Fourth note on'], [5, 'Any note on'], [0, 'All notes off']]);
    o.clockDivider = pairs([[3, '1/32'], [4, '1/16T'], [6, '1/16'], [8, '1/8T'], [9, '1/16D'], [12, '1/8'],
      [16, '1/4T'], [18, '1/8D'], [24, '1/4'], [32, '1/2T'], [36, '1/4D'], [48, '1/2'], [72, '1/2D'],
      [96, '1'], [1, '24ppqn']]);
    o.volts = range(1, 8, function (i) { return i + 'V'; });
    o.pitchScheme = pairs([[0, 'V/Oct'], [1, 'Hz/V \u2020'], [2, '1.2V/Oct \u2020']]);
    Object.keys(o).forEach(function (k) { o[k].forEach(Object.freeze); Object.freeze(o[k]); });
    return Object.freeze(o);
  }());

  // Column definitions: field suffix, value kind, model property, option list,
  // header text and tooltip (verbatim from patch.asp), and layout spacing.
  // kind: 'byte' (CByte), 'chan' (ReadChan), 'dur' (ReadDuration)
  function col(field, kind, prop, options, header, title, gapBefore) {
    return Object.freeze({ field: field, kind: kind, prop: prop, options: options, header: header, title: title, gapBefore: !!gapBefore });
  }
  var T = {
    defChan: "Select the MIDI channel to use for all mapings that use MIDI channel '(default)'",
    defTrig: "Select the millisecond duration for gate outputs that are set as '(trig)'",
    inEnable: "Select whether this note input is enabled and listening to MIDI.\nYou should disable any inputs you don't need.",
    inChan: 'Select the MIDI channel that this note input will listen to',
    inMode: 'When multiple notes are held, this setting determines which of the notes should be be played on the outputs',
    inMin: 'You can limit the range of notes that this note input will play (for example to split the keyboard between two outputs)\nSelect min note = 0 and max note = 127 to play any note on the selected MIDI channel',
    inMax: "Maximum note of the range. If you select 'single' then only the single note selected in min note will play.",
    inVel: 'You can filter notes that will play on the input based on their MIDI note velocity.\nOnly notes that are equal or higher in velocity can play.',
    inBend: 'Select the pitch bend range for this note input.',
    cvSrc: 'Select the source of the note or voltage level that this CV output will play.',
    cvEv: 'If you select a note input, this decides which note (or other parameter)\nfrom that note input will be mapped to the CV output',
    cvTr: 'If you select a note input, you can transpose the output note CV.\nThis only works for notes (not velocity, bend etc)',
    cvSch: 'For note pitch CV this is the voltage scaling scheme',
    cvChan: 'If you select a MIDI CC as input, you specify the channel here',
    cvCC: 'If you select a MIDI CC as input, you specify the CC number here',
    cvV: 'For non-musical note CV this is the full voltage range',
    gtSrc: 'Select the source of event that will activate this gate output',
    gtEv: 'If you select a note input, the gate can activate when\na note is played from that input',
    gtChan: 'If you select MIDI note or MIDI CC to activate the gate output\nthen you can select the MIDI channel here',
    gtMin: 'If you select MIDI note to activate the output, select the note value here',
    gtMax: 'Select a single note, or upper limit of a range of notes to activate the output when received',
    gtVel: 'The output can activate only when notes are received that are equal or higher than this velocity',
    gtCC: 'If you select MIDI CC to activate the output, select the CC number here',
    gtThr: 'If you select MIDI CC to activate the output, select the switching threshold here',
    gtDiv: 'If you select MIDI clock to activate the output, select the clock rate (divider) here',
    gtOfs: "You can also offset MIDI clock outputs so they activate 'late' by a number of ticks (There are 24 ticks per beat)",
    gtDur: "Select (trig) to pulse output with the default trigger time or\nselect (gate) to have the output switch on until the activating condition is over (e.g. note released)\nYou can also set a specific trigger time for this output",
  };

  var SECTIONS = Object.freeze([
    Object.freeze({
      key: 'globals', title: 'GLOBALS', count: 1, prefix: 'global', rowLabel: function () { return ''; },
      columns: Object.freeze([
        col('chan', 'chan', 'chan', OPTIONS.globalChannel, 'Default Channel', T.defChan),
        col('dur', 'dur', 'dur', OPTIONS.globalDuration, 'Default Trigger', T.defTrig, true),
      ]),
    }),
    Object.freeze({
      key: 'inputs', title: 'NOTE INPUTS', count: NUM_INPUTS, prefix: 'in', rowLabel: function (i) { return 'Input.' + (i + 1); },
      columns: Object.freeze([
        col('src', 'byte', 'source', OPTIONS.inputSource, 'Enable', T.inEnable),
        col('chan', 'chan', 'chan', OPTIONS.channel, 'Channel', T.inChan),
        col('prty', 'byte', 'priority', OPTIONS.priority, 'Mode', T.inMode),
        col('min_note', 'byte', 'minNote', OPTIONS.minNote, 'Min.Note', T.inMin),
        col('max_note', 'byte', 'maxNote', OPTIONS.maxNote, 'Max.Note', T.inMax),
        col('min_vel', 'byte', 'minVel', OPTIONS.minVel, 'Min Vel.', T.inVel),
        col('bend', 'byte', 'bendRange', OPTIONS.bendRange, 'Pitch Bend', T.inBend),
      ]),
    }),
    Object.freeze({
      key: 'cvOutputs', title: 'CV OUTPUTS', count: NUM_CVS, prefix: 'cv', rowLabel: function (i) { return 'CV.' + String.fromCharCode(65 + i); },
      firmwareNote: true,
      columns: Object.freeze([
        col('src', 'byte', 'source', OPTIONS.cvSource, 'CV Source', T.cvSrc),
        col('event', 'byte', 'inputEvent', OPTIONS.cvEvent, 'Note input', T.cvEv, true),
        col('trans', 'byte', 'transpose', OPTIONS.transpose, 'Transpose', T.cvTr),
        col('scheme', 'byte', 'pitchScheme', OPTIONS.pitchScheme, 'Scheme', T.cvSch),
        col('chan', 'chan', 'chan', OPTIONS.channel, 'Chan', T.cvChan, true),
        col('cc', 'byte', 'cc', OPTIONS.cc, 'CC#', T.cvCC),
        col('volts', 'byte', 'volts', OPTIONS.volts, 'Range', T.cvV),
      ]),
    }),
    Object.freeze({
      key: 'gates', title: 'GATE OUTPUTS', count: NUM_GATES, prefix: 'gt', rowLabel: function (i) { return 'Gate.' + (i + 1); },
      firmwareNote: true,
      columns: Object.freeze([
        col('src', 'byte', 'source', OPTIONS.gateSource, 'Source', T.gtSrc),
        col('event', 'byte', 'inputEvent', OPTIONS.gateEvent, 'Note input event', T.gtEv, true),
        col('chan', 'chan', 'chan', OPTIONS.channel, 'Chan', T.gtChan, true),
        col('min_note', 'byte', 'minNote', OPTIONS.minNote, 'Min.Note', T.gtMin),
        col('max_note', 'byte', 'maxNote', OPTIONS.maxNote, 'Max.Note', T.gtMax),
        col('min_vel', 'byte', 'minVel', OPTIONS.minVel, 'Min Vel.', T.gtVel),
        col('cc', 'byte', 'cc', OPTIONS.cc, 'CC#', T.gtCC, true),
        col('thrs', 'byte', 'threshold', OPTIONS.threshold, 'Switch@', T.gtThr),
        col('div', 'byte', 'divider', OPTIONS.clockDivider, 'Ck.Rate', T.gtDiv, true),
        col('ofs', 'byte', 'offset', OPTIONS.clockOffset, 'Tk.Ofs', T.gtOfs),
        col('dur', 'dur', 'dur', OPTIONS.gateDuration, 'Trig', T.gtDur, true),
      ]),
    }),
  ]);

  /**
   * Flat list of every form field in page order:
   * {name: 'cv2.trans', section, index (0-based row), column, options}
   */
  var FIELDS = (function () {
    var list = [];
    SECTIONS.forEach(function (s) {
      for (var i = 0; i < s.count; i++) {
        s.columns.forEach(function (c) {
          var name = (s.key === 'globals' ? 'global' : s.prefix + (i + 1)) + '.' + c.field;
          list.push(Object.freeze({ name: name, section: s.key, index: i, column: c, options: c.options }));
        });
      }
    });
    return Object.freeze(list);
  }());
  var FIELD_BY_NAME = {};
  FIELDS.forEach(function (f) { FIELD_BY_NAME[f.name] = f; });

  function modelObject(patch, f) {
    return f.section === 'globals' ? patch.globals : patch[f.section][f.index];
  }

  // ---- render semantics: which option a <select> shows for a model value

  function hasOption(options, value) {
    for (var i = 0; i < options.length; i++) if (options[i].value === value) return true;
    return false;
  }
  function shown(options, candidate) {
    // nothing matched => browser shows the first non-disabled option
    if (candidate !== null && hasOption(options, candidate)) return candidate;
    for (var i = 0; i < options.length; i++) if (!options[i].disabled) return options[i].value;
    return options[0].value;
  }
  function renderChan(o, includeDefault) {
    if (includeDefault && o.chanType === CHAN.DEFAULT) return 'default';
    if (o.chanType === CHAN.SPECIFIC && o.chanNumber >= 1 && o.chanNumber <= 16) return String(o.chanNumber);
    if (includeDefault && o.chanType === CHAN.OMNI) return 'omni';
    return null;
  }
  function renderDur(o, includeDefault) {
    if (includeDefault && o.durationType === DURATION.GATE) return 'inf';
    if (includeDefault && o.durationType === DURATION.RETRIG) return 'retrig';
    if (includeDefault && o.durationType === DURATION.DEFAULT) return 'default';
    if (o.durationType === DURATION.MS) return String(o.duration);
    return null;
  }

  /**
   * The value each form <select> shows for this patch, as the original
   * patch.asp rendered it (a value with no matching option shows the first
   * option, exactly as browsers do).
   * @returns {Object<string,string>} field name -> option value
   */
  MutantBrainPatch.prototype.toFormValues = function () {
    var out = {};
    var self = this;
    FIELDS.forEach(function (f) {
      var o = modelObject(self, f);
      var includeDefault = f.section !== 'globals';
      var c = f.column, cand;
      if (c.kind === 'chan') cand = renderChan(o, includeDefault);
      else if (c.kind === 'dur') cand = renderDur(o, includeDefault);
      else cand = typeof o[c.prop] === 'number' ? String(o[c.prop]) : null;
      out[f.name] = shown(f.options, cand);
    });
    return out;
  };

  // ---- enable/disable rules (verbatim logic of XAble_* in patch.asp)

  var IN_DEPENDENT = ['chan', 'prty', 'min_note', 'max_note', 'min_vel', 'bend'];

  /**
   * Which fields are enabled for the given displayed form values (missing
   * keys take the fresh-form value). Mirrors XAble_Input / XAble_CVOutput /
   * XAble_GateOutput from patch.asp.
   * @returns {Object<string,boolean>}
   */
  function enabledFields(values) {
    var v = completeValues(values);
    var en = {};
    FIELDS.forEach(function (f) { en[f.name] = true; });
    var i, k, p, val, val2;
    for (i = 1; i <= NUM_INPUTS; i++) {
      p = 'in' + i + '.';
      var d = v[p + 'src'] !== '1';
      for (k = 0; k < IN_DEPENDENT.length; k++) en[p + IN_DEPENDENT[k]] = !d;
    }
    for (i = 1; i <= NUM_CVS; i++) {
      p = 'cv' + i + '.';
      val = v[p + 'src']; val2 = v[p + 'event'];
      var dEv = !(val === '11' || val === '12' || val === '13' || val === '14');
      var dVel = val2 === '20';
      var dCh = !(val === '2' || val === '3' || val === '4' || val === '5');
      var dCc = !(val === '2');
      var dVolts = !(val === '2' || val === '4' || val === '5' || val === '20' || val === '127' || (!dEv && val2 === '20'));
      en[p + 'event'] = !dEv;
      en[p + 'trans'] = !(dEv || dVel);
      en[p + 'scheme'] = !(dEv || dVel);
      en[p + 'chan'] = !dCh;
      en[p + 'cc'] = !dCc;
      en[p + 'volts'] = !dVolts;
    }
    for (i = 1; i <= NUM_GATES; i++) {
      p = 'gt' + i + '.';
      val = v[p + 'src'];
      var eAny = val !== '0';
      var eEv = val === '11' || val === '12' || val === '13' || val === '14';
      var eNote = val === '1';
      var eCc = val === '2' || val === '3';
      var eClk = val === '20' || val === '21';
      en[p + 'event'] = eEv;
      en[p + 'chan'] = eCc || eNote;
      en[p + 'min_note'] = eNote;
      en[p + 'max_note'] = eNote;
      en[p + 'min_vel'] = eNote;
      en[p + 'cc'] = eCc;
      en[p + 'thrs'] = eCc;
      en[p + 'div'] = eClk;
      en[p + 'ofs'] = eClk;
      en[p + 'dur'] = eAny;
    }
    return en;
  }

  var _freshValues = null;
  /** Displayed values of a freshly loaded (empty) form. */
  function defaultFormValues() {
    if (!_freshValues) _freshValues = Object.freeze(new MutantBrainPatch().toFormValues());
    return Object.assign({}, _freshValues);
  }
  function completeValues(values) {
    var v = defaultFormValues();
    if (values) {
      Object.keys(values).forEach(function (k) {
        if (!FIELD_BY_NAME[k]) throw MutantBrainError('BAD_FORM_VALUE', 'Unknown form field "' + k + '"');
        v[k] = String(values[k]);
      });
    }
    return v;
  }

  /**
   * The name/value pairs a browser submits for these displayed values:
   * disabled fields are omitted, and so is a field whose selected option is a
   * disabled one (e.g. CC 6 "Data Entry MSB" loaded from a file).
   * @returns {Object<string,string>}
   */
  function submittedValues(values) {
    var v = completeValues(values);
    var en = enabledFields(v);
    var out = {};
    FIELDS.forEach(function (f) {
      var val = v[f.name];
      var option = null;
      for (var i = 0; i < f.options.length; i++) {
        if (f.options[i].value === val) { option = f.options[i]; break; }
      }
      // a <select> can only ever hold one of its own options
      if (!option) throw MutantBrainError('BAD_FORM_VALUE', 'Field "' + f.name + '" has no option "' + val + '"');
      if (en[f.name] && !option.disabled) out[f.name] = val;
    });
    return out;
  }

  // ---- ReadForm semantics (sysex.inc). A field that was not submitted reads
  //      as Empty in ASP, and CByte(Empty) = CLng(Empty) = 0.

  function readNumber(name, raw, max) {
    if (raw === undefined || raw === null) return 0;
    var s = String(raw);
    if (!/^\d{1,3}$/.test(s) || Number(s) > max) {
      throw MutantBrainError('BAD_FORM_VALUE', 'Field "' + name + '" has invalid value "' + s + '"');
    }
    return Number(s);
  }

  /**
   * Build a patch from submitted form fields exactly as get_sysex.asp did
   * (ReadForm). Fields absent from `submitted` were not submitted (disabled)
   * and read as 0. Most callers want fromFormValues() instead.
   */
  MutantBrainPatch.fromSubmittedForm = function (submitted) {
    var s = submitted || {};
    Object.keys(s).forEach(function (k) {
      if (!FIELD_BY_NAME[k]) throw MutantBrainError('BAD_FORM_VALUE', 'Unknown form field "' + k + '"');
    });
    var patch = new MutantBrainPatch();
    FIELDS.forEach(function (f) {
      var o = modelObject(patch, f);
      var raw = Object.prototype.hasOwnProperty.call(s, f.name) ? s[f.name] : undefined;
      var c = f.column;
      if (c.kind === 'chan') {
        if (raw === 'omni') { o.chanType = CHAN.OMNI; o.chanNumber = 0; }
        else if (raw === 'default') { o.chanType = CHAN.DEFAULT; o.chanNumber = 0; }
        else { o.chanType = CHAN.SPECIFIC; o.chanNumber = readNumber(f.name, raw, 255); }
      } else if (c.kind === 'dur') {
        if (raw === 'inf') { o.durationType = DURATION.GATE; o.duration = 0; }
        else if (raw === 'default') { o.durationType = DURATION.DEFAULT; o.duration = 0; }
        else if (raw === 'retrig') { o.durationType = DURATION.RETRIG; o.duration = 0; }
        else { o.durationType = DURATION.MS; o.duration = readNumber(f.name, raw, 255); }
      } else {
        o[c.prop] = readNumber(f.name, raw, 255);
      }
    });
    return patch;
  };

  /**
   * Build a patch from the values shown in the form, applying the page's
   * enable/disable rules and browser submission rules first. This is exactly
   * "click 'Gimme that SysEx'" on the original site. Missing keys take the
   * fresh-form value.
   */
  MutantBrainPatch.fromFormValues = function (values) {
    return MutantBrainPatch.fromSubmittedForm(submittedValues(values));
  };

  /**
   * The patch the original site would save after loading this one into the
   * form and pressing the button (= fromFormValues(this.toFormValues())).
   */
  MutantBrainPatch.prototype.normalize = function () {
    return MutantBrainPatch.fromFormValues(this.toFormValues());
  };

  // ===========================================================================
  // EXPORTS
  // ===========================================================================

  var Form = Object.freeze({
    SECTIONS: SECTIONS,
    FIELDS: FIELDS,
    OPTIONS: OPTIONS,
    field: function (name) { return FIELD_BY_NAME[name] || null; },
    enabledFields: enabledFields,
    submittedValues: submittedValues,
    defaultFormValues: defaultFormValues,
    FIRMWARE_NOTE: 'Some settings have specific firmware requirements. Make sure you have an appropriate firmware version to use settings marked with the \u2020 symbol',
    FIRMWARE_URL: 'https://www.ericasynths.lv/hexinverter-mutant-brain-2515/',
  });

  return Object.freeze({
    VERSION: '1.0.0',
    MutantBrainPatch: MutantBrainPatch,
    MutantBrainError: MutantBrainError,
    Form: Form,
    SYSEX_START: SYSEX_START,
    SYSEX_END: SYSEX_END,
    MANUFACTURER_ID: MANUFACTURER_ID,
    LEGACY_MANUFACTURER_ID: LEGACY_MANUFACTURER_ID,
    BLOCK: BLOCK,
    PARAM: PARAM,
    SOURCE: SOURCE,
    CHAN: CHAN,
    DURATION: DURATION,
    CV_EVENT_VELOCITY: CV_EVENT_VELOCITY,
    NUM_INPUTS: NUM_INPUTS,
    NUM_CVS: NUM_CVS,
    NUM_GATES: NUM_GATES,
    /** Suggested download filename (the original site's). */
    DEFAULT_FILENAME: 'mutantbrain.syx',
  });
}));
