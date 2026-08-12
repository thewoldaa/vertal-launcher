import { setState } from '../state.js';
import { toast } from '../toast.js';
import { formatBytes, initials, escapeHtml } from '../format.js';
import { applyTheme } from './settings.js';

const STEPS = ['language', 'license', 'profile', 'path', 'install'];
let stepIndex = 0;
let selectedLanguage = 'en';
let agreed = false;
let chosenDataPath = null;
let installStarted = false;

function el(id) { return document.getElementById(id); }

function showStep(i) {
  stepIndex = i;
  const stepId = STEPS[i];
  document.querySelectorAll('.wz-panel').forEach((p) => p.classList.add('hidden'));
  el(`wz-panel-${stepId}`).classList.remove('hidden');

  document.querySelectorAll('.wizard-nav .wz-step').forEach((navEl) => {
    const idx = STEPS.indexOf(navEl.dataset.step);
    navEl.classList.toggle('active', idx === i);
    navEl.classList.toggle('done', idx < i);
  });

  const footer = el('wizard-footer');
  footer.classList.toggle('hidden', stepId === 'install');
  el('wizard-back-btn').disabled = i === 0;
  el('wizard-next-btn').textContent = stepId === 'path' ? 'Install' : 'Next';

  if (stepId === 'install' && !installStarted) startInstall();
}

function canProceedFrom(stepId) {
  if (stepId === 'language') return true;
  if (stepId === 'license') return agreed;
  if (stepId === 'profile') return true; // profiles are optional — add them any time from Settings
  if (stepId === 'path') return !!chosenDataPath;
  return true;
}

function next() {
  const stepId = STEPS[stepIndex];
  if (!canProceedFrom(stepId)) {
    if (stepId === 'license') toast('Please accept the terms to continue.', 'error');
    if (stepId === 'path') toast('Choose where Vertal should store game files.', 'error');
    return;
  }
  if (stepIndex < STEPS.length - 1) showStep(stepIndex + 1);
}

function back() {
  if (stepIndex > 0) showStep(stepIndex - 1);
}

// ---------------- Step: Language ----------------
function initLanguageStep() {
  document.querySelectorAll('.lang-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedLanguage = card.dataset.lang;
      document.querySelectorAll('.lang-card').forEach((c) => c.classList.toggle('selected', c === card));
    });
  });
}

// ---------------- Step: License ----------------
function initLicenseStep() {
  const row = el('wz-agree-row');
  const checkbox = el('wz-agree-checkbox');
  row.addEventListener('click', (e) => {
    if (e.target !== checkbox) checkbox.checked = !checkbox.checked;
    agreed = checkbox.checked;
    row.classList.toggle('checked', agreed);
  });
}

// ---------------- Step: Profile ----------------
async function refreshAccountsUI() {
  const accounts = await window.api.accounts.list();
  setState({ accounts });
  const listEl = el('wz-account-list');
  if (!accounts.length) {
    listEl.innerHTML = `<div class="empty-state" style="padding:20px 10px"><span class="material-symbols-outlined">person_add</span><p style="font-size:12.5px">Add a username above to create your first offline profile.</p></div>`;
    return;
  }
  listEl.innerHTML = accounts.map((a) => `
    <div class="account-row">
      <div class="avatar">${initials(a.username)}</div>
      <div class="meta"><div class="name">${escapeHtml(a.username)}</div><div class="uuid">${a.uuidDashless}</div></div>
      <button class="btn-danger-ghost wz-remove-account" data-id="${a.id}"><span class="material-symbols-outlined" style="font-size:16px">delete</span></button>
    </div>`).join('');
  listEl.querySelectorAll('.wz-remove-account').forEach((btn) => {
    btn.addEventListener('click', async () => { await window.api.accounts.remove(btn.dataset.id); refreshAccountsUI(); });
  });
}

function initProfileStep() {
  const addBtn = el('wz-add-account-btn');
  const input = el('wz-username-input');
  const handleAdd = async () => {
    const username = input.value.trim();
    if (!username) return;
    try {
      await window.api.accounts.add(username);
      input.value = '';
      await refreshAccountsUI();
    } catch (e) { toast(e.message, 'error'); }
  };
  addBtn.addEventListener('click', handleAdd);
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') handleAdd(); });
}

