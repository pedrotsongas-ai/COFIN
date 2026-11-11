const { contextBridge, ipcRenderer } = require('electron');

const ALLOWED_INVOKE_CHANNELS = new Set([
  'escolher-pasta',
  'salvar-backup',
  'selecionar-arquivo-backup',
  'win:is-maximized',
  'cofin:ms-auth',
  'cofin:ms-token',
  'cofin:fetch-onedrive',
  'obter-ip-local',
  'enviar-sync',
  'verificar-atualizacoes-agora',
  'aplicar-atualizacao'
]);

const ALLOWED_SEND_CHANNELS = new Set([
  'win:minimize',
  'win:maximize',
  'win:close',
  'cofin:set-window-icon',
  'atualizar-cache-p2p',
  'aplicar-atualizacao'
]);

const ALLOWED_WINDOW_ACTIONS = new Set(['minimize', 'maximize', 'close']);

function invokeAllowlisted(channel, data) {
  if (!ALLOWED_INVOKE_CHANNELS.has(channel)) {
    return Promise.reject(new Error(`Canal IPC não permitido: ${String(channel)}`));
  }
  return ipcRenderer.invoke(channel, data);
}

function sendAllowlisted(channel, data) {
  if (!ALLOWED_SEND_CHANNELS.has(channel)) {
    throw new Error(`Canal IPC não permitido: ${String(channel)}`);
  }
  ipcRenderer.send(channel, data);
}

function createListener(channel) {
  return (callback) => {
    if (typeof callback !== 'function') return () => {};
    const handler = (_event, value) => callback(value);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  };
}

const electronAPI = Object.freeze({
  escolherPasta: () => invokeAllowlisted('escolher-pasta'),
  salvarBackup: (dadosJson, caminhoDestino, nomeArquivo) =>
    invokeAllowlisted('salvar-backup', { dadosJson, caminhoDestino, nomeArquivo }),
  selecionarArquivoBackup: () => invokeAllowlisted('selecionar-arquivo-backup'),
  invocar: (canal, dados) => invokeAllowlisted(canal, dados),
  enviar: (canal, dados) => sendAllowlisted(canal, dados),
  windowControl: (action) => {
    if (!ALLOWED_WINDOW_ACTIONS.has(action)) return;
    sendAllowlisted(`win:${action}`);
  },
  isMaximized: () => invokeAllowlisted('win:is-maximized'),
  onMaximizedStatus: createListener('win:maximized-status'),
  setWindowIcon: (dataUrl) => sendAllowlisted('cofin:set-window-icon', dataUrl),
  fetchOneDrive: (url) => invokeAllowlisted('cofin:fetch-onedrive', url),

  // Sincronização Familiar P2P (Rede Local :45000)
  obterIPLocal: () => invokeAllowlisted('obter-ip-local'),
  enviarSync: (ipParceiro, stateLocal, pinP2P) =>
    invokeAllowlisted('enviar-sync', { ipParceiro, stateLocal, pinP2P }),
  onReceberSync: createListener('receber-sync'),
  atualizarCacheP2P: (stateLocal) => sendAllowlisted('atualizar-cache-p2p', stateLocal),

  // Auto-Update Silencioso & Diagnóstico (OTA via electron-updater)
  verificarAtualizacoesAgora: () => invokeAllowlisted('verificar-atualizacoes-agora'),
  onUpdateErro: createListener('update-erro'),
  onUpdateNaoDisponivel: createListener('update-nao-disponivel'),
  onUpdateVerificando: createListener('update-verificando'),
  onDownloadIniciado: createListener('download-iniciado'),
  onDownloadConcluido: createListener('download-concluido'),
  aplicarAtualizacao: () => invokeAllowlisted('aplicar-atualizacao')
});

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI);
} else {
  globalThis.electronAPI = electronAPI;
}

