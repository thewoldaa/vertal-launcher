import { state, setState } from '../state.js';
import { toast } from '../toast.js';
import { loaderLabel, formatRelativeTime, escapeHtml } from '../format.js';
import { openInstanceModal } from './instanceModal.js';
import { runInstall } from '../installOverlay.js';
import { playInstance, stopInstance } from '../play.js';

let activeFilter = 'all';
let searchQuery = '';

function el(id) { return document.getElementById(id); }

function badgeClassFor(instance) {
  if (instance.loader !== 'vanilla') return `badge-${instance.loader}`;
  return instance.versionType === 'snapshot' ? 'badge-snapshot' : 'badge-release';
}

function matchesFilter(instance) {
  if (activeFilter === 'installed' && !instance.installed) return false;
  if (activeFilter === 'modded' && instance.loader === 'vanilla') return false;
  if (activeFilter === 'vanilla' && instance.loader !== 'vanilla') return false;
  if (searchQuery && !`${instance.name} ${instance.mcVersion}`.toLowerCase().includes(searchQuery.toLowerCase())) return false;
  return true;
}

function cardHtml(instance) {
  const badge = badgeClassFor(instance);
  const loaderTxt = instance.loader === 'vanilla'
    ? (instance.versionType === 'snapshot' ? 'Snapshot' : 'Release')
    : `${loaderLabel(instance.loader)}${instance.loaderVersion && instance.loaderVersion !== 'latest' ? ' ' + instance.loaderVersion : ''}`;

  const actions = instance.installed
    ? `<button class="btn btn-primary vc-play" data-id="${instance.id}"><span class="material-symbols-outlined" style="font-size:16px">play_arrow</span>Play</button>
       <button class="btn-danger-ghost vc-edit" data-id="${instance.id}" title="Edit"><span class="material-symbols-outlined" style="font-size:17px">edit</span></button>
       <button class="btn-danger-ghost vc-delete" data-id="${instance.id}" title="Delete"><span class="material-symbols-outlined" style="font-size:17px">delete</span></button>`
    : `<button class="btn btn-primary vc-install" data-id="${instance.id}"><span class="material-symbols-outlined" style="font-size:16px">download</span>Install</button>
       <button class="btn-danger-ghost vc-edit" data-id="${instance.id}" title="Edit"><span class="material-symbols-outlined" style="font-size:17px">edit</span></button>
       <button class="btn-danger-ghost vc-delete" data-id="${instance.id}" title="Delete"><span class="material-symbols-outlined" style="font-size:17px">delete</span></button>`;

  return `
    <div class="version-card fade-in" data-id="${instance.id}">
      <div class="vc-body">
        <div class="vc-top">
          <span class="badge ${badge}">${escapeHtml(loaderTxt)}</span>
        </div>
        <h3>${escapeHtml(instance.name)}</h3>
        <p class="vc-sub">${escapeHtml(instance.mcVersion)} · ${instance.installed ? `Played ${formatRelativeTime(instance.lastPlayedAt)}` : 'Not installed'}</p>
        <div class="vc-progress hidden">
          <div class="progress-track"><div class="progress-fill shimmer-bar" style="width:20%"></div></div>
          <div class="vc-progress-meta"><span class="vc-progress-phase">Preparing…</span><span class="vc-progress-pct"></span></div>
        </div>
        <div class="vc-actions">${actions}</div>
      </div>
    </div>`;
}

function addCardHtml() {
  return `
    <div class="version-card-add clickable" id="vc-add">
      <span class="material-symbols-outlined">add_circle</span>
      <span>New Installation</span>
    </div>`;
}

async function refresh() {
  const list = await window.api.instances.list();
  setState({ instances: list });
  render();
}

function render() {
  const grid = el('version-grid');
  const filtered = state.instances.filter(matchesFilter);
  grid.innerHTML = filtered.map(cardHtml).join('') + addCardHtml();
  wireCardEvents();
}

function setCardBusy(instanceId, phase, pct, indeterminate) {
  const card = document.querySelector(`.version-card[data-id="${instanceId}"]`);
  if (!card) return;
  card.querySelector('.vc-progress').classList.remove('hidden');
  card.querySelector('.vc-actions').classList.add('hidden');
  card.querySelector('.vc-progress-phase').textContent = phase || 'Working…';
  card.querySelector('.vc-progress-pct').textContent = indeterminate ? '' : `${Math.round(pct || 0)}%`;
  const fill = card.querySelector('.progress-fill');
  fill.style.width = indeterminate ? '30%' : `${Math.min(100, pct || 0)}%`;
  fill.classList.toggle('shimmer-bar', !!indeterminate);
}

