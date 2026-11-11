const { app, BrowserWindow, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');

function criarFallbackLogger() {
  const gravarArquivo = (nivel, args) => {
    try {
      const pastaLogs = app && typeof app.getPath === 'function' ? app.getPath('logs') : __dirname;
      const arquivoLog = path.join(pastaLogs, 'cofin-updater-fallback.log');
      const linha = `[${new Date().toISOString()}] [${nivel}] ${args.map(a => (a instanceof Error ? (a.stack || a.message) : String(a))).join(' ')}\n`;
      fs.appendFileSync(arquivoLog, linha, 'utf8');
    } catch (e) {}
  };
  return {
    transports: { file: { level: 'info' } },
    info: (...args) => { console.log('[Auto-Update][INFO]', ...args); gravarArquivo('INFO', args); },
    warn: (...args) => { console.warn('[Auto-Update][WARN]', ...args); gravarArquivo('WARN', args); },
    error: (...args) => { console.error('[Auto-Update][ERROR]', ...args); gravarArquivo('ERROR', args); },
    debug: (...args) => { console.debug('[Auto-Update][DEBUG]', ...args); gravarArquivo('DEBUG', args); }
  };
}

let log = null;
try {
  log = require('electron-log');
} catch (err) {
  log = criarFallbackLogger();
}

let autoUpdater = null;
let autoUpdaterErroCarga = null;
try {
  ({ autoUpdater } = require('electron-updater'));
} catch (err) {
  autoUpdaterErroCarga = err.message || String(err);
  console.warn('[Auto-Update] Módulo electron-updater não encontrado no ambiente atual:', err.message);
}

const PORTA_P2P = 45000;
let mainWindow = null;
let servidorP2P = null;
let cacheStateLocalP2P = null;

function obterJanelaAtiva() {
  if (mainWindow && !mainWindow.isDestroyed()) return mainWindow;
  const janelas = BrowserWindow.getAllWindows();
  return janelas.find(w => !w.isDestroyed()) || null;
}

function enviarEventoParaFrontend(canal, payload) {
  const win = obterJanelaAtiva();
  if (win && win.webContents && !win.webContents.isDestroyed()) {
    try {
      win.webContents.send(canal, payload);
    } catch (e) {}
  }
}

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
  mainWindow = win;
  
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
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null;
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

/* ================= INFRAESTRUTURA P2P (REDE LOCAL PORTA 45000) ================= */
function obterIPLocal() {
  try {
    const interfaces = os.networkInterfaces() || {};
    const candidatos = [];
    for (const [nome, lista] of Object.entries(interfaces)) {
      if (!Array.isArray(lista)) continue;
      for (const iface of lista) {
        const ehIPv4 = iface.family === 'IPv4' || iface.family === 4;
        if (!ehIPv4 || iface.internal || !iface.address) continue;
        const virtual = /vethernet|vmware|virtualbox|vbox|wsl|hyper-v|docker|loopback|hamachi|tailscale/i.test(nome);
        const privadoPadrao = /^(192\.168\.|10\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(iface.address);
        candidatos.push({
          address: iface.address,
          prioridade: (virtual ? 0 : 2) + (privadoPadrao ? 1 : 0)
        });
      }
    }
    candidatos.sort((a, b) => b.prioridade - a.prioridade);
    return candidatos.length > 0 ? candidatos[0].address : '127.0.0.1';
  } catch (err) {
    console.error('[P2P] Erro ao obter IP local:', err);
    return '127.0.0.1';
  }
}

async function obterStateLocalAtual() {
  const win = obterJanelaAtiva();
  if (win && win.webContents && !win.webContents.isDestroyed()) {
    try {
      const raw = await Promise.race([
        win.webContents.executeJavaScript('localStorage.getItem("controle-financeiro-dados")', true),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout localStorage')), 2500))
      ]);
      if (raw && typeof raw === 'string') {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          cacheStateLocalP2P = parsed;
          return parsed;
        }
      }
    } catch (e) {}
  }
  return cacheStateLocalP2P || { lancamentos: [], cofres: [], metas: [] };
}

function iniciarServidorP2P() {
  if (servidorP2P) return;

  servidorP2P = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET') {
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ ok: true, app: 'COFIN', ip: obterIPLocal(), porta: PORTA_P2P }));
      return;
    }

    if (req.method === 'POST') {
      let bodyChunks = [];
      let totalBytes = 0;
      const LIMITE_BYTES = 50 * 1024 * 1024; // 50 MB

      req.on('data', (chunk) => {
        totalBytes += chunk.length;
        if (totalBytes > LIMITE_BYTES) {
          req.destroy();
          return;
        }
        bodyChunks.push(chunk);
      });

      req.on('end', async () => {
        try {
          const rawBody = Buffer.concat(bodyChunks).toString('utf8');
          const stateParceiro = JSON.parse(rawBody);

          if (!stateParceiro || typeof stateParceiro !== 'object' || Array.isArray(stateParceiro)) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, erro: 'O STATE enviado é malformado ou inválido.' }));
            return;
          }

          // Obtém o STATE local antes/durante o merge para devolver na resposta ao parceiro
          const stateLocal = await obterStateLocalAtual();

          // Envia o STATE recebido do parceiro para o frontend realizar o Merge Inteligente
          enviarEventoParaFrontend('receber-sync', stateParceiro);

          res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(stateLocal));
        } catch (err) {
          res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify({ ok: false, erro: 'JSON malformado: ' + (err.message || 'Erro de leitura') }));
        }
      });

      req.on('error', (err) => {
        console.error('[P2P] Erro na requisição recebida:', err);
      });
      return;
    }

    res.writeHead(405, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ ok: false, erro: 'Método não permitido.' }));
  });

  servidorP2P.on('error', (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`[P2P] Porta ${PORTA_P2P} já está em uso (EADDRINUSE). O servidor existente foi preservado sem travar a aplicação.`);
      return;
    }
    console.error('[P2P] Erro no servidor HTTP local:', err);
  });

  try {
    servidorP2P.listen(PORTA_P2P, '0.0.0.0', () => {
      console.log(`[P2P] Servidor de Sincronização Familiar ativo em http://${obterIPLocal()}:${PORTA_P2P}`);
    });
  } catch (err) {
    console.warn('[P2P] Falha ao iniciar escuta na porta P2P:', err.message);
  }
}

