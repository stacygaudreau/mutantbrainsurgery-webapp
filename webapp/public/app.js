/*
 * Mutant Brain Surgery - page glue. All patch logic lives in
 * lib/mutantbrain-sysex.js; this file only builds the DOM and wires events.
 */
(function () {
  'use strict';

  var MB = window.MutantBrainSysex;
  var Patch = MB.MutantBrainPatch;
  var Form = MB.Form;
  var selects = {}; // field name -> <select>

  function el(tag, attrs, children) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      if (k === 'text') e.textContent = attrs[k];
      else if (k === 'className') e.className = attrs[k];
      else e.setAttribute(k, attrs[k]);
    });
    (children || []).forEach(function (c) { e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }

  function buildSelect(field) {
    var s = el('select', { name: field.name, id: field.name, 'aria-label': field.name });
    field.options.forEach(function (o) {
      var opt = el('option', { value: o.value, text: o.label });
      if (o.disabled) opt.disabled = true;
      s.appendChild(opt);
    });
    s.addEventListener('change', applyEnabled);
    selects[field.name] = s;
    return s;
  }

  function render() {
    var root = document.getElementById('sections');
    Form.SECTIONS.forEach(function (section) {
      var block = el('section', { className: 'block', 'aria-label': section.title });
      root.appendChild(block);
      var heading = el('h3', { text: section.title });
      if (section.key === 'globals') heading.appendChild(el('span', { className: 'hint', text: 'Tip: hover a column heading for a description' }));
      block.appendChild(heading);

      var head = el('tr', null, [el('td', { className: 'row-label' })]);
      section.columns.forEach(function (c) {
        if (c.gapBefore) head.appendChild(el('td', { className: 'gap' }));
        head.appendChild(el('td', { title: c.title, text: c.header }));
      });
      var body = el('tbody');
      for (var i = 0; i < section.count; i++) {
        var tr = el('tr', null, [el('td', { className: 'row-label', text: section.rowLabel(i) })]);
        section.columns.forEach(function (c) {
          if (c.gapBefore) tr.appendChild(el('td', { className: 'gap' }));
          var name = (section.key === 'globals' ? 'global' : section.prefix + (i + 1)) + '.' + c.field;
          tr.appendChild(el('td', null, [buildSelect(Form.field(name))]));
        });
        body.appendChild(tr);
      }
      block.appendChild(el('div', { className: 'scroll' }, [el('table', { className: 'grid' }, [el('thead', null, [head]), body])]));

      if (section.firmwareNote) {
        var note = el('p', { className: 'note' }, ['\u2020\u00a0Some settings have specific firmware requirements. Make sure you have an ']);
        note.appendChild(el('a', { href: Form.FIRMWARE_URL, text: 'appropriate firmware version', target: '_blank', rel: 'noopener' }));
        note.appendChild(document.createTextNode(' to use settings marked with the \u2020 symbol'));
        block.appendChild(note);
      }
    });
  }

  /** Displayed form values (field name -> option value). */
  function currentValues() {
    var v = {};
    Object.keys(selects).forEach(function (k) { v[k] = selects[k].value; });
    return v;
  }

  function applyEnabled() {
    var en = Form.enabledFields(currentValues());
    Object.keys(selects).forEach(function (k) { selects[k].disabled = !en[k]; });
  }

  function showPatch(patch) {
    var v = patch.toFormValues();
    Object.keys(v).forEach(function (k) { selects[k].value = v[k]; });
    applyEnabled();
  }

  function setError(message) {
    var box = document.getElementById('load-error');
    box.hidden = !message;
    document.getElementById('load-error-detail').textContent = message ? '(' + message + ')' : '';
  }

  /** Load SysEx bytes into the form. Returns true on success. */
  function loadBytes(bytes, label) {
    var status = document.getElementById('load-status');
    try {
      showPatch(Patch.fromSysex(bytes));
      setError(null);
      // "Loaded <b>name.syx</b>" (textContent stays "Loaded name.syx")
      status.textContent = 'Loaded' + (label ? ' ' : '');
      if (label) status.appendChild(el('strong', { text: label }));
      return true;
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
      status.textContent = '';
      return false;
    }
  }

  /** Choosing a file loads it straight away. */
  function loadSelectedFile() {
    var input = document.getElementById('file');
    var file = input.files && input.files[0];
    if (!file) return; // picker cancelled
    var reader = new FileReader();
    reader.onload = function () { loadBytes(new Uint8Array(reader.result), file.name); };
    reader.onerror = function () { setError('could not read the file'); };
    reader.readAsArrayBuffer(file);
    // clear the picker so choosing the same file again (e.g. to undo edits)
    // fires 'change' again; the status line shows what was loaded
    input.value = '';
  }

  /** The SysEx the form currently describes (exactly what the old site produced). */
  function buildSysex() {
    return Patch.fromFormValues(currentValues()).toSysex();
  }

  function download(bytes, filename) {
    var blob = new Blob([bytes], { type: 'application/octet-stream' });
    var url = URL.createObjectURL(blob);
    var a = el('a', { href: url, download: filename });
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }

  render();
  showPatch(new Patch());

  document.getElementById('file').addEventListener('change', loadSelectedFile);
  document.getElementById('reset').addEventListener('click', function () {
    showPatch(new Patch());
    setError(null);
    document.getElementById('file').value = '';
    document.getElementById('load-status').textContent = '';
  });
  document.getElementById('sysex').addEventListener('submit', function (ev) {
    ev.preventDefault();
    try {
      download(buildSysex(), MB.DEFAULT_FILENAME);
    } catch (e) {
      setError(e && e.message ? e.message : String(e));
    }
  });

  // small hook for automated browser tests and power users (devtools console)
  window.MutantBrainApp = { loadBytes: loadBytes, currentValues: currentValues, buildSysex: buildSysex, showPatch: showPatch };
}());
