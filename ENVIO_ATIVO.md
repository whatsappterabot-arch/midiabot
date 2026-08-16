# Envio Ativo — Documentação Técnica

Campanhas de envio ativo (disparo em massa) de WhatsApp: o cliente sobe uma planilha de contatos, escreve um texto com variáveis, configura ritmo/horário, e o sistema dispara sozinho, respeitando limites pra não arriscar banimento do número. É a primeira funcionalidade **ativa/de saída** do MidiaBot — tudo o resto do produto é reativo (responde quem escreve primeiro).

**Status: construído e testado de ponta a ponta em 2026-08-15/16, com envios reais confirmados.**

## Arquitetura — dois workflows diferentes, cada um com um papel

```
envio_ativo.html (front-end)
        │  fetch POST { origem: "envioativo", acao, id_cliente, dados }
        ▼
Workflow "Midiabot painel config" (mesmo webhook do dashboard.html)
  Switch(origem) → galho "envioativo" → Switch(ação) → 8 ações
        +
  Schedule Trigger (a cada 1 min, gatilho independente do webhook) → tique de disparo real

Workflow "MidiaBot Chat" (webhook que recebe mensagem de verdade do WhatsApp)
  Webhook2 → Switch(evento) → messages.upsert → define sala e vendedor
        +→ resgate de contexto de campanha (quando o cliente responde)
        +→ registro de "SAIR" (opt-out)
```

Importante: **não existe um terceiro workflow** pro envio ativo. Foi cogitado durante o desenho e explicitamente descartado — tudo fica dentro de "Midiabot painel config" (as ações de configuração e o tique de disparo) e "MidiaBot Chat" (os dois ganchos que reagem a mensagem recebida).

## Banco de dados

```sql
CREATE TABLE midiabot_proibicao_envioativo (
    id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
    telefone TEXT NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id_cliente, telefone)
);

CREATE TABLE midiabot_disclaimer_envio (
    id_cliente INTEGER PRIMARY KEY REFERENCES midiabot_cad_usuarios(id),
    disclaimer TEXT NOT NULL
);

CREATE TABLE midiabot_envioativo_campanha (
    id SERIAL PRIMARY KEY,
    id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
    instancia TEXT NOT NULL,           -- nome_instancia (ex.: "Marcelo-1"), NÃO o sender
    texto TEXT NOT NULL,               -- com {{placeholders}}, sem o disclaimer
    intervalo_segundos INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'agendada',  -- agendada | em_andamento | pausada | cancelada | concluida
    agendado_para TIMESTAMPTZ NOT NULL,
    proximo_envio_em TIMESTAMPTZ,      -- controla quando o tique pode mandar a próxima
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE midiabot_envioativo_horario (
    id_campanha INTEGER NOT NULL REFERENCES midiabot_envioativo_campanha(id),
    dia_semana SMALLINT NOT NULL,      -- convenção Postgres EXTRACT(DOW): 0=domingo...6=sábado
    hora_inicio TIME NOT NULL,
    hora_fim TIME NOT NULL
);

CREATE TABLE midiabot_envioativo_fila (
    id SERIAL PRIMARY KEY,
    id_campanha INTEGER NOT NULL REFERENCES midiabot_envioativo_campanha(id),
    telefone TEXT NOT NULL,
    dados JSONB NOT NULL,              -- colunas dinâmicas da planilha (nome, data1, unidade...)
    status TEXT NOT NULL DEFAULT 'pendente',  -- pendente | enviado | falhou
    enviado_em TIMESTAMPTZ,
    erro TEXT,
    contextualizado BOOLEAN NOT NULL DEFAULT false
);
```

`midiabot_disclaimer_envio` é seedado pela procedure `configurar_cliente` (idempotente, `ON CONFLICT DO NOTHING`), então sobrevive a reset/reinstalação.

**Decisão de modelagem**: a planilha aceita **colunas dinâmicas** — a primeira linha define os nomes, e cada coluna vira uma variável `{{nome_da_coluna}}` no texto. A única coluna obrigatória e fixa é `telefone_envio` (não pode ser renomeada). Formato de arquivo: **só `.xlsx`** — CSV foi descartado de propósito pra não precisar de dois caminhos de leitura no node `Extract from File` do n8n (CSV e planilha usam operações diferentes).

## Regras de negócio

