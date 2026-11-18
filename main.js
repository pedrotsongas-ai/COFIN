const { app, BrowserWindow, ipcMain, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const dotenv = require('dotenv');
const { PluggyClient } = require('pluggy-sdk');

function obterCaminhoArquivoEnv() {
  const localEnv = path.join(__dirname, '.env');
  if (!__dirname.includes('app.asar')) {
    return localEnv;
  }
  try {
    if (app && typeof app.getPath === 'function') {
      return path.join(app.getPath('userData'), '.env');
    }
  } catch (e) {}
  return path.join(process.resourcesPath || __dirname, '.env');
}

dotenv.config({ path: obterCaminhoArquivoEnv() });

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
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    }
  });
  mainWindow = win;

  win.maximize();
  win.show();
  win.loadFile('index.html');

  // Inicia a verificação automática somente após o renderer registrar os listeners IPC
  win.webContents.once('did-finish-load', () => {
    dispararVerificacaoInicialUpdates();
  });

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

function sanitizarNomeBackup(nomeBruto, fallbackPadrao) {
  const base = path.basename(String(nomeBruto || '').trim());
  const limpo = base.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!limpo || limpo === '.' || limpo === '..') return fallbackPadrao;
  return limpo.toLowerCase().endsWith('.json') ? limpo : `${limpo}.json`;
}

