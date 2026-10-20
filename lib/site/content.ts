import type { PlanFeature } from '../plans';

/**
 * The marketing site's editable content, with code defaults for the initial publication.
 * Contact fields stay empty until real company details are supplied.
 */
export interface SiteItem {
  id: string;
  title: string;
  text: string;
  image?: string;
  visible?: boolean;
}

export interface SiteContent {
  design?: SiteDesign;
  title: string;
  subtitle: string;
  primary: string;
  secondary: string;
  aiTitle: string;
  aiText: string;
  updatesTitle: string;
  updatesText: string;
  securityTitle: string;
  pricingFootnote: string;
  defaultCycle: 'monthly' | 'annual';
  benefits: SiteItem[];
  steps: SiteItem[];
  security: SiteItem[];
  /** Only real, authorized testimonials. Empty hides the section. */
  testimonials: SiteItem[];
  faq: SiteItem[];
  /** Contact and company data — fill with the real values; empty ones are hidden. */
  whatsapp: string;
  email: string;
  phone: string;
  hours: string;
  legalName: string;
  cnpj: string;
  socials: string[];
  seoTitle: string;
  seoDescription: string;
  terms: string;
  privacy: string;
}

/** What each plan feature means, for the "funcionalidades" section and the comparison table. */
export const FEATURE_DESCRIPTIONS: Record<PlanFeature, string> = {
  technicians: 'Cadastro da equipe com acesso próprio para cada técnico.',
  services: 'Ordens de serviço por técnico, competência e quinzena.',
  service_import: 'Importe as OS de planilhas, com prévia e conferência.',
  hours: 'Apontamento de horas e banco de horas sempre em dia.',
  schedule: 'Escala da equipe montada e visível para todos.',
  payroll:
    'Folha com comissão, benefícios e recibo calculados automaticamente.',
  library: 'Documentos da operação organizados e entregues para cada técnico.',
  porto: 'Horas e escala importadas automaticamente do Portal do Prestador.',
  whatsapp: 'Avisos de escala, folga, horas e pagamento direto no WhatsApp.',
  finance: 'Contas a pagar e a receber, parcelas e resultado do mês.',
  billing_report: 'Faturamento, custo da folha, margem e ticket médio.',
  management_dashboard: 'Indicadores da operação para decidir com clareza.',
  ai: 'Pergunte sobre a operação e receba respostas e análises na hora.',
  parts: 'Peças em consignação com cada técnico, venda pelo celular com Pix ou cartão, inventário e acerto do mês.',
  support: 'Chamados de suporte direto pelo sistema, com acompanhamento da nossa equipe.',
};

