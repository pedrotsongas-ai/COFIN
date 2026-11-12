<div align="center">
  <img src="cofin-icon.svg" alt="COFIN Logo" width="84" height="84" />
  <h1>COFIN — Controle Financeiro Pessoal & Familiar</h1>
  <p>
    <strong>Aplicativo Desktop Offline-First em Electron</strong> com interface Glassmorphism em Bento Grid,
    motor de sincronização P2P em rede local, OCR nativo, Shadow Vault e atualizações OTA automatizadas via GitHub Releases.
  </p>

  <p>
    <img src="https://img.shields.io/badge/vers%C3%A3o-1.3.0-1A6FE0?style=for-the-badge" alt="Versão 1.3.0" />
    <img src="https://img.shields.io/badge/Electron-32.0-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron 32" />
    <img src="https://img.shields.io/badge/Windows-NSIS%20Installer-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows NSIS" />
    <img src="https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white" alt="GitHub Actions" />
    <img src="https://img.shields.io/badge/licen%C3%A7a-ISC-10B981?style=for-the-badge" alt="Licença ISC" />
  </p>
</div>

---

## Sumário

1. [Visão Geral & Arquitetura](#1-visão-geral--arquitetura)
2. [Design System & Interface (Glassmorphism + Bento Grid)](#2-design-system--interface-glassmorphism--bento-grid)
3. [Motor de Sincronização Familiar P2P (LAN)](#3-motor-de-sincronização-familiar-p2p-lan)
4. [Auto-Update OTA & Pipeline de Releases](#4-auto-update-ota--pipeline-de-releases)
5. [Segurança Desktop, Privacidade & Shadow Vault](#5-segurança-desktop-privacidade--shadow-vault)
6. [Instalação, Desenvolvimento & Build Limpo](#6-instalação-desenvolvimento--build-limpo)
7. [Funcionalidades Financeiras & Integração em Nuvem](#7-funcionalidades-financeiras--integração-em-nuvem)
8. [Atalhos de Teclado](#8-atalhos-de-teclado)
9. [Estrutura do Repositório](#9-estrutura-do-repositório)

---

## 1. Visão Geral & Arquitetura

O **COFIN** foi projetado sob arquitetura **Offline-First** com separação estrita entre Processo Principal, Preload isolado e Renderer Process:

```text
┌─────────────────────────────────────────────────────────────────────────┐
│                        RENDERER PROCESS (UI/UX)                         │
│     index.html + style.css + app.js (Vanilla JS, Chart.js, Tesseract)   │
│     Estado primário determinístico em localStorage (Zero latência)      │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
             contextBridge + Allowlist estrita (preload.js)
                                │
┌───────────────────────────────▼─────────────────────────────────────────┐
│                       MAIN PROCESS (main.js / Node)                     │
│  ┌─────────────────────┬──────────────────────┬───────────────────────┐ │
│  │   Shadow Vault      │   Motor P2P Local    │   Auto-Updater OTA    │ │
│  │   Backups .json     │   HTTP LAN :45000    │   GitHub Releases     │ │
│  │   Anti-traversal    │   x-cofin-client     │   electron-updater    │ │
│  └─────────────────────┴──────────────────────┴───────────────────────┘ │
└───────────────┬───────────────────────────────┬─────────────────────────┘
                │                               │
                ▼                               ▼
     Disco Local (.json)             Sincronização Opcional em Nuvem
   (Pasta segura escolhida)         Make.com Webhook / Microsoft OneDrive
```

### Camadas Principais
* **Main Process ([`main.js`](main.js)):** Gerencia ciclo de vida da janela (`BrowserWindow`), controles customizados de janela, proxy IPC seguro para leitura de planilhas do OneDrive, persistência de backups no Shadow Vault, servidor HTTP P2P local e integração com `electron-updater` / `electron-log`.
* **Preload Bridge ([`preload.js`](preload.js)):** Expõe exclusivamente a API congelada `window.electronAPI` com `contextIsolation` ativo, validando todos os canais `invoke` e `send` contra `ALLOWED_INVOKE_CHANNELS` e `ALLOWED_SEND_CHANNELS`.
* **Renderer Process ([`index.html`](index.html), [`app.js`](app.js), [`style.css`](style.css)):** Interface reativa sem framework pesado, com motor de conciliação financeira, faturas de cartão, simuladores, gráficos (`Chart.js`), leitura/exportação Excel (`SheetJS / xlsx`) e OCR local (`Tesseract.js`).

---

## 2. Design System & Interface (Glassmorphism + Bento Grid)

O sistema visual combina legibilidade financeira de alta densidade com profundidade translúcida:

* **Glassmorphism em Camadas:** Superfícies translúcidas (`rgba(var(--surface-rgb), ...)` + `backdrop-filter: blur(...)`) na barra superior, cartões, modais e notificações toast, com suporte nativo a **Light Mode** e **Dark Mode** via tokens CSS em [`style.css`](style.css).
* **Ambient Glow Dinâmico:** Iluminação radial contextual adaptada ao estado financeiro atual (`--ambient-glow`) e paletas personalizáveis com ícones SVG embutidos por tema.
* **Bento Grid Fluido & Drag-and-Drop:** Blocos de métricas e painéis reorganizáveis por arraste, com adaptação responsiva por **Container Queries** quando o visualizador de anexos em **Split-View 50/50** é aberto.
* **Tipografia Financeira Tabular:** Fontes `Inter` (com `cv02`, `cv03`, `cv04`, `cv11`) e `IBM Plex Mono` para alinhamento numérico exato em saldos, tabelas e faturas.
* **Micro-interações:** *Magic Move*, *Skeleton Glass* durante transições, *Spotlight Glow* sob o cursor e feedback auditivo opcional via **Web Audio API (SoundScape)**.

---

## 3. Motor de Sincronização Familiar P2P (LAN)

Para sincronizar dados financeiros entre dispositivos da mesma residência sem passar por servidores externos:

* **Servidor HTTP Embarcado:** Iniciado automaticamente pelo Main Process em `0.0.0.0:45000` (tratando `EADDRINUSE` sem interromper o app).
* **Isolamento de Rede Privada:** A função `ehIPPrivadoLAN` bloqueia requisições fora de loopback e faixas privadas RFC 1918 (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) ou endereços link-local/ULA IPv6 (`fe80::`, `fc00::`/`fd00::`).
* **Handshake & Integridade:**
  * `GET /` ou `GET /status`: retorna status operacional, IP local detectado e porta (`45000`).
  * `POST /sync`: exige o cabeçalho `x-cofin-client: COFIN-P2P/1`, limita o payload a `50 MB`, valida o JSON recebido, aplica `sanitizarStateP2P` antes de emitir o evento `receber-sync` ao Renderer e responde com o `STATE` local atualizado.
* **Segurança de Pareamento:** Suporte opcional a PIN P2P nas configurações de sincronização familiar.

---

## 4. Auto-Update OTA & Pipeline de Releases

O COFIN implementa atualizações *Over-The-Air* automatizadas diretamente pelo repositório GitHub (`pedrotsongas-ai/COFIN`):

### Fluxo em Produção (`electron-updater` + `electron-log`)
1. Ao iniciar o app empacotado, `configurarAutoUpdater()` configura `autoDownload = true`, `autoInstallOnAppQuit = true` e registra logs em disco via `electron-log`.
2. O app consulta `latest.yml` no GitHub Releases mais recente.
3. Quando há versão superior, baixa apenas os blocos diferenciais via `.blockmap` + `COFIN-Setup-<versão>.exe` e instala ao reiniciar/encerrar o aplicativo (ou sob demanda via botão **Instalar Atualização**).

### Diagnóstico Manual em Desenvolvimento
* O arquivo [`dev-app-update.yml`](dev-app-update.yml) habilita `forceDevUpdateConfig = true` ao acionar a verificação manual de atualização (`verificar-atualizacoes-agora`) na aba de Configurações/Diagnóstico OTA, permitindo inspecionar a resposta real do GitHub Releases mesmo em execução local.

### Pipeline Automatizado CI/CD ([`.github/workflows/release.yml`](.github/workflows/release.yml))
Todo push de tag semântica no padrão `v*` (ou disparo manual via `workflow_dispatch`) executa em `windows-latest`:
1. Checkout do repositório e setup do **Node.js 20**.
2. Instalação determinística de dependências com **`npm ci`** (usando o `package-lock.json` versionado).
3. Verificação de sintaxe em **`main.js`**, **`preload.js`** e **`app.js`** via `node --check`.
4. Build NSIS e publicação automática no GitHub Releases via `npx electron-builder --win --publish always`, anexando:
   * `COFIN-Setup-<versão>.exe`
   * `COFIN-Setup-<versão>.exe.blockmap`
   * `latest.yml`

---

## 5. Segurança Desktop, Privacidade & Shadow Vault

* **Hardening Electron:** `contextIsolation: true`, `nodeIntegration: false`, `webSecurity` nativa ativa, bloqueio de permissões/navegações externas inesperadas e comunicação restrita ao contrato em [`preload.js`](preload.js).
* **Shadow Vault (Auto-Backup Local):** Grava snapshots `.json` na pasta escolhida pelo usuário (ex.: pasta sincronizada no OneDrive/Google Drive), com validação de caminho anti-traversal e bloqueio de nomes inválidos antes de escrever no disco.
* **Bloqueio por PIN & Modo Stealth:** Proteção da abertura do app com PIN local e ocultação instantânea de valores monetários via `Alt + P`.
* **OCR 100% Local:** Leitura de comprovantes e faturas por imagem via `Tesseract.js` processada inteiramente na máquina, sem envio de anexos a APIs terceiras.

---

## 6. Instalação, Desenvolvimento & Build Limpo

### Pré-requisitos
* **Node.js 20 LTS** (ou 18+) e **npm** instalados ([nodejs.org](https://nodejs.org)).
* **Windows 10/11** para gerar o instalador NSIS (`.exe`).

### Executar em Modo de Desenvolvimento
```bash
# 1. Clonar o repositório
git clone https://github.com/pedrotsongas-ai/COFIN.git
cd COFIN

# 2. Instalar dependências exatamente conforme o lockfile
npm ci

# 3. Iniciar o aplicativo Electron
npm start
```
> No Windows, você também pode abrir rapidamente pelo atalho [`Iniciar COFIN.bat`](Iniciar%20COFIN.bat) após instalar as dependências.

### Gerar Instalador Windows (`.exe`) Localmente
```bash
npm run dist
```
Os artefatos empacotados serão gerados em `dist/` (ex.: `dist/COFIN-Setup-1.3.0.exe`), diretório devidamente ignorado pelo Git.

### Publicar uma Nova Versão (OTA)
1. Atualize a versão em [`package.json`](package.json), [`package-lock.json`](package-lock.json), [`app.js`](app.js) (`CURRENT_VERSION` / `APP_VERSAO`) e Patch Notes em [`index.html`](index.html).
2. Faça o commit das alterações em `main` e envie ao GitHub.
3. Crie e envie a tag correspondente (ex.: `git tag -a v1.2.2 -m "Release v1.2.2"` e `git push origin v1.2.2`) para acionar a geração e publicação automática no GitHub Releases.

---

## 7. Funcionalidades Financeiras & Integração em Nuvem

* **Conciliação & Faturas Inteligentes:** Separação estrita entre o status individual do lançamento e a liquidação da fatura (`faturaPaga`), pagamento de fatura com débito em conta corrente, restituição automática de limite e neutralidade no DRE para evitar dupla contagem.
* **Lançamento Rápido (Smart Add) & Regras Inteligentes:** Interpretação em linguagem natural (*"Uber 25,90 ontem no Nubank"*) e auto-categorização por palavras-chave configuráveis.
* **Anti-Metas & Cofres de Retenção:** Controle de tetos mensais com pacing diário seguro e reserva de patrimônio protegido fora do saldo diário disponível.
* **Simuladores & Fechamento Guiado:** Simulador *What-If*, comparativo *À Vista vs. Parcelado (CDI)* e assistente em 3 etapas para fechamento mensal.
* **Integração Make.com + OneDrive:** Envio automático em background (debounce de `1.2s`) da planilha `.xlsx` estruturada para Webhook do Make.com usando o blueprint oficial [`Cenario_COFIN_Make.json`](Cenario_COFIN_Make.json).

---

## 8. Atalhos de Teclado

| Atalho | Ação |
| :--- | :--- |
| **`Ctrl + K`** | Abre o **Spotlight Semântico** (busca global, filtros e comandos rápidos com `>`). |
| **`Ctrl + N`** | Abre o modal de **Novo Lançamento**. |
| **`Alt + P`** | Alterna o **Modo Stealth** (borra valores sensíveis na tela). |
| **`Esc`** | Fecha modais e janelas sobrepostas ativas. |
| **`Enter`** | Confirma formulários rápidos de lançamento. |
| **Arrastar e Soltar** | Solte imagens de comprovantes/cupons para leitura automática via **OCR Local**. |

---

## 9. Estrutura do Repositório

```text
COFIN/
├── .github/
│   └── workflows/
│       └── release.yml         # CI/CD Windows NSIS + publicação OTA no GitHub Releases
├── build/
│   └── icon.ico                # Ícone oficial do executável e instalador NSIS
├── app.js                      # Lógica de domínio, estado offline-first e UI renderer
├── index.html                  # Estrutura HTML, modais, tabelas e Patch Notes
├── style.css                   # Design System (Glassmorphism, Bento Grid, Light/Dark)
├── main.js                     # Main Process Electron (IPC, P2P :45000, OTA, Shadow Vault)
├── preload.js                  # Ponte segura contextBridge com allowlist de canais IPC
├── dev-app-update.yml          # Configuração de diagnóstico OTA em desenvolvimento
├── Cenario_COFIN_Make.json     # Blueprint pronto para importação no Make.com
├── cofin-icon*.png / .svg      # Ícones da aplicação e suporte opcional PWA
├── manifest.json / service-worker.js
├── Iniciar COFIN.bat           # Atalho local Windows para npm start
├── package.json
├── package-lock.json           # Lockfile versionado para builds determinísticos (npm ci)
├── .gitignore
└── README.md
```

---

<p align="center">
  <strong>COFIN</strong> · Desenvolvido com foco em privacidade local, estabilidade contábil e produtividade desktop · Licença <strong>ISC</strong>
</p>