ipcMain.handle('salvar-backup', async (_evento, params) => {
  try {
    const { dadosJson, caminhoDestino, nomeArquivo } = params || {};
    if (!caminhoDestino || typeof caminhoDestino !== 'string') {
      return { ok: false, erro: 'Caminho de pasta de destino não fornecido.' };
    }
    const dirResolvido = path.resolve(caminhoDestino);
    if (!fs.existsSync(dirResolvido) || !fs.statSync(dirResolvido).isDirectory()) {
      return { ok: false, erro: `A pasta selecionada não existe ou é inválida: ${caminhoDestino}` };
    }

    const agora = new Date();
    const ano = agora.getFullYear();
    const mes = String(agora.getMonth() + 1).padStart(2, '0');
    const dia = String(agora.getDate()).padStart(2, '0');
    const fallbackPadrao = `cofin_backup_${ano}${mes}${dia}.json`;
    const nomeFinal = sanitizarNomeBackup(nomeArquivo, fallbackPadrao);
    const caminhoCompleto = path.resolve(dirResolvido, nomeFinal);

    // Garante que o destino resolvido permaneça estritamente dentro da pasta escolhida
    const prefixoDir = dirResolvido.endsWith(path.sep) ? dirResolvido : `${dirResolvido}${path.sep}`;
    if (!caminhoCompleto.startsWith(prefixoDir)) {
      return { ok: false, erro: 'Nome de arquivo inválido fora da pasta de destino.' };
    }

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

function ehHostOneDrivePermitido(hostname) {
  const host = String(hostname || '').toLowerCase();
  return /^(api\.onedrive\.com|onedrive\.live\.com|1drv\.ms|1drv\.com|.+\.sharepoint\.com|.+\.files\.1drv\.com|.+\.storage\.live\.com|.+\.livefilestore\.com)$/i.test(host);
}

ipcMain.handle('cofin:fetch-onedrive', async (_evento, urlAlvo) => {
  let parsed;
  try {
    parsed = new URL(String(urlAlvo || ''));
  } catch (e) {
    return { ok: false, status: 400, erro: 'URL inválida para OneDrive.' };
  }
  if (parsed.protocol !== 'https:' || !ehHostOneDrivePermitido(parsed.hostname)) {
    return { ok: false, status: 403, erro: 'Domínio não autorizado para proxy OneDrive.' };
  }
  try {
    const resp = await fetch(parsed.toString(), { redirect: 'follow' });
    const finalParsed = new URL(resp.url || parsed.toString());
    if (finalParsed.protocol !== 'https:' || !ehHostOneDrivePermitido(finalParsed.hostname)) {
      return { ok: false, status: 403, erro: 'Redirecionamento externo bloqueado por segurança.' };
    }
    const buf = Buffer.from(await resp.arrayBuffer());
    return {
      ok: resp.ok,
      status: resp.status,
      contentType: resp.headers.get('content-type') || '',
      dataBase64: buf.toString('base64')
    };
  } catch (err) {
    return { ok: false, status: 0, erro: err.message || 'Falha ao buscar planilha no OneDrive.' };
  }
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

function ehIPPrivadoLAN(ipBruto) {
  let ip = String(ipBruto || '').trim();
  if (ip.startsWith('::ffff:')) ip = ip.slice(7);
  if (!ip) return false;
  if (ip === '127.0.0.1' || ip === '::1') return true;
  if (/^10\./.test(ip)) return true;
  if (/^192\.168\./.test(ip)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(ip)) return true;
  if (/^(fe80:|fc00:|fd[0-9a-f]{2}:)/i.test(ip)) return true;
  return false;
}

function sanitizarStateP2P(state) {
  if (!state || typeof state !== 'object' || Array.isArray(state)) {
    return { lancamentos: [], cofres: [], metas: [] };
  }
  const copia = { ...state };
  if (copia.config && typeof copia.config === 'object') {
    const { webhookMake, ...configSeguro } = copia.config;
    copia.config = configSeguro;
  }
  return copia;
}

function obterStateLocalAtual() {
  return cacheStateLocalP2P || { lancamentos: [], cofres: [], metas: [] };
}

function responderJson(res, statusCode, objeto) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(objeto));
}

function iniciarServidorP2P() {
  if (servidorP2P) return;

  servidorP2P = http.createServer((req, res) => {
    const ipRemoto = (req.socket && req.socket.remoteAddress) || '';
    if (!ehIPPrivadoLAN(ipRemoto)) {
      responderJson(res, 403, { ok: false, erro: 'Acesso permitido apenas na rede local.' });
      return;
    }

    const caminho = String((req.url || '/').split('?')[0]);

    if (req.method === 'GET' && (caminho === '/' || caminho === '/status')) {
      responderJson(res, 200, { ok: true, app: 'COFIN', ip: obterIPLocal(), porta: PORTA_P2P });
      return;
    }

    if (req.method === 'POST' && caminho === '/sync') {
      if (req.headers['x-cofin-client'] !== 'COFIN-P2P/1') {
        responderJson(res, 401, { ok: false, erro: 'Cabeçalho de cliente COFIN P2P ausente.' });
        return;
      }

      const bodyChunks = [];
      let totalBytes = 0;
      let payloadExcedido = false;
      const LIMITE_BYTES = 50 * 1024 * 1024; // 50 MB

      req.on('data', (chunk) => {
        if (payloadExcedido) return;
        totalBytes += chunk.length;
        if (totalBytes > LIMITE_BYTES) {
          payloadExcedido = true;
          responderJson(res, 413, { ok: false, erro: 'Payload excede o limite de 50 MB.' });
          req.destroy();
          return;
        }
        bodyChunks.push(chunk);
      });

      req.on('end', () => {
        if (payloadExcedido) return;
        try {
          const rawBody = Buffer.concat(bodyChunks).toString('utf8');
          const stateParceiro = JSON.parse(rawBody);

          if (!stateParceiro || typeof stateParceiro !== 'object' || Array.isArray(stateParceiro)) {
            responderJson(res, 400, { ok: false, erro: 'O STATE enviado é malformado ou inválido.' });
            return;
          }

          const stateLocal = obterStateLocalAtual();
          enviarEventoParaFrontend('receber-sync', sanitizarStateP2P(stateParceiro));
          responderJson(res, 200, stateLocal);
        } catch (err) {
          responderJson(res, 400, { ok: false, erro: 'JSON malformado: ' + (err.message || 'Erro de leitura') });
        }
      });

      req.on('error', (err) => {
        console.error('[P2P] Erro na requisição recebida:', err);
      });
      return;
    }

    if (req.method === 'GET' || req.method === 'POST') {
      responderJson(res, 404, { ok: false, erro: 'Rota não encontrada.' });
      return;
    }

    responderJson(res, 405, { ok: false, erro: 'Método não permitido.' });
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
    cacheStateLocalP2P = sanitizarStateP2P(stateObj);
  }
});

ipcMain.handle('enviar-sync', async (_evento, payload, stateExtra) => {
  const ipBruto = (payload && typeof payload === 'object' && !Array.isArray(payload))
    ? (payload.ipParceiro || payload.ip || '')
    : String(payload || '');
  const dadosEnvio = (payload && typeof payload === 'object' && payload.stateLocal)
    ? payload.stateLocal
    : (stateExtra || obterStateLocalAtual());

  if (dadosEnvio && typeof dadosEnvio === 'object') {
    cacheStateLocalP2P = sanitizarStateP2P(dadosEnvio);
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

  const bodyStr = typeof dadosEnvio === 'string'
    ? dadosEnvio
    : JSON.stringify(sanitizarStateP2P(dadosEnvio));

  return new Promise((resolve) => {
    const opcoes = {
      hostname: host,
      port: porta,
      path: '/sync',
      method: 'POST',
      timeout: 10000,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Content-Length': Buffer.byteLength(bodyStr, 'utf8'),
        'X-Cofin-Client': 'COFIN-P2P/1'
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

/* ================= MOTOR DE AUTO-UPDATE SILENCIOSO (OTA) ================= */
let autoUpdaterConfigurado = false;

function emitirErroAutoUpdater(err, mensagemPersonalizada) {
  const mensagem = mensagemPersonalizada || ((err && err.message) ? err.message : String(err || 'Erro ao verificar atualizações.'));
  if (autoUpdater && autoUpdater.logger && typeof autoUpdater.logger.error === 'function' && err) {
    autoUpdater.logger.error(err);
  } else if (log && typeof log.error === 'function' && err) {
    log.error(err);
  }
  enviarEventoParaFrontend('update-erro', mensagem);
  return mensagem;
}

function configurarAutoUpdater() {
  if (!autoUpdater || autoUpdaterConfigurado) return;
  autoUpdaterConfigurado = true;
  try {
    autoUpdater.logger = log;
    if (autoUpdater.logger && autoUpdater.logger.transports && autoUpdater.logger.transports.file) {
      autoUpdater.logger.transports.file.level = 'info';
    }

    if (!app.isPackaged) {
      autoUpdater.forceDevUpdateConfig = true;
      const devUpdateYml = path.join(__dirname, 'dev-app-update.yml');
      if (fs.existsSync(devUpdateYml)) {
        autoUpdater.updateConfigPath = devUpdateYml;
      }
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
      emitirErroAutoUpdater(err);
    });
  } catch (err) {
    console.warn('[Auto-Update] Falha ao configurar autoUpdater:', err.message);
  }
}

function dispararVerificacaoInicialUpdates() {
  if (!autoUpdater) return;
  try {
    const checkResult = autoUpdater.checkForUpdatesAndNotify();
    if (checkResult && typeof checkResult.catch === 'function') {
      checkResult.catch((err) => {
        if (autoUpdater.logger && typeof autoUpdater.logger.error === 'function') {
          autoUpdater.logger.error(err);
        }
      });
    }
  } catch (err) {
    console.warn('[Auto-Update] Falha ao disparar verificação inicial:', err.message);
  }
}

function executarQuitAndInstall() {
  if (autoUpdater && typeof autoUpdater.quitAndInstall === 'function') {
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return { ok: true };
  }
  return { ok: false, erro: 'Módulo de atualização automática indisponível neste modo de execução.' };
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
    const msg = `Pacote "electron-updater" não está instalado (${autoUpdaterErroCarga || 'MODULE_NOT_FOUND'}). Execute "npm install" na pasta do projeto.`;
    emitirErroAutoUpdater(null, msg);
    return { ok: false, erro: msg };
  }
  try {
    const resultado = await autoUpdater.checkForUpdates();
    return {
      ok: true,
      updateInfo: (resultado && resultado.updateInfo) ? resultado.updateInfo : null
    };
  } catch (err) {
    const msg = emitirErroAutoUpdater(err);
    return { ok: false, erro: msg };
  }
});

ipcMain.handle('aplicar-atualizacao', () => executarQuitAndInstall());

ipcMain.on('aplicar-atualizacao', () => executarQuitAndInstall());

/* ================= OPEN FINANCE (PLUGGY CONNECT & CREDENCIAIS .ENV) ================= */
let pluggyClient = null;

function recarregarVariaveisEnvPluggy() {
  const caminhoEnv = obterCaminhoArquivoEnv();
  if (fs.existsSync(caminhoEnv)) {
    dotenv.config({ path: caminhoEnv, override: true });
  }
  const clientId = String(process.env.PLUGGY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PLUGGY_CLIENT_SECRET || '').trim();
  return { caminhoEnv, clientId, clientSecret, configured: Boolean(clientId && clientSecret) };
}

function inicializarPluggyClient(forcarRecriacao = false) {
  if (pluggyClient && !forcarRecriacao) return pluggyClient;

  const { clientId, clientSecret, configured } = recarregarVariaveisEnvPluggy();
  if (!configured) {
    pluggyClient = null;
    return null;
  }

  pluggyClient = new PluggyClient({ clientId, clientSecret });
  return pluggyClient;
}

try {
  pluggyClient = inicializarPluggyClient();
  if (!pluggyClient) {
    console.warn('[Pluggy] Credenciais PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET ainda vazias no .env; aguardando configuração pela interface.');
  }
} catch (err) {
  console.warn('[Pluggy] Falha ao inicializar PluggyClient:', err && err.message ? err.message : err);
}

function sanitizarValorEnv(valor) {
  return String(valor || '').replace(/[\r\n\0]/g, '').trim();
}

function atualizarConteudoEnv(conteudoAtual, novasChaves) {
  const linhas = String(conteudoAtual || '').split(/\r?\n/);
  const chavesRestantes = new Set(Object.keys(novasChaves));
  const linhasAtualizadas = linhas.map((linha) => {
    const match = linha.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!match) return linha;
    const chave = match[1];
    if (!Object.prototype.hasOwnProperty.call(novasChaves, chave)) return linha;
    chavesRestantes.delete(chave);
    return `${chave}=${novasChaves[chave]}`;
  });

  for (const chave of chavesRestantes) {
    if (linhasAtualizadas.length === 1 && linhasAtualizadas[0] === '') {
      linhasAtualizadas[0] = `${chave}=${novasChaves[chave]}`;
    } else {
      linhasAtualizadas.push(`${chave}=${novasChaves[chave]}`);
    }
  }

  const textoFinal = linhasAtualizadas.join('\n').replace(/\n+$/, '') + '\n';
  return textoFinal;
}

ipcMain.handle('pluggy:checkCredentials', async () => {
  try {
    const { configured } = recarregarVariaveisEnvPluggy();
    return { ok: true, configured, hasCredentials: configured };
  } catch (err) {
    console.error('[Pluggy] Erro ao verificar credenciais:', err && err.message ? err.message : err);
    return { ok: false, configured: false, hasCredentials: false, erro: 'Falha ao verificar credenciais do Pluggy.' };
  }
});

ipcMain.handle('pluggy:saveCredentials', async (_evento, params) => {
  try {
    const payload = (params && typeof params === 'object') ? params : {};
    const clientId = sanitizarValorEnv(payload.clientId || payload.PLUGGY_CLIENT_ID);
    const clientSecret = sanitizarValorEnv(payload.clientSecret || payload.PLUGGY_CLIENT_SECRET);

    if (!clientId || !clientSecret) {
      return {
        ok: false,
        erro: 'Informe tanto o PLUGGY_CLIENT_ID quanto o PLUGGY_CLIENT_SECRET.'
      };
    }

    const caminhoEnv = obterCaminhoArquivoEnv();
    const conteudoExistente = fs.existsSync(caminhoEnv) ? fs.readFileSync(caminhoEnv, 'utf8') : '';
    const novoConteudo = atualizarConteudoEnv(conteudoExistente, {
      PLUGGY_CLIENT_ID: clientId,
      PLUGGY_CLIENT_SECRET: clientSecret
    });

    fs.writeFileSync(caminhoEnv, novoConteudo, { encoding: 'utf8', mode: 0o600 });

    process.env.PLUGGY_CLIENT_ID = clientId;
    process.env.PLUGGY_CLIENT_SECRET = clientSecret;
    dotenv.config({ path: caminhoEnv, override: true });
    inicializarPluggyClient(true);

    return { ok: true, configured: true, hasCredentials: true };
  } catch (err) {
    console.error('[Pluggy] Erro ao salvar credenciais no .env:', err && err.message ? err.message : err);
    return {
      ok: false,
      erro: 'Não foi possível gravar as credenciais no ficheiro .env.'
    };
  }
});

function sanitizarOpcoesConnectToken(opcoesBrutas) {
  if (!opcoesBrutas || typeof opcoesBrutas !== 'object' || Array.isArray(opcoesBrutas)) {
    return { itemId: undefined, options: undefined };
  }
  const itemId = (typeof opcoesBrutas.itemId === 'string' && opcoesBrutas.itemId.trim())
    ? opcoesBrutas.itemId.trim()
    : undefined;
  const options = {};
  if (typeof opcoesBrutas.clientUserId === 'string' && opcoesBrutas.clientUserId.trim()) {
    options.clientUserId = opcoesBrutas.clientUserId.trim().slice(0, 255);
  }
  if (typeof opcoesBrutas.avoidDuplicates === 'boolean') {
    options.avoidDuplicates = opcoesBrutas.avoidDuplicates;
  }
  if (typeof opcoesBrutas.connectorSortAlphabetically === 'boolean') {
    options.connectorSortAlphabetically = opcoesBrutas.connectorSortAlphabetically;
  }
  return {
    itemId,
    options: Object.keys(options).length > 0 ? options : undefined
  };
}

function normalizarDataTransacaoPluggy(valorData) {
  if (!valorData) return new Date().toISOString().slice(0, 10);
  if (valorData instanceof Date && !isNaN(valorData.getTime())) {
    return valorData.toISOString().slice(0, 10);
  }
  const str = String(valorData).trim();
  const mIso = str.match(/^(\d{4}-\d{2}-\d{2})/);
  if (mIso) return mIso[1];
  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function serializarContaPluggy(acc) {
  if (!acc || typeof acc !== 'object') return null;
  return {
    id: String(acc.id || ''),
    itemId: String(acc.itemId || ''),
    name: String(acc.name || acc.marketingName || 'Conta Open Finance'),
    marketingName: acc.marketingName ? String(acc.marketingName) : null,
    number: acc.number ? String(acc.number) : '',
    type: String(acc.type || 'BANK'),
    subtype: String(acc.subtype || 'CHECKING_ACCOUNT'),
    balance: typeof acc.balance === 'number' ? acc.balance : Number(acc.balance || 0),
    currencyCode: String(acc.currencyCode || 'BRL')
  };
}

function serializarTransacaoPluggy(tx, contaMeta) {
  if (!tx || typeof tx !== 'object') return null;
  return {
    id: String(tx.id || tx.providerId || ''),
    providerId: tx.providerId ? String(tx.providerId) : null,
    accountId: String(tx.accountId || (contaMeta && contaMeta.id) || ''),
    accountName: (contaMeta && contaMeta.name) ? String(contaMeta.name) : (tx.accountName ? String(tx.accountName) : ''),
    accountType: (contaMeta && contaMeta.type) ? String(contaMeta.type) : (tx.accountType ? String(tx.accountType) : ''),
    date: normalizarDataTransacaoPluggy(tx.date),
    description: String(tx.description || tx.descriptionRaw || 'Transação Open Finance').trim(),
    descriptionRaw: tx.descriptionRaw ? String(tx.descriptionRaw).trim() : null,
    amount: typeof tx.amount === 'number' ? tx.amount : Number(tx.amount || 0),
    type: String(tx.type || (Number(tx.amount) < 0 ? 'DEBIT' : 'CREDIT')),
    status: String(tx.status || 'POSTED'),
    category: tx.category ? String(tx.category) : null,
    categoryId: tx.categoryId ? String(tx.categoryId) : null,
    merchant: (tx.merchant && typeof tx.merchant === 'object')
      ? {
          name: tx.merchant.name ? String(tx.merchant.name) : '',
          businessName: tx.merchant.businessName ? String(tx.merchant.businessName) : '',
          category: tx.merchant.category ? String(tx.merchant.category) : ''
        }
      : null
  };
}

ipcMain.handle('pluggy:createConnectToken', async (_evento, params) => {
  try {
    const client = inicializarPluggyClient();
    if (!client) {
      return {
        ok: false,
        code: 'MISSING_CREDENTIALS',
        erro: 'Credenciais do Pluggy não configuradas. Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.'
      };
    }

    const { itemId, options } = sanitizarOpcoesConnectToken(params);
    const data = await client.createConnectToken(itemId, options);
    if (!data || !data.accessToken) {
      return { ok: false, erro: 'A API do Pluggy não devolveu um accessToken válido.' };
    }

    return { ok: true, accessToken: data.accessToken };
  } catch (err) {
    console.error('[Pluggy] Erro ao criar Connect Token:', err && err.message ? err.message : err);
    return {
      ok: false,
      erro: 'Erro ao solicitar Connect Token na API do Pluggy. Verifique suas credenciais e conectividade.'
    };
  }
});

/* ================= SERVIDOR LOOPBACK LOCAL (127.0.0.1:45001) & PERSISTÊNCIA DE ITEM_IDS PLUGGY ================= */
const PORTA_LOOPBACK_PLUGGY = 45001;
let servidorLoopbackPluggy = null;

function obterCaminhoArquivoPluggyItems() {
  try {
    if (app && typeof app.getPath === 'function') {
      const pastaUserData = app.getPath('userData');
      if (pastaUserData) {
        return path.join(pastaUserData, 'pluggy-items.json');
      }
    }
  } catch (_e) {}
  return path.join(__dirname, 'pluggy-items.json');
}

function lerItemIdsPersistidosPluggy() {
  const idsUnicos = new Set();

  // 1. Lê do ficheiro JSON em userData (pluggy-items.json)
  try {
    const caminhoJson = obterCaminhoArquivoPluggyItems();
    if (fs.existsSync(caminhoJson)) {
      const conteudo = JSON.parse(fs.readFileSync(caminhoJson, 'utf8'));
      const lista = Array.isArray(conteudo)
        ? conteudo
        : (conteudo && Array.isArray(conteudo.itemIds) ? conteudo.itemIds : []);
      for (const rawId of lista) {
        const limpo = sanitizarValorEnv(rawId);
        if (limpo) idsUnicos.add(limpo);
      }
    }
  } catch (_errJson) {}

  // 2. Lê também de PLUGGY_ITEM_IDS no .env / process.env
  try {
    const caminhoEnv = obterCaminhoArquivoEnv();
    if (fs.existsSync(caminhoEnv)) {
      dotenv.config({ path: caminhoEnv, override: true });
    }
    const envIds = String(process.env.PLUGGY_ITEM_IDS || '').split(',');
    for (const rawId of envIds) {
      const limpo = sanitizarValorEnv(rawId);
      if (limpo) idsUnicos.add(limpo);
    }
  } catch (_errEnv) {}

  return [...idsUnicos];
}

function salvarItemIdPersistidoPluggy(novoItemId) {
  const idLimpo = sanitizarValorEnv(novoItemId);
  if (!idLimpo) return lerItemIdsPersistidosPluggy();

  const atuais = lerItemIdsPersistidosPluggy();
  const atualizados = [idLimpo, ...atuais.filter(id => id !== idLimpo)];

  // 1. Persiste em userData/pluggy-items.json
  try {
    const caminhoJson = obterCaminhoArquivoPluggyItems();
    const dir = path.dirname(caminhoJson);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(
      caminhoJson,
      JSON.stringify({ itemIds: atualizados, updatedAt: new Date().toISOString() }, null, 2),
      { encoding: 'utf8', mode: 0o600 }
    );
  } catch (errJson) {
    console.warn('[Pluggy] Aviso ao gravar pluggy-items.json:', errJson && errJson.message ? errJson.message : errJson);
  }

  // 2. Persiste também em PLUGGY_ITEM_IDS no .env
  try {
    const caminhoEnv = obterCaminhoArquivoEnv();
    const conteudoExistente = fs.existsSync(caminhoEnv) ? fs.readFileSync(caminhoEnv, 'utf8') : '';
    const valorEnv = atualizados.join(',');
    const novoConteudo = atualizarConteudoEnv(conteudoExistente, {
      PLUGGY_ITEM_IDS: valorEnv
    });
    fs.writeFileSync(caminhoEnv, novoConteudo, { encoding: 'utf8', mode: 0o600 });
    process.env.PLUGGY_ITEM_IDS = valorEnv;
  } catch (errEnv) {
    console.warn('[Pluggy] Aviso ao atualizar PLUGGY_ITEM_IDS no .env:', errEnv && errEnv.message ? errEnv.message : errEnv);
  }

  return atualizados;
}

function encerrarServidorLoopbackPluggy() {
  return new Promise((resolve) => {
    if (!servidorLoopbackPluggy) {
      resolve();
      return;
    }
    const srv = servidorLoopbackPluggy;
    servidorLoopbackPluggy = null;
    try {
      srv.close(() => resolve());
    } catch (_e) {
      resolve();
    }
  });
}

function gerarHtmlBridgePluggyConnect(connectToken) {
  const tokenJson = JSON.stringify(String(connectToken || '')).replace(/</g, '\\u003c');
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>COFIN · Conexão Open Finance (Pluggy Connect)</title>
  <script src="https://cdn.pluggy.ai/pluggy-connect/v2.7.0/pluggy-connect.js"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: #0B1220;
      color: #F8FAFC;
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 24px;
    }
    .card {
      background: #131C31;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 16px;
      padding: 32px;
      max-width: 480px;
      width: 100%;
      text-align: center;
      box-shadow: 0 20px 50px rgba(0, 0, 0, 0.45);
    }
    .badge {
      display: inline-block;
      background: rgba(26, 111, 224, 0.2);
      color: #60A5FA;
      border: 1px solid rgba(96, 165, 250, 0.35);
      border-radius: 999px;
      padding: 4px 12px;
      font-size: 12px;
      font-weight: 600;
      margin-bottom: 14px;
    }
    h1 {
      font-size: 20px;
      font-weight: 700;
      margin-bottom: 10px;
    }
    p {
      font-size: 14px;
      line-height: 1.55;
      color: #94A3B8;
    }
    .ok-msg {
      color: #4ADE80;
      font-weight: 600;
      font-size: 15px;
      margin-top: 8px;
    }
  </style>
</head>
<body>
  <div class="card">
    <span class="badge">COFIN · Open Finance Bridge</span>
    <h1 id="status-title">Conectando ao Pluggy Connect...</h1>
    <p id="status-msg">Aguarde a abertura do assistente bancário para concluir a autenticação.</p>
  </div>
  <script>
    (function() {
      const connectToken = ${tokenJson};
      const titleEl = document.getElementById('status-title');
      const msgEl = document.getElementById('status-msg');

      if (typeof window.PluggyConnect !== 'function') {
        titleEl.textContent = 'Erro ao carregar SDK';
        msgEl.textContent = 'Não foi possível carregar o script do Pluggy Connect. Verifique sua conexão à internet.';
        return;
      }

      const pluggyConnect = new window.PluggyConnect({
        connectToken: connectToken,
        includeSandbox: true,
        onSuccess: async (itemData) => {
          const itemId = (itemData && itemData.item && itemData.item.id) || (itemData && itemData.id) || '';
          try {
            await fetch('/callback', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ itemId: itemData && itemData.item ? itemData.item.id : itemId })
            });
          } catch (e) {
            console.error('[COFIN Loopback] Erro ao enviar callback:', e);
          }
          titleEl.textContent = 'Conexão Concluída!';
          msgEl.className = 'ok-msg';
          msgEl.textContent = 'Conexão concluída! Pode fechar esta aba e voltar ao COFIN.';
        },
        onError: (err) => {
          console.error('[Pluggy Connect] Erro:', err);
          titleEl.textContent = 'Erro na conexão';
          msgEl.textContent = (err && (err.message || err.description)) || 'Ocorreu um erro durante a autenticação no Pluggy Connect.';
        },
        onClose: () => {
          if (msgEl.className !== 'ok-msg') {
            titleEl.textContent = 'Assistente encerrado';
            msgEl.textContent = 'Você pode fechar esta aba e retornar ao COFIN.';
          }
        }
      });

      pluggyConnect.init();
    })();
  </script>
</body>
</html>`;
}

async function iniciarServidorLoopbackPluggy(connectToken) {
  await encerrarServidorLoopbackPluggy();

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const urlObj = new URL(req.url || '/', `http://127.0.0.1:${PORTA_LOOPBACK_PLUGGY}`);
      const pathname = urlObj.pathname;

      if (req.method === 'GET' && (pathname === '/' || pathname === '/index.html')) {
        const html = gerarHtmlBridgePluggyConnect(connectToken);
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Cache-Control': 'no-store, no-cache, must-revalidate'
        });
        res.end(html);
        return;
      }

      if (req.method === 'POST' && pathname === '/callback') {
        const chunks = [];
        let totalBytes = 0;

        req.on('data', (chunk) => {
          totalBytes += chunk.length;
          if (totalBytes <= 64 * 1024) {
            chunks.push(chunk);
          }
        });

        req.on('end', () => {
          try {
            const rawBody = Buffer.concat(chunks).toString('utf8');
            const parsed = rawBody ? JSON.parse(rawBody) : {};
            const itemId = sanitizarValorEnv(parsed.itemId || (parsed.item && parsed.item.id));

            if (!itemId) {
              res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
              res.end(JSON.stringify({ ok: false, erro: 'itemId ausente no callback.' }));
              return;
            }

            const itemIds = salvarItemIdPersistidoPluggy(itemId);

            if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
              mainWindow.webContents.send('pluggy:itemConnected', itemId);
            }

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: true, itemId, itemIds }));

            setImmediate(() => {
              encerrarServidorLoopbackPluggy().catch(() => {});
            });
          } catch (errCallback) {
            res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ ok: false, erro: 'Payload inválido no callback.' }));
          }
        });
        return;
      }

      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Não encontrado.');
    });

    servidorLoopbackPluggy = server;

    const tentarEscutar = (porta) => {
      server.once('error', (err) => {
        if (err && err.code === 'EADDRINUSE' && porta === PORTA_LOOPBACK_PLUGGY) {
          tentarEscutar(0);
          return;
        }
        servidorLoopbackPluggy = null;
        reject(err);
      });

      server.listen(porta, '127.0.0.1', () => {
        const addr = server.address();
        const portaAtiva = (addr && typeof addr === 'object' && addr.port) ? addr.port : PORTA_LOOPBACK_PLUGGY;
        resolve({
          server,
          port: portaAtiva,
          url: `http://127.0.0.1:${portaAtiva}/`
        });
      });
    };

    tentarEscutar(PORTA_LOOPBACK_PLUGGY);
  });
}

