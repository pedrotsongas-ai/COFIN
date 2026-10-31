# 📊 COFIN — Controle Financeiro Pessoal & Familiar

> Sistema desktop executável (Electron) para controle financeiro de alta produtividade, offline-first, com design Bento Grid Glassmorphism, automações inteligentes, OCR local e sincronização em nuvem via Make.com e OneDrive.

---

## 📑 Sumário
1. [Visão Geral & Arquitetura](#-visão-geral--arquitetura)
2. [Como Iniciar e Gerar o Executável (.exe)](#-como-iniciar-e-gerar-o-executável-exe)
3. [Guia de Funcionalidades do Painel](#-guia-de-funcionalidades-do-painel)
4. [Conexão e Automação com o Make.com](#-conexão-e-automação-com-o-makecom)
5. [Segurança & Sistema de Auto-Backup (Shadow Vault)](#-segurança--sistema-de-auto-backup-shadow-vault)
6. [Atalhos de Teclado & Dicas de Produtividade](#-atalhos-de-teclado--dicas-de-produtividade)

---

## 🏛 Visão Geral & Arquitetura

O **COFIN** foi desenvolvido para unir o melhor de dois mundos:
* **Velocidade e Privacidade Total:** Seus dados residem primariamente no armazenamento local (`localStorage`), funcionando 100% offline, sem depender de servidores lentos para abrir telas ou registrar despesas.
* **Sincronização em Nuvem sob Demanda:** Conecta-se via Webhooks ao **Make.com** e/ou API direta da **Microsoft Graph (OneDrive)** para espelhar seus lançamentos em planilhas Excel (`.xlsx`) estruturadas.

```
┌────────────────────────────────────────────────────────┐
│                   APLICATIVO COFIN                     │
│  (Electron + Vanilla JS + Glassmorphism + Bento Grid)  │
└───────────────┬────────────────────────┬───────────────┘
                │                        │
       [Operação Diária]         [Webhook em Background]
                ▼                        ▼
        Armazenamento Local           Make.com
           (Offline-First)       (Cenário Automatizado)
                │                        │
                ▼                        ▼
          Shadow Vault            Microsoft OneDrive
       (Auto-Backup .json)      (Planilha .xlsx na Nuvem)
```

---

## 🚀 Como Iniciar e Gerar o Executável (.exe)

### Pré-requisitos
* Ter o **Node.js** instalado no computador (versão 18+ recomendada). Baixe em [nodejs.org](https://nodejs.org).

### 1. Iniciar em Modo de Desenvolvimento
Para abrir a janela do COFIN imediatamente:
* Dê duplo clique no arquivo: **`Iniciar COFIN.bat`**
* *Ou via terminal na pasta do projeto:*
  ```bash
  npm start
  ```

### 2. Gerar o Instalador Executável (.exe)
Para empacotar o aplicativo num instalador profissional para Windows:
1. Abra o terminal na pasta do COFIN.
2. Execute o comando:
   ```bash
   npm run dist
   ```
3. Aguarde o empacotamento finalizar.
4. O instalador final estará pronto dentro da pasta **`dist/`** (ex: `COFIN Setup 1.0.0.exe`).

---

## 🧭 Guia de Funcionalidades do Painel

### 1. Dashboard Fluido (Bento Grid)
* **Design Responsivo & Sem Vácuos:** Os blocos de métricas, gráficos e saldos adaptam-se dinamicamente à largura da janela. Linhas com 1, 2 ou 3 cards expandem fluidamente sem deixar buracos pretos.
* **Drag & Drop (Organização Livre):** Clique e arraste qualquer cartão ou KPI para reordenar o painel como preferir. A sua ordem personalizada é salva automaticamente.

### 2. Lançamento Rápido em Linguagem Natural (Smart Add)
Na aba **Lançamentos**, digite naturalmente na barra de lançamento rápido e pressione `Enter`:
* *"Uber 25,90 ontem no Nubank"* $\rightarrow$ Detecta a categoria **Transporte**, a data de ontem, o valor de **R$ 25,90** e a conta **Nubank**.
* *"Ifood 45 hoje no Inter"* $\rightarrow$ Detecta **Alimentação**, data de hoje e conta **Inter**.
* *"Recebi 1500 freela na Carteira"* $\rightarrow$ Registra como **Receita**, categoria **Freelance**.

### 3. Spotlight Semântico (`Ctrl + K`)
Pressione **`Ctrl + K`** (ou `Cmd + K` no Mac) em qualquer tela para abrir a busca global:
* Digite qualquer termo para encontrar transações por descrição, valor ou categoria.
* Digite **`>`** para acessar comandos rápidos (ex: `> nova despesa`, `> novo cofre`, `> tema`).
* Use filtros como *"mês passado"*, *"este mês"*, *"receitas"* ou *"despesas"*.

### 4. Dropzone Universal com OCR Local (Tesseract.js)
* **Arrastar e Soltar:** Arraste qualquer imagem de recibo, cupom fiscal ou comprovante diretamente para a janela do aplicativo.
* **Processamento 100% Local:** O motor OCR (Tesseract.js) lê a imagem no seu computador (sem enviar para servidores externos), extrai data, valor e estabelecimento, e preenche o modal de lançamento automaticamente.

### 5. Smart Rules (Regras Inteligentes de Categorização)
* Acesse **Configurações** $\rightarrow$ **Regras Inteligentes**.
* Cadastre palavras-chave (ex: *"Netflix"*, *"Mercado Livre"*, *"Posto"*).
* Quando um lançamento é digitado ou lido pelo OCR com essa palavra, a categoria e a conta correspondentes são preenchidas sozinhas.

### 6. Anti-Metas (Redução de Hábitos Nocivos)
* Defina um teto mensal para categorias que deseja controlar (ex: Delivery, Bebidas, Compras por impulso).
* O widget circular exibe a porcentagem consumida com código de cores:
  * **Verde/Azul:** Sob controle (< 80%).
  * **Laranja:** Atenção (80% a 100%).
  * **Vermelho:** Teto estourado (> 100%).
* Mostra métricas de **Pacing Diário Seguro** (quanto ainda pode gastar por dia até o final do mês).

### 7. Cartões de Crédito & Faturas Inteligentes
* Na aba **Cartões**, cadastre o limite, dia de fechamento e dia de vencimento.
* O sistema agrupa automaticamente despesas por competência de fatura e sinaliza o limite comprometido vs. limite disponível em tempo real.

### 8. Metas & Cofres de Retenção
* O dinheiro guardado em Metas/Cofres é **protegido do seu Saldo Disponível** diário (para você não gastar por engano), mas continua somando no seu **Patrimônio Total**.
* Acompanhe a trilha de progresso com marcos e estimativa de tempo para conclusão.

### 9. Fechamento do Mês Guiado & Simuladores
* **Fechamento do Mês:** Localizado na barra de ferramentas do Dashboard. Um passo a passo em 3 etapas para conciliar contas, quitar pendências e fechar o mês com segurança.
* **Simuladores Financeiros:**
  * **Simulador What-If:** Avalia o impacto de uma compra no orçamento do mês antes de realizá-la.
  * **Simulador À Vista vs. Parcelado:** Compara o desconto à vista contra o rendimento do dinheiro aplicado no CDI.

---

## ⚡ Conexão e Automação com o Make.com

O COFIN permite sincronizar automaticamente todas as suas finanças com uma planilha Excel no **OneDrive** através de um cenário no **Make.com**.

### Como funciona o fluxo:
1. Sempre que você cria, edita ou apaga um lançamento, o COFIN aguarda 1.2 segundos (debounce) e gera um arquivo Excel virtual com o cabeçalho oficial:
   ```
   [ID, Data, Descrição, Categoria, Conta, Tipo, Valor, Status, Observação, Parcela, Fixo/Recorrente, Hashtags, Garantia Fim, Reembolso]
   ```
2. O aplicativo converte esse Excel para **Base64** e faz uma requisição HTTP `POST` para o seu Webhook do Make.com.
3. O Make.com decodifica o arquivo e substitui a planilha `controle-financeiro.xlsx` no seu OneDrive.

### Como Conectar no Make.com (Sincronização em Nuvem)

Para sincronizar seus lançamentos com a sua própria conta do OneDrive e do Make.com, siga os passos abaixo:

---

#### 📥 Passo 1: Importar o Modelo no Make.com
1. Crie uma conta gratuita em [make.com](https://www.make.com).
2. No painel do Make, clique em **"Scenarios"** $\rightarrow$ **"Create a new scenario"**.
3. Na barra inferior da tela, clique no botão de **três pontinhos (`...`)** e selecione **"Import Blueprint"**.
4. Escolha o arquivo de modelo **`Cenario_COFIN_Make.json`** fornecido junto com o aplicativo.
5. **Pronto!** O cenário completo será montado automaticamente na sua tela com todos os módulos e parâmetros necessários.

---

#### 🔑 Passo 2: Conectar o OneDrive e Ativar o Webhook
1. Clique sobre o módulo do **OneDrive** e conecte a sua conta Microsoft (botão *"Add"*).
2. Clique sobre o módulo **Custom Webhook**, clique em *"Add"* para gerar a sua chave exclusiva e **copie a URL do Webhook** gerada (ex: `https://hook.us2.make.com/...`).
3. Ligue a chave do cenário no canto inferior esquerdo para **"ON"** (Ativo) e clique no disquete para Salvar.

---

#### 🔗 Passo 3: Colar a URL no COFIN
1. Abra o aplicativo **COFIN**.
2. No menu lateral, acesse **Sincronizar OneDrive**.
3. No campo **"URL do Webhook do Make.com"**, cole a URL gerada no Passo 2.
4. No campo **"Link de compartilhamento da planilha"**, cole o link público gerado na sua planilha do OneDrive.
5. Pronto! A partir de agora, qualquer lançamento feito no aplicativo será enviado e salvo automaticamente na sua própria nuvem.

---

#### 🛠 Como Montar o Cenário Manualmente (Caso não use o Blueprint):
```
[1. Custom Webhook] ──► [2. Tools: Set Variable] ──► [3. OneDrive: Upload File] ──► [4. Webhook Response]
```

1. **Módulo 1 — Webhooks $\rightarrow$ Custom Webhook:**
   * Crie um Webhook e copie a URL gerada.
   * O payload recebido será: `{ "arquivoBase64": "..." }`.
2. **Módulo 2 — Tools $\rightarrow$ Set Variable (Converter Base64):**
   * Variable Name: `arquivoBinario`
   * Variable Value: `toBinary(1.arquivoBase64; "base64")`
3. **Módulo 3 — Microsoft OneDrive $\rightarrow$ Upload a File:**
   * Conecte sua conta Microsoft.
   * Folder: Selecione a pasta de destino (ex: `/COFIN`).
   * File Name: `controle-financeiro.xlsx`.
   * Data: Mapeie a variável `arquivoBinario` do Módulo 2.
   * Overwrite: **Yes** (para sempre atualizar o mesmo arquivo).
4. **Módulo 4 — Webhooks $\rightarrow$ Webhook Response:**
   * Status: `200`
   * Body: `{"sucesso": true}`

---

## 🛡 Segurança & Sistema de Auto-Backup (Shadow Vault)

Além da nuvem, o COFIN conta com uma camada de segurança local silenciosa chamada **Shadow Vault**:

1. Acesse **Configurações** $\rightarrow$ secção **Segurança e Backups**.
2. Clique em **"Selecionar Pasta de Backup"** e escolha uma pasta segura no seu computador (por exemplo, uma pasta sincronizada com o Google Drive, Dropbox ou OneDrive).
3. **Auto-Backup Silencioso:** A cada 7 dias (ou sempre que fechar o app), o COFIN gera um arquivo com carimbo de data (ex: `cofin_backup_20261031.json`) sem interromper o seu trabalho.
4. **Restaurar Backup:** Caso troque de computador ou precise recuperar dados, utilize o botão **"Restaurar Backup"** para carregar o arquivo `.json` instantaneamente.
5. **Bloqueio por PIN:** Em Configurações, cadastre um PIN de 4 a 6 dígitos para exigir senha toda vez que o sistema for aberto.

---

## ⌨️ Atalhos de Teclado & Dicas de Produtividade

| Atalho | Ação |
| :--- | :--- |
| **`Ctrl + K`** | Abre o **Spotlight Semântico** (busca rápida e comandos em qualquer tela). |
| **`Alt + P`** | Alterna o **Stealth Mode** (borra todos os valores monetários na tela para uso em público). |
| **`Ctrl + N`** | Abre o modal para criar um **Novo Lançamento**. |
| **`Esc`** | Fecha qualquer modal ou janela sobreposta ativa. |
| **`Enter`** | Salva formulários rápidos (no campo de valor ou texto). |
| **`Arrastar Arquivo`** | Solte qualquer comprovante/fatura sobre o app para leitura via **OCR Local**. |

---

*COFIN — Desenvolvido com foco em velocidade, autonomia e soberania financeira.*

