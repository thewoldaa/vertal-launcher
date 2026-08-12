import { formatBytes, formatSpeed, formatEta } from './format.js';

const overlayEl = () => document.getElementById('install-overlay');

function render(state) {
  const el = overlayEl();
  if (!el) return;
  const pct = Math.max(0, Math.min(100, state.pct || 0));
  el.querySelector('.io-title').textContent = state.title || 'Installing';
  el.querySelector('.io-phase').textContent = state.phase || 'Preparing…';
  el.querySelector('.io-pct').textContent = state.indeterminate ? '' : `${pct.toFixed(0)}%`;
  const fill = el.querySelector('.progress-fill');
  if (state.indeterminate) {
    fill.style.width = '35%';
    fill.classList.add('shimmer-bar');
  } else {
    fill.style.width = `${pct}%`;
    fill.classList.remove('shimmer-bar');
  }
  const doneStr = formatBytes(state.doneBytes || 0);
  const totalStr = formatBytes(state.totalBytes || 0);
  el.querySelector('.io-size').textContent = state.totalBytes ? `${doneStr} / ${totalStr}` : '';
  el.querySelector('.io-speed').textContent = state.speedBps ? formatSpeed(state.speedBps) : '';
  const bytesLeft = (state.totalBytes || 0) - (state.doneBytes || 0);
  el.querySelector('.io-eta').textContent = state.speedBps && state.totalBytes ? `ETA ${formatEta(bytesLeft, state.speedBps)}` : '';
  el.querySelector('.io-file').textContent = state.currentFile ? `${state.filesDone || 0}/${state.filesTotal || 0} · ${state.currentFile}` : '';
  const errEl = el.querySelector('.io-error');
  errEl.textContent = state.error || '';
  errEl.style.display = state.error ? 'block' : 'none';
}

export function showOverlay(title) {
  const el = overlayEl();
  el.classList.remove('hidden');
  render({ title, phase: 'Preparing…', pct: 0, indeterminate: true });
}

export function hideOverlay() {
  const el = overlayEl();
  el.classList.add('hidden');
}

/**
 * Runs the install pipeline for an instance, driving the shared overlay.
 * @returns {Promise<void>}
 */
export function runInstall(instanceId, title) {
  return new Promise((resolve, reject) => {
    showOverlay(title);
    window.api.install.start(instanceId).then(({ requestId }) => {
      const off = window.api.install.onEvent((evt) => {
        if (evt.requestId !== requestId) return;
        if (evt.type === 'progress') {
          render({ title, ...evt });
        } else if (evt.type === 'done') {
          render({ title, phase: 'Done', pct: 100 });
          off();
          setTimeout(() => { hideOverlay(); resolve(); }, 350);
        } else if (evt.type === 'error') {
          render({ title, phase: 'Failed', error: evt.message });
          off();
          reject(new Error(evt.message));
        }
      });
    }).catch((err) => {
      render({ title, error: err.message });
      reject(err);
    });
  });
}
