# Midiabot_chat — Conceito

Chat próprio, feito pra substituir o uso de supergrupo do Telegram (com tópicos) como canal de atendimento humano. Motivo: numa pré-implantação real, os vendedores se perderam na tela do Telegram — não dá pra apontar um problema específico, mas a tela é considerada rebuscada demais pra quem não usa o app no dia a dia.

**Convenção de diretório**: todo arquivo deste produto vive em `/midiabot_chat/`, nunca na raiz do projeto (a raiz é do painel administrativo). Tabelas novas do Midiabot_chat usam o prefixo `midiabot_midiachat_`.

**Login**: quadrinho na tela inicial do `midiabot.com.br` com 3 campos — `nome_fantasia` (digitado, não uma lista/dropdown de clientes, pra não expor publicamente quem são os clientes do MidiaBot), `login` e `senha`. `nome_fantasia` mora em `midiabot_cad_usuarios` (coluna nova, `UNIQUE`), e serve pra identificar de qual `id_cliente` é o vendedor que está logando — só assim dá pra permitir login/senha repetidos entre empresas diferentes. Comparar sempre com `LOWER(TRIM(...))` (tolerar diferença de maiúscula/espaço), nunca comparação exata crua. O destino após login é sempre dentro de `/midiabot_chat/`. `login`+`senha` (e `nome_vendedor`, `ativo`, `cor_emoji`) moram em `midiabot_login_chat` — ver tabela em `DOCUMENTACAO_TECNICA.md`.

## Como a mensagem chega numa sala

O roteamento de mensagens (recebimento e distribuição) é feito por um fluxo no n8n, já existente. Mensagens que precisam de resposta humana devem receber, nesse fluxo, um `chat_id` (a sala) — e dentro da sala, a conversa é identificada só pelo `remote_jid` do cliente, sem nenhum ID adicional.

**Decisão**: eliminado o conceito de `message_thread_id` (ideia herdada por analogia ao Telegram, onde o tópico é uma entidade própria da API deles). Como o Midiabot_chat é um chat construído do zero, não existe essa necessidade — o par `(chat_id, remote_jid)` já identifica uma conversa de forma única e completa, sem risco de duas informações (thread id e remote_jid) descolarem uma da outra.

Consequência prática: **não é preciso construir a tabela de roteamento** que estava planejada (`chat_id` + `message_thread_id` + `remoteJid`). Ela já existe, hoje, como `midiabot_remotejid_chatid` (`id_cliente`, `remotejid`, `chat_id`, `arquivada`).

**Lógica de preenchimento (decisão desta sessão)**: ao chegar mensagem, o fluxo verifica se aquele `remotejid` já tem `chat_id` em `midiabot_remotejid_chatid`; se não tiver, atribui a partir do padrão do sender (`midiabot_sender_chatid`) e grava. A tabela deixa de ser esparsa (só atribuição manual) e passa a ganhar uma linha pra **toda** conversa, na primeira mensagem. Consequência desejada: uma vez atribuído, o `chat_id` fica fixo pra aquele cliente mesmo que o padrão do sender mude depois — é assim que o gestor consegue transferir um cliente de um vendedor/sala pra outro (via Atribuição de Chat) sem que a próxima mudança de padrão desfaça isso. O `COALESCE` com `midiabot_sender_chatid` (já usado em `listar_remotejids`) vira rede de segurança pra dado anterior a essa lógica, não o mecanismo principal.

## Telas

### Desktop — 3 colunas

**Coluna esquerda — lista de contatos**
- Lista os contatos mais recentes que mandaram mensagem (não arquivados), com link pra abrir os **arquivados**.
- Cada linha mostra só o número, com um ícone pequeno de edição ao lado.
- Clicar no ícone abre um painel com todas as informações do contato: campo de observações, e a possibilidade de colocar um emoji no início do apelido do cliente. Emoji e apelido são livres — cada equipe de vendedores define o próprio significado pra eles (não é um código fixo do sistema).
- Observações e apelido/emoji são **compartilhados**: qualquer consultor que atenda aquele cliente vê e edita o mesmo dado, não é pessoal por consultor. Guardados em `midiabot_midiachat_contato` (ver schema na seção "Decisões fechadas nesta rodada").
- Arquivar também é **compartilhado** (não é por consultor): uma conversa arquivada some da lista principal pra todo mundo, e volta a aparecer sozinha assim que o cliente manda mensagem nova. Clicar em "ARQUIVADAS" mostra as arquivadas pra qualquer consultor. Guardado na coluna `arquivada` de `midiabot_remotejid_chatid` (ver seção "Como a mensagem chega numa sala").

**Coluna do meio — conversa aberta**
- Fundo da tela: bege-clarinho. Estilo das mensagens inspirado no WhatsApp: enviadas em balão verde-claro, fonte preta, alinhadas à direita, até 90% da largura da coluna. Recebidas em balão branco, fonte preta, alinhadas à esquerda, até 90% da largura.
- Não repete apelido nem controle de arquivar — isso já está na coluna esquerda.
- **Cabeçalho fino no topo** (nome/número do contato + ícone "⋮"), presente tanto no desktop quanto no celular (no celular ocupa o topo da tela cheia da conversa). O "⋮" abre um menu com os **botões de controle de fluxo** — ações sobre a conversa aberta, escondidas ali de propósito pra não gastar espaço fixo na tela (importante no celular) e pra sobrar espaço pra crescer com mais botões no futuro. Primeiro botão: **pausar a IA por N horas** nesse `remote_jid` — diferente de "Proibições de IA" (`midiabot_remotejid_proibidos`), que é permanente e só o gestor mexe; esse é temporário, o próprio vendedor ativa, e expira sozinho. Implementação: chave no **Redis** com TTL (nunca precisa de rotina de limpeza depois).

**Coluna direita — assistente de IA**
- **Redimensionável, arrastando a divisória entre ela e a coluna do meio** — mas nunca pode desaparecer de todo: fica sempre um mínimo de **10% de largura visível**, pra o vendedor nunca achar que ela deixou de existir. Só essa divisória é arrastável (a da esquerda, entre contatos e conversa, fica fixa — decisão consciente, pra não correr o mesmo risco de "sumiço" também na lista de contatos, que não teria tanto ganho em ser redimensionável). **Não aparece no celular.**
- De cima pra baixo:
  1. Espaço onde a resposta da IA aparece.
  2. Campo onde o consultor escreve a pergunta pra IA.
  3. Campo numérico editável (**4 a 15**) — quantas mensagens do histórico daquela conversa entram como contexto pra IA — e o botão de enviar, os dois juntos, abaixo do campo de pergunta.
- O prompt/instrução dessa IA conselheira **não é o mesmo** cadastrado em "Prompts" (que fala com o cliente final) — é um texto separado. Decisão: por ora (v1) fica **fixo direto no node do n8n**, sem tela de cadastro; formalizar isso num cadastro editável fica pra v2, quando o chat principal já estiver funcionando.

### Seletor de salas
- Uma faixa horizontal fina de abas, no topo de tudo (acima das 3 colunas).
- Todo consultor tem acesso a **todas as salas**.
- Existe uma relação **N-pra-N** entre sala e vendedor "proprietário" (uma sala pode ter um, dois ou mais donos), em `midiabot_midiachat_sala_vendedor` (`id_cliente`, `chat_id`, `id_vendedor` — PK nas três, FK de `id_cliente+chat_id` pra `midiabot_chatid_workflowname`, FK de `id_cliente+id_vendedor` pra `midiabot_login_chat` — é essa a tabela com a identidade completa do vendedor, não `midiabot_vendedores`, que hoje só guarda `sender`). Salas em que o consultor logado é proprietário aparecem com uma cor de fundo diferente na aba.
- Cada aba mostra, de preferência, quantas conversas desarquivadas daquela sala têm mensagem sem resposta (contador de pendências).

