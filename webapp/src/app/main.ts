/**
 * The patch builder page (Mutant Brain Surgery, and the CV.OCD site). The
 * patch being edited lives in memory as a PatchDocument; the page renders it
 * and turns user actions into library calls (open, new, clear, rename, change
 * a setting, save). All patch logic lives in the library.
 */
import { Editor, Form, PatchDocument, type EditorView, type FieldRef, type FieldView, type FormField, type FormSection } from '../lib';

/** The patch being edited. Only `update` replaces it. */
let doc: PatchDocument = PatchDocument.create();
/** Editor.view(doc.patch), computed once per change of settings. */
let view: EditorView = Editor.view(doc.patch);

// Branding comes from the page, so each site (Mutant Brain Surgery, CV.OCD)
// shares this script: the site name is <meta name="application-name"> (the
// <title> is a longer one for search results), and the firmware and bug
// report links are <body data-firmware-url data-support-url data-support-label>.
const SITE_TITLE =
  document.querySelector('meta[name="application-name"]')?.getAttribute('content') || document.title;
const FIRMWARE_URL = document.body.getAttribute('data-firmware-url') || Form.FIRMWARE_URL;
const SUPPORT_URL = document.body.getAttribute('data-support-url');
const SUPPORT_LABEL = document.body.getAttribute('data-support-label') || 'Let us know';

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
// Building the form
// ---------------------------------------------------------------------------

function fieldView(name: string): FieldView {
  return view.get(Editor.refOf(name));
}

/** A dropdown for one setting. Option i stands for the field's option i. */
function buildSelect(field: FormField): HTMLSelectElement {
  const { ref, options } = fieldView(field.name);
  const select = el('select', { name: field.name, id: field.name, 'aria-label': field.name });
  for (const o of options) {
    const label = o.needsNewerFirmware ? `${o.label} †` : o.label;
    select.appendChild(el('option', { value: String(o.value), textContent: label, disabled: o.disabled }));
  }
  select.addEventListener('change', () => changeSetting(ref, select));
  selects.set(field.name, select);
  return select;
}

/** A section is a framed pane: title set into the border, table inside. */
function buildSection(section: FormSection): HTMLElement {
  const heading = el('h3', { className: 'info-panel__header', textContent: section.title });
  // A section with a single item (the globals) lists its settings as rows;
  // the others have one row per item and one column per setting.
  const table = section.count === 1 ? buildSettingsList(section) : buildItemTable(section);

  const block = el('section', { className: 'block info-panel', 'aria-label': section.title }, [heading]);
  block.appendChild(el('div', { className: 'scroll' }, [table]));
  return block;
}

/** One row per item (e.g. Gate.1 - Gate.12), one column per setting. */
function buildItemTable(section: FormSection): HTMLTableElement {
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
  return el('table', { className: 'grid' }, [el('thead', {}, [headerRow]), body]);
}

/** A single item's settings as rows: setting name | value. */
function buildSettingsList(section: FormSection): HTMLTableElement {
  const body = el('tbody');
  for (const column of section.columns) {
    const field = Form.field(Form.fieldName(section, 0, column));
    if (!field) continue;
    body.appendChild(el('tr', {}, [
      el('td', { className: 'row-label', title: column.title, textContent: column.header }),
      el('td', {}, [buildSelect(field)]),
    ]));
  }
  return el('table', { className: 'grid grid--settings' }, [body]);
}

/**
 * Notes below the settings, as a bulleted list: where to report a bug (if the
 * page names a place), the hover tip (hidden on touch screens, where there is
 * no hover) and the † firmware note (if any section has firmware-dependent
 * settings).
 */
function notesFooter(): HTMLElement {
  const link = (href: string, text: string) => el('a', { href, textContent: text, target: '_blank', rel: 'noopener' });
  const items: HTMLElement[] = [];
  if (SUPPORT_URL) items.push(el('li', { className: 'support' }, ['Found a bug? ', link(SUPPORT_URL, SUPPORT_LABEL)]));
  items.push(el('li', { className: 'tip', textContent: 'Tip: hover a setting name for a description' }));
  if (Form.SECTIONS.some((section) => section.firmwareNote)) {
    items.push(el('li', { className: 'firmware' }, [
      '† Some settings have specific firmware requirements. Make sure you have an ',
      link(FIRMWARE_URL, 'appropriate firmware version'),
      ' to use settings marked with the † symbol',
    ]));
  }
  return el('footer', { className: 'notes', 'aria-label': 'Notes' }, [el('ul', { className: 'notes__list' }, items)]);
}

