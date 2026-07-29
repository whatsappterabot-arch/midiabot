# MidiaBot — Documentação Técnica

Documento de referência do que foi construído até agora: páginas, banco de dados, convenções de payload e decisões importantes. Serve tanto para retomar o projeto numa sessão nova quanto como referência rápida durante o desenvolvimento.

## Arquitetura

```
Front-end estático (HTML + Tailwind CDN + JS módulos)
        │  fetch POST
        ▼
n8n — dois webhooks:
  LOGIN_URL  → autenticação (Google/Firebase)
  API_URL    → tudo mais, roteado por Switch(plataforma) → Switch(origem) → Switch(acao)
        │
        ▼
PostgreSQL
```

Hospedagem: Cloudfy (`www.midiabot.com.br`). Deploy é **sempre manual**, feito pelo usuário — nunca tentar rodar `npx @cloudfy.io/cli deploy` a partir daqui.

## Padrão de payload

Toda chamada ao `API_URL` segue este formato:
```json
{
  "origem": "nome_do_modulo",
  "plataforma": "whatsapp" | "instagram",
  "acao": "nome_da_acao",
  "id_cliente": 1,
  "dados": { }
}
```

**Regra de ouro nas queries do n8n**: sempre usar parâmetros (`$1, $2...`) no campo separado "Query Parameters" — nunca colar `{{ expressão }}` dentro de aspas simples no texto do SQL (quebra com apóstrofo e é risco de injeção). Nas operações estruturadas do node Postgres (Update/Insert, sem SQL manual), nunca envolver a expressão `{{ }}` com aspas — o node já trata isso.

## Páginas front-end

| Arquivo | Página | Menu lateral |
|---|---|---|
| `index.html` | Login (Google via Firebase) | — |
| `dashboard.html` | Painel inicial | — |
| `instancias.html` | Instâncias | Instâncias |
| `proibicoes.html` | Proibições de IA | Proibições de IA |
| `telegram_sender.html` | Conectores de Telegram | Conectores de Telegram |
| `consultores.html` | Atribuição a Consultores | Atribuição a Consultores |
| `vendedores.html` | Lista de Consultores | Lista de Consultores |
| `horarios.html` | Horários | Horários |
| `prompts.html` | Prompts | Prompts |
| `config.js` | `CONFIG` (URLs) + `showToast()` (toast de notificação, usado em vez de `alert()`) | — |

Todas as páginas (exceto index/dashboard) têm: sidebar com logo + toggle WhatsApp/Instagram + menu dinâmico; header com título + nome/ID do usuário + logout; import de `CONFIG` e `showToast` de `config.js`.

## Sequência de configuração de um cliente novo

Ordem esperada até o sistema funcionar de ponta a ponta, pra um cliente com todas as tabelas limpas:

1. **Instâncias** — cria a(s) instância(s), conecta via QR code, atribui um workflow a cada uma.
2. **Conectores de Chat** — cria a(s) sala(s) de cada workflow usado, atrelando (na hora ou depois) os senders órfãos das instâncias do passo 1.
3. **Prompts** — escreve os prompts de IA (horário de trabalho / fora do horário) pra cada sala do passo 2.
4. **Horários** — define o expediente de cada workflow, que decide qual dos dois prompts do passo 3 vale em cada momento.
5. **Senhas do MidiaChat** — cria login pros consultores acessarem as salas do passo 2 e lerem as mensagens.

Opcionais, só se o fluxo do cliente precisar:

6. **Atribuição a Consultores / Lista de Consultores** — distribuição automática de leads pra vendedores.
7. **Proibições de IA** — números que pulam a IA e vão direto pro atendente humano.

**Atribuição de Chat** não faz parte dessa sequência inicial — só passa a ser útil depois, com conversas reais já acontecendo (`midiabot_historico_mensagens` populado), pra mover um cliente específico pra outra sala.

## Tabelas do banco (PostgreSQL, schema `public`)

