/**
 * Proxy serverless (Vercel/Node) — Criação de negociação no RD Station CRM + ANTI-DUPLICIDADE
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * O form chama  POST /api/rdstation  { deal: { ... } }  (mesmo payload do RD Station).
 * O token do RD Station fica no servidor (env var), nunca exposto no frontend.
 *
 * SETUP (uma vez):
 *   1. No Vercel: Project "formularios_output" > Settings > Environment Variables
 *      > adicione  RD_STATION_TOKEN = <token do RD Station CRM>  (Production + Preview).
 *   2. Redeploy (ou git push).
 *
 * ANTI-DUPLICIDADE:
 *   Antes de criar a negociação, casa o lead por E-MAIL **ou** TELEFONE. Se já existir
 *   negociação ABERTA (win === null) no MESMO funil (deal.deal_pipeline_id), NÃO cria nova:
 *   apenas registra uma anotação no deal existente e responde { status: 'duplicate' }.
 *   "Fail-open": qualquer falha/timeout de consulta => cria normalmente (nunca perde lead).
 *
 *   Endpoints (confirmados na API real):
 *     - Contato:   GET  /api/v1/contacts?email= | &phone=   (filtro exato; já traz deals[])
 *     - Deal abre: win === null  no array deals[] embutido no contato
 *     - Funil:     GET  /api/v1/deals/{id}  ->  deal_pipeline.id
 *     - Anotação:  POST /api/v1/activities  { text, deal_id }
 *     - Criar:     POST /api/v1/deals
 *
 * Doc: https://developers.rdstation.com/reference/crm-v1-deals
 */

const RD_BASE = 'https://crm.rdstation.com/api/v1';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // ── CORS / origem ──────────────────────────────────────────────────────────
  // Allowlist igual ao /api/cfm. Ecoa o Access-Control-Allow-Origin para a origem
  // permitida (funciona same-origin no Vercel e cross-origin se preciso).
  const ALLOWED_HOSTS = ['form.contourline.com.br', 'localhost', '127.0.0.1'];
  const originRef = req.headers.origin || req.headers.referer || '';
  let originHost = '';
  try { originHost = originRef ? new URL(originRef).hostname : ''; } catch (e) { originHost = ''; }
  const originAllowed = originHost !== '' && (
    ALLOWED_HOSTS.includes(originHost) ||
    originHost.endsWith('.vercel.app') ||
    originHost.endsWith('.contourline.com.br')
  );
  if (req.headers.origin && originAllowed) {
    res.setHeader('Access-Control-Allow-Origin', req.headers.origin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method !== 'POST') {
    res.status(405).json({ error: 'Método não permitido. Use POST.' });
    return;
  }

  // Bloqueia abuso externo (curl/outros sites) da criação de negociações.
  // POST via fetch sempre envia Origin, então o form legítimo passa.
  if (!originAllowed) {
    res.status(403).json({ error: 'Origem não autorizada.' });
    return;
  }

  const token = process.env.RD_STATION_TOKEN;
  if (!token) {
    res.status(500).json({ error: 'RD_STATION_TOKEN não configurado no servidor.' });
    return;
  }

  // ── Body (Vercel auto-parseia JSON; fallback pra stream cru) ──
  let body = req.body;
  if (!body || typeof body !== 'object') {
    try {
      const raw = await new Promise((resolve, reject) => {
        let d = '';
        req.on('data', (c) => { d += c; });
        req.on('end', () => resolve(d));
        req.on('error', reject);
      });
      body = raw ? JSON.parse(raw) : {};
    } catch (e) {
      body = {};
    }
  }

  if (!body || !body.deal) {
    res.status(400).json({ error: 'Dados inválidos. Envie um JSON com o campo "deal".' });
    return;
  }

  // ── Validação de qualidade dos dados (anti-CEP-no-nome) ──
  const contatos = Array.isArray(body.deal.contacts) ? body.deal.contacts : [];
  for (const c of contatos) {
    const nome = String((c && c.name) || '').trim();
    const letras = (nome.match(/\p{L}/gu) || []).length;
    if (letras < 2) {
      console.error('[rdstation] Lead rejeitado — nome invalido: ' + nome);
      res.status(422).json({
        error: 'Nome do contato invalido. Deve conter ao menos 2 letras.',
        rejected_name: nome,
        reason: 'name_must_contain_letters'
      });
      return;
    }
  }

  // ── ANTI-DUPLICIDADE ──
  try {
    const dedup = await rdDedupCheck(token, body.deal);
    if (dedup.duplicate) {
      const annotated = await rdAddAnnotation(token, dedup.deal_id, dedup.note);
      console.log(`[rdstation] Duplicata evitada (deal ${dedup.deal_id}, por ${dedup.matched_by}). Anotacao: ${annotated ? 'ok' : 'falhou'}`);
      res.status(200).json({
        status: 'duplicate',
        deal_id: dedup.deal_id,
        deal_name: dedup.deal_name,
        matched_by: dedup.matched_by,
        annotated,
        message: 'Lead ja possui negociacao aberta neste funil — nova negociacao NAO criada (anti-duplicidade).'
      });
      return;
    }
  } catch (e) {
    // Fail-open: qualquer erro no dedup não pode impedir a criação do lead.
    console.error('[rdstation] Dedup falhou (fail-open, segue criando): ' + String((e && e.message) || e));
  }

  // ── Criar a negociação no RD Station ──
  try {
    const apiRes = await fetch(`${RD_BASE}/deals?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(25000)
    });
    const text = await apiRes.text();
    res.status(apiRes.status).send(text);
  } catch (e) {
    res.status(502).json({
      error: 'Erro de conexão com o RD Station.',
      details: String((e && e.message) || e)
    });
  }
};


// ============================================================
// FUNÇÕES AUXILIARES — DEDUP
// ============================================================

// GET genérico; retorna objeto JSON ou null (fail-open em qualquer erro/HTTP != 2xx)
async function rdGet(url) {
  try {
    const r = await fetch(url, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) return null;
    return await r.json();
  } catch (e) {
    return null;
  }
}

// Procura contato por E-MAIL e, se não achar, por TELEFONE. Retorna { contact, by } ou null.
async function rdFindContact(token, email, phones) {
  if (email) {
    const r = await rdGet(`${RD_BASE}/contacts?token=${encodeURIComponent(token)}&email=${encodeURIComponent(email)}&limit=5`);
    if (r && Array.isArray(r.contacts) && r.contacts.length) {
      return { contact: r.contacts[0], by: 'email' };
    }
  }
  for (const p of phones) {
    const r = await rdGet(`${RD_BASE}/contacts?token=${encodeURIComponent(token)}&phone=${encodeURIComponent(p)}&limit=5`);
    if (r && Array.isArray(r.contacts) && r.contacts.length) {
      return { contact: r.contacts[0], by: 'phone:' + p };
    }
  }
  return null;
}

// Detalhe do deal só para descobrir o funil. Retorna id do pipeline ou null.
async function rdDealPipelineId(token, dealId) {
  const r = await rdGet(`${RD_BASE}/deals/${encodeURIComponent(dealId)}?token=${encodeURIComponent(token)}`);
  if (r && r.deal_pipeline && r.deal_pipeline.id) return r.deal_pipeline.id;
  return null;
}

// Cria anotação (atividade) no deal. Best-effort (true/false).
async function rdAddAnnotation(token, dealId, text) {
  try {
    const r = await fetch(`${RD_BASE}/activities?token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify({ text, deal_id: dealId }),
      signal: AbortSignal.timeout(8000)
    });
    if (!r.ok) {
      const t = await r.text().catch(() => '');
      console.error(`[rdstation] Falha ao criar anotacao no deal ${dealId} (HTTP ${r.status}): ${t.slice(0, 300)}`);
      return false;
    }
    return true;
  } catch (e) {
    console.error(`[rdstation] Erro ao criar anotacao no deal ${dealId}: ${String((e && e.message) || e)}`);
    return false;
  }
}

