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
  setWindowIcon: (dataUrl) => ipcRenderer.send('cofin:set-window-icon', dataUrl),

  // Sincronização Familiar P2P (Rede Local :45000)
  obterIPLocal: () => ipcRenderer.invoke('obter-ip-local'),
  enviarSync: (ipParceiro, stateLocal) => ipcRenderer.invoke('enviar-sync', { ipParceiro, stateLocal }),
  onReceberSync: (callback) => {
    ipcRenderer.on('receber-sync', (_event, dadosParceiro) => callback(dadosParceiro));
  },
  atualizarCacheP2P: (stateLocal) => ipcRenderer.send('atualizar-cache-p2p', stateLocal),

  // Auto-Update Silencioso (OTA via electron-updater)
  onDownloadIniciado: (callback) => {
    ipcRenderer.on('download-iniciado', (_event, info) => callback(info));
  },
  onDownloadConcluido: (callback) => {
    ipcRenderer.on('download-concluido', (_event, info) => callback(info));
  },
  aplicarAtualizacao: () => ipcRenderer.invoke('aplicar-atualizacao')
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