### `midiabot_cad_usuarios` (pré-existente)
Cadastro de clientes/usuários. Campos usados: `id`, `email`, `nome`, `whatsapp`, `plano_id`, `ativo`, `criado_em`, `nome_fantasia` (adicionado nesta sessão — `TEXT`, `UNIQUE`, nullable até existir tela de cadastro; usado como identificador digitável do cliente no login do Midiabot_chat, evitando expor a lista de clientes numa tela pública; comparar sempre com `LOWER(TRIM(...))` pra tolerar diferença de maiúscula/espaço). `id` é referenciado como `id_cliente` em quase todas as outras tabelas.

### `midiabot_a_workflows`
Catálogo global de workflows disponíveis (lista reduzida, curada pelo admin).
```sql
id SERIAL PRIMARY KEY,
nome TEXT NOT NULL UNIQUE
```
**Atenção — divergência encontrada nesta sessão**: a coluna `webhook_url`, descrita abaixo em "Webhook por workflow" e usada supostamente por `salvar_workflow`, **não existe** na tabela real (conferido via `information_schema.columns`). Ou foi removida em algum momento não documentado, ou a seção "Webhook por workflow" já estava desatualizada/nunca chegou a ser implementada assim. Precisa esclarecer com o usuário como `salvar_workflow` realmente aponta o webhook da instância hoje.

### `midiabot_cad_planos`
Catálogo de planos (referenciado por `midiabot_cad_usuarios.plano_id`). Não documentado até esta sessão.
```sql
id INTEGER PRIMARY KEY,
nome VARCHAR NOT NULL,
whatsapp INTEGER NOT NULL,   -- CHECK IN (0,1)
instagram INTEGER NOT NULL, -- CHECK IN (0,1)
limite_mensagens_whatsapp INTEGER NOT NULL,
descricao TEXT
```

### `midiabot_a_instancias`
Uma instância = um número de WhatsApp conectado via Evolution API.
```sql
id SERIAL PRIMARY KEY,
id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
nome_instancia TEXT UNIQUE,   -- identificador estável; nome digitado + "-{id_cliente}" (sufixo aplicado no n8n)
sender TEXT UNIQUE,           -- número conectado (formato numero@s.whatsapp.net); mutável
workflow_name TEXT REFERENCES midiabot_a_workflows(nome),
criado_em TIMESTAMP NOT NULL DEFAULT now()
```
**Importante**: `nome_instancia` é o identificador estável de uma instância; `sender` pode mudar (reconectar com outro número). Nunca usar `sender` como chave de longo prazo em outras tabelas — usar `nome_instancia`.

### `midiabot_remotejid_proibidos` (Proibições de IA)
Números cujas mensagens pulam a IA e vão direto pro atendente humano.
```sql
remotejid TEXT,
id_cliente INTEGER,
PRIMARY KEY (id_cliente, remotejid)  -- corrigido de PK(remotejid) sozinho
```

### `midiabot_sender_chatid` (Conectores de Chat)
Liga o sender de uma instância à sua sala padrão.
```sql
sender VARCHAR NOT NULL,   -- número da instância (numero@s.whatsapp.net)
chat_id BIGINT NOT NULL,   -- sala padrão
id_cliente INTEGER,        -- nullable
chat_id_nome TEXT,         -- nullable
PRIMARY KEY (sender)  -- confirmado correto: um sender só aponta pra 1 sala por vez
```
**Atenção — coluna `chat_id_nome` encontrada nesta sessão, não documentada antes**: essa tabela tem seu próprio `chat_id_nome`, separado do `chat_id_nome` de `midiabot_chatid_workflowname` (o catálogo oficial de salas). Provável resquício de antes de `midiabot_chatid_workflowname` existir — precisa confirmar com o usuário se ainda é usado em algum lugar ou se pode ser ignorado/removido.