- **Duplicado por telefone**: se um número aparece mais de uma vez na planilha, **nenhuma** das ocorrências recebe mensagem — sem regra de "pega a primeira".
- **Opt-out**: checado na hora de processar a planilha (upload), contra `midiabot_proibicao_envioativo`. *Não* é rechecado de novo no momento do envio de verdade (lacuna conhecida e aceita — se alguém pedir exclusão depois que a campanha já foi criada mas antes de todos os envios saírem, ainda pode receber o resto da campanha).
- **Ritmo**: cliente escolhe o intervalo (mínimo 50 segundos, máximo 180 minutos); o sistema soma automaticamente uma variação aleatória de até 30 segundos em cada espera.
- **Horário por dia da semana**: cada campanha tem seu próprio horário de envio (não usa o horário de atendimento/IA) — grade de 7 dias, cada um com início/fim independentes, todos editáveis (default: seg-sex 10h-17h, sáb/dom em branco). Dia sem horário preenchido não recebe envio naquele dia.
- **Disclaimer fixo**: toda mensagem de campanha ganha, colado no final (`\n\n` de separação, nunca armazenado com a quebra de linha), o texto: *"Nós respeitamos sua privacidade. Caso não queira receber nossas mensagens, envie SAIR"* — não editável pelo cliente.
- **Nunca escreve em `midiabot_historico_mensagens` na hora do envio** (nem sucesso nem falha) — só a fila da campanha registra isso. A conversa só "nasce" no chat interno quando o cliente responde de verdade (ver seção de resgate de contexto).

## As 8 ações — workflow "Midiabot painel config", `origem: "envioativo"`

Cada uma resolve `id_cliente` a partir do próprio payload do webhook (`$('Webhook1').item.json.body.id_cliente`), sem depender de node central.

| Ação | O que faz |
|---|---|
| `processar_planilha` | Recebe o arquivo em base64, lê com o node nativo `Extract from File`, valida coluna `telefone_envio`, detecta duplicado, cruza com `midiabot_proibicao_envioativo`. Não grava nada. |
| `criar_campanha` | Chamada só na confirmação final — grava campanha + horários + fila numa `CALL` de procedure só. |
| `listar_campanhas` | Lista campanhas do cliente com contadores, pro histórico da tela inicial. |
| `detalhe_campanha` | Status + contadores + lista de contatos de uma campanha, pra tela de acompanhamento. |
| `pausar_campanha` / `retomar_campanha` / `cancelar_campanha` | Cada uma só troca o `status` — um `UPDATE` simples. |
| `relatorio_campanha` | Todas as linhas da fila de uma campanha, sem paginação, pro CSV de download. |

**`processar_planilha`** — cadeia de nodes: `Convert to File` (Operation: `Move Base64 String to File`, Input Field `body.dados.arquivo_base64`) → `Extract from File` (Operation XLSX) → `IF` (`{{ $input.first().json.telefone_envio !== undefined }}`, tipo Boolean, "is true") → `Code` `detecta_duplicado` (Run Once for All Items) → Postgres `consulta_proibicao` → `Code` `cruza_com_proibicao` → `Respond to Webhook`.

**`criar_campanha`** chama a procedure:
```sql
CREATE OR REPLACE PROCEDURE criar_campanha_envioativo(p_id_cliente INTEGER, p_dados JSONB)
LANGUAGE plpgsql
AS $procedure$
DECLARE
    v_id_campanha INTEGER;
    v_horario JSONB;
    v_contato JSONB;
BEGIN
    INSERT INTO midiabot_envioativo_campanha (id_cliente, instancia, texto, intervalo_segundos, status, agendado_para, proximo_envio_em)
    VALUES (
        p_id_cliente,
        p_dados->>'instancia',
        p_dados->>'texto',
        (p_dados->>'intervalo_segundos')::int,
        'agendada',
        (p_dados->>'agendado_para')::timestamptz,
        (p_dados->>'agendado_para')::timestamptz
    )
    RETURNING id INTO v_id_campanha;

    FOR v_horario IN SELECT * FROM jsonb_array_elements(p_dados->'horarios')
    LOOP
        INSERT INTO midiabot_envioativo_horario (id_campanha, dia_semana, hora_inicio, hora_fim)
        VALUES (v_id_campanha, (v_horario->>'dia_semana')::smallint, (v_horario->>'hora_inicio')::time, (v_horario->>'hora_fim')::time);
    END LOOP;

    FOR v_contato IN SELECT * FROM jsonb_array_elements(p_dados->'contatos')
    LOOP
        INSERT INTO midiabot_envioativo_fila (id_campanha, telefone, dados, status)
        VALUES (v_id_campanha, v_contato->>'telefone_envio', v_contato, 'pendente');
    END LOOP;
END;
$procedure$;
```
Chamada via node Postgres: `CALL criar_campanha_envioativo($1, $2::jsonb)`.

