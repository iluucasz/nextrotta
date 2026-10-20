/**
 * Catalogue of the WhatsApp notifications sent to technicians: what each one is, when it fires,
 * which variables its template can use, and the defaults. Dependency-free so the admin page
 * (client) and the jobs (server/worker) share one definition.
 */

export const NOTIFICATION_TYPES = [
  'payroll_closed',
  'monthly_schedule',
  'next_day_shift',
  'daily_hours',
  'day_off',
  'justified',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** `event`: fires when an admin action happens. `daily`/`monthly`: fires at a configured time. */
export type NotificationTrigger = 'event' | 'daily' | 'monthly';

export interface NotificationSetting {
  enabled: boolean;
  /** HH:MM in Brasília time. Used by daily and monthly notifications. */
  time: string;
  /** 1-28. Used by monthly notifications only. */
  dayOfMonth: number;
  template: string;
}

export type NotificationSettings = Record<NotificationType, NotificationSetting>;

export interface NotificationVariable {
  key: string;
  description: string;
  example: string;
}

/** Plain-language explanation shown in the "?" of each notification card. */
export interface NotificationHelp {
  /** What the technician gets out of it. */
  purpose: string;
  /** When it fires. */
  when: string;
  /** Who it reaches, and who it skips. */
  recipients: string[];
  /** Anything easy to get wrong. */
  notes: string[];
}

export interface NotificationDefinition {
  label: string;
  description: string;
  trigger: NotificationTrigger;
  defaultTime: string;
  defaultTemplate: string;
  variables: NotificationVariable[];
  help: NotificationHelp;
}

const NAME_VARIABLE: NotificationVariable = { key: 'nome', description: 'Primeiro nome do técnico', example: 'Alex' };

export const NOTIFICATION_DEFINITIONS: Record<NotificationType, NotificationDefinition> = {
  payroll_closed: {
    label: 'Folha fechada',
    description: 'Enviada quando a folha do técnico é fechada no admin.',
    trigger: 'event',
    defaultTime: '09:00',
    defaultTemplate:
      'Olá, {nome}! 👋\n\nSua folha de *{competencia}* foi fechada. Os valores já estão disponíveis no sistema, na aba *Pagamento*.',
    variables: [
      NAME_VARIABLE,
      { key: 'competencia', description: 'Mês da folha', example: 'setembro de 2026' },
      { key: 'valor_em_conta', description: 'Valor líquido pago em conta', example: 'R$ 2.450,00' },
      { key: 'link', description: 'Link da tela de pagamento do técnico no sistema da empresa', example: 'https://suaempresa.nextrotta.com.br/dashboard/payroll' },
    ],
    help: {
      purpose: 'Avisa o técnico de que o pagamento do mês foi fechado e já pode ser conferido no sistema.',
      when: 'Na hora em que você salva a folha dele como fechada, em Folha. Não tem horário: é na hora do evento.',
      recipients: ['O técnico daquela folha, e só ele.', 'Folha salva como rascunho não envia nada.'],
      notes: [
        'Uma mensagem por técnico por competência. Reabrir e fechar a mesma folha de novo não reenvia.',
        'A variável {valor_em_conta} coloca o valor líquido na mensagem. Se preferir não mandar valor por WhatsApp, é só não usá-la.',
      ],
    },
  },
  monthly_schedule: {
    label: 'Escala do mês',
    description: 'Enviada no dia e horário escolhidos, com a escala do mês inteiro.',
    trigger: 'monthly',
    defaultTime: '09:00',
    defaultTemplate: 'Olá, {nome}! 📅\n\nSegue sua escala de *{mes}*:\n\n{escala}\n\nQualquer dúvida, fale com a administração.',
    variables: [
      NAME_VARIABLE,
      { key: 'mes', description: 'Mês da escala', example: 'setembro de 2026' },
      { key: 'escala', description: 'Lista dia a dia da escala', example: '01/09 (ter) — 08:00 às 18:00\n02/09 (qua) — Folga' },
    ],
    help: {
      purpose: 'Manda a escala do mês inteiro, dia a dia, para o técnico se organizar.',
      when: 'Uma vez por mês, no dia e horário escolhidos acima, sempre com a escala do mês corrente.',
      recipients: ['Todo técnico ativo que tenha algum dia lançado na escala do mês.', 'Quem não tem nenhum dia na escala do mês não recebe.'],
      notes: [
        'A lista sai igual ao que está na escala: horário do turno, Folga ou Indisponível (férias, atestado).',
        'Se a escala do mês ainda não tiver sido importada do Porto quando a mensagem sair, ela vai incompleta. Escolha um dia/horário depois da importação.',
        'Uma mensagem por técnico por mês. Mudou a escala depois? Use "Rodar agora" só depois de apagar a linha antiga no Histórico, ou avise por fora.',
      ],
    },
  },
  next_day_shift: {
    label: 'Horário do dia seguinte',
    description: 'Enviada todo dia no horário escolhido, para quem tem escala no dia seguinte.',
    trigger: 'daily',
    defaultTime: '18:00',
    defaultTemplate: 'Olá, {nome}! ⏰\n\nLembrete: amanhã, *{dia_semana} ({data})*, seu horário é das *{inicio}* às *{fim}*.\n\nAté amanhã!',
    variables: [
      NAME_VARIABLE,
      { key: 'data', description: 'Data de amanhã', example: '20/09/2026' },
      { key: 'dia_semana', description: 'Dia da semana de amanhã', example: 'domingo' },
      { key: 'inicio', description: 'Hora de entrada', example: '08:00' },
      { key: 'fim', description: 'Hora de saída', example: '18:00' },
    ],
    help: {
      purpose: 'Lembra o técnico, na véspera, do horário em que ele trabalha amanhã.',
      when: 'Todo dia, no horário escolhido acima. Sempre olha o dia seguinte, nunca o dia de hoje.',
      recipients: [
        'Quem tem escala amanhã com horário definido.',
        'Quem está de folga, férias ou sem nada na escala amanhã não recebe.',
      ],
      notes: [
        'Costuma atingir poucos técnicos por vez, diferente da escala do mês, que vai para todos.',
        'Uma mensagem por técnico por dia.',
      ],
    },
  },
  daily_hours: {
    label: 'Fim do expediente',
    description: 'Enviada após a importação noturna das horas da Porto (horário em Configurações), com as horas registradas no dia.',
    trigger: 'daily',
    defaultTime: '23:30',
    defaultTemplate:
      'Olá, {nome}! ✅\n\nSeu expediente de hoje ({data}) foi registrado: *{horas}* trabalhadas ({entrada} às {saida}).\n\nNo mês você soma *{horas_mes}* de {meta_mes}.',
    variables: [
      NAME_VARIABLE,
      { key: 'data', description: 'Data do expediente', example: '19/09/2026' },
      { key: 'horas', description: 'Horas trabalhadas no dia', example: '9h' },
      { key: 'entrada', description: 'Primeira entrada do dia', example: '08:00' },
      { key: 'saida', description: 'Última saída do dia', example: '18:00' },
      { key: 'horas_mes', description: 'Horas somadas no mês', example: '152h' },
      { key: 'meta_mes', description: 'Meta de horas do mês', example: '220h' },
    ],
    help: {
      purpose: 'Fecha o dia com o técnico: mostra as horas registradas e como está o total do mês.',
      when: 'Logo depois que o sistema importa as horas da Porto (horário definido em Configurações). O horário acima é a segunda chance: só dispara depois que a importação do dia terminou.',
      recipients: ['Quem teve horas lançadas hoje.', 'Quem não trabalhou ou ainda não teve o apontamento importado não recebe.'],
      notes: [
        'Os valores vêm do que está gravado em banco de horas, inclusive apontamentos lançados à mão.',
        'Uma mensagem por técnico por dia.',
      ],
    },
  },
  day_off: {
    label: 'Folga',
    description: 'Enviada no dia da folga, no horário escolhido.',
    trigger: 'daily',
    defaultTime: '08:00',
    defaultTemplate: 'Bom dia, {nome}! 🌴\n\nHoje ({data}) é a sua folga. Desejamos um ótimo dia de descanso!',
    variables: [
      NAME_VARIABLE,
      { key: 'data', description: 'Data da folga', example: '19/09/2026' },
      { key: 'dia_semana', description: 'Dia da semana', example: 'sábado' },
    ],
    help: {
      purpose: 'Deseja um bom descanso no dia de folga do técnico.',
      when: 'No próprio dia da folga, no horário escolhido acima.',
      recipients: [
        'Quem está de folga hoje na escala.',
        'Férias, atestado e outras indisponibilidades não recebem: a mensagem de descanso soaria errada.',
      ],
      notes: ['Uma mensagem por técnico por dia.'],
    },
  },
  justified: {
    label: 'Ausência justificada',
    description: 'Enviada quando o admin marca um dia do técnico como "Justificou".',
    trigger: 'event',
    defaultTime: '09:00',
    defaultTemplate: 'Olá, {nome}.\n\nSua ausência do dia *{data}* foi registrada como *justificada* no sistema.',
    variables: [
      NAME_VARIABLE,
      { key: 'data', description: 'Data justificada', example: '18/09/2026' },
      { key: 'observacao', description: 'Observação do apontamento (vazio se não houver)', example: 'Atestado médico' },
    ],
    help: {
      purpose: 'Confirma ao técnico que a ausência dele foi registrada como justificada, e não como falta.',
      when: 'Na hora em que você marca o dia como "Justificou", em Escala ou no apontamento de horas.',
      recipients: ['O técnico daquele dia.'],
      notes: [
        'Uma mensagem por técnico por dia justificado. Salvar a mesma semana de novo não reenvia.',
        'A variável {observacao} traz o que você escreveu no apontamento. Fica vazia se não houver observação.',
      ],
    },
  },
};

export function createDefaultNotificationSettings(): NotificationSettings {
  return Object.fromEntries(
    NOTIFICATION_TYPES.map((type) => [
      type,
      { enabled: false, time: NOTIFICATION_DEFINITIONS[type].defaultTime, dayOfMonth: 1, template: NOTIFICATION_DEFINITIONS[type].defaultTemplate },
    ]),
  ) as NotificationSettings;
}

const TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Fills gaps and discards invalid values, so a stored or submitted object is always complete. */
export function normalizeNotificationSettings(value: unknown): NotificationSettings {
  const defaults = createDefaultNotificationSettings();
  if (!isRecord(value)) return defaults;

  for (const type of NOTIFICATION_TYPES) {
    const raw = value[type];
    if (!isRecord(raw)) continue;

    const day = Number(raw.dayOfMonth);
    defaults[type] = {
      enabled: typeof raw.enabled === 'boolean' ? raw.enabled : defaults[type].enabled,
      time: typeof raw.time === 'string' && TIME_PATTERN.test(raw.time) ? raw.time : defaults[type].time,
      // Capped at 28 so the day exists in every month, February included.
      dayOfMonth: Number.isInteger(day) && day >= 1 && day <= 28 ? day : defaults[type].dayOfMonth,
      template: typeof raw.template === 'string' && raw.template.trim() ? raw.template : defaults[type].template,
    };
  }

  return defaults;
}

/** Replaces `{variavel}` placeholders. Unknown placeholders are left as typed, so typos stay visible. */
export function renderTemplate(template: string, variables: Record<string, string>) {
  return template.replace(/\{([a-z_]+)\}/g, (match, key: string) => (key in variables ? variables[key] : match));
}

export function exampleVariables(type: NotificationType) {
  return Object.fromEntries(NOTIFICATION_DEFINITIONS[type].variables.map((variable) => [variable.key, variable.example]));
}

export const MESSAGE_STATUSES = ['pending', 'sent', 'failed', 'skipped'] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  pending: 'Enviando',
  sent: 'Enviada',
  failed: 'Falhou',
  skipped: 'Não enviada',
};

/** Where a message came from. `test` = the admin's test message, not tied to a notification type. */
export type MessageTrigger = 'auto' | 'event' | 'manual' | 'test';

export const MESSAGE_TRIGGER_LABELS: Record<MessageTrigger, string> = {
  auto: 'Automático',
  event: 'Evento',
  manual: 'Manual',
  test: 'Teste',
};

/** Messages sent to the end customer of a parts sale (payment link and receipt), not to technicians. */
export type CustomerMessageType = 'parts_sale';

export const MESSAGE_TYPE_LABELS: Record<NotificationType | 'test' | CustomerMessageType, string> = {
  ...(Object.fromEntries(NOTIFICATION_TYPES.map((type) => [type, NOTIFICATION_DEFINITIONS[type].label])) as Record<NotificationType, string>),
  test: 'Mensagem de teste',
  parts_sale: 'Venda de peças (cliente)',
};