### Mobile
- Navegação em uma tela por vez, estilo WhatsApp: lista de contatos → toca → conversa aberta em tela cheia, com botão de voltar.
- Sem coluna de IA nenhuma (nem colapsada).
- O seletor de salas vira um dropdown, em vez da faixa de abas do desktop.

## Tempo real (mensagem chegando ao vivo)

**Saída (chat → n8n → WhatsApp)**: **decisão revista** — usa o mesmo mecanismo *notify-then-fetch* da entrada, não aparece na tela na hora que o vendedor aperta enviar.
```
Vendedor manda mensagem → webhook n8n
    → ramo 1: Evolution API (envia de verdade pro WhatsApp)
    → ramo 2: INSERT no Postgres (midiabot_historico_mensagens, from_me = true)
    → Pusher dispara evento leve no canal do cliente
    → navegador do vendedor (o mesmo que mandou) recebe o evento
    → chat faz o SELECT e só aí renderiza a mensagem como enviada
```
Motivo da escolha consciente: só mostra como "enviada" depois que o banco confirma que foi processada — se a Evolution API falhar (instância desconectada, número bloqueado), não corre o risco de exibir como enviada uma mensagem que não saiu de verdade. Custo aceito: pequena demora entre apertar enviar e ver a mensagem aparecer. Um único caminho de renderização serve tanto pra mensagem enviada quanto recebida, sem lógica separada de exibição otimista.

**Entrada (WhatsApp → n8n → chat)**: padrão *notify-then-fetch*, usando Pusher.
```
WhatsApp → Evolution API → webhook n8n
    → n8n resolve o chat_id (mesmo COALESCE já usado em listar_remotejids)
    → n8n faz INSERT da mensagem no Postgres (mesmo banco do resto do MidiaBot)
    → n8n chama a API do Pusher (HTTP Request comum, servidor-a-servidor) disparando
      um evento LEVE (ex: {chat_id, remote_jid, message_id}) — nunca o conteúdo
      completo da mensagem, porque mídia (áudio/vídeo/imagem/documento) estoura o
      limite de tamanho de evento do Pusher
    → navegador do consultor, inscrito no canal, recebe o evento
    → chat faz um SELECT (via webhook n8n) pra buscar a mensagem completa e renderizar
```
O n8n nunca segura conexão WebSocket nenhuma — só faz uma chamada HTTP comum pro Pusher. É o Pusher que mantém a conexão com os navegadores.

**Granularidade do canal: um canal por `id_cliente`** (não por `chat_id`, não por `remote_jid`/conversa individual). Descartado por conversa individual: geraria centenas/milhares de canais, inviável, e não serve pra visão agregada (contador de pendência na faixa de abas, reordenar lista de contatos de conversas que não estão abertas). Empatado com `chat_id` em volume de dado recebido, porque **todo consultor acessa todas as salas** — mas `id_cliente` exige só uma inscrição por sessão (feita uma vez no login) em vez de N, sem perder nada. Se um dia o acesso deixar de ser "todo mundo vê tudo", reconsiderar por `chat_id`.

**Segurança do canal — decisão importante**: o canal precisa ser **privado** (`private-cliente-{id_cliente}`), nunca público, porque expõe conversas reais de clientes ao vivo. A chamada n8n→Pusher (publicar) não tem esse problema, é servidor-a-servidor. O problema é a inscrição navegador→Pusher: o Pusher exige que um endpoint seu autorize a inscrição antes de liberar o canal privado.

Isso só é seguro de verdade se esse endpoint souber provar quem está pedindo — e o resto do painel administrativo **não tem isso** (`id_cliente` é só um valor que o navegador informa, sem verificação, decisão consciente e aceita só pra a parte de configuração). Copiar esse mesmo modelo pro chat seria teatro de segurança, porque o risco aqui é maior (vazamento de conversa ao vivo, não só manipulação de configuração).

**Decisão**: não é preciso corrigir a lacuna de autenticação do painel inteiro antes de construir o chat. O MidiaChat já nasce com login de verdade (usuário+senha, via "Senhas do MidiaChat" — diferente do resto do painel). Ao validar login com sucesso, o backend deve emitir um **token de sessão assinado**, e é esse token — não um `id_cliente` alegado pelo navegador — que autentica tanto as chamadas normais do chat quanto o endpoint de autorização do canal Pusher.

## Decisões fechadas nesta rodada

- **Token de sessão**: validade de **7 dias**, chave opaca (não JWT) gerada pelo Postgres via `pgcrypto`, guardada em `midiabot_midiachat_sessao`:
```sql
CREATE TABLE midiabot_midiachat_sessao (
    token TEXT PRIMARY KEY,
    id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
    id_vendedor INTEGER NOT NULL,
    criado_em TIMESTAMPTZ NOT NULL DEFAULT now(),
    expira_em TIMESTAMPTZ NOT NULL,
    FOREIGN KEY (id_cliente, id_vendedor) REFERENCES midiabot_login_chat (id_cliente, id_vendedor)
);
```
Fluxo de login (workflow n8n próprio, webhook dedicado): valida `nome_fantasia`+`login`+`senha` (`crypt()` contra `midiabot_login_chat`), se achar, gera o token (`encode(gen_random_bytes(32), 'hex')`) e grava aqui com `expira_em = now() + interval '7 days'`. Front-end (`midiabot_chat/index.html`) guarda o token no `localStorage` (chave `midiachat_session`) e redireciona pra `chat.html`.

**Status: construído e testado de ponta a ponta** — login certo (gera token, salva sessão, redireciona) e login errado (mostra erro, sem sessão) confirmados funcionando.

**`chat.html` (seletor de salas + lista de conversas + conversa aberta + enviar mensagem): construído e testado de ponta a ponta.** Ações `listar_salas`/`listar_conversas`/`listar_mensagens` usando "Respond to Webhook" com **"All Incoming Items"**; `enviar_mensagem` faz um `INSERT` só em `midiabot_historico_mensagens`, sem chamar a Evolution API ainda (o usuário configura esse pedaço depois, quando quiser). Mensagens do cliente passam por `escapeHtml()` antes de renderizar (proteção contra XSS).

**`midiabot_whats_versus_telegram` renomeada pra `midiabot_midiachat_ultima_instancia`** — guarda por qual instância (`last_instance`) responder a um `remote_jid`. **Decisão importante corrigida nesta sessão**: a resolução da instância **não pode depender do `chat_id`** — mover um cliente de sala (Atribuição de Chat) não pode quebrar o envio de mensagem. A query de `enviar_mensagem` busca só por `remote_jid` (com `DISTINCT ON` de proteção contra linha duplicada antiga), o `chat_id` da sala atual só é usado pra achar o `workflow_name`, não a instância.

**Bug real encontrado em 2026-07-31, com migração em andamento**: testando com uma instância nova atrelada a outro workflow, uma mensagem de um `remote_jid` que já tinha conversado com **outro workflow** do mesmo cliente caiu na sala errada — porque `midiabot_remotejid_chatid` guardava só uma linha por `(id_cliente, remotejid)`, ignorando o workflow. Pior: a chave primária de `midiabot_midiachat_ultima_instancia` (`midiabot_whats_versus_telegram_pkey2`, antiga) era `(remote_jid, chat_id, workflow_name)` — ou seja, **incluía o `chat_id`**, contrariando a decisão acima ("não pode depender do chat_id"). Na prática, cada troca de sala (mesmo dentro do mesmo workflow) criava uma linha nova em vez de atualizar a existente, deixando linhas duplicadas/órfãs e fazendo `enviar_mensagem` escolher a instância errada quase na sorte (o `DISTINCT ON` não tinha `ORDER BY` que garantisse pegar a mais recente).

