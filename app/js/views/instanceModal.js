import { state, setState } from '../state.js';
import { toast } from '../toast.js';
import { runInstall } from '../installOverlay.js';
import { escapeHtml, loaderLabel } from '../format.js';

let onCreatedCallback = null;
let selectedLoader = 'vanilla';
let showSnapshots = false;
let editingInstance = null; // instance object when editing, null when creating

function el(id) { return document.getElementById(id); }

async function ensureManifest() {
  if (state.mojangManifest) return state.mojangManifest;
  const manifest = await window.api.mojang.listVersions();
  setState({ mojangManifest: manifest });
  return manifest;
}

function populateVersionSelect() {
  const manifest = state.mojangManifest;
  const select = el('modal-mc-version');
  const list = manifest.versions.filter((v) => (showSnapshots ? true : v.type === 'release'));
  select.innerHTML = list.map((v) => `<option value="${v.id}" data-type="${v.type}">${v.id}${v.id === manifest.latest.release ? '  (latest release)' : ''}</option>`).join('');
}

async function populateLoaderVersionSelect() {
  const mcVersion = el('modal-mc-version').value;
  const wrap = el('modal-loader-version-wrap');
  const select = el('modal-loader-version');

  if (selectedLoader === 'vanilla') {
    wrap.classList.add('hidden');
    return;
  }
  wrap.classList.remove('hidden');
  select.innerHTML = `<option value="latest">Loading…</option>`;
  select.disabled = true;
  try {
    if (selectedLoader === 'fabric' || selectedLoader === 'quilt') {
      const list = await window.api.loader.listFabricQuilt(selectedLoader, mcVersion);
      if (!list.length) {
        select.innerHTML = `<option value="latest">No builds available</option>`;
      } else {
        select.innerHTML = [`<option value="latest">Latest stable (recommended)</option>`]
          .concat(list.slice(0, 40).map((e) => `<option value="${e.loader.version}">${e.loader.version}${e.loader.stable ? '' : ' (unstable)'}</option>`))
          .join('');
      }
    } else {
      const info = await window.api.loader.listForgeNeo(selectedLoader, mcVersion);
      if (!info.versions.length) {
        select.innerHTML = `<option value="latest">No builds available</option>`;
      } else {
        select.innerHTML = [`<option value="latest">Recommended (${info.recommended || info.versions[0]})</option>`]
          .concat(info.versions.slice(0, 40).map((v) => `<option value="${v}">${v}</option>`))
          .join('');
      }
    }
  } catch (e) {
    select.innerHTML = `<option value="latest">Latest (auto-detect)</option>`;
  }
  select.disabled = false;
}

function selectLoader(loader) {
  selectedLoader = loader;
  document.querySelectorAll('.loader-opt').forEach((elm) => elm.classList.toggle('selected', elm.dataset.loader === loader));
  populateLoaderVersionSelect();
}

function suggestName() {
  const nameInput = el('modal-name');
  if (nameInput.dataset.touched === '1') return;
  const mcVersion = el('modal-mc-version').value;
  const loaderPart = selectedLoader === 'vanilla' ? '' : ` ${selectedLoader[0].toUpperCase()}${selectedLoader.slice(1)}`;
  nameInput.value = `${mcVersion}${loaderPart}`;
}

function ramMaxMB() {
  return state.systemInfo ? Math.max(4096, Math.floor(state.systemInfo.totalMemMB * 0.9 / 512) * 512) : 16384;
}

function setupRamSlider() {
  const maxMB = ramMaxMB();
  const slider = el('modal-ram-slider');
  slider.min = 0;
  slider.max = maxMB;
  el('modal-ram-max-label').textContent = `${Math.round(maxMB / 1024)} GB`;
  const update = () => {
    const v = parseInt(slider.value, 10);
    el('modal-ram-readout').textContent = v > 0 ? `${Math.round(v / 1024 * 10) / 10} GB` : 'Global (from Settings)';
  };
  slider.addEventListener('input', update);
  slider._update = update;
}

