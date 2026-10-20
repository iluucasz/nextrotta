# Assistente de IA

Um chat para o admin da empresa perguntar sobre a operação ("qual técnico mais produziu?", "quem
tomou advertência este mês?", "o robô do Porto rodou bem ontem?"). O modelo (DeepSeek, `deepseek-chat`)
**só lê**: escolhe uma das consultas fixas de `lib/ai/tools.ts` e seus parâmetros, nunca escreve SQL,
nunca altera dados e nunca vê outra organização (toda consulta filtra `organization_id` e `deleted_at`).

- Tela: `/admin/assistente` (menu "Assistente IA") e o chat flutuante (`components/assistant/widget.tsx`),
  só para admin, fora do modo preview e com o recurso `ai` do plano.
- API: `GET|POST /api/assistant` (status com saldo e sugestões iniciais, conversas / perguntar) e
  `GET|DELETE /api/assistant/[id]` (abrir / arquivar conversa). `lib/ai/route.ts` decide quem entra.
- Conversas são por admin (`ai_conversations.user_id`); arquivar só esconde (`deleted_at`).
- Até 6 rodadas de consultas por pergunta; as últimas 12 mensagens da conversa vão como contexto.

## Créditos

- Cada resposta debita `creditsPerUse` créditos (configurações da plataforma) no extrato
  `ai_credit_ledger` (cota mensal do plano, bônus de entrada, compras, ajustes do dono, consumo).
  Sem saldo, o assistente para de responder até a próxima cota ou uma compra.
- O custo real do provedor é guardado em cada mensagem (`ai_messages.cost`, pelos preços por milhão de
  tokens das configurações da plataforma) e aparece para o dono.
- O dono dentro da conta da empresa não consome créditos dela.

## Sugestões

- **Iniciais** (`lib/ai/suggestions.ts`, `getStarterSuggestions(organizationId)`): montadas a partir
  dos dados da organização, com cache de 5 min por organização.
  - O que pede atenção vem primeiro: advertências de laudo no mês, folhas do mês anterior em rascunho, última execução do robô com erro ou avisos.
  - O resto é sorteado a cada abertura.
  - Só entra o que o plano tem: nada do robô sem o recurso `porto`, nada de contas sem `finance`.
  - Se uma consulta falhar, valem as perguntas neutras. Sempre de 4 a 6: o chat flutuante mostra 4 e a tela mostra 6.
  - Clicar já envia a pergunta.
- **Depois de cada resposta:** o modelo termina com `[[SUGESTOES]] ["...", "...", "..."]`.
  `splitFollowUps` (`lib/ai/assistant.ts`) tira isso do texto (vale o último marcador) e guarda em
  `ai_messages.suggestions` (migração `0019`). As sugestões aparecem como botões só embaixo da última
  resposta, e também enviam ao clicar. Lista ausente ou malformada = resposta sem sugestões: nunca quebra
  a resposta. Vêm na mesma chamada (≈30 tokens de saída), sem mudar o débito de créditos.

## Consultas (`lib/ai/tools.ts`)

| Consulta | O que traz |
|---|---|
| `resumo_da_empresa` | Regras da empresa, técnicos ativos/inativos, competências com OS |
| `listar_tecnicos` | Nome, QRA, situação, comissão/salário/VA/VR próprios |
| `producao_por_tecnico` | OS e valor por técnico e por tipo, numa competência (opcional Q1/Q2) |
| `listar_os` | Até 150 OS de uma competência, opcionalmente de um técnico |
| `folha_da_competencia` | Folha por técnico (rascunho/fechada) |
| `horas_trabalhadas` | Horas, dias, média, diferença para a jornada, dias importados do Porto, situações (folga/falta/justificado/serviço cancelado) e advertências com as datas, lidas da observação da escala |
| `escala` | Turnos de até 62 dias |
| `descontos_e_adiantamentos` | Lançamentos da folha de uma competência |
| `financeiro_do_mes` | Contas a pagar/receber do mês (só com o recurso `finance`) |
| `robo_do_porto` | Automação ligada/modo teste e as 12 últimas execuções: resultado, avisos, possível mudança de tela do portal (só com o recurso `porto`) |

Resultado acima de 24 mil caracteres é cortado e o modelo é orientado a filtrar.

## Configuração e testes

- `DEEPSEEK_API_KEY` (obrigatória) e `DEEPSEEK_MODEL` (opcional) no ambiente.
- Schema: migrações `0010` (conversas, mensagens, extrato) e `0019` (sugestões).
- `components/assistant/validate.mjs`: teste de navegador com dados fictícios (Chrome com
  `--remote-debugging-port=9223`). Cobre as sugestões iniciais (6 na tela, 4 no chat flutuante), o
  envio ao clicar, as sugestões só embaixo da última resposta, o saldo, os erros, o histórico, o
  consumo, as preferências e o celular.
