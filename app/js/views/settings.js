import { state, setState } from '../state.js';
import { toast } from '../toast.js';
import { initials, escapeHtml } from '../format.js';

function el(id) { return document.getElementById(id); }

let pendingTheme = 'dark';
let pendingJavaPath = null;
let pendingResolution = { width: 0, height: 0, fullscreen: false };
let pendingCloseOnLaunch = false;

function renderAccounts() {
  const wrap = el('settings-accounts');
  if (!state.accounts.length) {
    wrap.innerHTML = `<div class="empty-state" style="padding:24px 10px"><span class="material-symbols-outlined">person_off</span><p style="font-size:12.5px">No offline profiles yet.</p></div>`;
    return;
  }
  wrap.innerHTML = state.accounts.map((a) => `
    <div class="account-row">
      <div class="avatar">${initials(a.username)}</div>
      <div class="meta">
        <div class="name">${escapeHtml(a.username)}${a.id === state.activeAccount?.id ? ' <span class="badge badge-release" style="margin-left:6px">Active</span>' : ''}</div>
        <div class="uuid">${a.uuidDashless}</div>
      </div>
      ${a.id !== state.activeAccount?.id ? `<button class="btn btn-secondary settings-use-account" data-id="${a.id}" style="padding:7px 14px;font-size:12px">Use</button>` : ''}
      <button class="btn-danger-ghost settings-remove-account" data-id="${a.id}" title="Remove"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
    </div>`).join('');

  wrap.querySelectorAll('.settings-use-account').forEach((btn) => {
    btn.addEventListener('click', async () => {
      await window.api.accounts.setActive(btn.dataset.id);
      await refresh();
      toast('Active profile switched.', 'success');
    });
  });
  wrap.querySelectorAll('.settings-remove-account').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const acc = state.accounts.find((a) => a.id === btn.dataset.id);
      if (!confirm(`Remove offline profile "${acc?.username}"?`)) return;
      await window.api.accounts.remove(btn.dataset.id);
      await refresh();
    });
  });
}