ipcMain.handle('pluggy:openConnectInBrowser', async (_evento, params) => {
  try {
    let connectToken = '';
    if (typeof params === 'string') {
      connectToken = params.trim();
    } else if (params && typeof params === 'object') {
      connectToken = String(params.connectToken || params.accessToken || '').trim();
    }

    if (!connectToken) {
      const client = inicializarPluggyClient();
      if (!client) {
        return {
          ok: false,
          code: 'MISSING_CREDENTIALS',
          erro: 'Credenciais do Pluggy não configuradas. Configure PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET.'
        };
      }
      const { itemId, options } = sanitizarOpcoesConnectToken(params);
      const data = await client.createConnectToken(itemId, options);
      if (!data || !data.accessToken) {
        return { ok: false, erro: 'A API do Pluggy não devolveu um accessToken válido.' };
      }
      connectToken = String(data.accessToken).trim();
    }

    const loopback = await iniciarServidorLoopbackPluggy(connectToken);
    await shell.openExternal(loopback.url);

    return {
      ok: true,
      url: loopback.url,
      port: loopback.port,
      connectToken,
      accessToken: connectToken
    };
  } catch (err) {
    console.error('[Pluggy] Erro ao abrir Pluggy Connect via Loopback Bridge:', err && err.message ? err.message : err);
    return {
      ok: false,
      erro: 'Não foi possível iniciar a ponte local do Pluggy Connect no navegador.'
    };
  }
});

