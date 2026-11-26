<div align="center">
  <img src="cofin-icon.svg" alt="COFIN Logo" width="84" height="84" />
  <h1>COFIN — Controle Financeiro Pessoal & Familiar</h1>
  <p>
    <strong>Aplicativo Desktop Offline-First em Electron</strong> com Motor de Auto-Categorização v2 (CNAE + Aprendizado Silencioso),
    Cérebro de Categorias na Nuvem via GitHub Gist Privado, Open Finance Híbrido (Pluggy v2 + OFX Drag &amp; Drop),
    integração Make.com + OneDrive, sincronização familiar P2P em rede local, OCR nativo, Shadow Vault e atualizações OTA via GitHub Releases.
  </p>

  <p>
    <img src="https://img.shields.io/badge/vers%C3%A3o-1.7.0-1A6FE0?style=for-the-badge" alt="Versão 1.7.0" />
    <img src="https://img.shields.io/badge/Electron-32.0-47848F?style=for-the-badge&logo=electron&logoColor=white" alt="Electron 32" />
    <img src="https://img.shields.io/badge/Windows-NSIS%20Installer-0078D6?style=for-the-badge&logo=windows&logoColor=white" alt="Windows NSIS" />
    <img src="https://img.shields.io/badge/CI%2FCD-GitHub%20Actions-2088FF?style=for-the-badge&logo=github-actions&logoColor=white" alt="GitHub Actions" />
    <img src="https://img.shields.io/badge/licen%C3%A7a-ISC-10B981?style=for-the-badge" alt="Licença ISC" />
  </p>
</div>

---

## Sumário