export function openInstanceModal(onCreated, instance = null) {
  onCreatedCallback = onCreated || null;
  editingInstance = instance || null;
  selectedLoader = instance ? instance.loader || 'vanilla' : 'vanilla';
  showSnapshots = false;

  el('modal-name').value = instance ? instance.name : '';
  el('modal-name').dataset.touched = instance ? '1' : '0';
  el('modal-separate-folder').checked = !!(instance && instance.separateFolder);

  // Advanced (RAM / JVM) prefill
  const ramSlider = el('modal-ram-slider');
  if (!ramSlider._update) setupRamSlider();
  ramSlider.value = instance && instance.ramMBOverride ? String(instance.ramMBOverride) : '0';
  ramSlider._update();
  el('modal-jvm-args').value = (instance && instance.jvmArgsOverride) || '';

  if (instance) {
    // ---- Edit mode: version/loader are frozen ----
    el('modal-title').textContent = 'Edit Installation';
    el('modal-static-info').style.display = '';
    el('modal-static-chips').innerHTML = [
      `<span class="chip" style="font-size:10px">MC ${escapeHtml(instance.mcVersion)}</span>`,
      `<span class="chip" style="font-size:10px">${loaderLabel(instance.loader)}${instance.loaderVersion && instance.loaderVersion !== 'latest' ? ' ' + escapeHtml(instance.loaderVersion) : ''}</span>`,
      instance.installed ? `<span class="chip" style="font-size:10px;color:var(--primary-fixed-dim)">Installed</span>` : `<span class="chip" style="font-size:10px;color:var(--error)">Not installed</span>`,
    ].join('');
    el('modal-picker').style.display = 'none';
    el('modal-loader-picker').style.display = 'none';
    el('modal-create-btn').innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">save</span>Save Changes`;
  } else {
    // ---- Create mode ----
    el('modal-title').textContent = 'New Installation';
    el('modal-static-info').style.display = 'none';
    el('modal-picker').style.display = '';
    el('modal-loader-picker').style.display = '';
    el('modal-create-btn').innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">add</span>Create Installation`;
    document.querySelectorAll('.loader-opt').forEach((elm) => elm.classList.toggle('selected', elm.dataset.loader === selectedLoader));
    el('chip-show-snapshots').classList.remove('active');
    el('modal-loader-version-wrap').classList.add('hidden');
  }

  el('instance-modal-overlay').classList.remove('hidden');

  ensureManifest().then(() => {
    populateVersionSelect();
    if (instance) {
      el('modal-mc-version').value = instance.mcVersion;
      el('modal-loader-version-wrap').classList.add('hidden');
    } else {
      suggestName();
      populateLoaderVersionSelect();
    }
  }).catch((e) => toast(`Could not load version list: ${e.message}`, 'error'));
}

function closeInstanceModal() {
  el('instance-modal-overlay').classList.add('hidden');
}

async function handleCreate() {
  const name = el('modal-name').value.trim();
  if (!name) { toast('Give this installation a name.', 'error'); return; }

  const createBtn = el('modal-create-btn');
  createBtn.disabled = true;
  try {
    if (editingInstance) {
      // ---- Edit: basic fields + per-instance RAM/JVM (no reinstall) ----
      const patch = {
        name,
        separateFolder: el('modal-separate-folder').checked,
        ramMBOverride: parseInt(el('modal-ram-slider').value, 10) || null,
        jvmArgsOverride: el('modal-jvm-args').value.trim() || null,
      };
      await window.api.instances.update(editingInstance.id, patch);
      closeInstanceModal();
      toast(`"${name}" updated.`, 'success');
    } else {
      // ---- Create + install ----
      const mcVersion = el('modal-mc-version').value;
      if (!mcVersion) { toast('Choose a Minecraft version.', 'error'); return; }
      const versionType = el('modal-mc-version').selectedOptions[0]?.dataset.type || 'release';
      const loaderVersion = selectedLoader === 'vanilla' ? null : (el('modal-loader-version').value || 'latest');
      const separateFolder = el('modal-separate-folder').checked;
      const ramMBOverride = parseInt(el('modal-ram-slider').value, 10) || null;
      const jvmArgsOverride = el('modal-jvm-args').value.trim() || null;

      const instance = await window.api.instances.create({
        name, mcVersion, versionType, loader: selectedLoader, loaderVersion,
        separateFolder, ramMBOverride, jvmArgsOverride,
      });
      closeInstanceModal();
      toast(`"${name}" created — installing…`, 'success');
      try {
        await runInstall(instance.id, `Installing ${name}`);
        toast(`"${name}" is ready to play.`, 'success');
      } catch (e) {
        toast(`Install failed: ${e.message}`, 'error');
      }
      if (onCreatedCallback) onCreatedCallback();
    }
  } catch (e) {
    toast(e.message, 'error');
  } finally {
    createBtn.disabled = false;
  }
}

export function initInstanceModal() {
  el('modal-close-btn').addEventListener('click', closeInstanceModal);
  el('modal-cancel-btn').addEventListener('click', closeInstanceModal);
  el('instance-modal-overlay').addEventListener('click', (e) => { if (e.target.id === 'instance-modal-overlay') closeInstanceModal(); });
  el('modal-create-btn').addEventListener('click', handleCreate);

  document.querySelectorAll('.loader-opt').forEach((elm) => {
    elm.addEventListener('click', () => { selectLoader(elm.dataset.loader); suggestName(); });
  });

  el('modal-mc-version').addEventListener('change', () => { populateLoaderVersionSelect(); suggestName(); });
  el('modal-name').addEventListener('input', () => { el('modal-name').dataset.touched = '1'; });

  el('chip-show-snapshots').addEventListener('click', () => {
    showSnapshots = !showSnapshots;
    el('chip-show-snapshots').classList.toggle('active', showSnapshots);
    populateVersionSelect();
  });
}