**Correção em andamento — migração de banco, passos concluídos:**
1. ~~Apagar linhas de teste duplicadas.~~ Feito.
2. ~~Trocar a chave de `midiabot_midiachat_ultima_instancia` de `(remote_jid, chat_id, workflow_name)` pra `(remote_jid, workflow_name)`~~ — feito (`chat_id` continua como coluna normal da tabela, só não faz mais parte da chave; é só informativo agora).
3. ~~Ajustar `ON CONFLICT` do Passo 2 de `iniciar_conversa`~~ pra `(remote_jid, workflow_name)`, atualizando `chat_id` também no `DO UPDATE`. Feito.

**Os três itens que faltavam aqui (ajustar `enviar_mensagem`, derrubar a FK antiga, adicionar `workflow_name` à chave de `midiabot_remotejid_chatid`) foram concluídos em 2026-07-31** — ver a entrada "Migração 'workflow precisa fazer parte da identidade da conversa'" mais abaixo, que é o registro correto e atual. Confirmado de novo em 2026-08-07 direto no banco: `midiabot_remotejid_chatid_pkey = PRIMARY KEY (id_cliente, remotejid, workflow_name)`.

- **Prompt da IA conselheira**: separado do de "Prompts", fixo no n8n por ora, cadastro editável fica pra v2.

- **`midiabot_midiachat_contato` (apelido/emoji/observações do contato, desenhada em 2026-07-30)**:
```sql
CREATE TABLE midiabot_midiachat_contato (
    id_cliente INTEGER NOT NULL REFERENCES midiabot_cad_usuarios(id),
    remotejid TEXT NOT NULL,
    apelido TEXT,
    emoji TEXT,
    observacoes TEXT,
    PRIMARY KEY (id_cliente, remotejid),
    FOREIGN KEY (id_cliente, remotejid) REFERENCES midiabot_remotejid_chatid (id_cliente, remotejid)
);
```
Coluna `remotejid` (sem underscore) escolhida pra bater com `midiabot_remotejid_chatid`, sua tabela-irmã de mesma PK/grão (`midiabot_historico_mensagens` usa `remote_jid`, com underscore — inconsistência antiga, não replicada aqui). A FK pra `midiabot_remotejid_chatid` é segura porque toda conversa passa por lá primeiro (mensagem recebida ou botão "Nova conversa", ambos gravam ali antes de a conversa aparecer em qualquer tela) — nunca existe apelido pendurado num `remotejid` que ainda não é uma conversa de verdade. **Tabela criada no banco em 2026-07-30.**

**UI de contato (`chat.html`), construída em 2026-07-30**: cada linha da lista de conversas tem um ícone de lápis que abre um modal (Emoji + Apelido + Observações), chamando a ação `salvar_contato` (`UPSERT` em `midiabot_midiachat_contato`, via `ON CONFLICT (id_cliente, remotejid) DO UPDATE`). Quando o contato tem `apelido`, a lista mostra só `emoji + apelido` (sem repetir o número — o número já aparece no cabeçalho da conversa aberta); sem apelido, continua `pushname - número` ou só número. **Status: `salvar_contato` confirmado funcionando (2026-08-05)** — o erro "Host not found" observado num teste anterior não se repetiu; provavelmente já estava corrigido ou foi algo pontual. `listar_conversas` foi ajustada com `LEFT JOIN midiabot_midiachat_contato ct ON ct.id_cliente = rc.id_cliente AND ct.remotejid = rc.remotejid` trazendo `ct.apelido, ct.emoji, ct.observacoes` — configurada, mas teste também não confirmado depois da criação da tabela.

- **"+ Nova conversa" (`iniciar_conversa`), construído e testado em 2026-07-30**: modal no `chat.html` pra começar uma conversa com um número que nunca mandou mensagem. Sugere a última instância usada por aquele número, se houver (ação `buscar_instancia_sugerida`, busca em `midiabot_midiachat_ultima_instancia` por `remote_jid`); senão, o vendedor escolhe manualmente entre as instâncias do cliente (ação `listar_instancias`). Ao confirmar, a ação `iniciar_conversa` faz dois upserts: **Passo 1** em `midiabot_remotejid_chatid` (cria a conversa na sala atual) e **Passo 2** em `midiabot_midiachat_ultima_instancia` (grava a instância escolhida como `last_instance`). Os dois upserts precisam estar como um único `INSERT ... ON CONFLICT`, nunca um `SELECT` solto antes do `ON CONFLICT` (causa erro de sintaxe).

- **Destaque visual de UI, feito em 2026-07-30**: conversa aberta fica com fundo cinza na lista da esquerda (antes as duas cores de aba pareciam parecidas demais). Cabeçalho da conversa aberta mostra o número sem o sufixo `@s.whatsapp.net` (`numeroSemSufixo()`). Campo de número do modal "Nova conversa" não menciona mais "@" (rótulo virou "Número do WhatsApp") — jargão técnico que só o desenvolvedor entendia, não devia estar visível pro vendedor.

- **Pusher — conta e app criados em 2026-07-30**: plano Sandbox (gratuito), produto **Channels** (não confundir com "Beams", que é push notification, produto diferente). App único (sem separação de ambientes dev/prod). Cluster **`sa1`** (São Paulo). Credenciais: `app_id = 2181791`, `key = 8112484fe599e854a7e4`, `cluster = sa1` (não sensíveis, já estão em `midiabot_chat/config.js`, que é versionado). O `secret` do Pusher **não é documentado aqui de propósito** (segurança) — está hardcoded só dentro do node Code do endpoint `pusher-auth` no n8n (ver abaixo); se precisar consultá-lo de novo, é só abrir esse node no n8n.

- **Endpoint de autorização de canal Pusher (`pusher-auth`), construído em 2026-07-30**: webhook dedicado, separado do webhook principal do Midiabot_chat (porque quem chama essa URL é a própria biblioteca do Pusher no navegador, num formato fixo dela, não o nosso `chamarApi()`). URL: `https://awkwardgiantpanda-n8n.cloudfy.live/webhook/pusher-auth` — o token da sessão vai colado na query string (`?token=...`), montado pelo próprio `chat.html`, não fixo na URL do node. Cadeia de nodes:
  1. **Webhook1** (POST, "Respond" = "Using 'Respond to Webhook' Node"). Pusher manda `channel_name` e `socket_id` no body, como `application/x-www-form-urlencoded` (formato diferente do resto do projeto, que é sempre JSON).
  2. **Validar sessão** (Postgres, Always Output Data ligado):
     ```sql
     SELECT id_cliente
     FROM midiabot_midiachat_sessao
     WHERE token = $1 AND expira_em > now()
     ```
     Parâmetro: `{{ $json.query.token }}`.
  3. **IF** — duas condições em AND: `{{ $json.id_cliente }}` não vazio (sessão válida) E `{{ $('Webhook1').item.json.body.channel_name }}` igual a `{{ 'private-cliente-' + $json.id_cliente }}` (impede um vendedor de se inscrever no canal de outro cliente).
  4. **Saída true** → node **Code** calcula a assinatura HMAC-SHA256 (`crypto.createHmac('sha256', secret).update(socket_id + ':' + channel_name).digest('hex')`) e devolve `{ auth: "key:assinatura" }` → **Respond to Webhook** ("All Incoming Items").
  5. **Saída false** → **Respond to Webhook** direto, JSON `{"erro": "não autorizado"}`, Response Code **403**.

  Lado do navegador (`chat.html`): biblioteca `https://js.pusher.com/8.4.0/pusher.min.js` carregada no `<head>`; função `conectarPusher()`, chamada no `DOMContentLoaded` (depois de confirmar a sessão), cria o cliente Pusher com `channelAuthorization.endpoint = CONFIG.PUSHER_AUTH_URL + '?token=' + sessao.token` e se inscreve em `private-cliente-{sessao.id_cliente}`.

  **Status: construído e testado de ponta a ponta em 2026-07-30 — `pusher:subscription_succeeded` confirmado no console do navegador.** Duas armadilhas do n8n encontradas e corrigidas nesse processo (relevantes pra qualquer webhook novo neste projeto):
  - **IF comparando número com texto**: `id_cliente` vem do Postgres como número, mas a condição estava configurada esperando texto (`Wrong type: '1' is a number but was expecting a string`). Corrigido ligando **"Convert types where required"** nas Options do node IF.
  - **Respond to Webhook, modo JSON**: "All Incoming Items" envolve a resposta num array (`[{"auth":...}]`), formato que o Pusher rejeita (ele exige objeto puro). Trocado pra modo "JSON" com corpo digitado à mão `{ "auth": "{{ $json.auth }}" }` — e o campo precisa estar com o **modo Expressão ligado** (ícone "fx" ao lado do campo), senão o `{{ }}` vai literal como texto em vez de ser calculado (mesma armadilha já vista no webhook de login).

