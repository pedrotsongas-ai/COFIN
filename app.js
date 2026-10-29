/* ================= ESTADO E PERSISTÊNCIA ================= */
const APP_VERSAO = '2026-10-19 · r7';
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
  regras: [],
  metas: [],
  cofres: [],               // Cofres/Caixinhas (Vaults): { id, nome, icone, cor, objetivo, saldoAlocado }
  dividas: [],
  lixeira: [],              // lançamentos excluídos (recuperáveis por 30 dias)
  excluidosPendentes: [],   // IDs apagados aqui que a planilha ainda pode ter (evita ressuscitar na sincronização)
  recorrentesIgnorados: [], // 'idRecorrência|AAAA-MM' apagados de propósito (a recorrência não recria)
  config: { lastSync: null, oneDriveLink: null, ultimoMesFechado: null, modoViagem: { ativo: false, nome: '', hashtag: '' } }
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
  const [ano, mes, dia] = dataISO.split('-').map(Number);
  if (dia <= (diaFechamento || 1)) return { ano, mes };
  let m = mes + 1, a = ano;
  if (m > 12) { m = 1; a++; }
  return { ano: a, mes: m };
}

function mesCompetenciaLancamento(l) {
  if (!l) return '';
  if (l.faturaAno && l.faturaMes) {
    return `${l.faturaAno}-${String(l.faturaMes).padStart(2, '0')}`;
  }
  const cartao = (STATE.contas || []).find(c => c.nome === l.conta && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === l.conta);
  if (cartao && cartao.diaFechamento && (l.dataCompra || l.data)) {
    const comp = competenciaFatura(l.dataCompra || l.data, cartao.diaFechamento);
    return `${comp.ano}-${String(comp.mes).padStart(2, '0')}`;
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

function ehLancamentoCartao(l) {
  if (!l) return false;
  if (l.faturaAno && l.faturaMes) return true;
  if (l.dataVencimentoFatura) return true;
  if (l.parcelaAtual || l.parcelaTotal) return true;
  const c = (STATE.contas || []).find(x => x.nome === l.conta) || (STATE.cartoes || []).find(x => x.nome === l.conta);
  return !!(c && (c.tipo === 'cartao' || (STATE.cartoes || []).some(k => k.nome === l.conta)));
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

/* ================= GESTÃO INTELIGENTE DE CARTÕES DE CRÉDITO ================= */
function obterInfoCartaoInteligente(cartao) {
  const hoje = hojeLocalISO();
  const [anoHoje, mesHoje, diaHoje] = hoje.split('-').map(Number);
  const diaFechamento = parseInt(cartao.diaFechamento, 10) || 1;
  const diaVencimento = parseInt(cartao.diaVencimento, 10) || 10;
  const limiteTotal = Number(cartao.limiteTotal || cartao.limite) || 0;

  const compAtual = competenciaFatura(hoje, diaFechamento);
  const itensFaturaAtual = lancamentosDaFatura(cartao.nome, compAtual.ano, compAtual.mes);
  const totalFaturaAtual = itensFaturaAtual.reduce((s, l) => s + l.valor, 0);
  const totalFaturaPendente = itensFaturaAtual.filter(l => !estaPago(l)).reduce((s, l) => s + l.valor, 0);

  // Todo o comprometimento não pago (fatura atual + parcelas futuras)
  const pendentesCartao = (STATE.lancamentos || []).filter(l => l.conta === cartao.nome && l.tipo === 'despesa' && !estaPago(l));
  const totalComprometido = pendentesCartao.reduce((s, l) => s + l.valor, 0);
  const limiteDisponivel = limiteTotal > 0 ? Math.max(0, limiteTotal - totalComprometido) : 0;
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

function renderWidgetMelhorCartao() {
  const container = document.getElementById('dash-melhor-cartao-content');
  if (!container) return;

  const cartoes = (STATE.cartoes && STATE.cartoes.length > 0)
    ? STATE.cartoes
    : (STATE.contas || []).filter(c => c.tipo === 'cartao');

  if (!cartoes || cartoes.length === 0) {
    container.innerHTML = `
      <div class="empty" style="padding:1.5rem">
        <i class="ti ti-credit-card-off"></i>
        <p style="margin:.5rem 0;color:var(--text2)">Nenhum cartão de crédito cadastrado.</p>
        <button class="btn btn-sm btn-primary" onclick="abrirModalGerirCartoes()"><i class="ti ti-plus"></i> Cadastrar Cartão</button>
      </div>`;
    return;
  }

  const infos = cartoes.map(obterInfoCartaoInteligente);
  infos.sort((a, b) => b.diasAtePagar - a.diasAtePagar);
  const melhor = infos[0];

  const html = `
    <div class="melhor-cartao-hero" style="border-left:4px solid ${melhor.cor}">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:8px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="background:${melhor.cor};width:14px;height:14px;border-radius:50%;display:inline-block;box-shadow:0 0 8px ${melhor.cor}66"></span>
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--text3)">Melhor Cartão para Comprar Hoje</div>
            <div style="font-size:17px;font-weight:800;color:var(--text)">${escHtml(melhor.nome)}</div>
          </div>
        </div>
        <div style="text-align:right">
          <span class="badge" style="background:rgba(16,185,129,.15);color:var(--good);font-weight:700;font-size:12px;padding:4px 10px;border-radius:20px">
            <i class="ti ti-sparkles"></i> ${melhor.diasAtePagar} dias até pagar
          </span>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(130px, 1fr));gap:10px;margin-top:12px;padding-top:10px;border-top:1px solid var(--border)">
        <div>
          <div class="metric-sub" style="font-size:10.5px">Limite Disponível</div>
          <div class="valor-sensivel" style="font-size:14px;font-weight:700;color:var(--good)">${toBRL(melhor.limiteDisponivel)}</div>
          <div class="metric-sub" style="font-size:10px">de ${toBRL(melhor.limiteTotal)} (${melhor.pctUsado}% usado)</div>
        </div>
        <div>
          <div class="metric-sub" style="font-size:10.5px">Fatura Atual</div>
          <div class="valor-sensivel" style="font-size:14px;font-weight:700;color:var(--bad)">${toBRL(melhor.totalFaturaAtual)}</div>
          <div class="metric-sub" style="font-size:10px">Fecha dia ${melhor.diaFechamento} · Vence dia ${melhor.diaVencimento}</div>
        </div>
        <div>
          <div class="metric-sub" style="font-size:10.5px">Compra hoje vence em</div>
          <div style="font-size:13.5px;font-weight:700;color:var(--accent)">
            ${melhor.vencCompraHoje.split('-').reverse().slice(0,2).join('/')}
          </div>
          <div class="metric-sub" style="font-size:10px">${melhor.diasAteFechamento === 0 ? 'Fatura fecha hoje!' : 'Fecha em ' + melhor.diasAteFechamento + ' dia(s)'}</div>
        </div>
      </div>
    </div>

    ${infos.length > 1 ? `
      <div style="margin-top:12px">
        <div style="font-size:11px;font-weight:700;color:var(--text3);text-transform:uppercase;letter-spacing:.04em;margin-bottom:6px">Outros Cartões</div>
        <div class="melhor-cartao-grid">
          ${infos.slice(1).map(c => `
            <div class="cartao-int-item" style="border-left:3px solid ${c.cor}">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <span style="font-weight:700;color:var(--text);font-size:12px">${escHtml(c.nome)}</span>
                <span style="font-size:11px;font-weight:600;color:var(--text2)">${c.diasAtePagar} dias até pagar</span>
              </div>
              <div style="display:flex;align-items:center;justify-content:space-between;margin-top:4px;font-size:11px;color:var(--text3)">
                <span>Disp: <strong class="valor-sensivel" style="color:var(--good)">${toBRL(c.limiteDisponivel)}</strong></span>
                <span>Fatura: <strong class="valor-sensivel" style="color:var(--bad)">${toBRL(c.totalFaturaAtual)}</strong></span>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    ` : ''}

    <div style="display:flex;justify-content:flex-end;margin-top:10px">
      <button class="btn btn-sm" onclick="abrirModalGerirCartoes()"><i class="ti ti-settings"></i> Gerenciar Cartões &amp; Limites</button>
    </div>
  `;
  container.innerHTML = html;
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
  await salvarDados();
  cancelarEdicaoCartaoInteligente();
  renderListaCartoesInteligentes();
  renderWidgetMelhorCartao();
  popularContasSelect();
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
    renderWidgetMelhorCartao();
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
  if (banner) {
    if (aVistaVence) {
      banner.style.background = 'rgba(16, 185, 129, 0.12)';
      banner.style.border = '1px solid rgba(16, 185, 129, 0.35)';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <i class="ti ti-cash" style="font-size:24px;color:var(--good)"></i>
          <div>
            <div style="font-weight:800;font-size:15px;color:var(--good)">Veredito: Pague no PIX / À Vista!</div>
            <div style="font-size:12.5px;color:var(--text);margin-top:2px">
              O desconto à vista de <strong>${descontoPct}% (${toBRL(descontoReais)})</strong> supera os rendimentos que você teria no Cofre (<strong>${toBRL(totalRendimentoAcumulado)}</strong>).
              Você garante um ganho líquido real de <strong class="valor-sensivel" style="color:var(--good)">${toBRL(diferenca)}</strong> no ato da compra.
            </div>
          </div>
        </div>
      `;
    } else {
      banner.style.background = 'rgba(26, 111, 224, 0.12)';
      banner.style.border = '1px solid rgba(26, 111, 224, 0.35)';
      banner.innerHTML = `
        <div style="display:flex;align-items:center;gap:10px">
          <i class="ti ti-credit-card" style="font-size:24px;color:var(--accent)"></i>
          <div>
            <div style="font-weight:800;font-size:15px;color:var(--accent)">Veredito: Parcele no Cartão e guarde o valor no Cofre!</div>
            <div style="font-size:12.5px;color:var(--text);margin-top:2px">
              Parcelando em <strong>${parcelas}x sem juros</strong> de <strong>${toBRL(valorParcela)}</strong> e deixando o montante rendendo a <strong>${(taxaMensal*100).toFixed(2)}% a.m.</strong>, você acumula <strong class="valor-sensivel" style="color:var(--accent)">${toBRL(totalRendimentoAcumulado)}</strong> de rendimento líquido, superando o desconto à vista em <strong class="valor-sensivel" style="color:var(--good)">${toBRL(diferenca)}</strong>!
            </div>
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
      <div class="empty" style="padding:1.25rem 1rem">
        <i class="ti ti-circle-check" style="color:var(--good);font-size:24px"></i>
        <p style="margin:.4rem 0;color:var(--text2)">Nenhum adiantamento ou reembolso pendente.</p>
        <span class="help-text">Todo o dinheiro na rua já foi recuperado!</span>
      </div>`;
    return;
  }

  listaEl.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:8px;max-height:260px;overflow-y:auto;padding-right:4px">
      ${pendentes.map(l => {
        const [a, m, d] = (l.data || '').split('-');
        const dataFmt = a ? `${d}/${m}/${a}` : l.data;
        return `
          <div class="reembolso-row" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;background:var(--surface2);border:1px solid var(--border2);border-radius:var(--radius)">
            <div style="min-width:0;flex:1">
              <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                <span style="font-weight:700;font-size:12.5px;color:var(--text)">${escHtml(l.descricao)}</span>
                <span class="reembolso-devedor-tag"><i class="ti ti-user"></i> ${escHtml(l.reembolsoDevedor || 'Terceiro')}</span>
              </div>
              <div style="font-size:11px;color:var(--text3);margin-top:2px">
                <span>${dataFmt}</span> · <span>${escHtml(l.conta || 'Conta')}</span>
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <span class="valor-sensivel" style="font-weight:800;font-size:13.5px;color:#F59E0B">${toBRL(l.valor)}</span>
              <button class="btn btn-sm" onclick="confirmarReembolso('${l.id}')" title="Confirmar recebimento do reembolso"><i class="ti ti-check"></i> Reembolsar</button>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
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
    const dadosSalvos = localStorage.getItem(STORAGE_KEY);
    if (dadosSalvos) {
      // Se já tem dados guardados no PC, carrega eles
      STATE = Object.assign(STATE, JSON.parse(dadosSalvos));
    }
    // Compatibilidade: contas salvas antes de existir "tipo" viram conta bancária normal
    (STATE.contas || []).forEach(c => { if (!c.tipo) c.tipo = 'conta'; });
    normalizarHierarquiaCategorias();
    if (!Array.isArray(STATE.cartoes)) STATE.cartoes = [];
    if (!Array.isArray(STATE.historicoPatrimonio)) STATE.historicoPatrimonio = [];
    sincronizarEstruturaCartoes();
    if (!STATE.regras) STATE.regras = [];
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
    if (STATE.config && STATE.config.oneDriveLink) {
      document.getElementById('sync-link').value = STATE.config.oneDriveLink;
    }
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
  STATE.config.oneDriveLink = document.getElementById('sync-link').value.trim();
  await salvarDados();
}

async function salvarDados() {
  if (window.__apagandoDados) return;
  try { 
    // Guarda tudo silenciosamente no armazenamento interno do app
    localStorage.setItem(STORAGE_KEY, JSON.stringify(STATE)); 
  } catch (e) { 
    console.error("Erro ao salvar:", e); 
    toast('Erro ao salvar no armazenamento local.', 'err'); 
  }
}

/* ================= NAVEGAÇÃO ================= */
const TITULOS = { dashboard:'Dashboard', lancamentos:'Lançamentos', cartoes:'Cartões & Faturas', recorrentes:'Assinaturas & Recorrentes', cofres:'Metas & Cofres', metas:'Metas & Cofres', dividas:'Dívidas & Terceiros', relatorios:'Relatórios', sync:'Sincronizar OneDrive', config:'Categorias & Contas' };
const PAGINAS_MAIS = new Set(['recorrentes', 'cofres', 'metas', 'dividas', 'relatorios', 'sync', 'config']);
function nav(page) {
  if (page === 'cofres') page = 'metas';
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
  if (page === 'dashboard') renderDashboard();
  if (page === 'lancamentos') renderLancamentos();
  if (page === 'cartoes') renderCartoes();
  if (page === 'recorrentes') renderRecorrentes();
  if (page === 'metas') renderMetas();
  if (page === 'dividas') renderDividas();
  if (page === 'relatorios') renderRelatorios();
  if (page === 'config') renderConfig();
  if (page === 'sync') atualizarStatusMs();
  fecharSidebarMobile();
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
  t.textContent = msg;
  t.className = 'toast show' + (tipo ? ' ' + tipo : '');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), tipo === 'err' ? 9000 : 3200);
}
function fecharModal(id) {
  const el = document.getElementById(id);
  if (el) el.classList.remove('show');
}
function abrirModal(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.classList.add('show');
  registrarEstadoInicialModal(el);
}
function registrarEstadoInicialModal(modalEl) {
  if (!modalEl) return;
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
  if (!modalEl || modalEl.id === 'modal-confirmacao') return false;
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
    if (typeof atualizarUIComprovante === 'function') atualizarUIComprovante();
    const wrapGarantia = document.getElementById('lanc-garantia-wrap');
    if (wrapGarantia) wrapGarantia.style.display = 'none';
    const wrapSplit = document.getElementById('lanc-split-wrap');
    if (wrapSplit) wrapSplit.style.display = 'none';
    const wrapRec = document.getElementById('lanc-recorrencia-wrap');
    if (wrapRec) wrapRec.style.display = 'none';
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
  if (!modal || !elTitulo || !elMsg || !btnOk || !btnCancel) return;

  elTitulo.textContent = titulo || 'Atenção';
  elMsg.textContent = mensagem || '';
  confirmCallbackAtivo = typeof callbackConfirmacao === 'function' ? callbackConfirmacao : null;

  btnOk.onclick = async () => {
    const fn = confirmCallbackAtivo;
    fecharConfirmacao();
    if (fn) await fn();
  };
  btnCancel.onclick = () => {
    fecharConfirmacao();
  };

  modal.classList.add('show');
  setTimeout(() => btnOk.focus(), 50);
}
function fecharConfirmacao() {
  const modal = document.getElementById('modal-confirmacao');
  const btnOk = document.getElementById('btn-confirm-ok');
  const btnCancel = document.getElementById('btn-confirm-cancel');
  if (modal) modal.classList.remove('show');
  if (btnOk) btnOk.onclick = null;
  if (btnCancel) btnCancel.onclick = null;
  confirmCallbackAtivo = null;
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
    if (typeof process !== 'undefined' && process.versions && process.versions.electron && typeof require === 'function') {
      const { ipcRenderer } = require('electron');
      const img = new Image();
      img.onload = () => {
        try {
          const canvas = document.createElement('canvas');
          canvas.width = 128;
          canvas.height = 128;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, 128, 128);
          const pngUrl = canvas.toDataURL('image/png');
          ipcRenderer.send('cofin:set-window-icon', pngUrl);
        } catch (e) {
          ipcRenderer.send('cofin:set-window-icon', src);
        }
      };
      img.onerror = () => {
        ipcRenderer.send('cofin:set-window-icon', src);
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
    if (l.data && l.data.slice(0, 7) === mesAtual && !l.ehTransferencia) {
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

let dashDragEl = null;
function aplicarLayoutDashboard() {
  const container = document.getElementById('dash-modular-container');
  if (!container) return;
  const ordem = (STATE.config && Array.isArray(STATE.config.layoutDashboard)) ? STATE.config.layoutDashboard : [];
  ordem.forEach(id => {
    const el = document.getElementById(id);
    if (el && el.parentElement === container) {
      container.appendChild(el);
    }
  });
  const kpiCont = document.getElementById('dash-kpis');
  if (kpiCont && STATE.config && Array.isArray(STATE.config.layoutDashboardKpis)) {
    STATE.config.layoutDashboardKpis.forEach(id => {
      const kEl = document.getElementById(id);
      if (kEl && kEl.parentElement === kpiCont) kpiCont.appendChild(kEl);
    });
  }
}
function inicializarDragDropDashboard() {
  const container = document.getElementById('dash-modular-container');
  if (!container || container.dataset.dndInit === '1') return;
  container.dataset.dndInit = '1';

  container.addEventListener('dragstart', (e) => {
    const alvo = e.target.closest('.dash-draggable');
    if (!alvo) return;
    dashDragEl = alvo;
    alvo.classList.add('dragging');
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try { e.dataTransfer.setData('text/plain', alvo.id); } catch (err) {}
    }
  });
  container.addEventListener('dragenter', (e) => {
    e.preventDefault();
    const alvo = e.target.closest('.dash-draggable');
    if (!alvo || !dashDragEl || alvo === dashDragEl || alvo.parentElement !== dashDragEl.parentElement) return;
    alvo.classList.add('drag-over');
  });
  container.addEventListener('dragover', (e) => {
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
  });
  container.addEventListener('dragleave', (e) => {
    const alvo = e.target.closest('.dash-draggable');
    if (alvo) alvo.classList.remove('drag-over');
  });
  container.addEventListener('drop', async (e) => {
    e.preventDefault();
    const alvo = e.target.closest('.dash-draggable');
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    if (!alvo || !dashDragEl || alvo === dashDragEl || alvo.parentElement !== dashDragEl.parentElement) return;
    const pai = alvo.parentElement;
    const filhos = [...pai.children];
    const idxOrigem = filhos.indexOf(dashDragEl);
    const idxAlvo = filhos.indexOf(alvo);
    if (idxOrigem < idxAlvo) pai.insertBefore(dashDragEl, alvo.nextSibling);
    else pai.insertBefore(dashDragEl, alvo);

    if (!STATE.config) STATE.config = {};
    if (pai.id === 'dash-modular-container') {
      STATE.config.layoutDashboard = [...pai.children].map(c => c.id).filter(Boolean);
    } else if (pai.id === 'dash-kpis') {
      STATE.config.layoutDashboardKpis = [...pai.children].map(c => c.id).filter(Boolean);
    }
    await salvarDados();
  });
  container.addEventListener('dragend', () => {
    if (dashDragEl) dashDragEl.classList.remove('dragging');
    container.querySelectorAll('.drag-over').forEach(el => el.classList.remove('drag-over'));
    dashDragEl = null;
  });
}

function renderDashboard() {
  migrarCofresParaMetas();
  const mesAtual = hojeLocalISO().slice(0, 7);
  let receitasMes = 0, despesasMes = 0, totalReceitas = 0, totalDespesas = 0;
  STATE.lancamentos.forEach(l => {
    if (l.ehMovimentoCofre) return;
    const mesLanc = mesCompetenciaLancamento(l);

    // Considera apenas transações até o mês atual (ignora parcelas e lançamentos de meses futuros)
    if (!mesLanc || mesLanc <= mesAtual) {
      if (l.tipo === 'receita') totalReceitas += l.valor;
      else totalDespesas += l.valor;
    }

    // Apenas transações da competência do mês atual
    if (mesLanc === mesAtual && !l.ehTransferencia) {
      if (l.tipo === 'receita') receitasMes += l.valor;
      else despesasMes += l.valor;
    }
  });
  const totalGuardadoMetas = calcularTotalGuardadoMetas();
  const patrimonioTotal = Math.round((totalReceitas - totalDespesas) * 100) / 100;
  const saldoDisponivel = Math.round((patrimonioTotal - totalGuardadoMetas) * 100) / 100;
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

  document.getElementById('dash-kpis').innerHTML = `
    <div class="metric m-info dash-draggable" id="kpi-saldo-total" draggable="true">
      <div class="metric-top"><div class="metric-label" title="Saldo Disponível">Saldo Disponível</div><div class="metric-icon mi-info"><i class="ti ti-wallet"></i></div></div>
      <div class="metric-value valor-sensivel ${saldoDisponivel>=0?'mv-ok':'mv-bad'} ${valSaldo.isLong?'metric-val-long':''}" title="${valSaldo.str}">${valSaldo.str}</div>
      <span class="text-muted text-sm" id="dash-saldo-exclui-metas" style="${totalGuardadoMetas > 0 ? '' : 'display:none'}">${totalGuardadoMetas > 0 ? 'Exclui ' + toBRL(totalGuardadoMetas) + ' guardados em Metas' : ''}</span>
      <div class="metric-sub" style="${totalGuardadoMetas > 0 ? 'display:none' : ''}">livre para uso diário</div>
    </div>
    <div class="metric m-info dash-draggable" id="kpi-patrimonio-total" draggable="true">
      <div class="metric-top"><div class="metric-label" title="Patrimônio Total">Patrimônio Total</div><div class="metric-icon mi-info"><i class="ti ti-pig-money"></i></div></div>
      <div class="metric-value valor-sensivel ${patrimonioTotal>=0?'mv-info':'mv-bad'} ${valPat.isLong?'metric-val-long':''}" title="${valPat.str}">${valPat.str}</div>
      <div class="metric-sub" title="${totalGuardadoMetas > 0 ? 'inclui ' + toBRL(totalGuardadoMetas) + ' retidos em Metas' : 'receitas − despesas (saldo global)'}">${totalGuardadoMetas > 0 ? 'inclui ' + toBRL(totalGuardadoMetas) + ' retidos em Metas' : 'receitas − despesas (saldo global)'}</div>
    </div>
    <div class="metric m-ok dash-draggable" id="kpi-receitas-mes" draggable="true">
      <div class="metric-top"><div class="metric-label" title="Receitas no mês">Receitas no mês</div><div class="metric-icon mi-ok"><i class="ti ti-trending-up"></i></div></div>
      <div class="metric-value valor-sensivel mv-ok ${valRec.isLong?'metric-val-long':''}" title="${valRec.str}">${valRec.str}</div>
      <div class="metric-sub">mês atual</div>
    </div>
    <div class="metric m-bad dash-draggable" id="kpi-despesas-mes" draggable="true">
      <div class="metric-top"><div class="metric-label" title="Despesas no mês">Despesas no mês</div><div class="metric-icon mi-bad"><i class="ti ti-trending-down"></i></div></div>
      <div class="metric-value valor-sensivel mv-bad ${valDesp.isLong?'metric-val-long':''}" title="${valDesp.str}">${valDesp.str}</div>
      <div class="metric-sub">mês atual</div>
    </div>
    <div class="metric ${resultadoMes>=0?'m-ok':'m-bad'} dash-draggable" id="kpi-resultado-mes" draggable="true">
      <div class="metric-top"><div class="metric-label" title="Resultado do mês">Resultado do mês</div><div class="metric-icon ${resultadoMes>=0?'mi-ok':'mi-bad'}"><i class="ti ti-scale"></i></div></div>
      <div class="metric-value valor-sensivel ${resultadoMes>=0?'mv-ok':'mv-bad'} ${valRes.isLong?'metric-val-long':''}" title="${valRes.str}">${valRes.str}</div>
      <div class="metric-sub">receitas - despesas</div>
    </div>
    <div class="metric ${taxaMesAtual>=20?'m-ok':taxaMesAtual>=0?'m-info':'m-bad'} dash-draggable" id="kpi-taxa-poupanca" draggable="true">
      <div class="metric-top"><div class="metric-label" title="Taxa de poupança">Taxa de poupança</div><div class="metric-icon ${taxaMesAtual>=20?'mi-ok':taxaMesAtual>=0?'mi-info':'mi-bad'}"><i class="ti ti-coin"></i></div></div>
      <div class="metric-value valor-sensivel ${classeTaxaPoupanca(taxaMesAtual)}" title="${valTaxa}">${valTaxa}</div>
      <div class="metric-sub" title="${taxaMesAtual === null ? 'sem receita neste mês' : 'mês anterior: ' + fmtPct(taxaMesAnterior) + ' · ref.: 20%'}">${taxaMesAtual === null ? 'sem receita neste mês' : 'mês anterior: ' + fmtPct(taxaMesAnterior) + ' · ref.: 20%'}</div>
    </div>`;
  aplicarLayoutDashboard();
  inicializarDragDropDashboard();

  // SMART INSIGHTS DINÂMICOS
  const insights = [];
  const hojeISO = hojeLocalISO();
  const em3DiasISO = hojeLocalISO(3);
  const listaCartoes = (STATE.cartoes && STATE.cartoes.length) ? STATE.cartoes : (STATE.contas || []).filter(c => c.tipo === 'cartao');
  listaCartoes.forEach(cartao => {
    // Agrupa todos os lançamentos não pagos deste cartão por fatura (ano-mes)
    const pendentes = (STATE.lancamentos || []).filter(l => l.conta === cartao.nome && l.tipo === 'despesa' && !estaPago(l));
    const porFatura = {};
    pendentes.forEach(l => {
      const comp = (l.faturaAno && l.faturaMes)
        ? { ano: l.faturaAno, mes: l.faturaMes }
        : competenciaFatura(l.dataCompra || l.data, cartao.diaFechamento || 1);
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
          texto: `Há ${toBRL(fat.total)} em aberto na fatura de ${vd}/${vm}. Lembre-se de quitar para evitar encargos.`
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
      texto: `Totalizando ${toBRL(somaVenc)} pendentes de pagamento no curto prazo.`
    });
  }
  if (taxaMesAtual !== null && taxaMesAtual >= 20) {
    insights.push({
      tipo: 'ok', icone: 'ti-Sparkles',
      titulo: `Excelente! Taxa de poupança em ${fmtPct(taxaMesAtual)}`,
      texto: `Você superou a meta recomendada de 20% neste mês, poupando ${toBRL(resultadoMes)}.`
    });
  } else if (!(STATE.config && STATE.config.modoViagem && STATE.config.modoViagem.ativo) && receitasMes > 0 && despesasMes > receitasMes) {
    insights.push({
      tipo: 'bad', icone: 'ti-alert-triangle',
      titulo: `Alerta: Despesas superaram as receitas no mês`,
      texto: `Os gastos deste mês estão ${toBRL(despesasMes - receitasMes)} acima das entradas registradas.`
    });
  } else if (!(STATE.config && STATE.config.modoViagem && STATE.config.modoViagem.ativo) && despesasMes > 0) {
    const mesPassadoKey = mesesDoisUltimos[0];
    const despMesPassado = STATE.lancamentos
      .filter(l => !l.ehTransferencia && l.tipo === 'despesa' && (l.data || '').slice(0, 7) === mesPassadoKey)
      .reduce((s, l) => s + l.valor, 0);
    if (despMesPassado > 0 && despesasMes > despMesPassado * 1.15) {
      const altaPct = (((despesasMes - despMesPassado) / despMesPassado) * 100).toFixed(0);
      insights.push({
        tipo: 'info', icone: 'ti-trending-up',
        titulo: `Gastos ${altaPct}% maiores que no mês anterior`,
        texto: `Neste mês você já registrou ${toBRL(despesasMes)} em despesas contra ${toBRL(despMesPassado)} no mês passado.`
      });
    }
  }
  const contInsights = document.getElementById('dash-insights');
  if (contInsights) {
    const exibidos = insights.slice(0, 2);
    contInsights.style.display = exibidos.length ? 'grid' : 'none';
    contInsights.innerHTML = exibidos.map(ins => `
      <div class="insight-card ins-${ins.tipo}">
        <div class="insight-icon"><i class="ti ${ins.icone.toLowerCase()}"></i></div>
        <div class="insight-body">
          <div class="insight-title">${ins.titulo}</div>
          <div class="insight-text">${ins.texto}</div>
        </div>
      </div>`).join('');
  }

  const meses = ultimosMeses(6);
  const somaPorMes = {};
  meses.forEach(m => somaPorMes[m] = { receita: 0, despesa: 0 });
  STATE.lancamentos.forEach(l => {
    if (l.ehTransferencia) return;
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
      return `<div class="pendente-row">
        <div class="pendente-info">
          <div class="pendente-desc">${l.descricao || '-'}${badgeParcelaHTML(l)}</div>
          <div class="pendente-meta">${dataFmt} · ${l.categoria || '-'}</div>
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <div class="pendente-valor ${l.tipo==='receita'?'mv-ok':'mv-bad'}">${l.tipo==='receita'?'+':'-'} ${toBRL(l.valor)}</div>
          <button class="btn btn-sm" onclick="togglePagamento('${l.id}')"><i class="ti ti-check"></i> Marcar como paga</button>
        </div>
      </div>`;
    }).join('') + (pendentes.length > 8 ? `<div class="help-text" style="margin-top:.5rem">+ ${pendentes.length - 8} outras pendências. Veja todas em Lançamentos, filtrando por status "Pendentes".</div>` : '');
  } else {
    cardPendentes.style.display = 'none';
  }

  const saldos = saldoPorConta();
  const contasBancarias = (STATE.contas || []).filter(c => c.tipo !== 'cartao');
  const nomesContas = [...new Set([...contasBancarias.map(c => c.nome), ...Object.keys(saldos)])];
  const cartoesDash = (STATE.contas || []).filter(c => c.tipo === 'cartao');

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

      const totalSaldosBancos = nomesContas.reduce((acc, nome) => acc + (saldos[nome] || 0), 0);
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
            <div class="pendente-row dash-conta-row">
              <div class="pendente-info">
                <div class="pendente-desc">
                  <i class="ti ti-building-bank" style="font-size:13px;color:var(--text3);margin-right:5px"></i>${escHtml(nome)}
                </div>
              </div>
              <div class="pendente-valor ${saldo >= 0 ? 'mv-ok' : 'mv-bad'}">${toBRL(saldo)}</div>
            </div>`;
        }).join('');
      }

      if (cartoesDash.length) {
        html += `
          <div class="dash-contas-secao" style="${nomesContas.length ? 'margin-top:14px;' : ''}">
            <div class="dash-contas-secao-titulo"><i class="ti ti-credit-card"></i> Cartões de Crédito</div>
          </div>`;

        html += cartoesDash.map(cartao => {
          const compAtual = competenciaFatura(hojeDashISO, cartao.diaFechamento || 1);
          const itensFatura = lancamentosDaFatura(cartao.nome, compAtual.ano, compAtual.mes);
          const totalFatura = itensFatura.reduce((s, l) => s + l.valor, 0);
          const temLimite = typeof cartao.limite === 'number' && cartao.limite > 0;
          const limite = temLimite ? cartao.limite : 0;
          const pendentesCartao = STATE.lancamentos.filter(l => l.conta === cartao.nome && l.tipo === 'despesa' && !estaPago(l));
          const totalPendente = pendentesCartao.reduce((s, l) => s + l.valor, 0);
          const disponivel = temLimite ? Math.max(0, limite - totalPendente) : 0;
          const pctUsado = (temLimite && limite > 0) ? Math.min(100, Math.max(0, (totalPendente / limite) * 100)) : 0;

          const venc = calcularVencimentoFatura(compAtual.ano, compAtual.mes, cartao.diaFechamento || 1, cartao.diaVencimento || 10);
          const [va, vm, vd] = (venc || '').split('-');
          const vencFmt = vd && vm ? `${vd}/${vm}` : (cartao.diaVencimento ? `dia ${cartao.diaVencimento}` : '');

          const corBarra = pctUsado >= 90 ? 'critico' : (pctUsado >= 70 ? 'aviso' : 'normal');
          const temMaisPendencias = totalPendente > totalFatura;

          const tooltipInfo = `Cartão ${cartao.nome} · Fatura atual: ${toBRL(totalFatura)}${temLimite ? ` | Limite disponível: ${toBRL(disponivel)} (Total: ${toBRL(limite)} - ${pctUsado.toFixed(0)}% utilizado)` : ''}${temMaisPendencias ? ` | Total comprometido a pagar: ${toBRL(totalPendente)}` : ''}`;

          return `
            <div class="pendente-row dash-cartao-row" onclick="nav('cartoes')" title="${escHtml(tooltipInfo)}">
              <div class="pendente-info">
                <div class="pendente-desc">
                  <i class="ti ti-credit-card" style="font-size:13px;color:${cartao.cor || 'var(--accent)'};margin-right:5px"></i>${escHtml(cartao.nome)}
                </div>
                <div class="pendente-meta">
                  <span>Fatura atual</span>
                  ${vencFmt ? `<span>·</span><span>Vence ${vencFmt}</span>` : ''}
                  ${cartao.diaFechamento ? `<span>·</span><span>Fecha dia ${cartao.diaFechamento}</span>` : ''}
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
}

/* ================= LANÇAMENTOS ================= */
function popularFiltros() {
  const meses = [...new Set(STATE.lancamentos.map(l => mesCompetenciaLancamento(l) || (l.data||'').slice(0,7)))].filter(Boolean).sort().reverse();
  const nomesMes = { '01':'Jan','02':'Fev','03':'Mar','04':'Abr','05':'Mai','06':'Jun','07':'Jul','08':'Ago','09':'Set','10':'Out','11':'Nov','12':'Dez' };
  const fMes = document.getElementById('f-mes');
  const atual = fMes.value;
  fMes.innerHTML = '<option value="">Todos os meses</option>' + meses.map(m => {
    const [a,mm] = m.split('-'); return `<option value="${m}">${nomesMes[mm]||mm}/${a}</option>`;
  }).join('');
  fMes.value = atual;
  const fCat = document.getElementById('f-categoria');
  const catAtual = fCat.value;
  normalizarHierarquiaCategorias();
  fCat.innerHTML = '<option value="">Todas as categorias</option>' + construirOptionsCategoriasHTML('', catAtual);
  fCat.value = [...fCat.options].some(o => o.value === catAtual) ? catAtual : '';
  const fTag = document.getElementById('f-tag');
  const tagAtual = fTag.value;
  fTag.innerHTML = '<option value="">Todas as tags</option>' + todasAsTags().map(t => `<option value="${t}">#${t}</option>`).join('');
  fTag.value = [...fTag.options].some(o => o.value === tagAtual) ? tagAtual : '';
}
function categoriaCorrespondeFiltro(catLanc, catFiltro) {
  if (!catFiltro) return true;
  if (catLanc === catFiltro) return true;
  if (catFiltro.includes(' -> ')) return catLanc === catFiltro;
  const parsed = extrairMacroESubcategoria(catLanc);
  return parsed.macro.toLowerCase() === catFiltro.toLowerCase();
}
function estaPago(l) { return l.pago !== false; }
function badgeStatusHTML(l, comClique) {
  const pago = estaPago(l);
  const onclick = comClique ? ` onclick="togglePagamento('${l.id}')" title="Clique para alternar"` : '';
  return `<span class="badge ${pago?'badge-pago':'badge-pendente'}${comClique?' badge-click':''}"${onclick}>${pago?'Pago':'Pendente'}</span>`;
}
function badgeParcelaHTML(l) {
  if (!l.parcelaTotal || l.parcelaTotal <= 1) return '';
  return `<span class="badge badge-parcela">${l.parcelaAtual}/${l.parcelaTotal}</span>`;
}
function badgeValorHTML(l) {
  if (l.ehTransferencia) return `<span class="badge badge-transfer"><i class="ti ti-transfer" style="font-size:10px"></i> ${toBRL(l.valor)}</span>`;
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
  return html;
}
function linhaLancamento(l) {
  const [a,m,d] = (l.data||'').split('-');
  const dataFmt = a ? `${d}/${m}/${a}` : '-';
  return `<tr>
    <td>${dataFmt}</td>
    <td>${formatarDescricaoComHashtags(l.descricao)}${badgeParcelaHTML(l)}${badgesTagsHTML(l)}${comprovanteIconHTML(l)}</td>
    <td><span class="badge badge-cat">${escHtml(formatarCategoriaExibicao(l.categoria))}</span></td>
    <td>${l.conta || '-'}</td>
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

  // Filtra lançamentos do mês de referência do calendário (respeitando demais filtros ativos)
  const tipo = document.getElementById('f-tipo').value;
  const cat = document.getElementById('f-categoria').value;
  const status = document.getElementById('f-status').value;
  const busca = document.getElementById('f-busca').value.toLowerCase();
  const tagFiltro = document.getElementById('f-tag').value;
  const doMes = STATE.lancamentos.filter(l =>
    (l.data || '').slice(0, 7) === calendarioMesRef &&
    (!tipo || l.tipo === tipo) &&
    categoriaCorrespondeFiltro(l.categoria, cat) &&
    (!status || (status === 'pago' ? estaPago(l) : !estaPago(l))) &&
    (!tagFiltro || lancamentoTemHashtag(l, tagFiltro)) &&
    (!busca || (l.descricao || '').toLowerCase().includes(busca))
  );

  const porDia = {};
  doMes.forEach(l => {
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
      const acao = l.ehTransferencia ? '' : `onclick="abrirModalLancamento('${l.id}')"`;
      return `<div class="cal-pill ${classe}" ${acao} title="${(l.descricao || '').replace(/"/g, '&quot;')} (${toBRL(l.valor)})">
        <span style="overflow:hidden;text-overflow:ellipsis">${l.descricao || '-'}</span>
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
function renderLancamentos() {
  popularFiltros();
  atualizarContagemLixeira();
  aplicarEstiloTabela(); // Aplica o estilo (Tabela/Cards) baseado na escolha salva
  const mes = document.getElementById('f-mes').value;
  const tipo = document.getElementById('f-tipo').value;
  const cat = document.getElementById('f-categoria').value;
  const status = document.getElementById('f-status').value;
  const busca = document.getElementById('f-busca').value.toLowerCase();
  const tagFiltro = document.getElementById('f-tag').value;
  let lista = STATE.lancamentos.filter(l =>
    (!mes || mesCompetenciaLancamento(l) === mes) &&
    (!tipo || l.tipo === tipo) &&
    categoriaCorrespondeFiltro(l.categoria, cat) &&
    (!status || (status === 'pago' ? estaPago(l) : !estaPago(l))) &&
    (!tagFiltro || lancamentoTemHashtag(l, tagFiltro)) &&
    (!busca || (l.descricao||'').toLowerCase().includes(busca))
  ).sort((a,b) => (b.data||'').localeCompare(a.data||''));

  const resumoTag = document.getElementById('tag-resumo');
  if (tagFiltro) {
    const gastos = lista.filter(l => l.tipo === 'despesa' && !l.ehTransferencia).reduce((s,l) => s + l.valor, 0);
    const entradas = lista.filter(l => l.tipo === 'receita' && !l.ehTransferencia).reduce((s,l) => s + l.valor, 0);
    const cats = gastosPorCategoria(lista).slice(0, 4).map(([c, v]) => `${c}: ${toBRL(v)}`).join(' · ');
    resumoTag.style.display = '';
    resumoTag.innerHTML = `<i class="ti ti-tag" style="flex-shrink:0"></i><div><strong>#${tagFiltro}</strong> — gasto total ${toBRL(gastos)}${entradas ? ` · entradas ${toBRL(entradas)}` : ''} · ${lista.length} lançamento(s)${cats ? `<br><span style="font-weight:400">Por categoria: ${cats}</span>` : ''}</div>`;
  } else {
    resumoTag.style.display = 'none';
  }

  const tbody = document.getElementById('lanc-tbody');
  const thead = document.getElementById('lanc-thead');
  const wrap = document.getElementById('lanc-table-wrap');
  if (wrap) wrap.classList.toggle('modo-conciliacao-ativo', modoConciliacaoAtivo);
  if (thead) {
    thead.innerHTML = modoConciliacaoAtivo
      ? `<tr><th><label style="display:inline-flex;align-items:center;gap:6px;cursor:pointer;margin:0"><input type="checkbox" id="concil-check-all" onchange="selecionarTodosConciliacao(this.checked)" title="Selecionar todos os pendentes do mês atual" style="width:15px;height:15px;accent-color:var(--accent)"> Data</label></th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Status</th><th style="text-align:right">Valor</th><th style="width:70px"></th></tr>`
      : `<tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Conta</th><th>Status</th><th style="text-align:right">Valor</th><th style="width:70px"></th></tr>`;
  }
  const mesAtualConcil = document.getElementById('f-mes').value || hojeLocalISO().slice(0, 7);
  document.getElementById('lanc-empty').style.display = lista.length ? 'none' : 'block';
  tbody.innerHTML = lista.map(l => {
    const [a,m,d] = (l.data||'').split('-');
    const dataFmt = a ? `${d}/${m}/${a}` : '-';
    const acoes = l.ehTransferencia
      ? `<button class="icon-btn danger" onclick="excluirTransferencia('${l.transferenciaGrupo}')" title="Excluir transferência"><i class="ti ti-trash"></i></button>`
      : `<button class="icon-btn" onclick="abrirModalLancamento('${l.id}')" title="Editar"><i class="ti ti-pencil"></i></button>
         <button class="icon-btn danger" onclick="excluirLancamento('${l.id}')" title="Excluir"><i class="ti ti-trash"></i></button>`;
    const elegivelConcil = !estaPago(l) && !l.ehTransferencia && mesCompetenciaLancamento(l) === mesAtualConcil;
    const selecionado = modoConciliacaoAtivo && elegivelConcil && conciliacaoSelecionados.has(l.id);
    const chkConcil = modoConciliacaoAtivo && elegivelConcil
      ? `<input type="checkbox" class="concil-chk" value="${l.id}" ${selecionado ? 'checked' : ''} style="width:15px;height:15px;accent-color:var(--accent);margin-right:6px;pointer-events:none;vertical-align:-2px">`
      : '';
    const classesTr = [
      modoConciliacaoAtivo ? (elegivelConcil ? 'concil-elegivel' : 'concil-inativo') : '',
      selecionado ? 'item-selecionado' : ''
    ].filter(Boolean).join(' ');
    const attrCliqueTr = modoConciliacaoAtivo && elegivelConcil
      ? ` onclick="clicarItemConciliacao('${l.id}', this, event)"`
      : '';
    const subCatsBadge = (l.subTransacoes && l.subTransacoes.length)
      ? ` <span class="badge badge-cat" title="${l.subTransacoes.map(s => s.categoria + ': ' + toBRL(s.valor)).join(' | ')}"><i class="ti ti-arrows-split-2"></i> ${l.subTransacoes.length} cats</span>`
      : '';
    return `<tr data-id="${l.id}"${classesTr ? ` class="${classesTr}"` : ''}${attrCliqueTr}>
      <td>${chkConcil}${dataFmt}</td>
      <td>${formatarDescricaoComHashtags(l.descricao)}${badgeParcelaHTML(l)}${subCatsBadge}${badgesTagsHTML(l)}${comprovanteIconHTML(l)}</td>
      <td><span class="badge badge-cat">${escHtml(formatarCategoriaExibicao(l.categoria))}</span></td>
      <td>${l.conta || '-'}</td>
      <td>${badgeStatusHTML(l, !l.ehTransferencia && !modoConciliacaoAtivo)}</td>
      <td style="text-align:right">${badgeValorHTML(l)}</td>
      <td class="concil-acoes" style="text-align:right;white-space:nowrap">${acoes}</td>
    </tr>`;
  }).join('');
  atualizarBarraConciliacao();
  if (STATE.config && STATE.config.viewModo === 'calendario') {
    renderCalendarioFinanceiro(lista);
  }
}

/* ---- Conciliação Rápida em Lote ---- */
let modoConciliacaoAtivo = false;
let conciliacaoSelecionados = new Set();
function alternarModoConciliacao() {
  modoConciliacaoAtivo = !modoConciliacaoAtivo;
  conciliacaoSelecionados.clear();
  const btn = document.getElementById('btn-modo-conciliacao');
  if (btn) {
    btn.classList.toggle('btn-primary', modoConciliacaoAtivo);
    btn.innerHTML = modoConciliacaoAtivo ? '<i class="ti ti-x"></i> Sair da Conciliação' : '<i class="ti ti-checks"></i> Modo Conciliação';
  }
  renderLancamentos();
}
function clicarItemConciliacao(id, trEl, ev) {
  if (!modoConciliacaoAtivo) return;
  if (ev) ev.stopPropagation();
  const novoEstado = !conciliacaoSelecionados.has(id);
  if (novoEstado) conciliacaoSelecionados.add(id);
  else conciliacaoSelecionados.delete(id);
  if (trEl) {
    trEl.classList.toggle('item-selecionado', novoEstado);
    const chk = trEl.querySelector('.concil-chk');
    if (chk) chk.checked = novoEstado;
  }
  const allChks = [...document.querySelectorAll('.concil-chk')];
  const masterChk = document.getElementById('concil-check-all');
  if (masterChk && allChks.length) {
    masterChk.checked = allChks.every(c => c.checked);
  }
  atualizarBarraConciliacao();
}
function selecionarTodosConciliacao(marcar) {
  document.querySelectorAll('.concil-chk').forEach(chk => {
    chk.checked = marcar;
    const tr = chk.closest('tr');
    if (tr) tr.classList.toggle('item-selecionado', marcar);
    if (marcar) conciliacaoSelecionados.add(chk.value);
    else conciliacaoSelecionados.delete(chk.value);
  });
  atualizarBarraConciliacao();
}
function atualizarBarraConciliacao() {
  const bar = document.getElementById('conciliacao-bar');
  const cont = document.getElementById('conciliacao-contador');
  if (!bar || !cont) return;
  const qtd = conciliacaoSelecionados.size;
  const soma = [...conciliacaoSelecionados].reduce((acc, id) => {
    const item = STATE.lancamentos.find(x => x.id === id);
    return acc + (item ? item.valor : 0);
  }, 0);
  cont.textContent = `${qtd} pendente(s) selecionado(s) · ${toBRL(soma)}`;
  bar.classList.toggle('show', modoConciliacaoAtivo);
}
async function marcarSelecionadosComoPagos() {
  if (!conciliacaoSelecionados.size) {
    toast('Selecione ao menos um lançamento pendente.', 'err');
    return;
  }
  let alterados = 0;
  STATE.lancamentos.forEach(l => {
    if (conciliacaoSelecionados.has(l.id) && !estaPago(l)) {
      l.pago = true;
      l.sincronizado = false;
      alterados++;
    }
  });
  conciliacaoSelecionados.clear();
  modoConciliacaoAtivo = false;
  const btn = document.getElementById('btn-modo-conciliacao');
  if (btn) {
    btn.classList.remove('btn-primary');
    btn.innerHTML = '<i class="ti ti-checks"></i> Modo Conciliação';
  }
  await salvarDados();
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  toast(`${alterados} lançamento(s) conciliado(s) como pagos!`, 'ok');
}
async function togglePagamento(id) {
  const l = STATE.lancamentos.find(x => x.id === id);
  if (!l) return;
  l.pago = !estaPago(l);
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
  document.getElementById('lanc-conta').innerHTML = STATE.contas.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');
}
function sugerirCategoriaPorRegra() {
  const descricao = document.getElementById('lanc-descricao').value;
  const categoriaSugerida = aplicarRegraCategorizacao(descricao);
  if (!categoriaSugerida) return;
  const sel = document.getElementById('lanc-categoria');
  if ([...sel.options].some(o => o.value === categoriaSugerida)) {
    sel.value = categoriaSugerida;
  }
}
function somarMeses(dataISO, n) {
  const [y, m, d] = dataISO.split('-').map(Number);
  const dt = new Date(y, (m - 1) + n, d);
  return dt.toISOString().slice(0, 10);
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
  return txt.replace(/#[\wÀ-ÿ]+/g, '<span class="hashtag" onclick="event.stopPropagation(); filtrarPorHashtag(\'$&\')">$&</span>');
}
function badgesTagsHTML(l) {
  const inlineSet = new Set(extrairHashtagsDescricao(l.descricao).map(t => t.toLowerCase()));
  return (l.tags || [])
    .filter(t => !inlineSet.has(t.toLowerCase()))
    .map(t => `<span class="hashtag" onclick="event.stopPropagation(); filtrarPorHashtag('#${t.replace(/'/g, "\\'")}')">#${t}</span>`)
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
  const reader = new FileReader();
  reader.onload = (e) => {
    const conteudo = String(e.target.result || '');
    let itens = [];
    if (nome.endsWith('.ofx') || conteudo.includes('<OFX') || conteudo.includes('<STMTTRN>')) {
      itens = parseExtratoOFX(conteudo);
    } else {
      itens = parseExtratoCSV(conteudo);
    }
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
  const s = String(str || '').trim().replace(/^["']|["']$/g, '');
  const mBR = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
  if (mBR) {
    const d = mBR[1].padStart(2, '0'), m = mBR[2].padStart(2, '0');
    let a = mBR[3];
    if (a.length === 2) a = '20' + a;
    return `${a}-${m}-${d}`;
  }
  const mISO = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})/);
  if (mISO) return `${mISO[1]}-${mISO[2].padStart(2, '0')}-${mISO[3].padStart(2, '0')}`;
  const mOFX = s.match(/^(\d{4})(\d{2})(\d{2})/);
  if (mOFX) return `${mOFX[1]}-${mOFX[2]}-${mOFX[3]}`;
  return '';
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
  const itens = [];
  const blocos = String(texto || '').match(/<STMTTRN>[\s\S]*?(?:<\/STMTTRN>|(?=<STMTTRN>|<\/BANKTRANLIST>|$))/gi) || [];
  blocos.forEach(bloco => {
    const mDt = bloco.match(/<DTPOSTED>\s*([0-9]{8})/i);
    const mVal = bloco.match(/<TRNAMT>\s*([+-]?[0-9.,]+)/i);
    const mMemo = bloco.match(/<MEMO>\s*([^\r\n<]+)/i);
    const mName = bloco.match(/<NAME>\s*([^\r\n<]+)/i);
    const mType = bloco.match(/<TRNTYPE>\s*([^\r\n<]+)/i);
    if (!mDt || !mVal) return;
    const dataISO = normalizarDataExtrato(mDt[1]);
    const valorBruto = parseValorExtrato(mVal[1]);
    if (!dataISO || isNaN(valorBruto) || valorBruto === 0) return;
    const descricao = ((mMemo && mMemo[1]) || (mName && mName[1]) || 'Transação OFX').trim();
    const trnType = mType ? mType[1].trim().toUpperCase() : '';
    const tipo = (valorBruto < 0 || trnType === 'DEBIT' || trnType === 'PAYMENT') ? 'despesa' : 'receita';
    const valor = Math.abs(valorBruto);
    itens.push({
      data: dataISO,
      descricao,
      valor,
      tipo,
      categoria: sugerirCategoriaExtrato(descricao, tipo)
    });
  });
  return itens;
}
function abrirModalRevisaoExtrato(itens) {
  itensExtratoEmRevisao = itens.map(it => ({ ...it }));
  const selConta = document.getElementById('extrato-rev-conta');
  if (selConta) {
    selConta.innerHTML = STATE.contas.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');
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
      <div style="min-width:0"><input type="text" value="${(it.descricao || '').replace(/"/g, '&quot;')}" oninput="itensExtratoEmRevisao[${idx}].descricao = this.value" style="padding:5px 8px;font-size:12px"></div>
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
      data: it.data || hojeLocalISO(),
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
  if (l.comprovante) {
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
  document.getElementById('lanc-data').value = l ? l.data : hojeLocalISO();
  document.getElementById('lanc-descricao').value = l ? l.descricao : '';
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
  document.getElementById('lanc-valor').value = l ? toBRL(l.valor).replace('R$','R$ ') : '';
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
  // Parcelas só fazem sentido ao criar um lançamento novo (edição mexe em 1 parcela por vez)
  const parcelasSelect = document.getElementById('lanc-parcelas');
  const parcelasObs = document.getElementById('lanc-parcelas-obs');
  parcelasSelect.value = '1';
  if (l) {
    parcelasSelect.disabled = true;
    parcelasObs.style.display = '';
  } else {
    parcelasSelect.disabled = false;
    parcelasObs.style.display = 'none';
  }
  document.getElementById('lanc-valor-hint').textContent = '';
  abrirModal('modal-lancamento');
}
async function salvarLancamento() {
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
      subTransacoes.forEach((sub, idxSub) => {
        STATE.lancamentos.push({
          id: uid(), parentId, tipo, data,
          descricao: `${descricao} [${formatarCategoriaExibicao(sub.categoria)}]`,
          categoria: sub.categoria, conta, valor: sub.valor,
          origem: 'manual', sincronizado: false, pago, tags,
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
    fecharModal('modal-lancamento');
    renderPaginaAtiva();
    sincronizarEmSegundoPlano();
    toast(racharAtivo ? `Despesa dividida e receita pendente de ${toBRL(valorRachar)} gerada!` : `Lançamento dividido em ${subTransacoes.length} categorias salvo!`, 'ok');
    return;
  }

  if (id) {
    // Edição: mexe só nesse lançamento (mantém o grupo de parcelas, se houver)
    const idx = STATE.lancamentos.findIndex(x => x.id === id);
    const anterior = idx >= 0 ? STATE.lancamentos[idx] : (lancEmEdicao && lancEmEdicao.id === id ? lancEmEdicao : { id });
    const editado = {
      ...anterior,
      tipo, data, descricao, categoria, conta, valor: valorTotal, pago,
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
      let dataParcela = somarMeses(data, i - 1);
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
        dataParcela = dataVencimentoFatura;
      }

      STATE.lancamentos.push({
        id: uid(), tipo, data: dataParcela,
        dataCompra: data,
        descricao: `${descricao} (${i}/${parcelas})`,
        categoria, conta, valor: centavos / 100,
        origem: 'manual', sincronizado: false,
        parcelaGrupo: grupoId, parcelaAtual: i, parcelaTotal: parcelas,
        faturaAno, faturaMes, dataVencimentoFatura,
        pago: false,
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
    let dataLancamento = data;
    let faturaAno = undefined;
    let faturaMes = undefined;
    let dataVencimentoFatura = undefined;
    if (cartaoConta) {
      const comp = competenciaFatura(data, cartaoConta.diaFechamento || 1);
      faturaAno = comp.ano;
      faturaMes = comp.mes;
      dataVencimentoFatura = calcularVencimentoFatura(comp.ano, comp.mes, cartaoConta.diaFechamento || 1, cartaoConta.diaVencimento || 10);
      dataLancamento = dataVencimentoFatura;
    }

    STATE.lancamentos.push({
      id: uid(), tipo, data: dataLancamento,
      dataCompra: data,
      descricao, categoria, conta, valor: valorTotal,
      origem: 'manual', sincronizado: false,
      faturaAno, faturaMes, dataVencimentoFatura,
      pago, tags,
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
  await salvarDados();
  fecharModal('modal-lancamento');
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  if (racharAtivo) {
    toast(`Despesa salva e Receita Pendente de ${toBRL(valorRachar)} criada!`, 'ok');
  } else if (parcelas <= 1) {
    toast('Lançamento salvo.', 'ok');
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
  STATE.lancamentos = STATE.lancamentos.filter(x => x.id !== id);
  const entradaId = registrarExclusao([l], l.descricao || 'Lançamento');
  await salvarDados();
  renderPaginaAtiva(); atualizarContagemLixeira();
  sincronizarEmSegundoPlano();
  toastDesfazer(`"${l.descricao || 'Lançamento'}" excluído.`, entradaId);
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

  const grupoId = uid();
  STATE.lancamentos.push({
    id: uid(), tipo: 'despesa', data, descricao: `${descricao} → ${destino}`,
    categoria: 'Transferência', conta: origem, valor,
    origem: 'manual', sincronizado: false, pago: true,
    ehTransferencia: true, transferenciaGrupo: grupoId, transferenciaContraparte: destino
  });
  STATE.lancamentos.push({
    id: uid(), tipo: 'receita', data, descricao: `${descricao} ← ${origem}`,
    categoria: 'Transferência', conta: destino, valor,
    origem: 'manual', sincronizado: false, pago: true,
    ehTransferencia: true, transferenciaGrupo: grupoId, transferenciaContraparte: origem
  });
  await salvarDados();
  fecharModal('modal-transferencia');
  renderPaginaAtiva();
  sincronizarEmSegundoPlano();
  toast(`${toBRL(valor)} transferido de ${origem} para ${destino}.`, 'ok');
}
async function excluirTransferencia(grupoId) {
  const itens = STATE.lancamentos.filter(l => l.transferenciaGrupo === grupoId);
  if (!itens.length) return;
  const movCofre = itens.find(l => l.ehMovimentoCofre && l.metaId);
  if (movCofre) {
    const meta = (STATE.metas || []).find(m => m.id === movCofre.metaId);
    if (meta) {
      const delta = movCofre.tipo === 'despesa' ? -movCofre.valor : movCofre.valor;
      meta.valorAtual = Math.max(0, Math.round(((Number(meta.valorAtual) || 0) + delta) * 100) / 100);
    }
  }
  STATE.lancamentos = STATE.lancamentos.filter(l => l.transferenciaGrupo !== grupoId);
  const entradaId = registrarExclusao(itens, itens[0].descricao || 'Transferência');
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
      return `<span class="tag"><i class="ti ti-credit-card" style="opacity:.6"></i> ${c.nome} <span class="badge badge-cat" style="margin-left:4px">${info}</span>
        <button onclick="editarConta(${i})" title="Editar"><i class="ti ti-pencil"></i></button>
        <button onclick="removerConta(${i})" title="Remover"><i class="ti ti-x"></i></button></span>`;
    }
    const saldo = saldos[c.nome] || 0;
    return `<span class="tag">${c.nome} <span class="badge ${saldo>=0?'badge-pago':'badge-pendente'}" style="margin-left:4px">${toBRL(saldo)}</span>
      <button onclick="editarConta(${i})" title="Editar"><i class="ti ti-pencil"></i></button>
      <button onclick="removerConta(${i})" title="Remover"><i class="ti ti-x"></i></button></span>`;
  }).join('') || '<span class="help-text">Nenhuma conta.</span>';

  const selRegra = document.getElementById('regra-categoria');
  selRegra.innerHTML = construirOptionsCategoriasHTML('', selRegra.value);
  document.getElementById('regra-list').innerHTML = (STATE.regras || []).map((r,i) =>
    `<span class="tag">"${r.palavraChave}" → ${formatarCategoriaExibicao(r.categoria)}<button onclick="removerRegra(${i})"><i class="ti ti-x"></i></button></span>`).join('') || '<span class="help-text">Nenhuma regra cadastrada.</span>';
  atualizarSegurancaUI();
  atualizarUIModoViagem();
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
    const nomeAntigo = STATE.contas[idxEdicao].nome;
    STATE.contas[idxEdicao] = dados;
    if (nomeAntigo !== nome) {
      // Renomear precisa acompanhar tudo que referencia essa conta pelo nome
      STATE.lancamentos.forEach(l => { if (l.conta === nomeAntigo) l.conta = nome; });
      (STATE.recorrentes || []).forEach(r => { if (r.conta === nomeAntigo) r.conta = nome; });
    }
  } else {
    STATE.contas.push(dados);
  }
  cancelarEdicaoConta();
  await salvarDados(); renderConfig();
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
  const categoria = document.getElementById('regra-categoria').value;
  if (!palavraChave || !categoria) return;
  STATE.regras.push({ id: uid(), palavraChave, categoria });
  document.getElementById('regra-palavra').value = '';
  await salvarDados(); renderConfig();
}
async function removerRegra(idx) {
  STATE.regras.splice(idx, 1);
  await salvarDados(); renderConfig();
}
function aplicarRegraCategorizacao(descricao) {
  if (!descricao) return null;
  const desc = descricao.toLowerCase();
  const regra = (STATE.regras || []).find(r => desc.includes(r.palavraChave.toLowerCase()));
  return regra ? regra.categoria : null;
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
  document.getElementById('rec-conta').innerHTML = STATE.contas.map(c => `<option value="${c.nome}">${c.nome}</option>`).join('');
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
      <td>${r.nome}</td>
      <td><span class="badge badge-cat">${r.categoria || '-'}</span></td>
      <td>${r.conta || '-'}</td>
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

/* ================= CÁLCULOS COMPARTILHADOS ================= */
function renderPaginaAtiva() {
  const ativo = document.querySelector('.nav-item.active');
  const pagina = ativo ? ativo.getAttribute('data-page') : 'dashboard';
  if (pagina === 'lancamentos') renderLancamentos();
  else if (pagina === 'cartoes') renderCartoes();
  else if (pagina === 'recorrentes') renderRecorrentes();
  else if (pagina === 'cofres') renderCofres();
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
    if (l.ehTransferencia || mesCompetenciaLancamento(l) !== mesKey) return;
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
function saldoPorConta() {
  const saldos = {};
  STATE.contas.filter(c => c.tipo !== 'cartao').forEach(c => { saldos[c.nome] = 0; });
  STATE.lancamentos.forEach(l => {
    if (l.ehMovimentoCofre) return; // retenção em Metas/Cofres já é isolada no Saldo Disponível
    if (!estaPago(l)) return; // só o que já efetivamente entrou/saiu da conta
    if (!(l.conta in saldos)) return; // conta apagada ou é cartão — não entra no saldo
    saldos[l.conta] += (l.tipo === 'receita' ? 1 : -1) * l.valor;
  });
  return saldos;
}
function lancamentosDaFatura(nomeCartao, ano, mes) {
  const cartao = STATE.contas.find(c => c.nome === nomeCartao && c.tipo === 'cartao') || (STATE.cartoes || []).find(c => c.nome === nomeCartao);
  if (!cartao) return [];
  return STATE.lancamentos.filter(l => {
    if (l.conta !== nomeCartao || l.tipo !== 'despesa') return false;
    if (l.faturaAno && l.faturaMes) {
      return l.faturaAno === ano && l.faturaMes === mes;
    }
    const comp = competenciaFatura(l.dataCompra || l.data, cartao.diaFechamento);
    return comp.ano === ano && comp.mes === mes;
  });
}
function gastosPorMacroESubcategoria(lista) {
  const somaMacro = {};
  const subMap = {};
  lista.filter(l => l.tipo === 'despesa' && !l.ehTransferencia && !(l.ehReembolsavel && l.reembolsado)).forEach(l => {
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
    .filter(l => !l.ehMovimentoCofre);
  let acumulado = baseLancs
    .filter(l => estaPago(l) && mesCompetenciaLancamento(l) < primeiroMes)
    .reduce((s,l) => s + (l.tipo === 'receita' ? 1 : -1) * l.valor, 0);
  return meses.map(m => {
    const doMes = baseLancs.filter(l => estaPago(l) && mesCompetenciaLancamento(l) === m);
    acumulado += doMes.reduce((s,l) => s + (l.tipo === 'receita' ? 1 : -1) * l.valor, 0);
    return { mes: m, saldo: acumulado };
  });
}

/* ================= CARTÕES & FATURAS ================= */
let estadoFaturaCartao = {};
function navegarFatura(nomeCartao, delta) {
  estadoFaturaCartao[nomeCartao] = (estadoFaturaCartao[nomeCartao] || 0) + delta;
  renderCartoes();
}
function pagarFaturaInteira(nomeCartao, ano, mes) {
  const itens = lancamentosDaFatura(nomeCartao, ano, mes).filter(l => !estaPago(l));
  if (!itens.length) return;
  abrirConfirmacao(`Marcar ${itens.length} lançamento(s) dessa fatura como pagos?`, async () => {
    itens.forEach(l => { l.pago = true; l.sincronizado = false; });
    await salvarDados();
    renderPaginaAtiva();
    sincronizarEmSegundoPlano();
    toast('Fatura marcada como paga.', 'ok');
  }, 'Pagar fatura');
}
function renderCartoes() {
  const cartoes = STATE.contas.filter(c => c.tipo === 'cartao');
  document.getElementById('cartoes-empty').style.display = cartoes.length ? 'none' : 'block';
  document.getElementById('cartoes-content').innerHTML = cartoes.map(cartao => {
    const offset = estadoFaturaCartao[cartao.nome] || 0;
    const hoje = new Date();
    const compAtual = competenciaFatura(hojeLocalISO(), cartao.diaFechamento);
    let ano = compAtual.ano, mes = compAtual.mes + offset;
    while (mes > 12) { mes -= 12; ano++; }
    while (mes < 1) { mes += 12; ano--; }
    const itens = lancamentosDaFatura(cartao.nome, ano, mes).sort((a,b) => (a.data||'').localeCompare(b.data||''));
    const total = itens.reduce((s,l) => s+l.valor, 0);
    const vencimento = calcularVencimentoFatura(ano, mes, cartao.diaFechamento, cartao.diaVencimento);
    const [va,vm,vd] = vencimento.split('-');
    const nomesMes = { 1:'Jan',2:'Fev',3:'Mar',4:'Abr',5:'Mai',6:'Jun',7:'Jul',8:'Ago',9:'Set',10:'Out',11:'Nov',12:'Dez' };
    const usoLimite = cartao.limite ? Math.min(100, (total / cartao.limite) * 100) : null;
    return `
    <div class="card">
      <div class="card-header">
        <div style="display:flex;align-items:center;gap:8px">
          <i class="ti ti-credit-card" style="font-size:18px;color:var(--accent)"></i>
          <div class="card-title" style="font-size:13.5px;color:var(--text)">${cartao.nome}</div>
        </div>
        <div style="display:flex;align-items:center;gap:6px">
          <button class="icon-btn" onclick="navegarFatura('${cartao.nome}', -1)" title="Fatura anterior"><i class="ti ti-chevron-left"></i></button>
          <span style="font-size:12.5px;font-weight:600;min-width:90px;text-align:center">${nomesMes[mes]}/${ano}</span>
          <button class="icon-btn" onclick="navegarFatura('${cartao.nome}', 1)" title="Próxima fatura"><i class="ti ti-chevron-right"></i></button>
          ${itens.some(l=>!estaPago(l)) ? `<button class="btn btn-sm" style="margin-left:6px" onclick="pagarFaturaInteira('${cartao.nome}', ${ano}, ${mes})"><i class="ti ti-checks"></i> Pagar fatura</button>` : ''}
        </div>
      </div>
      <div class="grid4" style="margin-bottom:1rem">
        <div class="metric"><div class="metric-label">Total da fatura</div><div class="metric-value mv-bad">${toBRL(total)}</div><div class="metric-sub">${itens.length} lançamento(s)</div></div>
        <div class="metric"><div class="metric-label">Vencimento</div><div class="metric-value mv-info" style="font-size:18px">${vd}/${vm}</div><div class="metric-sub">fecha dia ${cartao.diaFechamento}</div></div>
        <div class="metric"><div class="metric-label">Pendente de pagamento</div><div class="metric-value ${itens.some(l=>!estaPago(l))?'mv-bad':'mv-ok'}">${itens.filter(l=>!estaPago(l)).length}</div><div class="metric-sub">de ${itens.length} itens</div></div>
        <div class="metric"><div class="metric-label">${cartao.limite ? 'Limite usado' : 'Limite'}</div>${cartao.limite ? `<div class="metric-value ${usoLimite>=90?'mv-bad':'mv-info'}">${usoLimite.toFixed(0)}%</div><div class="metric-sub">${toBRL(total)} de ${toBRL(cartao.limite)}</div>` : `<div class="metric-value mv-info" style="font-size:13px">Não definido</div><div class="metric-sub">configure em Categorias &amp; Contas</div>`}</div>
      </div>
      <div class="table-wrap">
        <table><thead><tr><th>Data</th><th>Descrição</th><th>Categoria</th><th>Status</th><th style="text-align:right">Valor</th></tr></thead><tbody>
          ${itens.length ? itens.map(l => {
            const [a,m,d] = (l.data||'').split('-');
            return `<tr><td>${d}/${m}/${a}</td><td>${l.descricao||'-'}${badgeParcelaHTML(l)}</td><td><span class="badge badge-cat">${l.categoria||'-'}</span></td><td>${badgeStatusHTML(l, true)}</td><td style="text-align:right">${toBRL(l.valor)}</td></tr>`;
          }).join('') : `<tr><td colspan="5" style="text-align:center;color:var(--text3);padding:1.5rem 0">Nenhum lançamento nessa fatura.</td></tr>`}
        </tbody></table>
      </div>
    </div>`;
  }).join('');
}

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
  const mesLimite = mesAnoLimite || hojeLocalISO().slice(0, 7);
  let totalReceitas = 0, totalDespesas = 0;
  STATE.lancamentos.forEach(l => {
    if (l.ehMovimentoCofre) return;
    const mesLanc = mesCompetenciaLancamento(l);
    if (mesLanc && mesLanc > mesLimite) return; // Ignora parcelas e compras de meses futuros
    if (l.tipo === 'receita') totalReceitas += (Number(l.valor) || 0);
    else totalDespesas += (Number(l.valor) || 0);
  });
  const saldoTotal = Math.round((totalReceitas - totalDespesas) * 100) / 100;
  const totalAlocado = calcularTotalGuardadoMetas();
  return {
    totalReceitas: Math.round(totalReceitas * 100) / 100,
    totalDespesas: Math.round(totalDespesas * 100) / 100,
    saldoTotal,
    patrimonioTotal: saldoTotal,
    totalAlocado,
    saldoDisponivel: Math.round((saldoTotal - totalAlocado) * 100) / 100
  };
}
function atualizarSaldos() {
  renderDashboard();
  if (document.getElementById('page-metas')?.classList.contains('active')) renderMetas();
  if (document.getElementById('page-lancamentos')?.classList.contains('active')) renderLancamentos();
}
function renderCofres() {
  if (!STATE.cofres) STATE.cofres = [];
  const lista = STATE.cofres;
  const { saldoTotal, totalAlocado, saldoDisponivel } = calcularSaldoDisponivelGeral();
  const totalObjetivos = lista.reduce((s, c) => s + (Number(c.objetivo) || 0), 0);

  const kpisEl = document.getElementById('cofres-kpis');
  if (kpisEl) {
    kpisEl.innerHTML = `
      <div class="metric m-info">
        <div class="metric-top"><div class="metric-label">Saldo Disponível</div><div class="metric-icon mi-info"><i class="ti ti-wallet"></i></div></div>
        <div class="metric-value ${saldoDisponivel>=0?'mv-ok':'mv-bad'}">${toBRL(saldoDisponivel)}</div>
        <div class="metric-sub">livre para uso diário</div>
      </div>
      <div class="metric m-ok">
        <div class="metric-top"><div class="metric-label">Total nos Cofres</div><div class="metric-icon mi-ok"><i class="ti ti-pig-money"></i></div></div>
        <div class="metric-value mv-ok">${toBRL(totalAlocado)}</div>
        <div class="metric-sub">${lista.length} cofre(s) ativo(s)</div>
      </div>
      <div class="metric m-info">
        <div class="metric-top"><div class="metric-label">Patrimônio Total</div><div class="metric-icon mi-info"><i class="ti ti-building-bank"></i></div></div>
        <div class="metric-value ${saldoTotal>=0?'mv-info':'mv-bad'}">${toBRL(saldoTotal)}</div>
        <div class="metric-sub">disponível + cofres</div>
      </div>
      <div class="metric m-warn">
        <div class="metric-top"><div class="metric-label">Soma dos Objetivos</div><div class="metric-icon mi-warn"><i class="ti ti-target-arrow"></i></div></div>
        <div class="metric-value mv-info">${toBRL(totalObjetivos)}</div>
        <div class="metric-sub">${totalObjetivos > 0 ? Math.min(100, (totalAlocado / totalObjetivos) * 100).toFixed(0) + '% alcançado no geral' : 'sem meta global'}</div>
      </div>`;
  }

  const emptyEl = document.getElementById('cofres-empty');
  const contEl = document.getElementById('cofres-lista');
  if (emptyEl) emptyEl.style.display = lista.length ? 'none' : 'block';
  if (!contEl) return;

  contEl.innerHTML = lista.map(c => {
    const alocado = Number(c.saldoAlocado) || 0;
    const obj = Number(c.objetivo) || 0;
    const pct = obj > 0 ? Math.min(100, (alocado / obj) * 100) : 0;
    const cor = c.cor || '#1A6FE0';
    const icone = c.icone || 'ti-pig-money';
    return `
      <div class="vault-card">
        <div class="vault-card-bar" style="background:${cor}"></div>
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div style="display:flex;align-items:center;gap:10px;min-width:0">
            <div class="vault-icon" style="background:${cor}"><i class="ti ${icone}"></i></div>
            <div style="min-width:0">
              <div style="font-size:14px;font-weight:700;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escHtml(c.nome)}</div>
              <div class="help-text" style="margin:0">${obj > 0 ? `Objetivo: ${toBRL(obj)} (${pct.toFixed(0)}%)` : 'Sem meta fixa'}</div>
            </div>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <button class="icon-btn" onclick="editarCofre('${c.id}')" title="Editar Cofre"><i class="ti ti-pencil"></i></button>
            <button class="icon-btn danger" onclick="removerCofre('${c.id}')" title="Excluir Cofre"><i class="ti ti-trash"></i></button>
          </div>
        </div>
        <div>
          <div style="font-size:11px;text-transform:uppercase;letter-spacing:.05em;color:var(--text3);font-weight:700">Saldo Alocado</div>
          <div style="font-size:22px;font-weight:800;color:var(--text);letter-spacing:-.02em">${toBRL(alocado)}</div>
        </div>
        <div class="vault-progress-track">
          <div class="vault-progress-fill" style="width:${pct}%;background:${cor}"></div>
        </div>
        <div style="display:flex;gap:8px;margin-top:2px">
          <button class="btn btn-primary btn-sm" style="flex:1;justify-content:center" onclick="guardarNoCofre('${c.id}')"><i class="ti ti-arrow-down-circle"></i> Guardar</button>
          <button class="btn btn-sm" style="flex:1;justify-content:center" onclick="resgatarDoCofre('${c.id}')" ${alocado <= 0 ? 'disabled' : ''}><i class="ti ti-arrow-up-circle"></i> Resgatar</button>
        </div>
      </div>`;
  }).join('');
}
async function salvarCofre() {
  if (!STATE.cofres) STATE.cofres = [];
  const id = document.getElementById('cofre-id').value;
  const nome = document.getElementById('cofre-nome').value.trim();
  const objetivo = moedaToNumber(document.getElementById('cofre-objetivo').value);
  const estilo = (document.getElementById('cofre-estilo').value || 'ti-pig-money|#1A6FE0').split('|');
  const icone = estilo[0] || 'ti-pig-money';
  const cor = estilo[1] || '#1A6FE0';
  if (!nome) { toast('Informe o nome do cofre.', 'err'); return; }

  if (id) {
    const c = STATE.cofres.find(x => x.id === id);
    if (c) Object.assign(c, { nome, objetivo, icone, cor });
  } else {
    STATE.cofres.push({ id: uid(), nome, icone, cor, objetivo: objetivo || 0, saldoAlocado: 0 });
  }
  cancelarEdicaoCofre();
  await salvarDados();
  renderCofres();
  renderDashboard();
  toast(id ? 'Cofre atualizado.' : 'Cofre criado com sucesso!', 'ok');
}
function editarCofre(id) {
  const c = (STATE.cofres || []).find(x => x.id === id);
  if (!c) return;
  document.getElementById('cofre-id').value = c.id;
  document.getElementById('cofre-nome').value = c.nome;
  document.getElementById('cofre-objetivo').value = c.objetivo ? toBRL(c.objetivo).replace('R$', 'R$ ') : '';
  const selEstilo = document.getElementById('cofre-estilo');
  const chaveEstilo = `${c.icone || 'ti-pig-money'}|${c.cor || '#1A6FE0'}`;
  if ([...selEstilo.options].some(o => o.value === chaveEstilo)) selEstilo.value = chaveEstilo;
  document.getElementById('cofre-form-title').textContent = 'Editando Cofre: ' + c.nome;
  document.getElementById('cofre-submit-btn').innerHTML = '<i class="ti ti-device-floppy"></i> Salvar alterações';
  document.getElementById('cofre-cancelar-btn').style.display = '';
  focarCampoCriacao('cofre-nome');
}
function cancelarEdicaoCofre() {
  document.getElementById('cofre-id').value = '';
  document.getElementById('cofre-nome').value = '';
  document.getElementById('cofre-objetivo').value = '';
  document.getElementById('cofre-form-title').textContent = 'Novo Cofre / Caixinha';
  document.getElementById('cofre-submit-btn').innerHTML = '<i class="ti ti-plus"></i> Criar Cofre';
  document.getElementById('cofre-cancelar-btn').style.display = 'none';
}
function removerCofre(id) {
  const c = (STATE.cofres || []).find(x => x.id === id);
  if (!c) return;
  const msg = c.saldoAlocado > 0
    ? `Remover o cofre "${c.nome}"? Os ${toBRL(c.saldoAlocado)} guardados nele voltarão automaticamente para o seu Saldo Disponível.`
    : `Remover o cofre "${c.nome}"?`;
  abrirConfirmacao(msg, async () => {
    STATE.cofres = (STATE.cofres || []).filter(x => x.id !== id);
    await salvarDados();
    renderCofres();
    renderDashboard();
    toast('Cofre removido e saldo liberado.', 'ok');
  }, 'Remover Cofre');
}
async function guardarNoCofre(id) {
  const c = (STATE.cofres || []).find(x => x.id === id);
  if (!c) return;
  const { saldoDisponivel } = calcularSaldoDisponivelGeral();
  const resp = await pedirValor(`Guardar no cofre "${c.nome}" (Disponível: ${toBRL(saldoDisponivel)})`);
  if (resp === null) return;
  const valor = moedaToNumber(resp);
  if (!valor || valor <= 0) { toast('Informe um valor válido maior que zero.', 'err'); return; }
  c.saldoAlocado = Math.round(((Number(c.saldoAlocado) || 0) + valor) * 100) / 100;
  await salvarDados();
  renderCofres();
  renderDashboard();
  toast(`${toBRL(valor)} guardado em "${c.nome}"!`, 'ok');
}
async function resgatarDoCofre(id) {
  const c = (STATE.cofres || []).find(x => x.id === id);
  if (!c) return;
  const alocado = Number(c.saldoAlocado) || 0;
  if (alocado <= 0) { toast('Este cofre não possui saldo para resgatar.', 'err'); return; }
  const resp = await pedirValor(`Resgatar de "${c.nome}" para o Saldo Disponível (Máx: ${toBRL(alocado)})`, toBRL(alocado).replace('R$', 'R$ '));
  if (resp === null) return;
  const valor = moedaToNumber(resp);
  if (!valor || valor <= 0) return;
  if (valor > alocado + 0.009) { toast(`Valor superior ao saldo guardado no cofre (${toBRL(alocado)}).`, 'err'); return; }
  c.saldoAlocado = Math.max(0, Math.round((alocado - valor) * 100) / 100);
  await salvarDados();
  renderCofres();
  renderDashboard();
  toast(`${toBRL(valor)} devolvido ao Saldo Disponível!`, 'ok');
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

  const btnTop = document.getElementById('btn-modo-viagem-top');
  const lblTop = document.getElementById('label-modo-viagem-top');
  if (btnTop) btnTop.classList.toggle('btn-primary', !!mv.ativo);
  if (lblTop) lblTop.textContent = mv.ativo ? ` Viagem: ${mv.nome}` : ' Modo Viagem';

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
  m.valorAtual = Math.max(0, Math.round(((Number(m.valorAtual) || 0) + valor) * 100) / 100);
  registrarLancamentoHistoricoCofre(m, valor, 'guardar');
  await salvarDados();
  renderMetas();
  atualizarSaldos();
  sincronizarEmSegundoPlano();
  toast(`${toBRL(valor)} guardado no cofre "${m.nome}"!`, 'ok');
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
async function aportarMeta(id) {
  return adicionarFundoMeta(id);
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
      <td>${d.pessoa}</td>
      <td>${d.descricao || '-'}</td>
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

  const receitas = doPeriodo.filter(l => l.tipo==='receita' && !l.ehTransferencia).reduce((s,l)=>s+l.valor,0);
  const despesas = doPeriodo.filter(l => l.tipo==='despesa' && !l.ehTransferencia).reduce((s,l)=>s+l.valor,0);
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
      if (l.ehTransferencia || !lancamentoTemHashtag(l, hashtagFiltro)) return;
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
    if (l.tipo !== 'despesa' || l.ehTransferencia) return;
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
        return `<div class="mom-item">
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

  const ranking = [...doPeriodo].filter(l => l.tipo==='despesa' && !l.ehTransferencia).sort((a,b) => b.valor - a.valor).slice(0, 10);
  document.getElementById('rel-ranking').innerHTML = ranking.length ? ranking.map(l => {
    const [a,m,d] = (l.data||'').split('-');
    return `<tr><td>${d}/${m}/${a}</td><td>${formatarDescricaoComHashtags(l.descricao)}${badgesTagsHTML(l)}</td><td><span class="badge badge-cat">${escHtml(formatarCategoriaExibicao(l.categoria))}</span></td><td style="text-align:right">${toBRL(l.valor)}</td></tr>`;
  }).join('') : `<tr><td colspan="4" style="text-align:center;color:var(--text3);padding:1.5rem 0">Sem despesas no período.</td></tr>`;

  document.getElementById('rel-print-periodo').textContent = `Período: últimos ${numMeses} meses${hashtagFiltro ? ' (#' + hashtagFiltro + ')' : ''} · Gerado em ${new Date().toLocaleString('pt-BR')}`;
  renderGraficoMaquinaTempo();
}
function exportarRelatorioPDF() {
  const raiz = document.documentElement;
  const ocultos = raiz.classList.contains('privacidade');
  const executarImpressao = () => {
    if (ocultos) raiz.classList.remove('privacidade');
    document.getElementById('rel-print-header').style.display = '';
    let restaurado = false;
    const restaurar = () => {
      if (restaurado) return;
      restaurado = true;
      document.getElementById('rel-print-header').style.display = 'none';
      if (ocultos) raiz.classList.add('privacidade');
    };
    window.addEventListener('afterprint', restaurar, { once: true });
    setTimeout(restaurar, 15000); // garantia, caso o navegador não avise o fim da impressão
    if (typeof window.print === 'function') window.print();
  };
  if (ocultos) {
    abrirConfirmacao('O modo privacidade está ligado. Exportar o PDF com os valores visíveis?', executarImpressao, 'Exportar PDF');
  } else {
    executarImpressao();
  }
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
  if (ligada) { ativarObservadorPrivacidade(); blindarValores(document.body); }
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
  const temSubtle = !!(window.crypto && window.crypto.subtle);
  if (!temSubtle && typeof require !== 'function') throw new Error('Este ambiente não suporta a proteção por PIN (precisa de uma conexão segura, https).');
}
async function derivarPin(pin, salBytes, iteracoes) {
  exigirCripto();
  if (window.crypto && window.crypto.subtle) {
    const chave = await window.crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
    const bits = await window.crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salBytes, iterations: iteracoes }, chave, 256);
    return bytesParaB64(bits);
  }
  // Electron sem "contexto seguro" na página: usa a criptografia do próprio Node (mesmo algoritmo, mesmo resultado)
  return bytesParaB64(require('crypto').pbkdf2Sync(pin, Buffer.from(salBytes), iteracoes, 32, 'sha256'));
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
  try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(PIN_CHAVE); localStorage.removeItem(MS_CHAVE); localStorage.removeItem(MS_PKCE_CHAVE); } catch (e) {}
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
  return typeof process !== 'undefined' && !!(process.versions && process.versions.electron) && typeof require === 'function';
}
function ipcInvocar(canal, dados) { return require('electron').ipcRenderer.invoke(canal, dados); }
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
  if (typeof require === 'function') { arr.set(require('crypto').randomBytes(arr.length)); return arr; }
  throw new Error('Este ambiente não tem gerador de números aleatórios seguro.');
}
function aleatorioB64Url(n) { return base64Url(gerarAleatorio(new Uint8Array(n))); }
async function sha256Bytes(texto) {
  const dados = new TextEncoder().encode(texto);
  if (window.crypto && window.crypto.subtle) return new Uint8Array(await window.crypto.subtle.digest('SHA-256', dados));
  if (typeof require === 'function') return new Uint8Array(require('crypto').createHash('sha256').update(Buffer.from(dados)).digest());
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
  'EhReembolsavel','ReembolsoDevedor','Reembolsado'
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
  return JSON.stringify([l.id, l.tipo, l.data, l.descricao, l.categoria, l.conta, Number(l.valor), estaPago(l), (l.tags || []).join('|'),
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
function abrirBusca() {
  document.getElementById('busca-input').value = '';
  buscaIndiceAtivo = 0;
  abrirModal('modal-busca');
  filtrarBusca();
  setTimeout(() => document.getElementById('busca-input').focus(), 50);
}
function comandosSpotlight() {
  return [
    { tipo: 'comando', cmd: '>novo', label: 'Criar novo lançamento', icone: 'plus', executar: () => abrirModalLancamento() },
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
    { tipo: 'comando', cmd: '>conciliar', label: 'Ativar Modo Conciliação em Lançamentos', icone: 'checks', executar: () => { nav('lancamentos'); if (!modoConciliacaoAtivo) alternarModoConciliacao(); } },
    { tipo: 'comando', cmd: '>dashboard', label: 'Ir para o Dashboard', icone: 'layout-dashboard', executar: () => nav('dashboard') }
  ];
}
function filtrarBusca() {
  const bruto = document.getElementById('busca-input').value;
  const termo = bruto.trim().toLowerCase();
  const { paginas, acoes } = itensBuscaFixos();
  let resultados;
  if (termo.startsWith('>')) {
    const qCmd = termo.slice(1).trim();
    const cmds = comandosSpotlight();
    resultados = cmds.filter(c =>
      !qCmd ||
      c.cmd.toLowerCase().includes(qCmd) ||
      c.label.toLowerCase().includes(qCmd)
    );
  } else if (!termo) {
    resultados = [...comandosSpotlight().slice(0, 4), ...acoes, ...paginas];
  } else {
    const lancs = STATE.lancamentos
      .filter(l => (l.descricao||'').toLowerCase().includes(termo))
      .sort((a,b) => (b.data||'').localeCompare(a.data||''))
      .slice(0, 10)
      .map(l => ({ tipo:'lancamento', id: l.id, label: l.descricao, sub: `${toBRL(l.valor)} · ${l.data ? l.data.split('-').reverse().join('/') : ''}` }));
    resultados = [
      ...comandosSpotlight().filter(c => c.cmd.toLowerCase().includes(termo) || c.label.toLowerCase().includes(termo)),
      ...paginas.filter(p => p.label.toLowerCase().includes(termo)),
      ...acoes.filter(a => a.label.toLowerCase().includes(termo)),
      ...lancs
    ];
  }
  buscaIndiceAtivo = 0;
  renderResultadosBusca(resultados);
}
function renderResultadosBusca(resultados) {
  buscaResultadosAtuais = resultados;
  const cont = document.getElementById('busca-resultados');
  if (!resultados.length) { cont.innerHTML = '<p class="help-text" style="padding:.5rem">Nada encontrado. Digite <code>&gt;</code> para ver os comandos disponíveis.</p>'; return; }
  cont.innerHTML = resultados.map((r, i) => {
    const tag = r.tipo === 'comando' ? 'Comando' : r.tipo === 'nav' ? 'Ir para' : r.tipo === 'acao' ? 'Ação' : 'Lançamento';
    const icone = r.tipo === 'lancamento' ? 'receipt' : r.icone;
    const label = r.tipo === 'comando'
      ? `<span class="busca-cmd-badge">${r.cmd}</span>${r.label}`
      : r.tipo === 'lancamento' ? `${r.label} <span class="help-text">${r.sub}</span>` : r.label;
    return `<div class="busca-hit${i===buscaIndiceAtivo?' ativo':''}" onclick="selecionarResultadoBusca(${i})">
      <i class="ti ti-${icone}"></i><div class="busca-hit-label">${label}</div><div class="busca-hit-tag">${tag}</div>
    </div>`;
  }).join('');
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
  if (event.key === 'ArrowDown') { event.preventDefault(); buscaIndiceAtivo = Math.min(buscaResultadosAtuais.length-1, buscaIndiceAtivo+1); renderResultadosBusca(buscaResultadosAtuais); }
  else if (event.key === 'ArrowUp') { event.preventDefault(); buscaIndiceAtivo = Math.max(0, buscaIndiceAtivo-1); renderResultadosBusca(buscaResultadosAtuais); }
  else if (event.key === 'Enter') { event.preventDefault(); selecionarResultadoBusca(buscaIndiceAtivo); }
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
    abrirBusca();
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

/* ================= BACKUP ================= */
function exportarBackup() {
  const blob = new Blob([JSON.stringify(STATE, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'controle-financeiro-backup-' + hojeLocalISO() + '.json';
  a.click();
}
async function importarBackup(file) {
  if (!file) return;
  const texto = await file.text();
  try {
    const dados = JSON.parse(texto);
    STATE = Object.assign(STATE, dados);
    try { if (msLer().ultimoETag) msAtualizar({ ultimoETag: null }); } catch (e) {} // os dados mudaram: a próxima sincronização lê a nuvem de novo
    await salvarDados();
    renderDashboard(); renderLancamentos(); renderConfig();
    toast('Backup importado com sucesso.', 'ok');
  } catch (e) {
    toast('Arquivo de backup inválido.', 'err');
  }
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
  // No Electron o link original já funciona direto (sem CORS); no navegador o link da API é o mais promissor.
  const candidatos = (ehElectron() ? [original, api] : [api, original]).filter(Boolean);
  const metodos = [
    { nome: 'direto', montar: u => u },
    { nome: 'proxy próprio (Netlify)', montar: u => '/.netlify/functions/onedrive-proxy?url=' + encodeURIComponent(u) },
    { nome: 'corsproxy.io', montar: u => 'https://corsproxy.io/?' + encodeURIComponent(u) },
    { nome: 'allorigins.win', montar: u => 'https://api.allorigins.win/raw?url=' + encodeURIComponent(u) }
  ];
  const estrategias = [];
  metodos.forEach(m => candidatos.forEach(u => estrategias.push({
    nome: m.nome + (u === api ? ' · link da API' : ' · link original'),
    url: m.montar(u)
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
        const resp = await fetch(estrategia.url, { cache: 'no-store', signal: ctrl ? ctrl.signal : undefined });
        if (!resp.ok) {
          let detalhe = '';
          try { detalhe = (await resp.text()).replace(/\s+/g, ' ').slice(0, 160); } catch (e2) { /* corpo não textual, ignora */ }
          ultimoErro = new Error(`[${estrategia.nome}] HTTP ${resp.status}${detalhe ? ' — ' + detalhe : ''}`);
          log.push(`${rotulo} → HTTP ${resp.status}${detalhe ? ' — ' + detalhe : ''}`);
          console.warn('Sincronização OneDrive — tentativa falhou:', ultimoErro.message);
          continue;
        }
        const buf = await resp.arrayBuffer();
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
  if (!v) return '';
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`;
  const d = new Date(s);
  if (!isNaN(d)) return d.toISOString().slice(0,10);
  return '';
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
  STATE.lancamentos.forEach(l => { if (l && l.data && l.descricao) locaisPorChave.set(`${l.data}|${l.descricao}|${Math.abs(l.valor)}`, l); });

  const idsExistentes = new Set(baseAnterior.map(l => l.id));
  const apagadosAqui = new Set(STATE.excluidosPendentes || []);
  const chavesExistentes = new Set(baseAnterior.map(l => `${l.data}|${l.descricao}|${l.valor}`));
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
    if (mapa.status && row[mapa.status]) pago = !String(row[mapa.status]).toLowerCase().includes('pend');

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

    novosDaPlanilha.push({
      id: idPlanilha || uid(), tipo, data, descricao,
      categoria: (mapa.categoria && row[mapa.categoria]) ? String(row[mapa.categoria]).trim() : (aplicarRegraCategorizacao(descricao) || 'Importado'),
      conta: (mapa.conta && row[mapa.conta]) ? String(row[mapa.conta]).trim() : '',
      valor: valorNum, origem: 'onedrive',
      sincronizado: !(grupoTransf && !row['TransferenciaGrupo']), // a planilha ainda não sabe que é transferência: reenvia pra ela aprender
      pago,
      ehTransferencia: grupoTransf ? true : undefined,
      transferenciaGrupo: grupoTransf || undefined,
      transferenciaContraparte: lerCampoRow(['TransferenciaContraparte']) || (antigo && antigo.transferenciaContraparte) || undefined,
      comprovante,
      parcelaGrupo: lerCampoRow(['ParcelaGrupo']) || undefined,
      parcelaAtual: lerCampoRow(['ParcelaAtual']) ? parseInt(lerCampoRow(['ParcelaAtual']), 10) : undefined,
      parcelaTotal: lerCampoRow(['ParcelaTotal']) ? parseInt(lerCampoRow(['ParcelaTotal']), 10) : undefined,
      recorrenteId: lerCampoRow(['RecorrenteID']) || undefined,
      tags: lerCampoRow(['Tags']) ? parseTags(lerCampoRow(['Tags'])) : undefined,
      garantiaFim,
      garantiaMeses,
      anexoNome,
      anexoPath,
      ehReembolsavel,
      reembolsoDevedor,
      reembolsado
    });
    novos++;
  });

  STATE.lancamentos = modoSincronizacaoTotal
    ? [...novosDaPlanilha, ...baseAnterior]
    : [...STATE.lancamentos, ...novosDaPlanilha];

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
    !l.ehTransferencia &&
    !estaPago(l) &&
    mesCompetenciaLancamento(l) === mesKey
  ).sort((a, b) => (a.data || '').localeCompare(b.data || ''));
}

function calcularBalancoRealMesWizard(mesKey) {
  let receitasEfetivadas = 0;
  let despesasEfetivadas = 0;
  (STATE.lancamentos || []).forEach(l => {
    if (l.ehTransferencia || l.ehMovimentoCofre) return;
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
    metaAlvo.valorAtual = Math.max(0, Math.round(((Number(metaAlvo.valorAtual) || 0) + valorAlocar) * 100) / 100);
    registrarLancamentoHistoricoCofre(metaAlvo, valorAlocar, 'guardar');
    toast(`Fechamento concluído! ${toBRL(valorAlocar)} transferidos para o cofre "${metaAlvo.nome}".`, 'ok');
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

/* ================= INIT ================= */
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
  if (m.id === 'modal-prompt') { cancelarPrompt(); } else { m.classList.remove('show'); }
}));
(async function init() {
  sincronizarIconeTema();
  document.getElementById('app-versao').textContent = 'COFIN · versão ' + APP_VERSAO;
  inicializarModoStealth();
  // Privacidade: liga o "borrador" ANTES de desenhar qualquer tela, pra nenhum valor aparecer nem por um instante.
  try { if (localStorage.getItem(PRIV_CHAVE) === '1') aplicarPrivacidade(true, false); } catch (e) {}
  // Bloqueio: se o PIN sumiu/ficou inválido, não deixa o app preso na tela de PIN.
  if (!temPin()) document.documentElement.classList.remove('bloqueado');
  const logoMarca = document.querySelector('.brand-icon img');
  if (logoMarca) document.getElementById('bloqueio-logo').src = logoMarca.src;
  inicializarControlesJanela();
  if (document.documentElement.classList.contains('bloqueado')) setTimeout(() => document.getElementById('bloqueio-pin').focus(), 100);
  else iniciarRelogioOcioso();
  atualizarSegurancaUI();
  const veioDoLoginMs = await msTratarRetornoDoLogin(); // voltando da tela de login da Microsoft (site/celular)
  await carregarDados();
  await gerarLancamentosRecorrentes();
  renderDashboard();
  atualizarStatusSync();
  if (document.readyState === 'complete') {
    setTimeout(verificarViradaDeMesAutomatica, 250);
  } else {
    window.addEventListener('load', () => setTimeout(verificarViradaDeMesAutomatica, 250));
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
    return {
      "Data": dataFormatada,
      "Descrição": l.descricao || '',
      "Categoria": l.categoria || '',
      "Tipo": l.tipo === 'receita' ? 'Receita' : 'Despesa',
      "Valor": l.valor || 0,
      "Conta": l.conta || '',
      "Status": estaPago(l) ? 'Pago' : 'Pendente',
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
      "Reembolsado": l.reembolsado ? 'Sim' : ''
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
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    const resposta = await fetch(`https://hook.us2.make.com/bxu3xy2obmq4odwkqsbnrlwysvccoz9b`, {
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
    if (ehElectron()) {
      const { ipcRenderer } = require('electron');
      if (action === 'minimize') ipcRenderer.send('win:minimize');
      else if (action === 'maximize') ipcRenderer.send('win:maximize');
      else if (action === 'close') ipcRenderer.send('win:close');
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

  try {
    const { ipcRenderer } = require('electron');
    ipcRenderer.on('win:maximized-status', (event, isMax) => {
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
    });

    ipcRenderer.invoke('win:is-maximized').then(isMax => {
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
    }).catch(() => {});
  } catch (e) {}

  const topbar = document.querySelector('.topbar');
  if (topbar) {
    topbar.addEventListener('dblclick', (e) => {
      if (e.target.closest('button, a, input, select, .topbar-window-controls')) return;
      windowControl('maximize');
    });
  }
}