1. [Novidades da v1.7.0](#1-novidades-da-v170)
2. [Instalação e Primeiros Passos](#2-instalação-e-primeiros-passos)
3. [Guia Passo a Passo de Uso do Painel](#3-guia-passo-a-passo-de-uso-do-painel)
4. [Motor de Auto-Categorização v2 com Aprendizado](#4-motor-de-auto-categorização-v2-com-aprendizado)
5. [Cérebro de Categorias na Nuvem (GitHub Gist Privado)](#5-cérebro-de-categorias-na-nuvem-github-gist-privado)
6. [Como Conectar no Pluggy (Open Finance)](#6-como-conectar-no-pluggy-open-finance)
7. [Como Conectar no Make.com (Gravação Automática em Planilha)](#7-como-conectar-no-makecom-gravação-automática-em-planilha)
8. [Como Conectar no OneDrive (Leitura & Sincronização)](#8-como-conectar-no-onedrive-leitura--sincronização)
9. [Drag & Drop para Extratos (.OFX) e Comprovantes (OCR)](#9-drag--drop-para-extratos-ofx-e-comprovantes-ocr)
10. [Sincronização Familiar P2P, Shadow Vault e Segurança](#10-sincronização-familiar-p2p-shadow-vault-e-segurança)
11. [Atalhos de Teclado](#11-atalhos-de-teclado)
12. [Desenvolvimento, Build e Publicação OTA](#12-desenvolvimento-build-e-publicação-ota)

---

## 1. Novidades da v1.7.0

* **Cérebro de Categorias na Nuvem (GitHub Gist Privado):** Sincronização bidirecional automática de **Categorias/Subcategorias**, **Regras (`STATE.regrasCategoria`)** e **Memória Silenciosa (`STATE.memoriaCategorias`)** entre múltiplos computadores usando um Gist estritamente privado (`cofin-cerebro.json`). O Personal Access Token (`GITHUB_GIST_TOKEN`) e o `GITHUB_GIST_ID` ficam isolados no `.env` via IPC, com autodescoberta no 2º computador, tombstones para impedir ressurreição de itens excluídos, portabilidade automática de `contaId` por `contaNome`, debounce de 5 segundos e toast de reprocessamento em 1 clique.
* **Hidratação Automática do Histórico (`hidratarMemoriaDoHistorico`):** Antes do merge/push com o GitHub Gist, o COFIN extrai de forma leve e idempotente os padrões já classificados em `STATE.lancamentos` para `STATE.memoriaCategorias` (com `origem: 'historico'`), preservando escolhas manuais explícitas e tombstones.
* **Motor de Auto-Categorização v2 (Pluggy CNAE, CPF/CNPJ & Memória Silenciosa):** Aproveitamento dos metadados da API v2 da Pluggy (`cnae`, `merchantName`, `merchantCnpj`, `contraparteTipo`), **Trava Estrita de Tipo** (Receita vs. Despesa), **Memória Histórica por Tokens/Jaccard**, **Aprendizado Silencioso Automático**, **Dicionário Brasileiro ampliado** com fronteira de palavra (`\b`), neutralização prévia de repasses técnicos de **PIX no Crédito** e botão **Auto-Classificar Pendentes** na Triagem.
* **Tratamento Correto de Estornos em Cartão de Crédito:** Créditos/estornos no cartão (`CREDIT` + `receita`) agora respeitam o dia de fechamento da fatura, abatem corretamente despesas, fatura e limite disponível (sem inflar receitas no mês), são auto-categorizados como despesa efetiva e recebem selo discreto `Estorno` + valor `+ R$` em verde.

<details>
<summary><strong>Ver novidades anteriores (v1.6.0 e v1.5.0)</strong></summary>

### v1.6.0
* **Drill-Down Interativo no Dashboard e Relatórios:** Clique em KPIs, Contas Bancárias, Cartões de Crédito, barras do gráfico de 6 meses, Top 3 Gastos, Anti-Metas, Pendentes e gráficos de Relatórios para ir direto à aba **Lançamentos** com os filtros já aplicados e banner de limpeza em 1 clique.
* **Alternador "Por Data | Por Fatura" & Tag Discreta de Fatura:** A aba **Lançamentos** filtra pela data real (`l.data`) por padrão (em Tabela, Cards e Calendário), com opção rápida para auditar **Por Fatura** e selo discreto (ex.: `Fat. Dez/26`) em compras cobradas no mês seguinte.
* **Precisão Total de Datas e Fuso Horário (Pluggy, OFX & Planilha):** Função única `extrairDataLocalISO` no backend (`main.js`) e frontend (`app.js`) tratando `DD/MM/YYYY`, formato OFX, ISO meia-noite UTC sem recuar o dia, compras noturnas em UTC-3 e datas seriais do Excel, além de data editável no Modal de Revisão sincronizando `dataCompra` nos cartões.
* **Layout Responsivo & Interface Flat Dark Precision:** Sidebar compactável em janelas estreitas (`<= 1024px`), cabeçalhos fluidos, tabelas responsivas, modais adaptáveis (`min(95vw, ...)`) e dark mode sóbrio sem flares radiais nem spotlight `mousemove`.
* **Modo Seleção em Lote & Barra Fixa no Viewport:** Checkboxes de alto contraste (`#10b981`), destaque claro nas linhas/cards selecionados em `#lanc-tbody`, estado `indeterminate` em "Selecionar todos" e barra flutuante de ações em lote fixa na base da janela.

### v1.5.0
* **Motor de Auto-Categorização em 4 Camadas:** Normalizador de descrições bancárias brasileiras + classificação em cascata (**Regras do Usuário → Memória Histórica → Pluggy / Dicionário BR → Fila "A Classificar"**), preservando sempre `descricaoOriginal`.
* **Aprendizado em 1 Clique:** Toast inteligente após edição manual para criar regra automática e aplicá-la nos lançamentos antigos similares.
* **Triagem Agrupada ("Caixa de Entrada"):** Botão **Triagem (N)** na aba **Lançamentos** agrupando pendências em *"A Classificar"* e *"Outros"* por estabelecimento + tipo para classificar em lote.
* **Gerenciador de Regras & Reprocessamento Retroativo:** Regras avançadas em **Categorias & Contas** com prévia ao vivo e botão **Reprocessar Regras**.
* **Saldos 100% Unificados & Precisão em Despesas no Mês:** **Patrimônio Total** e **Saldo Disponível** alinhados ao card **Contas Bancárias**, efeito líquido zero para transferências, chip exclusivo **Transferências** e correção do fallback de `diaFechamento`.

</details>

---

## 2. Instalação e Primeiros Passos

### Opção A — Instalador Windows (Recomendado)
1. Acesse a aba **[Releases](https://github.com/pedrotsongas-ai/COFIN/releases)** do repositório.
2. Baixe o instalador mais recente: **`COFIN-Setup-1.7.0.exe`**.
3. Execute o instalador e conclua o assistente. A partir daí, futuras atualizações chegam automaticamente via **Auto-Update OTA**.

### Opção B — Executar a partir do Código-Fonte
> **Pré-requisitos:** [Node.js 20 LTS](https://nodejs.org) (ou 18+) e `npm`.

```bash
# 1. Clonar o repositório
git clone https://github.com/pedrotsongas-ai/COFIN.git
cd COFIN

# 2. Instalar dependências exatamente conforme o lockfile
npm ci

# 3. Iniciar o aplicativo Electron
npm start
```
> No Windows, após o `npm ci`, você também pode abrir o app dando duplo clique em [`Iniciar COFIN.bat`](Iniciar%20COFIN.bat).

---

## 3. Guia Passo a Passo de Uso do Painel

### Passo 1 — Cadastre suas Contas, Cartões e Categorias
1. No menu lateral, clique em **Categorias & Contas**.
2. Em **Contas / Cartões**, cadastre suas contas bancárias (ex.: *Santander*, *Nubank*) e cartões de crédito informando **Dia de fechamento**, **Dia de vencimento** e **Limite**.
   * *Dica:* Clique no ícone de balança (<i class="ti ti-scale"></i>) ao lado de uma conta bancária para conciliar rapidamente o **Saldo Inicial** com o saldo real do seu banco.
3. Em **Categorias**, personalize suas categorias principais e subcategorias (ex.: `Alimentação › Supermercado`) e defina orçamentos mensais opcionais.

### Passo 2 — Acompanhe o Dashboard
* **Saldo Disponível:** Saldo consolidado das contas bancárias descontando apenas valores reservados em **Metas & Cofres**. Sem reservas bloqueadas, bate no centavo com **Contas Bancárias**.
* **Patrimônio Total:** Soma consolidada de todas as contas bancárias (`saldoInicial + entradas efetivadas − saídas efetivadas`).
* **Receitas no mês / Despesas no mês / Resultado / Taxa de Poupança:** Calculados apenas sobre os lançamentos reais da competência do mês atual (sem transferências internas, sem pagamentos de fatura duplicados, sem despesas já reembolsadas e sem `saldoInicial`).
* **Saldo por Conta & Cartões:** Exibe o saldo individual de cada conta bancária e o resumo da fatura atual de cada cartão (com barra de limite e botão rápido de quitação).
* **Personalização:** Arraste os cards e KPIs do Dashboard para reorganizar a ordem como preferir.

### Passo 3 — Registre, Filtre e Organize Lançamentos
1. Na aba **Lançamentos** (ou via **`Ctrl + N`**), crie receitas ou despesas manualmente, com suporte a **parcelamento**, **divisão em múltiplas categorias (Split)**, **rachar conta (Split Bill)**, **reembolsável**, **garantia** e **anexo/comprovante** (visualizável em Split-View 50/50).
2. Use a barra **Lançamento Rápido (Smart Add)** no topo da aba para digitar em linguagem natural:
   * Exemplo: `"Uber 25,90 ontem no Nubank"`, `"Ifood 50 hoje Itaú"`, `"recebi 300 freela na Carteira"`.
3. Use o botão **Transferir** no topo para movimentar valores entre contas próprias — o COFIN grava automaticamente as duas pontas sincronizadas (saída na origem + entrada no destino) com efeito líquido **zero** no patrimônio global.
4. Filtre por **Todos | Receitas | Despesas | Transferências**, por status (**Pagos / Pendentes**), conta, categoria, hashtag (`#viagem`), mês ou busca por descrição (que encontra tanto o apelido quanto a `descricaoOriginal` do banco).

### Passo 4 — Cartões, Assinaturas, Metas e Relatórios
* **Cartões & Faturas:** Navegue mês a mês pelas faturas e use **Pagar Fatura** para quitar os lançamentos sem duplicar despesas no DRE.
* **Assinaturas & Recorrentes:** Cadastre contas fixas mensais e configure **Receitas Fixas (Auto-Paycheck)** por dia fixo ou dia útil em **Categorias & Contas**.
* **Metas & Cofres:** Separe reservas financeiras dentro do seu patrimônio sem perder o controle do saldo livre diário.
* **Relatórios & Simuladores:** Analise evolução patrimonial, comparativo mês a mês, *Simulador de Compra*, *À Vista vs. Parcelado (CDI)* e *Fechamento do Mês*.

---

## 4. Motor de Auto-Categorização v2 com Aprendizado

Ao importar transações (Pluggy, OFX ou Planilha na Nuvem), o COFIN neutraliza previamente ruídos operacionais (como o repasse de **PIX no Crédito** na conta corrente) e executa um **funil em 4 camadas** com **Trava Estrita de Tipo** (nunca classificando uma despesa em categoria de receita ou vice-versa, exceto estornos de cartão tratados como despesa efetiva):

1. **Camada 1 — Regras do Usuário (`STATE.regrasCategoria`):** Avalia regras ativas por **prioridade** e especificidade (`Exato` > `Começa com` > `Contém`), checando tipo, conta, faixa de valor, descrição bruta e núcleo normalizado. Pode aplicar **categoria/subcategoria**, **tag automática** e **apelido de descrição** (preservando sempre `descricaoOriginal`).
2. **Camada 2 — Memória Silenciosa & Memória Histórica por Tokens (`STATE.memoriaCategorias`):** Consulta o aprendizado silencioso gravado automaticamente em edições manuais (e hidratado do histórico anterior via `hidratarMemoriaDoHistorico`) e busca transações similares no histórico por núcleo, marca específica e similaridade de tokens (Jaccard).
3. **Camada 3 — Metadados Pluggy v2 (CNAE & CPF/CNPJ) + Dicionário BR:** Aproveita o código **CNAE**, dados do lojista (`merchantName`/`merchantCnpj`), proteção de Pix entre pessoas físicas (`#pessoa`), categorias nativas do Open Finance e Dicionário Brasileiro ampliado com correspondência segura por fronteira de palavra (`\b`).
4. **Camada 4 — Fila `"A Classificar"`:** O que não for reconhecido com confiança vai para a fila **A Classificar** (badge âmbar), evitando misturar itens desconhecidos em *"Outros"*.

### Como treinar o motor sem esforço
* **Aprendizado em 1 Clique & Silencioso:** Ao editar manualmente a categoria de um lançamento, o COFIN grava silenciosamente o padrão em `STATE.memoriaCategorias` e oferece a barra flutuante *"Sempre classificar `[nucleo]` como `[categoria]`?"* com os botões **Criar regra** e **Criar e aplicar em +N antigos**.
* **Triagem Agrupada (Caixa de Entrada):** Na aba **Lançamentos**, clique em **Triagem (N)**. Use **Auto-Classificar Pendentes** para rodar o motor v2 + saneamento de tipo/PIX no Crédito com 1 clique, ou classifique em lote por estabelecimento + tipo salvando regras automáticas.
* **Gerenciar Regras e Reprocessar:** Em **Categorias & Contas → Regras de Auto-Categorização**, clique em **+ Nova Regra** (com prévia ao vivo) ou use **Reprocessar Regras** para reaplicar retroativamente sobre *"Apenas 'A Classificar' e 'Outros'"* ou *"Todos os lançamentos não-transferência"*.

---

## 5. Cérebro de Categorias na Nuvem (GitHub Gist Privado)

Se você usa o COFIN em mais de um computador (ex.: notebook e PC de casa), pode manter **Categorias, Subcategorias, Regras de Auto-Categorização e Memória Silenciosa** sincronizados automaticamente via um **GitHub Gist Privado** (`cofin-cerebro.json`) — sem expor credenciais no `localStorage` nem em backups `.json`.

### Passo a Passo
1. **Crie um Personal Access Token no GitHub:**
   * Acesse **GitHub → Settings → Developer settings → Personal access tokens** e gere um token marcando apenas o escopo mínimo **`gist`**.
2. **Configure no COFIN (PC 1):**
   * Vá em **Categorias & Contas → Sincronização de Categorias (GitHub Gist Privado)** e clique em **Configurar Token (.env)**.
   * Informe o token (deixe o campo `Gist ID` em branco na primeira vez) e clique em **Validar e Salvar**.
   * O COFIN valida o token diretamente em `api.github.com/user`, salva `GITHUB_GIST_TOKEN` no `.env`, hidrata a memória a partir do histórico já classificado (`hidratarMemoriaDoHistorico`), cria o Gist estritamente **privado** (`public: false`) e salva o `GITHUB_GIST_ID` no `.env`.
3. **Conecte no 2º computador (PC 2):**
   * Basta informar o mesmo token no modal **Configurar Token (.env)** (o `Gist ID` é opcional, pois o COFIN localiza automaticamente seu Gist privado `cofin-cerebro.json`).
   * O merge inteligente combina categorias, regras (remapeando `contaId` automaticamente pelo `contaNome`) e memória silenciosa respeitando tombstones de exclusão, e oferece um toast em 1 clique para reprocessar lançamentos pendentes recém-cobertos pelas regras recebidas.

---

## 6. Como Conectar no Pluggy (Open Finance)

O COFIN possui integração nativa com a API **Pluggy v2** rodando no processo principal Node.js, mantendo suas chaves protegidas exclusivamente em um arquivo `.env` local (nunca expostas no `localStorage`).

### Passo a Passo
1. **Crie sua conta de desenvolvedor na Pluggy:**
   * Acesse [dashboard.pluggy.ai](https://dashboard.pluggy.ai) e crie/entre na sua conta.
   * No painel da Pluggy, crie uma aplicação (ou acesse **API Keys**) e copie o **`Client ID`** e o **`Client Secret`**.
2. **Configure as credenciais no COFIN:**
   * Abra o COFIN e vá em **Categorias & Contas → Open Finance (Pluggy Connect)**.
   * Clique em **Configurar Credenciais (.env)**.
   * Cole o **`PLUGGY_CLIENT_ID`** e o **`PLUGGY_CLIENT_SECRET`** e clique em **Salvar**.
   * *(Opcional)* Você também pode criar/editar manualmente um arquivo `.env` na raiz do projeto (ou na pasta `userData` se estiver usando o `.exe` instalado):
     ```env
     PLUGGY_CLIENT_ID=seu_client_id_aqui
     PLUGGY_CLIENT_SECRET=seu_client_secret_aqui
     ```
     > ⚠️ O arquivo `.env` já está no `.gitignore` para nunca ser enviado ao GitHub.
3. **Conecte seu banco:**
   * Clique em **Conectar Banco (Pluggy)** (disponível no Dashboard, em Lançamentos ou em Configurações).
   * O COFIN abrirá o fluxo do **Pluggy Connect** no navegador com um servidor *Loopback Bridge* local para capturar automaticamente o `itemId` da sua instituição.
   * Selecione seu banco, autorize o compartilhamento via Open Finance e aguarde o retorno automático ao COFIN.
4. **Revise e importe as transações:**
   * O COFIN busca todas as contas bancárias (`BANK`) e cartões (`CREDIT`), diferencia despesas/receitas, detecta pares reais de transferência e pagamentos de fatura e executa o motor de auto-categorização em 4 camadas.
   * No **Modal de Revisão**, confira:
     * O mapeamento de cada conta/cartão de origem para sua conta correspondente no COFIN;
     * A opção de **conciliar automaticamente o Saldo Inicial** com o saldo real retornado pela API;
     * As categorias sugeridas (com badge de origem `Regra`, `Memória`, `Pluggy` ou `A Classificar`) e os apelidos;
   * Clique em **Confirmar e Salvar**.
5. **Próximas sincronizações:**
   * Nas próximas vezes, basta clicar em **Sincronizar Conexão Atual** para puxar somente as novas transações (lançamentos já importados são bloqueados automaticamente por `pluggyId`/`externalId`).

---

## 7. Como Conectar no Make.com (Gravação Automática em Planilha)

O Make.com permite que o COFIN envie automaticamente sua base atualizada em formato `.xlsx` (Excel) para o seu OneDrive/Google Drive sempre que você salvar ou editar lançamentos (com envio em segundo plano após `1,2s` de inatividade).

### Passo a Passo
1. **Importe o Blueprint oficial no Make.com:**
   * Acesse [make.com](https://www.make.com) e clique em **Create a new scenario**.
   * No rodapé do editor do cenário, clique no menu **`...` (More)** → **Import Blueprint**.
   * Selecione o arquivo [`Cenario_COFIN_Make.json`](Cenario_COFIN_Make.json) localizado na raiz deste repositório.
2. **Crie/Copie a URL do Webhook:**
   * Clique no primeiro módulo (**Webhooks → Custom webhook**).
   * Clique em **Add**, dê um nome (ex.: `COFIN Sync`) e salve.
   * Clique em **Copy address to clipboard** para copiar a URL gerada (ex.: `https://hook.us2.make.com/xxxxxxxx...`).
3. **Conecte o destino da planilha no cenário:**
   * Clique no módulo de saída (**OneDrive — Upload a File** ou módulo equivalente no blueprint).
   * Conecte sua conta Microsoft, escolha a pasta de destino no OneDrive e habilite a opção de **sobrescrever arquivo existente** (ex.: `Controle_Financeiro_COFIN.xlsx`).
   * Salve o cenário e ative a chave **ON** (Scheduling: *Immediately as data arrives*).
4. **Configure o Webhook dentro do COFIN:**
   * No menu lateral do COFIN, clique em **Sincronizar OneDrive**.
   * No campo **URL do Webhook do Make.com (para gravação automática)**, cole a URL copiada do Make.
   * O COFIN salva automaticamente a URL e passa a sincronizar a planilha `.xlsx` em segundo plano a cada alteração!

---

## 8. Como Conectar no OneDrive (Leitura & Sincronização)

Além da gravação via Make.com, você pode ler e mesclar sua planilha do OneDrive diretamente no COFIN de **duas formas** (na aba **Sincronizar OneDrive**):

### Opção A — Login Microsoft (Recomendado)
1. No menu lateral, abra **Sincronizar OneDrive**.
2. No card **Login Microsoft (recomendado)**, clique para conectar sua conta Microsoft via OAuth.
3. Escolha a planilha `.xlsx` diretamente no seu OneDrive.
4. O COFIN sincronizará leitura e gravação diretamente com a API do Microsoft Graph / OneDrive.

### Opção B — Link de Compartilhamento da Planilha (`1drv.ms/x/...`)
1. No OneDrive Web (ou Explorador do Windows), clique com o botão direito na sua planilha `.xlsx` → **Compartilhar** → **Copiar link** (certifique-se de que o link permite visualização/download).
2. No COFIN, abra **Sincronizar OneDrive** e cole o link no campo **Link de compartilhamento da planilha (para leitura no OneDrive)**.
3. Clique em **Buscar planilha agora**:
   * No aplicativo Electron, o COFIN utiliza o **proxy IPC seguro** do processo principal (`main.js`) para baixar o `.xlsx` sem bloqueios de CORS.
   * As linhas são mescladas de forma inteligente: registros locais não sincronizados, garantias, comprovantes e `descricaoOriginal` são preservados, e linhas sem categoria passam automaticamente pelo **Motor de Auto-Categorização em 4 Camadas**.
4. *(Alternativa Offline)* Você também pode clicar em **Selecionar arquivo .xlsx manualmente** para importar qualquer planilha Excel direto do seu computador.

---

## 9. Drag & Drop para Extratos (`.OFX`) e Comprovantes (OCR)

O COFIN possui uma camada global inteligente de **Drag & Drop** ativa em qualquer tela do aplicativo — diferenciando automaticamente se você arrastou um **extrato bancário** ou uma **imagem/PDF de comprovante**:

### Importando Extratos Bancários (`.OFX` / `.QFX`)
1. **Exporte o extrato no seu banco:** No internet banking ou app do seu banco, exporte o extrato do período no formato **OFX** (`.ofx`).
2. **Arraste e solte em qualquer lugar do COFIN:**
   * Basta arrastar o arquivo `.ofx` para dentro da janela do aplicativo — um **Overlay Global** translúcido aparecerá automaticamente indicando *"Solte o extrato .OFX aqui para importar"*.
   * Se preferir, você também pode usar a área dedicada em **Categorias & Contas → Conciliação de Extratos OFX (Offline)** ou o botão **Importar Extrato** na barra de **Lançamentos**.
3. **Vínculo automático de conta (`<ACCTID>`):**
   * O motor extrai a tag `<ACCTID>` do arquivo OFX. Na primeira vez que importar um extrato daquela conta, um modal pergunta a qual conta do COFIN ela pertence e grava o vínculo (`ofxAccountId`) para que próximas importações sejam reconhecidas sozinhas.
4. **Anti-duplicação & Revisão Humana:**
   * Lançamentos já importados são bloqueados automaticamente pelo identificador único `<FITID>` do banco.
   * Os lançamentos novos passam pelo **Motor de Auto-Categorização em 4 Camadas** e abrem no **Modal de Revisão**, onde você pode revisar badges de origem (`Regra`, `Memória`, `Pluggy`, `A Classificar`), editar categorias (disparando o aprendizado em 1 clique), ajustar transferências e confirmar.
   * **100% Local e Privado:** Nenhum dado do seu arquivo `.ofx` sai do seu computador.

### Arrastando Comprovantes, Notas e Recibos (OCR Local)
* Arraste uma imagem (**PNG, JPG, WEBP**) ou recibo para dentro da janela do COFIN.
* O motor **Tesseract.js (OCR 100% local)** lê automaticamente o valor total, a data e o estabelecimento, abre o modal de **Novo Lançamento** pré-preenchido e já anexa a imagem ao lançamento para visualização em **Split-View**.

---

## 10. Sincronização Familiar P2P, Shadow Vault e Segurança

* **Sincronização Familiar P2P (Rede Local — Porta `45000`):**
  * Em **Categorias & Contas → Sincronização Familiar**, copie o **Seu IP na rede**, informe o **IP do Parceiro** (outro computador com COFIN na mesma rede Wi-Fi/LAN) e clique em **Sincronizar Agora**.
  * O **Merge Inteligente** combina lançamentos, contas, cofres, metas e `regrasCategoria` de ambos os lados sem duplicar nem apagar nada, bloqueando qualquer conexão fora de redes privadas RFC 1918.
* **Shadow Vault (Auto-Backup Local):**
  * Escolha uma pasta segura em **Categorias & Contas** para gerar snapshots `.json` automáticos (contendo todo o `STATE`, incluindo `regrasCategoria` e `memoriaCategorias`), além de exportação e restauração manual de backup `.json`.
* **Privacidade e Hardening Electron:**
  * Bloqueio por **PIN** local, **Modo Stealth (`Alt + P`)** para ocultar valores na tela, `contextIsolation: true`, `nodeIntegration: false`, allowlist estrita de canais IPC em [`preload.js`](preload.js) e credenciais Pluggy e GitHub Gist isoladas no `.env`.

---

## 11. Atalhos de Teclado

| Atalho | Ação |
| :--- | :--- |
| **`Ctrl + K`** | Abre o **Spotlight Semântico** (busca global, filtros e comandos rápidos com `>`). |
| **`Ctrl + N`** | Abre o modal de **Novo Lançamento**. |
| **`Alt + P`** | Alterna o **Modo Stealth** (borra valores sensíveis na tela). |
| **`Esc`** | Fecha modais, Split-View e janelas sobrepostas ativas. |
| **`Enter`** | Confirma formulários rápidos (Smart Add e cadastros). |
| **Arrastar `.ofx`** | Abre o Overlay Global para conciliação local de extrato bancário. |
| **Arrastar imagem** | Executa leitura automática via **OCR Local (Tesseract.js)** e anexa o comprovante. |

---

## 12. Desenvolvimento, Build e Publicação OTA

### Scripts disponíveis
```bash
npm start     # Inicia o COFIN em modo de desenvolvimento (Electron)
npm run dist  # Gera o instalador Windows NSIS em dist/COFIN-Setup-1.7.0.exe
```

### Pipeline Automatizado CI/CD ([`.github/workflows/release.yml`](.github/workflows/release.yml))
Todo push de tag semântica `v*` (ex.: `v1.7.0`) dispara o GitHub Actions em `windows-latest`:
1. `npm ci` usando o `package-lock.json` versionado;
2. Validação de sintaxe em `main.js`, `preload.js` e `app.js` via `node --check`;
3. Empacotamento NSIS e publicação automática no **GitHub Releases** (`COFIN-Setup-1.7.0.exe`, `.blockmap` e `latest.yml`) para entrega **Auto-Update OTA**.

### Estrutura do Repositório
```text
COFIN/
├── .github/workflows/release.yml   # CI/CD Windows NSIS + publicação OTA
├── build/icon.ico                  # Ícone oficial do executável Windows
├── app.js                          # Domínio, Auto-Categorização v2, Gist Sync, Open Finance, OFX e UI
├── index.html                      # Estrutura HTML, modais (Revisão, Triagem, Regras, Gist) e Patch Notes
├── style.css                       # Design System Flat Dark Precision + Light Mode
├── main.js                         # Main Process Electron (Pluggy v2 IPC, GitHub Gist IPC, P2P :45000, OTA)
├── preload.js                      # contextBridge seguro com allowlist de canais IPC
├── Cenario_COFIN_Make.json         # Blueprint pronto para importação no Make.com
├── dev-app-update.yml              # Diagnóstico OTA em desenvolvimento
├── Iniciar COFIN.bat               # Atalho rápido Windows
├── package.json / package-lock.json
└── README.md
```

---

<p align="center">
  <strong>COFIN v1.7.0</strong> · Offline-First, Privacidade Local e Produtividade Financeira · Licença <strong>ISC</strong>
</p>
