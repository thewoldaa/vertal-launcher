import { state, setState } from '../state.js';
import { toast } from '../toast.js';
import { escapeHtml, loaderLabel, formatRelativeTime } from '../format.js';
import { playInstance } from '../play.js';

let editingServerId = null;

function el(id) { return document.getElementById(id); }

function activeInstance() {
  return state.instances.find((i) => i.id === state.config?.activeInstanceId) || state.instances[0] || null;
}

function instanceName(id) {
  const inst = state.instances.find((i) => i.id === id);
  return inst ? inst.name : null;
}

function serverAddressText(s) {
  return s.port === 25565 ? s.address : `${s.address}:${s.port}`;
}

function renderInstanceChip() {
  const inst = activeInstance();
  el('servers-instance-chip').textContent = inst
    ? `Launching with: ${inst.name} (${inst.mcVersion}${inst.loader !== 'vanilla' ? ' ' + loaderLabel(inst.loader) : ''})`
    : 'Launching with: no installation yet — create one in Versions';
  el('servers-instance-chip').classList.toggle('danger-chip', !inst);
}

function renderGrid() {
  const grid = el('servers-grid');
  if (!state.servers.length) {
    grid.innerHTML = `
      <div class="empty-state" style="grid-column:1/-1">
        <span class="material-symbols-outlined">dns</span>
        <p>No servers saved yet.<br>Add an offline-mode server (your SMP, a friend's LAN world, a cracked server…) and jump straight in with one click.</p>
      </div>`;
    return;
  }
  grid.innerHTML = state.servers.map((s) => {
    const instName = s.instanceId ? instanceName(s.instanceId) : null;
    const instLabel = instName
      ? `with ${escapeHtml(instName)}`
      : (activeInstance() ? `with active (${escapeHtml(activeInstance().name)})` : 'no installation');
    return `
    <div class="server-card fade-in" data-id="${s.id}">
      <div class="sc-top">
        <div class="server-avatar"><span class="material-symbols-outlined">dns</span></div>
        <div class="grow" style="min-width:0">
          <h3>${escapeHtml(s.name)}</h3>
          <div class="server-addr mono">${escapeHtml(serverAddressText(s))}</div>
        </div>
        <div class="row" style="gap:6px">
          <button class="btn-icon server-edit-btn" data-id="${s.id}" title="Edit"><span class="material-symbols-outlined" style="font-size:17px">edit</span></button>
          <button class="btn-icon server-del-btn" data-id="${s.id}" title="Delete"><span class="material-symbols-outlined" style="font-size:17px">delete</span></button>
        </div>
      </div>
      <div class="sc-meta">
        <span class="chip" style="font-size:10px">${escapeHtml(instLabel)}</span>
        ${s.playCount ? `<span class="text-dim" style="font-size:11px">Played ${s.playCount}× · ${formatRelativeTime(s.lastPlayedAt)}</span>` : '<span class="text-dim" style="font-size:11px">Never played</span>'}
      </div>
      <button class="btn btn-primary server-play-btn" data-id="${s.id}"><span class="material-symbols-outlined" style="font-size:16px">play_arrow</span>Join Server</button>
    </div>`;
  }).join('');
  wireGridEvents();
}

function wireGridEvents() {
  document.querySelectorAll('.server-play-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const server = state.servers.find((s) => s.id === btn.dataset.id);
      if (!server) return;
      const inst = (server.instanceId && state.instances.find((i) => i.id === server.instanceId)) || activeInstance();
      if (!inst) {
        toast('Create an installation first — Vertal needs one to launch the game.', 'error');
        return;
      }
      const instForLaunch = inst;
      await playInstance(instForLaunch.id, (status, detail) => {
        if (status === 'launching') {
          btn.disabled = true;
          btn.innerHTML = `<span class="material-symbols-outlined spin" style="font-size:16px">progress_activity</span>Starting…`;
        } else if (status === 'installing') {
          btn.disabled = true;
          btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">download</span>${detail?.phase ? escapeHtml(detail.phase) : 'Installing…'}`;
        } else if (status === 'running') {
          btn.disabled = false;
          btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">sports_esports</span>In game`;
          refresh();
        } else if (status === 'idle') {
          btn.disabled = false;
          btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">play_arrow</span>Join Server`;
          refresh();
        } else if (status === 'error') {
          btn.disabled = false;
          btn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">play_arrow</span>Join Server`;
          refresh();
        }
      }, { server: server.id });
    });
  });

  document.querySelectorAll('.server-edit-btn').forEach((btn) => {
    btn.addEventListener('click', () => openServerModal(state.servers.find((s) => s.id === btn.dataset.id)));
  });

  document.querySelectorAll('.server-del-btn').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const server = state.servers.find((s) => s.id === btn.dataset.id);
      if (!confirm(`Delete server "${server?.name}"?`)) return;
      await window.api.servers.remove(btn.dataset.id);
      toast(`Server "${server?.name}" deleted.`, 'success');
      refresh();
    });
  });
}

function populateInstanceSelect(selectedId) {
  const select = el('server-modal-instance');
  const active = activeInstance();
  const opts = state.instances.map((i) =>
    `<option value="${i.id}" ${selectedId === i.id ? 'selected' : ''}>${escapeHtml(i.name)} (${escapeHtml(i.mcVersion)} ${loaderLabel(i.loader)})</option>`);
  select.innerHTML = [
    `<option value="" ${!selectedId ? 'selected' : ''}>Active installation (${active ? escapeHtml(active.name) : 'none yet'})</option>`,
    ...opts,
  ].join('');
  select.disabled = !state.instances.length;
}

export function openServerModal(server) {
  editingServerId = server ? server.id : null;
  el('server-modal-title').textContent = server ? 'Edit Server' : 'Add Server';
  el('server-modal-name').value = server ? server.name : '';
  el('server-modal-address').value = server ? serverAddressText(server) : '';
  populateInstanceSelect(server ? server.instanceId : null);
  el('server-modal-overlay').classList.remove('hidden');
  setTimeout(() => el('server-modal-address').focus(), 50);
}

function closeServerModal() {
  el('server-modal-overlay').classList.add('hidden');
  editingServerId = null;
}

async function handleSave() {
  const name = el('server-modal-name').value.trim();
  const address = el('server-modal-address').value.trim();
  const instanceId = el('server-modal-instance').value || null;
  if (!address) { toast('Server address is required.', 'error'); return; }
  try {
    if (editingServerId) {
      await window.api.servers.update(editingServerId, { name, address, instanceId });
      toast('Server updated.', 'success');
    } else {
      await window.api.servers.add({ name, address, instanceId });
      toast('Server added.', 'success');
    }
    closeServerModal();
    refresh();
  } catch (e) {
    toast(e.message, 'error');
  }
}

async function refresh() {
  const [servers, instances, config] = await Promise.all([
    window.api.servers.list(),
    window.api.instances.list(),
    window.api.config.get(),
  ]);
  setState({ servers, instances, config });
  renderInstanceChip();
  renderGrid();
}

export function initServersView() {
  el('servers-add-btn').addEventListener('click', () => openServerModal(null));
  el('server-modal-close-btn').addEventListener('click', closeServerModal);
  el('server-modal-cancel-btn').addEventListener('click', closeServerModal);
  el('server-modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'server-modal-overlay') closeServerModal(); });
  el('server-modal-save-btn').addEventListener('click', handleSave);
  el('server-modal-address').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleSave(); });
}

export function enterServersView() {
  refresh().catch((e) => toast(e.message, 'error'));
}