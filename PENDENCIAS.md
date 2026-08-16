# Pendências

Lista organizada de próximos passos, em 2026-08-16. Itens específicos do Envio Ativo têm mais detalhe em `ENVIO_ATIVO.md`.

## Prioridade alta — próximo a atacar

1. **Tela de edição de configuração pra cliente já ativo** (adicionar/remover vendedor, renomear sala, trocar Nome do Bot, etc., sem precisar de reset). Hoje qualquer ajuste pequeno num cliente já configurado depende de SQL manual. Provavelmente precisa ser dividido em seções: Vendedores (nome/senha/emoji/ativo — o mais usado no dia a dia), Salas (renomear/ativar/desativar/telefones vinculados), Distribuição (sorteio automático/manual, dono de sala dedicada), Nome do Bot (campo único, pode entrar dentro de Vendedores).

## Pendências técnicas conhecidas, prontas pra atacar

2. Erro amigável quando `nome_fantasia` já está em uso no cadastro (a constraint `UNIQUE` já existe no banco, só falta a tela tratar o erro).
3. Revisar se a **Atribuição de Chat** (`listar_remotejids`/`salvar_atribuicao`, painel admin) também precisa do ajuste de identidade de workflow feito em outros lugares — ainda não avaliado.
4. `instancias.html` — falta o item 3 do fallback de correção ("Montar item final"), os outros dois já foram aplicados.
5. Confirmar se o cabeçalho `📤 Mensagem enviada por {nome_vendedor}:` do lado do vendedor (mensagens que saem pelo WhatsApp) foi de fato aplicado nos 4 nodes de envio (texto/imagem/vídeo/documento) — foi desenhado numa sessão anterior, nunca reconfirmado rodando de verdade. Áudio ficou fora de escopo por enquanto.

## Decisões que dependem do usuário pensar mais (não são só "codar")

6. Por que o vendedor fica atrelado à sala em dois lugares (`midiabot_sender_chatid` e `midiabot_vendedores.sender`) — usuário disse que ia pensar mais, nunca foi retomado.
7. Onde/como o quadrinho de login do Midiabot Chat vai aparecer fisicamente na tela inicial do `midiabot.com.br` (seção fixa, modal, etc.).

## Baixo risco, sem solução ainda ou nunca testado — não urgentes

8. Edição de mensagem / reação do cliente final — sem solução aceitável até agora (WAHA testado parcialmente e abandonado; migrar pra API oficial do WhatsApp é opção futura).
9. `liveLocationMessage` (localização em tempo real) — nunca testada; diferente da localização fixa, que já funciona (vira link do Google Maps).

## Envio Ativo — pendências específicas (ver `ENVIO_ATIVO.md` para o resto)

10. Testar campanha atravessando a borda do horário configurado (pausa sozinha ao sair da janela, retoma sozinha no horário seguinte, inclusive de um dia pro outro) — desenhado e implementado, nunca observado rodando de verdade. Adiado de propósito: usuário está aquecendo os números junto à Meta/WhatsApp, não quer arriscar volume num teste maior agora.
11. Opt-out (`midiabot_proibicao_envioativo`) só é checado na criação da campanha (upload da planilha), não é rechecado no momento do envio real — lacuna aceita, mas vale reavaliar.
