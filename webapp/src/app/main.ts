/**
 * Mutant Brain Surgery page: builds the form from the library's schema and
 * wires up loading and saving. All patch logic lives in the library.
 */
import { DEFAULT_FILENAME, Form, MutantBrainPatch, type FormField, type FormSection, type FormValues } from '../lib';

const selects = new Map<string, HTMLSelectElement>();

// ---------------------------------------------------------------------------
// DOM helpers
// ---------------------------------------------------------------------------

type Child = Node | string;

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> & { [attr: string]: unknown } = {},
  children: Child[] = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const key of Object.keys(props)) {
    const value = props[key];
    if (key in node) (node as unknown as { [k: string]: unknown })[key] = value;
    else node.setAttribute(key, String(value));
  }
  for (const child of children) node.appendChild(typeof child === 'string' ? document.createTextNode(child) : child);
  return node;
}

function byId<T extends HTMLElement = HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error(`Missing #${id} in the page`);
  return node as T;
}

// ---------------------------------------------------------------------------
// Rendering the form
// ---------------------------------------------------------------------------

function buildSelect(field: FormField): HTMLSelectElement {
  const select = el('select', { name: field.name, id: field.name, 'aria-label': field.name });
  for (const o of field.options) {
    select.appendChild(el('option', { value: o.value, textContent: o.label, disabled: !!o.disabled }));
  }
  select.addEventListener('change', applyEnabledFields);
  selects.set(field.name, select);
  return select;
}

function buildSection(section: FormSection): HTMLElement {
  const heading = el('h3', { textContent: section.title });
  if (section.key === 'globals') {
    heading.appendChild(el('span', { className: 'hint', textContent: 'Tip: hover a column heading for a description' }));
  }

  const headerRow = el('tr', {}, [el('td', { className: 'row-label' })]);
  for (const column of section.columns) {
    if (column.gapBefore) headerRow.appendChild(el('td', { className: 'gap' }));
    headerRow.appendChild(el('td', { title: column.title, textContent: column.header }));
  }

  const body = el('tbody');
  for (let row = 0; row < section.count; row++) {
    const tr = el('tr', {}, [el('td', { className: 'row-label', textContent: section.rowLabel(row) })]);
    for (const column of section.columns) {
      if (column.gapBefore) tr.appendChild(el('td', { className: 'gap' }));
      const field = Form.field(Form.fieldName(section, row, column));
      if (field) tr.appendChild(el('td', {}, [buildSelect(field)]));
    }
    body.appendChild(tr);
  }

  const block = el('section', { className: 'block', 'aria-label': section.title }, [
    heading,
    el('div', { className: 'scroll' }, [el('table', { className: 'grid' }, [el('thead', {}, [headerRow]), body])]),
  ]);
  if (section.firmwareNote) block.appendChild(firmwareNote());
  return block;
}

function firmwareNote(): HTMLElement {
  return el('p', { className: 'note' }, [
    '† Some settings have specific firmware requirements. Make sure you have an ',
    el('a', { href: Form.FIRMWARE_URL, textContent: 'appropriate firmware version', target: '_blank', rel: 'noopener' }),
    ' to use settings marked with the † symbol',
  ]);
}

// ---------------------------------------------------------------------------
// Form state
// ---------------------------------------------------------------------------

/** The value every dropdown currently shows. */
function currentValues(): FormValues {
  const values: FormValues = {};
  selects.forEach((select, name) => (values[name] = select.value));
  return values;
}

function applyEnabledFields(): void {
  const enabled = Form.enabledFields(currentValues());
  selects.forEach((select, name) => (select.disabled = !enabled[name]));
}

function showPatch(patch: MutantBrainPatch): void {
  const values = patch.toFormValues();
  selects.forEach((select, name) => (select.value = values[name]));
  applyEnabledFields();
}

/** The SysEx the form currently describes (what the original site produced). */
function buildSysex(): Uint8Array {
  return MutantBrainPatch.fromFormValues(currentValues()).toSysex();
}

// ---------------------------------------------------------------------------
// Loading and saving
// ---------------------------------------------------------------------------

function showError(message: string | null): void {
  byId('load-error').hidden = !message;
  byId('load-error-detail').textContent = message ? `(${message})` : '';
}

function showLoaded(fileName: string | null): void {
  const status = byId('load-status');
  status.textContent = '';
  if (fileName === null) return;
  // "Loaded <strong>name.syx</strong>" (textContent reads "Loaded name.syx")
  status.append('Loaded ', el('strong', { textContent: fileName }));
}

/** Load SysEx bytes into the form. Returns true on success. */
function loadBytes(bytes: Uint8Array, fileName = ''): boolean {
  try {
    showPatch(MutantBrainPatch.fromSysex(bytes));
    showError(null);
    showLoaded(fileName);
    return true;
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
    showLoaded(null);
    return false;
  }
}

/** Choosing a file loads it straight away. */
function loadChosenFile(): void {
  const input = byId<HTMLInputElement>('file');
  const file = input.files && input.files[0];
  if (!file) return; // picker cancelled
  const reader = new FileReader();
  reader.onload = () => loadBytes(new Uint8Array(reader.result as ArrayBuffer), file.name);
  reader.onerror = () => showError('could not read the file');
  reader.readAsArrayBuffer(file);
  // Clear the picker so choosing the same file again (e.g. to undo edits)
  // fires 'change' again; the status line shows what was loaded.
  input.value = '';
}

function startFromScratch(): void {
  showPatch(new MutantBrainPatch());
  showError(null);
  showLoaded(null);
  byId<HTMLInputElement>('file').value = '';
}

function downloadSysex(event: Event): void {
  event.preventDefault();
  try {
    const url = URL.createObjectURL(new Blob([buildSysex()], { type: 'application/octet-stream' }));
    const link = el('a', { href: url, download: DEFAULT_FILENAME });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    showError(error instanceof Error ? error.message : String(error));
  }
}

// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------

const sectionsRoot = byId('sections');
for (const section of Form.SECTIONS) sectionsRoot.appendChild(buildSection(section));
showPatch(new MutantBrainPatch());

byId('file').addEventListener('change', loadChosenFile);
byId('reset').addEventListener('click', startFromScratch);
byId('sysex').addEventListener('submit', downloadSysex);

// Hook for automated browser tests and the devtools console.
declare global {
  interface Window {
    MutantBrainApp: {
      loadBytes: typeof loadBytes;
      currentValues: typeof currentValues;
      buildSysex: typeof buildSysex;
      showPatch: typeof showPatch;
    };
  }
}
window.MutantBrainApp = { loadBytes, currentValues, buildSysex, showPatch };
