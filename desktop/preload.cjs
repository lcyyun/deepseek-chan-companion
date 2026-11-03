const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['toggle-chat', 'toggle-menu', 'toggle-drag', 'toggle-follow', 'hide-chat', 'hide-pet', 'show-pet', 'drag-mode', 'resize-pet', 'move-pet', 'choose-model', 'open-extension', 'open-url', 'copy-pairing', 'copy-text', 'minimize', 'quit', 'reset-position', 'diagnostics', 'pet-hit-regions', 'pet-pointer-lock', 'pet-input-mode', 'pet-runtime-error', 'mouse-tracking', 'suspend-tracking', 'basin-enabled', 'glasses-enabled', 'glasses-style', 'small-form-enabled', 'pet-pin', 'setup-complete', 'dsh-status', 'dsh-sessions', 'dsh-prompt', 'dsh-connect', 'dsh-open', 'dsh-open-launcher', 'chest-reaction', 'model-tuning', 'render-quality', 'render-sample', 'copy-performance', 'render-buffer-cache', 'render-state-snapshots']);
contextBridge.exposeInMainWorld('companion', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  control: (action, data) => {
    if (!allowed.has(action)) return Promise.reject(new Error('不支持的窗口操作'));
    // pet-pointer-lock carries {locked,id}; legacy booleans remain supported by
    // main. pet-pointer-release events use that id and screen-DIP coordinates.
    return ipcRenderer.invoke('window-control', action, data);
  },
  onEvent: callback => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('desktop-event', listener);
    return () => ipcRenderer.removeListener('desktop-event', listener);
  }
});
