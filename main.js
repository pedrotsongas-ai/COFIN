const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');

function createWindow () {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    autoHideMenuBar: true,
    title: "COFIN",
    icon: path.join(__dirname, 'build', 'icon.ico'),
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false // <--- AQUI DESLIGAMOS O CORS
    }
  });
  
  win.loadFile('index.html');
}

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
