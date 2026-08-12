import { state, setState } from '../state.js';
import { toast } from '../toast.js';
import { formatDuration, formatRelativeTime, loaderLabel, initials, escapeHtml } from '../format.js';
import { playInstance } from '../play.js';
import { openInstanceModal } from './instanceModal.js';

const HERO_BACKGROUNDS = ['panoramic-dusk', 'lush-cave', 'deep-dark', 'floating-islands'];

function el(id) { return document.getElementById(id); }

function pickHeroBackground(instance) {
  const idx = instance ? Math.abs(hashCode(instance.id)) % HERO_BACKGROUNDS.length : 0;
  return `assets/bg/${HERO_BACKGROUNDS[idx]}.png`;
}

function hashCode(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (Math.imul(31, h) + str.charCodeAt(i)) | 0;
  return h;
}

function totalPlaytime() {
  return state.instances.reduce((sum, i) => sum + (i.totalPlaytimeMs || 0), 0);
}

function renderHero() {
  const instance = state.instances.find((i) => i.id === state.config?.activeInstanceId) || state.instances[0] || null;
  const heroEl = el('hero');
  const bgEl = el('bg-layer');

  if (!instance) {
    heroEl.style.backgroundImage = `url('assets/bg/abstract-obsidian.png')`;
    heroEl.innerHTML = `
      <span class="eyebrow">GET STARTED</span>
      <h2>No installations yet</h2>
      <p>Create your first Minecraft installation — vanilla, Fabric, Quilt, Forge or NeoForge — and jump in offline, no account required.</p>
      <div class="hero-actions">
        <button class="btn btn-primary play-btn" id="hero-create-btn"><span class="material-symbols-outlined icon-fill">add_circle</span>Create Installation</button>
      </div>`;
    el('hero-create-btn').addEventListener('click', () => openInstanceModal(() => renderAll()));
    if (bgEl) bgEl.style.backgroundImage = `url('assets/bg/abstract-obsidian.png')`;
    return;
  }

  const bg = pickHeroBackground(instance);
  heroEl.style.backgroundImage = `url('${bg}')`;
  if (bgEl) bgEl.style.backgroundImage = `url('${bg}')`;

  const loaderTxt = instance.loader === 'vanilla' ? 'Vanilla' : loaderLabel(instance.loader);
  const otherInstances = state.instances.filter((i) => i.id !== instance.id);

  heroEl.innerHTML = `
    <span class="eyebrow">${instance.installed ? 'READY TO PLAY' : 'NOT INSTALLED YET'}</span>
    <h2>${escapeHtml(instance.name)}</h2>
    <p>${escapeHtml(instance.mcVersion)} · ${loaderTxt}${instance.loaderVersion && instance.loaderVersion !== 'latest' && instance.loader !== 'vanilla' ? ' ' + escapeHtml(instance.loaderVersion) : ''} — playing offline as <b>${escapeHtml(state.activeAccount?.username || '—')}</b>.</p>
    <div class="hero-actions">
      <button class="btn btn-primary play-btn" id="hero-play-btn">
        <span class="material-symbols-outlined icon-fill">play_arrow</span>
        <span id="hero-play-label">${instance.installed ? 'Play' : 'Install & Play'}</span>
      </button>
      <div class="version-picker clickable" id="hero-version-picker">
        <span class="material-symbols-outlined">expand_more</span>
        <div>
          <div class="vp-label">Active</div>
          <div class="vp-value">${escapeHtml(instance.mcVersion)}</div>
        </div>
      </div>
    </div>`;

  el('hero-play-btn').addEventListener('click', async () => {
    const btn = el('hero-play-btn');
    const label = el('hero-play-label');
    await playInstance(instance.id, (status, detail) => {
      if (status === 'launching') {
        btn.disabled = true;
        label.textContent = 'Starting…';
      } else if (status === 'installing') {
        label.textContent = detail?.phase ? `${detail.phase}${detail.indeterminate ? '' : ' ' + Math.round(detail.pct || 0) + '%'}` : 'Installing…';
      } else if (status === 'running') {
        btn.disabled = false;
        label.textContent = 'Running';
      } else if (status === 'idle' || status === 'error') {
        btn.disabled = false;
        label.textContent = instance.installed ? 'Play' : 'Install & Play';
        refreshData();
      }
    });
  });

  if (otherInstances.length) {
    el('hero-version-picker').addEventListener('click', async () => {
      // Simple cycle-through picker to keep the dashboard lightweight; full switching lives in Versions.
      const currentIdx = state.instances.findIndex((i) => i.id === instance.id);
      const next = state.instances[(currentIdx + 1) % state.instances.length];
      await window.api.instances.setActive(next.id);
      await refreshData();
    });
  }
}

function renderStats() {
  el('stat-ram').textContent = state.config ? `${(state.config.ramMB / 1024).toFixed(1)} GB` : '—';
  el('stat-playtime').textContent = formatDuration(totalPlaytime());
  el('stat-installs').textContent = String(state.instances.length);
}

function renderProfile() {
  const account = state.activeAccount;
  const card = el('home-profile-card');
  if (!account) {
    card.innerHTML = `<div class="col grow"><h3>No offline profile</h3><p class="text-dim" style="font-size:12px;margin-top:4px">Add one in Settings</p></div>`;
    return;
  }
  card.innerHTML = `
    <div class="avatar">${initials(account.username)}</div>
    <div class="grow">
      <h3>${escapeHtml(account.username)}</h3>
      <div class="sub"><span class="dot"></span>OFFLINE PROFILE</div>
    </div>`;
}

function renderActivity() {
  const list = [...state.instances]
    .filter((i) => i.lastPlayedAt)
    .sort((a, b) => (b.lastPlayedAt || 0) - (a.lastPlayedAt || 0))
    .slice(0, 6);
  const listEl = el('activity-list');

  if (!list.length) {
    listEl.innerHTML = `<div class="empty-state" style="padding:30px 10px"><span class="material-symbols-outlined">history</span><p style="font-size:12.5px">Nothing played yet — hit Play to get started.</p></div>`;
    return;
  }

  listEl.innerHTML = list.map((i) => `
    <div class="news-item">
      <div class="thumb"><span class="material-symbols-outlined">${i.loader === 'vanilla' ? 'deployed_code' : 'extension'}</span></div>
      <div class="grow">
        <span class="cat text-dim">${loaderLabel(i.loader)} · ${escapeHtml(i.mcVersion)}</span>
        <h4>${escapeHtml(i.name)} — ${formatRelativeTime(i.lastPlayedAt)}</h4>
      </div>
    </div>`).join('');
}

async function refreshData() {
  const [instances, config, activeAccount] = await Promise.all([
    window.api.instances.list(),
    window.api.config.get(),
    window.api.accounts.getActive(),
  ]);
  setState({ instances, config, activeAccount });
  renderAll();
}

function renderAll() {
  renderHero();
  renderStats();
  renderProfile();
  renderActivity();
}

export function initHomeView() {
  // no static wiring needed beyond enter-time render
}

export function enterHomeView() {
  refreshData().catch((e) => toast(e.message, 'error'));
}

export { refreshData as refreshHomeData };