**Ação reaproveitada, não nova**: o dropdown de instâncias usa `listar_instancias`, que já existia, com `origem: "dashboard"` (não `envioativo`).

## O tique de disparo — dentro de "Midiabot painel config"

Segundo gatilho no mesmo workflow, **Schedule Trigger** (a cada 1 minuto), completamente separado do `Webhook1`. Cadeia:

```
Schedule Trigger
   → busca_campanha_pronta (Postgres — sem Always Output Data, queremos que pare quando não há nada a fazer)
   → busca_proximo_contato (Postgres)
   → monta_mensagem (Code)
   → Enviar texto (node nativo n8n-nodes-evolution-api, On Error: "Continue using error output")
        ├─ sucesso → atualiza_contato_enviado ──┐
        └─ erro    → atualiza_contato_falhou  ──┴─→ atualiza_campanha_proximo_envio → verifica_conclusao
```

**`busca_campanha_pronta`**:
```sql
SELECT c.id, c.id_cliente, c.instancia, c.texto, c.intervalo_segundos
FROM midiabot_envioativo_campanha c
WHERE c.status IN ('agendada','em_andamento')
  AND c.proximo_envio_em <= now()
  AND EXISTS (
    SELECT 1 FROM midiabot_envioativo_horario h
    WHERE h.id_campanha = c.id
      AND h.dia_semana = EXTRACT(DOW FROM (now() AT TIME ZONE 'America/Sao_Paulo'))::smallint
      AND (now() AT TIME ZONE 'America/Sao_Paulo')::time BETWEEN h.hora_inicio AND h.hora_fim
  )
  AND EXISTS (SELECT 1 FROM midiabot_envioativo_fila f WHERE f.id_campanha = c.id AND f.status = 'pendente')
ORDER BY c.proximo_envio_em ASC
LIMIT 1;
```

**`busca_proximo_contato`** (params: `[id_campanha, id_cliente]` da saída anterior):
```sql
SELECT f.id AS id_fila, f.telefone, f.dados, d.disclaimer
FROM midiabot_envioativo_fila f
LEFT JOIN midiabot_disclaimer_envio d ON d.id_cliente = $2
WHERE f.id_campanha = $1 AND f.status = 'pendente'
ORDER BY f.id LIMIT 1;
```

**`monta_mensagem`** (Code, Run Once for All Items):
```js
const campanha = $('busca_campanha_pronta').item.json;
const contato = $input.first().json;
let texto = campanha.texto;
const dados = contato.dados || {};
texto = texto.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, k) => (dados[k] !== undefined ? dados[k] : m));
const mensagemFinal = texto + '\n\n' + (contato.disclaimer || '');
return [{ json: { id_fila: contato.id_fila, telefone: contato.telefone, remoteJid: contato.telefone + '@s.whatsapp.net', mensagem: mensagemFinal, instancia: campanha.instancia } }];
```

**`Enviar texto`** (node nativo Evolution API): `instanceName = {{ $json.instancia }}`, `remoteJid = {{ $json.remoteJid }}`, `messageText = {{ $json.mensagem }}` — **os três campos precisam estar em modo expressão (ícone "fx")**, senão manda o texto literal `{{ ... }}` pra API (erro real já visto em produção: `"{{ $json.instancia }}" instance does not exist`).

**`atualiza_contato_enviado`**: `UPDATE midiabot_envioativo_fila SET status='enviado', enviado_em=now() WHERE id=$1`.

**`atualiza_contato_falhou`**: `UPDATE midiabot_envioativo_fila SET status='falhou', erro=$2 WHERE id=$1` — parâmetro do erro é `{{ $json.error }}` (string direta na saída de erro desse node específico, **não** `$json.error.message`).

**`atualiza_campanha_proximo_envio`** (rodam os dois caminhos, sucesso ou falha):
```sql
UPDATE midiabot_envioativo_campanha
SET status = 'em_andamento',
    proximo_envio_em = now() + ((intervalo_segundos + floor(random()*30)) || ' seconds')::interval
WHERE id = $1;
```