- **Migração "workflow precisa fazer parte da identidade da conversa", concluída em 2026-07-31**: `midiabot_midiachat_ultima_instancia` com chave `(remote_jid, workflow_name)`; `midiabot_remotejid_chatid` com chave `(id_cliente, remotejid, workflow_name)`; FK `midiabot_midiachat_contato_id_cliente_remotejid_fkey` removida; `enviar_mensagem`, o Passo 2 de `iniciar_conversa` e o node "resolver chat_id" (workflow de teste) todos ajustados e testados — mensagem pro número da instância `TesteChat-1` (workflow "Publi ScentyStore v1") confirmada caindo na sala certa ("Sala da Loja"), não mais na sala de outro workflow.

- **Bug de fuso horário corrigido em 2026-07-31**: `midiabot_historico_mensagens.datetime` tinha `DEFAULT (now() AT TIME ZONE 'America/Sao_Paulo')`, que fazia uma dupla conversão de fuso e gravava o horário ~3h adiantado/atrasado (dependia do sinal) sempre que um `INSERT` não informava `datetime` explicitamente. Corrigido pra `DEFAULT now()`. **Só corrige daqui pra frente — mensagens antigas gravadas pelo padrão antigo continuam com o horário errado no banco** (isso pode incluir mensagens reais do fluxo de produção, não só teste; não avaliado se vale a pena/como fazer backfill).

- **"Não lida" (indicador de mensagem nova), construído em 2026-07-31**: compartilhado entre consultores (não por pessoa), critério é "a última mensagem da conversa é do cliente E é mais nova que a última vez que alguém abriu essa conversa" — não usa "respondida" como critério (mensagens tipo "tchau" não geram alerta indevido só por decisão de quem atende).
  - `midiabot_remotejid_chatid.lida_em TIMESTAMPTZ` (nova coluna, `NULL` = nunca lida).
  - Ação nova `marcar_lida`: `UPDATE ... SET lida_em = now()`, chamada pelo `chat.html` toda vez que uma conversa é aberta.
  - `listar_conversas` traz `from_me` da última mensagem e calcula `nao_lida` (boolean).
  - `listar_salas` traz `pendentes` (contagem de conversas não lidas por sala, via subquery correlacionada).
  - `chat.html`: ponto verde nas linhas com `nao_lida = true`; badge vermelho com o número de `pendentes` em cada aba de sala (desktop e mobile); ao abrir uma conversa, chama `marcar_lida`, remove o ponto na hora (sem esperar reload) e atualiza os badges das abas via `atualizarContadoresSalas()` (uma versão de `carregarSalas()` que **não** troca a sala selecionada, ao contrário de `carregarSalas()`, que sempre seleciona a primeira sala da lista — por isso não dá pra reusar `carregarSalas()` aqui).

- **Fluxo de mensagem chegando (WhatsApp → Pusher), construído e testado em 2026-07-31**, no workflow de teste isolado (Publi ScentyStore v1): Webhook → "resolver chat_id" → `INSERT` em `midiabot_historico_mensagens` (`RETURNING id, chat_id, remote_jid, id_cliente`) → **Code** (monta a chamada assinada pra API REST do Pusher — `crypto.createHash('md5')` pro corpo, `crypto.createHmac('sha256', secret)` pra assinatura, seguindo o algoritmo de autenticação do Pusher: `auth_key`, `auth_timestamp`, `auth_version=1.0`, `body_md5`, ordenados alfabeticamente na query string, assinando `POST\n/apps/{app_id}/events\n{query_string}`) → **HTTP Request** (`POST` pra `{{ $json.url }}`, corpo Raw `{{ $json.body }}`, `Content-Type: application/json`) — resposta `{}` confirma sucesso. Evento sempre leve: `{chat_id, remote_jid, message_id}`, nunca o conteúdo da mensagem.

  Lado do navegador: `conectarPusher()` (em `chat.html`) agora também faz `canal.bind('nova-mensagem', ...)` — ao receber o evento, recarrega a lista de conversas se for da sala aberta no momento, recarrega as mensagens se for da conversa aberta no momento, e sempre atualiza os contadores de pendências das abas (`atualizarContadoresSalas()`).

  **Nota importante (corrigida em 2026-08-05, repetida por engano várias vezes antes disso): não existe um workflow "de teste" separado de um workflow "de produção".** "Publi ScentyStore v1" é o workflow real, único — tudo que é construído nele já está em produção, não existe etapa de "replicar depois". Qualquer menção anterior neste documento a "replicar pro fluxo de produção" está desatualizada/errada.

## Mídia e tipos de mensagem — recebimento e exibição (construído em 2026-08-05 a 2026-08-07)

**Arquitetura confirmada em produção** (todos os campos abaixo verificados contra payload real, nunca chutados — a lição do início do projeto, quando um chute de estrutura de campo saiu errado, foi levada a sério o resto do caminho): `listar_mensagens` traz `id`, `mensagem`, `caption`, `from_me`, `datetime`, `messagetype`, `mime_type`, `midia`, `resposta_a` — **sem** `base64` (lista fica leve). Ação `buscar_midia` (`id` → `base64` + `mime_type`) só é chamada quando o vendedor clica pra abrir uma mídia específica.

**Fluxo de entrada, ordem real das peças** (workflow "Publi ScentyStore v1"): `Webhook2` → **Switch** (`body.event == 'messages.upsert'` segue adiante; `body.data.messageType == 'secretEncryptedMessage'` desvia pra um ramo à parte, ver seção de edição abaixo; qualquer outro `event` — ex. `messages.delete` — não bate em nenhuma regra e a execução morre ali, sem erro) → `Verifica parâmetros` (resolve `id_cliente`/`workflow_name`/`chat_id`) → `Code` node ("verifica messagetype", normaliza qualquer tipo de mensagem pros mesmos campos) → `Insert`.