### `midiabot_chatid_workflowname` (salas de chat — Conectores de Chat)
Catálogo de salas (chat_id) do cliente. Cada sala pertence a exatamente um workflow — nunca compartilhada entre workflows (regra de negócio, não só de schema).
```sql
id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
chat_id INTEGER NOT NULL GENERATED BY DEFAULT AS IDENTITY (START WITH -1 INCREMENT BY -1),
chat_id_nome TEXT,
workflow_name TEXT NOT NULL REFERENCES midiabot_a_workflows(nome),
PRIMARY KEY (id_cliente, chat_id)
```
`chat_id` é **gerado pelo banco** (negativo, decrescente a partir de -1) — nunca digitado pelo gestor do cliente. Criada só pela tela **Conectores de Chat** (`origem: conect_telegram`, ação `criar_sala`); a tela **Atribuição de Chat** nunca cria sala, só move um `remotejid` entre salas já existentes do mesmo workflow. Uma sala pode existir sem nenhum sender atrelado.

### `midiabot_remotejid_chatid` (Atribuição de Chat + Midiabot_chat)
Sala atual de cada cliente final (`remote_jid`) — inclui `arquivada`, usado pelo Midiabot_chat (ver `midiabot_chat/Midiabot_chat.md`).
```sql
id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
remotejid TEXT NOT NULL,
chat_id INTEGER,
arquivada SMALLINT NOT NULL DEFAULT 0,  -- adicionado nesta sessão, uso do Midiabot_chat
PRIMARY KEY (id_cliente, remotejid)
```
**Lógica de preenchimento (decisão desta sessão, muda o modelo mental da tabela)**: ao chegar mensagem, o fluxo verifica se aquele `remotejid` já tem `chat_id` aqui; se não tiver, atribui o `chat_id` a partir do padrão do sender (`midiabot_sender_chatid`) e grava. Ou seja, a tabela deixa de ser esparsa (só atribuição manual) e passa a ganhar uma linha pra **toda** conversa, logo na primeira mensagem. Consequência: uma vez atribuído, o `chat_id` fica fixo pra aquele cliente mesmo que o padrão do sender mude depois — é assim que o gestor consegue transferir um cliente de um vendedor/sala pra outro sem que isso seja desfeito pela próxima mudança de padrão. O `COALESCE` com `midiabot_sender_chatid` (usado em `listar_remotejids`) vira rede de segurança pra dado anterior a essa lógica, não o mecanismo principal.

### `midiabot_sorteio_vendedor` (Atribuição a Consultores)
Configuração de distribuição de leads por workflow.
```sql
id_cliente INTEGER,
workflow_name TEXT,
sorteio SMALLINT,              -- CHECK IN (0,1). 1 = escolha automática (rotaciona vendedores); 0 = manual
vendedor_escolhido INTEGER,    -- CHECK > 0
PRIMARY KEY (id_cliente, workflow_name)  -- corrigido de PK(workflow_name) sozinho
```
**Atenção — FK duplicada e conflitante, encontrada nesta sessão**: hoje existem **duas** foreign keys em `(id_cliente, vendedor_escolhido)` ao mesmo tempo — uma pra `midiabot_vendedores(id_cliente, id_vendedor)` (a antiga, de antes da separação de identidade) e outra pra `midiabot_login_chat(id_cliente, id_vendedor)` (a nova, correta — é `midiabot_login_chat` que tem a identidade completa do vendedor agora). As duas juntas obrigam `vendedor_escolhido` a existir nas duas tabelas simultaneamente, o que funciona hoje só porque, na prática, todo vendedor cadastrado tem linha nas duas — mas é redundante e arriscado. **Recomendo derrubar a FK antiga (`midiabot_sorteio_vendedor_vendedor_fkey`, a que aponta pra `midiabot_vendedores`) e manter só a nova (`fk_midiabot_sorteio_vendedor_vendedor`, pra `midiabot_login_chat`)** — ainda não fiz isso, só documentei o achado.

### `midiabot_vendedores` (Lista de Consultores)
**Alterado nesta sessão**: `workflow_name` removido — um vendedor deixa de ser por-workflow e vira uma identidade única por cliente (qualquer vendedor pode ser sorteado/atribuído em qualquer workflow do cliente; decisão consciente, sem trava de "esse vendedor só atende esse fluxo"). `nome_vendedor`, `ativo`, `cor_emoji`, `login`, `senha` saíram daqui e foram pra `midiabot_login_chat` (ver abaixo) — o que restou aqui é só o vínculo de `sender`.
```sql
id_vendedor INTEGER,    -- 1 a 10, por cliente (CHECK, mesmo intervalo de midiabot_login_chat)
sender TEXT,            -- número do CONSULTOR (pessoa da equipe), não confundir com sender de instância
id_cliente INTEGER,
PRIMARY KEY (id_cliente, id_vendedor)
```
Linhas são pré-cadastradas manualmente pelo admin (sem tela de inclusão/exclusão — decisão consciente, pendente de repensar se quiserem self-service).