export const siteContent: SiteContent = {
  title: 'Sua equipe em campo.\nSua gestão no controle.',
  subtitle:
    'Da primeira ordem de serviço ao fechamento da folha. Organize sua operação, automatize a rotina e ganhe tempo para crescer.',
  primary: 'Ver planos',
  secondary: 'Falar com a gente',
  aiTitle: 'Uma boa pergunta. Uma decisão melhor.',
  aiText:
    'Pergunte qualquer coisa sobre OS, técnicos, folha, gastos e escala. Receba respostas, análises e sugestões na hora, com o assistente de IA do plano Pro.',
  updatesTitle: 'Sua operação evolui. O NextRotta também.',
  updatesText:
    'O NextRotta é atualizado periodicamente com novos recursos — sem aumentar sua mensalidade. Toda melhoria geral chega para todos os clientes do plano.',
  securityTitle: 'Seus dados são seus. Sempre.',
  pricingFootnote:
    'Implantação inclui configuração e treinamento. Atualizações sem custo extra. Seus dados nunca são apagados por atraso.',
  defaultCycle: 'monthly',
  benefits: [
    {
      id: 'b1',
      title: 'Adeus, planilhas soltas',
      text: 'Tudo que sua equipe precisa, no mesmo lugar.',
    },
    {
      id: 'b2',
      title: 'Folha sem retrabalho',
      text: 'Horas, comissões e recibos calculados automaticamente.',
    },
    {
      id: 'b3',
      title: 'Cada um na sua rota',
      text: 'Escalas claras e acesso próprio para cada técnico.',
    },
  ],
  steps: [
    {
      id: 's1',
      title: 'Escolha seu plano',
      text: 'Encontre o tamanho certo para sua operação.',
    },
    {
      id: 's2',
      title: 'Deixe a implantação com a gente',
      text: 'Configuramos o sistema e treinamos sua equipe.',
    },
    {
      id: 's3',
      title: 'Comece uma nova rotina',
      text: 'Sua operação organizada desde o primeiro dia.',
    },
  ],
  security: [
    {
      id: 'seg1',
      title: 'Dados preservados',
      text: 'Se a assinatura atrasar, o acesso é pausado. Nenhum dado é apagado.',
    },
    {
      id: 'seg2',
      title: 'Liberdade para exportar',
      text: 'Todos os seus dados disponíveis para exportação a qualquer momento.',
    },
    {
      id: 'seg3',
      title: 'Backup todos os dias',
      text: 'Guardado por 3 meses no Essencial, 6 meses no Pro ou pelo tempo negociado no Sob medida.',
    },
  ],
  testimonials: [],
  faq: [
    {
      id: 'f1',
      title: 'Como funciona a implantação?',
      text: 'Nossa equipe configura o sistema, orienta a importação dos seus dados e treina as pessoas que vão usar o NextRotta.',
    },
    {
      id: 'f2',
      title: 'Posso mudar de plano?',
      text: 'Sim. Fale com a gente para ajustar seu plano e o ciclo de cobrança à sua operação.',
    },
    {
      id: 'f3',
      title: 'O que acontece se eu atrasar?',
      text: 'O acesso pode ser pausado após a carência, mas seus dados são preservados. O administrador pode regularizar e exportar os dados.',
    },
    {
      id: 'f4',
      title: 'Os créditos de IA acumulam?',
      text: 'A cota mensal renova a cada mês e não acumula. Você também pode comprar créditos extras quando precisar.',
    },
  ],
  whatsapp: '',
  email: '',
  phone: '',
  hours: 'Segunda a sexta, das 9h às 18h (Brasília)',
  legalName: 'NextRotta',
  cnpj: '',
  socials: [],
  seoTitle: 'NextRotta — gestão para quem está em campo',
  seoDescription:
    'Organize técnicos, ordens de serviço, escala, folha e financeiro em um só lugar.',
  terms:
    '# Termos de uso\n\nVersão preliminar, em revisão jurídica antes do lançamento comercial.\n\n## Uso da plataforma\nO NextRotta organiza a operação de equipes técnicas. O administrador é responsável pelos acessos da sua organização.\n\n## Assinatura e dados\nPlanos e limites são informados na contratação. Atraso ou cancelamento não apagam os dados. A organização pode exportar suas informações.\n\n## Inteligência artificial\nO assistente oferece análises e sugestões que devem ser conferidas pelo usuário. Serviços de terceiros podem processar os dados necessários às consultas.',
  privacy:
    '# Política de privacidade\n\nVersão preliminar, em revisão jurídica antes do lançamento comercial.\n\n## Dados tratados\nDados de contato, informações operacionais e registros de acesso são usados para prestar o serviço.\n\n## Prestadores e IA\nConsultas de IA podem ser processadas por provedores terceiros, incluindo DeepSeek, fora do Brasil. Há transferência internacional dos dados necessários à consulta.\n\n## Seus direitos\nSolicitações de acesso, correção e exportação podem ser encaminhadas ao contato da plataforma.',
};

/** Shared document format used by the CMS, persistence, and public renderer. */
export type SectionType =
  | 'hero'
  | 'benefits'
  | 'ai'
  | 'features'
  | 'steps'
  | 'updates'
  | 'security'
  | 'pricing'
  | 'testimonials'
  | 'faq'
  | 'cta'
  | 'text'
  | 'image'
  | 'banner'
  | 'cards'
  | 'spacer';
export interface ThemeSection {
  id: string;
  type: SectionType;
  name: string;
  hidden: boolean;
  archived: boolean;
  settings: {
    title?: string;
    text?: string;
    eyebrow?: string;
    image?: string;
    alt?: string;
    buttonLabel?: string;
    buttonHref?: string;
    background?: string;
    color?: string;
    align?: 'left' | 'center' | 'right';
    padding?: number;
    width?: 'contained' | 'full';
    imageFit?: 'cover' | 'contain';
    height?: number;
    items?: SiteItem[];
  };
}
export interface SiteTheme {
  primary: string;
  background: string;
  text: string;
  muted: string;
  surface: string;
  accent: string;
  font: 'geist' | 'serif' | 'system';
  radius: number;
  buttonRadius: number;
}
export interface SiteDesign {
  schemaVersion: 1;
  theme: SiteTheme;
  sections: ThemeSection[];
  header?: { ctaLabel: string; ctaHref: string };
  footer?: { tagline: string; signature: string };
}
export type SiteDocument = SiteContent;
export interface SiteVersion {
  id: string;
  label: string;
  createdAt: string;
  content: SiteDocument;
  kind: 'draft' | 'published';
}
