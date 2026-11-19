/* ================= ESTADO E PERSISTÊNCIA ================= */
const CURRENT_VERSION = '1.6.0';
const APP_VERSAO = '1.6.0 · r16';
const STORAGE_KEY = 'controle-financeiro-dados';

const SUBCATEGORIAS_PADRAO_MAP = {
  'Moradia': ['Aluguel / Condomínio', 'Energia & Água', 'Internet & TV', 'Manutenção'],
  'Alimentação': ['Supermercado', 'Restaurante', 'Delivery / Lanche', 'Padaria & Café'],
  'Transporte': ['Combustível', 'Uber / 99 / Táxi', 'Transporte Público', 'Manutenção / IPVA'],
  'Saúde': ['Farmácia', 'Consultas & Exames', 'Plano de Saúde', 'Academia'],
  'Educação': ['Cursos & Faculdade', 'Livros & Material'],
  'Lazer': ['Passeios & Eventos', 'Viagens & Hospedagem', 'Jogos & Hobbies'],
  'Assinaturas': ['Streaming (Vídeo/Música)', 'Software & Nuvem', 'Clubes & Assinaturas'],
  'Outros': [],
  'Salário': ['Salário Mensal', '13º & Férias', 'Bônus / PLR'],
  'Freelance': ['Projetos', 'Consultoria'],
  'Investimentos': ['Dividendos / FIIs', 'Rendimentos Renda Fixa']
};

let STATE = {
  lancamentos: [],
  categorias: [
    {nome:'Moradia',tipo:'despesa',subcategorias:['Aluguel / Condomínio','Energia & Água','Internet & TV','Manutenção']},
    {nome:'Alimentação',tipo:'despesa',subcategorias:['Supermercado','Restaurante','Delivery / Lanche','Padaria & Café']},
    {nome:'Transporte',tipo:'despesa',subcategorias:['Combustível','Uber / 99 / Táxi','Transporte Público','Manutenção / IPVA']},
    {nome:'Saúde',tipo:'despesa',subcategorias:['Farmácia','Consultas & Exames','Plano de Saúde','Academia']},
    {nome:'Educação',tipo:'despesa',subcategorias:['Cursos & Faculdade','Livros & Material']},
    {nome:'Lazer',tipo:'despesa',subcategorias:['Passeios & Eventos','Viagens & Hospedagem','Jogos & Hobbies']},
    {nome:'Assinaturas',tipo:'despesa',subcategorias:['Streaming (Vídeo/Música)','Software & Nuvem','Clubes & Assinaturas']},
    {nome:'Outros',tipo:'despesa',subcategorias:[]},
    {nome:'Salário',tipo:'receita',subcategorias:['Salário Mensal','13º & Férias','Bônus / PLR']},
    {nome:'Freelance',tipo:'receita',subcategorias:['Projetos','Consultoria']},
    {nome:'Investimentos',tipo:'receita',subcategorias:['Dividendos / FIIs','Rendimentos Renda Fixa']},
    {nome:'Outros',tipo:'receita',subcategorias:[]}
  ],
  contas: [{nome:'Conta principal', tipo:'conta'}],
  cartoes: [],              // Gestão Inteligente: { id, nome, limiteTotal, diaFechamento, diaVencimento, cor }
  historicoPatrimonio: [],  // Máquina do Tempo: { id, mesAno, saldoLivre, totalCofres, dividasCartao, patrimonioLiquido, dataRegistro }
  recorrentes: [],
  receitasFixas: [],        // Motor de Receitas Inteligentes (Auto-Paycheck): { id, descricao, valor, conta, categoria, tipoRegra: 'dia_fixo'|'dia_util', diaRegra, ativo }
  regras: [],               // Legado: migrado automaticamente para regrasCategoria
  regrasCategoria: [],      // Motor de Regras de Auto-Categorização (v2)
  antiMetas: [],            // Anti-Metas: { id, categoriaId, limiteMensal }
  metas: [],
  cofres: [],               // Cofres/Caixinhas (Vaults): { id, nome, icone, cor, objetivo, saldoAlocado }
  dividas: [],
  lixeira: [],              // lançamentos excluídos (recuperáveis por 30 dias)
  excluidosPendentes: [],   // IDs apagados aqui que a planilha ainda pode ter (evita ressuscitar na sincronização)
  recorrentesIgnorados: [], // 'idRecorrência|AAAA-MM' apagados de propósito (a recorrência não recria)
  config: { lastSync: null, oneDriveLink: null, ultimoMesFechado: null, modoViagem: { ativo: false, nome: '', hashtag: '' }, pastaBackup: null, ultimoBackupSilencioso: null, lastSeenVersion: null }
};
let importRowsRaw = [];
let importHeaders = [];

function normalizarHierarquiaCategorias() {
  if (!Array.isArray(STATE.categorias)) STATE.categorias = [];
  STATE.categorias.forEach(c => {
    if (!Array.isArray(c.subcategorias)) {
      c.subcategorias = SUBCATEGORIAS_PADRAO_MAP[c.nome] ? [...SUBCATEGORIAS_PADRAO_MAP[c.nome]] : [];
    }
  });
}

function extrairMacroESubcategoria(catRaw) {
  const s = String(catRaw || '').trim();
  if (!s) return { macro: 'Sem categoria', sub: 'Geral (Direto)', temSub: false, completo: 'Sem categoria' };
  const sepIdx = s.indexOf(' -> ');
  if (sepIdx !== -1) {
    const macro = s.slice(0, sepIdx).trim() || 'Sem categoria';
    const sub = s.slice(sepIdx + 4).trim() || 'Geral (Direto)';
    return { macro, sub, temSub: true, completo: `${macro} -> ${sub}` };
  }
  // Caso o lançamento tenha sido salvo apenas com o nome de uma subcategoria cadastrada
  for (const c of (STATE.categorias || [])) {
    if (Array.isArray(c.subcategorias) && c.subcategorias.some(sub => sub.toLowerCase() === s.toLowerCase())) {
      const subOriginal = c.subcategorias.find(sub => sub.toLowerCase() === s.toLowerCase());
      return { macro: c.nome, sub: subOriginal, temSub: true, completo: `${c.nome} -> ${subOriginal}` };
    }
  }
  return { macro: s, sub: 'Geral (Direto)', temSub: false, completo: s };
}

function formatarCategoriaExibicao(catRaw) {
  return String(catRaw || '-').replace(/\s*->\s*/g, ' › ');
}

function competenciaFatura(dataISO, diaFechamento) {
  if (!dataISO) return { ano: new Date().getFullYear(), mes: new Date().getMonth() + 1 };
  const [ano, mes, dia] = String(dataISO).slice(0, 10).split('-').map(Number);
  const fechamento = parseInt(diaFechamento, 10);
  // Só aplica transbordo para o mês seguinte quando diaFechamento for válido entre 2 e 31
  // (evita deslocar 100% das compras para o mês seguinte quando o cartão está sem diaFechamento ou com fallback 1)
  if (Number.isInteger(fechamento) && fechamento >= 2 && fechamento <= 31 && dia >= fechamento) {
    let m = mes + 1;
    let a = ano;
    if (m > 12) {
      m = 1;
      a += 1;
    }
    return { ano: a, mes: m };
  }
  return { ano, mes };
}

function calcularCompetenciaLancamentoCartao(l, cartaoParam) {
  if (!l) return { ano: new Date().getFullYear(), mes: new Date().getMonth() + 1 };

  // 1) Prioriza faturaAno e faturaMes quando já definidos explicitamente no lançamento
  const fatAno = parseInt(l.faturaAno, 10);
  const fatMes = parseInt(l.faturaMes, 10);
  if (Number.isInteger(fatAno) && fatAno >= 1900 && Number.isInteger(fatMes) && fatMes >= 1 && fatMes <= 12) {
    return { ano: fatAno, mes: fatMes };
  }

  const cartao = cartaoParam
    || (STATE.contas || []).find(c => c && c.nome === l.conta && c.tipo === 'cartao')
    || (STATE.cartoes || []).find(c => c && (c.nome === l.conta || c.id === l.cartaoId));
  const fechRaw = cartao ? parseInt(cartao.diaFechamento, 10) : NaN;
  const diaFechamentoValido = (Number.isInteger(fechRaw) && fechRaw >= 2 && fechRaw <= 31) ? fechRaw : null;

  // Usa sempre a data real da transação (sem alterá-la no banco) para determinar a competência
  const dataTransacao = l.dataCompra || l.data;
  if (!dataTransacao) {
    return {
      ano: new Date().getFullYear(),
      mes: new Date().getMonth() + 1
    };
  }

  const compBase = competenciaFatura(dataTransacao, diaFechamentoValido);
  const numParcela = parseInt(l.parcelaAtual, 10) || 1;
  const totParcelas = parseInt(l.parcelaTotal || l.totalParcelas, 10) || 1;

  // Se for compra parcelada e estivermos a partir da dataCompra original, desloca (parcelaAtual - 1) meses
  if (l.dataCompra && totParcelas > 1 && numParcela > 1) {
    let m = compBase.mes + (numParcela - 1);
    let a = compBase.ano + Math.floor((m - 1) / 12);
    m = ((m - 1) % 12) + 1;
    return { ano: a, mes: m };
  }

  return compBase;
}

function mesCompetenciaLancamento(l) {
  if (!l) return '';
  if (ehLancamentoCartao(l) && l.tipo === 'despesa' && !l.ehPagamentoFatura) {
    const comp = calcularCompetenciaLancamentoCartao(l);
    return `${comp.ano}-${String(comp.mes).padStart(2, '0')}`;
  }
  if (l.faturaAno && l.faturaMes) {
    return `${l.faturaAno}-${String(l.faturaMes).padStart(2, '0')}`;
  }
  return (l.data || '').slice(0, 7);
}

function calcularVencimentoFatura(anoComp, mesComp, diaFechamento, diaVencimento) {
  const fech = parseInt(diaFechamento, 10) || 1;
  const venc = parseInt(diaVencimento, 10) || 10;
  let aVenc = parseInt(anoComp, 10) || new Date().getFullYear();
  let mVenc = parseInt(mesComp, 10) || (new Date().getMonth() + 1);
  if (venc <= fech) {
    mVenc += 1;
    if (mVenc > 12) {
      mVenc = 1;
      aVenc += 1;
    }
  }
  const ultimoDia = new Date(aVenc, mVenc, 0).getDate();
  const diaReal = Math.min(venc, ultimoDia);
  return `${aVenc}-${String(mVenc).padStart(2, '0')}-${String(diaReal).padStart(2, '0')}`;
}

function ehContaDeCartaoLancamento(l) {
  if (!l || typeof l !== 'object') return false;
  if (l.faturaAno && l.faturaMes) return true;
  if (l.dataVencimentoFatura) return true;
  if (l.parcelaAtual || l.parcelaTotal) return true;
  if (String(l.accountType || '').toUpperCase() === 'CREDIT' || l.meioPagamento === 'cartao') return true;
  const c = (STATE.contas || []).find(x => x && x.nome === l.conta) || (STATE.cartoes || []).find(x => x && x.nome === l.conta);
  return !!(c && (c.tipo === 'cartao' || (STATE.cartoes || []).some(k => k && k.nome === l.conta)));
}

function ehLancamentoPagamentoFatura(l) {
  if (!l || typeof l !== 'object') return false;
  if (l.ehPagamentoFatura === true) return true;
  const catNorm = normalizarTextoSemAcento(l.categoria);
  if (
    catNorm === 'transferencia/pagamento de fatura' ||
    catNorm === 'pagamento de fatura' ||
    catNorm === 'pagamento fatura' ||
    catNorm === 'pagamento de cartao' ||
    catNorm === 'pagamento cartao'
  ) {
    return true;
  }
  const descNorm = normalizarTextoSemAcento(l.descricao);
  if (!descNorm) return false;
  if (/\b(?:pagamento(?:\s+de)?|pagto\.?)\s+fatura\b/.test(descNorm)) return true;
  if (/\b(?:pagamento(?:\s+de)?|pagto\.?)\s+cartao\b/.test(descNorm)) return true;
  const emCartao = ehContaDeCartaoLancamento(l);
  if (/\bpagamento\s+recebido\b/.test(descNorm) && emCartao) return true;
  if (/\bpagamento\s+efetuado\b/.test(descNorm) && (emCartao || /\b(fatura|cartao)\b/.test(descNorm))) return true;
  return false;
}

function normalizarTextoSemAcento(valor) {
  return String(valor || '')
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function obterTransferenciaId(l) {
  if (!l || typeof l !== 'object') return '';
  return String(l.transferenciaId || l.transferenciaGrupo || '').trim();
}

function isLancamentoTransferencia(l) {
  if (!l || typeof l !== 'object') return false;
  if (l.isTransferencia === true || l.ehTransferencia === true) return true;
  if (obterTransferenciaId(l)) return true;
  const tipoNorm = normalizarTextoSemAcento(l.tipo);
  if (tipoNorm === 'transferencia') return true;
  const catNorm = normalizarTextoSemAcento(l.categoria);
  if (catNorm === 'transferencia' || catNorm.startsWith('transferencia ->')) return true;
  return false;
}

function correspondeFiltroTipoLancamento(l, tipoFiltro) {
  if (!tipoFiltro) return true;
  const ehTransf = isLancamentoTransferencia(l);
  if (tipoFiltro === 'transferencia') return ehTransf;
  return l.tipo === tipoFiltro && !ehTransf;
}

function normalizarIntegridadeTransferencias() {
  if (!Array.isArray(STATE.lancamentos)) return false;
  let alterou = false;
  STATE.lancamentos.forEach(l => {
    if (!l || typeof l !== 'object') return;
    if (ehLancamentoPagamentoFatura(l)) return;
    if (!isLancamentoTransferencia(l)) return;
    if (l.ehTransferencia !== true) { l.ehTransferencia = true; alterou = true; }
    if (l.isTransferencia !== true) { l.isTransferencia = true; alterou = true; }
    const gid = obterTransferenciaId(l);
    if (gid) {
      if (l.transferenciaId !== gid) { l.transferenciaId = gid; alterou = true; }
      if (l.transferenciaGrupo !== gid) { l.transferenciaGrupo = gid; alterou = true; }
    }
  });
  return alterou;
}

function calcularDeltaTransferenciasOrfasNaoCalibradas(mesLimiteOpt, saldosContasOpt) {
  const contasBancarias = (STATE.contas || []).filter(c => c && c.tipo !== 'cartao');
  const mapaContas = new Map(contasBancarias.map(c => [c.nome, c]));
  const saldosAtuais = saldosContasOpt || (typeof saldoPorConta === 'function' ? saldoPorConta() : {});
  const grupos = new Map();

  (STATE.lancamentos || []).forEach(l => {
    if (!l || l.ehMovimentoCofre || ehLancamentoPagamentoFatura(l)) return;
    if (!isLancamentoTransferencia(l)) return;
    if (!estaPago(l)) return;
    const contaObj = mapaContas.get(l.conta);
    if (!contaObj) return;
    if (mesLimiteOpt) {
      const mesL = mesCompetenciaLancamento(l);
      if (mesL && mesL > mesLimiteOpt) return;
    }
    const gid = obterTransferenciaId(l) || `__orfao_${l.id || uid()}`;
    if (!grupos.has(gid)) grupos.set(gid, []);
    grupos.get(gid).push({ lanc: l, contaObj });
  });

  let deltaOrfao = 0;
  grupos.forEach(itens => {
    const somaLiquidaGrupo = itens.reduce((acc, { lanc }) => {
      const sinal = lanc.tipo === 'receita' ? 1 : -1;
      return acc + sinal * (Number(lanc.valor) || 0);
    }, 0);
    // Par completo e balanceado (saída na origem + entrada no destino): efeito líquido = 0
    if (Math.abs(somaLiquidaGrupo) < 0.01) return;

    // Transferência incompleta/órfã: neutraliza o impacto líquido caso a conta não esteja
    // calibrada exatamente no saldo real Pluggy (onde saldoInicial já absorveu essa ponta).
    itens.forEach(({ lanc, contaObj }) => {
      const saldoAtualConta = Number(saldosAtuais[contaObj.nome]);
      const calibracaoPluggyExata = Boolean(contaObj.pluggyBalanceSyncAt)
        && Number.isFinite(contaObj.pluggyBalanceReal)
        && Number.isFinite(saldoAtualConta)
        && Math.abs(saldoAtualConta - contaObj.pluggyBalanceReal) < 0.01;
      if (calibracaoPluggyExata) return;
      const sinal = lanc.tipo === 'receita' ? 1 : -1;
      deltaOrfao += sinal * (Number(lanc.valor) || 0);
    });
  });

  return Math.round(deltaOrfao * 100) / 100;
}

function ehLancamentoCartao(l) {
  if (!l || ehLancamentoPagamentoFatura(l)) return false;
  return ehContaDeCartaoLancamento(l);
}

function construirOptionsCategoriasHTML(tipoFiltro, valorSelecionado) {
  normalizarHierarquiaCategorias();
  const cats = (STATE.categorias || []).filter(c => !tipoFiltro || c.tipo === tipoFiltro);
  let html = '';
  const valoresPresentes = new Set();
  cats.forEach(c => {
    const subs = Array.isArray(c.subcategorias) ? c.subcategorias : [];
    html += `<optgroup label="${escHtml(c.nome)}${!tipoFiltro ? ' (' + (c.tipo === 'receita' ? 'Receita' : 'Despesa') + ')' : ''}">`;
    const valGeral = c.nome;
    valoresPresentes.add(valGeral);
    html += `<option value="${escHtml(valGeral)}" ${valorSelecionado === valGeral ? 'selected' : ''}>${escHtml(c.nome)} (Geral)</option>`;
    subs.forEach(sub => {
      const valSub = `${c.nome} -> ${sub}`;
      valoresPresentes.add(valSub);
      html += `<option value="${escHtml(valSub)}" ${valorSelecionado === valSub ? 'selected' : ''}>${escHtml(c.nome)} › ${escHtml(sub)}</option>`;
    });
    html += `</optgroup>`;
  });
  if (valorSelecionado && !valoresPresentes.has(valorSelecionado)) {
    html += `<option value="${escHtml(valorSelecionado)}" selected>${escHtml(formatarCategoriaExibicao(valorSelecionado))}</option>`;
  }
  return html;
}

function sincronizarEstruturaCartoes() {
  if (!Array.isArray(STATE.cartoes)) STATE.cartoes = [];
  if (!Array.isArray(STATE.contas)) STATE.contas = [];

  // Se cartoes estiver vazio mas existirem cartões em contas, migra
  if (STATE.cartoes.length === 0) {
    const cartoesConta = STATE.contas.filter(c => c.tipo === 'cartao');
    cartoesConta.forEach(c => {
      STATE.cartoes.push({
        id: c.id || uid(),
        nome: c.nome,
        limiteTotal: Number(c.limite) || 3000,
        diaFechamento: parseInt(c.diaFechamento, 10) || 1,
        diaVencimento: parseInt(c.diaVencimento, 10) || 10,
        cor: c.cor || '#1A6FE0'
      });
    });
  }

  // Garante sincronização bidirecional com STATE.contas
  STATE.cartoes.forEach(cart => {
    let emConta = STATE.contas.find(c => c.nome.toLowerCase() === cart.nome.toLowerCase());
    if (!emConta) {
      emConta = {
        id: cart.id,
        nome: cart.nome,
        tipo: 'cartao',
        limite: cart.limiteTotal,
        diaFechamento: cart.diaFechamento,
        diaVencimento: cart.diaVencimento,
        cor: cart.cor
      };
      STATE.contas.push(emConta);
    } else {
      emConta.tipo = 'cartao';
      emConta.limite = cart.limiteTotal;
      emConta.diaFechamento = cart.diaFechamento;
      emConta.diaVencimento = cart.diaVencimento;
      emConta.cor = cart.cor || emConta.cor || '#1A6FE0';
    }
  });
}

function normalizarLancamentosCartaoExistentes() {
  if (!Array.isArray(STATE.lancamentos)) return;
  let alterado = false;
  STATE.lancamentos.forEach(l => {
    if (!l) return;
    if (ehLancamentoPagamentoFatura(l)) {
      if (!l.ehPagamentoFatura || !l.ehTransferencia || l.pago === false || !l.status) {
        l.ehPagamentoFatura = true;
        l.ehTransferencia = true;
        l.pago = true;
        l.status = l.status || 'Pago/Efetivado';
        alterado = true;
      }
      return;
    }
    if (l.tipo !== 'despesa' || !l.conta) return;
    const cartaoConta = (STATE.contas || []).find(c => c.nome === l.conta && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === l.conta);
    if (!cartaoConta) return;

    // Preserva sempre a data real da transação no banco de dados (nunca sobrescreve com a data de vencimento)
    if (l.dataCompra) {
      let dataRealTransacao = l.dataCompra;
      if (l.parcelaTotal && l.parcelaTotal > 1 && l.parcelaAtual) {
        dataRealTransacao = somarMeses(l.dataCompra, l.parcelaAtual - 1);
      }
      if (l.data !== dataRealTransacao) {
        l.data = dataRealTransacao;
        alterado = true;
      }
    }

    // Recalcula a competência da fatura conforme a regra (dia >= diaFechamento -> mês + 1)
    const comp = calcularCompetenciaLancamentoCartao(l, cartaoConta);
    const novoVenc = calcularVencimentoFatura(comp.ano, comp.mes, cartaoConta.diaFechamento || 1, cartaoConta.diaVencimento || 10);
    if (l.faturaAno !== comp.ano || l.faturaMes !== comp.mes || l.dataVencimentoFatura !== novoVenc) {
      l.faturaAno = comp.ano;
      l.faturaMes = comp.mes;
      l.dataVencimentoFatura = novoVenc;
      alterado = true;
    }
  });
  corrigirFaturasPresas();
  if (reconciliarFaturasPagas()) {
    alterado = true;
  }
  recalcularLimitesCartoes();
  if (alterado) {
    salvarDados();
  }
}

/**
 * Avalia estritamente se um lançamento de cartão teve sua fatura liquidada.
 * IGNORA status individuais de compra ("Efetivado", "Liquidado", etc.) — depende
 * EXCLUSIVAMENTE da flag explícita `faturaPaga === true`.
 */
function ehItemFaturaPago(l) {
  return !!(l && l.faturaPaga === true);
}

/**
 * Mapeia apenas os lançamentos reais de saída na conta corrente referentes a "Pagamento de Fatura".
 * Qualquer item de cartão só é considerado pago se possuir correspondência de pagamento em conta corrente.
 */
function obterMapaPagamentosDeFaturaReais() {
  const todosCartoes = [
    ...(Array.isArray(STATE.cartoes) ? STATE.cartoes : []),
    ...((STATE.contas || []).filter(c => c && c.tipo === 'cartao'))
  ];
  const nomesContasCartaoLower = new Set(todosCartoes.map(c => c && c.nome ? c.nome.toLowerCase() : '').filter(Boolean));
  const pagamentosPorChave = new Map();
  const idsPagamentosReais = new Set();

  const encontrarCartaoPorTexto = (texto) => {
    const limpo = String(texto || '').replace(/^pagamento\s+(?:de\s+)?fatura\s*/i, '').trim().toLowerCase();
    if (!limpo) return null;
    return todosCartoes.find(c => c && c.nome && (
      c.nome.toLowerCase() === limpo ||
      limpo.includes(c.nome.toLowerCase()) ||
      c.nome.toLowerCase().includes(limpo)
    )) || null;
  };

  (STATE.lancamentos || []).forEach(l => {
    if (!l || l.tipo !== 'despesa' || !ehLancamentoPagamentoFatura(l)) return;
    // Garante que é uma saída em conta bancária (não um lançamento fantasma dentro do próprio cartão)
    const contaOrigemLower = String(l.conta || '').trim().toLowerCase();
    if (!contaOrigemLower || nomesContasCartaoLower.has(contaOrigemLower)) return;

    let cartaoAlvo = null;
    if (l.cartaoNome || l.cartaoId) {
      cartaoAlvo = todosCartoes.find(c => c && (c.nome === l.cartaoNome || c.id === l.cartaoId)) || null;
    }
    if (!cartaoAlvo) {
      cartaoAlvo = encontrarCartaoPorTexto(l.descricao);
    }
    const nomeCartao = (cartaoAlvo && cartaoAlvo.nome) || l.cartaoNome || String(l.descricao || '').replace(/^pagamento\s+(?:de\s+)?fatura\s*/i, '').trim();
    if (!nomeCartao) return;

    let ano = parseInt(l.faturaAno, 10);
    let mes = parseInt(l.faturaMes, 10);

    if ((!ano || !mes) && l.faturaCompetencia) {
      const partes = String(l.faturaCompetencia).split(/[/-]/).map(Number);
      if (partes.length === 2) {
        if (partes[0] > 1900) { ano = partes[0]; mes = partes[1]; }
        else { mes = partes[0]; ano = partes[1]; }
      }
    }

    if ((!ano || !mes || isNaN(ano) || isNaN(mes)) && l.id) {
      const refCartao = cartaoAlvo || { nome: nomeCartao, diaFechamento: 1 };
      const itemVinculado = (STATE.lancamentos || []).find(x => x && x.pagamentoFaturaId === l.id && x.conta === nomeCartao && x.tipo === 'despesa');
      if (itemVinculado) {
        const cVinc = calcularCompetenciaLancamentoCartao(itemVinculado, refCartao);
        ano = cVinc.ano;
        mes = cVinc.mes;
      }
    }

    if (!ano || !mes || isNaN(ano) || isNaN(mes)) {
      const despesasCartao = (STATE.lancamentos || []).filter(x => x && x.conta === nomeCartao && x.tipo === 'despesa' && !ehLancamentoPagamentoFatura(x));
      const porComp = new Map();
      const refCartao = cartaoAlvo || { nome: nomeCartao, diaFechamento: 1 };
      despesasCartao.forEach(x => {
        const c = calcularCompetenciaLancamentoCartao(x, refCartao);
        const k = `${c.ano}-${c.mes}`;
        if (!porComp.has(k)) porComp.set(k, { ano: c.ano, mes: c.mes, soma: 0 });
        porComp.get(k).soma = Math.round((porComp.get(k).soma + (Number(x.valor) || 0)) * 100) / 100;
      });

      const valorPag = Math.round((Number(l.valor) || 0) * 100) / 100;
      let compEncontrada = null;
      for (const info of porComp.values()) {
        if (Math.abs(info.soma - valorPag) <= 0.05) {
          compEncontrada = info;
          break;
        }
      }
      if (!compEncontrada && l.data) {
        const [aData, mData] = String(l.data).split('-').map(Number);
        if (porComp.has(`${aData}-${mData}`)) {
          compEncontrada = porComp.get(`${aData}-${mData}`);
        } else {
          const compCiclo = competenciaFatura(l.data, (cartaoAlvo && cartaoAlvo.diaFechamento) || 1);
          compEncontrada = porComp.get(`${compCiclo.ano}-${compCiclo.mes}`) || { ano: aData, mes: mData };
        }
      }
      if (compEncontrada && compEncontrada.ano && compEncontrada.mes) {
        ano = compEncontrada.ano;
        mes = compEncontrada.mes;
      }
    }

    if (ano && mes && !isNaN(ano) && !isNaN(mes)) {
      const chaveLower = `${nomeCartao.toLowerCase()}|${ano}-${String(mes).padStart(2, '0')}`;
      idsPagamentosReais.add(l.id);
      if (!pagamentosPorChave.has(chaveLower)) {
        pagamentosPorChave.set(chaveLower, []);
      }
      pagamentosPorChave.get(chaveLower).push({ pagamento: l, cartaoAlvo, nomeCartao, ano, mes });
    }
  });

  return { pagamentosPorChave, idsPagamentosReais, todosCartoes };
}

function construirChaveFaturaCartao(nomeCartao, ano, mes) {
  const nome = String(nomeCartao || '').trim();
  const a = parseInt(ano, 10);
  const m = parseInt(mes, 10);
  if (!nome || !a || !m) return '';
  return `${nome}|${a}-${String(m).padStart(2, '0')}`;
}

function normalizarChaveFaturaLower(nomeCartao, ano, mes) {
  return construirChaveFaturaCartao(nomeCartao, ano, mes).toLowerCase();
}

function ehRegistroFaturaPagaValidoSemBanco(reg) {
  return Boolean(
    reg &&
    reg.cartaoNome &&
    reg.ano &&
    reg.mes &&
    (reg.quitacaoRetroativa === true || reg.pagamentoDetectado === true || Boolean(reg.origemQuitacao))
  );
}

/**
 * Rotina de Autocorreção (Migration de Estado):
 * Destrava faturas de cartão que ficaram marcadas com `faturaPaga: true` (ou zeradas
 * prematuramente por status individual de transação) sem que exista pagamento em
 * conta corrente nem registo explícito de quitação retroativa/detectada/manual em `faturasPagas`.
 */
function corrigirFaturasPresas() {
  if (!STATE || !Array.isArray(STATE.lancamentos)) return 0;

  const { pagamentosPorChave, todosCartoes } = obterMapaPagamentosDeFaturaReais();
  const chavesQuitadasValidas = new Set(pagamentosPorChave.keys());
  let corrigidos = 0;
  let configAlterada = false;

  // Limpa registos órfãos em STATE.config.faturasPagas que não possuam saída em conta corrente nem quitação explícita válida
  if (STATE.config && STATE.config.faturasPagas && typeof STATE.config.faturasPagas === 'object') {
    Object.keys(STATE.config.faturasPagas).forEach(k => {
      const reg = STATE.config.faturasPagas[k];
      if (!reg || !reg.cartaoNome || !reg.ano || !reg.mes) {
        delete STATE.config.faturasPagas[k];
        configAlterada = true;
        return;
      }
      const chaveLower = normalizarChaveFaturaLower(reg.cartaoNome, reg.ano, reg.mes);
      if (pagamentosPorChave.has(chaveLower) || ehRegistroFaturaPagaValidoSemBanco(reg)) {
        chavesQuitadasValidas.add(chaveLower);
      } else {
        delete STATE.config.faturasPagas[k];
        configAlterada = true;
      }
    });
  }

  // Varre todos os lançamentos de Cartão de Crédito e valida contra conta corrente + quitações explícitas
  STATE.lancamentos.forEach(l => {
    if (!l || l.tipo !== 'despesa' || ehLancamentoPagamentoFatura(l) || !ehLancamentoCartao(l)) return;

    const contaLower = String(l.conta || l.cartaoNome || '').toLowerCase();
    const cartaoAlvo = todosCartoes.find(c => c && (
      String(c.nome || '').toLowerCase() === contaLower || (l.cartaoId && c.id === l.cartaoId)
    )) || { nome: l.conta || l.cartaoNome, diaFechamento: 1 };
    const nomeCartaoRef = (cartaoAlvo && cartaoAlvo.nome) || l.cartaoNome || l.conta || '';
    const comp = calcularCompetenciaLancamentoCartao(l, cartaoAlvo);
    const chaveLower = normalizarChaveFaturaLower(nomeCartaoRef, comp.ano, comp.mes);
    const existeQuitacaoValida = chavesQuitadasValidas.has(chaveLower);

    if (!existeQuitacaoValida) {
      const tinhaFaturaPaga = ('faturaPaga' in l);
      const estavaFaturaPagaTrue = l.faturaPaga === true;
      const tinhaMetaPagamento = !!(l.pagamentoFaturaId || l.dataPagamentoFatura || l.contaPagamentoFatura);
      const estavaPagoNaFatura = l.pago === true;
      const statusInconsistente = l.status === 'Liquidado' || l.status === 'Pago' || l.status === 'Pago/Efetivado';

      if (tinhaFaturaPaga) delete l.faturaPaga;
      if (l.dataPagamentoFatura) delete l.dataPagamentoFatura;
      if (l.contaPagamentoFatura) delete l.contaPagamentoFatura;
      if (l.pagamentoFaturaId) delete l.pagamentoFaturaId;

      if (estavaFaturaPagaTrue || tinhaMetaPagamento || estavaPagoNaFatura || statusInconsistente) {
        l.pago = false;
        if (statusInconsistente || estavaFaturaPagaTrue) {
          l.status = 'Pendente';
        }
        l.sincronizado = false;
        corrigidos++;
      }
    }
  });

  if (corrigidos > 0 || configAlterada) {
    try {
      persistirStateNoLocalStorage();
    } catch (e) {
      console.warn('[Migration] Falha ao gravar correção de faturas no localStorage:', e);
    }
    if (corrigidos > 0) {
      console.info(`[Migration] corrigirFaturasPresas() destravou ${corrigidos} lançamento(s) de cartão sem pagamento em conta corrente.`);
    }
  }

  return corrigidos;
}

/**
 * Reconcilia os lançamentos de "Pagamento de Fatura" reais da conta corrente
 * com os respetivos itens da fatura paga. NUNCA promove status individuais ("Liquidado"/"Efetivado")
 * para `faturaPaga: true` na ausência de pagamento em conta corrente.
 */
function reconciliarFaturasPagas() {
  if (!Array.isArray(STATE.lancamentos)) return false;
  if (!STATE.config) STATE.config = {};
  if (!STATE.config.faturasPagas || typeof STATE.config.faturasPagas !== 'object') {
    STATE.config.faturasPagas = {};
  }

  let mudou = false;
  const { pagamentosPorChave } = obterMapaPagamentosDeFaturaReais();

  // 1) Garante integridade dos lançamentos reais de "Pagamento Fatura" presentes em STATE.lancamentos
  pagamentosPorChave.forEach((listaPags) => {
    listaPags.forEach(({ pagamento: l, cartaoAlvo, nomeCartao, ano, mes }) => {
      if (l.ehPagamentoFatura !== true) { l.ehPagamentoFatura = true; mudou = true; }
      if (l.ehTransferencia !== true) { l.ehTransferencia = true; mudou = true; }
      if (l.pago !== true) { l.pago = true; mudou = true; }
      if (!l.status || l.status === 'Pendente') { l.status = 'Pago/Efetivado'; mudou = true; }
      if (l.cartaoNome !== nomeCartao) { l.cartaoNome = nomeCartao; mudou = true; }
      if (cartaoAlvo && cartaoAlvo.id && l.cartaoId !== cartaoAlvo.id) { l.cartaoId = cartaoAlvo.id; mudou = true; }

      const refComp = `${String(mes).padStart(2, '0')}/${ano}`;
      if (l.faturaAno !== ano || l.faturaMes !== mes || l.faturaCompetencia !== refComp) {
        l.faturaAno = ano;
        l.faturaMes = mes;
        l.faturaCompetencia = refComp;
        mudou = true;
      }

      const chaveFatura = `${nomeCartao}|${ano}-${String(mes).padStart(2, '0')}`;
      if (!STATE.config.faturasPagas[chaveFatura]) {
        STATE.config.faturasPagas[chaveFatura] = {
          cartaoNome: nomeCartao,
          ano,
          mes,
          valor: Number(l.valor) || 0,
          dataPagamento: l.data || hojeLocalISO(),
          contaOrigem: l.conta || '',
          pagamentoFaturaId: l.id,
          itensPagosIds: Array.isArray(l.itensPagosIds) ? [...l.itensPagosIds] : undefined
        };
        mudou = true;
      } else if (Array.isArray(l.itensPagosIds) && !Array.isArray(STATE.config.faturasPagas[chaveFatura].itensPagosIds)) {
        STATE.config.faturasPagas[chaveFatura].itensPagosIds = [...l.itensPagosIds];
        mudou = true;
      }
    });
  });

  // 2) Restaura `faturaPaga: true` para faturas com pagamento real em conta corrente OU quitação explícita válida (retroativa/detectada/manual)
  Object.entries(STATE.config.faturasPagas).forEach(([k, reg]) => {
    if (!reg || !reg.cartaoNome || !reg.ano || !reg.mes) return;
    const chaveLower = normalizarChaveFaturaLower(reg.cartaoNome, reg.ano, reg.mes);
    if (!pagamentosPorChave.has(chaveLower) && !ehRegistroFaturaPagaValidoSemBanco(reg)) {
      delete STATE.config.faturasPagas[k];
      mudou = true;
      return;
    }
    const dataCorte = reg.dataPagamento || '9999-12-31';
    const idsPermitidos = Array.isArray(reg.itensPagosIds) ? new Set(reg.itensPagosIds) : null;
    const itens = lancamentosDaFatura(reg.cartaoNome, reg.ano, reg.mes);
    itens.forEach(item => {
      if (item.posPagamentoFatura === true || item.criadoAposPagamentoFatura === true) return;
      if (idsPermitidos) {
        const matchIdPag = Boolean(reg.pagamentoFaturaId && item.pagamentoFaturaId === reg.pagamentoFaturaId);
        if (!idsPermitidos.has(item.id) && !matchIdPag) return;
      } else {
        if (item.faturaPaga === false) return;
        const dtItem = item.dataCompra || item.data || '';
        if (dtItem > dataCorte) return;
      }
      if (item.faturaPaga !== true || item.pago !== true || item.status !== 'Liquidado') {
        item.faturaPaga = true;
        item.pago = true;
        item.status = 'Liquidado';
        item.dataPagamentoFatura = item.dataPagamentoFatura || reg.dataPagamento || hojeLocalISO();
        if (reg.contaOrigem && !item.contaPagamentoFatura) {
          item.contaPagamentoFatura = reg.contaOrigem;
        }
        if (reg.pagamentoFaturaId && !item.pagamentoFaturaId) {
          item.pagamentoFaturaId = reg.pagamentoFaturaId;
        }
        mudou = true;
      }
    });
  });

  return mudou;
}

/**
 * Recalcula dinamicamente o limiteUsado e o limiteDisponivel de todos os cartões
 * avaliando ESTRITAMENTE apenas a flag `faturaPaga === true`.
 * Transações sem `faturaPaga === true` (mesmo com status "Liquidado" ou "Efetivado")
 * continuam a consumir o limite até que a fatura seja explicitamente paga.
 */
function recalcularLimitesCartoes() {
  reconciliarFaturasPagas();

  const calcularUsadoCartao = (nomeCartao) => {
    if (!nomeCartao || !Array.isArray(STATE.lancamentos)) return 0;
    const despesasEmAberto = STATE.lancamentos.filter(l =>
      l &&
      l.conta === nomeCartao &&
      l.tipo === 'despesa' &&
      !ehLancamentoPagamentoFatura(l) &&
      l.faturaPaga !== true
    );
    const soma = despesasEmAberto.reduce((acc, l) => acc + (Number(l.valor) || 0), 0);
    return Math.max(0, Math.round(soma * 100) / 100);
  };

  if (Array.isArray(STATE.cartoes)) {
    STATE.cartoes.forEach(cartao => {
      if (!cartao || !cartao.nome) return;
      const limiteTotal = Number(cartao.limiteTotal || cartao.limite) || 0;
      const usado = calcularUsadoCartao(cartao.nome);
      cartao.limiteUsado = usado;
      cartao.limiteDisponivel = limiteTotal > 0 ? Math.max(0, Math.round((limiteTotal - usado) * 100) / 100) : 0;
    });
  }

  if (Array.isArray(STATE.contas)) {
    STATE.contas.forEach(conta => {
      if (!conta || conta.tipo !== 'cartao' || !conta.nome) return;
      const limiteTotal = Number(conta.limite || conta.limiteTotal) || 0;
      const usado = calcularUsadoCartao(conta.nome);
      conta.limiteUsado = usado;
      conta.limiteDisponivel = limiteTotal > 0 ? Math.max(0, Math.round((limiteTotal - usado) * 100) / 100) : 0;
    });
  }
}

/* ================= GESTÃO INTELIGENTE DE CARTÕES DE CRÉDITO ================= */
function obterInfoCartaoInteligente(cartao) {
  const hoje = hojeLocalISO();
  const [anoHoje, mesHoje, diaHoje] = hoje.split('-').map(Number);
  const diaFechamento = parseInt(cartao.diaFechamento, 10) || 1;
  const diaVencimento = parseInt(cartao.diaVencimento, 10) || 10;
  const limiteTotal = Number(cartao.limiteTotal || cartao.limite) || 0;

  const compAtual = obterCompetenciaFaturaDashboard(cartao.nome, diaFechamento, hoje);
  const itensFaturaAtual = lancamentosDaFatura(cartao.nome, compAtual.ano, compAtual.mes);
  const totalFaturaAtual = itensFaturaAtual.reduce((s, l) => s + l.valor, 0);
  const totalFaturaPendente = itensFaturaAtual.filter(l => l.faturaPaga !== true).reduce((s, l) => s + (Number(l.valor) || 0), 0);

  // Todo o comprometimento da fatura sem flag faturaPaga === true
  const pendentesCartao = (STATE.lancamentos || []).filter(
    l => l.conta === cartao.nome && l.tipo === 'despesa' && !ehLancamentoPagamentoFatura(l) && l.faturaPaga !== true
  );
  const totalComprometido = Math.round(pendentesCartao.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
  const limiteDisponivel = limiteTotal > 0 ? Math.max(0, Math.round((limiteTotal - totalComprometido) * 100) / 100) : 0;
  const pctUsado = (limiteTotal > 0) ? Math.min(100, Math.round((totalComprometido / limiteTotal) * 100)) : 0;

  // Vencimento se comprar HOJE
  const compCompraHoje = competenciaFatura(hoje, diaFechamento);
  const vencCompraHoje = calcularVencimentoFatura(compCompraHoje.ano, compCompraHoje.mes, diaFechamento, diaVencimento);
  const msPorDia = 86400000;
  const diasAtePagar = Math.max(0, Math.round((new Date(vencCompraHoje + 'T12:00:00').getTime() - new Date(hoje + 'T12:00:00').getTime()) / msPorDia));

  // Próximo fechamento
  let proxFechAno = anoHoje, proxFechMes = mesHoje;
  if (diaHoje >= diaFechamento) {
    proxFechMes++;
    if (proxFechMes > 12) { proxFechMes = 1; proxFechAno++; }
  }
  const proxFechamento = dataCobranca(proxFechAno, proxFechMes, diaFechamento);
  const diasAteFechamento = Math.max(0, Math.round((new Date(proxFechamento + 'T12:00:00').getTime() - new Date(hoje + 'T12:00:00').getTime()) / msPorDia));

  const ehMelhorDia = (diaHoje === diaFechamento + 1) || (diaFechamento === 31 && diaHoje === 1) || (diaHoje === diaFechamento);

  return {
    cartao,
    nome: cartao.nome,
    cor: cartao.cor || '#1A6FE0',
    limiteTotal,
    limiteDisponivel,
    totalComprometido,
    totalFaturaAtual,
    totalFaturaPendente,
    pctUsado,
    diaFechamento,
    diaVencimento,
    compAtual,
    vencimentoAtual: calcularVencimentoFatura(compAtual.ano, compAtual.mes, diaFechamento, diaVencimento),
    vencCompraHoje,
    diasAtePagar,
    diasAteFechamento,
    ehMelhorDia
  };
}

/* ================= UI/UX LUXO: 3D CARDS, ROLLING NUMBERS, SPOTLIGHT & AMBIENT GLOW ================= */

/**
 * 4. Física de Contadores / Rolling Numbers
 * Animação numérica com desaceleração exponencial (easeOutExpo) para efeito de painel de alta precisão.
 */
function animarNumero(elemento, valorFinal, duracao = 600) {
  const el = typeof elemento === 'string' ? document.getElementById(elemento) : elemento;
  if (!el) return;

  const numFinal = Number(valorFinal) || 0;
  let valorInicial = 0;
  if (el.dataset.valorRaw !== undefined) {
    valorInicial = parseFloat(el.dataset.valorRaw) || 0;
  } else {
    const rawTxt = (el.textContent || '').replace(/[^\d,-]/g, '').replace(',', '.');
    valorInicial = parseFloat(rawTxt) || 0;
  }

  el.dataset.valorRaw = String(numFinal);

  if (el._animRaf) {
    cancelAnimationFrame(el._animRaf);
    el._animRaf = null;
  }

  if (Math.abs(valorInicial - numFinal) < 0.005) {
    el.textContent = toBRL(numFinal);
    return;
  }

  const delta = numFinal - valorInicial;
  const inicioTempo = performance.now();

  function step(agora) {
    const decorrido = agora - inicioTempo;
    const progresso = Math.min(1, Math.max(0, decorrido / duracao));
    // Curva de desaceleração suave easeOutExpo
    const fatorEase = progresso === 1 ? 1 : 1 - Math.pow(2, -10 * progresso);
    const valorAtual = valorInicial + delta * fatorEase;

    el.textContent = toBRL(valorAtual);

    if (progresso < 1) {
      el._animRaf = requestAnimationFrame(step);
    } else {
      el.textContent = toBRL(numFinal);
      el._animRaf = null;
    }
  }

  el._animRaf = requestAnimationFrame(step);
}

/* Efeitos decorativos Ambient Glow e Spotlight Glow removidos para interface flat/precision de alta legibilidade */
function atualizarAmbientGlow() {
  return null;
}

function inicializarSpotlightGlow() {
  return;
}

/**
 * 3. Cartões de Crédito Físicos 3D (HTML Template & Efeito de Inclinação via Event Delegation)
 */
function gerarCartaoFisico3DHTML(cartao, compMes, compAno) {
  const corBase = cartao.cor || '#1A6FE0';
  const nomeCartao = (cartao.nome || 'Cartão').toUpperCase();
  const mesFormatado = String(compMes || 1).padStart(2, '0');
  const anoFormatado = String(compAno || new Date().getFullYear()).slice(2);
  const digitos = String(cartao.diaVencimento || 10).padStart(2, '0') + String(cartao.diaFechamento || 1).padStart(2, '0');
  const grad = `linear-gradient(135deg, ${corBase} 0%, #0d1a2d 100%)`;

  return `
    <div class="credit-card-3d-wrap" style="--card-glow:${escHtml(corBase)}55">
      <div class="credit-card-3d" style="background:${grad}">
        <div class="card-holographic"></div>
        <div class="card-3d-top" style="display:flex;justify-content:space-between;align-items:center;position:relative;z-index:2">
          <div style="display:flex;align-items:center;gap:10px">
            <div class="card-chip"></div>
            <i class="ti ti-wifi card-contactless" title="Aproximação"></i>
          </div>
          <div class="card-brand-logo" title="Mastercard / Bandeira">
            <div class="brand-circle c1"></div>
            <div class="brand-circle c2"></div>
          </div>
        </div>

        <div style="position:relative;z-index:2;margin:10px 0 4px">
          <div class="card-number-embossed">•••• •••• •••• ${digitos}</div>
          <div style="display:flex;justify-content:space-between;align-items:flex-end">
            <div>
              <div style="font-size:8px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1px;font-weight:700">Titular</div>
              <div class="card-holder-name">${escHtml(nomeCartao)}</div>
            </div>
            <div style="text-align:right">
              <div style="font-size:8px;color:rgba(255,255,255,.65);text-transform:uppercase;letter-spacing:1px;font-weight:700">Validade</div>
              <div class="card-expiry">${mesFormatado}/${anoFormatado}</div>
            </div>
          </div>
        </div>

        <div class="card-3d-bottom" style="position:relative;z-index:2;display:flex;justify-content:space-between;align-items:center;border-top:1px solid rgba(255,255,255,.18);padding-top:6px">
          <span style="font-size:9.5px;font-weight:600;color:rgba(255,255,255,.9)">Fecha dia ${cartao.diaFechamento || 1}</span>
          <span style="font-size:9.5px;font-weight:600;color:rgba(255,255,255,.9)">Vence dia ${cartao.diaVencimento || 10}</span>
        </div>
      </div>
    </div>
  `;
}

function resetarInclinacaoCartao3D(wrap) {
  if (!wrap) return;
  const card = wrap.querySelector('.credit-card-3d');
  if (!card) return;
  card.style.transition = 'transform 0.45s cubic-bezier(0.16, 1, 0.3, 1)';
  card.style.transform = 'rotateX(0deg) rotateY(0deg) scale3d(1, 1, 1)';
}

function inicializarEfeito3DCartoes() {
  const container = document.getElementById('cartoes-content');
  if (!container || container.dataset.tiltDelegado === '1') return;
  container.dataset.tiltDelegado = '1';

  let wrapAtivo = null;
  let rafId = null;

  container.addEventListener('mousemove', (e) => {
    const wrap = e.target && e.target.closest ? e.target.closest('.credit-card-3d-wrap') : null;
    if (wrap !== wrapAtivo) {
      if (wrapAtivo) resetarInclinacaoCartao3D(wrapAtivo);
      wrapAtivo = wrap;
    }
    if (!wrap) return;
    const card = wrap.querySelector('.credit-card-3d');
    if (!card) return;

    const rect = wrap.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const rotateY = ((x - centerX) / centerX) * 14;
    const rotateX = -((y - centerY) / centerY) * 14;

    if (rafId) cancelAnimationFrame(rafId);
    rafId = requestAnimationFrame(() => {
      card.style.transition = 'transform 0.08s ease-out';
      card.style.transform = `rotateX(${rotateX.toFixed(2)}deg) rotateY(${rotateY.toFixed(2)}deg) scale3d(1.02, 1.02, 1.02)`;
      const holo = card.querySelector('.card-holographic');
      if (holo) {
        holo.style.backgroundPosition = `${Math.round((x / rect.width) * 100)}% ${Math.round((y / rect.height) * 100)}%`;
      }
    });
  }, { passive: true });

  container.addEventListener('mouseleave', () => {
    if (rafId) cancelAnimationFrame(rafId);
    if (wrapAtivo) {
      resetarInclinacaoCartao3D(wrapAtivo);
      wrapAtivo = null;
    }
  });
}

function abrirModalGerirCartoes() {
  const selFech = document.getElementById('cartao-int-fechamento');
  const selVenc = document.getElementById('cartao-int-vencimento');
  if (selFech && selVenc && !selFech.children.length) {
    let opts = '';
    for (let d = 1; d <= 31; d++) opts += `<option value="${d}">Dia ${d}</option>`;
    selFech.innerHTML = opts;
    selVenc.innerHTML = opts;
  }
  const picker = document.getElementById('cartao-int-color-picker');
  if (picker && !picker.dataset.bound) {
    picker.dataset.bound = '1';
    picker.querySelectorAll('.cartao-color-swatch').forEach(sw => {
      sw.addEventListener('click', () => {
        picker.querySelectorAll('.cartao-color-swatch').forEach(s => s.classList.remove('active'));
        sw.classList.add('active');
        document.getElementById('cartao-int-cor').value = sw.dataset.color;
      });
    });
  }
  cancelarEdicaoCartaoInteligente();
  renderListaCartoesInteligentes();
  abrirModal('modal-gerir-cartoes');
}

function renderListaCartoesInteligentes() {
  const cont = document.getElementById('cartoes-int-lista');
  if (!cont) return;
  const cartoes = STATE.cartoes || [];
  if (!cartoes.length) {
    cont.innerHTML = `<div class="help-text" style="padding:.75rem 0">Nenhum cartão cadastrado. Adicione um acima.</div>`;
    return;
  }
  cont.innerHTML = cartoes.map(c => {
    const info = obterInfoCartaoInteligente(c);
    return `
      <div class="cartao-int-item" style="border-left:4px solid ${c.cor || '#1A6FE0'};display:flex;align-items:center;justify-content:space-between;padding:10px 12px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="background:${c.cor || '#1A6FE0'};width:12px;height:12px;border-radius:50%;display:inline-block"></span>
          <div>
            <div style="font-weight:700;color:var(--text);font-size:13.5px">${escHtml(c.nome)}</div>
            <div style="font-size:11px;color:var(--text3)">
              Fecha dia ${c.diaFechamento} · Vence dia ${c.diaVencimento} · 
              Limite: <span class="valor-sensivel">${toBRL(c.limiteTotal)}</span> (Disp: <span class="valor-sensivel" style="color:var(--good);font-weight:600">${toBRL(info.limiteDisponivel)}</span>)
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px">
          <button class="icon-btn" onclick="editarCartaoInteligente('${c.id}')" title="Editar"><i class="ti ti-edit"></i></button>
          <button class="icon-btn" onclick="excluirCartaoInteligente('${c.id}')" title="Excluir" style="color:var(--bad)"><i class="ti ti-trash"></i></button>
        </div>
      </div>
    `;
  }).join('');
}

function cancelarEdicaoCartaoInteligente() {
  const inpId = document.getElementById('cartao-int-id');
  const inpNome = document.getElementById('cartao-int-nome');
  const inpLim = document.getElementById('cartao-int-limite');
  const selFech = document.getElementById('cartao-int-fechamento');
  const selVenc = document.getElementById('cartao-int-vencimento');
  const inpCor = document.getElementById('cartao-int-cor');
  const btnCanc = document.getElementById('cartao-int-btn-cancelar');
  const titForm = document.getElementById('cartao-int-form-titulo');

  if (inpId) inpId.value = '';
  if (inpNome) inpNome.value = '';
  if (inpLim) inpLim.value = '';
  if (selFech) selFech.value = '1';
  if (selVenc) selVenc.value = '10';
  if (inpCor) inpCor.value = '#1A6FE0';
  if (btnCanc) btnCanc.style.display = 'none';
  if (titForm) titForm.innerHTML = `<i class="ti ti-plus"></i> Cadastrar Cartão`;

  const picker = document.getElementById('cartao-int-color-picker');
  if (picker) {
    picker.querySelectorAll('.cartao-color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === '#1A6FE0'));
  }
}

function editarCartaoInteligente(id) {
  const c = (STATE.cartoes || []).find(x => x.id === id);
  if (!c) return;
  document.getElementById('cartao-int-id').value = c.id;
  document.getElementById('cartao-int-nome').value = c.nome;
  document.getElementById('cartao-int-limite').value = toBRL(c.limiteTotal).replace('R$', 'R$ ');
  document.getElementById('cartao-int-fechamento').value = c.diaFechamento || 1;
  document.getElementById('cartao-int-vencimento').value = c.diaVencimento || 10;
  document.getElementById('cartao-int-cor').value = c.cor || '#1A6FE0';
  document.getElementById('cartao-int-btn-cancelar').style.display = '';
  document.getElementById('cartao-int-form-titulo').innerHTML = `<i class="ti ti-edit"></i> Editar Cartão: ${escHtml(c.nome)}`;
  const picker = document.getElementById('cartao-int-color-picker');
  if (picker) {
    picker.querySelectorAll('.cartao-color-swatch').forEach(s => s.classList.toggle('active', s.dataset.color === (c.cor || '#1A6FE0')));
  }
}

async function salvarCartaoInteligente() {
  const id = document.getElementById('cartao-int-id').value;
  const nome = document.getElementById('cartao-int-nome').value.trim();
  const limite = moedaToNumber(document.getElementById('cartao-int-limite').value);
  const diaFechamento = parseInt(document.getElementById('cartao-int-fechamento').value, 10) || 1;
  const diaVencimento = parseInt(document.getElementById('cartao-int-vencimento').value, 10) || 10;
  const cor = document.getElementById('cartao-int-cor').value || '#1A6FE0';

  if (!nome) { toast('Informe o nome do cartão.', 'err'); return; }
  if (!limite || limite <= 0) { toast('Informe o limite total do cartão.', 'err'); return; }

  if (!Array.isArray(STATE.cartoes)) STATE.cartoes = [];

  if (id) {
    const idx = STATE.cartoes.findIndex(c => c.id === id);
    if (idx >= 0) {
      STATE.cartoes[idx] = { ...STATE.cartoes[idx], nome, limiteTotal: limite, diaFechamento, diaVencimento, cor };
    }
  } else {
    STATE.cartoes.push({ id: uid(), nome, limiteTotal: limite, diaFechamento, diaVencimento, cor });
  }

  sincronizarEstruturaCartoes();
  normalizarLancamentosCartaoExistentes();
  await salvarDados();
  cancelarEdicaoCartaoInteligente();
  renderListaCartoesInteligentes();
  popularContasSelect();
  renderPaginaAtiva();
  renderDashboard();
  if (document.getElementById('page-cartoes')) renderCartoes();
  toast('Cartão salvo com sucesso!', 'ok');
}

function excluirCartaoInteligente(id) {
  const c = (STATE.cartoes || []).find(x => x.id === id);
  if (!c) return;
  abrirConfirmacao(`Deseja remover o cartão "${c.nome}"? Seus lançamentos existentes serão mantidos.`, async () => {
    STATE.cartoes = (STATE.cartoes || []).filter(x => x.id !== id);
    STATE.contas = (STATE.contas || []).filter(x => x.id !== id && x.nome !== c.nome);
    await salvarDados();
    renderListaCartoesInteligentes();
    popularContasSelect();
    toast('Cartão removido.', 'ok');
  }, 'Excluir Cartão');
}

/* ================= SIMULADOR À VISTA VS. PARCELADO ================= */
let ultimoResultadoSimulador = null;

function popularSelectParcelasSimulador() {
  const sel = document.getElementById('sim-parc-qtd');
  if (!sel) return;
  let html = '';
  for (let i = 2; i <= 24; i++) {
    html += `<option value="${i}" ${i === 10 ? 'selected' : ''}>${i}x (sem juros)</option>`;
  }
  sel.innerHTML = html;
}

function abrirModalSimuladorParcelado() {
  popularSelectParcelasSimulador();
  calcularSimuladorParcelado();
  abrirModal('modal-simulador-parcelado');
}

function calcularSimuladorParcelado() {
  const inpVal = document.getElementById('sim-parc-valor');
  const inpDesc = document.getElementById('sim-parc-desconto');
  const selQtd = document.getElementById('sim-parc-qtd');
  const inpTaxa = document.getElementById('sim-parc-taxa');
  if (!inpVal || !inpDesc || !selQtd || !inpTaxa) return;

  const valorCompra = moedaToNumber(inpVal.value) || 0;
  const descontoPct = parseFloat(inpDesc.value) || 0;
  const parcelas = parseInt(selQtd.value, 10) || 1;
  const taxaMensal = (parseFloat(inpTaxa.value) || 0) / 100;

  if (valorCompra <= 0) return;

  const totalVista = Math.round(valorCompra * (1 - descontoPct / 100) * 100) / 100;
  const descontoReais = Math.round((valorCompra - totalVista) * 100) / 100;
  const valorParcela = Math.round((valorCompra / parcelas) * 100) / 100;

  let saldoCofre = valorCompra;
  let totalRendimentoAcumulado = 0;
  const projecaoMeses = [];

  for (let m = 1; m <= parcelas; m++) {
    const rendimentoMes = Math.round(saldoCofre * taxaMensal * 100) / 100;
    totalRendimentoAcumulado += rendimentoMes;
    const saldoAposRendimento = saldoCofre + rendimentoMes;
    const saldoFinalMes = Math.max(0, Math.round((saldoAposRendimento - valorParcela) * 100) / 100);

    projecaoMeses.push({
      mes: m,
      saldoInicial: saldoCofre,
      rendimentoMes,
      parcelaPaga: valorParcela,
      saldoRestante: saldoFinalMes
    });

    saldoCofre = saldoFinalMes;
  }

  totalRendimentoAcumulado = Math.round(totalRendimentoAcumulado * 100) / 100;
  const diferenca = Math.round(Math.abs(descontoReais - totalRendimentoAcumulado) * 100) / 100;
  const aVistaVence = descontoReais >= totalRendimentoAcumulado;

  ultimoResultadoSimulador = {
    valorCompra,
    descontoPct,
    parcelas,
    taxaMensalPct: parseFloat(inpTaxa.value) || 0,
    totalVista,
    descontoReais,
    valorParcela,
    totalRendimentoAcumulado,
    aVistaVence,
    diferenca
  };

  const banner = document.getElementById('sim-parc-veredito-banner');
  const cardVista = document.getElementById('sim-card-avista');
  const cardParc = document.getElementById('sim-card-parcelado');
  if (cardVista) cardVista.classList.toggle('sim-card-vencedor', aVistaVence);
  if (cardParc) cardParc.classList.toggle('sim-card-vencedor', !aVistaVence);

  if (banner) {
    banner.className = `sim-veredito-box ${aVistaVence ? 'veredito-avista' : 'veredito-parcelado'}`;
    if (aVistaVence) {
      banner.innerHTML = `
        <i class="ti ti-cash" style="font-size:24px"></i>
        <div>
          <div class="sim-veredito-titulo">Veredito: Pague no PIX / À Vista!</div>
          <div class="sim-veredito-sub">
            O desconto à vista de <strong>${descontoPct}% (${toBRL(descontoReais)})</strong> supera os rendimentos que você teria no Cofre (<strong>${toBRL(totalRendimentoAcumulado)}</strong>).
            Você garante um ganho líquido real de <strong class="valor-sensivel">${toBRL(diferenca)}</strong> no ato da compra.
          </div>
        </div>
      `;
    } else {
      banner.innerHTML = `
        <i class="ti ti-credit-card" style="font-size:24px"></i>
        <div>
          <div class="sim-veredito-titulo">Veredito: Parcele no Cartão e guarde o valor no Cofre!</div>
          <div class="sim-veredito-sub">
            Parcelando em <strong>${parcelas}x sem juros</strong> de <strong>${toBRL(valorParcela)}</strong> e deixando o montante rendendo a <strong>${(taxaMensal * 100).toFixed(2)}% a.m.</strong>, você acumula <strong class="valor-sensivel">${toBRL(totalRendimentoAcumulado)}</strong> de rendimento líquido, superando o desconto à vista em <strong class="valor-sensivel">${toBRL(diferenca)}</strong>!
          </div>
        </div>
      `;
    }
  }

  const elVistaVal = document.getElementById('sim-avista-valor-final');
  const elVistaDet = document.getElementById('sim-avista-detalhe');
  const elParcVal = document.getElementById('sim-parc-valor-final');
  const elParcDet = document.getElementById('sim-parc-detalhe');
  if (elVistaVal) elVistaVal.textContent = toBRL(totalVista);
  if (elVistaDet) elVistaDet.textContent = `Economia imediata de ${toBRL(descontoReais)} (${descontoPct}%) no ato.`;
  if (elParcVal) elParcVal.textContent = `+ ${toBRL(totalRendimentoAcumulado)}`;
  if (elParcDet) elParcDet.textContent = `${parcelas}x de ${toBRL(valorParcela)} · Rendimento acumulado no Cofre.`;

  const tbody = document.getElementById('sim-parc-mes-a-mes-tbody');
  if (tbody) {
    tbody.innerHTML = projecaoMeses.map(p => `
      <tr>
        <td style="font-weight:600">Mês ${p.mes}</td>
        <td class="valor-sensivel">${toBRL(p.saldoInicial)}</td>
        <td class="valor-sensivel" style="color:var(--good)">+ ${toBRL(p.rendimentoMes)}</td>
        <td class="valor-sensivel" style="color:var(--bad)">- ${toBRL(p.parcelaPaga)}</td>
        <td class="valor-sensivel" style="text-align:right;font-weight:700">${toBRL(p.saldoRestante)}</td>
      </tr>
    `).join('');
  }
}

function lancarCompraSimulada() {
  if (!ultimoResultadoSimulador) return;
  const res = ultimoResultadoSimulador;
  fecharModal('modal-simulador-parcelado');
  abrirModalLancamento();

  const inpDesc = document.getElementById('lanc-descricao');
  const inpVal = document.getElementById('lanc-valor');
  const selParc = document.getElementById('lanc-parcelas');

  if (res.aVistaVence) {
    if (inpDesc) inpDesc.value = `Compra à vista (${res.descontoPct}% desc)`;
    if (inpVal) inpVal.value = toBRL(res.totalVista).replace('R$', 'R$ ');
    if (selParc) selParc.value = '1';
  } else {
    if (inpDesc) inpDesc.value = `Compra parcelada (${res.parcelas}x)`;
    if (inpVal) inpVal.value = toBRL(res.valorCompra).replace('R$', 'R$ ');
    if (selParc) selParc.value = String(res.parcelas);
  }
  atualizarDicaParcelas();
}

/* ================= MODO STEALTH / PRIVACIDADE INTELIGENTE ================= */
let timerInatividadeStealth = null;

function obterTempoInatividadeStealthMs() {
  try {
    const val = localStorage.getItem('cofin-stealth-timeout');
    if (val !== null) {
      const min = parseInt(val, 10);
      if (!isNaN(min)) return min * 60 * 1000;
    }
  } catch (e) {}
  return 3 * 60 * 1000; // Padrão: 3 minutos
}

function salvarTempoStealthInatividade(valor) {
  const min = parseInt(valor, 10);
  const minVal = isNaN(min) ? 3 : min;
  try {
    localStorage.setItem('cofin-stealth-timeout', String(minVal));
  } catch (e) {}
  reiniciarTemporizadorInatividadeStealth();
  if (minVal > 0) {
    toast(`Modo Stealth ativará após ${minVal} minuto(s) sem atividade.`, 'info');
  } else {
    toast('Modo Stealth automático por inatividade desativado (ativará apenas manualmente).', 'info');
  }
}

function reiniciarTemporizadorInatividadeStealth() {
  clearTimeout(timerInatividadeStealth);
  const ms = obterTempoInatividadeStealthMs();
  if (ms <= 0) return; // 0 = Nunca
  timerInatividadeStealth = setTimeout(() => {
    aplicarModoStealth(true);
    const min = Math.round(ms / 60000);
    toast(`Modo Stealth ativado automaticamente por inatividade (${min} min).`, 'info');
  }, ms);
}

function aplicarModoStealth(ativo, persistir) {
  if (document.body) document.body.classList.toggle('stealth-mode', ativo);
  document.documentElement.classList.toggle('privacidade', ativo);
  document.documentElement.classList.toggle('privacidade-ativa', ativo);

  if (persistir !== false) {
    try { localStorage.setItem('cofin-stealth-mode', ativo ? '1' : '0'); } catch (e) {}
  }

  const btnTop = document.getElementById('btn-privacidade');
  const iconeTop = document.getElementById('icone-privacidade');
  const lblTop = document.getElementById('label-privacidade');

  if (iconeTop) iconeTop.className = ativo ? 'ti ti-eye-off' : 'ti ti-eye';
  if (lblTop) lblTop.textContent = ativo ? ' Stealth Ativo' : ' Stealth Mode';
  if (btnTop) btnTop.classList.toggle('btn-primary', ativo);

  if (ativo) {
    ativarObservadorPrivacidade();
    blindarValores(document.body);
  }
}

function alternarModoStealth() {
  const ativo = !document.body.classList.contains('stealth-mode');
  aplicarModoStealth(ativo);
  toast(ativo ? 'Modo Stealth ativado (Valores ocultados).' : 'Modo Stealth desativado.', 'info');
}

function inicializarModoStealth() {
  let salvo = false;
  try { salvo = localStorage.getItem('cofin-stealth-mode') === '1'; } catch (e) {}
  if (salvo) aplicarModoStealth(true, false);

  ['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev => {
    document.addEventListener(ev, reiniciarTemporizadorInatividadeStealth, { passive: true, capture: true });
  });
  reiniciarTemporizadorInatividadeStealth();

  // Blur e visibilitychange foram desativados para evitar ativação involuntária ao alternar janelas/telas
}

/* ================= RASTREADOR DE REEMBOLSOS (IOU TRACKER) ================= */
function toggleCamposReembolsoModal() {
  const chk = document.getElementById('lanc-reembolsavel-chk');
  const wrap = document.getElementById('lanc-reembolsavel-wrap');
  if (wrap && chk) {
    wrap.style.display = chk.checked ? 'block' : 'none';
  }
}

function renderWidgetReembolsos() {
  const listaEl = document.getElementById('dash-reembolsos-lista');
  const totalEl = document.getElementById('dash-reembolsos-total');
  if (!listaEl) return;

  const pendentes = (STATE.lancamentos || []).filter(l => l.tipo === 'despesa' && l.ehReembolsavel && !l.reembolsado);
  const total = pendentes.reduce((s, l) => s + l.valor, 0);

  if (totalEl) totalEl.innerHTML = `<span class="valor-sensivel" style="font-weight:700;color:#F59E0B">${toBRL(total)}</span> a recuperar`;

  if (!pendentes.length) {
    listaEl.innerHTML = `
      <div class="reembolsos-empty-banner">
        <div class="reembolsos-empty-icon"><i class="ti ti-circle-check"></i></div>
        <div class="reembolsos-empty-content">
          <div class="reembolsos-empty-title">Tudo 100% recuperado</div>
          <div class="reembolsos-empty-desc">Nenhum adiantamento ou despesa de terceiro pendente de reembolso. Todo o dinheiro na rua já retornou para as suas contas.</div>
        </div>
      </div>`;
    return;
  }

  listaEl.innerHTML = `
    <div class="reembolsos-grid-items">
      ${pendentes.map(l => {
        const [a, m, d] = (l.data || '').split('-');
        const dataFmt = a ? `${d}/${m}/${a}` : l.data;
        return `
          <div class="reembolso-row dash-clickable" onclick="if(podeExecutarCliqueDashboard(event)) abrirModalLancamento('${l.id}')" title="Abrir lançamento para detalhes" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius)">
            <div style="min-width:0;flex:1;margin-right:8px">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="font-weight:700;font-size:12.5px;color:var(--text);min-width:0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;word-break:break-word;line-height:1.3">${escHtml(l.descricao)}</span>
                <span class="reembolso-devedor-tag"><i class="ti ti-user"></i> ${escHtml(l.reembolsoDevedor || 'Terceiro')}</span>
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">
                <span>${dataFmt}</span> · <span>${escHtml(l.conta || 'Conta')}</span>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
              <span class="valor-sensivel" style="font-weight:800;font-size:13.5px;color:#F59E0B">${toBRL(l.valor)}</span>
              <button type="button" class="btn btn-sm" onclick="event.stopPropagation(); confirmarReembolso('${l.id}')" title="Confirmar recebimento do reembolso"><i class="ti ti-check"></i> Reembolsar</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

function renderWidgetTop3Categorias() {
  const container = document.getElementById('dash-top3-content');
  const totalEl = document.getElementById('dash-top3-total');
  if (!container) return;

  const mesAtual = hojeLocalISO().slice(0, 7);
  const despesasDoMes = (STATE.lancamentos || []).filter(l =>
    l.tipo === 'despesa' &&
    !isLancamentoTransferencia(l) &&
    !l.ehMovimentoCofre &&
    !(l.ehReembolsavel && l.reembolsado) &&
    mesCompetenciaLancamento(l) === mesAtual
  );

  const porCat = {};
  despesasDoMes.forEach(l => {
    const rawCat = String(l.categoria || 'Sem categoria').trim() || 'Sem categoria';
    porCat[rawCat] = (porCat[rawCat] || 0) + (Number(l.valor) || 0);
  });

  const ordenados = Object.entries(porCat).sort((a, b) => b[1] - a[1]);
  const top3 = ordenados.slice(0, 3);
  const somaTop3 = top3.reduce((s, [, v]) => s + v, 0);

  if (totalEl) {
    totalEl.innerHTML = top3.length ? `Top 3: <span class="valor-sensivel mv-bad" style="font-weight:700">${toBRL(somaTop3)}</span>` : '';
  }

  if (!top3.length) {
    container.innerHTML = `
      <div class="empty" style="padding:1.25rem 1rem">
        <i class="ti ti-chart-pie" style="font-size:24px;color:var(--text3)"></i>
        <p style="margin:.4rem 0;color:var(--text2)">Nenhuma despesa registrada neste mês.</p>
        <span class="help-text">Seus maiores gastos do mês aparecerão aqui com escala comparativa.</span>
      </div>`;
    return;
  }

  const maxVal = top3[0][1] || 1;
  const rankIcons = ['ti-crown', 'ti-medal', 'ti-award'];

  container.innerHTML = `
    <div class="top3-cat-list">
      ${top3.map(([rawCat, val], i) => {
        const nomeExib = formatarCategoriaExibicao(rawCat);
        const rank = i + 1;
        const pct = Math.min(100, Math.max(8, (val / maxVal) * 100));
        return `
          <div class="top3-cat-item dash-clickable" data-drill-cat="${escHtml(rawCat)}" data-drill-mes="${escHtml(mesAtual)}" onclick="if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ mes: this.dataset.drillMes, tipo: 'despesa', categoria: this.dataset.drillCat, modoFiltroMes: 'fatura' })" title="Ver despesas de ${escHtml(nomeExib)} neste mês">
            <div class="top3-cat-header">
              <div class="top3-cat-name-wrap">
                <span class="top3-cat-rank top3-rank-${rank}"><i class="ti ${rankIcons[i]}"></i></span>
                <span class="top3-cat-name" title="${escHtml(nomeExib)}">${escHtml(nomeExib)}</span>
              </div>
              <span class="top3-cat-valor valor-sensivel" title="${toBRL(val)}">${toBRL(val)}</span>
            </div>
            <div class="top3-cat-bar-track" title="${pct.toFixed(1)}% do maior gasto (${escHtml(formatarCategoriaExibicao(top3[0][0]))})">
              <div class="top3-cat-bar-fill top3-fill-${rank}" style="width: ${pct}%"></div>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

/* ================= ANTI-METAS (REDUÇÃO DE HÁBITOS) ================= */
function renderAntiMetasWidget() {
  const container = document.getElementById('dash-antimetas-content');
  if (!container) return;

  if (!Array.isArray(STATE.antiMetas)) STATE.antiMetas = [];

  if (STATE.antiMetas.length === 0) {
    STATE.antiMetas.push({
      id: uid(),
      categoriaId: 'Alimentação',
      limiteMensal: 1000
    });
  }

  const am = STATE.antiMetas[0];
  const catAlvo = am.categoriaId || 'Alimentação';
  const limite = Number(am.limiteMensal) || 1000;

  const mesAtual = hojeLocalISO().slice(0, 7);
  let gastoAtual = 0;
  const lancsMesCat = [];

  (STATE.lancamentos || []).forEach(l => {
    if (l.tipo !== 'despesa' || isLancamentoTransferencia(l) || l.ehMovimentoCofre) return;
    if (mesCompetenciaLancamento(l) !== mesAtual) return;
    const { macro, completo } = extrairMacroESubcategoria(l.categoria);
    if (macro.toLowerCase() === catAlvo.toLowerCase() || completo.toLowerCase() === catAlvo.toLowerCase()) {
      const val = Number(l.valor) || 0;
      gastoAtual += val;
      lancsMesCat.push(l);
    }
  });

  const pct = limite > 0 ? Math.round((gastoAtual / limite) * 100) : 0;
  const pctRing = Math.min(100, Math.max(0, pct));

  // Cores: <80% Verde/Azul, 80-100% Laranja, >100% Vermelho
  let cor = '#10B981';
  let status = 'Sob Controle';

  if (pct > 100) {
    cor = '#EF4444';
    status = 'Estourou!';
  } else if (pct >= 80) {
    cor = '#F59E0B';
    status = 'Atenção';
  }

  const restante = limite - gastoAtual;

  // Ritmo e pacing diário
  const hoje = new Date();
  const ultimoDiaMes = new Date(hoje.getFullYear(), hoje.getMonth() + 1, 0).getDate();
  const diaAtual = Math.min(hoje.getDate(), ultimoDiaMes);
  const diasRestantes = Math.max(1, ultimoDiaMes - diaAtual + 1);
  const tetoDiarioSeguro = restante > 0 ? (restante / diasRestantes) : 0;
  const gastoMedioDiario = diaAtual > 0 ? (gastoAtual / diaAtual) : 0;
  const projecaoMes = gastoMedioDiario * ultimoDiaMes;

  // 2 últimos lançamentos da categoria
  const ultimosLancs = [...lancsMesCat]
    .sort((a,b) => (b.data||'').localeCompare(a.data||''))
    .slice(0, 2);

  container.innerHTML = `
    <div class="antimeta-box dash-clickable" data-drill-cat="${escHtml(catAlvo)}" data-drill-mes="${escHtml(mesAtual)}" onclick="if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ mes: this.dataset.drillMes, tipo: 'despesa', categoria: this.dataset.drillCat, modoFiltroMes: 'fatura' })" title="Ver despesas de ${escHtml(formatarCategoriaExibicao(catAlvo))} no mês">
      <div class="antimeta-ring" style="--am-cor: ${cor}; --am-pct: ${pctRing};">
        <div class="antimeta-ring-center">
          <span class="antimeta-pct-num">${pct}%</span>
          <span class="antimeta-status-chip" style="color:${cor}">${status}</span>
        </div>
      </div>
      <div class="antimeta-details">
        <div class="antimeta-cat-name" title="${escHtml(formatarCategoriaExibicao(catAlvo))}">${escHtml(formatarCategoriaExibicao(catAlvo))}</div>
        <div class="antimeta-values">
          <strong>${toBRL(gastoAtual)}</strong> <span class="help-text">/ teto ${toBRL(limite)}</span>
        </div>
        <div class="antimeta-sub-info">
          ${pct <= 100
            ? `<span style="color:var(--good)"><i class="ti ti-shield-check"></i> ${toBRL(restante)} restantes no mês</span>`
            : `<span style="color:var(--bad)"><i class="ti ti-alert-triangle"></i> Excedeu ${toBRL(Math.abs(restante))}</span>`}
        </div>
      </div>
    </div>

    <div class="antimeta-pacing-grid">
      <div class="antimeta-pace-item">
        <div class="antimeta-pace-label"><i class="ti ti-calendar-time"></i> Teto Diário Seguro</div>
        <div class="antimeta-pace-val valor-sensivel" style="color:${restante > 0 ? 'var(--good)' : 'var(--bad)'}">${toBRL(tetoDiarioSeguro)} <span style="font-size:10px;font-weight:400;color:var(--text3)">/dia</span></div>
        <div class="antimeta-pace-sub">${diasRestantes} dia(s) restantes no mês</div>
      </div>
      <div class="antimeta-pace-item">
        <div class="antimeta-pace-label"><i class="ti ti-chart-arrows"></i> Projeção no Ritmo</div>
        <div class="antimeta-pace-val valor-sensivel" style="color:${projecaoMes <= limite ? 'var(--text)' : 'var(--bad)'}">${toBRL(projecaoMes)}</div>
        <div class="antimeta-pace-sub">${projecaoMes <= limite ? 'Dentro do teto previsto' : 'Risco de ultrapassar'}</div>
      </div>
    </div>

    ${ultimosLancs.length > 0 ? `
      <div class="antimeta-recentes-wrap">
        <div style="font-size:10.5px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:0.04em">Últimos gastos na categoria</div>
        ${ultimosLancs.map(l => {
          const [a,m,d] = (l.data||'').split('-');
          return `
            <div class="antimeta-recente-item dash-clickable" onclick="if(podeExecutarCliqueDashboard(event)) abrirModalLancamento('${l.id}')" title="Abrir lançamento">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:170px" title="${escHtml(l.descricao)}">${d}/${m} · ${escHtml(l.descricao)}</span>
              <span class="valor-sensivel" style="font-weight:700;color:var(--text)">${toBRL(l.valor)}</span>
            </div>
          `;
        }).join('')}
      </div>
    ` : `
      <div class="antimeta-habit-banner">
        <i class="ti ti-sparkles" style="font-size:16px;flex-shrink:0"></i>
        <span><strong>100% sob controle:</strong> Nenhum gasto nesta categoria este mês! Seu orçamento está intacto.</span>
      </div>
    `}
  `;
}

function abrirModalAntiMetas() {
  if (!Array.isArray(STATE.antiMetas)) STATE.antiMetas = [];
  const am = STATE.antiMetas[0] || { categoriaId: 'Alimentação', limiteMensal: 1000 };
  const selCat = document.getElementById('antimeta-categoria');
  if (selCat) {
    selCat.innerHTML = construirOptionsCategoriasHTML('despesa', am.categoriaId);
  }
  const inpLim = document.getElementById('antimeta-limite');
  if (inpLim) {
    inpLim.value = toBRL(am.limiteMensal || 1000).replace('R$', 'R$ ');
  }
  abrirModal('modal-antimetas');
}

async function salvarAntiMeta() {
  const selCat = document.getElementById('antimeta-categoria');
  const inpLim = document.getElementById('antimeta-limite');
  if (!selCat || !inpLim) return;

  const categoriaId = selCat.value;
  const limiteMensal = moedaToNumber(inpLim.value);
  if (!categoriaId) {
    toast('Selecione uma categoria.', 'err');
    return;
  }
  if (!limiteMensal || limiteMensal <= 0) {
    toast('Informe um limite mensal válido maior que zero.', 'err');
    return;
  }

  if (!Array.isArray(STATE.antiMetas)) STATE.antiMetas = [];
  STATE.antiMetas[0] = {
    id: (STATE.antiMetas[0] && STATE.antiMetas[0].id) || uid(),
    categoriaId,
    limiteMensal
  };

  const btnSalvar = document.querySelector('#modal-antimetas .modal-actions .btn-primary');
  if (btnSalvar && (btnSalvar.classList.contains('btn-loading') || btnSalvar.classList.contains('btn-success'))) return;
  if (btnSalvar) btnSalvar.classList.add('btn-morphing', 'btn-loading');

  const savePromise = salvarDados();
  const minWait = new Promise(res => setTimeout(res, 400));
  await Promise.all([savePromise, minWait]);

  if (btnSalvar) {
    btnSalvar.classList.remove('btn-loading');
    btnSalvar.classList.add('btn-success');
  }
  await new Promise(res => setTimeout(res, 600));

  renderAntiMetasWidget();
  fecharModal('modal-antimetas');
  if (btnSalvar) btnSalvar.classList.remove('btn-loading', 'btn-success', 'btn-morphing');
  toast('Anti-Meta configurada com sucesso!', 'ok');
}

async function confirmarReembolso(id) {
  const lanc = (STATE.lancamentos || []).find(l => l.id === id);
  if (!lanc) return;

  abrirConfirmacao(`Confirmar o recebimento de ${toBRL(lanc.valor)} de "${lanc.reembolsoDevedor || 'Terceiro'}"? O valor entrará de volta no Saldo Disponível e neutralizará o gasto nas estatísticas.`, async () => {
    lanc.reembolsado = true;
    lanc.dataReembolso = hojeLocalISO();
    lanc.sincronizado = false;

    STATE.lancamentos.push({
      id: uid(),
      tipo: 'receita',
      data: hojeLocalISO(),
      descricao: `Reembolso recebido: ${lanc.descricao} (${lanc.reembolsoDevedor || 'Terceiro'})`,
      categoria: 'Reembolsos',
      conta: lanc.conta || (STATE.contas[0] ? STATE.contas[0].nome : 'Conta'),
      valor: lanc.valor,
      origem: 'reembolso',
      pago: true,
      ehReembolsoEntrada: true,
      reembolsoOrigemId: lanc.id,
      sincronizado: false
    });

    await salvarDados();
    renderPaginaAtiva();
    sincronizarEmSegundoPlano();
    toast(`Reembolso de ${toBRL(lanc.valor)} confirmado! Saldo recomposto.`, 'ok');
  }, 'Confirmar Reembolso');
}

/* ================= MÁQUINA DO TEMPO DE PATRIMÔNIO (NET WORTH SNAPSHOTS) ================= */
function calcularSnapshotPatrimonio(mesAnoAlvo) {
  const mesAno = mesAnoAlvo || hojeLocalISO().slice(0, 7);
  const [anoSnap, mesSnap] = mesAno.split('-').map(Number);
  const { patrimonioTotal, totalAlocado, saldoDisponivel } = calcularSaldoDisponivelGeral(mesAno);
  const totalCofres = totalAlocado;
  const saldoLivre = saldoDisponivel;

  // Coleta nomes de todos os cartões cadastrados e movimentados
  const nomesCartoes = new Set();
  (STATE.cartoes || []).forEach(c => c.nome && nomesCartoes.add(c.nome));
  (STATE.contas || []).filter(c => c.tipo === 'cartao').forEach(c => c.nome && nomesCartoes.add(c.nome));
  (STATE.lancamentos || []).forEach(l => {
    if (l.tipo === 'despesa' && l.faturaAno === anoSnap && l.faturaMes === mesSnap && l.conta) {
      nomesCartoes.add(l.conta);
    }
  });

  let faturaMesTotal = 0;
  nomesCartoes.forEach(nomeCartao => {
    const itens = lancamentosDaFatura(nomeCartao, anoSnap, mesSnap);
    itens.forEach(l => {
      faturaMesTotal += (Number(l.valor) || 0);
    });
  });

  const faturaCartao = Math.round(faturaMesTotal * 100) / 100;
  // O patrimônio líquido acumulado até o mês é o saldo total (patrimonioTotal),
  // que já computou a fatura e gastos do mês, sem descontar compras de parcelas futuras.
  const patrimonioLiquido = patrimonioTotal;

  return {
    id: uid(),
    mesAno,
    saldoLivre,
    totalCofres,
    dividasCartao: faturaCartao,
    faturaCartao: faturaCartao,
    faturaMes: faturaCartao,
    patrimonioLiquido,
    dataRegistro: new Date().toISOString()
  };
}

async function registrarSnapshotAtual(mesAnoAlvo, silencioso) {
  if (!Array.isArray(STATE.historicoPatrimonio)) STATE.historicoPatrimonio = [];
  const mesAno = mesAnoAlvo || hojeLocalISO().slice(0, 7);
  const snapshot = calcularSnapshotPatrimonio(mesAno);

  const idx = STATE.historicoPatrimonio.findIndex(s => s.mesAno === mesAno);
  if (idx >= 0) {
    STATE.historicoPatrimonio[idx] = { ...STATE.historicoPatrimonio[idx], ...snapshot };
  } else {
    STATE.historicoPatrimonio.push(snapshot);
  }

  STATE.historicoPatrimonio.sort((a, b) => a.mesAno.localeCompare(b.mesAno));

  await salvarDados();
  renderGraficoMaquinaTempo();

  const modalSnap = document.getElementById('modal-historico-snapshots');
  if (modalSnap && modalSnap.classList.contains('show')) {
    renderTabelaHistoricoSnapshots();
  }

  if (!silencioso) {
    toast(`Snapshot de patrimônio (${mesAno}) gravado com sucesso!`, 'ok');
  }
}

function renderGraficoMaquinaTempo() {
  const canvas = document.getElementById('rel-maquina-tempo-chart');
  const vazioEl = document.getElementById('rel-maquina-tempo-vazio');
  const wrapEl = document.getElementById('rel-maquina-tempo-chart-wrap');
  if (!canvas) return;

  if (!Array.isArray(STATE.historicoPatrimonio)) STATE.historicoPatrimonio = [];

  // Se já houver snapshots cadastrados, recalcula com a regra corrigida de fatura do mês
  if (STATE.historicoPatrimonio.length > 0) {
    STATE.historicoPatrimonio.forEach(s => {
      const recalc = calcularSnapshotPatrimonio(s.mesAno);
      s.saldoLivre = recalc.saldoLivre;
      s.totalCofres = recalc.totalCofres;
      s.dividasCartao = recalc.dividasCartao;
      s.faturaCartao = recalc.faturaCartao;
      s.faturaMes = recalc.faturaMes;
      s.patrimonioLiquido = recalc.patrimonioLiquido;
    });
  } else if (STATE.lancamentos && STATE.lancamentos.length > 0) {
    const snapAtual = calcularSnapshotPatrimonio();
    STATE.historicoPatrimonio.push(snapAtual);
    salvarDados();
  }

  const historico = STATE.historicoPatrimonio;

  if (!historico.length) {
    if (vazioEl) vazioEl.style.display = 'block';
    if (wrapEl) wrapEl.style.display = 'none';
    return;
  }

  if (vazioEl) vazioEl.style.display = 'none';
  if (wrapEl) wrapEl.style.display = 'block';

  if (typeof Chart !== 'undefined') {
    destruirChart('relMaquinaTempo');
    const ctx = canvas.getContext('2d');
    const grad = criarGradienteLinearChart(ctx, cssVar('--good') || '#10B981', 0.45, 0.02, 240);

    const nomesMesAbrev = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };

    const labels = historico.map(s => {
      const [ano, mes] = s.mesAno.split('-');
      return `${nomesMesAbrev[mes] || mes}/${ano.slice(2)}`;
    });

    const dataPatrimonio = historico.map(s => s.patrimonioLiquido);

    CHARTS.relMaquinaTempo = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [{
          label: 'Patrimônio Líquido',
          data: dataPatrimonio,
          borderColor: cssVar('--good') || '#10B981',
          backgroundColor: grad,
          fill: true,
          tension: 0.35,
          pointRadius: 5,
          pointHoverRadius: 8,
          pointBackgroundColor: cssVar('--good') || '#10B981',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onHover: (event, elements) => {
          const alvo = event && event.native && event.native.target;
          if (alvo) alvo.style.cursor = (elements && elements.length) ? 'pointer' : 'default';
        },
        onClick: (event, elements) => {
          if (!elements || !elements.length) return;
          const idx = elements[0].index;
          const snap = historico[idx];
          if (!snap || !snap.mesAno) return;
          navegarParaLancamentos({ mes: snap.mesAno, tipo: 'todos', modoFiltroMes: 'fatura' });
        },
        plugins: {
          legend: { display: false },
          tooltip: obterTooltipPremiumChart({
            title: (items) => {
              const idx = items[0].dataIndex;
              const s = historico[idx];
              const [ano, mes] = s.mesAno.split('-');
              return `Máquina do Tempo · ${nomesMesAbrev[mes] || mes}/${ano}`;
            },
            label: (ctx) => {
              const idx = ctx.dataIndex;
              const s = historico[idx];
              const prev = idx > 0 ? historico[idx - 1] : null;
              let varTexto = '';
              if (prev && prev.patrimonioLiquido !== 0) {
                const diff = s.patrimonioLiquido - prev.patrimonioLiquido;
                const pct = ((diff / Math.abs(prev.patrimonioLiquido)) * 100).toFixed(1);
                varTexto = diff >= 0 ? `▲ +${pct}%` : `▼ ${pct}%`;
              }
              const faturaVal = (s.faturaCartao != null) ? s.faturaCartao : (s.dividasCartao != null ? s.dividasCartao : (s.faturaMes || 0));
              return [
                ` Patrimônio Líquido: ${toBRL(s.patrimonioLiquido)} ${varTexto}`,
                `   • Saldo Livre: ${toBRL(s.saldoLivre)}`,
                `   • Cofres & Metas: ${toBRL(s.totalCofres)}`,
                `   • Fatura do Mês: ${toBRL(faturaVal)}`
              ];
            }
          })
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: cssVar('--text3') } },
          y: { grid: { color: cssVar('--border') }, ticks: { color: cssVar('--text3'), callback: (v) => toBRL(v) } }
        }
      }
    });
  }
}

function abrirModalHistoricoSnapshots() {
  renderTabelaHistoricoSnapshots();
  abrirModal('modal-historico-snapshots');
}

function renderTabelaHistoricoSnapshots() {
  const tbody = document.getElementById('snapshots-tbody');
  const empty = document.getElementById('snapshots-empty');
  if (!tbody) return;

  const historico = STATE.historicoPatrimonio || [];
  if (!historico.length) {
    tbody.innerHTML = '';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (empty) empty.style.display = 'none';

  tbody.innerHTML = historico.map((s, idx) => {
    const prev = idx > 0 ? historico[idx - 1] : null;
    let badgeMoM = '<span class="snapshot-mom-badge neutro">—</span>';
    if (prev && prev.patrimonioLiquido !== 0) {
      const diff = s.patrimonioLiquido - prev.patrimonioLiquido;
      const pct = ((diff / Math.abs(prev.patrimonioLiquido)) * 100).toFixed(1);
      if (diff > 0) {
        badgeMoM = `<span class="snapshot-mom-badge positivo">▲ +${pct}%</span>`;
      } else if (diff < 0) {
        badgeMoM = `<span class="snapshot-mom-badge negativo">▼ ${pct}%</span>`;
      } else {
        badgeMoM = `<span class="snapshot-mom-badge neutro">0.0%</span>`;
      }
    }

    const faturaVal = (s.faturaCartao != null) ? s.faturaCartao : (s.dividasCartao != null ? s.dividasCartao : (s.faturaMes || 0));

    return `
      <tr>
        <td style="font-weight:700">${s.mesAno}</td>
        <td class="valor-sensivel" style="text-align:right">${toBRL(s.saldoLivre)}</td>
        <td class="valor-sensivel" style="text-align:right;color:var(--accent)">${toBRL(s.totalCofres)}</td>
        <td class="valor-sensivel" style="text-align:right;color:var(--bad)">${toBRL(faturaVal)}</td>
        <td class="valor-sensivel" style="text-align:right;font-weight:800;color:var(--good)">${toBRL(s.patrimonioLiquido)}</td>
        <td style="text-align:right">${badgeMoM}</td>
        <td style="text-align:center">
          <button class="icon-btn" onclick="excluirSnapshot('${s.id || s.mesAno}')" title="Excluir snapshot" style="color:var(--bad)"><i class="ti ti-trash"></i></button>
        </td>
      </tr>
    `;
  }).join('');
}

async function excluirSnapshot(idOuMesAno) {
  abrirConfirmacao('Deseja realmente excluir este snapshot de patrimônio?', async () => {
    STATE.historicoPatrimonio = (STATE.historicoPatrimonio || []).filter(s => s.id !== idOuMesAno && s.mesAno !== idOuMesAno);
    await salvarDados();
    renderTabelaHistoricoSnapshots();
    renderGraficoMaquinaTempo();
    toast('Snapshot removido da Máquina do Tempo.', 'ok');
  }, 'Excluir Snapshot');
}

async function carregarDados() {
  try {
    const dadosSalvos = localStorage.getItem(STORAGE_KEY) || localStorage.getItem('STATE');
    if (dadosSalvos) {
      // Se já tem dados guardados no PC, carrega eles
      STATE = Object.assign(STATE, JSON.parse(dadosSalvos));
    }
    // Compatibilidade: contas salvas antes de existir "tipo" viram conta bancária normal
    (STATE.contas || []).forEach(c => { if (!c.tipo) c.tipo = 'conta'; });
    normalizarHierarquiaCategorias();
    if (!Array.isArray(STATE.cartoes)) STATE.cartoes = [];
    if (!Array.isArray(STATE.historicoPatrimonio)) STATE.historicoPatrimonio = [];
    if (!Array.isArray(STATE.receitasFixas)) STATE.receitasFixas = [];
    if (!STATE.config) STATE.config = { lastSync: null, oneDriveLink: null, ultimoMesFechado: null, faturasPagas: {} };
    if (!STATE.config.faturasPagas || typeof STATE.config.faturasPagas !== 'object') STATE.config.faturasPagas = {};
    sincronizarEstruturaCartoes();
    normalizarLancamentosCartaoExistentes();
    corrigirFaturasPresas();
    recalcularLimitesCartoes();
    normalizarConciliacaoLancamentos();
    normalizarIntegridadeTransferencias();
    normalizarRegrasCategoria();
    if (!STATE.regras) STATE.regras = [];
    if (!Array.isArray(STATE.antiMetas)) STATE.antiMetas = [];
    if (STATE.regras.length === 0) {
      STATE.regras = [
        { id: uid(), palavraChave: 'Uber', categoriaDesejada: 'Transporte', subcategoria: 'Uber / 99 / Táxi', categoria: 'Transporte -> Uber / 99 / Táxi' },
        { id: uid(), palavraChave: 'iFood', categoriaDesejada: 'Alimentação', subcategoria: 'Delivery / Lanche', categoria: 'Alimentação -> Delivery / Lanche' },
        { id: uid(), palavraChave: 'Netflix', categoriaDesejada: 'Assinaturas', subcategoria: 'Streaming (Vídeo/Música)', categoria: 'Assinaturas -> Streaming (Vídeo/Música)' },
        { id: uid(), palavraChave: 'Spotify', categoriaDesejada: 'Assinaturas', subcategoria: 'Streaming (Vídeo/Música)', categoria: 'Assinaturas -> Streaming (Vídeo/Música)' }
      ];
    }
    if (STATE.antiMetas.length === 0) {
      STATE.antiMetas = [
        { id: uid(), categoriaId: 'Alimentação', limiteMensal: 1000 }
      ];
    }
    if (!STATE.metas) STATE.metas = [];
    if (!STATE.cofres) STATE.cofres = [];
    if (!STATE.dividas) STATE.dividas = [];
    if (!STATE.lixeira) STATE.lixeira = [];
    if (!STATE.excluidosPendentes) STATE.excluidosPendentes = [];
    if (!STATE.recorrentesIgnorados) STATE.recorrentesIgnorados = [];
    if (!STATE.config) STATE.config = { lastSync: null, oneDriveLink: null, ultimoMesFechado: null };
    if (STATE.config.layoutDashboard && Array.isArray(STATE.config.layoutDashboard)) {
      STATE.config.layoutDashboard = STATE.config.layoutDashboard.filter(id => id !== 'dash-melhor-cartao-card');
    }
    if (STATE.config.ultimoMesFechado === undefined) STATE.config.ultimoMesFechado = null;
    if (!STATE.config.modoViagem) STATE.config.modoViagem = { ativo: false, nome: '', hashtag: '' };
    limparLixeira();
    if (STATE.config && STATE.config.oneDriveLink && document.getElementById('sync-link')) {
      document.getElementById('sync-link').value = STATE.config.oneDriveLink;
    }
    if (STATE.config && STATE.config.webhookMake && document.getElementById('sync-webhook-make')) {
      document.getElementById('sync-webhook-make').value = STATE.config.webhookMake;
    }
    localStorage.removeItem('STATE');
    definirCorDestaque((STATE.config && STATE.config.accentColor) || '#1A6FE0', false);
    aplicarEstadoSidebar();
    atualizarUIModoViagem();
    document.getElementById('sidebar-status').innerHTML = '<i class="ti ti-device-floppy"></i> <span>Salvo automaticamente no PC</span>';
  } catch (e) {
    console.error("Erro ao carregar dados:", e);
    document.getElementById('sidebar-status').innerHTML = '<i class="ti ti-alert-triangle"></i> <span>Erro ao ler os dados</span>';
  }
}
async function salvarLinkOneDrive() {
  if (!STATE.config) STATE.config = {};
  const el = document.getElementById('sync-link');
  if (el) STATE.config.oneDriveLink = el.value.trim();
  await salvarDados();
  toast('Link do OneDrive salvo.', 'ok');
}
async function salvarWebhookMake() {
  if (!STATE.config) STATE.config = {};
  const el = document.getElementById('sync-webhook-make');
  if (el) STATE.config.webhookMake = el.value.trim();
  await salvarDados();
  toast('Webhook do Make salvo com sucesso!', 'ok');
}

function persistirStateNoLocalStorage() {
  const serializado = JSON.stringify(STATE);
  localStorage.setItem(STORAGE_KEY, serializado);
  try { localStorage.removeItem('STATE'); } catch (e) {}
  if (window.electronAPI && typeof window.electronAPI.atualizarCacheP2P === 'function') {
    try { window.electronAPI.atualizarCacheP2P(STATE); } catch (e) {}
  }
}

async function salvarDados() {
  if (window.__apagandoDados) return;
  try {
    normalizarConciliacaoLancamentos();
    recalcularLimitesCartoes();
    persistirStateNoLocalStorage();
  } catch (e) {
    console.error("Erro ao salvar:", e);
    if (e && e.name === 'QuotaExceededError') {
      toast('Armazenamento local cheio! Exclua anexos antigos ou exporte um backup JSON.', 'err');
    } else {
      toast('Erro ao salvar no armazenamento local.', 'err');
    }
  }
}

/* ================= NAVEGAÇÃO & EXPANSÃO "MAGIC MOVE" (VIEW TRANSITIONS API) ================= */
const TITULOS = { dashboard:'Dashboard', lancamentos:'Lançamentos', cartoes:'Cartões & Faturas', recorrentes:'Assinaturas & Recorrentes', cofres:'Metas & Cofres', metas:'Metas & Cofres', dividas:'Dívidas & Terceiros', relatorios:'Relatórios', sync:'Sincronizar OneDrive', config:'Categorias & Contas' };
const PAGINAS_MAIS = new Set(['recorrentes', 'cofres', 'metas', 'dividas', 'relatorios', 'sync', 'config']);

function limparMarcadoresMagicMove() {
  document.querySelectorAll('.card-expansivel-ativo').forEach(el => {
    el.classList.remove('card-expansivel-ativo');
    if (el.style && el.style.viewTransitionName === 'card-expansivel') {
      el.style.viewTransitionName = '';
    }
  });
}

function obterCardDestinoMagicMove(page) {
  const pageEl = document.getElementById('page-' + page);
  if (!pageEl) return null;
  return pageEl.querySelector('.card, .cartao-fatura-container, .vault-card, .meta-vault-card, .table-wrap') || pageEl;
}

function executarTrocaPaginaInterna(page, opcoes) {
  if (page === 'cofres') page = 'metas';
  if (typeof fecharSplitViewer === 'function') fecharSplitViewer();
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active', 'fade-in'));
  document.querySelectorAll('.nav-item, .bottom-nav-item, .mobile-more-item').forEach(n => n.classList.remove('active'));
  const pageEl = document.getElementById('page-' + page);
  if (pageEl) {
    void pageEl.offsetWidth;
    pageEl.classList.add('active', 'fade-in');
  }
  document.querySelectorAll('[data-page="' + page + '"]').forEach(el => el.classList.add('active'));
  const btnMais = document.getElementById('btn-bottom-mais');
  if (btnMais && PAGINAS_MAIS.has(page)) btnMais.classList.add('active');
  document.getElementById('topbar-title').textContent = TITULOS[page];
  if (page !== 'lancamentos' && modoConciliacaoAtivo) {
    modoConciliacaoAtivo = false;
    conciliacaoSelecionados.clear();
    const bar = document.getElementById('conciliacao-bar');
    if (bar) bar.classList.remove('show');
    const pageLancEl = document.getElementById('page-lancamentos');
    if (pageLancEl) pageLancEl.classList.remove('conciliacao-bar-ativa');
    const wrapLancEl = document.getElementById('lanc-table-wrap');
    if (wrapLancEl) wrapLancEl.classList.remove('conciliacao-bar-ativa');
    const btn = document.getElementById('btn-modo-conciliacao');
    if (btn) {
      btn.classList.remove('btn-primary');
      btn.innerHTML = '<i class="ti ti-checks"></i> Modo Seleção';
    }
  }
  if (page === 'dashboard') renderDashboard();
  if (page === 'lancamentos' && !(opcoes && opcoes.pularRenderLancamentos)) renderLancamentos();
  if (page === 'cartoes') renderCartoes();
  if (page === 'recorrentes') renderRecorrentes();
  if (page === 'metas') renderMetas();
  if (page === 'dividas') renderDividas();
  if (page === 'relatorios') renderRelatorios();
  if (page === 'config') renderConfig();
  if (page === 'sync') atualizarStatusMs();
  fecharSidebarMobile();
}

function expandirCardMagicMove(origemEl, pageDestino) {
  const destino = pageDestino === 'cofres' ? 'metas' : pageDestino;
  const cardOrigem = (origemEl && typeof origemEl.closest === 'function')
    ? (origemEl.closest('.card, .metric, .dash-cartao-row, .dash-conta-row') || origemEl)
    : document.getElementById('dash-saldo-contas-card');

  if (typeof document !== 'undefined' && typeof document.startViewTransition === 'function' && cardOrigem) {
    try {
      limparMarcadoresMagicMove();
      cardOrigem.classList.add('card-expansivel-ativo');
      cardOrigem.style.viewTransitionName = 'card-expansivel';

      const transition = document.startViewTransition(() => {
        cardOrigem.classList.remove('card-expansivel-ativo');
        cardOrigem.style.viewTransitionName = '';
        executarTrocaPaginaInterna(destino);
        const cardDestino = obterCardDestinoMagicMove(destino);
        if (cardDestino) {
          cardDestino.classList.add('card-expansivel-ativo');
          cardDestino.style.viewTransitionName = 'card-expansivel';
        }
      });

      if (transition && transition.finished && typeof transition.finished.finally === 'function') {
        transition.finished.finally(() => {
          limparMarcadoresMagicMove();
        });
      } else {
        setTimeout(limparMarcadoresMagicMove, 450);
      }
      return;
    } catch (e) {
      limparMarcadoresMagicMove();
    }
  }

  executarTrocaPaginaInterna(destino);
}

function nav(page, origemEl) {
  if (origemEl) {
    expandirCardMagicMove(origemEl, page);
    return;
  }
  executarTrocaPaginaInterna(page);
}
function toggleSidebar() {
  const sheet = document.getElementById('mobile-more-sheet');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sheet) sheet.classList.toggle('show');
  if (backdrop) backdrop.classList.toggle('show');
}
function fecharSidebarMobile() {
  const sheet = document.getElementById('mobile-more-sheet');
  const backdrop = document.getElementById('sidebar-backdrop');
  if (sheet) sheet.classList.remove('show');
  if (backdrop) backdrop.classList.remove('show');
}
function alternarNavegacaoCompacta() {
  if (typeof window !== 'undefined' && window.innerWidth <= 900) {
    toggleSidebar();
    return;
  }
  const sb = document.getElementById('sidebar');
  if (typeof window !== 'undefined' && window.innerWidth <= 1024 && sb) {
    sb.classList.toggle('sidebar-compact-open');
    return;
  }
  toggleSidebarCollapse();
}
async function toggleSidebarCollapse() {
  if (!STATE.config) STATE.config = {};
  STATE.config.sidebarCollapsed = !STATE.config.sidebarCollapsed;
  aplicarEstadoSidebar();
  await salvarDados();
}
function aplicarEstadoSidebar() {
  const sb = document.getElementById('sidebar');
  const icone = document.getElementById('icone-sidebar-collapse');
  const colapsada = !!(STATE.config && STATE.config.sidebarCollapsed);
  if (sb) sb.classList.toggle('collapsed', colapsada);
  if (icone) icone.className = colapsada ? 'ti ti-chevron-right' : 'ti ti-chevron-left';
}
function toggleNavSection(idGrupo, btnEl) {
  const grupo = document.getElementById('nav-group-' + idGrupo);
  if (!grupo) return;
  grupo.classList.toggle('closed');
  if (btnEl) btnEl.classList.toggle('closed', grupo.classList.contains('closed'));
}
function selecionarChipFiltro(inputId, valor, btnEl, callback) {
  const inp = document.getElementById(inputId);
  if (inp) inp.value = valor;
  document.querySelectorAll(`[data-chip-target="${inputId}"]`).forEach(b => b.classList.toggle('active', b === btnEl));
  if (typeof callback === 'function') callback();
}
function focarCampoCriacao(inputId) {
  const el = document.getElementById(inputId);
  if (!el) return;
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => el.focus(), 120);
}
function atalhoCriarCartao() {
  nav('config');
  setTimeout(() => {
    const sel = document.getElementById('conta-tipo');
    if (sel) { sel.value = 'cartao'; atualizarCamposCartao(); }
    focarCampoCriacao('conta-nome');
  }, 80);
}

/* ================= HELPERS ================= */
// Data de "hoje" no fuso do usuário (toISOString devolve UTC, que no Brasil já vira "amanhã" depois das 21h).
// deslocDias: 0 = hoje, -1 = ontem, 3 = daqui a 3 dias.
function hojeLocalISO(deslocDias) {
  const d = new Date();
  if (deslocDias) d.setDate(d.getDate() + deslocDias);
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

function formatarPartesDataLocalISO(ano, mes, dia) {
  if (!Number.isInteger(ano) || !Number.isInteger(mes) || !Number.isInteger(dia)) return '';
  if (ano < 1900 || ano > 2100 || mes < 1 || mes > 12 || dia < 1 || dia > 31) return '';
  const dt = new Date(Date.UTC(ano, mes - 1, dia));
  if (dt.getUTCFullYear() !== ano || dt.getUTCMonth() !== mes - 1 || dt.getUTCDate() !== dia) return '';
  return `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;
}

function extrairDataLocalISO(valorData, contextoOuOpcoes) {
  const opcoes = (contextoOuOpcoes && typeof contextoOuOpcoes === 'object' && ('retornarVazioSeInvalido' in contextoOuOpcoes || 'silencioso' in contextoOuOpcoes || 'aceitarSerialExcel' in contextoOuOpcoes || 'contexto' in contextoOuOpcoes))
    ? contextoOuOpcoes
    : { contexto: contextoOuOpcoes };
  const retornarVazio = Boolean(opcoes.retornarVazioSeInvalido);
  const silencioso = Boolean(opcoes.silencioso);
  const aceitarSerialExcel = opcoes.aceitarSerialExcel !== false;

  const fallbackInvalido = () => {
    if (retornarVazio) return '';
    if (!silencioso && typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[COFIN][Data] Valor de data nulo/inválido; aplicando hojeLocalISO():', valorData, opcoes.contexto || '');
    }
    return hojeLocalISO();
  };

  if (valorData === null || valorData === undefined || valorData === '') {
    return fallbackInvalido();
  }

  // Objeto Date nativo -> usa sempre componentes locais (nunca toISOString em UTC)
  if (valorData instanceof Date) {
    if (!isNaN(valorData.getTime())) {
      const isoDate = formatarPartesDataLocalISO(
        valorData.getFullYear(),
        valorData.getMonth() + 1,
        valorData.getDate()
      );
      if (isoDate) return isoDate;
    }
    return fallbackInvalido();
  }

  // Número: OFX YYYYMMDD numérico, serial do Excel (sistema 1900) ou timestamp Unix
  if (typeof valorData === 'number' && Number.isFinite(valorData)) {
    if (Number.isInteger(valorData) && valorData >= 19000101 && valorData <= 21001231) {
      const sNum = String(valorData);
      const isoNum = formatarPartesDataLocalISO(
        parseInt(sNum.slice(0, 4), 10),
        parseInt(sNum.slice(4, 6), 10),
        parseInt(sNum.slice(6, 8), 10)
      );
      if (isoNum) return isoNum;
    }
    // e) Número serial do Excel (com correção do ano bissexto fictício de 1900 do Lotus 1-2-3)
    if (aceitarSerialExcel && valorData >= 1 && valorData <= 90000) {
      const diasInteiros = Math.floor(valorData);
      const baseMs = Date.UTC(1899, 11, diasInteiros < 60 ? 31 : 30);
      const dtExcel = new Date(baseMs + diasInteiros * 86400000);
      const isoExcel = formatarPartesDataLocalISO(
        dtExcel.getUTCFullYear(),
        dtExcel.getUTCMonth() + 1,
        dtExcel.getUTCDate()
      );
      if (isoExcel) return isoExcel;
    }
    if (valorData >= 1e9) {
      const ms = valorData < 1e12 ? valorData * 1000 : valorData;
      const dtUnix = new Date(ms);
      if (!isNaN(dtUnix.getTime())) {
        const isoUnix = formatarPartesDataLocalISO(
          dtUnix.getFullYear(),
          dtUnix.getMonth() + 1,
          dtUnix.getDate()
        );
        if (isoUnix) return isoUnix;
      }
    }
    return fallbackInvalido();
  }

  const s = String(valorData).trim().replace(/^["']|["']$/g, '');
  if (!s) return fallbackInvalido();

  // e) Serial do Excel vindo como string (5 dígitos modernos: 1954..2100, ex.: "46344" ou "46344.75")
  if (aceitarSerialExcel && /^\d{5}(?:[.,]\d+)?$/.test(s)) {
    const numSerial = parseFloat(s.replace(',', '.'));
    if (Number.isFinite(numSerial) && numSerial >= 20000 && numSerial <= 73050) {
      const diasInteiros = Math.floor(numSerial);
      const baseMs = Date.UTC(1899, 11, 30);
      const dtExcel = new Date(baseMs + diasInteiros * 86400000);
      const isoExcel = formatarPartesDataLocalISO(
        dtExcel.getUTCFullYear(),
        dtExcel.getUTCMonth() + 1,
        dtExcel.getUTCDate()
      );
      if (isoExcel) return isoExcel;
    }
  }

  // a) Formato brasileiro DD/MM/YYYY (ou DD/MM/YY ou DD-MM-YYYY), com ou sem hora
  const mBR = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})(?:[\sT].*)?$/);
  if (mBR) {
    const p1 = parseInt(mBR[1], 10);
    const p2 = parseInt(mBR[2], 10);
    let ano = parseInt(mBR[3], 10);
    if (mBR[3].length === 2) ano = ano < 70 ? 2000 + ano : 1900 + ano;
    // Prioriza DD/MM/YYYY; só inverte se o segundo campo > 12 (ex.: Excel em locale EN "11/19/2026")
    let dia = p1;
    let mes = p2;
    if (p2 > 12 && p1 <= 12) {
      mes = p1;
      dia = p2;
    }
    const isoBR = formatarPartesDataLocalISO(ano, mes, dia);
    if (isoBR) return isoBR;
    return fallbackInvalido();
  }

  // b) Formato OFX: YYYYMMDD ou YYYYMMDDHHMMSS[-3:BRT]
  const mOFX = s.match(/^(\d{4})(\d{2})(\d{2})(?:$|[\d.\[\s])/);
  if (mOFX) {
    const isoOFX = formatarPartesDataLocalISO(
      parseInt(mOFX[1], 10),
      parseInt(mOFX[2], 10),
      parseInt(mOFX[3], 10)
    );
    if (isoOFX) return isoOFX;
    return fallbackInvalido();
  }

  // c) e d) Formato ISO YYYY-MM-DD (com ou sem hora e fuso horário)
  const mISO = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i);
  if (mISO) {
    const ano = parseInt(mISO[1], 10);
    const mes = parseInt(mISO[2], 10);
    const dia = parseInt(mISO[3], 10);
    const hora = mISO[4];
    const min = mISO[5];
    const seg = mISO[6] || '00';
    const msStr = mISO[7] || '0';
    const tz = mISO[8] || '';

    // c) ISO sem hora ou sem fuso explícito -> preserva YYYY-MM-DD diretamente
    if (!hora || !tz) {
      const isoSimples = formatarPartesDataLocalISO(ano, mes, dia);
      if (isoSimples) return isoSimples;
      return fallbackInvalido();
    }

    // c) Meia-noite UTC exata (T00:00:00Z / T00:00:00.000Z / T00:00:00+00:00) -> evita recuar 1 dia no fuso UTC-3
    const ehUtcZero = /^(?:Z|[+-]00:?00)$/i.test(tz);
    const ehMeiaNoiteExata = hora === '00' && min === '00' && seg === '00' && /^0+$/.test(msStr);
    if (ehUtcZero && ehMeiaNoiteExata) {
      const isoMeiaNoite = formatarPartesDataLocalISO(ano, mes, dia);
      if (isoMeiaNoite) return isoMeiaNoite;
      return fallbackInvalido();
    }

    // d) ISO com hora real diferente de zero em UTC ou com fuso explícito -> converte para o fuso local
    const tzNorm = tz.toUpperCase() === 'Z'
      ? 'Z'
      : (tz.includes(':') ? tz : `${tz.slice(0, 3)}:${tz.slice(3)}`);
    const isoParaParse = `${String(ano).padStart(4, '0')}-${String(mes).padStart(2, '0')}-${String(dia).padStart(2, '0')}T${hora}:${min}:${seg}${mISO[7] ? '.' + mISO[7] : ''}${tzNorm}`;
    const dtComFuso = new Date(isoParaParse);
    if (!isNaN(dtComFuso.getTime())) {
      const isoLocal = formatarPartesDataLocalISO(
        dtComFuso.getFullYear(),
        dtComFuso.getMonth() + 1,
        dtComFuso.getDate()
      );
      if (isoLocal) return isoLocal;
    }
    return fallbackInvalido();
  }

  // Fallback para datas textuais RFC/JS válidas (ex.: "Wed Nov 18 2026 22:25:00 GMT-0300")
  if (/[a-zA-Z]{3}/.test(s)) {
    const dtFallback = new Date(s);
    if (!isNaN(dtFallback.getTime())) {
      const isoFallback = formatarPartesDataLocalISO(
        dtFallback.getFullYear(),
        dtFallback.getMonth() + 1,
        dtFallback.getDate()
      );
      if (isoFallback) return isoFallback;
    }
  }

  return fallbackInvalido();
}
function uid() { return 'id-' + Date.now() + '-' + Math.random().toString(36).slice(2,8); }
function toBRL(n) { return (n || 0).toLocaleString('pt-BR', { style:'currency', currency:'BRL' }); }
function maskMoeda(el) {
  let v = el.value.replace(/\D/g, '');
  v = (parseInt(v || '0', 10) / 100).toFixed(2);
  v = v.replace('.', ',').replace(/\B(?=(\d{3})+(?=,))/g, '.');
  el.value = 'R$ ' + v;
  // Garante que o cursor fique sempre no fim — sem isso, em alguns navegadores/Electron
  // o cursor pode "voltar" pro início depois de recriar o valor, fazendo parecer
  // que não dá pra editar o campo.
  const pos = el.value.length;
  if (typeof el.setSelectionRange === 'function') el.setSelectionRange(pos, pos);
}
function maskMoedaSmart(el) {
  const val = String(el.value || '');
  // Se o usuário digitar operadores matemáticos (+, -, *, /, parênteses), preserva a digitação livre para calcular no blur
  if (/[+\-*/()]/.test(val.replace(/^R\$\s*/, ''))) return;
  maskMoeda(el);
}
function avaliarExpressaoMoeda(el) {
  if (!el || !el.value) return;
  const bruto = String(el.value).replace(/R\$/gi, '').trim();
  if (!/[+\-*/()]/.test(bruto)) return;
  // Converte formato brasileiro (ex: 1.250,50 -> 1250.50 ou 150+45,50 -> 150+45.50)
  const normalizado = bruto.replace(/\.(?=\d{3}(?:[^\d]|$))/g, '').replace(/,/g, '.');
  if (!/^[0-9+\-*/.()\s]+$/.test(normalizado)) return;
  try {
    const resultado = Function("return (" + normalizado + ")")();
    if (typeof resultado === 'number' && isFinite(resultado) && resultado >= 0) {
      el.value = toBRL(resultado).replace('R$', 'R$ ');
      atualizarDicaParcelas();
    }
  } catch (e) {}
}
function moedaToNumber(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const s = String(str).trim();
  const cleaned = s.replace(/[^\d,.-]/g, '');
  if (cleaned.includes(',') && cleaned.includes('.')) {
    return parseFloat(cleaned.replace(/\./g, '').replace(',', '.')) || 0;
  } else if (cleaned.includes(',')) {
    return parseFloat(cleaned.replace(',', '.')) || 0;
  }
  return parseFloat(cleaned) || 0;
}
function toast(msg, tipo) {
  const t = document.getElementById('toast');
  t.onclick = null;
  t.title = '';
  t.textContent = msg;
  t.className = 'toast show' + (tipo ? ' ' + tipo : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), tipo === 'err' ? 9000 : 3200);
}
function atualizarEstadoModais() {
  const aberto = document.querySelector('.modal-bg.show');
  if (aberto) {
    document.body.classList.add('body-modal-active');
  } else {
    document.body.classList.remove('body-modal-active');
  }
}

async function animarBotaoMorphing(btn, callbackAsync) {
  if (!btn || btn.classList.contains('btn-loading') || btn.classList.contains('btn-success')) return;
  btn.classList.add('btn-morphing', 'btn-loading');
  try {
    const inicio = Date.now();
    const resultado = await callbackAsync();
    const decorrido = Date.now() - inicio;
    if (decorrido < 400) {
      await new Promise(r => setTimeout(r, 400 - decorrido));
    }
    btn.classList.remove('btn-loading');
    btn.classList.add('btn-success');
    await new Promise(r => setTimeout(r, 600));
    return resultado;
  } finally {
    btn.classList.remove('btn-loading', 'btn-success', 'btn-morphing');
  }
}

function resolverIdModalCompat(id) {
  if (id === 'modal-revisao-ofx' && !document.getElementById('modal-revisao-ofx')) {
    return 'modal-revisao-importacao';
  }
  return id;
}
function fecharModal(id) {
  const realId = resolverIdModalCompat(id);
  const el = document.getElementById(realId);
  if (el) el.classList.remove('show');
  atualizarEstadoModais();
}
function abrirModal(id) {
  const realId = resolverIdModalCompat(id);
  const el = document.getElementById(realId);
  if (!el) return;
  el.classList.add('show');
  registrarEstadoInicialModal(el);
  atualizarEstadoModais();
}
function registrarEstadoInicialModal(modalEl) {
  if (!modalEl || modalEl.id === 'modal-config-pluggy') return;
  const campos = modalEl.querySelectorAll('input, select, textarea');
  campos.forEach(campo => {
    if (campo.type === 'checkbox' || campo.type === 'radio') {
      campo.dataset.initialChecked = campo.checked ? 'true' : 'false';
    } else if (campo.type !== 'file') {
      campo.dataset.initialValue = campo.value ?? '';
    }
  });
}
function verificarModalSujo(modalEl) {
  if (!modalEl || modalEl.id === 'modal-confirmacao' || modalEl.id === 'modal-busca') return false;
  if (modalEl.id === 'modal-lancamento' && (typeof comprovanteAtual !== 'undefined' && (comprovanteAtual || anexoMetaAtual))) {
    const idEdit = document.getElementById('lanc-id')?.value;
    if (!idEdit) return true;
  }
  const campos = modalEl.querySelectorAll('input, select, textarea');
  if (!campos.length) return false;
  for (const campo of campos) {
    const tipo = (campo.type || '').toLowerCase();
    if (tipo === 'hidden' || tipo === 'button' || tipo === 'submit' || tipo === 'reset' || campo.disabled) continue;

    if (tipo === 'checkbox' || tipo === 'radio') {
      const inicial = campo.dataset.initialChecked !== undefined ? (campo.dataset.initialChecked === 'true') : campo.defaultChecked;
      if (campo.checked !== inicial) return true;
      continue;
    }

    if (tipo === 'file') {
      if (campo.files && campo.files.length > 0) return true;
      continue;
    }

    const valAtual = (campo.value || '').trim();
    const temInicial = campo.dataset.initialValue !== undefined;
    const valInicial = temInicial ? campo.dataset.initialValue.trim() : (campo.defaultValue || '').trim();

    if (campo.tagName === 'SELECT') {
      if (temInicial && valAtual !== valInicial) return true;
      continue;
    }

    if (tipo === 'date' || tipo === 'color') {
      if (temInicial && valAtual !== valInicial) return true;
      continue;
    }

    if (temInicial) {
      if (valAtual !== valInicial) return true;
    } else if (valAtual !== '' && valAtual !== 'R$ 0,00' && valAtual !== '0') {
      return true;
    }
  }
  return false;
}
function limparFormularioModal(modalEl) {
  if (!modalEl) return;
  const campos = modalEl.querySelectorAll('input, select, textarea');
  campos.forEach(campo => {
    const tipo = (campo.type || '').toLowerCase();
    if (tipo === 'button' || tipo === 'submit' || tipo === 'reset') return;
    if (tipo === 'hidden') {
      campo.value = '';
      return;
    }
    if (tipo === 'checkbox' || tipo === 'radio') {
      campo.checked = campo.dataset.initialChecked !== undefined ? (campo.dataset.initialChecked === 'true') : campo.defaultChecked;
    } else if (tipo === 'file') {
      campo.value = '';
    } else if (campo.tagName === 'SELECT') {
      if (campo.dataset.initialValue !== undefined) {
        campo.value = campo.dataset.initialValue;
      } else if (campo.options.length > 0) {
        campo.selectedIndex = 0;
      }
    } else if (tipo === 'date' || tipo === 'color') {
      campo.value = campo.dataset.initialValue !== undefined ? campo.dataset.initialValue : campo.defaultValue;
    } else {
      campo.value = '';
    }
    delete campo.dataset.initialValue;
    delete campo.dataset.initialChecked;
  });

  if (modalEl.id === 'modal-lancamento') {
    if (typeof comprovanteAtual !== 'undefined') comprovanteAtual = null;
    if (typeof anexoMetaAtual !== 'undefined') anexoMetaAtual = null;
    if (typeof splitLinhas !== 'undefined') splitLinhas = [];
    if (typeof renderComprovanteArea === 'function') renderComprovanteArea();
    const wrapGarantia = document.getElementById('lanc-garantia-wrap');
    if (wrapGarantia) wrapGarantia.style.display = 'none';
    const wrapSplit = document.getElementById('lanc-split-wrap');
    if (wrapSplit) wrapSplit.style.display = 'none';
    const wrapRachar = document.getElementById('lanc-rachar-wrap');
    if (wrapRachar) wrapRachar.style.display = 'none';
    const chkRachar = document.getElementById('lanc-rachar-chk');
    if (chkRachar) chkRachar.checked = false;
  } else if (modalEl.id === 'modal-simulador') {
    const resSim = document.getElementById('simulador-resultado');
    if (resSim) { resSim.style.display = 'none'; resSim.innerHTML = ''; }
  }
}
function fecharModalEspecifico(id) {
  if (id === 'modal-prompt') {
    cancelarPrompt();
  } else if (id === 'modal-import' && typeof cancelarImportacao === 'function') {
    cancelarImportacao();
  } else if (id === 'modal-vincular-ofx' && typeof cancelarVinculoOFX === 'function') {
    cancelarVinculoOFX(true);
  } else if ((id === 'modal-revisao-ofx' || id === 'modal-revisao-importacao') && typeof cancelarRevisaoImportacao === 'function') {
    cancelarRevisaoImportacao(true);
  } else if (id === 'modal-config-pluggy' && typeof fecharModalConfigPluggy === 'function') {
    fecharModalConfigPluggy(true);
  } else {
    fecharModal(id);
  }
}
function tentarFecharModalPorEsc(modalEl) {
  if (!modalEl) return;
  if (verificarModalSujo(modalEl)) {
    abrirConfirmacao(
      'Tem informações não guardadas. Tem a certeza que deseja fechar e cancelar as alterações?',
      () => {
        limparFormularioModal(modalEl);
        fecharModalEspecifico(modalEl.id);
      }
    );
  } else {
    limparFormularioModal(modalEl);
    fecharModalEspecifico(modalEl.id);
  }
}
function seEnviar(e, fn) {
  if (e.key === 'Enter') { e.preventDefault(); fn(); }
}

/* ---- Substituto de prompt() — o Electron não implementa o diálogo nativo do navegador ---- */
let promptResolver = null;
function pedirValor(titulo, valorInicial, modoTexto) {
  return new Promise((resolve) => {
    promptResolver = resolve;
    window.__promptModoTexto = !!modoTexto;
    document.getElementById('prompt-titulo').textContent = titulo;
    const input = document.getElementById('prompt-valor');
    input.placeholder = modoTexto ? 'Ex: Paris, Eurotrip...' : 'R$ 0,00';
    input.value = valorInicial || '';
    abrirModal('modal-prompt');
    setTimeout(() => { input.focus(); input.select(); }, 50);
  });
}
function confirmarPrompt() {
  const valor = document.getElementById('prompt-valor').value;
  window.__promptModoTexto = false;
  fecharModal('modal-prompt');
  const resolver = promptResolver; promptResolver = null;
  if (resolver) resolver(valor);
}
function cancelarPrompt() {
  window.__promptModoTexto = false;
  fecharModal('modal-prompt');
  const resolver = promptResolver; promptResolver = null;
  if (resolver) resolver(null);
}

/* ---- Modal de Confirmação Customizado (substitui window.confirm) ---- */
let confirmCallbackAtivo = null;
function abrirConfirmacao(mensagem, callbackConfirmacao, titulo = 'Atenção') {
  const modal = document.getElementById('modal-confirmacao');
  const elTitulo = document.getElementById('confirm-titulo');
  const elMsg = document.getElementById('confirm-mensagem');
  const btnOk = document.getElementById('btn-confirm-ok');
  const btnCancel = document.getElementById('btn-confirm-cancel');
  const btnSingle = document.getElementById('btn-confirm-single');
  if (!modal || !elTitulo || !elMsg || !btnOk || !btnCancel) return;

  elTitulo.textContent = titulo || 'Atenção';
  elMsg.textContent = mensagem || '';
  confirmCallbackAtivo = typeof callbackConfirmacao === 'function' ? callbackConfirmacao : null;

  if (btnSingle) {
    btnSingle.style.display = 'none';
    btnSingle.onclick = null;
  }
  btnOk.className = 'btn btn-danger';
  btnOk.innerHTML = '<i class="ti ti-check"></i> Confirmar';
  btnCancel.textContent = 'Cancelar';

  btnOk.onclick = async () => {
    const fn = confirmCallbackAtivo;
    fecharConfirmacao();
    if (fn) await fn();
  };
  btnCancel.onclick = () => {
    fecharConfirmacao();
  };

  modal.classList.add('show');
  atualizarEstadoModais();
  setTimeout(() => btnOk.focus(), 50);
}
function fecharConfirmacao() {
  const modal = document.getElementById('modal-confirmacao');
  const btnOk = document.getElementById('btn-confirm-ok');
  const btnCancel = document.getElementById('btn-confirm-cancel');
  const btnSingle = document.getElementById('btn-confirm-single');
  if (modal) modal.classList.remove('show');
  atualizarEstadoModais();
  if (btnOk) {
    btnOk.onclick = null;
    btnOk.className = 'btn btn-danger';
    btnOk.innerHTML = '<i class="ti ti-check"></i> Confirmar';
  }
  if (btnCancel) {
    btnCancel.onclick = null;
    btnCancel.textContent = 'Cancelar';
  }
  if (btnSingle) {
    btnSingle.style.display = 'none';
    btnSingle.onclick = null;
  }
  confirmCallbackAtivo = null;
}

function abrirConfirmacaoExclusaoParcelas(lancamento, itensGrupo) {
  const modal = document.getElementById('modal-confirmacao');
  const elTitulo = document.getElementById('confirm-titulo');
  const elMsg = document.getElementById('confirm-mensagem');
  const btnCancel = document.getElementById('btn-confirm-cancel');
  const btnSingle = document.getElementById('btn-confirm-single');
  const btnOk = document.getElementById('btn-confirm-ok');
  if (!modal || !elTitulo || !elMsg || !btnCancel || !btnSingle || !btnOk) return;

  elTitulo.textContent = 'Excluir despesa parcelada';
  elMsg.textContent = `Deseja apagar apenas esta parcela ou a compra inteira (${itensGrupo.length} parcelas)?`;

  btnCancel.textContent = 'Cancelar';
  btnCancel.onclick = () => fecharConfirmacao();

  btnSingle.style.display = 'inline-flex';
  btnSingle.className = 'btn';
  btnSingle.innerHTML = `<i class="ti ti-file-minus"></i> Apenas esta parcela (${lancamento.parcelaAtual || 1}/${itensGrupo.length})`;
  btnSingle.onclick = async () => {
    fecharConfirmacao();
    await executarExclusaoParcelaUnica(lancamento);
  };

  btnOk.className = 'btn btn-danger';
  btnOk.innerHTML = `<i class="ti ti-trash"></i> Compra inteira (${itensGrupo.length} parcelas)`;
  btnOk.onclick = async () => {
    fecharConfirmacao();
    await executarExclusaoGrupoParcelas(itensGrupo, lancamento);
  };

  modal.classList.add('show');
  setTimeout(() => btnOk.focus(), 50);
}

/* ================= TEMA & HELPERS CHART.JS ================= */
const CHARTS = {};
function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}
function destruirChart(id) {
  if (CHARTS[id]) { CHARTS[id].destroy(); delete CHARTS[id]; }
}
function converterCorParaRgba(cor, alpha) {
  const s = String(cor || '').trim();
  if (!s) return `rgba(26, 111, 224, ${alpha})`;
  if (s.startsWith('#')) {
    let hex = s.slice(1);
    if (hex.length === 3) hex = hex.split('').map(ch => ch + ch).join('');
    const num = parseInt(hex, 16);
    if (!isNaN(num) && hex.length === 6) {
      const r = (num >> 16) & 255;
      const g = (num >> 8) & 255;
      const b = num & 255;
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }
  }
  const m = s.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (m) return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
  return s;
}
function criarGradienteLinearChart(ctx, corBase, alphaTopo = 0.92, alphaBase = 0.22, alturaPadrao = 240) {
  if (!ctx || typeof ctx.createLinearGradient !== 'function') return corBase;
  const h = (ctx.canvas && ctx.canvas.clientHeight) ? ctx.canvas.clientHeight : alturaPadrao;
  const grad = ctx.createLinearGradient(0, 0, 0, Math.max(h, 160));
  grad.addColorStop(0, converterCorParaRgba(corBase, alphaTopo));
  grad.addColorStop(1, converterCorParaRgba(corBase, alphaBase));
  return grad;
}
function obterTooltipPremiumChart(callbacksCustomizados = {}) {
  return {
    backgroundColor: 'rgba(15, 23, 42, 0.86)',
    titleColor: '#F8FAFC',
    bodyColor: '#E2E8F0',
    titleFont: { family: cssVar('--font') || 'Inter, sans-serif', size: 12, weight: '700' },
    bodyFont: { family: cssVar('--font') || 'Inter, sans-serif', size: 12, weight: '500' },
    padding: 12,
    boxPadding: 5,
    cornerRadius: 10,
    borderWidth: 0,
    borderColor: 'transparent',
    usePointStyle: true,
    callbacks: callbacksCustomizados
  };
}

function aplicarTema(tema) {
  document.documentElement.setAttribute('data-theme', tema);
  const icone = document.getElementById('icone-tema');
  if (icone) icone.className = tema === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
  try { localStorage.setItem('cofin-tema', tema); } catch (e) {}
  definirCorDestaque((STATE.config && STATE.config.accentColor) || '#1A6FE0', false);
  renderDashboard();
  if (document.getElementById('page-relatorios').classList.contains('active')) renderRelatorios();
}
const ICONES_TEMA = {
  "#1A6FE0": {
    dark: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5Mi45MTkgMTc4Ljg0MlYxNDcuMjk3QzI5Mi45MTkgMTQ2Ljc0NSAyOTMuMzY2IDE0Ni4yOTcgMjkzLjkxOSAxNDYuMjk3SDQwNS41OTZDNDA2LjE0OCAxNDYuMjk3IDQwNi41OTYgMTQ2Ljc0NSA0MDYuNTk2IDE0Ny4yOTdWMTc4Ljg0MkM0MDYuNTk2IDE3OS4zOTQgNDA2LjE0OCAxNzkuODQyIDQwNS41OTYgMTc5Ljg0MkgyOTMuOTE5QzI5My4zNjYgMTc5Ljg0MiAyOTIuOTE5IDE3OS4zOTQgMjkyLjkxOSAxNzguODQyWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5NC45MjQgNDAwLjIzM0MyOTMuODE5IDQwMC4yMzMgMjkyLjkyNCAzOTkuMzM3IDI5Mi45MjQgMzk4LjIzM1YyOTAuNDE3QzI5Mi45MjQgMjg5LjMxMyAyOTMuODE5IDI4OC40MTcgMjk0LjkyNCAyODguNDE3SDQwMC45MzRDNDAyLjAzOCAyODguNDE3IDQwMi45MzQgMjg5LjMxMyA0MDIuOTM0IDI5MC40MTdWMzk4LjIzM0M0MDIuOTM0IDM5OS4zMzcgNDAyLjAzOCA0MDAuMjMzIDQwMC45MzQgNDAwLjIzM0gyOTQuOTI0Wk0zMjAuNTA3IDMxOS42MjJDMzE5LjQwMyAzMTkuNjIyIDMxOC41MDcgMzIwLjUxNyAzMTguNTA3IDMyMS42MjJWMzMzLjIyNEMzMTguNTA3IDMzNC4zMjggMzE5LjQwMyAzMzUuMjI0IDMyMC41MDcgMzM1LjIyNEgzNzUuMzVDMzc2LjQ1NSAzMzUuMjI0IDM3Ny4zNSAzMzQuMzI4IDM3Ny4zNSAzMzMuMjI0VjMyMS42MjJDMzc3LjM1IDMyMC41MTcgMzc2LjQ1NSAzMTkuNjIyIDM3NS4zNSAzMTkuNjIySDMyMC41MDdaTTMyMC41MDcgMzUwLjgyNkMzMTkuNDAzIDM1MC44MjYgMzE4LjUwNyAzNTEuNzIxIDMxOC41MDcgMzUyLjgyNlYzNjQuNDI4QzMxOC41MDcgMzY1LjUzMyAzMTkuNDAzIDM2Ni40MjggMzIwLjUwNyAzNjYuNDI4SDM3NS4zNUMzNzYuNDU1IDM2Ni40MjggMzc3LjM1IDM2NS41MzMgMzc3LjM1IDM2NC40MjhWMzUyLjgyNkMzNzcuMzUgMzUxLjcyMSAzNzYuNDU1IDM1MC44MjYgMzc1LjM1IDM1MC44MjZIMzIwLjUwN1oiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBmaWxsPSIjMUE2RkUwIi8+CjxwYXRoIGQ9Ik0xOTQuMDY2IDM5Ni4xMzhMMTYxLjQxOSAzNjIuOTU2TDEwNi43NTkgMzA3LjM5OUMxMDYuNTY4IDMwNy4yMDQgMTA2LjU2OCAzMDYuODkyIDEwNi43NTkgMzA2LjY5OEwxMjQuMzkzIDI4OC43NzVDMTI0LjU4OSAyODguNTc2IDEyNC45MSAyODguNTc2IDEyNS4xMDYgMjg4Ljc3NUwyMTIuNDEyIDM3Ny41MTRDMjEyLjYwNCAzNzcuNzA4IDIxMi42MDQgMzc4LjAyMSAyMTIuNDEyIDM3OC4yMTVMMTk0Ljc3OSAzOTYuMTM4QzE5NC41ODMgMzk2LjMzNyAxOTQuMjYyIDM5Ni4zMzcgMTk0LjA2NiAzOTYuMTM4WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzM0MF8yNTIpIiBzdHJva2U9InVybCgjcGFpbnQxX2xpbmVhcl8zNDBfMjUyKSIvPgo8cGF0aCBkPSJNMTI0LjM4OCAzOTYuMTMzTDEwNi43NDcgMzc4LjIwM0MxMDYuNTU5IDM3OC4wMTEgMTA2LjU1NSAzNzcuNzA0IDEwNi43NCAzNzcuNTA5TDE5NC4wOTIgMjg1LjAyNEMxOTQuMjc1IDI4NC44MzEgMTk0LjU3NiAyODQuODE0IDE5NC43NzkgMjg0Ljk4NkwyMTYuMDA4IDMwMi45NjhDMjE2LjIzIDMwMy4xNTYgMjE2LjI0NiAzMDMuNDkzIDIxNi4wNDIgMzAzLjdMMTI1LjEwMSAzOTYuMTMzQzEyNC45MDUgMzk2LjMzMiAxMjQuNTg0IDM5Ni4zMzIgMTI0LjM4OCAzOTYuMTMzWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IndoaXRlIiBzdHJva2U9IndoaXRlIi8+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjNjFCM0ZGIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzFBNkZFMCIvPgo8L2xpbmVhckdyYWRpZW50Pgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MV9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjNjFCM0ZGIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzFBNkZFMCIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo=",
    light: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0iIzBGMTcyQSIgc3Ryb2tlPSIjMEYxNzJBIi8+CjxwYXRoIGQ9Ik0yOTIuOTE5IDE3OC44NDJWMTQ3LjI5N0MyOTIuOTE5IDE0Ni43NDUgMjkzLjM2NiAxNDYuMjk3IDI5My45MTkgMTQ2LjI5N0g0MDUuNTk2QzQwNi4xNDggMTQ2LjI5NyA0MDYuNTk2IDE0Ni43NDUgNDA2LjU5NiAxNDcuMjk3VjE3OC44NDJDNDA2LjU5NiAxNzkuMzk0IDQwNi4xNDggMTc5Ljg0MiA0MDUuNTk2IDE3OS44NDJIMjkzLjkxOUMyOTMuMzY2IDE3OS44NDIgMjkyLjkxOSAxNzkuMzk0IDI5Mi45MTkgMTc4Ljg0MloiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8cGF0aCBkPSJNMjk0LjkyNCA0MDAuMjMzQzI5My44MTkgNDAwLjIzMyAyOTIuOTI0IDM5OS4zMzcgMjkyLjkyNCAzOTguMjMzVjI5MC40MTdDMjkyLjkyNCAyODkuMzEzIDI5My44MTkgMjg4LjQxNyAyOTQuOTI0IDI4OC40MTdINDAwLjkzNEM0MDIuMDM4IDI4OC40MTcgNDAyLjkzNCAyODkuMzEzIDQwMi45MzQgMjkwLjQxN1YzOTguMjMzQzQwMi45MzQgMzk5LjMzNyA0MDIuMDM4IDQwMC4yMzMgNDAwLjkzNCA0MDAuMjMzSDI5NC45MjRaTTMyMC41MDcgMzE5LjYyMkMzMTkuNDAzIDMxOS42MjIgMzE4LjUwNyAzMjAuNTE3IDMxOC41MDcgMzIxLjYyMlYzMzMuMjI0QzMxOC41MDcgMzM0LjMyOCAzMTkuNDAzIDMzNS4yMjQgMzIwLjUwNyAzMzUuMjI0SDM3NS4zNUMzNzYuNDU1IDMzNS4yMjQgMzc3LjM1IDMzNC4zMjggMzc3LjM1IDMzMy4yMjRWMzIxLjYyMkMzNzcuMzUgMzIwLjUxNyAzNzYuNDU1IDMxOS42MjIgMzc1LjM1IDMxOS42MjJIMzIwLjUwN1pNMzIwLjUwNyAzNTAuODI2QzMxOS40MDMgMzUwLjgyNiAzMTguNTA3IDM1MS43MjEgMzE4LjUwNyAzNTIuODI2VjM2NC40MjhDMzE4LjUwNyAzNjUuNTMzIDMxOS40MDMgMzY2LjQyOCAzMjAuNTA3IDM2Ni40MjhIMzc1LjM1QzM3Ni40NTUgMzY2LjQyOCAzNzcuMzUgMzY1LjUzMyAzNzcuMzUgMzY0LjQyOFYzNTIuODI2QzM3Ny4zNSAzNTEuNzIxIDM3Ni40NTUgMzUwLjgyNiAzNzUuMzUgMzUwLjgyNkgzMjAuNTA3WiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMxQTZGRTAiLz4KPHBhdGggZD0iTTE5NC4wNjYgMzk2LjEzOEwxNjEuNDE5IDM2Mi45NTZMMTA2Ljc1OSAzMDcuMzk5QzEwNi41NjggMzA3LjIwNCAxMDYuNTY4IDMwNi44OTIgMTA2Ljc1OSAzMDYuNjk4TDEyNC4zOTMgMjg4Ljc3NUMxMjQuNTg5IDI4OC41NzYgMTI0LjkxIDI4OC41NzYgMTI1LjEwNiAyODguNzc1TDIxMi40MTIgMzc3LjUxNEMyMTIuNjA0IDM3Ny43MDggMjEyLjYwNCAzNzguMDIxIDIxMi40MTIgMzc4LjIxNUwxOTQuNzc5IDM5Ni4xMzhDMTk0LjU4MyAzOTYuMzM3IDE5NC4yNjIgMzk2LjMzNyAxOTQuMDY2IDM5Ni4xMzhaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfMzQwXzI1MikiIHN0cm9rZT0idXJsKCNwYWludDFfbGluZWFyXzM0MF8yNTIpIi8+CjxwYXRoIGQ9Ik0xMjQuMzg4IDM5Ni4xMzNMMTA2Ljc0NyAzNzguMjAzQzEwNi41NTkgMzc4LjAxMSAxMDYuNTU1IDM3Ny43MDQgMTA2Ljc0IDM3Ny41MDlMMTk0LjA5MiAyODUuMDI0QzE5NC4yNzUgMjg0LjgzMSAxOTQuNTc2IDI4NC44MTQgMTk0Ljc3OSAyODQuOTg2TDIxNi4wMDggMzAyLjk2OEMyMTYuMjMgMzAzLjE1NiAyMTYuMjQ2IDMwMy40OTMgMjE2LjA0MiAzMDMuN0wxMjUuMTAxIDM5Ni4xMzNDMTI0LjkwNSAzOTYuMzMyIDEyNC41ODQgMzk2LjMzMiAxMjQuMzg4IDM5Ni4xMzNaIiBmaWxsPSIjMEYxNzJBIiBzdHJva2U9IiMwRjE3MkEiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzYxQjNGRiIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxQTZGRTAiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDFfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzYxQjNGRiIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxQTZGRTAiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K"
  },
  "#8B5CF6": {
    dark: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5Mi45MTkgMTc4Ljg0MlYxNDcuMjk3QzI5Mi45MTkgMTQ2Ljc0NSAyOTMuMzY2IDE0Ni4yOTcgMjkzLjkxOSAxNDYuMjk3SDQwNS41OTZDNDA2LjE0OCAxNDYuMjk3IDQwNi41OTYgMTQ2Ljc0NSA0MDYuNTk2IDE0Ny4yOTdWMTc4Ljg0MkM0MDYuNTk2IDE3OS4zOTQgNDA2LjE0OCAxNzkuODQyIDQwNS41OTYgMTc5Ljg0MkgyOTMuOTE5QzI5My4zNjYgMTc5Ljg0MiAyOTIuOTE5IDE3OS4zOTQgMjkyLjkxOSAxNzguODQyWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5NC45MjQgNDAwLjIzM0MyOTMuODE5IDQwMC4yMzMgMjkyLjkyNCAzOTkuMzM3IDI5Mi45MjQgMzk4LjIzM1YyOTAuNDE3QzI5Mi45MjQgMjg5LjMxMyAyOTMuODE5IDI4OC40MTcgMjk0LjkyNCAyODguNDE3SDQwMC45MzRDNDAyLjAzOCAyODguNDE3IDQwMi45MzQgMjg5LjMxMyA0MDIuOTM0IDI5MC40MTdWMzk4LjIzM0M0MDIuOTM0IDM5OS4zMzcgNDAyLjAzOCA0MDAuMjMzIDQwMC45MzQgNDAwLjIzM0gyOTQuOTI0Wk0zMjAuNTA3IDMxOS42MjJDMzE5LjQwMyAzMTkuNjIyIDMxOC41MDcgMzIwLjUxNyAzMTguNTA3IDMyMS42MjJWMzMzLjIyNEMzMTguNTA3IDMzNC4zMjggMzE5LjQwMyAzMzUuMjI0IDMyMC41MDcgMzM1LjIyNEgzNzUuMzVDMzc2LjQ1NSAzMzUuMjI0IDM3Ny4zNSAzMzQuMzI4IDM3Ny4zNSAzMzMuMjI0VjMyMS42MjJDMzc3LjM1IDMyMC41MTcgMzc2LjQ1NSAzMTkuNjIyIDM3NS4zNSAzMTkuNjIySDMyMC41MDdaTTMyMC41MDcgMzUwLjgyNkMzMTkuNDAzIDM1MC44MjYgMzE4LjUwNyAzNTEuNzIxIDMxOC41MDcgMzUyLjgyNlYzNjQuNDI4QzMxOC41MDcgMzY1LjUzMyAzMTkuNDAzIDM2Ni40MjggMzIwLjUwNyAzNjYuNDI4SDM3NS4zNUMzNzYuNDU1IDM2Ni40MjggMzc3LjM1IDM2NS41MzMgMzc3LjM1IDM2NC40MjhWMzUyLjgyNkMzNzcuMzUgMzUxLjcyMSAzNzYuNDU1IDM1MC44MjYgMzc1LjM1IDM1MC44MjZIMzIwLjUwN1oiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBmaWxsPSIjOEI1Q0Y2Ii8+CjxwYXRoIGQ9Ik0xOTQuMDY2IDM5Ni4xMzhMMTYxLjQxOSAzNjIuOTU2TDEwNi43NTkgMzA3LjM5OUMxMDYuNTY4IDMwNy4yMDQgMTA2LjU2OCAzMDYuODkyIDEwNi43NTkgMzA2LjY5OEwxMjQuMzkzIDI4OC43NzVDMTI0LjU4OSAyODguNTc2IDEyNC45MSAyODguNTc2IDEyNS4xMDYgMjg4Ljc3NUwyMTIuNDEyIDM3Ny41MTRDMjEyLjYwNCAzNzcuNzA4IDIxMi42MDQgMzc4LjAyMSAyMTIuNDEyIDM3OC4yMTVMMTk0Ljc3OSAzOTYuMTM4QzE5NC41ODMgMzk2LjMzNyAxOTQuMjYyIDM5Ni4zMzcgMTk0LjA2NiAzOTYuMTM4WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzM0MF8yNTIpIiBzdHJva2U9InVybCgjcGFpbnQxX2xpbmVhcl8zNDBfMjUyKSIvPgo8cGF0aCBkPSJNMTI0LjM4OCAzOTYuMTMzTDEwNi43NDcgMzc4LjIwM0MxMDYuNTU5IDM3OC4wMTEgMTA2LjU1NSAzNzcuNzA0IDEwNi43NCAzNzcuNTA5TDE5NC4wOTIgMjg1LjAyNEMxOTQuMjc1IDI4NC44MzEgMTk0LjU3NiAyODQuODE0IDE5NC43NzkgMjg0Ljk4NkwyMTYuMDA4IDMwMi45NjhDMjE2LjIzIDMwMy4xNTYgMjE2LjI0NiAzMDMuNDkzIDIxNi4wNDIgMzAzLjdMMTI1LjEwMSAzOTYuMTMzQzEyNC45MDUgMzk2LjMzMiAxMjQuNTg0IDM5Ni4zMzIgMTI0LjM4OCAzOTYuMTMzWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IndoaXRlIiBzdHJva2U9IndoaXRlIi8+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjRDg2MUZGIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzhCNUNGNiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MV9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjRDc2MUZGIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzhCNUNGNiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo=",
    light: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0iIzBGMTcyQSIgc3Ryb2tlPSIjMEYxNzJBIi8+CjxwYXRoIGQ9Ik0yOTIuOTE5IDE3OC44NDJWMTQ3LjI5N0MyOTIuOTE5IDE0Ni43NDUgMjkzLjM2NiAxNDYuMjk3IDI5My45MTkgMTQ2LjI5N0g0MDUuNTk2QzQwNi4xNDggMTQ2LjI5NyA0MDYuNTk2IDE0Ni43NDUgNDA2LjU5NiAxNDcuMjk3VjE3OC44NDJDNDA2LjU5NiAxNzkuMzk0IDQwNi4xNDggMTc5Ljg0MiA0MDUuNTk2IDE3OS44NDJIMjkzLjkxOUMyOTMuMzY2IDE3OS44NDIgMjkyLjkxOSAxNzkuMzk0IDI5Mi45MTkgMTc4Ljg0MloiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8cGF0aCBkPSJNMjk0LjkyNCA0MDAuMjMzQzI5My44MTkgNDAwLjIzMyAyOTIuOTI0IDM5OS4zMzcgMjkyLjkyNCAzOTguMjMzVjI5MC40MTdDMjkyLjkyNCAyODkuMzEzIDI5My44MTkgMjg4LjQxNyAyOTQuOTI0IDI4OC40MTdINDAwLjkzNEM0MDIuMDM4IDI4OC40MTcgNDAyLjkzNCAyODkuMzEzIDQwMi45MzQgMjkwLjQxN1YzOTguMjMzQzQwMi45MzQgMzk5LjMzNyA0MDIuMDM4IDQwMC4yMzMgNDAwLjkzNCA0MDAuMjMzSDI5NC45MjRaTTMyMC41MDcgMzE5LjYyMkMzMTkuNDAzIDMxOS42MjIgMzE4LjUwNyAzMjAuNTE3IDMxOC41MDcgMzIxLjYyMlYzMzMuMjI0QzMxOC41MDcgMzM0LjMyOCAzMTkuNDAzIDMzNS4yMjQgMzIwLjUwNyAzMzUuMjI0SDM3NS4zNUMzNzYuNDU1IDMzNS4yMjQgMzc3LjM1IDMzNC4zMjggMzc3LjM1IDMzMy4yMjRWMzIxLjYyMkMzNzcuMzUgMzIwLjUxNyAzNzYuNDU1IDMxOS42MjIgMzc1LjM1IDMxOS42MjJIMzIwLjUwN1pNMzIwLjUwNyAzNTAuODI2QzMxOS40MDMgMzUwLjgyNiAzMTguNTA3IDM1MS43MjEgMzE4LjUwNyAzNTIuODI2VjM2NC40MjhDMzE4LjUwNyAzNjUuNTMzIDMxOS40MDMgMzY2LjQyOCAzMjAuNTA3IDM2Ni40MjhIMzc1LjM1QzM3Ni40NTUgMzY2LjQyOCAzNzcuMzUgMzY1LjUzMyAzNzcuMzUgMzY0LjQyOFYzNTIuODI2QzM3Ny4zNSAzNTEuNzIxIDM3Ni40NTUgMzUwLjgyNiAzNzUuMzUgMzUwLjgyNkgzMjAuNTA3WiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiM4QjVDRjYiLz4KPHBhdGggZD0iTTE5NC4wNjYgMzk2LjEzOEwxNjEuNDE5IDM2Mi45NTZMMTA2Ljc1OSAzMDcuMzk5QzEwNi41NjggMzA3LjIwNCAxMDYuNTY4IDMwNi44OTIgMTA2Ljc1OSAzMDYuNjk4TDEyNC4zOTMgMjg4Ljc3NUMxMjQuNTg5IDI4OC41NzYgMTI0LjkxIDI4OC41NzYgMTI1LjEwNiAyODguNzc1TDIxMi40MTIgMzc3LjUxNEMyMTIuNjA0IDM3Ny43MDggMjEyLjYwNCAzNzguMDIxIDIxMi40MTIgMzc4LjIxNUwxOTQuNzc5IDM5Ni4xMzhDMTk0LjU4MyAzOTYuMzM3IDE5NC4yNjIgMzk2LjMzNyAxOTQuMDY2IDM5Ni4xMzhaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfMzQwXzI1MikiIHN0cm9rZT0idXJsKCNwYWludDFfbGluZWFyXzM0MF8yNTIpIi8+CjxwYXRoIGQ9Ik0xMjQuMzg4IDM5Ni4xMzNMMTA2Ljc0NyAzNzguMjAzQzEwNi41NTkgMzc4LjAxMSAxMDYuNTU1IDM3Ny43MDQgMTA2Ljc0IDM3Ny41MDlMMTk0LjA5MiAyODUuMDI0QzE5NC4yNzUgMjg0LjgzMSAxOTQuNTc2IDI4NC44MTQgMTk0Ljc3OSAyODQuOTg2TDIxNi4wMDggMzAyLjk2OEMyMTYuMjMgMzAzLjE1NiAyMTYuMjQ2IDMwMy40OTMgMjE2LjA0MiAzMDMuN0wxMjUuMTAxIDM5Ni4xMzNDMTI0LjkwNSAzOTYuMzMyIDEyNC41ODQgMzk2LjMzMiAxMjQuMzg4IDM5Ni4xMzNaIiBmaWxsPSIjMEYxNzJBIiBzdHJva2U9IiMwRjE3MkEiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iI0Q4NjFGRiIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM4QjVDRjYiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDFfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iI0Q3NjFGRiIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiM4QjVDRjYiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K"
  },
  "#10B981": {
    dark: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5Mi45MTkgMTc4Ljg0MlYxNDcuMjk3QzI5Mi45MTkgMTQ2Ljc0NSAyOTMuMzY2IDE0Ni4yOTcgMjkzLjkxOSAxNDYuMjk3SDQwNS41OTZDNDA2LjE0OCAxNDYuMjk3IDQwNi41OTYgMTQ2Ljc0NSA0MDYuNTk2IDE0Ny4yOTdWMTc4Ljg0MkM0MDYuNTk2IDE3OS4zOTQgNDA2LjE0OCAxNzkuODQyIDQwNS41OTYgMTc5Ljg0MkgyOTMuOTE5QzI5My4zNjYgMTc5Ljg0MiAyOTIuOTE5IDE3OS4zOTQgMjkyLjkxOSAxNzguODQyWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5NC45MjQgNDAwLjIzM0MyOTMuODE5IDQwMC4yMzMgMjkyLjkyNCAzOTkuMzM3IDI5Mi45MjQgMzk4LjIzM1YyOTAuNDE3QzI5Mi45MjQgMjg5LjMxMyAyOTMuODE5IDI4OC40MTcgMjk0LjkyNCAyODguNDE3SDQwMC45MzRDNDAyLjAzOCAyODguNDE3IDQwMi45MzQgMjg5LjMxMyA0MDIuOTM0IDI5MC40MTdWMzk4LjIzM0M0MDIuOTM0IDM5OS4zMzcgNDAyLjAzOCA0MDAuMjMzIDQwMC45MzQgNDAwLjIzM0gyOTQuOTI0Wk0zMjAuNTA3IDMxOS42MjJDMzE5LjQwMyAzMTkuNjIyIDMxOC41MDcgMzIwLjUxNyAzMTguNTA3IDMyMS42MjJWMzMzLjIyNEMzMTguNTA3IDMzNC4zMjggMzE5LjQwMyAzMzUuMjI0IDMyMC41MDcgMzM1LjIyNEgzNzUuMzVDMzc2LjQ1NSAzMzUuMjI0IDM3Ny4zNSAzMzQuMzI4IDM3Ny4zNSAzMzMuMjI0VjMyMS42MjJDMzc3LjM1IDMyMC41MTcgMzc2LjQ1NSAzMTkuNjIyIDM3NS4zNSAzMTkuNjIySDMyMC41MDdaTTMyMC41MDcgMzUwLjgyNkMzMTkuNDAzIDM1MC44MjYgMzE4LjUwNyAzNTEuNzIxIDMxOC41MDcgMzUyLjgyNlYzNjQuNDI4QzMxOC41MDcgMzY1LjUzMyAzMTkuNDAzIDM2Ni40MjggMzIwLjUwNyAzNjYuNDI4SDM3NS4zNUMzNzYuNDU1IDM2Ni40MjggMzc3LjM1IDM2NS41MzMgMzc3LjM1IDM2NC40MjhWMzUyLjgyNkMzNzcuMzUgMzUxLjcyMSAzNzYuNDU1IDM1MC44MjYgMzc1LjM1IDM1MC44MjZIMzIwLjUwN1oiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBmaWxsPSIjMTBCOTgxIi8+CjxwYXRoIGQ9Ik0xOTQuMDY2IDM5Ni4xMzhMMTYxLjQxOSAzNjIuOTU2TDEwNi43NTkgMzA3LjM5OUMxMDYuNTY4IDMwNy4yMDQgMTA2LjU2OCAzMDYuODkyIDEwNi43NTkgMzA2LjY5OEwxMjQuMzkzIDI4OC43NzVDMTI0LjU4OSAyODguNTc2IDEyNC45MSAyODguNTc2IDEyNS4xMDYgMjg4Ljc3NUwyMTIuNDEyIDM3Ny41MTRDMjEyLjYwNCAzNzcuNzA4IDIxMi42MDQgMzc4LjAyMSAyMTIuNDEyIDM3OC4yMTVMMTk0Ljc3OSAzOTYuMTM4QzE5NC41ODMgMzk2LjMzNyAxOTQuMjYyIDM5Ni4zMzcgMTk0LjA2NiAzOTYuMTM4WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzM0MF8yNTIpIiBzdHJva2U9InVybCgjcGFpbnQxX2xpbmVhcl8zNDBfMjUyKSIvPgo8cGF0aCBkPSJNMTI0LjM4OCAzOTYuMTMzTDEwNi43NDcgMzc4LjIwM0MxMDYuNTU5IDM3OC4wMTEgMTA2LjU1NSAzNzcuNzA0IDEwNi43NCAzNzcuNTA5TDE5NC4wOTIgMjg1LjAyNEMxOTQuMjc1IDI4NC44MzEgMTk0LjU3NiAyODQuODE0IDE5NC43NzkgMjg0Ljk4NkwyMTYuMDA4IDMwMi45NjhDMjE2LjIzIDMwMy4xNTYgMjE2LjI0NiAzMDMuNDkzIDIxNi4wNDIgMzAzLjdMMTI1LjEwMSAzOTYuMTMzQzEyNC45MDUgMzk2LjMzMiAxMjQuNTg0IDM5Ni4zMzIgMTI0LjM4OCAzOTYuMTMzWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IndoaXRlIiBzdHJva2U9IndoaXRlIi8+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjNjFGRkQyIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzEwQjk4MSIvPgo8L2xpbmVhckdyYWRpZW50Pgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MV9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjNjFGRkQyIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iIzEwQjk4MSIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo=",
    light: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0iIzBGMTcyQSIgc3Ryb2tlPSIjMEYxNzJBIi8+CjxwYXRoIGQ9Ik0yOTIuOTE5IDE3OC44NDJWMTQ3LjI5N0MyOTIuOTE5IDE0Ni43NDUgMjkzLjM2NiAxNDYuMjk3IDI5My45MTkgMTQ2LjI5N0g0MDUuNTk2QzQwNi4xNDggMTQ2LjI5NyA0MDYuNTk2IDE0Ni43NDUgNDA2LjU5NiAxNDcuMjk3VjE3OC44NDJDNDA2LjU5NiAxNzkuMzk0IDQwNi4xNDggMTc5Ljg0MiA0MDUuNTk2IDE3OS44NDJIMjkzLjkxOUMyOTMuMzY2IDE3OS44NDIgMjkyLjkxOSAxNzkuMzk0IDI5Mi45MTkgMTc4Ljg0MloiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8cGF0aCBkPSJNMjk0LjkyNCA0MDAuMjMzQzI5My44MTkgNDAwLjIzMyAyOTIuOTI0IDM5OS4zMzcgMjkyLjkyNCAzOTguMjMzVjI5MC40MTdDMjkyLjkyNCAyODkuMzEzIDI5My44MTkgMjg4LjQxNyAyOTQuOTI0IDI4OC40MTdINDAwLjkzNEM0MDIuMDM4IDI4OC40MTcgNDAyLjkzNCAyODkuMzEzIDQwMi45MzQgMjkwLjQxN1YzOTguMjMzQzQwMi45MzQgMzk5LjMzNyA0MDIuMDM4IDQwMC4yMzMgNDAwLjkzNCA0MDAuMjMzSDI5NC45MjRaTTMyMC41MDcgMzE5LjYyMkMzMTkuNDAzIDMxOS42MjIgMzE4LjUwNyAzMjAuNTE3IDMxOC41MDcgMzIxLjYyMlYzMzMuMjI0QzMxOC41MDcgMzM0LjMyOCAzMTkuNDAzIDMzNS4yMjQgMzIwLjUwNyAzMzUuMjI0SDM3NS4zNUMzNzYuNDU1IDMzNS4yMjQgMzc3LjM1IDMzNC4zMjggMzc3LjM1IDMzMy4yMjRWMzIxLjYyMkMzNzcuMzUgMzIwLjUxNyAzNzYuNDU1IDMxOS42MjIgMzc1LjM1IDMxOS42MjJIMzIwLjUwN1pNMzIwLjUwNyAzNTAuODI2QzMxOS40MDMgMzUwLjgyNiAzMTguNTA3IDM1MS43MjEgMzE4LjUwNyAzNTIuODI2VjM2NC40MjhDMzE4LjUwNyAzNjUuNTMzIDMxOS40MDMgMzY2LjQyOCAzMjAuNTA3IDM2Ni40MjhIMzc1LjM1QzM3Ni40NTUgMzY2LjQyOCAzNzcuMzUgMzY1LjUzMyAzNzcuMzUgMzY0LjQyOFYzNTIuODI2QzM3Ny4zNSAzNTEuNzIxIDM3Ni40NTUgMzUwLjgyNiAzNzUuMzUgMzUwLjgyNkgzMjAuNTA3WiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMxMEI5ODEiLz4KPHBhdGggZD0iTTE5NC4wNjYgMzk2LjEzOEwxNjEuNDE5IDM2Mi45NTZMMTA2Ljc1OSAzMDcuMzk5QzEwNi41NjggMzA3LjIwNCAxMDYuNTY4IDMwNi44OTIgMTA2Ljc1OSAzMDYuNjk4TDEyNC4zOTMgMjg4Ljc3NUMxMjQuNTg5IDI4OC41NzYgMTI0LjkxIDI4OC41NzYgMTI1LjEwNiAyODguNzc1TDIxMi40MTIgMzc3LjUxNEMyMTIuNjA0IDM3Ny43MDggMjEyLjYwNCAzNzguMDIxIDIxMi40MTIgMzc4LjIxNUwxOTQuNzc5IDM5Ni4xMzhDMTk0LjU4MyAzOTYuMzM3IDE5NC4yNjIgMzk2LjMzNyAxOTQuMDY2IDM5Ni4xMzhaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfMzQwXzI1MikiIHN0cm9rZT0idXJsKCNwYWludDFfbGluZWFyXzM0MF8yNTIpIi8+CjxwYXRoIGQ9Ik0xMjQuMzg4IDM5Ni4xMzNMMTA2Ljc0NyAzNzguMjAzQzEwNi41NTkgMzc4LjAxMSAxMDYuNTU1IDM3Ny43MDQgMTA2Ljc0IDM3Ny41MDlMMTk0LjA5MiAyODUuMDI0QzE5NC4yNzUgMjg0LjgzMSAxOTQuNTc2IDI4NC44MTQgMTk0Ljc3OSAyODQuOTg2TDIxNi4wMDggMzAyLjk2OEMyMTYuMjMgMzAzLjE1NiAyMTYuMjQ2IDMwMy40OTMgMjE2LjA0MiAzMDMuN0wxMjUuMTAxIDM5Ni4xMzNDMTI0LjkwNSAzOTYuMzMyIDEyNC41ODQgMzk2LjMzMiAxMjQuMzg4IDM5Ni4xMzNaIiBmaWxsPSIjMEYxNzJBIiBzdHJva2U9IiMwRjE3MkEiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzYxRkZEMiIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxMEI5ODEiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDFfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iIzYxRkZEMiIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiMxMEI5ODEiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K"
  },
  "#F97316": {
    dark: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5Mi45MTkgMTc4Ljg0MlYxNDcuMjk3QzI5Mi45MTkgMTQ2Ljc0NSAyOTMuMzY2IDE0Ni4yOTcgMjkzLjkxOSAxNDYuMjk3SDQwNS41OTZDNDA2LjE0OCAxNDYuMjk3IDQwNi41OTYgMTQ2Ljc0NSA0MDYuNTk2IDE0Ny4yOTdWMTc4Ljg0MkM0MDYuNTk2IDE3OS4zOTQgNDA2LjE0OCAxNzkuODQyIDQwNS41OTYgMTc5Ljg0MkgyOTMuOTE5QzI5My4zNjYgMTc5Ljg0MiAyOTIuOTE5IDE3OS4zOTQgMjkyLjkxOSAxNzguODQyWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5NC45MjQgNDAwLjIzM0MyOTMuODE5IDQwMC4yMzMgMjkyLjkyNCAzOTkuMzM3IDI5Mi45MjQgMzk4LjIzM1YyOTAuNDE3QzI5Mi45MjQgMjg5LjMxMyAyOTMuODE5IDI4OC40MTcgMjk0LjkyNCAyODguNDE3SDQwMC45MzRDNDAyLjAzOCAyODguNDE3IDQwMi45MzQgMjg5LjMxMyA0MDIuOTM0IDI5MC40MTdWMzk4LjIzM0M0MDIuOTM0IDM5OS4zMzcgNDAyLjAzOCA0MDAuMjMzIDQwMC45MzQgNDAwLjIzM0gyOTQuOTI0Wk0zMjAuNTA3IDMxOS42MjJDMzE5LjQwMyAzMTkuNjIyIDMxOC41MDcgMzIwLjUxNyAzMTguNTA3IDMyMS42MjJWMzMzLjIyNEMzMTguNTA3IDMzNC4zMjggMzE5LjQwMyAzMzUuMjI0IDMyMC41MDcgMzM1LjIyNEgzNzUuMzVDMzc2LjQ1NSAzMzUuMjI0IDM3Ny4zNSAzMzQuMzI4IDM3Ny4zNSAzMzMuMjI0VjMyMS42MjJDMzc3LjM1IDMyMC41MTcgMzc2LjQ1NSAzMTkuNjIyIDM3NS4zNSAzMTkuNjIySDMyMC41MDdaTTMyMC41MDcgMzUwLjgyNkMzMTkuNDAzIDM1MC44MjYgMzE4LjUwNyAzNTEuNzIxIDMxOC41MDcgMzUyLjgyNlYzNjQuNDI4QzMxOC41MDcgMzY1LjUzMyAzMTkuNDAzIDM2Ni40MjggMzIwLjUwNyAzNjYuNDI4SDM3NS4zNUMzNzYuNDU1IDM2Ni40MjggMzc3LjM1IDM2NS41MzMgMzc3LjM1IDM2NC40MjhWMzUyLjgyNkMzNzcuMzUgMzUxLjcyMSAzNzYuNDU1IDM1MC44MjYgMzc1LjM1IDM1MC44MjZIMzIwLjUwN1oiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBmaWxsPSIjRjk3MzE2Ii8+CjxwYXRoIGQ9Ik0xOTQuMDY2IDM5Ni4xMzhMMTYxLjQxOSAzNjIuOTU2TDEwNi43NTkgMzA3LjM5OUMxMDYuNTY4IDMwNy4yMDQgMTA2LjU2OCAzMDYuODkyIDEwNi43NTkgMzA2LjY5OEwxMjQuMzkzIDI4OC43NzVDMTI0LjU4OSAyODguNTc2IDEyNC45MSAyODguNTc2IDEyNS4xMDYgMjg4Ljc3NUwyMTIuNDEyIDM3Ny41MTRDMjEyLjYwNCAzNzcuNzA4IDIxMi42MDQgMzc4LjAyMSAyMTIuNDEyIDM3OC4yMTVMMTk0Ljc3OSAzOTYuMTM4QzE5NC41ODMgMzk2LjMzNyAxOTQuMjYyIDM5Ni4zMzcgMTk0LjA2NiAzOTYuMTM4WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzM0MF8yNTIpIiBzdHJva2U9InVybCgjcGFpbnQxX2xpbmVhcl8zNDBfMjUyKSIvPgo8cGF0aCBkPSJNMTI0LjM4OCAzOTYuMTMzTDEwNi43NDcgMzc4LjIwM0MxMDYuNTU5IDM3OC4wMTEgMTA2LjU1NSAzNzcuNzA0IDEwNi43NCAzNzcuNTA5TDE5NC4wOTIgMjg1LjAyNEMxOTQuMjc1IDI4NC44MzEgMTk0LjU3NiAyODQuODE0IDE5NC43NzkgMjg0Ljk4NkwyMTYuMDA4IDMwMi45NjhDMjE2LjIzIDMwMy4xNTYgMjE2LjI0NiAzMDMuNDkzIDIxNi4wNDIgMzAzLjdMMTI1LjEwMSAzOTYuMTMzQzEyNC45MDUgMzk2LjMzMiAxMjQuNTg0IDM5Ni4zMzIgMTI0LjM4OCAzOTYuMTMzWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IndoaXRlIiBzdHJva2U9IndoaXRlIi8+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjRkY5RTYxIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0Y5NzMxNiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MV9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjRkY5RTYxIi8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0Y5NzMxNiIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo=",
    light: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0iIzBGMTcyQSIgc3Ryb2tlPSIjMEYxNzJBIi8+CjxwYXRoIGQ9Ik0yOTIuOTE5IDE3OC44NDJWMTQ3LjI5N0MyOTIuOTE5IDE0Ni43NDUgMjkzLjM2NiAxNDYuMjk3IDI5My45MTkgMTQ2LjI5N0g0MDUuNTk2QzQwNi4xNDggMTQ2LjI5NyA0MDYuNTk2IDE0Ni43NDUgNDA2LjU5NiAxNDcuMjk3VjE3OC44NDJDNDA2LjU5NiAxNzkuMzk0IDQwNi4xNDggMTc5Ljg0MiA0MDUuNTk2IDE3OS44NDJIMjkzLjkxOUMyOTMuMzY2IDE3OS44NDIgMjkyLjkxOSAxNzkuMzk0IDI5Mi45MTkgMTc4Ljg0MloiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8cGF0aCBkPSJNMjk0LjkyNCA0MDAuMjMzQzI5My44MTkgNDAwLjIzMyAyOTIuOTI0IDM5OS4zMzcgMjkyLjkyNCAzOTguMjMzVjI5MC40MTdDMjkyLjkyNCAyODkuMzEzIDI5My44MTkgMjg4LjQxNyAyOTQuOTI0IDI4OC40MTdINDAwLjkzNEM0MDIuMDM4IDI4OC40MTcgNDAyLjkzNCAyODkuMzEzIDQwMi45MzQgMjkwLjQxN1YzOTguMjMzQzQwMi45MzQgMzk5LjMzNyA0MDIuMDM4IDQwMC4yMzMgNDAwLjkzNCA0MDAuMjMzSDI5NC45MjRaTTMyMC41MDcgMzE5LjYyMkMzMTkuNDAzIDMxOS42MjIgMzE4LjUwNyAzMjAuNTE3IDMxOC41MDcgMzIxLjYyMlYzMzMuMjI0QzMxOC41MDcgMzM0LjMyOCAzMTkuNDAzIDMzNS4yMjQgMzIwLjUwNyAzMzUuMjI0SDM3NS4zNUMzNzYuNDU1IDMzNS4yMjQgMzc3LjM1IDMzNC4zMjggMzc3LjM1IDMzMy4yMjRWMzIxLjYyMkMzNzcuMzUgMzIwLjUxNyAzNzYuNDU1IDMxOS42MjIgMzc1LjM1IDMxOS42MjJIMzIwLjUwN1pNMzIwLjUwNyAzNTAuODI2QzMxOS40MDMgMzUwLjgyNiAzMTguNTA3IDM1MS43MjEgMzE4LjUwNyAzNTIuODI2VjM2NC40MjhDMzE4LjUwNyAzNjUuNTMzIDMxOS40MDMgMzY2LjQyOCAzMjAuNTA3IDM2Ni40MjhIMzc1LjM1QzM3Ni40NTUgMzY2LjQyOCAzNzcuMzUgMzY1LjUzMyAzNzcuMzUgMzY0LjQyOFYzNTIuODI2QzM3Ny4zNSAzNTEuNzIxIDM3Ni40NTUgMzUwLjgyNiAzNzUuMzUgMzUwLjgyNkgzMjAuNTA3WiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiNGOTczMTYiLz4KPHBhdGggZD0iTTE5NC4wNjYgMzk2LjEzOEwxNjEuNDE5IDM2Mi45NTZMMTA2Ljc1OSAzMDcuMzk5QzEwNi41NjggMzA3LjIwNCAxMDYuNTY4IDMwNi44OTIgMTA2Ljc1OSAzMDYuNjk4TDEyNC4zOTMgMjg4Ljc3NUMxMjQuNTg5IDI4OC41NzYgMTI0LjkxIDI4OC41NzYgMTI1LjEwNiAyODguNzc1TDIxMi40MTIgMzc3LjUxNEMyMTIuNjA0IDM3Ny43MDggMjEyLjYwNCAzNzguMDIxIDIxMi40MTIgMzc4LjIxNUwxOTQuNzc5IDM5Ni4xMzhDMTk0LjU4MyAzOTYuMzM3IDE5NC4yNjIgMzk2LjMzNyAxOTQuMDY2IDM5Ni4xMzhaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfMzQwXzI1MikiIHN0cm9rZT0idXJsKCNwYWludDFfbGluZWFyXzM0MF8yNTIpIi8+CjxwYXRoIGQ9Ik0xMjQuMzg4IDM5Ni4xMzNMMTA2Ljc0NyAzNzguMjAzQzEwNi41NTkgMzc4LjAxMSAxMDYuNTU1IDM3Ny43MDQgMTA2Ljc0IDM3Ny41MDlMMTk0LjA5MiAyODUuMDI0QzE5NC4yNzUgMjg0LjgzMSAxOTQuNTc2IDI4NC44MTQgMTk0Ljc3OSAyODQuOTg2TDIxNi4wMDggMzAyLjk2OEMyMTYuMjMgMzAzLjE1NiAyMTYuMjQ2IDMwMy40OTMgMjE2LjA0MiAzMDMuN0wxMjUuMTAxIDM5Ni4xMzNDMTI0LjkwNSAzOTYuMzMyIDEyNC41ODQgMzk2LjMzMiAxMjQuMzg4IDM5Ni4xMzNaIiBmaWxsPSIjMEYxNzJBIiBzdHJva2U9IiMwRjE3MkEiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iI0ZGOUU2MSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGOTczMTYiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDFfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iI0ZGOUU2MSIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGOTczMTYiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K"
  },
  "#F43F5E": {
    dark: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5Mi45MTkgMTc4Ljg0MlYxNDcuMjk3QzI5Mi45MTkgMTQ2Ljc0NSAyOTMuMzY2IDE0Ni4yOTcgMjkzLjkxOSAxNDYuMjk3SDQwNS41OTZDNDA2LjE0OCAxNDYuMjk3IDQwNi41OTYgMTQ2Ljc0NSA0MDYuNTk2IDE0Ny4yOTdWMTc4Ljg0MkM0MDYuNTk2IDE3OS4zOTQgNDA2LjE0OCAxNzkuODQyIDQwNS41OTYgMTc5Ljg0MkgyOTMuOTE5QzI5My4zNjYgMTc5Ljg0MiAyOTIuOTE5IDE3OS4zOTQgMjkyLjkxOSAxNzguODQyWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTI5NC45MjQgNDAwLjIzM0MyOTMuODE5IDQwMC4yMzMgMjkyLjkyNCAzOTkuMzM3IDI5Mi45MjQgMzk4LjIzM1YyOTAuNDE3QzI5Mi45MjQgMjg5LjMxMyAyOTMuODE5IDI4OC40MTcgMjk0LjkyNCAyODguNDE3SDQwMC45MzRDNDAyLjAzOCAyODguNDE3IDQwMi45MzQgMjg5LjMxMyA0MDIuOTM0IDI5MC40MTdWMzk4LjIzM0M0MDIuOTM0IDM5OS4zMzcgNDAyLjAzOCA0MDAuMjMzIDQwMC45MzQgNDAwLjIzM0gyOTQuOTI0Wk0zMjAuNTA3IDMxOS42MjJDMzE5LjQwMyAzMTkuNjIyIDMxOC41MDcgMzIwLjUxNyAzMTguNTA3IDMyMS42MjJWMzMzLjIyNEMzMTguNTA3IDMzNC4zMjggMzE5LjQwMyAzMzUuMjI0IDMyMC41MDcgMzM1LjIyNEgzNzUuMzVDMzc2LjQ1NSAzMzUuMjI0IDM3Ny4zNSAzMzQuMzI4IDM3Ny4zNSAzMzMuMjI0VjMyMS42MjJDMzc3LjM1IDMyMC41MTcgMzc2LjQ1NSAzMTkuNjIyIDM3NS4zNSAzMTkuNjIySDMyMC41MDdaTTMyMC41MDcgMzUwLjgyNkMzMTkuNDAzIDM1MC44MjYgMzE4LjUwNyAzNTEuNzIxIDMxOC41MDcgMzUyLjgyNlYzNjQuNDI4QzMxOC41MDcgMzY1LjUzMyAzMTkuNDAzIDM2Ni40MjggMzIwLjUwNyAzNjYuNDI4SDM3NS4zNUMzNzYuNDU1IDM2Ni40MjggMzc3LjM1IDM2NS41MzMgMzc3LjM1IDM2NC40MjhWMzUyLjgyNkMzNzcuMzUgMzUxLjcyMSAzNzYuNDU1IDM1MC44MjYgMzc1LjM1IDM1MC44MjZIMzIwLjUwN1oiIGZpbGwtcnVsZT0iZXZlbm9kZCIgY2xpcC1ydWxlPSJldmVub2RkIiBmaWxsPSIjRjQzRjVFIi8+CjxwYXRoIGQ9Ik0xOTQuMDY2IDM5Ni4xMzhMMTYxLjQxOSAzNjIuOTU2TDEwNi43NTkgMzA3LjM5OUMxMDYuNTY4IDMwNy4yMDQgMTA2LjU2OCAzMDYuODkyIDEwNi43NTkgMzA2LjY5OEwxMjQuMzkzIDI4OC43NzVDMTI0LjU4OSAyODguNTc2IDEyNC45MSAyODguNTc2IDEyNS4xMDYgMjg4Ljc3NUwyMTIuNDEyIDM3Ny41MTRDMjEyLjYwNCAzNzcuNzA4IDIxMi42MDQgMzc4LjAyMSAyMTIuNDEyIDM3OC4yMTVMMTk0Ljc3OSAzOTYuMTM4QzE5NC41ODMgMzk2LjMzNyAxOTQuMjYyIDM5Ni4zMzcgMTk0LjA2NiAzOTYuMTM4WiIgZmlsbD0idXJsKCNwYWludDBfbGluZWFyXzM0MF8yNTIpIiBzdHJva2U9InVybCgjcGFpbnQxX2xpbmVhcl8zNDBfMjUyKSIvPgo8cGF0aCBkPSJNMTI0LjM4OCAzOTYuMTMzTDEwNi43NDcgMzc4LjIwM0MxMDYuNTU5IDM3OC4wMTEgMTA2LjU1NSAzNzcuNzA0IDEwNi43NCAzNzcuNTA5TDE5NC4wOTIgMjg1LjAyNEMxOTQuMjc1IDI4NC44MzEgMTk0LjU3NiAyODQuODE0IDE5NC43NzkgMjg0Ljk4NkwyMTYuMDA4IDMwMi45NjhDMjE2LjIzIDMwMy4xNTYgMjE2LjI0NiAzMDMuNDkzIDIxNi4wNDIgMzAzLjdMMTI1LjEwMSAzOTYuMTMzQzEyNC45MDUgMzk2LjMzMiAxMjQuNTg0IDM5Ni4zMzIgMTI0LjM4OCAzOTYuMTMzWiIgZmlsbD0id2hpdGUiIHN0cm9rZT0id2hpdGUiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IndoaXRlIiBzdHJva2U9IndoaXRlIi8+CjxkZWZzPgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MF9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjRkY2MUY0Ii8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0Y0M0Y1RSIvPgo8L2xpbmVhckdyYWRpZW50Pgo8bGluZWFyR3JhZGllbnQgaWQ9InBhaW50MV9saW5lYXJfMzQwXzI1MiIgeDE9IjExMy43NDgiIHkxPSIyOTUuODY3IiB4Mj0iMjA2LjkxNSIgeTI9IjM4Ny41MyIgZ3JhZGllbnRVbml0cz0idXNlclNwYWNlT25Vc2UiPgo8c3RvcCBzdG9wLWNvbG9yPSIjRkY2MUY0Ii8+CjxzdG9wIG9mZnNldD0iMSIgc3RvcC1jb2xvcj0iI0Y0M0Y1RSIvPgo8L2xpbmVhckdyYWRpZW50Pgo8L2RlZnM+Cjwvc3ZnPgo=",
    light: "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNTEzIiBoZWlnaHQ9IjUxMyIgdmlld0JveD0iMCAwIDUxMyA1MTMiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxwYXRoIGQ9Ik0xNjAuNDc0IDkzLjI4NjlMMTQzLjI1NyAxNDUuNzg1QzE0My4xNTIgMTQ2LjEwNCAxNDIuODkzIDE0Ni4zNSAxNDIuNTY5IDE0Ni40MzhMOTAuOTQ0NSAxNjAuNDNDOTAuMDIwNSAxNjAuNjgxIDg5Ljk0MjcgMTYxLjk2MSA5MC44Mjk1IDE2Mi4zMjJMMTQyLjY3MiAxODMuMzk5QzE0Mi45MzcgMTgzLjUwNyAxNDMuMTQzIDE4My43MjQgMTQzLjIzOCAxODMuOTk0TDE2MC40ODEgMjMzLjA2NEMxNjAuNzk0IDIzMy45NTYgMTYyLjA1NCAyMzMuOTU2IDE2Mi4zNjggMjMzLjA2NEwxNzkuNjIgMTgzLjk2NUMxNzkuNzA5IDE4My43MTEgMTc5Ljg5NiAxODMuNTA1IDE4MC4xMzkgMTgzLjM5MUwyMjUuMTAyIDE2Mi4yOThDMjI1LjkyOCAxNjEuOTExIDIyNS44NDYgMTYwLjcxIDIyNC45NzYgMTYwLjQzOEwxODAuMjUgMTQ2LjQ1MUMxNzkuOTQyIDE0Ni4zNTQgMTc5LjY5OSAxNDYuMTE1IDE3OS41OTkgMTQ1LjgwOEwxNjIuMzc0IDkzLjI4NjlDMTYyLjA3MyA5Mi4zNjkgMTYwLjc3NSA5Mi4zNjkgMTYwLjQ3NCA5My4yODY5WiIgZmlsbD0iIzBGMTcyQSIgc3Ryb2tlPSIjMEYxNzJBIi8+CjxwYXRoIGQ9Ik0yOTIuOTE5IDE3OC44NDJWMTQ3LjI5N0MyOTIuOTE5IDE0Ni43NDUgMjkzLjM2NiAxNDYuMjk3IDI5My45MTkgMTQ2LjI5N0g0MDUuNTk2QzQwNi4xNDggMTQ2LjI5NyA0MDYuNTk2IDE0Ni43NDUgNDA2LjU5NiAxNDcuMjk3VjE3OC44NDJDNDA2LjU5NiAxNzkuMzk0IDQwNi4xNDggMTc5Ljg0MiA0MDUuNTk2IDE3OS44NDJIMjkzLjkxOUMyOTMuMzY2IDE3OS44NDIgMjkyLjkxOSAxNzkuMzk0IDI5Mi45MTkgMTc4Ljg0MloiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8cGF0aCBkPSJNMjk0LjkyNCA0MDAuMjMzQzI5My44MTkgNDAwLjIzMyAyOTIuOTI0IDM5OS4zMzcgMjkyLjkyNCAzOTguMjMzVjI5MC40MTdDMjkyLjkyNCAyODkuMzEzIDI5My44MTkgMjg4LjQxNyAyOTQuOTI0IDI4OC40MTdINDAwLjkzNEM0MDIuMDM4IDI4OC40MTcgNDAyLjkzNCAyODkuMzEzIDQwMi45MzQgMjkwLjQxN1YzOTguMjMzQzQwMi45MzQgMzk5LjMzNyA0MDIuMDM4IDQwMC4yMzMgNDAwLjkzNCA0MDAuMjMzSDI5NC45MjRaTTMyMC41MDcgMzE5LjYyMkMzMTkuNDAzIDMxOS42MjIgMzE4LjUwNyAzMjAuNTE3IDMxOC41MDcgMzIxLjYyMlYzMzMuMjI0QzMxOC41MDcgMzM0LjMyOCAzMTkuNDAzIDMzNS4yMjQgMzIwLjUwNyAzMzUuMjI0SDM3NS4zNUMzNzYuNDU1IDMzNS4yMjQgMzc3LjM1IDMzNC4zMjggMzc3LjM1IDMzMy4yMjRWMzIxLjYyMkMzNzcuMzUgMzIwLjUxNyAzNzYuNDU1IDMxOS42MjIgMzc1LjM1IDMxOS42MjJIMzIwLjUwN1pNMzIwLjUwNyAzNTAuODI2QzMxOS40MDMgMzUwLjgyNiAzMTguNTA3IDM1MS43MjEgMzE4LjUwNyAzNTIuODI2VjM2NC40MjhDMzE4LjUwNyAzNjUuNTMzIDMxOS40MDMgMzY2LjQyOCAzMjAuNTA3IDM2Ni40MjhIMzc1LjM1QzM3Ni40NTUgMzY2LjQyOCAzNzcuMzUgMzY1LjUzMyAzNzcuMzUgMzY0LjQyOFYzNTIuODI2QzM3Ny4zNSAzNTEuNzIxIDM3Ni40NTUgMzUwLjgyNiAzNzUuMzUgMzUwLjgyNkgzMjAuNTA3WiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiNGNDNGNUUiLz4KPHBhdGggZD0iTTE5NC4wNjYgMzk2LjEzOEwxNjEuNDE5IDM2Mi45NTZMMTA2Ljc1OSAzMDcuMzk5QzEwNi41NjggMzA3LjIwNCAxMDYuNTY4IDMwNi44OTIgMTA2Ljc1OSAzMDYuNjk4TDEyNC4zOTMgMjg4Ljc3NUMxMjQuNTg5IDI4OC41NzYgMTI0LjkxIDI4OC41NzYgMTI1LjEwNiAyODguNzc1TDIxMi40MTIgMzc3LjUxNEMyMTIuNjA0IDM3Ny43MDggMjEyLjYwNCAzNzguMDIxIDIxMi40MTIgMzc4LjIxNUwxOTQuNzc5IDM5Ni4xMzhDMTk0LjU4MyAzOTYuMzM3IDE5NC4yNjIgMzk2LjMzNyAxOTQuMDY2IDM5Ni4xMzhaIiBmaWxsPSJ1cmwoI3BhaW50MF9saW5lYXJfMzQwXzI1MikiIHN0cm9rZT0idXJsKCNwYWludDFfbGluZWFyXzM0MF8yNTIpIi8+CjxwYXRoIGQ9Ik0xMjQuMzg4IDM5Ni4xMzNMMTA2Ljc0NyAzNzguMjAzQzEwNi41NTkgMzc4LjAxMSAxMDYuNTU1IDM3Ny43MDQgMTA2Ljc0IDM3Ny41MDlMMTk0LjA5MiAyODUuMDI0QzE5NC4yNzUgMjg0LjgzMSAxOTQuNTc2IDI4NC44MTQgMTk0Ljc3OSAyODQuOTg2TDIxNi4wMDggMzAyLjk2OEMyMTYuMjMgMzAzLjE1NiAyMTYuMjQ2IDMwMy40OTMgMjE2LjA0MiAzMDMuN0wxMjUuMTAxIDM5Ni4xMzNDMTI0LjkwNSAzOTYuMzMyIDEyNC41ODQgMzk2LjMzMiAxMjQuMzg4IDM5Ni4xMzNaIiBmaWxsPSIjMEYxNzJBIiBzdHJva2U9IiMwRjE3MkEiLz4KPHBhdGggZD0iTTAuNSA0NjMuOTE2VjUyLjgyMTJDMC41IDIyLjkyMzQgMTUuMTI4NyAwLjUgNDguMDQyOSAwLjVINDYxLjNDNDk0LjIxNSAwLjUgNTEyLjUgMTkuMTg2MSA1MTIuNSA1Mi44MjEyVjQ2My45MTZDNTEyLjUgNDk3LjU1MSA0OTQuMjE1IDUxMi41IDQ1Ny42NDMgNTEyLjVINTEuN0MyMi40NDMgNTEyLjUgMC41MDAxMTIgNDkzLjgxNCAwLjUgNDYzLjkxNlpNNDguMDQzIDQ0NS4yM1Y3MS41MDczQzQ4LjA0MjkgNTYuNTU4NCA1MS43MDAxIDUyLjgyMTIgNjYuMzI4NyA1Mi44MjEySDQ0Ni42NzJDNDYxLjMgNTIuODIxMiA0NjQuOTU3IDY0LjAzMjggNDY0Ljk1NyA3My44NjI0VjQ0NS4yM0M0NjQuOTU3IDQ1Ni40NDIgNDU3LjY0MyA0NjMuOTE2IDQ0Ni42NzIgNDYzLjkxNkg2Ni4zMjg3QzU1LjM1NzMgNDYzLjkxNiA0OC4wNDMgNDU2LjQ0MiA0OC4wNDMgNDQ1LjIzWiIgZmlsbC1ydWxlPSJldmVub2RkIiBjbGlwLXJ1bGU9ImV2ZW5vZGQiIGZpbGw9IiMwRjE3MkEiIHN0cm9rZT0iIzBGMTcyQSIvPgo8ZGVmcz4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDBfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iI0ZGNjFGNCIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGNDNGNUUiLz4KPC9saW5lYXJHcmFkaWVudD4KPGxpbmVhckdyYWRpZW50IGlkPSJwYWludDFfbGluZWFyXzM0MF8yNTIiIHgxPSIxMTMuNzQ4IiB5MT0iMjk1Ljg2NyIgeDI9IjIwNi45MTUiIHkyPSIzODcuNTMiIGdyYWRpZW50VW5pdHM9InVzZXJTcGFjZU9uVXNlIj4KPHN0b3Agc3RvcC1jb2xvcj0iI0ZGNjFGNCIvPgo8c3RvcCBvZmZzZXQ9IjEiIHN0b3AtY29sb3I9IiNGNDNGNUUiLz4KPC9saW5lYXJHcmFkaWVudD4KPC9kZWZzPgo8L3N2Zz4K"
  }
};
function atualizarIconesTema(corHex) {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const temaKey = isDark ? 'dark' : 'light';
  const iconesCor = ICONES_TEMA[corHex] || ICONES_TEMA['#1A6FE0'];
  const src = (iconesCor && iconesCor[temaKey]) ? iconesCor[temaKey] : (iconesCor ? (iconesCor.dark || iconesCor) : '');
  if (!src) return;

  const fav = document.getElementById('app-favicon') || document.querySelector('link[rel="icon"]');
  if (fav) fav.href = src;
  const brandImg = document.getElementById('brand-logo-img') || document.querySelector('.brand-icon img');
  if (brandImg) brandImg.src = src;
  const bloqImg = document.getElementById('bloqueio-logo');
  if (bloqImg) bloqImg.src = src;
  try {
    if (ehElectron()) {
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 128, 128);
          const pngUrl = canvas.toDataURL('image/png');
          if (window.electronAPI && typeof window.electronAPI.setWindowIcon === 'function') {
            window.electronAPI.setWindowIcon(pngUrl);
          }
        } catch (e) {
          enviarIcone(src);
        }
      };
      img.onerror = () => {
        enviarIcone(src);
      };
      img.src = src;
    }
  } catch (e) {}
}
const PALETA_ACCENT = {
  '#1A6FE0': { light: { accent: '#1A6FE0', dark: '#0B3D91', bg: '#EFF6FF', glow: 'rgba(26,111,224,.12)', text: '#0B3D91' }, dark: { accent: '#3B82F6', dark: '#1D4ED8', bg: 'rgba(59,130,246,.14)', glow: 'rgba(59,130,246,.22)', text: '#8FBBFA' } },
  '#8B5CF6': { light: { accent: '#8B5CF6', dark: '#6D28D9', bg: '#F5F3FF', glow: 'rgba(139,92,246,.14)', text: '#5B21B6' }, dark: { accent: '#A78BFA', dark: '#7C3AED', bg: 'rgba(167,139,250,.15)', glow: 'rgba(167,139,250,.22)', text: '#DDD6FE' } },
  '#10B981': { light: { accent: '#10B981', dark: '#047857', bg: '#ECFDF5', glow: 'rgba(16,185,129,.14)', text: '#065F46' }, dark: { accent: '#34D399', dark: '#059669', bg: 'rgba(52,211,153,.15)', glow: 'rgba(52,211,153,.22)', text: '#A7F3D0' } },
  '#F97316': { light: { accent: '#F97316', dark: '#C2410C', bg: '#FFF7ED', glow: 'rgba(249,115,22,.14)', text: '#9A3412' }, dark: { accent: '#FB923C', dark: '#EA580C', bg: 'rgba(251,146,60,.15)', glow: 'rgba(251,146,60,.22)', text: '#FED7AA' } },
  '#F43F5E': { light: { accent: '#F43F5E', dark: '#BE123C', bg: '#FFF1F2', glow: 'rgba(244,63,94,.14)', text: '#9F1239' }, dark: { accent: '#FB7185', dark: '#E11D48', bg: 'rgba(251,113,133,.15)', glow: 'rgba(251,113,133,.22)', text: '#FECDD3' } }
};
async function definirCorDestaque(corHex, salvar) {
  const chave = PALETA_ACCENT[corHex] ? corHex : '#1A6FE0';
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const vars = PALETA_ACCENT[chave][isDark ? 'dark' : 'light'];
  const root = document.documentElement.style;
  root.setProperty('--accent', vars.accent);
  root.setProperty('--accent-dark', vars.dark);
  root.setProperty('--accent-bg', vars.bg);
  root.setProperty('--accent-glow', vars.glow);
  root.setProperty('--accent-text', vars.text);
  document.querySelectorAll('.accent-swatch').forEach(btn => {
    const ativo = btn.getAttribute('data-accent') === chave;
    btn.classList.toggle('active', ativo);
    btn.innerHTML = ativo ? '<i class="ti ti-check"></i>' : '';
  });
  atualizarIconesTema(chave);
  if (!STATE.config) STATE.config = {};
  STATE.config.accentColor = chave;
  if (salvar) {
    await salvarDados();
    renderDashboard();
    if (document.getElementById('page-relatorios').classList.contains('active')) renderRelatorios();
  }
}
function alternarTema() {
  const atual = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  aplicarTema(atual === 'dark' ? 'light' : 'dark');
}
function sincronizarIconeTema() {
  const tema = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
  const icone = document.getElementById('icone-tema');
  if (icone) icone.className = tema === 'dark' ? 'ti ti-sun' : 'ti ti-moon';
}

/* ================= DASHBOARD & SIMULADOR WHAT-IF & DASHBOARD MODULAR ================= */
function abrirModalSimulador() {
  const inp = document.getElementById('simulador-valor');
  const res = document.getElementById('simulador-resultado');
  if (inp) inp.value = '';
  if (res) { res.style.display = 'none'; res.innerHTML = ''; }
  abrirModal('modal-simulador');
  setTimeout(() => { if (inp) inp.focus(); }, 60);
}
function calcularSimulacaoImpacto() {
  const inp = document.getElementById('simulador-valor');
  const res = document.getElementById('simulador-resultado');
  if (!inp || !res) return;
  const valorCompra = moedaToNumber(inp.value);
  if (!valorCompra || valorCompra <= 0) {
    res.style.display = 'none';
    return;
  }
  const mesAtual = hojeLocalISO().slice(0, 7);
  let receitasMes = 0, despesasMes = 0;
  STATE.lancamentos.forEach(l => {
    if (l.data && l.data.slice(0, 7) === mesAtual && !isLancamentoTransferencia(l)) {
      if (l.tipo === 'receita') receitasMes += l.valor;
      else despesasMes += l.valor;
    }
  });
  const orcamentoCats = STATE.categorias
    .filter(c => c.tipo === 'despesa' && c.orcamento > 0)
    .reduce((s, c) => s + c.orcamento, 0);
  const baseOrcamento = orcamentoCats > 0 ? orcamentoCats : receitasMes;
  const pct = baseOrcamento > 0 ? ((valorCompra / baseOrcamento) * 100).toFixed(1).replace('.', ',') : '100,0';
  const novoSaldoMes = (receitasMes - despesasMes) - valorCompra;
  const modoViagemAtivo = !!(STATE.config && STATE.config.modoViagem && STATE.config.modoViagem.ativo);
  const critico = !modoViagemAtivo && (novoSaldoMes < 0 || (baseOrcamento > 0 && (valorCompra / baseOrcamento) > 0.3));

  res.style.display = 'flex';
  res.style.background = critico ? 'var(--bad-bg)' : 'var(--accent-bg)';
  res.style.borderColor = critico ? 'var(--bad-border)' : 'var(--accent)';
  res.style.color = critico ? 'var(--bad-text)' : 'var(--accent-text)';
  res.innerHTML = `<i class="ti ${modoViagemAtivo ? 'ti-plane' : (critico ? 'ti-alert-triangle' : 'ti-info-circle')}" style="font-size:18px;flex-shrink:0;margin-top:2px"></i>
    <div>${modoViagemAtivo ? `<strong>Modo Viagem Ativo (${STATE.config.modoViagem.nome}):</strong> Alertas de limite de orçamento estão suspensos. ` : ''}Esta compra consumirá <strong>${pct}%</strong> do seu orçamento atual${orcamentoCats > 0 ? ' (soma das metas de categorias)' : ' (receitas do mês)'} e o saldo do mês passará para <strong>${toBRL(novoSaldoMes)}</strong>.</div>`;
}
function converterSimulacaoEmLancamento() {
  const valorTxt = document.getElementById('simulador-valor').value;
  fecharModal('modal-simulador');
  abrirModalLancamento();
  const inp = document.getElementById('lanc-valor');
  if (inp && valorTxt) {
    inp.value = valorTxt;
    atualizarDicaParcelas();
  }
}

/* ================= BENTO GRID INTERATIVA (DRAG & DROP) ================= */
let dashDragEl = null;

async function guardarLayout() {
  const container = document.getElementById('dash-modular-container');
  if (!container) return;
  const cards = container.querySelectorAll(':scope > [data-widget-id]');
  const novoLayout = Array.from(cards).map(c => c.getAttribute('data-widget-id')).filter(Boolean);

  if (!STATE.config) STATE.config = {};
  STATE.config.layout = novoLayout;

  await salvarDados();
}

function aplicarLayout() {
  const container = document.getElementById('dash-modular-container');
  if (!container) return;

  const layout = (STATE.config && Array.isArray(STATE.config.layout)) ? STATE.config.layout : null;

  if (Array.isArray(layout) && layout.length > 0) {
    layout.forEach(widgetIdOuId => {
      const el = container.querySelector(`:scope > [data-widget-id="${widgetIdOuId}"]`) ||
                 container.querySelector(`:scope > #${widgetIdOuId}`);
      if (el && el.parentElement === container) {
        container.appendChild(el);
      }
    });
  }

  const kpiCont = document.getElementById('dash-kpis');
  if (kpiCont && STATE.config && Array.isArray(STATE.config.layoutDashboardKpis)) {
    STATE.config.layoutDashboardKpis.forEach(id => {
      const kEl = document.getElementById(id);
      if (kEl && kEl.parentElement === kpiCont) kpiCont.appendChild(kEl);
    });
  }
}

function aplicarLayoutDashboard() {
  aplicarLayout();
}

let _arrastandoDashboard = false;
let _ultimoDragEndDashboardTs = 0;

function podeExecutarCliqueDashboard(ev) {
  if (_arrastandoDashboard) return false;
  if (Date.now() - _ultimoDragEndDashboardTs < 280) return false;
  if (ev && ev.target && typeof ev.target.closest === 'function') {
    const alvoAtual = ev.currentTarget || null;
    const interativoInterno = ev.target.closest('button, a, input, select, textarea, .dash-drag-handle');
    if (interativoInterno && interativoInterno !== alvoAtual) return false;
  }
  return true;
}

function focarWidgetSaldoContasDashboard(ev) {
  if (ev && !podeExecutarCliqueDashboard(ev)) return;
  const alvo = document.getElementById('dash-saldo-contas-card');
  if (!alvo) {
    nav('config');
    return;
  }
  if (typeof alvo.scrollIntoView === 'function') {
    alvo.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }
  alvo.classList.remove('widget-highlight-pulse');
  void alvo.offsetWidth;
  alvo.classList.add('widget-highlight-pulse');
  clearTimeout(focarWidgetSaldoContasDashboard._t);
  focarWidgetSaldoContasDashboard._t = setTimeout(() => {
    alvo.classList.remove('widget-highlight-pulse');
  }, 1600);
}

function inicializarDragDropDashboard() {
  const container = document.getElementById('dash-modular-container');
  if (!container) return;

  if (!container._cofinDragGuardBound && typeof container.addEventListener === 'function') {
    container._cofinDragGuardBound = true;
    container.addEventListener('dragstart', () => {
      _arrastandoDashboard = true;
    }, true);
    container.addEventListener('dragend', () => {
      _arrastandoDashboard = false;
      _ultimoDragEndDashboardTs = Date.now();
    }, true);
    container.addEventListener('drop', () => {
      _arrastandoDashboard = false;
      _ultimoDragEndDashboardTs = Date.now();
    }, true);
  }

  const cards = container.querySelectorAll(':scope > .dash-draggable, :scope > [data-widget-id]');

  cards.forEach(card => {
    card.setAttribute('draggable', 'true');

    card.ondragstart = (e) => {
      _arrastandoDashboard = true;
      dashDragEl = card;
      card.classList.add('dragging');
      if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        try {
          e.dataTransfer.setData('text/plain', card.getAttribute('data-widget-id') || card.id);
        } catch (err) {}
      }
    };

    card.ondragend = async () => {
      _arrastandoDashboard = false;
      _ultimoDragEndDashboardTs = Date.now();
      card.classList.remove('dragging');
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      dashDragEl = null;
      await guardarLayout();
    };
  });

  container.ondragover = (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (!dashDragEl) return;

    const target = e.target.closest('#dash-modular-container > [data-widget-id], #dash-modular-container > .dash-draggable');
    if (!target || target === dashDragEl || target.parentElement !== container) return;

    const rect = target.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const midX = rect.left + rect.width / 2;

    const estaDepois = (e.clientY > midY) || (Math.abs(e.clientY - midY) < rect.height * 0.35 && e.clientX > midX);

    if (estaDepois) {
      if (target.nextSibling !== dashDragEl) {
        container.insertBefore(dashDragEl, target.nextSibling);
      }
    } else {
      if (target !== dashDragEl.nextSibling) {
        container.insertBefore(dashDragEl, target);
      }
    }
  };

  container.ondragenter = (e) => {
    e.preventDefault();
    const target = e.target.closest('#dash-modular-container > [data-widget-id], #dash-modular-container > .dash-draggable');
    if (target && target !== dashDragEl && target.parentElement === container) {
      container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
      target.classList.add('drag-over');
    }
  };

  container.ondragleave = (e) => {
    const target = e.target.closest('#dash-modular-container > [data-widget-id], #dash-modular-container > .dash-draggable');
    if (target && e.relatedTarget && !target.contains(e.relatedTarget)) {
      target.classList.remove('drag-over');
    }
  };

  container.ondrop = async (e) => {
    e.preventDefault();
    if (dashDragEl) {
      dashDragEl.classList.remove('dragging');
    }
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dashDragEl = null;
    await guardarLayout();
  };
}

/**
 * Verifica se uma despesa de cartão já foi liquidada através de um lançamento de
 * "Transferência/Pagamento de Fatura" na conta corrente, anulando a dívida do cartão
 * no cálculo do Património Líquido / Saldo Geral para evitar qualquer duplicação.
 */
function despesaCartaoAnuladaPorPagamentoFatura(l) {
  if (!l || ehLancamentoPagamentoFatura(l) || !ehLancamentoCartao(l) || l.tipo !== 'despesa') return false;
  if (l.faturaPaga !== true) return false;
  // Verifica se existe o lançamento de saída ("Pagamento Fatura") na conta bancária
  const temSaidaConta = (STATE.lancamentos || []).some(p => {
    if (!ehLancamentoPagamentoFatura(p)) return false;
    if (l.pagamentoFaturaId && p.id === l.pagamentoFaturaId) return true;
    const nomeC = p.cartaoNome || String(p.descricao || '').replace(/^pagamento\s+(?:de\s+)?fatura\s*/i, '').trim();
    if (nomeC && l.conta && nomeC.toLowerCase() === l.conta.toLowerCase()) {
      if (p.faturaAno && p.faturaMes && l.faturaAno && l.faturaMes) {
        return Number(p.faturaAno) === Number(l.faturaAno) && Number(p.faturaMes) === Number(l.faturaMes);
      }
      return true;
    }
    return false;
  });
  return temSaidaConta;
}

function renderDashboard() {
  migrarCofresParaMetas();
  recalcularLimitesCartoes();
  const mesAtual = hojeLocalISO().slice(0, 7);
  if (typeof atualizarContagemTriagem === 'function') atualizarContagemTriagem();
  const resumoGlobal = calcularSaldoDisponivelGeral(mesAtual);
  const receitasMes = resumoGlobal.receitasMes;
  const despesasMes = resumoGlobal.despesasMes;
  const totalGuardadoMetas = resumoGlobal.totalAlocado;
  const patrimonioTotal = resumoGlobal.patrimonioTotal;
  const saldoDisponivel = resumoGlobal.saldoDisponivel;
  const resultadoMes = Math.round((receitasMes - despesasMes) * 100) / 100;
  const mesesDoisUltimos = ultimosMeses(2);
  const taxaMesAtual = taxaPoupanca(mesesDoisUltimos[1]);
  const taxaMesAnterior = taxaPoupanca(mesesDoisUltimos[0]);
  const fmtValKpi = (v) => {
    const s = toBRL(v);
    return { str: s, isLong: s.length > 13 };
  };
  const valSaldo = fmtValKpi(saldoDisponivel);
  const valPat = fmtValKpi(patrimonioTotal);
  const valRec = fmtValKpi(receitasMes);
  const valDesp = fmtValKpi(despesasMes);
  const valRes = fmtValKpi(resultadoMes);
  const valTaxa = fmtPct(taxaMesAtual);

  // Guarda valores anteriores para animação suave de Rolling Numbers
  const elSaldoAntigo = document.getElementById('kpi-saldo-valor');
  const saldoAnterior = (elSaldoAntigo && elSaldoAntigo.dataset.valorRaw !== undefined) ? parseFloat(elSaldoAntigo.dataset.valorRaw) : null;
  const elPatAntigo = document.getElementById('kpi-patrimonio-valor');
  const patAnterior = (elPatAntigo && elPatAntigo.dataset.valorRaw !== undefined) ? parseFloat(elPatAntigo.dataset.valorRaw) : null;

  document.getElementById('dash-kpis').innerHTML = `
    <div class="metric m-info dash-draggable dash-clickable" id="kpi-saldo-total" draggable="true" onclick="focarWidgetSaldoContasDashboard(event)" title="Ver saldos detalhados por conta e cartão">
      <div class="metric-top"><div class="metric-label" title="Saldo Disponível">Saldo Disponível</div><div class="metric-icon mi-info"><i class="ti ti-wallet"></i></div></div>
      <div class="metric-value valor-sensivel ${saldoDisponivel>=0?'mv-ok':'mv-bad'} ${valSaldo.isLong?'metric-val-long':''}" id="kpi-saldo-valor" title="${valSaldo.str}">${valSaldo.str}</div>
      <span class="text-muted text-sm" id="dash-saldo-exclui-metas" style="${totalGuardadoMetas > 0 ? '' : 'display:none'}">${totalGuardadoMetas > 0 ? 'Exclui ' + toBRL(totalGuardadoMetas) + ' guardados em Metas' : ''}</span>
      <div class="metric-sub" style="${totalGuardadoMetas > 0 ? 'display:none' : ''}">livre para uso diário</div>
    </div>
    <div class="metric m-info dash-draggable dash-clickable" id="kpi-patrimonio-total" draggable="true" onclick="focarWidgetSaldoContasDashboard(event)" title="Ver saldo consolidado por conta e cartão">
      <div class="metric-top"><div class="metric-label" title="Patrimônio Total">Patrimônio Total</div><div class="metric-icon mi-info"><i class="ti ti-pig-money"></i></div></div>
      <div class="metric-value valor-sensivel ${patrimonioTotal>=0?'mv-info':'mv-bad'} ${valPat.isLong?'metric-val-long':''}" id="kpi-patrimonio-valor" title="${valPat.str}">${valPat.str}</div>
      <div class="metric-sub" title="${totalGuardadoMetas > 0 ? 'inclui ' + toBRL(totalGuardadoMetas) + ' retidos em Metas' : 'saldo consolidado das contas'}">${totalGuardadoMetas > 0 ? 'inclui ' + toBRL(totalGuardadoMetas) + ' retidos em Metas' : 'saldo consolidado das contas'}</div>
    </div>
    <div class="metric m-ok dash-draggable dash-clickable" id="kpi-receitas-mes" draggable="true" data-drill-mes="${escHtml(mesAtual)}" onclick="if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ mes: this.dataset.drillMes, tipo: 'receita', modoFiltroMes: 'fatura' })" title="Ver receitas do mês em Lançamentos">
      <div class="metric-top"><div class="metric-label" title="Receitas no mês">Receitas no mês</div><div class="metric-icon mi-ok"><i class="ti ti-trending-up"></i></div></div>
      <div class="metric-value valor-sensivel mv-ok ${valRec.isLong?'metric-val-long':''}" title="${valRec.str}">${valRec.str}</div>
      <div class="metric-sub">mês atual · ver lançamentos</div>
    </div>
    <div class="metric m-bad dash-draggable dash-clickable" id="kpi-despesas-mes" draggable="true" data-drill-mes="${escHtml(mesAtual)}" onclick="if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ mes: this.dataset.drillMes, tipo: 'despesa', modoFiltroMes: 'fatura' })" title="Ver despesas do mês em Lançamentos">
      <div class="metric-top"><div class="metric-label" title="Despesas no mês">Despesas no mês</div><div class="metric-icon mi-bad"><i class="ti ti-trending-down"></i></div></div>
      <div class="metric-value valor-sensivel mv-bad ${valDesp.isLong?'metric-val-long':''}" title="${valDesp.str}">${valDesp.str}</div>
      <div class="metric-sub">mês atual · ver lançamentos</div>
    </div>
    <div class="metric ${resultadoMes>=0?'m-ok':'m-bad'} dash-draggable dash-clickable" id="kpi-resultado-mes" draggable="true" data-drill-mes="${escHtml(mesAtual)}" onclick="if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ mes: this.dataset.drillMes, tipo: 'todos', modoFiltroMes: 'fatura' })" title="Ver todos os lançamentos do mês">
      <div class="metric-top"><div class="metric-label" title="Resultado do mês">Resultado do mês</div><div class="metric-icon ${resultadoMes>=0?'mi-ok':'mi-bad'}"><i class="ti ti-scale"></i></div></div>
      <div class="metric-value valor-sensivel ${resultadoMes>=0?'mv-ok':'mv-bad'} ${valRes.isLong?'metric-val-long':''}" title="${valRes.str}">${valRes.str}</div>
      <div class="metric-sub">receitas - despesas · ver mês</div>
    </div>
    <div class="metric ${taxaMesAtual>=20?'m-ok':taxaMesAtual>=0?'m-info':'m-bad'} dash-draggable dash-clickable" id="kpi-taxa-poupanca" draggable="true" onclick="if(podeExecutarCliqueDashboard(event)) nav('relatorios')" title="Ver evolução da taxa de poupança em Relatórios">
      <div class="metric-top"><div class="metric-label" title="Taxa de poupança">Taxa de poupança</div><div class="metric-icon ${taxaMesAtual>=20?'mi-ok':taxaMesAtual>=0?'mi-info':'mi-bad'}"><i class="ti ti-coin"></i></div></div>
      <div class="metric-value valor-sensivel ${classeTaxaPoupanca(taxaMesAtual)}" title="${valTaxa}">${valTaxa}</div>
      <div class="metric-sub" title="${taxaMesAtual === null ? 'sem receita neste mês' : 'mês anterior: ' + fmtPct(taxaMesAnterior) + ' · ref.: 20%'}">${taxaMesAtual === null ? 'sem receita neste mês' : 'mês anterior: ' + fmtPct(taxaMesAnterior) + ' · ref.: 20%'}</div>
    </div>`;

  // Animação dos contadores com desaceleração easeOutExpo
  const elSaldo = document.getElementById('kpi-saldo-valor');
  if (elSaldo && saldoAnterior !== null) elSaldo.dataset.valorRaw = String(saldoAnterior);
  const elPat = document.getElementById('kpi-patrimonio-valor');
  if (elPat && patAnterior !== null) elPat.dataset.valorRaw = String(patAnterior);

  animarNumero('kpi-saldo-valor', saldoDisponivel, 600);
  animarNumero('kpi-patrimonio-valor', patrimonioTotal, 600);

  aplicarLayoutDashboard();
  inicializarDragDropDashboard();

  // SMART INSIGHTS DINÂMICOS
  const insights = [];
  const hojeISO = hojeLocalISO();
  const em3DiasISO = hojeLocalISO(3);
  const listaCartoes = (STATE.cartoes && STATE.cartoes.length) ? STATE.cartoes : (STATE.contas || []).filter(c => c.tipo === 'cartao');
  listaCartoes.forEach(cartao => {
    // Agrupa todos os lançamentos sem faturaPaga === true deste cartão por fatura (ano-mes)
    const pendentes = (STATE.lancamentos || []).filter(l => l.conta === cartao.nome && l.tipo === 'despesa' && !ehLancamentoPagamentoFatura(l) && l.faturaPaga !== true);
    const porFatura = {};
    pendentes.forEach(l => {
      const comp = calcularCompetenciaLancamentoCartao(l, cartao);
      const chave = `${comp.ano}-${String(comp.mes).padStart(2, '0')}`;
      if (!porFatura[chave]) porFatura[chave] = { ano: comp.ano, mes: comp.mes, total: 0 };
      porFatura[chave].total += l.valor;
    });

    Object.values(porFatura).forEach(fat => {
      const venc = calcularVencimentoFatura(fat.ano, fat.mes, cartao.diaFechamento, cartao.diaVencimento);
      if (fat.total > 0 && venc <= em3DiasISO) {
        const [va, vm, vd] = venc.split('-');
        const ehVencida = venc < hojeISO;
        insights.push({
          tipo: 'warn', icone: 'ti-credit-card',
          titulo: ehVencida ? `Fatura ${cartao.nome} vencida (${vd}/${vm})` : `Fatura ${cartao.nome} vence em breve (${vd}/${vm})`,
          texto: `Há ${toBRL(fat.total)} em aberto na fatura de ${vd}/${vm}. Lembre-se de quitar para evitar encargos.`,
          filtros: { conta: cartao.nome, mes: `${fat.ano}-${String(fat.mes).padStart(2, '0')}`, status: 'pendente', modoFiltroMes: 'fatura' }
        });
      }
    });
  });
  const vencendoGeral = STATE.lancamentos.filter(l => !estaPago(l) && l.tipo === 'despesa' && !ehLancamentoCartao(l) && l.data && l.data <= em3DiasISO);
  if (!insights.length && vencendoGeral.length > 0) {
    const somaVenc = vencendoGeral.reduce((s, l) => s + l.valor, 0);
    insights.push({
      tipo: 'warn', icone: 'ti-bell-ringing',
      titulo: `${vencendoGeral.length} conta(s) vencidas ou vencendo em até 3 dias`,
      texto: `Totalizando ${toBRL(somaVenc)} pendentes de pagamento no curto prazo.`,
      filtros: { status: 'pendente', tipo: 'despesa', mes: '' }
    });
  }
  if (taxaMesAtual !== null && taxaMesAtual >= 20) {
    insights.push({
      tipo: 'ok', icone: 'ti-Sparkles',
      titulo: `Excelente! Taxa de poupança em ${fmtPct(taxaMesAtual)}`,
      texto: `Você superou a meta recomendada de 20% neste mês, poupando ${toBRL(resultadoMes)}.`,
      filtros: { mes: mesAtual, tipo: 'todos', modoFiltroMes: 'fatura' }
    });
  } else if (!(STATE.config && STATE.config.modoViagem && STATE.config.modoViagem.ativo) && receitasMes > 0 && despesasMes > receitasMes) {
    insights.push({
      tipo: 'bad', icone: 'ti-alert-triangle',
      titulo: `Alerta: Despesas superaram as receitas no mês`,
      texto: `Os gastos deste mês estão ${toBRL(despesasMes - receitasMes)} acima das entradas registradas.`,
      filtros: { mes: mesAtual, tipo: 'despesa', modoFiltroMes: 'fatura' }
    });
  } else if (!(STATE.config && STATE.config.modoViagem && STATE.config.modoViagem.ativo) && despesasMes > 0) {
    const mesPassadoKey = mesesDoisUltimos[0];
    const despMesPassado = STATE.lancamentos
      .filter(l => !isLancamentoTransferencia(l) && l.tipo === 'despesa' && (l.data || '').slice(0, 7) === mesPassadoKey)
      .reduce((s, l) => s + l.valor, 0);
    if (despMesPassado > 0 && despesasMes > despMesPassado * 1.15) {
      const altaPct = (((despesasMes - despMesPassado) / despMesPassado) * 100).toFixed(0);
      insights.push({
        tipo: 'info', icone: 'ti-trending-up',
        titulo: `Gastos ${altaPct}% maiores que no mês anterior`,
        texto: `Neste mês você já registrou ${toBRL(despesasMes)} em despesas contra ${toBRL(despMesPassado)} no mês passado.`,
        filtros: { mes: mesAtual, tipo: 'despesa', modoFiltroMes: 'fatura' }
      });
    }
  }
  const contInsights = document.getElementById('dash-insights');
  if (contInsights) {
    const exibidos = insights.slice(0, 2);
    contInsights.style.display = exibidos.length ? 'grid' : 'none';
    window._dashInsightsFiltros = exibidos.map(ins => ins.filtros || null);
    contInsights.innerHTML = exibidos.map((ins, idxIns) => `
      <div class="insight-card ins-${escHtml(ins.tipo)} dash-clickable" onclick="if(podeExecutarCliqueDashboard(event) && window._dashInsightsFiltros && window._dashInsightsFiltros[${idxIns}]) navegarParaLancamentos(window._dashInsightsFiltros[${idxIns}])" title="Ver lançamentos relacionados">
        <div class="insight-icon"><i class="ti ${escHtml(ins.icone.toLowerCase())}"></i></div>
        <div class="insight-body">
          <div class="insight-title">${escHtml(ins.titulo)}</div>
          <div class="insight-text">${escHtml(ins.texto)}</div>
        </div>
      </div>`).join('');
  }

  const meses = ultimosMeses(6);
  const somaPorMes = {};
  meses.forEach(m => somaPorMes[m] = { receita: 0, despesa: 0 });
  STATE.lancamentos.forEach(l => {
    if (isLancamentoTransferencia(l)) return;
    const m = mesCompetenciaLancamento(l);
    if (somaPorMes[m]) somaPorMes[m][l.tipo] += l.valor;
  });
  const nomesMes = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };
  const labelsDash = meses.map(m => { const [ano, mes] = m.split('-'); return `${nomesMes[mes]}/${ano.slice(2)}`; });

  if (typeof Chart !== 'undefined') {
    destruirChart('dash');
    const ctxDash = document.getElementById('dash-chart').getContext('2d');
    const gradReceitas = criarGradienteLinearChart(ctxDash, cssVar('--good'), 0.95, 0.28, 220);
    const gradDespesas = criarGradienteLinearChart(ctxDash, cssVar('--bad'), 0.95, 0.28, 220);
    CHARTS.dash = new Chart(ctxDash, {
      type: 'bar',
      data: {
        labels: labelsDash,
        datasets: [
          {
            label: 'Receitas',
            data: meses.map(m => somaPorMes[m].receita),
            backgroundColor: gradReceitas,
            hoverBackgroundColor: cssVar('--good'),
            borderRadius: 6,
            maxBarThickness: 32
          },
          {
            label: 'Despesas',
            data: meses.map(m => somaPorMes[m].despesa),
            backgroundColor: gradDespesas,
            hoverBackgroundColor: cssVar('--bad'),
            borderRadius: 6,
            maxBarThickness: 32
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onHover: (event, elements) => {
          const alvo = event && event.native && event.native.target;
          if (alvo) alvo.style.cursor = (elements && elements.length) ? 'pointer' : 'default';
        },
        onClick: (event, elements) => {
          if (!podeExecutarCliqueDashboard() || !elements || !elements.length) return;
          const { index, datasetIndex } = elements[0];
          const mesClicado = meses[index];
          if (!mesClicado) return;
          const tipoClicado = datasetIndex === 0 ? 'receita' : 'despesa';
          navegarParaLancamentos({ mes: mesClicado, tipo: tipoClicado, modoFiltroMes: 'fatura' });
        },
        plugins: {
          legend: { labels: { color: cssVar('--text2'), font: { family: cssVar('--font'), size: 12 } } },
          tooltip: obterTooltipPremiumChart({ label: (ctx) => ` ${ctx.dataset.label}: ${toBRL(ctx.parsed.y)}` })
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: cssVar('--text3') } },
          y: { grid: { color: cssVar('--border') }, ticks: { color: cssVar('--text3'), callback: (v) => toBRL(v) } }
        }
      }
    });
  }

  const ultimos = [...STATE.lancamentos]
    .filter(l => (l.data || '') <= hojeLocalISO())
    .sort((a,b) => (b.data||'').localeCompare(a.data||''))
    .slice(0,8);
  document.getElementById('dash-ultimos').innerHTML = ultimos.length ? ultimos.map(linhaLancamento).join('') :
    `<tr><td colspan="6" style="text-align:center;color:var(--text3);padding:2rem 0">Nenhum lançamento ainda.</td></tr>`;

  const pendentes = STATE.lancamentos.filter(l => !estaPago(l)).sort((a,b) => (a.data||'').localeCompare(b.data||''));
  const cardPendentes = document.getElementById('dash-pendentes-card');
  if (pendentes.length) {
    cardPendentes.style.display = '';
    const totalPendente = pendentes.reduce((s,l) => s + (l.tipo === 'despesa' ? l.valor : -l.valor), 0);
    document.getElementById('dash-pendentes-total').textContent = `em aberto: ${toBRL(totalPendente)}`;
    document.getElementById('dash-pendentes-list').innerHTML = pendentes.slice(0,8).map(l => {
      const [a,m,d] = (l.data||'').split('-');
      const dataFmt = a ? `${d}/${m}/${a}` : '-';
      const ehCartao = ehLancamentoCartao(l);
      const compPend = ehCartao ? calcularCompetenciaLancamentoCartao(l) : null;
      const mesPendDrill = ehCartao && compPend
        ? `${compPend.ano}-${String(compPend.mes).padStart(2, '0')}`
        : String(l.data || '').slice(0, 7);
      const modoPendDrill = ehCartao ? 'fatura' : 'data';
      const btnAcaoHTML = ehCartao
        ? `<button type="button" class="btn btn-sm btn-primary btn-pagar-fatura" onclick="event.stopPropagation()" data-cartao-id="${escHtml(l.conta)}" ${compPend ? `data-mes="${compPend.mes}" data-ano="${compPend.ano}"` : ''}><i class="ti ti-cash-banknote"></i> Pagar Fatura</button>`
        : `<button type="button" class="btn btn-sm" onclick="event.stopPropagation(); togglePagamento('${l.id}')"><i class="ti ti-check"></i> Marcar como paga</button>`;
      return `<div class="pendente-row dash-clickable" data-drill-conta="${escHtml(l.conta || '')}" data-drill-mes="${escHtml(mesPendDrill)}" data-drill-modo="${modoPendDrill}" onclick="if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ conta: this.dataset.drillConta, mes: this.dataset.drillMes, status: 'pendente', modoFiltroMes: this.dataset.drillModo })" title="Ver lançamentos pendentes relacionados">
        <div class="pendente-info">
          <div class="pendente-desc">${escHtml(l.descricao || '-')}${badgeParcelaHTML(l)}</div>
          <div class="pendente-meta">${dataFmt} · ${escHtml(l.categoria || '-')}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <div class="pendente-valor ${l.tipo==='receita'?'mv-ok':'mv-bad'}">${l.tipo==='receita'?'+':'-'} ${toBRL(l.valor)}</div>
          ${btnAcaoHTML}
        </div>
      </div>`;
    }).join('') + (pendentes.length > 8 ? `<div class="help-text dash-clickable" style="margin-top:.5rem;padding:4px 6px;border-radius:6px" onclick="if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ status: 'pendente', mes: '' })" title="Ver todos os lançamentos pendentes">+ ${pendentes.length - 8} outras pendências. Clique para ver todas em Lançamentos →</div>` : '');
  } else {
    cardPendentes.style.display = 'none';
  }

  const {
    saldos,
    contasBancarias,
    nomesContas,
    totalContasBancarias: totalSaldosBancos
  } = calcularResumoSaldosContasBancarias();
  const cartoesDash = (STATE.contas || []).filter(c => c && c.tipo === 'cartao');

  const cardContasTopo = document.getElementById('dash-contas-resumo-topo');
  if (cardContasTopo) {
    const totalContas = nomesContas.length;
    const totalCart = cartoesDash.length;
    if (totalContas && totalCart) {
      cardContasTopo.textContent = `${totalContas} conta(s) · ${totalCart} cartão(ões)`;
    } else if (totalCart) {
      cardContasTopo.textContent = `${totalCart} cartão(ões)`;
    } else if (totalContas) {
      cardContasTopo.textContent = `${totalContas} conta(s)`;
    } else {
      cardContasTopo.textContent = '';
    }
  }

  const containerSaldoContas = document.getElementById('dash-saldo-contas');
  if (containerSaldoContas) {
    if (!nomesContas.length && !cartoesDash.length) {
      containerSaldoContas.innerHTML = `<p class="help-text" style="padding:.5rem 0">Nenhuma conta ou cartão cadastrado ainda.</p>`;
    } else {
      let html = '';

      const hojeDashISO = hojeLocalISO();

      if (nomesContas.length) {
        if (cartoesDash.length) {
          html += `
            <div class="dash-contas-secao">
              <div class="dash-contas-secao-titulo"><i class="ti ti-building-bank"></i> Contas Bancárias</div>
              <div class="dash-contas-secao-total ${totalSaldosBancos >= 0 ? 'mv-ok' : 'mv-bad'}">${toBRL(totalSaldosBancos)}</div>
            </div>`;
        }
        html += nomesContas.map(nome => {
          const saldo = saldos[nome] || 0;
          return `
            <div class="pendente-row dash-conta-row dash-clickable" data-drill-conta="${escHtml(nome)}" onclick="if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ conta: this.dataset.drillConta, mes: '' })" title="Ver todos os lançamentos da conta ${escHtml(nome)}">
              <div class="pendente-info">
                <div class="pendente-desc">
                  <i class="ti ti-building-bank" style="font-size:13px;color:var(--text3);margin-right:5px"></i>${escHtml(nome)}
                </div>
              </div>
              <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
                <div class="pendente-valor ${saldo >= 0 ? 'mv-ok' : 'mv-bad'}">${toBRL(saldo)}</div>
                <i class="ti ti-chevron-right dash-drill-arrow" aria-hidden="true"></i>
              </div>
            </div>`;
        }).join('');
      }

      if (cartoesDash.length) {
        html += `
          <div class="dash-contas-secao" style="${nomesContas.length ? 'margin-top:14px;' : ''}">
            <div class="dash-contas-secao-titulo"><i class="ti ti-credit-card"></i> Cartões de Crédito</div>
          </div>`;

        html += cartoesDash.map(cartao => {
          const compAtual = obterCompetenciaFaturaDashboard(cartao.nome, cartao.diaFechamento || 1, hojeDashISO);
          const itensFatura = lancamentosDaFatura(cartao.nome, compAtual.ano, compAtual.mes);
          const totalBrutoFatura = Math.round(itensFatura.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
          const totalFatura = Math.round(
            itensFatura
              .filter(l => l.faturaPaga !== true)
              .reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100
          ) / 100;
          const faturaSemSaldo = totalFatura === 0;
          const faturaJaPaga = itensFatura.length > 0 && totalFatura <= 0;
          const limite = Number(cartao.limite || cartao.limiteTotal) || 0;
          const temLimite = limite > 0;
          const pendentesCartao = STATE.lancamentos.filter(
            l => l.conta === cartao.nome && l.tipo === 'despesa' && !ehLancamentoPagamentoFatura(l) && l.faturaPaga !== true
          );
          const totalPendente = Math.round(pendentesCartao.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
          const disponivel = temLimite ? Math.max(0, Math.round((limite - totalPendente) * 100) / 100) : 0;
          const pctUsado = (temLimite && limite > 0) ? Math.min(100, Math.max(0, (totalPendente / limite) * 100)) : 0;

          const venc = calcularVencimentoFatura(compAtual.ano, compAtual.mes, cartao.diaFechamento || 1, cartao.diaVencimento || 10);
          const [va, vm, vd] = (venc || '').split('-');
          const vencFmt = vd && vm ? `${vd}/${vm}` : (cartao.diaVencimento ? `dia ${cartao.diaVencimento}` : '');

          const corBarra = pctUsado >= 90 ? 'critico' : (pctUsado >= 70 ? 'aviso' : 'normal');
          const temMaisPendencias = totalPendente > totalFatura;
          const idCartaoAttr = escHtml(cartao.id || cartao.nome);

          const mesFaturaISO = `${compAtual.ano}-${String(compAtual.mes).padStart(2, '0')}`;
          const tooltipInfo = `Ver lançamentos da fatura ${String(compAtual.mes).padStart(2, '0')}/${compAtual.ano} · ${cartao.nome}: ${toBRL(totalFatura)}${faturaJaPaga ? ` (Fatura Paga: ${toBRL(totalBrutoFatura)})` : ''}${temLimite ? ` | Limite disponível: ${toBRL(disponivel)} (Total: ${toBRL(limite)} - ${pctUsado.toFixed(0)}% utilizado)` : ''}${temMaisPendencias ? ` | Total comprometido a pagar: ${toBRL(totalPendente)}` : ''}`;

          return `
            <div class="pendente-row dash-cartao-row dash-clickable" data-drill-conta="${escHtml(cartao.nome)}" data-drill-mes="${escHtml(mesFaturaISO)}" onclick="if(!event.target.closest('.btn-pagar-fatura') && podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ conta: this.dataset.drillConta, mes: this.dataset.drillMes, modoFiltroMes: 'fatura' })" title="${escHtml(tooltipInfo)}">
              <div class="pendente-info">
                <div class="pendente-desc" style="display:flex;align-items:center;gap:5px;flex-wrap:wrap">
                  <span><i class="ti ti-credit-card" style="font-size:13px;color:${escHtml(cartao.cor || 'var(--accent)')};margin-right:5px"></i>${escHtml(cartao.nome)}</span>
                  ${faturaJaPaga ? `<span class="badge badge-fatura-paga" style="font-size:9.5px;padding:1px 6px"><i class="ti ti-circle-check"></i> Fatura Paga</span>` : ''}
                </div>
                <div class="pendente-meta">
                  <span>Fatura ${String(compAtual.mes).padStart(2, '0')}/${String(compAtual.ano).slice(2)}</span>
                  ${vencFmt ? `<span>·</span><span>Vence ${vencFmt}</span>` : ''}
                  ${cartao.diaFechamento ? `<span>·</span><span>Fecha dia ${cartao.diaFechamento}</span>` : ''}
                </div>
                <div style="margin-top:6px">
                  <button type="button" class="btn btn-sm btn-primary btn-pagar-fatura" onclick="event.stopPropagation()" data-cartao-id="${idCartaoAttr}" data-mes="${compAtual.mes}" data-ano="${compAtual.ano}" style="padding:3px 10px;font-size:11px" ${faturaSemSaldo ? 'disabled' : ''}>
                    <i class="ti ${faturaSemSaldo ? 'ti-circle-check' : 'ti-cash-banknote'}"></i> ${faturaSemSaldo ? 'Fatura Paga' : 'Pagar Fatura'}
                  </button>
                </div>
              </div>
              <div class="dash-cartao-col-valor">
                <div class="pendente-valor dash-cartao-val-linha">
                  <span class="${totalFatura > 0 ? 'mv-bad' : 'mv-ok'} valor-sensivel" title="Fatura atual">${toBRL(totalFatura)}</span>
                  ${temLimite ? `
                    <span class="dash-limite-sep" style="margin:0 2px">·</span>
                    <span style="color:var(--good);font-weight:700" title="Limite disponível"><span style="font-size:11px;font-weight:500;color:var(--text3);margin-right:2px">disp.</span><span class="valor-sensivel">${toBRL(disponivel)}</span></span>
                  ` : ''}
                </div>
                ${temLimite ? `
                  <div class="dash-cartao-meta-linha">
                    <span class="pendente-meta" style="font-size:10.5px">limite total <span class="valor-sensivel" style="color:var(--text2)">${toBRL(limite)}</span> · ${pctUsado.toFixed(0)}% utilizado</span>
                    <div class="dash-cartao-mini-bar" title="${pctUsado.toFixed(0)}% do limite utilizado">
                      <div class="dash-cartao-mini-bar-fill ${corBarra}" style="width:${Math.min(100, Math.max(0, pctUsado))}%"></div>
                    </div>
                  </div>` : `
                  <div class="pendente-meta" style="text-align:right;font-size:10px;color:var(--text3)">fatura atual · sem limite cadastrado</div>
                `}
              </div>
            </div>`;
        }).join('');
      }

      containerSaldoContas.innerHTML = html;
    }
  }

  // WIDGETS DE GESTÃO PATRIMONIAL & SEGURANÇA
  renderWidgetReembolsos();
  renderWidgetTop3Categorias();
  renderAntiMetasWidget();
  inicializarEfeito3DCartoes();
  alternarEstadoCarregamento(false);
}

/* ================= LANÇAMENTOS ================= */
let modoFiltroMes = 'data';

function obterModoFiltroMesLancamentos() {
  const inp = typeof document !== 'undefined' ? document.getElementById('f-modo-mes') : null;
  if (inp && (inp.value === 'data' || inp.value === 'fatura')) {
    modoFiltroMes = inp.value;
    return modoFiltroMes;
  }
  return modoFiltroMes === 'fatura' ? 'fatura' : 'data';
}

function mesDoLancamentoNaAbaLancamentos(l, modo) {
  if (!l) return '';
  const criterio = (modo === 'fatura' || modo === 'data') ? modo : obterModoFiltroMesLancamentos();
  if (criterio === 'fatura') return mesCompetenciaLancamento(l);
  return String(l.data || '').slice(0, 7);
}

function atualizarVisibilidadeModoFiltroMes() {
  const grupo = typeof document !== 'undefined' ? document.getElementById('filtro-modo-mes-group') : null;
  if (!grupo) return;
  const fMes = document.getElementById('f-mes');
  const emCalendario = Boolean(STATE.config && STATE.config.viewModo === 'calendario');
  const temMesAtivo = Boolean((fMes && fMes.value) || emCalendario);
  grupo.style.display = temMesAtivo ? 'inline-flex' : 'none';
  const criterioAtual = obterModoFiltroMesLancamentos();
  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('[data-chip-target="f-modo-mes"]').forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-chip-val') === criterioAtual);
    });
  }
}

function selecionarModoFiltroMes(modo, btnEl) {
  modoFiltroMes = modo === 'fatura' ? 'fatura' : 'data';
  const inp = document.getElementById('f-modo-mes');
  if (inp) inp.value = modoFiltroMes;
  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('[data-chip-target="f-modo-mes"]').forEach((b) => {
      const ativo = btnEl ? (b === btnEl) : (b.getAttribute('data-chip-val') === modoFiltroMes);
      b.classList.toggle('active', ativo);
    });
  }
  renderLancamentos({ pularFiltros: true });
}

let _drilldownFiltroAtivo = false;

function formatarMesLabelCurto(mesISO) {
  if (!mesISO || !/^\d{4}-\d{2}$/.test(String(mesISO))) return String(mesISO || '');
  const [ano, mm] = String(mesISO).split('-');
  const nomes = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };
  return `${nomes[mm] || mm}/${ano}`;
}

function sincronizarChipsFiltroPorValor(inputId, valor) {
  const inp = document.getElementById(inputId);
  if (inp) inp.value = valor;
  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll(`[data-chip-target="${inputId}"]`).forEach((b) => {
      b.classList.toggle('active', b.getAttribute('data-chip-val') === valor);
    });
  }
}

function garantirOpcaoSelect(selectEl, valor, rotulo) {
  if (!selectEl || !valor) return;
  const opts = Array.from(selectEl.options || []);
  const existe = opts.some(o => o && o.value === valor);
  if (!existe && typeof document.createElement === 'function' && typeof selectEl.appendChild === 'function') {
    const opt = document.createElement('option');
    opt.value = valor;
    opt.textContent = rotulo || valor;
    selectEl.appendChild(opt);
  }
  selectEl.value = valor;
}

function resolverContaParaSelectFiltro(contaRef) {
  const bruto = String(contaRef || '').trim();
  if (!bruto) return '';
  const brutoLower = bruto.toLowerCase();
  const todas = [...(STATE.contas || []), ...(STATE.cartoes || [])];
  const porIdOuNome = todas.find(c =>
    c && (
      String(c.id || '').trim() === bruto ||
      String(c.nome || '').trim().toLowerCase() === brutoLower
    )
  );
  return porIdOuNome && porIdOuNome.nome ? String(porIdOuNome.nome).trim() : bruto;
}

function resolverCategoriaParaSelectFiltro(catRef, selectEl) {
  const bruto = String(catRef || '').trim();
  if (!bruto) return '';
  const normalizada = bruto.replace(/\s*›\s*/g, ' -> ');
  const normLower = normalizada.toLowerCase();
  const opts = Array.from((selectEl && selectEl.options) || []);
  const matchExato = opts.find(o => o && String(o.value || '').toLowerCase() === normLower);
  if (matchExato) return matchExato.value;
  const parsed = extrairMacroESubcategoria(normalizada);
  const matchMacro = opts.find(o => o && String(o.value || '').toLowerCase() === parsed.macro.toLowerCase());
  if (matchMacro) return matchMacro.value;
  return normalizada;
}

function atualizarBannerDrillDownLancamentos() {
  const banner = document.getElementById('drilldown-filtro-banner');
  if (!banner) return;
  const mes = (document.getElementById('f-mes') && document.getElementById('f-mes').value) || '';
  const modoMes = obterModoFiltroMesLancamentos();
  const tipo = (document.getElementById('f-tipo') && document.getElementById('f-tipo').value) || '';
  const status = (document.getElementById('f-status') && document.getElementById('f-status').value) || '';
  const conta = (document.getElementById('f-conta') && document.getElementById('f-conta').value) || '';
  const cat = (document.getElementById('f-categoria') && document.getElementById('f-categoria').value) || '';
  const tag = (document.getElementById('f-tag') && document.getElementById('f-tag').value) || '';
  const busca = (document.getElementById('f-busca') && document.getElementById('f-busca').value.trim()) || '';

  const partes = [];
  if (tipo === 'receita') partes.push('Receitas');
  else if (tipo === 'despesa') partes.push('Despesas');
  else if (tipo === 'transferencia') partes.push('Transferências');
  if (status === 'pago') partes.push('Pagos');
  else if (status === 'pendente') partes.push('Pendentes');
  if (conta) partes.push(conta);
  if (cat) partes.push(formatarCategoriaExibicao(cat));
  if (tag) partes.push(`#${tag}`);
  if (busca) partes.push(`"${busca}"`);
  if (mes) partes.push(`${formatarMesLabelCurto(mes)} (${modoMes === 'fatura' ? 'Por Fatura' : 'Por Data'})`);

  if (!_drilldownFiltroAtivo || partes.length === 0) {
    _drilldownFiltroAtivo = false;
    banner.style.display = 'none';
    banner.innerHTML = '';
    return;
  }

  banner.style.display = 'flex';
  banner.innerHTML = `
    <div class="drilldown-banner-info">
      <i class="ti ti-filter"></i>
      <span><strong>Filtro ativo:</strong> ${partes.map(p => `<span class="drilldown-chip">${escHtml(p)}</span>`).join('<span class="drilldown-sep">·</span>')}</span>
    </div>
    <button type="button" class="btn btn-sm drilldown-clear-btn" onclick="limparFiltrosLancamentos()">
      <i class="ti ti-filter-off"></i> Limpar filtros
    </button>
  `;
}

function limparFiltrosLancamentos() {
  _drilldownFiltroAtivo = false;
  modoFiltroMes = 'data';
  sincronizarChipsFiltroPorValor('f-modo-mes', 'data');
  sincronizarChipsFiltroPorValor('f-tipo', '');
  sincronizarChipsFiltroPorValor('f-status', '');
  const fMes = document.getElementById('f-mes');
  const fConta = document.getElementById('f-conta');
  const fCat = document.getElementById('f-categoria');
  const fTag = document.getElementById('f-tag');
  const fBusca = document.getElementById('f-busca');
  if (fMes) fMes.value = '';
  if (fConta) fConta.value = '';
  if (fCat) fCat.value = '';
  if (fTag) fTag.value = '';
  if (fBusca) fBusca.value = '';
  renderLancamentos();
}

function navegarParaLancamentos(filtros = {}) {
  const f = (filtros && typeof filtros === 'object') ? filtros : {};

  // 1. Garante que as opções dos selects existam e reseta todos os filtros para o estado limpo
  popularFiltros();
  modoFiltroMes = 'data';
  sincronizarChipsFiltroPorValor('f-modo-mes', 'data');
  sincronizarChipsFiltroPorValor('f-tipo', '');
  sincronizarChipsFiltroPorValor('f-status', '');

  const fMes = document.getElementById('f-mes');
  const fConta = document.getElementById('f-conta');
  const fCat = document.getElementById('f-categoria');
  const fTag = document.getElementById('f-tag');
  const fBusca = document.getElementById('f-busca');
  if (fMes) fMes.value = '';
  if (fConta) fConta.value = '';
  if (fCat) fCat.value = '';
  if (fTag) fTag.value = '';
  if (fBusca) fBusca.value = '';

  if (STATE.config && STATE.config.viewModo === 'calendario') {
    STATE.config.viewModo = 'lista';
  }

  // 2. Aplica somente os campos informados
  const mesNorm = (typeof f.mes === 'string' && /^\d{4}-\d{2}$/.test(f.mes.trim())) ? f.mes.trim() : '';
  if (fMes) {
    if (mesNorm) garantirOpcaoSelect(fMes, mesNorm, formatarMesLabelCurto(mesNorm));
    else fMes.value = '';
  }

  const modoMesAplicado = f.modoFiltroMes === 'fatura' ? 'fatura' : 'data';
  modoFiltroMes = modoMesAplicado;
  sincronizarChipsFiltroPorValor('f-modo-mes', modoMesAplicado);

  const tipoBruto = String(f.tipo || '').trim().toLowerCase();
  const tipoAplicado = ['receita', 'despesa', 'transferencia'].includes(tipoBruto) ? tipoBruto : '';
  sincronizarChipsFiltroPorValor('f-tipo', tipoAplicado);

  const statusBruto = String(f.status || '').trim().toLowerCase();
  const statusAplicado = ['pago', 'pendente'].includes(statusBruto) ? statusBruto : '';
  sincronizarChipsFiltroPorValor('f-status', statusAplicado);

  const contaAplicada = resolverContaParaSelectFiltro(f.conta);
  if (fConta && contaAplicada) {
    garantirOpcaoSelect(fConta, contaAplicada, contaAplicada);
  }

  const catAplicada = resolverCategoriaParaSelectFiltro(f.categoria, fCat);
  if (fCat && catAplicada) {
    garantirOpcaoSelect(fCat, catAplicada, formatarCategoriaExibicao(catAplicada));
  }

  const tagAplicada = String(f.tag || '').trim().replace(/^#+/, '');
  if (fTag && tagAplicada) {
    garantirOpcaoSelect(fTag, tagAplicada, `#${tagAplicada}`);
  }

  const buscaAplicada = String(f.busca || '').trim();
  if (fBusca && buscaAplicada) {
    fBusca.value = buscaAplicada;
  }

  // 3. Ativa banner discreto se houver algum filtro aplicado
  _drilldownFiltroAtivo = Boolean(
    mesNorm || tipoAplicado || statusAplicado || contaAplicada || catAplicada || tagAplicada || buscaAplicada
  );

  // 4. Troca para a aba Lançamentos, renderiza e rola suavemente ao topo
  executarTrocaPaginaInterna('lancamentos', { pularRenderLancamentos: true });
  renderLancamentos({ pularFiltros: true });

  const contentEl = typeof document.querySelector === 'function' ? document.querySelector('.content') : null;
  if (contentEl && typeof contentEl.scrollTo === 'function') {
    contentEl.scrollTo({ top: 0, behavior: 'smooth' });
  }
  if (typeof window !== 'undefined' && typeof window.scrollTo === 'function') {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function badgeFaturaCompetenciaHTML(l) {
  if (!l || !ehLancamentoCartao(l) || ehLancamentoPagamentoFatura(l)) return '';
  const mesData = String(l.data || '').slice(0, 7);
  const mesFat = mesCompetenciaLancamento(l);
  if (!mesData || !mesFat || mesFat === mesData) return '';
  const [anoFat, mmFat] = mesFat.split('-');
  if (!anoFat || !mmFat) return '';
  const nomesMesCurto = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };
  const rotulo = `Fat. ${nomesMesCurto[mmFat] || mmFat}/${anoFat.slice(-2)}`;
  const [anoData, mmData] = mesData.split('-');
  const titulo = `Compra de ${nomesMesCurto[mmData] || mmData}/${anoData} cobrada na fatura de ${nomesMesCurto[mmFat] || mmFat}/${anoFat}`;
  return `<span class="badge-fatura-comp" title="${escHtml(titulo)}">${escHtml(rotulo)}</span>`;
}

function popularFiltros() {
  const mesesSet = new Set();
  (STATE.lancamentos || []).forEach(l => {
    if (!l) return;
    const mData = String(l.data || '').slice(0, 7);
    const mFat = mesCompetenciaLancamento(l);
    if (mData) mesesSet.add(mData);
    if (mFat) mesesSet.add(mFat);
  });
  const nomesMes = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };
  const fMes = document.getElementById('f-mes');
  const atual = fMes ? fMes.value : '';
  if (atual && /^\d{4}-\d{2}$/.test(atual)) mesesSet.add(atual);
  const meses = [...mesesSet].filter(Boolean).sort().reverse();
  if (fMes) {
    fMes.innerHTML = '<option value="">Todos os meses</option>' + meses.map(m => {
      const [a,mm] = m.split('-'); return `<option value="${m}">${nomesMes[mm]||mm}/${a}</option>`;
    }).join('');
    fMes.value = atual;
  }
  const fCat = document.getElementById('f-categoria');
  const catAtual = fCat.value;
  normalizarHierarquiaCategorias();
  const temAClassificar = (STATE.lancamentos || []).some(l => l && !ehLancamentoProtegidoAutoCat(l) && normalizarTextoSemAcento(l.categoria) === 'a classificar');
  const optAClassificar = temAClassificar ? `<option value="${CATEGORIA_A_CLASSIFICAR}"${catAtual === CATEGORIA_A_CLASSIFICAR ? ' selected' : ''}>📥 A Classificar</option>` : '';
  fCat.innerHTML = '<option value="">Todas as categorias</option>' + optAClassificar + construirOptionsCategoriasHTML('', catAtual);
  fCat.value = [...fCat.options].some(o => o.value === catAtual) ? catAtual : '';
  const fTag = document.getElementById('f-tag');
  const tagAtual = fTag.value;
  fTag.innerHTML = '<option value="">Todas as tags</option>' + todasAsTags().map(t => `<option value="${escHtml(t)}">#${escHtml(t)}</option>`).join('');
  fTag.value = [...fTag.options].some(o => o.value === tagAtual) ? tagAtual : '';

  // Filtro de Conta / Cartão
  const fConta = document.getElementById('f-conta');
  if (fConta) {
    const contaAtual = fConta.value;
    const contas = (STATE.contas || []).map(c => c.nome);
    const cartoes = (STATE.cartoes || []).map(c => c.nome);
    const doLancamentos = (STATE.lancamentos || []).map(l => l.conta).filter(Boolean);
    const todasContas = [...new Set([...contas, ...cartoes, ...doLancamentos])].filter(Boolean).sort();
    fConta.innerHTML = '<option value="">Todas as contas/cartões</option>' + todasContas.map(c => `<option value="${escHtml(c)}">${escHtml(c)}</option>`).join('');
    fConta.value = [...fConta.options].some(o => o.value === contaAtual) ? contaAtual : '';
  }
}
function categoriaCorrespondeFiltro(catLanc, catFiltro) {
  if (!catFiltro) return true;
  if (catLanc === catFiltro) return true;
  if (catFiltro.includes(' -> ')) return catLanc === catFiltro;
  const parsed = extrairMacroESubcategoria(catLanc);
  return parsed.macro.toLowerCase() === catFiltro.toLowerCase();
}
function estaPago(l) {
  if (!l) return false;
  if (ehLancamentoPagamentoFatura(l)) {
    return l.pago !== false;
  }
  if (ehLancamentoCartao(l) && l.tipo === 'despesa') {
    return l.faturaPaga === true;
  }
  return l.pago !== false || l.status === 'Liquidado' || l.status === 'Pago/Efetivado';
}
function badgeStatusHTML(l, comClique) {
  const onclick = comClique ? ` onclick="togglePagamento('${l.id}')" title="Clique para alternar"` : '';
  if (ehLancamentoCartao(l) && l.tipo === 'despesa' && !ehLancamentoPagamentoFatura(l)) {
    const faturaQuitada = l.faturaPaga === true;
    if (faturaQuitada) {
      return `<span class="badge badge-pago badge-liquidado${comClique?' badge-click':''}"${onclick}><i class="ti ti-checks" style="font-size:11px;margin-right:2px"></i>Liquidado</span>`;
    }
    const tipTrans = l.status && l.status !== 'Pendente'
      ? `Transação: ${escHtml(l.status)} · Fatura Pendente`
      : 'Pendente de pagamento da fatura';
    return `<span class="badge badge-pendente${comClique?' badge-click':''}"${onclick} title="${tipTrans}">Pendente</span>`;
  }
  const pago = estaPago(l);
  if (pago && (l.ehPagamentoFatura || l.status === 'Pago/Efetivado')) {
    return `<span class="badge badge-pago badge-liquidado${comClique?' badge-click':''}"${onclick}><i class="ti ti-circle-check" style="font-size:11px;margin-right:2px"></i>Pago/Efetivado</span>`;
  }
  if (pago && l.status === 'Liquidado') {
    return `<span class="badge badge-pago badge-liquidado${comClique?' badge-click':''}"${onclick}><i class="ti ti-checks" style="font-size:11px;margin-right:2px"></i>Liquidado</span>`;
  }
  return `<span class="badge ${pago?'badge-pago':'badge-pendente'}${comClique?' badge-click':''}"${onclick}>${pago?'Pago':'Pendente'}</span>`;
}
function badgeParcelaHTML(l) {
  if (!l.parcelaTotal || l.parcelaTotal <= 1) return '';
  return `<span class="badge badge-parcela">${l.parcelaAtual}/${l.parcelaTotal}</span>`;
}
function badgeValorHTML(l) {
  if (isLancamentoTransferencia(l)) return `<span class="badge badge-transfer"><i class="ti ti-transfer" style="font-size:10px"></i> ${toBRL(l.valor)}</span>`;
  return `<span class="badge ${l.tipo==='receita'?'badge-receita':'badge-despesa'}">${l.tipo==='receita'?'+':'-'} ${toBRL(l.valor)}</span>`;
}
function comprovanteIconHTML(l) {
  let html = '';
  const temAnexo = l.comprovante || l.anexoNome || l.anexoPath;
  if (temAnexo) {
    const titulo = l.anexoNome ? `Anexo: ${l.anexoNome}${l.anexoPath ? ' (' + l.anexoPath + ')' : ''}` : 'Ver comprovante';
    html += ` <i class="ti ti-paperclip" style="cursor:pointer;color:var(--accent)" onclick="event.stopPropagation(); verComprovanteLancamento('${l.id}')" title="${titulo.replace(/"/g, '&quot;')}"></i>`;
  }
  if (l.garantiaFim) {
    const [ga, gm, gd] = l.garantiaFim.split('-');
    const dataGarFmt = ga ? `${gd}/${gm}/${ga}` : l.garantiaFim;
    const diasRest = Math.ceil((new Date(l.garantiaFim + 'T23:59:59').getTime() - Date.now()) / 86400000);
    const corGar = diasRest < 0 ? 'var(--bad)' : (diasRest <= 30 ? 'var(--amber)' : 'var(--good)');
    html += ` <i class="ti ti-shield-check" style="cursor:pointer;color:${corGar}" onclick="event.stopPropagation(); abrirModalGarantias()" title="Garantia até ${dataGarFmt}"></i>`;
  }
  if (l.conciliado === true) {
    html += ` <i class="ti ti-circle-check concil-check-badge" title="Conciliado com o extrato bancário"></i>`;
  }
  return html;
}
function linhaLancamento(l) {
  const [a,m,d] = (l.data||'').split('-');
  const dataFmt = a ? `${d}/${m}/${a}` : '-';
  const ehTransf = isLancamentoTransferencia(l);
  const onclickLinha = ehTransf
    ? `if(podeExecutarCliqueDashboard(event)) navegarParaLancamentos({ tipo: 'transferencia', mes: '${escHtml(String(l.data || '').slice(0, 7))}', conta: '${escHtml(String(l.conta || '').replace(/'/g, "\\'"))}' })`
    : `if(podeExecutarCliqueDashboard(event)) abrirModalLancamento('${l.id}')`;
  return `<tr data-id="${l.id}" class="card-lancamento dash-clickable" onclick="${onclickLinha}" title="${ehTransf ? 'Ver transferência em Lançamentos' : 'Abrir lançamento'}">
    <td>${dataFmt}</td>
    <td>${formatarDescricaoComHashtags(l.descricao)}${badgeParcelaHTML(l)}${badgesTagsHTML(l)}${comprovanteIconHTML(l)}</td>
    <td><span class="badge badge-cat">${escHtml(formatarCategoriaExibicao(l.categoria))}</span></td>
    <td>${escHtml(l.conta || '-')}${badgeFaturaCompetenciaHTML(l)}</td>
    <td>${badgeStatusHTML(l, false)}</td>
    <td style="text-align:right">${badgeValorHTML(l)}</td>
  </tr>`;
}
/* ================= TOGGLE VISUALIZAÇÃO DE LANÇAMENTOS & CALENDÁRIO ================= */
let calendarioMesRef = '';
async function alternarEstiloTabela() {
  if (!STATE.config) STATE.config = {};
  if (STATE.config.viewModo === 'calendario') STATE.config.viewModo = 'lista';
  STATE.config.viewEstilo = STATE.config.viewEstilo === 'cards' ? 'tabela' : 'cards';
  await salvarDados();
  renderLancamentos();
}
async function alternarModoCalendario() {
  if (!STATE.config) STATE.config = {};
  STATE.config.viewModo = STATE.config.viewModo === 'calendario' ? 'lista' : 'calendario';
  await salvarDados();
  renderLancamentos();
}
function navegarMesCalendario(delta) {
  const base = calendarioMesRef || document.getElementById('f-mes').value || hojeLocalISO().slice(0, 7);
  const [y, m] = base.split('-').map(Number);
  const dt = new Date(y, (m - 1) + delta, 1);
  calendarioMesRef = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
  const fMes = document.getElementById('f-mes');
  if ([...fMes.options].some(o => o.value === calendarioMesRef)) fMes.value = calendarioMesRef;
  renderLancamentos();
}
function renderCalendarioFinanceiro(listaFiltrada) {
  const cont = document.getElementById('view-calendario');
  if (!cont) return;
  const fMesVal = document.getElementById('f-mes').value;
  if (fMesVal) calendarioMesRef = fMesVal;
  if (!calendarioMesRef) calendarioMesRef = hojeLocalISO().slice(0, 7);
  const [ano, mes] = calendarioMesRef.split('-').map(Number);
  const nomesMesExtenso = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  const primeiroDiaSemana = new Date(ano, mes - 1, 1).getDay(); // 0 = Dom
  const totalDiasMes = new Date(ano, mes, 0).getDate();
  const hojeISO = hojeLocalISO();

  // Filtra lançamentos do mês de referência do calendário (respeitando modoFiltroMes e demais filtros ativos)
  const modoMes = obterModoFiltroMesLancamentos();
  const tipo = document.getElementById('f-tipo').value;
  const cat = document.getElementById('f-categoria').value;
  const status = document.getElementById('f-status').value;
  const busca = document.getElementById('f-busca').value.toLowerCase();
  const tagFiltro = document.getElementById('f-tag').value;
  const fContaCal = document.getElementById('f-conta');
  const contaFiltro = fContaCal ? fContaCal.value : '';
  const doMes = STATE.lancamentos.filter(l =>
    mesDoLancamentoNaAbaLancamentos(l, modoMes) === calendarioMesRef &&
    correspondeFiltroTipoLancamento(l, tipo) &&
    (!contaFiltro || l.conta === contaFiltro) &&
    categoriaCorrespondeFiltro(l.categoria, cat) &&
    (!status || (status === 'pago' ? estaPago(l) : !estaPago(l))) &&
    (!tagFiltro || lancamentoTemHashtag(l, tagFiltro)) &&
    (!busca || (l.descricao || '').toLowerCase().includes(busca) || (l.descricaoOriginal || '').toLowerCase().includes(busca))
  );

  const porDia = {};
  const foraDoMesCalendario = [];
  doMes.forEach(l => {
    const mesDataItem = String(l.data || '').slice(0, 7);
    if (mesDataItem !== calendarioMesRef) {
      foraDoMesCalendario.push(l);
      return;
    }
    const d = parseInt((l.data || '').slice(8, 10), 10);
    if (!d) return;
    if (!porDia[d]) porDia[d] = [];
    porDia[d].push(l);
  });

  let celulasHTML = '';
  for (let i = 0; i < primeiroDiaSemana; i++) {
    celulasHTML += `<div class="cal-cell cal-empty"></div>`;
  }
  for (let dia = 1; dia <= totalDiasMes; dia++) {
    const dataISO = `${calendarioMesRef}-${String(dia).padStart(2, '0')}`;
    const ehHoje = dataISO === hojeISO;
    const itens = porDia[dia] || [];
    const visiveis = itens.slice(0, 3);
    const ocultos = itens.length - visiveis.length;
    const pillsHTML = visiveis.map(l => {
      const classe = l.tipo === 'receita' ? 'rec' : 'desp';
      const sinal = l.tipo === 'receita' ? '+' : '-';
      const acao = isLancamentoTransferencia(l) ? '' : `onclick="abrirModalLancamento('${l.id}')"`;
      const fatMesTip = (ehLancamentoCartao(l) && !ehLancamentoPagamentoFatura(l) && mesCompetenciaLancamento(l) && mesCompetenciaLancamento(l) !== String(l.data || '').slice(0, 7))
        ? ` · Fatura ${mesCompetenciaLancamento(l).split('-').reverse().join('/')}`
        : '';
      return `<div class="cal-pill ${classe}" ${acao} title="${escHtml(l.descricao || '')} (${toBRL(l.valor)})${escHtml(fatMesTip)}">
        <span style="overflow:hidden;text-overflow:ellipsis">${escHtml(l.descricao || '-')}</span>
        <span>${sinal}${toBRL(l.valor)}</span>
      </div>`;
    }).join('');
    celulasHTML += `<div class="cal-cell${ehHoje ? ' cal-today' : ''}">
      <div class="cal-day-top">
        <span class="cal-day-num">${dia}</span>
        ${itens.length ? `<span style="font-size:10px;color:var(--text3)">${itens.length}x</span>` : ''}
      </div>
      <div class="cal-events">
        ${pillsHTML}
        ${ocultos > 0 ? `<div class="cal-more">+ ${ocultos} mais</div>` : ''}
      </div>
    </div>`;
  }

  let blocoExtrasFaturaHTML = '';
  if (modoMes === 'fatura' && foraDoMesCalendario.length > 0) {
    const totalExtras = foraDoMesCalendario.reduce((s, l) => s + (Number(l.valor) || 0), 0);
    const extrasPills = foraDoMesCalendario
      .sort((a, b) => String(b.data || '').localeCompare(String(a.data || '')))
      .map(l => {
        const [ea, em, ed] = String(l.data || '').split('-');
        const dtCurta = ea && em && ed ? `${ed}/${em}` : '-';
        const classe = l.tipo === 'receita' ? 'rec' : 'desp';
        const sinal = l.tipo === 'receita' ? '+' : '-';
        const acao = isLancamentoTransferencia(l) ? '' : `onclick="abrirModalLancamento('${l.id}')"`;
        return `<div class="cal-pill ${classe}" ${acao} title="Compra em ${dtCurta}/${ea || ''} · ${escHtml(l.descricao || '')} (${toBRL(l.valor)})">
          <span style="overflow:hidden;text-overflow:ellipsis">${escHtml(dtCurta)} · ${escHtml(l.descricao || '-')}</span>
          <span>${sinal}${toBRL(l.valor)}</span>
        </div>`;
      }).join('');
    blocoExtrasFaturaHTML = `
      <div class="cal-fatura-extras">
        <div class="cal-fatura-extras-head">
          <i class="ti ti-credit-card"></i>
          <span>Compras de outro mês nesta fatura (${foraDoMesCalendario.length}x · ${toBRL(totalExtras)})</span>
        </div>
        <div class="cal-fatura-extras-list">${extrasPills}</div>
      </div>`;
  }

  cont.innerHTML = `
    <div class="cal-header">
      <div style="display:flex;align-items:center;gap:8px">
        <button class="btn btn-sm" type="button" onclick="navegarMesCalendario(-1)" title="Mês anterior"><i class="ti ti-chevron-left"></i></button>
        <div class="cal-title">${nomesMesExtenso[mes - 1]} ${ano}</div>
        <button class="btn btn-sm" type="button" onclick="navegarMesCalendario(1)" title="Próximo mês"><i class="ti ti-chevron-right"></i></button>
      </div>
      <div style="display:flex;align-items:center;gap:12px;font-size:12px;color:var(--text3)">
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--good);margin-right:4px"></span>Receitas</span>
        <span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--bad);margin-right:4px"></span>Despesas</span>
      </div>
    </div>
    ${blocoExtrasFaturaHTML}
    <div class="cal-weekdays">
      <div>Dom</div><div>Seg</div><div>Ter</div><div>Qua</div><div>Qui</div><div>Sex</div><div>Sáb</div>
    </div>
    <div class="cal-grid">${celulasHTML}</div>`;
}

function aplicarEstiloTabela() {
  const wrap = document.getElementById('lanc-table-wrap');
  const cardCont = document.getElementById('lanc-card-container');
  const calCont = document.getElementById('view-calendario');
  const btn = document.getElementById('btn-toggle-view');
  const btnCal = document.getElementById('btn-toggle-calendario');
  if (!wrap || !btn) return;
  
  const modoCalendario = STATE.config && STATE.config.viewModo === 'calendario';
  if (calCont && btnCal) {
    calCont.style.display = modoCalendario ? 'block' : 'none';
    cardCont.style.display = modoCalendario ? 'none' : 'block';
    btnCal.innerHTML = modoCalendario ? '<i class="ti ti-list"></i> Lista/Cards' : '<i class="ti ti-calendar-event"></i> Calendário';
    btnCal.classList.toggle('btn-primary', modoCalendario);
  }

  if (STATE.config && STATE.config.viewEstilo === 'cards') {
    wrap.classList.add('view-cards');
    cardCont.classList.add('bg-transparent');
    btn.innerHTML = '<i class="ti ti-list"></i> Estilo Tabela';
  } else {
    wrap.classList.remove('view-cards');
    cardCont.classList.remove('bg-transparent');
    btn.innerHTML = '<i class="ti ti-layout-cards"></i> Estilo Cards';
  }
}
let _timerBuscaLancamentos = null;
function agendarRenderLancamentos() {
  clearTimeout(_timerBuscaLancamentos);
  _timerBuscaLancamentos = setTimeout(() => {
    renderLancamentos({ pularFiltros: true });
  }, 180);
}

function renderLancamentos(opcoes) {
  const pularFiltros = Boolean(opcoes && opcoes.pularFiltros);
  if (!pularFiltros) popularFiltros();
  atualizarContagemLixeira();
  if (typeof atualizarContagemTriagem === 'function') atualizarContagemTriagem();
  aplicarEstiloTabela(); // Aplica o estilo (Tabela/Cards) baseado na escolha salva
  atualizarVisibilidadeModoFiltroMes();
  atualizarBannerDrillDownLancamentos();
  const mes = document.getElementById('f-mes').value;
  const modoMes = obterModoFiltroMesLancamentos();
  const tipo = document.getElementById('f-tipo').value;
  const cat = document.getElementById('f-categoria').value;
  const status = document.getElementById('f-status').value;
  const busca = document.getElementById('f-busca').value.toLowerCase();
  const tagFiltro = document.getElementById('f-tag').value;
  const fContaEl = document.getElementById('f-conta');
  const contaFiltro = fContaEl ? fContaEl.value : '';
  let lista = STATE.lancamentos.filter(l =>
    (!mes || mesDoLancamentoNaAbaLancamentos(l, modoMes) === mes) &&
    correspondeFiltroTipoLancamento(l, tipo) &&
    (!contaFiltro || l.conta === contaFiltro) &&
    categoriaCorrespondeFiltro(l.categoria, cat) &&
    (!status || (status === 'pago' ? estaPago(l) : !estaPago(l))) &&
    (!tagFiltro || lancamentoTemHashtag(l, tagFiltro)) &&
    (!busca || (l.descricao || '').toLowerCase().includes(busca) || (l.descricaoOriginal || '').toLowerCase().includes(busca))
  ).sort((a,b) => (b.data||'').localeCompare(a.data||''));

  const resumoTag = document.getElementById('tag-resumo');
  if (tagFiltro) {
    const gastos = lista.filter(l => l.tipo === 'despesa' && !isLancamentoTransferencia(l)).reduce((s,l) => s + l.valor, 0);
    const entradas = lista.filter(l => l.tipo === 'receita' && !isLancamentoTransferencia(l)).reduce((s,l) => s + l.valor, 0);
    const cats = gastosPorCategoria(lista).slice(0, 4).map(([c, v]) => `${escHtml(c)}: ${toBRL(v)}`).join(' · ');
    resumoTag.style.display = '';
    resumoTag.innerHTML = `<i class="ti ti-tag" style="flex-shrink:0"></i><div><strong>#${escHtml(tagFiltro)}</strong> — gasto total ${toBRL(gastos)}${entradas ? ` · entradas ${toBRL(entradas)}` : ''} · ${lista.length} lançamento(s)${cats ? `<br><span style="font-weight:400">Por categoria: ${cats}</span>` : ''}</div>`;
  } else {
    resumoTag.style.display = 'none';
  }

  const tbody = document.getElementById('lanc-tbody');
  const thead = document.getElementById('lanc-thead');
  const wrap = document.getElementById('lanc-table-wrap');
  if (wrap) wrap.classList.toggle('modo-conciliacao-ativo', modoConciliacaoAtivo);
  if (thead) {
    thead.innerHTML = modoConciliacaoAtivo
      ? `<tr><th><label style="display:inline-flex;align-items:center;gap:8px;cursor:pointer;margin:0"><input type="checkbox" id="concil-check-all" onchange="selecionarTodosConciliacao(this.checked)" title="Selecionar todos os lançamentos visíveis"> Data</label></th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Status</th><th style="text-align:right">Valor</th><th style="width:70px"></th></tr>`
      : `<tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Status</th><th style="text-align:right">Valor</th><th style="width:70px"></th></tr>`;
  }
  document.getElementById('lanc-empty').style.display = lista.length ? 'none' : 'block';
  tbody.innerHTML = lista.map(l => {
    const [a,m,d] = (l.data||'').split('-');
    const dataFmt = a ? `${d}/${m}/${a}` : '-';
    const ehTransfItem = isLancamentoTransferencia(l);
    const grupoTransfId = obterTransferenciaId(l);
    const acoes = (ehTransfItem && grupoTransfId)
      ? `<button class="icon-btn danger" onclick="excluirTransferencia('${grupoTransfId}')" title="Excluir transferência"><i class="ti ti-trash"></i></button>`
      : `<button class="icon-btn" onclick="abrirModalLancamento('${l.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
         <button class="icon-btn danger" onclick="excluirLancamento('${l.id}')" title="Excluir"><i class="ti ti-trash"></i></button>`;
    const selecionado = modoConciliacaoAtivo && conciliacaoSelecionados.has(l.id);
    const chkConcil = modoConciliacaoAtivo
      ? `<input type="checkbox" class="concil-chk" value="${escHtml(l.id)}" aria-label="Selecionar lançamento ${escHtml(l.descricao || '')}" ${selecionado ? 'checked' : ''} onclick="event.stopPropagation()" onchange="clicarItemConciliacao('${l.id}', this.closest('tr'), event)">`
      : '';
    const classesTr = [
      'card-lancamento',
      modoConciliacaoAtivo ? 'concil-elegivel' : '',
      selecionado ? 'item-selecionado lancamento-selecionado' : ''
    ].filter(Boolean).join(' ');
    const attrCliqueTr = modoConciliacaoAtivo
      ? ` onclick="if(!event.target.closest('.concil-chk')) clicarItemConciliacao('${l.id}', this, event)"`
      : '';
    const subCatsBadge = (l.subTransacoes && l.subTransacoes.length)
      ? ` <span class="badge badge-cat" title="${escHtml(l.subTransacoes.map(s => s.categoria + ': ' + toBRL(s.valor)).join(' | '))}"><i class="ti ti-arrows-split-2"></i> ${l.subTransacoes.length} cats</span>`
      : '';
    const ehAClassificar = normalizarTextoSemAcento(l.categoria) === 'a classificar';
    const badgeDescOrig = (l.descricaoOriginal && l.descricaoOriginal !== l.descricao)
      ? ` <i class="ti ti-info-circle" style="font-size:12px;color:var(--text3);vertical-align:-1px" title="Descrição original do banco: ${escHtml(l.descricaoOriginal)}"></i>`
      : '';
    return `<tr data-id="${l.id}"${classesTr ? ` class="${classesTr}"` : ''}${attrCliqueTr}>
      <td>${chkConcil}${dataFmt}</td>
      <td>${formatarDescricaoComHashtags(l.descricao)}${badgeDescOrig}${badgeParcelaHTML(l)}${subCatsBadge}${badgesTagsHTML(l)}${comprovanteIconHTML(l)}</td>
      <td><span class="badge badge-cat${ehAClassificar ? ' badge-a-classificar' : ''}">${escHtml(formatarCategoriaExibicao(l.categoria))}</span></td>
      <td>${escHtml(l.conta || '-')}${badgeFaturaCompetenciaHTML(l)}</td>
      <td>${badgeStatusHTML(l, !ehTransfItem && !modoConciliacaoAtivo)}</td>
      <td style="text-align:right">${badgeValorHTML(l)}</td>
      <td class="concil-acoes" style="text-align:right;white-space:nowrap">${acoes}</td>
    </tr>`;
  }).join('');
  atualizarBarraConciliacao();
  if (STATE.config && STATE.config.viewModo === 'calendario') {
    renderCalendarioFinanceiro(lista);
  }
}

/* ---- Modo Seleção em Lote (Apagar e Conciliar Múltiplos) ---- */
let modoConciliacaoAtivo = false;
let conciliacaoSelecionados = new Set();

function obterItensGrupoParcelas(l) {
  if (!l) return [];
  const grupoId = l.grupoId || l.parcelaGrupo;
  if (grupoId) {
    const porGrupo = STATE.lancamentos.filter(x => (x.grupoId === grupoId || x.parcelaGrupo === grupoId));
    if (porGrupo.length > 0) return porGrupo;
  }
  const matchDesc = (l.descricao || '').match(/^(.*?)\s*\((\d+)\/(\d+)\)$/);
  const totalParcelas = (l.totalParcelas || l.parcelaTotal) || (matchDesc ? parseInt(matchDesc[3], 10) : 0);
  const baseDesc = matchDesc ? matchDesc[1].trim() : (l.descricao || '').trim();

  if (baseDesc && (totalParcelas > 1 || matchDesc)) {
    const irmaos = STATE.lancamentos.filter(x => {
      if (x.id === l.id) return true;
      if (x.tipo !== l.tipo) return false;
      if (l.conta && x.conta && x.conta !== l.conta) return false;
      if (l.dataCompra && x.dataCompra && l.dataCompra !== x.dataCompra) return false;

      const mX = (x.descricao || '').match(/^(.*?)\s*\((\d+)\/(\d+)\)$/);
      if (mX) {
        const baseDescX = mX[1].trim();
        const totalX = parseInt(mX[3], 10);
        if (baseDescX.toLowerCase() === baseDesc.toLowerCase()) {
          if (!totalParcelas || totalX === totalParcelas || !mX[3]) {
            const d1 = l.dataCompra || l.data;
            const d2 = x.dataCompra || x.data;
            if (d1 && d2) {
              const [y1, m1] = d1.split('-').map(Number);
              const [y2, m2] = d2.split('-').map(Number);
              if (y1 && y2) {
                const diffMeses = Math.abs((y1 - y2) * 12 + (m1 - m2));
                if (diffMeses > Math.max(12, (totalParcelas || 6) + 3)) return false;
              }
            }
            return true;
          }
        }
      }
      return false;
    });
    if (irmaos.length > 1) {
      const novoGrupoId = l.grupoId || l.parcelaGrupo || uid();
      irmaos.forEach(item => {
        if (!item.grupoId) item.grupoId = novoGrupoId;
        if (!item.parcelaGrupo) item.parcelaGrupo = novoGrupoId;
        if (!item.totalParcelas && totalParcelas) item.totalParcelas = totalParcelas;
        if (!item.parcelaTotal && totalParcelas) item.parcelaTotal = totalParcelas;
      });
      return irmaos;
    }
  }
  return [l];
}

function alternarModoConciliacao() {
  modoConciliacaoAtivo = !modoConciliacaoAtivo;
  conciliacaoSelecionados.clear();
  const btn = document.getElementById('btn-modo-conciliacao');
  if (btn) {
    btn.classList.toggle('btn-primary', modoConciliacaoAtivo);
    btn.innerHTML = modoConciliacaoAtivo ? '<i class="ti ti-x"></i> Sair da Seleção' : '<i class="ti ti-checks"></i> Modo Seleção';
  }
  renderLancamentos();
}
function sincronizarCheckboxSelecionarTodos() {
  const tbodyLanc = document.getElementById('lanc-tbody');
  const allChks = tbodyLanc && typeof tbodyLanc.querySelectorAll === 'function'
    ? [...tbodyLanc.querySelectorAll('.concil-chk')]
    : [...document.querySelectorAll('#lanc-tbody .concil-chk')];
  const masterChk = document.getElementById('concil-check-all');
  if (!masterChk) return;
  const marcados = allChks.filter(c => c.checked).length;
  masterChk.checked = allChks.length > 0 && marcados === allChks.length;
  masterChk.indeterminate = marcados > 0 && marcados < allChks.length;
}

function obterLinhaLancamentoNoTbody(itemId, trPreferencial) {
  const tbodyLanc = document.getElementById('lanc-tbody');
  if (trPreferencial && (!tbodyLanc || (trPreferencial.closest && trPreferencial.closest('#lanc-tbody') === tbodyLanc))) {
    return trPreferencial;
  }
  if (!tbodyLanc || typeof tbodyLanc.querySelector !== 'function') return null;
  const escId = (typeof CSS !== 'undefined' && typeof CSS.escape === 'function')
    ? CSS.escape(String(itemId))
    : String(itemId).replace(/["\\]/g, '\\$&');
  return tbodyLanc.querySelector(`tr[data-id="${escId}"]`);
}

function clicarItemConciliacao(id, trEl, ev) {
  if (!modoConciliacaoAtivo) return;
  if (ev && typeof ev.stopPropagation === 'function') ev.stopPropagation();
  const item = STATE.lancamentos.find(x => x.id === id);
  const irmaos = item ? obterItensGrupoParcelas(item) : [];
  const idsAfetados = (irmaos.length > 1) ? irmaos.map(x => x.id) : [id];

  const novoEstado = !conciliacaoSelecionados.has(id);
  idsAfetados.forEach(itemId => {
    if (novoEstado) conciliacaoSelecionados.add(itemId);
    else conciliacaoSelecionados.delete(itemId);
  });

  idsAfetados.forEach(itemId => {
    const tr = obterLinhaLancamentoNoTbody(itemId, itemId === id ? trEl : null);
    if (tr) {
      tr.classList.toggle('item-selecionado', novoEstado);
      tr.classList.toggle('lancamento-selecionado', novoEstado);
      const chk = tr.querySelector('.concil-chk');
      if (chk) chk.checked = novoEstado;
    }
  });

  sincronizarCheckboxSelecionarTodos();
  atualizarBarraConciliacao();
}
function selecionarTodosConciliacao(marcar) {
  const tbodyLanc = document.getElementById('lanc-tbody');
  const chks = tbodyLanc && typeof tbodyLanc.querySelectorAll === 'function'
    ? [...tbodyLanc.querySelectorAll('.concil-chk')]
    : [...document.querySelectorAll('#lanc-tbody .concil-chk')];
  chks.forEach(chk => {
    chk.checked = Boolean(marcar);
    const tr = chk.closest ? chk.closest('tr') : null;
    if (tr) {
      tr.classList.toggle('item-selecionado', Boolean(marcar));
      tr.classList.toggle('lancamento-selecionado', Boolean(marcar));
    }
    const item = STATE.lancamentos.find(x => x.id === chk.value);
    const irmaos = item ? obterItensGrupoParcelas(item) : [];
    const idsAfetados = (irmaos.length > 1) ? irmaos.map(x => x.id) : [chk.value];
    idsAfetados.forEach(itemId => {
      if (marcar) conciliacaoSelecionados.add(itemId);
      else conciliacaoSelecionados.delete(itemId);
    });
  });
  sincronizarCheckboxSelecionarTodos();
  atualizarBarraConciliacao();
}
function atualizarBarraConciliacao() {
  const bar = document.getElementById('conciliacao-bar');
  const cont = document.getElementById('conciliacao-contador');
  const pageLanc = document.getElementById('page-lancamentos');
  const wrapLanc = document.getElementById('lanc-table-wrap');
  if (!bar || !cont) return;

  const qtd = conciliacaoSelecionados.size;
  const soma = [...conciliacaoSelecionados].reduce((acc, id) => {
    const item = STATE.lancamentos.find(x => x.id === id);
    return acc + (item ? (Number(item.valor) || 0) : 0);
  }, 0);
  cont.innerHTML = `<strong>${qtd}</strong> selecionado(s) · <span class="valor-sensivel" style="font-weight:700">${toBRL(soma)}</span>`;

  const emLancamentos = !pageLanc || pageLanc.classList.contains('active');
  const mostrarBarra = modoConciliacaoAtivo && qtd > 0 && emLancamentos;
  bar.classList.toggle('show', mostrarBarra);
  if (pageLanc) pageLanc.classList.toggle('conciliacao-bar-ativa', mostrarBarra);
  if (wrapLanc) wrapLanc.classList.toggle('conciliacao-bar-ativa', mostrarBarra);

  const btnDel = document.getElementById('btn-concil-apagar');
  const btnPago = document.getElementById('btn-concil-pago');
  if (btnDel) btnDel.disabled = qtd === 0;
  if (btnPago) btnPago.disabled = qtd === 0;

  sincronizarCheckboxSelecionarTodos();
}
async function excluirSelecionadosEmLote() {
  if (!conciliacaoSelecionados.size) {
    toast('Selecione ao menos um lançamento para apagar.', 'err');
    return;
  }
  const qtdSelecionada = conciliacaoSelecionados.size;
  const itensParaExcluir = STATE.lancamentos.filter(l => conciliacaoSelecionados.has(l.id));
  const itensParaExcluirSet = new Set(itensParaExcluir);

  // 1. Expande compras parceladas: se uma parcela foi selecionada, inclui todas as outras do grupo
  itensParaExcluir.forEach(l => {
    const irmaosParcelas = obterItensGrupoParcelas(l);
    if (irmaosParcelas.length > 1) {
      irmaosParcelas.forEach(p => itensParaExcluirSet.add(p));
    }
  });

  // 2. Trata transferências: se uma ponta foi selecionada, inclui a outra para manter integridade
  itensParaExcluir.forEach(l => {
    const gid = obterTransferenciaId(l);
    if (gid) {
      STATE.lancamentos.filter(x => obterTransferenciaId(x) === gid).forEach(par => {
        itensParaExcluirSet.add(par);
        if (par.ehMovimentoCofre && par.metaId) {
          const meta = (STATE.metas || []).find(m => m.id === par.metaId);
          if (meta) {
            const delta = par.tipo === 'despesa' ? -par.valor : par.valor;
            meta.valorAtual = Math.max(0, Math.round(((Number(meta.valorAtual) || 0) + delta) * 100) / 100);
          }
        }
      });
    }
  });

  const itensFinais = [...itensParaExcluirSet];
  const totalExcluir = itensFinais.length;

  const temParcelas = itensFinais.some(x => {
    const match = (x.descricao || '').match(/\(\d+\/\d+\)$/);
    return (x.parcelaTotal && x.parcelaTotal > 1) || match;
  });

  let mensagemConfirmacao = `Tem a certeza de que deseja apagar os ${totalExcluir} lançamentos selecionados? Você poderá recuperá-los pela Lixeira se precisar.`;
  if (temParcelas) {
    mensagemConfirmacao = `Deseja apagar os lançamentos selecionados? Como há compras parceladas incluídas, todas as ${totalExcluir} parcelas vinculadas serão excluídas de uma só vez.`;
  }

  abrirConfirmacao(
    mensagemConfirmacao,
    async () => {
      const idsFinais = new Set(itensFinais.map(x => x.id));
      STATE.lancamentos = STATE.lancamentos.filter(x => !idsFinais.has(x.id));

      const rotulo = totalExcluir === 1
        ? (itensFinais[0]?.descricao || 'Lançamento')
        : `${totalExcluir} lançamentos excluídos em lote`;
      const entradaId = registrarExclusao(itensFinais, rotulo);

      conciliacaoSelecionados.clear();
      modoConciliacaoAtivo = false;
      const btn = document.getElementById('btn-modo-conciliacao');
      if (btn) {
        btn.classList.remove('btn-primary');
        btn.innerHTML = '<i class="ti ti-checks"></i> Modo Seleção';
      }

      await salvarDados();
      renderPaginaAtiva();
      atualizarContagemLixeira();
      sincronizarEmSegundoPlano();
      toastDesfazer(
        totalExcluir === 1 ? '1 lançamento apagado.' : `${totalExcluir} lançamentos apagados com sucesso (todas as parcelas vinculadas foram removidas).`,
        entradaId
      );
    },
    `Apagar ${totalExcluir} lançamento${totalExcluir > 1 ? 's' : ''}`
  );
}
async function marcarSelecionadosComoPagos() {
  if (!conciliacaoSelecionados.size) {
    toast('Selecione ao menos um lançamento.', 'err');
    return;
  }
  let alterados = 0;
  let ignoradosCartao = 0;
  STATE.lancamentos.forEach(l => {
    if (conciliacaoSelecionados.has(l.id)) {
      if (ehLancamentoCartao(l) && l.tipo === 'despesa' && !ehLancamentoPagamentoFatura(l)) {
        ignoradosCartao++;
        return;
      }
      if (!estaPago(l)) {
        l.pago = true;
        l.sincronizado = false;
        alterados++;
      }
    }
  });
  const totalSel = conciliacaoSelecionados.size;
  conciliacaoSelecionados.clear();
  modoConciliacaoAtivo = false;
  const btn = document.getElementById('btn-modo-conciliacao');
  if (btn) {
    btn.classList.remove('btn-primary');
    btn.innerHTML = '<i class="ti ti-checks"></i> Modo Seleção';
  }
  await salvarDados();
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  if (ignoradosCartao > 0 && alterados === 0) {
    toast('Compras de cartão só são liquidadas pelo botão "Pagar Fatura".', 'info');
  } else {
    toast(alterados ? `${alterados} lançamento(s) marcado(s) como pago(s)!` : `${totalSel} lançamento(s) já estavam pagos.`, 'ok');
  }
}
async function togglePagamento(id) {
  const l = STATE.lancamentos.find(x => x.id === id);
  if (!l) return;
  if (ehLancamentoCartao(l) && l.tipo === 'despesa' && !ehLancamentoPagamentoFatura(l)) {
    if (l.faturaPaga === true) {
      toast('Esta fatura já está liquidada.', 'info');
      return;
    }
    const cartao = (STATE.contas || []).find(c => c.nome === l.conta && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === l.conta);
    const comp = calcularCompetenciaLancamentoCartao(l, cartao || { nome: l.conta, diaFechamento: 1 });
    abrirModalPagamentoFatura(l.conta, comp.mes, comp.ano);
    return;
  }
  const novoEstado = !estaPago(l);
  l.pago = novoEstado;
  if (!novoEstado && (l.status === 'Liquidado' || l.status === 'Pago/Efetivado')) {
    delete l.status;
  }
  l.sincronizado = false;
  await salvarDados();
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
}
function popularCategoriasSelect() {
  const tipo = document.getElementById('lanc-tipo').value;
  const sel = document.getElementById('lanc-categoria');
  const atual = sel.value;
  sel.innerHTML = construirOptionsCategoriasHTML(tipo, atual);
  if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
  if (splitAtivoNoModal) renderLinhasSplit();
  const rowRachar = document.getElementById('lanc-split-bill-toggle-row');
  const wrapRachar = document.getElementById('lanc-rachar-wrap');
  const chkRachar = document.getElementById('lanc-rachar-chk');
  const editando = !!(document.getElementById('lanc-id') && document.getElementById('lanc-id').value);
  if (rowRachar) rowRachar.style.display = (!editando && tipo === 'despesa') ? 'flex' : 'none';
  if (editando || tipo !== 'despesa') {
    if (chkRachar) chkRachar.checked = false;
    if (wrapRachar) wrapRachar.style.display = 'none';
  }
  const rowReembolso = document.getElementById('lanc-reembolsavel-row');
  const wrapReembolso = document.getElementById('lanc-reembolsavel-wrap');
  const chkReembolso = document.getElementById('lanc-reembolsavel-chk');
  if (rowReembolso) rowReembolso.style.display = (tipo === 'despesa') ? 'flex' : 'none';
  if (tipo !== 'despesa') {
    if (chkReembolso) chkReembolso.checked = false;
    if (wrapReembolso) wrapReembolso.style.display = 'none';
  }
}

/* ---- Desmembramento de Lançamentos (Split Transactions) ---- */
let splitAtivoNoModal = false;
let splitLinhas = [];
function alternarSplitLancamento(forcarEstado) {
  splitAtivoNoModal = typeof forcarEstado === 'boolean' ? forcarEstado : !splitAtivoNoModal;
  const singleWrap = document.getElementById('lanc-cat-single-wrap');
  const splitWrap = document.getElementById('lanc-split-wrap');
  if (singleWrap) singleWrap.style.display = splitAtivoNoModal ? 'none' : '';
  if (splitWrap) splitWrap.style.display = splitAtivoNoModal ? 'block' : 'none';
  if (splitAtivoNoModal && splitLinhas.length === 0) {
    const tipo = document.getElementById('lanc-tipo').value;
    const cats = STATE.categorias.filter(c => c.tipo === tipo);
    const valTotal = moedaToNumber(document.getElementById('lanc-valor').value);
    const metade = valTotal > 0 ? Math.floor((valTotal / 2) * 100) / 100 : 0;
    const resto = valTotal > 0 ? Math.round((valTotal - metade) * 100) / 100 : 0;
    splitLinhas = [
      { categoria: (cats[0] && cats[0].nome) || 'Outros', valor: metade },
      { categoria: (cats[1] && cats[1].nome) || (cats[0] && cats[0].nome) || 'Outros', valor: resto }
    ];
  }
  if (splitAtivoNoModal) renderLinhasSplit();
}
function adicionarLinhaSplit() {
  const tipo = document.getElementById('lanc-tipo').value;
  const cats = STATE.categorias.filter(c => c.tipo === tipo);
  const valTotal = moedaToNumber(document.getElementById('lanc-valor').value);
  const somaAtual = splitLinhas.reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const faltante = Math.max(0, Math.round((valTotal - somaAtual) * 100) / 100);
  splitLinhas.push({ categoria: (cats[0] && cats[0].nome) || 'Outros', valor: faltante });
  renderLinhasSplit();
}
function removerLinhaSplit(idx) {
  if (splitLinhas.length <= 2) {
    toast('O desmembramento exige ao menos 2 linhas (ou volte para categoria única).', 'err');
    return;
  }
  splitLinhas.splice(idx, 1);
  renderLinhasSplit();
}
function atualizarCampoSplit(idx, campo, el) {
  if (!splitLinhas[idx]) return;
  if (campo === 'categoria') {
    splitLinhas[idx].categoria = el.value;
  } else if (campo === 'valor') {
    maskMoedaSmart(el);
    splitLinhas[idx].valor = moedaToNumber(el.value);
    atualizarResumoSplit();
  }
}
function renderLinhasSplit() {
  const cont = document.getElementById('lanc-split-rows');
  if (!cont) return;
  const tipo = document.getElementById('lanc-tipo').value;
  cont.innerHTML = splitLinhas.map((item, idx) => {
    const opts = construirOptionsCategoriasHTML(tipo, item.categoria);
    const valStr = item.valor > 0 ? toBRL(item.valor).replace('R$', 'R$ ') : '';
    return `<div class="split-row">
      <select onchange="atualizarCampoSplit(${idx}, 'categoria', this)">${opts}</select>
      <input type="text" placeholder="R$ 0,00" value="${valStr}" oninput="atualizarCampoSplit(${idx}, 'valor', this)" onblur="avaliarExpressaoMoeda(this); splitLinhas[${idx}].valor = moedaToNumber(this.value); atualizarResumoSplit();">
      <button type="button" class="icon-btn danger" onclick="removerLinhaSplit(${idx})" title="Remover linha"><i class="ti ti-trash"></i></button>
    </div>`;
  }).join('');
  atualizarResumoSplit();
}
function atualizarResumoSplit() {
  const statusEl = document.getElementById('lanc-split-status');
  if (!statusEl) return;
  const total = moedaToNumber(document.getElementById('lanc-valor').value);
  const soma = splitLinhas.reduce((s, r) => s + (Number(r.valor) || 0), 0);
  const diff = Math.round((total - soma) * 100) / 100;
  if (Math.abs(diff) < 0.009 && total > 0) {
    statusEl.style.color = 'var(--good)';
    statusEl.innerHTML = `<i class="ti ti-circle-check"></i> Soma: ${toBRL(soma)} (Exato)`;
  } else {
    statusEl.style.color = 'var(--bad)';
    statusEl.innerHTML = `<i class="ti ti-alert-circle"></i> Soma: ${toBRL(soma)} (${diff > 0 ? 'Faltam ' + toBRL(diff) : 'Excede ' + toBRL(Math.abs(diff))})`;
  }
}
function popularContasSelect() {
  document.getElementById('lanc-conta').innerHTML = STATE.contas.map(c => `<option value="${escHtml(c.nome)}">${escHtml(c.nome)}</option>`).join('');
}
function sugerirCategoriaPorRegra() {
  const campoDesc = document.getElementById('lanc-descricao');
  if (!campoDesc) return;
  const descricao = campoDesc.value;
  const regra = buscarRegraCategorizacao(descricao);
  if (!regra) return;

  const catNome = regra.categoriaDesejada || regra.categoria;
  const subCat = regra.subcategoria;
  const conta = regra.contaId || regra.conta;

  const selCat = document.getElementById('lanc-categoria');
  if (selCat && catNome) {
    const valComSub = subCat ? `${catNome} -> ${subCat}` : catNome;
    if ([...selCat.options].some(o => o.value === valComSub)) {
      selCat.value = valComSub;
    } else if ([...selCat.options].some(o => o.value === catNome)) {
      selCat.value = catNome;
    } else if (regra.categoria && [...selCat.options].some(o => o.value === regra.categoria)) {
      selCat.value = regra.categoria;
    }
  }

  const selConta = document.getElementById('lanc-conta');
  if (selConta && conta) {
    if ([...selConta.options].some(o => o.value === conta)) {
      selConta.value = conta;
    }
  }
}
function somarMeses(dataISO, n) {
  if (!dataISO) return '';
  const [y, m, d] = dataISO.split('-').map(Number);
  let targetMonth = (m - 1) + n;
  let targetYear = y + Math.floor(targetMonth / 12);
  targetMonth = ((targetMonth % 12) + 12) % 12 + 1;
  const maxDays = new Date(targetYear, targetMonth, 0).getDate();
  const day = Math.min(d, maxDays);
  return `${targetYear}-${String(targetMonth).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
function popularParcelasSelect() {
  const sel = document.getElementById('lanc-parcelas');
  let opts = '';
  for (let i = 1; i <= 24; i++) opts += `<option value="${i}">${i === 1 ? 'À vista (1x)' : i + 'x'}</option>`;
  sel.innerHTML = opts;
}
function atualizarDicaParcelas() {
  const parcelas = parseInt(document.getElementById('lanc-parcelas').value, 10) || 1;
  const valor = moedaToNumber(document.getElementById('lanc-valor').value);
  const hint = document.getElementById('lanc-valor-hint');
  if (parcelas > 1 && valor > 0) {
    hint.textContent = `(total — ${parcelas}x de ${toBRL(valor / parcelas)})`;
  } else {
    hint.textContent = '';
  }
}
/* ---- Tags (etiquetas livres que cruzam categorias & #Hashtags na descrição) ---- */
function parseTags(texto) {
  const vistas = new Set();
  return String(texto || '').split(',').map(t => t.trim().replace(/^#/, '')).filter(t => {
    if (!t) return false;
    const k = t.toLowerCase();
    if (vistas.has(k)) return false;
    vistas.add(k);
    return true;
  });
}
function extrairHashtagsDescricao(desc) {
  const matches = String(desc || '').match(/#[\wÀ-ÿ]+/g) || [];
  return matches.map(m => m.slice(1));
}
function lancamentoTemHashtag(l, tagAlvo) {
  if (!tagAlvo) return true;
  const alvo = String(tagAlvo).replace(/^#/, '').toLowerCase();
  if ((l.tags || []).some(t => t.toLowerCase() === alvo)) return true;
  const inline = extrairHashtagsDescricao(l.descricao);
  return inline.some(t => t.toLowerCase() === alvo);
}
function todasAsTags() {
  const mapa = new Map();
  STATE.lancamentos.forEach(l => {
    (l.tags || []).forEach(t => { if (t && !mapa.has(t.toLowerCase())) mapa.set(t.toLowerCase(), t); });
    extrairHashtagsDescricao(l.descricao).forEach(t => { if (t && !mapa.has(t.toLowerCase())) mapa.set(t.toLowerCase(), t); });
  });
  return [...mapa.values()].sort((a, b) => a.localeCompare(b));
}
function formatarDescricaoComHashtags(desc) {
  const txt = String(desc || '-');
  const regex = /#[\wÀ-ÿ]+/g;
  let resultado = '';
  let ultimoIndice = 0;
  let match;
  while ((match = regex.exec(txt)) !== null) {
    if (match.index > ultimoIndice) {
      resultado += escHtml(txt.slice(ultimoIndice, match.index));
    }
    const tagEsc = escHtml(match[0]);
    resultado += `<span class="hashtag" data-hashtag="${tagEsc}" onclick="event.stopPropagation(); filtrarPorHashtag(this.dataset.hashtag)">${tagEsc}</span>`;
    ultimoIndice = regex.lastIndex;
  }
  if (ultimoIndice < txt.length) {
    resultado += escHtml(txt.slice(ultimoIndice));
  }
  return resultado || '-';
}
function badgesTagsHTML(l) {
  const inlineSet = new Set(extrairHashtagsDescricao(l.descricao).map(t => t.toLowerCase()));
  return (l.tags || [])
    .filter(t => !inlineSet.has(t.toLowerCase()))
    .map(t => `<span class="hashtag" data-hashtag="#${escHtml(t)}" onclick="event.stopPropagation(); filtrarPorHashtag(this.dataset.hashtag)">#${escHtml(t)}</span>`)
    .join('');
}
function filtrarPorHashtag(tagRaw) {
  const limpa = String(tagRaw || '').replace(/^#/, '');
  if (!limpa) return;
  popularFiltros();
  const sel = document.getElementById('f-tag');
  if (sel) {
    sel.value = limpa;
    renderLancamentos();
  }
}

/* ---- Importador de Extratos Bancários (CSV / OFX) ---- */
let itensExtratoEmRevisao = [];
function lerArquivoExtrato(file) {
  if (!file) return;
  const nome = (file.name || '').toLowerCase();
  if ((nome.endsWith('.ofx') || nome.endsWith('.qfx')) && typeof lerArquivoOFX === 'function') {
    lerArquivoOFX(file);
    return;
  }
  const reader = new FileReader();
  reader.onload = (e) => {
    const conteudo = String(e.target.result || '');
    if (conteudo.includes('<OFX') || conteudo.includes('<STMTTRN>')) {
      if (typeof processarTextoOFX === 'function') {
        processarTextoOFX(conteudo, file.name, file);
        return;
      }
    }
    const itens = parseExtratoCSV(conteudo);
    if (!itens.length) {
      toast('Nenhum lançamento válido encontrado neste arquivo (.csv / .ofx).', 'err');
      return;
    }
    abrirModalRevisaoExtrato(itens);
  };
  reader.onerror = () => toast('Erro ao ler o arquivo de extrato.', 'err');
  reader.readAsText(file, 'UTF-8');
}
function normalizarDataExtrato(str) {
  return extrairDataLocalISO(str, {
    retornarVazioSeInvalido: true,
    aceitarSerialExcel: false,
    silencioso: true
  });
}
function parseValorExtrato(str) {
  if (typeof str === 'number') return str;
  const s = String(str || '').trim().replace(/^["']|["']$/g, '').replace(/[R$\s]/g, '');
  if (!s || !/\d/.test(s)) return NaN;
  const negativo = s.startsWith('-') || (s.startsWith('(') && s.endsWith(')'));
  const limpo = s.replace(/[^0-9.,]/g, '');
  let num = 0;
  if (limpo.includes(',') && limpo.includes('.')) {
    if (limpo.lastIndexOf(',') > limpo.lastIndexOf('.')) {
      num = parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
    } else {
      num = parseFloat(limpo.replace(/,/g, ''));
    }
  } else if (limpo.includes(',')) {
    num = parseFloat(limpo.replace(',', '.'));
  } else {
    num = parseFloat(limpo);
  }
  if (isNaN(num)) return NaN;
  return negativo ? -Math.abs(num) : num;
}
function sugerirCategoriaExtrato(descricao, tipo) {
  const porRegra = aplicarRegraCategorizacao(descricao);
  if (porRegra) return porRegra;
  const catsDoTipo = STATE.categorias.filter(c => c.tipo === tipo);
  return (catsDoTipo.find(c => c.nome === 'Outros') || catsDoTipo[0] || {}).nome || 'Outros';
}
function parseExtratoCSV(texto) {
  const linhas = String(texto || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return [];
  const itens = [];
  for (let i = 0; i < linhas.length; i++) {
    const linha = linhas[i];
    const sep = (linha.match(/;/g) || []).length >= (linha.match(/,/g) || []).length ? ';' : ',';
    const cols = linha.split(sep).map(c => c.trim().replace(/^["']|["']$/g, ''));
    if (cols.length < 2) continue;
    let dataISO = '';
    let valorNum = NaN;
    let descPartes = [];
    for (const col of cols) {
      if (!dataISO) {
        const dt = normalizarDataExtrato(col);
        if (dt) { dataISO = dt; continue; }
      }
      if (isNaN(valorNum) && /^-?\s*(?:R\$\s*)?\d[\d.,]*$/.test(col)) {
        const v = parseValorExtrato(col);
        if (!isNaN(v) && v !== 0) { valorNum = v; continue; }
      }
      if (col && !/^(data|date|valor|amount|descri[cç][aã]o|hist[oó]rico|memo)$/i.test(col)) {
        descPartes.push(col);
      }
    }
    if (!dataISO || isNaN(valorNum) || valorNum === 0) continue;
    const descricao = descPartes.join(' - ').trim() || 'Lançamento importado';
    const tipo = valorNum < 0 ? 'despesa' : 'receita';
    const valor = Math.abs(valorNum);
    itens.push({
      data: dataISO,
      descricao,
      valor,
      tipo,
      categoria: sugerirCategoriaExtrato(descricao, tipo)
    });
  }
  return itens;
}
function parseExtratoOFX(texto) {
  if (typeof parseOFX !== 'function') return [];
  const res = parseOFX(texto);
  return Array.isArray(res) ? res : ((res && Array.isArray(res.transacoes)) ? res.transacoes : []);
}
function abrirModalRevisaoExtrato(itens) {
  itensExtratoEmRevisao = itens.map(it => ({ ...it }));
  const selConta = document.getElementById('extrato-rev-conta');
  if (selConta) {
    selConta.innerHTML = STATE.contas.map(c => `<option value="${escHtml(c.nome)}">${escHtml(c.nome)}</option>`).join('');
  }
  renderListaRevisaoExtrato();
  abrirModal('modal-revisao-extrato');
}
function renderListaRevisaoExtrato() {
  const cont = document.getElementById('extrato-rev-lista');
  const resumo = document.getElementById('extrato-rev-resumo');
  if (!cont) return;
  if (!itensExtratoEmRevisao.length) {
    cont.innerHTML = `<div class="empty" style="padding:1.5rem"><p>Nenhum item restante na revisão.</p></div>`;
    if (resumo) resumo.textContent = '0 itens';
    return;
  }
  const todasCategorias = [...new Set(STATE.categorias.map(c => c.nome))];
  if (!todasCategorias.includes('Outros')) todasCategorias.push('Outros');
  const totalDesp = itensExtratoEmRevisao.filter(i => i.tipo === 'despesa').reduce((s, i) => s + i.valor, 0);
  const totalRec = itensExtratoEmRevisao.filter(i => i.tipo === 'receita').reduce((s, i) => s + i.valor, 0);
  if (resumo) {
    resumo.textContent = `${itensExtratoEmRevisao.length} item(ns) · Saídas: ${toBRL(totalDesp)} · Entradas: ${toBRL(totalRec)}`;
  }
  cont.innerHTML = itensExtratoEmRevisao.map((it, idx) => {
    const [a, m, d] = (it.data || '').split('-');
    const dataFmt = a ? `${d}/${m}/${a}` : it.data;
    const optsCat = construirOptionsCategoriasHTML(it.tipo || '', it.categoria);
    return `<div class="extrato-rev-row">
      <div style="font-family:var(--mono);font-size:11.5px;color:var(--text3)">${dataFmt}</div>
      <div style="min-width:0"><input type="text" value="${escHtml(it.descricao || '')}" oninput="itensExtratoEmRevisao[${idx}].descricao = this.value" style="padding:5px 8px;font-size:12px"></div>
      <div style="text-align:right;font-weight:700" class="${it.tipo === 'receita' ? 'mv-ok' : 'mv-bad'}">${it.tipo === 'receita' ? '+' : '-'} ${toBRL(it.valor)}</div>
      <div><select onchange="itensExtratoEmRevisao[${idx}].categoria = this.value" style="padding:5px 8px;font-size:12px">${optsCat}</select></div>
      <div style="text-align:right"><button class="icon-btn danger" type="button" onclick="removerItemRevisaoExtrato(${idx})" title="Ignorar este item"><i class="ti ti-trash"></i></button></div>
    </div>`;
  }).join('');
}
function removerItemRevisaoExtrato(idx) {
  itensExtratoEmRevisao.splice(idx, 1);
  renderListaRevisaoExtrato();
}
async function aprovarTodosExtrato() {
  if (!itensExtratoEmRevisao.length) {
    toast('Não há itens para importar.', 'err');
    return;
  }
  const contaPadrao = (document.getElementById('extrato-rev-conta') && document.getElementById('extrato-rev-conta').value) || (STATE.contas[0] ? STATE.contas[0].nome : 'Conta');
  let adicionados = 0;
  itensExtratoEmRevisao.forEach(it => {
    const desc = (it.descricao || '').trim() || 'Lançamento importado';
    const tagsInline = extrairHashtagsDescricao(desc);
    STATE.lancamentos.push({
      id: uid(),
      tipo: it.tipo || 'despesa',
      data: extrairDataLocalISO(it.data, { contexto: { etapa: 'aprovarTodosExtrato', descricao: desc } }),
      descricao: desc,
      categoria: it.categoria || 'Outros',
      conta: contaPadrao,
      valor: Number(it.valor) || 0,
      origem: 'extrato',
      sincronizado: false,
      pago: true,
      tags: tagsInline.length ? tagsInline : undefined
    });
    adicionados++;
  });
  itensExtratoEmRevisao = [];
  await salvarDados();
  fecharModal('modal-revisao-extrato');
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  toast(`${adicionados} lançamento(s) importado(s) do extrato com sucesso!`, 'ok');
}

/* ---- Comprovante / Anexo (foto/print ou arquivo via Drag & Drop) ---- */
let comprovanteAtual = null;
let anexoMetaAtual = null; // { nome, path }
let lancEmEdicao = null; // cópia do lançamento aberto no formulário (se outro aparelho apagar o original, a edição recria)
function renderComprovanteArea() {
  const area = document.getElementById('lanc-comprovante-area');
  if (!area) return;
  const infoArquivo = anexoMetaAtual && anexoMetaAtual.nome
    ? `<div class="drop-zone-file-info" title="${(anexoMetaAtual.path || anexoMetaAtual.nome).replace(/"/g, '&quot;')}"><i class="ti ti-file-check"></i> <span>${anexoMetaAtual.nome}</span></div>`
    : '';
  if (comprovanteAtual || (anexoMetaAtual && anexoMetaAtual.nome)) {
    area.innerHTML = `
      ${comprovanteAtual ? `<img src="${comprovanteAtual}" class="comprovante-thumb" onclick="event.stopPropagation(); verComprovante(comprovanteAtual)">` : ''}
      ${infoArquivo}
      <button class="btn btn-sm" type="button" onclick="event.stopPropagation(); document.getElementById('lanc-comprovante-input').click()"><i class="ti ti-refresh"></i> Trocar</button>
      <button class="btn btn-sm btn-danger" type="button" onclick="event.stopPropagation(); removerComprovanteAnexado()"><i class="ti ti-trash"></i></button>`;
  } else {
    area.innerHTML = `<button class="btn btn-sm" type="button" onclick="event.stopPropagation(); document.getElementById('lanc-comprovante-input').click()"><i class="ti ti-paperclip"></i> Anexar foto/arquivo</button>`;
  }
}
function anexarComprovante(file) {
  if (!file) return;
  anexoMetaAtual = { nome: file.name || 'anexo', path: file.path || '' };
  if (file.type && file.type.startsWith('image/')) {
    const leitor = new FileReader();
    leitor.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxLado = 900;
        let { width, height } = img;
        if (width > maxLado || height > maxLado) {
          const escala = maxLado / Math.max(width, height);
          width = Math.round(width * escala); height = Math.round(height * escala);
        }
        const canvas = document.createElement('canvas');
        canvas.width = width; canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        comprovanteAtual = canvas.toDataURL('image/jpeg', 0.72);
        renderComprovanteArea();
      };
      img.src = e.target.result;
    };
    leitor.readAsDataURL(file);
  } else {
    comprovanteAtual = null;
    renderComprovanteArea();
  }
}
function removerComprovanteAnexado() {
  comprovanteAtual = null;
  anexoMetaAtual = null;
  document.getElementById('lanc-comprovante-input').value = '';
  renderComprovanteArea();
}
function verComprovante(dataUri) {
  if (!dataUri) return;
  document.getElementById('comprovante-img-grande').src = dataUri;
  abrirModal('modal-comprovante');
}
function verComprovanteLancamento(id) {
  const l = STATE.lancamentos.find(x => x.id === id);
  if (!l) return;
  if (typeof abrirSplitViewerLancamento === 'function') {
    abrirSplitViewerLancamento(l);
  } else if (l.comprovante) {
    verComprovante(l.comprovante);
  } else if (l.anexoNome || l.anexoPath) {
    toast(`Anexo vinculado: ${l.anexoNome || ''}${l.anexoPath ? ' (' + l.anexoPath + ')' : ''}`, 'ok');
  }
}
/* ---- Sistema de Divisão de Contas (Split Bill / Rachar Conta) ---- */
function toggleCamposRacharConta() {
  const chk = document.getElementById('lanc-rachar-chk');
  const wrap = document.getElementById('lanc-rachar-wrap');
  if (!chk || !wrap) return;
  wrap.style.display = chk.checked ? 'block' : 'none';
  if (chk.checked) {
    const inpData = document.getElementById('lanc-rachar-data');
    const dataLanc = document.getElementById('lanc-data')?.value || hojeLocalISO();
    if (inpData && !inpData.value) inpData.value = dataLanc;
    const inpVal = document.getElementById('lanc-rachar-valor');
    if (inpVal && !inpVal.value) preencherMetadeRacharConta();
  }
}
function preencherMetadeRacharConta() {
  const valTotal = moedaToNumber(document.getElementById('lanc-valor')?.value);
  const inpVal = document.getElementById('lanc-rachar-valor');
  if (!inpVal || valTotal <= 0) return;
  const metade = Math.round((valTotal / 2) * 100) / 100;
  inpVal.value = toBRL(metade).replace('R$', 'R$ ');
}

function abrirModalLancamento(id) {
  popularContasSelect();
  popularParcelasSelect();
  const l = id ? STATE.lancamentos.find(x => x.id === id) : null;
  lancEmEdicao = l ? { ...l } : null;
  document.getElementById('lanc-modal-title').textContent = l ? 'Editar lançamento' : 'Novo lançamento';
  document.getElementById('lanc-id').value = l ? l.id : '';
  document.getElementById('lanc-tipo').value = l ? l.tipo : 'despesa';
  popularCategoriasSelect();
  document.getElementById('lanc-data').value = l ? (l.dataCompra || l.data) : hojeLocalISO();
  
  const itensGrupo = l ? obterItensGrupoParcelas(l) : [];
  const ehGrupo = itensGrupo.length > 1;

  if (ehGrupo) {
    const descBase = l.descricao ? l.descricao.replace(/\s*\(\d+\/\d+\)$/, '').trim() : '';
    document.getElementById('lanc-descricao').value = descBase || l.descricao;
    const totalGrupo = Math.round(itensGrupo.reduce((s, x) => s + (Number(x.valor) || 0), 0) * 100) / 100;
    document.getElementById('lanc-valor').value = toBRL(totalGrupo).replace('R$', 'R$ ');
    document.getElementById('lanc-valor-hint').textContent = `(Total das ${itensGrupo.length} parcelas · ${toBRL(l.valor)} cada)`;
  } else {
    document.getElementById('lanc-descricao').value = l ? l.descricao : '';
    document.getElementById('lanc-valor').value = l ? toBRL(l.valor).replace('R$','R$ ') : '';
    document.getElementById('lanc-valor-hint').textContent = '';
  }

  const selCat = document.getElementById('lanc-categoria');
  if (l && l.categoria) {
    if (![...selCat.options].some(o => o.value === l.categoria)) {
      selCat.insertAdjacentHTML('beforeend', `<option value="${escHtml(l.categoria)}">${escHtml(formatarCategoriaExibicao(l.categoria))}</option>`);
    }
    selCat.value = l.categoria;
  } else if (selCat.options.length > 0) {
    selCat.selectedIndex = 0;
  }
  document.getElementById('lanc-conta').value = l ? l.conta : (STATE.contas[0] ? STATE.contas[0].nome : '');
  document.getElementById('lanc-pago').checked = l ? estaPago(l) : true;
  document.getElementById('lanc-tags').value = (l && l.tags) ? l.tags.join(', ') : '';
  document.getElementById('lista-tags-existentes').innerHTML = todasAsTags().map(t => `<option value="${t}">`).join('');
  comprovanteAtual = (l && l.comprovante) ? l.comprovante : null;
  anexoMetaAtual = (l && (l.anexoNome || l.anexoPath)) ? { nome: l.anexoNome || '', path: l.anexoPath || '' } : null;
  renderComprovanteArea();
  const chkGarantia = document.getElementById('lanc-garantia-chk');
  const inpGarMeses = document.getElementById('lanc-garantia-meses');
  const inpGarFim = document.getElementById('lanc-garantia-fim');
  if (chkGarantia && inpGarMeses && inpGarFim) {
    chkGarantia.checked = !!(l && l.garantiaFim);
    inpGarMeses.value = (l && l.garantiaMeses) ? l.garantiaMeses : '';
    inpGarFim.value = (l && l.garantiaFim) ? l.garantiaFim : '';
    toggleCamposGarantiaModal();
  }
  const chkRachar = document.getElementById('lanc-rachar-chk');
  const inpRacharVal = document.getElementById('lanc-rachar-valor');
  const inpRacharData = document.getElementById('lanc-rachar-data');
  const inpRacharDesc = document.getElementById('lanc-rachar-desc');
  const wrapRachar = document.getElementById('lanc-rachar-wrap');
  const rowRachar = document.getElementById('lanc-split-bill-toggle-row');
  if (chkRachar) chkRachar.checked = false;
  if (inpRacharVal) inpRacharVal.value = '';
  if (inpRacharData) inpRacharData.value = hojeLocalISO();
  if (inpRacharDesc) inpRacharDesc.value = '';
  if (wrapRachar) wrapRachar.style.display = 'none';
  if (rowRachar) rowRachar.style.display = !l ? 'flex' : 'none';

  const chkReembolso = document.getElementById('lanc-reembolsavel-chk');
  const inpDevedor = document.getElementById('lanc-reembolsavel-devedor');
  const wrapReembolso = document.getElementById('lanc-reembolsavel-wrap');
  const rowReembolso = document.getElementById('lanc-reembolsavel-row');
  if (chkReembolso && inpDevedor && wrapReembolso) {
    chkReembolso.checked = !!(l && l.ehReembolsavel);
    inpDevedor.value = (l && l.reembolsoDevedor) ? l.reembolsoDevedor : '';
    wrapReembolso.style.display = (l && l.ehReembolsavel) ? 'block' : 'none';
    if (rowReembolso) rowReembolso.style.display = ((l ? l.tipo : document.getElementById('lanc-tipo').value) === 'despesa') ? 'flex' : 'none';
  }
  if (l && Array.isArray(l.subTransacoes) && l.subTransacoes.length >= 2) {
    splitLinhas = l.subTransacoes.map(s => ({ categoria: s.categoria, valor: Number(s.valor) || 0 }));
    alternarSplitLancamento(true);
  } else {
    splitLinhas = [];
    alternarSplitLancamento(false);
  }
  
  // Parcelas
  const parcelasSelect = document.getElementById('lanc-parcelas');
  const parcelasObs = document.getElementById('lanc-parcelas-obs');
  if (ehGrupo) {
    parcelasSelect.value = String(itensGrupo.length);
    parcelasSelect.disabled = true;
    parcelasObs.innerHTML = `<i class="ti ti-link"></i> Compra parcelada (${l.parcelaAtual || 1}/${itensGrupo.length}). Alterações em categoria, descrição, conta ou valor total serão aplicadas a todas as ${itensGrupo.length} parcelas.`;
    parcelasObs.style.display = '';
  } else if (l) {
    parcelasSelect.value = '1';
    parcelasSelect.disabled = true;
    parcelasObs.textContent = 'Parcelamento só pode ser definido na criação — para editar uma parcela existente, altere seus campos normalmente.';
    parcelasObs.style.display = '';
  } else {
    parcelasSelect.value = '1';
    parcelasSelect.disabled = false;
    parcelasObs.style.display = 'none';
  }
  abrirModal('modal-lancamento');
}
async function salvarLancamento() {
  const btnSalvar = document.getElementById('btn-salvar-lancamento') || document.querySelector('#modal-lancamento .modal-actions .btn-primary');
  if (btnSalvar && (btnSalvar.classList.contains('btn-loading') || btnSalvar.classList.contains('btn-success'))) {
    return;
  }
  avaliarExpressaoMoeda(document.getElementById('lanc-valor'));
  const id = document.getElementById('lanc-id').value;
  const data = document.getElementById('lanc-data').value;
  let descricao = document.getElementById('lanc-descricao').value.trim();
  const valorTotal = moedaToNumber(document.getElementById('lanc-valor').value);
  const tipo = document.getElementById('lanc-tipo').value;
  const categoria = document.getElementById('lanc-categoria').value;
  const conta = document.getElementById('lanc-conta').value;
  const pago = document.getElementById('lanc-pago').checked;
  const tags = parseTags(document.getElementById('lanc-tags').value);
  const parcelas = id ? 1 : (parseInt(document.getElementById('lanc-parcelas').value, 10) || 1);
  if (!data || !descricao || !valorTotal) { toast('Preencha data, descrição e valor.', 'err'); return; }

  // Modo Viagem Ativo: injeta automaticamente a hashtag da viagem em novos lançamentos
  if (!id && STATE.config && STATE.config.modoViagem && STATE.config.modoViagem.ativo && STATE.config.modoViagem.hashtag) {
    const tagViagem = STATE.config.modoViagem.hashtag.replace(/^#/, '');
    const regexTag = new RegExp('#' + escaparRegex(tagViagem) + '\\b', 'i');
    if (!regexTag.test(descricao)) {
      descricao = `${descricao} #${tagViagem}`;
    }
    if (!tags.some(t => t.toLowerCase() === tagViagem.toLowerCase())) {
      tags.push(tagViagem);
    }
  }

  // Garantia (Warranty Tracker)
  const possuiGarantia = document.getElementById('lanc-garantia-chk') && document.getElementById('lanc-garantia-chk').checked;
  let garantiaFim = undefined;
  let garantiaMeses = undefined;
  if (possuiGarantia) {
    const mesesVal = parseInt(document.getElementById('lanc-garantia-meses').value, 10);
    const dataFimVal = document.getElementById('lanc-garantia-fim').value;
    if (mesesVal > 0) garantiaMeses = mesesVal;
    if (dataFimVal) {
      garantiaFim = dataFimVal;
    } else if (mesesVal > 0) {
      garantiaFim = somarMeses(data, mesesVal);
    } else {
      garantiaFim = somarMeses(data, 12);
      garantiaMeses = 12;
    }
  }

  const anexoNome = anexoMetaAtual && anexoMetaAtual.nome ? anexoMetaAtual.nome : undefined;
  const anexoPath = anexoMetaAtual && anexoMetaAtual.path ? anexoMetaAtual.path : undefined;

  // Rastreador de Reembolsos (IOU Tracker)
  const ehReembolsavel = tipo === 'despesa' && document.getElementById('lanc-reembolsavel-chk') && document.getElementById('lanc-reembolsavel-chk').checked;
  const devedorReembolso = ehReembolsavel ? ((document.getElementById('lanc-reembolsavel-devedor') && document.getElementById('lanc-reembolsavel-devedor').value.trim()) || 'Terceiro') : undefined;

  // Divisão de Contas (Split Bill / Rachar Conta)
  const racharAtivo = !id && tipo === 'despesa' && document.getElementById('lanc-rachar-chk') && document.getElementById('lanc-rachar-chk').checked;
  let valorRachar = 0;
  let dataRachar = data;
  let descRachar = '';
  if (racharAtivo) {
    const inpValRachar = document.getElementById('lanc-rachar-valor');
    if (inpValRachar) avaliarExpressaoMoeda(inpValRachar);
    valorRachar = moedaToNumber(inpValRachar ? inpValRachar.value : '');
    if (!valorRachar || valorRachar <= 0) {
      toast('Informe o Valor a Receber de Terceiros para dividir a despesa.', 'err');
      return;
    }
    if (valorRachar > valorTotal) {
      toast('O valor a receber de terceiros não pode superar o valor total da despesa.', 'err');
      return;
    }
    dataRachar = (document.getElementById('lanc-rachar-data') && document.getElementById('lanc-rachar-data').value) || data || hojeLocalISO();
    const descInputRachar = (document.getElementById('lanc-rachar-desc') && document.getElementById('lanc-rachar-desc').value.trim()) || '';
    descRachar = descInputRachar ? `${descInputRachar} — ${descricao}` : `Reembolso (Rachar conta): ${descricao}`;
  }

  const injetarReceitaSplitBill = () => {
    if (!racharAtivo || !(valorRachar > 0)) return;
    const catRecPadrao = (STATE.categorias.find(c => c.tipo === 'receita' && c.nome === 'Outros') || STATE.categorias.find(c => c.tipo === 'receita') || { nome: 'Outros' }).nome;
    STATE.lancamentos.push({
      id: uid(),
      tipo: 'receita',
      data: dataRachar,
      descricao: descRachar,
      categoria: catRecPadrao,
      conta: conta,
      valor: Math.round(valorRachar * 100) / 100,
      origem: 'split_bill',
      sincronizado: false,
      pago: false,
      tags: tags.length ? [...tags] : undefined
    });
  };

  if (splitAtivoNoModal) {
    const somaSplit = splitLinhas.reduce((s, r) => s + (Number(r.valor) || 0), 0);
    if (splitLinhas.some(r => !r.categoria || !(r.valor > 0))) {
      toast('Preencha categoria e valor positivo em todas as linhas da divisão.', 'err');
      return;
    }
    if (Math.abs(somaSplit - valorTotal) >= 0.01) {
      toast(`A soma das categorias (${toBRL(somaSplit)}) deve ser exatamente igual ao valor total (${toBRL(valorTotal)}).`, 'err');
      return;
    }
    const parentId = id || uid();
    const subTransacoes = splitLinhas.map(r => ({ categoria: r.categoria, valor: Math.round(r.valor * 100) / 100 }));
    if (id) {
      const idx = STATE.lancamentos.findIndex(x => x.id === id);
      const anterior = idx >= 0 ? STATE.lancamentos[idx] : (lancEmEdicao && lancEmEdicao.id === id ? lancEmEdicao : { id });
      const editado = {
        ...anterior,
        tipo, data, descricao, categoria: subTransacoes[0].categoria, conta, valor: valorTotal, pago,
        comprovante: comprovanteAtual || undefined,
        anexoNome, anexoPath, tags, subTransacoes, parentId,
        ehReembolsavel: ehReembolsavel || (anterior.ehReembolsavel && !ehReembolsavel ? false : anterior.ehReembolsavel),
        reembolsoDevedor: devedorReembolso || (ehReembolsavel ? anterior.reembolsoDevedor : undefined),
        reembolsado: anterior.reembolsado || false,
        garantiaFim, garantiaMeses, sincronizado: false
      };
      if (idx >= 0) STATE.lancamentos[idx] = editado; else STATE.lancamentos.push(editado);
    } else {
      const cartaoConta = (tipo === 'despesa') ? (STATE.contas.find(c => c.nome === conta && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === conta)) : null;
      const dataSplit = data;
      let faturaAno = undefined;
      let faturaMes = undefined;
      let dataVencimentoFatura = undefined;
      if (cartaoConta) {
        const comp = competenciaFatura(data, cartaoConta.diaFechamento || 1);
        const fech = cartaoConta.diaFechamento || 1;
        faturaAno = comp.ano;
        faturaMes = comp.mes;
        dataVencimentoFatura = calcularVencimentoFatura(comp.ano, comp.mes, fech, cartaoConta.diaVencimento || 10);
      }

      subTransacoes.forEach((sub, idxSub) => {
        STATE.lancamentos.push({
          id: uid(), parentId, tipo, data: dataSplit,
          dataCompra: data,
          descricao: `${descricao} [${formatarCategoriaExibicao(sub.categoria)}]`,
          categoria: sub.categoria, conta, valor: sub.valor,
          origem: 'manual', sincronizado: false,
          pago: cartaoConta ? false : pago,
          posPagamentoFatura: (cartaoConta && faturaAno && faturaMes && STATE.config && STATE.config.faturasPagas && STATE.config.faturasPagas[`${conta}|${faturaAno}-${String(faturaMes).padStart(2, '0')}`]) ? true : undefined,
          tags,
          faturaAno, faturaMes, dataVencimentoFatura,
          subTransacoes: idxSub === 0 ? subTransacoes : undefined,
          ehReembolsavel: idxSub === 0 ? !!ehReembolsavel : undefined,
          reembolsoDevedor: idxSub === 0 ? devedorReembolso : undefined,
          reembolsado: idxSub === 0 ? false : undefined,
          comprovante: idxSub === 0 ? (comprovanteAtual || undefined) : undefined,
          anexoNome: idxSub === 0 ? anexoNome : undefined,
          anexoPath: idxSub === 0 ? anexoPath : undefined,
          garantiaFim: idxSub === 0 ? garantiaFim : undefined,
          garantiaMeses: idxSub === 0 ? garantiaMeses : undefined
        });
      });
      injetarReceitaSplitBill();
    }
    comprovanteAtual = null;
    anexoMetaAtual = null;
    splitLinhas = [];
    alternarSplitLancamento(false);
    await salvarDados();
    if (typeof SoundScape !== 'undefined' && SoundScape.playSave) SoundScape.playSave();
    fecharModal('modal-lancamento');
    renderPaginaAtiva();
    sincronizarEmSegundoPlano();
    toast(racharAtivo ? `Despesa dividida e receita pendente de ${toBRL(valorRachar)} gerada!` : `Lançamento dividido em ${subTransacoes.length} categorias salvo!`, 'ok');
    return;
  }

  if (id) {
    const idx = STATE.lancamentos.findIndex(x => x.id === id);
    const anterior = idx >= 0 ? STATE.lancamentos[idx] : (lancEmEdicao && lancEmEdicao.id === id ? lancEmEdicao : { id });
    const itensGrupo = anterior ? obterItensGrupoParcelas(anterior) : [];
    const ehGrupo = itensGrupo.length > 1;
    const grupoId = anterior.grupoId || anterior.parcelaGrupo || (ehGrupo ? itensGrupo[0].grupoId : null);

    if (ehGrupo) {
      // Edição em cadeia para compras parceladas
      const baseDesc = descricao.replace(/\s*\(\d+\/\d+\)$/, '').trim() || descricao;
      const totalAnterior = Math.round(itensGrupo.reduce((s, x) => s + (Number(x.valor) || 0), 0) * 100) / 100;
      const valorAlterado = Math.abs(valorTotal - totalAnterior) > 0.009;

      const n = itensGrupo.length;
      itensGrupo.sort((a, b) => (Number(a.parcelaAtual) || 1) - (Number(b.parcelaAtual) || 1));

      let valoresPorItem = [];
      if (valorAlterado) {
        const totalCentavos = Math.round(valorTotal * 100);
        const baseCentavos = Math.floor(totalCentavos / n);
        const restoCentavos = totalCentavos - baseCentavos * n;
        valoresPorItem = itensGrupo.map((_, i) => (baseCentavos + (i === n - 1 ? restoCentavos : 0)) / 100);
      }

      const cartaoConta = (tipo === 'despesa') ? (STATE.contas.find(c => c.nome === conta && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === conta)) : null;

      itensGrupo.forEach((item, i) => {
        const numParcela = item.parcelaAtual || (i + 1);
        const totParcelas = item.totalParcelas || item.parcelaTotal || n;
        const novoValor = valorAlterado ? valoresPorItem[i] : item.valor;

        item.descricao = `${baseDesc} (${numParcela}/${totParcelas})`;
        item.categoria = categoria;
        item.conta = conta;
        item.tags = tags;
        item.valor = novoValor;
        item.grupoId = grupoId;
        item.parcelaGrupo = grupoId;
        item.parcelaAtual = numParcela;
        item.totalParcelas = totParcelas;
        item.parcelaTotal = totParcelas;
        item.sincronizado = false;

        if (cartaoConta) {
          const dataBase = item.dataCompra || item.data;
          const compInicial = competenciaFatura(dataBase, cartaoConta.diaFechamento || 1);
          let mFat = compInicial.mes + (numParcela - 1);
          let aFat = compInicial.ano + Math.floor((mFat - 1) / 12);
          mFat = ((mFat - 1) % 12) + 1;
          item.faturaAno = aFat;
          item.faturaMes = mFat;
          item.dataVencimentoFatura = calcularVencimentoFatura(aFat, mFat, cartaoConta.diaFechamento || 1, cartaoConta.diaVencimento || 10);
          if (item.dataCompra) {
            item.data = somarMeses(item.dataCompra, numParcela - 1);
          }
        }

        if (item.id === id) {
          item.pago = cartaoConta ? (item.faturaPaga === true) : pago;
          item.tipo = tipo;
          if (comprovanteAtual) item.comprovante = comprovanteAtual;
          if (anexoNome) item.anexoNome = anexoNome;
          if (anexoPath) item.anexoPath = anexoPath;
          if (garantiaFim) item.garantiaFim = garantiaFim;
          if (garantiaMeses) item.garantiaMeses = garantiaMeses;
          item.ehReembolsavel = ehReembolsavel || (anterior.ehReembolsavel && !ehReembolsavel ? false : anterior.ehReembolsavel);
          item.reembolsoDevedor = devedorReembolso || (ehReembolsavel ? anterior.reembolsoDevedor : undefined);
          item.reembolsado = anterior.reembolsado || false;
        }
      });
      toast(`Compra parcelada atualizada em lote (${n} parcelas).`, 'ok');
    } else {
      // Edição de item único
      const cartaoConta = (tipo === 'despesa') ? (STATE.contas.find(c => c.nome === conta && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === conta)) : null;
      const dataLancamento = data;
      let faturaAno = anterior.faturaAno;
      let faturaMes = anterior.faturaMes;
      let dataVencimentoFatura = anterior.dataVencimentoFatura;
      let dataCompra = anterior.dataCompra || data;

      if (cartaoConta) {
        const comp = competenciaFatura(data, cartaoConta.diaFechamento || 1);
        const fech = cartaoConta.diaFechamento || 1;
        faturaAno = comp.ano;
        faturaMes = comp.mes;
        dataVencimentoFatura = calcularVencimentoFatura(comp.ano, comp.mes, fech, cartaoConta.diaVencimento || 10);
        dataCompra = data;
      }

      const descOriginalPreservada = anterior.descricaoOriginal
        || (anterior.descricao && anterior.descricao !== descricao ? anterior.descricao : undefined);
      const editado = {
        ...anterior,
        tipo, data: dataLancamento, dataCompra, descricao,
        descricaoOriginal: descOriginalPreservada,
        categoria, conta, valor: valorTotal,
        pago: cartaoConta ? (anterior.faturaPaga === true) : pago,
        faturaPaga: cartaoConta ? (anterior.faturaPaga === true ? true : undefined) : anterior.faturaPaga,
        faturaAno, faturaMes, dataVencimentoFatura,
        comprovante: comprovanteAtual || undefined,
        anexoNome, anexoPath,
        tags,
        ehReembolsavel: ehReembolsavel || (anterior.ehReembolsavel && !ehReembolsavel ? false : anterior.ehReembolsavel),
        reembolsoDevedor: devedorReembolso || (ehReembolsavel ? anterior.reembolsoDevedor : undefined),
        reembolsado: anterior.reembolsado || false,
        garantiaFim, garantiaMeses,
        sincronizado: false
      };
      if (idx >= 0) STATE.lancamentos[idx] = editado; else STATE.lancamentos.push(editado);
      if (anterior && (anterior.categoria !== categoria || anterior.descricao !== descricao)) {
        window.__pendenteAprendizadoSalvar = {
          lanc: editado,
          categoria,
          apelidoSugerido: (descOriginalPreservada && descOriginalPreservada !== descricao) ? descricao : ''
        };
      }
    }
  } else if (parcelas > 1) {
    // Novo lançamento parcelado: divide o valor total em N parcelas mensais
    const grupoId = uid();
    const totalCentavos = Math.round(valorTotal * 100);
    const baseCentavos = Math.floor(totalCentavos / parcelas);
    const restoCentavos = totalCentavos - baseCentavos * parcelas;

    const cartaoConta = (tipo === 'despesa') ? (STATE.contas.find(c => c.nome === conta && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === conta)) : null;
    const compInicial = cartaoConta ? competenciaFatura(data, cartaoConta.diaFechamento || 1) : null;

    for (let i = 1; i <= parcelas; i++) {
      const centavos = baseCentavos + (i === parcelas ? restoCentavos : 0);
      const dataParcela = somarMeses(data, i - 1);
      let faturaAno = undefined;
      let faturaMes = undefined;
      let dataVencimentoFatura = undefined;

      if (cartaoConta && compInicial) {
        let mFat = compInicial.mes + (i - 1);
        let aFat = compInicial.ano + Math.floor((mFat - 1) / 12);
        mFat = ((mFat - 1) % 12) + 1;
        faturaAno = aFat;
        faturaMes = mFat;
        dataVencimentoFatura = calcularVencimentoFatura(aFat, mFat, cartaoConta.diaFechamento || 1, cartaoConta.diaVencimento || 10);
      }

      STATE.lancamentos.push({
        id: uid(), tipo, data: dataParcela,
        dataCompra: data,
        descricao: `${descricao} (${i}/${parcelas})`,
        categoria, conta, valor: centavos / 100,
        origem: 'manual', sincronizado: false,
        grupoId: grupoId,
        parcelaGrupo: grupoId,
        parcelaAtual: i,
        parcelaTotal: parcelas,
        totalParcelas: parcelas,
        faturaAno, faturaMes, dataVencimentoFatura,
        pago: false,
        posPagamentoFatura: (cartaoConta && faturaAno && faturaMes && STATE.config && STATE.config.faturasPagas && STATE.config.faturasPagas[`${conta}|${faturaAno}-${String(faturaMes).padStart(2, '0')}`]) ? true : undefined,
        tags,
        ehReembolsavel: i === 1 ? !!ehReembolsavel : undefined,
        reembolsoDevedor: i === 1 ? devedorReembolso : undefined,
        reembolsado: false,
        comprovante: i === 1 ? (comprovanteAtual || undefined) : undefined,
        anexoNome: i === 1 ? anexoNome : undefined,
        anexoPath: i === 1 ? anexoPath : undefined,
        garantiaFim: i === 1 ? garantiaFim : undefined,
        garantiaMeses: i === 1 ? garantiaMeses : undefined
      });
    }
    toast(`${parcelas} parcelas criadas, distribuídas mês a mês no cartão/conta.`, 'ok');
  } else {
    const cartaoConta = (tipo === 'despesa') ? (STATE.contas.find(c => c.nome === conta && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === conta)) : null;
    const dataLancamento = data;
    let faturaAno = undefined;
    let faturaMes = undefined;
    let dataVencimentoFatura = undefined;
    if (cartaoConta) {
      const comp = competenciaFatura(data, cartaoConta.diaFechamento || 1);
      const fech = cartaoConta.diaFechamento || 1;
      faturaAno = comp.ano;
      faturaMes = comp.mes;
      dataVencimentoFatura = calcularVencimentoFatura(comp.ano, comp.mes, fech, cartaoConta.diaVencimento || 10);
    }

    STATE.lancamentos.push({
      id: uid(), tipo, data: dataLancamento,
      dataCompra: data,
      descricao, categoria, conta, valor: valorTotal,
      origem: 'manual', sincronizado: false,
      faturaAno, faturaMes, dataVencimentoFatura,
      pago: cartaoConta ? false : pago,
      posPagamentoFatura: (cartaoConta && faturaAno && faturaMes && STATE.config && STATE.config.faturasPagas && STATE.config.faturasPagas[`${conta}|${faturaAno}-${String(faturaMes).padStart(2, '0')}`]) ? true : undefined,
      tags,
      ehReembolsavel: !!ehReembolsavel,
      reembolsoDevedor: devedorReembolso,
      reembolsado: false,
      comprovante: comprovanteAtual || undefined,
      anexoNome, anexoPath,
      garantiaFim, garantiaMeses
    });
  }
  if (!id) injetarReceitaSplitBill();
  comprovanteAtual = null;
  anexoMetaAtual = null;
  if (btnSalvar) {
    btnSalvar.classList.add('btn-morphing', 'btn-loading');
  }
  const savePromise = salvarDados();
  const minWait = new Promise(res => setTimeout(res, 400));
  await Promise.all([savePromise, minWait]);

  if (btnSalvar) {
    btnSalvar.classList.remove('btn-loading');
    btnSalvar.classList.add('btn-success');
  }
  if (typeof SoundScape !== 'undefined' && SoundScape.playSave) SoundScape.playSave();
  await new Promise(res => setTimeout(res, 600));

  fecharModal('modal-lancamento');
  if (btnSalvar) {
    btnSalvar.classList.remove('btn-loading', 'btn-success', 'btn-morphing');
  }
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  if (racharAtivo) {
    toast(`Despesa salva e Receita Pendente de ${toBRL(valorRachar)} criada!`, 'ok');
  } else if (parcelas <= 1) {
    toast('Lançamento salvo.', 'ok');
  }
  if (window.__pendenteAprendizadoSalvar) {
    const infoApr = window.__pendenteAprendizadoSalvar;
    window.__pendenteAprendizadoSalvar = null;
    if (typeof oferecerAprendizadoRegra === 'function') {
      oferecerAprendizadoRegra(infoApr.lanc, infoApr.categoria, { apelidoSugerido: infoApr.apelidoSugerido });
    }
  }
}
/* ================= LIXEIRA / EXCLUSÕES ================= */
const LIXEIRA_DIAS = 30;
const LIXEIRA_MAX_BYTES = 3000000; // teto de espaço pra lixeira no armazenamento local (a entrada mais recente nunca é descartada)
function limparLixeira() {
  const limite = Date.now() - LIXEIRA_DIAS * 86400000;
  STATE.lixeira = (STATE.lixeira || []).filter(e => new Date(e.excluidoEm).getTime() >= limite);
  while (STATE.lixeira.length > 1 && JSON.stringify(STATE.lixeira).length > LIXEIRA_MAX_BYTES) STATE.lixeira.pop();
}
function chaveRecorrenteIgnorada(l) { return l.recorrenteId && l.data ? l.recorrenteId + '|' + l.data.slice(0, 7) : null; }
// Registra uma exclusão: guarda na lixeira (como UMA entrada, pra poder desfazer a ação inteira), marca os IDs como
// "apagados pendentes" (a sincronização não deixa a planilha trazê-los de volta) e impede a recorrência de recriar o mês.
function registrarExclusao(itens, rotulo) {
  if (!itens.length) return null;
  const entrada = { id: uid(), excluidoEm: new Date().toISOString(), rotulo, itens: itens.map(l => ({ ...l })) };
  STATE.lixeira.unshift(entrada);
  const pend = new Set(STATE.excluidosPendentes), ign = new Set(STATE.recorrentesIgnorados);
  itens.forEach(l => { if (l.id) pend.add(l.id); const k = chaveRecorrenteIgnorada(l); if (k) ign.add(k); });
  STATE.excluidosPendentes = [...pend];
  STATE.recorrentesIgnorados = [...ign];
  limparLixeira();
  return entrada.id;
}
async function restaurarDaLixeira(entradaId) {
  const idx = STATE.lixeira.findIndex(e => e.id === entradaId);
  if (idx < 0) return 0;
  const entrada = STATE.lixeira[idx];
  const existentes = new Set(STATE.lancamentos.map(l => l.id));
  const ids = new Set(), chaves = new Set();
  let n = 0;
  entrada.itens.forEach(l => {
    ids.add(l.id); const k = chaveRecorrenteIgnorada(l); if (k) chaves.add(k);
    if (existentes.has(l.id)) return;
    STATE.lancamentos.push({ ...l, sincronizado: false }); // volta como "ainda não enviado" -> sobe de novo pra planilha
    n++;
  });
  STATE.excluidosPendentes = STATE.excluidosPendentes.filter(id => !ids.has(id));
  STATE.recorrentesIgnorados = STATE.recorrentesIgnorados.filter(k => !chaves.has(k));
  STATE.lixeira.splice(idx, 1);
  await salvarDados();
  renderPaginaAtiva();
  atualizarContagemLixeira();
  if (document.getElementById('modal-lixeira').classList.contains('show')) renderLixeira();
  sincronizarEmSegundoPlano();
  return n;
}
function toastDesfazer(msg, entradaId) {
  const t = document.getElementById('toast');
  t.innerHTML = '';
  const texto = document.createElement('span'); texto.textContent = msg;
  const btn = document.createElement('button'); btn.type = 'button'; btn.className = 'toast-acao'; btn.textContent = 'Desfazer';
  btn.onclick = async () => {
    t.classList.remove('show');
    const n = await restaurarDaLixeira(entradaId);
    toast(n ? 'Exclusão desfeita.' : 'Nada a restaurar.', n ? 'ok' : 'err');
  };
  t.append(texto, btn);
  t.className = 'toast show ok com-acao';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 8000);
}
function atualizarContagemLixeira() {
  const el = document.getElementById('lixeira-contagem');
  if (el) el.textContent = STATE.lixeira.length ? '(' + STATE.lixeira.length + ')' : '';
}
function abrirLixeira() { renderLixeira(); abrirModal('modal-lixeira'); }
function renderLixeira() {
  const lista = STATE.lixeira;
  document.getElementById('lixeira-vazia').style.display = lista.length ? 'none' : 'block';
  document.getElementById('btn-esvaziar-lixeira').style.display = lista.length ? '' : 'none';
  document.getElementById('lixeira-tbody').innerHTML = lista.map(e => {
    const quando = new Date(e.excluidoEm).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    const valor = e.itens.length === 1 ? toBRL(e.itens[0].valor) : e.itens.length + ' itens';
    const diasRestantes = Math.max(0, Math.ceil((new Date(e.excluidoEm).getTime() + LIXEIRA_DIAS * 86400000 - Date.now()) / 86400000));
    return `<tr>
      <td>${quando}<div class="help-text" style="margin:0">some em ${diasRestantes} dia(s)</div></td>
      <td>${e.rotulo}</td>
      <td style="text-align:right">${valor}</td>
      <td style="text-align:right;white-space:nowrap">
        <button class="btn btn-sm" onclick="restaurarEntradaLixeira('${e.id}')"><i class="ti ti-arrow-back-up"></i> Restaurar</button>
        <button class="icon-btn danger" onclick="excluirDefinitivamente('${e.id}')" title="Excluir definitivamente"><i class="ti ti-trash-x"></i></button>
      </td>
    </tr>`;
  }).join('');
}
async function restaurarEntradaLixeira(id) {
  const n = await restaurarDaLixeira(id);
  toast(n ? `${n} lançamento(s) restaurado(s).` : 'Nada a restaurar.', n ? 'ok' : 'err');
}
function excluirDefinitivamente(id) {
  abrirConfirmacao('Excluir definitivamente? Depois disso não dá mais pra restaurar.', async () => {
    STATE.lixeira = STATE.lixeira.filter(e => e.id !== id);
    await salvarDados(); renderLixeira(); atualizarContagemLixeira();
  }, 'Excluir definitivamente');
}
function esvaziarLixeira() {
  if (!STATE.lixeira.length) return;
  abrirConfirmacao('Esvaziar a lixeira? Os itens dela não poderão mais ser restaurados.', async () => {
    STATE.lixeira = [];
    await salvarDados(); renderLixeira(); atualizarContagemLixeira();
  }, 'Esvaziar lixeira');
}

async function excluirLancamento(id) {
  const l = STATE.lancamentos.find(x => x.id === id);
  if (!l) return;
  const grupoTransfId = obterTransferenciaId(l);
  if (isLancamentoTransferencia(l) && grupoTransfId) {
    await excluirTransferencia(grupoTransfId);
    return;
  }
  const itensGrupo = obterItensGrupoParcelas(l);
  if (itensGrupo.length > 1) {
    abrirConfirmacaoExclusaoParcelas(l, itensGrupo);
    return;
  }
  await executarExclusaoParcelaUnica(l);
}

async function executarExclusaoParcelaUnica(l) {
  STATE.lancamentos = STATE.lancamentos.filter(x => x.id !== l.id);
  const entradaId = registrarExclusao([l], l.descricao || 'Lançamento');
  if (typeof SoundScape !== 'undefined' && SoundScape.playDelete) SoundScape.playDelete();
  await salvarDados();
  renderPaginaAtiva(); atualizarContagemLixeira();
  sincronizarEmSegundoPlano();
  toastDesfazer(`"${l.descricao || 'Lançamento'}" excluído.`, entradaId);
}

async function executarExclusaoGrupoParcelas(itens, l) {
  const ids = new Set(itens.map(x => x.id));
  STATE.lancamentos = STATE.lancamentos.filter(x => !ids.has(x.id));
  const descBase = (l.descricao || 'Compra parcelada').replace(/\s*\(\d+\/\d+\)$/, '').trim();
  const rotulo = `${descBase} (${itens.length} parcelas)`;
  const entradaId = registrarExclusao(itens, rotulo);
  if (typeof SoundScape !== 'undefined' && SoundScape.playDelete) SoundScape.playDelete();
  await salvarDados();
  renderPaginaAtiva(); atualizarContagemLixeira();
  sincronizarEmSegundoPlano();
  toastDesfazer(`Compra inteira "${descBase}" (${itens.length} parcelas) excluída.`, entradaId);
}

/* ================= LANÇAMENTO RÁPIDO (TEXTO LIVRE / SMART ADD) ================= */
function escaparRegex(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

const MAPA_SMART_CATEGORIAS = [
  { re: /\b(ifood|rappi|99food|uber\s*eats|mercado|supermercado|padaria|restaurante|lanche|almo[cç]o|jantar|pizza|hamb[uú]rguer|burger|caf[eé]|a[cç]ougue|hortifruti|feira)\b/i, cat: 'Alimentação' },
  { re: /\b(uber|99|99pop|t[aá]xi|gasolina|combust[ií]vel|etanol|diesel|estacionamento|ped[aá]gio|metr[oô]|ônibus|onibus|passagem|oficina|ipva)\b/i, cat: 'Transporte' },
  { re: /\b(aluguel|condom[ií]nio|luz|energia|enel|cemig|cpfl|[aá]gua|sabesp|g[aá]s|internet|vivo|claro|tim|oi|iptu|faxina)\b/i, cat: 'Moradia' },
  { re: /\b(farm[aá]cia|drogaria|rem[eé]dio|m[eé]dico|consulta|exame|dentista|psic[oó]logo|hospital|plano\s*de\s*sa[uú]de|academia|smartfit)\b/i, cat: 'Saúde' },
  { re: /\b(netflix|spotify|amazon|prime|disney|hbo|max|cinema|ingresso|show|bar|cerveja| festa|jogo|steam|playstation|xbox|viagem|hotel|airbnb)\b/i, cat: 'Lazer' },
  { re: /\b(curso|faculdade|escola|livro|udemy|alura|mensalidade|material)\b/i, cat: 'Educação' },
  { re: /\b(sal[aá]rio|adiantamento|13º|d[eé]cimo|holerite|pro-labore|pr[oó]-labore)\b/i, cat: 'Salário' },
  { re: /\b(freela|freelance|projeto|consultoria|servi[cç]o|bico|comiss[aã]o)\b/i, cat: 'Freelance' },
  { re: /\b(dividendo|dividendos|rendimento|rendimentos|fii|cdb|tesouro|juros|investimento)\b/i, cat: 'Investimentos' }
];

function inferirCategoriaSmartAdd(texto, descricao, tipo) {
  const porRegra = aplicarRegraCategorizacao(descricao) || aplicarRegraCategorizacao(texto);
  if (porRegra) return porRegra;
  const doTipo = STATE.categorias.filter(c => c.tipo === tipo);
  for (const item of MAPA_SMART_CATEGORIAS) {
    if (item.re.test(texto) || item.re.test(descricao)) {
      const catExistente = STATE.categorias.find(c => c.nome.toLowerCase() === item.cat.toLowerCase());
      return catExistente ? catExistente.nome : item.cat;
    }
  }
  return (doTipo.find(c => c.nome === 'Outros') || doTipo[0] || {}).nome || 'Outros';
}

function removerAcentos(s) {
  return String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function identificarContaSmartAdd(textoAtual) {
  let t = textoAtual;
  const contasOrdenadas = [...(STATE.contas || [])].sort((a, b) => b.nome.length - a.nome.length);
  const stopWordsConta = new Set(['conta', 'cartao', 'banco', 'corrente', 'credito', 'debito', 'meu', 'minha', 'da', 'do', 'de']);
  const prepPattern = '(?:(?:no|na|em|pelo|pela|via|pro|pra|para|do|da)\\s+(?:minha\\s+|meu\\s+)?(?:conta\\s+|cart[aã]o\\s+|banco\\s+)?)?';

  // 1. Tentativa pelo nome completo da conta cadastrada (ignorando acentos e com preposições opcionais)
  for (const c of contasOrdenadas) {
    const tokensNome = c.nome.trim().split(/\s+/).map(p => {
      const limpo = removerAcentos(p);
      return limpo.split('').map(ch => {
        if (/[aA]/.test(ch)) return '[aáàâãAÁÀÂÃ]';
        if (/[eE]/.test(ch)) return '[eéêEÉÊ]';
        if (/[iI]/.test(ch)) return '[iíIÍ]';
        if (/[oO]/.test(ch)) return '[oóôõOÓÔÕ]';
        if (/[uU]/.test(ch)) return '[uúüUÚÜ]';
        if (/[cC]/.test(ch)) return '[cçCÇ]';
        return escaparRegex(ch);
      }).join('');
    }).join('\\s+');
    const reFull = new RegExp('(^|\\s)' + prepPattern + '(' + tokensNome + ')(?=\\s|$|[.,;!?])', 'i');
    if (reFull.test(t)) {
      t = t.replace(reFull, ' ');
      return { conta: c.nome, explicita: true, textoRestante: t };
    }
  }

  // 2. Tentativa por palavra-chave única do nome da conta (ex: "Itaú" para "Conta Itaú", "Nubank" para "Cartão Nubank")
  for (const c of contasOrdenadas) {
    const partes = c.nome.trim().split(/\s+/).filter(p => p.length >= 3 && !stopWordsConta.has(removerAcentos(p).toLowerCase()));
    for (const parte of partes) {
      const flexParte = removerAcentos(parte).split('').map(ch => {
        if (/[aA]/.test(ch)) return '[aáàâãAÁÀÂÃ]';
        if (/[eE]/.test(ch)) return '[eéêEÉÊ]';
        if (/[iI]/.test(ch)) return '[iíIÍ]';
        if (/[oO]/.test(ch)) return '[oóôõOÓÔÕ]';
        if (/[uU]/.test(ch)) return '[uúüUÚÜ]';
        if (/[cC]/.test(ch)) return '[cçCÇ]';
        return escaparRegex(ch);
      }).join('');
      const rePart = new RegExp('(^|\\s)' + prepPattern + '(' + flexParte + ')(?=\\s|$|[.,;!?])', 'i');
      if (rePart.test(t)) {
        t = t.replace(rePart, ' ');
        return { conta: c.nome, explicita: true, textoRestante: t };
      }
    }
  }

  // 3. Menção genérica a "no cartão / no crédito" -> seleciona o primeiro cartão de crédito cadastrado
  const reCartaoGen = /(^|\s)(?:no|pelo|via|em)?\s*(?:cart[aã]o(?:\s+de\s+cr[eé]dito)?|cr[eé]dito)(?=\s|$|[.,;!?])/i;
  if (reCartaoGen.test(t)) {
    const primeiroCartao = (STATE.contas || []).find(c => c.tipo === 'cartao');
    if (primeiroCartao) {
      t = t.replace(reCartaoGen, ' ');
      return { conta: primeiroCartao.nome, explicita: true, textoRestante: t };
    }
  }

  // 4. Menção a "pix / débito / dinheiro / carteira" -> seleciona conta corrente/carteira correspondente
  const reContaGen = /(^|\s)(?:no|na|via|pelo|em)?\s*(pix|d[eé]bito|dinheiro|esp[eé]cie|carteira)(?=\s|$|[.,;!?])/i;
  const mGen = t.match(reContaGen);
  if (mGen) {
    const termo = removerAcentos(mGen[2]).toLowerCase();
    let contaAlvo = null;
    if (termo === 'dinheiro' || termo === 'especie' || termo === 'carteira') {
      contaAlvo = (STATE.contas || []).find(c => /carteira|dinheiro|especie/i.test(removerAcentos(c.nome)));
    }
    if (!contaAlvo) contaAlvo = (STATE.contas || []).find(c => c.tipo !== 'cartao') || STATE.contas[0];
    if (contaAlvo) {
      t = t.replace(reContaGen, ' ');
      return { conta: contaAlvo.nome, explicita: true, textoRestante: t };
    }
  }

  // 5. Fallback para a conta padrão
  const padrao = (STATE.contas || []).find(c => c.tipo !== 'cartao') || (STATE.contas || [])[0];
  return { conta: padrao ? padrao.nome : '', explicita: false, textoRestante: t };
}

// Interpreta frases como "Uber 25,90 ontem no Nubank", "Ifood 50 hoje Itaú", "recebi 300 freela na Carteira".
// Devolve { erro } se não der pra entender, ou os campos prontos do lançamento.
function parseLancamentoRapido(textoOriginal) {
  const original = String(textoOriginal || '').trim();
  if (!original) return { erro: 'Digite algo, ex: "Uber 25,90 ontem no Nubank".' };
  let t = ' ' + original + ' ';
  const pad = (n) => String(n).padStart(2, '0');

  // #tags (underline vira espaço: #Viagem_Portugal -> "Viagem Portugal")
  const tagsBrutas = [];
  t = t.replace(/#([\wÀ-ÿ_-]+)/g, (_, tg) => { tagsBrutas.push(tg.replace(/_/g, ' ')); return ' '; });

  // data: anteontem / ontem / hoje / amanhã / dd/mm / dd/mm/aaaa (sem data, vale hoje)
  let data = hojeLocalISO();
  let dataLabel = 'Hoje';
  const relativas = [
    [/(^|\s)anteontem(?=\s|$)/i, -2, 'Anteontem'],
    [/(^|\s)ontem(?=\s|$)/i, -1, 'Ontem'],
    [/(^|\s)hoje(?=\s|$)/i, 0, 'Hoje'],
    [/(^|\s)amanh[aã](?=\s|$)/i, 1, 'Amanhã']
  ];
  let achouRelativa = false;
  for (const [re, desloc, rotulo] of relativas) {
    if (re.test(t)) { data = hojeLocalISO(desloc); dataLabel = rotulo; t = t.replace(re, ' '); achouRelativa = true; break; }
  }
  if (!achouRelativa) {
    const m = t.match(/(^|\s)(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?(?=\s|$)/);
    if (m) {
      const dia = parseInt(m[2], 10), mes = parseInt(m[3], 10);
      let ano = m[4] ? parseInt(m[4], 10) : new Date().getFullYear();
      if (ano < 100) ano += 2000;
      const teste = new Date(ano, mes - 1, dia);
      if (teste.getFullYear() !== ano || teste.getMonth() !== mes - 1 || teste.getDate() !== dia) {
        return { erro: `Data inválida: ${m[2]}/${m[3]}.` };
      }
      data = `${ano}-${pad(mes)}-${pad(dia)}`;
      dataLabel = `${pad(dia)}/${pad(mes)}/${ano}`;
      t = t.replace(m[0], ' ');
    }
  }

  // conta: identifica a conta ou cartão onde entrou a receita ou saiu a despesa
  const resConta = identificarContaSmartAdd(t);
  const conta = resConta.conta;
  const contaExplicita = resConta.explicita;
  t = resConta.textoRestante;

  // valor: números "soltos" (aceita 25, 25,90, 25.90, 1.250 e 1.250,00). Prefere o último com centavos; senão o último número.
  t = t.replace(/R\$\s*/gi, ' ').replace(/(^|\s)reais?(?=\s|$)/gi, ' ');
  const reNum = /(^|\s)(\d{1,3}(?:\.\d{3})+(?:,\d{1,2})?|\d+(?:[.,]\d{1,2})?)(?=\s|$)/g;
  const candidatos = [];
  let mm;
  while ((mm = reNum.exec(t)) !== null) {
    candidatos.push({ token: mm[2], inicio: mm.index + mm[1].length });
    if (mm[0].length === 0) reNum.lastIndex++;
  }
  if (!candidatos.length) return { erro: 'Digite um valor numérico (ex: "Ifood 50 hoje no Nubank").' };
  const temCentavos = (tok) => /,\d{1,2}$/.test(tok) || /^\d+\.\d{1,2}$/.test(tok);
  const escolhido = [...candidatos].reverse().find(c => temCentavos(c.token)) || candidatos[candidatos.length - 1];
  const numero = /^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(escolhido.token)
    ? parseFloat(escolhido.token.replace(/\./g, '').replace(',', '.'))
    : parseFloat(escolhido.token.replace(',', '.'));
  if (!(numero > 0)) return { erro: 'O valor precisa ser maior que zero.' };
  t = t.slice(0, escolhido.inicio) + ' ' + t.slice(escolhido.inicio + escolhido.token.length);

  // tipo: palavras que indicam entrada de dinheiro; senão é despesa
  const tipo = /(^|\s)(recebi|recebido|receita|entrada|sal[aá]rio|venda|vendi|reembolso|rendimentos?|dividendos?|freela|entrou|caiu|deposito|dep[oó]sito)(?=\s|$)/i.test(original) ? 'receita' : 'despesa';
  t = t.replace(/(^|\s)(recebi|recebido|entrou|caiu)(?=\s|$)/gi, ' ');
  // limpa preposições soltas que sobraram nas pontas
  t = t.replace(/(^|\s)(no|na|em|pelo|pela|via|por|de|do|da)(?=\s*$)/gi, ' ');

  let descricao = t.replace(/\s{2,}/g, ' ').trim();
  if (!descricao) descricao = tipo === 'receita' ? 'Receita' : 'Despesa';
  descricao = descricao.charAt(0).toUpperCase() + descricao.slice(1);

  const categoria = inferirCategoriaSmartAdd(original, descricao, tipo);

  return { data, dataLabel, valor: numero, tipo, descricao, categoria, conta, contaExplicita, tags: parseTags(tagsBrutas.join(',')), pago: data <= hojeLocalISO() };
}

function atualizarPreviewSmartAdd() {
  const campo = document.getElementById('rapido-texto');
  const prev = document.getElementById('rapido-preview');
  if (!campo || !prev) return;
  const val = campo.value.trim();
  if (!val) {
    prev.className = 'smart-add-preview';
    prev.innerHTML = '';
    return;
  }
  const r = parseLancamentoRapido(val);
  if (r.erro) {
    prev.className = 'smart-add-preview show erro';
    prev.innerHTML = `<i class="ti ti-info-circle"></i> <span>${r.erro}</span>`;
    return;
  }
  const tipoTxt = r.tipo === 'receita' ? 'Receita' : 'Despesa';
  const acaoContaTxt = r.tipo === 'receita' ? 'Entrou na conta' : 'Saiu da conta';
  const objConta = (STATE.contas || []).find(c => c.nome === r.conta);
  const iconeConta = objConta && objConta.tipo === 'cartao' ? 'ti-credit-card' : 'ti-building-bank';
  const tagsTxt = r.tags && r.tags.length ? ` · ${r.tags.map(tg => '#' + tg).join(' ')}` : '';
  prev.className = 'smart-add-preview show';
  prev.innerHTML = `<i class="ti ti-sparkles"></i> <span>${tipoTxt} de <strong>${toBRL(r.valor)}</strong> em <strong>${r.categoria || 'Outros'}</strong> (${r.dataLabel}) · <i class="ti ${iconeConta}" style="vertical-align:-1px"></i> ${acaoContaTxt}: <strong>${r.conta || 'Padrão'}</strong>${r.contaExplicita ? '' : ' <em style="opacity:.75;font-weight:400">(padrão)</em>'} — "${r.descricao}"${tagsTxt}</span>`;
}

async function criarLancamentoRapido() {
  const campo = document.getElementById('rapido-texto');
  const r = parseLancamentoRapido(campo.value);
  if (r.erro) { toast(r.erro, 'err'); return; }
  const tagsFinais = Array.isArray(r.tags) ? [...r.tags] : [];
  if (STATE.config && STATE.config.modoViagem && STATE.config.modoViagem.ativo && STATE.config.modoViagem.hashtag) {
    const tagViagem = STATE.config.modoViagem.hashtag.replace(/^#/, '');
    if (!tagsFinais.some(t => t.toLowerCase() === tagViagem.toLowerCase())) {
      tagsFinais.push(tagViagem);
    }
  }
  const descComTags = tagsFinais.length
    ? `${r.descricao} ${tagsFinais.map(tg => '#' + tg.replace(/\s+/g, '_')).join(' ')}`
    : r.descricao;
  STATE.lancamentos.push({
    id: uid(), tipo: r.tipo, data: r.data, descricao: descComTags, categoria: r.categoria, conta: r.conta,
    valor: r.valor, origem: 'manual', sincronizado: false, pago: r.pago, tags: tagsFinais
  });
  campo.value = '';
  atualizarPreviewSmartAdd();
  if (typeof SoundScape !== 'undefined' && SoundScape.playSave) SoundScape.playSave();
  await salvarDados();
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  const [a, m, d] = r.data.split('-');
  toast(`Lançado: ${r.descricao} · ${toBRL(r.valor)} · ${d}/${m}/${a} · ${r.categoria || 'sem categoria'} (${r.conta})${r.pago ? '' : ' · pendente'}`, 'ok');
  campo.focus();
}

/* ================= TRANSFERÊNCIA ENTRE CONTAS ================= */
function abrirModalTransferencia() {
  const opts = STATE.contas.map(c => `<option value="${c.nome}">${c.nome}${c.tipo==='cartao' ? ' (cartão)' : ''}</option>`).join('');
  document.getElementById('transf-origem').innerHTML = opts;
  document.getElementById('transf-destino').innerHTML = opts;
  if (STATE.contas.length > 1) document.getElementById('transf-destino').selectedIndex = 1;
  document.getElementById('transf-valor').value = '';
  document.getElementById('transf-descricao').value = '';
  document.getElementById('transf-data').value = hojeLocalISO();
  abrirModal('modal-transferencia');
}
async function salvarTransferencia() {
  const origem = document.getElementById('transf-origem').value;
  const destino = document.getElementById('transf-destino').value;
  const valor = moedaToNumber(document.getElementById('transf-valor').value);
  const data = document.getElementById('transf-data').value;
  const descricao = document.getElementById('transf-descricao').value.trim() || 'Transferência';
  if (!origem || !destino) { toast('Escolha as duas contas.', 'err'); return; }
  if (origem === destino) { toast('Escolha contas diferentes para origem e destino.', 'err'); return; }
  if (!valor || !data) { toast('Preencha valor e data.', 'err'); return; }

  const btnSalvar = document.querySelector('#modal-transferencia .modal-actions .btn-primary');
  if (btnSalvar && (btnSalvar.classList.contains('btn-loading') || btnSalvar.classList.contains('btn-success'))) return;

  const grupoId = uid();
  STATE.lancamentos.push({
    id: uid(), tipo: 'despesa', data, descricao: `${descricao} → ${destino}`,
    categoria: 'Transferência', conta: origem, valor,
    origem: 'manual', sincronizado: false, pago: true, status: 'Pago/Efetivado',
    ehTransferencia: true, isTransferencia: true,
    transferenciaId: grupoId, transferenciaGrupo: grupoId, transferenciaContraparte: destino
  });
  STATE.lancamentos.push({
    id: uid(), tipo: 'receita', data, descricao: `${descricao} ← ${origem}`,
    categoria: 'Transferência', conta: destino, valor,
    origem: 'manual', sincronizado: false, pago: true, status: 'Pago/Efetivado',
    ehTransferencia: true, isTransferencia: true,
    transferenciaId: grupoId, transferenciaGrupo: grupoId, transferenciaContraparte: origem
  });

  if (btnSalvar) {
    btnSalvar.classList.add('btn-morphing', 'btn-loading');
  }
  const savePromise = salvarDados();
  const minWait = new Promise(res => setTimeout(res, 400));
  await Promise.all([savePromise, minWait]);

  if (btnSalvar) {
    btnSalvar.classList.remove('btn-loading');
    btnSalvar.classList.add('btn-success');
  }
  if (typeof SoundScape !== 'undefined' && SoundScape.playSave) SoundScape.playSave();
  await new Promise(res => setTimeout(res, 600));

  fecharModal('modal-transferencia');
  if (btnSalvar) {
    btnSalvar.classList.remove('btn-loading', 'btn-success', 'btn-morphing');
  }
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  toast(`${toBRL(valor)} transferido de ${origem} para ${destino}.`, 'ok');
}
async function excluirTransferencia(grupoId) {
  const itens = STATE.lancamentos.filter(l => obterTransferenciaId(l) === grupoId);
  if (!itens.length) return;
  const movCofre = itens.find(l => l.ehMovimentoCofre && l.metaId);
  if (movCofre) {
    const meta = (STATE.metas || []).find(m => m.id === movCofre.metaId);
    if (meta) {
      const delta = movCofre.tipo === 'despesa' ? -movCofre.valor : movCofre.valor;
      meta.valorAtual = Math.max(0, Math.round(((Number(meta.valorAtual) || 0) + delta) * 100) / 100);
    }
  }
  STATE.lancamentos = STATE.lancamentos.filter(l => obterTransferenciaId(l) !== grupoId);
  const entradaId = registrarExclusao(itens, itens[0].descricao || 'Transferência');
  if (typeof SoundScape !== 'undefined' && SoundScape.playDelete) SoundScape.playDelete();
  await salvarDados();
  renderPaginaAtiva(); atualizarContagemLixeira();
  sincronizarEmSegundoPlano();
  toastDesfazer(movCofre ? 'Movimentação do cofre excluída e saldo ajustado.' : 'Transferência excluída (as duas pontas).', entradaId);
}

/* ================= CATEGORIAS / CONTAS ================= */
function popularSelectDias(id) {
  const sel = document.getElementById(id);
  let opts = '';
  for (let i = 1; i <= 31; i++) opts += `<option value="${i}">Dia ${i}</option>`;
  sel.innerHTML = opts;
}
function atualizarCamposCartao() {
  const ehCartao = document.getElementById('conta-tipo').value === 'cartao';
  const wrap = document.getElementById('conta-campos-cartao');
  if (ehCartao) {
    if (!document.getElementById('conta-fechamento').options.length) popularSelectDias('conta-fechamento');
    if (!document.getElementById('conta-vencimento').options.length) popularSelectDias('conta-vencimento');
    wrap.style.display = '';
    atualizarDicaFechamento();
  } else {
    wrap.style.display = 'none';
    document.getElementById('conta-dica-fechamento').textContent = '';
  }
}
function atualizarDicaFechamento() {
  const dia = parseInt(document.getElementById('conta-fechamento').value, 10);
  const el = document.getElementById('conta-dica-fechamento');
  el.textContent = dia
    ? `Compras feitas até o dia ${dia} entram na fatura deste mês; depois disso, só entram na fatura seguinte.`
    : '';
}
function popularMacroPaiConfigSelect() {
  normalizarHierarquiaCategorias();
  const selTipo = document.getElementById('cat-tipo');
  const selPai = document.getElementById('cat-pai');
  if (!selPai || !selTipo) return;
  const tipo = selTipo.value || 'despesa';
  const atual = selPai.value;
  const macros = STATE.categorias.filter(c => c.tipo === tipo);
  selPai.innerHTML = `<option value="">-- Nova Categoria Principal (Macro) --</option>` +
    macros.map(c => `<option value="${escHtml(c.nome)}">↳ Subcategoria de: ${escHtml(c.nome)}</option>`).join('');
  if ([...selPai.options].some(o => o.value === atual)) selPai.value = atual;
}
function renderBlocoCategoriaMacroConfig(c) {
  const idx = STATE.categorias.indexOf(c);
  const subs = Array.isArray(c.subcategorias) ? c.subcategorias : [];
  const orcamentoBtn = c.tipo === 'despesa'
    ? `<span class="badge badge-cat badge-click" onclick="editarOrcamentoCategoria(${idx})" title="Definir orçamento mensal">${c.orcamento ? toBRL(c.orcamento) + '/mês' : '+ orçamento'}</span>`
    : '';
  const subsHTML = subs.map((s, sIdx) => `
    <span class="cat-sub-pill">
      <i class="ti ti-corner-down-right" style="opacity:.6"></i>
      <span>${escHtml(s)}</span>
      <button type="button" onclick="removerSubcategoria(${idx}, ${sIdx})" title="Remover subcategoria"><i class="ti ti-x"></i></button>
    </span>`).join('');
  return `<div class="cat-macro-card">
    <div class="cat-macro-top">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
        <span style="font-size:13px;font-weight:700;color:var(--text)">${escHtml(c.nome)}</span>
        <span style="font-size:11px;color:var(--text3)">(${subs.length} subcategoria${subs.length === 1 ? '' : 's'})</span>
        ${orcamentoBtn}
      </div>
      <div style="display:flex;align-items:center;gap:4px">
        <button type="button" class="btn btn-sm" style="padding:3px 8px;font-size:11px" onclick="adicionarSubcategoriaRapida(${idx})" title="Adicionar subcategoria"><i class="ti ti-plus"></i> Subcategoria</button>
        <button type="button" class="icon-btn danger" onclick="removerCategoria(${idx})" title="Remover categoria principal"><i class="ti ti-trash"></i></button>
      </div>
    </div>
    <div class="cat-sub-pills">
      ${subsHTML || '<span class="help-text" style="margin:0;font-size:11px">Sem subcategorias específicas (apenas lançamento geral).</span>'}
    </div>
  </div>`;
}
function renderConfig() {
  normalizarHierarquiaCategorias();
  popularMacroPaiConfigSelect();
  const despesa = STATE.categorias.filter(c => c.tipo === 'despesa');
  const receita = STATE.categorias.filter(c => c.tipo === 'receita');
  document.getElementById('cat-list-despesa').innerHTML = despesa.map(renderBlocoCategoriaMacroConfig).join('') || '<span class="help-text">Nenhuma categoria.</span>';
  document.getElementById('cat-list-receita').innerHTML = receita.map(renderBlocoCategoriaMacroConfig).join('') || '<span class="help-text">Nenhuma categoria.</span>';

  const saldos = saldoPorConta();
  document.getElementById('conta-list').innerHTML = STATE.contas.map((c,i) => {
    if (c.tipo === 'cartao') {
      const info = [c.diaFechamento ? `fecha dia ${c.diaFechamento}` : null, c.diaVencimento ? `vence dia ${c.diaVencimento}` : null].filter(Boolean).join(' · ');
      return `<span class="tag"><i class="ti ti-credit-card" style="opacity:.6"></i> ${escHtml(c.nome)} <span class="badge badge-cat" style="margin-left:4px">${escHtml(info)}</span>
        <button onclick="editarConta(${i})" title="Editar"><i class="ti ti-pencil"></i></button>
        <button onclick="removerConta(${i})" title="Remover"><i class="ti ti-x"></i></button></span>`;
    }
    const saldo = saldos[c.nome] || 0;
    return `<span class="tag">${escHtml(c.nome)} <span class="badge ${saldo>=0?'badge-pago':'badge-pendente'}" style="margin-left:4px">${toBRL(saldo)}</span>
      <button onclick="abrirModalConciliacaoPorIndice(${i})" title="Conciliar saldo desta conta"><i class="ti ti-scale"></i></button>
      <button onclick="editarConta(${i})" title="Editar"><i class="ti ti-pencil"></i></button>
      <button onclick="removerConta(${i})" title="Remover"><i class="ti ti-x"></i></button></span>`;
  }).join('') || '<span class="help-text">Nenhuma conta.</span>';

  const selRegra = document.getElementById('regra-categoria');
  if (selRegra) selRegra.innerHTML = construirOptionsCategoriasHTML('', selRegra.value);
  const selRegraConta = document.getElementById('regra-conta');
  if (selRegraConta) {
    selRegraConta.innerHTML = '<option value="">Qualquer Conta/Cartão</option>' + (STATE.contas || []).map(c => `<option value="${escHtml(c.nome)}">${escHtml(c.nome)}</option>`).join('');
  }
  const elRegraList = document.getElementById('regra-list');
  if (elRegraList) {
    elRegraList.innerHTML = (STATE.regras || []).map((r,i) => {
      const catFmt = escHtml(formatarCategoriaExibicao(r.categoriaDesejada || r.categoria));
      const subFmt = r.subcategoria ? ` › ${escHtml(r.subcategoria)}` : '';
      const contaFmt = (r.contaId || r.conta) ? ` <span class="badge badge-cat tag-regra-badge">${escHtml(r.contaId || r.conta)}</span>` : '';
      return `<span class="tag">"${escHtml(r.palavraChave)}" → ${catFmt}${subFmt}${contaFmt}<button onclick="removerRegra(${i})"><i class="ti ti-x"></i></button></span>`;
    }).join('') || '<span class="help-text">Nenhuma regra cadastrada.</span>';
  }
  if (typeof renderRegrasCategoriaConfig === 'function') renderRegrasCategoriaConfig();
  atualizarSegurancaUI();
  atualizarUIModoViagem();
  atualizarUIBackup();
  renderReceitasFixas();
  atualizarUISincronizacaoFamiliarP2P();
}
async function adicionarCategoria() {
  normalizarHierarquiaCategorias();
  const nome = document.getElementById('cat-nome').value.trim();
  const tipo = document.getElementById('cat-tipo').value;
  const paiNome = document.getElementById('cat-pai') ? document.getElementById('cat-pai').value : '';
  const orcamento = moedaToNumber(document.getElementById('cat-orcamento').value) || undefined;
  if (!nome) return;
  if (paiNome) {
    const macro = STATE.categorias.find(c => c.nome === paiNome && c.tipo === tipo);
    if (!macro) { toast('Categoria principal não encontrada.', 'err'); return; }
    if (!Array.isArray(macro.subcategorias)) macro.subcategorias = [];
    if (macro.subcategorias.some(s => s.toLowerCase() === nome.toLowerCase())) {
      toast('Esta subcategoria já existe nessa categoria principal.', 'err');
      return;
    }
    macro.subcategorias.push(nome);
    document.getElementById('cat-nome').value = '';
    await salvarDados();
    renderConfig();
    toast(`Subcategoria "${macro.nome} › ${nome}" adicionada!`, 'ok');
    return;
  }
  if (STATE.categorias.some(c => c.nome.toLowerCase() === nome.toLowerCase() && c.tipo === tipo)) { toast('Categoria principal já existe.', 'err'); return; }
  STATE.categorias.push({ nome, tipo, orcamento, subcategorias: [] });
  document.getElementById('cat-nome').value = '';
  document.getElementById('cat-orcamento').value = '';
  await salvarDados();
  renderConfig();
  toast(`Categoria principal "${nome}" adicionada!`, 'ok');
}
async function adicionarSubcategoriaRapida(idxMacro) {
  normalizarHierarquiaCategorias();
  const macro = STATE.categorias[idxMacro];
  if (!macro) return;
  const resp = await pedirValor(`Nova subcategoria dentro de "${macro.nome}"`, '', true);
  if (resp === null || !String(resp).trim()) return;
  const subNome = String(resp).trim();
  if (!Array.isArray(macro.subcategorias)) macro.subcategorias = [];
  if (macro.subcategorias.some(s => s.toLowerCase() === subNome.toLowerCase())) {
    toast('Subcategoria já existe.', 'err');
    return;
  }
  macro.subcategorias.push(subNome);
  await salvarDados();
  renderConfig();
  toast(`Subcategoria "${macro.nome} › ${subNome}" criada!`, 'ok');
}
async function removerSubcategoria(idxMacro, idxSub) {
  normalizarHierarquiaCategorias();
  const macro = STATE.categorias[idxMacro];
  if (!macro || !Array.isArray(macro.subcategorias)) return;
  macro.subcategorias.splice(idxSub, 1);
  await salvarDados();
  renderConfig();
}
async function removerCategoria(idx) {
  STATE.categorias.splice(idx, 1);
  await salvarDados(); renderConfig();
}
async function editarOrcamentoCategoria(idx) {
  const cat = STATE.categorias[idx];
  if (!cat) return;
  const atual = cat.orcamento ? toBRL(cat.orcamento).replace('R$','R$ ') : '';
  const resposta = await pedirValor(`Orçamento mensal para "${cat.nome}" (deixe vazio para remover)`, atual);
  if (resposta === null) return;
  const valor = moedaToNumber(resposta);
  cat.orcamento = valor > 0 ? valor : undefined;
  await salvarDados(); renderConfig(); renderDashboard();
}
async function salvarConta() {
  const idxEdicao = document.getElementById('conta-id').value;
  const nome = document.getElementById('conta-nome').value.trim();
  const tipo = document.getElementById('conta-tipo').value;
  if (!nome) return;
  const duplicada = STATE.contas.some((c,i) => c.nome.toLowerCase() === nome.toLowerCase() && String(i) !== idxEdicao);
  if (duplicada) { toast('Já existe uma conta com esse nome.', 'err'); return; }

  const dados = { nome, tipo };
  if (tipo === 'cartao') {
    dados.diaFechamento = parseInt(document.getElementById('conta-fechamento').value, 10) || 1;
    dados.diaVencimento = parseInt(document.getElementById('conta-vencimento').value, 10) || 10;
    const limite = moedaToNumber(document.getElementById('conta-limite').value);
    if (limite > 0) dados.limite = limite;
  }

  if (idxEdicao !== '') {
    const contaAntiga = STATE.contas[idxEdicao];
    const nomeAntigo = contaAntiga.nome;
    dados.id = contaAntiga.id || uid();
    dados.cor = contaAntiga.cor || '#1A6FE0';
    const contaAtualizada = { ...contaAntiga, ...dados };
    if (tipo !== 'cartao') {
      delete contaAtualizada.diaFechamento;
      delete contaAtualizada.diaVencimento;
      delete contaAtualizada.limite;
    }
    STATE.contas[idxEdicao] = contaAtualizada;
    if (nomeAntigo !== nome) {
      // Renomear precisa acompanhar tudo que referencia essa conta pelo nome
      STATE.lancamentos.forEach(l => { if (l.conta === nomeAntigo) l.conta = nome; });
      (STATE.recorrentes || []).forEach(r => { if (r.conta === nomeAntigo) r.conta = nome; });
    }
    if (tipo === 'cartao' && Array.isArray(STATE.cartoes)) {
      const idxCart = STATE.cartoes.findIndex(c => c.id === dados.id || c.nome.toLowerCase() === nomeAntigo.toLowerCase());
      if (idxCart >= 0) {
        STATE.cartoes[idxCart] = {
          ...STATE.cartoes[idxCart],
          id: dados.id,
          nome: dados.nome,
          limiteTotal: Number(dados.limite) || STATE.cartoes[idxCart].limiteTotal || 0,
          diaFechamento: dados.diaFechamento,
          diaVencimento: dados.diaVencimento
        };
      }
    }
  } else {
    dados.id = uid();
    STATE.contas.push(dados);
    if (tipo === 'cartao') {
      if (!Array.isArray(STATE.cartoes)) STATE.cartoes = [];
      STATE.cartoes.push({
        id: dados.id,
        nome: dados.nome,
        limiteTotal: Number(dados.limite) || 3000,
        diaFechamento: dados.diaFechamento,
        diaVencimento: dados.diaVencimento,
        cor: '#1A6FE0'
      });
    }
  }
  normalizarLancamentosCartaoExistentes();
  cancelarEdicaoConta();
  await salvarDados(); renderConfig(); renderDashboard();
  if (document.getElementById('page-cartoes')) renderCartoes();
  toast(idxEdicao !== '' ? 'Conta atualizada.' : 'Conta adicionada.', 'ok');
}
function editarConta(idx) {
  const c = STATE.contas[idx];
  if (!c) return;
  document.getElementById('conta-id').value = idx;
  document.getElementById('conta-nome').value = c.nome;
  document.getElementById('conta-tipo').value = c.tipo || 'conta';
  atualizarCamposCartao();
  if (c.tipo === 'cartao') {
    document.getElementById('conta-fechamento').value = c.diaFechamento || 1;
    document.getElementById('conta-vencimento').value = c.diaVencimento || 10;
    document.getElementById('conta-limite').value = c.limite ? toBRL(c.limite).replace('R$','R$ ') : '';
    atualizarDicaFechamento();
  }
  document.getElementById('conta-form-title').textContent = 'Editando: ' + c.nome;
  document.getElementById('conta-submit-btn').innerHTML = '<i class="ti ti-device-floppy"></i> Salvar alterações';
  document.getElementById('conta-cancelar-btn').style.display = '';
}
function cancelarEdicaoConta() {
  document.getElementById('conta-id').value = '';
  document.getElementById('conta-nome').value = '';
  document.getElementById('conta-tipo').value = 'conta';
  document.getElementById('conta-limite').value = '';
  atualizarCamposCartao();
  document.getElementById('conta-form-title').textContent = 'Contas / Cartões';
  document.getElementById('conta-submit-btn').innerHTML = '<i class="ti ti-plus"></i> Adicionar';
  document.getElementById('conta-cancelar-btn').style.display = 'none';
}
async function removerConta(idx) {
  STATE.contas.splice(idx, 1);
  await salvarDados(); renderConfig();
}
async function adicionarRegra() {
  const palavraChave = document.getElementById('regra-palavra').value.trim();
  const catVal = document.getElementById('regra-categoria').value;
  const selConta = document.getElementById('regra-conta');
  const conta = selConta ? selConta.value : '';
  if (!palavraChave || !catVal) return;

  const { macro, sub, temSub } = extrairMacroESubcategoria(catVal);
  STATE.regras.push({
    id: uid(),
    palavraChave,
    categoriaDesejada: macro,
    subcategoria: temSub ? sub : undefined,
    categoria: catVal,
    contaId: conta || undefined,
    conta: conta || undefined
  });
  document.getElementById('regra-palavra').value = '';
  await salvarDados();
  renderConfig();
  toast('Regra de auto-categorização adicionada!', 'ok');
}
async function removerRegra(idx) {
  STATE.regras.splice(idx, 1);
  await salvarDados();
  renderConfig();
}
function buscarRegraCategorizacao(descricao, tipoOpt) {
  if (!descricao) return null;
  if (typeof normalizarRegrasCategoria === 'function') {
    normalizarRegrasCategoria();
    const ativas = ordenarRegrasCategoriaParaAvaliacao((STATE.regrasCategoria || []).filter(r => r && r.ativa));
    const draft = { descricao, tipo: tipoOpt || 'despesa', valor: 0 };
    const found = ativas.find(r => avaliarRegraNoLancamento(r, draft));
    if (found) {
      return {
        ...found,
        palavraChave: found.padrao,
        categoriaDesejada: found.categoria,
        categoria: montarCategoriaCompletaAutoCat(found.categoria, found.subcategoria)
      };
    }
  }
  const desc = String(descricao).toLowerCase();
  const regra = (STATE.regras || []).find(r => {
    if (!r.palavraChave) return false;
    const kw = r.palavraChave.toLowerCase().trim();
    if (!kw) return false;
    try {
      const regex = new RegExp(`(^|\\s|[.,;\\-_/])${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|\\s|[.,;\\-_/])`, 'i');
      if (regex.test(desc)) return true;
    } catch (e) {}
    return desc.includes(kw);
  });
  return regra || null;
}
function aplicarRegraCategorizacao(descricao) {
  const r = buscarRegraCategorizacao(descricao);
  if (!r) return null;
  return r.categoriaDesejada || r.categoria || null;
}

/* ================= ASSINATURAS & RECORRENTES ================= */
function diaValidoNoMes(ano, mes, dia) {
  // mes é 1-based aqui. Se o dia não existir nesse mês (ex: 31 em fevereiro), usa o último dia do mês.
  const ultimoDia = new Date(ano, mes, 0).getDate();
  return Math.min(dia, ultimoDia);
}
function dataCobranca(ano, mes, diaCobranca) {
  const dia = diaValidoNoMes(ano, mes, diaCobranca);
  return `${ano}-${String(mes).padStart(2,'0')}-${String(dia).padStart(2,'0')}`;
}
function proximaCobranca(rec) {
  const hoje = new Date();
  let ano = hoje.getFullYear(), mes = hoje.getMonth() + 1;
  let data = dataCobranca(ano, mes, rec.diaCobranca);
  if (data < hojeLocalISO()) {
    mes += 1;
    if (mes > 12) { mes = 1; ano += 1; }
    data = dataCobranca(ano, mes, rec.diaCobranca);
  }
  return data;
}
async function gerarLancamentosRecorrentes() {
  const hojeISO = hojeLocalISO();
  const mesAtual = hojeISO.slice(0,7);
  let criados = 0;
  const ignorados = new Set(STATE.recorrentesIgnorados || []);
  (STATE.recorrentes || []).filter(r => r.ativa !== false).forEach(rec => {
    const inicioBase = (rec.dataInicio || hojeISO).slice(0,7);
    const [anoIni, mesIni] = inicioBase <= mesAtual ? inicioBase.split('-').map(Number) : mesAtual.split('-').map(Number);
    let ano = anoIni, mes = mesIni;
    while (`${ano}-${String(mes).padStart(2,'0')}` <= mesAtual) {
      const monthKey = `${ano}-${String(mes).padStart(2,'0')}`;
      const nomeLimpo = (rec.nome || '').trim().toLowerCase();
      const jaExiste = STATE.lancamentos.some(l =>
        (l.data || '').slice(0,7) === monthKey &&
        (l.recorrenteId === rec.id || ((l.descricao || '').trim().toLowerCase() === nomeLimpo && l.tipo === rec.tipo))
      );
      if (!jaExiste && !ignorados.has(rec.id + '|' + monthKey)) {
        STATE.lancamentos.push({
          id: uid(), tipo: rec.tipo || 'despesa', data: dataCobranca(ano, mes, rec.diaCobranca || 1),
          descricao: rec.nome, categoria: rec.categoria || 'Outros', conta: rec.conta || (STATE.contas[0] ? STATE.contas[0].nome : 'Conta'), valor: rec.valor,
          origem: 'recorrente', sincronizado: false, pago: false, recorrenteId: rec.id
        });
        criados++;
      }
      mes += 1;
      if (mes > 12) { mes = 1; ano += 1; }
    }
  });
  if (criados > 0) { await salvarDados(); sincronizarEmSegundoPlano(); }
  return criados;
}
function popularCategoriaRecorrenteSelect() {
  const tipo = document.getElementById('rec-tipo').value;
  const sel = document.getElementById('rec-categoria');
  const atual = sel.value;
  sel.innerHTML = construirOptionsCategoriasHTML(tipo, atual);
  if ([...sel.options].some(o => o.value === atual)) sel.value = atual;
}
function popularContaRecorrenteSelect() {
  document.getElementById('rec-conta').innerHTML = STATE.contas.map(c => `<option value="${escHtml(c.nome)}">${escHtml(c.nome)}</option>`).join('');
}
function popularDiaRecorrenteSelect() {
  const sel = document.getElementById('rec-dia');
  let opts = '';
  for (let i = 1; i <= 31; i++) opts += `<option value="${i}">Dia ${i}</option>`;
  sel.innerHTML = opts;
}
async function salvarRecorrente() {
  const id = document.getElementById('rec-id').value;
  const nome = document.getElementById('rec-nome').value.trim();
  const tipo = document.getElementById('rec-tipo').value;
  const categoria = document.getElementById('rec-categoria').value;
  const conta = document.getElementById('rec-conta').value;
  const valor = moedaToNumber(document.getElementById('rec-valor').value);
  const diaCobranca = parseInt(document.getElementById('rec-dia').value, 10) || 1;
  const dataInicio = document.getElementById('rec-inicio').value || hojeLocalISO();
  if (!nome || !valor) { toast('Preencha ao menos o nome e o valor.', 'err'); return; }

  if (id) {
    const rec = STATE.recorrentes.find(r => r.id === id);
    if (rec) Object.assign(rec, { nome, tipo, categoria, conta, valor, diaCobranca, dataInicio });
  } else {
    STATE.recorrentes.push({ id: uid(), nome, tipo, categoria, conta, valor, diaCobranca, dataInicio, ativa: true });
  }
  cancelarEdicaoRecorrente();
  await salvarDados();
  await gerarLancamentosRecorrentes();
  renderRecorrentes(); renderDashboard();
  toast(id ? 'Assinatura atualizada.' : 'Assinatura/recorrência adicionada.', 'ok');
}
function editarRecorrente(id) {
  const rec = STATE.recorrentes.find(r => r.id === id);
  if (!rec) return;
  popularContaRecorrenteSelect();
  popularDiaRecorrenteSelect();
  document.getElementById('rec-id').value = rec.id;
  document.getElementById('rec-nome').value = rec.nome;
  document.getElementById('rec-tipo').value = rec.tipo;
  popularCategoriaRecorrenteSelect();
  document.getElementById('rec-categoria').value = rec.categoria;
  document.getElementById('rec-conta').value = rec.conta;
  document.getElementById('rec-valor').value = toBRL(rec.valor).replace('R$','R$ ');
  document.getElementById('rec-dia').value = rec.diaCobranca;
  document.getElementById('rec-inicio').value = rec.dataInicio;
  document.getElementById('rec-form-title').textContent = 'Editando: ' + rec.nome;
  document.getElementById('rec-submit-btn').innerHTML = '<i class="ti ti-device-floppy"></i> Salvar alterações';
  document.getElementById('rec-cancelar-btn').style.display = '';
  const nomeInput = document.getElementById('rec-nome');
  if (typeof nomeInput.scrollIntoView === 'function') nomeInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
  nomeInput.focus();
}
function cancelarEdicaoRecorrente() {
  document.getElementById('rec-id').value = '';
  document.getElementById('rec-nome').value = '';
  document.getElementById('rec-tipo').value = 'despesa';
  popularCategoriaRecorrenteSelect();
  document.getElementById('rec-valor').value = '';
  popularDiaRecorrenteSelect();
  document.getElementById('rec-inicio').value = hojeLocalISO();
  document.getElementById('rec-form-title').textContent = 'Nova assinatura / recorrência';
  document.getElementById('rec-submit-btn').innerHTML = '<i class="ti ti-plus"></i> Adicionar';
  document.getElementById('rec-cancelar-btn').style.display = 'none';
}
async function toggleRecorrenteAtiva(id) {
  const rec = STATE.recorrentes.find(r => r.id === id);
  if (!rec) return;
  rec.ativa = !rec.ativa;
  await salvarDados();
  if (rec.ativa) await gerarLancamentosRecorrentes();
  renderRecorrentes(); renderDashboard();
}
function removerRecorrente(id) {
  abrirConfirmacao('Remover esta assinatura/recorrência? Os lançamentos já gerados por ela continuam no histórico — só as próximas cobranças deixam de ser criadas.', async () => {
    STATE.recorrentes = STATE.recorrentes.filter(r => r.id !== id);
    await salvarDados();
    renderRecorrentes();
    toast('Assinatura removida. As cobranças futuras não serão mais geradas.', 'ok');
  }, 'Remover assinatura');
}
function renderRecorrentes() {
  popularCategoriaRecorrenteSelect();
  popularContaRecorrenteSelect();
  popularDiaRecorrenteSelect();
  document.getElementById('rec-inicio').value = document.getElementById('rec-inicio').value || hojeLocalISO();

  const lista = [...STATE.recorrentes].sort((a,b) => (a.nome||'').localeCompare(b.nome||''));
  const despesasAtivas = lista.filter(r => r.ativa && r.tipo === 'despesa');
  const receitasAtivas = lista.filter(r => r.ativa && r.tipo === 'receita');
  const totalDespesas = despesasAtivas.reduce((s,r) => s + r.valor, 0);
  const totalReceitas = receitasAtivas.reduce((s,r) => s + r.valor, 0);

  // Radar de Assinaturas (Subscription Killer)
  const radarEl = document.getElementById('rec-radar-alerta');
  if (radarEl) {
    if (despesasAtivas.length > 0 && totalDespesas > 0) {
      const custoAnual = totalDespesas * 12;
      const mesAtualKey = hojeLocalISO().slice(0, 7);
      const recMesAtual = receitasDespesasDoMes(mesAtualKey).receitas;
      const mesesRec = ultimosMeses(6).map(m => receitasDespesasDoMes(m).receitas).filter(v => v > 0);
      const mediaReceitaMensal = mesesRec.length ? (mesesRec.reduce((a, b) => a + b, 0) / mesesRec.length) : 0;
      const baseReceita = recMesAtual > 0 ? recMesAtual : (mediaReceitaMensal > 0 ? mediaReceitaMensal : totalReceitas);
      const pctReceita = baseReceita > 0 ? ((totalDespesas / baseReceita) * 100).toFixed(1).replace('.', ',') : '0,0';
      radarEl.style.display = 'flex';
      radarEl.innerHTML = `
        <div class="radar-assinaturas-left">
          <div class="radar-assinaturas-icon"><i class="ti ti-radar-2"></i></div>
          <div>
            <div style="font-size:13px;font-weight:700;margin-bottom:2px">Radar de Assinaturas (Subscription Killer)</div>
            <div style="font-size:12.5px;line-height:1.4">Atenção: Você gasta <strong>${toBRL(custoAnual)}</strong> por ano com assinaturas (<strong>${pctReceita}%</strong> da sua receita). Deseja rever alguma?</div>
          </div>
        </div>
        <button class="btn btn-sm" type="button" onclick="const tb = document.getElementById('rec-tbody'); if(tb) tb.scrollIntoView({behavior:'smooth', block:'center'});"><i class="ti ti-eye-check"></i> Rever assinaturas</button>`;
    } else {
      radarEl.style.display = 'none';
      radarEl.innerHTML = '';
    }
  }

  document.getElementById('rec-kpis').innerHTML = `
    <div class="metric"><div class="metric-label">Compromisso mensal</div><div class="metric-value mv-bad">${toBRL(totalDespesas)}</div><div class="metric-sub">${despesasAtivas.length} assinatura(s)/despesa(s) ativa(s)</div></div>
    <div class="metric"><div class="metric-label">Receita recorrente</div><div class="metric-value mv-ok">${toBRL(totalReceitas)}</div><div class="metric-sub">${receitasAtivas.length} recorrência(s) ativa(s)</div></div>
    <div class="metric"><div class="metric-label">Resultado recorrente</div><div class="metric-value ${(totalReceitas-totalDespesas)>=0?'mv-ok':'mv-bad'}">${toBRL(totalReceitas-totalDespesas)}</div><div class="metric-sub">por mês</div></div>
    <div class="metric"><div class="metric-label">Total cadastrado</div><div class="metric-value mv-info">${lista.length}</div><div class="metric-sub">${lista.length - despesasAtivas.length - receitasAtivas.length} pausada(s)</div></div>`;

  const tbody = document.getElementById('rec-tbody');
  document.getElementById('rec-empty').style.display = lista.length ? 'none' : 'block';
  tbody.innerHTML = lista.map(r => {
    const [a,m,d] = proximaCobranca(r).split('-');
    return `<tr>
      <td>${escHtml(r.nome)}</td>
      <td><span class="badge badge-cat">${escHtml(r.categoria || '-')}</span></td>
      <td>${escHtml(r.conta || '-')}</td>
      <td>${r.diaCobranca}</td>
      <td>${r.ativa ? `${d}/${m}/${a}` : '-'}</td>
      <td><span class="badge ${r.ativa?'badge-pago':'badge-pendente'} badge-click" onclick="toggleRecorrenteAtiva('${r.id}')" title="Clique para pausar/reativar">${r.ativa ? 'Ativa' : 'Pausada'}</span></td>
      <td style="text-align:right"><span class="badge ${r.tipo==='receita'?'badge-receita':'badge-despesa'}">${r.tipo==='receita'?'+':'-'} ${toBRL(r.valor)}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="icon-btn" onclick="editarRecorrente('${r.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
        <button class="icon-btn danger" onclick="removerRecorrente('${r.id}')" title="Remover"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}

/* ================= MOTOR DE RECEITAS INTELIGENTES (AUTO-PAYCHECK) ================= */

/**
 * Calcula a data do Domingo de Páscoa utilizando o algoritmo clássico de Computus (Meeus/Jones/Butcher).
 * Válido para o calendário Gregoriano em Vanilla JS puro.
 */
function calcularPascoa(ano) {
  const a = ano % 19;
  const b = Math.floor(ano / 100);
  const c = ano % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const mes = Math.floor((h + l - 7 * m + 114) / 31);
  const dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia, 12, 0, 0);
}

/**
 * Retorna todos os feriados nacionais brasileiros (fixos e móveis) no formato 'DD/MM' para o ano solicitado.
 * Feriados Fixos: 01/01, 21/04, 01/05, 07/09, 12/10, 02/11, 15/11, 20/11 (Consciência Negra) e 25/12.
 * Feriados Móveis: Carnaval (Páscoa - 47 dias), Sexta-feira Santa (Páscoa - 2 dias), Corpus Christi (Páscoa + 60 dias).
 */
function obterFeriadosAno(ano) {
  const a = parseInt(ano, 10) || new Date().getFullYear();
  const pascoa = calcularPascoa(a);
  const carnaval = new Date(pascoa.getTime() - 47 * 24 * 60 * 60 * 1000);
  const sextaSanta = new Date(pascoa.getTime() - 2 * 24 * 60 * 60 * 1000);
  const corpusChristi = new Date(pascoa.getTime() + 60 * 24 * 60 * 60 * 1000);

  const fmtDDMM = (d) => `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;

  const feriadosFixos = [
    '01/01', // Confraternização Universal
    '21/04', // Tiradentes
    '01/05', // Dia do Trabalho
    '07/09', // Independência do Brasil
    '12/10', // Nossa Senhora Aparecida
    '02/11', // Finados
    '15/11', // Proclamação da República
    '20/11', // Consciência Negra (Lei 14.759/2023)
    '25/12'  // Natal
  ];

  const feriadosMoveis = [
    fmtDDMM(carnaval),
    fmtDDMM(sextaSanta),
    fmtDDMM(corpusChristi)
  ];

  return [...new Set([...feriadosFixos, ...feriadosMoveis])];
}

/**
 * Calcula a data exata do N-ésimo dia útil de um determinado mês e ano no Brasil.
 * Inicia no dia 1 do mês/ano fornecido e itera dia a dia.
 * Ignora sábados (6), domingos (0) e feriados nacionais fixos/móveis (obterFeriadosAno).
 * Se o N solicitado ultrapassar os dias úteis do mês, avança ordenadamente pelos meses seguintes.
 * Retorna data no formato ISO YYYY-MM-DD.
 */
function calcularDiaUtil(mes, ano, nDiaUtil) {
  if (typeof mes === 'string' && mes.includes('-')) {
    const partes = mes.split('-').map(Number);
    ano = partes[0];
    mes = partes[1];
  }
  let m = parseInt(mes, 10);
  let a = parseInt(ano, 10);
  let n = parseInt(nDiaUtil, 10);
  if (isNaN(n) || n < 1) n = 1;

  // Proteção se parâmetros forem passados invertidos (ano, mes)
  if (m > 100 && a <= 12) {
    const temp = m;
    m = a;
    a = temp;
  }
  if (!a || isNaN(a)) a = new Date().getFullYear();
  if (!m || isNaN(m)) m = new Date().getMonth() + 1;

  let curAno = a;
  let curMes = (m >= 1 && m <= 12) ? m : 1;
  let curMesIndex = curMes - 1;
  let diasUteisContados = 0;
  let diaEscolhido = 1;
  let feriadosSet = new Set(obterFeriadosAno(curAno));

  while (diasUteisContados < n) {
    const diasNoMes = new Date(curAno, curMesIndex + 1, 0).getDate();
    let encontrouNoMes = false;

    for (let d = 1; d <= diasNoMes; d++) {
      const dataObj = new Date(curAno, curMesIndex, d, 12, 0, 0);
      const diaSemana = dataObj.getDay(); // 0 = Domingo, 6 = Sábado
      const diaMesFmt = `${String(d).padStart(2, '0')}/${String(curMes).padStart(2, '0')}`;
      const ehFimDeSemana = (diaSemana === 0 || diaSemana === 6);
      const ehFeriado = feriadosSet.has(diaMesFmt);

      if (!ehFimDeSemana && !ehFeriado) {
        diasUteisContados++;
        if (diasUteisContados === n) {
          diaEscolhido = d;
          encontrouNoMes = true;
          break;
        }
        diaEscolhido = d;
      }
    }

    if (encontrouNoMes || diasUteisContados >= n) {
      break;
    }

    // Avança para o mês seguinte se nDiaUtil for maior que os dias úteis deste mês
    curMesIndex++;
    if (curMesIndex > 11) {
      curMesIndex = 0;
      curAno++;
      feriadosSet = new Set(obterFeriadosAno(curAno));
    }
    curMes = curMesIndex + 1;
  }

  const yyyy = String(curAno);
  const mm = String(curMes).padStart(2, '0');
  const dd = String(diaEscolhido).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Calcula a data prevista para crédito da receita fixa no mês e ano informados.
 */
function calcularDataReceitaFixa(r, ano, mes) {
  const a = parseInt(ano, 10) || new Date().getFullYear();
  const m = parseInt(mes, 10) || (new Date().getMonth() + 1);
  if (r.tipoRegra === 'dia_util') {
    return calcularDiaUtil(m, a, r.diaRegra || 5);
  } else {
    const diaValido = diaValidoNoMes(a, m, parseInt(r.diaRegra, 10) || 1);
    return `${a}-${String(m).padStart(2, '0')}-${String(diaValido).padStart(2, '0')}`;
  }
}

/**
 * Motor de injeção automática silenciosa (Auto-Paycheck).
 * Processa todas as receitas fixas ativas do mês atual.
 * Se a data atual for maior ou igual à data de pagamento calculada e ainda
 * não houver lançamento com essa descrição naquele mês/ano, gera o crédito automaticamente.
 */
async function processarReceitasAutomatizadas(manual) {
  if (!Array.isArray(STATE.receitasFixas) || STATE.receitasFixas.length === 0) {
    if (manual) toast('Nenhuma receita fixa cadastrada.', 'info');
    return;
  }

  const hojeISO = hojeLocalISO();
  const [anoAtual, mesAtual] = hojeISO.split('-').map(Number);
  const mesAnoAtual = `${anoAtual}-${String(mesAtual).padStart(2, '0')}`;

  let criados = 0;
  const ativas = STATE.receitasFixas.filter(r => r.ativo !== false);

  for (const r of ativas) {
    const valorNum = Number(r.valor) || 0;
    if (valorNum <= 0) continue;

    const dataPagamentoISO = calcularDataReceitaFixa(r, anoAtual, mesAtual);

    // Se a data atual for maior ou igual à data calculada
    if (hojeISO >= dataPagamentoISO) {
      const descLimpa = (r.descricao || '').trim().toLowerCase();

      // Verifica se já existe lançamento automático correspondente neste mês/ano
      const jaExiste = (STATE.lancamentos || []).some(l => {
        if (l.tipo !== 'receita') return false;
        const compMes = mesCompetenciaLancamento(l) || (l.data || '').slice(0, 7);
        if (compMes !== mesAnoAtual) return false;
        if (l.receitaFixaId && l.receitaFixaId === r.id) return true;
        const descL = (l.descricao || '').trim().toLowerCase();
        return descL === descLimpa;
      });

      if (!jaExiste) {
        const contaDestino = r.conta || (STATE.contas && STATE.contas[0] ? STATE.contas[0].nome : 'Conta principal');
        const novo = {
          id: uid(),
          tipo: 'receita',
          data: dataPagamentoISO,
          descricao: r.descricao || 'Salário',
          categoria: r.categoria || 'Salário',
          conta: contaDestino,
          valor: valorNum,
          pago: true, // Status: Efetivado
          origem: 'auto_receita',
          receitaFixaId: r.id,
          sincronizado: false
        };

        STATE.lancamentos.push(novo);
        criados++;

        const nomeNotif = (r.descricao && r.descricao.trim()) ? r.descricao.trim() : 'Salário';
        toast(`O seu ${nomeNotif} de ${toBRL(valorNum)} foi creditado automaticamente hoje.`, 'ok');
      }
    }
  }

  if (criados > 0) {
    await salvarDados();
    renderPaginaAtiva();
    if (typeof sincronizarEmSegundoPlano === 'function') sincronizarEmSegundoPlano();
  } else if (manual) {
    toast('Nenhuma receita fixa pendente para creditar hoje.', 'info');
  }
}

function atualizarDicaRegraReceitaFixa() {
  const elTipo = document.getElementById('recfixa-tipo-regra');
  const elDia = document.getElementById('recfixa-dia');
  const elDica = document.getElementById('recfixa-dica-regra');
  const elLbl = document.getElementById('recfixa-lbl-dia');
  if (!elTipo || !elDia || !elDica) return;

  const tipo = elTipo.value;
  let dia = parseInt(elDia.value, 10);
  if (isNaN(dia) || dia < 1) dia = 1;

  if (tipo === 'dia_util') {
    if (elLbl) elLbl.textContent = 'Xº Dia Útil (1 a 23)';
    elDia.max = 23;
    if (dia > 23) { dia = 23; elDia.value = '23'; }
  } else {
    if (elLbl) elLbl.textContent = 'Dia Fixo do Mês (1 a 31)';
    elDia.max = 31;
    if (dia > 31) { dia = 31; elDia.value = '31'; }
  }

  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();
  const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const nomesSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  const dataPrevistaISO = (tipo === 'dia_util') ? calcularDiaUtil(mesAtual, anoAtual, dia) : `${anoAtual}-${String(mesAtual).padStart(2, '0')}-${String(diaValidoNoMes(anoAtual, mesAtual, dia)).padStart(2, '0')}`;
  const [a, m, d] = dataPrevistaISO.split('-').map(Number);
  const dataObj = new Date(a, m - 1, d, 12, 0, 0);
  const diaSemanaNome = nomesSemana[dataObj.getDay()];

  if (tipo === 'dia_util') {
    elDica.innerHTML = `<i class="ti ti-calendar-event"></i> Previsão neste mês (${nomesMeses[mesAtual - 1]}/${anoAtual}): <strong>${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} (${diaSemanaNome})</strong> — ${dia}º dia útil (descontando fins de semana e feriados nacionais).`;
  } else {
    elDica.innerHTML = `<i class="ti ti-calendar-event"></i> Previsão neste mês (${nomesMeses[mesAtual - 1]}/${anoAtual}): <strong>${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} (${diaSemanaNome})</strong> — todo dia ${dia}.`;
  }
}

function atualizarDicaRegraReceitaFixaModal() {
  const elTipo = document.getElementById('modal-recfixa-tipo-regra');
  const elDia = document.getElementById('modal-recfixa-dia');
  const elDica = document.getElementById('modal-recfixa-dica-regra');
  if (!elTipo || !elDia || !elDica) return;

  const tipo = elTipo.value;
  let dia = parseInt(elDia.value, 10);
  if (isNaN(dia) || dia < 1) dia = 1;
  if (tipo === 'dia_util' && dia > 23) { dia = 23; elDia.value = '23'; }
  if (tipo === 'dia_fixo' && dia > 31) { dia = 31; elDia.value = '31'; }

  const hoje = new Date();
  const mesAtual = hoje.getMonth() + 1;
  const anoAtual = hoje.getFullYear();
  const nomesMeses = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  const nomesSemana = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];

  const dataPrevistaISO = (tipo === 'dia_util') ? calcularDiaUtil(mesAtual, anoAtual, dia) : `${anoAtual}-${String(mesAtual).padStart(2, '0')}-${String(diaValidoNoMes(anoAtual, mesAtual, dia)).padStart(2, '0')}`;
  const [a, m, d] = dataPrevistaISO.split('-').map(Number);
  const dataObj = new Date(a, m - 1, d, 12, 0, 0);
  const diaSemanaNome = nomesSemana[dataObj.getDay()];

  if (tipo === 'dia_util') {
    elDica.innerHTML = `<i class="ti ti-calendar-event"></i> Previsão (${nomesMeses[mesAtual - 1]}/${anoAtual}): <strong>${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} (${diaSemanaNome})</strong> — ${dia}º dia útil (descontando fins de semana e feriados nacionais).`;
  } else {
    elDica.innerHTML = `<i class="ti ti-calendar-event"></i> Previsão (${nomesMeses[mesAtual - 1]}/${anoAtual}): <strong>${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')} (${diaSemanaNome})</strong> — todo dia ${dia}.`;
  }
}

function popularSelectsReceitaFixa() {
  const selConta = document.getElementById('recfixa-conta');
  const selContaModal = document.getElementById('modal-recfixa-conta');
  const selCat = document.getElementById('recfixa-cat');
  const selCatModal = document.getElementById('modal-recfixa-cat');

  const contasBancarias = (STATE.contas || []).filter(c => c.tipo !== 'cartao');
  const listaContas = contasBancarias.length ? contasBancarias : (STATE.contas || []);
  const optsContas = listaContas.map(c => `<option value="${escHtml(c.nome)}">${escHtml(c.nome)}</option>`).join('');

  if (selConta && (!selConta.options.length || selConta.innerHTML.trim() === '')) {
    selConta.innerHTML = optsContas;
  }
  if (selContaModal) selContaModal.innerHTML = optsContas;

  const catsReceita = (STATE.categorias || []).filter(c => c.tipo === 'receita');
  let optsCat = '';
  catsReceita.forEach(c => {
    optsCat += `<option value="${escHtml(c.nome)}">${escHtml(c.nome)}</option>`;
    if (Array.isArray(c.subcategorias)) {
      c.subcategorias.forEach(sub => {
        optsCat += `<option value="${escHtml(c.nome + ' -> ' + sub)}">${escHtml(c.nome)} › ${escHtml(sub)}</option>`;
      });
    }
  });
  if (!optsCat) optsCat = '<option value="Salário">Salário</option>';

  if (selCat && (!selCat.options.length || selCat.innerHTML.trim() === '')) {
    selCat.innerHTML = optsCat;
    if ([...selCat.options].some(o => o.value.toLowerCase().includes('salário'))) {
      const optSal = [...selCat.options].find(o => o.value.toLowerCase().includes('salário'));
      if (optSal) selCat.value = optSal.value;
    }
  }
  if (selCatModal) {
    selCatModal.innerHTML = optsCat;
    if ([...selCatModal.options].some(o => o.value.toLowerCase().includes('salário'))) {
      const optSal = [...selCatModal.options].find(o => o.value.toLowerCase().includes('salário'));
      if (optSal) selCatModal.value = optSal.value;
    }
  }
}

function renderReceitasFixas() {
  if (!Array.isArray(STATE.receitasFixas)) STATE.receitasFixas = [];
  popularSelectsReceitaFixa();
  atualizarDicaRegraReceitaFixa();

  const cont = document.getElementById('recfixa-lista');
  if (!cont) return;

  if (STATE.receitasFixas.length === 0) {
    cont.innerHTML = `
      <div class="empty" style="padding:1.5rem 0">
        <div class="empty-icon-badge"><i class="ti ti-cash-banknote"></i></div>
        <div style="font-weight:600;font-size:13.5px;margin-top:8px">Nenhuma receita fixa cadastrada ainda</div>
        <div class="help-text">Cadastre seu salário ou renda fixa acima para que ele caia na conta automaticamente todo mês.</div>
      </div>`;
    return;
  }

  const hojeISO = hojeLocalISO();
  const [anoAtual, mesAtual] = hojeISO.split('-').map(Number);
  const mesAnoAtual = `${anoAtual}-${String(mesAtual).padStart(2, '0')}`;

  cont.innerHTML = STATE.receitasFixas.map(r => {
    const dataPrevistaISO = calcularDataReceitaFixa(r, anoAtual, mesAtual);
    const [a, m, d] = dataPrevistaISO.split('-');
    const dataFmt = `${d}/${m}/${a}`;

    const jaCreditado = (STATE.lancamentos || []).some(l => {
      if (l.tipo !== 'receita') return false;
      const compMes = mesCompetenciaLancamento(l) || (l.data || '').slice(0, 7);
      if (compMes !== mesAnoAtual) return false;
      if (l.receitaFixaId && l.receitaFixaId === r.id) return true;
      return (l.descricao || '').trim().toLowerCase() === (r.descricao || '').trim().toLowerCase();
    });

    const regraTexto = (r.tipoRegra === 'dia_util') ? `${r.diaRegra}º Dia Útil` : `Dia Fixo: ${r.diaRegra}`;
    const estaAtivo = r.ativo !== false;

    let badgeStatus = '';
    if (!estaAtivo) {
      badgeStatus = `<span class="badge" style="background:var(--surface2);color:var(--text3)"><i class="ti ti-player-pause" style="margin-right:3px"></i>Pausada</span>`;
    } else if (jaCreditado) {
      badgeStatus = `<span class="badge badge-pago" title="Já creditado na conta neste mês"><i class="ti ti-check" style="margin-right:3px"></i>Creditado neste mês</span>`;
    } else if (hojeISO < dataPrevistaISO) {
      badgeStatus = `<span class="badge badge-pendente" title="Aguardando data prevista de crédito"><i class="ti ti-clock" style="margin-right:3px"></i>Previsto p/ ${d}/${m}</span>`;
    } else {
      badgeStatus = `<span class="badge badge-pago" title="Pronto para creditar hoje"><i class="ti ti-arrow-down-circle" style="margin-right:3px"></i>Pronto p/ hoje</span>`;
    }

    return `
      <div class="recfixa-row ${estaAtivo ? '' : 'inativa'}">
        <div class="recfixa-info">
          <div class="recfixa-titulo">
            <i class="ti ti-cash" style="color:var(--good);font-size:16px"></i>
            <span>${escHtml(r.descricao || 'Salário')}</span>
            <span class="badge badge-cat">${regraTexto}</span>
            ${badgeStatus}
          </div>
          <div class="recfixa-meta">
            <span><i class="ti ti-building-bank"></i> ${escHtml(r.conta || 'Conta')}</span>
            <span>·</span>
            <span><i class="ti ti-tag"></i> ${escHtml(formatarCategoriaExibicao(r.categoria || 'Salário'))}</span>
            <span>·</span>
            <span>Próximo crédito: <strong>${dataFmt}</strong></span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:12px">
          <div class="recfixa-valor valor-sensivel">${toBRL(r.valor)}</div>
          <div class="recfixa-acoes">
            <button class="icon-btn" onclick="alternarAtivoReceitaFixa('${r.id}')" title="${estaAtivo ? 'Pausar crédito automático' : 'Ativar crédito automático'}">
              <i class="ti ${estaAtivo ? 'ti-toggle-right' : 'ti-toggle-left'}" style="font-size:18px;color:${estaAtivo ? 'var(--good)' : 'var(--text3)'}"></i>
            </button>
            <button class="icon-btn" onclick="editarReceitaFixa('${r.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
            <button class="icon-btn danger" onclick="removerReceitaFixa('${r.id}')" title="Remover"><i class="ti ti-trash"></i></button>
          </div>
        </div>
      </div>`;
  }).join('');
}

function abrirModalRendas(id) {
  popularSelectsReceitaFixa();
  const elId = document.getElementById('modal-recfixa-id');
  const elDesc = document.getElementById('modal-recfixa-desc');
  const elValor = document.getElementById('modal-recfixa-valor');
  const elConta = document.getElementById('modal-recfixa-conta');
  const elCat = document.getElementById('modal-recfixa-cat');
  const elTipo = document.getElementById('modal-recfixa-tipo-regra');
  const elDia = document.getElementById('modal-recfixa-dia');
  const elTitle = document.getElementById('modal-rendas-title');
  const elBtn = document.getElementById('modal-recfixa-btn-salvar');

  if (id) {
    const r = (STATE.receitasFixas || []).find(x => x.id === id);
    if (!r) return;
    if (elId) elId.value = r.id;
    if (elDesc) elDesc.value = r.descricao || '';
    if (elValor) elValor.value = toBRL(r.valor).replace('R$', 'R$ ');
    if (elConta && r.conta) elConta.value = r.conta;
    if (elCat && r.categoria) elCat.value = r.categoria;
    if (elTipo) elTipo.value = r.tipoRegra || 'dia_util';
    if (elDia) elDia.value = r.diaRegra || 5;
    if (elTitle) elTitle.innerHTML = '<i class="ti ti-pencil" style="color:var(--good);margin-right:6px"></i><span>Editar Receita Fixa</span>';
    if (elBtn) elBtn.innerHTML = '<i class="ti ti-check"></i> Atualizar Receita Fixa';
  } else {
    if (elId) elId.value = '';
    if (elDesc) elDesc.value = '';
    if (elValor) elValor.value = '';
    if (elTipo) elTipo.value = 'dia_util';
    if (elDia) elDia.value = '5';
    if (elTitle) elTitle.innerHTML = '<i class="ti ti-cash-banknote" style="color:var(--good);margin-right:6px"></i><span>Nova Receita Fixa (Auto-Paycheck)</span>';
    if (elBtn) elBtn.innerHTML = '<i class="ti ti-check"></i> Salvar Receita Fixa';
  }
  atualizarDicaRegraReceitaFixaModal();
  abrirModal('modal-rendas');
  setTimeout(() => { if (elDesc) elDesc.focus(); }, 60);
}

async function salvarReceitaFixaModal() {
  const id = document.getElementById('modal-recfixa-id')?.value;
  const descricao = document.getElementById('modal-recfixa-desc')?.value.trim();
  const valor = moedaToNumber(document.getElementById('modal-recfixa-valor')?.value);
  const conta = document.getElementById('modal-recfixa-conta')?.value;
  const categoria = document.getElementById('modal-recfixa-cat')?.value || 'Salário';
  const tipoRegra = document.getElementById('modal-recfixa-tipo-regra')?.value || 'dia_util';
  let diaRegra = parseInt(document.getElementById('modal-recfixa-dia')?.value, 10);
  if (isNaN(diaRegra) || diaRegra < 1) diaRegra = 1;

  if (!descricao) {
    toast('Informe a descrição da receita fixa (ex: Salário Nubank).', 'warn');
    document.getElementById('modal-recfixa-desc')?.focus();
    return;
  }
  if (!valor || valor <= 0) {
    toast('Informe um valor válido maior que zero.', 'warn');
    document.getElementById('modal-recfixa-valor')?.focus();
    return;
  }

  if (!Array.isArray(STATE.receitasFixas)) STATE.receitasFixas = [];

  if (id) {
    const item = STATE.receitasFixas.find(x => x.id === id);
    if (item) {
      item.descricao = descricao;
      item.valor = valor;
      item.conta = conta;
      item.categoria = categoria;
      item.tipoRegra = tipoRegra;
      item.diaRegra = diaRegra;
    }
  } else {
    STATE.receitasFixas.push({
      id: uid(),
      descricao,
      valor,
      conta,
      categoria,
      tipoRegra,
      diaRegra,
      ativo: true,
      criadoEm: hojeLocalISO()
    });
  }

  await salvarDados();
  fecharModal('modal-rendas');
  renderReceitasFixas();
  toast(id ? 'Receita fixa atualizada com sucesso!' : 'Receita fixa cadastrada com sucesso!', 'ok');
  await processarReceitasAutomatizadas();
}

async function salvarReceitaFixa() {
  const id = document.getElementById('recfixa-id')?.value;
  const descricao = document.getElementById('recfixa-desc')?.value.trim();
  const valor = moedaToNumber(document.getElementById('recfixa-valor')?.value);
  const conta = document.getElementById('recfixa-conta')?.value;
  const categoria = document.getElementById('recfixa-cat')?.value || 'Salário';
  const tipoRegra = document.getElementById('recfixa-tipo-regra')?.value || 'dia_util';
  let diaRegra = parseInt(document.getElementById('recfixa-dia')?.value, 10);
  if (isNaN(diaRegra) || diaRegra < 1) diaRegra = 1;

  if (!descricao) {
    toast('Informe a descrição da receita fixa (ex: Salário Nubank).', 'warn');
    document.getElementById('recfixa-desc')?.focus();
    return;
  }
  if (!valor || valor <= 0) {
    toast('Informe um valor válido maior que zero.', 'warn');
    document.getElementById('recfixa-valor')?.focus();
    return;
  }

  if (!Array.isArray(STATE.receitasFixas)) STATE.receitasFixas = [];

  if (id) {
    const item = STATE.receitasFixas.find(x => x.id === id);
    if (item) {
      item.descricao = descricao;
      item.valor = valor;
      item.conta = conta;
      item.categoria = categoria;
      item.tipoRegra = tipoRegra;
      item.diaRegra = diaRegra;
    }
  } else {
    STATE.receitasFixas.push({
      id: uid(),
      descricao,
      valor,
      conta,
      categoria,
      tipoRegra,
      diaRegra,
      ativo: true,
      criadoEm: hojeLocalISO()
    });
  }

  cancelarEdicaoReceitaFixa();
  await salvarDados();
  renderReceitasFixas();
  toast(id ? 'Receita fixa atualizada com sucesso!' : 'Receita fixa cadastrada com sucesso!', 'ok');
  await processarReceitasAutomatizadas();
}

function editarReceitaFixa(id) {
  const r = (STATE.receitasFixas || []).find(x => x.id === id);
  if (!r) return;

  const elId = document.getElementById('recfixa-id');
  const elDesc = document.getElementById('recfixa-desc');
  const elValor = document.getElementById('recfixa-valor');
  const elConta = document.getElementById('recfixa-conta');
  const elCat = document.getElementById('recfixa-cat');
  const elTipo = document.getElementById('recfixa-tipo-regra');
  const elDia = document.getElementById('recfixa-dia');
  const elBtnSalvar = document.getElementById('recfixa-btn-salvar');
  const elBtnCancelar = document.getElementById('recfixa-btn-cancelar');

  if (elId) elId.value = r.id;
  if (elDesc) elDesc.value = r.descricao || '';
  if (elValor) elValor.value = toBRL(r.valor).replace('R$', 'R$ ');
  if (elConta && r.conta) elConta.value = r.conta;
  if (elCat && r.categoria) elCat.value = r.categoria;
  if (elTipo) elTipo.value = r.tipoRegra || 'dia_util';
  if (elDia) elDia.value = r.diaRegra || 5;

  if (elBtnSalvar) elBtnSalvar.innerHTML = '<i class="ti ti-check"></i> Atualizar Receita Fixa';
  if (elBtnCancelar) elBtnCancelar.style.display = 'inline-flex';

  atualizarDicaRegraReceitaFixa();
  const card = document.getElementById('card-receitas-fixas');
  if (card) card.scrollIntoView({ behavior: 'smooth', block: 'center' });
  setTimeout(() => { if (elDesc) elDesc.focus(); }, 100);
}

function cancelarEdicaoReceitaFixa() {
  const elId = document.getElementById('recfixa-id');
  const elDesc = document.getElementById('recfixa-desc');
  const elValor = document.getElementById('recfixa-valor');
  const elTipo = document.getElementById('recfixa-tipo-regra');
  const elDia = document.getElementById('recfixa-dia');
  const elBtnSalvar = document.getElementById('recfixa-btn-salvar');
  const elBtnCancelar = document.getElementById('recfixa-btn-cancelar');

  if (elId) elId.value = '';
  if (elDesc) elDesc.value = '';
  if (elValor) elValor.value = '';
  if (elTipo) elTipo.value = 'dia_util';
  if (elDia) elDia.value = '5';

  if (elBtnSalvar) elBtnSalvar.innerHTML = '<i class="ti ti-plus"></i> Salvar Receita Fixa';
  if (elBtnCancelar) elBtnCancelar.style.display = 'none';

  atualizarDicaRegraReceitaFixa();
}

async function removerReceitaFixa(id) {
  const r = (STATE.receitasFixas || []).find(x => x.id === id);
  const nome = r ? r.descricao : 'esta receita';
  if (!confirm(`Deseja remover ${nome}? Os lançamentos já creditados no extrato serão preservados.`)) return;

  STATE.receitasFixas = (STATE.receitasFixas || []).filter(x => x.id !== id);
  if (document.getElementById('recfixa-id')?.value === id) cancelarEdicaoReceitaFixa();
  await salvarDados();
  renderReceitasFixas();
  toast('Receita fixa removida.', 'ok');
}

async function alternarAtivoReceitaFixa(id) {
  const r = (STATE.receitasFixas || []).find(x => x.id === id);
  if (!r) return;
  r.ativo = (r.ativo === false) ? true : false;
  await salvarDados();
  renderReceitasFixas();
  toast(r.ativo ? `Receita "${r.descricao}" ativada.` : `Receita "${r.descricao}" pausada.`, 'info');
  if (r.ativo) {
    await processarReceitasAutomatizadas();
  }
}

/* ================= CÁLCULOS COMPARTILHADOS ================= */
function renderPaginaAtiva() {
  const ativo = document.querySelector('.nav-item.active');
  const pagina = ativo ? ativo.getAttribute('data-page') : 'dashboard';
  if (pagina === 'lancamentos') renderLancamentos();
  else if (pagina === 'cartoes') renderCartoes();
  else if (pagina === 'recorrentes') renderRecorrentes();
  else if (pagina === 'metas') renderMetas();
  else if (pagina === 'dividas') renderDividas();
  else if (pagina === 'relatorios') renderRelatorios();
  else if (pagina === 'config') renderConfig();
  renderDashboard();
}
function ultimosMeses(n) {
  const base = new Date();
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(base.getFullYear(), base.getMonth() - i, 1);
    out.push(d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'));
  }
  return out;
}
// Receitas e despesas do mês ("AAAA-MM"), com a mesma regra do Dashboard: todos os lançamentos do mês
// (pagos e pendentes), sem as transferências entre contas.
function receitasDespesasDoMes(mesKey) {
  let receitas = 0, despesas = 0;
  STATE.lancamentos.forEach(l => {
    if (isLancamentoTransferencia(l) || ehLancamentoPagamentoFatura(l) || mesCompetenciaLancamento(l) !== mesKey) return;
    if (l.tipo === 'receita') receitas += l.valor; else despesas += l.valor;
  });
  return { receitas, despesas };
}
// Taxa de poupança = (receitas − despesas) ÷ receitas. Sem receita no mês, não existe (null).
function taxaPoupanca(mesKey) {
  const { receitas, despesas } = receitasDespesasDoMes(mesKey);
  return receitas > 0 ? ((receitas - despesas) / receitas) * 100 : null;
}
function fmtPct(n) {
  return n === null || n === undefined ? '—' : n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + '%';
}
function classeTaxaPoupanca(taxa) {
  return taxa === null ? 'mv-info' : taxa >= 20 ? 'mv-ok' : taxa >= 0 ? 'mv-info' : 'mv-bad';
}
function obterSomaSaldosIniciaisContas(nomeContaFiltro = null) {
  const filtro = nomeContaFiltro ? String(nomeContaFiltro).trim().toLowerCase() : '';
  return Math.round(
    (STATE.contas || [])
      .filter(c => c && c.tipo !== 'cartao' && (!filtro || String(c.nome || '').trim().toLowerCase() === filtro))
      .reduce((acc, c) => acc + (Number(c.saldoInicial) || 0), 0) * 100
  ) / 100;
}
function calcularSomaLancamentosEfetivadosPorConta(mesLimiteOpt = null) {
  const movimentos = {};
  (STATE.contas || []).filter(c => c && c.tipo !== 'cartao').forEach(c => {
    movimentos[c.nome] = 0;
  });
  (STATE.lancamentos || []).forEach(l => {
    if (!l || l.ehMovimentoCofre) return; // retenção em Metas/Cofres já é isolada no Saldo Disponível
    if (!estaPago(l)) return; // só o que já efetivamente entrou/saiu da conta
    if (!(l.conta in movimentos)) return; // conta apagada ou é cartão — não entra no saldo
    if (mesLimiteOpt) {
      const mesL = mesCompetenciaLancamento(l);
      if (mesL && mesL > mesLimiteOpt) return;
    }
    const delta = (l.tipo === 'receita' ? 1 : -1) * (Number(l.valor) || 0);
    movimentos[l.conta] = Math.round((movimentos[l.conta] + delta) * 100) / 100;
  });
  return movimentos;
}
function saldoPorConta(mesLimiteOpt = null) {
  const movimentos = calcularSomaLancamentosEfetivadosPorConta(mesLimiteOpt);
  const saldos = {};
  (STATE.contas || []).filter(c => c && c.tipo !== 'cartao').forEach(c => {
    const inicial = Number(c.saldoInicial) || 0;
    saldos[c.nome] = Math.round((inicial + (movimentos[c.nome] || 0)) * 100) / 100;
  });
  return saldos;
}
function calcularResumoSaldosContasBancarias(mesLimiteOpt = null) {
  const saldos = saldoPorConta(mesLimiteOpt);
  const contasBancarias = (STATE.contas || []).filter(c => c && c.tipo !== 'cartao');
  const nomesContas = [...new Set([...contasBancarias.map(c => c.nome), ...Object.keys(saldos)])];
  const totalContasBancarias = Math.round(
    nomesContas.reduce((acc, nome) => acc + (Number(saldos[nome]) || 0), 0) * 100
  ) / 100;
  return { saldos, contasBancarias, nomesContas, totalContasBancarias };
}
function lancamentosDaFatura(nomeCartao, ano, mes) {
  const nomeLower = String(nomeCartao || '').trim().toLowerCase();
  const cartao = (STATE.contas || []).find(c => c && c.tipo === 'cartao' && String(c.nome || '').trim().toLowerCase() === nomeLower)
    || (STATE.cartoes || []).find(c => c && String(c.nome || '').trim().toLowerCase() === nomeLower);
  if (!cartao) return [];
  const cartaoLower = String(cartao.nome || nomeCartao || '').trim().toLowerCase();
  const anoAlvo = parseInt(ano, 10);
  const mesAlvo = parseInt(mes, 10);
  return (STATE.lancamentos || []).filter(l => {
    if (!l || l.tipo !== 'despesa' || ehLancamentoPagamentoFatura(l)) return false;
    const contaLancLower = String(l.conta || l.cartaoNome || '').trim().toLowerCase();
    const matchCartao = contaLancLower === cartaoLower || (!l.conta && cartao.id && l.cartaoId === cartao.id);
    if (!matchCartao) return false;
    const comp = calcularCompetenciaLancamentoCartao(l, cartao);
    return comp.ano === anoAlvo && comp.mes === mesAlvo;
  });
}

function obterCompetenciaFaturaDashboard(nomeCartao, diaFechamento, dataRefISO) {
  const ref = dataRefISO || hojeLocalISO();
  const [anoRef, mesRef] = ref.split('-').map(Number);
  const compCiclo = competenciaFatura(ref, diaFechamento || 1);

  // 1) Se o mês civil atual tiver lançamentos sem a flag faturaPaga === true, prioriza exibir a fatura do mês civil atual
  const itensMesCivil = lancamentosDaFatura(nomeCartao, anoRef, mesRef);
  const pendentesMesCivil = itensMesCivil.filter(l => l.faturaPaga !== true);
  if (pendentesMesCivil.length > 0) {
    return { ano: anoRef, mes: mesRef };
  }

  // 2) Se a competência do ciclo atual (ex: mês seguinte quando dia >= diaFechamento) tiver lançamentos sem faturaPaga === true, exibe-a
  const itensCiclo = lancamentosDaFatura(nomeCartao, compCiclo.ano, compCiclo.mes);
  const pendentesCiclo = itensCiclo.filter(l => l.faturaPaga !== true);
  if (pendentesCiclo.length > 0) {
    return compCiclo;
  }

  // 3) Se houver fatura anterior/atual em atraso (até o ciclo atual) sem faturaPaga === true, prioriza a mais antiga pendente
  // (Não avança automaticamente para parcelas de meses futuros quando a fatura atual foi liquidada)
  const cartao = (STATE.contas || []).find(c => c.nome === nomeCartao && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === nomeCartao);
  const todosPendentesAteCiclo = (STATE.lancamentos || []).filter(l => {
    if (!l || l.conta !== nomeCartao || l.tipo !== 'despesa' || ehLancamentoPagamentoFatura(l)) return false;
    if (l.faturaPaga === true) return false;
    const c = calcularCompetenciaLancamentoCartao(l, cartao);
    return (c.ano < compCiclo.ano) || (c.ano === compCiclo.ano && c.mes <= compCiclo.mes);
  });
  if (todosPendentesAteCiclo.length > 0) {
    const comps = todosPendentesAteCiclo
      .map(l => calcularCompetenciaLancamentoCartao(l, cartao))
      .sort((a, b) => (a.ano !== b.ano ? a.ano - b.ano : a.mes - b.mes));
    return comps[0];
  }

  // 4) Se a fatura do mês civil atual ou do ciclo atual possui lançamentos e todos têm faturaPaga === true,
  // mantém essa competência em exibição para apresentar "R$ 0,00" e a tag "Fatura Paga"
  if (itensMesCivil.length > 0 && itensCiclo.length === 0) {
    return { ano: anoRef, mes: mesRef };
  }
  if (itensCiclo.length > 0) {
    return compCiclo;
  }
  if (itensMesCivil.length > 0) {
    return { ano: anoRef, mes: mesRef };
  }

  return compCiclo;
}
function gastosPorMacroESubcategoria(lista) {
  const somaMacro = {};
  const subMap = {};
  lista.filter(l => l.tipo === 'despesa' && !isLancamentoTransferencia(l) && !ehLancamentoPagamentoFatura(l) && !(l.ehReembolsavel && l.reembolsado)).forEach(l => {
    const { macro, sub } = extrairMacroESubcategoria(l.categoria);
    somaMacro[macro] = (somaMacro[macro] || 0) + l.valor;
    if (!subMap[macro]) subMap[macro] = {};
    subMap[macro][sub] = (subMap[macro][sub] || 0) + l.valor;
  });
  const macrosOrdenadas = Object.entries(somaMacro).sort((a, b) => b[1] - a[1]);
  return { macrosOrdenadas, subMap };
}
function gastosPorCategoria(lista) {
  return gastosPorMacroESubcategoria(lista).macrosOrdenadas;
}
function patrimonioAcumulado(numMeses, hashtagFiltro) {
  const hoje = new Date();
  const meses = [];
  for (let i = numMeses - 1; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
    meses.push(d.toISOString().slice(0,7));
  }
  const primeiroMes = meses[0];
  const baseLancs = (hashtagFiltro ? STATE.lancamentos.filter(l => lancamentoTemHashtag(l, hashtagFiltro)) : STATE.lancamentos)
    .filter(l => !l.ehMovimentoCofre && !ehLancamentoPagamentoFatura(l) && !isLancamentoTransferencia(l));
  let acumulado = obterSomaSaldosIniciaisContas() + baseLancs
    .filter(l => estaPago(l) && mesCompetenciaLancamento(l) < primeiroMes)
    .reduce((s,l) => s + (l.tipo === 'receita' ? 1 : -1) * l.valor, 0);
  return meses.map(m => {
    const doMes = baseLancs.filter(l => estaPago(l) && mesCompetenciaLancamento(l) === m);
    acumulado += doMes.reduce((s,l) => s + (l.tipo === 'receita' ? 1 : -1) * l.valor, 0);
    return { mes: m, saldo: acumulado };
  });
}

/* ================= CARTÕES & FATURAS (FLUXO INTELIGENTE DE PAGAMENTO) ================= */
let estadoFaturaCartao = {};
let _contextoPagamentoFatura = null;

function navegarFatura(nomeCartao, delta) {
  estadoFaturaCartao[nomeCartao] = (estadoFaturaCartao[nomeCartao] || 0) + delta;
  renderCartoes();
}

function resolverCartaoPorIdOuNome(idOuNome) {
  const listaCartoes = Array.isArray(STATE.cartoes) ? STATE.cartoes : [];
  const listaContasCartao = (STATE.contas || []).filter(c => c.tipo === 'cartao');

  let cartaoInt = null;
  let cartaoConta = null;

  if (idOuNome) {
    cartaoInt = listaCartoes.find(c => c.id === idOuNome || c.nome === idOuNome) || null;
    cartaoConta = listaContasCartao.find(c => c.id === idOuNome || c.nome === idOuNome) || null;
  } else {
    cartaoConta = listaContasCartao[0] || null;
    cartaoInt = listaCartoes[0] || null;
  }

  if (cartaoInt && !cartaoConta) {
    cartaoConta = listaContasCartao.find(c => c.nome === cartaoInt.nome || c.id === cartaoInt.id) || null;
  } else if (cartaoConta && !cartaoInt) {
    cartaoInt = listaCartoes.find(c => c.nome === cartaoConta.nome || c.id === cartaoConta.id) || null;
  }

  if (!cartaoInt && !cartaoConta) return null;

  const nome = (cartaoConta && cartaoConta.nome) || (cartaoInt && cartaoInt.nome);
  const id = (cartaoInt && cartaoInt.id) || (cartaoConta && cartaoConta.id) || nome;
  const diaFechamento = parseInt((cartaoConta && cartaoConta.diaFechamento) || (cartaoInt && cartaoInt.diaFechamento), 10) || 1;
  const diaVencimento = parseInt((cartaoConta && cartaoConta.diaVencimento) || (cartaoInt && cartaoInt.diaVencimento), 10) || 10;
  const limiteTotal = Number((cartaoInt && (cartaoInt.limiteTotal || cartaoInt.limite)) || (cartaoConta && cartaoConta.limite)) || 0;

  return { id, nome, diaFechamento, diaVencimento, limiteTotal, cartaoInt, cartaoConta };
}

function abrirModalPagamentoFatura(idCartao, mesParam, anoParam) {
  const infoCartao = resolverCartaoPorIdOuNome(idCartao);
  if (!infoCartao) {
    toast('Cartão de crédito não encontrado.', 'err');
    return;
  }

  const { id, nome: nomeCartao, diaFechamento } = infoCartao;
  let mes = parseInt(mesParam, 10);
  let ano = parseInt(anoParam, 10);

  if (!mes || !ano || isNaN(mes) || isNaN(ano)) {
    const pageCartoesAtiva = document.getElementById('page-cartoes') && document.getElementById('page-cartoes').classList.contains('active');
    if (pageCartoesAtiva && estadoFaturaCartao[nomeCartao] !== undefined) {
      const offset = estadoFaturaCartao[nomeCartao] || 0;
      const compAtual = competenciaFatura(hojeLocalISO(), diaFechamento);
      ano = compAtual.ano;
      mes = compAtual.mes + offset;
      while (mes > 12) { mes -= 12; ano++; }
      while (mes < 1) { mes += 12; ano--; }
    } else {
      const compAtiva = obterCompetenciaFaturaDashboard(nomeCartao, diaFechamento, hojeLocalISO());
      ano = compAtiva.ano;
      mes = compAtiva.mes;
    }
  }

  let itensFatura = lancamentosDaFatura(nomeCartao, ano, mes);
  let itensPendentes = itensFatura.filter(l => l.faturaPaga !== true);

  // Fallback: se a competência informada não tiver saldo pendente, verifica se há fatura ativa pendente no cartão
  if (itensPendentes.length === 0) {
    const compFallback = obterCompetenciaFaturaDashboard(nomeCartao, diaFechamento, hojeLocalISO());
    const itensFallback = lancamentosDaFatura(nomeCartao, compFallback.ano, compFallback.mes);
    const pendentesFallback = itensFallback.filter(l => l.faturaPaga !== true);
    if (pendentesFallback.length > 0) {
      ano = compFallback.ano;
      mes = compFallback.mes;
      itensFatura = itensFallback;
      itensPendentes = pendentesFallback;
    }
  }

  const valorFatura = Math.round(itensPendentes.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;

  if (valorFatura <= 0) {
    toast('Esta fatura já está liquidada ou não possui saldo pendente.', 'info');
    return;
  }

  const contasDebito = (STATE.contas || []).filter(c => c.tipo !== 'cartao');
  const saldos = saldoPorConta();
  const selConta = document.getElementById('pagar-fatura-conta-origem');
  const btnConfirmarPag = document.getElementById('btn-confirmar-pagamento-fatura');
  if (selConta) {
    if (contasDebito.length) {
      selConta.disabled = false;
      selConta.innerHTML = contasDebito.map(c => {
        const saldoAtual = saldos[c.nome] || 0;
        return `<option value="${escHtml(c.id || c.nome)}" data-nome="${escHtml(c.nome)}">${escHtml(c.nome)} — Saldo: ${toBRL(saldoAtual)}</option>`;
      }).join('');
    } else {
      selConta.disabled = true;
      selConta.innerHTML = '<option value="">Nenhuma conta bancária cadastrada (use Apenas Marcar como Paga)</option>';
    }
  }
  if (btnConfirmarPag) {
    btnConfirmarPag.disabled = contasDebito.length === 0;
  }

  const nomesMes = { 1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez' };
  const competenciaLabel = `${nomesMes[mes] || String(mes).padStart(2, '0')}/${ano}`;

  _contextoPagamentoFatura = {
    idCartao: id,
    nomeCartao,
    valorFatura,
    mes,
    ano,
    qtdItens: itensPendentes.length
  };

  const inpCartaoId = document.getElementById('pagar-fatura-cartao-id');
  const inpValorRaw = document.getElementById('pagar-fatura-valor-raw');
  const inpMes = document.getElementById('pagar-fatura-mes');
  const inpAno = document.getElementById('pagar-fatura-ano');
  if (inpCartaoId) inpCartaoId.value = id;
  if (inpValorRaw) inpValorRaw.value = String(valorFatura);
  if (inpMes) inpMes.value = String(mes);
  if (inpAno) inpAno.value = String(ano);

  const elSub = document.getElementById('pagar-fatura-subtitulo');
  const elComp = document.getElementById('pagar-fatura-competencia-pill');
  const elValTotal = document.getElementById('pagar-fatura-valor-total');
  const elQtdItens = document.getElementById('pagar-fatura-qtd-itens');
  const elLimLib = document.getElementById('pagar-fatura-limite-liberado');

  if (elSub) elSub.textContent = `${nomeCartao} · Competência ${competenciaLabel}`;
  if (elComp) elComp.textContent = competenciaLabel;
  if (elValTotal) elValTotal.textContent = toBRL(valorFatura);
  if (elQtdItens) elQtdItens.textContent = `${itensPendentes.length} lançamento(s) pendente(s) serão marcados como Liquidados`;
  if (elLimLib) elLimLib.textContent = `+ ${toBRL(valorFatura)}`;

  atualizarPreviewSaldoPagamentoFatura();
  abrirModal('modal-pagar-fatura');
}

function atualizarPreviewSaldoPagamentoFatura() {
  const selConta = document.getElementById('pagar-fatura-conta-origem');
  const inpValorRaw = document.getElementById('pagar-fatura-valor-raw');
  const elSaldoAtual = document.getElementById('pagar-fatura-saldo-atual');
  const elSaldoFinal = document.getElementById('pagar-fatura-saldo-final');
  if (!selConta || !elSaldoAtual || !elSaldoFinal) return;

  const valConta = selConta.value;
  const contaObj = (STATE.contas || []).find(c => c.tipo !== 'cartao' && (c.id === valConta || c.nome === valConta));
  const nomeConta = contaObj ? contaObj.nome : valConta;
  const saldos = saldoPorConta();
  const saldoAtual = Number(saldos[nomeConta]) || 0;
  const valorFatura = Number(inpValorRaw ? inpValorRaw.value : (_contextoPagamentoFatura && _contextoPagamentoFatura.valorFatura)) || 0;
  const saldoFinal = Math.round((saldoAtual - valorFatura) * 100) / 100;

  elSaldoAtual.textContent = toBRL(saldoAtual);
  elSaldoAtual.style.color = saldoAtual >= 0 ? 'var(--text)' : 'var(--bad)';
  elSaldoFinal.textContent = toBRL(saldoFinal);
  elSaldoFinal.style.color = saldoFinal >= 0 ? 'var(--good)' : 'var(--bad)';
}

/**
 * Atualiza todos os lançamentos de uma fatura para Pago/Liquidado e grava em STATE.config.faturasPagas.
 * Compartilhado por confirmarPagamentoFatura, marcarFaturaComoPaga e importação retroativa Pluggy/OFX.
 */
function quitarItensFaturaCartao(infoCartao, anoNum, mesNum, opcoes = {}) {
  if (!infoCartao || !infoCartao.nome || !anoNum || !mesNum) {
    return { itensAtualizados: 0, valorSettled: 0, chaveFaturaPaga: '' };
  }

  const nomeCartao = infoCartao.nome;
  const cartaoIdResolvido = infoCartao.id || nomeCartao;
  const fechamento = parseInt(infoCartao.diaFechamento, 10) || 1;
  const vencimento = parseInt(infoCartao.diaVencimento, 10) || 10;
  const itensFatura = lancamentosDaFatura(nomeCartao, anoNum, mesNum);
  const itensAlvo = Array.isArray(opcoes.itensAlvo)
    ? opcoes.itensAlvo
    : itensFatura.filter(l => l.faturaPaga !== true);

  const dataPag = opcoes.dataPagamento || hojeLocalISO();
  const contaOrigem = opcoes.contaOrigem !== undefined ? String(opcoes.contaOrigem || '').trim() : '';
  const pagamentoFaturaId = opcoes.pagamentoFaturaId ? String(opcoes.pagamentoFaturaId).trim() : '';
  const origemQuitacao = opcoes.origemQuitacao || (pagamentoFaturaId ? 'conta_corrente' : 'manual_sem_conta');
  const valorCalculado = Math.round(itensAlvo.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
  const valorFinal = (typeof opcoes.valorTotal === 'number' && !isNaN(opcoes.valorTotal) && opcoes.valorTotal > 0)
    ? Math.round(opcoes.valorTotal * 100) / 100
    : valorCalculado;
  const refCompetencia = `${String(mesNum).padStart(2, '0')}/${anoNum}`;
  const dataVencCalc = typeof calcularVencimentoFatura === 'function'
    ? calcularVencimentoFatura(anoNum, mesNum, fechamento, vencimento)
    : undefined;

  itensAlvo.forEach(l => {
    l.pago = true;
    l.faturaPaga = true;
    l.status = 'Liquidado';
    l.cartaoNome = l.cartaoNome || nomeCartao;
    if (!l.cartaoId && cartaoIdResolvido) l.cartaoId = cartaoIdResolvido;
    l.faturaAno = anoNum;
    l.faturaMes = mesNum;
    l.faturaCompetencia = l.faturaCompetencia || refCompetencia;
    if (dataVencCalc && !l.dataVencimentoFatura) l.dataVencimentoFatura = dataVencCalc;
    delete l.posPagamentoFatura;
    delete l.criadoAposPagamentoFatura;
    l.dataPagamentoFatura = dataPag;
    if (contaOrigem) {
      l.contaPagamentoFatura = contaOrigem;
    } else if (!l.contaPagamentoFatura) {
      delete l.contaPagamentoFatura;
    }
    if (pagamentoFaturaId) {
      l.pagamentoFaturaId = pagamentoFaturaId;
    }
    l.sincronizado = false;
  });

  if (!STATE.config) STATE.config = {};
  if (!STATE.config.faturasPagas || typeof STATE.config.faturasPagas !== 'object') {
    STATE.config.faturasPagas = {};
  }

  const chaveFaturaPaga = construirChaveFaturaCartao(nomeCartao, anoNum, mesNum);
  const regAnterior = STATE.config.faturasPagas[chaveFaturaPaga];
  const idsExistentesReg = (regAnterior && Array.isArray(regAnterior.itensPagosIds)) ? regAnterior.itensPagosIds : [];
  const idsTodosFatura = itensFatura.map(l => l.id).filter(Boolean);
  const idsNovos = itensAlvo.map(l => l.id).filter(Boolean);
  const todosIdsPagos = [...new Set([...idsExistentesReg, ...idsTodosFatura, ...idsNovos])];
  const totalBrutoFatura = Math.round(itensFatura.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;

  STATE.config.faturasPagas[chaveFaturaPaga] = {
    ...(regAnterior || {}),
    cartaoNome: nomeCartao,
    cartaoId: cartaoIdResolvido,
    ano: anoNum,
    mes: mesNum,
    valor: valorFinal || totalBrutoFatura || (regAnterior && regAnterior.valor) || 0,
    dataPagamento: dataPag,
    contaOrigem: contaOrigem || (regAnterior && regAnterior.contaOrigem) || '',
    pagamentoFaturaId: pagamentoFaturaId || (regAnterior && regAnterior.pagamentoFaturaId) || undefined,
    quitacaoRetroativa: Boolean(opcoes.quitacaoRetroativa || (regAnterior && regAnterior.quitacaoRetroativa)),
    pagamentoDetectado: Boolean(opcoes.pagamentoDetectado || (regAnterior && regAnterior.pagamentoDetectado)),
    origemQuitacao,
    itensPagosIds: todosIdsPagos
  };

  return { itensAtualizados: itensAlvo.length, valorSettled: valorFinal, chaveFaturaPaga };
}

async function confirmarPagamentoFatura(idContaOrigem, idCartao, valorFatura, mes, ano) {
  // Permite invocação direta pelo botão do modal (sem argumentos) ou programática com parâmetros explícitos
  if (!idContaOrigem || (typeof idContaOrigem === 'object' && idContaOrigem !== null)) {
    const selConta = document.getElementById('pagar-fatura-conta-origem');
    idContaOrigem = selConta ? selConta.value : '';
  }
  if (!idCartao) {
    const inpCartao = document.getElementById('pagar-fatura-cartao-id');
    idCartao = (inpCartao && inpCartao.value) || (_contextoPagamentoFatura && _contextoPagamentoFatura.idCartao);
  }
  if (valorFatura === undefined || valorFatura === null || isNaN(Number(valorFatura))) {
    const inpVal = document.getElementById('pagar-fatura-valor-raw');
    valorFatura = inpVal && inpVal.value ? parseFloat(inpVal.value) : (_contextoPagamentoFatura && _contextoPagamentoFatura.valorFatura);
  }
  if (!mes) {
    const inpMes = document.getElementById('pagar-fatura-mes');
    mes = inpMes && inpMes.value ? parseInt(inpMes.value, 10) : (_contextoPagamentoFatura && _contextoPagamentoFatura.mes);
  }
  if (!ano) {
    const inpAno = document.getElementById('pagar-fatura-ano');
    ano = inpAno && inpAno.value ? parseInt(inpAno.value, 10) : (_contextoPagamentoFatura && _contextoPagamentoFatura.ano);
  }

  const contaOrigemObj = (STATE.contas || []).find(c => c.tipo !== 'cartao' && (c.id === idContaOrigem || c.nome === idContaOrigem));
  const nomeContaOrigem = contaOrigemObj ? contaOrigemObj.nome : String(idContaOrigem || '').trim();
  if (!nomeContaOrigem) {
    toast('Selecione uma conta bancária de origem válida.', 'err');
    return;
  }

  const infoCartao = resolverCartaoPorIdOuNome(idCartao);
  if (!infoCartao) {
    toast('Cartão de crédito não encontrado.', 'err');
    return;
  }

  const { id: cartaoIdResolvido, nome: nomeCartao, diaFechamento } = infoCartao;
  const mesNum = parseInt(mes, 10) || competenciaFatura(hojeLocalISO(), diaFechamento).mes;
  const anoNum = parseInt(ano, 10) || competenciaFatura(hojeLocalISO(), diaFechamento).ano;

  const itensFatura = lancamentosDaFatura(nomeCartao, anoNum, mesNum);
  const itensPendentes = itensFatura.filter(l => l.faturaPaga !== true);
  const somaPendentes = Math.round(itensPendentes.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
  const valorFinal = (typeof valorFatura === 'number' && !isNaN(valorFatura) && valorFatura > 0)
    ? Math.round(valorFatura * 100) / 100
    : somaPendentes;

  if (valorFinal <= 0) {
    toast('Esta fatura já se encontra paga.', 'info');
    fecharModal('modal-pagar-fatura');
    return;
  }

  const btnConfirmar = document.getElementById('btn-confirmar-pagamento-fatura');
  if (btnConfirmar && btnConfirmar.dataset.morphing === '1') return;

  const executarTransacaoAtomica = async () => {
    const dataHoje = hojeLocalISO();
    const idTransacaoPagamento = uid();
    const refCompetencia = `${String(mesNum).padStart(2, '0')}/${anoNum}`;

    // Ação Atómica (a): Gera o lançamento automático de Saída (Despesa) na conta bancária de origem
    // Classificado como "Transferência/Pagamento de Fatura" (ehTransferencia: true, ehPagamentoFatura: true)
    // para abater o saldo bancário sem duplicar gastos por categoria no DRE.
    const lancamentoPagamento = {
      id: idTransacaoPagamento,
      tipo: 'despesa',
      descricao: `Pagamento Fatura ${nomeCartao}`,
      valor: valorFinal,
      data: dataHoje,
      categoria: 'Transferência/Pagamento de Fatura',
      conta: nomeContaOrigem,
      contaOrigemId: contaOrigemObj ? contaOrigemObj.id : idContaOrigem,
      cartaoId: cartaoIdResolvido,
      cartaoNome: nomeCartao,
      faturaMes: mesNum,
      faturaAno: anoNum,
      faturaCompetencia: refCompetencia,
      itensPagosIds: itensPendentes.map(l => l.id),
      pago: true,
      status: 'Pago/Efetivado',
      ehTransferencia: true,
      ehPagamentoFatura: true,
      tags: ['fatura', 'cartao'],
      sincronizado: false
    };
    STATE.lancamentos.push(lancamentoPagamento);

    // Ação Atómica (b): Marca todos os lançamentos pendentes dessa fatura como pagos e regista em STATE.config.faturasPagas
    quitarItensFaturaCartao(infoCartao, anoNum, mesNum, {
      itensAlvo: itensPendentes,
      dataPagamento: dataHoje,
      contaOrigem: nomeContaOrigem,
      pagamentoFaturaId: idTransacaoPagamento,
      valorTotal: valorFinal,
      origemQuitacao: 'conta_corrente'
    });

    // Ação Atómica (c): Recalcula dinamicamente o limiteUsado e limiteDisponivel em STATE.cartoes e STATE.contas
    recalcularLimitesCartoes();

    // Persistência imediata e síncrona no localStorage + pipeline salvarDados()
    try {
      persistirStateNoLocalStorage();
    } catch (errStorage) {
      console.error('Erro na gravação imediata do localStorage:', errStorage);
    }
    await salvarDados();
    renderPaginaAtiva();
    renderDashboard();
    if (document.getElementById('page-cartoes')) renderCartoes();
    sincronizarEmSegundoPlano();
  };

  const modalEl = document.getElementById('modal-pagar-fatura');
  if (btnConfirmar && modalEl && modalEl.classList.contains('show') && typeof executarComMorphingButton === 'function') {
    await executarComMorphingButton(btnConfirmar, executarTransacaoAtomica, () => {
      fecharModal('modal-pagar-fatura');
      toast(`Fatura de ${nomeCartao} (${toBRL(valorFinal)}) paga via ${nomeContaOrigem}! Limite restaurado.`, 'ok');
    });
  } else {
    await executarTransacaoAtomica();
    fecharModal('modal-pagar-fatura');
    toast(`Fatura de ${nomeCartao} (${toBRL(valorFinal)}) paga via ${nomeContaOrigem}! Limite restaurado.`, 'ok');
  }
}

function pagarFaturaInteira(nomeCartao, ano, mes) {
  abrirModalPagamentoFatura(nomeCartao, mes, ano);
}

/**
 * Marca uma fatura inteira como Paga/Liquidada sem gerar novo lançamento de saída em conta bancária.
 * Útil para faturas históricas já quitadas, importações via Pluggy/OFX ou cartões sem conta vinculada.
 */
async function marcarFaturaComoPaga(idCartao, mesParam, anoParam, opcoes = {}) {
  const infoCartao = resolverCartaoPorIdOuNome(idCartao);
  if (!infoCartao) {
    toast('Cartão de crédito não encontrado.', 'err');
    return false;
  }

  const { id: cartaoIdResolvido, nome: nomeCartao, diaFechamento } = infoCartao;
  const compAtual = competenciaFatura(hojeLocalISO(), diaFechamento);
  const mesNum = parseInt(mesParam, 10) || compAtual.mes;
  const anoNum = parseInt(anoParam, 10) || compAtual.ano;

  const itensFatura = lancamentosDaFatura(nomeCartao, anoNum, mesNum);
  const itensPendentes = itensFatura.filter(l => l.faturaPaga !== true);
  if (!itensFatura.length) {
    toast('Não há lançamentos nesta competência para marcar como paga.', 'info');
    return false;
  }

  const chaveFatura = construirChaveFaturaCartao(nomeCartao, anoNum, mesNum);
  const jaRegistrada = Boolean(STATE.config && STATE.config.faturasPagas && STATE.config.faturasPagas[chaveFatura]);
  if (!itensPendentes.length && jaRegistrada) {
    toast('Esta fatura já está marcada como Paga.', 'info');
    return false;
  }

  const resultado = quitarItensFaturaCartao(infoCartao, anoNum, mesNum, {
    itensAlvo: itensPendentes,
    dataPagamento: opcoes.dataPagamento || hojeLocalISO(),
    contaOrigem: opcoes.contaOrigem || '',
    pagamentoFaturaId: opcoes.pagamentoFaturaId || '',
    quitacaoRetroativa: opcoes.quitacaoRetroativa !== undefined ? Boolean(opcoes.quitacaoRetroativa) : true,
    pagamentoDetectado: Boolean(opcoes.pagamentoDetectado),
    origemQuitacao: opcoes.origemQuitacao || 'manual_sem_conta'
  });

  recalcularLimitesCartoes();

  try {
    persistirStateNoLocalStorage();
  } catch (errStorage) {
    console.error('Erro na gravação imediata do localStorage:', errStorage);
  }
  await salvarDados();
  renderPaginaAtiva();
  renderDashboard();
  if (document.getElementById('page-cartoes')) renderCartoes();
  if (typeof sincronizarEmSegundoPlano === 'function') sincronizarEmSegundoPlano();

  const refComp = `${String(mesNum).padStart(2, '0')}/${anoNum}`;
  if (!opcoes.silencioso) {
    toast(`Fatura de ${nomeCartao} (${refComp} · ${toBRL(resultado.valorSettled)}) marcada como Paga!`, 'ok');
  }
  return { ...resultado, cartaoId: cartaoIdResolvido, nomeCartao, ano: anoNum, mes: mesNum };
}

async function confirmarMarcarFaturaComoPaga() {
  const inpCartao = document.getElementById('pagar-fatura-cartao-id');
  const inpMes = document.getElementById('pagar-fatura-mes');
  const inpAno = document.getElementById('pagar-fatura-ano');
  const idCartao = (inpCartao && inpCartao.value) || (_contextoPagamentoFatura && _contextoPagamentoFatura.idCartao);
  const mes = (inpMes && inpMes.value) ? parseInt(inpMes.value, 10) : (_contextoPagamentoFatura && _contextoPagamentoFatura.mes);
  const ano = (inpAno && inpAno.value) ? parseInt(inpAno.value, 10) : (_contextoPagamentoFatura && _contextoPagamentoFatura.ano);

  const ok = await marcarFaturaComoPaga(idCartao, mes, ano, { origemQuitacao: 'manual_sem_conta' });
  if (ok) {
    fecharModal('modal-pagar-fatura');
  }
}

function renderCartoes() {
  recalcularLimitesCartoes();
  const cartoes = STATE.contas.filter(c => c.tipo === 'cartao');
  const emptyEl = document.getElementById('cartoes-empty');
  const heroBar = document.getElementById('cartoes-resumo-fatura-bar');
  if (emptyEl) emptyEl.style.display = cartoes.length ? 'none' : 'block';

  const nomesMes = { 1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez' };

  if (heroBar) {
    if (!cartoes.length) {
      heroBar.style.display = 'none';
    } else {
      heroBar.style.display = 'flex';
      const cartaoHero = cartoes[0];
      const offsetHero = estadoFaturaCartao[cartaoHero.nome] || 0;
      const compHero = obterCompetenciaFaturaDashboard(cartaoHero.nome, cartaoHero.diaFechamento || 1, hojeLocalISO());
      let anoH = compHero.ano, mesH = compHero.mes + offsetHero;
      while (mesH > 12) { mesH -= 12; anoH++; }
      while (mesH < 1) { mesH += 12; anoH--; }
      const itensHero = lancamentosDaFatura(cartaoHero.nome, anoH, mesH);
      const totalBrutoHero = Math.round(itensHero.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
      const itensPendentesHero = itensHero.filter(l => l.faturaPaga !== true);
      const totalAbertoHero = Math.round(itensPendentesHero.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
      const faturaSemSaldoHero = totalAbertoHero === 0;
      const faturaPagaHeroComItens = itensHero.length > 0 && faturaSemSaldoHero;

      const elHeroValor = document.getElementById('cartoes-hero-total-valor');
      const elHeroSub = document.getElementById('cartoes-hero-sub');
      const elHeroBadge = document.getElementById('cartoes-hero-badge-paga');
      const btnHeroPagar = document.getElementById('btn-hero-pagar-fatura');
      const btnHeroMarcarPaga = document.getElementById('btn-hero-marcar-paga');

      if (elHeroValor) {
        elHeroValor.textContent = toBRL(totalAbertoHero);
        elHeroValor.className = `metric-value ${totalAbertoHero > 0 ? 'mv-bad' : 'mv-ok'} valor-sensivel`;
      }
      if (elHeroBadge) {
        elHeroBadge.style.display = faturaPagaHeroComItens ? 'inline-flex' : 'none';
      }
      if (elHeroSub) {
        elHeroSub.textContent = faturaPagaHeroComItens
          ? `${cartaoHero.nome} (${nomesMes[mesH]}/${anoH}) · Fatura Paga (${toBRL(totalBrutoHero)})`
          : `${cartaoHero.nome} · Competência ${nomesMes[mesH]}/${anoH} (${itensPendentesHero.length} pendente(s))`;
      }
      if (btnHeroMarcarPaga) {
        btnHeroMarcarPaga.style.display = faturaSemSaldoHero ? 'none' : 'inline-flex';
        btnHeroMarcarPaga.disabled = faturaSemSaldoHero;
        btnHeroMarcarPaga.setAttribute('data-cartao-id', cartaoHero.id || cartaoHero.nome);
        btnHeroMarcarPaga.setAttribute('data-mes', String(mesH));
        btnHeroMarcarPaga.setAttribute('data-ano', String(anoH));
      }
      if (btnHeroPagar) {
        btnHeroPagar.disabled = faturaSemSaldoHero;
        btnHeroPagar.setAttribute('data-cartao-id', cartaoHero.id || cartaoHero.nome);
        btnHeroPagar.setAttribute('data-mes', String(mesH));
        btnHeroPagar.setAttribute('data-ano', String(anoH));
        btnHeroPagar.removeAttribute('onclick');
        btnHeroPagar.onclick = null;
        btnHeroPagar.innerHTML = faturaSemSaldoHero
          ? `<i class="ti ti-circle-check"></i> Fatura Paga`
          : `<i class="ti ti-cash-banknote"></i> Pagar Fatura`;
      }
    }
  }

  document.getElementById('cartoes-content').innerHTML = cartoes.map(cartao => {
    const offset = estadoFaturaCartao[cartao.nome] || 0;
    const compAtual = obterCompetenciaFaturaDashboard(cartao.nome, cartao.diaFechamento || 1, hojeLocalISO());
    let ano = compAtual.ano, mes = compAtual.mes + offset;
    while (mes > 12) { mes -= 12; ano++; }
    while (mes < 1) { mes += 12; ano--; }
    const itens = lancamentosDaFatura(cartao.nome, ano, mes).sort((a,b) => (a.data||'').localeCompare(b.data||''));
    const totalBruto = Math.round(itens.reduce((s,l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
    // Avalia ESTRITAMENTE apenas lançamentos sem a flag faturaPaga === true
    const itensPendentes = itens.filter(l => l.faturaPaga !== true);
    const totalAberto = Math.round(itensPendentes.reduce((s,l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
    const faturaSemSaldo = totalAberto === 0;
    const faturaJaPaga = itens.length > 0 && faturaSemSaldo;

    // Comprometimento global em aberto deste cartão: soma APENAS itens com faturaPaga !== true
    const pendentesGlobaisCartao = (STATE.lancamentos || []).filter(
      l => l.conta === cartao.nome && l.tipo === 'despesa' && !ehLancamentoPagamentoFatura(l) && l.faturaPaga !== true
    );
    const limiteUsadoCartao = Math.round(pendentesGlobaisCartao.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
    const limiteTotalCartao = Number(cartao.limite || cartao.limiteTotal) || 0;
    const limiteDisponivelCartao = limiteTotalCartao > 0 ? Math.max(0, Math.round((limiteTotalCartao - limiteUsadoCartao) * 100) / 100) : 0;
    const usoLimite = limiteTotalCartao > 0 ? Math.min(100, (limiteUsadoCartao / limiteTotalCartao) * 100) : null;

    const vencimento = calcularVencimentoFatura(ano, mes, cartao.diaFechamento, cartao.diaVencimento);
    const [va,vm,vd] = vencimento.split('-');
    const idOuNomeCartao = escHtml(cartao.id || cartao.nome);

    return `
    <div class="card" style="margin-bottom:20px">
      <div class="cartao-fatura-container">
        <div style="display:flex;flex-direction:column;align-items:center;gap:12px;width:100%">
          ${gerarCartaoFisico3DHTML(cartao, mes, ano)}
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;justify-content:center;margin-top:2px">
            <button type="button" class="btn btn-sm" onclick="abrirModalGerirCartoes()"><i class="ti ti-settings"></i> Configurar Cartão</button>
            <button type="button" class="btn btn-sm btn-primary btn-pagar-fatura" data-cartao-id="${idOuNomeCartao}" data-mes="${mes}" data-ano="${ano}" ${faturaSemSaldo ? 'disabled' : ''}>
              <i class="ti ${faturaSemSaldo ? 'ti-circle-check' : 'ti-cash-banknote'}"></i> ${faturaSemSaldo ? 'Fatura Paga' : 'Pagar Fatura'}
            </button>
          </div>
        </div>
        <div style="min-width:0;width:100%">
          <div class="card-header" style="margin-bottom:.75rem">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
              <i class="ti ti-credit-card" style="font-size:18px;color:${cartao.cor || 'var(--accent)'}"></i>
              <div class="card-title" style="font-size:14px;color:var(--text);font-weight:700">${escHtml(cartao.nome)}</div>
              ${faturaJaPaga ? `<span class="badge badge-fatura-paga"><i class="ti ti-circle-check"></i> Fatura Paga</span>` : ''}
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <button class="icon-btn" data-cartao-nome="${escHtml(cartao.nome)}" onclick="navegarFatura(this.dataset.cartaoNome, -1)" title="Fatura anterior"><i class="ti ti-chevron-left"></i></button>
              <span style="font-size:12.5px;font-weight:600;min-width:90px;text-align:center">${nomesMes[mes]}/${ano}</span>
              <button class="icon-btn" data-cartao-nome="${escHtml(cartao.nome)}" onclick="navegarFatura(this.dataset.cartaoNome, 1)" title="Próxima fatura"><i class="ti ti-chevron-right"></i></button>
              ${!faturaSemSaldo ? `<button type="button" class="btn btn-sm btn-marcar-fatura-paga" style="margin-left:4px" data-cartao-id="${idOuNomeCartao}" data-mes="${mes}" data-ano="${ano}" title="Marcar fatura como Paga sem gerar débito em conta"><i class="ti ti-circle-check"></i> Marcar como Paga</button>` : ''}
              <button type="button" class="btn btn-sm btn-primary btn-pagar-fatura" style="margin-left:6px" data-cartao-id="${idOuNomeCartao}" data-mes="${mes}" data-ano="${ano}" ${faturaSemSaldo ? 'disabled' : ''}>
                <i class="ti ${faturaSemSaldo ? 'ti-circle-check' : 'ti-cash-banknote'}"></i> ${faturaSemSaldo ? 'Fatura Paga' : 'Pagar Fatura'}
              </button>
            </div>
          </div>
          <div class="grid4" style="margin-bottom:1rem">
            <div class="metric">
              <div style="display:flex;align-items:center;justify-content:space-between;gap:4px">
                <div class="metric-label">Total da fatura</div>
                ${faturaJaPaga ? `<span class="badge badge-fatura-paga" style="font-size:10px;padding:1px 6px">Liquidado</span>` : ''}
              </div>
              <div class="metric-value ${totalAberto > 0 ? 'mv-bad' : 'mv-ok'} valor-sensivel">${toBRL(totalAberto)}</div>
              <div class="metric-sub">${faturaJaPaga ? `Pago: ${toBRL(totalBruto)} (${itens.length} itens)` : `${itens.length} lançamento(s)`}</div>
            </div>
            <div class="metric"><div class="metric-label">Vencimento</div><div class="metric-value mv-info" style="font-size:18px">${vd}/${vm}</div><div class="metric-sub">fecha dia ${cartao.diaFechamento || 1}</div></div>
            <div class="metric"><div class="metric-label">Pendente de pagamento</div><div class="metric-value ${itensPendentes.length > 0 ? 'mv-bad' : 'mv-ok'}">${itensPendentes.length}</div><div class="metric-sub">de ${itens.length} itens</div></div>
            <div class="metric"><div class="metric-label">${limiteTotalCartao ? 'Limite usado' : 'Limite'}</div>${limiteTotalCartao ? `<div class="metric-value ${usoLimite>=90?'mv-bad':'mv-info'}">${usoLimite.toFixed(0)}%</div><div class="metric-sub">Disp: <span class="valor-sensivel" style="color:var(--good);font-weight:700">${toBRL(limiteDisponivelCartao)}</span> · Usado: <span class="valor-sensivel">${toBRL(limiteUsadoCartao)}</span></div>` : `<div class="metric-value mv-info" style="font-size:13px">Não definido</div><div class="metric-sub">configure em Categorias &amp; Contas</div>`}</div>
          </div>
          <div class="table-wrap">
            <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Status</th><th style="text-align:right">Valor</th></tr></thead><tbody>
              ${itens.length ? itens.map(l => {
                const [a,m,d] = (l.data||'').split('-');
                return `<tr><td>${d}/${m}/${a}</td><td>${escHtml(l.descricao || '-')}${badgeParcelaHTML(l)}</td><td><span class="badge badge-cat">${escHtml(l.categoria || '-')}</span></td><td>${badgeStatusHTML(l, true)}</td><td style="text-align:right" class="valor-sensivel">${toBRL(l.valor)}</td></tr>`;
              }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem 0">Nenhum lançamento nessa fatura.</td></tr>`}
            </tbody></table>
          </div>
        </div>
      </div>
    </div>`;
  }).join('');
  inicializarEfeito3DCartoes();
}
const renderizarFaturaCartao = renderCartoes;

/**
 * Delegação Global de Eventos (Event Delegation) para todos os botões .btn-pagar-fatura
 * (Dashboard, Aba de Cartões & Faturas e barra Hero).
 */
function inicializarDelegacaoPagarFatura() {
  if (window._delegacaoPagarFaturaAtiva) return;
  window._delegacaoPagarFaturaAtiva = true;

  document.addEventListener('click', (event) => {
    const btnMarcarPaga = event.target.closest('.btn-marcar-fatura-paga');
    if (btnMarcarPaga && !btnMarcarPaga.disabled) {
      event.preventDefault();
      event.stopPropagation();

      const idCartao = btnMarcarPaga.getAttribute('data-cartao-id') || btnMarcarPaga.dataset.cartaoId || '';
      const mesAttr = btnMarcarPaga.getAttribute('data-mes') || btnMarcarPaga.dataset.mes;
      const anoAttr = btnMarcarPaga.getAttribute('data-ano') || btnMarcarPaga.dataset.ano;

      marcarFaturaComoPaga(idCartao, mesAttr, anoAttr, { origemQuitacao: 'manual_sem_conta' });
      return;
    }

    const btn = event.target.closest('.btn-pagar-fatura');
    if (!btn || btn.disabled) return;

    event.preventDefault();
    event.stopPropagation();

    const idCartao = btn.getAttribute('data-cartao-id') || btn.dataset.cartaoId || '';
    const mesAttr = btn.getAttribute('data-mes') || btn.dataset.mes;
    const anoAttr = btn.getAttribute('data-ano') || btn.dataset.ano;

    abrirModalPagamentoFatura(idCartao, mesAttr, anoAttr);
  });
}

inicializarDelegacaoPagarFatura();

/* ================= COFRES / CAIXINHAS (VAULTS) & CÁLCULO DE SALDOS ================= */
function migrarCofresParaMetas() {
  if (!Array.isArray(STATE.metas)) STATE.metas = [];
  if (Array.isArray(STATE.cofres) && STATE.cofres.length > 0) {
    STATE.cofres.forEach(c => {
      const jaExiste = STATE.metas.some(m => m.id === c.id || (m.nome && c.nome && m.nome.toLowerCase() === c.nome.toLowerCase()));
      if (!jaExiste) {
        STATE.metas.push({
          id: c.id || uid(),
          nome: c.nome || 'Cofre',
          valorAlvo: Number(c.objetivo) || Number(c.saldoAlocado) || 1000,
          valorAtual: Number(c.saldoAlocado) || 0
        });
      } else {
        const alvo = STATE.metas.find(m => m.id === c.id || (m.nome && c.nome && m.nome.toLowerCase() === c.nome.toLowerCase()));
        if (alvo && (Number(c.saldoAlocado) || 0) > 0) {
          alvo.valorAtual = Math.round(((Number(alvo.valorAtual) || 0) + (Number(c.saldoAlocado) || 0)) * 100) / 100;
        }
      }
    });
    STATE.cofres = [];
    salvarDados();
  }
}
function calcularTotalGuardadoMetas() {
  migrarCofresParaMetas();
  const somaMetas = (STATE.metas || []).reduce((s, m) => s + (Number(m.valorAtual) || 0), 0);
  const somaCofres = (STATE.cofres || []).reduce((s, c) => s + (Number(c.saldoAlocado) || 0), 0);
  return Math.round((somaMetas + somaCofres) * 100) / 100;
}
function calcularSaldoDisponivelGeral(mesAnoLimite) {
  recalcularLimitesCartoes();
  const mesAtual = hojeLocalISO().slice(0, 7);
  const mesLimite = mesAnoLimite || mesAtual;
  const isHistoricoPassado = Boolean(mesAnoLimite && mesAnoLimite < mesAtual);

  // Fonte única de verdade: exatamente o mesmo total consolidado exibido em "CONTAS BANCÁRIAS"
  // (saldoInicial + entradas efetivadas - saídas efetivadas de cada conta bancária, sem misturar faturas de cartão)
  const resumoBancos = calcularResumoSaldosContasBancarias(isHistoricoPassado ? mesLimite : null);
  const saldoTotal = resumoBancos.totalContasBancarias;

  // KPIs mensais calculados apenas sobre os lançamentos do mês selecionado
  // (excluindo transferências internas, pagamentos de fatura e movimentos de cofre; sem saldoInicial)
  let totalReceitas = 0, totalDespesas = 0;
  let receitasMes = 0, despesasMes = 0;

  (STATE.lancamentos || []).forEach(l => {
    if (!l || l.ehMovimentoCofre) return;
    if (l.ehReembolsavel && l.reembolsado) return;
    const ehPagFatura = ehLancamentoPagamentoFatura(l);
    const ehTransf = !ehPagFatura && isLancamentoTransferencia(l);
    if (ehPagFatura || ehTransf) return;

    const mesLanc = mesCompetenciaLancamento(l);
    const valor = Number(l.valor) || 0;
    if (!mesLanc || mesLanc <= mesLimite) {
      if (l.tipo === 'receita') totalReceitas += valor;
      else if (l.tipo === 'despesa') totalDespesas += valor;
    }
    if (mesLanc === mesLimite) {
      if (l.tipo === 'receita') receitasMes += valor;
      else if (l.tipo === 'despesa') despesasMes += valor;
    }
  });

  // Metas/Cofres já estão contidos no saldo das contas bancárias; apenas o Saldo Disponível desconta essas reservas
  const totalAlocado = calcularTotalGuardadoMetas();
  const saldoDisponivel = Math.round((saldoTotal - totalAlocado) * 100) / 100;

  return {
    totalReceitas: Math.round(totalReceitas * 100) / 100,
    totalDespesas: Math.round(totalDespesas * 100) / 100,
    receitasMes: Math.round(receitasMes * 100) / 100,
    despesasMes: Math.round(despesasMes * 100) / 100,
    saldosContas: resumoBancos.saldos,
    nomesContasBancarias: resumoBancos.nomesContas,
    totalContasBancarias: saldoTotal,
    saldoTotal,
    patrimonioTotal: saldoTotal,
    totalAlocado,
    saldoDisponivel
  };
}
function atualizarSaldos() {
  renderDashboard();
  if (document.getElementById('page-metas')?.classList.contains('active')) renderMetas();
  if (document.getElementById('page-lancamentos')?.classList.contains('active')) renderLancamentos();
}

/* ================= RASTREADOR DE GARANTIAS (WARRANTY TRACKER) ================= */
function toggleCamposGarantiaModal() {
  const chk = document.getElementById('lanc-garantia-chk');
  const wrap = document.getElementById('lanc-garantia-wrap');
  if (!chk || !wrap) return;
  wrap.style.display = chk.checked ? 'block' : 'none';
  if (chk.checked) {
    const inpFim = document.getElementById('lanc-garantia-fim');
    const inpMeses = document.getElementById('lanc-garantia-meses');
    if (inpFim && !inpFim.value) {
      if (inpMeses && !inpMeses.value) inpMeses.value = '12';
      calcularDataGarantiaPorMeses();
    }
  }
}
function calcularDataGarantiaPorMeses() {
  const inpMeses = document.getElementById('lanc-garantia-meses');
  const inpFim = document.getElementById('lanc-garantia-fim');
  const inpData = document.getElementById('lanc-data');
  if (!inpMeses || !inpFim) return;
  const meses = parseInt(inpMeses.value, 10);
  if (!meses || meses <= 0) return;
  const dataBase = (inpData && inpData.value) ? inpData.value : hojeLocalISO();
  inpFim.value = somarMeses(dataBase, meses);
}
function abrirModalGarantias() {
  renderGarantiasAtivas();
  abrirModal('modal-garantias');
}
function renderGarantiasAtivas() {
  const cont = document.getElementById('garantias-lista');
  const kpis = document.getElementById('garantias-resumo-kpis');
  if (!cont) return;
  const hojeMs = new Date(hojeLocalISO() + 'T00:00:00').getTime();
  const comGarantia = STATE.lancamentos
    .filter(l => !!l.garantiaFim)
    .map(l => {
      const fimMs = new Date(l.garantiaFim + 'T00:00:00').getTime();
      const diasRestantes = Math.round((fimMs - hojeMs) / 86400000);
      return { ...l, diasRestantes };
    })
    .sort((a, b) => a.diasRestantes - b.diasRestantes);

  const ativas = comGarantia.filter(g => g.diasRestantes >= 0);
  const expirando30 = ativas.filter(g => g.diasRestantes <= 30);
  const expiradas = comGarantia.filter(g => g.diasRestantes < 0);
  const valorProtegido = ativas.reduce((s, g) => s + (Number(g.valor) || 0), 0);

  if (kpis) {
    kpis.innerHTML = `
      <div class="metric m-ok"><div class="metric-label">Garantias Ativas</div><div class="metric-value mv-ok">${ativas.length}</div><div class="metric-sub">em vigor hoje</div></div>
      <div class="metric ${expirando30.length ? 'm-warn' : 'm-info'}"><div class="metric-label">Expiram em ≤ 30 dias</div><div class="metric-value" style="color:${expirando30.length ? 'var(--amber)' : 'var(--accent)'}">${expirando30.length}</div><div class="metric-sub">atenção prioritária</div></div>
      <div class="metric m-info"><div class="metric-label">Valor Protegido</div><div class="metric-value mv-info">${toBRL(valorProtegido)}</div><div class="metric-sub">em compras vigentes</div></div>
      <div class="metric"><div class="metric-label">Vencidas</div><div class="metric-value" style="color:var(--text3)">${expiradas.length}</div><div class="metric-sub">histórico total</div></div>`;
  }

  if (!comGarantia.length) {
    cont.innerHTML = `<div class="empty" style="padding:2rem 1rem">
      <i class="ti ti-shield-off"></i>
      <p>Nenhum lançamento com garantia cadastrada ainda.</p>
      <div class="help-text">Ao criar ou editar um lançamento, marque a opção <strong>"Possui Garantia?"</strong>.</div>
    </div>`;
    return;
  }

  cont.innerHTML = comGarantia.map(item => {
    const [ca, cm, cd] = (item.data || '').split('-');
    const dataCompraFmt = ca ? `${cd}/${cm}/${ca}` : '-';
    const [fa, fm, fd] = (item.garantiaFim || '').split('-');
    const dataFimFmt = fa ? `${fd}/${fm}/${fa}` : item.garantiaFim;

    let classeRow = 'w-ok';
    let badgeTempo = '';
    let iconeAlerta = '';

    if (item.diasRestantes < 0) {
      classeRow = 'w-expired';
      const diasPassados = Math.abs(item.diasRestantes);
      iconeAlerta = `<i class="ti ti-alert-octagon" style="color:var(--bad);font-size:18px" title="Garantia expirada"></i>`;
      badgeTempo = `<span class="badge badge-despesa">Expirada há ${diasPassados} dia(s)</span>`;
    } else if (item.diasRestantes <= 30) {
      classeRow = 'w-expiring';
      const corIcone = item.diasRestantes <= 7 ? 'var(--bad)' : 'var(--amber)';
      iconeAlerta = `<i class="ti ti-alert-triangle" style="color:${corIcone};font-size:19px" title="Expira nos próximos 30 dias!"></i>`;
      badgeTempo = `<span class="badge ${item.diasRestantes <= 7 ? 'badge-despesa' : 'badge-pendente'}">${item.diasRestantes === 0 ? 'Expira hoje!' : `Faltam ${item.diasRestantes} dia(s)`}</span>`;
    } else {
      const mesesRest = Math.floor(item.diasRestantes / 30);
      const diasRestMod = item.diasRestantes % 30;
      const textoRest = mesesRest > 0
        ? `${mesesRest} mês(es)${diasRestMod > 0 ? ` e ${diasRestMod}d` : ''} (${item.diasRestantes} dias)`
        : `${item.diasRestantes} dias restantes`;
      iconeAlerta = `<i class="ti ti-shield-check" style="color:var(--good);font-size:18px"></i>`;
      badgeTempo = `<span class="badge badge-pago">${textoRest}</span>`;
    }

    return `<div class="warranty-row ${classeRow}">
      <div style="display:flex;align-items:center;gap:10px;min-width:0">
        ${iconeAlerta}
        <div style="min-width:0">
          <div style="font-size:13.5px;font-weight:700;color:var(--text)">${escHtml(item.descricao || '-')}</div>
          <div class="help-text" style="margin:0">Compra: ${dataCompraFmt} · Término da garantia: <strong>${dataFimFmt}</strong> · ${toBRL(item.valor)}</div>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
        ${badgeTempo}
        <button class="icon-btn" onclick="fecharModal('modal-garantias'); abrirModalLancamento('${item.id}')" title="Editar lançamento"><i class="ti ti-pencil"></i></button>
      </div>
    </div>`;
  }).join('');
}

/* ================= MODO VIAGEM (TRAVEL MODE) ================= */
function slugViagemHashtag(nome) {
  const limpo = removerAcentos(String(nome || '').trim().toLowerCase())
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return 'viagem_' + (limpo || 'ativa');
}
function atualizarUIModoViagem() {
  const mv = (STATE.config && STATE.config.modoViagem) ? STATE.config.modoViagem : { ativo: false, nome: '', hashtag: '' };
  const banner = document.getElementById('travel-banner');
  const bannerTxt = document.getElementById('travel-banner-text');
  const bannerTag = document.getElementById('travel-banner-hashtag');
  if (banner) banner.classList.toggle('show', !!mv.ativo);
  if (bannerTxt && mv.ativo) bannerTxt.textContent = `✈️ Modo Viagem Ativo: ${mv.nome}`;
  if (bannerTag && mv.ativo) bannerTag.textContent = `#${mv.hashtag}`;

  const chkCfg = document.getElementById('cfg-modo-viagem-toggle');
  const lblCfg = document.getElementById('cfg-modo-viagem-label');
  if (chkCfg) chkCfg.checked = !!mv.ativo;
  if (lblCfg) lblCfg.textContent = mv.ativo ? `Ativo (${mv.nome} · #${mv.hashtag})` : 'Desativado';
}
async function alternarModoViagem() {
  if (!STATE.config) STATE.config = {};
  if (!STATE.config.modoViagem) STATE.config.modoViagem = { ativo: false, nome: '', hashtag: '' };
  if (STATE.config.modoViagem.ativo) {
    await encerrarModoViagem();
    return;
  }
  const nome = await pedirValor('Qual o destino ou nome da viagem? (Ex: Paris)', '', true);
  if (nome === null || !String(nome).trim()) {
    atualizarUIModoViagem();
    return;
  }
  const nomeLimpo = String(nome).trim();
  const hashtag = slugViagemHashtag(nomeLimpo);
  STATE.config.modoViagem = { ativo: true, nome: nomeLimpo, hashtag };
  await salvarDados();
  atualizarUIModoViagem();
  renderPaginaAtiva();
  toast(`✈️ Modo Viagem Ativo: ${nomeLimpo} (#${hashtag})`, 'ok');
}
async function encerrarModoViagem() {
  if (!STATE.config) STATE.config = {};
  const nomeAntigo = (STATE.config.modoViagem && STATE.config.modoViagem.nome) || '';
  STATE.config.modoViagem = { ativo: false, nome: '', hashtag: '' };
  await salvarDados();
  atualizarUIModoViagem();
  renderPaginaAtiva();
  toast(nomeAntigo ? `Viagem "${nomeAntigo}" encerrada. Modo normal restaurado.` : 'Modo Viagem encerrado.', 'ok');
}

/* ================= METAS & COFRES (UNIFICADOS E GAMIFICADOS) ================= */
function renderMetas() {
  migrarCofresParaMetas();
  const lista = STATE.metas || [];
  const { saldoTotal, totalAlocado, saldoDisponivel } = calcularSaldoDisponivelGeral();
  const totalObjetivos = lista.reduce((s, m) => s + (Number(m.valorAlvo) || 0), 0);

  const kpisEl = document.getElementById('metas-kpis');
  if (kpisEl) {
    kpisEl.innerHTML = `
      <div class="metric m-info">
        <div class="metric-top"><div class="metric-label">Saldo Disponível</div><div class="metric-icon mi-info"><i class="ti ti-wallet"></i></div></div>
        <div class="metric-value ${saldoDisponivel>=0?'mv-ok':'mv-bad'}">${toBRL(saldoDisponivel)}</div>
        <div class="metric-sub">livre para transferir</div>
      </div>
      <div class="metric m-ok">
        <div class="metric-top"><div class="metric-label">Retido em Metas &amp; Cofres</div><div class="metric-icon mi-ok"><i class="ti ti-shield-lock"></i></div></div>
        <div class="metric-value mv-ok">${toBRL(totalAlocado)}</div>
        <div class="metric-sub">${lista.length} cofre(s) ativo(s)</div>
      </div>
      <div class="metric m-info">
        <div class="metric-top"><div class="metric-label">Patrimônio Total</div><div class="metric-icon mi-info"><i class="ti ti-pig-money"></i></div></div>
        <div class="metric-value ${saldoTotal>=0?'mv-info':'mv-bad'}">${toBRL(saldoTotal)}</div>
        <div class="metric-sub">disponível + metas</div>
      </div>
      <div class="metric m-warn">
        <div class="metric-top"><div class="metric-label">Soma das Metas</div><div class="metric-icon mi-warn"><i class="ti ti-target-arrow"></i></div></div>
        <div class="metric-value mv-info">${toBRL(totalObjetivos)}</div>
        <div class="metric-sub">${totalObjetivos > 0 ? Math.min(100, (totalAlocado / totalObjetivos) * 100).toFixed(0) + '% alcançado no geral' : 'sem meta global'}</div>
      </div>`;
  }

  document.getElementById('metas-empty').style.display = lista.length ? 'none' : 'block';
  const marcosRef = [
    { pct: 25, icone: 'ti-flag-3' },
    { pct: 50, icone: 'ti-Flame' },
    { pct: 75, icone: 'ti-medal' },
    { pct: 100, icone: 'ti-trophy' }
  ];
  document.getElementById('metas-lista').innerHTML = lista.map(m => {
    const valorRetido = Number(m.valorAtual) || 0;
    const valorAlvo = Number(m.valorAlvo) || 0;
    const pct = valorAlvo > 0 ? Math.min(100, (valorRetido / valorAlvo) * 100) : 0;
    const faltante = Math.max(0, valorAlvo - valorRetido);
    const prazoTxt = m.prazo ? (() => { const [a,mm,d] = m.prazo.split('-'); return `Prazo: ${d}/${mm}/${a}`; })() : '';
    const marcosHTML = marcosRef.map(mc => {
      const atingido = pct >= mc.pct;
      const posLeft = mc.pct === 100 ? 'calc(100% - 11px)' : `${mc.pct}%`;
      const iconeClasse = mc.pct === 50 ? 'ti-flame' : mc.icone;
      return `<div class="meta-marco${atingido ? ' marco-atingido' : ''}" style="left:${posLeft}" title="Marco de ${mc.pct}% (${toBRL(valorAlvo * (mc.pct / 100))})">
        <div class="meta-marco-dot"><i class="ti ${iconeClasse}"></i></div>
        <div class="meta-marco-label">${mc.pct}%</div>
      </div>`;
    }).join('');
    return `
    <div class="card meta-vault-card">
      <div class="meta-vault-header">
        <div class="meta-vault-identity">
          <div class="meta-vault-emblem${pct >= 100 ? ' concluida' : ''}" title="Cofre de Retenção Ativo">
            <i class="ti ${pct >= 100 ? 'ti-trophy' : 'ti-shield-lock'}"></i>
          </div>
          <div>
            <div class="card-title" style="font-size:14px;color:var(--text);display:flex;align-items:center;gap:8px;text-transform:none;letter-spacing:-.01em">
              <span>${escHtml(m.nome)}</span>
              <span class="badge ${pct >= 100 ? 'badge-pago' : 'badge-cat'}">${pct.toFixed(0)}% concluído</span>
            </div>
            <div class="help-text" style="margin:2px 0 0">Objetivo: <strong>${toBRL(valorAlvo)}</strong> ${prazoTxt ? '· ' + prazoTxt : ''}</div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <button class="btn btn-primary btn-sm" onclick="adicionarFundoMeta('${m.id}')" title="Transferir do Saldo Disponível para este cofre"><i class="ti ti-arrow-up-circle"></i> Guardar</button>
          <button class="btn btn-sm" onclick="resgatarFundoMeta('${m.id}')" title="Devolver ao Saldo Disponível" ${valorRetido <= 0 ? 'disabled' : ''}><i class="ti ti-arrow-down-circle"></i> Resgatar</button>
          <button class="icon-btn" onclick="editarMeta('${m.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
          <button class="icon-btn danger" onclick="removerMeta('${m.id}')" title="Remover"><i class="ti ti-trash"></i></button>
        </div>
      </div>
      <div class="meta-vault-valor-wrap">
        <div class="meta-vault-valor-row">
          <div class="meta-vault-valor-atual" title="Valor atual guardado neste cofre">
            <i class="ti ti-lock"></i>
            <span>${toBRL(valorRetido)}</span>
            <span style="font-size:12px;font-weight:500;color:var(--text3)">de ${toBRL(valorAlvo)}</span>
          </div>
          ${faltante > 0
            ? `<span class="help-text" style="margin:0">Faltam <strong>${toBRL(faltante)}</strong> para atingir a meta</span>`
            : `<span class="badge badge-pago"><i class="ti ti-circle-check" style="margin-right:3px"></i> Meta concluída!</span>`}
        </div>
        <div>
          <span class="badge-seguranca"><i class="ti ti-shield-check"></i> ${toBRL(valorRetido)} protegidos do saldo diário</span>
        </div>
      </div>
      <div class="meta-trilha-wrap">
        <div class="meta-trilha-bar">
          <div class="meta-trilha-fill" data-target-width="${pct}%" style="width:0%;background:${pct>=100?'var(--good)':'linear-gradient(90deg, var(--accent), var(--good))'}"></div>
        </div>
        <div class="meta-marcos">${marcosHTML}</div>
      </div>
    </div>`;
  }).join('');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      document.querySelectorAll('#metas-lista .meta-trilha-fill').forEach(el => {
        el.style.width = el.getAttribute('data-target-width') || '0%';
      });
    });
  });
}
async function salvarMeta() {
  const id = document.getElementById('meta-id').value;
  const nome = document.getElementById('meta-nome').value.trim();
  const valorAlvo = moedaToNumber(document.getElementById('meta-valor-alvo').value);
  const prazo = document.getElementById('meta-prazo').value || undefined;
  if (!nome || !valorAlvo) { toast('Preencha nome e valor alvo.', 'err'); return; }
  if (id) {
    const meta = STATE.metas.find(m => m.id === id);
    if (meta) Object.assign(meta, { nome, valorAlvo, prazo });
  } else {
    STATE.metas.push({ id: uid(), nome, valorAlvo, valorAtual: 0, prazo });
  }
  cancelarEdicaoMeta();
  await salvarDados();
  renderMetas();
  atualizarSaldos();
  toast(id ? 'Meta / Cofre atualizado.' : 'Meta / Cofre criado.', 'ok');
}
function editarMeta(id) {
  const m = STATE.metas.find(x => x.id === id);
  if (!m) return;
  document.getElementById('meta-id').value = m.id;
  document.getElementById('meta-nome').value = m.nome;
  document.getElementById('meta-valor-alvo').value = toBRL(m.valorAlvo).replace('R$','R$ ');
  document.getElementById('meta-prazo').value = m.prazo || '';
  document.getElementById('meta-form-title').textContent = 'Editando: ' + m.nome;
  document.getElementById('meta-submit-btn').innerHTML = '<i class="ti ti-device-floppy"></i> Salvar alterações';
  document.getElementById('meta-cancelar-btn').style.display = '';
  focarCampoCriacao('meta-nome');
}
function cancelarEdicaoMeta() {
  document.getElementById('meta-id').value = '';
  document.getElementById('meta-nome').value = '';
  document.getElementById('meta-valor-alvo').value = '';
  document.getElementById('meta-prazo').value = '';
  document.getElementById('meta-form-title').textContent = 'Nova Meta / Cofre';
  document.getElementById('meta-submit-btn').innerHTML = '<i class="ti ti-plus"></i> Criar Meta / Cofre';
  document.getElementById('meta-cancelar-btn').style.display = 'none';
}
function removerMeta(id) {
  const m = STATE.metas.find(x => x.id === id);
  const msg = m && (Number(m.valorAtual) || 0) > 0
    ? `Remover o cofre "${m.nome}"? Os ${toBRL(m.valorAtual)} guardados nele voltarão automaticamente para o seu Saldo Disponível.`
    : 'Remover esta meta/cofre?';
  abrirConfirmacao(msg, async () => {
    STATE.metas = STATE.metas.filter(m => m.id !== id);
    await salvarDados();
    renderMetas();
    atualizarSaldos();
    toast('Meta / Cofre removido.', 'ok');
  }, 'Remover Meta / Cofre');
}
function registrarLancamentoHistoricoCofre(meta, valor, direcao) {
  const contaPadrao = (STATE.contas.find(c => c.tipo !== 'cartao') || STATE.contas[0] || { nome: 'Carteira' }).nome;
  const grupoId = uid();
  const ehGuardar = direcao === 'guardar';
  STATE.lancamentos.push({
    id: uid(),
    tipo: ehGuardar ? 'despesa' : 'receita',
    data: hojeLocalISO(),
    descricao: ehGuardar ? `Saída para Cofre: ${meta.nome}` : `Resgate do Cofre: ${meta.nome}`,
    categoria: 'Transferência',
    conta: contaPadrao,
    valor,
    origem: 'cofre',
    sincronizado: false,
    pago: true,
    ehTransferencia: true,
    ehMovimentoCofre: true,
    metaId: meta.id,
    transferenciaGrupo: grupoId,
    transferenciaContraparte: `Cofre: ${meta.nome}`
  });
}
async function adicionarFundoMeta(id) {
  const m = STATE.metas.find(x => x.id === id);
  if (!m) return;
  const { saldoDisponivel } = calcularSaldoDisponivelGeral();
  if (saldoDisponivel <= 0) {
    toast(`Saldo Disponível insuficiente (${toBRL(saldoDisponivel)}) para guardar neste cofre.`, 'err');
    return;
  }
  const resposta = await pedirValor(`Quanto deseja transferir do seu Saldo Disponível para este cofre? (Disponível: ${toBRL(saldoDisponivel)})`);
  if (resposta === null) return;
  const valor = moedaToNumber(resposta);
  if (!valor || valor <= 0) { toast('Informe um valor válido maior que zero.', 'err'); return; }
  if (valor > saldoDisponivel + 0.009) {
    toast(`Saldo Disponível insuficiente (${toBRL(saldoDisponivel)}) para transferir ${toBRL(valor)}.`, 'err');
    return;
  }
  const valorAntes = Number(m.valorAtual) || 0;
  const valorAlvo = Number(m.valorAlvo) || 0;
  m.valorAtual = Math.max(0, Math.round((valorAntes + valor) * 100) / 100);
  const atingiuObjetivo100 = valorAlvo > 0 && valorAntes < valorAlvo - 0.009 && m.valorAtual >= valorAlvo - 0.009;
  registrarLancamentoHistoricoCofre(m, valor, 'guardar');
  await salvarDados();
  renderMetas();
  atualizarSaldos();
  sincronizarEmSegundoPlano();
  if (atingiuObjetivo100) {
    dispararConfettis();
    toastObjetivoAtingido(m.nome);
  } else {
    toast(`${toBRL(valor)} guardado no cofre "${m.nome}"!`, 'ok');
  }
}
async function resgatarFundoMeta(id) {
  const m = STATE.metas.find(x => x.id === id);
  if (!m) return;
  const guardado = Number(m.valorAtual) || 0;
  if (guardado <= 0) { toast('Este cofre não possui saldo guardado para resgatar.', 'err'); return; }
  const resposta = await pedirValor(`Quanto deseja devolver ao seu Saldo Disponível? (Guardado: ${toBRL(guardado)})`, toBRL(guardado).replace('R$', 'R$ '));
  if (resposta === null) return;
  const valor = moedaToNumber(resposta);
  if (!valor || valor <= 0) { toast('Informe um valor válido maior que zero.', 'err'); return; }
  if (valor > guardado + 0.009) {
    toast(`Saldo insuficiente no cofre (${toBRL(guardado)}) para resgatar ${toBRL(valor)}.`, 'err');
    return;
  }
  m.valorAtual = Math.max(0, Math.round((guardado - valor) * 100) / 100);
  registrarLancamentoHistoricoCofre(m, valor, 'resgatar');
  await salvarDados();
  renderMetas();
  atualizarSaldos();
  sincronizarEmSegundoPlano();
  toast(`${toBRL(valor)} devolvido ao Saldo Disponível!`, 'ok');
}

/* ================= DÍVIDAS & TERCEIROS ================= */
function renderDividas() {
  const lista = [...STATE.dividas].sort((a,b) => (a.quitada === b.quitada ? 0 : a.quitada ? 1 : -1) || (b.data||'').localeCompare(a.data||''));
  const pendentes = lista.filter(d => !d.quitada);
  const totalReceber = pendentes.filter(d => d.direcao === 'receber').reduce((s,d) => s+d.valor, 0);
  const totalPagar = pendentes.filter(d => d.direcao === 'pagar').reduce((s,d) => s+d.valor, 0);
  document.getElementById('divida-kpis').innerHTML = `
    <div class="metric"><div class="metric-label">A receber de terceiros</div><div class="metric-value mv-ok">${toBRL(totalReceber)}</div><div class="metric-sub">${pendentes.filter(d=>d.direcao==='receber').length} pendência(s)</div></div>
    <div class="metric"><div class="metric-label">A pagar a terceiros</div><div class="metric-value mv-bad">${toBRL(totalPagar)}</div><div class="metric-sub">${pendentes.filter(d=>d.direcao==='pagar').length} pendência(s)</div></div>
    <div class="metric"><div class="metric-label">Saldo líquido com terceiros</div><div class="metric-value ${(totalReceber-totalPagar)>=0?'mv-ok':'mv-bad'}">${toBRL(totalReceber-totalPagar)}</div><div class="metric-sub">a receber − a pagar</div></div>
    <div class="metric"><div class="metric-label">Total registrado</div><div class="metric-value mv-info">${lista.length}</div><div class="metric-sub">${lista.length - pendentes.length} já quitada(s)</div></div>`;

  document.getElementById('divida-empty').style.display = lista.length ? 'none' : 'block';
  document.getElementById('divida-tbody').innerHTML = lista.map(d => {
    const [a,m,dd] = (d.data||'').split('-');
    const dataFmt = a ? `${dd}/${m}/${a}` : '-';
    return `<tr>
      <td>${escHtml(d.pessoa)}</td>
      <td>${escHtml(d.descricao || '-')}</td>
      <td>${dataFmt}</td>
      <td><span class="badge badge-cat">${d.direcao === 'receber' ? 'Ela me deve' : 'Eu devo a ela'}</span></td>
      <td><span class="badge ${d.quitada?'badge-pago':'badge-pendente'} badge-click" onclick="toggleQuitarDivida('${d.id}')" title="Clique pra alternar">${d.quitada ? 'Quitada' : 'Pendente'}</span></td>
      <td style="text-align:right"><span class="badge ${d.direcao==='receber'?'badge-receita':'badge-despesa'}">${toBRL(d.valor)}</span></td>
      <td style="text-align:right;white-space:nowrap">
        <button class="icon-btn" onclick="editarDivida('${d.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
        <button class="icon-btn danger" onclick="removerDivida('${d.id}')" title="Remover"><i class="ti ti-trash"></i></button>
      </td>
    </tr>`;
  }).join('');
}
async function salvarDivida() {
  const id = document.getElementById('divida-id').value;
  const pessoa = document.getElementById('divida-pessoa').value.trim();
  const direcao = document.getElementById('divida-direcao').value;
  const valor = moedaToNumber(document.getElementById('divida-valor').value);
  const descricao = document.getElementById('divida-descricao').value.trim();
  const data = document.getElementById('divida-data').value || hojeLocalISO();
  if (!pessoa || !valor) { toast('Preencha ao menos a pessoa e o valor.', 'err'); return; }

  if (id) {
    const d = STATE.dividas.find(x => x.id === id);
    if (d) Object.assign(d, { pessoa, direcao, valor, descricao, data });
  } else {
    STATE.dividas.push({ id: uid(), pessoa, direcao, valor, descricao, data, quitada: false });
  }
  cancelarEdicaoDivida();
  await salvarDados();
  renderDividas();
  toast(id ? 'Dívida atualizada.' : 'Dívida registrada.', 'ok');
}
function editarDivida(id) {
  const d = STATE.dividas.find(x => x.id === id);
  if (!d) return;
  document.getElementById('divida-id').value = d.id;
  document.getElementById('divida-pessoa').value = d.pessoa;
  document.getElementById('divida-direcao').value = d.direcao;
  document.getElementById('divida-valor').value = toBRL(d.valor).replace('R$','R$ ');
  document.getElementById('divida-descricao').value = d.descricao || '';
  document.getElementById('divida-data').value = d.data;
  document.getElementById('divida-form-title').textContent = 'Editando: ' + d.pessoa;
  document.getElementById('divida-submit-btn').innerHTML = '<i class="ti ti-device-floppy"></i> Salvar alterações';
  document.getElementById('divida-cancelar-btn').style.display = '';
}
function cancelarEdicaoDivida() {
  document.getElementById('divida-id').value = '';
  document.getElementById('divida-pessoa').value = '';
  document.getElementById('divida-direcao').value = 'receber';
  document.getElementById('divida-valor').value = '';
  document.getElementById('divida-descricao').value = '';
  document.getElementById('divida-data').value = hojeLocalISO();
  document.getElementById('divida-form-title').textContent = 'Nova dívida';
  document.getElementById('divida-submit-btn').innerHTML = '<i class="ti ti-plus"></i> Adicionar';
  document.getElementById('divida-cancelar-btn').style.display = 'none';
}
async function toggleQuitarDivida(id) {
  const d = STATE.dividas.find(x => x.id === id);
  if (!d) return;
  d.quitada = !d.quitada;
  await salvarDados();
  renderDividas();
}
function removerDivida(id) {
  abrirConfirmacao('Remover esta dívida?', async () => {
    STATE.dividas = STATE.dividas.filter(x => x.id !== id);
    await salvarDados();
    renderDividas();
    toast('Dívida removida.', 'ok');
  }, 'Remover dívida');
}

/* ================= RELATÓRIOS / ANÁLISES ================= */
function renderRelatorios() {
  const numMeses = parseInt(document.getElementById('rel-periodo').value, 10) || 6;
  const selHash = document.getElementById('rel-hashtag');
  if (selHash) {
    const hashAtual = selHash.value;
    const tagsDisp = todasAsTags();
    selHash.innerHTML = '<option value="">Todas as #Hashtags</option>' + tagsDisp.map(t => `<option value="${t}">#${t}</option>`).join('');
    selHash.value = [...selHash.options].some(o => o.value === hashAtual) ? hashAtual : '';
  }
  const hashtagFiltro = selHash ? selHash.value : '';
  const hoje = new Date();
  const inicioJanela = new Date(hoje.getFullYear(), hoje.getMonth() - (numMeses - 1), 1).toISOString().slice(0,7);
  const mesAtualRel = hojeLocalISO().slice(0, 7);
  const doPeriodo = STATE.lancamentos.filter(l =>
    estaPago(l) &&
    mesCompetenciaLancamento(l) >= inicioJanela &&
    mesCompetenciaLancamento(l) <= mesAtualRel &&
    (!hashtagFiltro || lancamentoTemHashtag(l, hashtagFiltro))
  );

  const receitas = doPeriodo.filter(l => l.tipo==='receita' && !isLancamentoTransferencia(l)).reduce((s,l)=>s+l.valor,0);
  const despesas = doPeriodo.filter(l => l.tipo==='despesa' && !isLancamentoTransferencia(l)).reduce((s,l)=>s+l.valor,0);
  const subPeriodo = `últimos ${numMeses} meses${hashtagFiltro ? ' · #' + hashtagFiltro : ''}`;
  document.getElementById('rel-kpis').innerHTML = `
    <div class="metric"><div class="metric-label">Receitas no período</div><div class="metric-value mv-ok">${toBRL(receitas)}</div><div class="metric-sub">${subPeriodo}</div></div>
    <div class="metric"><div class="metric-label">Despesas no período</div><div class="metric-value mv-bad">${toBRL(despesas)}</div><div class="metric-sub">${subPeriodo}</div></div>
    <div class="metric"><div class="metric-label">Resultado</div><div class="metric-value ${(receitas-despesas)>=0?'mv-ok':'mv-bad'}">${toBRL(receitas-despesas)}</div><div class="metric-sub">receitas − despesas</div></div>
    <div class="metric"><div class="metric-label">Média mensal de gastos</div><div class="metric-value mv-info">${toBRL(despesas/numMeses)}</div><div class="metric-sub">por mês, no período</div></div>`;

  const nomesMesAbrev = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };

  const { macrosOrdenadas: todasPorCategoria, subMap: subMapPeriodo } = gastosPorMacroESubcategoria(doPeriodo);
  const porCategoria = todasPorCategoria.slice(0, 8);
  const pontos = patrimonioAcumulado(numMeses, hashtagFiltro);
  const mesesPoup = ultimosMeses(numMeses);
  const recDespMesFiltrado = (mesKey) => {
    if (!hashtagFiltro) return receitasDespesasDoMes(mesKey);
    let rec = 0, desp = 0;
    STATE.lancamentos.forEach(l => {
      if (isLancamentoTransferencia(l) || !lancamentoTemHashtag(l, hashtagFiltro)) return;
      if (mesCompetenciaLancamento(l) !== mesKey) return;
      if (l.tipo === 'receita') rec += l.valor; else desp += l.valor;
    });
    return { receitas: rec, despesas: desp };
  };
  const taxasPoup = mesesPoup.map(m => {
    const rd = recDespMesFiltrado(m);
    return { mes: m, taxa: rd.receitas > 0 ? ((rd.receitas - rd.despesas) / rd.receitas) * 100 : null };
  });

  if (typeof Chart !== 'undefined') {
    destruirChart('relCategorias');
    const ctxCat = document.getElementById('rel-categorias-chart').getContext('2d');
    const paleta = [cssVar('--accent'), cssVar('--bad'), cssVar('--amber'), cssVar('--good'), '#8B5CF6', '#EC4899', '#06B6D4', '#64748B'];
    const paletaGradientes = paleta.map(cor => criarGradienteLinearChart(ctxCat, cor, 0.96, 0.55, 220));
    CHARTS.relCategorias = new Chart(ctxCat, {
      type: 'doughnut',
      data: {
        labels: porCategoria.length ? porCategoria.map(c => c[0]) : ['Sem despesas'],
        datasets: [{
          data: porCategoria.length ? porCategoria.map(c => c[1]) : [1],
          backgroundColor: porCategoria.length ? paletaGradientes : [cssVar('--border2')],
          hoverBackgroundColor: porCategoria.length ? paleta : [cssVar('--border2')],
          borderColor: cssVar('--surface'),
          borderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '65%',
        onHover: (event, elements) => {
          const alvo = event && event.native && event.native.target;
          if (alvo) alvo.style.cursor = (porCategoria.length && elements && elements.length) ? 'pointer' : 'default';
        },
        onClick: (event, elements) => {
          if (!porCategoria.length || !elements || !elements.length) return;
          const idx = elements[0].index;
          const catClicada = porCategoria[idx] && porCategoria[idx][0];
          if (!catClicada) return;
          navegarParaLancamentos({ mes: '', tipo: 'despesa', categoria: catClicada, tag: hashtagFiltro || '' });
        },
        plugins: {
          legend: { position: 'right', labels: { color: cssVar('--text2'), padding: 14, font: { size: 12 } } },
          tooltip: obterTooltipPremiumChart({
            label: (ctx) => porCategoria.length ? ` ${ctx.label} (Total Macro): ${toBRL(ctx.parsed)}` : ' Sem despesas no período',
            afterBody: (items) => {
              if (!porCategoria.length || !items.length) return [];
              const macroNome = items[0].label;
              const subs = subMapPeriodo[macroNome] ? Object.entries(subMapPeriodo[macroNome]).sort((a, b) => b[1] - a[1]) : [];
              if (!subs.length) return [];
              return ['', 'Discriminação por Subcategoria:', ...subs.map(([sNome, sVal]) => `  ↳ ${sNome}: ${toBRL(sVal)}`)];
            }
          })
        }
      }
    });

    destruirChart('relPatrimonio');
    const ctxPat = document.getElementById('rel-patrimonio-chart').getContext('2d');
    const gradPatrimonio = criarGradienteLinearChart(ctxPat, cssVar('--accent'), 0.42, 0.02, 220);
    CHARTS.relPatrimonio = new Chart(ctxPat, {
      type: 'line',
      data: {
        labels: pontos.map(p => { const [ano, mes] = p.mes.split('-'); return `${nomesMesAbrev[mes]}/${ano.slice(2)}`; }),
        datasets: [{
          label: 'Saldo acumulado',
          data: pontos.map(p => p.saldo),
          borderColor: cssVar('--accent'),
          backgroundColor: gradPatrimonio,
          fill: true,
          tension: 0.35,
          pointRadius: 4,
          pointHoverRadius: 6,
          pointBackgroundColor: cssVar('--accent')
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onHover: (event, elements) => {
          const alvo = event && event.native && event.native.target;
          if (alvo) alvo.style.cursor = (elements && elements.length) ? 'pointer' : 'default';
        },
        onClick: (event, elements) => {
          if (!elements || !elements.length) return;
          const idx = elements[0].index;
          const ponto = pontos[idx];
          if (!ponto || !ponto.mes) return;
          navegarParaLancamentos({ mes: ponto.mes, tipo: 'todos', tag: hashtagFiltro || '', modoFiltroMes: 'fatura' });
        },
        plugins: {
          legend: { display: false },
          tooltip: obterTooltipPremiumChart({ label: (ctx) => ` Saldo: ${toBRL(ctx.parsed.y)}` })
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: cssVar('--text3') } },
          y: { grid: { color: cssVar('--border') }, ticks: { color: cssVar('--text3'), callback: (v) => toBRL(v) } }
        }
      }
    });

    destruirChart('relPoupanca');
    const ctxPoup = document.getElementById('rel-poupanca-chart').getContext('2d');
    const coresPoupBase = taxasPoup.map(p => p.taxa === null ? cssVar('--border2') : p.taxa >= 20 ? cssVar('--good') : p.taxa >= 0 ? cssVar('--accent') : cssVar('--bad'));
    const gradPoupanca = taxasPoup.map((p, idx) => p.taxa === null ? cssVar('--border2') : criarGradienteLinearChart(ctxPoup, coresPoupBase[idx], 0.95, 0.28, 220));
    CHARTS.relPoupanca = new Chart(ctxPoup, {
      type: 'bar',
      data: {
        labels: taxasPoup.map(p => { const [ano, mes] = p.mes.split('-'); return `${nomesMesAbrev[mes]}/${ano.slice(2)}`; }),
        datasets: [{
          label: 'Taxa de poupança (%)',
          data: taxasPoup.map(p => p.taxa !== null ? Number(p.taxa.toFixed(1)) : 0),
          backgroundColor: gradPoupanca,
          hoverBackgroundColor: coresPoupBase,
          borderRadius: 6,
          maxBarThickness: 36
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        onHover: (event, elements) => {
          const alvo = event && event.native && event.native.target;
          if (alvo) alvo.style.cursor = (elements && elements.length) ? 'pointer' : 'default';
        },
        onClick: (event, elements) => {
          if (!elements || !elements.length) return;
          const idx = elements[0].index;
          const itemMes = taxasPoup[idx];
          if (!itemMes || !itemMes.mes) return;
          navegarParaLancamentos({ mes: itemMes.mes, tipo: 'todos', tag: hashtagFiltro || '', modoFiltroMes: 'fatura' });
        },
        plugins: {
          legend: { display: false },
          tooltip: obterTooltipPremiumChart({ label: (ctx) => ` Poupança: ${fmtPct(ctx.parsed.y)}` })
        },
        scales: {
          x: { grid: { display: false }, ticks: { color: cssVar('--text3') } },
          y: { grid: { color: cssVar('--border') }, ticks: { color: cssVar('--text3'), callback: (v) => v + '%' } }
        }
      }
    });
  }
  const somaPoup = mesesPoup.reduce((acc, m) => { const r = recDespMesFiltrado(m); acc.rec += r.receitas; acc.desp += r.despesas; return acc; }, { rec: 0, desp: 0 });
  document.getElementById('rel-poupanca-media').textContent = somaPoup.rec > 0
    ? 'média do período: ' + fmtPct(((somaPoup.rec - somaPoup.desp) / somaPoup.rec) * 100)
    : 'sem receitas no período';

  const mesAtual = hojeLocalISO().slice(0,7);
  const [anoAtualNum, mesAtualNum] = mesAtual.split('-').map(Number);
  const dtMesAnterior = new Date(anoAtualNum, mesAtualNum - 2, 1);
  const mesAnteriorExato = dtMesAnterior.getFullYear() + '-' + String(dtMesAnterior.getMonth() + 1).padStart(2, '0');

  const gastosMesAtual = {};
  const gastosMesAnterior = {};
  const subGastosMesAtual = {};
  STATE.lancamentos.forEach(l => {
    if (l.tipo !== 'despesa' || isLancamentoTransferencia(l)) return;
    if (hashtagFiltro && !lancamentoTemHashtag(l, hashtagFiltro)) return;
    const m = mesCompetenciaLancamento(l);
    const { macro: cat, sub } = extrairMacroESubcategoria(l.categoria);
    if (m === mesAtual) {
      gastosMesAtual[cat] = (gastosMesAtual[cat] || 0) + l.valor;
      if (!subGastosMesAtual[cat]) subGastosMesAtual[cat] = {};
      subGastosMesAtual[cat][sub] = (subGastosMesAtual[cat][sub] || 0) + l.valor;
    } else if (m === mesAnteriorExato) {
      gastosMesAnterior[cat] = (gastosMesAnterior[cat] || 0) + l.valor;
    }
  });

  // Comparativo Inteligente (MoM - Month over Month) + Discriminação de Subcategorias abaixo do gráfico
  const momContainer = document.getElementById('rel-categorias-mom');
  if (momContainer) {
    const categoriasParaMoM = porCategoria.length
      ? porCategoria
      : Object.entries(gastosMesAtual).sort((a, b) => b[1] - a[1]);
    if (categoriasParaMoM.length) {
      momContainer.innerHTML = categoriasParaMoM.map(([catNome, totalPeriodo]) => {
        const atualVal = gastosMesAtual[catNome] || 0;
        const antVal = gastosMesAnterior[catNome] || 0;
        let badgeMoM = '';
        if (antVal > 0) {
          const diffPct = Math.round(((atualVal - antVal) / antVal) * 100);
          if (diffPct < 0) {
            badgeMoM = `<span class="mom-badge mom-good">▼ ${Math.abs(diffPct)}% vs mês passado</span>`;
          } else if (diffPct > 0) {
            badgeMoM = `<span class="mom-badge mom-bad">▲ ${diffPct}% vs mês passado</span>`;
          } else {
            badgeMoM = `<span class="mom-badge mom-neutral">= 0% vs mês passado</span>`;
          }
        } else if (atualVal > 0 && antVal === 0) {
          badgeMoM = `<span class="mom-badge mom-bad">▲ 100% vs mês passado</span>`;
        } else {
          badgeMoM = `<span class="mom-badge mom-neutral">— sem gastos no mês atual</span>`;
        }
        const subsEntries = subMapPeriodo[catNome]
          ? Object.entries(subMapPeriodo[catNome]).sort((a, b) => b[1] - a[1])
          : (subGastosMesAtual[catNome] ? Object.entries(subGastosMesAtual[catNome]).sort((a, b) => b[1] - a[1]) : []);
        const subBreakdownHTML = subsEntries.length
          ? `<div class="subcat-breakdown">${subsEntries.map(([sNome, sVal]) => {
              const pctSub = totalPeriodo > 0 ? Math.round((sVal / totalPeriodo) * 100) : 0;
              return `<div class="subcat-breakdown-row">
                <span><i class="ti ti-corner-down-right" style="opacity:.6"></i> ${escHtml(sNome)}</span>
                <span style="font-weight:600;color:var(--text)">${toBRL(sVal)} <span style="font-weight:400;color:var(--text3)">(${pctSub}%)</span></span>
              </div>`;
            }).join('')}</div>`
          : '';
        return `<div class="mom-item dash-clickable" data-drill-cat="${escHtml(catNome)}" data-drill-mes="${escHtml(mesAtual)}" data-drill-tag="${escHtml(hashtagFiltro || '')}" onclick="navegarParaLancamentos({ mes: this.dataset.drillMes, tipo: 'despesa', categoria: this.dataset.drillCat, tag: this.dataset.drillTag, modoFiltroMes: 'fatura' })" title="Ver despesas de ${escHtml(catNome)} no mês atual">
          <div class="mom-item-top">
            <span>${escHtml(catNome)}</span>
            <span>${toBRL(atualVal)} <span style="font-size:10.5px;font-weight:400;color:var(--text3)">(mês atual)</span></span>
          </div>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
            ${badgeMoM}
            <span style="font-size:11px;color:var(--text3)">Mês ant.: ${toBRL(antVal)} · Período: ${toBRL(totalPeriodo)}</span>
          </div>
          ${subBreakdownHTML}
        </div>`;
      }).join('');
    } else {
      momContainer.innerHTML = `<div class="help-text">Nenhuma despesa por categoria registrada no período para comparação MoM.</div>`;
    }
  }
  const comOrcamento = STATE.categorias.filter(c => c.tipo==='despesa' && c.orcamento);
  document.getElementById('rel-orcamento').innerHTML = comOrcamento.length ? comOrcamento.map(c => {
    const gasto = gastosMesAtual[c.nome] || 0;
    const pct = Math.min(100, (gasto / c.orcamento) * 100);
    const subsMes = subGastosMesAtual[c.nome] ? Object.entries(subGastosMesAtual[c.nome]).sort((a,b) => b[1]-a[1]) : [];
    const dicaSubs = subsMes.length ? `<div style="font-size:11px;color:var(--text3);margin-left:130px;margin-top:-4px;margin-bottom:8px">${subsMes.map(([sn, sv]) => `${escHtml(sn)}: ${toBRL(sv)}`).join(' · ')}</div>` : '';
    return `<div class="bar-row">
      <div class="bar-label" style="width:120px">${escHtml(c.nome)}</div>
      <div class="bar-pair">
        <div class="bar-track"><div class="bar-fill" style="width:${pct}%;background:${pct>=100?'var(--bad)':pct>=80?'var(--amber)':'var(--good)'}">${toBRL(gasto)} / ${toBRL(c.orcamento)}</div></div>
      </div>
    </div>${dicaSubs}`;
  }).join('') : `<p class="help-text">Nenhuma categoria com orçamento definido ainda — configure em Categorias &amp; Contas.</p>`;

  const ranking = [...doPeriodo].filter(l => l.tipo==='despesa' && !isLancamentoTransferencia(l)).sort((a,b) => b.valor - a.valor).slice(0, 10);
  document.getElementById('rel-ranking').innerHTML = ranking.length ? ranking.map(l => {
    const [a,m,d] = (l.data||'').split('-');
    return `<tr class="dash-clickable" onclick="abrirModalLancamento('${l.id}')" title="Abrir lançamento"><td>${d}/${m}/${a}</td><td>${formatarDescricaoComHashtags(l.descricao)}${badgesTagsHTML(l)}</td><td><span class="badge badge-cat">${escHtml(formatarCategoriaExibicao(l.categoria))}</span></td><td style="text-align:right">${toBRL(l.valor)}</td></tr>`;
  }).join('') : `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:1.5rem 0">Sem despesas no período.</td></tr>`;

  renderGraficoMaquinaTempo();
}

/* ================= PRIVACIDADE: OCULTAR VALORES ================= */
const PRIV_CHAVE = 'cofin-privacidade';
// Qualquer coisa escrita como dinheiro ("R$ 1.234,56", "-R$ 50,00") é envolvida num <span class="vs"> e borrada pelo CSS.
// Funciona em qualquer tela (inclusive as que forem criadas no futuro) porque olha o TEXTO, não a tela onde ele está.
const RE_VALOR_FONTE = '-?R\\$[\\s\\u00A0]*-?\\d[\\d.]*(?:,\\d+)?';
const SELETOR_NAO_BLINDAR = '.vs, script, style, textarea, input, option, select, [data-sem-privacidade]';
function textoTemValor(t) { return new RegExp(RE_VALOR_FONTE).test(t); }
function envolverValoresNoTexto(no) {
  const pai = no.parentElement;
  if (!pai || pai.closest(SELETOR_NAO_BLINDAR)) return;
  const texto = no.nodeValue;
  const re = new RegExp(RE_VALOR_FONTE, 'g');
  const frag = document.createDocumentFragment();
  let ultimo = 0, m, achou = false;
  while ((m = re.exec(texto)) !== null) {
    achou = true;
    if (m.index > ultimo) frag.appendChild(document.createTextNode(texto.slice(ultimo, m.index)));
    const sp = document.createElement('span');
    sp.className = 'vs';
    sp.textContent = m[0];
    frag.appendChild(sp);
    ultimo = m.index + m[0].length;
  }
  if (!achou) return;
  if (ultimo < texto.length) frag.appendChild(document.createTextNode(texto.slice(ultimo)));
  no.parentNode.replaceChild(frag, no);
}
function blindarValores(raiz) {
  if (!raiz) return;
  if (raiz.nodeType === 3) { envolverValoresNoTexto(raiz); return; }
  if (raiz.nodeType !== 1) return;
  const alvos = [];
  const walker = document.createTreeWalker(raiz, NodeFilter.SHOW_TEXT, {
    acceptNode(n) { return textoTemValor(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP; }
  });
  while (walker.nextNode()) alvos.push(walker.currentNode);
  alvos.forEach(envolverValoresNoTexto);
}
let observadorPrivacidade = null;
function ativarObservadorPrivacidade() {
  if (observadorPrivacidade || typeof MutationObserver === 'undefined') return;
  observadorPrivacidade = new MutationObserver((registros) => {
    if (document.documentElement.classList.contains('privacidade')) {
      registros.forEach(r => {
        if (r.type === 'characterData') blindarValores(r.target);
        r.addedNodes.forEach(n => blindarValores(n));
      });
    }
    observadorPrivacidade.takeRecords(); // descarta as mudanças que o próprio blindar acabou de fazer
  });
  observadorPrivacidade.observe(document.body, { childList: true, subtree: true, characterData: true });
}
function aplicarPrivacidade(ligada, persistir) {
  document.documentElement.classList.toggle('privacidade', ligada);
  document.documentElement.classList.toggle('privacidade-ativa', ligada);
  if (document.body) document.body.classList.toggle('privacidade-ativa', ligada);
  if (persistir !== false) { try { localStorage.setItem(PRIV_CHAVE, ligada ? '1' : '0'); } catch (e) {} }
  if (ligada) {
    ativarObservadorPrivacidade();
    blindarValores(document.body);
  } else if (observadorPrivacidade) {
    observadorPrivacidade.disconnect();
    observadorPrivacidade = null;
  }
  const icone = document.getElementById('icone-privacidade');
  if (icone) icone.className = ligada ? 'ti ti-eye-off' : 'ti ti-eye';
  const lbl = document.getElementById('label-privacidade');
  if (lbl) lbl.textContent = ligada ? ' Mostrar Valores' : ' Ocultar Valores';
  atualizarSegurancaUI();
}
function alternarPrivacidade() { aplicarPrivacidade(!document.documentElement.classList.contains('privacidade')); }

/* ================= SEGURANÇA: PIN E BLOQUEIO ================= */
// O PIN é uma trava de tela por aparelho (guardado só aqui, nunca vai pra planilha nem pro backup).
// Guardamos só um "resumo" (PBKDF2-SHA256 com sal aleatório), nunca o PIN em si. Isso NÃO criptografa os dados do app.
const PIN_CHAVE = 'cofin-pin';
function lerConfigPin() { try { return JSON.parse(localStorage.getItem(PIN_CHAVE) || 'null'); } catch (e) { return null; } }
function gravarConfigPin(c) { localStorage.setItem(PIN_CHAVE, JSON.stringify(c)); }
function temPin() { const c = lerConfigPin(); return !!(c && c.hash); }
function bytesParaB64(buf) { let s = ''; new Uint8Array(buf).forEach(b => { s += String.fromCharCode(b); }); return btoa(s); }
function b64ParaBytes(b64) { const s = atob(b64); const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u; }
function exigirCripto() {
  if (!(window.crypto && window.crypto.subtle)) {
    throw new Error('Este ambiente não suporta a proteção por PIN (Web Crypto indisponível).');
  }
}
async function derivarPin(pin, salBytes, iteracoes) {
  exigirCripto();
  const chave = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await window.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salBytes, iterations: iteracoes }, chave, 256);
  return bytesParaB64(bits);
}
function iguaisEmTempoConstante(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function verificarPin(pin) {
  const c = lerConfigPin();
  if (!c || !c.hash) return false;
  return iguaisEmTempoConstante(await derivarPin(pin, b64ParaBytes(c.sal), c.it), c.hash);
}
async function gravarNovoPin(pin) {
  exigirCripto();
  const anterior = lerConfigPin() || {};
  const sal = gerarAleatorio(new Uint8Array(16));
  const it = 100000;
  gravarConfigPin({ v: 1, sal: bytesParaB64(sal), it, hash: await derivarPin(pin, sal, it), ocioso: anterior.ocioso || 0, falhas: 0, bloqueadoAte: 0 });
}
function fecharTodosOsModais() {
  document.querySelectorAll('.modal-bg.show').forEach(m => { if (m.id === 'modal-prompt') cancelarPrompt(); else m.classList.remove('show'); });
}
function bloquearApp() {
  if (!temPin()) { toast('Defina um PIN em Categorias & Contas > Segurança para poder bloquear.', 'err'); return; }
  fecharTodosOsModais();
  pararRelogioOcioso();
  document.documentElement.classList.add('bloqueado');
  const inp = document.getElementById('bloqueio-pin');
  inp.value = '';
  document.getElementById('bloqueio-erro').textContent = '';
  setTimeout(() => inp.focus(), 50);
}
function desbloquearApp() {
  document.documentElement.classList.remove('bloqueado');
  document.getElementById('bloqueio-pin').value = '';
  document.getElementById('bloqueio-erro').textContent = '';
  document.getElementById('bloqueio-confirma').value = '';
  document.getElementById('bloqueio-reset').style.display = 'none';
  iniciarRelogioOcioso();
  renderPaginaAtiva();
}
async function tentarDesbloquear() {
  const inp = document.getElementById('bloqueio-pin'), erro = document.getElementById('bloqueio-erro');
  const c = lerConfigPin();
  if (!c || !c.hash) { desbloquearApp(); return; }
  const agora = Date.now();
  if (c.bloqueadoAte && c.bloqueadoAte > agora) { erro.textContent = `Muitas tentativas. Aguarde ${Math.ceil((c.bloqueadoAte - agora) / 1000)}s.`; return; }
  if (!/^\d{4,6}$/.test(inp.value)) { erro.textContent = 'Digite o PIN de 4 a 6 números.'; return; }
  let certo = false;
  try { certo = await verificarPin(inp.value); } catch (e) { erro.textContent = e.message; return; }
  if (certo) { c.falhas = 0; c.bloqueadoAte = 0; gravarConfigPin(c); desbloquearApp(); return; }
  c.falhas = (c.falhas || 0) + 1;
  // a cada 5 erros seguidos: pausa de 30s, depois 60s, 2min... (no máximo 15min)
  if (c.falhas % 5 === 0) c.bloqueadoAte = agora + Math.min(900, 30 * Math.pow(2, c.falhas / 5 - 1)) * 1000;
  gravarConfigPin(c);
  inp.value = '';
  const card = document.querySelector('.bloqueio-card');
  card.classList.remove('tremer'); void card.offsetWidth; card.classList.add('tremer');
  erro.textContent = c.bloqueadoAte > agora
    ? `Muitas tentativas. Aguarde ${Math.ceil((c.bloqueadoAte - agora) / 1000)}s.`
    : `PIN incorreto. Mais ${5 - (c.falhas % 5)} tentativa(s) antes de uma pausa.`;
}
function mostrarEsqueciPin(e) { if (e) e.preventDefault(); document.getElementById('bloqueio-reset').style.display = ''; }
function recarregarApp() { location.reload(); }
function apagarDadosDoAparelho() {
  if (document.getElementById('bloqueio-confirma').value.trim().toUpperCase() !== 'APAGAR') {
    document.getElementById('bloqueio-erro').textContent = 'Digite APAGAR para confirmar.';
    return;
  }
  window.__apagandoDados = true; // impede qualquer salvamento em segundo plano de recriar os dados antes de recarregar
  try {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem('STATE');
    localStorage.removeItem(PIN_CHAVE);
    localStorage.removeItem(MS_CHAVE);
    localStorage.removeItem(MS_PKCE_CHAVE);
  } catch (e) {}
  recarregarApp();
}
// Bloqueio automático por inatividade
let ultimaAtividade = Date.now(), timerOcioso = null;
function registrarAtividade() { ultimaAtividade = Date.now(); }
function pararRelogioOcioso() { if (timerOcioso) { clearInterval(timerOcioso); timerOcioso = null; } }
function iniciarRelogioOcioso() {
  pararRelogioOcioso();
  const c = lerConfigPin();
  if (!c || !c.hash || !c.ocioso) return;
  ultimaAtividade = Date.now();
  timerOcioso = setInterval(verificarOcioso, 15000);
}
function verificarOcioso() {
  const c = lerConfigPin();
  if (!c || !c.hash || !c.ocioso || document.documentElement.classList.contains('bloqueado')) return;
  if (Date.now() - ultimaAtividade >= c.ocioso * 60000) bloquearApp();
}
['mousemove', 'keydown', 'click', 'touchstart', 'scroll'].forEach(ev => document.addEventListener(ev, registrarAtividade, { passive: true, capture: true }));
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') verificarOcioso(); });
function salvarOcioso() {
  const c = lerConfigPin();
  if (!c || !c.hash) return;
  c.ocioso = parseInt(document.getElementById('seg-ocioso').value, 10) || 0;
  gravarConfigPin(c);
  iniciarRelogioOcioso();
  toast(c.ocioso ? `Bloqueio automático após ${c.ocioso} min sem usar.` : 'Bloqueio automático desligado.', 'ok');
}
function atualizarSegurancaUI() {
  const el = (id) => document.getElementById(id);
  if (!el('seg-status')) return;
  const tem = temPin(), c = lerConfigPin() || {};
  el('seg-status').innerHTML = tem ? '<i class="ti ti-lock-check"></i> PIN ativo neste aparelho.' : '<i class="ti ti-lock-open"></i> Nenhum PIN definido — o app abre direto.';
  el('btn-pin-definir').style.display = tem ? 'none' : '';
  el('btn-pin-alterar').style.display = tem ? '' : 'none';
  el('btn-pin-remover').style.display = tem ? '' : 'none';
  el('btn-bloquear-agora').style.display = tem ? '' : 'none';
  el('btn-bloquear').style.display = tem ? '' : 'none';
  el('seg-ocioso').disabled = !tem;
  el('seg-ocioso').value = String(c.ocioso || 0);
  const elStealth = el('seg-stealth-ocioso');
  if (elStealth) {
    let t = '3';
    try {
      const salvo = localStorage.getItem('cofin-stealth-timeout');
      if (salvo !== null) t = salvo;
    } catch (e) {}
    elStealth.value = String(t);
  }
}
let modoPin = 'definir';
function abrirModalPin(modo) {
  modoPin = modo;
  document.getElementById('pin-titulo').textContent = { definir: 'Definir PIN', alterar: 'Alterar PIN', remover: 'Remover PIN' }[modo];
  document.getElementById('pin-atual-wrap').style.display = modo === 'definir' ? 'none' : '';
  document.getElementById('pin-novo-wrap').style.display = modo === 'remover' ? 'none' : '';
  document.getElementById('pin-conf-wrap').style.display = modo === 'remover' ? 'none' : '';
  ['pin-atual', 'pin-novo', 'pin-conf'].forEach(id => { document.getElementById(id).value = ''; });
  document.getElementById('pin-erro').textContent = '';
  abrirModal('modal-pin');
  setTimeout(() => document.getElementById(modo === 'definir' ? 'pin-novo' : 'pin-atual').focus(), 50);
}
async function confirmarModalPin() {
  const erro = document.getElementById('pin-erro');
  const atual = document.getElementById('pin-atual').value, novo = document.getElementById('pin-novo').value, conf = document.getElementById('pin-conf').value;
  try {
    if (modoPin !== 'definir' && !(await verificarPin(atual))) { erro.textContent = 'PIN atual incorreto.'; return; }
    if (modoPin === 'remover') {
      localStorage.removeItem(PIN_CHAVE);
      pararRelogioOcioso();
      fecharModal('modal-pin'); atualizarSegurancaUI();
      toast('PIN removido.', 'ok');
      return;
    }
    if (!/^\d{4,6}$/.test(novo)) { erro.textContent = 'O PIN precisa ter de 4 a 6 números.'; return; }
    if (novo !== conf) { erro.textContent = 'Os dois PINs não são iguais.'; return; }
    await gravarNovoPin(novo);
  } catch (e) { erro.textContent = e.message; return; }
  fecharModal('modal-pin');
  iniciarRelogioOcioso(); atualizarSegurancaUI();
  toast(modoPin === 'definir' ? 'PIN definido. O app vai pedir o PIN ao abrir.' : 'PIN alterado.', 'ok');
}

/* ================= LOGIN MICROSOFT (OAUTH) + ONEDRIVE PELA API DA MICROSOFT ================= */
// Troca "link público + Make.com" por uma conexão de verdade: você entra com a sua conta Microsoft (OAuth com PKCE,
// sem senha e sem segredo guardados no app) e o COFIN lê/grava a planilha direto no seu OneDrive, com controle de
// versão (não sobrescreve uma alteração feita em outro aparelho). O login fica só neste aparelho, numa chave própria
// do armazenamento local — nunca no backup nem na planilha.
const MS_CHAVE = 'cofin-ms';
const MS_PKCE_CHAVE = 'cofin-ms-pkce';
const MS_ESCOPOS = 'Files.ReadWrite offline_access User.Read';
const MS_REDIRECT_DESKTOP = 'http://localhost';
const GRAPH_URL = 'https://graph.microsoft.com/v1.0';
let msThrottleAte = 0; // se a Microsoft mandar esperar (Retry-After), nenhuma sincronização automática insiste antes disso
const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function ehElectron() {
  return (typeof window !== 'undefined' && !!window.electronAPI) ||
         (typeof process !== 'undefined' && !!(process.versions && process.versions.electron));
}
function ipcInvocar(canal, dados) {
  if (window.electronAPI && typeof window.electronAPI.invocar === 'function') {
    return window.electronAPI.invocar(canal, dados);
  }
  return Promise.reject(new Error('Electron IPC indisponível'));
}
function irParaUrl(url) { location.assign(url); }
function escHtml(t) { return String(t == null ? '' : t).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

function msLer() { try { return JSON.parse(localStorage.getItem(MS_CHAVE) || '{}') || {}; } catch (e) { return {}; } }
function msGravar(c) { localStorage.setItem(MS_CHAVE, JSON.stringify(c)); }
function msAtualizar(parcial) { const c = Object.assign(msLer(), parcial); msGravar(c); return c; }
function msRedirectWeb() { return location.origin + location.pathname.replace(/index\.html$/, ''); }
function msBase(c) { return 'https://login.microsoftonline.com/' + ((c && c.autoridade) || 'consumers') + '/oauth2/v2.0'; }
function erroMs(codigo, mensagem) { const e = new Error(mensagem || codigo); e.codigoMs = codigo; return e; }
// Só usa o login direto quando está tudo pronto: aplicativo configurado, conectado, sessão válida e arquivo escolhido.
function graphAtivo() {
  const c = msLer();
  return !!(c.clientId && c.tokens && c.tokens.renovacao && !c.expirada && c.arquivo && c.arquivo.itemId);
}

/* ---- PKCE ---- */
function base64Url(bytes) {
  let s = '';
  new Uint8Array(bytes).forEach(b => { s += String.fromCharCode(b); });
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function gerarAleatorio(arr) {
  if (window.crypto && window.crypto.getRandomValues) { window.crypto.getRandomValues(arr); return arr; }
  throw new Error('Este ambiente não tem gerador de números aleatórios seguro.');
}
function aleatorioB64Url(n) { return base64Url(gerarAleatorio(new Uint8Array(n))); }
async function sha256Bytes(texto) {
  const dados = new TextEncoder().encode(texto);
  if (window.crypto && window.crypto.subtle) return new Uint8Array(await window.crypto.subtle.digest('SHA-256', dados));
  throw new Error('Este ambiente não suporta SHA-256.');
}
async function desafioPkce(verifier) { return base64Url(await sha256Bytes(verifier)); }

/* ---- Tokens ---- */
// No Electron o pedido de token sai pelo processo principal (sem cabeçalho de origem e sem CORS), como num app nativo.
async function msPostToken(cfg, params) {
  const url = msBase(cfg) + '/token';
  const corpo = new URLSearchParams(params).toString();
  if (ehElectron()) {
    const r = await ipcInvocar('cofin:ms-token', { url, body: corpo });
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: r.json || {} };
  }
  const resp = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: corpo });
  let json = {};
  try { json = await resp.json(); } catch (e) {}
  return { ok: resp.ok, status: resp.status, json };
}
function msDescricaoErro(j, status) { return ((j && (j.error_description || j.error)) || ('HTTP ' + status)).split(/\r?\n/)[0]; }
function msGravarTokens(j) {
  const c = msLer();
  c.tokens = { acesso: j.access_token, expiraEm: Date.now() + (j.expires_in || 3600) * 1000, renovacao: j.refresh_token || (c.tokens && c.tokens.renovacao) };
  msGravar(c);
}
let msRenovando = null;
async function msTokenDeAcesso() {
  const c = msLer();
  if (!c.tokens || !c.tokens.renovacao) throw erroMs('NAO_CONECTADO', 'Não conectado à Microsoft.');
  if (c.expirada) throw erroMs('SESSAO_EXPIRADA', 'A sessão da Microsoft expirou.');
  if (c.tokens.acesso && c.tokens.expiraEm - 60000 > Date.now()) return c.tokens.acesso;
  if (!msRenovando) msRenovando = msRenovar().finally(() => { msRenovando = null; });
  return msRenovando;
}
async function msRenovar() {
  const c = msLer();
  const r = await msPostToken(c, { client_id: c.clientId, grant_type: 'refresh_token', refresh_token: c.tokens.renovacao, scope: MS_ESCOPOS });
  if (!r.ok) {
    // Só considera a sessão "vencida" quando a Microsoft diz isso; falha de rede ou erro 5xx NÃO desconecta ninguém.
    const motivo = r.json && r.json.error;
    if (motivo === 'invalid_grant' || motivo === 'interaction_required' || motivo === 'consent_required') {
      const atual = msLer();
      if (atual.tokens) atual.tokens.acesso = null;
      atual.expirada = true;
      msGravar(atual);
      atualizarStatusMs();
      throw erroMs('SESSAO_EXPIRADA', 'A sessão da Microsoft expirou.');
    }
    throw erroMs('RENOVACAO_FALHOU', 'Não consegui renovar o login: ' + msDescricaoErro(r.json, r.status));
  }
  msGravarTokens(r.json);
  return r.json.access_token;
}

/* ---- Login ---- */
async function msConectar() {
  const cfg = msLer();
  if (!cfg.clientId) { toast('Cole o ID do aplicativo (Azure) antes de conectar.', 'err'); return; }
  const desktop = ehElectron();
  if (!desktop && location.protocol === 'file:') { toast('Para entrar com a Microsoft, use o app de desktop ou o site publicado (https).', 'err'); return; }
  try {
    const verifier = aleatorioB64Url(64), state = aleatorioB64Url(16);
    const redirect = desktop ? MS_REDIRECT_DESKTOP : msRedirectWeb();
    const url = msBase(cfg) + '/authorize?' + new URLSearchParams({
      client_id: cfg.clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query',
      scope: MS_ESCOPOS, state, code_challenge: await desafioPkce(verifier), code_challenge_method: 'S256', prompt: 'select_account'
    }).toString();
    if (desktop) {
      const retorno = await ipcInvocar('cofin:ms-auth', url);
      await msConcluirLogin(retorno, { verifier, state, redirect });
      toast('Conectado à Microsoft.', 'ok');
      atualizarStatusMs();
      if (!msLer().arquivo) msAbrirEscolha();
      iniciarSyncAoVivo();
    } else {
      localStorage.setItem(MS_PKCE_CHAVE, JSON.stringify({ verifier, state, redirect, em: Date.now() }));
      irParaUrl(url);
    }
  } catch (e) {
    const t = String((e && e.message) || e);
    if (/No handler registered/i.test(t)) toast('O main.js do Electron precisa ser atualizado para entrar pelo desktop (troque pelo main.js novo e reinicie o app).', 'err');
    else toast('Não consegui conectar: ' + t, 'err');
  }
}
async function msConcluirLogin(urlRetorno, ctx) {
  const u = new URL(urlRetorno);
  const erro = u.searchParams.get('error');
  if (erro) throw new Error(((u.searchParams.get('error_description') || erro)).split(/\r?\n/)[0]);
  if (u.searchParams.get('state') !== ctx.state) throw new Error('A resposta do login não confere (state). Tente de novo.');
  const code = u.searchParams.get('code');
  if (!code) throw new Error('A Microsoft não devolveu o código de login.');
  const cfg = msLer();
  const r = await msPostToken(cfg, { client_id: cfg.clientId, grant_type: 'authorization_code', code, redirect_uri: ctx.redirect, code_verifier: ctx.verifier, scope: MS_ESCOPOS });
  if (!r.ok) throw new Error(msDescricaoErro(r.json, r.status));
  msGravarTokens(r.json);
  msAtualizar({ expirada: false });
  await msBuscarConta();
}
// Site/celular: depois do login a Microsoft devolve pra esta mesma página com ?code=...&state=...
async function msTratarRetornoDoLogin() {
  if (ehElectron()) return false;
  const p = new URLSearchParams(location.search);
  if (!p.has('code') && !p.has('error')) return false;
  let pendente = null;
  try { pendente = JSON.parse(localStorage.getItem(MS_PKCE_CHAVE) || 'null'); } catch (e) {}
  if (!pendente || p.get('state') !== pendente.state || Date.now() - pendente.em > 15 * 60000) return false; // não é um retorno nosso
  const urlRetorno = location.href;
  localStorage.removeItem(MS_PKCE_CHAVE);
  try { history.replaceState(null, '', location.pathname + location.hash); } catch (e) {} // tira o código da barra de endereço
  try {
    await msConcluirLogin(urlRetorno, pendente);
    if (pendente.silencioso) { toast('Sessão da Microsoft renovada.', 'ok'); return 'silencioso'; }
    toast('Conectado à Microsoft.', 'ok');
    return true;
  } catch (e) {
    if (pendente.silencioso) return false; // não deu pra renovar sem tela: fica o botão "Reconectar", sem alarde
    toast('Não consegui conectar: ' + e.message, 'err');
    return false;
  }
}
async function msBuscarConta() {
  try {
    const j = await graphJson('/me?$select=displayName,mail,userPrincipalName');
    msAtualizar({ conta: { nome: j.displayName || '', email: j.mail || j.userPrincipalName || '' } });
  } catch (e) { /* o nome da conta é só enfeite: não atrapalha o login */ }
}
function msDesconectar() {
  abrirConfirmacao('Desconectar da Microsoft? O COFIN volta ao método antigo (link + Make.com). Seus lançamentos continuam aqui.', () => {
    pararSyncAoVivo();
    const c = msLer();
    msGravar({ clientId: c.clientId, autoridade: c.autoridade });
    atualizarStatusMs();
    toast('Desconectado da Microsoft.', 'ok');
  }, 'Desconectar Microsoft');
}
function msSalvarConfig() {
  const c = msLer();
  const novoId = document.getElementById('ms-client-id').value.trim();
  const novaAut = document.getElementById('ms-autoridade').value;
  const mudou = !!((c.clientId && c.clientId !== novoId) || (c.autoridade && c.autoridade !== novaAut));
  msGravar(Object.assign({}, mudou ? {} : c, { clientId: novoId, autoridade: novaAut })); // trocou de aplicativo/tipo de conta: o login anterior não vale mais
  if (novoId && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(novoId)) toast('Esse ID não parece válido (o formato é xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx).', 'err');
  else if (mudou && c.tokens) toast('Você trocou o aplicativo ou o tipo de conta: entre de novo.', 'ok');
  atualizarStatusMs();
}
function atualizarStatusMs() {
  const el = (id) => document.getElementById(id);
  if (!el('ms-status')) return;
  const c = msLer();
  const conectado = !!(c.tokens && c.tokens.renovacao);
  const temArquivo = !!(c.arquivo && c.arquivo.itemId);
  let selo = c.clientId ? 'Não conectado' : 'Não configurado', classe = 'badge-cat';
  if (conectado && c.expirada) { selo = 'Sessão expirada — reconecte'; classe = 'badge-pendente'; }
  else if (conectado && !temArquivo) { selo = 'Conectado — escolha o arquivo'; classe = 'badge-pendente'; }
  else if (conectado) { selo = 'Conectado'; classe = 'badge-pago'; }
  el('ms-selo').className = 'badge ' + classe;
  el('ms-selo').textContent = selo;
  el('ms-status').textContent = conectado && c.conta
    ? 'Conta: ' + (c.conta.nome || '') + (c.conta.email ? ' (' + c.conta.email + ')' : '')
    : (c.clientId ? 'Toque em Conectar para entrar com a sua conta Microsoft.' : 'Preencha o ID do aplicativo (veja "Como configurar" abaixo).');
  if (document.activeElement !== el('ms-client-id')) el('ms-client-id').value = c.clientId || '';
  el('ms-autoridade').value = c.autoridade || 'consumers';
  el('btn-ms-conectar').innerHTML = '<i class="ti ti-brand-windows"></i> ' + (conectado ? 'Reconectar' : 'Conectar');
  el('btn-ms-arquivo').style.display = conectado ? '' : 'none';
  el('btn-ms-sync').style.display = conectado && temArquivo && !c.expirada ? '' : 'none';
  el('btn-ms-desconectar').style.display = conectado ? '' : 'none';
  el('ms-arquivo-atual').innerHTML = temArquivo
    ? 'Arquivo: <strong>' + escHtml(c.arquivo.nome) + '</strong> ' + escHtml(c.arquivo.caminho || '')
    : '';
  el('ms-aovivo').textContent = !graphAtivo() ? '' :
    socketEstado === 'conectado' ? '● Ao vivo: conectado — o que mudar em outro aparelho chega em instantes.' :
    socketEstado === 'conectando' ? '○ Conectando ao aviso em tempo real…' :
    'Sem aviso em tempo real agora: confiro mudanças a cada ~25 s e, ao voltar pro app, na hora.';
  el('ms-uri-web').textContent = location.protocol === 'file:' ? '(abra o site publicado para ver o endereço)' : msRedirectWeb();
  el('ms-uri-desktop').textContent = MS_REDIRECT_DESKTOP;
}

/* ---- Chamadas à API (Microsoft Graph) ---- */
async function graphFetch(caminho, opcoes, jaRenovou) {
  const token = await msTokenDeAcesso();
  const op = Object.assign({}, opcoes);
  op.headers = Object.assign({ Authorization: 'Bearer ' + token }, op.headers || {});
  const resp = await fetch(caminho.startsWith('http') ? caminho : GRAPH_URL + caminho, op);
  if ((resp.status === 429 || resp.status === 503) && resp.headers && typeof resp.headers.get === 'function') {
    const espera = parseInt(resp.headers.get('Retry-After') || '0', 10);
    if (espera > 0) msThrottleAte = Date.now() + Math.min(espera, 600) * 1000;
  }
  if (resp.status === 401 && !jaRenovou) { // token recusado: força uma renovação e tenta uma vez mais
    const c = msLer();
    if (c.tokens) { c.tokens.expiraEm = 0; msGravar(c); }
    return graphFetch(caminho, opcoes, true);
  }
  return resp;
}
async function erroGraph(resp) {
  let corpo = '';
  try { corpo = await resp.text(); } catch (e) {}
  let msg = '';
  try { const j = JSON.parse(corpo); msg = j.error && (j.error.message || j.error.code); } catch (e) { msg = corpo.slice(0, 160); }
  const e = new Error('Microsoft ' + resp.status + (msg ? ': ' + msg : ''));
  e.status = resp.status;
  return e;
}
async function graphJson(caminho, opcoes) {
  const resp = await graphFetch(caminho, opcoes);
  if (!resp.ok) throw await erroGraph(resp);
  return resp.json();
}
function graphItemUrl(arq) { return '/drives/' + encodeURIComponent(arq.driveId) + '/items/' + encodeURIComponent(arq.itemId); }
function graphMeta(arq) { return graphJson(graphItemUrl(arq) + '?select=id,name,size,eTag,file,parentReference,@microsoft.graph.downloadUrl'); }
// Baixa pelo endereço temporário de download (o caminho /content faz um redirecionamento que o navegador barra por CORS).
async function graphBaixar(arq, meta) {
  const url = meta['@microsoft.graph.downloadUrl'];
  if (url) {
    try { const r = await fetch(url); if (r.ok) return await r.arrayBuffer(); } catch (e) { /* CORS ou rede: tenta o outro caminho */ }
  }
  const r2 = await graphFetch(graphItemUrl(arq) + '/content');
  if (!r2.ok) throw await erroGraph(r2);
  return r2.arrayBuffer();
}
// Envia a nova versão. O caminho principal é a sessão de upload com If-Match (a Microsoft recusa com 412 se alguém
// alterou o arquivo desde que o lemos). Se o navegador bloquear esse caminho, usa o envio simples conferindo a versão antes.
async function graphEnviar(arq, bytes, etag) {
  const c = msLer();
  const tamanho = bytes.byteLength;
  let falhouSessao = false;
  if (!c.semSessaoUpload) {
    let sessao = null;
    try {
      const r = await graphFetch(graphItemUrl(arq) + '/createUploadSession', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'If-Match': etag },
        body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } })
      });
      if (!r.ok) throw await erroGraph(r);
      sessao = await r.json();
    } catch (e) { if (e.status) throw e; falhouSessao = true; }
    if (sessao && sessao.uploadUrl) {
      try {
        const up = await fetch(sessao.uploadUrl, { method: 'PUT', headers: { 'Content-Range': 'bytes 0-' + (tamanho - 1) + '/' + tamanho }, body: bytes });
        if (up.status === 412) throw Object.assign(new Error('Microsoft 412: o arquivo mudou'), { status: 412 });
        if (!up.ok) throw await erroGraph(up);
        const item = await up.json().catch(() => ({}));
        return item.eTag || null;
      } catch (e) { if (e.status) throw e; falhouSessao = true; }
    }
  }
  const atual = await graphMeta(arq);
  if (atual.eTag !== etag) throw Object.assign(new Error('Microsoft 412: o arquivo mudou'), { status: 412 });
  const r = await graphFetch(graphItemUrl(arq) + '/content', { method: 'PUT', headers: { 'Content-Type': MIME_XLSX }, body: bytes });
  if (!r.ok) throw await erroGraph(r);
  if (falhouSessao) msAtualizar({ semSessaoUpload: true }); // o envio simples funcionou: este ambiente não aceita a sessão de upload
  const item = await r.json().catch(() => ({}));
  return item.eTag || null;
}

/* ---- Planilha ---- */
const CABECALHO_PLANILHA = [
  'Data','Descrição','Categoria','Tipo','Valor','Conta','Status','ID',
  'ParcelaGrupo','ParcelaAtual','ParcelaTotal','RecorrenteID','Tags',
  'TransferenciaGrupo','TransferenciaContraparte',
  'GarantiaFim','GarantiaMeses','AnexoNome','AnexoPath',
  'EhReembolsavel','ReembolsoDevedor','Reembolsado','Conciliado',
  'FaturaPaga','EhPagamentoFatura','FaturaCompetencia'
];
function montarPlanilhaBytes(linhas) {
  const ws = XLSX.utils.json_to_sheet(linhas || lancamentosParaLinhas(), { header: CABECALHO_PLANILHA });
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Controle Financeiro');
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
}
function lerPlanilhaDoBuffer(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const linhas = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  const topo = XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] || [];
  return { linhas, cabecalhos: topo.map(h => String(h == null ? '' : h)), abas: wb.SheetNames.length };
}
function detectarMapaColunas(cabecalhos) {
  const achar = (nome) => cabecalhos.find(h => h.toLowerCase() === nome.toLowerCase()) || '';
  return {
    data: achar('Data'), descricao: achar('Descrição') || achar('Descricao'), categoria: achar('Categoria'),
    tipo: achar('Tipo'), valor: achar('Valor'), conta: achar('Conta'), status: achar('Status')
  };
}
// 'vazia' e 'cofin' são seguras pra gravar; 'estranha' (outra planilha) e 'multiplas' (várias abas) NUNCA são sobrescritas.
function classificarPlanilha(info) {
  if (info.abas > 1) return 'multiplas';
  if (!info.cabecalhos.length && !info.linhas.length) return 'vazia';
  const m = detectarMapaColunas(info.cabecalhos);
  return m.data && m.descricao && m.valor ? 'cofin' : 'estranha';
}

/* ---- Sincronização ---- */
let graphEmAndamento = false, graphPendente = false;
// Um ciclo: lê o arquivo, junta com o que há aqui, e só envia se houver algo a enviar. Se outro aparelho mexeu no
// arquivo no meio do caminho (412), recomeça lendo de novo — até 3 vezes.
async function cicloGraph() {
  const arq = msLer().arquivo;
  const antes = new Map(STATE.lancamentos.map(l => [l.id, impressaoCanonica(l)]));
  let enviou = false, baixou = false;
  for (let tentativa = 1; tentativa <= 3; tentativa++) {
    const meta = await graphMeta(arq);
    // Se a versão do arquivo é a mesma que já conferimos, não há o que baixar (só pode haver o que enviar).
    const nuvemIgual = !!msLer().ultimoETag && meta.eTag === msLer().ultimoETag;
    let info = null;
    if (!nuvemIgual) {
      info = { linhas: [], cabecalhos: [], abas: 0 };
      if (meta.size > 0) info = lerPlanilhaDoBuffer(await graphBaixar(arq, meta));
      const tipo = classificarPlanilha(info);
      if (tipo === 'multiplas') throw erroMs('ARQUIVO_INVALIDO', 'O arquivo tem mais de uma aba — não vou sobrescrevê-lo. Escolha outro ou crie um novo.');
      if (tipo === 'estranha') throw erroMs('ARQUIVO_INVALIDO', 'O arquivo não parece ser do COFIN (colunas: ' + (info.cabecalhos.slice(0, 5).join(', ') || '—') + ') — não vou sobrescrevê-lo.');
      baixou = true;
      if (info.linhas.length) mesclarLinhasNaBase(info.linhas, detectarMapaColunas(info.cabecalhos), true);
    }
    const temPendentes = STATE.lancamentos.some(l => l.sincronizado !== true);
    const temExclusoes = STATE.excluidosPendentes.length > 0;
    const nuvemVaziaMasTenhoDados = !!info && info.linhas.length === 0 && STATE.lancamentos.length > 0; // arquivo novo/zerado: repõe a partir daqui
    if (!(temPendentes || temExclusoes || nuvemVaziaMasTenhoDados)) { msAtualizar({ ultimoETag: meta.eTag }); break; }
    const instantaneo = tirarInstantaneo();
    const idsApagados = [...STATE.excluidosPendentes];
    let novoETag = null;
    try {
      novoETag = await graphEnviar(arq, montarPlanilhaBytes(), meta.eTag);
    } catch (e) {
      if (e.status === 412 && tentativa < 3) continue;
      throw e;
    }
    await concluirEnvio(instantaneo, idsApagados);
    msAtualizar({ ultimoETag: novoETag || null }); // a versão que acabamos de gravar é "nossa": não precisa baixar de volta
    enviou = true;
    break;
  }
  return Object.assign(contarMudancas(antes, STATE.lancamentos), { enviou, baixou });
}
// Comparação "de conteúdo" entre o que havia antes e o que há depois de mesclar (a ordem dos campos não conta).
function impressaoCanonica(l) {
  return JSON.stringify([l.id, l.tipo, l.data, l.descricao, l.categoria, l.conta, Number(l.valor), estaPago(l), l.faturaPaga === true, (l.tags || []).join('|'),
    l.parcelaGrupo || '', l.parcelaAtual || 0, l.parcelaTotal || 0, l.recorrenteId || '', l.transferenciaGrupo || '',
    l.garantiaFim || '', l.garantiaMeses || 0, l.anexoNome || '', l.anexoPath || '',
    l.ehReembolsavel || false, l.reembolsoDevedor || '', l.reembolsado || false]);
}
function contarMudancas(antes, depois) {
  let novos = 0, alterados = 0, removidos = 0;
  const vistos = new Set();
  depois.forEach(l => {
    vistos.add(l.id);
    if (!antes.has(l.id)) novos++; else if (antes.get(l.id) !== impressaoCanonica(l)) alterados++;
  });
  antes.forEach((_, id) => { if (!vistos.has(id)) removidos++; });
  return { novos, alterados, removidos };
}
async function sincronizarGraph(silencioso) {
  if (Date.now() < msThrottleAte) {
    if (!silencioso) toast('A Microsoft pediu para aguardar ' + Math.ceil((msThrottleAte - Date.now()) / 1000) + ' s antes de sincronizar de novo.', 'err');
    return null;
  }
  if (graphEmAndamento) { graphPendente = true; return null; }
  graphEmAndamento = true;
  if (!silencioso) atualizarIndicadorNuvem('baixando');
  try {
    const r = await cicloGraph();
    STATE.config.lastSync = new Date().toISOString();
    const mudou = !!(r.novos || r.alterados || r.removidos || r.enviou || r.baixou);
    if (mudou || !silencioso) { // checagem silenciosa sem novidade não grava nem redesenha nada
      await salvarDados();
      renderPaginaAtivaQuandoLivre();
      atualizarStatusSync();
      atualizarIndicadorNuvem('ok');
    }
    const partes = [];
    if (r.novos) partes.push('+' + r.novos + ' novo(s)');
    if (r.alterados) partes.push(r.alterados + ' alterado(s)');
    if (r.removidos) partes.push(r.removidos + ' removido(s)');
    if (!silencioso) toast('OneDrive sincronizado' + (partes.length ? ': ' + partes.join(', ') : '') + (r.enviou ? (partes.length ? ' · ' : ': ') + 'suas alterações foram enviadas' : '') + '.', 'ok');
    else if (partes.length) toast('Atualizado pela nuvem: ' + partes.join(', ') + '.', 'ok');
    return r;
  } catch (e) {
    console.warn('Sincronização com o OneDrive falhou:', e);
    atualizarIndicadorNuvem('erro');
    if (e.codigoMs === 'SESSAO_EXPIRADA') {
      atualizarStatusMs();
      pararSyncAoVivo();
      // No site/celular, tenta renovar o login sozinho (sem tela); só se não der, avisa e cai pro método antigo.
      const renovando = document.visibilityState === 'visible' ? await msReconectarSilencioso() : false;
      if (!renovando) {
        toast('Sua sessão da Microsoft expirou. Reconecte em Sincronizar OneDrive — até lá uso o método antigo.', 'err');
        if (silencioso) salvarNaNuvemWebhook(true).catch(() => {});
      }
    } else if (!silencioso || e.codigoMs === 'ARQUIVO_INVALIDO') {
      toast('Não consegui sincronizar com o OneDrive: ' + e.message, 'err');
    }
    return null;
  } finally {
    graphEmAndamento = false;
    if (graphPendente) { graphPendente = false; sincronizarEmSegundoPlano(); }
  }
}

/* ---- Sincronização "ao vivo" ---- */
// Enquanto o app está na tela: (1) o OneDrive avisa por WebSocket (socket.io) que algo mudou; (2) uma checagem leve de
// versão serve de reserva (se o aviso não chegar ou cair); (3) ao voltar pro app, confere na hora. Em segundo plano o
// celular suspende o app — isso nenhum site consegue contornar sem servidor; ao voltar, o item (3) resolve.
const SOCKETIO_URL = 'https://cdnjs.cloudflare.com/ajax/libs/socket.io/4.8.1/socket.io.js'; // endereço da documentação da Microsoft
let POLL_RAPIDO_MS = 25000, POLL_LENTO_MS = 90000, SOCKET_BACKOFF_BASE_MS = 5000, NOTIFICACAO_ATRASO_MS = 800;
let socketMs = null, socketEstado = 'parado', socketTentativas = 0, timerReconectarSocket = null, timerNotificacao = null, carregandoSocketLib = null;
let timerPoll = null, pollFalhas = 0, ultimoRetorno = 0;
function intervaloPoll() { return Math.min(300000, (socketEstado === 'conectado' ? POLL_LENTO_MS : POLL_RAPIDO_MS) * Math.pow(2, Math.min(pollFalhas, 4))); }
function carregarSocketIo() {
  if (typeof window.io === 'function') return Promise.resolve(true);
  if (carregandoSocketLib) return carregandoSocketLib;
  carregandoSocketLib = new Promise(resolve => {
    const sc = document.createElement('script');
    sc.src = SOCKETIO_URL; sc.async = true;
    sc.onload = () => resolve(typeof window.io === 'function');
    sc.onerror = () => { carregandoSocketLib = null; resolve(false); };
    document.head.appendChild(sc);
  });
  return carregandoSocketLib;
}
async function iniciarSocketOneDrive() {
  if (socketMs || !graphAtivo() || document.visibilityState !== 'visible') return;
  socketEstado = 'conectando';
  atualizarStatusMs();
  try {
    if (!(await carregarSocketIo())) throw new Error('biblioteca socket.io indisponível');
    const j = await graphJson('/me/drive/root/subscriptions/socketIo');
    if (!j.notificationUrl) throw new Error('a Microsoft não devolveu o endereço de notificação');
    // reconnection:false — quem reconecta somos nós, pedindo um endereço novo (o antigo pode ter expirado)
    const sk = window.io(j.notificationUrl, { transports: ['websocket'], reconnection: false });
    socketMs = sk;
    sk.on('connect', () => { socketEstado = 'conectado'; socketTentativas = 0; atualizarStatusMs(); agendarPoll(); verificarMudancaRemota().catch(() => {}); });
    sk.on('notification', () => { // o aviso vale pro OneDrive inteiro e não diz o que mudou: junta rajadas e confere a nossa planilha
      clearTimeout(timerNotificacao);
      timerNotificacao = setTimeout(() => verificarMudancaRemota().catch(() => {}), NOTIFICACAO_ATRASO_MS);
    });
    const caiu = () => { if (socketMs !== sk) return; socketMs = null; socketEstado = 'caido'; atualizarStatusMs(); agendarPoll(); agendarReconexaoSocket(); };
    sk.on('disconnect', caiu);
    sk.on('connect_error', caiu);
  } catch (e) {
    socketMs = null; socketEstado = 'caido';
    atualizarStatusMs(); agendarPoll(); agendarReconexaoSocket();
  }
}
function agendarReconexaoSocket() {
  clearTimeout(timerReconectarSocket);
  if (!graphAtivo() || document.visibilityState !== 'visible') return;
  socketTentativas++;
  timerReconectarSocket = setTimeout(iniciarSocketOneDrive, Math.min(300000, SOCKET_BACKOFF_BASE_MS * Math.pow(2, Math.min(socketTentativas - 1, 6))));
}
function pararSocketOneDrive() {
  clearTimeout(timerReconectarSocket); clearTimeout(timerNotificacao);
  const sk = socketMs;
  socketMs = null; socketEstado = 'parado';
  if (sk) { try { if (sk.removeAllListeners) sk.removeAllListeners(); sk.disconnect(); } catch (e) {} }
}
function agendarPoll() {
  clearTimeout(timerPoll); timerPoll = null;
  if (!graphAtivo() || document.visibilityState !== 'visible') return;
  timerPoll = setTimeout(async () => {
    try { await verificarMudancaRemota(); pollFalhas = 0; } catch (e) { pollFalhas++; }
    agendarPoll();
  }, intervaloPoll());
}
// Consulta leve (só a versão do arquivo): se mudou — ou se há algo daqui pra enviar — faz o ciclo completo.
async function verificarMudancaRemota() {
  if (!graphAtivo() || graphEmAndamento || Date.now() < msThrottleAte) return false;
  const c = msLer();
  const leve = await graphJson(graphItemUrl(c.arquivo) + '?select=id,eTag');
  const pendentes = STATE.lancamentos.some(l => l.sincronizado !== true) || STATE.excluidosPendentes.length > 0;
  if (leve.eTag !== c.ultimoETag || pendentes) { await sincronizarGraph(true); return true; }
  return false;
}
function iniciarSyncAoVivo() {
  if (!graphAtivo()) { pararSyncAoVivo(); return; }
  if (document.visibilityState !== 'visible') return;
  agendarPoll();
  iniciarSocketOneDrive();
}
function pararSyncAoVivo() {
  clearTimeout(timerPoll); timerPoll = null;
  pararSocketOneDrive();
  atualizarStatusMs();
}
function aoVoltarParaOApp() {
  const agora = Date.now();
  if (agora - ultimoRetorno < 2000) return; // visibilitychange + focus chegam juntos
  ultimoRetorno = agora;
  atualizarStatusMs(); // o login pode ter terminado em outra aba/janela
  const c = msLer();
  if (c.expirada && !ehElectron()) { msReconectarSilencioso().catch(() => {}); return; }
  if (!graphAtivo()) return;
  verificarMudancaRemota().catch(() => {});
  iniciarSyncAoVivo();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') aoVoltarParaOApp(); else pararSyncAoVivo(); });
window.addEventListener('focus', aoVoltarParaOApp);
window.addEventListener('online', aoVoltarParaOApp);
window.addEventListener('storage', (e) => { if (e.key === MS_CHAVE) { atualizarStatusMs(); iniciarSyncAoVivo(); } });

// Renovação do login sem tela (site/celular): a Microsoft limita esse login a 24 h. Se a sessão dela no aparelho ainda
// vale, uma ida-e-volta rápida (prompt=none) renova; se não, volta com erro e só então aparece o botão "Reconectar".
async function msReconectarSilencioso() {
  const cfg = msLer();
  if (ehElectron() || location.protocol === 'file:' || !cfg.clientId || !cfg.expirada || document.visibilityState !== 'visible') return false;
  if (Date.now() - (cfg.ultimaTentativaSilenciosa || 0) < 10 * 60000) return false; // evita ficar indo e voltando
  msAtualizar({ ultimaTentativaSilenciosa: Date.now() });
  try {
    const verifier = aleatorioB64Url(64), state = aleatorioB64Url(16), redirect = msRedirectWeb();
    const params = { client_id: cfg.clientId, response_type: 'code', redirect_uri: redirect, response_mode: 'query', scope: MS_ESCOPOS,
      state, code_challenge: await desafioPkce(verifier), code_challenge_method: 'S256', prompt: 'none' };
    if (cfg.conta && cfg.conta.email) params.login_hint = cfg.conta.email;
    localStorage.setItem(MS_PKCE_CHAVE, JSON.stringify({ verifier, state, redirect, em: Date.now(), silencioso: true }));
    irParaUrl(msBase(cfg) + '/authorize?' + new URLSearchParams(params).toString());
    return true;
  } catch (e) { return false; }
}

// Só redesenha a tela quando você NÃO está no meio de um formulário (senão o redesenho zeraria o que você escolheu/digitou).
// Os dados são atualizados na hora; só o desenho espera.
function usuarioEditando() {
  if (document.querySelector('.modal-bg.show')) return true;
  const a = document.activeElement;
  if (!a || a === document.body || !/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName || '')) return false;
  if (a.closest('.filters') || a.id === 'rapido-texto') return false; // filtros e lançamento rápido não são afetados pelo redesenho
  return !!a.closest('.page.active');
}
let renderAdiadoTimer = null;
function renderPaginaAtivaQuandoLivre() {
  if (!usuarioEditando()) { renderPaginaAtiva(); return; }
  if (renderAdiadoTimer) return;
  renderAdiadoTimer = setInterval(() => {
    if (usuarioEditando()) return;
    clearInterval(renderAdiadoTimer); renderAdiadoTimer = null;
    renderPaginaAtiva();
  }, 1500);
}

/* ---- Escolha do arquivo ---- */
let msResultadosBusca = [];
function msAbrirEscolha() {
  const painel = document.getElementById('ms-escolha');
  if (!painel) return;
  painel.style.display = '';
  document.getElementById('ms-escolha-msg').textContent = '';
}
function msCaminhoDoItem(i) { return ((i.parentReference && i.parentReference.path) || '').replace(/^.*root:/, '') || '/'; }
async function msBuscarArquivos() {
  const q = document.getElementById('ms-busca').value.trim();
  const msg = document.getElementById('ms-escolha-msg');
  if (!q) { msg.textContent = 'Digite parte do nome do arquivo (ex: controle).'; return; }
  msg.textContent = 'Buscando...';
  try {
    const j = await graphJson("/me/drive/root/search(q='" + encodeURIComponent(q.replace(/'/g, "''")) + "')?$select=id,name,size,file,parentReference,lastModifiedDateTime&$top=25");
    msResultadosBusca = (j.value || []).filter(i => i.file && /\.xlsx$/i.test(i.name));
    document.getElementById('ms-resultados').innerHTML = msResultadosBusca.length
      ? '<div class="table-wrap"><table><thead><tr><th>Arquivo</th><th>Pasta</th><th>Alterado</th><th></th></tr></thead><tbody>' +
        msResultadosBusca.map((i, k) => '<tr><td>' + escHtml(i.name) + '</td><td>' + escHtml(msCaminhoDoItem(i)) + '</td><td>' +
          (i.lastModifiedDateTime ? new Date(i.lastModifiedDateTime).toLocaleDateString('pt-BR') : '') +
          '</td><td style="text-align:right"><button class="btn btn-sm" onclick="msUsarResultado(' + k + ')">Usar este</button></td></tr>').join('') +
        '</tbody></table></div>'
      : '';
    msg.textContent = msResultadosBusca.length ? '' : 'Nenhuma planilha (.xlsx) encontrada com esse nome.';
  } catch (e) { msg.textContent = 'Erro na busca: ' + e.message; }
}
function msUsarResultado(k) { return msUsarArquivo(msResultadosBusca[k]); }
function codificarLinkCompartilhado(link) {
  return btoa(unescape(encodeURIComponent(link.split('?')[0]))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
}
// Tentativa: a Microsoft nem sempre aceita links no formato novo (1drv.ms/.../c/...), então isso pode falhar — e tudo bem.
async function msTentarLink() {
  const msg = document.getElementById('ms-escolha-msg');
  const link = (STATE.config && STATE.config.oneDriveLink) || document.getElementById('sync-link').value.trim();
  if (!link) { msg.textContent = 'Não há link configurado no método antigo.'; return; }
  msg.textContent = 'Tentando abrir o seu link pela API da Microsoft...';
  try {
    const item = await graphJson('/shares/u!' + codificarLinkCompartilhado(link) + '/driveItem?$select=id,name,size,file,parentReference');
    await msUsarArquivo(item);
  } catch (e) {
    msg.textContent = 'A Microsoft não aceitou esse link pela API (' + e.message + '). Links no formato novo (1drv.ms/…/c/…) costumam não funcionar — use a busca pelo nome do arquivo.';
  }
}
async function msCriarArquivo() {
  const msg = document.getElementById('ms-escolha-msg');
  msg.textContent = 'Criando o arquivo...';
  try {
    const r = await graphFetch('/me/drive/root:/COFIN/controle-financeiro.xlsx:/content?@microsoft.graph.conflictBehavior=fail', {
      method: 'PUT', headers: { 'Content-Type': MIME_XLSX }, body: montarPlanilhaBytes([])
    });
    if (r.status === 409) { msg.textContent = 'Já existe COFIN/controle-financeiro.xlsx no seu OneDrive. Use a busca (digite "controle") para escolhê-lo.'; return; }
    if (!r.ok) throw await erroGraph(r);
    await msUsarArquivo(await r.json());
  } catch (e) { msg.textContent = 'Não consegui criar o arquivo: ' + e.message; }
}
async function msUsarArquivo(item) {
  const msg = document.getElementById('ms-escolha-msg');
  const arq = { driveId: item.parentReference && item.parentReference.driveId, itemId: item.id, nome: item.name, caminho: msCaminhoDoItem(item) };
  if (!arq.driveId || !arq.itemId) { msg.textContent = 'A Microsoft não informou onde o arquivo está.'; return; }
  msg.textContent = 'Conferindo o arquivo...';
  try {
    const meta = await graphMeta(arq);
    let info = { linhas: [], cabecalhos: [], abas: 0 };
    if (meta.size > 0) info = lerPlanilhaDoBuffer(await graphBaixar(arq, meta));
    const tipo = classificarPlanilha(info);
    if (tipo === 'multiplas') { msg.textContent = 'Esse arquivo tem mais de uma aba. O COFIN só gerencia arquivos próprios (uma aba) — escolha outro ou crie um novo.'; return; }
    if (tipo === 'estranha') { msg.textContent = 'Esse arquivo não parece ser do COFIN (colunas: ' + (info.cabecalhos.slice(0, 6).join(', ') || '—') + '). Pra não sobrescrever os seus dados, não vou usá-lo.'; return; }
    // Arquivo novo: não sabemos o que ele tem, então tudo que há aqui vira "ainda não enviado" — é preservado e entra no arquivo.
    if ((msLer().arquivo || {}).itemId !== arq.itemId) {
      STATE.lancamentos = STATE.lancamentos.map(l => ({ ...l, sincronizado: false }));
      await salvarDados();
    }
    msAtualizar({ arquivo: arq, semSessaoUpload: false, ultimoETag: null });
    msg.textContent = '';
    document.getElementById('ms-escolha').style.display = 'none';
    atualizarStatusMs();
    toast(tipo === 'vazia' ? 'Arquivo escolhido (está vazio — vou enviar os seus lançamentos).' : 'Arquivo escolhido. Juntando com os lançamentos daqui...', 'ok');
    await sincronizarGraph(false);
    iniciarSyncAoVivo();
  } catch (e) { msg.textContent = 'Não consegui abrir o arquivo: ' + e.message; }
}

/* ================= BUSCA GLOBAL (CTRL+K) ================= */
let buscaIndiceAtivo = 0;
let buscaResultadosAtuais = [];
function itensBuscaFixos() {
  const paginas = [
    { tipo:'nav', pagina:'dashboard', label:'Dashboard', icone:'layout-dashboard' },
    { tipo:'nav', pagina:'lancamentos', label:'Lançamentos', icone:'list-details' },
    { tipo:'nav', pagina:'cartoes', label:'Cartões & Faturas', icone:'credit-card' },
    { tipo:'nav', pagina:'recorrentes', label:'Assinaturas & Recorrentes', icone:'repeat' },
    { tipo:'nav', pagina:'metas', label:'Metas & Cofres', icone:'pig-money' },
    { tipo:'nav', pagina:'dividas', label:'Dívidas & Terceiros', icone:'users' },
    { tipo:'nav', pagina:'relatorios', label:'Relatórios', icone:'chart-bar' },
    { tipo:'nav', pagina:'sync', label:'Sincronizar OneDrive', icone:'cloud-download' },
    { tipo:'nav', pagina:'config', label:'Categorias & Contas', icone:'settings' }
  ];
  const acoes = [
    { tipo:'acao', label:'Lançamento rápido (texto livre)', icone:'bolt', executar: () => { nav('lancamentos'); setTimeout(() => document.getElementById('rapido-texto').focus(), 60); } },
    { tipo:'acao', label:'Novo lançamento', icone:'plus', executar: () => abrirModalLancamento() },
    { tipo:'acao', label:'Cofre de Garantias Ativas', icone:'shield-check', executar: () => abrirModalGarantias() },
    { tipo:'acao', label:'Alternar Modo Viagem', icone:'plane', executar: () => alternarModoViagem() },
    { tipo:'acao', label:'Nova transferência', icone:'transfer', executar: () => abrirModalTransferencia() },
    { tipo:'acao', label:'Abrir lixeira', icone:'trash', executar: () => { nav('lancamentos'); abrirLixeira(); } },
    { tipo:'acao', label:'Ocultar/mostrar valores (privacidade)', icone:'eye-off', executar: () => alternarPrivacidade() },
    { tipo:'acao', label:'Bloquear agora (PIN)', icone:'lock', executar: () => bloquearApp() },
    { tipo:'acao', label:'Sincronizar Tudo', icone:'refresh', executar: () => sincronizacaoInteligente() },
    { tipo:'acao', label:'Exportar backup', icone:'download', executar: () => exportarBackup() },
    { tipo:'acao', label:'Alternar tema claro/escuro', icone:'moon', executar: () => alternarTema() }
  ];
  return { paginas, acoes };
}
function escapeHTML(str) {
  if (str === null || str === undefined) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
function abrirBusca() {
  const inp = document.getElementById('busca-input');
  if (inp) inp.value = '';
  buscaIndiceAtivo = 0;
  abrirModal('modal-busca');
  filtrarBusca();
  setTimeout(() => { if (inp) inp.focus(); }, 60);
}
function definirTermoBusca(termo) {
  const inp = document.getElementById('busca-input');
  if (!inp) return;
  inp.value = termo;
  inp.focus();
  filtrarBusca();
}
function comandosSpotlight() {
  return [
    { tipo: 'comando', cmd: '>novo', label: 'Criar novo lançamento', icone: 'plus', executar: () => abrirModalLancamento() },
    { tipo: 'comando', cmd: '>salario', label: 'Configurar Receita Fixa / Salário (Auto-Paycheck)', icone: 'cash', executar: () => abrirModalRendas() },
    { tipo: 'comando', cmd: '>rendas', label: 'Receitas Fixas Inteligentes (Auto-Paycheck)', icone: 'cash-banknote', executar: () => { nav('config'); document.getElementById('card-receitas-fixas')?.scrollIntoView({ behavior: 'smooth' }); } },
    { tipo: 'comando', cmd: '>parcelado', label: 'Simulador: À Vista vs. Parcelado (CDI)', icone: 'percentage', executar: () => abrirModalSimuladorParcelado() },
    { tipo: 'comando', cmd: '>cartoes', label: 'Gestão de Cartões & Melhor Dia de Compra', icone: 'credit-card', executar: () => abrirModalGerirCartoes() },
    { tipo: 'comando', cmd: '>stealth', label: 'Modo Stealth (Privacidade Inteligente)', icone: 'eye', executar: () => alternarModoStealth() },
    { tipo: 'comando', cmd: '>snapshot', label: 'Registrar Snapshot de Patrimônio (Máquina do Tempo)', icone: 'camera', executar: () => registrarSnapshotAtual() },
    { tipo: 'comando', cmd: '>reembolsos', label: 'Ver Despesas a Recuperar (Dinheiro na Rua)', icone: 'receipt-refund', executar: () => { nav('dashboard'); document.getElementById('dash-reembolsos-card')?.scrollIntoView({ behavior: 'smooth' }); } },
    { tipo: 'comando', cmd: '>metas', label: 'Abrir Metas & Cofres (Vaults)', icone: 'pig-money', executar: () => nav('metas') },
    { tipo: 'comando', cmd: '>garantias', label: 'Abrir Cofre de Garantias Ativas', icone: 'shield-check', executar: () => abrirModalGarantias() },
    { tipo: 'comando', cmd: '>viagem', label: 'Ativar / Encerrar Modo Viagem', icone: 'plane', executar: () => alternarModoViagem() },
    { tipo: 'comando', cmd: '>tema escuro', label: 'Ativar tema escuro (Dark Mode)', icone: 'moon', executar: () => aplicarTema('dark') },
    { tipo: 'comando', cmd: '>tema claro', label: 'Ativar tema claro (Light Mode)', icone: 'sun', executar: () => aplicarTema('light') },
    { tipo: 'comando', cmd: '>relatorio', label: 'Abrir aba de Relatórios & Análises', icone: 'chart-bar', executar: () => nav('relatorios') },
    { tipo: 'comando', cmd: '>simulador', label: 'Abrir Simulador de Compra (What-If)', icone: 'calculator', executar: () => abrirModalSimulador() },
    { tipo: 'comando', cmd: '>selecionar', label: 'Modo Seleção em Lote (Apagar / Conciliar)', icone: 'checks', executar: () => { nav('lancamentos'); if (!modoConciliacaoAtivo) alternarModoConciliacao(); } },
    { tipo: 'comando', cmd: '>conciliar', label: 'Ativar Modo Seleção / Conciliação em Lançamentos', icone: 'checks', executar: () => { nav('lancamentos'); if (!modoConciliacaoAtivo) alternarModoConciliacao(); } },
    { tipo: 'comando', cmd: '>backup', label: 'Shadow Vault: Forçar Backup Agora', icone: 'device-floppy', executar: () => executarBackupSilencioso(true) },
    { tipo: 'comando', cmd: '>restaurar', label: 'Restaurar Arquivo de Backup (.json)', icone: 'restore', executar: () => restaurarBackup() },
    { tipo: 'comando', cmd: '>dashboard', label: 'Ir para o Dashboard', icone: 'layout-dashboard', executar: () => nav('dashboard') }
  ];
}
function filtrarBusca() {
  const inp = document.getElementById('busca-input');
  const bruto = inp ? inp.value : '';
  const termo = bruto.trim().toLowerCase();
  const { paginas, acoes } = itensBuscaFixos();
  const cmds = comandosSpotlight();

  if (termo.startsWith('>')) {
    const qCmd = termo.slice(1).trim();
    const resultados = cmds.filter(c =>
      !qCmd ||
      c.cmd.toLowerCase().includes(qCmd) ||
      c.label.toLowerCase().includes(qCmd)
    );
    buscaIndiceAtivo = 0;
    renderResultadosBusca(resultados);
    return;
  }

  if (!termo) {
    const resultados = [
      ...cmds.slice(0, 4),
      ...acoes.slice(0, 4),
      ...paginas.slice(0, 4)
    ];
    buscaIndiceAtivo = 0;
    renderResultadosBusca(resultados);
    return;
  }

  // SPOTLIGHT SEMÂNTICO: Parser de Linguagem Natural e Filtros
  let textoProcessado = termo;
  let filtroPeriodo = null;
  let filtroTipo = null;
  let filtroStatus = null;

  const hoje = new Date();
  const anoAtual = hoje.getFullYear();
  const mesAtual = hoje.getMonth();
  const pad2 = n => String(n).padStart(2, '0');
  const chaveEsteMes = `${anoAtual}-${pad2(mesAtual + 1)}`;
  const dPassado = new Date(anoAtual, mesAtual - 1, 1);
  const chaveMesPassado = `${dPassado.getFullYear()}-${pad2(dPassado.getMonth() + 1)}`;
  const dProximo = new Date(anoAtual, mesAtual + 1, 1);
  const chaveProximoMes = `${dProximo.getFullYear()}-${pad2(dProximo.getMonth() + 1)}`;
  const chaveAnoPassado = `${anoAtual - 1}`;

  if (/m[eê]s\s+passado/i.test(textoProcessado)) {
    filtroPeriodo = 'mes_passado';
    textoProcessado = textoProcessado.replace(/m[eê]s\s+passado/gi, ' ');
  } else if (/este\s+m[eê]s|esse\s+m[eê]s|m[eê]s\s+atual/i.test(textoProcessado)) {
    filtroPeriodo = 'este_mes';
    textoProcessado = textoProcessado.replace(/este\s+m[eê]s|esse\s+m[eê]s|m[eê]s\s+atual/gi, ' ');
  } else if (/pr[oó]ximo\s+m[eê]s|m[eê]s\s+que\s+vem/i.test(textoProcessado)) {
    filtroPeriodo = 'proximo_mes';
    textoProcessado = textoProcessado.replace(/pr[oó]ximo\s+m[eê]s|m[eê]s\s+que\s+vem/gi, ' ');
  } else if (/ano\s+passado/i.test(textoProcessado)) {
    filtroPeriodo = 'ano_passado';
    textoProcessado = textoProcessado.replace(/ano\s+passado/gi, ' ');
  }

  const tokens = textoProcessado.trim().split(/\s+/).filter(Boolean);
  const tokensTexto = [];

  tokens.forEach(t => {
    if (['receita', 'receitas', 'entrada', 'entradas'].includes(t)) {
      filtroTipo = 'receita';
    } else if (['despesa', 'despesas', 'saida', 'saidas', 'gasto', 'gastos'].includes(t)) {
      filtroTipo = 'despesa';
    } else if (['transferencia', 'transferência', 'transf'].includes(t)) {
      filtroTipo = 'transferencia';
    } else if (['pago', 'pagos', 'efetivado', 'liquidado'].includes(t)) {
      filtroStatus = 'pago';
    } else if (['pendente', 'pendentes', 'aberto', 'abertos'].includes(t)) {
      filtroStatus = 'pendente';
    } else {
      tokensTexto.push(t);
    }
  });

  const lancsFiltrados = (STATE.lancamentos || []).filter(l => {
    if (filtroTipo && l.tipo !== filtroTipo) return false;
    const dt = l.data || l.dataCompra || '';
    if (filtroPeriodo === 'mes_passado' && !dt.startsWith(chaveMesPassado)) return false;
    if (filtroPeriodo === 'este_mes' && !dt.startsWith(chaveEsteMes)) return false;
    if (filtroPeriodo === 'proximo_mes' && !dt.startsWith(chaveProximoMes)) return false;
    if (filtroPeriodo === 'ano_passado' && !dt.startsWith(chaveAnoPassado)) return false;
    if (filtroStatus === 'pago' && !l.pago) return false;
    if (filtroStatus === 'pendente' && l.pago) return false;

    if (tokensTexto.length > 0) {
      const desc = (l.descricao || '').toLowerCase();
      const cat = (l.categoria || '').toLowerCase();
      const cta = (l.conta || '').toLowerCase();
      const tags = (l.tags || []).join(' ').toLowerCase();
      const valStr = String(l.valor || '');
      const valBRL = toBRL(l.valor || 0).toLowerCase();

      const casaTodos = tokensTexto.every(tok =>
        desc.includes(tok) ||
        cat.includes(tok) ||
        cta.includes(tok) ||
        tags.includes(tok) ||
        valStr.includes(tok) ||
        valBRL.includes(tok)
      );
      if (!casaTodos) return false;
    }
    return true;
  });

  lancsFiltrados.sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const lancsResult = lancsFiltrados.slice(0, 15).map(l => {
    const dtFmt = l.data ? l.data.split('-').reverse().join('/') : '';
    const catConta = [l.categoria, l.conta].filter(Boolean).join(' · ');
    return {
      tipo: 'lancamento',
      id: l.id,
      label: l.descricao || 'Sem descrição',
      sub: `${catConta} · ${dtFmt}`,
      valor: l.valor,
      tipoLanc: l.tipo,
      icone: l.tipo === 'receita' ? 'arrow-up-right' : l.tipo === 'despesa' ? 'arrow-down-left' : 'arrows-left-right'
    };
  });

  const textoBuscaGeral = tokensTexto.join(' ');
  const cmdsFiltrados = textoBuscaGeral
    ? cmds.filter(c => c.cmd.toLowerCase().includes(textoBuscaGeral) || c.label.toLowerCase().includes(textoBuscaGeral))
    : [];
  const paginasFiltradas = textoBuscaGeral
    ? paginas.filter(p => p.label.toLowerCase().includes(textoBuscaGeral))
    : [];
  const acoesFiltradas = textoBuscaGeral
    ? acoes.filter(a => a.label.toLowerCase().includes(textoBuscaGeral))
    : [];

  const resultados = [
    ...lancsResult,
    ...cmdsFiltrados,
    ...acoesFiltradas,
    ...paginasFiltradas
  ];

  buscaIndiceAtivo = 0;
  renderResultadosBusca(resultados);
}
function renderResultadosBusca(resultados) {
  buscaResultadosAtuais = resultados;
  const cont = document.getElementById('busca-resultados');
  const footerStatus = document.getElementById('spotlight-footer-status');
  if (footerStatus) {
    footerStatus.innerHTML = `<i class="ti ti-sparkles"></i> ${resultados.length} resultado(s)`;
  }
  if (!resultados.length) {
    cont.innerHTML = `
      <div class="empty" style="padding:2.5rem 1rem">
        <i class="ti ti-search-off" style="font-size:32px;opacity:0.35;margin-bottom:8px"></i>
        <p style="font-weight:600;color:var(--text2);margin-bottom:4px">Nenhum resultado encontrado</p>
        <span class="help-text">Tente termos como <code>mês passado</code>, <code>receita</code>, <code>despesa</code> ou <code>&gt;</code> para comandos</span>
      </div>`;
    return;
  }
  cont.innerHTML = resultados.map((r, i) => {
    const isAtivo = i === buscaIndiceAtivo;
    if (r.tipo === 'lancamento') {
      const clsVal = r.tipoLanc === 'receita' ? 'receita' : r.tipoLanc === 'despesa' ? 'despesa' : 'transferencia';
      const sinal = r.tipoLanc === 'receita' ? '+' : r.tipoLanc === 'despesa' ? '-' : '';
      return `<div class="busca-hit${isAtivo ? ' ativo' : ''}" onclick="selecionarResultadoBusca(${i})">
        <i class="ti ti-${r.icone || 'receipt'}"></i>
        <div class="busca-hit-label">
          <div class="busca-hit-title">${escapeHTML(r.label)}</div>
          <div class="busca-hit-sub">${escapeHTML(r.sub)}</div>
        </div>
        <div class="busca-hit-val ${clsVal}">${sinal} ${toBRL(r.valor)}</div>
        <div class="busca-hit-tag">Lançamento</div>
      </div>`;
    }
    const tag = r.tipo === 'comando' ? 'Comando' : r.tipo === 'nav' ? 'Navegação' : 'Ação';
    const icone = r.icone || 'command';
    const label = r.tipo === 'comando'
      ? `<span class="busca-cmd-badge">${r.cmd}</span><span>${escapeHTML(r.label)}</span>`
      : `<span>${escapeHTML(r.label)}</span>`;
    return `<div class="busca-hit${isAtivo ? ' ativo' : ''}" onclick="selecionarResultadoBusca(${i})">
      <i class="ti ti-${icone}"></i>
      <div class="busca-hit-label">
        <div class="busca-hit-title" style="display:flex;align-items:center">${label}</div>
      </div>
      <div class="busca-hit-tag">${tag}</div>
    </div>`;
  }).join('');

  const elAtivo = cont.querySelector('.busca-hit.ativo');
  if (elAtivo) {
    elAtivo.scrollIntoView({ block: 'nearest' });
  }
}
function selecionarResultadoBusca(i) {
  const r = buscaResultadosAtuais[i];
  if (!r) return;
  fecharModal('modal-busca');
  if (r.tipo === 'nav') nav(r.pagina);
  else if (r.tipo === 'acao' || r.tipo === 'comando') r.executar();
  else if (r.tipo === 'lancamento') abrirModalLancamento(r.id);
}
function navegarBusca(event) {
  if (event.key === 'ArrowDown') {
    event.preventDefault();
    buscaIndiceAtivo = Math.min(buscaResultadosAtuais.length - 1, buscaIndiceAtivo + 1);
    renderResultadosBusca(buscaResultadosAtuais);
  } else if (event.key === 'ArrowUp') {
    event.preventDefault();
    buscaIndiceAtivo = Math.max(0, buscaIndiceAtivo - 1);
    renderResultadosBusca(buscaResultadosAtuais);
  } else if (event.key === 'Enter') {
    event.preventDefault();
    selecionarResultadoBusca(buscaIndiceAtivo);
  } else if (event.key === 'Escape') {
    event.preventDefault();
    fecharModal('modal-busca');
  }
}
document.addEventListener('keydown', (e) => {
  if (document.documentElement.classList.contains('bloqueado')) return; // bloqueado: nenhum atalho funciona
  if (e.key === 'Escape') {
    const modalConfirm = document.getElementById('modal-confirmacao');
    if (modalConfirm && modalConfirm.classList.contains('show')) {
      e.preventDefault();
      e.stopPropagation();
      fecharConfirmacao();
      return;
    }
    const modaisVisiveis = Array.from(document.querySelectorAll('.modal-bg.show:not(#modal-confirmacao)'));
    const modalAtivo = modaisVisiveis[modaisVisiveis.length - 1];
    if (modalAtivo) {
      e.preventDefault();
      e.stopPropagation();
      tentarFecharModalPorEsc(modalAtivo);
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
    e.preventDefault();
    const modalBusca = document.getElementById('modal-busca');
    if (modalBusca && modalBusca.classList.contains('show')) {
      fecharModal('modal-busca');
    } else {
      abrirBusca();
    }
    return;
  }
  if (e.altKey && e.key.toLowerCase() === 'p') {
    e.preventDefault();
    alternarModoStealth();
    return;
  }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const elAtivo = document.activeElement;
  if (elAtivo && (/^(INPUT|TEXTAREA|SELECT)$/.test(elAtivo.tagName) || elAtivo.isContentEditable)) return;
  if (document.querySelector('.modal-bg.show')) return;
  const tecla = e.key.toLowerCase();
  if (tecla === 'n') {
    e.preventDefault();
    abrirModalLancamento();
  } else if (tecla === 't') {
    e.preventDefault();
    abrirModalTransferencia();
  } else if (tecla === 'p') {
    e.preventDefault();
    alternarModoStealth();
  }
});

/* ================= BACKUP & SHADOW VAULT (AUTO-BACKUP SILENCIOSO) ================= */
async function selecionarPastaBackup() {
  if (!window.electronAPI || !window.electronAPI.escolherPasta) {
    toast('A seleção de pastas só está disponível no aplicativo Desktop Electron.', 'info');
    return;
  }
  try {
    const caminho = await window.electronAPI.escolherPasta();
    if (caminho) {
      if (!STATE.config) STATE.config = {};
      STATE.config.pastaBackup = caminho;
      await salvarDados();
      atualizarUIBackup();
      toast('Pasta de auto-backup configurada com sucesso!', 'ok');
    }
  } catch (err) {
    console.error('Erro ao escolher pasta de backup:', err);
    toast('Erro ao selecionar a pasta de backup.', 'err');
  }
}

function atualizarUIBackup() {
  const elPasta = document.getElementById('backup-pasta-atual');
  if (elPasta) {
    const pasta = STATE.config?.pastaBackup;
    elPasta.innerHTML = pasta
      ? `<strong>Pasta atual:</strong> <code style="word-break:break-all;color:var(--accent)">${escHtml(pasta)}</code>`
      : `<strong>Pasta atual:</strong> <span class="help-text">Nenhuma pasta selecionada</span>`;
  }
  const elUltimo = document.getElementById('backup-ultimo-status');
  if (elUltimo) {
    const ultimo = STATE.config?.ultimoBackupSilencioso;
    if (ultimo) {
      const dt = new Date(ultimo);
      const dtFmt = isNaN(dt.getTime()) ? ultimo : dt.toLocaleString('pt-BR');
      elUltimo.textContent = `Último auto-backup: ${dtFmt}`;
    } else {
      elUltimo.textContent = 'Último auto-backup: Nenhum registro ainda';
    }
  }
}

async function executarBackupSilencioso(forcar = false) {
  if (!STATE.config || !STATE.config.pastaBackup) {
    if (forcar) toast('Selecione primeiro uma pasta para salvar o backup.', 'err');
    return false;
  }

  // Frequência: no arranque ou fecho corre se tiverem passado mais de 7 dias desde o último
  const SETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;
  const agora = Date.now();
  const ultimo = STATE.config.ultimoBackupSilencioso ? new Date(STATE.config.ultimoBackupSilencioso).getTime() : 0;
  if (!forcar && !isNaN(ultimo) && ultimo > 0 && (agora - ultimo < SETE_DIAS_MS)) {
    return false; // Ainda dentro da janela de 7 dias
  }

  if (!window.electronAPI || !window.electronAPI.salvarBackup) {
    if (forcar) {
      exportarBackup();
      toast('Backup exportado para download.', 'ok');
    }
    return false;
  }

  const caminhoDestino = STATE.config.pastaBackup;
  try {
    const hoje = new Date();
    const ano = hoje.getFullYear();
    const mes = String(hoje.getMonth() + 1).padStart(2, '0');
    const dia = String(hoje.getDate()).padStart(2, '0');
    const nomeArquivo = `cofin_backup_${ano}${mes}${dia}.json`;

    const dadosJson = JSON.stringify(STATE, null, 2);
    const res = await window.electronAPI.salvarBackup(dadosJson, caminhoDestino, nomeArquivo);

    if (res && res.ok) {
      STATE.config.ultimoBackupSilencioso = new Date().toISOString();
      await salvarDados();
      atualizarUIBackup();
      if (forcar) {
        toast(`Backup salvo com sucesso em ${res.arquivo || nomeArquivo}!`, 'ok');
      } else {
        console.log('[Shadow Vault] Auto-backup silencioso executado com sucesso:', res.caminho);
      }
      return true;
    } else {
      const erro = res?.erro || 'Falha ao gravar arquivo no disco';
      console.warn('[Shadow Vault] Erro no auto-backup:', erro);
      if (forcar) toast(`Erro ao salvar backup: ${erro}`, 'err');
      return false;
    }
  } catch (err) {
    console.error('[Shadow Vault] Exceção durante auto-backup:', err);
    if (forcar) toast('Erro ao executar auto-backup silencioso.', 'err');
    return false;
  }
}

async function restaurarBackup() {
  if (window.electronAPI && typeof window.electronAPI.selecionarArquivoBackup === 'function') {
    try {
      const res = await window.electronAPI.selecionarArquivoBackup();
      if (res && res.cancelado) return;
      if (res && res.ok && res.conteudo) {
        await processarRestauracaoBackup(res.conteudo);
        return;
      }
      if (res && !res.ok) {
        toast(`Erro ao abrir backup: ${res.erro || ''}`, 'err');
        return;
      }
    } catch (e) {
      console.warn('Falha no seletor nativo, alternando para o input HTML:', e);
    }
  }

  const inp = document.getElementById('backup-file-input');
  if (inp) inp.click();
}

async function processarRestauracaoBackup(textoJson) {
  try {
    if (!textoJson || typeof textoJson !== 'string') {
      throw new Error('Arquivo vazio ou ilegível.');
    }
    const dados = JSON.parse(textoJson);
    if (!dados || typeof dados !== 'object') {
      throw new Error('Conteúdo não é um objeto JSON válido.');
    }

    // Validação de estrutura mínima do COFIN
    const temEstruturaValida = Array.isArray(dados.lancamentos) ||
      Array.isArray(dados.categorias) ||
      Array.isArray(dados.contas) ||
      (dados.config && typeof dados.config === 'object');

    if (!temEstruturaValida) {
      throw new Error('O arquivo não contém a estrutura de dados esperada do COFIN.');
    }

    const qtdLancs = Array.isArray(dados.lancamentos) ? dados.lancamentos.length : 0;
    abrirConfirmacao(
      `Deseja realmente restaurar este backup? Os dados atuais serão substituídos pelos do arquivo (${qtdLancs} lançamentos). Esta ação não pode ser desfeita.`,
      async () => {
        try {
          const pastaBackupAtual = STATE.config?.pastaBackup;
          STATE = Object.assign(STATE, dados);
          if (!Array.isArray(STATE.receitasFixas)) STATE.receitasFixas = [];
          normalizarRegrasCategoria();
          if (pastaBackupAtual && !STATE.config.pastaBackup) {
            STATE.config.pastaBackup = pastaBackupAtual;
          }
          try {
            if (typeof msLer === 'function' && msLer().ultimoETag) {
              msAtualizar({ ultimoETag: null });
            }
          } catch (e) {}
          await salvarDados();
          renderDashboard();
          renderLancamentos();
          renderConfig();
          atualizarUIBackup();
          toast('Backup restaurado com sucesso!', 'ok');
        } catch (errRestauro) {
          console.error('Erro ao aplicar dados de restauração:', errRestauro);
          toast('Erro ao aplicar os dados do backup.', 'err');
        }
      }
    );
  } catch (errValidacao) {
    console.error('Validação do backup falhou:', errValidacao);
    toast(`Arquivo de backup inválido: ${errValidacao.message || 'Estrutura incorreta'}`, 'err');
  }
}

async function importarBackup(file) {
  if (!file) return;
  try {
    const texto = await file.text();
    await processarRestauracaoBackup(texto);
  } catch (e) {
    toast('Falha ao ler arquivo de backup.', 'err');
  }
}

function exportarBackup() {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'controle-financeiro-backup-' + hojeLocalISO() + '.json';
  a.click();
  setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) {} }, 1000);
}
function apagarTudo() {
  const total = STATE.lancamentos.length;
  if (!total) { toast('Não há lançamentos para apagar.', 'err'); return; }
  abrirConfirmacao(`Isso apaga os ${total} lançamentos deste aparelho e, pela sincronização automática, também os da planilha do OneDrive. Categorias, contas, assinaturas, metas, dívidas e regras são mantidas. Dá pra recuperar tudo pela Lixeira por ${LIXEIRA_DIAS} dias. Continuar?`, async () => {
    const itens = STATE.lancamentos;
    STATE.lancamentos = [];
    STATE.config.lastSync = null;
    const entradaId = registrarExclusao(itens, `Todos os lançamentos (${total})`);
    await salvarDados();
    renderDashboard(); renderLancamentos(); renderConfig(); atualizarContagemLixeira();
    sincronizarEmSegundoPlano();
    toastDesfazer(`${total} lançamentos apagados.`, entradaId);
  }, 'Apagar todos os lançamentos');
}

/* ================= SINCRONIZAÇÃO ONEDRIVE ================= */
function comCacheBuster(link) {
  const sep = link.includes('?') ? '&' : '?';
  return link + sep + '_cb=' + Date.now();
}
function converterParaLinkDireto(link) {
  // Truque conhecido da API do OneDrive: o link de compartilhamento, codificado em base64 "url-safe"
  // e prefixado com "u!", vira um endereço que devolve o arquivo puro — sem a página intermediária
  // de verificação que os links curtos (1drv.ms) costumam mostrar pra quem não é um navegador comum.
  try {
    const base = link.split('?')[0];
    const b64 = btoa(unescape(encodeURIComponent(base))).replace(/=+$/, '').replace(/\//g, '_').replace(/\+/g, '-');
    return 'https://api.onedrive.com/v1.0/shares/u!' + b64 + '/root/content';
  } catch (e) { return null; }
}
function pareceArquivoExcel(buf) {
  const b = new Uint8Array(buf.slice(0, 4));
  const zip = b[0] === 0x50 && b[1] === 0x4B;                                    // .xlsx é um ZIP ("PK")
  const ole = b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0;  // .xls antigo
  return zip || ole;
}
function trechoDoConteudo(buf) {
  try { return new TextDecoder().decode(buf.slice(0, 90)).replace(/\s+/g, ' ').trim(); } catch (e) { return ''; }
}
async function tentarBuscarOneDrive(link) {
  const original = comCacheBuster(link);
  const api = converterParaLinkDireto(link);
  const usaProxyElectron = !!(ehElectron() && window.electronAPI && typeof window.electronAPI.fetchOneDrive === 'function');
  const candidatos = (usaProxyElectron ? [original, api] : [api, original]).filter(Boolean);
  const metodos = usaProxyElectron
    ? [{ nome: 'proxy IPC seguro (Electron)', montar: u => u, viaElectronIpc: true }]
    : [
        { nome: 'direto', montar: u => u },
        { nome: 'proxy próprio (Netlify)', montar: u => '/.netlify/functions/onedrive-proxy?url=' + encodeURIComponent(u) },
        { nome: 'corsproxy.io', montar: u => 'https://corsproxy.io/?' + encodeURIComponent(u) },
        { nome: 'allorigins.win', montar: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) }
      ];
  const estrategias = [];
  metodos.forEach(m => candidatos.forEach(u => estrategias.push({
    nome: m.nome + (u === api ? ' · link da API' : ' · link original'),
    url: m.montar(u),
    viaElectronIpc: !!m.viaElectronIpc
  })));

  const log = [];
  let falhou = true;
  let ultimoErro = null;
  let erroConteudoErrado = null; // recebeu algo, mas não era planilha — é o erro mais informativo
  try {
    for (let i = 0; i < estrategias.length; i++) {
      const estrategia = estrategias[i];
      const rotulo = `[${i + 1}/${estrategias.length}] ${estrategia.nome}`;
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 15000) : null;
      try {
        let buf;
        if (estrategia.viaElectronIpc) {
          const rIpc = await window.electronAPI.fetchOneDrive(estrategia.url);
          if (!rIpc || !rIpc.ok) {
            const det = (rIpc && rIpc.erro) ? ` — ${rIpc.erro}` : '';
            const statusStr = rIpc && rIpc.status ? `HTTP ${rIpc.status}` : 'Falha IPC';
            ultimoErro = new Error(`[${estrategia.nome}] ${statusStr}${det}`);
            log.push(`${rotulo} → ${statusStr}${det}`);
            console.warn('Sincronização OneDrive — tentativa falhou:', ultimoErro.message);
            continue;
          }
          const bin = atob(rIpc.dataBase64 || '');
          const bytes = new Uint8Array(bin.length);
          for (let k = 0; k < bin.length; k++) bytes[k] = bin.charCodeAt(k);
          buf = bytes.buffer;
        } else {
          const resp = await fetch(estrategia.url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
          if (!resp.ok) {
            let detalhe = '';
            try { detalhe = (await resp.text()).replace(/\s+/g, ' ').slice(0, 160); } catch (e2) { /* corpo não textual, ignora */ }
            ultimoErro = new Error(`[${estrategia.nome}] HTTP ${resp.status}${detalhe ? ' — ' + detalhe : ''}`);
            log.push(`${rotulo} → HTTP ${resp.status}${detalhe ? ' — ' + detalhe : ''}`);
            console.warn('Sincronização OneDrive — tentativa falhou:', ultimoErro.message);
            continue;
          }
          buf = await resp.arrayBuffer();
        }
        if (!pareceArquivoExcel(buf)) {
          const trecho = trechoDoConteudo(buf);
          ultimoErro = new Error(`[${estrategia.nome}] recebi ${buf.byteLength} bytes, mas não é uma planilha${trecho ? ' (começa com: "' + trecho + '")' : ''}`);
          erroConteudoErrado = ultimoErro;
          log.push(`${rotulo} → recebi ${buf.byteLength} bytes que NÃO são planilha${trecho ? ': "' + trecho + '"' : ''}`);
          console.warn('Sincronização OneDrive — tentativa falhou:', ultimoErro.message);
          continue;
        }
        log.push(`${rotulo} → OK (${buf.byteLength} bytes)`);
        falhou = false;
        return buf;
      } catch (e) {
        const motivo = e && e.name === 'AbortError' ? 'demorou mais de 15s (cancelado)' : (e && e.message ? e.message : String(e));
        ultimoErro = new Error(`[${estrategia.nome}] ${motivo}`);
        log.push(`${rotulo} → falhou: ${motivo}`);
        console.warn('Sincronização OneDrive — tentativa falhou:', ultimoErro.message);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }
    throw erroConteudoErrado || ultimoErro || new Error('falha desconhecida');
  } finally {
    registrarDiagnosticoSync(log, falhou);
  }
}
function registrarDiagnosticoSync(linhas, falhou) {
  const el = document.getElementById('sync-diagnostico');
  if (!el) return;
  el.textContent = 'Última busca no OneDrive (' + new Date().toLocaleTimeString('pt-BR') + ') · versão ' + APP_VERSAO + '\n' + linhas.join('\n');
  el.style.display = '';
  if (falhou && typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

/* ================= DIAGNÓSTICO / INSTALAÇÃO DO APP (PWA) ================= */
let pwaPromptEvento = null;
window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  pwaPromptEvento = e;
  const b = document.getElementById('btn-instalar-app');
  if (b) b.style.display = '';
});
async function instalarApp() {
  if (!pwaPromptEvento) { toast('O Chrome ainda não liberou a instalação. Use "Verificar instalação (PWA)" pra ver o motivo.', 'err'); return; }
  pwaPromptEvento.prompt();
  try { await pwaPromptEvento.userChoice; } catch (e) { /* usuário cancelou */ }
  pwaPromptEvento = null;
  const b = document.getElementById('btn-instalar-app');
  if (b) b.style.display = 'none';
}
async function diagnosticarPWA() {
  const L = [];
  const ok = (t) => L.push('✔ ' + t), no = (t) => L.push('✘ ' + t), info = (t) => L.push('• ' + t);
  info('Versão do app: ' + APP_VERSAO);
  info('Endereço: ' + location.href);
  if (location.protocol === 'https:') ok('Conexão segura (https)'); else no('Não está em https — instalação e service worker não funcionam assim');
  const linkManifest = document.querySelector('link[rel="manifest"]');
  if (linkManifest) ok('Tag do manifest presente no HTML: ' + linkManifest.getAttribute('href')); else no('Tag <link rel="manifest"> não encontrada no HTML');
  try {
    const r = await fetch(linkManifest ? linkManifest.href : 'manifest.json', { cache: 'no-store' });
    if (!r.ok) {
      no('manifest.json respondeu HTTP ' + r.status + ' (o arquivo não está publicado no site?)');
    } else {
      ok('manifest.json encontrado (HTTP ' + r.status + ', ' + (r.headers && r.headers.get('content-type') || 'sem content-type') + ')');
      const m = await r.json();
      info('Nome: ' + (m.name || m.short_name || '(vazio)') + ' · display: ' + m.display + ' · start_url: ' + m.start_url);
      const icones = m.icons || [];
      if (!icones.length) no('O manifest não tem ícones');
      for (const ic of icones) {
        try {
          const ri = await fetch(new URL(ic.src, r.url || location.href).href, { cache: 'no-store' });
          if (ri.ok) ok('Ícone ' + ic.sizes + ' encontrado'); else no('Ícone ' + ic.sizes + ' → HTTP ' + ri.status + ' (' + ic.src + ' não está publicado?)');
        } catch (e) { no('Ícone ' + ic.sizes + ' falhou: ' + e.message); }
      }
    }
  } catch (e) { no('Não consegui ler o manifest: ' + e.message + ' (JSON inválido?)'); }
  if ('serviceWorker' in navigator) {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        no('Service worker NÃO está registrado');
      } else {
        const est = reg.active ? 'ativo' : reg.waiting ? 'aguardando' : reg.installing ? 'instalando' : 'estado desconhecido';
        if (reg.active) ok('Service worker ' + est + ' (escopo ' + reg.scope + ')'); else no('Service worker ' + est + ' (escopo ' + reg.scope + ')');
      }
      info(navigator.serviceWorker.controller ? 'Esta página está sob controle do service worker' : 'Esta página ainda não é controlada pelo service worker (recarregue uma vez)');
    } catch (e) { no('Erro ao consultar o service worker: ' + e.message); }
  } else {
    no('Este navegador não tem suporte a service worker');
  }
  const standalone = (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone;
  info(standalone ? 'Rodando como app instalado' : 'Rodando dentro do navegador');
  info(pwaPromptEvento ? 'O Chrome liberou a instalação (aparece o botão "Instalar app")' : 'O Chrome ainda não liberou a instalação (evento beforeinstallprompt não disparou)');
  try {
    const rf = await fetch('/.netlify/functions/onedrive-proxy?diag=1', { cache: 'no-store' });
    const txt = (await rf.text()).replace(/\s+/g, ' ').slice(0, 160);
    if (rf.ok) ok('Function do proxy no ar: ' + txt); else no('Function do proxy respondeu HTTP ' + rf.status + ': ' + txt);
  } catch (e) { info('Function do proxy indisponível aqui (' + e.message + ')'); }
  const el = document.getElementById('pwa-diagnostico');
  el.textContent = L.join('\n');
  el.style.display = '';
  if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  return L;
}
function forcarAtualizacaoApp() {
  abrirConfirmacao('Vou limpar o cache do app e recarregar. Seus lançamentos NÃO são apagados. Continuar?', async () => {
    try {
      if ('serviceWorker' in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map(r => r.unregister()));
      }
      if (window.caches) {
        const chaves = await caches.keys();
        await Promise.all(chaves.map(k => caches.delete(k)));
      }
    } catch (e) { console.error(e); }
    location.reload();
  }, 'Atualizar aplicativo');
}
async function sincronizarOneDrive() {
  const link = document.getElementById('sync-link').value.trim();
  if (!link) { toast('Informe o link da planilha.', 'err'); return; }

  const btn = document.getElementById('btn-sync');
  btn.innerHTML = '<span class="spinner"></span> Buscando...';
  btn.disabled = true;

  try {
    const buf = await tentarBuscarOneDrive(link);
    try {
      processarPlanilha(buf);
    } catch (eParse) {
      console.error(eParse);
      filaDeMesclagem = false;
      const motivo = eParse && eParse.message === 'A planilha não tem linhas de dados.'
        ? eParse.message
        : 'Baixei um arquivo do OneDrive, mas ele não é uma planilha válida — o link pode ter expirado ou a Microsoft devolveu uma página de verificação em vez do arquivo. Tente de novo em alguns segundos ou use "Selecionar arquivo manualmente".';
      toast(motivo, 'err');
    }
  } catch (e) {
    console.error(e);
    filaDeMesclagem = false;
    toast('Erro ao buscar a planilha no OneDrive: ' + (e && e.message ? e.message : 'falha na conexão') + '. Veja o "Diagnóstico" mais abaixo nesta tela (e me mande um print) ou use "Selecionar arquivo manualmente".', 'err');
  } finally {
    btn.innerHTML = '<i class="ti ti-refresh"></i> Buscar planilha agora';
    btn.disabled = false;
  }
}

async function importarArquivoLocal(file) {
  if (!file) return;
  const buf = await file.arrayBuffer();
  try {
    processarPlanilha(buf);
  } catch (e) {
    console.error(e);
    filaDeMesclagem = false;
    toast(e && e.message ? e.message : 'Não consegui ler esse arquivo como planilha.', 'err');
  }
}
function processarPlanilha(buf) {
  const wb = XLSX.read(buf, { type: 'array' });
  const nomeAba = wb.SheetNames[0];
  const sheet = wb.Sheets[nomeAba];
  const linhas = XLSX.utils.sheet_to_json(sheet, { defval: '', raw: false });
  if (!linhas.length) { throw new Error('A planilha não tem linhas de dados.'); }
  importRowsRaw = linhas;
  importHeaders = Object.keys(linhas[0]);
  abrirModalImportacao();
}
function adivinharColuna(aliases) {
  const achada = importHeaders.find(h => aliases.some(a => h.toLowerCase().includes(a)));
  return achada || '';
}
function abrirModalImportacao() {
  const campos = [
    { id:'map-data', label:'Data', aliases:['data','date'] },
    { id:'map-descricao', label:'Descrição', aliases:['descri','historic','memo','lancamento','item'] },
    { id:'map-categoria', label:'Categoria (opcional)', aliases:['categ'] },
    { id:'map-tipo', label:'Tipo receita/despesa (opcional)', aliases:['tipo','type'] },
    { id:'map-valor', label:'Valor', aliases:['valor','value','amount','total'] },
    { id:'map-conta', label:'Conta (opcional)', aliases:['conta','account','banco','cart'] },
    { id:'map-status', label:'Status pago/pendente (opcional)', aliases:['status','pago','situa'] }
  ];
  document.getElementById('import-mapping').innerHTML = campos.map(c => {
    const guess = adivinharColuna(c.aliases);
    const opts = ['<option value="">-- nenhum --</option>'].concat(importHeaders.map(h => `<option value="${h}" ${h===guess?'selected':''}>${h}</option>`));
    return `<div class="fg"><label>${c.label}</label><select id="${c.id}">${opts.join('')}</select></div>`;
  }).join('');
  const preview = importRowsRaw.slice(0,5);
  document.getElementById('import-preview').querySelector('thead').innerHTML =
    '<tr>' + importHeaders.map(h => `<th>${h}</th>`).join('') + '</tr>';
  document.getElementById('import-preview').querySelector('tbody').innerHTML =
    preview.map(r => '<tr>' + importHeaders.map(h => `<td>${r[h]}</td>`).join('') + '</tr>').join('');
  abrirModal('modal-import');
}
function excelDataParaISO(v) {
  if (v === null || v === undefined || v === '') return '';
  const iso = extrairDataLocalISO(v, {
    retornarVazioSeInvalido: true,
    aceitarSerialExcel: true,
    silencioso: true
  });
  if (!iso) {
    const s = String(v).trim();
    if (s && !/^(data|date)$/i.test(s) && typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn('[COFIN][Data][Planilha] Data não reconhecida na importação de planilha:', v);
    }
  }
  return iso;
}
// Lógica de mesclagem compartilhada entre a importação manual (com mapeamento de colunas no modal)
// e a sincronização automática silenciosa (que já sabe os nomes das colunas, porque foi o próprio
// app que as exportou). "modoSincronizacaoTotal": mantém só o que ainda não tinha ido pra nuvem —
// o resto vem inteiro da planilha. Senão, mantém tudo que já existe e só soma o que é novo.
function mesclarLinhasNaBase(linhas, mapa, modoSincronizacaoTotal) {
  const baseAnterior = modoSincronizacaoTotal
    ? STATE.lancamentos.filter(l => l.sincronizado !== true)
    : STATE.lancamentos.slice();

  // Itens já existentes no app são indexados para carregar junto tudo que só existe localmente
  // (garantias, anexos, comprovantes, transferências) para nunca sumirem na sincronização ou reload (Ctrl+R).
  const locaisExistentes = new Map();
  STATE.lancamentos.forEach(l => { if (l && l.id) locaisExistentes.set(l.id, l); });
  const locaisPorChave = new Map();
  STATE.lancamentos.forEach(l => {
    if (!l || !l.data) return;
    if (l.descricao) locaisPorChave.set(`${l.data}|${l.descricao}|${Math.abs(l.valor)}`, l);
    if (l.descricaoOriginal) locaisPorChave.set(`${l.data}|${l.descricaoOriginal}|${Math.abs(l.valor)}`, l);
  });

  const idsExistentes = new Set(baseAnterior.map(l => l.id));
  const apagadosAqui = new Set(STATE.excluidosPendentes || []);
  const chavesExistentes = new Set();
  baseAnterior.forEach(l => {
    if (!l) return;
    chavesExistentes.add(`${l.data}|${l.descricao}|${l.valor}`);
    if (l.descricaoOriginal) chavesExistentes.add(`${l.data}|${l.descricaoOriginal}|${l.valor}`);
  });
  const indiceMemoriaPlanilha = typeof construirIndiceMemoriaHistorica === 'function'
    ? construirIndiceMemoriaHistorica(STATE.lancamentos)
    : null;
  const novosDaPlanilha = [];
  let novos = 0, ignorados = 0;

  linhas.forEach(row => {
    const data = excelDataParaISO(row[mapa.data]);
    const descricao = String(row[mapa.descricao] || '').trim();
    let valorNum = moedaToNumber(row[mapa.valor]);
    if (!data || !descricao || !valorNum) { ignorados++; return; }
    let tipo;
    if (mapa.tipo && row[mapa.tipo]) {
      const t = String(row[mapa.tipo]).toLowerCase();
      tipo = t.includes('desp') || t.includes('exp') || t.includes('saída') || t.includes('saida') ? 'despesa' : 'receita';
    } else {
      tipo = valorNum < 0 ? 'despesa' : 'receita';
    }
    valorNum = Math.abs(valorNum);

    // Colunas técnicas (ID, parcelas, recorrência) — só existem quando a planilha é a que o próprio
    // app exportou. Se não existirem, tudo cai de volta no comportamento normal (sem quebrar nada).
    const idPlanilha = row['ID'] ? String(row['ID']).trim() : '';
    const chave = `${data}|${descricao}|${valorNum}`;
    if (idPlanilha && apagadosAqui.has(idPlanilha)) { ignorados++; return; } // apagado aqui e a planilha ainda não soube
    if (idPlanilha && idsExistentes.has(idPlanilha)) { ignorados++; return; }
    if (!idPlanilha && chavesExistentes.has(chave)) { ignorados++; return; }
    if (idPlanilha) idsExistentes.add(idPlanilha); else chavesExistentes.add(chave);

    let pago = true;
    const statusRawPlanilha = (mapa.status && row[mapa.status]) ? String(row[mapa.status]).trim() : '';
    const statusLower = statusRawPlanilha.toLowerCase();
    if (statusRawPlanilha) pago = !statusLower.includes('pend');

    const lerCampoRow = (nomes) => {
      for (const n of nomes) {
        if (row[n] !== undefined && String(row[n]).trim() !== '') return String(row[n]).trim();
        const k = Object.keys(row).find(key => key.trim().toLowerCase() === n.toLowerCase());
        if (k && row[k] !== undefined && String(row[k]).trim() !== '') return String(row[k]).trim();
      }
      return '';
    };

    const antigo = (idPlanilha ? locaisExistentes.get(idPlanilha) : null) || locaisPorChave.get(chave);
    const grupoTransf = lerCampoRow(['TransferenciaGrupo']) || (antigo && antigo.transferenciaGrupo) || '';

    const catBrutaPlanilha = (mapa.categoria && row[mapa.categoria]) ? String(row[mapa.categoria]).trim() : ((antigo && antigo.categoria) || '');
    const contaFinal = (mapa.conta && row[mapa.conta]) ? String(row[mapa.conta]).trim() : ((antigo && antigo.conta) || '');
    let categoriaFinal = catBrutaPlanilha;
    let descricaoFinalPlanilha = (antigo && antigo.descricao) || descricao;
    let descricaoOriginalPlanilha = (antigo && antigo.descricaoOriginal) || undefined;
    let tagAutoPlanilha = '';
    const ehTransfOuPagPlanilha = Boolean(grupoTransf) || ehLancamentoPagamentoFatura({ descricao, categoria: catBrutaPlanilha }) || isLancamentoTransferencia({ descricao, categoria: catBrutaPlanilha, ehTransferencia: antigo && antigo.ehTransferencia });
    if (!ehTransfOuPagPlanilha && (!categoriaFinal || ehCategoriaGenericaOuPendente(categoriaFinal)) && typeof autoClassificarLancamento === 'function') {
      const resAutoPlan = autoClassificarLancamento(
        { tipo, data, descricao, descricaoOriginal: descricaoOriginalPlanilha || descricao, conta: contaFinal, valor: valorNum },
        { indiceMemoria: indiceMemoriaPlanilha }
      );
      if (resAutoPlan) {
        categoriaFinal = resAutoPlan.categoriaCompleta || CATEGORIA_A_CLASSIFICAR;
        if (resAutoPlan.tag) tagAutoPlanilha = resAutoPlan.tag;
        if (resAutoPlan.apelidoDescricao) {
          descricaoOriginalPlanilha = descricaoOriginalPlanilha || descricao;
          descricaoFinalPlanilha = resAutoPlan.apelidoDescricao;
        }
        if (resAutoPlan.regraId) {
          const rMatch = (STATE.regrasCategoria || []).find(r => r && r.id === resAutoPlan.regraId);
          if (rMatch) rMatch.usos = (parseInt(rMatch.usos, 10) || 0) + 1;
        }
      }
    }
    if (!categoriaFinal) categoriaFinal = CATEGORIA_A_CLASSIFICAR;

    const rawFaturaPaga = lerCampoRow(['FaturaPaga', 'Fatura Paga', 'faturaPaga']).toLowerCase();
    const rawEhPagFatura = lerCampoRow(['EhPagamentoFatura', 'Eh Pagamento Fatura', 'ehPagamentoFatura']).toLowerCase();
    const faturaCompetencia = lerCampoRow(['FaturaCompetencia', 'Fatura Competencia', 'faturaCompetencia']) || (antigo && antigo.faturaCompetencia) || undefined;

    const ehPagFaturaDetectado =
      rawEhPagFatura === 'sim' || rawEhPagFatura === 'true' || rawEhPagFatura === '1' ||
      !!(antigo && antigo.ehPagamentoFatura === true) ||
      ehLancamentoPagamentoFatura({ descricao, categoria: categoriaFinal });

    const faturaPagaDetectada = !ehPagFaturaDetectado && (
      rawFaturaPaga === 'sim' || rawFaturaPaga === 'true' || rawFaturaPaga === '1' ||
      !!(antigo && antigo.faturaPaga === true)
    );

    const statusFinal = faturaPagaDetectada
      ? 'Liquidado'
      : (ehPagFaturaDetectado
        ? 'Pago/Efetivado'
        : (statusRawPlanilha || (antigo && antigo.status) || undefined));

    // GARANTIA & ANEXOS:
    // Prioriza o que está na planilha; se a planilha ainda não tiver as colunas (versão anterior),
    // preserva obrigatoriamente os dados locais de "antigo" para NUNCA perder garantias ou anexos!
    const rawGarFim = lerCampoRow(['GarantiaFim', 'Garantia Fim', 'Garantia_Fim', 'garantiaFim']);
    const garFimPlanilha = rawGarFim ? (excelDataParaISO(rawGarFim) || rawGarFim) : '';
    const garantiaFim = garFimPlanilha || (antigo && antigo.garantiaFim) || undefined;

    const rawGarMeses = parseInt(lerCampoRow(['GarantiaMeses', 'Garantia Meses', 'Garantia_Meses', 'garantiaMeses']), 10);
    const garantiaMeses = (!isNaN(rawGarMeses) && rawGarMeses > 0 ? rawGarMeses : undefined) || (antigo && antigo.garantiaMeses) || undefined;

    const anexoNome = lerCampoRow(['AnexoNome', 'Anexo Nome', 'anexoNome']) || (antigo && antigo.anexoNome) || undefined;
    const anexoPath = lerCampoRow(['AnexoPath', 'Anexo Path', 'anexoPath']) || (antigo && antigo.anexoPath) || undefined;
    const comprovante = (antigo && antigo.comprovante) || undefined;

    const rawReembolsavel = lerCampoRow(['EhReembolsavel', 'Eh Reembolsavel', 'ehReembolsavel']);
    const ehReembolsavel = (rawReembolsavel.toLowerCase() === 'sim' || rawReembolsavel === 'true' || rawReembolsavel === '1') ? true : ((antigo && antigo.ehReembolsavel) || undefined);
    const devedorPlanilha = lerCampoRow(['ReembolsoDevedor', 'Reembolso Devedor', 'reembolsoDevedor']);
    const reembolsoDevedor = devedorPlanilha || (antigo && antigo.reembolsoDevedor) || undefined;
    const rawReembolsado = lerCampoRow(['Reembolsado', 'reembolsado']);
    const reembolsado = (rawReembolsado.toLowerCase() === 'sim' || rawReembolsado === 'true' || rawReembolsado === '1') ? true : ((antigo && antigo.reembolsado) || undefined);
    const rawConciliado = lerCampoRow(['Conciliado', 'conciliado']);
    const conciliado = (rawConciliado.toLowerCase() === 'sim' || rawConciliado === 'true' || rawConciliado === '1') ? true : !!(antigo && antigo.conciliado === true);

    const ehDespesaCartaoLinha = !ehPagFaturaDetectado && tipo === 'despesa' && ehContaCartaoConcil(contaFinal);
    const pagoFinalLinha = ehDespesaCartaoLinha
      ? (faturaPagaDetectada === true)
      : ((faturaPagaDetectada || ehPagFaturaDetectado) ? true : pago);

    const tagsPlanilhaBase = lerCampoRow(['Tags']) ? parseTags(lerCampoRow(['Tags'])) : ((antigo && Array.isArray(antigo.tags)) ? [...antigo.tags] : []);
    if (tagAutoPlanilha && !tagsPlanilhaBase.some(t => String(t).toLowerCase() === tagAutoPlanilha.toLowerCase())) {
      tagsPlanilhaBase.push(tagAutoPlanilha);
    }
    novosDaPlanilha.push({
      id: idPlanilha || uid(), tipo, data,
      descricao: descricaoFinalPlanilha,
      descricaoOriginal: descricaoOriginalPlanilha,
      categoria: categoriaFinal,
      conta: contaFinal,
      valor: valorNum, origem: 'onedrive',
      sincronizado: !(grupoTransf && !row['TransferenciaGrupo']), // a planilha ainda não sabe que é transferência: reenvia pra ela aprender
      pago: pagoFinalLinha,
      faturaPaga: faturaPagaDetectada ? true : undefined,
      status: statusFinal,
      ehPagamentoFatura: ehPagFaturaDetectado ? true : undefined,
      ehTransferencia: (grupoTransf || ehPagFaturaDetectado || (antigo && antigo.ehTransferencia)) ? true : undefined,
      transferenciaGrupo: grupoTransf || undefined,
      transferenciaContraparte: lerCampoRow(['TransferenciaContraparte']) || (antigo && antigo.transferenciaContraparte) || undefined,
      cartaoId: (antigo && antigo.cartaoId) || undefined,
      cartaoNome: (antigo && antigo.cartaoNome) || undefined,
      faturaAno: (antigo && antigo.faturaAno) || undefined,
      faturaMes: (antigo && antigo.faturaMes) || undefined,
      faturaCompetencia,
      dataCompra: (antigo && antigo.dataCompra) || (ehDespesaCartaoLinha ? data : undefined),
      dataVencimentoFatura: (antigo && antigo.dataVencimentoFatura) || undefined,
      dataPagamentoFatura: (antigo && antigo.dataPagamentoFatura) || undefined,
      contaPagamentoFatura: (antigo && antigo.contaPagamentoFatura) || undefined,
      pagamentoFaturaId: (antigo && antigo.pagamentoFaturaId) || undefined,
      comprovante,
      parcelaGrupo: lerCampoRow(['ParcelaGrupo']) || (antigo && antigo.parcelaGrupo) || undefined,
      parcelaAtual: lerCampoRow(['ParcelaAtual']) ? parseInt(lerCampoRow(['ParcelaAtual']), 10) : ((antigo && antigo.parcelaAtual) || undefined),
      parcelaTotal: lerCampoRow(['ParcelaTotal']) ? parseInt(lerCampoRow(['ParcelaTotal']), 10) : ((antigo && antigo.parcelaTotal) || undefined),
      recorrenteId: lerCampoRow(['RecorrenteID']) || (antigo && antigo.recorrenteId) || undefined,
      tags: tagsPlanilhaBase.length ? tagsPlanilhaBase : undefined,
      garantiaFim,
      garantiaMeses,
      anexoNome,
      anexoPath,
      ehReembolsavel,
      reembolsoDevedor,
      reembolsado,
      conciliado
    });
    novos++;
  });

  STATE.lancamentos = modoSincronizacaoTotal
    ? [...novosDaPlanilha, ...baseAnterior]
    : [...STATE.lancamentos, ...novosDaPlanilha];

  corrigirFaturasPresas();
  recalcularLimitesCartoes();

  return { novos, ignorados, baseAnterior };
}
async function confirmarImportacao() {
  const mapa = {
    data: document.getElementById('map-data').value,
    descricao: document.getElementById('map-descricao').value,
    categoria: document.getElementById('map-categoria').value,
    tipo: document.getElementById('map-tipo').value,
    valor: document.getElementById('map-valor').value,
    conta: document.getElementById('map-conta').value,
    status: document.getElementById('map-status').value
  };
  if (!mapa.data || !mapa.descricao || !mapa.valor) { toast('Selecione ao menos as colunas de Data, Descrição e Valor.', 'err'); return; }

  const modoSincronizacaoTotal = filaDeMesclagem;
  const { novos, ignorados, baseAnterior } = mesclarLinhasNaBase(importRowsRaw, mapa, modoSincronizacaoTotal);

  filaDeMesclagem = false;
  STATE.config.lastSync = new Date().toISOString();
  await salvarDados();
  fecharModal('modal-import');
  renderDashboard(); renderLancamentos();
  atualizarStatusSync();
  if (modoSincronizacaoTotal) {
    toast(`Mesclado: ${novos} vindos da planilha + ${baseAnterior.length} mantidos localmente. Subindo o resultado pro OneDrive...`, 'ok');
    await salvarNaNuvemWebhook();
  } else {
    toast(`Importação concluída: ${novos} lançamentos novos, ${ignorados} ignorados (já existiam ou incompletos).`, 'ok');
  }
}
function cancelarImportacao() {
  filaDeMesclagem = false;
  fecharModal('modal-import');
}
function atualizarStatusSync() {
  const el = document.getElementById('sync-last');
  if (STATE.config.lastSync) {
    const d = new Date(STATE.config.lastSync);
    el.textContent = 'Última sincronização: ' + d.toLocaleString('pt-BR');
  } else {
    el.textContent = 'Nenhuma sincronização realizada ainda.';
  }
}

/* ================= ASSISTENTE DE FECHAMENTO MENSAL GUIADO (WIZARD DE FIM DE MÊS) ================= */
let wizardStepAtual = 1;
let wizardMesAlvo = ''; // formato 'AAAA-MM' do mês que encerrou

function obterMesAnteriorISO(mesBaseISO) {
  const base = mesBaseISO || hojeLocalISO().slice(0, 7);
  const [ano, mes] = base.split('-').map(Number);
  const dt = new Date(ano, mes - 2, 1);
  return dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0');
}

function formatarMesExtenso(mesKey) {
  if (!mesKey || !mesKey.includes('-')) return mesKey || '-';
  const [ano, mes] = mesKey.split('-').map(Number);
  const nomes = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
  return `${nomes[(mes - 1)] || mes}/${ano}`;
}

function obterPendenciasMesWizard(mesKey) {
  return (STATE.lancamentos || []).filter(l =>
    !isLancamentoTransferencia(l) &&
    !estaPago(l) &&
    mesCompetenciaLancamento(l) === mesKey
  ).sort((a, b) => (a.data || '').localeCompare(b.data || ''));
}

function calcularBalancoRealMesWizard(mesKey) {
  let receitasEfetivadas = 0;
  let despesasEfetivadas = 0;
  (STATE.lancamentos || []).forEach(l => {
    if (isLancamentoTransferencia(l) || l.ehMovimentoCofre) return;
    if (mesCompetenciaLancamento(l) !== mesKey) return;
    if (!estaPago(l)) return;
    if (l.tipo === 'receita') receitasEfetivadas += (Number(l.valor) || 0);
    else despesasEfetivadas += (Number(l.valor) || 0);
  });
  receitasEfetivadas = Math.round(receitasEfetivadas * 100) / 100;
  despesasEfetivadas = Math.round(despesasEfetivadas * 100) / 100;
  const lucroReal = Math.round((receitasEfetivadas - despesasEfetivadas) * 100) / 100;
  return { receitasEfetivadas, despesasEfetivadas, lucroReal };
}

function verificarViradaDeMesAutomatica() {
  if (!STATE.config) STATE.config = {};
  const mesAtual = hojeLocalISO().slice(0, 7);
  const mesAnterior = obterMesAnteriorISO(mesAtual);
  const ultimoFechado = STATE.config.ultimoMesFechado;
  // Aciona se detectar virada de mês (ultimoMesFechado diferente do mês atual / anterior ao mês encerrado)
  if (ultimoFechado !== mesAtual && ultimoFechado !== mesAnterior) {
    abrirWizardFechamentoMensal(false);
  }
}

function abrirWizardFechamentoMensal(manual) {
  const mesAtual = hojeLocalISO().slice(0, 7);
  wizardMesAlvo = obterMesAnteriorISO(mesAtual);
  wizardStepAtual = 1;
  const labelMes = formatarMesExtenso(wizardMesAlvo);
  const elTit = document.getElementById('wizard-titulo-mes');
  if (elTit) elTit.textContent = `Assistente de Fechamento Mensal — ${labelMes}`;
  ['wiz-step1-mes-label', 'wiz-step2-mes-label', 'wiz-step3-mes-label'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.textContent = labelMes;
  });
  atualizarUIWizardStep();
  abrirModal('modal-wizard-fechamento');
}

function adiarWizardFechamento() {
  fecharModal('modal-wizard-fechamento');
}

function navegarWizardStep(delta) {
  const novo = Math.max(1, Math.min(3, wizardStepAtual + delta));
  wizardStepAtual = novo;
  atualizarUIWizardStep();
}

function atualizarUIWizardStep() {
  for (let i = 1; i <= 3; i++) {
    const panel = document.getElementById(`wizard-step-${i}`);
    const pill = document.getElementById(`wiz-pill-${i}`);
    if (panel) panel.classList.toggle('active', i === wizardStepAtual);
    if (pill) {
      pill.classList.toggle('active', i === wizardStepAtual);
      pill.classList.toggle('done', i < wizardStepAtual);
    }
  }
  const btnVoltar = document.getElementById('wiz-btn-voltar');
  const btnAvancar = document.getElementById('wiz-btn-avancar');
  const btnPular = document.getElementById('wiz-btn-pular-alocacao');
  const btnConfirmar = document.getElementById('wiz-btn-confirmar-alocacao');

  if (btnVoltar) btnVoltar.style.visibility = wizardStepAtual > 1 ? 'visible' : 'hidden';

  if (wizardStepAtual === 1) {
    renderWizardStep1();
    if (btnAvancar) { btnAvancar.style.display = ''; btnAvancar.innerHTML = 'Ir para o Balanço <i class="ti ti-arrow-right"></i>'; }
    if (btnPular) btnPular.style.display = 'none';
    if (btnConfirmar) btnConfirmar.style.display = 'none';
  } else if (wizardStepAtual === 2) {
    renderWizardStep2();
    if (btnAvancar) { btnAvancar.style.display = ''; btnAvancar.innerHTML = 'Avançar para Destino do Lucro <i class="ti ti-arrow-right"></i>'; }
    if (btnPular) btnPular.style.display = 'none';
    if (btnConfirmar) btnConfirmar.style.display = 'none';
  } else if (wizardStepAtual === 3) {
    renderWizardStep3();
  }
}

function renderWizardStep1() {
  const pendencias = obterPendenciasMesWizard(wizardMesAlvo);
  const badge = document.getElementById('wiz-pend-count-badge');
  const bar = document.getElementById('wiz-pend-actions-bar');
  const wrap = document.getElementById('wiz-pend-list-wrap');
  const empty = document.getElementById('wiz-pend-empty');
  const tbody = document.getElementById('wiz-pend-tbody');

  if (badge) {
    badge.textContent = `${pendencias.length} pendente(s)`;
    badge.className = `badge ${pendencias.length ? 'badge-pendente' : 'badge-pago'}`;
  }
  if (!pendencias.length) {
    if (bar) bar.style.display = 'none';
    if (wrap) wrap.style.display = 'none';
    if (empty) empty.style.display = 'block';
    return;
  }
  if (bar) bar.style.display = 'flex';
  if (wrap) wrap.style.display = 'block';
  if (empty) empty.style.display = 'none';

  if (tbody) {
    tbody.innerHTML = pendencias.map(l => {
      const [a, m, d] = (l.data || '').split('-');
      const dataFmt = a ? `${d}/${m}/${a}` : '-';
      return `<tr>
        <td>${dataFmt}</td>
        <td>${escHtml(l.descricao || '-')}</td>
        <td><span class="badge badge-cat">${escHtml(formatarCategoriaExibicao(l.categoria))}</span></td>
        <td>${escHtml(l.conta || '-')}</td>
        <td style="text-align:right">${badgeValorHTML(l)}</td>
        <td style="text-align:right;white-space:nowrap">
          <button type="button" class="icon-btn" onclick="acaoIndividualWizardPendencia('${l.id}','pagar')" title="Marcar como Pago"><i class="ti ti-check" style="color:var(--good)"></i></button>
          <button type="button" class="icon-btn" onclick="acaoIndividualWizardPendencia('${l.id}','mover')" title="Mover para o mês atual"><i class="ti ti-calendar-forward" style="color:var(--accent)"></i></button>
          <button type="button" class="icon-btn danger" onclick="acaoIndividualWizardPendencia('${l.id}','apagar')" title="Apagar"><i class="ti ti-trash"></i></button>
        </td>
      </tr>`;
    }).join('');
  }
}

function moverDataParaMesAtual(dataISO) {
  const mesAtual = hojeLocalISO().slice(0, 7);
  const [anoAt, mesAt] = mesAtual.split('-').map(Number);
  const diaOrig = parseInt((dataISO || '').slice(8, 10), 10) || 1;
  return dataCobranca(anoAt, mesAt, diaOrig);
}

async function acaoIndividualWizardPendencia(id, acao) {
  const l = STATE.lancamentos.find(x => x.id === id);
  if (!l) return;
  if (acao === 'pagar') {
    l.pago = true;
    l.sincronizado = false;
    toast('Lançamento marcado como pago.', 'ok');
  } else if (acao === 'mover') {
    l.data = moverDataParaMesAtual(l.data);
    l.sincronizado = false;
    toast('Lançamento movido para o mês atual.', 'ok');
  } else if (acao === 'apagar') {
    registrarExclusao([l], `Excluído no Fechamento Mensal: ${l.descricao}`);
    STATE.lancamentos = STATE.lancamentos.filter(x => x.id !== id);
    toast('Lançamento movido para a lixeira.', 'ok');
  }
  await salvarDados();
  renderWizardStep1();
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
}

async function acaoLoteWizardPendencias(acao) {
  const pendencias = obterPendenciasMesWizard(wizardMesAlvo);
  if (!pendencias.length) {
    toast('Não há pendências neste mês.', 'ok');
    return;
  }
  if (acao === 'pagar') {
    pendencias.forEach(l => {
      l.pago = true;
      l.sincronizado = false;
    });
    toast(`${pendencias.length} lançamento(s) marcado(s) como Pagos!`, 'ok');
  } else if (acao === 'mover') {
    pendencias.forEach(l => {
      l.data = moverDataParaMesAtual(l.data);
      l.sincronizado = false;
    });
    toast(`${pendencias.length} lançamento(s) movido(s) para o mês atual!`, 'ok');
  } else if (acao === 'apagar') {
    const ids = new Set(pendencias.map(p => p.id));
    registrarExclusao(pendencias, `Lote excluído no Fechamento Mensal (${formatarMesExtenso(wizardMesAlvo)})`);
    STATE.lancamentos = STATE.lancamentos.filter(l => !ids.has(l.id));
    toast(`${pendencias.length} lançamento(s) apagado(s)!`, 'ok');
  }
  await salvarDados();
  renderWizardStep1();
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
}

function renderWizardStep2() {
  const { receitasEfetivadas, despesasEfetivadas, lucroReal } = calcularBalancoRealMesWizard(wizardMesAlvo);
  const kpisEl = document.getElementById('wiz-balanco-kpis');
  const heroEl = document.getElementById('wiz-balanco-hero');
  const taxa = receitasEfetivadas > 0 ? ((lucroReal / receitasEfetivadas) * 100) : null;

  if (kpisEl) {
    kpisEl.innerHTML = `
      <div class="metric m-ok">
        <div class="metric-top"><div class="metric-label">Receitas Efetivadas</div><div class="metric-icon mi-ok"><i class="ti ti-trending-up"></i></div></div>
        <div class="metric-value mv-ok">${toBRL(receitasEfetivadas)}</div>
        <div class="metric-sub">entradas pagas em ${formatarMesExtenso(wizardMesAlvo)}</div>
      </div>
      <div class="metric m-bad">
        <div class="metric-top"><div class="metric-label">Despesas Efetivadas</div><div class="metric-icon mi-bad"><i class="ti ti-trending-down"></i></div></div>
        <div class="metric-value mv-bad">${toBRL(despesasEfetivadas)}</div>
        <div class="metric-sub">saídas pagas em ${formatarMesExtenso(wizardMesAlvo)}</div>
      </div>
      <div class="metric ${lucroReal >= 0 ? 'm-info' : 'm-bad'}">
        <div class="metric-top"><div class="metric-label">Taxa de Poupança Real</div><div class="metric-icon mi-info"><i class="ti ti-percentage"></i></div></div>
        <div class="metric-value ${lucroReal >= 0 ? 'mv-info' : 'mv-bad'}">${fmtPct(taxa)}</div>
        <div class="metric-sub">sobre as receitas efetivadas</div>
      </div>`;
  }
  if (heroEl) {
    const corClasse = lucroReal > 0 ? 'mv-ok' : (lucroReal < 0 ? 'mv-bad' : 'mv-info');
    const msg = lucroReal > 0
      ? `Parabéns! Você encerrou ${formatarMesExtenso(wizardMesAlvo)} no azul e gerou excedente real de caixa.`
      : (lucroReal < 0
          ? `Atenção: as despesas efetivadas superaram as receitas em ${formatarMesExtenso(wizardMesAlvo)}.`
          : `Receitas e despesas ficaram exatamente empatadas neste mês.`);
    heroEl.innerHTML = `
      <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text3)">Lucro Real do Mês Encerrado (Receitas Efetivadas − Despesas Efetivadas)</div>
      <div class="wizard-balanco-valor ${corClasse}">${toBRL(lucroReal)}</div>
      <div style="font-size:13.5px;color:var(--text2)">${msg}</div>`;
  }
}

function renderWizardStep3() {
  migrarCofresParaMetas();
  const { lucroReal } = calcularBalancoRealMesWizard(wizardMesAlvo);
  const boxPos = document.getElementById('wiz-destino-positivo');
  const boxNeg = document.getElementById('wiz-destino-negativo');
  const btnAvancar = document.getElementById('wiz-btn-avancar');
  const btnPular = document.getElementById('wiz-btn-pular-alocacao');
  const btnConfirmar = document.getElementById('wiz-btn-confirmar-alocacao');

  if (btnAvancar) btnAvancar.style.display = 'none';

  if (lucroReal > 0) {
    if (boxPos) boxPos.style.display = 'block';
    if (boxNeg) boxNeg.style.display = 'none';
    if (btnPular) {
      btnPular.style.display = '';
      btnPular.textContent = 'Concluir sem alocar em Cofre';
    }
    if (btnConfirmar) {
      btnConfirmar.style.display = '';
      btnConfirmar.innerHTML = '<i class="ti ti-pig-money"></i> Confirmar e Alocar no Cofre';
    }
    const pergEl = document.getElementById('wiz-pergunta-lucro');
    if (pergEl) {
      pergEl.innerHTML = `<strong>Deseja alocar este lucro de ${toBRL(lucroReal)} em algum Cofre?</strong>`;
    }
    const inpVal = document.getElementById('wiz-valor-alocar');
    if (inpVal) inpVal.value = toBRL(lucroReal).replace('R$', 'R$ ');

    const selCofre = document.getElementById('wiz-select-cofre');
    const avisoSemCofre = document.getElementById('wiz-sem-cofres-aviso');
    const metasAtivas = STATE.metas || [];
    if (selCofre) {
      if (metasAtivas.length > 0) {
        selCofre.innerHTML = metasAtivas.map(m =>
          `<option value="${m.id}">${escHtml(m.nome)} (Atual: ${toBRL(m.valorAtual || 0)} / Meta: ${toBRL(m.valorAlvo || 0)})</option>`
        ).join('');
        if (avisoSemCofre) avisoSemCofre.style.display = 'none';
      } else {
        selCofre.innerHTML = `<option value="__novo_cofre_padrao__">✨ Criar Cofre "Reserva de Lucros"</option>`;
        if (avisoSemCofre) avisoSemCofre.style.display = 'block';
      }
    }
  } else {
    if (boxPos) boxPos.style.display = 'none';
    if (boxNeg) boxNeg.style.display = 'block';
    if (btnPular) {
      btnPular.style.display = '';
      btnPular.className = 'btn btn-primary';
      btnPular.innerHTML = '<i class="ti ti-check"></i> Concluir Fechamento do Mês';
    }
    if (btnConfirmar) btnConfirmar.style.display = 'none';
  }
}

async function concluirFechamentoMensal(alocarNoCofre) {
  migrarCofresParaMetas();
  if (!STATE.config) STATE.config = {};
  const mesAtual = hojeLocalISO().slice(0, 7);

  if (alocarNoCofre) {
    const inpVal = document.getElementById('wiz-valor-alocar');
    if (inpVal) avaliarExpressaoMoeda(inpVal);
    const valorAlocar = moedaToNumber(inpVal ? inpVal.value : '');
    if (!valorAlocar || valorAlocar <= 0) {
      toast('Informe um valor válido maior que zero para alocar no Cofre.', 'err');
      return;
    }
    const selCofre = document.getElementById('wiz-select-cofre');
    const cofreId = selCofre ? selCofre.value : '';
    let metaAlvo = (STATE.metas || []).find(m => m.id === cofreId);
    if (!metaAlvo) {
      metaAlvo = {
        id: uid(),
        nome: 'Reserva de Lucros',
        valorAlvo: Math.max(valorAlocar * 5, 5000),
        valorAtual: 0
      };
      STATE.metas.push(metaAlvo);
    }
    const valorAntesWiz = Number(metaAlvo.valorAtual) || 0;
    const valorAlvoWiz = Number(metaAlvo.valorAlvo) || 0;
    metaAlvo.valorAtual = Math.max(0, Math.round((valorAntesWiz + valorAlocar) * 100) / 100);
    const atingiu100Wiz = valorAlvoWiz > 0 && valorAntesWiz < valorAlvoWiz - 0.009 && metaAlvo.valorAtual >= valorAlvoWiz - 0.009;
    registrarLancamentoHistoricoCofre(metaAlvo, valorAlocar, 'guardar');
    if (atingiu100Wiz) {
      dispararConfettis();
      toastObjetivoAtingido(metaAlvo.nome);
    } else {
      toast(`Fechamento concluído! ${toBRL(valorAlocar)} transferidos para o cofre "${metaAlvo.nome}".`, 'ok');
    }
  } else {
    toast(`Fechamento de ${formatarMesExtenso(wizardMesAlvo)} concluído com sucesso!`, 'ok');
  }

  // Restaura estilo do botão caso tenha sido alterado no cenário sem lucro
  const btnPular = document.getElementById('wiz-btn-pular-alocacao');
  if (btnPular) btnPular.className = 'btn';

  STATE.config.ultimoMesFechado = mesAtual;
  await registrarSnapshotAtual(wizardMesAlvo || mesAtual, true);
  await salvarDados();
  fecharModal('modal-wizard-fechamento');
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
}

/* ================= MODO DE CONCILIAÇÃO BANCÁRIA (BALANCE RECONCILER) ================= */
let concilBancoSelecionados = new Set();

function normalizarConciliacaoLancamentos() {
  if (!Array.isArray(STATE.lancamentos)) return;
  STATE.lancamentos.forEach(l => {
    if (l && typeof l.conciliado !== 'boolean') {
      l.conciliado = false;
    }
  });
}

function ehContaCartaoConcil(nomeConta) {
  if (!nomeConta) return false;
  return (STATE.contas || []).some(c => c.nome === nomeConta && c.tipo === 'cartao') ||
         (STATE.cartoes || []).some(c => c.nome === nomeConta);
}

function maskMoedaComSinal(el) {
  if (!el) return;
  const raw = String(el.value || '');
  if (raw.trim() === '') {
    el.value = '';
    return;
  }
  const negativo = raw.trim().startsWith('-') || (raw.includes('-') && !raw.trim().startsWith('+'));
  const digitos = raw.replace(/\D/g, '');
  if (!digitos) {
    el.value = negativo ? '-' : '';
    return;
  }
  let v = (parseInt(digitos, 10) / 100).toFixed(2);
  v = v.replace('.', ',').replace(/\B(?=(\d{3})+(?=,))/g, '.');
  el.value = (negativo ? '- R$ ' : 'R$ ') + v;
  const pos = el.value.length;
  if (typeof el.setSelectionRange === 'function') el.setSelectionRange(pos, pos);
}

function moedaComSinalToNumber(str) {
  if (typeof str === 'number') return str;
  if (!str) return 0;
  const s = String(str).trim();
  if (!s || s === '-') return 0;
  const negativo = s.startsWith('-');
  const abs = Math.abs(moedaToNumber(s.replace(/-/g, '')));
  return negativo ? -abs : abs;
}

function abrirModalConciliacaoPorIndice(idx) {
  const c = (STATE.contas || [])[idx];
  abrirModalConciliacaoBancaria(c && c.tipo !== 'cartao' ? c.nome : undefined);
}

function obterContextoConciliacaoBancaria() {
  normalizarConciliacaoLancamentos();
  const selConta = document.getElementById('concil-banco-conta');
  const selMes = document.getElementById('concil-banco-mes');
  const contaSel = selConta ? selConta.value : '__todas__';
  const mesSel = (selMes && selMes.value) ? selMes.value : hojeLocalISO().slice(0, 7);

  const pertenceAConta = (l) => {
    if (!l || l.ehMovimentoCofre) return false;
    if (ehContaCartaoConcil(l.conta)) return false;
    if (contaSel === '__todas__') {
      return (STATE.contas || []).some(c => c.tipo !== 'cartao' && c.nome === l.conta);
    }
    return l.conta === contaSel;
  };

  // Lançamentos do mês com conciliado === false
  const itensElegiveis = (STATE.lancamentos || [])
    .filter(l => pertenceAConta(l) && mesCompetenciaLancamento(l) === mesSel && l.conciliado === false)
    .sort((a, b) => (b.data || '').localeCompare(a.data || ''));

  const idsElegiveis = new Set(itensElegiveis.map(l => l.id));

  // Saldo App (Base): saldo inicial + lançamentos efetivados da conta fora da lista pendente de conciliação
  const saldoInicialBase = contaSel === '__todas__'
    ? obterSomaSaldosIniciaisContas()
    : obterSomaSaldosIniciaisContas(contaSel);
  const saldoAppBase = Math.round(
    (saldoInicialBase + (STATE.lancamentos || [])
      .filter(l => pertenceAConta(l) && estaPago(l) && !idsElegiveis.has(l.id))
      .reduce((acc, l) => acc + (l.tipo === 'receita' ? 1 : -1) * (Number(l.valor) || 0), 0)) * 100
  ) / 100;

  const somaSelecionados = Math.round(
    itensElegiveis
      .filter(l => concilBancoSelecionados.has(l.id))
      .reduce((acc, l) => acc + (l.tipo === 'receita' ? 1 : -1) * (Number(l.valor) || 0), 0) * 100
  ) / 100;

  const saldoEsperado = Math.round((saldoAppBase + somaSelecionados) * 100) / 100;

  const inpReal = document.getElementById('concil-saldo-real');
  const rawReal = inpReal ? inpReal.value.trim() : '';
  const temSaldoReal = rawReal !== '' && rawReal !== '-';
  const saldoReal = temSaldoReal ? Math.round(moedaComSinalToNumber(rawReal) * 100) / 100 : saldoEsperado;
  // Fórmula exata: Diferença = Saldo Real - (Saldo App + Lançamentos Selecionados na Checkbox)
  const diferenca = Math.round((saldoReal - (saldoAppBase + somaSelecionados)) * 100) / 100;

  return {
    contaSel,
    mesSel,
    itensElegiveis,
    saldoAppBase,
    somaSelecionados,
    saldoEsperado,
    temSaldoReal,
    saldoReal,
    diferenca
  };
}

function abrirModalConciliacaoBancaria(contaPreSelecionada) {
  normalizarConciliacaoLancamentos();
  const selConta = document.getElementById('concil-banco-conta');
  const selMes = document.getElementById('concil-banco-mes');
  const inpReal = document.getElementById('concil-saldo-real');
  if (!selConta || !selMes || !inpReal) return;

  const contasBancarias = (STATE.contas || []).filter(c => c.tipo !== 'cartao');
  let optsConta = contasBancarias.map(c => `<option value="${escHtml(c.nome)}">${escHtml(c.nome)}</option>`).join('');
  if (contasBancarias.length > 1 || contasBancarias.length === 0) {
    optsConta += `<option value="__todas__">Todas as Contas Bancárias</option>`;
  }
  selConta.innerHTML = optsConta;

  if (contaPreSelecionada && contasBancarias.some(c => c.nome === contaPreSelecionada)) {
    selConta.value = contaPreSelecionada;
  } else if (contasBancarias.length > 0) {
    selConta.value = contasBancarias[0].nome;
  } else {
    selConta.value = '__todas__';
  }

  const mesAtual = hojeLocalISO().slice(0, 7);
  const mesesSet = new Set([mesAtual]);
  (STATE.lancamentos || []).forEach(l => {
    const m = mesCompetenciaLancamento(l);
    if (m) mesesSet.add(m);
  });
  const mesesOrdenados = [...mesesSet].sort((a, b) => b.localeCompare(a));
  const nomesMesCurto = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };
  selMes.innerHTML = mesesOrdenados.map(m => {
    const [ano, mes] = m.split('-');
    const rotulo = `${nomesMesCurto[mes] || mes}/${ano}${m === mesAtual ? ' (Atual)' : ''}`;
    return `<option value="${m}">${rotulo}</option>`;
  }).join('');
  selMes.value = mesAtual;

  inpReal.value = '';
  preSelecionarPagosConciliacaoBancaria();
  renderListaConciliacaoBancaria();
  atualizarCalculoConciliacaoBancaria();

  abrirModal('modal-conciliacao-bancaria');
  setTimeout(() => inpReal.focus(), 60);
}

function preSelecionarPagosConciliacaoBancaria() {
  concilBancoSelecionados.clear();
  const { itensElegiveis } = obterContextoConciliacaoBancaria();
  itensElegiveis.forEach(l => {
    if (estaPago(l)) concilBancoSelecionados.add(l.id);
  });
}

function aoMudarFiltroConciliacaoBancaria() {
  preSelecionarPagosConciliacaoBancaria();
  renderListaConciliacaoBancaria();
  atualizarCalculoConciliacaoBancaria();
}

function marcarTodosConciliacaoBancaria(marcar) {
  const { itensElegiveis } = obterContextoConciliacaoBancaria();
  concilBancoSelecionados.clear();
  if (marcar) {
    itensElegiveis.forEach(l => concilBancoSelecionados.add(l.id));
  }
  renderListaConciliacaoBancaria();
  atualizarCalculoConciliacaoBancaria();
}

function alternarItemConciliacaoBancaria(id) {
  if (concilBancoSelecionados.has(id)) {
    concilBancoSelecionados.delete(id);
  } else {
    concilBancoSelecionados.add(id);
  }
  const row = document.querySelector(`#concil-banco-lista .concil-item-row[data-id="${id}"]`);
  if (row) {
    const marcado = concilBancoSelecionados.has(id);
    row.classList.toggle('marcado', marcado);
    const chk = row.querySelector('input[type="checkbox"]');
    if (chk) chk.checked = marcado;
  }
  atualizarCalculoConciliacaoBancaria();
}

function renderListaConciliacaoBancaria() {
  const cont = document.getElementById('concil-banco-lista');
  const tituloEl = document.getElementById('concil-lista-titulo');
  if (!cont) return;

  const { itensElegiveis } = obterContextoConciliacaoBancaria();
  if (tituloEl) {
    tituloEl.textContent = `Lançamentos não conciliados do mês (${itensElegiveis.length})`;
  }

  if (itensElegiveis.length === 0) {
    cont.innerHTML = `<div class="empty" style="padding:1.5rem 1rem">
      <div class="empty-icon"><i class="ti ti-circle-check" style="color:var(--good)"></i></div>
      Todos os lançamentos desta conta neste mês já estão conciliados!
    </div>`;
    return;
  }

  cont.innerHTML = itensElegiveis.map(l => {
    const marcado = concilBancoSelecionados.has(l.id);
    const [a, m, d] = (l.data || '').split('-');
    const dataFmt = a ? `${d}/${m}/${a}` : '-';
    const ehRec = l.tipo === 'receita';
    const sinal = ehRec ? '+' : '−';
    const corValor = ehRec ? 'var(--good)' : 'var(--bad)';
    const statusBadge = estaPago(l)
      ? `<span class="badge badge-pago" style="font-size:10px;padding:1px 6px">Pago</span>`
      : `<span class="badge badge-pendente" style="font-size:10px;padding:1px 6px">Pendente</span>`;
    return `<label class="concil-item-row${marcado ? ' marcado' : ''}" data-id="${l.id}">
      <div class="concil-item-left">
        <input type="checkbox" ${marcado ? 'checked' : ''} onchange="alternarItemConciliacaoBancaria('${l.id}')" style="width:16px;height:16px;accent-color:var(--accent);flex-shrink:0;cursor:pointer">
        <div class="concil-item-info">
          <div class="concil-item-desc">${escHtml(l.descricao || 'Sem descrição')}</div>
          <div class="concil-item-meta">${dataFmt} · ${escHtml(formatarCategoriaExibicao(l.categoria))} · ${escHtml(l.conta || '-')} ${statusBadge}</div>
        </div>
      </div>
      <div class="concil-item-valor valor-sensivel" style="color:${corValor}">${sinal} ${toBRL(l.valor)}</div>
    </label>`;
  }).join('');
}

function atualizarCalculoConciliacaoBancaria() {
  const { saldoAppBase, somaSelecionados, saldoEsperado, temSaldoReal, diferenca } = obterContextoConciliacaoBancaria();

  const elBase = document.getElementById('concil-kpi-base');
  const elSel = document.getElementById('concil-kpi-selecionados');
  const elEsp = document.getElementById('concil-kpi-esperado');
  const elDif = document.getElementById('concil-kpi-diferenca');
  const boxDif = document.getElementById('concil-kpi-dif-box');
  const banner = document.getElementById('concil-status-banner');

  if (elBase) elBase.textContent = toBRL(saldoAppBase);
  if (elSel) {
    elSel.textContent = (somaSelecionados >= 0 ? '+ ' : '− ') + toBRL(Math.abs(somaSelecionados));
    elSel.style.color = somaSelecionados > 0 ? 'var(--good)' : somaSelecionados < 0 ? 'var(--bad)' : 'var(--text)';
  }
  if (elEsp) elEsp.textContent = toBRL(saldoEsperado);

  if (!temSaldoReal) {
    if (elDif) {
      elDif.textContent = '—';
      elDif.style.color = 'var(--text3)';
    }
    if (boxDif) boxDif.className = 'concil-kpi-box destaque';
    if (banner) {
      banner.className = 'concil-status-banner';
      banner.innerHTML = `<i class="ti ti-info-circle" style="font-size:16px;flex-shrink:0;color:var(--accent)"></i>
        <span>Digite o <strong>Saldo Real no Banco</strong> acima para calcular a diferença em tempo real.</span>`;
    }
    return;
  }

  const bateuExato = Math.abs(diferenca) < 0.01;
  if (elDif) {
    elDif.textContent = bateuExato ? 'R$ 0,00' : ((diferenca > 0 ? '+ ' : '− ') + toBRL(Math.abs(diferenca)));
    elDif.style.color = bateuExato ? 'var(--good)' : 'var(--amber)';
  }
  if (boxDif) {
    boxDif.className = 'concil-kpi-box destaque ' + (bateuExato ? 'ok' : 'divergente');
  }
  if (banner) {
    if (bateuExato) {
      banner.className = 'concil-status-banner ok';
      banner.innerHTML = `<i class="ti ti-circle-check" style="font-size:17px;flex-shrink:0"></i>
        <span>Saldos 100% sincronizados! Nenhuma divergência encontrada.</span>`;
    } else {
      const tipoAjuste = diferenca > 0 ? 'entrada não registada' : 'saída/tarifa não registada';
      banner.className = 'concil-status-banner divergente';
      banner.innerHTML = `<i class="ti ti-alert-triangle" style="font-size:17px;flex-shrink:0"></i>
        <span>Diferença de <strong class="valor-sensivel">${toBRL(Math.abs(diferenca))}</strong> (${tipoAjuste}). Ao finalizar, poderás gerar um Lançamento de Ajuste automático.</span>`;
    }
  }
}

async function finalizarConciliacaoBancaria() {
  const { contaSel, mesSel, itensElegiveis, temSaldoReal, diferenca } = obterContextoConciliacaoBancaria();

  if (!temSaldoReal && concilBancoSelecionados.size === 0) {
    toast('Informe o Saldo Real no Banco ou marque ao menos um lançamento para conciliar.', 'err');
    const inp = document.getElementById('concil-saldo-real');
    if (inp) inp.focus();
    return;
  }

  let qtdConciliados = 0;
  itensElegiveis.forEach(l => {
    if (concilBancoSelecionados.has(l.id)) {
      l.conciliado = true;
      l.pago = true;
      l.sincronizado = false;
      qtdConciliados++;
    } else if (temSaldoReal && estaPago(l)) {
      // Se o utilizador informou o Saldo Real e desmarcou um item pago na conciliação, ele ainda não compensou no banco
      l.pago = false;
      l.sincronizado = false;
    }
  });

  await salvarDados();
  fecharModal('modal-conciliacao-bancaria');
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();

  if (temSaldoReal && Math.abs(diferenca) >= 0.01) {
    const valorAbs = Math.round(Math.abs(diferenca) * 100) / 100;
    const msgAjuste = `Deseja criar um Lançamento de Ajuste de ${toBRL(valorAbs)} para sincronizar a conta?`;
    abrirConfirmacao(msgAjuste, async () => {
      const primeiraContaBanco = (STATE.contas || []).find(c => c.tipo !== 'cartao');
      const contaDestino = (contaSel && contaSel !== '__todas__')
        ? contaSel
        : (primeiraContaBanco ? primeiraContaBanco.nome : 'Conta principal');

      const hojeISO = hojeLocalISO();
      let dataAjuste = hojeISO;
      if (mesSel && mesSel !== hojeISO.slice(0, 7)) {
        const [anoRef, mesRef] = mesSel.split('-').map(Number);
        const ultimoDia = new Date(anoRef, mesRef, 0).getDate();
        dataAjuste = `${mesSel}-${String(ultimoDia).padStart(2, '0')}`;
      }

      STATE.lancamentos.push({
        id: uid(),
        tipo: diferenca > 0 ? 'receita' : 'despesa',
        data: dataAjuste,
        descricao: diferenca > 0 ? 'Ajuste de Conciliação Bancária (Entrada)' : 'Ajuste de Conciliação Bancária (Saída)',
        categoria: 'Ajuste de Saldo',
        conta: contaDestino,
        valor: valorAbs,
        origem: 'conciliacao',
        sincronizado: false,
        pago: true,
        conciliado: true
      });

      await salvarDados();
      renderPaginaAtiva();
      sincronizarEmSegundoPlano();
      toast(`Lançamento de Ajuste de ${toBRL(valorAbs)} criado e conta sincronizada!`, 'ok');
    }, 'Sincronizar Conta Bancária');

    const btnOk = document.getElementById('btn-confirm-ok');
    if (btnOk) {
      btnOk.className = 'btn btn-primary';
      btnOk.innerHTML = '<i class="ti ti-scale"></i> Criar Ajuste';
    }
    return;
  }

  toast(
    qtdConciliados > 0
      ? `Conciliação concluída! ${qtdConciliados} lançamento(s) conciliado(s).`
      : 'Saldo conferido e conta sincronizada!',
    'ok'
  );
}

/* ================= MENU DE CONTEXTO NATIVO (RIGHT-CLICK LANÇAMENTOS) ================= */
let ctxMenuLancamentoIdAtivo = null;
let ctxMenuLinhaAtivaEl = null;

function fecharContextMenu() {
  const menu = document.getElementById('context-menu');
  if (menu && menu.classList.contains('show')) {
    menu.classList.remove('show');
    menu.setAttribute('aria-hidden', 'true');
  }
  if (ctxMenuLinhaAtivaEl) {
    ctxMenuLinhaAtivaEl.classList.remove('context-active');
    ctxMenuLinhaAtivaEl = null;
  }
  ctxMenuLancamentoIdAtivo = null;
}

async function duplicarLancamentoContexto(id) {
  const original = (STATE.lancamentos || []).find(x => x.id === id);
  if (!original) return;
  if (original.ehMovimentoCofre) {
    toast('Movimentações internas de Cofre/Meta devem ser feitas na aba Metas & Cofres.', 'err');
    return;
  }
  if (original.ehTransferencia) {
    toast('Para repetir uma transferência entre contas, utilize o botão Transferir.', 'err');
    return;
  }

  const descSemParcela = String(original.descricao || 'Lançamento').replace(/\s*\(\d+\/\d+\)$/, '').trim();
  const copiaCartao = ehLancamentoCartao(original);
  const copia = {
    id: uid(),
    tipo: original.tipo || 'despesa',
    data: original.data || hojeLocalISO(),
    dataCompra: original.dataCompra || undefined,
    descricao: `${descSemParcela} (Cópia)`,
    categoria: original.categoria || 'Outros',
    conta: original.conta || ((STATE.contas && STATE.contas[0]) ? STATE.contas[0].nome : 'Conta principal'),
    valor: Number(original.valor) || 0,
    origem: 'manual',
    sincronizado: false,
    pago: copiaCartao ? false : estaPago(original),
    conciliado: false,
    faturaAno: original.faturaAno || undefined,
    faturaMes: original.faturaMes || undefined,
    dataVencimentoFatura: original.dataVencimentoFatura || undefined,
    tags: Array.isArray(original.tags) ? [...original.tags] : undefined,
    subTransacoes: Array.isArray(original.subTransacoes) ? original.subTransacoes.map(s => ({ ...s })) : undefined,
    ehReembolsavel: original.ehReembolsavel ? true : undefined,
    reembolsoDevedor: original.ehReembolsavel ? original.reembolsoDevedor : undefined,
    reembolsado: original.ehReembolsavel ? false : undefined
  };

  STATE.lancamentos.push(copia);
  await salvarDados();
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  toast(`Lançamento "${copia.descricao}" duplicado!`, 'ok');
}

function inicializarMenuContextoLancamentos() {
  const menu = document.getElementById('context-menu');
  if (!menu || menu.dataset.bound === '1') return;
  menu.dataset.bound = '1';

  const btnEditar = document.getElementById('ctx-btn-editar');
  const btnDuplicar = document.getElementById('ctx-btn-duplicar');
  const btnStatus = document.getElementById('ctx-btn-status');
  const btnApagar = document.getElementById('ctx-btn-apagar');
  const lblStatus = document.getElementById('ctx-label-status');
  const tituloMenu = document.getElementById('ctx-menu-titulo');

  document.addEventListener('contextmenu', (e) => {
    const linha = e.target.closest('tr.card-lancamento[data-id], #lanc-tbody tr[data-id], #dash-ultimos tr[data-id]');
    if (!linha) {
      fecharContextMenu();
      return;
    }
    if (modoConciliacaoAtivo) return;

    const id = linha.getAttribute('data-id');
    const lanc = (STATE.lancamentos || []).find(x => x.id === id);
    if (!lanc) return;

    e.preventDefault();
    e.stopPropagation();

    if (ctxMenuLinhaAtivaEl && ctxMenuLinhaAtivaEl !== linha) {
      ctxMenuLinhaAtivaEl.classList.remove('context-active');
    }
    ctxMenuLancamentoIdAtivo = id;
    ctxMenuLinhaAtivaEl = linha;
    linha.classList.add('context-active');

    if (tituloMenu) {
      tituloMenu.textContent = `${lanc.descricao || 'Lançamento'} · ${toBRL(lanc.valor)}`;
    }
    if (lblStatus) {
      lblStatus.textContent = estaPago(lanc)
        ? 'Alternar Estado (Marcar Pendente)'
        : 'Alternar Estado (Marcar Pago)';
    }
    if (btnEditar) {
      btnEditar.style.display = lanc.ehTransferencia ? 'none' : 'flex';
    }
    if (btnDuplicar) {
      btnDuplicar.style.display = lanc.ehTransferencia ? 'none' : 'flex';
    }
    if (btnStatus) {
      btnStatus.style.display = lanc.ehTransferencia ? 'none' : 'flex';
    }

    // Exibe invisível primeiro para medir dimensões reais e travar nos limites da janela do Electron
    menu.style.visibility = 'hidden';
    menu.style.left = '0px';
    menu.style.top = '0px';
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');

    const menuW = menu.offsetWidth || 248;
    const menuH = menu.offsetHeight || 184;
    const margem = 10;

    let posX = e.pageX;
    let posY = e.pageY;

    const maxX = window.scrollX + window.innerWidth - menuW - margem;
    const maxY = window.scrollY + window.innerHeight - menuH - margem;

    if (posX > maxX) posX = Math.max(window.scrollX + margem, e.pageX - menuW);
    if (posY > maxY) posY = Math.max(window.scrollY + margem, e.pageY - menuH);

    posX = Math.max(window.scrollX + margem, Math.min(posX, maxX));
    posY = Math.max(window.scrollY + margem, Math.min(posY, maxY));

    menu.style.left = `${Math.round(posX)}px`;
    menu.style.top = `${Math.round(posY)}px`;
    menu.style.visibility = 'visible';
  });

  if (btnEditar) {
    btnEditar.addEventListener('click', (e) => {
      e.stopPropagation();
      const id = ctxMenuLancamentoIdAtivo;
      fecharContextMenu();
      if (id) abrirModalLancamento(id);
    });
  }

  if (btnDuplicar) {
    btnDuplicar.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = ctxMenuLancamentoIdAtivo;
      fecharContextMenu();
      if (id) await duplicarLancamentoContexto(id);
    });
  }

  if (btnStatus) {
    btnStatus.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = ctxMenuLancamentoIdAtivo;
      fecharContextMenu();
      if (!id) return;
      const lanc = (STATE.lancamentos || []).find(x => x.id === id);
      if (!lanc || lanc.ehTransferencia) return;
      await togglePagamento(id);
      toast(`Estado alterado para ${estaPago(lanc) ? 'Pago' : 'Pendente'}.`, 'ok');
    });
  }

  if (btnApagar) {
    btnApagar.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = ctxMenuLancamentoIdAtivo;
      fecharContextMenu();
      if (!id) return;
      const lanc = (STATE.lancamentos || []).find(x => x.id === id);
      if (!lanc) return;
      if (lanc.ehTransferencia && lanc.transferenciaGrupo) {
        await excluirTransferencia(lanc.transferenciaGrupo);
      } else {
        await excluirLancamento(id);
      }
    });
  }

  window.addEventListener('click', (e) => {
    if (!menu.classList.contains('show')) return;
    if (!menu.contains(e.target)) fecharContextMenu();
  });

  window.addEventListener('resize', fecharContextMenu);
  window.addEventListener('blur', fecharContextMenu);
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') fecharContextMenu();
  });

  const scrollContainer = document.querySelector('.content');
  if (scrollContainer) {
    scrollContainer.addEventListener('scroll', fecharContextMenu, { passive: true });
  }
}

/* ================= CELEBRAÇÕES DE METAS / CONFETTIS (DOPAMINE MILESTONES) ================= */
let confettiAnimFrameId = null;
let confettiCleanupTimer = null;

function encerrarConfettis() {
  if (confettiAnimFrameId !== null) {
    cancelAnimationFrame(confettiAnimFrameId);
    confettiAnimFrameId = null;
  }
  if (confettiCleanupTimer !== null) {
    clearTimeout(confettiCleanupTimer);
    confettiCleanupTimer = null;
  }
  const canvas = document.getElementById('confetti-canvas');
  if (canvas) {
    const ctx = canvas.getContext('2d');
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    canvas.width = 0;
    canvas.height = 0;
    canvas.style.display = 'none';
  }
}

function dispararConfettis() {
  const canvas = document.getElementById('confetti-canvas');
  if (!canvas) return;

  encerrarConfettis();

  const largura = window.innerWidth || document.documentElement.clientWidth || 1024;
  const altura = window.innerHeight || document.documentElement.clientHeight || 768;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  canvas.style.display = 'block';
  canvas.width = Math.floor(largura * dpr);
  canvas.height = Math.floor(altura * dpr);

  const ctx = canvas.getContext('2d');
  if (!ctx) {
    encerrarConfettis();
    return;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const estilos = getComputedStyle(document.documentElement);
  const paleta = [
    estilos.getPropertyValue('--accent').trim() || '#1A6FE0',
    estilos.getPropertyValue('--good').trim() || '#10B981',
    estilos.getPropertyValue('--amber').trim() || '#F59E0B',
    '#8B5CF6',
    '#F43F5E',
    '#06B6D4',
    '#FBBF24'
  ];

  const origemX = largura * 0.5;
  const origemY = altura * 0.45;
  const totalParticulas = 115;
  const gravidade = 0.28;
  const atrito = 0.982;
  const particulas = [];

  for (let i = 0; i < totalParticulas; i++) {
    const angulo = Math.random() * Math.PI * 2;
    const velocidade = 5 + Math.random() * 15;
    const formato = Math.random() < 0.42 ? 'circle' : 'rect';
    const tamanho = 5 + Math.random() * 6.5;
    particulas.push({
      x: origemX + (Math.random() - 0.5) * 24,
      y: origemY + (Math.random() - 0.5) * 24,
      vx: Math.cos(angulo) * velocidade,
      vy: Math.sin(angulo) * velocidade - (3.5 + Math.random() * 4.5),
      cor: paleta[i % paleta.length],
      formato,
      larguraP: tamanho,
      alturaP: formato === 'rect' ? tamanho * (0.48 + Math.random() * 0.45) : tamanho,
      rotacao: Math.random() * Math.PI * 2,
      velRotacao: (Math.random() - 0.5) * 0.26,
      opacidade: 1,
      decaimento: 0.0055 + Math.random() * 0.0065
    });
  }

  const inicio = performance.now();
  const duracaoMaximaMs = 3800;

  function animarFrame(agora) {
    const decorrido = agora - inicio;
    ctx.clearRect(0, 0, largura, altura);

    if (decorrido >= duracaoMaximaMs) {
      encerrarConfettis();
      return;
    }

    let vivas = 0;
    for (let i = 0; i < particulas.length; i++) {
      const p = particulas[i];
      if (p.opacidade <= 0.02 || p.y > altura + 40) continue;

      p.vx *= atrito;
      p.vy = p.vy * atrito + gravidade;
      p.x += p.vx;
      p.y += p.vy;
      p.rotacao += p.velRotacao;

      if (decorrido > 1700) {
        p.opacidade -= p.decaimento * 1.8;
      } else {
        p.opacidade -= p.decaimento * 0.35;
      }
      if (p.opacidade <= 0.02) continue;

      vivas++;
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, p.opacidade));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rotacao);
      ctx.fillStyle = p.cor;

      if (p.formato === 'circle') {
        ctx.beginPath();
        ctx.arc(0, 0, p.larguraP * 0.5, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillRect(-p.larguraP * 0.5, -p.alturaP * 0.5, p.larguraP, p.alturaP);
      }
      ctx.restore();
    }

    if (vivas > 0) {
      confettiAnimFrameId = requestAnimationFrame(animarFrame);
    } else {
      encerrarConfettis();
    }
  }

  confettiAnimFrameId = requestAnimationFrame(animarFrame);
  // Garantia extra de auto-destruição mesmo se a aba ficar em background
  confettiCleanupTimer = setTimeout(encerrarConfettis, duracaoMaximaMs + 250);
}

function toastObjetivoAtingido(nomeMeta) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.onclick = null;
  t.title = '';
  const sufixo = nomeMeta ? ` Você completou 100% do cofre "${nomeMeta}"!` : ' Meta 100% concluída!';
  t.textContent = `🏆 Objetivo Atingido!${sufixo}`;
  t.className = 'toast show ok milestone';
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show', 'milestone'), 5500);
}

/* ================= SINCRONIZAÇÃO FAMILIAR P2P (REDE LOCAL PORTA 45000) ================= */
let p2pMeuIPCache = '';
let p2pListenerRegistrado = false;

async function obterMeuIPLocalP2P() {
  if (window.electronAPI && typeof window.electronAPI.obterIPLocal === 'function') {
    try {
      const ip = await window.electronAPI.obterIPLocal();
      if (ip && typeof ip === 'string') {
        p2pMeuIPCache = ip;
        return ip;
      }
    } catch (e) {}
  }
  if (window.electronAPI && typeof window.electronAPI.invocar === 'function') {
    try {
      const ip = await window.electronAPI.invocar('obter-ip-local');
      if (ip && typeof ip === 'string') {
        p2pMeuIPCache = ip;
        return ip;
      }
    } catch (e) {}
  }
  return p2pMeuIPCache || 'Indisponível (Modo Web)';
}

async function atualizarUISincronizacaoFamiliarP2P() {
  const elMeuIp = document.getElementById('p2p-meu-ip');
  const inpParceiro = document.getElementById('p2p-ip-parceiro');
  const elStatus = document.getElementById('p2p-status-msg');

  if (inpParceiro && STATE.config && STATE.config.ipParceiroP2P && !inpParceiro.value) {
    inpParceiro.value = STATE.config.ipParceiroP2P;
  }

  if (elMeuIp) {
    const ip = await obterMeuIPLocalP2P();
    elMeuIp.textContent = ip;
  }

  if (elStatus && STATE.config && STATE.config.ultimoSyncP2P) {
    elStatus.innerHTML = `<i class="ti ti-circle-check" style="color:var(--good)"></i> Última sincronização familiar: <strong>${escHtml(STATE.config.ultimoSyncP2P)}</strong>`;
  }
}

function salvarIPParceiroP2P(valor) {
  if (!STATE.config) STATE.config = {};
  STATE.config.ipParceiroP2P = String(valor || '').trim();
  try {
    persistirStateNoLocalStorage();
  } catch (e) {}
}

async function copiarMeuIPP2P() {
  const ip = await obterMeuIPLocalP2P();
  if (!ip || ip.startsWith('Indisponível')) {
    toast('Endereço IP local indisponível fora do aplicativo Desktop.', 'err');
    return;
  }
  try {
    await navigator.clipboard.writeText(ip);
    toast(`Seu IP (${ip}) foi copiado para a área de transferência!`, 'ok');
  } catch (e) {
    toast(`Seu IP na rede é: ${ip}`, 'ok');
  }
}

/**
 * Merge Inteligente P2P:
 * Cruza os arrays (lancamentos, cofres, metas e cadastros auxiliares) via IDs únicos,
 * adiciona os registos inexistentes, ignora duplicados e protege o localStorage contra
 * dados malformados.
 */
async function mesclarEstadoP2P(dadosExternos, silencioso = false) {
  let externo = dadosExternos;
  if (typeof externo === 'string') {
    try {
      externo = JSON.parse(externo);
    } catch (err) {
      if (!silencioso) toast('Erro no Merge P2P: JSON recebido está malformado.', 'err');
      return { ok: false, erro: 'JSON malformado.' };
    }
  }

  if (!externo || typeof externo !== 'object' || Array.isArray(externo)) {
    if (!silencioso) toast('Erro no Merge P2P: formato de dados inválido.', 'err');
    return { ok: false, erro: 'Formato de objeto inválido.' };
  }

  const temLancamentosValidos = Array.isArray(externo.lancamentos);
  const temCofresValidos = Array.isArray(externo.cofres);
  const temMetasValidas = Array.isArray(externo.metas);

  if (!temLancamentosValidos && !temCofresValidos && !temMetasValidas) {
    if (!silencioso) toast('Dados P2P ignorados: estrutura de estado não reconhecida.', 'err');
    return { ok: false, erro: 'Estrutura de estado ausente.' };
  }

  try {
    if (!Array.isArray(STATE.lancamentos)) STATE.lancamentos = [];
    if (!Array.isArray(STATE.cofres)) STATE.cofres = [];
    if (!Array.isArray(STATE.metas)) STATE.metas = [];
    if (!Array.isArray(STATE.contas)) STATE.contas = [];
    if (!Array.isArray(STATE.categorias)) STATE.categorias = [];

    const excluidosSet = new Set(Array.isArray(STATE.excluidosPendentes) ? STATE.excluidosPendentes : []);
    const idsLancamentosLocais = new Set(STATE.lancamentos.map(l => l && l.id).filter(Boolean));
    const nomesContasLocais = new Set(STATE.contas.map(c => c && c.nome ? c.nome.toLowerCase() : '').filter(Boolean));

    let novosLancamentos = 0;
    let novosCofres = 0;

    // 1. Mescla Contas que não existam localmente para evitar lançamentos órfãos
    if (Array.isArray(externo.contas)) {
      externo.contas.forEach(c => {
        if (!c || typeof c !== 'object' || typeof c.nome !== 'string') return;
        const nomeLimpo = c.nome.trim();
        if (!nomeLimpo || nomesContasLocais.has(nomeLimpo.toLowerCase())) return;
        STATE.contas.push({
          nome: nomeLimpo,
          tipo: c.tipo === 'cartao' ? 'cartao' : 'conta',
          diaFechamento: c.diaFechamento,
          diaVencimento: c.diaVencimento,
          limite: c.limite
        });
        nomesContasLocais.add(nomeLimpo.toLowerCase());
      });
    }

    // 2. Merge Inteligente de Lançamentos por ID único
    if (temLancamentosValidos) {
      externo.lancamentos.forEach(item => {
        if (!item || typeof item !== 'object') return;
        const id = typeof item.id === 'string' ? item.id.trim() : '';
        if (!id || idsLancamentosLocais.has(id) || excluidosSet.has(id)) return;
        const valorNum = Number(item.valor);
        if (!isFinite(valorNum) || valorNum < 0) return;

        const contaItem = typeof item.conta === 'string' && item.conta.trim() ? item.conta.trim() : 'Conta principal';
        if (!nomesContasLocais.has(contaItem.toLowerCase())) {
          STATE.contas.push({ nome: contaItem, tipo: 'conta' });
          nomesContasLocais.add(contaItem.toLowerCase());
        }

        STATE.lancamentos.push({
          ...item,
          id,
          tipo: item.tipo === 'receita' ? 'receita' : 'despesa',
          valor: Math.round(valorNum * 100) / 100,
          conta: contaItem,
          conciliado: typeof item.conciliado === 'boolean' ? item.conciliado : false,
          pago: typeof item.pago === 'boolean' ? item.pago : true
        });
        idsLancamentosLocais.add(id);
        novosLancamentos++;
      });
    }

    // 3. Merge Inteligente de Cofres (STATE.cofres) e Metas (STATE.metas) por ID único
    const idsCofresLocais = new Set(STATE.cofres.map(c => c && c.id).filter(Boolean));
    const idsMetasLocais = new Set(STATE.metas.map(m => m && m.id).filter(Boolean));

    if (temCofresValidos) {
      externo.cofres.forEach(cofre => {
        if (!cofre || typeof cofre !== 'object') return;
        const id = typeof cofre.id === 'string' ? cofre.id.trim() : '';
        if (!id || idsCofresLocais.has(id)) return;
        STATE.cofres.push({ ...cofre, id });
        idsCofresLocais.add(id);
        if (!idsMetasLocais.has(id)) novosCofres++;
      });
    }

    if (temMetasValidas) {
      externo.metas.forEach(meta => {
        if (!meta || typeof meta !== 'object') return;
        const id = typeof meta.id === 'string' ? meta.id.trim() : '';
        if (!id || idsMetasLocais.has(id)) return;
        const valorAlvo = Number(meta.valorAlvo ?? meta.objetivo) || 0;
        const valorAtual = Number(meta.valorAtual ?? meta.saldoAlocado) || 0;
        if (!isFinite(valorAlvo) || !isFinite(valorAtual)) return;
        STATE.metas.push({
          ...meta,
          id,
          nome: String(meta.nome || 'Cofre Familiar').trim(),
          valorAlvo: Math.max(0, valorAlvo),
          valorAtual: Math.max(0, valorAtual)
        });
        idsMetasLocais.add(id);
        novosCofres++;
      });
    }

    // 4. Merge Inteligente de Regras de Auto-Categorização (STATE.regrasCategoria)
    normalizarRegrasCategoria();
    if (Array.isArray(externo.regrasCategoria)) {
      const idsRegrasLocais = new Set(STATE.regrasCategoria.map(r => r && r.id).filter(Boolean));
      const assinsLocais = new Set(STATE.regrasCategoria.map(r =>
        `${normalizarTextoSemAcento(r.padrao)}|${r.modoMatch}|${r.tipo}|${r.contaId}|${r.categoria}|${r.subcategoria}`
      ));
      externo.regrasCategoria.forEach(rExt => {
        if (!rExt || typeof rExt !== 'object' || !rExt.padrao || !rExt.categoria) return;
        const rid = typeof rExt.id === 'string' && rExt.id.trim() ? rExt.id.trim() : uid();
        const assin = `${normalizarTextoSemAcento(rExt.padrao)}|${rExt.modoMatch || 'contem'}|${rExt.tipo || 'todos'}|${rExt.contaId || ''}|${rExt.categoria}|${rExt.subcategoria || ''}`;
        if (idsRegrasLocais.has(rid) || assinsLocais.has(assin)) return;
        STATE.regrasCategoria.push({ ...rExt, id: rid });
        idsRegrasLocais.add(rid);
        assinsLocais.add(assin);
      });
      normalizarRegrasCategoria();
    }

    migrarCofresParaMetas();
    sincronizarEstruturaCartoes();
    recalcularLimitesCartoes();

    if (!STATE.config) STATE.config = {};
    const agoraFmt = new Date().toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
    STATE.config.ultimoSyncP2P = agoraFmt;

    await salvarDados();
    renderPaginaAtiva();
    atualizarSaldos();
    atualizarUISincronizacaoFamiliarP2P();

    return { ok: true, novosLancamentos, novosCofres };
  } catch (err) {
    console.error('[P2P] Erro protegido durante o Merge Inteligente:', err);
    if (!silencioso) toast('Falha ao mesclar dados P2P. Seus dados locais foram preservados.', 'err');
    return { ok: false, erro: err.message || 'Erro interno no merge.' };
  }
}

async function sincronizarP2PFamiliar() {
  const inp = document.getElementById('p2p-ip-parceiro');
  const btn = document.getElementById('btn-p2p-sincronizar');
  const elStatus = document.getElementById('p2p-status-msg');
  const ipParceiro = inp ? inp.value.trim() : '';

  if (!ipParceiro) {
    toast('Informe o IP do Parceiro na rede local (ex: 192.168.1.15).', 'err');
    if (inp) inp.focus();
    return;
  }

  salvarIPParceiroP2P(ipParceiro);

  const enviarFn = (window.electronAPI && typeof window.electronAPI.enviarSync === 'function')
    ? (ip, st) => window.electronAPI.enviarSync(ip, st)
    : (window.electronAPI && typeof window.electronAPI.invocar === 'function')
      ? (ip, st) => window.electronAPI.invocar('enviar-sync', { ipParceiro: ip, stateLocal: st })
      : null;

  if (!enviarFn) {
    toast('A Sincronização P2P requer o aplicativo Desktop (Electron).', 'err');
    return;
  }

  const htmlOriginal = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Sincronizando...';
  }
  if (elStatus) {
    elStatus.innerHTML = `<i class="ti ti-loader" style="color:var(--accent)"></i> Conectando a <strong>${escHtml(ipParceiro)}:45000</strong>...`;
  }

  try {
    const resposta = await enviarFn(ipParceiro, STATE);
    if (!resposta || !resposta.ok) {
      const msgErro = (resposta && resposta.erro) || 'Não foi possível conectar ao parceiro.';
      if (elStatus) {
        elStatus.innerHTML = `<i class="ti ti-alert-triangle" style="color:var(--bad)"></i> ${escHtml(msgErro)}`;
      }
      toast(msgErro, 'err');
      return;
    }

    const resMerge = await mesclarEstadoP2P(resposta.stateParceiro, false);
    if (resMerge && resMerge.ok) {
      const resumo = (resMerge.novosLancamentos > 0 || resMerge.novosCofres > 0)
        ? `Sincronização concluída! +${resMerge.novosLancamentos} lançamento(s) e +${resMerge.novosCofres} cofre(s) adicionados.`
        : 'Sincronização concluída! Ambos os computadores já estão 100% atualizados.';
      toast(resumo, 'ok');
    }
  } catch (err) {
    const msg = err.message || 'Falha ao sincronizar com o parceiro.';
    if (elStatus) {
      elStatus.innerHTML = `<i class="ti ti-alert-triangle" style="color:var(--bad)"></i> ${escHtml(msg)}`;
    }
    toast(msg, 'err');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = htmlOriginal || '<i class="ti ti-arrows-exchange"></i> Sincronizar Agora';
    }
  }
}

function inicializarSyncFamiliarP2P() {
  if (p2pListenerRegistrado) return;
  p2pListenerRegistrado = true;

  if (window.electronAPI && typeof window.electronAPI.atualizarCacheP2P === 'function') {
    try { window.electronAPI.atualizarCacheP2P(STATE); } catch (e) {}
  }

  if (window.electronAPI && typeof window.electronAPI.onReceberSync === 'function') {
    window.electronAPI.onReceberSync(async (stateParceiro) => {
      const res = await mesclarEstadoP2P(stateParceiro, true);
      if (res && res.ok) {
        const detalhe = (res.novosLancamentos > 0 || res.novosCofres > 0)
          ? `+${res.novosLancamentos} lançamento(s) e +${res.novosCofres} cofre(s) mesclados.`
          : 'Dados conferidos e sincronizados.';
        toast(`🤝 Sincronização Familiar recebida! ${detalhe}`, 'ok');
      }
    });
  }

  atualizarUISincronizacaoFamiliarP2P();
}

/* ================= FEEDBACK VISUAL DE AUTO-UPDATE SILENCIOSO (OTA) & DEBUG ================= */
let autoUpdateListenersRegistrados = false;
let ultimoErroUpdateTimestamp = 0;

function atualizarPainelDebugUpdate(mensagem, tipo = 'info') {
  const logEl = document.getElementById('update-debug-log');
  const badgeEl = document.getElementById('update-debug-badge');
  const horario = new Date().toLocaleTimeString('pt-BR');

  if (logEl) {
    logEl.textContent = `[${horario}] ${mensagem}`;
    if (tipo === 'erro') {
      logEl.style.color = 'var(--bad-text)';
      logEl.style.borderColor = 'var(--bad-border)';
      logEl.style.background = 'var(--bad-bg)';
    } else if (tipo === 'ok') {
      logEl.style.color = 'var(--good-text)';
      logEl.style.borderColor = 'rgba(22, 163, 74, 0.35)';
      logEl.style.background = 'var(--good-bg)';
    } else {
      logEl.style.color = 'var(--text2)';
      logEl.style.borderColor = 'var(--border)';
      logEl.style.background = 'var(--surface2)';
    }
  }

  if (badgeEl) {
    if (tipo === 'erro') {
      badgeEl.textContent = 'Erro OTA';
      badgeEl.style.background = 'var(--bad-bg)';
      badgeEl.style.color = 'var(--bad-text)';
    } else if (tipo === 'ok') {
      badgeEl.textContent = 'Conectado ao GitHub';
      badgeEl.style.background = 'var(--good-bg)';
      badgeEl.style.color = 'var(--good-text)';
    } else {
      badgeEl.textContent = 'A verificar...';
      badgeEl.style.background = 'var(--accent-bg)';
      badgeEl.style.color = 'var(--accent-text)';
    }
  }
}

function exibirToastDownloadIniciado(info) {
  const versao = (info && info.version) ? ` (v${info.version})` : '';
  atualizarPainelDebugUpdate(`Nova versão detetada no GitHub${versao}! A descarregar em background...`, 'ok');
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(t._timer);
  t.onclick = null;
  t.title = '';
  t.textContent = `⬇️ A descarregar nova versão${versao} em background...`;
  t.className = 'toast show update-downloading';
  t._timer = setTimeout(() => t.classList.remove('show', 'update-downloading'), 4500);
}

function acionarInstalacaoAtualizacaoOTA() {
  if (window.electronAPI && typeof window.electronAPI.aplicarAtualizacao === 'function') {
    window.electronAPI.aplicarAtualizacao();
  } else if (window.electronAPI && typeof window.electronAPI.invocar === 'function') {
    window.electronAPI.invocar('aplicar-atualizacao');
  } else if (window.electronAPI && typeof window.electronAPI.enviar === 'function') {
    window.electronAPI.enviar('aplicar-atualizacao');
  }
}

function exibirToastAtualizacaoPronta(info) {
  const versao = (info && info.version) ? ` (v${info.version})` : '';
  atualizarPainelDebugUpdate(`Download concluído${versao}! Pronto para reiniciar e aplicar.`, 'ok');
  const t = document.getElementById('toast');
  if (!t) return;
  clearTimeout(t._timer);
  t.textContent = '🚀 Nova versão pronta! Clique aqui para reiniciar e atualizar.';
  t.title = 'Clique para reiniciar e instalar a atualização agora';
  t.className = 'toast show update-ready';
  t.onclick = () => {
    t.classList.remove('show', 'update-ready');
    t.onclick = null;
    acionarInstalacaoAtualizacaoOTA();
  };
  t._timer = setTimeout(() => {
    t.classList.remove('show', 'update-ready');
    t.onclick = null;
  }, 60000);
}

async function forcarVerificacaoUpdateDebug() {
  const btn = document.getElementById('btn-forcar-update');
  if (!window.electronAPI || typeof window.electronAPI.verificarAtualizacoesAgora !== 'function') {
    const msg = 'Verificação automática de atualizações disponível apenas no aplicativo Desktop.';
    atualizarPainelDebugUpdate(msg, 'erro');
    toast('⚠️ ' + msg, 'bad');
    return { ok: false, erro: msg };
  }

  try {
    if (btn) btn.disabled = true;
    atualizarPainelDebugUpdate('Consultando servidor de lançamentos no GitHub...', 'info');
    toast('🔍 Procurando atualizações...', 'ok');

    const res = await window.electronAPI.verificarAtualizacoesAgora();
    if (res && res.ok === false && res.erro) {
      console.error('[Auto-Update Erro]:', res.erro);
      atualizarPainelDebugUpdate(`Erro retornado na verificação: ${res.erro}`, 'erro');
      if (Date.now() - ultimoErroUpdateTimestamp > 800) {
        ultimoErroUpdateTimestamp = Date.now();
        toast(`❌ Erro no Update: ${String(res.erro).slice(0, 120)}`, 'bad');
      }
    } else if (res && res.updateInfo) {
      const vRemota = res.updateInfo.version || 'desconhecida';
      atualizarPainelDebugUpdate(`Versão disponível no repositório: v${vRemota} (Instalada: v${CURRENT_VERSION})`, 'ok');
    }
    return res;
  } catch (err) {
    const msg = (err && err.message) ? err.message : String(err);
    console.error('[Auto-Update Exceção]:', msg);
    atualizarPainelDebugUpdate(`Falha ao procurar atualização: ${msg}`, 'erro');
    toast(`❌ Falha ao procurar atualização: ${msg.slice(0, 120)}`, 'bad');
    return { ok: false, erro: msg };
  } finally {
    if (btn) btn.disabled = false;
  }
}

function inicializarAutoUpdateOTA() {
  const btnForcar = document.getElementById('btn-forcar-update');
  if (btnForcar && !btnForcar._listenerRegistrado) {
    btnForcar._listenerRegistrado = true;
    btnForcar.addEventListener('click', forcarVerificacaoUpdateDebug);
  }

  if (autoUpdateListenersRegistrados) return;
  autoUpdateListenersRegistrados = true;

  if (window.electronAPI && typeof window.electronAPI.onDownloadIniciado === 'function') {
    window.electronAPI.onDownloadIniciado((info) => {
      exibirToastDownloadIniciado(info);
    });
  }

  if (window.electronAPI && typeof window.electronAPI.onDownloadConcluido === 'function') {
    window.electronAPI.onDownloadConcluido((info) => {
      exibirToastAtualizacaoPronta(info);
    });
  }

  if (window.electronAPI && typeof window.electronAPI.onUpdateNaoDisponivel === 'function') {
    window.electronAPI.onUpdateNaoDisponivel((info) => {
      const vRemota = (info && info.version) ? info.version : CURRENT_VERSION;
      const msg = `Nenhuma atualização superior disponível no GitHub (Remota: v${vRemota} | Local: v${CURRENT_VERSION}).`;
      console.info('[Auto-Update]:', msg);
      atualizarPainelDebugUpdate(msg, 'ok');
      toast(`✅ Já está na versão mais recente (v${vRemota}).`, 'ok');
    });
  }

  if (window.electronAPI && typeof window.electronAPI.onUpdateErro === 'function') {
    window.electronAPI.onUpdateErro((errMessage) => {
      const textoErro = typeof errMessage === 'string' ? errMessage : JSON.stringify(errMessage);
      console.error('[Auto-Update Erro do Backend]:', textoErro);
      atualizarPainelDebugUpdate(`Erro do GitHub / electron-updater: ${textoErro}`, 'erro');
      ultimoErroUpdateTimestamp = Date.now();
      toast(`❌ Erro Auto-Update: ${textoErro.slice(0, 130)}`, 'bad');
    });
  }
}

/* ================= 3. FEEDBACK SONORO TÁTIL (SOUNDSCAPE - WEB AUDIO API) ================= */
class SoundScape {
  static _ctx = null;

  static getContext() {
    try {
      if (!SoundScape._ctx) {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          SoundScape._ctx = new AudioCtx();
        }
      }
      if (SoundScape._ctx && SoundScape._ctx.state === 'suspended' && typeof SoundScape._ctx.resume === 'function') {
        SoundScape._ctx.resume().catch(() => {});
      }
      return SoundScape._ctx;
    } catch (e) {
      return null;
    }
  }

  static _reproduzirTom({ freqInicial, freqFinal, rampFreqEm, gainInicial, rampGainEm, duracao }) {
    try {
      const ctx = SoundScape.getContext();
      if (!ctx) return false;
      const now = ctx.currentTime;

      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freqInicial, now);
      osc.frequency.exponentialRampToValueAtTime(freqFinal, now + rampFreqEm);

      gain.gain.setValueAtTime(gainInicial, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + rampGainEm);

      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.onended = () => {
        try { osc.disconnect(); } catch (e) {}
        try { gain.disconnect(); } catch (e) {}
      };
      osc.start(now);
      osc.stop(now + duracao);
      return true;
    } catch (e) {
      return false;
    }
  }

  /**
   * Som agudo e subtil de "vidro / bolha" ao guardar dados
   */
  static playSave() {
    return SoundScape._reproduzirTom({
      freqInicial: 880,
      freqFinal: 1318.5,
      rampFreqEm: 0.09,
      gainInicial: 0.075,
      rampGainEm: 0.16,
      duracao: 0.17
    });
  }

  /**
   * Som abafado e grave ao apagar dados
   */
  static playDelete() {
    return SoundScape._reproduzirTom({
      freqInicial: 195,
      freqFinal: 55,
      rampFreqEm: 0.18,
      gainInicial: 0.11,
      rampGainEm: 0.21,
      duracao: 0.22
    });
  }
}

/* ================= 4. VISUALIZADOR DE ANEXOS "SPLIT-VIEW" (50% / 50%) ================= */
let splitViewerLancamentoAtual = null;

function atualizarOffsetTopSplitViewer() {
  const mainEl = document.getElementById('main-workspace') || document.querySelector('main.main, .main');
  const topbar = document.querySelector('.topbar');
  if (!mainEl) return;
  if (topbar && topbar.offsetHeight > 0) {
    const offsetTop = (topbar.offsetTop || 0) + topbar.offsetHeight;
    mainEl.style.setProperty('--split-viewer-top', `${offsetTop}px`);
  } else {
    mainEl.style.setProperty('--split-viewer-top', '57px');
  }
}

function abrirSplitViewerLancamento(lancamentoOuId) {
  const l = typeof lancamentoOuId === 'string'
    ? (STATE.lancamentos || []).find(x => x.id === lancamentoOuId)
    : lancamentoOuId;
  if (!l) return;

  const mainEl = document.getElementById('main-workspace') || document.querySelector('main.main, .main');
  const viewer = document.getElementById('split-viewer');
  const imgEl = document.getElementById('split-viewer-img');
  const iframeEl = document.getElementById('split-viewer-iframe');
  const fallbackEl = document.getElementById('split-viewer-fallback');
  const titleEl = document.getElementById('split-viewer-title');
  const subEl = document.getElementById('split-viewer-subtitle');
  const btnAmpliar = document.getElementById('split-viewer-btn-ampliar');

  if (!mainEl || !viewer) {
    if (l.comprovante) verComprovante(l.comprovante);
    return;
  }

  splitViewerLancamentoAtual = l;
  atualizarOffsetTopSplitViewer();

  const [a, m, d] = (l.data || '').split('-');
  const dataFmt = a ? `${d}/${m}/${a}` : (l.data || '-');
  if (titleEl) titleEl.textContent = l.anexoNome || l.descricao || 'Comprovante anexado';
  if (subEl) subEl.textContent = `${l.descricao || 'Lançamento'} · ${toBRL(l.valor)} · ${dataFmt} (${l.conta || '-'})`;

  const src = l.comprovante || '';
  const nomeArq = (l.anexoNome || '').toLowerCase();
  const pathArq = l.anexoPath || '';
  const ehPdf = src.startsWith('data:application/pdf') || /\.pdf$/i.test(nomeArq) || /\.pdf$/i.test(pathArq);
  const ehImagem = src.startsWith('data:image/') || (!!src && !ehPdf);

  if (imgEl) {
    imgEl.style.display = 'none';
    imgEl.removeAttribute('src');
  }
  if (iframeEl) {
    iframeEl.style.display = 'none';
    iframeEl.removeAttribute('src');
  }
  if (fallbackEl) {
    fallbackEl.style.display = 'none';
    fallbackEl.innerHTML = '';
  }

  if (ehPdf && (src || pathArq)) {
    if (iframeEl) {
      iframeEl.src = src || pathArq;
      iframeEl.style.display = 'block';
    }
    if (btnAmpliar) btnAmpliar.style.display = 'none';
  } else if (ehImagem && src) {
    if (imgEl) {
      imgEl.src = src;
      imgEl.style.display = 'block';
    }
    if (btnAmpliar) btnAmpliar.style.display = '';
  } else if (fallbackEl) {
    fallbackEl.style.display = 'block';
    fallbackEl.innerHTML = `
      <div style="font-size:36px;color:var(--accent);margin-bottom:10px"><i class="ti ti-file-description"></i></div>
      <div style="font-weight:700;font-size:14px;color:var(--text);margin-bottom:4px">${escHtml(l.anexoNome || 'Anexo Registrado')}</div>
      <div class="help-text" style="word-break:break-all">${escHtml(pathArq || 'Referência de anexo salva no lançamento.')}</div>
    `;
    if (btnAmpliar) btnAmpliar.style.display = 'none';
  }

  mainEl.classList.add('split-active');
  viewer.setAttribute('aria-hidden', 'false');
}

function fecharSplitViewer() {
  const mainEl = document.getElementById('main-workspace') || document.querySelector('main.main, .main');
  const viewer = document.getElementById('split-viewer');
  const iframeEl = document.getElementById('split-viewer-iframe');
  if (mainEl) mainEl.classList.remove('split-active');
  if (viewer) viewer.setAttribute('aria-hidden', 'true');
  if (iframeEl) iframeEl.removeAttribute('src');
  splitViewerLancamentoAtual = null;
}

function ampliarComprovanteDoSplitViewer() {
  if (splitViewerLancamentoAtual && splitViewerLancamentoAtual.comprovante) {
    verComprovante(splitViewerLancamentoAtual.comprovante);
  }
}

/* ================= 5. SKELETON SCREENS EM VIDRO (PREMIUM LOADING STATE) ================= */
const BENTO_SKELETON_CARD_IDS = [
  'dash-chart-card',
  'dash-saldo-contas-card',
  'dash-reembolsos-card',
  'dash-top3-categorias-card',
  'dash-antimetas-card',
  'dash-pendentes-card',
  'dash-ultimos-card'
];

function alternarEstadoCarregamento(ativo) {
  const isAtivo = Boolean(ativo);
  const container = document.getElementById('dash-modular-container');
  const kpisGrid = document.getElementById('dash-kpis');

  const cardsAlvo = [];
  BENTO_SKELETON_CARD_IDS.forEach(id => {
    const el = document.getElementById(id);
    if (el) cardsAlvo.push(el);
  });
  if (container && typeof container.querySelectorAll === 'function') {
    const extras = container.querySelectorAll('.bento-item, .card.dash-draggable');
    if (extras && extras.forEach) {
      extras.forEach(el => {
        if (el && el.id !== 'dash-kpis' && !cardsAlvo.includes(el)) cardsAlvo.push(el);
      });
    }
  }

  if (isAtivo) {
    if (kpisGrid) {
      const kpiCards = typeof kpisGrid.querySelectorAll === 'function' ? kpisGrid.querySelectorAll('.metric') : [];
      if (kpiCards && kpiCards.length > 0) {
        kpiCards.forEach(m => m.classList.add('skeleton-glass'));
      } else {
        kpisGrid.classList.add('skeleton-glass');
        if (typeof kpisGrid.setAttribute === 'function') kpisGrid.setAttribute('data-skeleton-temp-kpis', '1');
        kpisGrid.innerHTML = Array.from({ length: 6 }).map(() => `
          <div class="metric skeleton-glass" aria-hidden="true">
            <div class="skeleton-bar sk-title"></div>
            <div class="skeleton-bar sk-lg" style="margin:8px 0"></div>
            <div class="skeleton-bar sk-sm"></div>
            <span class="skeleton-invisible-text">A carregar indicador...</span>
          </div>
        `).join('');
      }
    }

    cardsAlvo.forEach(card => {
      card.classList.add('skeleton-glass');
      if (typeof card.setAttribute === 'function') card.setAttribute('aria-busy', 'true');
      const jaTemOverlay = typeof card.querySelector === 'function' && card.querySelector('.skeleton-placeholder-overlay');
      if (!jaTemOverlay && typeof document.createElement === 'function') {
        const overlay = document.createElement('div');
        overlay.className = 'skeleton-placeholder-overlay';
        if (typeof overlay.setAttribute === 'function') overlay.setAttribute('aria-hidden', 'true');
        overlay.innerHTML = `
          <div class="skeleton-bar sk-title"></div>
          <div class="skeleton-bar sk-lg"></div>
          <div class="skeleton-bar sk-md"></div>
          <div class="skeleton-bar sk-sm"></div>
          <span class="skeleton-invisible-text">A carregar dados financeiros...</span>
        `;
        if (typeof card.appendChild === 'function') {
          card.appendChild(overlay);
        }
      }
    });
  } else {
    if (kpisGrid) {
      kpisGrid.classList.remove('skeleton-glass');
      if (typeof kpisGrid.getAttribute === 'function' && kpisGrid.getAttribute('data-skeleton-temp-kpis') === '1') {
        if (typeof kpisGrid.removeAttribute === 'function') kpisGrid.removeAttribute('data-skeleton-temp-kpis');
      }
      const kpiCards = typeof kpisGrid.querySelectorAll === 'function' ? kpisGrid.querySelectorAll('.metric.skeleton-glass') : [];
      if (kpiCards && kpiCards.forEach) {
        kpiCards.forEach(m => m.classList.remove('skeleton-glass'));
      }
    }

    cardsAlvo.forEach(card => {
      card.classList.remove('skeleton-glass');
      if (typeof card.removeAttribute === 'function') card.removeAttribute('aria-busy');
      if (typeof card.querySelectorAll === 'function') {
        const overlays = card.querySelectorAll('.skeleton-placeholder-overlay');
        if (overlays && overlays.forEach) {
          overlays.forEach(ov => {
            if (ov && typeof ov.remove === 'function') ov.remove();
            else if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
          });
        }
      }
    });
  }

  return isAtivo;
}

/* ================= 6. MODAL DE PATCH NOTES / CHANGELOG ================= */
function abrirModalPatchNotes() {
  const badgeEl = document.getElementById('patch-notes-version-badge');
  if (badgeEl) badgeEl.innerHTML = `<i class="ti ti-rocket"></i> v${CURRENT_VERSION}`;
  abrirModal('modal-patch-notes');
}

async function fecharModalPatchNotes() {
  if (!STATE.config) STATE.config = {};
  STATE.config.lastSeenVersion = CURRENT_VERSION;
  fecharModal('modal-patch-notes');
  await salvarDados();
}

function verificarPatchNotes() {
  if (!STATE.config) STATE.config = {};
  if (STATE.config.lastSeenVersion !== CURRENT_VERSION) {
    abrirModalPatchNotes();
  }
}

/* ================= MOTOR LOCAL DE EXTRATOS OFX (DRAG & DROP) ================= */
let transacoesPendentes = [];
let _ofxPendenciaVinculo = null;
let _ofxRevisaoContexto = null;

const REGRAS_CATEGORIAS = {
  Transporte: [
    'UBER', '99APP', '99POP', 'CABIFY', 'POSTO', 'IPIRANGA', 'SHELL', 'PETROBRAS',
    'BR MANIA', 'COMBUSTIVEL', 'GASOLINA', 'ETANOL', 'ESTACIONAMENTO', 'SEM PARAR',
    'VELOE', 'PEDAGIO', 'BILHETE UNICO', 'METRO', 'ONIBUS', 'PASSAGEM'
  ],
  Alimentação: [
    'IFOOD', 'RAPPI', 'ZEDELIVERY', 'MCDONALDS', 'BURGER KING', 'STARBUCKS',
    'RESTAURANTE', 'PADARIA', 'LANCHONETE', 'PIZZARIA', 'CHURRASCARIA',
    'SUPERMERCADO', 'MERCADO', 'CARREFOUR', 'ASSAI', 'ATACADAO', 'PAO DE ACUCAR',
    'EXTRA', 'SONDA', 'HORTIFRUTI', 'SACOLAO', 'ACAI', 'CAFETERIA'
  ],
  Moradia: [
    'ALUGUEL', 'CONDOMINIO', 'QUINTOANDAR', 'CPFL', 'ENEL', 'LIGHT', 'CEMIG',
    'COPEL', 'SABESP', 'SANEPAR', 'COMGAS', 'ULTRAGAZ', 'CONTA DE GAS',
    'CLARO', 'VIVO', 'TIM FIBRA', 'OI FIBRA', 'INTERNET', 'ENERGIA', 'LUZ',
    'AGUA', 'IPTU'
  ],
  Saúde: [
    'DROGASIL', 'DROGARIA', 'RAIA', 'PACHECO', 'ULTRAFARMA', 'PAGUE MENOS',
    'FARMACIA', 'HOSPITAL', 'CLINICA', 'LABORATORIO', 'FLEURY', 'DELBONI',
    'EXAME', 'UNIMED', 'AMIL', 'SULAMERICA', 'BRADESCO SAUDE', 'ODONTO',
    'SMARTFIT', 'BLUEFIT', 'ACADEMIA', 'GYMPASS', 'WELLHUB'
  ],
  Educação: [
    'UDEMY', 'ALURA', 'COURSERA', 'ROCKETSEAT', 'FACULDADE', 'UNIVERSIDADE',
    'ESCOLA', 'MENSALIDADE ESCOLAR', 'SARAIVA', 'AMAZON LIVROS', 'LIVRARIA',
    'HOTMART', 'KIWIFY', 'DUOLINGO'
  ],
  Lazer: [
    'CINEMARK', 'CINEPOLIS', 'INGRESSO', 'SYMPLA', 'EVENTIM', 'AIRBNB',
    'BOOKING', 'HOTEL', 'POUSADA', 'PLAYSTATION', 'XBOX', 'STEAM', 'NINTENDO',
    'SHOPPING', 'VIAGEM', 'TEATRO', 'PARQUE'
  ],
  Assinaturas: [
    'NETFLIX', 'SPOTIFY', 'AMAZON PRIME', 'PRIME VIDEO', 'DISNEY', 'HBO MAX',
    'YOUTUBE', 'APPLE.COM/BILL', 'ICLOUD', 'GOOGLE ONE', 'CHATGPT', 'OPENAI',
    'MICROSOFT', 'ADOBE', 'CANVA', 'GLOBOPLAY', 'MUBI', 'DEEZER'
  ],
  Salário: [
    'SALARIO', 'PAGTO SALARIO', 'FOLHA', 'REMUNERACAO', 'DECIMO TERCEIRO',
    '13 SALARIO', 'FERIAS', 'PRO-LABORE', 'VALE REFEICAO', 'VALE ALIMENTACAO'
  ],
  Investimentos: [
    'DIVIDEND', 'JCP', 'RENDIMENTO', 'RESGATE CDB', 'TESOURO', 'CORRETORA',
    'XP INVEST', 'BTG PACTUAL', 'NUINVEST', 'RICO', 'CLEAR', 'POUPANCA'
  ],
  Freelance: [
    'FREELA', 'SERVICOS PRESTADOS', 'HONORARIOS', 'CONSULTORIA', 'NOTA FISCAL'
  ]
};

const CATEGORIAS_OFX_RECEITA = new Set(['Salário', 'Freelance', 'Investimentos']);

function normalizarTextoBuscaOFX(texto) {
  return String(texto || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function resolverNomeCategoriaNoStateOFX(nomeRegra, tipo) {
  const categorias = Array.isArray(STATE.categorias) ? STATE.categorias : [];
  const alvoLower = String(nomeRegra || '').toLowerCase();
  const matchTipo = categorias.find(
    c => c && c.nome && c.nome.toLowerCase() === alvoLower && (!tipo || c.tipo === tipo)
  );
  if (matchTipo) return matchTipo.nome;
  const matchQualquer = categorias.find(c => c && c.nome && c.nome.toLowerCase() === alvoLower);
  if (matchQualquer) return matchQualquer.nome;
  return nomeRegra;
}

function autoCategorizar(memo, tipo, extrasOpt) {
  const textoLimpo = String(memo || '').trim();
  if (!textoLimpo) return CATEGORIA_A_CLASSIFICAR;

  if (typeof autoClassificarLancamento === 'function') {
    const res = autoClassificarLancamento(
      {
        descricao: textoLimpo,
        descricaoOriginal: textoLimpo,
        tipo: tipo || 'despesa',
        valor: (extrasOpt && extrasOpt.valor) || 0,
        conta: (extrasOpt && extrasOpt.conta) || '',
        rawCategory: (extrasOpt && extrasOpt.rawCategory) || ''
      },
      extrasOpt || {}
    );
    if (res && res.categoriaCompleta) return res.categoriaCompleta;
  }
  return CATEGORIA_A_CLASSIFICAR;
}

const TIPOS_OFX_DEBITO = new Set([
  'DEBIT',
  'PAYMENT',
  'FEE',
  'SRVCHG',
  'DIRECTDEBIT',
  'CHECK',
  'ATM',
  'POS',
  'CASH'
]);

function decodificarEntidadesOFX(texto) {
  return String(texto || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, '$1')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_m, dec) => {
      const code = parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : '';
    })
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairCampoBlocoOFX(bloco, nomeTag) {
  const raw = String(bloco || '');
  const reFechada = new RegExp(`<${nomeTag}(?:\\s[^>]*)?>([\\s\\S]*?)</${nomeTag}>`, 'i');
  const mFechada = raw.match(reFechada);
  if (mFechada) {
    return decodificarEntidadesOFX(mFechada[1]);
  }
  const reSgml = new RegExp(`<${nomeTag}(?:\\s[^>]*)?>\\s*([^<\\r\\n]+)`, 'i');
  const mSgml = raw.match(reSgml);
  return mSgml ? decodificarEntidadesOFX(mSgml[1]) : '';
}

function normalizarDataOFX(rawDate) {
  return extrairDataLocalISO(rawDate, {
    retornarVazioSeInvalido: true,
    aceitarSerialExcel: false,
    silencioso: true
  });
}

function parseValorOFX(rawAmt) {
  if (typeof rawAmt === 'number') return Number.isFinite(rawAmt) ? rawAmt : NaN;
  const s = String(rawAmt || '').trim();
  if (!s) return NaN;
  const sinalInvertido = s.endsWith('-') && !s.startsWith('-');
  const limpo = sinalInvertido ? `-${s.slice(0, -1)}` : s;
  if (typeof parseValorExtrato === 'function') {
    return parseValorExtrato(limpo);
  }
  const num = parseFloat(limpo.replace(/\s+/g, '').replace(',', '.'));
  return Number.isFinite(num) ? num : NaN;
}

function normalizarTransacaoOFX(campos, mapaFallbackFitid) {
  if (!campos) return null;
  const dataISO = normalizarDataOFX(campos.dtPosted);
  const valorAssinado = parseValorOFX(campos.trnAmt);
  if (!dataISO || !Number.isFinite(valorAssinado) || valorAssinado === 0) return null;

  const valor = Math.round(Math.abs(valorAssinado) * 100) / 100;
  if (valor <= 0) return null;

  const trnType = String(campos.trnType || '').trim().toUpperCase() || (valorAssinado < 0 ? 'DEBIT' : 'CREDIT');
  const amtRaw = String(campos.trnAmt || '').trim();
  const ehDebito = valorAssinado < 0 || (!amtRaw.startsWith('+') && TIPOS_OFX_DEBITO.has(trnType));
  const tipo = ehDebito ? 'despesa' : 'receita';

  const memoLimpo = String(campos.memo || '').trim();
  const nameLimpo = String(campos.name || '').trim();
  const memo = memoLimpo || nameLimpo || 'Transação OFX';
  const descricao = memo;

  let fitid = String(campos.fitid || '').trim();
  if (!fitid) {
    const chaveBase = `ofx_auto_${dataISO}_${trnType}_${valor.toFixed(2)}_${memo.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'tx'}`;
    const ocorrencia = (mapaFallbackFitid.get(chaveBase) || 0) + 1;
    mapaFallbackFitid.set(chaveBase, ocorrencia);
    fitid = `${chaveBase}_${ocorrencia}`;
  }

  const categoria = autoCategorizar(memo, tipo);

  return {
    fitid,
    trnType,
    data: dataISO,
    valor,
    valorAssinado: Math.round(valorAssinado * 100) / 100,
    tipo,
    memo,
    descricao,
    categoria
  };
}

function extrairMetadadosOFX(texto) {
  const src = String(texto || '').replace(/^\uFEFF/, '');
  const org = extrairCampoBlocoOFX(src, 'ORG');
  const bankId = extrairCampoBlocoOFX(src, 'BANKID');
  const acctId = (extrairCampoBlocoOFX(src, 'ACCTID') || extrairCampoBlocoOFX(src, 'CARDID')).trim();
  const curDef = extrairCampoBlocoOFX(src, 'CURDEF') || 'BRL';
  const ledgerAmt = parseValorOFX(extrairCampoBlocoOFX(src, 'BALAMT'));
  const ehCartao = /<CREDITCARDMSGSRSV\d*>|<CCSTMTRS\b|<CCSTMTTRNRS\b/i.test(src);

  return {
    org,
    bankId,
    acctId,
    acctMascarada: acctId ? acctId.slice(-4) : '',
    curDef,
    ledgerBalance: Number.isFinite(ledgerAmt) ? Math.round(ledgerAmt * 100) / 100 : null,
    ehCartao
  };
}

function parseOFX(texto) {
  if (typeof texto !== 'string' && !(texto instanceof String)) {
    return { acctId: '', bankId: '', org: '', curDef: 'BRL', ledgerBalance: null, ehCartao: false, transacoes: [] };
  }
  const limpo = String(texto).replace(/^\uFEFF/, '').trim();
  if (!limpo) {
    return { acctId: '', bankId: '', org: '', curDef: 'BRL', ledgerBalance: null, ehCartao: false, transacoes: [] };
  }

  const metadados = extrairMetadadosOFX(limpo);
  const mapaFallbackFitid = new Map();
  const transacoes = [];

  // Tenta DOMParser quando o ficheiro OFX 2.x for XML bem-formado com tags de fechamento
  if (typeof DOMParser !== 'undefined' && /<\/STMTTRN>/i.test(limpo) && /<\?xml/i.test(limpo)) {
    try {
      const inicioXml = limpo.indexOf('<');
      const xmlCandidato = inicioXml >= 0 ? limpo.slice(inicioXml) : limpo;
      const doc = new DOMParser().parseFromString(xmlCandidato, 'text/xml');
      const parserErro = doc && doc.getElementsByTagName('parsererror');
      const nos = doc && (!parserErro || parserErro.length === 0)
        ? Array.from(doc.getElementsByTagName('STMTTRN'))
        : [];

      if (doc && (!parserErro || parserErro.length === 0) && !metadados.acctId) {
        const acctEls = doc.getElementsByTagName('ACCTID');
        const cardEls = doc.getElementsByTagName('CARDID');
        const acctDom = (acctEls && acctEls.length ? acctEls[0].textContent : (cardEls && cardEls.length ? cardEls[0].textContent : '')) || '';
        metadados.acctId = decodificarEntidadesOFX(acctDom);
        metadados.acctMascarada = metadados.acctId ? metadados.acctId.slice(-4) : '';
      }

      if (nos.length > 0) {
        for (const no of nos) {
          const lerNo = (tag) => {
            const filhos = no.getElementsByTagName(tag);
            if (!filhos || !filhos.length) {
              const minuscula = no.getElementsByTagName(tag.toLowerCase());
              return minuscula && minuscula.length ? decodificarEntidadesOFX(minuscula[0].textContent) : '';
            }
            return decodificarEntidadesOFX(filhos[0].textContent);
          };
          try {
            const tx = normalizarTransacaoOFX({
              trnType: lerNo('TRNTYPE'),
              dtPosted: lerNo('DTPOSTED'),
              trnAmt: lerNo('TRNAMT'),
              fitid: lerNo('FITID'),
              memo: lerNo('MEMO'),
              name: lerNo('NAME')
            }, mapaFallbackFitid);
            if (tx) transacoes.push(tx);
          } catch (errXmlItem) {
            console.warn('[OFX] Bloco XML malformado ignorado:', errXmlItem);
          }
        }
        if (transacoes.length > 0) {
          return { ...metadados, transacoes };
        }
      }
    } catch (errDom) {
      console.warn('[OFX] Fallback para parser SGML:', errDom);
    }
  }

  // Parser SGML/XML resiliente por bloco <STMTTRN> (compatível com OFX 1.x sem fechamento de tags)
  const blocos = limpo.match(/<STMTTRN\b[^>]*>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN\b|<\/BANKTRANLIST>|<\/CCSTMTRS>|<\/STMTRS>|$))/gi) || [];
  for (const bloco of blocos) {
    try {
      const tx = normalizarTransacaoOFX({
        trnType: extrairCampoBlocoOFX(bloco, 'TRNTYPE'),
        dtPosted: extrairCampoBlocoOFX(bloco, 'DTPOSTED'),
        trnAmt: extrairCampoBlocoOFX(bloco, 'TRNAMT'),
        fitid: extrairCampoBlocoOFX(bloco, 'FITID'),
        memo: extrairCampoBlocoOFX(bloco, 'MEMO'),
        name: extrairCampoBlocoOFX(bloco, 'NAME')
      }, mapaFallbackFitid);
      if (tx) transacoes.push(tx);
    } catch (errBloco) {
      console.warn('[OFX] Bloco SGML malformado ignorado:', errBloco);
    }
  }

  return { ...metadados, transacoes };
}

function processarTextoOFX(conteudo, nomeArquivo, arquivoOriginal) {
  const texto = String(conteudo || '');
  if (!texto.trim() || (!/<OFX\b/i.test(texto) && !/<STMTTRN\b/i.test(texto))) {
    toast(`O ficheiro "${nomeArquivo || 'OFX'}" não contém estrutura OFX válida.`, 'err');
    return false;
  }

  // Resiliência contra ficheiros OFX bancários brasileiros gravados em Windows-1252 / ISO-8859-1
  const declaraAnsi = /CHARSET\s*:\s*(1252|8859|ISO-?8859-1)/i.test(texto.slice(0, 512));
  if (arquivoOriginal && !arquivoOriginal._reencodedWin1252 && (declaraAnsi || texto.includes('\uFFFD'))) {
    const readerFallback = new FileReader();
    readerFallback.onload = (ev) => {
      arquivoOriginal._reencodedWin1252 = true;
      processarTextoOFX(String((ev && ev.target && ev.target.result) || ''), nomeArquivo, arquivoOriginal);
    };
    readerFallback.onerror = () => {
      toast('Erro ao decodificar acentuação do ficheiro OFX.', 'err');
    };
    readerFallback.readAsText(arquivoOriginal, 'windows-1252');
    return true;
  }

  const resultadoOFX = parseOFX(texto);
  const transacoes = Array.isArray(resultadoOFX.transacoes) ? resultadoOFX.transacoes : [];
  if (!transacoes.length) {
    toast(`Nenhuma transação válida (<STMTTRN>) encontrada em "${nomeArquivo || 'extrato.ofx'}".`, 'err');
    return false;
  }

  const acctId = String(resultadoOFX.acctId || '').trim();
  const contaVinculada = acctId
    ? (STATE.contas || []).find(c => c && String(c.ofxAccountId || '').trim() === acctId)
    : null;

  if (!contaVinculada) {
    abrirModalVincularOFX(nomeArquivo || 'extrato.ofx', resultadoOFX);
    return true;
  }

  processarNovasTransacoes(transacoes, 'OFX', {
    contaDestino: contaVinculada,
    nomeArquivo: nomeArquivo || 'extrato.ofx',
    metadados: resultadoOFX
  });
  return true;
}

function lerArquivoOFX(file) {
  if (!file) return;
  const nome = String(file.name || '').trim();
  const reader = new FileReader();
  reader.onload = (e) => {
    const conteudo = String((e && e.target && e.target.result) || '');
    processarTextoOFX(conteudo, nome, file);
  };
  reader.onerror = () => toast('Não foi possível ler o ficheiro .OFX selecionado.', 'err');
  reader.readAsText(file, 'UTF-8');
}

function abrirSeletorArquivoOFX() {
  const input = document.getElementById('ofx-file-input');
  if (input) {
    input.value = '';
    input.click();
  }
}

function coletarIdsExistentesImportacao(nomeConta) {
  const ids = new Set();
  const alvo = nomeConta ? String(nomeConta).trim() : '';
  (STATE.lancamentos || []).forEach((l) => {
    if (!l) return;
    // IDs globais de API (Pluggy/externalId) são sempre verificados; FITIDs de arquivo verificam globalmente e na conta
    if (l.pluggyId) ids.add(String(l.pluggyId).trim());
    if (l.externalId) ids.add(String(l.externalId).trim());
    if (!alvo || !l.conta || l.conta === alvo) {
      if (l.fitid) ids.add(String(l.fitid).trim());
      if (l.ofxFitId) ids.add(String(l.ofxFitId).trim());
      if (l.id) ids.add(String(l.id).trim());
    }
  });
  (STATE.excluidosPendentes || []).forEach((idEx) => {
    if (idEx) ids.add(String(idEx).trim());
  });
  return ids;
}
const coletarIdsExistentesContaOFX = coletarIdsExistentesImportacao;

function sugerirContaParaOFX(metadados) {
  const contas = Array.isArray(STATE.contas) ? STATE.contas : [];
  if (!contas.length) return '';
  if (metadados && metadados.org) {
    const orgLower = metadados.org.toLowerCase();
    const matchOrg = contas.find(c => c && c.nome && (orgLower.includes(c.nome.toLowerCase()) || c.nome.toLowerCase().includes(orgLower)));
    if (matchOrg) return matchOrg.nome;
  }
  if (metadados && metadados.ehCartao) {
    const cartao = contas.find(c => c && c.tipo === 'cartao');
    if (cartao) return cartao.nome;
  }
  const contaBancaria = contas.find(c => c && c.tipo !== 'cartao');
  return (contaBancaria || contas[0]).nome;
}

function abrirModalVincularOFX(nomeArquivo, resultadoOFX) {
  const selConta = document.getElementById('ofx-vincular-conta-select');
  const bannerEl = document.getElementById('ofx-vincular-banner');
  const subtituloEl = document.getElementById('ofx-vincular-subtitulo');
  const novaWrap = document.getElementById('ofx-vincular-nova-wrap');
  const novaInput = document.getElementById('ofx-vincular-nova-nome');

  const acctId = String((resultadoOFX && resultadoOFX.acctId) || '').trim();
  const transacoes = Array.isArray(resultadoOFX && resultadoOFX.transacoes) ? resultadoOFX.transacoes : [];

  _ofxPendenciaVinculo = {
    nomeArquivo: String(nomeArquivo || 'extrato.ofx'),
    acctId,
    metadados: resultadoOFX || {},
    transacoes
  };

  if (subtituloEl) {
    subtituloEl.textContent = acctId
      ? `A conta OFX (${acctId}) ainda não está vinculada. Mapeie abaixo para automatizar futuras importações.`
      : `Ficheiro "${_ofxPendenciaVinculo.nomeArquivo}" sem tag <ACCTID>. Escolha a conta de destino antes de revisar.`;
  }

  if (bannerEl) {
    const infos = [
      resultadoOFX && resultadoOFX.org ? escHtml(resultadoOFX.org) : null,
      acctId ? `ACCTID: <code>${escHtml(acctId)}</code>` : 'Sem ACCTID declarado',
      `${transacoes.length} transação(ões) lida(s)`
    ].filter(Boolean).join(' · ');
    bannerEl.innerHTML = `<div><i class="ti ti-building-bank"></i> ${infos}</div>`;
  }

  const contas = Array.isArray(STATE.contas) ? STATE.contas : [];
  if (selConta) {
    const saldos = typeof saldoPorConta === 'function' ? saldoPorConta() : {};
    const sugerida = sugerirContaParaOFX(resultadoOFX);
    const optsExistentes = contas.map((c) => {
      const ehCartao = c.tipo === 'cartao';
      const saldoExib = ehCartao
        ? (Number(c.saldo) || 0)
        : (saldos[c.nome] !== undefined ? saldos[c.nome] : (Number(c.saldo) || 0));
      const selected = c.nome === sugerida ? ' selected' : '';
      return `<option value="${escHtml(c.nome)}"${selected}>${escHtml(c.nome)} (${ehCartao ? 'Cartão' : 'Conta'} · ${escHtml(toBRL(saldoExib))})</option>`;
    }).join('');

    selConta.innerHTML = optsExistentes + `<option value="__nova__"${!contas.length ? ' selected' : ''}>[ + Criar Nova Conta ]</option>`;
  }

  if (novaInput) {
    const sufixoAcct = acctId ? ` (${acctId.slice(-4)})` : '';
    const sugestaoNome = (resultadoOFX && resultadoOFX.org ? `${resultadoOFX.org}${sufixoAcct}` : `Conta OFX${sufixoAcct}`).trim();
    novaInput.value = sugestaoNome;
  }
  if (novaWrap) {
    novaWrap.style.display = selConta && selConta.value === '__nova__' ? '' : 'none';
  }

  abrirModal('modal-vincular-ofx');
}

function aoMudarSelectVinculoOFX() {
  const selConta = document.getElementById('ofx-vincular-conta-select');
  const novaWrap = document.getElementById('ofx-vincular-nova-wrap');
  if (novaWrap && selConta) {
    novaWrap.style.display = selConta.value === '__nova__' ? '' : 'none';
  }
}

async function confirmarVinculoOFX() {
  if (!_ofxPendenciaVinculo) {
    toast('Nenhum extrato pendente para vincular.', 'err');
    cancelarVinculoOFX();
    return;
  }

  const selConta = document.getElementById('ofx-vincular-conta-select');
  const novaInput = document.getElementById('ofx-vincular-nova-nome');
  const escolha = selConta ? selConta.value : '';
  const { nomeArquivo, acctId, metadados, transacoes } = _ofxPendenciaVinculo;

  if (!Array.isArray(STATE.contas)) STATE.contas = [];
  let contaDestino = null;

  if (escolha === '__nova__') {
    const nomeBase = (novaInput && novaInput.value ? novaInput.value : '').trim() || 'Nova Conta OFX';
    let nomeSeguro = nomeBase;
    let contador = 2;
    while (STATE.contas.some(c => c && c.nome && c.nome.toLowerCase() === nomeSeguro.toLowerCase())) {
      nomeSeguro = `${nomeBase} (${contador++})`;
    }
    const ehCartao = Boolean(metadados && metadados.ehCartao);
    contaDestino = {
      id: uid(),
      nome: nomeSeguro,
      tipo: ehCartao ? 'cartao' : 'conta',
      cor: '#1A6FE0',
      saldo: 0
    };
    if (ehCartao) {
      contaDestino.diaFechamento = 1;
      contaDestino.diaVencimento = 10;
      if (!Array.isArray(STATE.cartoes)) STATE.cartoes = [];
      STATE.cartoes.push({
        id: contaDestino.id,
        nome: nomeSeguro,
        limiteTotal: 3000,
        diaFechamento: 1,
        diaVencimento: 10,
        cor: '#1A6FE0'
      });
    }
    STATE.contas.push(contaDestino);
  } else {
    contaDestino = STATE.contas.find(c => c && c.nome === escolha) || null;
  }

  if (!contaDestino) {
    toast('Selecione ou crie uma conta válida para vincular.', 'err');
    return;
  }

  if (acctId) {
    STATE.contas.forEach(c => {
      if (c && c !== contaDestino && String(c.ofxAccountId || '').trim() === acctId) {
        delete c.ofxAccountId;
      }
    });
    contaDestino.ofxAccountId = acctId;
  }

  await salvarDados();
  popularContasSelect();
  cancelarVinculoOFX();
  processarNovasTransacoes(transacoes, 'OFX', {
    contaDestino,
    nomeArquivo,
    metadados
  });
}

function cancelarVinculoOFX(chamadoPorFechamento) {
  _ofxPendenciaVinculo = null;
  if (!chamadoPorFechamento) {
    fecharModal('modal-vincular-ofx');
  } else {
    const el = document.getElementById('modal-vincular-ofx');
    if (el) el.classList.remove('show');
    if (typeof atualizarEstadoModais === 'function') atualizarEstadoModais();
  }
}

function construirOptionsCategoriasOFX(tipo, categoriaSelecionada) {
  if (typeof construirOptionsCategoriasHTML === 'function') {
    return construirOptionsCategoriasHTML(tipo || '', categoriaSelecionada || 'Outros');
  }
  const nomes = new Set(['Outros']);
  (STATE.categorias || []).forEach(c => {
    if (c && c.nome && (!tipo || c.tipo === tipo)) nomes.add(c.nome);
  });
  Object.keys(REGRAS_CATEGORIAS).forEach(k => nomes.add(k));
  if (categoriaSelecionada) nomes.add(categoriaSelecionada);

  return [...nomes].map(nome => (
    `<option value="${escHtml(nome)}"${nome === categoriaSelecionada ? ' selected' : ''}>${escHtml(nome)}</option>`
  )).join('');
}

function mapearCategoriaPluggy(categoriaPluggy, descricao, tipo) {
  const catRaw = String(categoriaPluggy || '').trim();
  if (catRaw) {
    const exata = (STATE.categorias || []).find(
      c => c && c.nome && (!tipo || c.tipo === tipo) && c.nome.toLowerCase() === catRaw.toLowerCase()
    );
    if (exata) return exata.nome;

    const cLow = catRaw.toLowerCase();
    const mapaSemantico = [
      { padrao: /food|grocer|restaur|eating|supermarket|alimenta|mercado|padaria|delivery|lanche/i, nome: 'Alimentação' },
      { padrao: /transport|taxi|ride|uber|fuel|gas|parking|auto|combust|pedagio/i, nome: 'Transporte' },
      { padrao: /hous|rent|utilit|electric|water|internet|phone|moradia|aluguel|condom|energia/i, nome: 'Moradia' },
      { padrao: /health|pharmac|medical|doctor|dentist|hospital|gym|sa[uú]de|farm[aá]cia|academia/i, nome: 'Saúde' },
      { padrao: /educat|school|college|university|book|course|educa|curso|livro|faculdade/i, nome: 'Educação' },
      { padrao: /entertain|leisure|movie|music|game|travel|hotel|lazer|viagem|passeio|cinema/i, nome: 'Lazer' },
      { padrao: /subscript|streaming|software|digital|assinatura/i, nome: 'Assinaturas' },
      { padrao: /salary|payroll|wage|sal[aá]rio|remunera/i, nome: 'Salário' },
      { padrao: /invest|dividend|interest|rendimento|fii/i, nome: 'Investimentos' },
      { padrao: /freelanc|service|consulting|consultoria|servi[cç]o/i, nome: 'Freelance' }
    ];
    for (const item of mapaSemantico) {
      if (item.padrao.test(cLow)) {
        return resolverNomeCategoriaNoStateOFX(item.nome, tipo);
      }
    }
  }
  return autoCategorizar(descricao, tipo);
}

function normalizarTipoContaPluggy(accountTypeBruto, origemNorm = 'OFX') {
  if (String(origemNorm || '').toUpperCase() === 'OFX') return 'BANK';
  const t = String(accountTypeBruto || '').trim().toUpperCase();
  if (t === 'CREDIT' || t === 'CREDIT_CARD' || t === 'CARTAO' || t === 'CARTÃO') {
    return 'CREDIT';
  }
  return 'BANK';
}

function construirChaveOrigemPluggy(accountName, accountType) {
  const tipo = normalizarTipoContaPluggy(accountType, 'PLUGGY');
  const nome = String(accountName || '').trim() || (tipo === 'CREDIT' ? 'Cartão de Crédito' : 'Conta Corrente');
  return `${tipo}::${nome}`;
}

function sugerirNomeContaDestinoCOFIN(accountName, accountType, contaPadraoFallback, temMultiplasOrigensBanco = false) {
  if (typeof sincronizarEstruturaCartoes === 'function') sincronizarEstruturaCartoes();
  if (!Array.isArray(STATE.contas)) STATE.contas = [];

  const tipoNorm = normalizarTipoContaPluggy(accountType, 'PLUGGY');
  const nomeBruto = String(accountName || '').trim();
  const nLow = nomeBruto.toLowerCase();

  const cartoes = STATE.contas.filter(c => c && c.tipo === 'cartao' && c.nome);
  const contasBancarias = STATE.contas.filter(c => c && c.tipo !== 'cartao' && c.nome);

  const tentarMatchPorNome = (lista) => {
    if (!nLow || !lista.length) return null;
    const exata = lista.find(c => c.nome.toLowerCase() === nLow);
    if (exata) return exata;
    const parcial = lista.find(c => nLow.includes(c.nome.toLowerCase()) || c.nome.toLowerCase().includes(nLow));
    if (parcial) return parcial;
    const tokens = nLow.split(/[^a-zà-ÿ0-9]+/i).filter(t => t.length >= 3);
    if (tokens.length) {
      const porToken = lista.find(c => tokens.some(tok => c.nome.toLowerCase().includes(tok)));
      if (porToken) return porToken;
    }
    return null;
  };

  if (tipoNorm === 'CREDIT') {
    const matchCartao = tentarMatchPorNome(cartoes);
    if (matchCartao) return matchCartao.nome;
    if (cartoes.length === 1) return cartoes[0].nome;
    if (cartoes.length > 1) return cartoes[0].nome;
    // Se ainda não houver nenhum cartão cadastrado no COFIN, sugere criar automaticamente um Cartão de Crédito com o nome vindo do Pluggy
    const nomeNovoCartao = nomeBruto ? `Cartão ${nomeBruto}` : 'Cartão de Crédito Pluggy';
    return `__CRIAR_CARTAO__:${nomeNovoCartao}`;
  }

  const matchConta = tentarMatchPorNome(contasBancarias);
  if (matchConta) return matchConta.nome;
  if (temMultiplasOrigensBanco && nomeBruto) {
    return `__CRIAR_CONTA__:${nomeBruto}`;
  }
  if (contaPadraoFallback && contaPadraoFallback.tipo !== 'cartao' && contaPadraoFallback.nome) {
    return contaPadraoFallback.nome;
  }
  if (contasBancarias[0]) return contasBancarias[0].nome;
  if (contaPadraoFallback && contaPadraoFallback.nome) return contaPadraoFallback.nome;
  return 'Conta Principal';
}

function construirOptionsContasECartoesRevisaoHTML(valorSelecionado, accountTypeSugerido, accountNameSugerido) {
  if (typeof sincronizarEstruturaCartoes === 'function') sincronizarEstruturaCartoes();
  const contas = Array.isArray(STATE.contas) ? STATE.contas : [];
  const contasBancarias = contas.filter(c => c && c.tipo !== 'cartao' && c.nome);
  const cartoes = contas.filter(c => c && c.tipo === 'cartao' && c.nome);
  const tipoNorm = normalizarTipoContaPluggy(accountTypeSugerido, 'PLUGGY');
  const nomeBruto = String(accountNameSugerido || '').trim();

  const opcoesCartoes = cartoes.map(c => (
    `<option value="${escHtml(c.nome)}"${c.nome === valorSelecionado ? ' selected' : ''}>💳 ${escHtml(c.nome)} (Cartão)</option>`
  )).join('');

  const opcoesBancos = contasBancarias.map(c => (
    `<option value="${escHtml(c.nome)}"${c.nome === valorSelecionado ? ' selected' : ''}>🏦 ${escHtml(c.nome)} (Conta/Débito)</option>`
  )).join('');

  const nomeAutoCartao = nomeBruto ? ( /^cart[aã]o\b/i.test(nomeBruto) ? nomeBruto : `Cartão ${nomeBruto}` ) : 'Cartão de Crédito Pluggy';
  const valCriarCartao = `__CRIAR_CARTAO__:${nomeAutoCartao}`;
  const jaTemCartaoMesmoNome = cartoes.some(c => c.nome.toLowerCase() === nomeAutoCartao.toLowerCase() || (nomeBruto && c.nome.toLowerCase() === nomeBruto.toLowerCase()));
  const optCriarCartao = (!jaTemCartaoMesmoNome && (tipoNorm === 'CREDIT' || String(valorSelecionado || '').startsWith('__CRIAR_CARTAO__:')))
    ? `<option value="${escHtml(valCriarCartao)}"${valorSelecionado === valCriarCartao ? ' selected' : ''}>✨ Criar "${escHtml(nomeAutoCartao)}" (Novo Cartão)</option>`
    : '';

  const nomeAutoConta = nomeBruto || 'Conta Corrente Pluggy';
  const valCriarConta = `__CRIAR_CONTA__:${nomeAutoConta}`;
  const jaTemContaMesmoNome = contasBancarias.some(c => c.nome.toLowerCase() === nomeAutoConta.toLowerCase());
  const optCriarConta = (!jaTemContaMesmoNome && nomeBruto && (tipoNorm === 'BANK' || String(valorSelecionado || '').startsWith('__CRIAR_CONTA__:')))
    ? `<option value="${escHtml(valCriarConta)}"${valorSelecionado === valCriarConta ? ' selected' : ''}>✨ Criar "${escHtml(nomeAutoConta)}" (Nova Conta)</option>`
    : '';

  let html = '';
  if (tipoNorm === 'CREDIT') {
    if (opcoesCartoes || optCriarCartao) {
      html += `<optgroup label="Cartões de Crédito">${opcoesCartoes}${optCriarCartao}</optgroup>`;
    }
    if (opcoesBancos || optCriarConta) {
      html += `<optgroup label="Contas Bancárias (Débito)">${opcoesBancos}${optCriarConta}</optgroup>`;
    }
  } else {
    if (opcoesBancos || optCriarConta) {
      html += `<optgroup label="Contas Bancárias (Débito)">${opcoesBancos}${optCriarConta}</optgroup>`;
    }
    if (opcoesCartoes || optCriarCartao) {
      html += `<optgroup label="Cartões de Crédito">${opcoesCartoes}${optCriarCartao}</optgroup>`;
    }
  }

  if (!html) {
    html = `<option value="Conta Principal" selected>🏦 Conta Principal</option>`;
  }
  return html;
}

function resolverOuCriarContaDestinoTransacao(valorContaDestino, accountTypeTx, contaFallback) {
  if (typeof sincronizarEstruturaCartoes === 'function') sincronizarEstruturaCartoes();
  if (!Array.isArray(STATE.contas)) STATE.contas = [];
  if (!Array.isArray(STATE.cartoes)) STATE.cartoes = [];

  const val = String(valorContaDestino || '').trim();
  const tipoNorm = normalizarTipoContaPluggy(accountTypeTx, 'PLUGGY');

  if (val.startsWith('__CRIAR_CARTAO__:')) {
    const nomeCartao = val.slice('__CRIAR_CARTAO__:'.length).trim() || 'Cartão de Crédito';
    let existente = STATE.contas.find(c => c && c.nome && c.nome.toLowerCase() === nomeCartao.toLowerCase());
    if (!existente) {
      const novoId = uid();
      existente = {
        id: novoId,
        nome: nomeCartao,
        tipo: 'cartao',
        diaFechamento: 1,
        diaVencimento: 10,
        limite: 5000,
        cor: '#8B5CF6',
        saldo: 0
      };
      STATE.contas.push(existente);
      STATE.cartoes.push({
        id: novoId,
        nome: nomeCartao,
        limiteTotal: 5000,
        diaFechamento: 1,
        diaVencimento: 10,
        cor: '#8B5CF6'
      });
    } else if (existente.tipo !== 'cartao') {
      // Se já existia uma conta bancária com o mesmo nome, cria uma entrada distinta para o cartão
      const nomeDistinto = `${nomeCartao} (Cartão)`;
      let cartaoDistinto = STATE.contas.find(c => c && c.nome && c.nome.toLowerCase() === nomeDistinto.toLowerCase());
      if (!cartaoDistinto) {
        const novoId = uid();
        cartaoDistinto = {
          id: novoId,
          nome: nomeDistinto,
          tipo: 'cartao',
          diaFechamento: 1,
          diaVencimento: 10,
          limite: 5000,
          cor: '#8B5CF6',
          saldo: 0
        };
        STATE.contas.push(cartaoDistinto);
        STATE.cartoes.push({
          id: novoId,
          nome: nomeDistinto,
          limiteTotal: 5000,
          diaFechamento: 1,
          diaVencimento: 10,
          cor: '#8B5CF6'
        });
      }
      return cartaoDistinto;
    }
    return existente;
  }

  if (val.startsWith('__CRIAR_CONTA__:')) {
    const nomeConta = val.slice('__CRIAR_CONTA__:'.length).trim() || 'Conta Corrente';
    let existente = STATE.contas.find(c => c && c.nome && c.nome.toLowerCase() === nomeConta.toLowerCase());
    if (!existente) {
      existente = {
        id: uid(),
        nome: nomeConta,
        tipo: 'conta',
        cor: '#1A6FE0',
        saldo: 0
      };
      STATE.contas.push(existente);
    }
    return existente;
  }

  if (val) {
    const encontrada = STATE.contas.find(c => c && c.nome === val)
      || STATE.contas.find(c => c && c.nome && c.nome.toLowerCase() === val.toLowerCase());
    if (encontrada) return encontrada;
  }

  if (tipoNorm === 'CREDIT') {
    const primeiroCartao = STATE.contas.find(c => c && c.tipo === 'cartao');
    if (primeiroCartao) return primeiroCartao;
  }

  return contaFallback || STATE.contas[0] || { id: uid(), nome: 'Conta Principal', tipo: 'conta', cor: '#1A6FE0', saldo: 0 };
}

function resolverContaDestinoImportacao(opcoesExtras, listaNormalizada) {
  if (typeof sincronizarEstruturaCartoes === 'function') sincronizarEstruturaCartoes();
  if (!Array.isArray(STATE.contas)) STATE.contas = [];
  if (opcoesExtras && opcoesExtras.contaDestino && typeof opcoesExtras.contaDestino === 'object') {
    return opcoesExtras.contaDestino;
  }
  if (opcoesExtras && typeof opcoesExtras.contaNome === 'string' && opcoesExtras.contaNome.trim()) {
    const porNome = STATE.contas.find(c => c && c.nome === opcoesExtras.contaNome.trim());
    if (porNome) return porNome;
  }

  const txComConta = (listaNormalizada || []).find(t => t && (t.accountName || t.conta));
  if (txComConta) {
    const nomeSugeridoTx = txComConta.accountName || txComConta.conta || '';
    const tipoTx = txComConta.accountType || 'BANK';
    const sLow = nomeSugeridoTx.toLowerCase();
    const candidatos = tipoTx === 'CREDIT'
      ? STATE.contas.filter(c => c && c.tipo === 'cartao')
      : STATE.contas.filter(c => c && c.tipo !== 'cartao');
    const matchConta = candidatos.find(
      c => c && c.nome && (c.nome.toLowerCase() === sLow || sLow.includes(c.nome.toLowerCase()) || c.nome.toLowerCase().includes(sLow))
    );
    if (matchConta) return matchConta;
  }

  const primeiraBancaria = STATE.contas.find(c => c && c.tipo !== 'cartao');
  if (primeiraBancaria) return primeiraBancaria;
  if (STATE.contas[0]) return STATE.contas[0];

  const contaPadrao = { id: uid(), nome: 'Conta Principal', tipo: 'conta', cor: '#1A6FE0', saldo: 0 };
  STATE.contas.push(contaPadrao);
  return contaPadrao;
}

function ehTransacaoPagamentoFaturaPluggy(memo, rawCategory = '') {
  const texto = String(memo || '').trim();
  const cat = String(rawCategory || '').trim();
  if (/credit\s*card\s*payment|pagamento\s*(?:de\s*)?fatura/i.test(cat)) return true;
  return /pagamento\s*(?:de\s*|da\s*|efetuado\s*(?:de\s*|na\s*)?)?fatura|pagamento\s*recebido|pag(?:to|amento)?\.?\s*recebido|fatura\s*paga|bill\s*payment|pgto\.?\s*fatura|pagto\.?\s*fatura|cr[eé]dito\s*(?:em\s*)?fatura/i.test(texto);
}

function obterConfigCartaoParaRevisao(destinoNome) {
  const bruto = String(destinoNome || '').trim();
  const ehMarcadorNovo = /^__CRIAR_CARTAO__:/i.test(bruto);
  const nomeLimpo = bruto.replace(/^__CRIAR_CARTAO__:/i, '').trim();
  const nomeLower = nomeLimpo.toLowerCase();
  const cartao = (STATE.contas || []).find(c => c && c.tipo === 'cartao' && String(c.nome || '').trim().toLowerCase() === nomeLower)
    || (STATE.cartoes || []).find(c => c && String(c.nome || '').trim().toLowerCase() === nomeLower)
    || null;
  if (cartao) {
    return {
      cartao,
      nomeCartao: cartao.nome,
      isCartao: true,
      diaFechamento: parseInt(cartao.diaFechamento, 10) || 1,
      diaVencimento: parseInt(cartao.diaVencimento, 10) || 10
    };
  }
  return {
    cartao: null,
    nomeCartao: nomeLimpo,
    isCartao: ehMarcadorNovo,
    diaFechamento: 1,
    diaVencimento: 10
  };
}

function estimarCompetenciaPorDataPagamento(dataISO, diaFechamento, diaVencimento) {
  const [aStr, mStr] = String(dataISO || hojeLocalISO()).slice(0, 10).split('-');
  let ano = parseInt(aStr, 10) || new Date().getFullYear();
  let mes = parseInt(mStr, 10) || (new Date().getMonth() + 1);
  const fech = parseInt(diaFechamento, 10) || 1;
  const venc = parseInt(diaVencimento, 10) || 10;
  if (venc <= fech) {
    mes -= 1;
    if (mes < 1) {
      mes = 12;
      ano -= 1;
    }
  }
  return { ano, mes };
}

function resolverCompetenciaPagamentoCartao(txPagamento, candidatosComp, cfgCartao) {
  const dataPag = String((txPagamento && (txPagamento.data || txPagamento.dataCompra)) || hojeLocalISO()).slice(0, 10);
  const valorPag = Math.round((Number(txPagamento && txPagamento.valor) || 0) * 100) / 100;
  const fech = (cfgCartao && cfgCartao.diaFechamento) || 1;
  const venc = (cfgCartao && cfgCartao.diaVencimento) || 10;
  const lista = Array.isArray(candidatosComp) ? candidatosComp.filter(c => c && c.ano && c.mes && c.totalBruto > 0) : [];

  if (lista.length > 0 && /^\d{4}-\d{2}-\d{2}$/.test(dataPag)) {
    const pagMs = new Date(`${dataPag}T12:00:00`).getTime();
    const candidatosNoIntervalo = lista.map((c) => {
      const dueStr = calcularVencimentoFatura(c.ano, c.mes, fech, venc);
      const dueMs = new Date(`${dueStr}T12:00:00`).getTime();
      const diffDias = (pagMs - dueMs) / 86400000;
      const diffValor = Math.abs((Number(c.totalBruto) || 0) - valorPag);
      return { c, diffDias, absDias: Math.abs(diffDias), diffValor };
    }).filter(x => Number.isFinite(x.diffDias) && x.diffDias >= -18 && x.diffDias <= 32);

    if (candidatosNoIntervalo.length > 0) {
      const toleranciaValor = Math.max(1.00, valorPag * 0.02);
      const comMesmoValor = candidatosNoIntervalo.filter(x => valorPag > 0 && x.diffValor <= toleranciaValor);
      if (comMesmoValor.length > 0) {
        comMesmoValor.sort((a, b) => (a.diffValor - b.diffValor) || (a.absDias - b.absDias));
        return { ano: comMesmoValor[0].c.ano, mes: comMesmoValor[0].c.mes };
      }
      candidatosNoIntervalo.sort((a, b) => {
        const aPrefer = a.diffDias >= -7 ? 0 : 1;
        const bPrefer = b.diffDias >= -7 ? 0 : 1;
        if (aPrefer !== bPrefer) return aPrefer - bPrefer;
        return a.absDias - b.absDias;
      });
      return { ano: candidatosNoIntervalo[0].c.ano, mes: candidatosNoIntervalo[0].c.mes };
    }
  }

  return estimarCompetenciaPorDataPagamento(dataPag, fech, venc);
}

function calcularPlanoQuitacaoFaturasRevisao(listaTransacoes, opcoes = {}) {
  const marcarAnteriores = opcoes.marcarFaturasAnterioresPagas !== false;
  const dataRef = String(opcoes.dataReferencia || hojeLocalISO()).slice(0, 10);
  const mesAtualKey = dataRef.slice(0, 7);
  const contaPadraoNome = (_ofxRevisaoContexto && _ofxRevisaoContexto.contaNome) || '';
  const contasResolvidasPorTx = opcoes.contasResolvidasPorTx instanceof Map ? opcoes.contasResolvidasPorTx : null;

  const candidatosPorCartao = new Map();
  const obterOuCriarGrupoCartao = (nomeCartaoRaw, cfgFallback) => {
    const cleanName = String(nomeCartaoRaw || '').replace(/^__CRIAR_CARTAO__:/i, '').trim();
    if (!cleanName) return null;
    const keyLower = cleanName.toLowerCase();
    if (!candidatosPorCartao.has(keyLower)) {
      const cfg = cfgFallback || obterConfigCartaoParaRevisao(cleanName);
      candidatosPorCartao.set(keyLower, {
        nomeCartao: cfg.nomeCartao || cleanName,
        cfg,
        competencias: new Map()
      });
    }
    return candidatosPorCartao.get(keyLower);
  };

  const registrarDespesaCartao = (grupo, ano, mes, valor) => {
    if (!grupo || !ano || !mes) return null;
    const compKey = `${ano}-${String(mes).padStart(2, '0')}`;
    if (!grupo.competencias.has(compKey)) {
      grupo.competencias.set(compKey, { ano, mes, compKey, totalBruto: 0 });
    }
    const entry = grupo.competencias.get(compKey);
    entry.totalBruto = Math.round((entry.totalBruto + (Number(valor) || 0)) * 100) / 100;
    return entry;
  };

  const todosCartoesExistentes = [
    ...((STATE && Array.isArray(STATE.contas)) ? STATE.contas.filter(c => c && c.tipo === 'cartao') : []),
    ...((STATE && Array.isArray(STATE.cartoes)) ? STATE.cartoes : [])
  ];

  // Inclui despesas de cartão já gravadas em STATE.lancamentos para melhorar o batimento de valores
  (STATE.lancamentos || []).forEach((l) => {
    if (!l || l.tipo !== 'despesa' || ehLancamentoPagamentoFatura(l) || !ehLancamentoCartao(l)) return;
    const nomeC = l.conta || l.cartaoNome;
    if (!nomeC) return;
    const cfg = obterConfigCartaoParaRevisao(nomeC);
    const grupo = obterOuCriarGrupoCartao(cfg.nomeCartao, cfg);
    const comp = calcularCompetenciaLancamentoCartao(l, cfg.cartao || { nome: cfg.nomeCartao, diaFechamento: cfg.diaFechamento });
    registrarDespesaCartao(grupo, comp.ano, comp.mes, l.valor);
  });

  // Inclui despesas de cartão do lote atual em revisão/importação
  (listaTransacoes || []).forEach((tx) => {
    if (!tx || tx.ehDuplicada) return;
    const contaResolvida = contasResolvidasPorTx ? contasResolvidasPorTx.get(tx) : null;
    const destinoNome = (contaResolvida && contaResolvida.nome) || tx.contaDestino || contaPadraoNome;
    const cfg = contaResolvida
      ? {
          cartao: contaResolvida,
          nomeCartao: contaResolvida.nome,
          isCartao: contaResolvida.tipo === 'cartao',
          diaFechamento: parseInt(contaResolvida.diaFechamento, 10) || 1,
          diaVencimento: parseInt(contaResolvida.diaVencimento, 10) || 10
        }
      : obterConfigCartaoParaRevisao(destinoNome);

    const ehTipoCartao = cfg.isCartao || normalizarTipoContaPluggy(tx.accountType, tx.origem === 'pluggy' ? 'PLUGGY' : 'OFX') === 'CREDIT';
    const ehPagCartao = Boolean(tx.ehPagamentoFaturaNoCartao || (ehTipoCartao && ehTransacaoPagamentoFaturaPluggy(tx.memo || tx.descricao, tx.rawCategory)));
    if (!ehTipoCartao || !cfg.isCartao || tx.tipo !== 'despesa' || ehPagCartao || tx.selecionada === false) return;

    const grupo = obterOuCriarGrupoCartao(cfg.nomeCartao, cfg);
    const comp = competenciaFatura(tx.dataCompra || tx.data, cfg.diaFechamento);
    registrarDespesaCartao(grupo, comp.ano, comp.mes, tx.valor);
  });

  const pagamentosDetectadosPorChave = new Map();

  // 1) Pagamentos de fatura detectados no próprio cartão (ex.: "Pagamento recebido", "Credit Card Payment")
  (listaTransacoes || []).forEach((tx) => {
    if (!tx || tx.ehDuplicada) return;
    const contaResolvida = contasResolvidasPorTx ? contasResolvidasPorTx.get(tx) : null;
    const destinoNome = (contaResolvida && contaResolvida.nome) || tx.contaDestino || contaPadraoNome;
    const cfg = contaResolvida
      ? {
          cartao: contaResolvida,
          nomeCartao: contaResolvida.nome,
          isCartao: contaResolvida.tipo === 'cartao',
          diaFechamento: parseInt(contaResolvida.diaFechamento, 10) || 1,
          diaVencimento: parseInt(contaResolvida.diaVencimento, 10) || 10
        }
      : obterConfigCartaoParaRevisao(destinoNome);

    const ehTipoCartao = cfg.isCartao || normalizarTipoContaPluggy(tx.accountType, tx.origem === 'pluggy' ? 'PLUGGY' : 'OFX') === 'CREDIT';
    const ehPagCartao = Boolean(tx.ehPagamentoFaturaNoCartao || (ehTipoCartao && ehTransacaoPagamentoFaturaPluggy(tx.memo || tx.descricao, tx.rawCategory)));
    if (!ehPagCartao || !cfg.isCartao) return;

    const grupo = obterOuCriarGrupoCartao(cfg.nomeCartao, cfg);
    const candidatos = grupo ? [...grupo.competencias.values()] : [];
    const compPag = resolverCompetenciaPagamentoCartao(tx, candidatos, cfg);
    registrarDespesaCartao(grupo, compPag.ano, compPag.mes, 0);

    const chaveLower = normalizarChaveFaturaLower(grupo.nomeCartao, compPag.ano, compPag.mes);
    if (chaveLower) {
      pagamentosDetectadosPorChave.set(chaveLower, {
        dataPagamento: String(tx.data || dataRef).slice(0, 10),
        valor: Number(tx.valor) || 0,
        contaOrigem: '',
        pagamentoFaturaId: '',
        cartaoNome: grupo.nomeCartao,
        ano: compPag.ano,
        mes: compPag.mes,
        fonte: 'cartao'
      });
    }
  });

  // 2) Pagamentos de fatura vindos da conta bancária (BANK) no mesmo lote ou já importados
  const bancosPagamentoLista = [
    ...(Array.isArray(opcoes.pagamentosBancoRecentes) ? opcoes.pagamentosBancoRecentes : []),
    ...(listaTransacoes || []).filter((tx) => {
      if (!tx || tx.ehDuplicada || tx.selecionada === false) return false;
      const ehTipoCartao = normalizarTipoContaPluggy(tx.accountType, tx.origem === 'pluggy' ? 'PLUGGY' : 'OFX') === 'CREDIT';
      if (ehTipoCartao) return false;
      return tx.tipo === 'despesa' && Boolean(tx.ehPagamentoFaturaDetectado || ehTransacaoPagamentoFaturaPluggy(tx.memo || tx.descricao, tx.rawCategory));
    })
  ];

  bancosPagamentoLista.forEach((pagBank) => {
    const descBank = String(pagBank.descricao || pagBank.memo || '').toLowerCase();
    let grupoAlvo = null;
    for (const g of candidatosPorCartao.values()) {
      const nomeLow = g.nomeCartao.toLowerCase();
      if (descBank.includes(nomeLow) || (pagBank.cartaoNome && String(pagBank.cartaoNome).toLowerCase() === nomeLow)) {
        grupoAlvo = g;
        break;
      }
    }
    if (!grupoAlvo && candidatosPorCartao.size === 1) {
      grupoAlvo = [...candidatosPorCartao.values()][0];
    }
    if (!grupoAlvo && todosCartoesExistentes.length === 1) {
      const cfgUnico = obterConfigCartaoParaRevisao(todosCartoesExistentes[0].nome);
      grupoAlvo = obterOuCriarGrupoCartao(cfgUnico.nomeCartao, cfgUnico);
    }
    if (!grupoAlvo) return;

    const candidatos = [...grupoAlvo.competencias.values()];
    const compBank = (pagBank.faturaAno && pagBank.faturaMes)
      ? { ano: parseInt(pagBank.faturaAno, 10), mes: parseInt(pagBank.faturaMes, 10) }
      : resolverCompetenciaPagamentoCartao({ data: pagBank.data, valor: pagBank.valor }, candidatos, grupoAlvo.cfg);
    registrarDespesaCartao(grupoAlvo, compBank.ano, compBank.mes, 0);

    const chaveLower = normalizarChaveFaturaLower(grupoAlvo.nomeCartao, compBank.ano, compBank.mes);
    const anterior = pagamentosDetectadosPorChave.get(chaveLower);
    pagamentosDetectadosPorChave.set(chaveLower, {
      dataPagamento: String(pagBank.data || (anterior && anterior.dataPagamento) || dataRef).slice(0, 10),
      valor: Number(pagBank.valor) || (anterior && anterior.valor) || 0,
      contaOrigem: (pagBank.conta || pagBank.contaDestino || (anterior && anterior.contaOrigem) || '').replace(/^__CRIAR_CARTAO__:/i, ''),
      pagamentoFaturaId: pagBank._lancId || pagBank.idPagamentoLanc || (anterior && anterior.pagamentoFaturaId) || '',
      lancBancoRef: pagBank._lancRef || (anterior && anterior.lancBancoRef) || null,
      cartaoNome: grupoAlvo.nomeCartao,
      ano: compBank.ano,
      mes: compBank.mes,
      fonte: 'banco'
    });
  });

  const porChaveLower = new Map();
  const faturasParaQuitar = [];

  candidatosPorCartao.forEach((grupo) => {
    grupo.competencias.forEach((comp) => {
      const chaveLower = normalizarChaveFaturaLower(grupo.nomeCartao, comp.ano, comp.mes);
      if (!chaveLower) return;
      const pagInfo = pagamentosDetectadosPorChave.get(chaveLower) || null;
      const ehMesAnterior = comp.compKey < mesAtualKey;
      const deveQuitar = Boolean(pagInfo) || (marcarAnteriores && ehMesAnterior);
      if (!deveQuitar) return;

      const dataVenc = calcularVencimentoFatura(comp.ano, comp.mes, grupo.cfg.diaFechamento, grupo.cfg.diaVencimento);
      const planoItem = {
        chaveLower,
        cartaoNome: grupo.nomeCartao,
        ano: comp.ano,
        mes: comp.mes,
        compKey: comp.compKey,
        dataPagamento: (pagInfo && pagInfo.dataPagamento) || dataVenc || dataRef,
        contaOrigem: (pagInfo && pagInfo.contaOrigem) || '',
        pagamentoFaturaId: (pagInfo && pagInfo.pagamentoFaturaId) || '',
        lancBancoRef: (pagInfo && pagInfo.lancBancoRef) || null,
        quitacaoRetroativa: Boolean(marcarAnteriores && ehMesAnterior),
        pagamentoDetectado: Boolean(pagInfo),
        origemQuitacao: pagInfo
          ? (pagInfo.contaOrigem ? 'pluggy_conta_e_cartao' : 'pluggy_pagamento_detectado')
          : 'pluggy_mes_anterior'
      };
      porChaveLower.set(chaveLower, planoItem);
      faturasParaQuitar.push(planoItem);
    });
  });

  return {
    porChaveLower,
    faturasParaQuitar,
    pagamentosDetectadosPorChave,
    qtdPagamentosCartaoDetectados: [...pagamentosDetectadosPorChave.values()].filter(p => p.fonte === 'cartao').length
  };
}

function normalizarTextoParaMatchTransferencia(str) {
  return String(str || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function extrairNomeLimpoDestinoImportacao(valorDestino) {
  return String(valorDestino || '')
    .replace(/^__(?:CRIAR_CARTAO|CRIAR_CONTA)__:/i, '')
    .trim();
}

function ehMovimentacaoDinheiroFisicoImportacao(memo, rawCategory = '') {
  const catNorm = normalizarTextoParaMatchTransferencia(rawCategory);
  const memoNorm = normalizarTextoParaMatchTransferencia(memo);
  return (
    /\bcash\b|same\s*person\s*transfer\s*-\s*cash/i.test(catNorm) ||
    /\b(?:dep\s*dinheiro|deposito\s*(?:em\s*)?dinheiro|saques?|bco\s*24\s*h|banco\s*24\s*h|caixa\s*eletronico)\b/i.test(memoNorm)
  );
}

function calcularDiferencaDiasISOUtc(dataA, dataB) {
  const mA = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataA || '').trim());
  const mB = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dataB || '').trim());
  if (!mA || !mB) return Infinity;
  const msA = Date.UTC(Number(mA[1]), Number(mA[2]) - 1, Number(mA[3]));
  const msB = Date.UTC(Number(mB[1]), Number(mB[2]) - 1, Number(mB[3]));
  return Math.abs(msA - msB) / 86400000;
}

function contasBancariasSaoDiferentesTransferencia(txA, txB) {
  const destA = extrairNomeLimpoDestinoImportacao(txA && (txA.contaDestino || txA.conta)).toLowerCase();
  const destB = extrairNomeLimpoDestinoImportacao(txB && (txB.contaDestino || txB.conta)).toLowerCase();
  if (destA && destB && destA !== destB) return true;

  const rawIdA = String((txA && txA.accountId) || '').trim();
  const rawIdB = String((txB && txB.accountId) || '').trim();
  if (rawIdA && rawIdB && rawIdA !== rawIdB) return true;

  const rawNameA = String((txA && txA.accountName) || '').trim().toLowerCase();
  const rawNameB = String((txB && txB.accountName) || '').trim().toLowerCase();
  if (rawNameA && rawNameB && rawNameA !== rawNameB) return true;

  return false;
}

function detectarTransferenciasNoLoteImportacao(itensRevisao) {
  if (!Array.isArray(itensRevisao) || !itensRevisao.length) return;

  const elegiveis = itensRevisao.filter(
    tx => tx && !tx.ehDuplicada && !tx.ehCartaoCredito && !tx.ehPagamentoFaturaDetectado && !tx.ehPagamentoFaturaNoCartao && !tx.isCashMovement && (Number(tx.valor) || 0) > 0
  );
  const pareadosNoLote = new Set();

  // 1) Pareamento exato dentro do próprio lote atual (saída na Conta A + entrada na Conta B, mesmo valor, diff <= 1 dia)
  const candidatosPares = [];
  for (let i = 0; i < elegiveis.length; i += 1) {
    for (let j = i + 1; j < elegiveis.length; j += 1) {
      const a = elegiveis[i];
      const b = elegiveis[j];
      const dirA = a.direcaoOriginal || a.tipo;
      const dirB = b.direcaoOriginal || b.tipo;
      if (dirA === dirB) continue;
      if (Math.abs((Number(a.valor) || 0) - (Number(b.valor) || 0)) > 0.01) continue;
      if (!contasBancariasSaoDiferentesTransferencia(a, b)) continue;
      const diffDias = calcularDiferencaDiasISOUtc(a.data, b.data);
      if (diffDias > 1) continue;
      candidatosPares.push({ i, j, a, b, diffDias });
    }
  }

  candidatosPares.sort((p1, p2) => p1.diffDias - p2.diffDias);

  candidatosPares.forEach(({ a, b }) => {
    if (pareadosNoLote.has(a) || pareadosNoLote.has(b)) return;
    pareadosNoLote.add(a);
    pareadosNoLote.add(b);

    const dirA = a.direcaoOriginal || a.tipo;
    const txSaida = dirA === 'despesa' ? a : b;
    const txEntrada = dirA === 'receita' ? a : b;

    const nomeLimpoSaida = extrairNomeLimpoDestinoImportacao(txSaida.contaDestino);
    const nomeLimpoEntrada = extrairNomeLimpoDestinoImportacao(txEntrada.contaDestino);
    if (nomeLimpoSaida.toLowerCase() === nomeLimpoEntrada.toLowerCase() && txEntrada.accountName && txEntrada.accountName.toLowerCase() !== nomeLimpoSaida.toLowerCase()) {
      txEntrada.contaDestino = `__CRIAR_CONTA__:${txEntrada.accountName}`;
    }

    const origemFinal = txSaida.contaDestino || 'Conta Origem';
    const destinoFinal = txEntrada.contaDestino || 'Conta Destino';
    const nomeOrigemExib = extrairNomeLimpoDestinoImportacao(origemFinal);
    const nomeDestExib = extrairNomeLimpoDestinoImportacao(destinoFinal);

    txSaida.direcaoOriginal = 'despesa';
    txSaida.ehTransferencia = true;
    txSaida.isTransferencia = true;
    txSaida.tipoRevisao = 'transferencia';
    txSaida.categoria = 'Transferência';
    txSaida.contaContraparte = destinoFinal;
    txSaida.transferenciaParId = txEntrada.fitid || txEntrada.id;
    txSaida.transferenciaMotivo = `Par automático detectado (${nomeOrigemExib} → ${nomeDestExib})`;
    txSaida.selecionada = true;

    txEntrada.direcaoOriginal = 'receita';
    txEntrada.ehTransferencia = true;
    txEntrada.isTransferencia = true;
    txEntrada.ehParTransferenciaConsolidado = true;
    txEntrada.tipoRevisao = 'transferencia';
    txEntrada.categoria = 'Transferência';
    txEntrada.contaContraparte = origemFinal;
    txEntrada.transferenciaPrincipalId = txSaida.fitid || txSaida.id;
    txEntrada.transferenciaParId = txSaida.fitid || txSaida.id;
    txEntrada.transferenciaMotivo = `Consolidada com saída em ${nomeOrigemExib}`;
    txEntrada.selecionada = false;
  });

  // 2) Pareamento com lançamentos já existentes em STATE.lancamentos (apenas contas BANK conectadas do utilizador)
  const nomesBancosExistentes = new Set(
    (STATE.contas || []).filter(c => c && c.tipo !== 'cartao' && c.nome).map(c => String(c.nome).trim().toLowerCase())
  );
  const existentesUsados = new Set();
  const existingBancarios = (STATE.lancamentos || []).filter(
    l => l && !l.ehMovimentoCofre && !ehLancamentoPagamentoFatura(l) && !ehLancamentoCartao(l)
      && (Number(l.valor) || 0) > 0 && nomesBancosExistentes.has(String(l.conta || '').trim().toLowerCase())
  );

  elegiveis.forEach((tx) => {
    if (pareadosNoLote.has(tx)) return;
    const dirTx = tx.direcaoOriginal || tx.tipo;
    const contaTxLimpa = extrairNomeLimpoDestinoImportacao(tx.contaDestino || tx.accountName).toLowerCase();

    // Verifica primeiro se já existe uma ponta manual de transferência NÃO conciliada nesta mesma conta (para conciliar sem duplicar saldo)
    const legManualMesmaConta = existingBancarios.find((l) => {
      if (existentesUsados.has(l.id)) return false;
      if (l.ehTransferencia !== true || l.fitid || l.pluggyId || l.ofxFitId || l.externalId) return false;
      if (l.tipo !== dirTx) return false;
      if (String(l.conta || '').trim().toLowerCase() !== contaTxLimpa) return false;
      if (Math.abs((Number(l.valor) || 0) - (Number(tx.valor) || 0)) > 0.01) return false;
      return calcularDiferencaDiasISOUtc(l.data, tx.data) <= 1;
    });

    if (legManualMesmaConta) {
      existentesUsados.add(legManualMesmaConta.id);
      pareadosNoLote.add(tx);
      tx.direcaoOriginal = dirTx;
      tx.ehTransferencia = true;
      tx.tipoRevisao = 'transferencia';
      tx.categoria = 'Transferência';
      tx.contaContraparte = legManualMesmaConta.transferenciaContraparte || '__SEM_CONTRAPARTE__';
      tx.transferenciaConciliarLegId = legManualMesmaConta.id;
      tx.transferenciaMotivo = 'Concilia transferência já existente';
      return;
    }

    // Procura lançamento oposto em outra conta já gravada em STATE.lancamentos
    let melhorExistente = null;
    let melhorDiff = Infinity;
    existingBancarios.forEach((l) => {
      if (existentesUsados.has(l.id)) return;
      if (l.tipo === dirTx) return;
      if (l.ehTransferencia && l.transferenciaContraparte) return; // já faz parte de transferência completa
      const contaL = String(l.conta || '').trim();
      if (!contaL || contaL.toLowerCase() === contaTxLimpa) return;
      if (Math.abs((Number(l.valor) || 0) - (Number(tx.valor) || 0)) > 0.01) return;
      const diff = calcularDiferencaDiasISOUtc(l.data, tx.data);
      if (diff <= 1 && diff < melhorDiff) {
        melhorExistente = l;
        melhorDiff = diff;
      }
    });

    if (melhorExistente) {
      existentesUsados.add(melhorExistente.id);
      pareadosNoLote.add(tx);
      tx.direcaoOriginal = dirTx;
      tx.ehTransferencia = true;
      tx.tipoRevisao = 'transferencia';
      tx.categoria = 'Transferência';
      tx.contaContraparte = melhorExistente.conta;
      tx.transferenciaExistenteId = melhorExistente.id;
      tx.transferenciaMotivo = `Pareada com lançamento em ${melhorExistente.conta}`;
    }
  });

  itensRevisao.forEach((tx) => {
    if (tx) {
      if (!tx.direcaoOriginal) tx.direcaoOriginal = tx.tipo === 'receita' ? 'receita' : 'despesa';
      const ehTransfPrevia = !tx.ehPagamentoFaturaDetectado
        && !ehLancamentoPagamentoFatura(tx)
        && (tx.tipoRevisao === 'transferencia' || isLancamentoTransferencia(tx));
      if (ehTransfPrevia) {
        tx.ehTransferencia = true;
        tx.isTransferencia = true;
        tx.tipoRevisao = 'transferencia';
        tx.categoria = 'Transferência';
      } else if (!tx.tipoRevisao) {
        tx.tipoRevisao = tx.direcaoOriginal;
      }
      tx._transferenciaAvaliada = true;
    }
  });
}

function construirOptionsContraparteTransferenciaHTML(valorSelecionado, contaLinhaAtual) {
  if (typeof sincronizarEstruturaCartoes === 'function') sincronizarEstruturaCartoes();
  const contas = Array.isArray(STATE.contas) ? STATE.contas : [];
  const contaAtualLimpa = extrairNomeLimpoDestinoImportacao(contaLinhaAtual).toLowerCase();
  const contasBancarias = contas.filter(c => c && c.tipo !== 'cartao' && c.nome && c.nome.toLowerCase() !== contaAtualLimpa);
  const cartoes = contas.filter(c => c && c.tipo === 'cartao' && c.nome && c.nome.toLowerCase() !== contaAtualLimpa);

  const valAtual = String(valorSelecionado || '').trim();
  const valNormCriar = valAtual.startsWith('__CRIAR_CONTA__:') ? extrairNomeLimpoDestinoImportacao(valAtual) : '';
  const jaTemNoState = valNormCriar && contasBancarias.some(c => c.nome.toLowerCase() === valNormCriar.toLowerCase());

  const opcoesBancos = contasBancarias.map(c => (
    `<option value="${escHtml(c.nome)}"${c.nome === valAtual ? ' selected' : ''}>🏦 ${escHtml(c.nome)}</option>`
  )).join('');

  const opCriar = (valNormCriar && !jaTemNoState)
    ? `<option value="${escHtml(valAtual)}" selected>✨ Criar "${escHtml(valNormCriar)}" (Nova Conta)</option>`
    : '';

  const opcoesCartoes = cartoes.map(c => (
    `<option value="${escHtml(c.nome)}"${c.nome === valAtual ? ' selected' : ''}>💳 ${escHtml(c.nome)} (Cartão)</option>`
  )).join('');

  let html = `<option value=""${(!valAtual || valAtual === '__SEM_CONTRAPARTE__') ? ' selected' : ''}>-- Selecione a conta de contrapartida --</option>`;
  if (opcoesBancos || opCriar) {
    html += `<optgroup label="Contas Bancárias">${opcoesBancos}${opCriar}</optgroup>`;
  }
  if (opcoesCartoes) {
    html += `<optgroup label="Cartões">${opcoesCartoes}</optgroup>`;
  }
  return html;
}

/**
 * Pipeline Unificado de Normalização e Anti-Duplicação (PLUGGY & OFX).
 * Mapeia transações brutas da API Pluggy ou de ficheiros OFX para o formato canônico do COFIN,
 * identifica automaticamente Conta/Débito (BANK) vs Cartão de Crédito (CREDIT) e transferências entre contas,
 * verifica os IDs únicos contra STATE.lancamentos e abre o #modal-revisao-importacao.
 */
function normalizarListaContasPluggyMeta(opcoesExtras = {}, transacoesBrutas = null, listaEntrada = []) {
  const mapaPorChave = new Map();
  const registrar = (acc) => {
    if (!acc || typeof acc !== 'object') return;
    const id = String(acc.id || acc.accountId || '').trim();
    const name = String(acc.name || acc.accountName || acc.marketingName || acc.conta || '').trim();
    const type = normalizarTipoContaPluggy(acc.type || acc.accountType, 'PLUGGY');
    const balRaw = acc.balance !== undefined ? acc.balance : acc.accountBalance;
    const balNum = (balRaw !== undefined && balRaw !== null && balRaw !== '') ? Number(balRaw) : NaN;
    const hasBalance = type === 'BANK' && Number.isFinite(balNum);
    const balance = hasBalance ? Math.round(balNum * 100) / 100 : null;
    if (!id && !name) return;

    const key = id ? `ID:${id}` : `NAME:${type}::${name.toLowerCase()}`;
    const anterior = mapaPorChave.get(key);
    mapaPorChave.set(key, {
      id: id || (anterior && anterior.id) || '',
      itemId: String(acc.itemId || (anterior && anterior.itemId) || ''),
      name: name || (anterior && anterior.name) || (type === 'CREDIT' ? 'Cartão de Crédito' : 'Conta Corrente'),
      type,
      balance: balance !== null ? balance : (anterior ? anterior.balance : null),
      hasBalance: hasBalance || Boolean(anterior && anterior.hasBalance)
    });
  };

  if (opcoesExtras && Array.isArray(opcoesExtras.accounts)) {
    opcoesExtras.accounts.forEach(registrar);
  }
  if (transacoesBrutas && !Array.isArray(transacoesBrutas) && Array.isArray(transacoesBrutas.accounts)) {
    transacoesBrutas.accounts.forEach(registrar);
  }
  (listaEntrada || []).forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;
    if (raw.account && typeof raw.account === 'object') {
      registrar(raw.account);
    } else if (raw.accountBalance !== undefined && raw.accountBalance !== null) {
      registrar({
        id: raw.accountId,
        name: raw.accountName || raw.conta,
        type: raw.accountType || 'BANK',
        balance: raw.accountBalance
      });
    }
  });

  return [...mapaPorChave.values()];
}

function processarNovasTransacoes(transacoesBrutas, origem = 'OFX', opcoesExtras = {}) {
  const origemNorm = String(origem || 'OFX').trim().toUpperCase();
  let listaEntrada = [];
  let metadadosInferidos = (opcoesExtras && opcoesExtras.metadados) ? { ...opcoesExtras.metadados } : {};

  if (typeof transacoesBrutas === 'string') {
    const parsed = parseOFX(transacoesBrutas);
    listaEntrada = Array.isArray(parsed.transacoes) ? parsed.transacoes : [];
    metadadosInferidos = { ...parsed, ...metadadosInferidos };
  } else if (Array.isArray(transacoesBrutas)) {
    listaEntrada = transacoesBrutas;
  } else if (transacoesBrutas && Array.isArray(transacoesBrutas.transactions)) {
    listaEntrada = transacoesBrutas.transactions;
  } else if (transacoesBrutas && Array.isArray(transacoesBrutas.transacoes)) {
    listaEntrada = transacoesBrutas.transacoes;
  } else if (transacoesBrutas && Array.isArray(transacoesBrutas.results)) {
    listaEntrada = transacoesBrutas.results;
  }

  const contasPluggyMeta = origemNorm === 'PLUGGY'
    ? normalizarListaContasPluggyMeta(opcoesExtras, transacoesBrutas, listaEntrada)
    : [];

  const mapaFallbackFitid = new Map();
  const normalizadas = [];
  const indiceMemoriaLote = typeof construirIndiceMemoriaHistorica === 'function'
    ? construirIndiceMemoriaHistorica(STATE.lancamentos)
    : null;

  listaEntrada.forEach((raw) => {
    if (!raw || typeof raw !== 'object') return;

    if (origemNorm === 'PLUGGY') {
      const rawId = String(raw.id || raw.pluggyId || raw.providerId || raw.externalId || raw.fitid || '').trim();
      const dataBruta =
        (raw.date !== undefined && raw.date !== null && raw.date !== '' ? raw.date : null) ??
        (raw.transactedAt !== undefined && raw.transactedAt !== null && raw.transactedAt !== '' ? raw.transactedAt : null) ??
        (raw.creditCardMetadata && raw.creditCardMetadata.purchaseDate ? raw.creditCardMetadata.purchaseDate : null) ??
        (raw.dataCompra !== undefined && raw.dataCompra !== null && raw.dataCompra !== '' ? raw.dataCompra : null) ??
        (raw.data !== undefined && raw.data !== null && raw.data !== '' ? raw.data : null);
      const dataISO = extrairDataLocalISO(dataBruta, {
        contexto: { origem: 'PLUGGY', id: rawId, description: raw.description || raw.memo || '', raw }
      });

      const valorBruto = typeof raw.amount === 'number'
        ? raw.amount
        : parseValorOFX(raw.amount !== undefined ? raw.amount : raw.valor);
      if (!Number.isFinite(valorBruto) || valorBruto === 0) return;

      const valor = Math.round(Math.abs(valorBruto) * 100) / 100;
      if (valor <= 0) return;

      // Diferenciação estrita: accountType ('CREDIT' | 'BANK') define o meio de pagamento (Cartão vs Conta),
      // enquanto raw.type ('DEBIT' | 'CREDIT') define a direção do lançamento (Despesa vs Receita).
      const accountType = normalizarTipoContaPluggy(
        raw.accountType || (raw.account && raw.account.type),
        'PLUGGY'
      );
      const accountName = String(
        raw.accountName || (raw.account && raw.account.name) || raw.conta || ''
      ).trim();
      const accountId = String(
        raw.accountId || (raw.account && raw.account.id) || ''
      ).trim();
      const ehCartaoCredito = accountType === 'CREDIT';
      const meioPagamento = ehCartaoCredito ? 'cartao' : 'conta';

      const pluggyType = String(raw.type || raw.trnType || raw.tipo || '').trim().toUpperCase();
      const ehDebito = pluggyType === 'DEBIT' || pluggyType === 'DESPESA' || (pluggyType !== 'CREDIT' && pluggyType !== 'RECEITA' && valorBruto < 0);
      const tipo = ehDebito ? 'despesa' : 'receita';
      const trnType = ehDebito ? 'DEBIT' : 'CREDIT';

      const memo = String(
        raw.description ||
        raw.descriptionRaw ||
        raw.memo ||
        raw.descricao ||
        (raw.merchant && (raw.merchant.name || raw.merchant.businessName)) ||
        'Transação Open Finance'
      ).trim();

      let uniqueId = rawId;
      if (!uniqueId) {
        const chaveBase = `pluggy_auto_${dataISO}_${trnType}_${valor.toFixed(2)}_${memo.toLowerCase().replace(/[^a-z0-9]+/g, '').slice(0, 18) || 'tx'}`;
        const ocorrencia = (mapaFallbackFitid.get(chaveBase) || 0) + 1;
        mapaFallbackFitid.set(chaveBase, ocorrencia);
        uniqueId = `${chaveBase}_${ocorrencia}`;
      }

      const catFonte = raw.category || (raw.merchant && raw.merchant.category) || '';
      const statusPluggy = String(raw.status || 'POSTED').toUpperCase();
      const ehPagamentoFaturaDetectado = ehTransacaoPagamentoFaturaPluggy(memo, catFonte);
      const ehPagamentoFaturaNoCartao = ehCartaoCredito && ehPagamentoFaturaDetectado;
      const isCashMovement = ehMovimentacaoDinheiroFisicoImportacao(memo, catFonte);

      const resClassPluggy = (!ehPagamentoFaturaDetectado && typeof autoClassificarLancamento === 'function')
        ? autoClassificarLancamento(
            { tipo, data: dataISO, descricao: memo, descricaoOriginal: memo, valor, conta: accountName, accountId, rawCategory: String(catFonte || '') },
            { indiceMemoria: indiceMemoriaLote, rawCategory: String(catFonte || '') }
          )
        : null;
      const categoria = ehPagamentoFaturaDetectado
        ? 'Transferência/Pagamento de Fatura'
        : ((resClassPluggy && resClassPluggy.categoriaCompleta) || CATEGORIA_A_CLASSIFICAR);

      normalizadas.push({
        id: uniqueId,
        fitid: uniqueId,
        pluggyId: uniqueId,
        externalId: uniqueId,
        trnType,
        data: dataISO,
        dataCompra: ehCartaoCredito ? dataISO : undefined,
        valor,
        valorAssinado: ehDebito ? -valor : valor,
        tipo,
        direcaoOriginal: tipo,
        memo,
        descricao: memo,
        descricaoOriginal: memo,
        categoria,
        classificacaoOrigem: ehPagamentoFaturaDetectado ? 'pluggy' : ((resClassPluggy && resClassPluggy.origem) || 'pendente'),
        classificacaoRegraId: (resClassPluggy && resClassPluggy.regraId) || null,
        tagSugerida: (resClassPluggy && resClassPluggy.tag) || '',
        apelidoSugerido: (resClassPluggy && resClassPluggy.apelidoDescricao) || '',
        rawCategory: String(catFonte || ''),
        accountId,
        accountName,
        accountType,
        meioPagamento,
        ehCartaoCredito,
        ehPagamentoFaturaDetectado,
        ehPagamentoFaturaNoCartao,
        isCashMovement,
        conta: accountName,
        pago: ehCartaoCredito ? (tipo === 'receita') : (statusPluggy !== 'PENDING'),
        origem: 'pluggy'
      });
      return;
    }

    // Origem OFX (Conta / Débito por padrão)
    if (raw.fitid && raw.data && typeof raw.valor === 'number' && (raw.tipo === 'despesa' || raw.tipo === 'receita')) {
      const memo = String(raw.memo || raw.descricao || 'Transação OFX').trim();
      const fitid = String(raw.fitid).trim();
      const accType = normalizarTipoContaPluggy(raw.accountType, 'OFX');
      const accName = String(raw.accountName || raw.conta || '').trim();
      const dataOfxISO = extrairDataLocalISO(raw.dataCompra || raw.data || raw.date || raw.dtPosted || raw.DTPOSTED, {
        contexto: { origem: 'OFX', fitid, memo, raw }
      });
      const ehPagFaturaDetect = ehTransacaoPagamentoFaturaPluggy(memo, raw.categoria || '');
      const isCashOfx = ehMovimentacaoDinheiroFisicoImportacao(memo, raw.categoria || '');
      const resClassOfx = (!ehPagFaturaDetect && typeof autoClassificarLancamento === 'function')
        ? autoClassificarLancamento(
            { tipo: raw.tipo, data: dataOfxISO, descricao: memo, descricaoOriginal: memo, valor: raw.valor, conta: accName },
            { indiceMemoria: indiceMemoriaLote }
          )
        : null;
      const catOfx = ehPagFaturaDetect
        ? 'Transferência/Pagamento de Fatura'
        : ((resClassOfx && resClassOfx.categoriaCompleta) || raw.categoria || CATEGORIA_A_CLASSIFICAR);
      normalizadas.push({
        ...raw,
        id: fitid,
        fitid,
        externalId: fitid,
        data: dataOfxISO,
        dataCompra: accType === 'CREDIT' ? dataOfxISO : raw.dataCompra,
        direcaoOriginal: raw.tipo,
        memo,
        descricao: memo,
        descricaoOriginal: memo,
        accountName: accName,
        accountType: accType,
        meioPagamento: accType === 'CREDIT' ? 'cartao' : 'conta',
        ehCartaoCredito: accType === 'CREDIT',
        ehPagamentoFaturaDetectado: ehPagFaturaDetect,
        ehPagamentoFaturaNoCartao: accType === 'CREDIT' && ehPagFaturaDetect,
        isCashMovement: isCashOfx,
        ehTransferencia: false,
        categoria: catOfx,
        classificacaoOrigem: ehPagFaturaDetect ? 'pluggy' : ((resClassOfx && resClassOfx.origem) || 'pendente'),
        classificacaoRegraId: (resClassOfx && resClassOfx.regraId) || null,
        tagSugerida: (resClassOfx && resClassOfx.tag) || '',
        apelidoSugerido: (resClassOfx && resClassOfx.apelidoDescricao) || '',
        origem: 'ofx'
      });
      return;
    }

    const txOfx = normalizarTransacaoOFX({
      fitid: raw.FITID || raw.fitid || raw.id || raw.externalId,
      dtPosted: raw.DTPOSTED || raw.dtPosted || raw.data || raw.date,
      trnAmt: raw.TRNAMT !== undefined ? raw.TRNAMT : (raw.trnAmt !== undefined ? raw.trnAmt : raw.valor),
      trnType: raw.TRNTYPE || raw.trnType || raw.tipo,
      memo: raw.MEMO || raw.memo || raw.descricao,
      name: raw.NAME || raw.name
    }, mapaFallbackFitid);

    if (txOfx) {
      const accName = String(raw.accountName || raw.conta || '').trim();
      const ehPagFaturaRaw = ehTransacaoPagamentoFaturaPluggy(txOfx.memo, raw.categoria || '');
      const isCashRaw = ehMovimentacaoDinheiroFisicoImportacao(txOfx.memo, raw.categoria || '');
      const resClassRaw = (!ehPagFaturaRaw && typeof autoClassificarLancamento === 'function')
        ? autoClassificarLancamento(
            { tipo: txOfx.tipo, data: txOfx.data, descricao: txOfx.memo, descricaoOriginal: txOfx.memo, valor: txOfx.valor, conta: accName },
            { indiceMemoria: indiceMemoriaLote }
          )
        : null;
      normalizadas.push({
        ...txOfx,
        id: txOfx.fitid,
        externalId: txOfx.fitid,
        direcaoOriginal: txOfx.tipo,
        descricaoOriginal: txOfx.memo,
        accountName: accName,
        accountType: 'BANK',
        meioPagamento: 'conta',
        ehCartaoCredito: false,
        ehPagamentoFaturaDetectado: ehPagFaturaRaw,
        isCashMovement: isCashRaw,
        categoria: ehPagFaturaRaw ? 'Transferência/Pagamento de Fatura' : ((resClassRaw && resClassRaw.categoriaCompleta) || txOfx.categoria || CATEGORIA_A_CLASSIFICAR),
        classificacaoOrigem: ehPagFaturaRaw ? 'pluggy' : ((resClassRaw && resClassRaw.origem) || 'pendente'),
        classificacaoRegraId: (resClassRaw && resClassRaw.regraId) || null,
        tagSugerida: (resClassRaw && resClassRaw.tag) || '',
        apelidoSugerido: (resClassRaw && resClassRaw.apelidoDescricao) || '',
        conta: accName,
        origem: 'ofx'
      });
    }
  });

  const temContasPluggyComSaldo = origemNorm === 'PLUGGY' && contasPluggyMeta.some(a => a && a.hasBalance);
  if (!normalizadas.length && !temContasPluggyComSaldo) {
    toast(`Nenhuma transação válida encontrada para processar (${origemNorm}).`, 'err');
    return [];
  }

  const contaDestino = resolverContaDestinoImportacao(opcoesExtras, normalizadas);
  const idsExistentesGlobal = coletarIdsExistentesImportacao();
  const vistosNoLote = new Set();
  const nomesContasBankNoLote = new Set(
    normalizadas
      .filter(t => t && t.accountType !== 'CREDIT' && String(t.accountName || t.conta || '').trim())
      .map(t => String(t.accountName || t.conta).trim().toLowerCase())
  );
  const temMultiplasOrigensBanco = nomesContasBankNoLote.size > 1;

  const transacoesProcessadas = [];
  const transacoesLimpas = [];
  let qtdDuplicadasIgnoradas = 0;

  normalizadas.forEach((tx) => {
    const uniqueId = String(tx.fitid || tx.id || tx.externalId || '').trim();
    const ehDuplicada = !uniqueId || idsExistentesGlobal.has(uniqueId) || vistosNoLote.has(uniqueId);
    if (uniqueId) vistosNoLote.add(uniqueId);

    const contaSugerida = (origemNorm === 'PLUGGY')
      ? sugerirNomeContaDestinoCOFIN(tx.accountName, tx.accountType, contaDestino, temMultiplasOrigensBanco)
      : (contaDestino ? contaDestino.nome : 'Conta Principal');

    const ehPagCartao = Boolean(tx.ehPagamentoFaturaNoCartao || (tx.ehCartaoCredito && tx.ehPagamentoFaturaDetectado));
    const itemRevisao = {
      ...tx,
      id: uniqueId,
      fitid: uniqueId,
      externalId: uniqueId,
      direcaoOriginal: tx.direcaoOriginal || (tx.tipo === 'receita' ? 'receita' : 'despesa'),
      ehPagamentoFaturaNoCartao: ehPagCartao,
      contaDestino: tx.contaDestino || contaSugerida,
      selecionada: !ehDuplicada && !ehPagCartao,
      ehDuplicada
    };

    transacoesProcessadas.push(itemRevisao);
    if (ehDuplicada) {
      qtdDuplicadasIgnoradas += 1;
    } else {
      transacoesLimpas.push(itemRevisao);
    }
  });

  detectarTransferenciasNoLoteImportacao(transacoesProcessadas);

  abrirModalRevisaoImportacao(contaDestino, transacoesProcessadas, {
    origem: origemNorm,
    nomeArquivo: (opcoesExtras && opcoesExtras.nomeArquivo) || (origemNorm === 'PLUGGY' ? 'Pluggy Open Finance' : 'extrato.ofx'),
    metadados: metadadosInferidos,
    accounts: contasPluggyMeta,
    qtdNovas: transacoesLimpas.length,
    qtdDuplicadas: qtdDuplicadasIgnoradas
  });

  return transacoesLimpas;
}

function encontrarContaPluggyParaOrigem(contasPluggy, accountId, accountName, accountType) {
  const lista = Array.isArray(contasPluggy) ? contasPluggy : [];
  if (!lista.length) return null;
  const idLimpo = String(accountId || '').trim();
  if (idLimpo) {
    const porId = lista.find(a => a && String(a.id || '').trim() === idLimpo);
    if (porId) return porId;
  }
  const nomeLower = String(accountName || '').trim().toLowerCase();
  const tipoNorm = normalizarTipoContaPluggy(accountType, 'PLUGGY');
  return lista.find(a => a && String(a.name || '').trim().toLowerCase() === nomeLower && a.type === tipoNorm)
    || lista.find(a => a && String(a.name || '').trim().toLowerCase() === nomeLower)
    || null;
}

function coletarOrigensDistintasPluggy(listaTransacoes, contaAlvoPadrao, contasPluggy = []) {
  const mapa = new Map();
  const listaContasMeta = Array.isArray(contasPluggy) ? contasPluggy : [];
  const nomesContasBankUnicas = new Set([
    ...(listaTransacoes || []).filter(t => t && t.accountType !== 'CREDIT' && (t.accountName || t.conta)).map(t => String(t.accountName || t.conta).trim().toLowerCase()),
    ...listaContasMeta.filter(a => a && a.type !== 'CREDIT' && a.name).map(a => String(a.name).trim().toLowerCase())
  ]);
  const temMultiplasContasBank = nomesContasBankUnicas.size > 1;

  (listaTransacoes || []).forEach((tx) => {
    if (!tx) return;
    const accountType = normalizarTipoContaPluggy(tx.accountType, tx.origem === 'pluggy' ? 'PLUGGY' : 'OFX');
    const accountName = String(tx.accountName || tx.conta || '').trim() || (accountType === 'CREDIT' ? 'Cartão de Crédito' : 'Conta Corrente');
    const chave = construirChaveOrigemPluggy(accountName, accountType);
    const metaAcc = encontrarContaPluggyParaOrigem(listaContasMeta, tx.accountId, accountName, accountType);

    if (!mapa.has(chave)) {
      const destinoInicial = tx.contaDestino || sugerirNomeContaDestinoCOFIN(accountName, accountType, contaAlvoPadrao, temMultiplasContasBank);
      const balanceVal = (metaAcc && metaAcc.hasBalance) ? metaAcc.balance : null;
      mapa.set(chave, {
        chave,
        accountId: (metaAcc && metaAcc.id) || String(tx.accountId || '').trim(),
        accountName,
        accountType,
        rotuloTipo: accountType === 'CREDIT' ? 'Cartão de Crédito' : 'Débito/Conta',
        contaDestino: destinoInicial,
        balance: balanceVal,
        hasBalance: balanceVal !== null && accountType === 'BANK',
        quantidade: 0
      });
    } else if (mapa.get(chave).balance === null && metaAcc && metaAcc.hasBalance) {
      const item = mapa.get(chave);
      item.balance = metaAcc.balance;
      item.hasBalance = accountType === 'BANK';
      if (!item.accountId && metaAcc.id) item.accountId = metaAcc.id;
    }
    mapa.get(chave).quantidade += 1;
  });

  // Garante também contas Pluggy `BANK` com saldo retornado mesmo se ainda não houver lançamentos no lote
  listaContasMeta.forEach((acc) => {
    if (!acc || acc.type !== 'BANK') return;
    const accountName = String(acc.name || '').trim() || 'Conta Corrente';
    const chave = construirChaveOrigemPluggy(accountName, 'BANK');
    if (!mapa.has(chave) && acc.hasBalance) {
      mapa.set(chave, {
        chave,
        accountId: acc.id || '',
        accountName,
        accountType: 'BANK',
        rotuloTipo: 'Débito/Conta',
        contaDestino: sugerirNomeContaDestinoCOFIN(accountName, 'BANK', contaAlvoPadrao, temMultiplasContasBank),
        balance: acc.balance,
        hasBalance: true,
        quantidade: 0
      });
    }
  });

  return [...mapa.values()];
}

function abrirModalRevisaoImportacao(contaDestino, transacoes, opcoes = {}) {
  const subtituloEl = document.getElementById('ofx-revisao-subtitulo');
  const tituloEl = document.getElementById('revisao-importacao-titulo');
  const btnConfirmar = document.getElementById('btn-confirmar-revisao-ofx');

  const origemNorm = String((opcoes && opcoes.origem) || (transacoes && transacoes[0] && transacoes[0].origem) || 'OFX').toUpperCase();
  const nomeArquivo = String((opcoes && opcoes.nomeArquivo) || (origemNorm === 'PLUGGY' ? 'Pluggy Open Finance' : 'extrato.ofx'));
  const metadados = (opcoes && opcoes.metadados) || {};
  const contaAlvo = contaDestino || resolverContaDestinoImportacao({}, transacoes);

  const idsExistentes = coletarIdsExistentesImportacao();
  const vistosNoLote = new Set();

  transacoesPendentes = (transacoes || []).map((tx) => {
    const memo = String((tx && (tx.memo || tx.descricao)) || (origemNorm === 'PLUGGY' ? 'Transação Open Finance' : 'Transação OFX')).trim();
    const tipo = (tx && tx.tipo) || 'despesa';
    const fitid = String((tx && (tx.fitid || tx.id || tx.externalId)) || '').trim();
    const categoriaSugerida = (tx && tx.categoria) || autoCategorizar(memo, tipo);
    const accountType = normalizarTipoContaPluggy(tx && tx.accountType, origemNorm);
    const accountName = String((tx && (tx.accountName || tx.conta)) || '').trim();
    const ehCartaoCredito = accountType === 'CREDIT';
    const meioPagamento = ehCartaoCredito ? 'cartao' : 'conta';

    const ehDuplicada = typeof tx.ehDuplicada === 'boolean'
      ? tx.ehDuplicada
      : (!fitid || idsExistentes.has(fitid) || vistosNoLote.has(fitid));
    if (fitid) vistosNoLote.add(fitid);

    const contaDestinoTx = (tx && tx.contaDestino)
      ? tx.contaDestino
      : (origemNorm === 'PLUGGY'
        ? sugerirNomeContaDestinoCOFIN(accountName, accountType, contaAlvo)
        : (contaAlvo ? contaAlvo.nome : 'Conta Principal'));

    const ehPagDetect = Boolean(
      (tx && tx.ehPagamentoFaturaDetectado) || ehTransacaoPagamentoFaturaPluggy(memo, (tx && tx.rawCategory) || (tx && tx.category) || '')
    );
    const ehPagCartao = Boolean((tx && tx.ehPagamentoFaturaNoCartao) || (ehCartaoCredito && ehPagDetect));
    const ehTransfFlag = Boolean(tx && (tx.ehTransferencia || tx.tipoRevisao === 'transferencia'));
    const dirOriginal = (tx && tx.direcaoOriginal) || (tipo === 'receita' ? 'receita' : 'despesa');
    const dataBrutaItem = tx
      ? (tx.data || tx.date || tx.transactedAt || (tx.creditCardMetadata && tx.creditCardMetadata.purchaseDate) || tx.dataCompra || tx.dtPosted || tx.DTPOSTED)
      : null;
    const dataItemISO = extrairDataLocalISO(dataBrutaItem, {
      contexto: { etapa: 'abrirModalRevisaoImportacao', origem: origemNorm, fitid, memo }
    });

    return {
      ...tx,
      id: fitid,
      fitid,
      externalId: fitid,
      data: dataItemISO,
      dataCompra: ehCartaoCredito ? dataItemISO : (tx && tx.dataCompra),
      memo,
      descricao: memo,
      tipo,
      direcaoOriginal: dirOriginal,
      tipoRevisao: (tx && tx.tipoRevisao) || (ehTransfFlag ? 'transferencia' : dirOriginal),
      ehTransferencia: ehTransfFlag,
      contaContraparte: (tx && tx.contaContraparte) || '',
      accountName,
      accountType,
      meioPagamento,
      ehCartaoCredito,
      ehPagamentoFaturaDetectado: ehPagDetect,
      ehPagamentoFaturaNoCartao: ehPagCartao,
      contaDestino: contaDestinoTx,
      categoria: ehTransfFlag ? 'Transferência' : categoriaSugerida,
      origem: (tx && tx.origem) ? String(tx.origem).toLowerCase() : origemNorm.toLowerCase(),
      selecionada: typeof tx.selecionada === 'boolean' ? tx.selecionada : (!ehDuplicada && !ehPagCartao),
      ehDuplicada
    };
  });

  if (transacoesPendentes.some(t => t && !t._transferenciaAvaliada)) {
    detectarTransferenciasNoLoteImportacao(transacoesPendentes);
  }

  const contasPluggyMeta = originNormSafe();
  function originNormSafe() {
    return origemNorm === 'PLUGGY'
      ? normalizarListaContasPluggyMeta(opcoes, null, transacoesPendentes)
      : [];
  }
  const origensPluggy = coletarOrigensDistintasPluggy(transacoesPendentes, contaAlvo, contasPluggyMeta);
  const mapaOrigens = {};
  origensPluggy.forEach((o) => {
    mapaOrigens[o.chave] = o.contaDestino;
  });
  const temContasPluggyComSaldo = origensPluggy.some(o => o.hasBalance);

  _ofxRevisaoContexto = {
    origem: origemNorm,
    nomeArquivo,
    contaNome: contaAlvo.nome,
    contasPluggy: contasPluggyMeta,
    mapaOrigens,
    marcarFaturasAnterioresPagas: opcoes.marcarFaturasAnterioresPagas !== undefined ? Boolean(opcoes.marcarFaturasAnterioresPagas) : true,
    ajustarSaldoInicialPluggy: opcoes.ajustarSaldoInicialPluggy !== undefined ? Boolean(opcoes.ajustarSaldoInicialPluggy) : true,
    metadados
  };

  if (tituloEl) {
    const icone = origemNorm === 'PLUGGY' ? 'ti-plug-connected' : 'ti-checklist';
    const textoTitulo = origemNorm === 'PLUGGY'
      ? 'Revisão de Importação (Open Finance · Pluggy)'
      : 'Revisão de Importação (Extrato OFX)';
    tituloEl.innerHTML = `<i class="ti ${icone}" style="color:var(--accent);font-size:19px"></i><span>${escHtml(textoTitulo)}</span>`;
  }

  if (subtituloEl) {
    subtituloEl.textContent = origemNorm === 'PLUGGY'
      ? 'Confira o mapeamento de Contas (Débito) e Cartões de Crédito, desmarque itens indesejados (como pagamento de fatura) e revise as categorias.'
      : `Origem: "${_ofxRevisaoContexto.nomeArquivo}" → Conta: ${contaAlvo.nome}. Revise ou altere as categorias antes de salvar.`;
  }

  atualizarResumoModalRevisaoImportacao(contaAlvo);

  if (btnConfirmar) {
    btnConfirmar.disabled = transacoesPendentes.length === 0 && !temContasPluggyComSaldo;
  }

  renderListaRevisaoOFX();
  abrirModal('modal-revisao-importacao');
}

function atualizarResumoModalRevisaoImportacao(contaAlvo) {
  const resumoEl = document.getElementById('ofx-revisao-resumo');
  if (!resumoEl || !_ofxRevisaoContexto) return;

  const origemNorm = _ofxRevisaoContexto.origem || 'OFX';
  const selecionadasAtivas = transacoesPendentes.filter(t => !t.ehDuplicada && t.selecionada !== false);
  const qtdNovas = selecionadasAtivas.length;
  const qtdDup = transacoesPendentes.filter(t => t.ehDuplicada).length;
  const qtdCredit = transacoesPendentes.filter(t => t.accountType === 'CREDIT').length;
  const qtdBank = transacoesPendentes.length - qtdCredit;
  const qtdTransfAtivas = selecionadasAtivas.filter(t => t.ehTransferencia === true || t.tipoRevisao === 'transferencia').length;
  const totalEntradas = selecionadasAtivas
    .filter(t => !t.ehTransferencia && t.tipoRevisao !== 'transferencia' && t.tipo === 'receita')
    .reduce((s, t) => s + t.valor, 0);
  const totalSaidas = selecionadasAtivas
    .filter(t => !t.ehTransferencia && t.tipoRevisao !== 'transferencia' && t.tipo === 'despesa')
    .reduce((s, t) => s + t.valor, 0);
  const datas = transacoesPendentes.map(t => t.data).filter(Boolean).sort();
  const periodoTxt = datas.length
    ? `${datas[0].split('-').reverse().join('/')} a ${datas[datas.length - 1].split('-').reverse().join('/')}`
    : 'Período não informado';

  const acctBadge = (contaAlvo && contaAlvo.ofxAccountId)
    ? ` <span class="badge badge-pago" style="font-size:10px">Vinculada (${escHtml(contaAlvo.ofxAccountId)})</span>`
    : '';
  const origemBadge = `<span class="badge badge-info" style="font-size:10px">${escHtml(origemNorm)}</span>`;

  const optsContasPadrao = (STATE.contas || []).map(c => (
    `<option value="${escHtml(c.nome)}"${c.nome === _ofxRevisaoContexto.contaNome ? ' selected' : ''}>${escHtml(c.nome)}${c.tipo === 'cartao' ? ' (Cartão)' : ' (Conta)'}</option>`
  )).join('');

  let blocoMapeamentoPluggy = '';
  if (origemNorm === 'PLUGGY') {
    const origens = coletarOrigensDistintasPluggy(transacoesPendentes, contaAlvo, _ofxRevisaoContexto.contasPluggy || []);
    if (origens.length > 0) {
      const temSaldoPluggyBanco = origens.some(o => o.hasBalance);
      const ajustarSaldoChecked = _ofxRevisaoContexto.ajustarSaldoInicialPluggy !== false;
      const linhasMapeamento = origens.map((orig) => {
        const destinoAtual = (_ofxRevisaoContexto.mapaOrigens && _ofxRevisaoContexto.mapaOrigens[orig.chave]) || orig.contaDestino;
        const badgeTipo = orig.accountType === 'CREDIT'
          ? '<span class="badge badge-pluggy-credit"><i class="ti ti-credit-card"></i> Cartão de Crédito</span>'
          : '<span class="badge badge-pluggy-bank"><i class="ti ti-building-bank"></i> Débito / Conta</span>';
        const badgeSaldoReal = orig.hasBalance
          ? `<span class="badge badge-pluggy-saldo"><i class="ti ti-wallet"></i> Saldo real no banco: <strong>${escHtml(toBRL(orig.balance))}</strong></span>`
          : '';
        const optsSelect = construirOptionsContasECartoesRevisaoHTML(destinoAtual, orig.accountType, orig.accountName);
        return `
          <div class="pluggy-mapeamento-item">
            <div class="pluggy-mapeamento-origem">
              <span>${escHtml(orig.accountName)} (${escHtml(orig.rotuloTipo)})</span>
              ${badgeTipo}
              ${badgeSaldoReal}
              <span class="badge badge-cat" style="font-size:10px">${orig.quantidade} lançamento(s)</span>
            </div>
            <div class="pluggy-mapeamento-destino">
              <span style="font-size:11px;color:var(--text3);white-space:nowrap">Gravar em:</span>
              <select
                class="pluggy-mapa-conta-select"
                data-origem-key="${escHtml(orig.chave)}"
                onchange="aoMudarMapeamentoContaPluggy(this.getAttribute('data-origem-key'), this.value)">
                ${optsSelect}
              </select>
            </div>
          </div>
        `;
      }).join('');

      const toggleAjusteSaldoHTML = temSaldoPluggyBanco
        ? `
          <label class="pluggy-retro-toggle pluggy-saldo-toggle" for="pluggy-ajustar-saldo-inicial">
            <input type="checkbox" id="pluggy-ajustar-saldo-inicial" ${ajustarSaldoChecked ? 'checked' : ''} onchange="aoAlternarAjustarSaldoInicialPluggy(this.checked)">
            <span><strong>Ajustar Saldo Inicial automaticamente para bater com o saldo real do banco</strong></span>
          </label>
        `
        : '';

      blocoMapeamentoPluggy = `
        <div class="pluggy-mapeamento-box" id="pluggy-mapeamento-contas">
          <div class="pluggy-mapeamento-title">
            <i class="ti ti-arrows-right-left" style="color:var(--accent)"></i>
            <span>Mapeamento de Contas &amp; Cartões (Pluggy → COFIN)</span>
          </div>
          <div class="pluggy-mapeamento-grid">
            ${linhasMapeamento}
          </div>
          ${toggleAjusteSaldoHTML}
        </div>
      `;
    }
  }

  const marcarAnterioresChecked = _ofxRevisaoContexto.marcarFaturasAnterioresPagas !== false;
  const planoPreview = qtdCredit > 0
    ? calcularPlanoQuitacaoFaturasRevisao(transacoesPendentes, { marcarFaturasAnterioresPagas: marcarAnterioresChecked })
    : { qtdPagamentosCartaoDetectados: 0, faturasParaQuitar: [] };
  const blocoQuitacaoRetroativa = (qtdCredit > 0 || origemNorm === 'PLUGGY')
    ? `
      <label class="pluggy-retro-toggle" for="pluggy-marcar-faturas-anteriores" style="display:flex;align-items:center;gap:8px;margin-top:8px;padding:7px 10px;border-radius:8px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.22);font-size:12px;cursor:pointer">
        <input type="checkbox" id="pluggy-marcar-faturas-anteriores" ${marcarAnterioresChecked ? 'checked' : ''} onchange="aoAlternarMarcarFaturasAnteriores(this.checked)">
        <span><strong>Marcar faturas de meses anteriores como Pagas</strong> <span style="color:var(--text3)">(faturas anteriores ao mês atual${planoPreview.qtdPagamentosCartaoDetectados > 0 ? ` + ${planoPreview.qtdPagamentosCartaoDetectados} pagamento(s) de fatura detectado(s)` : ''} serão gravadas como Pagas)</span></span>
      </label>
    `
    : '';

  resumoEl.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap">
      <div><strong>${escHtml(_ofxRevisaoContexto.contaNome)}</strong>${acctBadge} ${origemBadge} · <strong>${transacoesPendentes.length}</strong> transação(ões) lida(s)</div>
      <div style="display:flex;align-items:center;gap:6px">
        <label for="revisao-importacao-conta-select" style="font-size:11px;margin:0">Conta padrão:</label>
        <select id="revisao-importacao-conta-select" onchange="aoMudarContaRevisaoImportacao(this.value)" style="padding:3px 8px;font-size:11.5px;width:auto">
          ${optsContasPadrao}
        </select>
      </div>
    </div>
    <div class="ofx-resumo-stats">
      <span><i class="ti ti-calendar"></i> ${escHtml(periodoTxt)}</span>
      <span class="mv-ok">${qtdNovas} selecionada(s)</span>
      <span style="color:var(--text3)">${qtdDup} duplicada(s) (${origemNorm === 'PLUGGY' ? 'ID' : 'FITID'})</span>
      ${qtdBank > 0 ? `<span class="badge badge-pluggy-bank"><i class="ti ti-building-bank"></i> ${qtdBank} Débito/Conta</span>` : ''}
      ${qtdCredit > 0 ? `<span class="badge badge-pluggy-credit"><i class="ti ti-credit-card"></i> ${qtdCredit} Crédito</span>` : ''}
      ${qtdTransfAtivas > 0 ? `<span class="badge badge-pluggy-transfer"><i class="ti ti-transfer"></i> ${qtdTransfAtivas} Transferência(s)</span>` : ''}
      <span class="mv-ok">+ ${escHtml(toBRL(totalEntradas))}</span>
      <span class="mv-bad">- ${escHtml(toBRL(totalSaidas))}</span>
    </div>
    ${blocoQuitacaoRetroativa}
    ${blocoMapeamentoPluggy}
  `;
}

function obterFlagMarcarFaturasAnterioresRevisao() {
  const chk = typeof document !== 'undefined' ? document.getElementById('pluggy-marcar-faturas-anteriores') : null;
  if (chk && String(chk.type || '').toLowerCase() === 'checkbox') {
    return Boolean(chk.checked);
  }
  return !_ofxRevisaoContexto || _ofxRevisaoContexto.marcarFaturasAnterioresPagas !== false;
}

function aoAlternarMarcarFaturasAnteriores(marcado) {
  if (!_ofxRevisaoContexto) return;
  _ofxRevisaoContexto.marcarFaturasAnterioresPagas = Boolean(marcado);
  renderListaRevisaoOFX();
}

function obterFlagAjustarSaldoInicialPluggy() {
  const chk = typeof document !== 'undefined' ? document.getElementById('pluggy-ajustar-saldo-inicial') : null;
  if (chk && String(chk.type || '').toLowerCase() === 'checkbox') {
    return Boolean(chk.checked);
  }
  return !_ofxRevisaoContexto || _ofxRevisaoContexto.ajustarSaldoInicialPluggy !== false;
}

function aoAlternarAjustarSaldoInicialPluggy(marcado) {
  if (!_ofxRevisaoContexto) return;
  _ofxRevisaoContexto.ajustarSaldoInicialPluggy = Boolean(marcado);
}

function sincronizarContraparteAposMudancaConta(tx, novoDestino) {
  if (!tx || !novoDestino) return;
  const novoLimpo = extrairNomeLimpoDestinoImportacao(novoDestino).toLowerCase();
  const idsPar = [tx.transferenciaPrincipalId, tx.transferenciaParId].filter(Boolean);
  idsPar.forEach((idRef) => {
    const par = transacoesPendentes.find(p => p && p !== tx && (p.fitid === idRef || p.id === idRef));
    if (par) par.contaContraparte = novoDestino;
  });
  if ((tx.ehTransferencia || tx.isTransferencia) && extrairNomeLimpoDestinoImportacao(tx.contaContraparte).toLowerCase() === novoLimpo) {
    tx.contaContraparte = '';
  }
}

function aoMudarMapeamentoContaPluggy(chaveOrigem, novoDestino) {
  if (!_ofxRevisaoContexto || !chaveOrigem || !novoDestino) return;
  if (!_ofxRevisaoContexto.mapaOrigens) _ofxRevisaoContexto.mapaOrigens = {};
  _ofxRevisaoContexto.mapaOrigens[chaveOrigem] = novoDestino;

  transacoesPendentes.forEach((tx) => {
    const chaveTx = construirChaveOrigemPluggy(tx.accountName || tx.conta, tx.accountType);
    if (chaveTx === chaveOrigem) {
      tx.contaDestino = novoDestino;
      sincronizarContraparteAposMudancaConta(tx, novoDestino);
    }
  });

  const contaAlvo = (STATE.contas || []).find(c => c && c.nome === _ofxRevisaoContexto.contaNome) || STATE.contas[0];
  atualizarResumoModalRevisaoImportacao(contaAlvo);
  renderListaRevisaoOFX();
}

function aoMudarContaRevisaoImportacao(novoNomeConta) {
  if (!_ofxRevisaoContexto || !novoNomeConta) return;
  const novaConta = (STATE.contas || []).find(c => c && c.nome === novoNomeConta);
  if (!novaConta) return;

  _ofxRevisaoContexto.contaNome = novaConta.nome;
  const idsExistentes = coletarIdsExistentesImportacao(novaConta.nome);
  const vistos = new Set();
  transacoesPendentes.forEach((tx) => {
    if (_ofxRevisaoContexto.origem !== 'PLUGGY' || !tx.contaDestino) {
      tx.contaDestino = novaConta.nome;
    }
    const id = String(tx.fitid || tx.id || '').trim();
    tx.ehDuplicada = !id || idsExistentes.has(id) || vistos.has(id);
    if (id) vistos.add(id);
  });

  atualizarResumoModalRevisaoImportacao(novaConta);
  renderListaRevisaoOFX();
}

function aoAlterarContaLinhaRevisaoImportacao(idx, novoDestino) {
  const tx = transacoesPendentes[idx];
  if (tx && novoDestino) {
    tx.contaDestino = novoDestino;
    sincronizarContraparteAposMudancaConta(tx, novoDestino);
    const contaAlvo = (STATE.contas || []).find(c => c && c.nome === (_ofxRevisaoContexto && _ofxRevisaoContexto.contaNome)) || STATE.contas[0];
    atualizarResumoModalRevisaoImportacao(contaAlvo);
    renderListaRevisaoOFX();
  }
}

function aoAlterarTipoRevisaoImportacao(idx, novoTipoRaw) {
  const tx = transacoesPendentes[idx];
  if (!tx) return;
  const novoTipo = ['despesa', 'receita', 'transferencia'].includes(novoTipoRaw) ? novoTipoRaw : 'despesa';
  tx.tipoRevisao = novoTipo;

  if (novoTipo === 'transferencia') {
    if (!tx.direcaoOriginal) tx.direcaoOriginal = tx.tipo === 'receita' ? 'receita' : 'despesa';
    tx.ehTransferencia = true;
    tx.categoria = 'Transferência';
    const contraAtualLimpa = extrairNomeLimpoDestinoImportacao(tx.contaContraparte).toLowerCase();
    const contaLinhaLimpa = extrairNomeLimpoDestinoImportacao(tx.contaDestino).toLowerCase();
    if (!contraAtualLimpa || contraAtualLimpa === contaLinhaLimpa || tx.contaContraparte === '__SEM_CONTRAPARTE__') {
      tx.contaContraparte = '';
    }
    if (!tx.transferenciaMotivo) tx.transferenciaMotivo = 'Definida manualmente como Transferência';
  } else {
    if (tx.transferenciaParId) {
      const par = transacoesPendentes.find(p => p && p !== tx && (p.fitid === tx.transferenciaParId || p.id === tx.transferenciaParId));
      if (par && par.ehParTransferenciaConsolidado) {
        par.ehParTransferenciaConsolidado = false;
        par.ehTransferencia = false;
        par.tipoRevisao = par.direcaoOriginal || par.tipo || 'receita';
        par.categoria = autoCategorizar(par.memo, par.tipoRevisao);
        par.selecionada = !par.ehDuplicada;
        delete par.transferenciaPrincipalId;
        delete par.transferenciaMotivo;
      }
      delete tx.transferenciaParId;
    }
    tx.ehTransferencia = false;
    tx.ehParTransferenciaConsolidado = false;
    tx.tipo = novoTipo;
    tx.direcaoOriginal = novoTipo;
    tx.categoria = autoCategorizar(tx.memo, novoTipo);
    delete tx.contaContraparte;
    delete tx.transferenciaExistenteId;
    delete tx.transferenciaConciliarLegId;
    delete tx.transferenciaPrincipalId;
    delete tx.transferenciaMotivo;
  }

  const contaAlvo = (STATE.contas || []).find(c => c && c.nome === (_ofxRevisaoContexto && _ofxRevisaoContexto.contaNome)) || STATE.contas[0];
  atualizarResumoModalRevisaoImportacao(contaAlvo);
  renderListaRevisaoOFX();
}

function aoAlterarContraparteTransferenciaRevisao(idx, novaContraparte) {
  const tx = transacoesPendentes[idx];
  if (!tx) return;
  tx.contaContraparte = String(novaContraparte || '').trim();
  if (tx.ehTransferencia && tx.transferenciaMotivo && tx.transferenciaMotivo.startsWith('Par automático detectado')) {
    const origemLimpa = extrairNomeLimpoDestinoImportacao(tx.contaDestino);
    const contraLimpa = tx.contaContraparte ? extrairNomeLimpoDestinoImportacao(tx.contaContraparte) : 'Selecione';
    tx.transferenciaMotivo = `Transferência (${origemLimpa} → ${contraLimpa})`;
  }
}

function aoAlternarSelecaoRevisaoImportacao(idx, marcado) {
  if (!transacoesPendentes[idx]) return;
  transacoesPendentes[idx].selecionada = Boolean(marcado);
  const rowEl = document.querySelector(`#ofx-revisao-lista .ofx-revisao-row[data-ofx-row="${idx}"]`);
  if (rowEl) {
    rowEl.classList.toggle('ofx-desmarcado', !marcado);
  }
  const contaAlvo = (STATE.contas || []).find(c => c && c.nome === (_ofxRevisaoContexto && _ofxRevisaoContexto.contaNome)) || STATE.contas[0];
  atualizarResumoModalRevisaoImportacao(contaAlvo);
}

function abrirModalRevisaoOFX(contaDestino, transacoes, nomeArquivo, metadados) {
  return abrirModalRevisaoImportacao(contaDestino, transacoes, {
    origem: 'OFX',
    nomeArquivo: nomeArquivo || 'extrato.ofx',
    metadados: metadados || {}
  });
}

function aoAlterarDataRevisaoImportacao(idx, novaDataRaw) {
  const tx = transacoesPendentes[idx];
  if (!tx) return;
  const dataNorm = extrairDataLocalISO(novaDataRaw, {
    retornarVazioSeInvalido: true,
    aceitarSerialExcel: false,
    silencioso: true
  });
  if (!dataNorm) return;
  tx.data = dataNorm;
  if (tx.ehCartaoCredito || normalizarTipoContaPluggy(tx.accountType, tx.origem === 'pluggy' ? 'PLUGGY' : 'OFX') === 'CREDIT') {
    tx.dataCompra = dataNorm;
  }
  const contaAlvo = (STATE.contas || []).find(c => c && c.nome === (_ofxRevisaoContexto && _ofxRevisaoContexto.contaNome)) || STATE.contas[0];
  atualizarResumoModalRevisaoImportacao(contaAlvo);
  renderListaRevisaoOFX();
}

function aoAlterarCategoriaRevisaoOFX(idx, novaCategoria) {
  const tx = transacoesPendentes[idx];
  if (!tx) return;
  tx.categoria = novaCategoria || CATEGORIA_A_CLASSIFICAR;
  tx.classificacaoOrigem = 'manual';
  tx.classificacaoRegraId = null;
  const badgeWrap = document.querySelector(`[data-ofx-origem-idx="${idx}"]`);
  if (badgeWrap && typeof badgeOrigemClassificacaoHTML === 'function') {
    badgeWrap.innerHTML = badgeOrigemClassificacaoHTML('manual');
  }
  if (typeof oferecerAprendizadoRegra === 'function') {
    oferecerAprendizadoRegra(tx, tx.categoria, { contexto: 'revisao' });
  }
}

function renderListaRevisaoOFX() {
  const cont = document.getElementById('ofx-revisao-lista');
  if (!cont) return;

  if (!transacoesPendentes.length) {
    cont.innerHTML = '<div class="empty" style="padding:1.5rem"><p>Nenhuma transação pendente para revisão.</p></div>';
    return;
  }

  const rotuloId = (_ofxRevisaoContexto && _ofxRevisaoContexto.origem === 'PLUGGY') ? 'Pluggy ID' : 'FITID';
  const contaPadraoNome = (_ofxRevisaoContexto && _ofxRevisaoContexto.contaNome) || (STATE.contas[0] && STATE.contas[0].nome) || 'Conta Principal';
  const planoPreview = calcularPlanoQuitacaoFaturasRevisao(transacoesPendentes, {
    marcarFaturasAnterioresPagas: obterFlagMarcarFaturasAnterioresRevisao()
  });

  cont.innerHTML = transacoesPendentes.map((tx, idx) => {
    const dataInputISO = extrairDataLocalISO(tx.data || tx.date || tx.dataCompra, {
      retornarVazioSeInvalido: true,
      silencioso: true
    }) || '';
    const [a, m, d] = String(dataInputISO || tx.data || '').split('-');
    const dataFmt = a && m && d ? `${d}/${m}/${a}` : (tx.data || '-');
    const tipoLinhaAtual = tx.tipoRevisao || (tx.ehTransferencia ? 'transferencia' : (tx.tipo === 'receita' ? 'receita' : 'despesa'));
    const ehTransf = tipoLinhaAtual === 'transferencia' || tx.ehTransferencia === true;
    const direcaoLinha = tx.direcaoOriginal || (tx.tipo === 'receita' ? 'receita' : 'despesa');
    const sinal = ehTransf ? '⇄' : (tipoLinhaAtual === 'receita' ? '+' : '-');
    const classeValor = ehTransf ? 'mv-transfer' : (tipoLinhaAtual === 'receita' ? 'mv-ok' : 'mv-bad');
    const destinoAtual = tx.contaDestino || contaPadraoNome;
    const cfgCartaoPreview = obterConfigCartaoParaRevisao(destinoAtual);
    const ehCredito = normalizarTipoContaPluggy(tx.accountType, tx.origem === 'pluggy' ? 'PLUGGY' : 'OFX') === 'CREDIT';
    const badgeMeioPagamento = ehCredito
      ? '<span class="badge badge-pluggy-credit" title="Lançamento de Cartão de Crédito (Fatura)"><i class="ti ti-credit-card"></i> Crédito</span>'
      : '<span class="badge badge-pluggy-bank" title="Movimentação de Conta Corrente / Débito"><i class="ti ti-building-bank"></i> Débito / Conta</span>';

    const badgeContaOrigem = tx.accountName
      ? `<span class="badge badge-cat" style="font-size:10px"><i class="ti ti-Building"></i>${escHtml(tx.accountName)}</span>`
      : '';

    const badgeTransferencia = ehTransf
      ? `<span class="badge badge-pluggy-transfer" style="font-size:10px" title="${escHtml(tx.transferenciaMotivo || 'Transferência entre contas próprias — não contabilizada como Receita ou Despesa')}"><i class="ti ti-transfer"></i> ${tx.ehParTransferenciaConsolidado ? 'Transferência pareada (Consolidada)' : 'Transferência'}</span>`
      : '';

    const badgePagFatura = tx.ehPagamentoFaturaDetectado
      ? `<span class="badge badge-pendente" style="font-size:10px" title="${tx.ehPagamentoFaturaNoCartao ? 'Pagamento de fatura detectado no cartão — desmarcado por padrão para evitar duplicidade, mas usado para marcar a fatura como Paga' : 'Saída em conta referente a pagamento de fatura — vinculada para evitar duplicidade no gráfico/DRE'}"><i class="ti ti-alert-triangle"></i> Pagamento de fatura detectado</span>`
      : '';

    let badgeFaturaPreview = '';
    if ((ehCredito || cfgCartaoPreview.isCartao) && cfgCartaoPreview.isCartao && !ehTransf && tipoLinhaAtual === 'despesa' && !tx.ehPagamentoFaturaNoCartao) {
      const compTx = competenciaFatura(tx.dataCompra || tx.data, cfgCartaoPreview.diaFechamento);
      const chavePrev = normalizarChaveFaturaLower(cfgCartaoPreview.nomeCartao, compTx.ano, compTx.mes);
      const quitadaPrev = planoPreview.porChaveLower.has(chavePrev);
      const labelComp = `${String(compTx.mes).padStart(2, '0')}/${compTx.ano}`;
      badgeFaturaPreview = quitadaPrev
        ? `<span class="badge badge-pago" style="font-size:10px" title="Será importada como Fatura Paga"><i class="ti ti-circle-check"></i> Fatura ${escHtml(labelComp)} · Paga</span>`
        : `<span class="badge badge-pendente" style="font-size:10px" title="Ficará em aberto em Cartões &amp; Faturas"><i class="ti ti-clock"></i> Fatura ${escHtml(labelComp)} · Aberta</span>`;
    }

    const badgeStatus = tx.ehDuplicada
      ? `<span class="badge badge-cat" style="font-size:10px">Já importada (${rotuloId})</span>`
      : '<span class="badge badge-pago" style="font-size:10px">Novo</span>';

    const optsContaLinha = construirOptionsContasECartoesRevisaoHTML(destinoAtual, tx.accountType, tx.accountName);
    const optsCat = construirOptionsCategoriasOFX(tipoLinhaAtual === 'receita' ? 'receita' : 'despesa', tx.categoria);
    const contraparteAtual = tx.contaContraparte || '';
    const optsContraparte = ehTransf ? construirOptionsContraparteTransferenciaHTML(contraparteAtual, destinoAtual) : '';
    const rotuloContraparte = direcaoLinha === 'despesa' ? 'Para (Conta Destino):' : 'De (Conta Origem):';
    const colunaDireitaHTML = ehTransf
      ? `
        <div class="ofx-revisao-contraparte-wrap">
          <span class="ofx-revisao-contraparte-label">${escHtml(rotuloContraparte)}</span>
          <select
            class="ofx-revisao-contraparte-select"
            data-ofx-contraparte-idx="${idx}"
            aria-label="${escHtml(rotuloContraparte)} ${escHtml(tx.memo)}"
            onchange="aoAlterarContraparteTransferenciaRevisao(${idx}, this.value)">
            ${optsContraparte}
          </select>
        </div>
      `
      : `
        <div class="ofx-revisao-cat-wrap">
          <select
            class="ofx-revisao-cat-select"
            data-ofx-idx="${idx}"
            aria-label="Categoria para ${escHtml(tx.memo)}"
            onchange="aoAlterarCategoriaRevisaoOFX(${idx}, this.value)">
            ${optsCat}
          </select>
          <span data-ofx-origem-idx="${idx}">${typeof badgeOrigemClassificacaoHTML === 'function' ? badgeOrigemClassificacaoHTML(tx.classificacaoOrigem || 'pendente') : ''}</span>
        </div>
      `;

    const estaSelecionada = !tx.ehDuplicada && tx.selecionada !== false;
    const descOrigRevisao = tx.descricaoOriginal || tx.memo || '';
    const descExibRevisaoHTML = (tx.apelidoSugerido && !ehTransf)
      ? `<span title="Original do banco: ${escHtml(descOrigRevisao)}">${escHtml(tx.apelidoSugerido)}</span><span class="ofx-revisao-apelido-pill" title="Original do banco: ${escHtml(descOrigRevisao)}"><i class="ti ti-tag"></i> Apelido</span>`
      : escHtml(tx.memo);

    return `
      <div class="ofx-revisao-row${tx.ehDuplicada ? ' ofx-dup' : ''}${!estaSelecionada ? ' ofx-desmarcado' : ''}" data-ofx-row="${idx}">
        <div class="ofx-revisao-chk-wrap">
          <input
            type="checkbox"
            class="ofx-revisao-chk"
            data-ofx-chk="${idx}"
            aria-label="Incluir ${escHtml(tx.memo)}"
            ${estaSelecionada ? 'checked' : ''}
            ${tx.ehDuplicada ? 'disabled' : ''}
            onchange="aoAlternarSelecaoRevisaoImportacao(${idx}, this.checked)">
        </div>
        <div class="ofx-revisao-data">
          <input
            type="date"
            class="ofx-revisao-data-input"
            data-ofx-data-idx="${idx}"
            value="${escHtml(dataInputISO)}"
            aria-label="Data para ${escHtml(tx.memo)}"
            title="${escHtml(dataFmt)}"
            ${tx.ehDuplicada ? 'disabled' : ''}
            onchange="aoAlterarDataRevisaoImportacao(${idx}, this.value)">
        </div>
        <div class="ofx-revisao-info">
          <div class="ofx-revisao-desc">${descExibRevisaoHTML}</div>
          <div class="ofx-revisao-badges">
            ${badgeMeioPagamento}
            ${badgeTransferencia}
            ${badgeContaOrigem}
            ${badgeStatus}
            ${badgePagFatura}
            ${badgeFaturaPreview}
          </div>
        </div>
        <div class="ofx-revisao-val valor-sensivel ${classeValor}">${sinal} ${escHtml(toBRL(tx.valor))}</div>
        <div class="ofx-revisao-tipo-wrap">
          <select
            class="ofx-revisao-tipo-select"
            data-ofx-tipo-idx="${idx}"
            aria-label="Tipo para ${escHtml(tx.memo)}"
            onchange="aoAlterarTipoRevisaoImportacao(${idx}, this.value)">
            <option value="despesa"${tipoLinhaAtual === 'despesa' ? ' selected' : ''}>Despesa</option>
            <option value="receita"${tipoLinhaAtual === 'receita' ? ' selected' : ''}>Receita</option>
            <option value="transferencia"${tipoLinhaAtual === 'transferencia' ? ' selected' : ''}>⇄ Transferência</option>
          </select>
        </div>
        <div class="ofx-revisao-conta-wrap">
          <select
            class="ofx-revisao-conta-select"
            data-ofx-conta-idx="${idx}"
            aria-label="Conta ou Cartão para ${escHtml(tx.memo)}"
            onchange="aoAlterarContaLinhaRevisaoImportacao(${idx}, this.value)">
            ${optsContaLinha}
          </select>
        </div>
        ${colunaDireitaHTML}
      </div>
    `;
  }).join('');
}

function recalcularSaldoContaOFX(contaDestino) {
  if (!contaDestino) return 0;
  if (typeof recalcularLimitesCartoes === 'function') recalcularLimitesCartoes();

  if (contaDestino.tipo === 'cartao') {
    const pendentesCartao = (STATE.lancamentos || []).filter(
      l => l && l.conta === contaDestino.nome && l.tipo === 'despesa' && !ehLancamentoPagamentoFatura(l) && l.faturaPaga !== true
    );
    const totalFaturaAberta = Math.round(pendentesCartao.reduce((s, l) => s + (Number(l.valor) || 0), 0) * 100) / 100;
    contaDestino.saldo = totalFaturaAberta;
    return totalFaturaAberta;
  }

  const saldos = typeof saldoPorConta === 'function' ? saldoPorConta() : {};
  const saldoRecalculado = Math.round((Number(saldos[contaDestino.nome]) || 0) * 100) / 100;
  contaDestino.saldo = saldoRecalculado;
  return saldoRecalculado;
}

function criarPontaTransferenciaImportada({
  tipo, data, descricaoBase, seta, conta, contraparte, valor, origem, grupoId, uniqueId, rawTx, tags
}) {
  const temId = Boolean(uniqueId);
  const orig = String(origem || 'pluggy').toLowerCase();
  const descFinal = contraparte ? `${descricaoBase} ${seta} ${contraparte}` : descricaoBase;
  return {
    id: uid(),
    tipo,
    data,
    descricao: descFinal,
    categoria: 'Transferência',
    conta,
    valor,
    origem: orig,
    sincronizado: false,
    pago: true,
    status: 'Pago/Efetivado',
    ehTransferencia: true,
    isTransferencia: true,
    transferenciaId: grupoId,
    transferenciaGrupo: grupoId,
    transferenciaContraparte: contraparte || '',
    conciliado: temId,
    fitid: temId ? uniqueId : undefined,
    ofxFitId: (temId && orig === 'ofx') ? uniqueId : undefined,
    pluggyId: (temId && orig === 'pluggy') ? uniqueId : undefined,
    externalId: temId ? uniqueId : undefined,
    accountType: 'BANK',
    accountName: (rawTx && rawTx.accountName) || undefined,
    meioPagamento: 'conta',
    tags: (Array.isArray(tags) && tags.length) ? tags : undefined
  };
}

async function confirmarESalvarRevisaoImportacao() {
  if (!_ofxRevisaoContexto || !Array.isArray(transacoesPendentes)) {
    toast('Não há transações pendentes para salvar.', 'err');
    cancelarRevisaoImportacao();
    return;
  }

  const contaPadrao = (STATE.contas || []).find(c => c && c.nome === _ofxRevisaoContexto.contaNome) || STATE.contas[0];
  const origensParaSaldoPre = (_ofxRevisaoContexto.origem === 'PLUGGY')
    ? coletarOrigensDistintasPluggy(transacoesPendentes, contaPadrao, _ofxRevisaoContexto.contasPluggy || [])
    : [];
  const temSaldoPluggyBancoParaAjustar = origensParaSaldoPre.some(o => o.hasBalance);

  if (!transacoesPendentes.length && !temSaldoPluggyBancoParaAjustar) {
    toast('Não há transações pendentes para salvar.', 'err');
    cancelarRevisaoImportacao();
    return;
  }

  if (typeof document.querySelectorAll === 'function') {
    document.querySelectorAll('#ofx-revisao-lista .ofx-revisao-tipo-select[data-ofx-tipo-idx]').forEach((sel) => {
      const idx = parseInt(sel.dataset ? sel.dataset.ofxTipoIdx : sel.getAttribute('data-ofx-tipo-idx'), 10);
      if (Number.isInteger(idx) && transacoesPendentes[idx] && sel.value) {
        const val = sel.value;
        transacoesPendentes[idx].tipoRevisao = val;
        if (val === 'transferencia') {
          transacoesPendentes[idx].ehTransferencia = true;
          transacoesPendentes[idx].isTransferencia = true;
          transacoesPendentes[idx].categoria = 'Transferência';
        } else if (val === 'despesa' || val === 'receita') {
          transacoesPendentes[idx].ehTransferencia = false;
          transacoesPendentes[idx].isTransferencia = false;
          transacoesPendentes[idx].tipo = val;
          transacoesPendentes[idx].direcaoOriginal = val;
        }
      }
    });
    document.querySelectorAll('#ofx-revisao-lista .ofx-revisao-contraparte-select[data-ofx-contraparte-idx]').forEach((sel) => {
      const idx = parseInt(sel.dataset ? sel.dataset.ofxContraparteIdx : sel.getAttribute('data-ofx-contraparte-idx'), 10);
      if (Number.isInteger(idx) && transacoesPendentes[idx]) {
        transacoesPendentes[idx].contaContraparte = String(sel.value || '').trim();
      }
    });
    document.querySelectorAll('#ofx-revisao-lista .ofx-revisao-cat-select[data-ofx-idx]').forEach((sel) => {
      const idx = parseInt(sel.dataset ? sel.dataset.ofxIdx : sel.getAttribute('data-ofx-idx'), 10);
      if (Number.isInteger(idx) && transacoesPendentes[idx] && sel.value) {
        transacoesPendentes[idx].categoria = sel.value;
        if (normalizarTextoSemAcento(sel.value) === 'transferencia' && !transacoesPendentes[idx].ehPagamentoFaturaDetectado) {
          transacoesPendentes[idx].tipoRevisao = 'transferencia';
          transacoesPendentes[idx].ehTransferencia = true;
          transacoesPendentes[idx].isTransferencia = true;
        }
      }
    });
    document.querySelectorAll('#ofx-revisao-lista .ofx-revisao-conta-select[data-ofx-conta-idx]').forEach((sel) => {
      const idx = parseInt(sel.dataset ? sel.dataset.ofxContaIdx : sel.getAttribute('data-ofx-conta-idx'), 10);
      if (Number.isInteger(idx) && transacoesPendentes[idx] && sel.value) {
        transacoesPendentes[idx].contaDestino = sel.value;
      }
    });
    document.querySelectorAll('#ofx-revisao-lista .ofx-revisao-chk[data-ofx-chk]').forEach((chk) => {
      const idx = parseInt(chk.dataset ? chk.dataset.ofxChk : chk.getAttribute('data-ofx-chk'), 10);
      if (Number.isInteger(idx) && transacoesPendentes[idx]) {
        transacoesPendentes[idx].selecionada = Boolean(chk.checked);
      }
    });
    document.querySelectorAll('#ofx-revisao-lista .ofx-revisao-data-input[data-ofx-data-idx]').forEach((inp) => {
      const idx = parseInt(inp.dataset ? inp.dataset.ofxDataIdx : inp.getAttribute('data-ofx-data-idx'), 10);
      if (Number.isInteger(idx) && transacoesPendentes[idx] && inp.value) {
        const dataEdit = extrairDataLocalISO(inp.value, {
          retornarVazioSeInvalido: true,
          aceitarSerialExcel: false,
          silencioso: true
        });
        if (dataEdit) {
          transacoesPendentes[idx].data = dataEdit;
          if (transacoesPendentes[idx].ehCartaoCredito || normalizarTipoContaPluggy(transacoesPendentes[idx].accountType, String(_ofxRevisaoContexto.origem || '').toUpperCase()) === 'CREDIT') {
            transacoesPendentes[idx].dataCompra = dataEdit;
          }
        }
      }
    });
  }

  const marcarFaturasAnteriores = obterFlagMarcarFaturasAnterioresRevisao();

  // Validação prévia atômica: toda linha marcada como Transferência deve possuir
  // par completo válido (ou conta de contrapartida distinta) ANTES de gravar qualquer lançamento.
  for (let idx = 0; idx < transacoesPendentes.length; idx += 1) {
    const tx = transacoesPendentes[idx];
    if (!tx || tx.ehDuplicada || tx.ehParTransferenciaConsolidado || tx.selecionada === false) continue;
    if (tx.ehPagamentoFaturaDetectado || ehLancamentoPagamentoFatura(tx)) continue;
    const isTransf = tx.tipoRevisao === 'transferencia' || isLancamentoTransferencia(tx);
    if (!isTransf) continue;

    const contaOrigemAtualNome = extrairNomeLimpoDestinoImportacao(tx.contaDestino || (contaPadrao && contaPadrao.nome));
    const ehCartaoAtual = normalizarTipoContaPluggy(tx.accountType, String(_ofxRevisaoContexto.origem || '').toUpperCase()) === 'CREDIT'
      && (STATE.contas || []).some(c => c && c.tipo === 'cartao' && c.nome.toLowerCase() === contaOrigemAtualNome.toLowerCase());
    if (ehCartaoAtual) continue;

    const direcaoPre = tx.direcaoOriginal || (tx.tipo === 'receita' ? 'receita' : 'despesa');
    const temConciliarValido = Boolean(tx.transferenciaConciliarLegId && (STATE.lancamentos || []).some(l => l && l.id === tx.transferenciaConciliarLegId));
    const temExistenteValido = Boolean(tx.transferenciaExistenteId && (STATE.lancamentos || []).some(
      l => l && l.id === tx.transferenciaExistenteId
        && String(l.conta || '').toLowerCase() !== contaOrigemAtualNome.toLowerCase()
        && l.tipo !== direcaoPre
    ));
    if (temConciliarValido || temExistenteValido) continue;

    const valContra = String(tx.contaContraparte || '').trim();
    const contraLimpa = extrairNomeLimpoDestinoImportacao(valContra).toLowerCase();
    if (!valContra || valContra === '__SEM_CONTRAPARTE__' || !contraLimpa || contraLimpa === contaOrigemAtualNome.toLowerCase()) {
      if (typeof document.querySelector === 'function') {
        const selContra = document.querySelector(`#ofx-revisao-lista .ofx-revisao-contraparte-select[data-ofx-contraparte-idx="${idx}"]`);
        if (selContra && typeof selContra.focus === 'function') selContra.focus();
      }
      toast(`Selecione explicitamente a conta de contrapartida (diferente de ${contaOrigemAtualNome}) para a transferência "${tx.memo}".`, 'err');
      return false;
    }
  }

  if (!Array.isArray(STATE.lancamentos)) STATE.lancamentos = [];
  const idsExistentesGlobal = coletarIdsExistentesImportacao();
  const idsConsolidadosNesteLote = new Set();
  const origemPadrao = String(_ofxRevisaoContexto.origem || 'ofx').toLowerCase();
  const contasAfetadas = new Map();
  const mapaContasResolvidas = new Map();
  const pagamentosBancoImportados = [];

  let adicionados = 0;
  let ignoradosDuplicados = 0;
  let ignoradosDesmarcados = 0;

  for (const tx of transacoesPendentes) {
    const uniqueId = String((tx && (tx.fitid || tx.id || tx.externalId)) || '').trim();
    if (uniqueId && idsConsolidadosNesteLote.has(uniqueId)) {
      continue;
    }
    if (!uniqueId || tx.ehDuplicada || idsExistentesGlobal.has(uniqueId)) {
      ignoradosDuplicados += 1;
      continue;
    }

    if (tx.selecionada === false) {
      ignoradosDesmarcados += 1;
      continue;
    }

    const contaDestinoTx = resolverOuCriarContaDestinoTransacao(
      tx.contaDestino || (_ofxRevisaoContexto && _ofxRevisaoContexto.contaNome),
      tx.accountType,
      contaPadrao
    );
    if (!contaDestinoTx) continue;
    contasAfetadas.set(contaDestinoTx.nome, contaDestinoTx);
    mapaContasResolvidas.set(tx, contaDestinoTx);

    const ehCartao = (contaDestinoTx.tipo === 'cartao') || (normalizarTipoContaPluggy(tx.accountType, origemPadrao.toUpperCase()) === 'CREDIT' && contaDestinoTx.tipo === 'cartao');
    const desc = String((tx.memo || tx.descricao || 'Transação importada')).trim();
    const tagsInline = typeof extrairHashtagsDescricao === 'function' ? extrairHashtagsDescricao(desc) : [];
    const dataLanc = extrairDataLocalISO(
      tx.data || tx.date || tx.transactedAt || (tx.creditCardMetadata && tx.creditCardMetadata.purchaseDate) || tx.dataCompra,
      { contexto: { etapa: 'confirmarESalvarRevisaoImportacao', id: uniqueId, memo: desc } }
    );
    const origemTx = String(tx.origem || origemPadrao).toLowerCase();
    const valorNorm = Math.round((Number(tx.valor) || 0) * 100) / 100;
    const ehTransferenciaLinha = !ehCartao
      && !tx.ehPagamentoFaturaDetectado
      && !ehLancamentoPagamentoFatura(tx)
      && (tx.tipoRevisao === 'transferencia' || isLancamentoTransferencia(tx));

    if (ehTransferenciaLinha) {
      const direcao = tx.direcaoOriginal || (tx.tipo === 'receita' ? 'receita' : 'despesa');

      // 1) Conciliação de ponta manual já existente na mesma conta (evita duplicar saldo e garante par completo)
      if (tx.transferenciaConciliarLegId) {
        const legAlvo = STATE.lancamentos.find(l => l && l.id === tx.transferenciaConciliarLegId);
        if (legAlvo) {
          const grupoIdConcil = obterTransferenciaId(legAlvo) || uid();
          legAlvo.ehTransferencia = true;
          legAlvo.isTransferencia = true;
          legAlvo.categoria = 'Transferência';
          legAlvo.transferenciaId = grupoIdConcil;
          legAlvo.transferenciaGrupo = grupoIdConcil;
          legAlvo.fitid = uniqueId;
          if (origemTx === 'ofx') legAlvo.ofxFitId = uniqueId;
          if (origemTx === 'pluggy') legAlvo.pluggyId = uniqueId;
          legAlvo.externalId = uniqueId;
          legAlvo.conciliado = true;
          legAlvo.pago = true;
          legAlvo.status = 'Pago/Efetivado';
          legAlvo.sincronizado = false;

          // Garante que a ponta oposta exista em STATE.lancamentos para manter efeito líquido ZERO no saldo global
          const pontaOpostaExist = STATE.lancamentos.find(
            l => l && l.id !== legAlvo.id && obterTransferenciaId(l) === grupoIdConcil && l.tipo !== legAlvo.tipo
          );
          if (!pontaOpostaExist) {
            const valContraConcil = String(legAlvo.transferenciaContraparte || tx.contaContraparte || '').trim();
            const contaContraConcil = (valContraConcil && valContraConcil !== '__SEM_CONTRAPARTE__')
              ? resolverOuCriarContaDestinoTransacao(valContraConcil, 'BANK', null)
              : null;
            if (contaContraConcil && contaContraConcil.nome.toLowerCase() !== String(legAlvo.conta || '').toLowerCase()) {
              contasAfetadas.set(contaContraConcil.nome, contaContraConcil);
              legAlvo.transferenciaContraparte = contaContraConcil.nome;
              const tipoOposto = legAlvo.tipo === 'despesa' ? 'receita' : 'despesa';
              const pontaComplementar = criarPontaTransferenciaImportada({
                tipo: tipoOposto,
                data: legAlvo.data || dataLanc,
                descricaoBase: desc,
                seta: tipoOposto === 'despesa' ? '→' : '←',
                conta: contaContraConcil.nome,
                contraparte: legAlvo.conta,
                valor: Number(legAlvo.valor) || valorNorm,
                origem: origemTx,
                grupoId: grupoIdConcil,
                uniqueId: '',
                rawTx: tx,
                tags: tagsInline
              });
              STATE.lancamentos.push(pontaComplementar);
              adicionados += 1;
            }
          } else {
            pontaOpostaExist.ehTransferencia = true;
            pontaOpostaExist.isTransferencia = true;
            pontaOpostaExist.transferenciaId = grupoIdConcil;
            pontaOpostaExist.transferenciaGrupo = grupoIdConcil;
          }

          idsExistentesGlobal.add(uniqueId);
          adicionados += 1;
          continue;
        }
      }

      // 2) Pareamento com lançamento já existente em outra conta de STATE.lancamentos
      if (tx.transferenciaExistenteId) {
        const existenteOp = STATE.lancamentos.find(l => l && l.id === tx.transferenciaExistenteId);
        if (existenteOp && existenteOp.tipo !== direcao && String(existenteOp.conta || '').toLowerCase() !== contaDestinoTx.nome.toLowerCase()) {
          const grupoIdExist = obterTransferenciaId(existenteOp) || uid();
          const pontaMesmaContaExist = STATE.lancamentos.find(
            l => l && l.id !== existenteOp.id && obterTransferenciaId(l) === grupoIdExist && String(l.conta || '').toLowerCase() === contaDestinoTx.nome.toLowerCase() && l.tipo === direcao
          );
          existenteOp.ehTransferencia = true;
          existenteOp.isTransferencia = true;
          existenteOp.categoria = 'Transferência';
          existenteOp.transferenciaId = grupoIdExist;
          existenteOp.transferenciaGrupo = grupoIdExist;
          existenteOp.transferenciaContraparte = contaDestinoTx.nome;
          existenteOp.pago = true;
          existenteOp.status = 'Pago/Efetivado';
          existenteOp.sincronizado = false;

          const contaOpObj = (STATE.contas || []).find(c => c && c.nome === existenteOp.conta);
          if (contaOpObj) contasAfetadas.set(contaOpObj.nome, contaOpObj);

          if (pontaMesmaContaExist) {
            pontaMesmaContaExist.ehTransferencia = true;
            pontaMesmaContaExist.isTransferencia = true;
            pontaMesmaContaExist.transferenciaId = grupoIdExist;
            pontaMesmaContaExist.transferenciaGrupo = grupoIdExist;
            pontaMesmaContaExist.fitid = uniqueId;
            if (origemTx === 'ofx') pontaMesmaContaExist.ofxFitId = uniqueId;
            if (origemTx === 'pluggy') pontaMesmaContaExist.pluggyId = uniqueId;
            pontaMesmaContaExist.externalId = uniqueId;
            pontaMesmaContaExist.conciliado = true;
            pontaMesmaContaExist.pago = true;
            pontaMesmaContaExist.status = 'Pago/Efetivado';
            idsExistentesGlobal.add(uniqueId);
            adicionados += 1;
            continue;
          }

          const novaPontaPareada = criarPontaTransferenciaImportada({
            tipo: direcao,
            data: dataLanc,
            descricaoBase: desc,
            seta: direcao === 'despesa' ? '→' : '←',
            conta: contaDestinoTx.nome,
            contraparte: existenteOp.conta,
            valor: valorNorm,
            origem: origemTx,
            grupoId: grupoIdExist,
            uniqueId,
            rawTx: tx,
            tags: tagsInline
          });
          STATE.lancamentos.push(novaPontaPareada);
          idsExistentesGlobal.add(uniqueId);
          adicionados += 1;
          continue;
        }
      }

      // 3) Transferência completa em par (ponta origem + ponta destino sincronizadas com o mesmo transferenciaId)
      const valContraparte = String(tx.contaContraparte || '').trim();
      const contaContraparteObj = (valContraparte && valContraparte !== '__SEM_CONTRAPARTE__')
        ? resolverOuCriarContaDestinoTransacao(valContraparte, 'BANK', null)
        : null;

      if (contaContraparteObj && contaContraparteObj.nome.toLowerCase() !== contaDestinoTx.nome.toLowerCase()) {
        contasAfetadas.set(contaContraparteObj.nome, contaContraparteObj);
        const grupoId = uid();
        const idParRef = tx.transferenciaParId || tx.transferenciaPrincipalId || '';
        const rawPar = idParRef
          ? transacoesPendentes.find(p => p && p !== tx && (p.fitid === idParRef || p.id === idParRef))
          : null;
        const contaOrigemObj = direcao === 'despesa' ? contaDestinoTx : contaContraparteObj;
        const contaDestObj = direcao === 'despesa' ? contaContraparteObj : contaDestinoTx;
        const txSaida = direcao === 'despesa' ? tx : rawPar;
        const txEntrada = direcao === 'receita' ? tx : rawPar;
        const idSaida = txSaida ? String(txSaida.fitid || txSaida.id || txSaida.externalId || '').trim() : '';
        const idEntrada = txEntrada ? String(txEntrada.fitid || txEntrada.id || txEntrada.externalId || '').trim() : '';

        const lancSaida = criarPontaTransferenciaImportada({
          tipo: 'despesa',
          data: extrairDataLocalISO((txSaida && txSaida.data) || dataLanc, { contexto: { etapa: 'transferenciaSaida', grupoId } }),
          descricaoBase: (txSaida && String(txSaida.memo || txSaida.descricao || '').trim()) || desc,
          seta: '→',
          conta: contaOrigemObj.nome,
          contraparte: contaDestObj.nome,
          valor: valorNorm,
          origem: (txSaida && txSaida.origem) || origemTx,
          grupoId,
          uniqueId: idSaida,
          rawTx: txSaida || tx,
          tags: tagsInline
        });

        const lancEntrada = criarPontaTransferenciaImportada({
          tipo: 'receita',
          data: extrairDataLocalISO((txEntrada && txEntrada.data) || dataLanc, { contexto: { etapa: 'transferenciaEntrada', grupoId } }),
          descricaoBase: (txEntrada && String(txEntrada.memo || txEntrada.descricao || '').trim()) || desc,
          seta: '←',
          conta: contaDestObj.nome,
          contraparte: contaOrigemObj.nome,
          valor: valorNorm,
          origem: (txEntrada && txEntrada.origem) || origemTx,
          grupoId,
          uniqueId: idEntrada,
          rawTx: txEntrada || tx,
          tags: tagsInline
        });

        STATE.lancamentos.push(lancSaida);
        STATE.lancamentos.push(lancEntrada);
        idsExistentesGlobal.add(uniqueId);
        if (rawPar) {
          const parUid = String(rawPar.fitid || rawPar.id || rawPar.externalId || '').trim();
          if (parUid) {
            idsExistentesGlobal.add(parUid);
            idsConsolidadosNesteLote.add(parUid);
          }
        }
        adicionados += 2;
        continue;
      }

      toast(`Transferência ignorada: conta de contrapartida inválida para "${tx.memo}".`, 'err');
      return false;
    }

    const tipoFinal = (tx.tipoRevisao === 'receita' || tx.tipoRevisao === 'despesa') ? tx.tipoRevisao : (tx.tipo || 'despesa');
    const categoriaBruta = String(tx.categoria || '').trim() || autoCategorizar(desc, tipoFinal);
    const categoriaFinal = (!ehCartao && !tx.ehPagamentoFaturaDetectado && normalizarTextoSemAcento(categoriaBruta) === 'transferencia')
      ? 'Outros'
      : categoriaBruta;
    const accountTypeFinal = ehCartao ? 'CREDIT' : 'BANK';
    const pagoContaBase = tx.pago !== undefined ? Boolean(tx.pago) : true;

    const tagsCombinadas = Array.isArray(tagsInline) ? [...tagsInline] : [];
    const tagRegraLimpa = String(tx.tagSugerida || '').trim().replace(/^#+/, '');
    if (tagRegraLimpa && !tagsCombinadas.some(t => String(t).toLowerCase() === tagRegraLimpa.toLowerCase())) {
      tagsCombinadas.push(tagRegraLimpa);
    }
    const apelidoFinal = String(tx.apelidoSugerido || '').trim();
    const descBrutaOrig = String(tx.descricaoOriginal || desc).trim();
    const descFinalLanc = apelidoFinal || desc;
    const descOrigSalvar = apelidoFinal ? descBrutaOrig : (tx.descricaoOriginal && tx.descricaoOriginal !== desc ? tx.descricaoOriginal : undefined);

    const novoLanc = {
      id: uid(),
      fitid: uniqueId,
      ofxFitId: origemTx === 'ofx' ? uniqueId : undefined,
      pluggyId: origemTx === 'pluggy' ? uniqueId : undefined,
      externalId: uniqueId,
      trnType: tx.trnType || (tipoFinal === 'receita' ? 'CREDIT' : 'DEBIT'),
      accountType: accountTypeFinal,
      accountName: tx.accountName || undefined,
      meioPagamento: ehCartao ? 'cartao' : 'conta',
      origem: origemTx,
      tipo: tipoFinal,
      data: dataLanc,
      dataCompra: ehCartao ? dataLanc : undefined,
      descricao: descFinalLanc,
      descricaoOriginal: descOrigSalvar,
      categoria: categoriaFinal,
      conta: contaDestinoTx.nome,
      cartaoId: ehCartao ? (contaDestinoTx.id || undefined) : undefined,
      cartaoNome: ehCartao ? contaDestinoTx.nome : undefined,
      valor: valorNorm,
      pago: ehCartao ? (tipoFinal === 'receita') : pagoContaBase,
      status: ehCartao ? (tipoFinal === 'receita' ? 'Liquidado' : 'Pendente') : (pagoContaBase ? 'Pago/Efetivado' : 'Pendente'),
      conciliado: true,
      sincronizado: false,
      tags: tagsCombinadas.length ? tagsCombinadas : undefined
    };
    if (tx.classificacaoOrigem === 'regra' && tx.classificacaoRegraId && !ehLancamentoProtegidoAutoCat(novoLanc)) {
      const rUsada = (STATE.regrasCategoria || []).find(r => r && r.id === tx.classificacaoRegraId);
      if (rUsada) rUsada.usos = (parseInt(rUsada.usos, 10) || 0) + 1;
    }

    if (ehCartao && novoLanc.tipo === 'despesa' && typeof competenciaFatura === 'function') {
      const fechamento = parseInt(contaDestinoTx.diaFechamento, 10) || 1;
      const vencimento = parseInt(contaDestinoTx.diaVencimento, 10) || 10;
      const comp = competenciaFatura(dataLanc, fechamento);
      novoLanc.faturaAno = comp.ano;
      novoLanc.faturaMes = comp.mes;
      novoLanc.faturaCompetencia = `${String(comp.mes).padStart(2, '0')}/${comp.ano}`;
      novoLanc.dataVencimentoFatura = calcularVencimentoFatura(comp.ano, comp.mes, fechamento, vencimento);
      novoLanc.faturaPaga = false;
      novoLanc.pago = false;
      novoLanc.status = 'Pendente';
    } else if (ehCartao && ehTransacaoPagamentoFaturaPluggy(desc, tx.rawCategory || tx.categoria)) {
      novoLanc.ehTransferencia = true;
      novoLanc.ehPagamentoFatura = true;
      novoLanc.categoria = 'Transferência/Pagamento de Fatura';
      novoLanc.status = 'Pago/Efetivado';
    } else if (!ehCartao && novoLanc.tipo === 'despesa' && (tx.ehPagamentoFaturaDetectado || ehTransacaoPagamentoFaturaPluggy(desc, tx.rawCategory || tx.categoria))) {
      novoLanc.ehPagamentoFatura = true;
      novoLanc.ehTransferencia = true;
      novoLanc.categoria = 'Transferência/Pagamento de Fatura';
      novoLanc.pago = true;
      novoLanc.status = 'Pago/Efetivado';
      pagamentosBancoImportados.push({
        _lancId: novoLanc.id,
        _lancRef: novoLanc,
        data: novoLanc.data,
        valor: novoLanc.valor,
        descricao: novoLanc.descricao,
        conta: novoLanc.conta
      });
    }

    STATE.lancamentos.push(novoLanc);
    idsExistentesGlobal.add(uniqueId);
    adicionados += 1;
  }

  // Liquida automaticamente faturas de meses anteriores (quando marcado) e faturas com pagamento detectado
  const planoQuitacao = calcularPlanoQuitacaoFaturasRevisao(transacoesPendentes, {
    marcarFaturasAnterioresPagas: marcarFaturasAnteriores,
    pagamentosBancoRecentes: pagamentosBancoImportados,
    contasResolvidasPorTx: mapaContasResolvidas
  });

  let qtdFaturasQuitadas = 0;
  planoQuitacao.faturasParaQuitar.forEach((itemPlano) => {
    const infoCartao = resolverCartaoPorIdOuNome(itemPlano.cartaoNome);
    if (!infoCartao) return;

    const itensFatura = lancamentosDaFatura(infoCartao.nome, itemPlano.ano, itemPlano.mes);
    if (!itensFatura.length) return;

    const resQuitacao = quitarItensFaturaCartao(infoCartao, itemPlano.ano, itemPlano.mes, {
      dataPagamento: itemPlano.dataPagamento,
      contaOrigem: itemPlano.contaOrigem,
      pagamentoFaturaId: itemPlano.pagamentoFaturaId,
      quitacaoRetroativa: itemPlano.quitacaoRetroativa,
      pagamentoDetectado: itemPlano.pagamentoDetectado,
      origemQuitacao: itemPlano.origemQuitacao
    });

    if (itemPlano.lancBancoRef) {
      const regFatura = STATE.config && STATE.config.faturasPagas && STATE.config.faturasPagas[resQuitacao.chaveFaturaPaga];
      itemPlano.lancBancoRef.cartaoNome = infoCartao.nome;
      itemPlano.lancBancoRef.cartaoId = infoCartao.id || infoCartao.nome;
      itemPlano.lancBancoRef.faturaAno = itemPlano.ano;
      itemPlano.lancBancoRef.faturaMes = itemPlano.mes;
      itemPlano.lancBancoRef.faturaCompetencia = `${String(itemPlano.mes).padStart(2, '0')}/${itemPlano.ano}`;
      if (regFatura && Array.isArray(regFatura.itensPagosIds)) {
        itemPlano.lancBancoRef.itensPagosIds = [...regFatura.itensPagosIds];
      }
    }
    qtdFaturasQuitadas += 1;
  });

  if (typeof sincronizarEstruturaCartoes === 'function') sincronizarEstruturaCartoes();
  if (typeof normalizarLancamentosCartaoExistentes === 'function') normalizarLancamentosCartaoExistentes();
  if (typeof recalcularLimitesCartoes === 'function') recalcularLimitesCartoes();

  // Conciliação automática de Saldo Inicial para contas BANK Pluggy com saldo real informado pelo banco
  let qtdSaldosAjustados = 0;
  const ajustarSaldoInicial = (_ofxRevisaoContexto.origem === 'PLUGGY')
    ? obterFlagAjustarSaldoInicialPluggy()
    : false;
  if (ajustarSaldoInicial) {
    const origensFinais = coletarOrigensDistintasPluggy(
      transacoesPendentes,
      contaPadrao,
      _ofxRevisaoContexto.contasPluggy || []
    );
    const alvosPorConta = new Map();
    const origensVistas = new Set();

    origensFinais.forEach((orig) => {
      if (!orig || orig.accountType !== 'BANK' || !orig.hasBalance) return;
      const chaveDedupe = orig.accountId || orig.chave;
      if (origensVistas.has(chaveDedupe)) return;
      origensVistas.add(chaveDedupe);

      const destinoMapa = (_ofxRevisaoContexto.mapaOrigens && _ofxRevisaoContexto.mapaOrigens[orig.chave])
        || orig.contaDestino
        || _ofxRevisaoContexto.contaNome;
      const contaAlvo = resolverOuCriarContaDestinoTransacao(destinoMapa, 'BANK', contaPadrao);
      if (!contaAlvo || contaAlvo.tipo === 'cartao') return;

      contasAfetadas.set(contaAlvo.nome, contaAlvo);
      const acumulado = alvosPorConta.get(contaAlvo.nome) || { conta: contaAlvo, saldoReal: 0 };
      acumulado.saldoReal = Math.round((acumulado.saldoReal + Number(orig.balance)) * 100) / 100;
      if (orig.accountId && !contaAlvo.pluggyAccountId) {
        contaAlvo.pluggyAccountId = orig.accountId;
      }
      alvosPorConta.set(contaAlvo.nome, acumulado);
    });

    if (alvosPorConta.size > 0) {
      const movimentosSemInicial = calcularSomaLancamentosEfetivadosPorConta();
      alvosPorConta.forEach(({ conta, saldoReal }) => {
        const saldoCalculadoSemInicial = Math.round((Number(movimentosSemInicial[conta.nome]) || 0) * 100) / 100;
        const novoSaldoInicial = Math.round((saldoReal - saldoCalculadoSemInicial) * 100) / 100;
        conta.saldoInicial = novoSaldoInicial;
        conta.pluggyBalanceReal = saldoReal;
        conta.pluggyBalanceSyncAt = new Date().toISOString();
        qtdSaldosAjustados += 1;
      });
    }
  }

  contasAfetadas.forEach((c) => recalcularSaldoContaOFX(c));
  if (contaPadrao && !contasAfetadas.has(contaPadrao.nome)) {
    recalcularSaldoContaOFX(contaPadrao);
  }

  await salvarDados();
  cancelarRevisaoImportacao();
  popularContasSelect();
  renderDashboard();
  renderPaginaAtiva();
  if (document.getElementById('page-cartoes')) renderCartoes();
  if (typeof sincronizarEmSegundoPlano === 'function') sincronizarEmSegundoPlano();

  const nomesContasSalvas = [...contasAfetadas.keys()].join(', ') || (contaPadrao ? contaPadrao.nome : 'COFIN');
  if (adicionados > 0 || qtdFaturasQuitadas > 0 || qtdSaldosAjustados > 0) {
    const detalhes = [];
    if (qtdSaldosAjustados > 0) detalhes.push(`saldo inicial conciliado em ${qtdSaldosAjustados} conta(s)`);
    if (qtdFaturasQuitadas > 0) detalhes.push(`${qtdFaturasQuitadas} fatura(s) marcada(s) como Paga(s)`);
    if (ignoradosDuplicados > 0) detalhes.push(`${ignoradosDuplicados} duplicada(s)`);
    if (ignoradosDesmarcados > 0) detalhes.push(`${ignoradosDesmarcados} desmarcada(s)`);
    const sufixo = detalhes.length ? ` (${detalhes.join(' · ')})` : '';
    const msgBase = adicionados > 0
      ? `Importação concluída! ${adicionados} lançamento(s) salvo(s) em ${nomesContasSalvas}`
      : (qtdSaldosAjustados > 0
          ? `Conciliação de saldo concluída em ${nomesContasSalvas}`
          : `Conciliação de faturas concluída`);
    toast(`${msgBase}${sufixo}.`, 'ok');
  } else {
    toast(`Nenhuma transação nova importada (${ignoradosDuplicados} duplicada(s), ${ignoradosDesmarcados} desmarcada(s)).`, 'info');
  }
}
const confirmarESalvarRevisaoOFX = confirmarESalvarRevisaoImportacao;

function cancelarRevisaoImportacao(chamadoPorFechamento) {
  transacoesPendentes = [];
  _ofxRevisaoContexto = null;
  const listaEl = document.getElementById('ofx-revisao-lista');
  if (listaEl) listaEl.innerHTML = '';
  if (!chamadoPorFechamento) {
    fecharModal('modal-revisao-importacao');
  } else {
    const el = document.getElementById('modal-revisao-importacao') || document.getElementById('modal-revisao-ofx');
    if (el) el.classList.remove('show');
    if (typeof atualizarEstadoModais === 'function') atualizarEstadoModais();
  }
}
const cancelarRevisaoOFX = cancelarRevisaoImportacao;

/* ================= INTEGRAÇÃO OPEN FINANCE (PLUGGY CONNECT & CREDENCIAIS SEGURAS) ================= */
let _pluggyContinuarConexaoAposSalvar = false;

function atualizarStatusUIPluggy(mensagem, textoBadge) {
  const msgEl = document.getElementById('pluggy-status-msg');
  if (msgEl && mensagem) msgEl.textContent = mensagem;
  const badgeEl = document.getElementById('pluggy-status-badge');
  if (badgeEl && textoBadge) badgeEl.textContent = textoBadge;
}

function expurgarInputsCredenciaisPluggyDOM() {
  const inputId = document.getElementById('pluggy-client-id');
  const inputSecret = document.getElementById('pluggy-client-secret');
  if (inputId) {
    inputId.value = '';
    inputId.removeAttribute('value');
    if (inputId.dataset) delete inputId.dataset.initialValue;
  }
  if (inputSecret) {
    inputSecret.value = '';
    inputSecret.removeAttribute('value');
    if (inputSecret.dataset) delete inputSecret.dataset.initialValue;
  }
}

function abrirModalConfigPluggy(continuarConexao = false) {
  _pluggyContinuarConexaoAposSalvar = Boolean(continuarConexao);
  expurgarInputsCredenciaisPluggyDOM();
  abrirModal('modal-config-pluggy');
  const inputId = document.getElementById('pluggy-client-id');
  if (inputId && typeof inputId.focus === 'function') inputId.focus();
}

function fecharModalConfigPluggy(chamadoPorFechamento) {
  _pluggyContinuarConexaoAposSalvar = false;
  expurgarInputsCredenciaisPluggyDOM();
  if (!chamadoPorFechamento) {
    fecharModal('modal-config-pluggy');
  } else {
    const el = document.getElementById('modal-config-pluggy');
    if (el) el.classList.remove('show');
    if (typeof atualizarEstadoModais === 'function') atualizarEstadoModais();
  }
}

async function salvarConfiguracaoPluggy() {
  const inputId = document.getElementById('pluggy-client-id');
  const inputSecret = document.getElementById('pluggy-client-secret');

  let clientId = inputId ? String(inputId.value || '').trim() : '';
  let clientSecret = inputSecret ? String(inputSecret.value || '').trim() : '';

  // Expurga imediatamente os inputs do DOM antes de qualquer operação assíncrona
  expurgarInputsCredenciaisPluggyDOM();

  if (!clientId || !clientSecret) {
    clientId = '';
    clientSecret = '';
    toast('Preencha tanto o PLUGGY_CLIENT_ID quanto o PLUGGY_CLIENT_SECRET.', 'err');
    return false;
  }

  if (!window.electronAPI || typeof window.electronAPI.salvarCredenciaisPluggy !== 'function') {
    clientId = '';
    clientSecret = '';
    toast('A gravação segura no .env requer o ambiente Desktop (Electron).', 'err');
    return false;
  }

  const deveContinuarConexao = _pluggyContinuarConexaoAposSalvar;

  try {
    const payload = { clientId, clientSecret };
    // Limpa referências locais em memória no frontend imediatamente após empacotar para o IPC
    clientId = '';
    clientSecret = '';

    const res = await window.electronAPI.salvarCredenciaisPluggy(payload);
    payload.clientId = '';
    payload.clientSecret = '';

    if (!res || !res.ok) {
      toast((res && res.erro) || 'Falha ao gravar credenciais no ficheiro .env.', 'err');
      return false;
    }

    fecharModalConfigPluggy();
    atualizarStatusUIPluggy('Credenciais Pluggy gravadas com segurança no .env.', 'Credenciais Ativas · .env');
    toast('Credenciais Pluggy salvas com segurança no ficheiro .env!', 'ok');

    if (deveContinuarConexao) {
      await conectarBancoPluggy();
    }
    return true;
  } catch (err) {
    clientId = '';
    clientSecret = '';
    console.error('[Pluggy] Erro ao salvar credenciais via IPC:', err);
    toast('Erro ao comunicar com o processo principal para gravar o .env.', 'err');
    return false;
  }
}

let _unsubscribePluggyItemConnected = null;

function registrarItemIdPluggyNoState(itemId, listaAdicional = []) {
  if (!STATE.config) STATE.config = {};
  if (!Array.isArray(STATE.config.pluggyItemIds)) {
    STATE.config.pluggyItemIds = [];
  }

  const todosNovos = [
    itemId,
    ...(Array.isArray(listaAdicional) ? listaAdicional : [])
  ]
    .map(id => String(id || '').trim())
    .filter(Boolean);

  for (const id of todosNovos) {
    STATE.config.pluggyItemIds = [
      id,
      ...STATE.config.pluggyItemIds.filter(existente => existente !== id)
    ];
  }

  if (todosNovos[0]) {
    STATE.config.pluggyLastItemId = todosNovos[0];
  }
}

function inicializarListenerPluggyConnect() {
  if (!window.electronAPI || typeof window.electronAPI.onPluggyItemConnected !== 'function') {
    return;
  }
  if (typeof _unsubscribePluggyItemConnected === 'function') {
    try { _unsubscribePluggyItemConnected(); } catch (_e) {}
    _unsubscribePluggyItemConnected = null;
  }

  _unsubscribePluggyItemConnected = window.electronAPI.onPluggyItemConnected(async (payload) => {
    const itemId = typeof payload === 'string'
      ? payload.trim()
      : (payload && typeof payload.itemId === 'string' ? payload.itemId.trim() : '');
    if (!itemId) return;

    registrarItemIdPluggyNoState(itemId);
    await salvarDados();

    atualizarStatusUIPluggy(
      `Conexão Pluggy recebida com sucesso (${itemId.slice(0, 8)}). Sincronizando lançamentos...`,
      'Conectado'
    );
    toast('Banco conectado no navegador! Sincronizando lançamentos automaticamente...', 'ok');

    await sincronizarItemPluggyPorId(itemId);
  });
}

async function sincronizarItemPluggyPorId(itemId) {
  const idLimpo = String(itemId || '').trim();
  if (!window.electronAPI) {
    toast('A sincronização Open Finance (Pluggy) requer o ambiente Desktop (Electron).', 'err');
    return [];
  }

  try {
    atualizarStatusUIPluggy(
      idLimpo
        ? `Sincronizando contas e transações do item ${idLimpo.slice(0, 8)}...`
        : 'Buscando itens e contas conectadas via Open Finance (Pluggy)...',
      'Sincronizando · Pluggy'
    );
    toast('Buscando contas e transações via Open Finance (Pluggy)...', 'ok');

    let todasTransacoes = [];
    let contasPluggy = [];
    let nomeContaPrincipal = '';
    let itemIdResolvido = idLimpo;
    let itemIdsResolvidos = [];
    const itemIdsLocais = (STATE.config && Array.isArray(STATE.config.pluggyItemIds))
      ? STATE.config.pluggyItemIds
      : [];

    if (typeof window.electronAPI.sincronizarItemPluggy === 'function') {
      const resSync = await window.electronAPI.sincronizarItemPluggy({
        itemId: idLimpo || undefined,
        itemIds: itemIdsLocais
      });
      if (!resSync || !resSync.ok) {
        throw new Error((resSync && resSync.erro) || 'Falha ao sincronizar item no Pluggy.');
      }
      if (Array.isArray(resSync.itemIds)) {
        itemIdsResolvidos = resSync.itemIds;
      }
      if (!itemIdResolvido && resSync.itemId) {
        itemIdResolvido = String(resSync.itemId).trim();
      }
      contasPluggy = Array.isArray(resSync.accounts) ? resSync.accounts : [];
      if (contasPluggy[0] && contasPluggy[0].name) nomeContaPrincipal = contasPluggy[0].name;
      todasTransacoes = Array.isArray(resSync.transactions) ? resSync.transactions : [];
    } else if (typeof window.electronAPI.buscarContasPluggy === 'function' && typeof window.electronAPI.buscarTransacoesPluggy === 'function') {
      const resContas = await window.electronAPI.buscarContasPluggy({
        itemId: idLimpo || undefined,
        itemIds: itemIdsLocais
      });
      if (!resContas || !resContas.ok) {
        throw new Error((resContas && resContas.erro) || 'Falha ao buscar contas no Pluggy.');
      }
      contasPluggy = Array.isArray(resContas.accounts) ? resContas.accounts : [];
      if (Array.isArray(resContas.itemIds)) {
        itemIdsResolvidos = resContas.itemIds;
      }
      if (!itemIdResolvido) {
        itemIdResolvido = String(resContas.itemId || (contasPluggy[0] && contasPluggy[0].itemId) || '').trim();
      }
      if (contasPluggy[0] && contasPluggy[0].name) nomeContaPrincipal = contasPluggy[0].name;

      for (const acc of contasPluggy) {
        const resTx = await window.electronAPI.buscarTransacoesPluggy({
          accountId: acc.id,
          accountMeta: { id: acc.id, name: acc.name, type: acc.type, balance: acc.balance }
        });
        if (resTx && resTx.ok && Array.isArray(resTx.transactions)) {
          resTx.transactions.forEach(tx => {
            todasTransacoes.push({
              ...tx,
              accountId: tx.accountId || acc.id,
              accountName: tx.accountName || acc.name || '',
              accountType: tx.accountType || acc.type || ''
            });
          });
        }
      }
    } else {
      throw new Error('Canais IPC do Pluggy não disponíveis no preload.');
    }

    registrarItemIdPluggyNoState(itemIdResolvido, itemIdsResolvidos);
    STATE.config.pluggyLastSyncAt = new Date().toISOString();
    await salvarDados();

    atualizarStatusUIPluggy(
      `Sincronização Pluggy concluída (${todasTransacoes.length} transação(ões) obtida(s)).`,
      'Conectado'
    );

    return processarNovasTransacoes(todasTransacoes, 'PLUGGY', {
      nomeArquivo: nomeContaPrincipal ? `Pluggy · ${nomeContaPrincipal}` : 'Pluggy Open Finance',
      accounts: contasPluggy
    });
  } catch (err) {
    console.error('[Pluggy] Erro na sincronização Open Finance:', err);
    const msg = (err && err.message) ? err.message : 'Erro ao sincronizar dados do banco via Pluggy.';
    atualizarStatusUIPluggy(`Falha na sincronização: ${msg}`, 'Atenção · Pluggy');
    toast(msg, 'err');
    return [];
  }
}

async function sincronizarUltimoItemPluggy() {
  const ultimoItemId = (STATE.config && STATE.config.pluggyLastItemId) || '';
  return await sincronizarItemPluggyPorId(ultimoItemId);
}
const sincronizarBancosPluggy = sincronizarUltimoItemPluggy;

async function conectarBancoPluggy(itemIdParaAtualizar) {
  if (!window.electronAPI || typeof window.electronAPI.verificarCredenciaisPluggy !== 'function') {
    toast('A conexão Open Finance (Pluggy) requer o aplicativo Desktop (Electron).', 'err');
    return;
  }

  try {
    const check = await window.electronAPI.verificarCredenciaisPluggy();
    const possuiCredenciais = Boolean(check && (check.configured || check.hasCredentials));

    if (!possuiCredenciais) {
      atualizarStatusUIPluggy('Configure o PLUGGY_CLIENT_ID e PLUGGY_CLIENT_SECRET para ativar o Open Finance.', 'Configuração Necessária');
      abrirModalConfigPluggy(true);
      return;
    }

    atualizarStatusUIPluggy('Solicitando Connect Token efêmero ao processo principal...', 'Autenticando · Pluggy');
    const opcoesToken = (typeof itemIdParaAtualizar === 'string' && itemIdParaAtualizar.trim())
      ? { itemId: itemIdParaAtualizar.trim() }
      : {};
    const resToken = await window.electronAPI.criarPluggyConnectToken(opcoesToken);

    if (!resToken || !resToken.ok || !resToken.accessToken) {
      if (resToken && resToken.code === 'MISSING_CREDENTIALS') {
        abrirModalConfigPluggy(true);
        return;
      }
      const msgErro = (resToken && resToken.erro) || 'Não foi possível gerar o Connect Token do Pluggy.';
      atualizarStatusUIPluggy(msgErro, 'Erro de Autenticação');
      toast(msgErro, 'err');
      return;
    }

    const connectToken = resToken.accessToken;
    const resBrowser = await window.electronAPI.abrirPluggyNoNavegador(connectToken);
    if (!resBrowser || !resBrowser.ok) {
      const msgErroBrowser = (resBrowser && resBrowser.erro) || 'Não foi possível abrir o Pluggy Connect no navegador padrão.';
      atualizarStatusUIPluggy(msgErroBrowser, 'Erro · Pluggy');
      toast(msgErroBrowser, 'err');
      return;
    }

    const msgAviso = "Pluggy Connect aberto no seu navegador. Conclua a conexão por lá e depois clique em 'Sincronizar Bancos' aqui no COFIN.";
    atualizarStatusUIPluggy(msgAviso, 'Aguardando Conexão · Navegador');
    toast(msgAviso, 'ok');
  } catch (err) {
    console.error('[Pluggy] Falha ao iniciar Pluggy Connect:', err);
    toast((err && err.message) || 'Erro inesperado ao abrir o Pluggy Connect.', 'err');
  }
}

const iniciarPluggyConnect = conectarBancoPluggy;
const abrirPluggyConnect = conectarBancoPluggy;
inicializarListenerPluggyConnect();

function inicializarDropzoneOFX() {
  const dropzone = document.getElementById('ofx-dropzone');
  const fileInput = document.getElementById('ofx-file-input');

  if (fileInput && fileInput.dataset.ofxInputBound !== '1') {
    fileInput.dataset.ofxInputBound = '1';
    fileInput.addEventListener('change', (e) => {
      const f = e.target && e.target.files && e.target.files[0];
      if (f) lerArquivoOFX(f);
      fileInput.value = '';
    });
  }

  if (!dropzone || dropzone.dataset.ofxBound === '1') return;
  dropzone.dataset.ofxBound = '1';

  const ocultarOverlayGlobal = () => {
    if (typeof dragDropCounter !== 'undefined') dragDropCounter = 0;
    const overlayOCR = document.getElementById('dropzone-overlay');
    if (overlayOCR) overlayOCR.style.display = 'none';
    const overlayOFX = document.getElementById('ofx-drag-overlay');
    if (overlayOFX) overlayOFX.classList.add('oculto');
  };

  dropzone.addEventListener('dragenter', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ocultarOverlayGlobal();
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ocultarOverlayGlobal();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
    dropzone.classList.add('dragover');
  });

  dropzone.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!e.relatedTarget || !dropzone.contains(e.relatedTarget)) {
      dropzone.classList.remove('dragover');
    }
  });

  dropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    ocultarOverlayGlobal();
    dropzone.classList.remove('dragover');
    const files = e.dataTransfer && e.dataTransfer.files;
    const file = files && files[0];
    if (file) {
      lerArquivoOFX(file);
    }
  });

  dropzone.addEventListener('click', () => {
    abrirSeletorArquivoOFX();
  });

  dropzone.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      abrirSeletorArquivoOFX();
    }
  });
}

/* ================= INIT ================= */
inicializarDropzoneOFX();
const contentEl = document.querySelector('.content');
const topbarEl = document.querySelector('.topbar');
if (contentEl && topbarEl) {
  contentEl.addEventListener('scroll', () => {
    topbarEl.classList.toggle('scrolled', contentEl.scrollTop > 10);
  }, { passive: true });
}
const inputLancValor = document.getElementById('lanc-valor');
if (inputLancValor) {
  inputLancValor.addEventListener('blur', function () {
    avaliarExpressaoMoeda(this);
  });
}
const inputLancDesc = document.getElementById('lanc-descricao');
if (inputLancDesc) {
  inputLancDesc.addEventListener('input', sugerirCategoriaPorRegra);
}
const dropZoneAnexo = document.getElementById('drop-zone-anexo');
if (dropZoneAnexo) {
  dropZoneAnexo.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneAnexo.classList.add('drag-active');
  });
  dropZoneAnexo.addEventListener('dragleave', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneAnexo.classList.remove('drag-active');
  });
  dropZoneAnexo.addEventListener('drop', (e) => {
    e.preventDefault();
    e.stopPropagation();
    dropZoneAnexo.classList.remove('drag-active');
    const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) anexarComprovante(file);
  });
}
document.querySelectorAll('.modal-bg').forEach(m => m.addEventListener('click', e => {
  if (e.target !== m) return;
  if (m.id === 'modal-prompt') { cancelarPrompt(); }
  else if (m.id === 'modal-patch-notes') { fecharModalPatchNotes(); }
  else if (m.id === 'modal-vincular-ofx') { cancelarVinculoOFX(); }
  else if (m.id === 'modal-revisao-ofx') { cancelarRevisaoOFX(); }
  else { fecharModal(m.id); }
}));
document.addEventListener('click', (e) => {
  const navBtn = e.target && e.target.closest
    ? e.target.closest('.nav-item[data-page], .bottom-nav-item[data-page], .mobile-more-item[data-page]')
    : null;
  if (!navBtn) return;
  const targetPage = navBtn.getAttribute('data-page');
  if (targetPage) nav(targetPage);
});

(async function init() {
  sincronizarIconeTema();
  document.getElementById('app-versao').textContent = 'COFIN · v' + CURRENT_VERSION + ' (' + APP_VERSAO + ')';
  inicializarModoStealth();
  // Privacidade: liga o "borrador" ANTES de desenhar qualquer tela, pra nenhum valor aparecer nem por um instante.
  try { if (localStorage.getItem(PRIV_CHAVE) === '1') aplicarPrivacidade(true, false); } catch (e) {}
  // Bloqueio: se o PIN sumiu/ficou inválido, não deixa o app preso na tela de PIN.
  if (!temPin()) document.documentElement.classList.remove('bloqueado');
  const logoMarca = document.querySelector('.brand-icon img');
  if (logoMarca) document.getElementById('bloqueio-logo').src = logoMarca.src;
  inicializarControlesJanela();
  iniciarDropzoneUniversal();
  inicializarMenuContextoLancamentos();
  inicializarAutoUpdateOTA();
  if (document.documentElement.classList.contains('bloqueado')) setTimeout(() => document.getElementById('bloqueio-pin').focus(), 100);
  else iniciarRelogioOcioso();
  atualizarSegurancaUI();
  alternarEstadoCarregamento(true);
  const veioDoLoginMs = await msTratarRetornoDoLogin(); // voltando da tela de login da Microsoft (site/celular)
  await carregarDados();
  inicializarSyncFamiliarP2P();
  await gerarLancamentosRecorrentes();
  await processarReceitasAutomatizadas();
  renderDashboard();
  verificarPatchNotes();
  atualizarStatusSync();
  atualizarUIBackup();
  setTimeout(() => { executarBackupSilencioso(false).catch(() => {}); }, 1500);
  if (document.readyState === 'complete') {
    setTimeout(verificarViradaDeMesAutomatica, 250);
  } else {
    window.addEventListener('load', () => {
      setTimeout(verificarViradaDeMesAutomatica, 250);
    }, { once: true });
  }
  // Não usa "await" aqui de propósito: a tela já aparece com os dados locais na hora,
  // e a planilha é carregada por cima, em segundo plano, sem travar a abertura do app.
  // Site/celular com login vencido: tenta renovar sozinho (sem tela) antes de qualquer outra coisa.
  const renovandoLogin = (msLer().expirada && !ehElectron()) ? await msReconectarSilencioso() : false;
  if (!renovandoLogin) sincronizarAutomaticamenteAoAbrir();
  atualizarStatusMs();
  if (veioDoLoginMs === true) { nav('sync'); if (!(msLer().arquivo)) msAbrirEscolha(); }
  iniciarSyncAoVivo();
  // Service worker só faz sentido quando o app está hospedado (http/https) — em Electron (file://) isso é ignorado.
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) {
    window.addEventListener('load', () => { navigator.serviceWorker.register('service-worker.js').catch(() => {}); });
  }
})();
/* ================= SALVAMENTO DIRETO NA NUVEM (WEBHOOK) ================= */
// "Impressão digital" do lançamento pra saber se ele mudou depois que o envio começou (ignora o que não vai pra planilha).
function impressaoDigital(l) {
  const { sincronizado, origem, comprovante, ...resto } = l;
  return JSON.stringify(resto);
}
// Linhas da planilha a partir dos lançamentos — usado pelo envio via Make e pelo envio direto ao OneDrive.
function lancamentosParaLinhas() {
  return STATE.lancamentos.map(l => {
    const dataFormatada = l.data ? l.data.split('-').reverse().join('/') : '';
    const ehPagFatura = ehLancamentoPagamentoFatura(l);
    const ehFaturaQuitada = !ehPagFatura && l.faturaPaga === true;
    const statusPlanilha = ehFaturaQuitada
      ? 'Liquidado'
      : (ehPagFatura ? 'Pago/Efetivado' : (ehLancamentoCartao(l) && l.tipo === 'despesa' ? (l.status || 'Pendente') : (estaPago(l) ? 'Pago' : 'Pendente')));
    return {
      "Data": dataFormatada,
      "Descrição": l.descricao || '',
      "Categoria": l.categoria || '',
      "Tipo": l.tipo === 'receita' ? 'Receita' : 'Despesa',
      "Valor": l.valor || 0,
      "Conta": l.conta || '',
      "Status": statusPlanilha,
      "ID": l.id || '',
      "ParcelaGrupo": l.parcelaGrupo || '',
      "ParcelaAtual": l.parcelaAtual || '',
      "ParcelaTotal": l.parcelaTotal || '',
      "RecorrenteID": l.recorrenteId || '',
      "Tags": (l.tags || []).join(', '),
      "TransferenciaGrupo": l.transferenciaGrupo || '',
      "TransferenciaContraparte": l.transferenciaContraparte || '',
      "GarantiaFim": l.garantiaFim || '',
      "GarantiaMeses": l.garantiaMeses || '',
      "AnexoNome": l.anexoNome || '',
      "AnexoPath": l.anexoPath || '',
      "EhReembolsavel": l.ehReembolsavel ? 'Sim' : '',
      "ReembolsoDevedor": l.reembolsoDevedor || '',
      "Reembolsado": l.reembolsado ? 'Sim' : '',
      "Conciliado": l.conciliado ? 'Sim' : '',
      "FaturaPaga": ehFaturaQuitada ? 'Sim' : '',
      "EhPagamentoFatura": ehPagFatura ? 'Sim' : '',
      "FaturaCompetencia": l.faturaCompetencia || (l.faturaMes && l.faturaAno ? `${String(l.faturaMes).padStart(2, '0')}/${l.faturaAno}` : '')
    };
  });
}
// Foto do que está sendo enviado agora: só isso pode ser marcado como "sincronizado" no fim do envio.
function tirarInstantaneo() { return new Map(STATE.lancamentos.map(l => [l.id, impressaoDigital(l)])); }
// Marca como sincronizado só o que foi enviado E não mudou desde então, e esquece as exclusões que já chegaram na planilha.
async function concluirEnvio(instantaneo, idsApagadosNoEnvio) {
  STATE.lancamentos = STATE.lancamentos.map(l =>
    instantaneo.get(l.id) === impressaoDigital(l) ? { ...l, sincronizado: true, origem: 'onedrive' } : l);
  const jaEnviados = new Set(idsApagadosNoEnvio);
  STATE.excluidosPendentes = STATE.excluidosPendentes.filter(id => !jaEnviados.has(id));
  await salvarDados();
}
async function salvarNaNuvemWebhook(silencioso) {
  const idsApagadosNoEnvio = [...(STATE.excluidosPendentes || [])];
  // Lista vazia só é enviada quando veio de exclusões (senão, um aparelho recém-instalado, ainda vazio, apagaria a planilha).
  if ((!STATE.lancamentos || STATE.lancamentos.length === 0) && idsApagadosNoEnvio.length === 0) {
    if (!silencioso) toast('Nenhum lançamento para salvar.', 'err');
    return;
  }

  const btn = document.getElementById('btn-export-nuvem');
  const textoOriginal = btn ? btn.innerHTML : '';
  if (btn) { btn.innerHTML = '<span class="spinner"></span> Enviando...'; btn.disabled = true; }
  if (silencioso) atualizarIndicadorNuvem('enviando');

  const instantaneo = tirarInstantaneo();

  try {
    // 1. Prepara os dados para o Excel
    const dadosPlanilha = lancamentosParaLinhas();

    // 2. Cria a planilha virtual (cabeçalho fixo: mesmo vazia, a planilha mantém a linha de títulos)
    const worksheet = XLSX.utils.json_to_sheet(dadosPlanilha, { header: CABECALHO_PLANILHA });
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Controle Financeiro");

    // 3. Converte o Excel para Base64
    const base64Excel = XLSX.write(workbook, { bookType: 'xlsx', type: 'base64' });

    // 4. Dispara os dados para o Make.com
    const webhookUrl = (STATE.config && STATE.config.webhookMake && STATE.config.webhookMake.trim())
      ? STATE.config.webhookMake.trim()
      : 'https://hook.us2.make.com/bxu3xy2obmq4odwkqsbnrlwysvccoz9b';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const resposta = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        arquivoBase64: base64Excel
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!resposta.ok) throw new Error('Falha na resposta do Webhook');
    await concluirEnvio(instantaneo, idsApagadosNoEnvio);

    if (silencioso) atualizarIndicadorNuvem('ok');
    else toast('Planilha salva e atualizada no OneDrive com sucesso!', 'ok');
  } catch (erro) {
    console.error("Erro ao enviar para la nuvem:", erro);
    if (silencioso) atualizarIndicadorNuvem('erro');
    else toast('Erro ao enviar. Verifique o link do Webhook.', 'err');
  } finally {
    if (btn) { btn.innerHTML = textoOriginal; btn.disabled = false; }
  }
}
/* ================= AUTOMAÇÃO: PUXA AO ABRIR, ENVIA A CADA MUDANÇA ================= */
function atualizarIndicadorNuvem(estado) {
  const el = document.getElementById('sidebar-status');
  if (!el) return;
  clearTimeout(atualizarIndicadorNuvem._t);
  if (estado === 'enviando') { el.innerHTML = '<i class="ti ti-cloud-upload"></i> <span>Enviando pra nuvem...</span>'; return; }
  if (estado === 'baixando') { el.innerHTML = '<i class="ti ti-cloud-download"></i> <span>Carregando planilha...</span>'; return; }
  if (estado === 'ok') el.innerHTML = '<i class="ti ti-cloud-check"></i> <span>Sincronizado com a nuvem</span>';
  else if (estado === 'erro') el.innerHTML = '<i class="ti ti-cloud-off"></i> <span>Falha ao sincronizar — tentando depois</span>';
  atualizarIndicadorNuvem._t = setTimeout(() => {
    el.innerHTML = '<i class="ti ti-device-floppy"></i> <span>Salvo automaticamente no PC</span>';
  }, 4000);
}
// Chamado depois de qualquer mudança em lançamentos — junta várias mudanças seguidas (ex: marcar
// 5 itens de uma fatura como pagos) num envio só, 1.2s depois da última, pra não disparar um
// pedido de rede por clique.
let debounceNuvem = null;
function sincronizarEmSegundoPlano() {
  clearTimeout(debounceNuvem);
  debounceNuvem = setTimeout(() => {
    if (graphAtivo()) sincronizarGraph(true).catch(() => {});
    else salvarNaNuvemWebhook(true).catch(() => {});
  }, 1200);
}
// Roda ao abrir o app (sem travar a tela — a interface já aparece com os dados locais, e some
// atualizando sozinha se a planilha trouxer algo novo). Só mescla se a planilha reconhecidamente
// tiver as colunas que o próprio app usa — senão não arrisca misturar dado de planilha errada.
async function sincronizarAutomaticamenteAoAbrir() {
  if (graphAtivo()) { await sincronizarGraph(true); return; } // login Microsoft ativo: sincroniza direto pela API
  const link = (STATE.config && STATE.config.oneDriveLink) ||
    (document.getElementById('sync-link') && document.getElementById('sync-link').value.trim());
  if (!link) return;
  atualizarIndicadorNuvem('baixando');
  try {
    const buf = await tentarBuscarOneDrive(link);
    const wb = XLSX.read(buf, { type: 'array' });
    const linhas = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
    if (!linhas.length) { atualizarIndicadorNuvem('ok'); return; }
    const cabecalhos = Object.keys(linhas[0]);
    const achar = (nome) => cabecalhos.find(h => h.toLowerCase() === nome.toLowerCase()) || '';
    const mapa = {
      data: achar('Data'), descricao: achar('Descrição') || achar('Descricao'),
      categoria: achar('Categoria'), tipo: achar('Tipo'), valor: achar('Valor'),
      conta: achar('Conta'), status: achar('Status')
    };
    if (!mapa.data || !mapa.descricao || !mapa.valor) {
      console.warn('Sincronização automática: planilha sem as colunas esperadas, pulando.');
      atualizarIndicadorNuvem('ok');
      return;
    }
    const pendentesAntes = STATE.lancamentos.filter(l => l.sincronizado !== true).length;
    const { novos } = mesclarLinhasNaBase(linhas, mapa, true);
    STATE.config.lastSync = new Date().toISOString();
    await salvarDados();
    renderPaginaAtiva();
    if (novos > 0) toast(`Planilha carregada: ${novos} lançamento(s) novo(s) da nuvem.`, 'ok');
    if (pendentesAntes > 0 || STATE.excluidosPendentes.length > 0) { await salvarNaNuvemWebhook(true); } else { atualizarIndicadorNuvem('ok'); }
  } catch (e) {
    console.warn('Sincronização automática ao abrir falhou (silenciosa):', e.message);
    atualizarIndicadorNuvem('erro');
  }
}

/* ================= SINCRONIZAÇÃO INTELIGENTE ================= */
let filaDeMesclagem = false;

async function sincronizacaoInteligente() {
  if (graphAtivo()) { toast('Sincronizando com o OneDrive...', 'ok'); await sincronizarGraph(false); return; }
  const pendentesLocais = STATE.lancamentos.filter(l => l.sincronizado !== true).length;
  filaDeMesclagem = true;
  // Não apaga nada aqui: STATE.lancamentos só é tocado depois que a planilha
  // já foi baixada com sucesso e você confirma a importação (confirmarImportacao).
  // Se a busca falhar ou você cancelar o modal, nada se perde.
  toast(pendentesLocais > 0
    ? `Buscando a planilha na nuvem — ${pendentesLocais} lançamento(s) local(is) ainda não sincronizado(s) serão preservados.`
    : 'Buscando a planilha na nuvem...', 'ok');
  await sincronizarOneDrive();
}

/* ================= CONTROLES DE JANELA (FRAMELESS) ================= */
function windowControl(action) {
  try {
    if (window.electronAPI && typeof window.electronAPI.windowControl === 'function') {
      window.electronAPI.windowControl(action);
    }
  } catch (e) {
    console.error('Erro no controle da janela:', e);
  }
}

function inicializarControlesJanela() {
  const ctrl = document.getElementById('window-controls');
  if (!ehElectron()) {
    if (ctrl) ctrl.style.display = 'none';
    return;
  }
  if (ctrl) ctrl.style.display = 'inline-flex';

  const atualizarBotaoMax = (isMax) => {
    const btnMax = document.getElementById('win-btn-max');
    if (!btnMax) return;
    const iconMax = btnMax.querySelector('.icon-maximize');
    const iconRest = btnMax.querySelector('.icon-restore');
    if (iconMax && iconRest) {
      iconMax.style.display = isMax ? 'none' : 'block';
      iconRest.style.display = isMax ? 'block' : 'none';
      btnMax.title = isMax ? 'Restaurar' : 'Maximizar';
      btnMax.setAttribute('aria-label', btnMax.title);
    }
  };

  try {
    if (window.electronAPI && typeof window.electronAPI.onMaximizedStatus === 'function') {
      window.electronAPI.onMaximizedStatus(atualizarBotaoMax);
      if (typeof window.electronAPI.isMaximized === 'function') {
        window.electronAPI.isMaximized().then(atualizarBotaoMax).catch(() => {});
      }
    }
  } catch (e) {}

  const topbar = document.querySelector('.topbar');
  if (topbar) {
    topbar.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, a, input, select, .topbar-window-controls')) return;
      windowControl('maximize');
    });
  }
}

/* ================= DROPZONE UNIVERSAL & OCR LOCAL (TESSERACT.JS) ================= */
let dragDropCounter = 0;

function extrairValoresRecibo(texto) {
  if (!texto) return [];
  const valores = [];

  // 1) R$ ou palavras-chave de total seguidas por moeda brasileira: TOTAL R$ 1.250,50, VALOR: 89,90, LIQUIDO: 50,00
  const regexMoeda = /(?:R\$\s*|TOTAL\s*:?\s*|VALOR\s*(?:TOTAL|PAGAR|L[IÍ]QUIDO)?\s*:?\s*|L[IÍ]QUIDO\s*:?\s*|SUBTOTAL\s*:?\s*)(\d{1,3}(?:\.\d{3})*,\d{2})/gi;
  let match;
  while ((match = regexMoeda.exec(texto)) !== null) {
    const limpo = match[1].replace(/\./g, '').replace(',', '.');
    const num = parseFloat(limpo);
    if (!isNaN(num) && num > 0 && num < 10000000) valores.push(num);
  }

  // 2) Padrão explícito R$ seguido de número (com ou sem separador de milhar)
  const regexRS = /R\$\s*(\d{1,3}(?:\.\d{3})*,\d{2}|\d+,\d{2})/gi;
  while ((match = regexRS.exec(texto)) !== null) {
    const limpo = match[1].replace(/\./g, '').replace(',', '.');
    const num = parseFloat(limpo);
    if (!isNaN(num) && num > 0 && num < 10000000) valores.push(num);
  }

  // 3) Números isolados no formato monetário padrão brasileiro (1.250,50 ou 150,00)
  const regexNumeros = /\b(\d{1,3}(?:\.\d{3})*,\d{2})\b/g;
  while ((match = regexNumeros.exec(texto)) !== null) {
    const limpo = match[1].replace(/\./g, '').replace(',', '.');
    const num = parseFloat(limpo);
    if (!isNaN(num) && num > 0 && num < 10000000) valores.push(num);
  }

  return [...new Set(valores)];
}

function lerArquivoComoDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function mostrarIndicadorOCR(titulo, progresso) {
  const hud = document.getElementById('ocr-loading-hud');
  if (!hud) return;
  const progEl = document.getElementById('ocr-loading-progress');
  if (progEl) progEl.textContent = progresso || 'Processando imagem...';
  hud.style.display = 'flex';
}

function atualizarProgressoOCR(progresso) {
  const progEl = document.getElementById('ocr-loading-progress');
  if (progEl) progEl.textContent = progresso;
}

function ocultarIndicadorOCR() {
  const hud = document.getElementById('ocr-loading-hud');
  if (hud) hud.style.display = 'none';
}

async function processarArquivoDropzone(file) {
  if (!file) return;

  const nomeArquivo = file.name || 'documento';
  if (/\.(ofx|qfx)$/i.test(nomeArquivo)) {
    lerArquivoOFX(file);
    return;
  }
  const ehImagem = (file.type && file.type.startsWith('image/')) || /\.(png|jpe?g|webp|bmp|gif)$/i.test(nomeArquivo);
  const ehPdf = file.type === 'application/pdf' || /\.pdf$/i.test(nomeArquivo);

  if (!ehImagem && !ehPdf) {
    toast(`Formato de arquivo não suportado: ${nomeArquivo}. Arraste uma imagem (PNG, JPG, WEBP) para OCR ou um extrato .OFX.`, 'err');
    return;
  }

  mostrarIndicadorOCR('A ler fatura... (OCR)', 'Inicializando motor OCR...');
  document.body.style.cursor = 'wait';

  let dataUrl = null;
  try {
    dataUrl = await lerArquivoComoDataURL(file);
  } catch (errLeitura) {
    console.warn('Erro ao ler arquivo como dataURL:', errLeitura);
  }

  if (typeof Tesseract === 'undefined') {
    ocultarIndicadorOCR();
    document.body.style.cursor = 'default';
    toast('O motor OCR Tesseract.js não foi encontrado. Verifique sua conexão à internet.', 'err');
    abrirModalLancamento();
    if (dataUrl && ehImagem) {
      comprovanteAtual = dataUrl;
      anexoMetaAtual = { nome: nomeArquivo, path: file.path || '' };
      renderComprovanteArea();
    }
    return;
  }

  try {
    atualizarProgressoOCR('Carregando modelo em português...');
    const workerOptions = {
      logger: m => {
        if (m.status === 'recognizing text') {
          const pct = Math.round((m.progress || 0) * 100);
          atualizarProgressoOCR(`Lendo texto da fatura... ${pct}%`);
        } else if (m.status === 'loading tesseract core') {
          atualizarProgressoOCR('Inicializando núcleo OCR...');
        } else if (m.status === 'loading language traineddata') {
          atualizarProgressoOCR('Carregando dados de português...');
        }
      }
    };

    const alvo = dataUrl || file;
    const resultado = await Tesseract.recognize(alvo, 'por', workerOptions);
    const texto = (resultado && resultado.data && resultado.data.text) ? resultado.data.text : '';

    ocultarIndicadorOCR();
    document.body.style.cursor = 'default';

    const valoresEncontrados = extrairValoresRecibo(texto);
    const valorMaior = valoresEncontrados.length > 0 ? Math.max(...valoresEncontrados) : 0;

    const linhas = texto.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    let descFinal = '';
    for (const linha of linhas) {
      const semPontuacao = linha.replace(/[^a-zA-ZÀ-ÿ0-9\s]/g, '').trim();
      if (semPontuacao.length >= 3 && !/^(cnpj|cpf|ie|im|data|hora|coo|ccf|cupom|via|item|cod|c[oó]digo|extrato|documento|nota|fiscal|subtotal|total|troco|dinheiro|cart[aã]o|pix|valor)/i.test(semPontuacao)) {
        descFinal = linha.slice(0, 50);
        break;
      }
    }
    if (!descFinal) {
      descFinal = nomeArquivo.replace(/\.[^/.]+$/, '').replace(/[-_]/g, ' ').trim();
      if (descFinal) {
        descFinal = descFinal.charAt(0).toUpperCase() + descFinal.slice(1);
      } else {
        descFinal = 'Fatura / Recibo';
      }
    }

    let dataDetectada = '';
    const matchData = texto.match(/\b([0-3]?\d)[/-]([0-1]?\d)[/-](20\d{2}|\d{2})\b/);
    if (matchData) {
      const dia = matchData[1].padStart(2, '0');
      const mes = matchData[2].padStart(2, '0');
      let ano = matchData[3];
      if (ano.length === 2) ano = '20' + ano;
      const nDia = parseInt(dia, 10);
      const nMes = parseInt(mes, 10);
      if (nDia >= 1 && nDia <= 31 && nMes >= 1 && nMes <= 12) {
        dataDetectada = `${ano}-${mes}-${dia}`;
      }
    }

    abrirModalLancamento();

    if (valorMaior > 0) {
      const campoVal = document.getElementById('lanc-valor');
      if (campoVal) campoVal.value = toBRL(valorMaior);
    }
    if (descFinal) {
      const campoDesc = document.getElementById('lanc-descricao');
      if (campoDesc) {
        campoDesc.value = descFinal;
        sugerirCategoriaPorRegra();
      }
    }
    if (dataDetectada) {
      const campoData = document.getElementById('lanc-data');
      if (campoData) campoData.value = dataDetectada;
    }

    if (dataUrl && ehImagem) {
      comprovanteAtual = dataUrl;
      anexoMetaAtual = { nome: nomeArquivo, path: file.path || '' };
      renderComprovanteArea();
    }

    if (valorMaior > 0) {
      toast(`Fatura lida via OCR! Total detectado: ${toBRL(valorMaior)}. Confira antes de salvar.`, 'ok');
    } else {
      toast('Fatura processada via OCR. Verifique os dados antes de salvar.', 'ok');
    }

  } catch (errOCR) {
    console.error('Erro no processamento OCR:', errOCR);
    ocultarIndicadorOCR();
    document.body.style.cursor = 'default';
    toast('Não foi possível ler o texto da imagem automaticamente. O modal foi aberto para preenchimento manual.', 'err');

    abrirModalLancamento();
    if (ehImagem && dataUrl) {
      comprovanteAtual = dataUrl;
      anexoMetaAtual = { nome: nomeArquivo, path: file.path || '' };
      renderComprovanteArea();
    }
  }
}

function ocultarOverlaysArrastoGlobais() {
  dragDropCounter = 0;
  const overlayOCR = document.getElementById('dropzone-overlay');
  if (overlayOCR) overlayOCR.style.display = 'none';
  const overlayOFX = document.getElementById('ofx-drag-overlay');
  if (overlayOFX) overlayOFX.classList.add('oculto');
}

function ehArrastoDeFicheiroGlobal(e) {
  const dt = e && e.dataTransfer;
  if (!dt) return false;
  const tipos = dt.types ? Array.from(dt.types) : [];
  const itens = dt.items ? Array.from(dt.items) : [];
  return tipos.includes('Files') || itens.some(it => it && it.kind === 'file') || (dt.files && dt.files.length > 0);
}

function ehArrastoArquivoOFXGlobal(e) {
  const dt = e && e.dataTransfer;
  if (!dt) return false;
  const itens = dt.items ? Array.from(dt.items) : [];
  if (itens.length > 0) {
    const temArquivo = itens.some(it => it && it.kind === 'file');
    if (!temArquivo) return false;
    const ehMidiaOCR = itens.some(it => it && it.kind === 'file' && (
      String(it.type || '').startsWith('image/') || it.type === 'application/pdf'
    ));
    return !ehMidiaOCR;
  }
  return ehArrastoDeFicheiroGlobal(e);
}

function iniciarDropzoneUniversal() {
  const overlayOCR = document.getElementById('dropzone-overlay');
  const overlayOFX = document.getElementById('ofx-drag-overlay');

  const estaEmDropzoneLocal = (e) => Boolean(
    e && e.target && typeof e.target.closest === 'function' && e.target.closest('#ofx-dropzone, #drop-zone-anexo')
  );

  window.addEventListener('dragenter', (e) => {
    e.preventDefault();
    if (estaEmDropzoneLocal(e)) {
      ocultarOverlaysArrastoGlobais();
      return;
    }
    if (!ehArrastoDeFicheiroGlobal(e)) return;

    dragDropCounter += 1;
    if (ehArrastoArquivoOFXGlobal(e)) {
      if (overlayOCR) overlayOCR.style.display = 'none';
      if (overlayOFX) overlayOFX.classList.remove('oculto');
    } else {
      if (overlayOFX) overlayOFX.classList.add('oculto');
      if (overlayOCR) overlayOCR.style.display = 'flex';
    }
  });

  window.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (estaEmDropzoneLocal(e)) {
      ocultarOverlaysArrastoGlobais();
      return;
    }
    if (e.dataTransfer) {
      e.dataTransfer.dropEffect = 'copy';
    }
  });

  window.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDropCounter = Math.max(0, dragDropCounter - 1);
    const foraDaJanela = !e.relatedTarget || (
      typeof document !== 'undefined' &&
      e.relatedTarget.nodeType &&
      typeof document.contains === 'function' &&
      !document.contains(e.relatedTarget)
    );
    if (dragDropCounter === 0 && foraDaJanela) {
      ocultarOverlaysArrastoGlobais();
    } else if (!e.relatedTarget) {
      ocultarOverlaysArrastoGlobais();
    }
  });

  window.addEventListener('drop', async (e) => {
    e.preventDefault();
    ocultarOverlaysArrastoGlobais();

    const files = e.dataTransfer ? e.dataTransfer.files : null;
    const file = files && files[0];
    if (!file) return;

    const nomeArquivo = String(file.name || '');
    const ehMidiaOCR = (file.type && (file.type.startsWith('image/') || file.type === 'application/pdf'))
      || /\.(png|jpe?g|webp|bmp|gif|pdf)$/i.test(nomeArquivo);

    if (ehMidiaOCR) {
      await processarArquivoDropzone(file);
    } else {
      lerArquivoOFX(file);
    }
  });

  window.addEventListener('blur', ocultarOverlaysArrastoGlobais);
  window.addEventListener('dragend', ocultarOverlaysArrastoGlobais);
}


/* ============================================================================
 * MOTOR DE AUTO-CATEGORIZAÇÃO COM APRENDIZADO (4 CAMADAS + REGRAS + TRIAGEM)
 * ============================================================================ */

const CATEGORIA_A_CLASSIFICAR = 'A Classificar';

const DICIONARIO_PALAVRAS_CHAVE_BR = [
  { re: /\b(uber|99app|99pop|99\s*taxi|cabify)\b/i, categoria: 'Transporte', subcategoria: 'Uber / 99 / Táxi', tipo: 'despesa' },
  { re: /\b(ifood|rappi|zedelivery|ze\s*delivery|aiqfome)\b/i, categoria: 'Alimentação', subcategoria: 'Delivery / Lanche', tipo: 'despesa' },
  { re: /\b(drogaria|farmacia|raia|drogasil|pacheco|ultrafarma|pague\s*menos|panvel)\b/i, categoria: 'Saúde', subcategoria: 'Farmácia', tipo: 'despesa' },
  { re: /\b(posto|shell|ipiranga|petrobras|br\s*mania|combustivel|gasolina|etanol|ale\s*combust)\b/i, categoria: 'Transporte', subcategoria: 'Combustível', tipo: 'despesa' },
  { re: /\b(mercado|supermercado|atacadao|assai|carrefour|pao\s*de\s*acucar|sonda|hortifruti|sacolao|extra\s*mercado|hipermercado|dia\s*supermercado)\b/i, categoria: 'Alimentação', subcategoria: 'Supermercado', tipo: 'despesa' },
  { re: /\b(netflix|spotify|amazon\s*prime|prime\s*video|youtube|icloud|disney|hbo\s*max|max\s*stream|apple\s*com\s*bill|chatgpt|openai|globoplay|deezer)\b/i, categoria: 'Assinaturas', subcategoria: 'Streaming (Vídeo/Música)', tipo: 'despesa' },
  { re: /\b(liquido\s*de\s*vencimento|salario|pagto\s*salario|folha\s*de\s*pagamento|decimo\s*terceiro|pro\s*labore|ferias)\b/i, categoria: 'Salário', subcategoria: 'Salário Mensal', tipo: 'receita' },
  { re: /\b(remuneracao\s*aplicacao|rendimento|dividendo|dividendos|jcp|juros\s*sobre\s*capital|resgate\s*cdb|tesouro\s*direto)\b/i, categoria: 'Investimentos', subcategoria: 'Rendimentos Renda Fixa', tipo: 'receita' }
];

const MAPA_CATEGORIAS_PLUGGY_SEMANTICO = [
  { re: /grocer|supermarket|supermercado|mercado/i, categoria: 'Alimentação', subcategoria: 'Supermercado' },
  { re: /eating\s*out|restaurant|food|delivery|coffee|bakery|fast\s*food|alimenta|restaurante|padaria|lanche/i, categoria: 'Alimentação', subcategoria: 'Restaurante' },
  { re: /transport|taxi|ride|uber|fuel|gas|parking|auto|toll|combust|pedagio/i, categoria: 'Transporte', subcategoria: '' },
  { re: /subscript|streaming|software|digital|cloud|saas|assinatura/i, categoria: 'Assinaturas', subcategoria: '' },
  { re: /health|pharmac|medical|doctor|dentist|hospital|gym|fitness|saude|farmacia|academia/i, categoria: 'Saúde', subcategoria: '' },
  { re: /shopping|retail|clothing|electronics|store|compras|loja/i, categoria: 'Lazer', subcategoria: '' },
  { re: /utilit|hous|rent|electric|water|internet|phone|telecom|moradia|aluguel|condominio|energia/i, categoria: 'Moradia', subcategoria: '' },
  { re: /salary|payroll|wage|income|salario|remuneracao/i, categoria: 'Salário', subcategoria: '' },
  { re: /invest|dividend|interest|yield|rendimento|fii|broker/i, categoria: 'Investimentos', subcategoria: '' },
  { re: /educat|school|college|university|book|course|educacao|curso|livro|faculdade/i, categoria: 'Educação', subcategoria: '' },
  { re: /entertain|leisure|movie|music|game|travel|hotel|lazer|viagem|passeio|cinema/i, categoria: 'Lazer', subcategoria: '' },
  { re: /freelanc|service|consulting|consultoria/i, categoria: 'Freelance', subcategoria: '' }
];

function ehLancamentoProtegidoAutoCat(l) {
  if (!l || typeof l !== 'object') return true;
  if (l.ehMovimentoCofre === true) return true;
  if (typeof ehLancamentoPagamentoFatura === 'function' && ehLancamentoPagamentoFatura(l)) return true;
  if (l.ehPagamentoFatura === true || l.ehPagamentoFaturaDetectado === true) return true;
  if (typeof isLancamentoTransferencia === 'function' && isLancamentoTransferencia(l)) return true;
  if (l.tipoRevisao === 'transferencia') return true;
  return false;
}

function ehCategoriaGenericaOuPendente(cat) {
  const norm = normalizarTextoSemAcento(cat);
  return !norm || norm === 'outros' || norm === 'a classificar' || norm === 'importado' || norm === 'sem categoria';
}

function ehCategoriaValidaParaAprendizado(cat) {
  const norm = normalizarTextoSemAcento(cat);
  if (!norm) return false;
  if (norm === 'a classificar' || norm === 'outros' || norm === 'importado' || norm === 'sem categoria') return false;
  if (norm === 'transferencia' || norm.startsWith('transferencia ->') || norm.includes('pagamento de fatura')) return false;
  return true;
}

function obterDescricaoBaseAutoCat(l) {
  if (!l || typeof l !== 'object') return '';
  return String(l.descricaoOriginal || l.descricao || l.memo || '').trim();
}

function montarCategoriaCompletaAutoCat(categoria, subcategoria) {
  const cat = String(categoria || '').trim();
  const sub = String(subcategoria || '').trim();
  if (!cat) return CATEGORIA_A_CLASSIFICAR;
  if (cat.includes(' -> ')) return cat;
  return sub ? `${cat} -> ${sub}` : cat;
}

function resolverCategoriaExistenteNoState(nomeMacro, subcategoriaDesejada, tipo) {
  normalizarHierarquiaCategorias();
  const cats = Array.isArray(STATE.categorias) ? STATE.categorias : [];
  const alvoNorm = normalizarTextoSemAcento(nomeMacro);
  if (!alvoNorm) return { categoria: CATEGORIA_A_CLASSIFICAR, subcategoria: '', categoriaCompleta: CATEGORIA_A_CLASSIFICAR };

  let encontrada = cats.find(c => c && c.nome && (!tipo || c.tipo === tipo) && normalizarTextoSemAcento(c.nome) === alvoNorm)
    || cats.find(c => c && c.nome && (!tipo || c.tipo === tipo) && (normalizarTextoSemAcento(c.nome).includes(alvoNorm) || alvoNorm.includes(normalizarTextoSemAcento(c.nome))))
    || cats.find(c => c && c.nome && normalizarTextoSemAcento(c.nome) === alvoNorm);

  const macroFinal = encontrada ? encontrada.nome : nomeMacro;
  let subFinal = '';
  if (subcategoriaDesejada && encontrada && Array.isArray(encontrada.subcategorias)) {
    const subAlvo = normalizarTextoSemAcento(subcategoriaDesejada);
    const subMatch = encontrada.subcategorias.find(s => normalizarTextoSemAcento(s) === subAlvo)
      || encontrada.subcategorias.find(s => normalizarTextoSemAcento(s).includes(subAlvo) || subAlvo.includes(normalizarTextoSemAcento(s)));
    if (subMatch) subFinal = subMatch;
  }
  return {
    categoria: macroFinal,
    subcategoria: subFinal,
    categoriaCompleta: montarCategoriaCompletaAutoCat(macroFinal, subFinal)
  };
}

function normalizarDescricaoBancaria(texto) {
  let s = normalizarTextoSemAcento(texto);
  if (!s) return '';

  // Remove CNPJ / CPF formatados
  s = s.replace(/\b\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2}\b/g, ' ');
  s = s.replace(/\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/g, ' ');

  // Remove prefixos de adquirentes e intermediadores bancários (pag*, ifd*, mp*, ec*, dl*, int*, etc.)
  s = s.replace(/(^|[\s|])(?:pag|ifd|mp|ec|dl|int|pg|mercpago|sumup|stone|cielo|rede|getnet)\s*\*\s*/gi, ' ');

  // Remove prefixos/ruídos bancários comuns no Brasil
  const prefixosRuido = [
    /\btransferencia\s+enviada\s*\|?/gi,
    /\btransferencia\s+recebida\s*\|?/gi,
    /\btransf\.?\s+(?:enviada|recebida)\s*\|?/gi,
    /\bpix\s+recebido(?:\s+de)?\b/gi,
    /\bpix\s+enviado(?:\s+para)?\b/gi,
    /\bpagamento\s+pix\b/gi,
    /\bpagto\.?\s+pix\b/gi,
    /\bcompra\s+(?:no\s+)?cartao(?:\s+de\s+(?:debito|credito))?\b/gi,
    /\bcompra\s+(?:no\s+)?debito\b/gi,
    /\bcompra\s+(?:no\s+)?credito\b/gi,
    /\bdebito\s+automatico\b/gi,
    /\bpagamento\s+de\s+boleto\b/gi
  ];
  prefixosRuido.forEach(re => { s = s.replace(re, ' '); });

  // Remove indicadores de parcela (parc 1/3, parcela 01/12, 01/12) e datas soltas (dd/mm, dd/mm/aaaa)
  s = s.replace(/\bparc(?:ela)?\.?\s*\d{1,2}\s*[/\\-]\s*\d{1,2}\b/gi, ' ');
  s = s.replace(/\b\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\b/g, ' ');
  s = s.replace(/\b\d{2}-\d{2}(?:-\d{2,4})?\b/g, ' ');

  // Remove sequências numéricas longas / códigos de autorização / CNPJ soltos sem pontuação
  s = s.replace(/\b\d{5,}\b/g, ' ');

  // Limpa separadores e pontuação residual mantendo letras, números e espaços
  s = s.replace(/[|*_\/:;.,()\[\]{}#@!?"'~^+=<>-]+/g, ' ');
  s = s.replace(/\s+/g, ' ').trim();

  // Remove ruídos soltos no início (ex: "pix ", "ted ", "doc ") se restar conteúdo útil depois
  const semSiglaInicial = s.replace(/^(?:pix|ted|doc|compra|pagto|pagamento|debito|credito)\s+/i, '').trim();
  if (semSiglaInicial.length >= 2) s = semSiglaInicial;

  return s;
}

function normalizarRegrasCategoria() {
  if (!Array.isArray(STATE.regrasCategoria)) STATE.regrasCategoria = [];
  if (!STATE.config || typeof STATE.config !== 'object') STATE.config = {};

  // Migração única e retrocompatível das regras legadas (STATE.regras -> STATE.regrasCategoria)
  if (STATE.regrasCategoria.length === 0 && !STATE.config.regrasCategoriaMigradas && Array.isArray(STATE.regras) && STATE.regras.length > 0) {
    STATE.regras.forEach((r, idx) => {
      if (!r || !r.palavraChave) return;
      const parsed = extrairMacroESubcategoria(r.categoria || r.categoriaDesejada || '');
      const macro = r.categoriaDesejada || parsed.macro || '';
      const sub = r.subcategoria || (parsed.temSub ? parsed.sub : '');
      if (!macro || ehCategoriaGenericaOuPendente(macro)) return;
      STATE.regrasCategoria.push({
        id: r.id || uid(),
        ativa: true,
        prioridade: 100 + idx,
        padrao: String(r.palavraChave).trim(),
        modoMatch: 'contem',
        tipo: 'todos',
        contaId: String(r.contaId || r.conta || '').trim(),
        valorMin: null,
        valorMax: null,
        categoria: macro,
        subcategoria: sub,
        tag: '',
        apelidoDescricao: '',
        criadaEm: new Date().toISOString(),
        usos: 0
      });
    });
    STATE.config.regrasCategoriaMigradas = true;
  }

  STATE.regrasCategoria = STATE.regrasCategoria
    .filter(r => r && typeof r === 'object' && String(r.padrao || '').trim() && String(r.categoria || '').trim())
    .map(r => {
      const parsed = extrairMacroESubcategoria(r.categoria);
      const macro = r.subcategoria ? (parsed.temSub ? parsed.macro : String(r.categoria).trim()) : parsed.macro;
      const sub = r.subcategoria ? String(r.subcategoria).trim() : (parsed.temSub ? parsed.sub : '');
      const modo = (r.modoMatch === 'exato' || r.modoMatch === 'comeca_com' || r.modoMatch === 'contem') ? r.modoMatch : 'contem';
      const tipo = (r.tipo === 'despesa' || r.tipo === 'receita' || r.tipo === 'todos') ? r.tipo : 'todos';
      const vMin = (r.valorMin !== null && r.valorMin !== undefined && r.valorMin !== '' && Number.isFinite(Number(r.valorMin))) ? Number(r.valorMin) : null;
      const vMax = (r.valorMax !== null && r.valorMax !== undefined && r.valorMax !== '' && Number.isFinite(Number(r.valorMax))) ? Number(r.valorMax) : null;
      const prio = Number.isFinite(Number(r.prioridade)) ? Number(r.prioridade) : 100;
      const tagLimpa = String(r.tag || '').trim().replace(/^#+/, '');
      return {
        id: String(r.id || uid()),
        ativa: r.ativa !== false,
        prioridade: prio,
        padrao: String(r.padrao).trim(),
        modoMatch: modo,
        tipo,
        contaId: String(r.contaId || '').trim(),
        valorMin: vMin,
        valorMax: vMax,
        categoria: macro,
        subcategoria: sub,
        tag: tagLimpa,
        apelidoDescricao: String(r.apelidoDescricao || '').trim(),
        criadaEm: String(r.criadaEm || new Date().toISOString()),
        usos: Math.max(0, parseInt(r.usos, 10) || 0)
      };
    });

  return STATE.regrasCategoria;
}

function especificidadeModoMatch(modo) {
  if (modo === 'exato') return 3;
  if (modo === 'comeca_com') return 2;
  return 1;
}

function ordenarRegrasCategoriaParaAvaliacao(regras) {
  return [...(regras || [])].sort((a, b) => {
    const pDiff = (Number(a.prioridade) || 100) - (Number(b.prioridade) || 100);
    if (pDiff !== 0) return pDiff;
    const espDiff = especificidadeModoMatch(b.modoMatch) - especificidadeModoMatch(a.modoMatch);
    if (espDiff !== 0) return espDiff;
    return String(b.padrao || '').length - String(a.padrao || '').length;
  });
}

function contaCorrespondeRegraAutoCat(regraContaId, lanc) {
  const alvo = String(regraContaId || '').trim();
  if (!alvo) return true;
  const alvoLow = alvo.toLowerCase();
  const candidatos = [
    lanc.contaId,
    lanc.accountId,
    lanc.conta,
    lanc.contaDestino,
    lanc.accountName
  ].filter(Boolean).map(x => String(x).replace(/^__CRIAR_CONTA__:/, '').trim().toLowerCase());
  if (candidatos.includes(alvoLow)) return true;

  const contaObj = (STATE.contas || []).find(c => c && (String(c.id || '').toLowerCase() === alvoLow || String(c.nome || '').toLowerCase() === alvoLow));
  if (contaObj) {
    const nomeObj = String(contaObj.nome || '').toLowerCase();
    const idObj = String(contaObj.id || '').toLowerCase();
    if (candidatos.includes(nomeObj) || (idObj && candidatos.includes(idObj))) return true;
  }
  return false;
}

function avaliarRegraNoLancamento(regra, lanc, descBrutaNormOpt, nucleoOpt) {
  if (!regra || !lanc || ehLancamentoProtegidoAutoCat(lanc)) return false;
  const tipoLanc = lanc.tipo === 'receita' ? 'receita' : 'despesa';
  if (regra.tipo && regra.tipo !== 'todos' && regra.tipo !== tipoLanc) return false;
  if (!contaCorrespondeRegraAutoCat(regra.contaId, lanc)) return false;

  const valor = Math.abs(Number(lanc.valor) || 0);
  if (regra.valorMin !== null && regra.valorMin !== undefined && valor < Number(regra.valorMin)) return false;
  if (regra.valorMax !== null && regra.valorMax !== undefined && valor > Number(regra.valorMax)) return false;

  const padraoNorm = normalizarTextoSemAcento(regra.padrao);
  if (!padraoNorm) return false;
  const padraoNucleo = normalizarDescricaoBancaria(regra.padrao);

  const descBruta = obterDescricaoBaseAutoCat(lanc);
  const descBrutaNorm = descBrutaNormOpt !== undefined ? descBrutaNormOpt : normalizarTextoSemAcento(descBruta);
  const nucleo = nucleoOpt !== undefined ? nucleoOpt : normalizarDescricaoBancaria(descBruta);

  const modo = regra.modoMatch || 'contem';
  if (modo === 'exato') {
    return descBrutaNorm === padraoNorm || nucleo === padraoNorm || (Boolean(padraoNucleo) && nucleo === padraoNucleo);
  }
  if (modo === 'comeca_com') {
    return descBrutaNorm.startsWith(padraoNorm) || nucleo.startsWith(padraoNorm) || (Boolean(padraoNucleo) && nucleo.startsWith(padraoNucleo));
  }
  return descBrutaNorm.includes(padraoNorm) || nucleo.includes(padraoNorm) || (Boolean(padraoNucleo) && nucleo.includes(padraoNucleo));
}

function construirIndiceMemoriaHistorica(lancamentos) {
  const lista = Array.isArray(lancamentos) ? lancamentos : (STATE.lancamentos || []);
  const contagemPorChave = new Map();

  for (let i = 0; i < lista.length; i += 1) {
    const l = lista[i];
    if (!l || ehLancamentoProtegidoAutoCat(l)) continue;
    if (ehCategoriaGenericaOuPendente(l.categoria)) continue;
    const nucleo = normalizarDescricaoBancaria(obterDescricaoBaseAutoCat(l));
    if (!nucleo || nucleo.length < 3) continue;
    const tipo = l.tipo === 'receita' ? 'receita' : 'despesa';
    const chave = `${tipo}|${nucleo}`;
    const parsed = extrairMacroESubcategoria(l.categoria);
    const catKey = montarCategoriaCompletaAutoCat(parsed.macro, parsed.temSub ? parsed.sub : '');
    const dataStr = String(l.data || '');

    let bucket = contagemPorChave.get(chave);
    if (!bucket) {
      bucket = new Map();
      contagemPorChave.set(chave, bucket);
    }
    const prev = bucket.get(catKey);
    if (prev) {
      prev.count += 1;
      if (dataStr > prev.lastDate) prev.lastDate = dataStr;
    } else {
      bucket.set(catKey, {
        categoria: parsed.macro,
        subcategoria: parsed.temSub ? parsed.sub : '',
        categoriaCompleta: catKey,
        count: 1,
        lastDate: dataStr
      });
    }
  }

  const indice = new Map();
  contagemPorChave.forEach((bucket, chave) => {
    let melhor = null;
    bucket.forEach((entry) => {
      if (!melhor || entry.count > melhor.count || (entry.count === melhor.count && entry.lastDate > melhor.lastDate)) {
        melhor = entry;
      }
    });
    if (melhor) indice.set(chave, melhor);
  });
  return indice;
}

function mapearCategoriaPluggyFlexivel(rawCategory, tipo) {
  const catRaw = String(rawCategory || '').trim();
  if (!catRaw) return null;
  const catNorm = normalizarTextoSemAcento(catRaw);
  if (!catNorm || catNorm.includes('transfer') || catNorm === 'other' || catNorm === 'outros') return null;

  // Correspondência direta com categorias reais do STATE
  const exata = (STATE.categorias || []).find(
    c => c && c.nome && (!tipo || c.tipo === tipo) && normalizarTextoSemAcento(c.nome) === catNorm
  );
  if (exata) {
    return { categoria: exata.nome, subcategoria: '', categoriaCompleta: exata.nome };
  }

  for (const item of MAPA_CATEGORIAS_PLUGGY_SEMANTICO) {
    if (item.re.test(catNorm)) {
      return resolverCategoriaExistenteNoState(item.categoria, item.subcategoria, tipo);
    }
  }
  return null;
}

function autoClassificarLancamento(lanc, opcoes = {}) {
  if (!lanc || typeof lanc !== 'object') return null;
  if (ehLancamentoProtegidoAutoCat(lanc)) return null;

  normalizarRegrasCategoria();
  const descBruta = obterDescricaoBaseAutoCat(lanc);
  const descBrutaNorm = normalizarTextoSemAcento(descBruta);
  const nucleo = normalizarDescricaoBancaria(descBruta);
  const tipo = lanc.tipo === 'receita' ? 'receita' : 'despesa';

  // CAMADA 1 — Regras do Usuário (STATE.regrasCategoria)
  const regrasAtivas = ordenarRegrasCategoriaParaAvaliacao(
    (opcoes.regras || STATE.regrasCategoria || []).filter(r => r && r.ativa === true)
  );
  for (let i = 0; i < regrasAtivas.length; i += 1) {
    const r = regrasAtivas[i];
    if (avaliarRegraNoLancamento(r, lanc, descBrutaNorm, nucleo)) {
      const catCompleta = montarCategoriaCompletaAutoCat(r.categoria, r.subcategoria);
      return {
        categoria: r.categoria,
        subcategoria: r.subcategoria || '',
        categoriaCompleta: catCompleta,
        tag: r.tag || '',
        apelidoDescricao: r.apelidoDescricao || '',
        origem: 'regra',
        regraId: r.id
      };
    }
  }

  // CAMADA 2 — Memória Histórica Automática (mesmo núcleo >= 3 chars e mesmo tipo)
  if (!opcoes.pularMemoria && nucleo.length >= 3) {
    const indice = opcoes.indiceMemoria || construirIndiceMemoriaHistorica();
    const matchMem = indice.get(`${tipo}|${nucleo}`);
    if (matchMem) {
      return {
        categoria: matchMem.categoria,
        subcategoria: matchMem.subcategoria || '',
        categoriaCompleta: matchMem.categoriaCompleta,
        tag: '',
        apelidoDescricao: '',
        origem: 'memoria',
        regraId: null
      };
    }
  }

  // CAMADA 3 — Dicionário Pluggy + Palavras-Chave BR
  const rawCategory = opcoes.rawCategory !== undefined ? opcoes.rawCategory : (lanc.rawCategory || '');
  if (rawCategory) {
    const matchPluggy = mapearCategoriaPluggyFlexivel(rawCategory, tipo);
    if (matchPluggy) {
      return {
        categoria: matchPluggy.categoria,
        subcategoria: matchPluggy.subcategoria || '',
        categoriaCompleta: matchPluggy.categoriaCompleta,
        tag: '',
        apelidoDescricao: '',
        origem: 'pluggy',
        regraId: null
      };
    }
  }

  for (let i = 0; i < DICIONARIO_PALAVRAS_CHAVE_BR.length; i += 1) {
    const item = DICIONARIO_PALAVRAS_CHAVE_BR[i];
    if (item.tipo && item.tipo !== tipo) continue;
    if (item.re.test(descBrutaNorm) || (nucleo && item.re.test(nucleo))) {
      const resolvido = resolverCategoriaExistenteNoState(item.categoria, item.subcategoria, tipo);
      return {
        categoria: resolvido.categoria,
        subcategoria: resolvido.subcategoria || '',
        categoriaCompleta: resolvido.categoriaCompleta,
        tag: '',
        apelidoDescricao: '',
        origem: 'dicionario',
        regraId: null
      };
    }
  }

  // Fallback complementar no dicionário estendido REGRAS_CATEGORIAS
  if (typeof REGRAS_CATEGORIAS === 'object' && REGRAS_CATEGORIAS) {
    const textoUpper = normalizarTextoBuscaOFX(descBruta);
    const entradas = Object.entries(REGRAS_CATEGORIAS).filter(([cat]) => (
      tipo === 'receita' ? CATEGORIAS_OFX_RECEITA.has(cat) : !CATEGORIAS_OFX_RECEITA.has(cat)
    ));
    for (const [cat, palavras] of entradas) {
      for (const kwRaw of (palavras || [])) {
        const kw = normalizarTextoBuscaOFX(kwRaw);
        if (kw && textoUpper.includes(kw)) {
          const resolvido = resolverCategoriaExistenteNoState(cat, '', tipo);
          return {
            categoria: resolvido.categoria,
            subcategoria: resolvido.subcategoria || '',
            categoriaCompleta: resolvido.categoriaCompleta,
            tag: '',
            apelidoDescricao: '',
            origem: 'dicionario',
            regraId: null
          };
        }
      }
    }
  }

  // CAMADA 4 — Fila "A Classificar"
  return {
    categoria: CATEGORIA_A_CLASSIFICAR,
    subcategoria: '',
    categoriaCompleta: CATEGORIA_A_CLASSIFICAR,
    tag: '',
    apelidoDescricao: '',
    origem: 'pendente',
    regraId: null
  };
}

function mesclarTagNoLancamento(l, novaTag) {
  const limpa = String(novaTag || '').trim().replace(/^#+/, '');
  if (!limpa) return false;
  const atuais = Array.isArray(l.tags) ? [...l.tags] : [];
  if (atuais.some(t => String(t).toLowerCase() === limpa.toLowerCase())) return false;
  atuais.push(limpa);
  l.tags = atuais;
  return true;
}

function aplicarResultadoAutoCatNoLancamento(l, res, opcoes = {}) {
  if (!l || !res || ehLancamentoProtegidoAutoCat(l)) return false;
  let mudou = false;
  const novaCat = res.categoriaCompleta || montarCategoriaCompletaAutoCat(res.categoria, res.subcategoria);
  if (novaCat && l.categoria !== novaCat) {
    l.categoria = novaCat;
    mudou = true;
  }
  if (res.tag && mesclarTagNoLancamento(l, res.tag)) {
    mudou = true;
  }
  if (res.apelidoDescricao) {
    const apelido = String(res.apelidoDescricao).trim();
    if (apelido && l.descricao !== apelido) {
      if (!l.descricaoOriginal) l.descricaoOriginal = l.descricao;
      l.descricao = apelido;
      mudou = true;
    }
  }
  if (mudou) l.sincronizado = false;
  if (mudou && res.regraId && opcoes.incrementarUso !== false) {
    const regra = (STATE.regrasCategoria || []).find(r => r && r.id === res.regraId);
    if (regra) regra.usos = (parseInt(regra.usos, 10) || 0) + 1;
  }
  return mudou;
}

function badgeOrigemClassificacaoHTML(origem) {
  const mapa = {
    regra: { cls: 'badge-origem-regra', icone: 'ti-sparkles', label: 'Regra' },
    memoria: { cls: 'badge-origem-memoria', icone: 'ti-brain', label: 'Memória' },
    pluggy: { cls: 'badge-origem-pluggy', icone: 'ti-plug-connected', label: 'Pluggy' },
    dicionario: { cls: 'badge-origem-dicionario', icone: 'ti-book-2', label: 'Pluggy' },
    pendente: { cls: 'badge-origem-pendente', icone: 'ti-inbox', label: 'A Classificar' },
    manual: { cls: 'badge-origem-manual', icone: 'ti-hand-click', label: 'Manual' }
  };
  const info = mapa[origem] || mapa.pendente;
  return `<span class="badge-origem-cat ${info.cls}"><i class="ti ${info.icone}" style="font-size:10px"></i> ${info.label}</span>`;
}

/* ---- 4.1 APRENDIZADO COM 1 CLIQUE (TOAST INTELIGENTE) ---- */
let _aprendizadoRegraContexto = null;
let _aprendizadoRegraTimer = null;

function criarOuAtualizarRegraAutomatica({ padrao, modoMatch = 'contem', tipo = 'todos', contaId = '', valorMin = null, valorMax = null, categoria, subcategoria = '', tag = '', apelidoDescricao = '', prioridade = 100 }) {
  normalizarRegrasCategoria();
  const padraoLimpo = String(padrao || '').trim();
  const parsed = extrairMacroESubcategoria(categoria);
  const macro = subcategoria ? (parsed.temSub ? parsed.macro : String(categoria || '').trim()) : parsed.macro;
  const sub = subcategoria ? String(subcategoria).trim() : (parsed.temSub ? parsed.sub : '');
  if (!padraoLimpo || !macro) return null;

  const padraoNorm = normalizarTextoSemAcento(padraoLimpo);
  const existente = STATE.regrasCategoria.find(r =>
    r &&
    normalizarTextoSemAcento(r.padrao) === padraoNorm &&
    (r.modoMatch || 'contem') === modoMatch &&
    (r.tipo || 'todos') === tipo &&
    String(r.contaId || '') === String(contaId || '') &&
    r.valorMin === valorMin &&
    r.valorMax === valorMax
  );

  if (existente) {
    existente.ativa = true;
    existente.categoria = macro;
    existente.subcategoria = sub;
    if (tag) existente.tag = String(tag).trim().replace(/^#+/, '');
    if (apelidoDescricao) existente.apelidoDescricao = String(apelidoDescricao).trim();
    return { regra: existente, criada: false };
  }

  const nova = {
    id: uid(),
    ativa: true,
    prioridade: Number.isFinite(Number(prioridade)) ? Number(prioridade) : 100,
    padrao: padraoLimpo,
    modoMatch,
    tipo,
    contaId: String(contaId || '').trim(),
    valorMin,
    valorMax,
    categoria: macro,
    subcategoria: sub,
    tag: String(tag || '').trim().replace(/^#+/, ''),
    apelidoDescricao: String(apelidoDescricao || '').trim(),
    criadaEm: new Date().toISOString(),
    usos: 0
  };
  STATE.regrasCategoria.push(nova);
  return { regra: nova, criada: true };
}

function fecharToastAprendizadoRegra() {
  clearTimeout(_aprendizadoRegraTimer);
  _aprendizadoRegraTimer = null;
  _aprendizadoRegraContexto = null;
  const el = document.getElementById('toast-aprendizado-regra');
  if (el) el.classList.add('oculto');
}

function oferecerAprendizadoRegra(lanc, novaCategoriaCompleta, opcoes = {}) {
  if (!lanc || ehLancamentoProtegidoAutoCat(lanc)) return;
  if (!ehCategoriaValidaParaAprendizado(novaCategoriaCompleta)) return;

  const descBase = obterDescricaoBaseAutoCat(lanc);
  const nucleo = normalizarDescricaoBancaria(descBase);
  if (!nucleo || nucleo.length < 2) return;

  const tipo = lanc.tipo === 'receita' ? 'receita' : 'despesa';
  const parsed = extrairMacroESubcategoria(novaCategoriaCompleta);
  const catCompleta = montarCategoriaCompletaAutoCat(parsed.macro, parsed.temSub ? parsed.sub : '');
  const apelido = String(opcoes.apelidoSugerido || '').trim();

  // Conta outros lançamentos similares já salvos em STATE.lancamentos
  const similaresIds = (STATE.lancamentos || [])
    .filter(x => {
      if (!x || x.id === lanc.id || ehLancamentoProtegidoAutoCat(x)) return false;
      if ((x.tipo === 'receita' ? 'receita' : 'despesa') !== tipo) return false;
      const nucX = normalizarDescricaoBancaria(obterDescricaoBaseAutoCat(x));
      if (nucX !== nucleo) return false;
      return x.categoria !== catCompleta || (apelido && x.descricao !== apelido);
    })
    .map(x => x.id);

  // Evita sugerir se já existe regra idêntica ativa e não há similares pendentes
  normalizarRegrasCategoria();
  const jaTemRegraIdentica = STATE.regrasCategoria.some(r =>
    r.ativa &&
    normalizarTextoSemAcento(r.padrao) === normalizarTextoSemAcento(nucleo) &&
    (r.tipo === tipo || r.tipo === 'todos') &&
    montarCategoriaCompletaAutoCat(r.categoria, r.subcategoria) === catCompleta &&
    (!apelido || r.apelidoDescricao === apelido)
  );
  if (jaTemRegraIdentica && similaresIds.length === 0) return;

  _aprendizadoRegraContexto = {
    nucleo,
    tipo,
    categoria: parsed.macro,
    subcategoria: parsed.temSub ? parsed.sub : '',
    categoriaCompleta: catCompleta,
    apelidoDescricao: apelido,
    similaresIds
  };

  const el = document.getElementById('toast-aprendizado-regra');
  const msgEl = document.getElementById('toast-aprendizado-msg');
  const actEl = document.getElementById('toast-aprendizado-actions');
  if (!el || !msgEl || !actEl) return;

  const catExib = formatarCategoriaExibicao(catCompleta);
  msgEl.innerHTML = `Sempre classificar <strong>"${escHtml(nucleo)}"</strong> como <strong>"${escHtml(catExib)}"</strong>?`;

  const qtd = similaresIds.length;
  actEl.innerHTML = `
    <button type="button" class="btn btn-sm btn-primary" onclick="confirmarAprendizadoRegra(false)">
      <i class="ti ti-sparkles"></i> Criar regra
    </button>
    ${qtd > 0 ? `
      <button type="button" class="btn btn-sm" style="border-color:var(--accent);color:var(--accent-text)" onclick="confirmarAprendizadoRegra(true)">
        <i class="ti ti-bolt"></i> Criar e aplicar em +${qtd} antigos
      </button>
    ` : ''}
  `;

  el.classList.remove('oculto');
  clearTimeout(_aprendizadoRegraTimer);
  _aprendizadoRegraTimer = setTimeout(() => fecharToastAprendizadoRegra(), 12000);
}

async function confirmarAprendizadoRegra(aplicarAntigos) {
  const ctx = _aprendizadoRegraContexto;
  if (!ctx) return;

  const resRegra = criarOuAtualizarRegraAutomatica({
    padrao: ctx.nucleo,
    modoMatch: 'contem',
    tipo: ctx.tipo,
    categoria: ctx.categoria,
    subcategoria: ctx.subcategoria,
    apelidoDescricao: ctx.apelidoDescricao
  });

  let atualizados = 0;
  if (aplicarAntigos && ctx.similaresIds.length > 0 && resRegra && resRegra.regra) {
    const idsSet = new Set(ctx.similaresIds);
    (STATE.lancamentos || []).forEach(l => {
      if (!l || !idsSet.has(l.id) || ehLancamentoProtegidoAutoCat(l)) return;
      const ok = aplicarResultadoAutoCatNoLancamento(l, {
        categoria: ctx.categoria,
        subcategoria: ctx.subcategoria,
        categoriaCompleta: ctx.categoriaCompleta,
        apelidoDescricao: ctx.apelidoDescricao,
        regraId: resRegra.regra.id
      }, { incrementarUso: true });
      if (ok) atualizados += 1;
    });
  }

  // Também atualiza eventuais linhas similares ainda abertas no Modal de Revisão
  if (Array.isArray(transacoesPendentes) && transacoesPendentes.length > 0 && resRegra && resRegra.regra) {
    let mudouRevisao = false;
    transacoesPendentes.forEach(tx => {
      if (!tx || ehLancamentoProtegidoAutoCat(tx)) return;
      if ((tx.tipo === 'receita' ? 'receita' : 'despesa') !== ctx.tipo) return;
      if (normalizarDescricaoBancaria(obterDescricaoBaseAutoCat(tx)) === ctx.nucleo) {
        tx.categoria = ctx.categoriaCompleta;
        tx.classificacaoOrigem = 'regra';
        tx.classificacaoRegraId = resRegra.regra.id;
        if (ctx.apelidoDescricao) tx.apelidoSugerido = ctx.apelidoDescricao;
        mudouRevisao = true;
      }
    });
    if (mudouRevisao && typeof renderListaRevisaoOFX === 'function') renderListaRevisaoOFX();
  }

  fecharToastAprendizadoRegra();
  await salvarDados();
  if (typeof renderRegrasCategoriaConfig === 'function') renderRegrasCategoriaConfig();
  renderPaginaAtiva();
  atualizarContagemTriagem();
  sincronizarEmSegundoPlano();

  if (aplicarAntigos && atualizados > 0) {
    toast(`Regra salva e aplicada em +${atualizados} lançamento(s) antigo(s)!`, 'ok');
  } else {
    toast(`Regra automática salva para "${ctx.nucleo}" → ${formatarCategoriaExibicao(ctx.categoriaCompleta)}.`, 'ok');
  }
}

/* ---- 4.2 TRIAGEM AGRUPADA ("CAIXA DE ENTRADA") ---- */
let _gruposTriagemAtuais = [];

function obterLancamentosPendentesTriagem() {
  return (STATE.lancamentos || []).filter(l => {
    if (!l || ehLancamentoProtegidoAutoCat(l)) return false;
    return ehCategoriaGenericaOuPendente(l.categoria);
  });
}

function atualizarContagemTriagem() {
  const qtd = obterLancamentosPendentesTriagem().length;
  const badge = document.getElementById('triagem-contagem');
  const btn = document.getElementById('btn-abrir-triagem');
  if (badge) badge.textContent = String(qtd);
  if (btn) btn.classList.toggle('tem-pendencias', qtd > 0);
  return qtd;
}

function agruparLancamentosParaTriagem() {
  const pendentes = obterLancamentosPendentesTriagem();
  const mapa = new Map();

  pendentes.forEach(l => {
    const descBase = obterDescricaoBaseAutoCat(l);
    const nucleo = normalizarDescricaoBancaria(descBase) || normalizarTextoSemAcento(descBase) || 'sem descricao';
    const tipo = l.tipo === 'receita' ? 'receita' : 'despesa';
    const chave = `${tipo}|${nucleo}`;
    let grupo = mapa.get(chave);
    if (!grupo) {
      grupo = {
        chave,
        nucleo,
        tipo,
        exemploDescricao: descBase || l.descricao || '-',
        ids: [],
        totalValor: 0
      };
      mapa.set(chave, grupo);
    }
    grupo.ids.push(l.id);
    grupo.totalValor = Math.round((grupo.totalValor + (Number(l.valor) || 0)) * 100) / 100;
  });

  return [...mapa.values()].sort((a, b) => (b.ids.length - a.ids.length) || (b.totalValor - a.totalValor));
}

function abrirModalTriagemCategorias() {
  renderModalTriagemCategorias();
  abrirModal('modal-triagem-categorias');
}

function renderModalTriagemCategorias() {
  _gruposTriagemAtuais = agruparLancamentosParaTriagem();
  const totalLancs = _gruposTriagemAtuais.reduce((s, g) => s + g.ids.length, 0);
  const badgeModal = document.getElementById('triagem-modal-badge');
  const listaEl = document.getElementById('triagem-grupos-lista');
  const infoEl = document.getElementById('triagem-footer-info');
  const btnTodos = document.getElementById('btn-triagem-aplicar-todos');

  if (badgeModal) badgeModal.textContent = `${totalLancs} pendente(s) · ${_gruposTriagemAtuais.length} grupo(s)`;
  if (infoEl) infoEl.textContent = _gruposTriagemAtuais.length
    ? `Mostrando ${_gruposTriagemAtuais.length} grupo(s) ordenados por maior frequência.`
    : 'Tudo classificado! Nenhum lançamento pendente na Caixa de Entrada.';
  if (btnTodos) btnTodos.disabled = _gruposTriagemAtuais.length === 0;
  if (!listaEl) return;

  if (!_gruposTriagemAtuais.length) {
    listaEl.innerHTML = `
      <div class="empty" style="padding:2rem 1rem">
        <i class="ti ti-circle-check" style="font-size:32px;color:var(--good)"></i>
        <p style="margin-top:.5rem">Caixa de Entrada zerada!</p>
        <span class="help-text">Não há lançamentos em "A Classificar" ou "Outros".</span>
      </div>`;
    return;
  }

  listaEl.innerHTML = _gruposTriagemAtuais.map((g, idx) => {
    const optsCat = '<option value="">-- Escolher categoria --</option>' + construirOptionsCategoriasHTML(g.tipo, '');
    const badgeTipo = g.tipo === 'receita'
      ? '<span class="badge badge-receita">Receita</span>'
      : '<span class="badge badge-despesa">Despesa</span>';
    return `
      <div class="triagem-grupo-card" data-triagem-idx="${idx}">
        <div class="triagem-grupo-topo">
          <div class="triagem-grupo-titulo-wrap">
            <div class="triagem-grupo-nucleo">
              <span>${escHtml(g.nucleo)}</span>
              ${badgeTipo}
              <span class="badge badge-cat">${g.ids.length} lançamento(s)</span>
            </div>
            <div class="triagem-grupo-exemplo" title="${escHtml(g.exemploDescricao)}">
              Exemplo: ${escHtml(g.exemploDescricao)}
            </div>
          </div>
          <div class="triagem-grupo-meta">
            <strong class="valor-sensivel ${g.tipo === 'receita' ? 'mv-ok' : 'mv-bad'}">${toBRL(g.totalValor)}</strong>
          </div>
        </div>
        <div class="triagem-grupo-controles">
          <select class="triagem-cat-select" data-triagem-cat="${idx}">
            ${optsCat}
          </select>
          <input type="text" class="triagem-tag-input" data-triagem-tag="${idx}" placeholder="Tag (opcional)">
          <input type="text" class="triagem-apelido-input" data-triagem-apelido="${idx}" placeholder="Apelido descrição (opcional)">
          <button type="button" class="btn btn-sm btn-primary" onclick="aplicarGrupoTriagem(${idx})">
            <i class="ti ti-check"></i> Aplicar
          </button>
        </div>
        <div class="triagem-grupo-rodape">
          <label class="triagem-chk-regra">
            <input type="checkbox" class="triagem-regra-chk" data-triagem-regra="${idx}" checked>
            <span>Salvar regra automática para <strong>"${escHtml(g.nucleo)}"</strong></span>
          </label>
        </div>
      </div>`;
  }).join('');
}

function executarAplicacaoGrupoTriagemInterno(idx) {
  const grupo = _gruposTriagemAtuais[idx];
  if (!grupo) return { aplicado: false, qtd: 0 };
  const selCat = document.querySelector(`[data-triagem-cat="${idx}"]`);
  const inpTag = document.querySelector(`[data-triagem-tag="${idx}"]`);
  const inpApelido = document.querySelector(`[data-triagem-apelido="${idx}"]`);
  const chkRegra = document.querySelector(`[data-triagem-regra="${idx}"]`);

  const catVal = selCat ? String(selCat.value || '').trim() : '';
  if (!catVal) return { aplicado: false, qtd: 0 };

  const parsed = extrairMacroESubcategoria(catVal);
  const catCompleta = montarCategoriaCompletaAutoCat(parsed.macro, parsed.temSub ? parsed.sub : '');
  const tagVal = inpTag ? String(inpTag.value || '').trim().replace(/^#+/, '') : '';
  const apelidoVal = inpApelido ? String(inpApelido.value || '').trim() : '';
  const salvarRegra = chkRegra ? Boolean(chkRegra.checked) : true;

  let regraCriadaId = null;
  if (salvarRegra && ehCategoriaValidaParaAprendizado(catCompleta)) {
    const rObj = criarOuAtualizarRegraAutomatica({
      padrao: grupo.nucleo,
      modoMatch: 'contem',
      tipo: grupo.tipo,
      categoria: parsed.macro,
      subcategoria: parsed.temSub ? parsed.sub : '',
      tag: tagVal,
      apelidoDescricao: apelidoVal
    });
    if (rObj && rObj.regra) regraCriadaId = rObj.regra.id;
  }

  const idsSet = new Set(grupo.ids);
  let atualizados = 0;
  (STATE.lancamentos || []).forEach(l => {
    if (!l || !idsSet.has(l.id) || ehLancamentoProtegidoAutoCat(l)) return;
    const ok = aplicarResultadoAutoCatNoLancamento(l, {
      categoria: parsed.macro,
      subcategoria: parsed.temSub ? parsed.sub : '',
      categoriaCompleta: catCompleta,
      tag: tagVal,
      apelidoDescricao: apelidoVal,
      regraId: regraCriadaId
    }, { incrementarUso: Boolean(regraCriadaId) });
    if (ok) atualizados += 1;
  });

  return { aplicado: true, qtd: atualizados, regraCriada: Boolean(regraCriadaId) };
}

async function aplicarGrupoTriagem(idx) {
  const res = executarAplicacaoGrupoTriagemInterno(idx);
  if (!res.aplicado) {
    toast('Selecione uma categoria para este grupo antes de aplicar.', 'err');
    return;
  }
  await salvarDados();
  renderModalTriagemCategorias();
  renderPaginaAtiva();
  if (typeof renderRegrasCategoriaConfig === 'function') renderRegrasCategoriaConfig();
  atualizarContagemTriagem();
  sincronizarEmSegundoPlano();
  toast(`${res.qtd} lançamento(s) classificado(s)${res.regraCriada ? ' e regra automática salva' : ''}!`, 'ok');
}

async function aplicarTodosGruposTriagem() {
  let gruposAplicados = 0;
  let totalLancs = 0;
  let regrasSalvas = 0;

  for (let i = 0; i < _gruposTriagemAtuais.length; i += 1) {
    const res = executarAplicacaoGrupoTriagemInterno(i);
    if (res.aplicado) {
      gruposAplicados += 1;
      totalLancs += res.qtd;
      if (res.regraCriada) regrasSalvas += 1;
    }
  }

  if (gruposAplicados === 0) {
    toast('Selecione a categoria em pelo menos um grupo para aplicar.', 'err');
    return;
  }

  await salvarDados();
  renderModalTriagemCategorias();
  renderPaginaAtiva();
  if (typeof renderRegrasCategoriaConfig === 'function') renderRegrasCategoriaConfig();
  atualizarContagemTriagem();
  sincronizarEmSegundoPlano();
  toast(`${totalLancs} lançamento(s) classificado(s) em ${gruposAplicados} grupo(s)${regrasSalvas ? ` (${regrasSalvas} regra(s) salva(s))` : ''}!`, 'ok');
}

/* ---- 4.3 GERENCIADOR DE REGRAS + LIVE PREVIEW + REPROCESSAMENTO ---- */
function renderRegrasCategoriaConfig() {
  normalizarRegrasCategoria();
  const listaEl = document.getElementById('regras-autocat-lista');
  const totalEl = document.getElementById('regras-autocat-total');
  const ordenadas = ordenarRegrasCategoriaParaAvaliacao(STATE.regrasCategoria);
  if (totalEl) totalEl.textContent = `${ordenadas.length} regra(s)`;
  if (!listaEl) return;

  if (!ordenadas.length) {
    listaEl.innerHTML = '<div class="help-text" style="padding:.5rem 0">Nenhuma regra cadastrada ainda. Clique em <strong>+ Nova Regra</strong> ou edite um lançamento para aprender automaticamente.</div>';
    return;
  }

  const labelModo = { contem: 'Contém', comeca_com: 'Começa com', exato: 'Exato' };
  const labelTipo = { todos: 'Todos', despesa: 'Despesa', receita: 'Receita' };

  listaEl.innerHTML = ordenadas.map(r => {
    const catExib = formatarCategoriaExibicao(montarCategoriaCompletaAutoCat(r.categoria, r.subcategoria));
    const extrasCond = [];
    if (r.tipo && r.tipo !== 'todos') extrasCond.push(labelTipo[r.tipo] || r.tipo);
    if (r.contaId) extrasCond.push(`Conta: ${r.contaId}`);
    if (r.valorMin !== null || r.valorMax !== null) {
      const minS = r.valorMin !== null ? toBRL(r.valorMin) : 'R$ 0,00';
      const maxS = r.valorMax !== null ? toBRL(r.valorMax) : '∞';
      extrasCond.push(`${minS} – ${maxS}`);
    }
    const extrasAcao = [];
    if (r.tag) extrasAcao.push(`<span class="badge badge-cat">#${escHtml(r.tag)}</span>`);
    if (r.apelidoDescricao) extrasAcao.push(`<span class="badge badge-origem-regra" title="Renomeia descrição mantendo original"><i class="ti ti-edit"></i> ${escHtml(r.apelidoDescricao)}</span>`);

    return `
      <div class="regra-item-card${r.ativa ? '' : ' inativa'}" data-regra-id="${escHtml(r.id)}">
        <div class="regra-item-left">
          <label class="regra-switch" title="${r.ativa ? 'Desativar regra' : 'Ativar regra'}">
            <input type="checkbox" ${r.ativa ? 'checked' : ''} onchange="alternarRegraCategoriaAtiva('${escHtml(r.id)}', this.checked)">
            <span class="regra-switch-slider"></span>
          </label>
          <div class="regra-item-info">
            <div class="regra-item-linha">
              <span class="badge badge-cat">${escHtml(labelModo[r.modoMatch] || 'Contém')}</span>
              <strong>"${escHtml(r.padrao)}"</strong>
              <i class="ti ti-arrow-right" style="opacity:.6"></i>
              <span class="badge badge-pago">${escHtml(catExib)}</span>
              ${extrasAcao.join(' ')}
            </div>
            <div class="regra-item-meta">
              <span>Prioridade: <strong>${r.prioridade}</strong></span>
              <span>·</span>
              <span>Usos: <strong>${r.usos || 0}</strong></span>
              ${extrasCond.length ? `<span>·</span><span>${escHtml(extrasCond.join(' · '))}</span>` : ''}
            </div>
          </div>
        </div>
        <div class="regra-item-acoes">
          <button type="button" class="icon-btn" onclick="abrirModalRegraCategoria('${escHtml(r.id)}')" title="Editar regra"><i class="ti ti-pencil"></i></button>
          <button type="button" class="icon-btn danger" onclick="excluirRegraCategoria('${escHtml(r.id)}')" title="Excluir regra"><i class="ti ti-trash"></i></button>
        </div>
      </div>`;
  }).join('');
}

function atualizarCategoriasModalRegra(valorPreservado) {
  const selTipo = document.getElementById('regra-modal-tipo');
  const selCat = document.getElementById('regra-modal-categoria');
  if (!selCat) return;
  const tipo = selTipo ? selTipo.value : 'todos';
  const filtroTipo = (tipo === 'despesa' || tipo === 'receita') ? tipo : '';
  const atual = valorPreservado !== undefined ? valorPreservado : selCat.value;
  selCat.innerHTML = construirOptionsCategoriasHTML(filtroTipo, atual);
}

function abrirModalRegraCategoria(regraId) {
  normalizarRegrasCategoria();
  const regra = regraId ? STATE.regrasCategoria.find(r => r && r.id === regraId) : null;

  const tituloEl = document.getElementById('modal-regra-titulo');
  if (tituloEl) {
    tituloEl.innerHTML = regra
      ? '<i class="ti ti-pencil" style="color:var(--accent);font-size:18px"></i><span>Editar Regra de Auto-Categorização</span>'
      : '<i class="ti ti-sparkles" style="color:var(--accent);font-size:18px"></i><span>Nova Regra de Auto-Categorização</span>';
  }

  const selConta = document.getElementById('regra-modal-conta');
  if (selConta) {
    selConta.innerHTML = '<option value="">Todas as contas</option>'
      + (STATE.contas || []).map(c => `<option value="${escHtml(c.nome)}">${escHtml(c.nome)}</option>`).join('');
  }

  document.getElementById('regra-modal-id').value = regra ? regra.id : '';
  document.getElementById('regra-modal-padrao').value = regra ? regra.padrao : '';
  document.getElementById('regra-modal-modo').value = regra ? regra.modoMatch : 'contem';
  document.getElementById('regra-modal-tipo').value = regra ? regra.tipo : 'todos';
  if (selConta) selConta.value = regra ? (regra.contaId || '') : '';
  document.getElementById('regra-modal-vmin').value = (regra && regra.valorMin !== null) ? toBRL(regra.valorMin) : '';
  document.getElementById('regra-modal-vmax').value = (regra && regra.valorMax !== null) ? toBRL(regra.valorMax) : '';
  document.getElementById('regra-modal-prioridade').value = regra ? String(regra.prioridade) : '100';
  document.getElementById('regra-modal-tag').value = regra ? (regra.tag || '') : '';
  document.getElementById('regra-modal-apelido').value = regra ? (regra.apelidoDescricao || '') : '';
  document.getElementById('regra-modal-ativa').checked = regra ? regra.ativa !== false : true;

  const catInicial = regra ? montarCategoriaCompletaAutoCat(regra.categoria, regra.subcategoria) : '';
  atualizarCategoriasModalRegra(catInicial);
  atualizarPreviewRegraModal();
  abrirModal('modal-regra-categoria');
}

function lerRascunhoRegraModal() {
  const padrao = String(document.getElementById('regra-modal-padrao')?.value || '').trim();
  const modoMatch = document.getElementById('regra-modal-modo')?.value || 'contem';
  const tipo = document.getElementById('regra-modal-tipo')?.value || 'todos';
  const contaId = String(document.getElementById('regra-modal-conta')?.value || '').trim();
  const rawMin = String(document.getElementById('regra-modal-vmin')?.value || '').trim();
  const rawMax = String(document.getElementById('regra-modal-vmax')?.value || '').trim();
  const valorMin = rawMin ? moedaToNumber(rawMin) : null;
  const valorMax = rawMax ? moedaToNumber(rawMax) : null;
  const prioridade = parseInt(document.getElementById('regra-modal-prioridade')?.value, 10) || 100;
  const catCompleta = String(document.getElementById('regra-modal-categoria')?.value || '').trim();
  const parsed = extrairMacroESubcategoria(catCompleta);
  const tag = String(document.getElementById('regra-modal-tag')?.value || '').trim().replace(/^#+/, '');
  const apelidoDescricao = String(document.getElementById('regra-modal-apelido')?.value || '').trim();
  const ativa = Boolean(document.getElementById('regra-modal-ativa')?.checked);

  return {
    id: String(document.getElementById('regra-modal-id')?.value || '').trim(),
    padrao,
    modoMatch,
    tipo,
    contaId,
    valorMin: (rawMin && Number.isFinite(valorMin)) ? valorMin : null,
    valorMax: (rawMax && Number.isFinite(valorMax)) ? valorMax : null,
    prioridade,
    categoria: parsed.macro,
    subcategoria: parsed.temSub ? parsed.sub : '',
    tag,
    apelidoDescricao,
    ativa
  };
}

function atualizarPreviewRegraModal() {
  const countEl = document.getElementById('regra-live-preview-count');
  const exEl = document.getElementById('regra-live-preview-exemplos');
  if (!countEl || !exEl) return;

  const rascunho = lerRascunhoRegraModal();
  if (!rascunho.padrao) {
    countEl.textContent = 'Digite um padrão para visualizar quantos lançamentos existentes correspondem.';
    exEl.innerHTML = '';
    return;
  }

  const matches = [];
  const lista = STATE.lancamentos || [];
  for (let i = 0; i < lista.length; i += 1) {
    const l = lista[i];
    if (avaliarRegraNoLancamento(rascunho, l)) {
      matches.push(l);
    }
  }

  countEl.textContent = `${matches.length} lançamento(s) existente(s) correspondem a esta regra`;
  exEl.innerHTML = matches.slice(0, 3).map(m => {
    const descShow = obterDescricaoBaseAutoCat(m);
    return `<div class="regra-live-preview-ex">
      <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(descShow)}</span>
      <span style="flex-shrink:0;color:var(--text3)">${escHtml(m.data || '')} · ${toBRL(m.valor)}</span>
    </div>`;
  }).join('');
}

async function salvarRegraCategoriaModal() {
  normalizarRegrasCategoria();
  const dados = lerRascunhoRegraModal();
  if (!dados.padrao) {
    toast('Informe o padrão / estabelecimento da regra.', 'err');
    return;
  }
  if (!dados.categoria || ehCategoriaGenericaOuPendente(dados.categoria)) {
    toast('Selecione uma categoria válida para a regra.', 'err');
    return;
  }
  if (dados.valorMin !== null && dados.valorMax !== null && dados.valorMin > dados.valorMax) {
    toast('O valor mínimo não pode ser maior que o valor máximo.', 'err');
    return;
  }

  if (dados.id) {
    const idx = STATE.regrasCategoria.findIndex(r => r && r.id === dados.id);
    if (idx >= 0) {
      STATE.regrasCategoria[idx] = {
        ...STATE.regrasCategoria[idx],
        ...dados
      };
    }
  } else {
    STATE.regrasCategoria.push({
      ...dados,
      id: uid(),
      criadaEm: new Date().toISOString(),
      usos: 0
    });
  }

  await salvarDados();
  fecharModal('modal-regra-categoria');
  renderRegrasCategoriaConfig();
  toast('Regra de auto-categorização salva!', 'ok');
}

async function alternarRegraCategoriaAtiva(regraId, ativa) {
  normalizarRegrasCategoria();
  const r = STATE.regrasCategoria.find(x => x && x.id === regraId);
  if (!r) return;
  r.ativa = Boolean(ativa);
  await salvarDados();
  renderRegrasCategoriaConfig();
}

async function excluirRegraCategoria(regraId) {
  normalizarRegrasCategoria();
  STATE.regrasCategoria = STATE.regrasCategoria.filter(r => r && r.id !== regraId);
  await salvarDados();
  renderRegrasCategoriaConfig();
  toast('Regra excluída.', 'ok');
}

function abrirModalReprocessarRegras() {
  normalizarRegrasCategoria();
  const ativas = STATE.regrasCategoria.filter(r => r && r.ativa);
  if (!ativas.length) {
    toast('Ative ou crie pelo menos uma regra antes de reprocessar.', 'err');
    return;
  }
  atualizarContagemReprocessarRegras();
  abrirModal('modal-reprocessar-regras');
}

function obterEscopoReprocessamentoSelecionado() {
  const radio = document.querySelector('input[name="reprocessar-escopo"]:checked');
  return radio ? radio.value : 'pendentes';
}

function atualizarContagemReprocessarRegras() {
  const infoEl = document.getElementById('reprocessar-preview-info');
  if (!infoEl) return;
  const escopo = obterEscopoReprocessamentoSelecionado();
  const regrasAtivas = ordenarRegrasCategoriaParaAvaliacao((STATE.regrasCategoria || []).filter(r => r && r.ativa));
  let elegiveis = 0;
  let comMatch = 0;

  (STATE.lancamentos || []).forEach(l => {
    if (!l || ehLancamentoProtegidoAutoCat(l)) return;
    if (escopo === 'pendentes' && !ehCategoriaGenericaOuPendente(l.categoria)) return;
    elegiveis += 1;
    const descBruta = obterDescricaoBaseAutoCat(l);
    const descNorm = normalizarTextoSemAcento(descBruta);
    const nuc = normalizarDescricaoBancaria(descBruta);
    if (regrasAtivas.some(r => avaliarRegraNoLancamento(r, l, descNorm, nuc))) {
      comMatch += 1;
    }
  });

  infoEl.textContent = `${comMatch} de ${elegiveis} lançamento(s) elegível(is) serão atualizados pelas regras ativas.`;
}

async function executarReprocessamentoRegras() {
  normalizarRegrasCategoria();
  const escopo = obterEscopoReprocessamentoSelecionado();
  const regrasAtivas = ordenarRegrasCategoriaParaAvaliacao(STATE.regrasCategoria.filter(r => r && r.ativa));
  if (!regrasAtivas.length) {
    toast('Nenhuma regra ativa para reprocessar.', 'err');
    return;
  }

  let atualizados = 0;
  (STATE.lancamentos || []).forEach(l => {
    if (!l || ehLancamentoProtegidoAutoCat(l)) return;
    if (escopo === 'pendentes' && !ehCategoriaGenericaOuPendente(l.categoria)) return;

    const descBruta = obterDescricaoBaseAutoCat(l);
    const descNorm = normalizarTextoSemAcento(descBruta);
    const nuc = normalizarDescricaoBancaria(descBruta);

    for (let i = 0; i < regrasAtivas.length; i += 1) {
      const r = regrasAtivas[i];
      if (avaliarRegraNoLancamento(r, l, descNorm, nuc)) {
        const ok = aplicarResultadoAutoCatNoLancamento(l, {
          categoria: r.categoria,
          subcategoria: r.subcategoria,
          categoriaCompleta: montarCategoriaCompletaAutoCat(r.categoria, r.subcategoria),
          tag: r.tag,
          apelidoDescricao: r.apelidoDescricao,
          regraId: r.id
        }, { incrementarUso: true });
        if (ok) atualizados += 1;
        break;
      }
    }
  });

  fecharModal('modal-reprocessar-regras');
  if (atualizados > 0) {
    await salvarDados();
    renderRegrasCategoriaConfig();
    renderPaginaAtiva();
    atualizarContagemTriagem();
    sincronizarEmSegundoPlano();
    toast(`Reprocessamento concluído: ${atualizados} lançamento(s) atualizado(s)!`, 'ok');
  } else {
    toast('Nenhum lançamento precisou ser alterado pelas regras ativas.', 'ok');
  }
}
