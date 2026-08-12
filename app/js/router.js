import { setState, state } from './state.js';

const VIEW_META = {
  home: { title: 'Home', crumb: 'Dashboard' },
  versions: { title: 'Versions', crumb: 'Installations' },
  servers: { title: 'Servers', crumb: 'Server List' },
  mods: { title: 'Mods', crumb: 'Mod Management' },
  settings: { title: 'Settings', crumb: 'Preferences' },
};

const onEnterCallbacks = {};

export function onViewEnter(viewId, fn) {
  onEnterCallbacks[viewId] = fn;
}

export function navigateTo(viewId) {
  if (!VIEW_META[viewId]) return;
  document.querySelectorAll('.view').forEach((el) => el.classList.remove('active'));
  document.getElementById(`view-${viewId}`)?.classList.add('active');

  document.querySelectorAll('#sidebar .nav-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.view === viewId);
  });

  const meta = VIEW_META[viewId];
  const crumbEl = document.getElementById('topbar-crumb');
  if (crumbEl) crumbEl.textContent = meta.crumb;

  setState({ currentView: viewId });

  if (onEnterCallbacks[viewId]) onEnterCallbacks[viewId]();
}

export function initRouter() {
  document.querySelectorAll('#sidebar .nav-item').forEach((el) => {
    el.addEventListener('click', () => navigateTo(el.dataset.view));
  });
  navigateTo('home');
}
