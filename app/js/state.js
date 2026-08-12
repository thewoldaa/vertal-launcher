const listeners = new Set();

export const state = {
  config: null,
  systemInfo: null,
  accounts: [],
  activeAccount: null,
  instances: [],
  activeInstance: null,
  servers: [],
  mojangManifest: null,
  currentView: 'home',
  runningInstanceId: null,
};

export function setState(patch) {
  Object.assign(state, patch);
  for (const fn of listeners) fn(state);
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function getInstanceById(id) {
  return state.instances.find((i) => i.id === id) || null;
}
