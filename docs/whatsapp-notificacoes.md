# Notificações por WhatsApp

Tela: **Admin → WhatsApp** (`/admin/whatsapp`). Envio via Evolution API, sem SDK: `POST {url}/message/sendText/{instância}` com o header `apikey`.

## Servidor e instâncias

- **Servidor (um só, de todas as organizações):** `EVOLUTION_API_URL` e `EVOLUTION_API_KEY` (chave global), só no ambiente — `.env`, Vercel **e** container do worker. Nunca são enviados a nenhuma tela.
- **Instância (uma por organização):** sempre com o nome do subdomínio (ex.: `kappa`), criada pelo admin da própria empresa na aba **Conexão** → **Conectar WhatsApp** (`POST /instance/create`, Baileys). A tela mostra o QR Code (`GET /instance/connect`), renovado a cada 30 s e verificado a cada 4 s até a leitura. Um número por instância; **Trocar número** faz `DELETE /instance/logout` e a instância fica pronta para outro QR Code.
- Se já existir no servidor uma instância com o nome do subdomínio que não seja da empresa, a criação é recusada (nunca assume a instância de outro cliente). Se a instância sumir do servidor, a empresa pode criá-la de novo.
- Código: `lib/whatsapp/evolution.ts` (cliente), `lib/whatsapp/instance.ts` (regras), `/api/whatsapp/instance` (GET estado, POST criar, DELETE desconectar) e `/api/whatsapp/instance/qrcode`. O estado e o número ficam em cache em `whatsapp_config` (migração `0012`) para o painel do dono (aba Integrações da organização e Operação). Criar e desconectar entram na auditoria.

## Configuração

1. Conecte o WhatsApp da empresa na aba **Conexão** (instância + QR Code).
2. Use a **Mensagem de teste** (só com o número conectado).
3. Cadastre o WhatsApp de cada técnico em **Técnicos → Editar**. Técnicos sem número aparecem listados na aba Conexão.
4. Para validar antes de liberar, preencha o **Número de teste**: todas as notificações vão para ele e nenhum técnico recebe. Esses envios não contam como entregues, então ao esvaziar o campo cada técnico ainda recebe a mensagem dele.
5. Ligue **Automação ativa** e as notificações desejadas na aba **Notificações**.

Recomendação: usar uma instância própria para este sistema, não a do WhatsApp da clínica.

## Notificações

| Notificação | Quando | Quem recebe |
|---|---|---|
| Folha fechada | Ao salvar a folha como fechada (`POST /api/payroll`) | O técnico da folha, uma vez por competência |
| Escala do mês | Dia e hora configurados | Técnicos com escala no mês |
| Horário do dia seguinte | Diariamente, na hora configurada | Quem tem escala `scheduled` com horário amanhã |
| Fim do expediente | Logo após o job de horas da Porto (23h); a hora configurada é a segunda chance | Quem tem horas lançadas hoje |
| Folga | Diariamente, na hora configurada | Quem tem folga hoje (só "folga": férias e outras indisponibilidades não) |
| Ausência justificada | Ao salvar um dia como "Justificou" (`POST /api/work-hours`) | O técnico, uma vez por dia justificado |

Os horários são sempre de Brasília. Os envios agendados rodam no **worker da VPS** (`worker/index.ts`), que verifica a cada 5 minutos o que está no horário. Cada notificação agendada roda uma vez por dia (ou por mês). Se o worker estiver fora do ar, ela ainda sai até 3h depois do horário; passado isso, fica para o próximo ciclo.

Nenhuma mensagem é enviada duas vezes com sucesso: cada uma tem uma chave única (ex.: `day_off:{técnico}:{data}`). Mensagens desviadas para o número de teste não usam essa chave, porque não chegaram ao técnico. Falhas e envios pulados (sem telefone, sem configuração) liberam a chave, então **Rodar agora** ou **Reenviar** tentam de novo.

## Histórico

A aba **Histórico** lista todos os envios com filtro por período (diário, mensal, anual, personalizado ou tudo), técnicos, notificação e status. Exporta para Excel ou CSV com os mesmos filtros (até 20.000 linhas por arquivo). Permite reenviar qualquer mensagem.

## Deploy

- **Vercel**: nada novo além do código. As tabelas `whatsapp_config` e `whatsapp_messages` e a coluna `technicians.phone` são criadas sozinhas no primeiro uso.
- **VPS**: é preciso **rebuildar e reiniciar o container do worker** para as notificações agendadas começarem a sair. Sem isso, só funcionam os eventos (folha e justificativa), os testes e o "Rodar agora".
