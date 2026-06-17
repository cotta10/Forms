// ============================================================
// GOOGLE APPS SCRIPT - Forms Meta Ads WhatsApp
// Cole em: Google Sheets > Extensoes > Apps Script
// ============================================================
//
// FUNCOES:
// - doPost()                       : Recebe dados do form, resolve ID->nome e salva na aba do MES
// - doGet()                        : Health check do webhook
// - organizarPlanilha()            : RODE 1x para criar a aba do mes atual
// - atualizarMapaIDs()             : Busca campanhas/adsets/ads do Meta e popula "Mapa_IDs"
//                                    (configure trigger diario para manter atualizado)
// - resolveCampaignName()          : Converte ID numerico em nome (=resolveCampaignName(A2))
// - migrarHistoricoParaAbasMensais : RODE 1x para migrar dados antigos das abas
//                                    'Cliente Final' / 'Profissionais' para abas mensais
//
// CONFIGURACAO INICIAL (1x):
// 1. Cole este codigo no Apps Script
// 2. Salve (Ctrl+S)
// 3. Em "Configuracoes do projeto" > "Propriedades do script", adicionar:
//      - Chave: META_ACCESS_TOKEN
//      - Valor: seu token do Meta Ads
// 4. Rode `organizarPlanilha` uma vez
// 5. Rode `atualizarMapaIDs` uma vez (cria a aba Mapa_IDs)
// 6. (Opcional) Rode `migrarHistoricoParaAbasMensais` para reorganizar dados antigos
// 7. Configure trigger diario: Acionadores > Adicionar > atualizarMapaIDs / Dia / 03:00
// 8. Implantar > Gerenciar implantacoes > Editar > Nova versao > Implantar
//

// ============================================================
// CONSTANTES
// ============================================================
var META_AD_ACCOUNT = 'act_2342726552705025';
var META_API_VERSION = 'v23.0';
var MAPA_SHEET_NAME = 'Mapa_IDs';
var TIMEZONE = 'America/Sao_Paulo';
var DIRETO_LABEL = '(direto/organico)';
var HEADERS = [
  'Data', 'Nome', 'Telefone', 'Email', 'Instagram', 'Perfil',
  'Especialidade', 'Equipamento', 'Como Conheceu', 'Marca',
  'Estado', 'Cidade', 'Source', 'Medium', 'Campaign', 'Campaign ID',
  'CRM', 'CRM Validado', 'CRM Nome', 'SDR'
];


// ============================================================
// ORGANIZAR PLANILHA (rode 1 vez)
// Cria as abas do mes atual (Cliente Final YYYY-MM / Profissionais YYYY-MM)
// ============================================================
function organizarPlanilha() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var mesAtual = Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM');
  criarOuAtualizarAba_('Cliente Final ' + mesAtual, HEADERS, '#1a73e8');
  criarOuAtualizarAba_('Profissionais ' + mesAtual, HEADERS, '#10b981');

  var defaultSheet = ss.getSheetByName('Pagina1') || ss.getSheetByName('Sheet1');
  if (defaultSheet && defaultSheet.getLastRow() <= 1) {
    try { ss.deleteSheet(defaultSheet); } catch(e) {}
  }

  Logger.log('Planilha organizada para o mes ' + mesAtual + '.');
}

function criarOuAtualizarAba_(nome, headers, corFundo) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(nome);
  var jaExistia = !!sheet;
  if (!sheet) sheet = ss.insertSheet(nome);
  var range = sheet.getRange(1, 1, 1, headers.length);
  range.setValues([headers]);
  range.setFontWeight('bold').setBackground(corFundo).setFontColor('#ffffff');
  sheet.setFrozenRows(1);
  if (!jaExistia) sheet.autoResizeColumns(1, headers.length);
  return sheet;
}

// Retorna (criando se preciso) a aba do mes para o tipo de lead
function getAbaDoMes_(isClienteFinal, dataReferencia) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mes = Utilities.formatDate(dataReferencia, TIMEZONE, 'yyyy-MM');
  var abaBase = isClienteFinal ? 'Cliente Final' : 'Profissionais';
  var cor = isClienteFinal ? '#1a73e8' : '#10b981';
  var abaNome = abaBase + ' ' + mes;

  var sheet = ss.getSheetByName(abaNome);
  if (!sheet) sheet = criarOuAtualizarAba_(abaNome, HEADERS, cor);
  return sheet;
}