**`verifica_conclusao`**:
```sql
UPDATE midiabot_envioativo_campanha
SET status = 'concluida'
WHERE id = $1 AND NOT EXISTS (SELECT 1 FROM midiabot_envioativo_fila WHERE id_campanha = $1 AND status = 'pendente');
```

**Por que uma falha não trava a campanha inteira**: sem o `On Error: Continue using error output` no `Enviar texto`, uma falha simplesmente para a execução ali — o contato problemático nunca é marcado `falhou`, o `proximo_envio_em` nunca avança, e o próximo tique tenta **o mesmo contato de novo, pra sempre**, travando toda a campanha (os outros contatos nunca recebem nada). Com o tratamento de erro, os dois caminhos (sucesso/falha) convergem no mesmo `atualiza_campanha_proximo_envio`, garantindo que a fila sempre avança.

**Testado de verdade em produção**: campanha de 2 contatos com envio 100% bem-sucedido (mensagens reais recebidas no WhatsApp, com disclaimer); campanha de 2 contatos com um número inválido de propósito — confirmado que fica `falhou` com o motivo, segue pro próximo contato, e a campanha fecha `concluida` sozinha.

## Resgate de contexto + respeito ao "SAIR" — workflow "MidiaBot Chat"

Como o envio de campanha nunca grava em `midiabot_historico_mensagens`, se o cliente final responder, o vendedor veria a resposta solta, sem contexto. E se ele responder "SAIR", precisa ser respeitado pra sempre em campanhas futuras. As duas coisas são resolvidas com **dois ramos paralelos**, plugados num único ponto comum a *todos* os fluxos de mensagem recebida — o node `define sala e vendedor` (mesmo ponto usado tanto pelo caminho que passa pela IA quanto pelo que não passa, então só precisou ser construído uma vez).

```
define sala e vendedor
   ├─→ verifica_contexto_campanha → tem_campanha_pra_contextualizar (IF)
   │      ├─ SIM → monta_mensagem_contexto → insere_contexto_campanha → marca_contextualizado ──┐
   │      └─ NÃO ─────────────────────────────────────────────────────────────────────────────────┤
   │                                                                                                ▼
   │                                                                 (segue pro node que já existia, ex.: "verifica messagetype")
   └─→ verifica_sair (IF) ── SIM → insere_proibicao   (ramo solto, não reconecta em nada)
```

**Princípio de segurança, pedido explicitamente pelo usuário**: nenhum dos dois ramos pode travar o fluxo principal (resposta da IA / inserção da mensagem real), mesmo se algo neles der erro — são recursos auxiliares, não podem competir em importância com o atendimento de verdade. Por isso, os nodes desses ramos usam `Always Output Data` / `Continue On Fail` conforme o caso.

**`verifica_contexto_campanha`** (Postgres, Always Output Data on):
```sql
SELECT f.id AS id_fila, f.dados, f.enviado_em, c.texto, c.instancia, d.disclaimer
FROM midiabot_envioativo_fila f
JOIN midiabot_envioativo_campanha c ON c.id = f.id_campanha
LEFT JOIN midiabot_disclaimer_envio d ON d.id_cliente = c.id_cliente
WHERE f.telefone = $1 AND c.id_cliente = $2 AND f.status = 'enviado' AND f.contextualizado = false
ORDER BY f.enviado_em DESC LIMIT 1;
```
Parâmetros: `{{ [ $('Webhook2').item.json.body.data.key.remoteJid.split('@')[0], $('define sala e vendedor').item.json.id_cliente ] }}`

**`tem_campanha_pra_contextualizar`**: IF Boolean, `{{ $json.id_fila !== undefined }}`, "is true".

**`monta_mensagem_contexto`** (Code): mesma lógica de substituição de `{{placeholders}}` + disclaimer do `monta_mensagem` do tique.

**`insere_contexto_campanha`** (Postgres):
```sql
INSERT INTO midiabot_historico_mensagens
    (datetime, from_me, instance, remote_jid, sender, pushname, mensagem, messagetype, workflow_name, id_cliente, chat_id, nome_remetente)
VALUES
    ($1, true, $2, $3, $4, NULL, $5, 'conversation', $6, $7, $8, 'Campanha');
```
**Ponto-chave**: `datetime` recebe o `enviado_em` original da fila (não `now()`) — é isso que faz a mensagem reconstituída aparecer na ordem cronológica certa no chat, mesmo sendo inserida dias depois.

