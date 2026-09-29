// Proxy simples pra contornar CORS quando o COFIN busca a planilha do OneDrive
// de dentro de um navegador (no Electron isso nem é chamado, pois o CORS já está desligado lá).
//
// Só aceita links de domínios da Microsoft, pra não virar um proxy aberto pra qualquer site.
// Usa o fetch nativo do Node (as functions da Netlify rodam Node 18+), então não precisa de dependências.

const HOSTS_PERMITIDOS = ['1drv.ms', 'onedrive.live.com', 'api.onedrive.com', 'sharepoint.com'];
const LIMITE_BYTES = 4.5 * 1024 * 1024; // respostas de function têm teto de ~6 MB (o base64 aumenta ~33%)

exports.handler = async function (event) {
  const cabecalhosCors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cabecalhosCors, body: '' };
  }

  const params = event.queryStringParameters || {};

  // ?diag=1 -> confirma que a function está no ar e em qual versão do Node ela roda
  if (params.diag) {
    return {
      statusCode: 200,
      headers: { ...cabecalhosCors, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true, node: process.version, fetchDisponivel: typeof fetch === 'function' })
    };
  }

  const url = params.url;
  if (!url) {
    return { statusCode: 400, headers: cabecalhosCors, body: 'Faltou o parâmetro url.' };
  }

  let destino;
  try {
    destino = new URL(url);
  } catch (e) {
    return { statusCode: 400, headers: cabecalhosCors, body: 'URL inválida: ' + e.message };
  }

  const permitido = HOSTS_PERMITIDOS.some((h) => destino.hostname === h || destino.hostname.endsWith('.' + h));
  if (!permitido) {
    return { statusCode: 403, headers: cabecalhosCors, body: 'Domínio não permitido neste proxy: ' + destino.hostname };
  }

  if (typeof fetch !== 'function') {
    return { statusCode: 500, headers: cabecalhosCors, body: 'Este ambiente não tem fetch (Node ' + process.version + ').' };
  }

  try {
    const resposta = await fetch(destino.toString(), {
      redirect: 'follow',
      headers: {
        // Alguns links da Microsoft mostram uma página de verificação pra clientes que não parecem navegadores
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': '*/*'
      }
    });
    if (!resposta.ok) {
      return { statusCode: resposta.status, headers: cabecalhosCors, body: 'A Microsoft respondeu com erro HTTP ' + resposta.status + ' ao buscar o arquivo.' };
    }
    const buffer = Buffer.from(await resposta.arrayBuffer());
    if (buffer.length > LIMITE_BYTES) {
      return { statusCode: 413, headers: cabecalhosCors, body: 'Arquivo grande demais pro proxy (' + buffer.length + ' bytes).' };
    }
    if (buffer.length < 200) {
      return { statusCode: 502, headers: cabecalhosCors, body: 'A resposta veio vazia ou pequena demais (' + buffer.length + ' bytes) — provável página de verificação em vez do arquivo.' };
    }
    return {
      statusCode: 200,
      headers: {
        ...cabecalhosCors,
        'Content-Type': resposta.headers.get('content-type') || 'application/octet-stream'
      },
      body: buffer.toString('base64'),
      isBase64Encoded: true
    };
  } catch (e) {
    const causa = e && e.cause ? ' | causa: ' + (e.cause.code || e.cause.message) : '';
    return { statusCode: 502, headers: cabecalhosCors, body: 'Falha ao buscar o arquivo (' + (e.name || 'Erro') + '): ' + e.message + causa };
  }
};
