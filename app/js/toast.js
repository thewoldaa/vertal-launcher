let root = null;

function ensureRoot() {
  if (!root) root = document.getElementById('toast-root');
  return root;
}

export function toast(message, type = 'info', timeoutMs = 4200) {
  const r = ensureRoot();
  if (!r) return;
  const el = document.createElement('div');
  el.className = `toast fade-in ${type}`;
  const icon = type === 'error' ? 'error' : type === 'success' ? 'check_circle' : 'info';
  el.innerHTML = `<span class="material-symbols-outlined">${icon}</span><span>${message}</span>`;
  r.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity 0.25s ease, transform 0.25s ease';
    el.style.opacity = '0';
    el.style.transform = 'translateX(20px)';
    setTimeout(() => el.remove(), 260);
  }, timeoutMs);
}