**Tipos de mensagem confirmados e implementados** (Code node "verifica messagetype" — se o tipo não bate em nenhuma branch conhecida, o node retorna `[]` e nada é inserido, evitando lixo no histórico):
- `conversation` — texto simples (`dados.message.conversation`). Cobre inclusive respostas citando outra mensagem de texto (a citação em si vem em `contextInfo.quotedMessage`, ver seção de resposta/citação).
- `extendedTextMessage` — nunca observado na prática apesar de múltiplos testes (link com preview, texto citando outra mensagem) sempre virem como `conversation`; o código mantém esse branch (`dados.message.extendedTextMessage?.text`) por precaução, usando o nome de campo oficial da Baileys, mas é o único trecho do sistema que não foi confirmado contra payload real.
- `imageMessage`/`audioMessage`/`videoMessage` — `mimetype` e `base64` (irmão de `message`, não aninhado dentro do tipo); `caption` existe pra imagem/vídeo, **não existe pra áudio** (o WhatsApp não permite legenda em áudio).
- `documentMessage` — mesmo padrão + `fileName` (guardado em `midia`), usado tanto no rótulo do card quanto no nome do download. Testado com `.docx` e `.pdf`.
- `stickerMessage` — mesmo padrão de imagem (`mimetype`/`base64`, `image/webp`), mas sem `caption` (WhatsApp não permite legenda em figurinha). Exibido pequeno (128px), sem fundo/cantos arredondados.
- `contactMessage` — `displayName` + `vcard` (já vem pronto e formatado do WhatsApp). `mensagem` recebe `"👤 Nome\ntelefone"` (telefone extraído do vcard via regex); `caption` guarda o vcard bruto, usado pelo `chat.html` pra gerar um download `.vcf` local (sem precisar buscar nada na Evolution API — o vcard já está no banco).
- `locationMessage` — `degreesLatitude`/`degreesLongitude`. Decisão final: não virou elemento visual próprio, só um link do Google Maps (`https://www.google.com/maps?q=lat,lng`) embutido no campo `mensagem` — já fica clicável de graça graças à linkificação de URL (ver seção de formatação abaixo). Zero mudança de front-end precisou ser feita.
- **Não tratados, ficam no aviso genérico "Tipo de mensagem ainda não suportado"**: `liveLocationMessage` (localização em tempo real — tipo diferente de `locationMessage`, nunca testado), `buttonsResponseMessage`/`listResponseMessage` (só relevante quando o MidiaBot passar a mandar mensagem com botão/lista, ainda não existe), `pollCreationMessage` (baixa prioridade, não é comum em atendimento 1:1).
- `reactionMessage` — **bloqueado estruturalmente**, ver seção "Edição e reação de mensagem" abaixo. Mesma causa raiz do bloqueio de mensagem editada.

**`protocolMessage` não existe como conceito neste sistema** — decisão anterior deste documento (linha antiga, já corrigida) descrevia apagar/editar como subtipos de `protocolMessage`. Isso era um chute nunca confirmado, e o teste real mostrou outra coisa:
- **Apagar mensagem**: chega como um **evento de webhook totalmente separado**, `event: "messages.delete"` (não `messages.upsert`), com formato de payload diferente (`data.remoteJid`/`data.id` direto, sem o wrapper `data.key`/`data.message` de sempre). Precisou de um Switch dedicado pra não deixar isso quebrar o resto do fluxo (ver acima). Nenhuma linha é gravada/alterada — o histórico não reflete a exclusão.
- **Editar mensagem**: também chega como `messages.upsert` normal, não como evento separado — só que com `messageType: "secretEncryptedMessage"`, ver próxima seção.

## Edição e reação de mensagem — investigado e bloqueado por limitação externa (2026-08-06/07)

**Descoberta principal**: editar uma mensagem no WhatsApp **não gera nenhum evento próprio** (`messages.update` existe como opção de webhook na Evolution API, mas nunca disparou em nenhum teste, mesmo ligado simultaneamente com uma edição real acontecendo). A edição chega pelo `messages.upsert` de sempre, com `messageType: "secretEncryptedMessage"` — um envelope cifrado (`encPayload`/`encIv`/`targetMessageKey`) que a Evolution API não decifra antes de repassar pro webhook. Reação com emoji usa o mesmo mecanismo.

**Causa raiz confirmada como bug aberto da própria Evolution API** (não é algo que dependa de configuração nossa) — issues públicas no GitHub: `EvolutionAPI/evolution-api#2010`, `evolution-foundation/evolution-api#2545` e `#1177`, sem correção nem resposta dos mantenedores até a data. Confirmado também que a Baileys (biblioteca por trás da Evolution API), usada diretamente, entrega o texto editado em claro — o bug é especificamente da camada de repasse da Evolution API, não da criptografia do WhatsApp em si.

**Tentativas de contorno, todas testadas e descartadas nesta ordem:**
1. Consultar o endpoint REST `POST {server_url}/chat/findMessages/{instance}` (`where: {key: {id: <targetMessageKey.id>}}`) esperando que o banco interno da Evolution já tivesse o texto atualizado — **testado e refutado**: mesmo esperando 15s, devolve o texto **original**, não o editado. O campo `MessageUpdate` da resposta desse endpoint vem sempre `[]`.
2. Habilitar `MESSAGES_UPDATE` no webhook da instância — não muda nada, nenhum evento chega.
3. Hipótese "contas comerciais oficiais desativam a edição pro remetente" (baseada em observação real: mensagens mandadas pra empresas com o aviso "esta empresa usa um serviço seguro da Meta" — indicador confirmado de API oficial — não ficam editáveis) — **não virou ação concreta**: é uma correlação observada em poucos casos, não uma causa comprovada, e mesmo que fosse real, migrar pra API oficial do WhatsApp é uma mudança de operação inteira (cobrança por mensagem, janela de 24h pra contato livre, verificação de empresa) — desproporcional só por essa causa.
4. Avaliadas alternativas de ferramenta (WAHA, WPPConnect) — ambas têm suporte parcial a esse recurso especificamente (capturam a **primeira** edição de uma mensagem; uma segunda edição da mesma mensagem não gera evento, limitação documentada nas duas). Nenhuma foi implantada — ver "Infra explorada e descartada" abaixo.

**Estado atual**: nada é gravado quando chega `secretEncryptedMessage` (o Code node retorna `[]` pra qualquer tipo não reconhecido, incluindo esse). O consultor não vê que uma mensagem foi editada nem o conteúdo novo. **Decisão do usuário**: não implementar um aviso "mensagem editada, conteúdo indisponível" como paliativo (julgado insuficiente) — o problema fica em aberto, sem solução aceitável encontrada até agora, revisitar quando/se migrar de ferramenta.

**Infra explorada e descartada nesta sessão** (pra não repetir a mesma investigação):
- **Cloudfy** (`cloudfy.space`, onde já roda n8n/Evolution/Postgres) só aceita deploy de app Node.js a partir de código-fonte (build automático esperando pasta `dist`) — não aceita rodar uma imagem Docker pronta nem um servidor Node persistente arbitrário. Testado tentando publicar tanto o WAHA (Docker) quanto um teste isolado de Puppeteer (servidor Node simples) — os dois falharam por esse motivo, não por erro de configuração.
- **Koyeb** (free tier) não "dorme" (diferente do Render gratuito) e aceita Docker direto, mas só 512MB RAM — apertado até pro motor leve do WAHA.
- **Vultr/DigitalOcean** não têm datacenter em São Paulo nos planos baratos (confirmado, não assumido — uma tentativa anterior de usar a Vultr por engano partiu da suposição errada de que tinha).
- **Serverspace** (`serverspace.com.br`) tem São Paulo, root de verdade, ~R$23-24/mês, e Docker disponível como app pronta — chegou a ter um servidor quase criado (1 CPU/1GB/25GB, Docker selecionado) pra testar o WAHA, mas o teste foi abandonado no meio (pausado, não descartado) quando a discussão migrou pra investigar a causa raiz em vez do contorno de ferramenta.