### `midiabot_login_chat` (Senhas do MidiaChat + identidade do vendedor)
Guarda a identidade completa do vendedor e a credencial de acesso ao Midiabot_chat — separado de `midiabot_vendedores` (que só guarda o vínculo de `sender`).
```sql
id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
id_vendedor INTEGER NOT NULL CHECK (id_vendedor BETWEEN 1 AND 10),
nome_vendedor TEXT,
login TEXT,
senha TEXT,             -- NULL = sem senha definida, vendedor não consegue logar
cor_emoji TEXT,
ativo SMALLINT,         -- 0 ou 1
PRIMARY KEY (id_cliente, id_vendedor),
UNIQUE (id_cliente, login)  -- login único dentro do cliente, mas pode repetir entre clientes diferentes
```
`ativo` aqui é o que alimenta o sorteio de leads (`midiabot_sorteio_vendedor`/`listar_vendedores_ativos`), não `midiabot_vendedores`. "Suspender acesso" (checkbox da tela) só zera `senha` — não mexe em `ativo`. Senha em branco na criação também vira `NULL` (`NULLIF(valor, '__SEM_ALTERACAO__')` no `INSERT`), nunca o texto literal do sentinel de "sem alteração".

### Tabelas encontradas nesta sessão (esclarecidas com o usuário)
Apareceram num levantamento completo do banco (`information_schema.columns`/`pg_constraint` filtrado por `midiabot%`), sem nenhuma menção anterior nesta documentação — provavelmente construídas na sessão anterior que se perdeu. Já esclarecidas:

**`midiabot_atribuicao_vendedor`** — **removida nesta sessão** (`DROP TABLE`). Era um mecanismo antigo de atribuir vendedor a um `remotejid` por workflow. Confirmado com o usuário: quem decide o vendedor é `midiabot_sorteio_vendedor` (a regra), e quem registra a relação `remotejid`↔sala/vendedor é `midiabot_remotejid_chatid` — essa tabela antiga ficou redundante. Se o Midiabot_chat não vingar, o usuário disse que remonta.

**`midiabot_messagethreadid_remotejid`** — ainda existe, mas confirmado como **fadada a desaparecer** assim que o Midiabot_chat estiver funcionando (é o antigo conceito de `message_thread_id` que este projeto decidiu não usar — ver `midiabot_chat/Midiabot_chat.md`). Não usar em nada novo.

**`midiabot_whats_versus_telegram`** — confirmado pelo usuário: é resíduo do tempo em que usavam Telegram, **ainda em uso**, só será apagada depois que o Midiabot_chat estiver funcionando. Guarda `last_instance` — a instância (número de WhatsApp) por onde aquele cliente escreveu, necessária pra saber por qual instância mandar a resposta de volta.

**Lacuna descoberta por causa disso**: `midiabot_remotejid_chatid` (o mecanismo novo, usado pelo Midiabot_chat) guarda `chat_id` mas **não guarda qual instância usar pra responder** — ao contrário de `midiabot_whats_versus_telegram`, que tinha `last_instance` pra isso. Precisa decidir: vira coluna nova em `midiabot_remotejid_chatid`, ou é derivado de `midiabot_historico_mensagens.instance` (que já guarda isso por mensagem) na hora de responder? Pendência a resolver antes de implementar o envio de mensagens do Midiabot_chat.

