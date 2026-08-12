import { toast } from './toast.js';
import { setState } from './state.js';

/**
 * Launches an instance (installing first if needed), reporting status
 * transitions so the calling view can update its button/card UI.
 * @param {string} instanceId
 * @param {(status:'launching'|'installing'|'running'|'idle'|'error', detail?:object)=>void} onStateChange
 * @param {object} [opts] - extra launch options passed to main, e.g. { server: serverId } for quick-play.
 */
export async function playInstance(instanceId, onStateChange, opts) {
  const running = await window.api.instances.isRunning(instanceId);
  if (running) {
    toast('This installation is already running.', 'info');
    return;
  }

  onStateChange && onStateChange('launching');
  try {
    const { requestId } = await window.api.launch.start(instanceId, opts || null);
    setState({ runningInstanceId: instanceId });

    await new Promise((resolve, reject) => {
      const off = window.api.launch.onEvent((evt) => {
        if (evt.requestId !== requestId) return;
        if (evt.type === 'progress') {
          onStateChange && onStateChange('installing', evt);
        } else if (evt.type === 'started') {
          onStateChange && onStateChange('running', evt);
        } else if (evt.type === 'exit') {
          setState({ runningInstanceId: null });
          onStateChange && onStateChange('idle');
          off();
          if (evt.code !== 0 && evt.code !== null) {
            toast(`Game closed with exit code ${evt.code}. Check Settings > Java if this keeps happening.`, 'error');
          }
          resolve();
        } else if (evt.type === 'error') {
          setState({ runningInstanceId: null });
          onStateChange && onStateChange('error');
          off();
          reject(new Error(evt.message));
        }
      });
    });
  } catch (e) {
    setState({ runningInstanceId: null });
    onStateChange && onStateChange('error');
    toast(e.message, 'error');
  }
}

export async function stopInstance(instanceId) {
  await window.api.launch.kill(instanceId);
}
