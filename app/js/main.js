import { setState, state } from './state.js';
import { toast } from './toast.js';
import { initTitlebar } from './components/titlebar.js';
import { initRouter, onViewEnter, navigateTo } from './router.js';
import { initWizard, startWizard } from './views/wizard.js';
import { initInstanceModal } from './views/instanceModal.js';
import { initHomeView, enterHomeView, refreshHomeData } from './views/home.js';
import { initVersionsView, enterVersionsView } from './views/versions.js';
import { initModsView, enterModsView } from './views/mods.js';
import { initServersView, enterServersView } from './views/servers.js';
import { initSettingsView, enterSettingsView, applyTheme } from './views/settings.js';
import { initials, escapeHtml } from './format.js';

function el(id) { return document.getElementById(id); }

async function renderSidebarFooter() {
  const account = await window.api.accounts.getActive();
  setState({ activeAccount: account });
  const footer = el('sidebar-footer');
  if (!account) {
    footer.innerHTML = `<div class="row" style="gap:10px;color:var(--on-surface-variant);font-size:12.5px"><span class="material-symbols-outlined" style="font-size:20px">person_off</span>No profile</div>`;
    return;
  }
  footer.innerHTML = `
    <div class="avatar" style="width:32px;height:32px;font-size:12px">${initials(account.username)}</div>
    <div class="grow" style="min-width:0">
      <div style="font-size:12.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(account.username)}</div>
      <div style="font-family:var(--font-mono);font-size:9.5px;color:var(--on-surface-variant)">OFFLINE</div>
    </div>`;
}

async function boot() {
  initTitlebar();

  const config = await window.api.config.get();
  setState({ config });
  applyTheme(config.theme || 'dark');

  initInstanceModal();
  initHomeView();
  initVersionsView();
  initServersView();
  initModsView();
  initSettingsView();

  onViewEnter('home', enterHomeView);
  onViewEnter('versions', enterVersionsView);
  onViewEnter('servers', enterServersView);
  onViewEnter('mods', enterModsView);
  onViewEnter('settings', enterSettingsView);

  initRouter();
  await renderSidebarFooter();

  if (config.firstRun) {
    initWizard(async () => {
      await renderSidebarFooter();
      navigateTo('home');
    });
    startWizard();
  } else {
    navigateTo('home');
  }

  el('sidebar-add-btn')?.addEventListener('click', () => navigateTo('versions'));
}

window.addEventListener('DOMContentLoaded', () => {
  boot().catch((e) => {
    console.error(e);
    toast(`Startup error: ${e.message}`, 'error', 10000);
  });
});