function calcularDataInicioPadraoPluggy(diasAtras = 365) {
  const data = new Date(Date.now() - diasAtras * 24 * 60 * 60 * 1000);
  return data.toISOString().slice(0, 10);
}

async function obterContasPluggyComFallback(client, itemIdInformado, accountType, itemIdsExtras = []) {
  const extrairContas = (accountsResponse) => {
    const rawAccounts = Array.isArray(accountsResponse)
      ? accountsResponse
      : (accountsResponse?.results || []);
    return rawAccounts.map(serializarContaPluggy).filter(Boolean);
  };

  const idLimpo = typeof itemIdInformado === 'string' ? sanitizarValorEnv(itemIdInformado) : '';
  if (idLimpo) {
    salvarItemIdPersistidoPluggy(idLimpo);
  }

  const persistidos = lerItemIdsPersistidosPluggy();
  const extrasLimpos = Array.isArray(itemIdsExtras)
    ? itemIdsExtras.map(sanitizarValorEnv).filter(Boolean)
    : [];

  const candidatos = idLimpo
    ? [idLimpo, ...extrasLimpos.filter(x => x !== idLimpo)]
    : [...new Set([...extrasLimpos, ...persistidos])];

  const contasPorId = new Map();
  let itemEmAtualizacao = false;

  for (const id of candidatos) {
    try {
      if (typeof client.fetchItem === 'function') {
        const item = await client.fetchItem(id);
        if (item) {
          console.log('[Pluggy Sync] Item:', item.id || id, 'Status:', item.status, 'Execution:', item.executionStatus);
          if (item.status === 'UPDATING') {
            itemEmAtualizacao = true;
            continue;
          }
        }
      }

      const accountsResponse = accountType
        ? await client.fetchAccounts(id, accountType)
        : await client.fetchAccounts(id);
      const listaContas = extrairContas(accountsResponse);

      for (const acc of listaContas) {
        if (acc && acc.id && !contasPorId.has(acc.id)) {
          if (!acc.itemId) acc.itemId = id;
          contasPorId.set(acc.id, acc);
        }
      }
    } catch (errItem) {
      if (idLimpo && candidatos.length === 1) {
        throw errItem;
      }
    }
  }

  const accounts = [...contasPorId.values()];
  console.log(
    '[Pluggy Sync] Contas encontradas:',
    accounts.length,
    accounts.map(a => ({ id: a.id, name: a.name, type: a.type, balance: a.balance }))
  );

  const itemIds = [...new Set([
    ...candidatos,
    ...accounts.map(a => a.itemId).filter(Boolean)
  ])];

  return {
    itemId: itemIds[0] || '',
    itemIds,
    accounts,
    updating: itemEmAtualizacao && accounts.length === 0
  };
}

