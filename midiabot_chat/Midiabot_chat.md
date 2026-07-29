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
- Observações e apelido/emoji são **compartilhados**: qualquer consultor que atenda aquele cliente vê e edita o mesmo dado, não é pessoal por consultor. Guardados em `midiabot_midiachat_contato` (`id_cliente`, `remote_jid`, `apelido`, `emoji`, `observacoes` — PK `id_cliente, remote_jid`).
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

- **Token de sessão**: validade de **7 dias**.
- **Armazenamento de mídia**: confirmado reaproveitar `midiabot_historico_mensagens` — já tem tudo que precisa (`from_me`, `instance`, `chat_id`, campos de mídia). O contador de pendência da faixa de salas ("conversas sem resposta") também dá pra calcular direto dali, sem coluna nova: basta checar se a mensagem mais recente daquele `remote_jid` tem `from_me = false`.
- **Por qual instância responder**: resolvido no fluxo de mensagens (fora desta sessão) — o n8n grava `last_instance` por `remotejid` ao chegar mensagem, hoje em `midiabot_whats_versus_telegram`; será redesenhado quando o fluxo de produção for atualizado pro Midiabot_chat.
- **Prompt da IA conselheira**: separado do de "Prompts", fixo no n8n por ora, cadastro editável fica pra v2.

## Pendências / decisões em aberto

- Renderização de cada tipo de mídia na tela (player de áudio, miniatura de imagem, link de documento etc.).
- Onde/como o quadrinho de login aparece fisicamente na tela inicial do `midiabot.com.br` (seção fixa, modal, etc.).
- Aviso de erro amigável quando `nome_fantasia` já estiver em uso (a constraint `UNIQUE` já existe no banco; falta a tela tratar o erro).
- Formato exato da chave/TTL no Redis pra "pausar IA por N horas", e quais outros botões entram no menu "⋮" além desse.
- Endpoint de autorização de canal do Pusher que valida o token de sessão (o token em si já está definido — 7 dias — falta desenhar o endpoint).
