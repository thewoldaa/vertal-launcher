export function initTitlebar() {
  document.getElementById('tb-minimize')?.addEventListener('click', () => window.api.window.minimize());
  document.getElementById('tb-maximize')?.addEventListener('click', () => window.api.window.maximize());
  document.getElementById('tb-close')?.addEventListener('click', () => window.api.window.close());
}