ipcMain.handle('pluggy:fetchAccounts', async (_evento, params) => {
  try {
    const client = inicializarPluggyClient();
    if (!client) {
      return {
        ok: false,
        code: 'MISSING_CREDENTIALS',
        erro: 'Credenciais do Pluggy não configuradas.'
      };
    }

    const itemId = typeof params === 'string'
      ? params.trim()
      : (params && typeof params.itemId === 'string' ? params.itemId.trim() : '');
    const itemIdsExtras = (params && typeof params === 'object' && Array.isArray(params.itemIds))
      ? params.itemIds
      : [];
    const accountType = (params && typeof params === 'object' && typeof params.type === 'string' && params.type.trim())
      ? params.type.trim()
      : undefined;

    const resultado = await obterContasPluggyComFallback(client, itemId, accountType, itemIdsExtras);
    if (resultado.updating) {
      return {
        ok: false,
        status: 'UPDATING',
        erro: 'A Pluggy ainda está sincronizando os dados com o banco. Aguarde alguns segundos e clique em Sincronizar novamente.'
      };
    }

    if (!itemId && resultado.accounts.length === 0 && resultado.itemIds.length === 0) {
      return {
        ok: false,
        erro: 'Nenhum item conectado foi encontrado. Clique em "Conectar Banco (Pluggy)" e conclua a conexão no navegador.'
      };
    }

    return {
      ok: true,
      itemId: resultado.itemId,
      itemIds: resultado.itemIds,
      accounts: resultado.accounts
    };
  } catch (err) {
    console.error('[Pluggy] Erro ao buscar contas (fetchAccounts):', err && err.message ? err.message : err);
    return {
      ok: false,
      erro: 'Erro ao buscar contas conectadas na API do Pluggy.'
    };
  }
});

