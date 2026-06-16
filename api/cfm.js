/**
 * Proxy serverless (Vercel/Node) — Validação de CRM via Infosimples (consulta "CFM Cadastro")
 * ───────────────────────────────────────────────────────────────────────────────────────────
 * O form chama POST /api/cfm  { inscricao, uf }  e recebe { valido, nome, situacao, ... }.
 * O token da Infosimples fica no servidor (env var), nunca exposto no frontend.
 *
 * SETUP (uma vez):
 *   1. Crie conta em https://infosimples.com e gere um token para a consulta "CFM / Cadastro".
 *      (É paga por consulta — confirme se há créditos na conta.)
 *   2. No Vercel: Project "formularios_output" > Settings > Environment Variables
 *      > adicione  INFOSIMPLES_TOKEN = <seu_token>  (Production + Preview).
 *   3. Redeploy.
 *
 * Doc da API: https://infosimples.com/consultas/cfm-cadastro/
 */

const INFOSIMPLES_URL = 'https://api.infosimples.com/api/v2/consultas/cfm/cadastro';

module.exports = async (req, res) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  // Preflight (mesmo domínio normalmente nem dispara, mas é barato responder)
  if (req.method === 'OPTIONS') { res.status(200).end(); return; }

  if (req.method !== 'POST') {
    res.status(405).json({ valido: false, erro: 'Método não permitido. Use POST.' });
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

  const inscricao = String(body.inscricao || '').replace(/\D/g, '');
  const uf = String(body.uf || '').trim().toUpperCase().slice(0, 2);

  if (!inscricao || !/^[A-Z]{2}$/.test(uf)) {
    res.status(400).json({ valido: false, erro: 'Informe inscricao (número do CRM) e uf (2 letras).' });
    return;
  }

  const token = process.env.INFOSIMPLES_TOKEN;
  if (!token) {
    res.status(500).json({ valido: false, erro: 'INFOSIMPLES_TOKEN não configurado no servidor.' });
    return;
  }

  try {
    const params = new URLSearchParams({ token: token, inscricao: inscricao, uf: uf, timeout: '20' });
    const apiRes = await fetch(INFOSIMPLES_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Accept': 'application/json'
      },
      body: params.toString()
    });
    const json = await apiRes.json();

    // code 200 = consulta executada com sucesso; data[] traz o(s) registro(s) do médico.
    const ok = json && json.code === 200 && Array.isArray(json.data) && json.data.length > 0;
    const reg = ok ? json.data[0] : null;

    res.status(200).json({
      valido: !!ok,
      code: json ? json.code : null,
      code_message: json ? json.code_message : null,
      nome: reg ? (reg.nome || reg.name || '') : '',
      situacao: reg ? (reg.situacao || reg.status || '') : '',
      especialidade: reg ? (reg.especialidades || reg.especialidade || '') : ''
    });
  } catch (e) {
    res.status(502).json({ valido: false, erro: 'Falha ao consultar a Infosimples.', detalhe: String((e && e.message) || e) });
  }
};
