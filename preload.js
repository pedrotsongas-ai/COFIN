const { contextBridge, ipcRenderer } = require('electron');

const electronAPI = {
  escolherPasta: () => ipcRenderer.invoke('escolher-pasta'),
  salvarBackup: (dadosJson, caminhoDestino, nomeArquivo) =>
    ipcRenderer.invoke('salvar-backup', { dadosJson, caminhoDestino, nomeArquivo }),
  selecionarArquivoBackup: () => ipcRenderer.invoke('selecionar-arquivo-backup'),
  invocar: (canal, dados) => ipcRenderer.invoke(canal, dados),
  enviar: (canal, dados) => ipcRenderer.send(canal, dados),
  windowControl: (action) => ipcRenderer.send(`win:${action}`),
  isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
  onMaximizedStatus: (callback) => {
    ipcRenderer.on('win:maximized-status', (_event, isMax) => callback(isMax));
  },
  setWindowIcon: (dataUrl) => ipcRenderer.send('cofin:set-window-icon', dataUrl)
};

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electronAPI', electronAPI);
  } catch (e) {
    window.electronAPI = electronAPI;
  }
} else {
  window.electronAPI = electronAPI;
}