async function handleAddAccount() {
  const input = el('settings-new-username');
  const username = input.value.trim();
  if (!username) return;
  try {
    await window.api.accounts.add(username);
    input.value = '';
    await refresh();
    toast(`Offline profile "${username}" created.`, 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

function ramLabel(mb) {
  return mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`;
}

function renderJavaEnv() {
  el('settings-java-path').value = state.config.javaPath || '';
  el('settings-java-path').placeholder = 'Auto-detected — Vertal will download one if needed';
  el('settings-jvm-args').value = state.config.jvmArgs || '';

  const ramSlider = el('settings-ram-slider');
  const baseMax = state.systemInfo ? Math.max(4096, Math.floor(state.systemInfo.totalMemMB * 0.9 / 512) * 512) : 16384;
  // Never let the slider's max be lower than whatever is already configured
  // (e.g. a config copied over from a machine with more RAM) — extend the
  // range instead of silently clamping the thumb away from the real value.
  const maxRam = Math.max(baseMax, state.config.ramMB);
  ramSlider.max = String(maxRam);
  ramSlider.min = '256';
  ramSlider.step = '256';
  ramSlider.value = String(state.config.ramMB);
  el('settings-ram-readout').innerHTML = `<b>${ramLabel(state.config.ramMB)}</b> allocated`;
  el('settings-ram-max-label').textContent = ramLabel(maxRam);
  updateRamWarn();
}

function updateRamWarn() {
  const mb = parseInt(el('settings-ram-slider').value, 10) || 0;
  const warn = el('settings-ram-warn');
  warn.classList.toggle('hidden', mb >= 2048);
  warn.textContent = mb < 2048
    ? 'Below 2 GB loading will be very slow — 2 GB or more is recommended.'
    : '';
}

function renderTheme() {
  pendingTheme = state.config.theme || 'dark';
  document.querySelectorAll('.theme-opt').forEach((opt) => opt.classList.toggle('selected', opt.dataset.theme === pendingTheme));
}

function renderDisplay() {
  const res = state.config.resolution || { width: 0, height: 0, fullscreen: false };
  pendingResolution = { width: res.width || 0, height: res.height || 0, fullscreen: !!res.fullscreen };
  pendingCloseOnLaunch = !!state.config.closeOnLaunch;
  el('settings-fullscreen-checkbox').checked = pendingResolution.fullscreen;
  el('settings-res-width').value = pendingResolution.width || '';
  el('settings-res-height').value = pendingResolution.height || '';
  el('settings-close-on-launch').checked = pendingCloseOnLaunch;
  el('settings-res-width').disabled = pendingResolution.fullscreen;
  el('settings-res-height').disabled = pendingResolution.fullscreen;
}

async function refresh() {
  const [accounts, activeAccount, config, systemInfo] = await Promise.all([
    window.api.accounts.list(),
    window.api.accounts.getActive(),
    window.api.config.get(),
    window.api.config.systemInfo(),
  ]);
  setState({ accounts, activeAccount, config, systemInfo });
  renderAccounts();
  renderJavaEnv();
  renderTheme();
  renderDisplay();
  pendingJavaPath = config.javaPath;
}

async function handleSave() {
  const ramMB = parseInt(el('settings-ram-slider').value, 10);
  const jvmArgs = el('settings-jvm-args').value.trim();
  const resolution = {
    width: parseInt(el('settings-res-width').value, 10) || 0,
    height: parseInt(el('settings-res-height').value, 10) || 0,
    fullscreen: el('settings-fullscreen-checkbox').checked,
  };
  const closeOnLaunch = el('settings-close-on-launch').checked;
  const savedResolution = resolution.width || resolution.height || resolution.fullscreen ? resolution : null;
  try {
    await window.api.config.set({
      ramMB, jvmArgs, javaPath: pendingJavaPath, theme: pendingTheme,
      resolution: savedResolution, closeOnLaunch,
    });
    setState({
      config: {
        ...state.config, ramMB, jvmArgs, javaPath: pendingJavaPath, theme: pendingTheme,
        resolution: savedResolution, closeOnLaunch,
      },
    });
    applyTheme(pendingTheme);
    toast('Settings saved.', 'success');
  } catch (e) {
    toast(e.message, 'error');
  }
}

export function applyTheme(theme) {
  document.body.classList.toggle('theme-light', theme === 'light');
}

export function initSettingsView() {
  el('settings-add-account-btn').addEventListener('click', handleAddAccount);
  el('settings-new-username').addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAddAccount(); });

  el('settings-ram-slider').addEventListener('input', (e) => {
    el('settings-ram-readout').innerHTML = `<b>${ramLabel(parseInt(e.target.value, 10))}</b> allocated`;
    updateRamWarn();
  });

  el('settings-browse-java').addEventListener('click', async () => {
    const path = await window.api.dialog.selectJava();
    if (!path) return;
    const ok = await window.api.java.verify(path);
    if (!ok) { toast('That file does not look like a working Java executable.', 'error'); return; }
    pendingJavaPath = path;
    el('settings-java-path').value = path;
  });
  el('settings-clear-java').addEventListener('click', () => {
    pendingJavaPath = null;
    el('settings-java-path').value = '';
  });

  document.querySelectorAll('.theme-opt').forEach((opt) => {
    opt.addEventListener('click', () => {
      pendingTheme = opt.dataset.theme;
      document.querySelectorAll('.theme-opt').forEach((o) => o.classList.toggle('selected', o === opt));
    });
  });

  el('settings-save-btn').addEventListener('click', handleSave);

  el('settings-open-data-folder').addEventListener('click', async () => {
    const dir = await window.api.app.getUserDataPath();
    window.api.app.openPath(dir);
  });

  el('settings-fullscreen-checkbox').addEventListener('change', (e) => {
    pendingResolution.fullscreen = e.target.checked;
    el('settings-res-width').disabled = e.target.checked;
    el('settings-res-height').disabled = e.target.checked;
  });
  el('settings-res-width').addEventListener('input', (e) => { pendingResolution.width = parseInt(e.target.value, 10) || 0; });
  el('settings-res-height').addEventListener('input', (e) => { pendingResolution.height = parseInt(e.target.value, 10) || 0; });
  el('settings-close-on-launch').addEventListener('change', (e) => { pendingCloseOnLaunch = e.target.checked; });
}

export function enterSettingsView() {
  refresh().catch((e) => toast(e.message, 'error'));
}