ipcMain.handle('obter-ip-local', () => {
  return obterIPLocal();
});

ipcMain.on('atualizar-cache-p2p', (_evento, stateObj) => {
  if (stateObj && typeof stateObj === 'object' && !Array.isArray(stateObj)) {
    cacheStateLocalP2P = stateObj;
  }
});

ipcMain.handle('enviar-sync', async (_evento, payload, stateExtra) => {
  const ipBruto = (payload && typeof payload === 'object' && !Array.isArray(payload))
    ? (payload.ipParceiro || payload.ip || '')
    : String(payload || '');
  const dadosEnvio = (payload && typeof payload === 'object' && payload.stateLocal)
    ? payload.stateLocal
    : (stateExtra || await obterStateLocalAtual());

  if (dadosEnvio && typeof dadosEnvio === 'object') {
    cacheStateLocalP2P = dadosEnvio;
  }

  const limpo = String(ipBruto || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/\/.*$/, '');

  if (!limpo) {
    return { ok: false, erro: 'Informe o IP do parceiro na rede local.' };
  }

  let host = limpo;
  let porta = PORTA_P2P;
  if (limpo.includes(':')) {
    const partes = limpo.split(':');
    host = partes[0].trim();
    const p = parseInt(partes[1], 10);
    if (p > 0 && p <= 65535) porta = p;
  }

  if (!host) {
    return { ok: false, erro: 'Endereço IP do parceiro inválido.' };
  }

  const bodyStr = typeof dadosEnvio === 'string' ? dadosEnvio : JSON.stringify(dadosEnvio || {});

  return new Promise((resolve) => {
    const opcoes = {
      hostname: host,
      port: porta,
      path: '/sync',
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf8')
      }
    };

    const req = http.request(opcoes, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const texto = Buffer.concat(chunks).toString('utf8');
        try {
          const json = JSON.parse(texto);
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve({ ok: true, stateParceiro: json });
          } else {
            resolve({ ok: false, erro: (json && json.erro) || `O parceiro respondeu com status HTTP ${res.statusCode}.` });
          }
        } catch (err) {
          resolve({ ok: false, erro: 'Resposta malformada recebida do parceiro.' });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy(new Error('Tempo limite excedido ao conectar com o IP do parceiro.'));
    });

    req.on('error', (err) => {
      let msg = err.message || 'Falha de conexão na rede local.';
      if (err.code === 'ECONNREFUSED') {
        msg = `Conexão recusada em ${host}:${porta}. Verifique se o COFIN está aberto no computador do parceiro.`;
      } else if (err.code === 'EHOSTUNREACH' || err.code === 'ENETUNREACH' || err.code === 'ETIMEDOUT') {
        msg = `Não foi possível alcançar ${host}:${porta} na rede local. Verifique se ambos estão no mesmo Wi-Fi/Rede.`;
      }
      resolve({ ok: false, erro: msg });
    });

    req.write(bodyStr);
    req.end();
  });
});

