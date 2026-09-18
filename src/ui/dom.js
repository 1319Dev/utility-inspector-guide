export function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

export function todayISO() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function fmtWhen(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function optionList(items, selected) {
  return items
    .map((it) => {
      const id = it.id ?? it;
      const label = it.label ?? it;
      const sel = id === selected ? ' selected' : '';
      return `<option value="${esc(id)}"${sel}>${esc(label)}</option>`;
    })
    .join('');
}

export function fileFromInput(input) {
  return input?.files?.[0] || null;
}

export function stickySave(id, label = 'Save') {
  return `
    <div class="sticky-save">
      <button type="button" class="primary-btn" id="${esc(id)}">${esc(label)}</button>
      <p class="muted sticky-save-status" id="${esc(id)}-status" role="status"></p>
    </div>`;
}

export function complianceNote() {
  return `<p class="compliance-note" role="note">Always follow the operator SOW, approved procedures, and applicable regulation.</p>`;
}

export function statusPill(status, label) {
  const color =
    status === 'qualified' || status === 'ok' || status === 'ready'
      ? 'green'
      : status === 'expiring_soon' || status === 'warn'
        ? 'yellow'
        : status === 'unable_to_verify' || status === 'idle'
          ? 'gray'
          : 'red';
  return `<span class="status-pill status-${color}">${esc(label)}</span>`;
}

export async function pickAndAttach(input, { recordId, collection, putAttachment }) {
  const file = fileFromInput(input);
  if (!file) return null;
  const row = await putAttachment({
    recordId,
    collection,
    name: file.name,
    mime: file.type,
    blob: file,
  });
  input.value = '';
  return row;
}