## Resposta/citação de mensagem (construído em 2026-08-05/06, só lado de entrada)

Duas colunas novas em `midiabot_historico_mensagens`:
- `wa_message_id TEXT` — o ID que o próprio WhatsApp dá à mensagem (`data.key.id` no recebimento; `data.key.id` também na resposta da Evolution API ao enviar).
- `resposta_a INTEGER REFERENCES midiabot_historico_mensagens(id)` — auto-referência, resolvida via subquery no `INSERT`, casando `contextInfo.stanzaId` (da mensagem que chegou) contra o `wa_message_id` já salvo, restrito por `remote_jid` + `workflow_name` (pra não cruzar workflows, mesmo cuidado de sempre).

**`chat.html`**: ao carregar as mensagens, monta um mapa `id → mensagem` e renderiza uma caixinha verde acima de qualquer mensagem com `resposta_a` preenchido, com um resumo da mensagem citada (texto, ou "📷 Imagem: legenda"/"🎥 Vídeo"/"🎵 Áudio"/"📄 nome do arquivo" pra mídia) — resolvido só a partir das mensagens já carregadas na tela, sem chamada extra.

**Envio (`enviar_mensagem`) precisou ser reordenado**: a ordem original era INSERT (log) → Evolution (envio de verdade) — o que tornava impossível capturar o `wa_message_id` real (só existe depois do envio). Corrigido pra Evolution → INSERT, com os campos que usavam `$json` "cru" trocados por referência nomeada ao node correto, já que o node imediatamente anterior ao INSERT mudou.

**Pendente**: o lado do vendedor ainda não manda `stanza_id` quando responde citando uma mensagem pelo próprio `chat.html` — hoje só funciona quando é o **cliente** que cita algo pelo celular. Fica pra quando o chat trabalhar tipos de mensagem do lado do vendedor (mídia, resposta, etc. saindo do chat pro WhatsApp).

## Outras correções desta sessão (2026-08-05 a 07)

- **Quebra de linha não era preservada** no `chat.html` — `white-space: pre-line` foi colocado inicialmente na bolha inteira, o que vazou a indentação do próprio template JS como linha em branco visível (bug próprio, corrigido movendo a classe pra envolver só o texto de cada mensagem/legenda, não o contêiner).
- **URLs não viravam link clicável** — `formatarWhatsApp()` só tratava `*negrito*`/`_itálico_`/`~tachado~`; agora também linkifica `http(s)://` e `www.` sem protocolo.
- **Contador de pendências (`listar_salas`) cruzando workflows**: a subquery que busca a mensagem mais recente de cada conversa (`LATERAL JOIN`) filtrava só por `remote_jid`+`id_cliente`, sem `workflow_name` — então uma mensagem de um workflow incrementava o contador de "não lida" de outra sala/workflow que compartilhasse o mesmo número de cliente. Corrigido adicionando `hm.workflow_name = rc.workflow_name` na subquery.

## Reconstrução do fluxo de recebimento (2026-08-08, em andamento)

Retomando o plano combinado em 2026-08-07 (reconstruir o fluxo antes de atacar envio de mídia do vendedor). Progresso real desta sessão:

**Resolução de `chat_id` — refeita e concluída.** O node "Verifica parâmetros" antigo só fazia `COALESCE` (roteava, nunca gravava). Decisão confirmada com o usuário: a relação `remotejid`↔`chat_id` deve ser **gravada** na primeira mensagem de um cliente novo (não recalculada a cada mensagem), pra não sofrer efeito colateral se o padrão sender→sala mudar depois — uma atribuição manual (gestor move o cliente de sala) sempre tem prioridade, porque o cálculo por sender só roda quando **não existe** relação nenhuma ainda. Nova query (`WITH resolvido AS (...) , gravado AS (INSERT ... WHERE precisa_gravar ...) SELECT ...`) substitui o node antigo, no mesmo lugar do fluxo (logo após o Switch). O `INSERT` principal (`midiabot_historico_mensagens`) teve o `chat_id` hardcoded (`-4`, atalho de teste) trocado pelo `chat_id` resolvido de verdade (`$15`), e todos os parâmetros passaram a usar **referência por nome** (`$('NomeDoNode')...`) em vez de `$json` cru — decisão explícita do usuário, porque ele está inserindo nodes no meio do fluxo enquanto reconstrói, e `$json` cru muda de significado quando um node novo entra logo antes (referência por nome não quebra com isso).

**Tratamento de mensagens `from_me` — desenhado, sub-fluxo "celular" construído e funcionando.** Decisão: mensagem `fromMe: true` vinda do próprio vendedor pelo `chat.html` já foi inserida no `enviar_mensagem` (não pode duplicar); vinda direto do celular do vendedor nunca foi vista antes (precisa inserir). Estrutura combinada: IF logo após "Verifica parâmetros" checando `fromMe` — `false` segue o caminho normal; `true` sai pra um sub-fluxo à parte, node "Insere msg env do celular" (`SELECT id FROM midiabot_historico_mensagens WHERE wa_message_id = $1 LIMIT 1`, insere só se não achar).

**Bloqueio encontrado e resolvido**: durante o teste, os ecos de `fromMe: true` pararam de chegar por completo (tanto vindas do chat quanto do celular) — nesse meio-tempo, também parou de chegar **qualquer** webhook (não só eco). A princípio suspeitou-se do bug conhecido da Evolution API sobre cache Redis de deduplicação (`EvolutionAPI/evolution-api#2110`, corrigido setando `CACHE_REDIS_ENABLED=false`, campo travado no painel da Cloudfy) — mas essa teoria **não foi confirmada como causa raiz**: o usuário diagnosticou a interrupção geral via webhook.site (testando se a Evolution API estava de fato entregando alguma coisa) e resolveu por conta própria; ao voltar a funcionar, os ecos também voltaram. Não está claro se o Redis era mesmo o problema ou se era só a interrupção geral — **tratar essa teoria do Redis como não confirmada** se reaparecer sintoma parecido.

Com os ecos voltando a chegar, apareceu um erro separado, esse sim identificado e corrigido: o node "Insere msg env do celular" falhava com "Host not found" — causa era a credencial Postgres do node estar desconfigurada/diferente das outras (não um problema de query). Corrigido trocando pra credencial "Postgres Terabot" (a mesma usada no resto do fluxo). **Confirmado funcionando** pelo usuário depois da troca.

**Transcrição de áudio — decidido usar Deepgram (não trocar de serviço).** Comparado com Inworld AI (aceita base64 direto, mas free tier menor e serviço menos estabelecido) — Deepgram ganha em crédito grátis total (US$200 único ≈ 775h, contra 400 min/mês do Inworld) e já é testado pelo usuário. Consequência: **precisa** do passo de conversão base64→binário (Deepgram exige binário puro, não aceita base64 — confirmado na doc oficial). Código reaproveitado de um fluxo anterior, com 2 correções feitas: nome do node trocado de `Webhook` pra `Webhook2` (nome real neste fluxo), e o `return` trocado pra preservar `$input.item.json` (o código antigo substituía o `json` inteiro por `{status, message}`, o que apagaria os campos já resolvidos por "verifica messagetype"/"Verifica parâmetros"). Recomendado ligar **"On Error: Continue"** tanto nesse Code node quanto no futuro node de chamada à API do Deepgram, pra uma falha de transcrição não impedir o áudio de ser salvo (só fica sem o `caption` preenchido). Posição exata no fluxo (antes ou depois do "verifica messagetype") ainda não decidida.