**`marca_contextualizado`**: `UPDATE midiabot_envioativo_fila SET contextualizado = true WHERE id = $1` — garante que a mesma linha da fila nunca é reconstituída duas vezes.

**`verifica_sair`** (IF, tipo String): `{{ ($('Webhook2').item.json.body.data.message.conversation || '').trim().toLowerCase() }}` igual a `sair` (o `|| ''` evita erro em mensagens sem texto, tipo áudio/imagem).

**`insere_proibicao`** (Postgres, Continue On Fail ligado):
```sql
INSERT INTO midiabot_proibicao_envioativo (id_cliente, telefone)
VALUES ($1, $2)
ON CONFLICT (id_cliente, telefone) DO NOTHING;
```

**Escopo do opt-out**: bloqueia só campanhas futuras. Nunca impede a IA nem o vendedor de continuar atendendo esse número normalmente pelo chat de sempre.

**Testado de verdade**: resgate de contexto confirmado com duas respostas reais consumindo dois contextos pendentes separados, um de cada vez (nunca duas vezes a mesma linha da fila); "SAIR" (maiúsculo, testando case-insensitive) gravou certo na proibição; mensagem normal não gravou nada; e o caso combinado (resposta que dispara os dois ramos ao mesmo tempo) confirmado funcionando sem conflito.

**Cuidado pra testes futuros**: pra simular uma mensagem recebida via `curl` direto no webhook do "MidiaBot Chat", a URL certa **não** é o `API_URL` do `midiabot_chat/config.js` (esse é só pras ações do próprio `chat.html`) — é a URL que aparece no campo `destination` de um payload real capturado da Evolution API (varia por instância/cliente).

## Front-end — `envio_ativo.html`

Página nova, no padrão das outras páginas do painel (sidebar + header + `chamarApi` com `origem: "envioativo"`). Link "Envio Ativo" no menu lateral já existia reservado (sem `href`) em todas as 10 páginas do painel — adicionado agora.

- **Tela inicial**: bloco de download do modelo (`.xlsx` real, embutido como `data:` URI direto no HTML — sem depender de nenhuma chamada ao backend só pra isso) + botão "Nova campanha" + histórico de campanhas anteriores.
- **Assistente de 4 passos**: planilha (upload + resumo de duplicado/opt-out + prévia) → texto (variáveis disponíveis, prévia ao vivo com disclaimer) → configurações (instância, intervalo, grade de horário por dia da semana, quando começar) → revisão final.
- **Acompanhamento**: status, contadores, pausar/retomar/cancelar, lista de contatos com status individual, baixar relatório em CSV (montado no próprio navegador a partir de `relatorio_campanha`, sem action dedicada de export).

Adicionada em `package.json` na lista de build (hardcoded, não é glob — todo arquivo novo precisa entrar nessa lista manualmente ou não é publicado).

**Bug corrigido**: o dropdown de instância inicialmente salvava o `sender` (JID tipo `551155490351@s.whatsapp.net`) em vez do `nome_instancia` (tipo `"Marcelo-1"`) — o node de envio da Evolution API precisa do nome, não do JID. Corrigido pra salvar/exibir `nome_instancia` diretamente.

## Pendências conhecidas (aceitas, não bugs)

- Opt-out só é checado na criação da campanha, não recheckado no momento do envio real (ver "Regras de negócio" acima).
- Sem paginação na lista de contatos da tela de acompanhamento (aceitável pro volume de teste atual, pode precisar rever pra campanhas de milhares de contatos).

## Testes futuros pendentes

- **Campanha atravessando a borda do horário configurado** (pausar sozinha ao sair da janela, retomar sozinha no próximo horário válido, inclusive de um dia pro outro) — todos os testes reais feitos em 2026-08-15/16 foram curtos e imediatos (poucos contatos, mesma sessão), então esse comportamento foi desenhado e implementado, mas **nunca observado de verdade rodando**. Adiado de propósito: o usuário está no período de "aquecimento" dos números junto à Meta/WhatsApp e não quer arriscar volume/robô num teste maior nesse momento. Retomar esse teste quando o aquecimento permitir mais tranquilidade.
