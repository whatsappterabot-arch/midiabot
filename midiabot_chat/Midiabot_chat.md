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

**UI de contato (`chat.html`), construída em 2026-07-30**: cada linha da lista de conversas tem um ícone de lápis que abre um modal (Emoji + Apelido + Observações), chamando a ação `salvar_contato` (`UPSERT` em `midiabot_midiachat_contato`, via `ON CONFLICT (id_cliente, remotejid) DO UPDATE`). Quando o contato tem `apelido`, a lista mostra só `emoji + apelido` (sem repetir o número — o número já aparece no cabeçalho da conversa aberta); sem apelido, continua `pushname - número` ou só número. **Status: `salvar_contato` deu erro "Host not found" no último teste (credencial de Postgres do node provavelmente não selecionada/errada) — não confirmado funcionando ainda.** `listar_conversas` foi ajustada com `LEFT JOIN midiabot_midiachat_contato ct ON ct.id_cliente = rc.id_cliente AND ct.remotejid = rc.remotejid` trazendo `ct.apelido, ct.emoji, ct.observacoes` — configurada, mas teste também não confirmado depois da criação da tabela.

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

  Lado do navegador (`chat.html`): biblioteca `https://js.pusher.com/8.4.0/pusher.min.js` carregada no `<head>`; função `conectarPusher()`, chamada no `DOMContentLoaded` (depois de confirmar a sessão), cria o cliente Pusher com `channelAuthorization.endpoint = CONFIG.PUSHER_AUTH_URL + '?token=' + sessao.token` e se inscreve em `private-cliente-{sessao.id_cliente}`. `Pusher.logToConsole = true` está ligado de propósito, temporário, só pra debug (dá pra ver no console do navegador se apareceu "Subscription succeeded" ou erro) — **desligar depois de confirmar que funciona**.

  **Status: construído (5 nodes do webhook + código do `chat.html`), mas ainda NÃO testado de ponta a ponta.** Falta: deploy (`npm run build` + Cloudfy), abrir o `chat.html` logado, e olhar o console do navegador.

## Pendências / decisões em aberto

- **Testar o `pusher-auth` de ponta a ponta** (ver seção acima) — próximo passo imediato.
- Depois de confirmado o `pusher-auth`: construir o fluxo de **mensagem chegando** (WhatsApp → Evolution API → webhook n8n → INSERT em `midiabot_historico_mensagens` → chamada HTTP servidor-a-servidor pro Pusher disparando o evento leve `{chat_id, remote_jid, message_id}` no canal `private-cliente-{id_cliente}`) — ainda não desenhado o node que dispara esse evento (precisa montar a chamada HTTP assinada pro Pusher, provavelmente outro node Code com `crypto`, já que o n8n Cloud não tem node nativo do Pusher).
- Depois: o lado do navegador que escuta o evento (`channel.bind(...)`) e reage fazendo o refetch — ainda não escrito no `chat.html`.
- Depois: revisar o fluxo de **enviar mensagem** pra seguir o mesmo padrão notify-then-fetch (hoje `enviar_mensagem` só faz `INSERT`, sem chamar a Evolution API nem o Pusher — o vendedor só vê a própria mensagem porque o front-end refaz o fetch manualmente).
- Corrigir a credencial do node de `salvar_contato` (erro "Host not found" no último teste) e reconfirmar `listar_conversas` com o `LEFT JOIN` de `midiabot_midiachat_contato` (a tabela só foi criada depois do primeiro teste ter falhado).
- Desligar `Pusher.logToConsole` no `chat.html` depois que o `pusher-auth` for confirmado funcionando.
- Renderização de cada tipo de mídia na tela (player de áudio, miniatura de imagem, link de documento etc.).
- Onde/como o quadrinho de login aparece fisicamente na tela inicial do `midiabot.com.br` (seção fixa, modal, etc.).
- Aviso de erro amigável quando `nome_fantasia` já estiver em uso (a constraint `UNIQUE` já existe no banco; falta a tela tratar o erro).
- Formato exato da chave/TTL no Redis pra "pausar IA por N horas", e quais outros botões entram no menu "⋮" além desse — esse menu vai depender de um webhook diferente do que estamos usando agora (ainda não é hora de construir).
