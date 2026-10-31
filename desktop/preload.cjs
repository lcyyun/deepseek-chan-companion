const { contextBridge, ipcRenderer } = require('electron');
const allowed = new Set(['toggle-chat', 'toggle-drag', 'toggle-follow', 'hide-chat', 'hide-pet', 'show-pet', 'drag-mode', 'resize-pet', 'move-pet', 'choose-model', 'open-extension', 'open-url', 'copy-pairing', 'minimize', 'quit', 'reset-position', 'diagnostics', 'pet-hit-regions', 'pet-pointer-lock', 'pet-input-mode', 'pet-runtime-error', 'mouse-tracking', 'suspend-tracking', 'basin-enabled', 'chest-reaction', 'model-tuning']);
contextBridge.exposeInMainWorld('companion', {
  bootstrap: () => ipcRenderer.invoke('bootstrap'),
  control: (action, data) => {
    if (!allowed.has(action)) return Promise.reject(new Error('不支持的窗口操作'));
    return ipcRenderer.invoke('window-control', action, data);
  },
  onEvent: callback => {
    const listener = (_, event) => callback(event);
    ipcRenderer.on('desktop-event', listener);
    return () => ipcRenderer.removeListener('desktop-event', listener);
  }
});
