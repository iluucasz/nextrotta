// No dependencies on the database or the framework: used by the routes, the webhook, the panel and the tests.
// The automatic messages of the Livechat: the catalog (with the default texts), the templates, the business hours and the decision
// of which automatic replies a message that arrives on WhatsApp deserves.

export type AutoKey =
  | 'chat_welcome'
  | 'chat_welcome_whatsapp'
  | 'chat_closing_web'
  | 'chat_closing_whatsapp'
  | 'case_closing'
  | 'whatsapp_greeting'
  | 'whatsapp_away'
  | 'whatsapp_media';

export type AutoVariable = 'nome' | 'chamado' | 'horario';

export type AutoMessageDefinition = {
  key: AutoKey;
  /** Where in the conversation it is said. */
  group: 'chat' | 'case' | 'whatsapp';
  label: string;
  /** What triggers it (shown behind the "?"). */
  help: string;
  variables: AutoVariable[];
  defaultEnabled: boolean;
  defaultText: string;
};

export const MAX_AUTO_MESSAGE_LENGTH = 1000;

export const VARIABLE_HELP: Record<AutoVariable, string> = {
  nome: 'Primeiro nome da pessoa (some sozinho quando não se sabe).',
  chamado: 'Número do chamado, como #123 (some sozinho quando não há).',
  horario: 'O horário de atendimento configurado, por exemplo "segunda a sexta, das 9h às 18h".',
};

export const AUTO_MESSAGES: AutoMessageDefinition[] = [
  {
    key: 'chat_welcome',
    group: 'chat',
    label: 'Chat começa (no sistema)',
    help: 'Primeira mensagem da equipe quando o cliente abre um chat ao vivo pelo sistema. Já é enviada hoje.',
    variables: ['nome', 'chamado'],
    defaultEnabled: true,
    defaultText:
      'Olá, {nome}! Recebemos o seu chamado urgente {chamado}. Em instantes um de nossos atendentes vai falar com você por aqui. Enquanto isso, pode ir adiantando os detalhes do que precisa. Se tiver um print ou arquivo, é só anexar aqui no chat. 😊',
  },
  {
    key: 'chat_welcome_whatsapp',
    group: 'chat',
    label: 'Chat começa (cópia no WhatsApp do cliente)',
    help: 'A mesma abertura, enviada ao WhatsApp que o cliente informou ao abrir o chat. Já é enviada hoje.',
    variables: ['nome', 'chamado'],
    defaultEnabled: true,
    defaultText:
      'Olá, {nome}! Recebemos o seu chamado urgente {chamado}. Em instantes um de nossos atendentes vai falar com você por aqui, no WhatsApp, e no chat do sistema. Enquanto isso, pode ir adiantando os detalhes do que precisa. Se tiver um print ou arquivo, pode mandar por aqui mesmo. 😊',
  },
  {
    key: 'chat_closing_web',
    group: 'chat',
    label: 'Chat termina (no sistema)',
    help: 'Agradecimento ao encerrar um chat do sistema, por você ou pelo cliente. Ao encerrar pelo painel, o texto vem preenchido e ainda dá para editar.',
    variables: ['nome', 'chamado'],
    defaultEnabled: true,
    defaultText:
      'Obrigado pelo seu contato! Foi um prazer ajudar. Estamos encerrando este atendimento, mas, se precisar de mais alguma coisa, é só chamar: inicie um novo chat ao vivo ou abra um chamado pelo sistema. Até a próxima! 😊',
  },
  {
    key: 'chat_closing_whatsapp',
    group: 'chat',
    label: 'Conversa do WhatsApp termina',
    help: 'Agradecimento ao encerrar uma conversa que começou no WhatsApp. Ao encerrar pelo painel, o texto vem preenchido e ainda dá para editar.',
    variables: ['nome'],
    defaultEnabled: true,
    defaultText:
      'Obrigado pelo seu contato! Foi um prazer ajudar. Estamos encerrando este atendimento, mas, se precisar de mais alguma coisa, é só chamar: escreva de novo para este número ou abra um chamado pelo sistema. Até a próxima! 😊',
  },
  {
    key: 'case_closing',
    group: 'case',
    label: 'Chamado por escrito concluído',
    help: 'Mensagem que fecha um chamado por escrito (Suporte, Bug, Sugestão) quando você o conclui. Ao concluir, o texto vem preenchido e dá para editar ou não enviar.',
    variables: ['chamado'],
    defaultEnabled: true,
    defaultText:
      'Olá! Seu chamado {chamado} foi encerrado. Agradecemos o seu contato! Se ainda precisar de ajuda, é só abrir um novo chamado pelo sistema que a nossa equipe responde. 😊',
  },
  {
    key: 'whatsapp_greeting',
    group: 'whatsapp',
    label: 'Primeira mensagem no WhatsApp',
    help: 'Quando alguém escreve para o número oficial e não há conversa aberta, ele recebe esta resposta (uma vez por conversa). Não vale para quem já está num chat do sistema. Fora do horário, se a mensagem de ausência estiver ligada, ela vai no lugar desta.',
    variables: ['nome'],
    defaultEnabled: false,
    defaultText: 'Olá, {nome}! Obrigado por falar com a NextRotta. Recebemos a sua mensagem e em instantes um de nossos atendentes responde por aqui. 😊',
  },
  {
    key: 'whatsapp_away',
    group: 'whatsapp',
    label: 'Fora do horário de atendimento',
    help: 'Quando chega uma mensagem no WhatsApp fora do horário abaixo, o cliente recebe este aviso (no máximo uma vez a cada 6 horas por conversa). O horário é o de Brasília.',
    variables: ['nome', 'horario'],
    defaultEnabled: false,
    defaultText: 'Olá, {nome}! No momento estamos fora do horário de atendimento ({horario}). Deixe a sua mensagem que respondemos assim que voltarmos. 😊',
  },
  {
    key: 'whatsapp_media',
    group: 'whatsapp',
    label: 'Cliente manda foto, áudio ou arquivo',
    help: 'Hoje fotos, áudios e documentos que chegam no WhatsApp aparecem só como aviso no painel. Esta resposta pede ao cliente que explique em texto ou envie o arquivo pelo chat do sistema (no máximo uma vez por hora por conversa).',
    variables: ['nome'],
    defaultEnabled: false,
    defaultText: 'Olá, {nome}! Recebemos o seu arquivo, mas por aqui só conseguimos ler mensagens de texto. Pode nos explicar em texto o que precisa? Se quiser enviar print ou documento, abra um chat pelo sistema e anexe lá. 🙏',
  },
];