// ---------------------------------------------------------------------------
// Showing the document
// ---------------------------------------------------------------------------

/** Make the page show `doc`. */
function render(): void {
  selects.forEach((select, name) => {
    const f = fieldView(name);
    select.value = String(f.value);
    select.disabled = !f.enabled;
  });
  const nameInput = byId<HTMLInputElement>('patch-name');
  if (nameInput.value !== doc.name) nameInput.value = doc.name;
  document.title = `${doc.modified ? '• ' : ''}${doc.name} - ${SITE_TITLE}`;
}

/** Replace the document and re-render if it changed. */
function update(next: PatchDocument): void {
  if (next === doc) return;
  if (next.patch !== doc.patch) view = Editor.view(next.patch);
  doc = next;
  render();
  remember();
}

// ---------------------------------------------------------------------------
// Keeping the patch across visits: after every change the open patch (and
// whether it came from a file) is saved in this browser's storage, and restored
// when the page opens again. Without storage (e.g. blocked) the page just
// starts with a new patch, as before.
// ---------------------------------------------------------------------------

const STORAGE_KEY = 'mutantbrain-surgery:open-patch';
let fromFile = false;

function remember(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ document: PatchDocument.serialize(doc), fromFile }));
  } catch { /* storage unavailable or full: keep working without it */ }
}

/** The patch saved by the last visit, or null (none, or unreadable: then it's dropped). */
function recall(): { document: PatchDocument; fromFile: boolean } | null {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return null;
    const data = JSON.parse(saved);
    return { document: PatchDocument.deserialize(data.document), fromFile: data.fromFile === true };
  } catch {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    return null;
  }
}

function showError(message: string | null): void {
  byId('load-error').hidden = !message;
  byId('load-error-detail').textContent = message ? `(${message})` : '';
}

/**
 * Whether the patch came from a file: "Patch loaded" with a teal pane and name
 * box, or "Load patch" for a new one. Clear All keeps it, New Patch ends it.
 */
function showLoaded(loaded: boolean): void {
  fromFile = loaded;
  remember();
  byId('patch-pane').classList.toggle('loader--loaded', loaded);
  byId('patch-title').textContent = loaded ? 'Patch Loaded' : 'Load Patch';
  byId('intro-empty').hidden = loaded;
  byId('intro-loaded').hidden = !loaded;
}

const errorText = (error: unknown) => (error instanceof Error ? error.message : String(error));

// ---------------------------------------------------------------------------
// User actions
// ---------------------------------------------------------------------------

function changeSetting(ref: FieldRef, select: HTMLSelectElement): void {
  const option = fieldView(select.name).options[select.selectedIndex];
  if (option) update(PatchDocument.setValue(doc, ref, option.value));
  render(); // also puts back a value the document did not take
}

/** Open SysEx bytes as the document. Returns true on success; a bad file leaves the document as it was. */
function openBytes(bytes: Uint8Array, fileName = ''): boolean {
  try {
    update(PatchDocument.open(fileName, bytes));
    showError(null);
    showLoaded(true);
    return true;
  } catch (error) {
    showError(errorText(error));
    return false;
  }
}

/** Choosing a file opens it straight away. */
function openChosenFile(): void {
  const input = byId<HTMLInputElement>('file');
  const file = input.files && input.files[0];
  if (!file) return; // picker cancelled
  const reader = new FileReader();
  reader.onload = () => openBytes(new Uint8Array(reader.result as ArrayBuffer), file.name);
  reader.onerror = () => showError('could not read the file');
  reader.readAsArrayBuffer(file);
  // Clear the picker so choosing the same file again (e.g. to undo edits) fires 'change' again.
  input.value = '';
}

/** A new patch: fresh settings and a new name, selected ready to type over. */
function newPatch(): void {
  update(PatchDocument.create());
  showError(null);
  showLoaded(false);
  editName();
}

/** Fresh settings, same name. */
function clearAll(): void {
  update(PatchDocument.clear(doc));
  showError(null);
}