**Bug real encontrado e corrigido: `base64` intermitentemente vazio em `audioMessage`.** Mesmo com a flag Base64 ativa na instância (confirmado repetidas vezes), `body.data.message.base64` às vezes chega vazio/ausente no payload do webhook — visto tanto em áudio comum quanto em `ptt: true` (nota de voz), sem diferença de configuração entre instâncias que funcionaram e que falharam na mesma sessão de teste. Não é um problema estável por instância nem por tipo (ptt vs. arquivo) — é intermitente de verdade (mesma instância, mesmo tipo, funcionou → falhou → voltou a funcionar). Causa raiz não identificada (nunca chegou a ser uma teoria específica descartável, só "instabilidade da própria Evolution API").

**Correção**: o Code node de conversão base64→binário (nomeado **"b64 para bin"**) ganhou um fallback embutido — se `body.data.message.base64` vier vazio, o próprio node chama `POST {server_url}/chat/getBase64FromMediaMessage/{instance}` (endpoint da Evolution API que baixa a mídia sob demanda a partir do `message.key.id`) via `this.helpers.httpRequest`, usando `server_url` e `apikey` **direto do payload do webhook** (`body.server_url`/`body.apikey`, presentes em todo evento — não fixos no código, funciona pra qualquer instância). A resposta desse endpoint traz o campo `base64` direto (`response.base64`, confirmado contra payload real, não chutado). O valor recuperado (`base64_recuperado`) é mantido no `json` de saída (não só usado pro binário), pra o Edit Fields seguinte poder reaproveitá-lo:
```js
let base64Data = $('Webhook2').first().json.body?.data?.message?.base64;

if (!base64Data) {
    const response = await this.helpers.httpRequest({
        method: 'POST',
        url: `${$('Webhook2').first().json.body.server_url}/chat/getBase64FromMediaMessage/${$('Webhook2').first().json.body.instance}`,
        headers: {
            'apikey': $('Webhook2').first().json.body.apikey,
            'Content-Type': 'application/json'
        },
        body: {
            message: { key: { id: $('Webhook2').first().json.body.data.key.id } }
        },
        json: true
    });
    base64Data = response.base64;
}

if (!base64Data) {
    throw new Error("O path do Base64 retornou vazio, e o download de fallback também falhou.");
}

const binaryBuffer = Buffer.from(base64Data, 'base64');

return [{
  json: { ...$input.item.json, base64_recuperado: base64Data },
  binary: { audio: await this.helpers.prepareBinaryData(binaryBuffer, 'audio.ogg', 'audio/ogg') }
}];
```

**Posição no fluxo e integração com o Insert — decidido e construído (2026-08-08), confirmado funcionando.** O "verifica messagetype" continua rodando pra **todas** as mensagens, na posição de sempre. Um IF logo depois checa `{{ $('Webhook2').item.json.body.data.messageType }} = audioMessage`; a saída `true` passa por **"b64 para bin" → "transcricao de audio" (Deepgram, HTTP Request) → "Edit Fields"**, e depois volta ao fluxo principal por um node **Merge** antes do Insert (a saída `false` vai direto pro Merge, sem passar por esses três nodes). Isso significa que, pra mensagens que não são áudio, nada muda; só o ramo de áudio ganha esse desvio extra.

O node "transcricao de audio" é uma chamada HTTP direta à API do Deepgram — a resposta **substitui o `json` inteiro** do item (não preserva nada de antes, nem `base64_recuperado`), com a transcrição em `results.channels[0].alternatives[0].transcript`. Por isso o "Edit Fields" seguinte referencia `$('b64 para bin').item.json.base64_recuperado` **por nome** (não dá pra pegar do `$json` cru nesse ponto) e monta dois campos:
- `base64`: `={{ $('b64 para bin').item.json.base64_recuperado }}`
- `caption`: `={{ ($json.caption ? $json.caption + ' ' : '') + $json.results.channels[0].alternatives[0].transcript }}`

O Insert (query principal em `midiabot_historico_mensagens`) precisou trocar só as posições de `caption` (`$6`) e `base64` (`$10`) no array de parâmetros, pra escolher a fonte certa dependendo do tipo de mensagem — sem isso, o Insert continuaria usando os campos (potencialmente vazios) calculados pelo "verifica messagetype", ignorando a correção do ramo de áudio:
```
$('verifica messagetype').item.json.messagetype === 'audioMessage'
  ? $('Edit Fields').item.json.caption
  : $('verifica messagetype').item.json.caption,
...
$('verifica messagetype').item.json.messagetype === 'audioMessage'
  ? $('Edit Fields').item.json.base64
  : $('verifica messagetype').item.json.base64,
```
Os outros parâmetros (`mensagem`, `messagetype`, `mime_type`, `midia`, `wa_message_id`, `stanza_id`, `workflow_name`, `id_cliente`, `chat_id`) continuam vindo do "verifica messagetype"/"Verifica parâmetros" sem mudança — a referência por nome funciona independente de qual ramo do IF rodou, porque cada node fica endereçável pelo nome durante toda a execução.

**Status: áudio chegando certo no chat (mídia carrega, legenda mostra a transcrição), confirmado pelo usuário.** Pendente, à parte: ligar "On Error: Continue" em "b64 para bin" e "transcricao de audio" (recomendado, não bloqueante); e o roteamento da transcrição pra IA (checar pausa via Redis, mandar resposta de verdade se não pausado, logar como linha `from_me=true` separada) — desenhado em conversa anterior, construção ainda não iniciada.

**Bug real encontrado e corrigido: `instancias.html` quebrava quando uma instância era apagada por fora do sistema** (direto no painel da Evolution API, não pelo botão "APAGAR INSTÂNCIA" do MidiaBot). A ação `listar_instancias` busca o status ao vivo de cada instância uma por uma (node "Buscar instancia", loop); quando uma não é encontrada (404), os nodes seguintes ("Atualizar Sender", "Buscar Sender atualizado", "Montar item final") assumiam que a resposta sempre tinha `data[0]`, quebrando a lista inteira por causa de uma única instância órfã. Correção aplicada (3 partes): (1) IF novo checando `{{ $json.data }}` antes de "Atualizar Sender", pulando o UPDATE quando não achar; (2) "Buscar Sender atualizado" trocou a origem do parâmetro pra `$('Loop Over Items').item.json.nome_instancia` (não depende da resposta da API); (3) "Montar item final" ganhou expressões com fallback (`data?.[0]?.name || ...`, `data?.[0]?.connectionStatus || 'not_found'`). Itens 1 e 2 confirmados aplicados pelo usuário; item 3 foi explicado passo a passo, aplicação não confirmada ainda.

**Efeito colateral não resolvido**: ao tentar recriar a instância apagada ("Marcelo-1") pra corrigir na raiz, o usuário escaneou o QR Code com o número que já é `sender` da instância "TesteChat-1" (usada a sessão inteira pros testes) — `midiabot_a_instancias.sender` tem `UNIQUE`, então o "Atualizar Sender" quebrou de novo, agora com erro de chave duplicada. Não resolvido — precisa reconectar "Marcelo-1" com um número diferente (o "1155490351" mencionado quando essa instância foi criada, não o número de teste de sempre).

## Salas compartilhadas vs. dedicadas (2026-08-08, desenhado, construção não iniciada)

**Contexto**: "Atribuição a Consultores" (`consultores.html`) hoje configura sorteio/escolha manual de vendedor **por workflow inteiro** — mas só faz sentido pra salas "porta de entrada" (várias possíveis vendedores, cliente novo sem dono óbvio). Salas onde o sender já é 1:1 com um vendedor específico não precisam de sorteio nenhum.

