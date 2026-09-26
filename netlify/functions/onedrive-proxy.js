// Proxy simples pra contornar CORS quando o COFIN busca a planilha do OneDrive
// de dentro de um navegador (no Electron isso nem é chamado, pois o CORS já está desligado lá).
//
// Só aceita links de domínios da Microsoft (1drv.ms, onedrive.live.com, sharepoint.com),
// pra não virar um proxy aberto pra qualquer site.

const HOSTS_PERMITIDOS = ['1drv.ms', 'onedrive.live.com', 'sharepoint.com'];

// Alguns runtimes de function ainda não trazem fetch nativo — usa o global se existir,
// senão cai pro node-fetch (dependência declarada no package.json).
async function obterFetch() {
  if (typeof fetch === 'function') return fetch;
  const mod = await import('node-fetch');
  return mod.default;
}

exports.handler = async function (event) {
  const cabecalhosCors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cabecalhosCors, body: '' };
  }

  const url = event.queryStringParameters && event.queryStringParameters.url;
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

  let fetchFn;
  try {
    fetchFn = await obterFetch();
  } catch (e) {
    return { statusCode: 500, headers: cabecalhosCors, body: 'Não consegui carregar o fetch neste ambiente: ' + e.message };
  }

  try {
    const resposta = await fetchFn(destino.toString(), { redirect: 'follow' });
    if (!resposta.ok) {
      return { statusCode: resposta.status, headers: cabecalhosCors, body: 'A Microsoft respondeu com erro HTTP ' + resposta.status + ' ao buscar o arquivo.' };
    }
    const buffer = Buffer.from(await resposta.arrayBuffer());
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
    return { statusCode: 502, headers: cabecalhosCors, body: 'Falha ao buscar o arquivo (' + (e.name || 'Erro') + '): ' + e.message };
  }
};
