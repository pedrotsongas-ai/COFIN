const { app, BrowserWindow, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: false, // Janela frameless com barra integrada
    autoHideMenuBar: true,
    title: "COFIN",
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: true,
      contextIsolation: true,
      webSecurity: false // <--- AQUI DESLIGAMOS O CORS
    }
  });
  
  win.maximize();
  win.show();
  win.loadFile('index.html');

  // Notificar o renderer sobre o estado de maximização
  win.on('maximize', () => {
    try { win.webContents.send('win:maximized-status', true); } catch (e) {}
  });
  win.on('unmaximize', () => {
    try { win.webContents.send('win:maximized-status', false); } catch (e) {}
  });
}

// Controles da janela frameless
ipcMain.on('win:minimize', (evento) => {
  const win = BrowserWindow.fromWebContents(evento.sender);
  if (win) win.minimize();
});

ipcMain.on('win:maximize', (evento) => {
  const win = BrowserWindow.fromWebContents(evento.sender);
  if (win) {
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  }
});

ipcMain.on('win:close', (evento) => {
  const win = BrowserWindow.fromWebContents(evento.sender);
  if (win) win.close();
});

ipcMain.handle('win:is-maximized', (evento) => {
  const win = BrowserWindow.fromWebContents(evento.sender);
  return win ? win.isMaximized() : false;
});

ipcMain.on('cofin:set-window-icon', (evento, dataUrl) => {
  try {
    const win = BrowserWindow.fromWebContents(evento.sender);
    if (win && typeof dataUrl === 'string' && dataUrl.startsWith('data:image/')) {
      const img = nativeImage.createFromDataURL(dataUrl);
      if (!img.isEmpty()) win.setIcon(img);
    }
  } catch (e) {}
});

/* ================= SHADOW VAULT (AUTO-BACKUP SILENCIOSO) ================= */
ipcMain.handle('escolher-pasta', async (evento) => {
  try {
    const win = BrowserWindow.fromWebContents(evento.sender);
    const resultado = await dialog.showOpenDialog(win, {
      title: 'Selecionar Pasta para Shadow Vault (Auto-Backup)',
      properties: ['openDirectory', 'createDirectory']
    });
    if (!resultado.canceled && resultado.filePaths && resultado.filePaths.length > 0) {
      return resultado.filePaths[0];
    }
    return null;
  } catch (err) {
    console.error('Erro ao escolher pasta de backup:', err);
    return null;
  }
});

ipcMain.handle('salvar-backup', async (_evento, params) => {
  try {
    const { dadosJson, caminhoDestino, nomeArquivo } = params || {};
    if (!caminhoDestino) {
      return { ok: false, erro: 'Caminho de pasta de destino não fornecido.' };
    }
    if (!fs.existsSync(caminhoDestino)) {
      return { ok: false, erro: `A pasta selecionada não existe ou foi removida: ${caminhoDestino}` };
    }

    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    const nomeFinal = nomeArquivo || `cofin_backup_${ano}${mes}${dia}.json`;
    const caminhoCompleto = path.join(caminhoDestino, nomeFinal);

    const conteudo = typeof dadosJson === 'string' ? dadosJson : JSON.stringify(dadosJson, null, 2);
    await fs.promises.writeFile(caminhoCompleto, conteudo, 'utf8');

    return { ok: true, caminho: caminhoCompleto, arquivo: nomeFinal };
  } catch (err) {
    console.error('Erro ao salvar backup no disco:', err);
    return { ok: false, erro: err.message || 'Falha ao gravar arquivo de backup no disco.' };
  }
});

ipcMain.handle('selecionar-arquivo-backup', async (evento) => {
  try {
    const win = BrowserWindow.fromWebContents(evento.sender);
    const resultado = await dialog.showOpenDialog(win, {
      title: 'Restaurar Backup do COFIN',
      properties: ['openFile'],
      filters: [{ name: 'Arquivos de Backup JSON (*.json)', extensions: ['json'] }]
    });
    if (!resultado.canceled && resultado.filePaths && resultado.filePaths.length > 0) {
      const caminho = resultado.filePaths[0];
      const conteudo = await fs.promises.readFile(caminho, 'utf8');
      return { ok: true, caminho, conteudo };
    }
    return { ok: false, cancelado: true };
  } catch (err) {
    console.error('Erro ao ler arquivo de backup:', err);
    return { ok: false, erro: err.message || 'Falha ao ler arquivo.' };
  }
});

/* ================= LOGIN MICROSOFT (OAuth) =================
   Duas pontes para o index.html (que roda com nodeIntegration):
   - cofin:ms-auth  -> abre a janela de login da Microsoft e devolve o endereço de retorno (http://localhost/?code=...)
   - cofin:ms-token -> faz o pedido de token pelo Node (sem CORS e sem cabeçalho de origem, como um app nativo)
   Só aceitam endereços de login.microsoftonline.com. */
const ORIGEM_LOGIN = 'https://login.microsoftonline.com/';

ipcMain.handle('cofin:ms-auth', (evento, urlLogin) => new Promise((resolve, reject) => {
  if (typeof urlLogin !== 'string' || !urlLogin.startsWith(ORIGEM_LOGIN)) {
    reject(new Error('Endereço de login não permitido.'));
    return;
  }
  const dono = BrowserWindow.fromWebContents(evento.sender);
  const janela = new BrowserWindow({
    width: 520,
    height: 720,
    parent: dono || undefined,
    modal: !!dono,
    autoHideMenuBar: true,
    title: 'Entrar na Microsoft',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      partition: 'cofin-ms-login' // sem "persist:" = a sessão do login fica só em memória
    }
  });

  let terminou = false;
  const finalizar = (fn, valor) => {
    if (terminou) return;
    terminou = true;
    try { if (!janela.isDestroyed()) janela.destroy(); } catch (e) {}
    fn(valor);
  };
  // A Microsoft redireciona para http://localhost/?code=... — interceptamos antes de carregar (não há nada ouvindo lá).
  const interceptar = (evt, urlLegado) => {
    const destino = urlLegado || (evt && evt.url) || '';
    if (destino.startsWith('http://localhost')) {
      evt.preventDefault();
      finalizar(resolve, destino);
    }
  };
  janela.webContents.on('will-redirect', interceptar);
  janela.webContents.on('will-navigate', interceptar);
  janela.on('closed', () => finalizar(reject, new Error('Login cancelado.')));
  janela.loadURL(urlLogin);
}));

ipcMain.handle('cofin:ms-token', async (_evento, { url, body }) => {
  if (typeof url !== 'string' || !url.startsWith(ORIGEM_LOGIN)) throw new Error('Endereço não permitido.');
  const resposta = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  let json = null;
  try { json = await resposta.json(); } catch (e) {}
  return { status: resposta.status, json };
});

app.whenReady().then(() => {
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