// ============================================================
// WEBHOOK - Recebe dados do formulario
// ============================================================
function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);

    var now = new Date();
    var timestamp = Utilities.formatDate(now, TIMEZONE, 'dd/MM/yyyy HH:mm:ss');

    var campaignRaw = data.campaign || '';
    var campaignNome = resolveCampaignName(campaignRaw);

    // Source/Medium/Campaign vazios => entrada direta/organica
    var source = (data.source || '').toLowerCase();
    var medium = (data.medium || '').toLowerCase();
    if (!source && !medium && !campaignRaw) {
      source = DIRETO_LABEL;
      medium = DIRETO_LABEL;
      campaignNome = DIRETO_LABEL;
    }

    var linha = [
      timestamp,
      (data.nome || '').toLowerCase(),
      data.telefone || '',
      (data.email || '').toLowerCase(),
      (data.instagram || '').toLowerCase(),
      (data.perfil || '').toLowerCase(),
      (data.especialidade || '').toLowerCase(),
      (data.equipamento || '').toLowerCase(),
      (data.comoConheceu || '').toLowerCase(),
      (data.brand || '').toLowerCase(),
      (data.estado || '').toUpperCase(),
      (data.cidade || '').toLowerCase(),
      source,
      medium,
      campaignNome,    // <-- nome resolvido (ou label de direto/organico)
      campaignRaw,     // <-- ID bruto (vazio se direto/organico)
      (data.crm || '').toUpperCase(),         // <-- CRM digitado (forms medicos: Lumenis / Contourline Med)
      (data.crm_valido || '').toLowerCase(),  // <-- sim | nao | erro | '' (validacao CFM/Infosimples)
      (data.crm_nome || '').toLowerCase(),    // <-- nome retornado pelo CFM quando valido
      (data.sdr || '')                        // <-- SDR que recebeu o lead (rotatividade WhatsApp)
    ];

    var perfil = (data.perfil || '').toLowerCase();
    var isClienteFinal = (data.tipo === 'cliente_final') || (perfil === 'cliente final');

    var sheet = getAbaDoMes_(isClienteFinal, now);
    sheet.appendRow(linha);

    return ContentService
      .createTextOutput(JSON.stringify({
        status: 'ok',
        campaign_resolvido: campaignNome,
        aba: sheet.getName()
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok', message: 'Webhook ativo' }))
    .setMimeType(ContentService.MimeType.JSON);
}


// ============================================================
// RESOLVE ID -> NOME (usa aba Mapa_IDs como cache)
// Pode ser chamada como formula:  =resolveCampaignName(A2)
// ============================================================
function resolveCampaignName(idOuNome) {
  if (!idOuNome) return '';
  var valor = String(idOuNome).trim();
  // Se nao parece um ID numerico longo, devolve como esta
  if (!/^\d{10,}$/.test(valor)) return valor;

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mapa = ss.getSheetByName(MAPA_SHEET_NAME);
  if (!mapa) return valor;

  var data = mapa.getDataRange().getValues();
  // Linha 1 = header: [id, tipo, nome, status, campaign_id, adset_id]
  for (var i = 1; i < data.length; i++) {
    if (String(data[i][0]) === valor) {
      return data[i][2] || valor;  // col C = nome
    }
  }
  return valor;  // fallback: retorna o proprio ID
}


// ============================================================
// ATUALIZAR MAPA IDs (busca Meta API e popula aba Mapa_IDs)
// Configure trigger diario para manter atualizado.
// ============================================================
function atualizarMapaIDs() {
  var token = PropertiesService.getScriptProperties().getProperty('META_ACCESS_TOKEN');
  if (!token) {
    throw new Error('Configure META_ACCESS_TOKEN em Configuracoes do projeto > Propriedades do script');
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(MAPA_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(MAPA_SHEET_NAME);
  sheet.clear();

  var headers = ['id', 'tipo', 'nome', 'status', 'campaign_id', 'adset_id'];
  sheet.appendRow(headers);
  sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold').setBackground('#374151').setFontColor('#ffffff');

  var linhas = [];

  // Campanhas
  fetchAll_(META_AD_ACCOUNT + '/campaigns',
    'id,name,effective_status',
    token
  ).forEach(function(c) {
    linhas.push([c.id, 'campaign', c.name || '', c.effective_status || '', '', '']);
  });

  // Adsets
  fetchAll_(META_AD_ACCOUNT + '/adsets',
    'id,name,effective_status,campaign_id',
    token
  ).forEach(function(a) {
    linhas.push([a.id, 'adset', a.name || '', a.effective_status || '', a.campaign_id || '', '']);
  });

  // Ads
  fetchAll_(META_AD_ACCOUNT + '/ads',
    'id,name,effective_status,campaign_id,adset_id',
    token
  ).forEach(function(ad) {
    linhas.push([ad.id, 'ad', ad.name || '', ad.effective_status || '', ad.campaign_id || '', ad.adset_id || '']);
  });

  if (linhas.length > 0) {
    sheet.getRange(2, 1, linhas.length, headers.length).setValues(linhas);
  }

  sheet.autoResizeColumns(1, headers.length);
  sheet.setFrozenRows(1);

  Logger.log('Mapa atualizado: ' + linhas.length + ' entradas');
  return linhas.length;
}


function fetchAll_(endpoint, fields, token) {
  var results = [];
  var url = 'https://graph.facebook.com/' + META_API_VERSION + '/' + endpoint
          + '?fields=' + encodeURIComponent(fields)
          + '&limit=200'
          + '&access_token=' + encodeURIComponent(token);

  while (url) {
    var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    var code = resp.getResponseCode();
    if (code !== 200) {
      Logger.log('Erro Meta API (' + code + '): ' + resp.getContentText().substring(0, 300));
      break;
    }
    var json = JSON.parse(resp.getContentText());
    (json.data || []).forEach(function(r) { results.push(r); });
    url = (json.paging && json.paging.next) ? json.paging.next : null;
  }
  return results;
}


// ============================================================
// MIGRAR HISTORICO: redistribui linhas das abas antigas
// ('Cliente Final' / 'Profissionais') em abas mensais.
// Rode 1x apos o deploy. As abas antigas sao renomeadas para
// '{Nome} (ARQUIVO)' ao final, sem perda de dados.
// ============================================================
function migrarHistoricoParaAbasMensais() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var abasFonte = [
    { nome: 'Cliente Final',  isClienteFinal: true  },
    { nome: 'Profissionais',  isClienteFinal: false }
  ];

  var totalMigrado = 0;

  abasFonte.forEach(function(cfg) {
    var fonte = ss.getSheetByName(cfg.nome);
    if (!fonte) {
      Logger.log('Aba "' + cfg.nome + '" nao encontrada, pulando.');
      return;
    }

    var lastRow = fonte.getLastRow();
    if (lastRow < 2) {
      Logger.log('Aba "' + cfg.nome + '" vazia, pulando.');
      return;
    }

    var lastCol = Math.max(fonte.getLastColumn(), HEADERS.length);
    var todas = fonte.getRange(2, 1, lastRow - 1, lastCol).getValues();

    // Agrupa linhas por mes (yyyy-MM) lendo a coluna A (Data)
    var grupos = {};
    todas.forEach(function(linha) {
      var mes = extrairMesDeData_(linha[0]);
      if (!mes) mes = 'sem-data';
      if (!grupos[mes]) grupos[mes] = [];

      // Normaliza source/medium/campaign vazios em linhas antigas
      var src = (linha[12] || '').toString().trim();
      var med = (linha[13] || '').toString().trim();
      var cmp = (linha[14] || '').toString().trim();
      var cmpId = (linha[15] || '').toString().trim();
      if (!src && !med && !cmp && !cmpId) {
        linha[12] = DIRETO_LABEL;
        linha[13] = DIRETO_LABEL;
        linha[14] = DIRETO_LABEL;
      }
      // Garante 16 colunas
      while (linha.length < HEADERS.length) linha.push('');
      linha = linha.slice(0, HEADERS.length);
      grupos[mes].push(linha);
    });

    var cor = cfg.isClienteFinal ? '#1a73e8' : '#10b981';
    Object.keys(grupos).sort().forEach(function(mes) {
      var nomeAba = cfg.nome + (mes === 'sem-data' ? ' (sem data)' : ' ' + mes);
      var destino = ss.getSheetByName(nomeAba);
      if (!destino) destino = criarOuAtualizarAba_(nomeAba, HEADERS, cor);

      var startRow = destino.getLastRow() + 1;
      var bloco = grupos[mes];
      destino.getRange(startRow, 1, bloco.length, HEADERS.length).setValues(bloco);
      totalMigrado += bloco.length;
      Logger.log('Migradas ' + bloco.length + ' linhas para "' + nomeAba + '"');
    });

    // Renomeia a aba antiga (arquivo) e remove dados
    try {
      fonte.setName(cfg.nome + ' (ARQUIVO)');
    } catch (e) {
      Logger.log('Nao consegui renomear "' + cfg.nome + '": ' + e);
    }
  });

  Logger.log('Migracao concluida. Total: ' + totalMigrado + ' linhas.');
  return totalMigrado;
}

// Extrai 'yyyy-MM' de uma celula que pode estar como Date ou string 'dd/MM/yyyy HH:mm:ss'
function extrairMesDeData_(valor) {
  if (!valor) return '';
  if (valor instanceof Date) {
    return Utilities.formatDate(valor, TIMEZONE, 'yyyy-MM');
  }
  var s = String(valor).trim();
  // dd/MM/yyyy ...
  var m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return m[3] + '-' + m[2];
  // yyyy-MM-dd ...
  m = s.match(/^(\d{4})-(\d{2})-\d{2}/);
  if (m) return m[1] + '-' + m[2];
  return '';
}