export const AUTO_KEYS = AUTO_MESSAGES.map((message) => message.key);
export const isAutoKey = (value: unknown): value is AutoKey => typeof value === 'string' && (AUTO_KEYS as string[]).includes(value);
export const autoDefinition = (key: AutoKey): AutoMessageDefinition => AUTO_MESSAGES.find((message) => message.key === key)!;

// ------------------------------------------------------------------------------------------------------------- templates

/** The ticket number as a variable: "#123", or nothing when there is none. */
export const ticketVariable = (ticketNumber: number | null | undefined) => (ticketNumber ? `#${ticketNumber}` : '');

/** The first name of a person ("" when unknown). */
export function firstName(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * Fills the variables of a template. A variable that has no value disappears and the punctuation around it is tidied, so
 * "Olá, {nome}!" reads "Olá!" when the name is unknown and "chamado {chamado}." reads "chamado." without a number.
 */
export function renderAutoMessage(template: string, values: Partial<Record<AutoVariable, string>> = {}): string {
  return template
    .replace(/\{(nome|chamado|horario)\}/g, (_, name: AutoVariable) => values[name] ?? '')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ([,.!?;:])/g, '$1')
    .replace(/,([!.?])/g, '$1')
    .replace(/ \n/g, '\n')
    .trim();
}

/** The reason a template cannot be saved (null when it can): empty, too long, or with a variable that does not exist here. */
export function templateProblem(key: AutoKey, body: unknown): string | null {
  if (typeof body !== 'string' || !body.trim()) return 'Escreva a mensagem.';
  if (body.trim().length > MAX_AUTO_MESSAGE_LENGTH) return `A mensagem pode ter até ${MAX_AUTO_MESSAGE_LENGTH} caracteres.`;
  const allowed = autoDefinition(key).variables;
  for (const match of body.matchAll(/\{([^{}]*)\}/g)) {
    if (!(allowed as string[]).includes(match[1])) return `{${match[1]}} não existe nesta mensagem. Use só: ${allowed.map((name) => `{${name}}`).join(', ')}.`;
  }
  return null;
}

// ----------------------------------------------------------------------------------------------------------- business hours

export type BusinessHours = { days: number[]; start: string; end: string };

/** Monday to Friday, 09:00 to 18:00 (Brasília). */
export const DEFAULT_HOURS: BusinessHours = { days: [1, 2, 3, 4, 5], start: '09:00', end: '18:00' };