async function getPluggyApiKey() {
  const { clientId, clientSecret, configured } = recarregarVariaveisEnvPluggy();
  const idFinal = clientId || String(process.env.PLUGGY_CLIENT_ID || '').trim();
  const secretFinal = clientSecret || String(process.env.PLUGGY_CLIENT_SECRET || '').trim();

  if (!configured && (!idFinal || !secretFinal)) {
    throw new Error('Credenciais do Pluggy (PLUGGY_CLIENT_ID / PLUGGY_CLIENT_SECRET) não configuradas.');
  }

  const response = await fetch('https://api.pluggy.ai/auth', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json'
    },
    body: JSON.stringify({
      clientId: idFinal,
      clientSecret: secretFinal
    })
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Falha ao autenticar na API da Pluggy (HTTP ${response.status}): ${errText}`);
  }

  const data = await response.json();
  if (!data || !data.apiKey) {
    throw new Error('A API da Pluggy não retornou uma apiKey válida em /auth.');
  }

  return data.apiKey;
}

function extrairProximoCursorPluggy(data) {
  if (!data || typeof data !== 'object') return null;

  if (typeof data.nextCursor === 'string' && data.nextCursor.trim()) {
    return data.nextCursor.trim();
  }

  if (typeof data.next === 'string' && data.next.trim()) {
    const rawNext = data.next.trim();
    if (rawNext.includes('after=') || rawNext.includes('cursor=') || rawNext.startsWith('http') || rawNext.startsWith('?') || rawNext.startsWith('/')) {
      try {
        const parsedUrl = new URL(rawNext, 'https://api.pluggy.ai');
        const cursorParam = parsedUrl.searchParams.get('cursor') || parsedUrl.searchParams.get('after');
        if (cursorParam && cursorParam.trim()) {
          return cursorParam.trim();
        }
      } catch (_e) {}
    }
    return rawNext;
  }

  return null;
}

async function fetchTransactionsV2(apiKey, accountId, from) {
  const MAX_PAGES = 30;
  const allTransactions = [];
  let cursor = null;
  let usarFormatoDateFromAfter = false;
  const fromFiltro = (typeof from === 'string' && from.trim()) ? from.trim() : '';

  for (let page = 0; page < MAX_PAGES; page++) {
    const paramData = fromFiltro
      ? (usarFormatoDateFromAfter ? `&dateFrom=${encodeURIComponent(fromFiltro)}` : `&from=${encodeURIComponent(fromFiltro)}`)
      : '';
    let url = usarFormatoDateFromAfter
      ? `https://api.pluggy.ai/v2/transactions?accountId=${encodeURIComponent(accountId)}${paramData}`
      : `https://api.pluggy.ai/v2/transactions?accountId=${encodeURIComponent(accountId)}${paramData}&pageSize=500`;

    if (cursor) {
      url += usarFormatoDateFromAfter
        ? `&after=${encodeURIComponent(cursor)}`
        : `&cursor=${encodeURIComponent(cursor)}`;
    }

    let response = await fetch(url, {
      method: 'GET',
      headers: {
        'X-API-KEY': apiKey,
        'Accept': 'application/json'
      }
    });

    // Fallback automático caso o validador estrito do /v2/transactions exija dateFrom/after sem pageSize
    if (response.status === 400 && !usarFormatoDateFromAfter) {
      usarFormatoDateFromAfter = true;
      const retryDataParam = fromFiltro ? `&dateFrom=${encodeURIComponent(fromFiltro)}` : '';
      let retryUrl = `https://api.pluggy.ai/v2/transactions?accountId=${encodeURIComponent(accountId)}${retryDataParam}`;
      if (cursor) {
        retryUrl += `&after=${encodeURIComponent(cursor)}`;
      }
      response = await fetch(retryUrl, {
        method: 'GET',
        headers: {
          'X-API-KEY': apiKey,
          'Accept': 'application/json'
        }
      });
    }

    if (!response.ok) {
      const errText = await response.text().catch(() => '');
      throw new Error(`Falha em GET /v2/transactions (HTTP ${response.status}): ${errText}`);
    }

    const data = await response.json();
    const results = Array.isArray(data)
      ? data
      : (Array.isArray(data && data.results) ? data.results : []);

    allTransactions.push(...results);

    const proximoCursor = extrairProximoCursorPluggy(data);
    if (!proximoCursor || proximoCursor === cursor || results.length === 0) {
      break;
    }
    cursor = proximoCursor;
  }

  return allTransactions;
}

