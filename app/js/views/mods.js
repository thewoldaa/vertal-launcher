import { state, setState } from '../state.js';
import { toast } from '../toast.js';
import { formatBytes, escapeHtml, loaderLabel } from '../format.js';

let selectedInstanceId = null;

function el(id) { return document.getElementById(id); }

function populateInstanceSelect() {
  const select = el('mods-instance-select');
  if (!state.instances.length) {
    select.innerHTML = `<option value="">No installations yet</option>`;
    select.disabled = true;
    return;
  }
  select.disabled = false;
  if (!selectedInstanceId || !state.instances.some((i) => i.id === selectedInstanceId)) {
    selectedInstanceId = (state.instances.find((i) => i.loader !== 'vanilla') || state.instances[0]).id;
  }
  select.innerHTML = state.instances.map((i) => `<option value="${i.id}" ${i.id === selectedInstanceId ? 'selected' : ''}>${escapeHtml(i.name)} (${loaderLabel(i.loader)})</option>`).join('');
}

async function renderModsList() {
  const listEl = el('mods-list');
  const noticeEl = el('mods-vanilla-notice');
  const instance = state.instances.find((i) => i.id === selectedInstanceId);
  if (!instance) {
    listEl.innerHTML = '';
    noticeEl.classList.add('hidden');
    return;
  }

  noticeEl.classList.toggle('hidden', instance.loader !== 'vanilla');

  try {
    const mods = await window.api.mods.list(instance.id);
    if (!mods.length) {
      listEl.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">extension_off</span><p>No mods in this installation's mods folder yet.<br>Drop .jar files in with "Add Mods".</p></div>`;
      return;
    }
    listEl.innerHTML = mods.map((m) => `
      <div class="mod-row ${m.enabled ? '' : 'disabled'}" data-file="${escapeHtml(m.fileName)}">
        <div class="mod-icon"><span class="material-symbols-outlined">deployed_code</span></div>
        <div class="meta">
          <div class="name">${escapeHtml(m.displayName)}</div>
          <div class="size">${formatBytes(m.sizeBytes)}</div>
        </div>
        <div class="switch ${m.enabled ? 'on' : ''}" data-file="${escapeHtml(m.fileName)}" title="${m.enabled ? 'Disable' : 'Enable'}"></div>
        <button class="btn-icon mods-remove-btn" data-file="${escapeHtml(m.fileName)}" title="Delete"><span class="material-symbols-outlined" style="font-size:18px">delete</span></button>
      </div>`).join('');

    listEl.querySelectorAll('.switch').forEach((sw) => {
      sw.addEventListener('click', async () => {
        const enabled = !sw.classList.contains('on');
        try {
          await window.api.mods.toggle(instance.id, sw.dataset.file, enabled);
          renderModsList();
        } catch (e) { toast(e.message, 'error'); }
      });
    });
    listEl.querySelectorAll('.mods-remove-btn').forEach((btn) => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this mod file?')) return;
        await window.api.mods.remove(instance.id, btn.dataset.file);
        renderModsList();
      });
    });
  } catch (e) {
    listEl.innerHTML = `<div class="empty-state"><span class="material-symbols-outlined">error</span><p>${escapeHtml(e.message)}</p></div>`;
  }
}

export function initModsView() {
  el('mods-instance-select').addEventListener('change', (e) => {
    selectedInstanceId = e.target.value;
    renderModsList();
  });

  el('mods-add-btn').addEventListener('click', async () => {
    if (!selectedInstanceId) return;
    const added = await window.api.mods.addViaDialog(selectedInstanceId);
    if (added.length) toast(`Added ${added.length} mod${added.length > 1 ? 's' : ''}.`, 'success');
    renderModsList();
  });

  el('mods-open-folder-btn').addEventListener('click', () => {
    if (!selectedInstanceId) return;
    window.api.mods.openFolder(selectedInstanceId);
  });
}

export async function enterModsView() {
  const instances = await window.api.instances.list();
  setState({ instances });
  populateInstanceSelect();
  renderModsList();
}