### `midiabot_z_horarios_trabalho` (Horários)
```sql
id_cliente INTEGER,
workflow_name TEXT,
dia_semana SMALLINT,  -- CHECK 0-6. 0=Domingo, 1=Segunda... 6=Sábado (convenção do Postgres EXTRACT(DOW))
hora_inicio TIME,
hora_fim TIME,
PRIMARY KEY (id_cliente, workflow_name, dia_semana)  -- corrigido: antes incluía hora_inicio na PK (bug: editar duplicava linha)
```
`salvar_horario` usa UPSERT (`ON CONFLICT DO UPDATE`) — linha é criada na primeira vez que aquele dia é salvo, sem pré-cadastro necessário. Front-end sempre desenha os 7 dias, mesmo sem dado no banco ainda.

### `midiabot_z_excessoes_horarios` (Horários — exceções)
```sql
id SERIAL PRIMARY KEY,
workflow_name TEXT,
data DATE,
hora_inicio TIME,      -- nullable (feriado inteiro = sem horário)
hora_fim TIME,         -- nullable
descricao TEXT,        -- nullable
id_cliente INTEGER
```
Só `data` é obrigatória. Inclusão/exclusão apenas, sem edição.

### `midiabot_z_prompts_ia` (Prompts)
```sql
id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
chat_id INTEGER NOT NULL,
trabalho_on SMALLINT NOT NULL,  -- 1 = prompt de horário de trabalho; 0 = fora do horário
prompt TEXT,                     -- até ~10.000 caracteres, sem limite rígido
PRIMARY KEY (id_cliente, chat_id, trabalho_on),
FOREIGN KEY (id_cliente, chat_id) REFERENCES midiabot_chatid_workflowname (id_cliente, chat_id)
```
Chaveado por `chat_id` (sala), não por `nome_instancia` — decisão revista nesta sessão. Motivo: duas instâncias podem compartilhar uma sala (e devem falar com a mesma "voz"), e mover um `remote_jid` pra outra sala via Atribuição de Chat só faz sentido de verdade se isso também mudar qual prompt a IA usa pra ele. O fluxo de mensagens (produção) precisa resolver a sala efetiva do remetente (mesmo `COALESCE` de `midiabot_remotejid_chatid`/`midiabot_sender_chatid` usado em `listar_remotejids`) antes de buscar o prompt. `salvar_prompts` usa UPSERT (2 vezes, uma por `trabalho_on`).

### `midiabot_historico_mensagens` (histórico de chat — WhatsApp/Telegram)
Tabela pré-existente (não criada por nós), usada pelo fluxo de produção que já roda mensagens reais. Ajustada nesta sessão pra ganhar `id_cliente` e `chat_id`.
```sql
id INTEGER PRIMARY KEY DEFAULT nextval('midiabot_historico_mensagens_id_seq'),
datetime TIMESTAMPTZ NOT NULL DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo'),
from_me BOOLEAN NOT NULL DEFAULT false,  -- true = o sender (número do cliente) enviou; false = o sender recebeu
instance TEXT NOT NULL,       -- = nome_instancia (não é FK — histórico sobrevive à instância ser apagada, é regra de negócio)
remote_jid TEXT NOT NULL,     -- número do contato externo (cliente do seu cliente) na conversa
sender TEXT NOT NULL,         -- número do WhatsApp do CLIENTE (mesmo conceito de midiabot_a_instancias.sender), nome mantido igual ao que o Evolution API manda
pushname TEXT,
mensagem TEXT,
caption TEXT,
messagetype TEXT,
mime_type TEXT,
midia TEXT,
base64 TEXT,
workflow_name VARCHAR,
id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),  -- adicionado nesta sessão; backfill manual = 1 pras linhas antigas
chat_id INTEGER  -- adicionado nesta sessão; supergrupo do Telegram pra onde a mensagem foi encaminhada, sem FK (chat_id não é único em midiabot_sender_chatid)
```
Nomes de sequência/constraint da PK foram renomeados nesta sessão pra bater com o nome atual da tabela (antes eram resquício de nomes antigos: `historico_mensagens_terabot_teste_id_seq` e `historico_menssagens_midiabot_scenty_pkey`). Ideia futura do usuário (ainda não decidida): aposentar o Telegram como canal de notificação e construir um chat próprio — mantendo o conceito de `chat_id` porque a forma como o Telegram estrutura isso é considerada inteligente.