ipcMain.handle('pluggy:fetchTransactions', async (_evento, params) => {
  try {
    const client = inicializarPluggyClient();
    if (!client) {
      return {
        ok: false,
        code: 'MISSING_CREDENTIALS',
        erro: 'Credenciais do Pluggy não configuradas.'
      };
    }

    const accountId = typeof params === 'string'
      ? params.trim()
      : (params && typeof params.accountId === 'string' ? params.accountId.trim() : '');

    if (!accountId) {
      return { ok: false, erro: 'O parâmetro accountId é obrigatório para buscar transações no Pluggy.' };
    }

    const fromInformado = (params && typeof params === 'object') ? (params.from || params.dateFrom) : '';
    const from = (typeof fromInformado === 'string' && fromInformado.trim())
      ? fromInformado.trim()
      : '';

    const contaMeta = (params && typeof params === 'object' && params.accountMeta) ? params.accountMeta : null;
    const nomeContaLog = (contaMeta && contaMeta.name) ? contaMeta.name : accountId;

    const apiKey = await getPluggyApiKey();
    const txs = await fetchTransactionsV2(apiKey, accountId, from);
    console.log('[Pluggy Sync] Transações da conta', nomeContaLog, ':', txs.length);

    const transactions = txs
      .map((tx) => {
        const serializada = serializarTransacaoPluggy(tx, contaMeta);
        if (!serializada) return null;
        return {
          ...serializada,
          accountName: (contaMeta && contaMeta.name) || serializada.accountName || '',
          accountType: (contaMeta && contaMeta.type) || serializada.accountType || ''
        };
      })
      .filter(Boolean);

    return { ok: true, transactions };
  } catch (err) {
    console.error('[Pluggy] Erro ao buscar transações (fetchTransactions):', err && err.message ? err.message : err);
    return {
      ok: false,
      erro: 'Erro ao buscar transações da conta na API do Pluggy.'
    };
  }
});

