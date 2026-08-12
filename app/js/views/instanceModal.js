import { state, setState } from '../state.js';
import { toast } from '../toast.js';
import { runInstall } from '../installOverlay.js';
import { escapeHtml, loaderLabel } from '../format.js';

let onCreatedCallback = null;
let selectedLoader = 'vanilla';
let showSnapshots = false;
let editingInstance = null; // instance object when editing, null when creating
let linkMode = false;       // create via "link existing folder" instead of download
let linkedScan = null;      // result of local:scanFolder

function el(id) { return document.getElementById(id); }

function setLinkMode(mode) {
  linkMode = mode === 'link';
  document.querySelectorAll('.linked-mode-opt').forEach((elm) => elm.classList.toggle('selected', elm.dataset.mode === mode));
  el('modal-linked-section').style.display = linkMode ? '' : 'none';
  el('modal-picker').style.display = linkMode ? 'none' : '';
  el('modal-loader-picker').style.display = linkMode ? 'none' : '';
  el('modal-separate-folder').closest('label').style.display = linkMode ? 'none' : '';
  if (!linkMode) linkedScan = null;
}

function renderLinkedScan(scan) {
  const chips = el('modal-linked-chips');
  const result = el('modal-linked-result');
  const errBox = el('modal-linked-error');
  if (!scan || !scan.ok) {
    result.classList.add('hidden');
    if (scan && scan.message) {
      errBox.textContent = scan.message;
      errBox.classList.remove('hidden');
    }
    return;
  }
  errBox.classList.add('hidden');
  linkedScan = scan;
  const parts = [
    `<span class="chip" style="font-size:10px">MC ${escapeHtml(scan.preferred ? (scan.preferred.baseVersion || scan.preferred.id) : '?')}</span>`,
    `<span class="chip" style="font-size:10px">${loaderLabel(scan.preferred ? scan.preferred.loader : 'vanilla')}</span>`,
  ];
  if (scan.gameDir) {
    parts.push(`<span class="chip" style="font-size:10px;color:var(--primary-fixed-dim)">Game folder: ${escapeHtml(scan.gameDir)}</span>`);
  } else {
    parts.push(`<span class="chip" style="font-size:10px;color:var(--primary-fixed-dim)">Install: ${escapeHtml(scan.root)}</span>`);
  }
  chips.innerHTML = parts.join('');

  const verSelect = el('modal-linked-version');
  const multi = scan.versions.length > 1;
  verSelect.innerHTML = scan.versions.map((v) =>
    `<option value="${escapeHtml(v.id)}">${escapeHtml(v.id)}${v.loader !== 'vanilla' ? ' · ' + loaderLabel(v.loader) : ''}</option>`
  ).join('');
  if (scan.preferred) verSelect.value = scan.preferred.id;
  el('modal-linked-version-wrap').style.display = multi ? '' : 'none';

  result.classList.remove('hidden');

  // Auto-suggest the name from the detected profile/game folder (only if untouched).
  const nameInput = el('modal-name');
  if (nameInput.dataset.touched !== '1' && scan.name) {
    nameInput.value = scan.name;
  }
}

async function ensureManifest(force = false) {
  if (state.mojangManifest && !force) return state.mojangManifest;
  const manifest = await window.api.mojang.listVersions(force);
  setState({ mojangManifest: manifest });
  return manifest;
}

function setManifestNote(manifest) {
  const note = el('modal-manifest-note');
  if (!note) return;
  if (manifest && manifest.offline) {
    const merged = manifest.loaderMerged
      ? ' Merged with the latest Fabric &amp; Quilt releases.'
      : '';
    note.innerHTML = `<span class="material-symbols-outlined" style="font-size:12px;vertical-align:-2px">cloud_off</span> Using the built-in version list (offline).${merged} <a href="#" id="modal-manifest-retry">Retry</a>`;
    note.classList.remove('hidden');
    el('modal-manifest-retry')?.addEventListener('click', onManifestRetry);
  } else {
    note.classList.add('hidden');
  }
}