// The name field reads as text until focused (clicking it, Tab, or the
// pencil button). Typing renames the patch; Enter or leaving the field
// finishes, Escape puts back the name it had before editing.
let nameBeforeEditing = doc.name;

function renamePatch(): void {
  update(PatchDocument.rename(doc, byId<HTMLInputElement>('patch-name').value));
}

function editName(): void {
  const nameInput = byId<HTMLInputElement>('patch-name');
  nameInput.focus();
  nameInput.select();
}

function nameKeys(event: KeyboardEvent): void {
  const nameInput = event.currentTarget as HTMLInputElement;
  if (event.key === 'Enter') {
    event.preventDefault(); // don't submit the form (download)
    nameInput.blur();
  } else if (event.key === 'Escape') {
    update(PatchDocument.rename(doc, nameBeforeEditing));
    nameInput.blur();
  }
}

/** "Generate SysEx": download the patch as <name>.syx. */
function savePatch(event: Event): void {
  event.preventDefault();
  try {
    const saved = PatchDocument.save(doc);
    const url = URL.createObjectURL(new Blob([saved.bytes], { type: 'application/octet-stream' }));
    const link = el('a', { href: url, download: saved.fileName });
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    update(saved.document);
    showError(null);
  } catch (error) {
    showError(errorText(error));
  }
}

/**
 * Time-limited notices: an element with data-expires="YYYY-MM-DD" starts out
 * hidden, and is shown only before that date (so it never flashes up after),
 * unless the visitor dismissed it with its .notice__close button. A dismissal
 * is remembered in this browser for that notice (keyed by its expiry date).
 */
const dismissedKey = (notice: HTMLElement) => `notice-dismissed:${notice.dataset.expires}`;

function isDismissed(notice: HTMLElement): boolean {
  try { return localStorage.getItem(dismissedKey(notice)) === '1'; } catch { return false; }
}

function showCurrentNotices(now = new Date()): void {
  document.querySelectorAll<HTMLElement>('[data-expires]').forEach((notice) => {
    const expires = new Date(`${notice.dataset.expires}T00:00:00`); // midnight, local time
    notice.hidden = !(now < expires) || isDismissed(notice); // an unreadable date hides it too
    notice.querySelector('.notice__close')?.addEventListener('click', () => {
      notice.hidden = true;
      try { localStorage.setItem(dismissedKey(notice), '1'); } catch { /* private mode: just this visit */ }
    });
  });
}

// ---------------------------------------------------------------------------
// Start up
// ---------------------------------------------------------------------------

showCurrentNotices();
const sectionsRoot = byId('sections');
for (const section of Form.SECTIONS) {
  const slot = document.getElementById(`slot-${section.key}`) || sectionsRoot;
  slot.appendChild(buildSection(section));
}
sectionsRoot.appendChild(notesFooter());
// carry on with the patch from the last visit, if any (before the first render, so nothing flickers)
const saved = recall();
if (saved) {
  doc = saved.document;
  view = Editor.view(doc.patch);
  showLoaded(saved.fromFile);
}
render();

byId('file').addEventListener('change', openChosenFile);
byId('open').addEventListener('keydown', (event) => {
  // The "Open Patch" label acts as a button: Enter or Space opens the file picker.
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    byId('file').click();
  }
});
byId('new').addEventListener('click', newPatch);
byId('reset').addEventListener('click', clearAll);
const nameField = byId<HTMLInputElement>('patch-name');
nameField.addEventListener('input', renamePatch);
nameField.addEventListener('focus', () => (nameBeforeEditing = doc.name));
nameField.addEventListener('keydown', nameKeys);
nameField.addEventListener('blur', () => nameField.setSelectionRange(0, 0)); // show the start of a long name
const renameButton = byId('rename');
renameButton.addEventListener('mousedown', (event) => event.preventDefault()); // keep focus (and edits) in the field
renameButton.addEventListener('click', editName);
byId('sysex').addEventListener('submit', savePatch);

/** Hooks for tests and the console. */
declare global {
  interface Window {
    MutantBrainApp: {
      /** The document being edited. */
      document(): PatchDocument;
      openBytes(bytes: Uint8Array, fileName?: string): boolean;
    };
  }
}
window.MutantBrainApp = { document: () => doc, openBytes };