ipcMain.handle('pluggy:syncItem', async (_evento, params) => {
  try {
    const client = inicializarPluggyClient();
    if (!client) {
      return {
        ok: false,
        code: 'MISSING_CREDENTIALS',
        erro: 'Credenciais do Pluggy não configuradas.'
      };
    }

    const itemIdInformado = typeof params === 'string'
      ? params.trim()
      : (params && typeof params.itemId === 'string' ? params.itemId.trim() : '');
    const itemIdsExtras = (params && typeof params === 'object' && Array.isArray(params.itemIds))
      ? params.itemIds
      : [];

    if (itemIdInformado) {
      salvarItemIdPersistidoPluggy(itemIdInformado);
    }

    const persistidos = lerItemIdsPersistidosPluggy();
    const extrasLimpos = itemIdsExtras.map(sanitizarValorEnv).filter(Boolean);
    const itemIdsParaSincronizar = itemIdInformado
      ? [itemIdInformado, ...extrasLimpos.filter(x => x !== itemIdInformado)]
      : [...new Set([...extrasLimpos, ...persistidos])];

    if (itemIdsParaSincronizar.length === 0) {
      return {
        ok: false,
        erro: 'Nenhum item conectado foi encontrado. Clique em "Conectar Banco (Pluggy)" e conclua a conexão no navegador.'
      };
    }

    const fromInformado = (params && typeof params === 'object') ? (params.from || params.dateFrom) : '';
    const from = (typeof fromInformado === 'string' && fromInformado.trim())
      ? fromInformado.trim()
      : '';

    const contasPorId = new Map();

    for (const itemId of itemIdsParaSincronizar) {
      // 1. Verifica o status do Item antes de buscar
      if (typeof client.fetchItem === 'function') {
        const item = await client.fetchItem(itemId);
        if (item) {
          console.log('[Pluggy Sync] Item:', item.id || itemId, 'Status:', item.status, 'Execution:', item.executionStatus);
          if (item.status === 'UPDATING') {
            return {
              ok: false,
              status: 'UPDATING',
              erro: 'A Pluggy ainda está sincronizando os dados com o banco. Aguarde alguns segundos e clique em Sincronizar novamente.'
            };
          }
        }
      }

      // 2. Busca todas as contas do Item (BANK e CREDIT) lendo .results com segurança
      const accountsResponse = await client.fetchAccounts(itemId);
      const rawAccounts = Array.isArray(accountsResponse)
        ? accountsResponse
        : (accountsResponse?.results || []);
      const accountsDoItem = rawAccounts.map(serializarContaPluggy).filter(Boolean);

      for (const acc of accountsDoItem) {
        if (acc && acc.id && !contasPorId.has(acc.id)) {
          if (!acc.itemId) acc.itemId = itemId;
          contasPorId.set(acc.id, acc);
        }
      }
    }

    const accounts = [...contasPorId.values()];
    console.log(
      '[Pluggy Sync] Contas encontradas:',
      accounts.length,
      accounts.map(a => ({ id: a.id, name: a.name, type: a.type, balance: a.balance }))
    );

    // 3. Autentica via POST /auth e busca transações via GET /v2/transactions com cursor pagination
    const apiKey = accounts.length > 0 ? await getPluggyApiKey() : '';
    const transactions = [];

    for (const account of accounts) {
      const txs = await fetchTransactionsV2(apiKey, account.id, from);
      console.log('[Pluggy Sync] Transações da conta', account.name, ':', txs.length);

      for (const tx of txs) {
        const serializada = serializarTransacaoPluggy(tx, account);
        if (serializada) {
          transactions.push({
            ...serializada,
            accountName: account.name,
            accountType: account.type
          });
        }
      }
    }

    return {
      ok: true,
      itemId: itemIdsParaSincronizar[0] || '',
      itemIds: itemIdsParaSincronizar,
      accounts: accounts.map(a => ({
        id: a.id,
        itemId: a.itemId || itemIdsParaSincronizar[0] || '',
        name: a.name,
        marketingName: a.marketingName || null,
        number: a.number || '',
        type: a.type,
        subtype: a.subtype || 'CHECKING_ACCOUNT',
        balance: typeof a.balance === 'number' && Number.isFinite(a.balance) ? a.balance : Number(a.balance || 0),
        currencyCode: a.currencyCode || 'BRL'
      })),
      transactions
    };
  } catch (err) {
    console.error('[Pluggy] Erro ao sincronizar item (syncItem):', err && err.message ? err.message : err);
    return {
      ok: false,
      erro: 'Erro ao sincronizar contas e transações na API do Pluggy.'
    };
  }
});

/* ================= INTERCETOR GLOBAL DE WEBCONTENTS (POP-UPS & PROTEÇÃO DA JANELA PRINCIPAL) ================= */
app.on('web-contents-created', (event, contents) => {
  // 1. Interceta pop-ups (window.open): permite janela filha nativa para about:blank e pluggy.ai (mantendo window.opener / postMessage)
  if (typeof contents.setWindowOpenHandler === 'function') {
    contents.setWindowOpenHandler((details) => {
      const url = (details && typeof details.url === 'string') ? details.url : '';
      console.log('[Pluggy Popup]', url);

      if (!url || url === 'about:blank' || url.startsWith('about:blank') || url.toLowerCase().includes('pluggy.ai')) {
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            webPreferences: {
              nodeIntegration: false,
              contextIsolation: true
            }
          }
        };
      }

      if (url.startsWith('http://') || url.startsWith('https://')) {
        shell.openExternal(url);
        return { action: 'deny' };
      }

      return { action: 'allow' };
    });
  }

  // 2. Protege estritamente a janela principal (mainWindow) contra saída do index.html, permitindo livre navegação nas janelas filhas (pop-ups OAuth)
  contents.on('will-navigate', (event, url) => {
    if (!mainWindow || mainWindow.isDestroyed() || !mainWindow.webContents || contents !== mainWindow.webContents) {
      return;
    }
    const targetUrl = typeof url === 'string'
      ? url
      : (event && typeof event.url === 'string' ? event.url : '');
    if (targetUrl.toLowerCase().includes('pluggy.ai')) {
      return;
    }
    if (targetUrl.startsWith('http://') || targetUrl.startsWith('https://')) {
      event.preventDefault();
      shell.openExternal(targetUrl);
    }
  });
});

app.whenReady().then(() => {
  configurarAutoUpdater();
  createWindow();
  iniciarServidorP2P();

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
  if (servidorLoopbackPluggy) {
    try { servidorLoopbackPluggy.close(); } catch (e) {}
    servidorLoopbackPluggy = null;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
