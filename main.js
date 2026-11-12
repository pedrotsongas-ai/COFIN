const { app, BrowserWindow, ipcMain, nativeImage, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const dotenv = require('dotenv');
const { PluggyClient } = require('pluggy-sdk');

const caminhoEnv = fs.existsSync(path.join(__dirname, '.env'))
  ? path.join(__dirname, '.env')
  : path.join(process.resourcesPath || __dirname, '.env');
dotenv.config({ path: caminhoEnv });

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

/* ================= OPEN FINANCE (PLUGGY CONNECT) ================= */
let pluggyClient = null;

function inicializarPluggyClient() {
  if (pluggyClient) return pluggyClient;

  const clientId = String(process.env.PLUGGY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.PLUGGY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) {
    return null;
  }

  pluggyClient = new PluggyClient({ clientId, clientSecret });
  return pluggyClient;
}

try {
  pluggyClient = inicializarPluggyClient();
  if (!pluggyClient) {
    console.warn('[Pluggy] Credenciais PLUGGY_CLIENT_ID/PLUGGY_CLIENT_SECRET ainda vazias no .env; aguardando configuração.');
  }
} catch (err) {
  console.warn('[Pluggy] Falha ao inicializar PluggyClient:', err && err.message ? err.message : err);
}

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

ipcMain.handle('pluggy:createConnectToken', async (_evento, params) => {
  try {
    const client = inicializarPluggyClient();
    if (!client) {
      return {
        ok: false,
        erro: 'Credenciais do Pluggy não configuradas. Preencha PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET no arquivo .env.'
      };
    }

    const { itemId, options } = sanitizarOpcoesConnectToken(params);
    const data = await client.createConnectToken(itemId, options);
    if (!data || !data.accessToken) {
      return { ok: false, erro: 'A API do Pluggy não devolveu um accessToken válido.' };
    }

    // Expõe exclusivamente o Connect Token efêmero; chaves permanentes permanecem isoladas no Main Process
    return { ok: true, accessToken: data.accessToken };
  } catch (err) {
    console.error('[Pluggy] Erro ao criar Connect Token:', err && err.message ? err.message : err);
    return {
      ok: false,
      erro: 'Erro ao solicitar Connect Token na API do Pluggy. Verifique suas credenciais e conectividade.'
    };
  }
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
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
