# Design: Formulário de Qualificação → RD Station CRM

**Data:** 2026-03-24
**Status:** Aguardando API Key do RD Station

---

## Problema Atual

- Lead preenche formulário → vai direto pro WhatsApp
- SDR atende sem contexto nenhum
- SDR preenche TUDO manualmente no RD Station (sondagem)
- Processo lento e com perda de informação

## Solução Proposta

Formulário envia dados direto pra API do RD Station, criando a negociação na etapa **Sondagem** com campos pré-preenchidos. O SDR recebe o lead já qualificado no CRM e faz apenas a segunda filtragem.

---

## Fluxo Novo

```
HOJE:   Anúncio → Formulário → WhatsApp (SDR sem contexto, preenche tudo manual)

NOVO:   Anúncio → Formulário (3 steps) → API RD Station cria negociação
        → Lead cai na SONDAGEM com campos preenchidos
        → SDR faz segunda filtragem no CRM
        → SDR entra em contato com leads qualificados
```

---

## Estrutura do Formulário (3 steps, ~30 segundos)

```
Step 1: Profissão              → 1 clique (cards)
Step 2: Dados de contato       → nome, telefone, email, Instagram (opcional)
Step 3: Como conheceu + enviar → 1 clique → cria negociação no RD Station
```

### Campos removidos (simplificação):
- ~~Estado~~ → SDR preenche na filtragem
- ~~Área de atuação~~ → profissão já dá o contexto

---

## Mapeamento: Formulário → RD Station CRM (Sondagem)

### Preenchido automaticamente pelo formulário:

| Campo RD Station        | Origem                                      |
|-------------------------|---------------------------------------------|
| Nome da negociação      | Formulário (formato: "NOME | EQUIPAMENTO")  |
| PERFIL MÉDICO?          | Step 1 (profissão)                          |
| EQUIPAMENTO             | UTM do anúncio (utm_term)                   |
| Fonte                   | UTM source (ex: "facebook")                 |
| Campanha                | UTM campaign (ex: "CONVERSÃO – SUPREME PRO")|
| FONTE SDR               | Step 3 (como conheceu a marca)              |
| Email do contato        | Step 2                                      |
| Telefone do contato     | Step 2                                      |
| Instagram               | Step 2 (opcional)                            |

### Preenchido pelo SDR na segunda filtragem:

| Campo RD Station          | SDR preenche na ligação   |
|---------------------------|---------------------------|
| Valor total               | Conforme negociação       |
| Estado / Cidade           | Pergunta na ligação       |
| Especialidade Médica      | Valida na conversa        |
| Modalidade de pagamento   | Conforme interesse        |
| Gerente de vendas         | Atribuição interna        |
| Houve demonstração?       | Valida com "como conheceu"|
| Nº de OP / Data da OP     | Processo interno          |
| Tipo de negociação        | Classificação interna     |

---

## Marcas e Perfis por Formulário

### Contourline (estética)
- **Público:** Esteticistas, Biomédicos Estetas, Fisioterapeutas Dermatofuncionais, Tecnólogos em Estética, Donos de clínica/Spa
- **Equipamentos:** HIPRO, MultiShape, X-Tonus, Focuskin, HivePro, Ultralift

### Contourline Med (médico)
- **Público:** Dermatologistas, Cirurgiões Plásticos, Médicos Estéticos, Ginecologistas
- **Equipamentos:** HIPRO-Med, Supreme Pro

### Lumenis (médico)
- **Público:** Dermatologistas, Cirurgiões Plásticos, Médicos Estéticos, Ginecologistas, Oftalmologistas
- **Equipamentos:** ULTRApulse, Stellar M22, TriLift, NuEra Tight

### Body Health (misto)
- **Público:** Dermatologistas, Ginecologistas, Cirurgiões Plásticos, Médicos Estéticos, Esteticistas/Biomédicos, Fisioterapeutas
- **Equipamentos:** Crystal 3D Plus, Enygma X-Orbital, Unyque Pro, Supreme Pro

### Visbody (fitness + clínico)
- **Público:** Personal Trainers, Nutricionistas, Fisioterapeutas, Médicos, Donos de academia/Studio
- **Equipamentos:** S-30, Creator-600, M-30

---

## Implementação Técnica

### Pré-requisitos:
- [ ] Obter API Key do RD Station CRM (Configurações → Integrações → API)
- [ ] Adicionar token ao `.env` como `RD_STATION_CRM_TOKEN`

### Integração:
- Formulário HTML faz POST via JavaScript (fetch) para a API do RD Station
- Endpoint: `https://crm.rdstation.com/api/v1/deals`
- Cria contato + negociação na etapa "Sondagem"
- Após sucesso, redireciona para WhatsApp (mantém o fluxo atual como fallback)

### Opções RMKT (Step 3 - "Como conheceu"):
1. "Já vi uma demonstração"
2. "Vi nas redes sociais"
3. "Indicação de colega"
4. "Congresso / Evento"
5. "Primeira vez que vejo"

---

## Benefícios Esperados

1. **SDR recebe lead com 70% da sondagem pronta** → menos tempo preenchendo, mais tempo vendendo
2. **Zero perda de informação** → dados vão direto do lead pro CRM
3. **Qualificação automática** → profissão + equipamento + fonte já filtram o lead
4. **Formulário rápido (30s)** → taxa de conversão alta
5. **Rastreabilidade completa** → UTMs conectam o lead à campanha/anúncio exato