### `midiabot_instrucoes` (textos de ajuda "?" nas telas)
```sql
id SERIAL PRIMARY KEY,
info_pagina VARCHAR(20) UNIQUE,   -- identificador da página, ex: 'instancias'
texto_instrucao VARCHAR(10000)    -- HTML simples (<b>, <u>, <br>), renderizado via innerHTML
```
Sendo adicionado gradualmente, uma página de cada vez.

## Ações por `origem`

| origem | ações |
|---|---|
| `proibicoes` | `listar`, `incluir`, `excluir` |
| `conect_telegram` (Conectores de Chat) | `listar`, `listar_workflows`, `listar_senders_orfaos`, `criar_sala` (2 passos: cria a sala com `RETURNING chat_id`; se vier `sender`, atrela em seguida), `atrelar_sender` (UPSERT), `desatrelar_sender` |
| `atribuicao_chat` (Atribuição de Chat) | `listar_workflows`, `listar_chatids`, `listar_remotejids`, `salvar_atribuicao` (UPSERT) |
| `sorteio_vendedor` | `listar_workflows`, `buscar_config`, `salvar` (UPSERT) |
| `vendedores` | `listar_workflows`, `listar`, `salvar` |
| `horarios` | `listar_workflows`, `listar_horarios`, `salvar_horario` (UPSERT), `listar_excecoes`, `incluir_excecao`, `excluir_excecao` |
| `prompts_ia` | `listar_workflows`, `listar_chatids` (dropdown fluxo → sala, igual Atribuição de Chat), `buscar_prompts`, `salvar_prompts` (UPSERT, por `chat_id`) |
| `instancias` | `listar_catalogo_workflows`, `listar_instancias`, `criar_instancia`, `gerar_qrcode`, `salvar_workflow`, `desconectar_instancia`, `apagar_instancia`, `buscar_instrucao` |

## Fluxo `listar_instancias` (o mais complexo)

```
Postgres "Listar Instâncias" (SELECT nome_instancia, sender, workflow_name WHERE id_cliente=$1)
   → Loop Over Items (batch size 1)
        → [loop] Evolution API "Buscar Instância" (nome_instancia como parâmetro)
        → Postgres "Atualizar Sender" (UPDATE ... WHERE nome_instancia=$2 AND $3='open' — condicional dentro do WHERE, sem node IF)
        → Postgres "Buscar Sender Atualizado" (SELECT sender, workflow_name WHERE nome_instancia=$1)
        → Edit Fields "Montar Item Final" (nome_instancia/connectionStatus do node Evolution por nome; sender/workflow_name do SELECT novo)
        → volta pro Loop
   → [done] Respond to Webhook (All Incoming Items)
```

Status exibido na tela: dois badges separados — "API" (`connectionStatus === 'open'`, ao vivo) e "Banco de dados" (`!!sender`, o que está salvo). Botão **Desconectar** aparece se pelo menos um estiver conectado (serve também pra corrigir divergência); **Gerar QR Code** + **Apagar Instância** só aparecem quando os dois estão desconectados.

## Integração Evolution API

- Servidor: `https://awkwardgiantpanda-evolution.cloudfy.live` (versão 2.3.7)
- Documentação oficial: `https://docs.evolutionfoundation.com.br`
- **Bug conhecido**: o node de comunidade "Evolution API" no n8n não processa múltiplos itens corretamente (mesmo com "Execute Once" desligado) — precisa envolver em **Loop Over Items** (batch 1) pra forçar uma chamada por item.
- **Bug conhecido**: o campo "Base64 No Webhook" desse mesmo node não funciona (API sempre devolve `false`) — usar **HTTP Request** direto pra configurar webhook.
- **Endpoint "Set Webhook"**: `POST /webhook/set/{instanceName}`, header `apikey`, corpo `{"webhook": {"enabled": bool, "url": "...", "events": [...], "base64": bool}}` — reparar que é **aninhado em `"webhook"`**, diferente do que a documentação mostra (a doc está desatualizada/diferente da versão rodando; confiar no erro real do servidor).
- **Endpoint "Logout"**: `DELETE /instance/logout/{instanceName}`, sem corpo. Retorna erro se a instância já estiver desconectada — tratar com "On Error: Continue" + "Always Output Data" no node, seguindo pro UPDATE que limpa o `sender` de qualquer forma.
- **Eventos de webhook relevantes**: `CONNECTION_UPDATE` (mudança de conexão — não usado no fim, resolvido via consulta ao vivo em vez de webhook), `QRCODE_UPDATED`, `MESSAGES_UPSERT` (mensagem nova — usado pro roteamento de IA por workflow).
- **QR code**: campo `base64` já vem com o prefixo completo `data:image/png;base64,...` — não adicionar prefixo de novo no front-end.
- **`groupsIgnore: true`**: deve ser configurado na criação de toda instância nova, sem opção do usuário desligar — evita a IA responder autonomamente em grupos de consultores (risco de loop). *(Pendente confirmar se já está no node "Criar Instância".)*
- **Nome da instância**: sempre `{nome digitado}-{id_cliente}` (sufixo aplicado no n8n via Edit Fields, nunca no front-end), pra nunca colidir entre clientes.