// ---------------- Step: Path ----------------
async function refreshPathUI() {
  el('wz-path-display').value = chosenDataPath;
  const space = await window.api.wizard.diskSpace(chosenDataPath);
  el('wz-space-free').textContent = space.freeBytes != null ? formatBytes(space.freeBytes) : 'Unknown';
  el('wz-space-note').textContent = 'A vanilla install needs ~1 GB; modded installs and multiple versions need more.';
}

function initPathStep() {
  el('wz-browse-path-btn').addEventListener('click', async () => {
    const picked = await window.api.wizard.selectDataPath();
    if (!picked) return;
    chosenDataPath = picked;
    refreshPathUI();
  });
}

// ---------------- Step: Install ----------------
function setInstallUI({ phase, pct, indeterminate, error, done }) {
  el('wz-install-phase').textContent = phase || '';
  el('wz-install-pct').textContent = indeterminate || done ? '' : `${Math.round(pct || 0)}%`;
  const fill = el('wz-install-fill');
  fill.style.width = done ? '100%' : indeterminate ? '30%' : `${Math.min(100, pct || 0)}%`;
  fill.classList.toggle('shimmer-bar', !!indeterminate && !done);
  el('wz-install-error').style.display = error ? 'block' : 'none';
  el('wz-install-error').textContent = error || '';
  el('wz-enter-app-btn').classList.toggle('hidden', !done);
  el('wz-install-icon').querySelector('.material-symbols-outlined').textContent = error ? 'error' : done ? 'check_circle' : 'downloading';
}

async function startInstall() {
  installStarted = true;
  setInstallUI({ phase: 'Setting up your data folder…', indeterminate: true });

  try {
    await window.api.wizard.setDataRoot(chosenDataPath);
    await window.api.config.set({ language: selectedLanguage });

    setInstallUI({ phase: 'Fetching the latest release…', indeterminate: true });
    const manifest = await window.api.mojang.listVersions();
    const latest = manifest.latest.release;

    const instance = await window.api.instances.create({
      name: `Minecraft ${latest}`,
      mcVersion: latest,
      versionType: 'release',
      loader: 'vanilla',
      separateFolder: false,
    });

    const { requestId } = await window.api.install.start(instance.id);
    await new Promise((resolve, reject) => {
      const off = window.api.install.onEvent((evt) => {
        if (evt.requestId !== requestId) return;
        if (evt.type === 'progress') setInstallUI(evt);
        else if (evt.type === 'done') { off(); resolve(); }
        else if (evt.type === 'error') { off(); reject(new Error(evt.message)); }
      });
    });

    await window.api.instances.setActive(instance.id);
    setInstallUI({ phase: `Minecraft ${latest} is ready.`, done: true });
  } catch (e) {
    setInstallUI({ phase: 'Setup failed', error: e.message });
  }
}

function finishWizard(onComplete) {
  window.api.wizard.complete().then(() => {
    applyTheme('dark');
    el('screen-wizard').classList.add('hidden');
    onComplete && onComplete();
  });
}

export function initWizard(onComplete) {
  initLanguageStep();
  initLicenseStep();
  initProfileStep();
  initPathStep();

  el('wizard-next-btn').addEventListener('click', next);
  el('wizard-back-btn').addEventListener('click', back);
  el('wz-enter-app-btn').addEventListener('click', () => finishWizard(onComplete));

  document.querySelectorAll('.wizard-nav .wz-step').forEach((navEl) => {
    navEl.addEventListener('click', () => {
      const idx = STEPS.indexOf(navEl.dataset.step);
      if (idx < stepIndex) showStep(idx); // allow revisiting completed steps only
    });
  });
}

export async function startWizard() {
  stepIndex = 0;
  installStarted = false;
  chosenDataPath = await window.api.wizard.getDefaultDataPath();
  el('wz-path-display').value = chosenDataPath;
  refreshPathUI();
  await refreshAccountsUI();
  el('screen-wizard').classList.remove('hidden');
  showStep(0);
}