async function onManifestRetry(e) {
  e.preventDefault();
  const note = el('modal-manifest-note');
  if (note) note.innerHTML = 'Retrying…';
  try {
    const manifest = await ensureManifest(true);
    populateVersionSelect();
    setManifestNote(manifest);
    if (!editingInstance) { suggestName(); populateLoaderVersionSelect(); }
    if (!manifest.offline) toast('Version list refreshed from Mojang.', 'success');
  } catch (err) {
    if (note) note.innerHTML = `Still offline: ${escapeHtml(err.message)}`;
  }
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
  slider.step = 256;
  el('modal-ram-max-label').textContent = `${Math.round(maxMB / 1024)} GB`;
  const update = () => {
    const v = parseInt(slider.value, 10);
    el('modal-ram-readout').textContent = v > 0 ? `${Math.round(v / 1024 * 10) / 10} GB` : 'Global (from Settings)';
    const warn = el('modal-ram-warn');
    warn.classList.toggle('hidden', v === 0 || v >= 2048);
    warn.textContent = v > 0 && v < 2048
      ? 'Below 2 GB loading will be very slow — 2 GB or more is recommended.'
      : '';
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
    const chips = [
      `<span class="chip" style="font-size:10px">MC ${escapeHtml(instance.mcVersion)}</span>`,
      `<span class="chip" style="font-size:10px">${loaderLabel(instance.loader)}${instance.loaderVersion && instance.loaderVersion !== 'latest' ? ' ' + escapeHtml(instance.loaderVersion) : ''}</span>`,
      instance.installed ? `<span class="chip" style="font-size:10px;color:var(--primary-fixed-dim)">Installed</span>` : `<span class="chip" style="font-size:10px;color:var(--error)">Not installed</span>`,
    ];
    if (instance.sourceDir) {
      chips.push(`<span class="chip" style="font-size:10px;color:var(--primary-fixed-dim)">Linked · ${escapeHtml(instance.sourceDir)}</span>`);
    }
    el('modal-static-chips').innerHTML = chips.join('');
    el('modal-picker').style.display = 'none';
    el('modal-loader-picker').style.display = 'none';
    el('modal-linked-wrap').style.display = 'none';
    el('modal-linked-section').style.display = instance.sourceDir ? '' : 'none';
    if (instance.sourceDir) {
      el('modal-linked-path').value = instance.sourceDir;
      el('modal-linked-result').classList.remove('hidden');
      el('modal-linked-chips').innerHTML =
        `<span class="chip" style="font-size:10px;color:var(--primary-fixed-dim)">Linked installation</span>` +
        `<span class="chip" style="font-size:10px">${escapeHtml(instance.resolvedVersionId || instance.mcVersion)}</span>`;
      el('modal-linked-version-wrap').style.display = 'none';
    }
    el('modal-create-btn').innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">save</span>Save Changes`;
  } else {
    // ---- Create mode ----
    el('modal-title').textContent = 'New Installation';
    el('modal-static-info').style.display = 'none';
    el('modal-picker').style.display = '';
    el('modal-loader-picker').style.display = '';
    el('modal-linked-wrap').style.display = '';
    el('modal-separate-folder').closest('label').style.display = '';
    linkMode = false;
    linkedScan = null;
    el('modal-linked-path').value = '';
    el('modal-linked-result').classList.add('hidden');
    el('modal-linked-error').classList.add('hidden');
    document.querySelectorAll('.linked-mode-opt').forEach((elm) => elm.classList.toggle('selected', elm.dataset.mode === 'download'));
    el('modal-create-btn').innerHTML = `<span class="material-symbols-outlined" style="font-size:16px">add</span>Create Installation`;
    document.querySelectorAll('.loader-opt').forEach((elm) => elm.classList.toggle('selected', elm.dataset.loader === selectedLoader));
    el('chip-show-snapshots').classList.remove('active');
    el('modal-loader-version-wrap').classList.add('hidden');
  }

  el('instance-modal-overlay').classList.remove('hidden');

  ensureManifest().then((manifest) => {
    populateVersionSelect();
    setManifestNote(manifest);
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
      const ramMBOverride = parseInt(el('modal-ram-slider').value, 10) || null;
      const jvmArgsOverride = el('modal-jvm-args').value.trim() || null;

      if (linkMode) {
        // ---- Create via linked existing folder: nothing to download ----
        if (!linkedScan || !linkedScan.ok) { toast('Scan a Minecraft folder first.', 'error'); return; }
        const chosenId = el('modal-linked-version').value || (linkedScan.preferred && linkedScan.preferred.id);
        const v = linkedScan.versions.find((x) => x.id === chosenId) || linkedScan.preferred;
        if (!v) { toast('No usable version profile found in that folder.', 'error'); return; }
        const instance = await window.api.instances.create({
          name,
          mcVersion: v.baseVersion || v.id,
          versionType: 'release',
          loader: v.loader || 'vanilla',
          loaderVersion: v.loaderVersion || 'latest',
          resolvedVersionId: v.id,
          sourceDir: linkedScan.root,
          customGameDir: linkedScan.gameDir || null,
          separateFolder: false,
          ramMBOverride,
          jvmArgsOverride,
        });
        closeInstanceModal();
        toast(`"${name}" linked — ready to play.`, 'success');
        if (onCreatedCallback) onCreatedCallback();
        return;
      }

      // ---- Create + install ----
      const mcVersion = el('modal-mc-version').value;
      if (!mcVersion) { toast('Choose a Minecraft version.', 'error'); return; }
      const versionType = el('modal-mc-version').selectedOptions[0]?.dataset.type || 'release';
      const loaderVersion = selectedLoader === 'vanilla' ? null : (el('modal-loader-version').value || 'latest');
      const separateFolder = el('modal-separate-folder').checked;

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

  // ---- Link-existing-folder mode ----
  document.querySelectorAll('.linked-mode-opt').forEach((elm) => {
    elm.addEventListener('click', () => setLinkMode(elm.dataset.mode));
  });
  el('modal-linked-browse').addEventListener('click', async () => {
    const folder = await window.api.local.selectFolder();
    if (!folder) return;
    el('modal-linked-path').value = folder;
    const scan = await window.api.local.scanFolder(folder);
    renderLinkedScan(scan);
  });
  el('modal-linked-scan').addEventListener('click', async () => {
    const folder = el('modal-linked-path').value.trim();
    if (!folder) { toast('Type or browse to a Minecraft folder first.', 'error'); return; }
    const btn = el('modal-linked-scan');
    btn.disabled = true;
    try {
      const scan = await window.api.local.scanFolder(folder);
      renderLinkedScan(scan);
    } finally {
      btn.disabled = false;
    }
  });
  el('modal-linked-path').addEventListener('change', () => {
    if (el('modal-linked-path').value.trim()) {
      window.api.local.scanFolder(el('modal-linked-path').value.trim()).then(renderLinkedScan);
    }
  });
}