function wireCardEvents() {
  el('vc-add')?.addEventListener('click', () => openInstanceModal(refresh));

  document.querySelectorAll('.vc-install').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (btn.dataset.busy === '1') return; // re-entry guard — one install at a time
      btn.dataset.busy = '1';
      btn.disabled = true;
      const instance = state.instances.find((i) => i.id === id);
      try {
        await window.api.install.start(id).then(({ requestId }) => new Promise((resolve, reject) => {
          const off = window.api.install.onEvent((evt) => {
            if (evt.requestId !== requestId) return;
            if (evt.type === 'progress') setCardBusy(id, evt.phase, evt.pct, evt.indeterminate);
            else if (evt.type === 'done') { off(); resolve(); }
            else if (evt.type === 'error') { off(); reject(new Error(evt.message)); }
          });
        }));
        toast(`"${instance?.name || 'Installation'}" is ready to play.`, 'success');
      } catch (e) {
        toast(`Install failed: ${e.message}`, 'error');
      } finally {
        btn.dataset.busy = '';
        btn.disabled = false;
      }
      refresh();
    });
  });

  document.querySelectorAll('.vc-play').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const card = document.querySelector(`.version-card[data-id="${id}"]`);
      const playBtn = card.querySelector('.vc-play');
      await playInstance(id, (status, detail) => {
        if (status === 'launching') {
          playBtn.disabled = true;
          playBtn.innerHTML = `<span class="material-symbols-outlined spin" style="font-size:16px">progress_activity</span>Starting…`;
        } else if (status === 'installing') {
          setCardBusy(id, detail?.phase, detail?.pct, detail?.indeterminate);
        } else if (status === 'running') {
          card.querySelector('.vc-progress')?.classList.add('hidden');
          card.querySelector('.vc-actions')?.classList.remove('hidden');
          playBtn.disabled = false;
          playBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">sports_esports</span>Running`;
          // Stop button while the game is running.
          let stopBtn = card.querySelector('.vc-stop');
          if (!stopBtn) {
            stopBtn = document.createElement('button');
            stopBtn.className = 'btn-danger-ghost vc-stop';
            stopBtn.dataset.id = id;
            stopBtn.title = 'Force stop';
            stopBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:17px">stop</span>`;
            stopBtn.addEventListener('click', async () => {
              try { await window.api.launch.kill(id); toast('Stopped.', 'info'); refresh(); }
              catch (e) { toast(e.message, 'error'); }
            });
            card.querySelector('.vc-actions').appendChild(stopBtn);
          }
        } else if (status === 'idle' || status === 'error') {
          card.querySelector('.vc-progress')?.classList.add('hidden');
          card.querySelector('.vc-actions')?.classList.remove('hidden');
          card.querySelector('.vc-stop')?.remove();
          playBtn.disabled = false;
          playBtn.innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">play_arrow</span>Play`;
          refresh();
        }
      });
    });
  });

  document.querySelectorAll('.vc-edit').forEach((btn) => {
    btn.addEventListener('click', () => {
      const instance = state.instances.find((i) => i.id === btn.dataset.id);
      if (instance) openInstanceModal(refresh, instance);
    });
  });

  document.querySelectorAll('.vc-delete').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      const instance = state.instances.find((i) => i.id === id);
      if (!confirm(`Delete "${instance?.name}"? This removes its saves, mods and settings.`)) return;
      await window.api.instances.delete(id);
      toast(`"${instance?.name}" deleted.`, 'success');
      refresh();
    });
  });
}

export function initVersionsView() {
  document.querySelectorAll('#versions-filters .chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      activeFilter = chip.dataset.filter;
      document.querySelectorAll('#versions-filters .chip').forEach((c) => c.classList.toggle('active', c === chip));
      render();
    });
  });

  el('topbar-search').addEventListener('input', (e) => {
    if (state.currentView !== 'versions') return;
    searchQuery = e.target.value;
    render();
  });
}

export function enterVersionsView() {
  refresh();
}