// Núcleo: decide se o deal recebido é duplicata. Retorna { duplicate: bool, ... }.
async function rdDedupCheck(token, deal) {
  const c = (Array.isArray(deal.contacts) && deal.contacts[0]) || null;
  if (!c) return { duplicate: false };

  // E-mail normalizado
  let email = '';
  if (c.emails && c.emails[0] && c.emails[0].email) {
    email = String(c.emails[0].email).trim().toLowerCase();
  }

  // Telefone -> variações de dígitos (com e sem DDI 55)
  const phones = [];
  if (c.phones && c.phones[0] && c.phones[0].phone) {
    const d = String(c.phones[0].phone).replace(/\D/g, '');
    if (d) {
      phones.push(d);
      if (d.length > 11 && d.slice(0, 2) === '55') phones.push(d.slice(2));
      else if (d.length <= 11) phones.push('55' + d);
    }
  }
  const uniquePhones = [...new Set(phones)];

  if (!email && uniquePhones.length === 0) return { duplicate: false };

  const found = await rdFindContact(token, email, uniquePhones);
  if (!found) return { duplicate: false }; // lead novo

  const targetPipeline = deal.deal_pipeline_id || '';
  const deals = Array.isArray(found.contact.deals) ? found.contact.deals : [];

  for (const dl of deals) {
    const isOpen = Object.prototype.hasOwnProperty.call(dl, 'win') && dl.win === null && !dl.closed_at;
    if (!isOpen) continue;

    // Restringe ao MESMO funil. Só bloqueia se CONFIRMAR o funil (senão, fail-open: cria).
    if (targetPipeline) {
      const pid = await rdDealPipelineId(token, dl.id);
      if (pid !== targetPipeline) continue;
    }

    return {
      duplicate: true,
      deal_id: dl.id,
      deal_name: dl.name || '',
      matched_by: found.by,
      note: rdBuildNote(deal, found.by)
    };
  }

  // Contato existe mas sem deal aberto no funil -> reengajamento legítimo: cria normal
  return { duplicate: false };
}

// Texto da anotação registrada no deal existente.
function rdBuildNote(deal, matchedBy) {
  const quando = new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const linhas = [
    `[FORMULARIO] Lead reenviou o formulario em ${quando}.`,
    `Ja existe negociacao aberta neste funil — nova NAO criada (anti-duplicidade). Casado por: ${matchedBy}.`
  ];
  if (deal.name) linhas.push('Entrada: ' + deal.name);
  if (deal.description) linhas.push(deal.description);
  return linhas.join('\n');
}
