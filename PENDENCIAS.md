# Pendências

Lista organizada de próximos passos, em 2026-08-16. Itens específicos do Envio Ativo têm mais detalhe em `ENVIO_ATIVO.md`.

## Prioridade alta — próximo a atacar

1. **Tela de edição de configuração pra cliente já ativo** (adicionar/remover vendedor, renomear sala, trocar Nome do Bot, etc., sem precisar de reset). Hoje qualquer ajuste pequeno num cliente já configurado depende de SQL manual. Provavelmente precisa ser dividido em seções: Vendedores (nome/senha/emoji/ativo — o mais usado no dia a dia), Salas (renomear/ativar/desativar/telefones vinculados), Distribuição (sorteio automático/manual, dono de sala dedicada), Nome do Bot (campo único, pode entrar dentro de Vendedores). **Provavelmente também é onde a permissão de sala do item 6 abaixo vai ser configurada** — ligar os dois ao desenhar.

## Iniciativa grande em desenho — permissão de sala + chat interno

6. **Substitui a pergunta antiga sobre vendedor atrelado à sala duas vezes** — o usuário pensou mais e chegou numa arquitetura bem maior: permissão de sala (nem todo colaborador vê toda sala), chat interno entre colaboradores reaproveitando a infraestrutura de `remotejid`/histórico já existente, e um mecanismo de encaminhamento/handoff entre salas com log próprio e "trazer de volta". Ver `[[project_salas_permissao_chat_interno]]` na memória (não há doc no repositório ainda, só memória). **Construção iniciada em 2026-08-16**: tabela `midiabot_vendedor_sala_permissao` criada e populada; `listar_salas`, `listar_mensagens`, `listar_conversas` e `listar_arquivadas` já respeitam a permissão de sala (testado ao vivo, positivo e negativo, nas quatro). Encaminhamento também completo e testado: log (`midiabot_encaminhamento_chat`), bloqueio do painel do gestor durante encaminhamento pendente, ação "trazer de volta", e cópia de contexto (últimas 10 mensagens + avisos de sistema) pra quem recebe a conversa. Frontend do encaminhamento também pronto e testado no navegador de verdade (botão Encaminhar, botão/lista Trazer de volta, mensagens de sistema destacadas visualmente). **Ainda falta**: chat interno, salas por departamento, e a UI de gerenciar permissão de sala (fica pra quando a tela de edição de configuração do item 1 for construída).

## Pendências técnicas conhecidas, prontas pra atacar

2. Erro amigável quando `nome_fantasia` já está em uso no cadastro (a constraint `UNIQUE` já existe no banco, só falta a tela tratar o erro).
3. ~~Revisar se a **Atribuição de Chat** precisa do ajuste de identidade de workflow~~ — **resolvido em 2026-08-16**: `salvar_atribuicao` estava com um bug real de produção (`ON CONFLICT` sem `workflow_name`, movimentação falhava silenciosamente), corrigido e testado; agora também bloqueia mover manualmente um cliente com encaminhamento pendente (ver item 6).
4. `instancias.html` — falta o item 3 do fallback de correção ("Montar item final"), os outros dois já foram aplicados.
5. Confirmar se o cabeçalho `📤 Mensagem enviada por {nome_vendedor}:` do lado do vendedor (mensagens que saem pelo WhatsApp) foi de fato aplicado nos 4 nodes de envio (texto/imagem/vídeo/documento) — foi desenhado numa sessão anterior, nunca reconfirmado rodando de verdade. Áudio ficou fora de escopo por enquanto.

## Decisões que dependem do usuário pensar mais (não são só "codar")

7. Onde/como o quadrinho de login do Midiabot Chat vai aparecer fisicamente na tela inicial do `midiabot.com.br` (seção fixa, modal, etc.).

## Baixo risco, sem solução ainda ou nunca testado — não urgentes

8. Edição de mensagem / reação do cliente final — sem solução aceitável até agora (WAHA testado parcialmente e abandonado; migrar pra API oficial do WhatsApp é opção futura).
9. `liveLocationMessage` (localização em tempo real) — nunca testada; diferente da localização fixa, que já funciona (vira link do Google Maps).

## Envio Ativo — pendências específicas (ver `ENVIO_ATIVO.md` para o resto)

10. Testar campanha atravessando a borda do horário configurado (pausa sozinha ao sair da janela, retoma sozinha no horário seguinte, inclusive de um dia pro outro) — desenhado e implementado, nunca observado rodando de verdade. Adiado de propósito: usuário está aquecendo os números junto à Meta/WhatsApp, não quer arriscar volume num teste maior agora.
11. Opt-out (`midiabot_proibicao_envioativo`) só é checado na criação da campanha (upload da planilha), não é rechecado no momento do envio real — lacuna aceita, mas vale reavaliar.