/* ================= MOTOR DE AUTO-UPDATE SILENCIOSO (OTA) & DEBUG ================= */
function configurarAutoUpdater() {
  if (!autoUpdater) return;
  try {
    try {
      autoUpdater.logger = require("electron-log");
      autoUpdater.logger.transports.file.level = "info";
    } catch (e) {
      autoUpdater.logger = log;
      if (autoUpdater.logger && autoUpdater.logger.transports && autoUpdater.logger.transports.file) {
        autoUpdater.logger.transports.file.level = "info";
      }
    }

    // Força verificação mesmo em modo de desenvolvimento (Dev Mode via dev-app-update.yml)
    autoUpdater.forceDevUpdateConfig = true;
    const devUpdateYml = path.join(__dirname, 'dev-app-update.yml');
    if (!app.isPackaged && fs.existsSync(devUpdateYml)) {
      autoUpdater.updateConfigPath = devUpdateYml;
    }

    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('checking-for-update', () => {
      if (autoUpdater.logger) autoUpdater.logger.info('A procurar atualizações no GitHub...');
      enviarEventoParaFrontend('update-verificando', { timestamp: Date.now() });
    });

    autoUpdater.on('update-available', (info) => {
      if (autoUpdater.logger) autoUpdater.logger.info('Nova atualização disponível:', info && info.version);
      enviarEventoParaFrontend('download-iniciado', info || {});
    });

    autoUpdater.on('update-not-available', (info) => {
      if (autoUpdater.logger) autoUpdater.logger.info('Nenhuma atualização superior encontrada no GitHub:', info && info.version);
      enviarEventoParaFrontend('update-nao-disponivel', info || {});
    });

    autoUpdater.on('update-downloaded', (info) => {
      if (autoUpdater.logger) autoUpdater.logger.info('Download da atualização concluído:', info && info.version);
      enviarEventoParaFrontend('download-concluido', info || {});
    });

    autoUpdater.on('error', (err) => {
      const mensagemErro = (err && err.message) ? err.message : String(err || 'Erro desconhecido no autoUpdater');
      if (autoUpdater.logger && typeof autoUpdater.logger.error === 'function') {
        autoUpdater.logger.error(err);
      }
      if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
        mainWindow.webContents.send('update-erro', mensagemErro);
      } else {
        enviarEventoParaFrontend('update-erro', mensagemErro);
      }
    });

    const checkResult = autoUpdater.checkForUpdatesAndNotify();
    if (checkResult && typeof checkResult.catch === 'function') {
      checkResult.catch((err) => {
        if (autoUpdater.logger && typeof autoUpdater.logger.error === 'function') {
          autoUpdater.logger.error(err);
        }
      });
    }
  } catch (err) {
    console.warn('[Auto-Update] Falha ao iniciar autoUpdater:', err.message);
  }
}

ipcMain.handle('verificar-atualizacoes-agora', async () => {
  if (!autoUpdater) {
    try {
      ({ autoUpdater } = require('electron-updater'));
      configurarAutoUpdater();
    } catch (errLoad) {
      autoUpdaterErroCarga = errLoad.message || String(errLoad);
    }
  }
  if (!autoUpdater) {
    const msg = `Pacote "electron-updater" não está instalado na pasta node_modules (${autoUpdaterErroCarga || 'MODULE_NOT_FOUND'}). Execute "npm install" na pasta do projeto.`;
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('update-erro', msg);
    }
    return { ok: false, erro: msg };
  }
  try {
    autoUpdater.forceDevUpdateConfig = true;
    const resultado = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      updateInfo: (resultado && resultado.updateInfo) ? resultado.updateInfo : null
    };
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err || 'Erro ao verificar atualizações no GitHub.');
    if (autoUpdater.logger && typeof autoUpdater.logger.error === 'function') {
      autoUpdater.logger.error(err);
    }
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('update-erro', msg);
    }
    return { ok: false, erro: msg };
  }
});

ipcMain.handle('aplicar-atualizacao', () => {
  if (autoUpdater && typeof autoUpdater.quitAndInstall === 'function') {
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  }
  return { ok: false, erro: 'Módulo de atualização automática indisponível neste modo de execução.' };
});

ipcMain.on('aplicar-atualizacao', () => {
  if (autoUpdater && typeof autoUpdater.quitAndInstall === 'function') {
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
  }
});

app.whenReady().then(() => {
  createWindow();
  iniciarServidorP2P();
  configurarAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('will-quit', () => {
  if (servidorP2P) {
    try { servidorP2P.close(); } catch (e) {}
    servidorP2P = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