const TIME = /^([01]\d|2[0-3]):([0-5]\d)$/;
const toMinutes = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** What was stored (or typed) as business hours, made safe: bad pieces fall back to the default. */
export function normalizeHours(input: unknown): BusinessHours {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const days = Array.isArray(value.days) ? [...new Set(value.days.map(Number).filter((day) => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : DEFAULT_HOURS.days;
  const start = typeof value.start === 'string' && TIME.test(value.start) ? value.start : DEFAULT_HOURS.start;
  const end = typeof value.end === 'string' && TIME.test(value.end) ? value.end : DEFAULT_HOURS.end;
  return { days, start, end };
}

/** The reason business hours cannot be saved (null when they can). */
export function hoursProblem(input: unknown): string | null {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  if (!Array.isArray(value.days) || value.days.length === 0) return 'Marque pelo menos um dia de atendimento.';
  if (typeof value.start !== 'string' || !TIME.test(value.start) || typeof value.end !== 'string' || !TIME.test(value.end)) return 'Informe o horário de início e de fim.';
  if (toMinutes(value.end) <= toMinutes(value.start)) return 'O fim do atendimento precisa ser depois do início.';
  return null;
}

const WEEKDAYS = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const hourText = (time: string) => {
  const hours = Number(time.slice(0, 2));
  const minutes = time.slice(3, 5);
  return minutes === '00' ? `${hours}h` : `${hours}h${minutes}`;
};

/** "segunda a sexta, das 9h às 18h". */
export function describeHours(hours: BusinessHours): string {
  const days = hours.days;
  let when: string;
  const consecutive = days.length > 1 && days.every((day, index) => index === 0 || day === days[index - 1] + 1);
  if (days.length === 7) when = 'todos os dias';
  else if (consecutive) when = `${WEEKDAYS[days[0]]} a ${WEEKDAYS[days[days.length - 1]]}`;
  else if (days.length === 1) when = WEEKDAYS[days[0]];
  else when = `${days.slice(0, -1).map((day) => WEEKDAYS[day]).join(', ')} e ${WEEKDAYS[days[days.length - 1]]}`;
  return `${when}, das ${hourText(hours.start)} às ${hourText(hours.end)}`;
}

/** Is this moment inside the business hours? Brasília time, whatever the server's own zone. */
export function isWithinBusinessHours(hours: BusinessHours, now: Date = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? '';
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(get('weekday'));
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return hours.days.includes(day) && minutes >= toMinutes(hours.start) && minutes < toMinutes(hours.end);
}

// ------------------------------------------------------------------------------------------------------- resolved settings

export type AutoRow = { key: string; enabled: boolean | null; body: string | null; config: unknown };

export type ResolvedAutoMessage = AutoMessageDefinition & { enabled: boolean; text: string; customized: boolean; textCustomized: boolean };

/** The catalog with what the owner changed on top of the defaults. */
export function resolveAutoMessages(rows: AutoRow[]): { messages: ResolvedAutoMessage[]; hours: BusinessHours } {
  const byKey = new Map(rows.map((row) => [row.key, row]));
  const messages = AUTO_MESSAGES.map((definition) => {
    const row = byKey.get(definition.key);
    const textCustomized = typeof row?.body === 'string' && row.body.trim() !== '';
    const enabledCustomized = typeof row?.enabled === 'boolean';
    return {
      ...definition,
      enabled: enabledCustomized ? (row!.enabled as boolean) : definition.defaultEnabled,
      text: textCustomized ? (row!.body as string) : definition.defaultText,
      customized: textCustomized || enabledCustomized,
      textCustomized,
    };
  });
  return { messages, hours: normalizeHours(byKey.get('whatsapp_away')?.config) };
}

// ----------------------------------------------------------------------------------------- what a WhatsApp message deserves

/** How long before the same automatic message may be sent again in one conversation. */
export const AWAY_REPEAT_HOURS = 6;
export const MEDIA_REPEAT_HOURS = 1;
/** A ceiling of automatic WhatsApp messages per hour in total: a loop with another robot can never run away. */
export const AUTO_SENDS_PER_HOUR = 40;

export type InboundContext = {
  /** The first message of the customer in this conversation. */
  first: boolean;
  media: boolean;
  withinHours: boolean;
  enabled: Record<'whatsapp_greeting' | 'whatsapp_away' | 'whatsapp_media', boolean>;
  awayRecently: boolean;
  mediaRecently: boolean;
};

/**
 * The automatic replies for a message that arrived on WhatsApp, in the order they go out. Outside the hours the "away" notice
 * says it all, so it takes the place of the greeting; a file gets its own notice (at most once an hour) on top.
 */
export function planInboundReplies(context: InboundContext): AutoKey[] {
  const plan: AutoKey[] = [];
  if (!context.withinHours && context.enabled.whatsapp_away) {
    if (!context.awayRecently) plan.push('whatsapp_away');
  } else if (context.first && context.enabled.whatsapp_greeting) {
    plan.push('whatsapp_greeting');
  }
  if (context.media && context.enabled.whatsapp_media && !context.mediaRecently) plan.push('whatsapp_media');
  return plan;
}
