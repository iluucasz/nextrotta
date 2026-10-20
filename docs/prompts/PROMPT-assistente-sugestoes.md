# Assistente de IA: sugestões dinâmicas e de continuação

> Prompt de trabalho para a IA que mantém o **NextRotta**. Escrito em 06/10/2026 a partir da produção
> (Central Operacional, commit `85f6f71`). O `CLAUDE.md` deste repositório vale acima de tudo:
> `organization_id` em toda query, `deleted_at IS NULL`, migrações versionadas, nenhum `DELETE`.

## Contexto

O assistente de IA nasceu aqui e foi levado para a produção. Lá, o dono do produto pediu três melhorias,
já validadas com a DeepSeek de verdade. Agora elas precisam voltar para cá. **Mantenha o modelo de
créditos deste repositório**: a produção usa custo em R$ e limite mensal no lugar dos créditos, e isso
**não** deve ser portado.

Código de referência (o pacote `patches/` + `referencia/` foi arquivado fora do repositório; a mudança já está aplicada — ver `lib/ai/suggestions.ts` e `docs/assistente-ia.md`). Para o original, leia a produção, commit `85f6f71`.

## O que o dono pediu

1. **Sugestões iniciais dinâmicas e pelo menos 4.** Hoje são 4 fixas em `components/assistant/workspace.tsx`
   (`const suggestions`), e o chat flutuante mostra só 2.
2. **Clicar numa sugestão já envia a pergunta**, sem passar pela caixa de texto.
3. **Depois de cada resposta, o assistente dá novas sugestões**, em toda interação.

## Como fazer

### 1. Sugestões iniciais a partir dos dados (`lib/ai/suggestions.ts`, novo)

`getStarterSuggestions(organizationId)` monta as perguntas com base no estado atual da organização:

- **O que pede atenção vem primeiro:**
  - advertências de laudo no mês (`schedule.notes LIKE '%ADVERTÊNCIA:%'`) → "Quem recebeu advertência de laudo em outubro?";
  - folhas do mês anterior que não estão `closed` → "Quais folhas de setembro ainda estão em rascunho?";
  - última execução de horas do robô com `status = 'error'` ou `error_message` começando com "Atenção" → "O que deu errado na última execução do robô do Porto?".
- **O resto é sorteado a cada abertura** de uma lista com o nome do mês: produção do mês; quem está
  abaixo da jornada; escala de amanhã; produção da quinzena comparada com o mês anterior; valor médio
  por OS; técnico sem horas nos últimos dias.
- **Quando não há problema**, entra a versão neutra da mesma pergunta ("Algum técnico recebeu
  advertência…", "Qual foi o líquido total da folha de setembro?", "O robô do Porto importou as horas
  de ontem?").
- **Contas pendentes no mês** → "Quais contas de outubro ainda estão pendentes?". Só com o recurso
  `finance` do plano.
- **Mês sem OS ainda** (início do mês) → a pergunta de produção usa o mês anterior.
- **Retorno:** de 4 a 6 perguntas, as urgentes primeiro e o resto embaralhado.

**Adaptações obrigatórias:**

- toda query filtrada por `organization_id` e `deleted_at IS NULL`;
- cache de 5 min **por organização** (a produção usa um cache único, porque tem um cliente só);
- não sugerir o que o plano não tem: sem o recurso do Porto, nada sobre o robô; sem `finance`, nada
  de contas;
- se uma consulta falhar, cair nas sugestões neutras. A lista nunca pode vir vazia.

O `GET /api/assistant` passa a devolver `suggestions` junto do status.

### 2. Sugestões depois de cada resposta (`lib/ai/assistant.ts`)

- **Prompt de sistema:** acrescente esta regra: ao final de **toda** resposta, numa linha separada,
  escrever `[[SUGESTOES]]` seguido de um array JSON com 3 perguntas curtas (até 70 caracteres), escritas
  como o administrador perguntaria e ligadas ao que acabou de ser respondido. Nada depois do array. O
  texto exato está em `referencia/lib/ai/assistant.ts`.
- **`splitFollowUps(raw)`:** procura o **último** `[[SUGESTOES]]`, devolve
  `{ answer, suggestions }` e tira o marcador do texto. Se o marcador faltar ou o JSON vier quebrado,
  devolve `suggestions: []` e a resposta continua valendo (nunca falhar por causa disso). Filtra itens
  que não são texto ou passam de 120 caracteres, e fica com no máximo 3.
- **Gravação:** migração nova (a próxima depois da `0018`) com
  `ALTER TABLE ai_messages ADD COLUMN suggestions JSONB`. Grave junto com a resposta e devolva
  `suggestions` no `ask()` e no `getConversation()`.
- **Créditos:** o débito não muda. As sugestões vêm na mesma chamada, sem chamada extra (custam só
  ~30 tokens de saída).
- **Contexto:** o histórico enviado ao modelo é o `content` já sem o marcador. Isso é o correto.

### 3. Tela (`components/assistant/workspace.tsx` + `assistant.css`)

- **Tipos:** `Status.suggestions: string[]`; `Message.suggestions?: string[]`.
- **Sugestões iniciais:** usam `status.suggestions`, com a lista fixa atual como reserva enquanto
  carrega. O chat flutuante (`compact`) mostra **4**; a tela inteira mostra **6**.
- **Envio:** `send(text?: string)` usa `text ?? question`. Clique numa sugestão → `void send(text)`.
- **Botões embaixo da resposta:** só embaixo da **última** resposta do assistente, e somente quando não
  está respondendo. Cada botão envia ao clicar. A classe `.ai-followups` usa botões em formato de pílula
  com as cores `--ai-*` (CSS pronto em `referencia/components/assistant/assistant.css`). No visual,
  respeite o território da IA de design definido no `CLAUDE.md`.
- **Testes de navegador:** atualize os dados fictícios do `components/assistant/validate.mjs` com
  `suggestions` no status e nas mensagens.

### Opcional: consultas que a produção ganhou

A produção também enriqueceu as consultas (`referencia/lib/ai/tools.ts`). Vale trazer, por organização:

- **`horas_trabalhadas`:** passa a trazer `dias_importados_do_porto`, as situações do dia
  (folga/falta/justificado/serviço cancelado, lidas de `schedule.notes`, prefixo `Apontamento manual:`)
  e `advertencias` com as datas (`ADVERTÊNCIA:` na observação).
- **`robo_do_porto` (nova):** se a automação está ligada ou em modo teste, mais as 12 últimas execuções
  com resultado, avisos e `layout_suspect`. Só com o recurso do Porto no plano.

## Como validar

1. **Unitário de `splitFollowUps`:** com marcador; sem marcador; JSON quebrado; marcador no meio do
   texto (vale o último).
2. **`getStarterSuggestions`:** em duas organizações de teste, nunca menos de 4, sem vazar dados de
   uma para a outra e respeitando os recursos do plano.
3. **Uma pergunta real com a DeepSeek** (custa menos de 1 centavo). Confira que:
   - o marcador não aparece no texto;
   - vêm 3 sugestões ligadas à resposta;
   - os créditos são debitados como antes.
4. `npx tsc --noEmit` limpo. Atualize o `CLAUDE.md` e a documentação do assistente deste repositório.