**Decisões fechadas:**
- Nova coluna **`midiabot_chatid_workflowname.sala_compartilhada INTEGER NOT NULL DEFAULT 0`** — criada em 2026-08-08. `1` = sala compartilhada (usa sorteio/escolha manual); `0` = sala dedicada (dono já determinado pelo sender atrelado a um vendedor).
- **`midiabot_midiachat_sala_vendedor` confirmado que não existe** (checado direto no banco via `information_schema.columns` em 2026-08-08, não só por falta de tela usando ela) — a menção no MidiaChat (N-pra-N, pra destacar aba do dono no `chat.html`) nunca foi implementada. A posse de uma sala dedicada será **derivada**: sender atrelado à sala (`midiabot_sender_chatid`, via "Conectores de Chat") + esse sender atribuído a um vendedor (`midiabot_vendedores`, escrito por `vendedores.html`/"Telefones dos Consultores") = esse vendedor é o dono, por transitividade. Isso não afeta `midiabot_remotejid_chatid` (atribuição de conversa a sala), que é um mecanismo totalmente separado.
- **Regra de "apagar sala"** (pendência antiga, revisada): fica com **2** condições, não 3 — sem sender atrelado (`midiabot_sender_chatid`) e sem conversa atribuída (`midiabot_remotejid_chatid`). "Sem vendedor dono" não é checagem separada, já está coberta por "sem sender" (dado que posse é derivada do sender).
- **Tabela real por trás de "Atribuição a Consultores"**: `midiabot_sorteio_vendedor` (`workflow_name`, `sorteio` smallint, `vendedor_escolhido` integer, `id_cliente`) — confirmado direto no banco em 2026-08-08. Hoje com chave/escopo em `workflow_name`; precisa migrar pra `chat_id` (trocar a coluna, já que `chat_id` não existe nela ainda).
- **Tabela real por trás de "Telefones dos Consultores"**: `midiabot_vendedores` (`id_vendedor`, `sender`, `id_cliente`) — separada de `midiabot_login_chat` (login/senha/nome/cor, usado pro login do MidiaChat).

**Ainda não construído** (ordem sugerida):
1. **"Conectores de Chat" (`telegram_sender.html`)**: toggle "Sala compartilhada" no formulário "Criar sala"; botão "Apagar sala" em cada card, com as 2 condições acima.
2. **"Atribuição a Consultores" (`consultores.html`)**: rescopear `midiabot_sorteio_vendedor` de `workflow_name` pra `chat_id` (precisa `ALTER TABLE` trocando/adicionando a coluna).
3. **"Telefones dos Consultores" (`vendedores.html`)**: trocar o campo `sender` de `midiabot_vendedores` de texto livre pra um `<select>`, mostrando **"NomeDaInstância / número"** (não o `sender` cru, buscado via JOIN com `midiabot_a_instancias`), listando só senders de salas **não** compartilhadas (`sala_compartilhada = 0`) — o sender já salvo daquele vendedor precisa continuar aparecendo mesmo se a regra mudasse depois. Texto de ajuda da tela precisa explicar em linguagem simples por que alguns números não aparecem (números de sala compartilhada são divididos automaticamente, não fazem sentido atribuir a um consultor só).

## Acesso somente-leitura ao banco para o Claude (2026-08-08, em configuração)

Decisão: dar ao Claude acesso **só leitura** ao Postgres (nunca escrita), via servidor MCP, pra reduzir idas e vindas de "roda essa query e cola o resultado" — mudanças no banco continuam exigindo o usuário rodar manualmente, sempre.

**Descobertas do processo (2026-08-08):**
- A porta padrão do Postgres (5432) **não é acessível de fora da rede da Cloudfy** — confirmado (não só suposto) testando de duas origens diferentes (`curl`/`Test-NetConnection`), ambas recusadas. Só o n8n, rodando dentro da rede interna da Cloudfy, alcança essa porta.
- A Cloudfy expõe uma porta externa alternativa (**8205**) pra acesso via cliente de banco (o usuário já usa isso no DBeaver) — essa porta responde de fora.
- **Armadilha real**: a porta 8205 conecta num banco chamado `db`, que **não é o mesmo banco onde os dados do MidiaBot ficam** (esses ficam no banco `postgres`, acessível hoje só pela porta interna 5432/pelo n8n). `claude_readonly` foi criado e recebeu `GRANT` no banco `db` por engano (onde não há nenhuma tabela do MidiaBot) antes disso ser percebido.
- Registrado via edição direta do arquivo de configuração do Claude Code (`claude mcp add-json` e `claude mcp add` falharam no PowerShell do Windows — problema de como aspas são repassadas pro processo; e a primeira senha gerada continha `#`, que quebra a URL de conexão por ser caractere reservado). Servidor MCP `midiabot-db` conectou com sucesso no banco `db` (porta 8205), mas esse banco está vazio pra fins do MidiaBot.

**Status: pausado por decisão do usuário**, sem resolver se existe um caminho pra alcançar o banco `postgres` (onde os dados reais estão) de fora da rede da Cloudfy. Enquanto isso, consultas de verificação continuam sendo feitas do jeito de sempre: o usuário roda a query manualmente (via DBeaver, conectado no banco certo) e cola o resultado aqui.

## Pendências / decisões em aberto

- **Terminar a reconstrução do fluxo de recebimento**: roteamento da transcrição de áudio pra IA (checar pausa via Redis, mandar resposta de verdade se não pausado, logar como linha `from_me=true` separada — áudio já chega certo no chat, falta só essa parte), ligar "On Error: Continue" em "b64 para bin"/"transcricao de audio", aplicar o item 3 da correção de `instancias.html`.
- **Reconectar a instância "Marcelo-1"** com o número certo (não o de teste "TesteChat-1").
- Construir as 3 telas da seção "Salas compartilhadas vs. dedicadas" acima.
- **Envio de mídia e outros tipos de mensagem do lado do vendedor** (upload de arquivo, resposta citando mensagem) — ainda não iniciado; só começa depois do item acima.
- Revisar se **Atribuição de Chat** (`listar_remotejids`/`salvar_atribuicao`, no painel admin) também precisa do ajuste de workflow na identidade da conversa — ainda não avaliado.
- Revisar o fluxo de **enviar mensagem** pra seguir o mesmo padrão notify-then-fetch via Pusher (hoje `enviar_mensagem` manda de verdade pra Evolution API e grava no histórico, mas não dispara evento Pusher — o vendedor só vê a própria mensagem porque o front-end refaz o fetch manualmente; outros vendedores olhando a mesma conversa não são avisados ao vivo).
- Onde/como o quadrinho de login aparece fisicamente na tela inicial do `midiabot.com.br` (seção fixa, modal, etc.).
- Aviso de erro amigável quando `nome_fantasia` já estiver em uso (a constraint `UNIQUE` já existe no banco; falta a tela tratar o erro).
- Formato exato da chave/TTL no Redis pra "pausar IA por N horas", e quais outros botões entram no menu "⋮" além desse — esse menu vai depender de um webhook diferente do que estamos usando agora (ainda não é hora de construir).
- **Edição/reação de mensagem sem solução aceitável** — ver seção dedicada acima; revisitar se/quando fizer sentido trocar de ferramenta (WAHA testado parcialmente, abandonado no meio) ou migrar pra API oficial do WhatsApp.
- `liveLocationMessage` (localização em tempo real, diferente da localização fixa já tratada) — nunca testada, tipo de mensagem diferente, precisa de payload real antes de decidir o design.