## Webhook por workflow (roteamento de mensagens)

**Seção desatualizada, achado nesta sessão**: o texto abaixo descreve o desenho original, mas `midiabot_a_workflows` não tem mais (ou nunca teve de verdade) a coluna `webhook_url` — conferido via `information_schema.columns`. Precisa perguntar ao usuário como `salvar_workflow` aponta o webhook da instância hoje de fato, antes de confiar neste texto.

Desenho original (pode estar desatualizado): cada linha de `midiabot_a_workflows` teria sua própria `webhook_url` (um fluxo n8n distinto por automação). Ao atribuir/trocar o workflow de uma instância (`salvar_workflow`): busca a `webhook_url` daquele workflow e chama `/webhook/set/{instanceName}` apontando pra lá, assinando `MESSAGES_UPSERT`. Se o workflow for removido (opção "Nenhum" no dropdown) ou não tiver `webhook_url` cadastrada ainda, desativa o webhook (`enabled: false`) em vez de deixar apontado pra lugar errado.

## Decisões e convenções importantes

- **Toasts, não alert()**: `showToast(mensagem, tipo)` em `config.js`, tipos `success`/`error`/`warning`.
- **Favicon + fonte Inter**: aplicados em todas as páginas.
- **Build**: `package.json` → `npm run build` copia todos os HTMLs + `config.js` + `logo.png` pra `dist/`. No Windows, rodar via Bash (não PowerShell/cmd), senão `mkdir -p` falha.
- **Deploy**: manual, feito pelo usuário. Nunca tentar rodar por conta própria.
- **`CLAUDE.md.txt`**: contém a deploy key do Cloudfy em texto puro — está no `.gitignore`, nunca deve ser commitado.
- **Lacuna de segurança conhecida e aceita por decisão do usuário**: não há autenticação real por requisição — `id_cliente` é um valor que o próprio navegador informa, sem verificação no servidor. Qualquer pessoa que descubra a URL do webhook pode agir como qualquer cliente. Decisão consciente de adiar a correção pro final do projeto.

## Pendências em aberto

- Confirmar `groupsIgnore: true` no node "Criar Instância".
- Autenticação real por requisição (adiado deliberadamente).
- Tela de criação de vendedores (hoje só edição, sem inclusão/exclusão — decisão consciente).
- Textos de ajuda ("?") ainda só existem pra tela de Instâncias; falta adicionar nas outras, aos poucos.
- Decidir como o Midiabot_chat vai saber por qual instância responder (`midiabot_remotejid_chatid` não guarda isso hoje — ver seção "Tabelas encontradas nesta sessão").
- Derrubar a FK antiga e duplicada em `midiabot_sorteio_vendedor` (a que aponta pra `midiabot_vendedores`; manter só a que aponta pra `midiabot_login_chat`).
- Confirmar como `salvar_workflow` aponta o webhook de uma instância hoje, já que `midiabot_a_workflows.webhook_url` não existe (a seção "Webhook por workflow" pode estar desatualizada).
- Confirmar se `midiabot_sender_chatid.chat_id_nome` ainda é usado em algum lugar ou é resquício.
