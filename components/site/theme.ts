import type { CSSProperties } from 'react';
import type { SiteContent, SiteItem } from '@/lib/site/content';

import type {
  SectionType,
  ThemeSection,
  SiteTheme,
  SiteDesign,
  SiteDocument,
} from '@/lib/site/content';
export type {
  SectionType,
  ThemeSection,
  SiteTheme,
  SiteDesign,
  SiteDocument,
  SiteVersion,
} from '@/lib/site/content';

export const DEFAULT_THEME: SiteTheme = {
  primary: '#147d63',
  background: '#fcfdf9',
  text: '#1c392e',
  muted: '#7c8a76',
  surface: '#ffffff',
  accent: '#eaf0dd',
  font: 'geist',
  radius: 12,
  buttonRadius: 7,
};
export const SECTION_CATALOG: {
  type: SectionType;
  name: string;
  description: string;
  category: 'Página' | 'Componentes';
}[] = [
  {
    type: 'hero',
    name: 'Capa principal',
    description: 'Título, chamadas e apresentação do produto.',
    category: 'Página',
  },
  {
    type: 'benefits',
    name: 'Benefícios',
    description: 'Destaques da operação em colunas.',
    category: 'Página',
  },
  {
    type: 'ai',
    name: 'Assistente de IA',
    description: 'Apresentação do assistente e exemplos.',
    category: 'Página',
  },
  {
    type: 'features',
    name: 'Funcionalidades',
    description: 'Recursos conectados ao catálogo de planos.',
    category: 'Página',
  },
  {
    type: 'steps',
    name: 'Como funciona',
    description: 'Uma sequência simples de passos.',
    category: 'Página',
  },
  {
    type: 'updates',
    name: 'Atualizações',
    description: 'Chamada para as novidades do produto.',
    category: 'Página',
  },
  {
    type: 'security',
    name: 'Segurança',
    description: 'Compromissos com a proteção dos dados.',
    category: 'Página',
  },
  {
    type: 'pricing',
    name: 'Planos e preços',
    description: 'Planos publicados no painel.',
    category: 'Página',
  },
  {
    type: 'testimonials',
    name: 'Depoimentos',
    description: 'Relatos reais e autorizados dos clientes.',
    category: 'Página',
  },
  {
    type: 'faq',
    name: 'Perguntas frequentes',
    description: 'Perguntas e respostas expansíveis.',
    category: 'Página',
  },
  {
    type: 'cta',
    name: 'Chamada para ação',
    description: 'Um convite para o próximo passo.',
    category: 'Página',
  },
  {
    type: 'text',
    name: 'Texto livre',
    description: 'Título e texto com formatação.',
    category: 'Componentes',
  },
  {
    type: 'image',
    name: 'Imagem com legenda',
    description: 'Imagem, texto alternativo e legenda.',
    category: 'Componentes',
  },
  {
    type: 'banner',
    name: 'Banner com botão',
    description: 'Destaque de campanha com link.',
    category: 'Componentes',
  },
  {
    type: 'cards',
    name: 'Texto e imagem',
    description: 'Conte uma história em duas colunas.',
    category: 'Componentes',
  },
  {
    type: 'spacer',
    name: 'Espaçamento',
    description: 'Uma pausa entre as seções.',
    category: 'Componentes',
  },
];
export function createSection(type: SectionType, id?: string): ThemeSection {
  const entry = SECTION_CATALOG.find((s) => s.type === type)!;
  const custom = ['text', 'image', 'banner', 'cards'].includes(type);
  return {
    id: id || crypto.randomUUID(),
    type,
    name: entry.name,
    hidden: false,
    archived: false,
    settings: custom
      ? {
          title:
            type === 'image'
              ? 'Uma imagem vale uma boa história.'
              : 'Um novo capítulo da sua operação.',
          text: 'Adicione seu conteúdo e deixe esta seção com a cara da sua empresa.',
          align: 'left',
          ...(type === 'banner'
            ? { buttonLabel: 'Saiba mais', buttonHref: '/contato' }
            : {}),
        }
      : type === 'spacer'
        ? { height: 64 }
        : {},
  };
}
export function designFor(content: SiteDocument): SiteDesign {
  if (
    content.design?.schemaVersion === 1 &&
    Array.isArray(content.design.sections)
  )
    return {
      ...content.design,
      theme: { ...DEFAULT_THEME, ...content.design.theme },
    };
  return {
    schemaVersion: 1,
    theme: { ...DEFAULT_THEME },
    sections: SECTION_CATALOG.filter((s) => s.category === 'Página').map((s) =>
      createSection(s.type, `section-${s.type}`),
    ),
  };
}
export function normalizeDocument(
  content: SiteDocument,
): SiteDocument & { design: SiteDesign } {
  return { ...content, design: designFor(content) };
}
export const CONTENT_BINDINGS: Partial<
  Record<
    SectionType,
    {
      title?: keyof SiteContent;
      text?: keyof SiteContent;
      buttonLabel?: keyof SiteContent;
    }
  >
> = {
  hero: { title: 'title', text: 'subtitle', buttonLabel: 'primary' },
  ai: { title: 'aiTitle', text: 'aiText' },
  updates: { title: 'updatesTitle', text: 'updatesText' },
  security: { title: 'securityTitle' },
};
export const LIST_BINDINGS: Partial<
  Record<
    SectionType,
    'benefits' | 'steps' | 'security' | 'testimonials' | 'faq'
  >
> = {
  benefits: 'benefits',
  steps: 'steps',
  security: 'security',
  testimonials: 'testimonials',
  faq: 'faq',
};
export function contentForSection(
  content: SiteDocument,
  section: ThemeSection,
): SiteContent {
  const bindings = CONTENT_BINDINGS[section.type];
  const overrides: Record<string, string> = {};
  for (const [setting, field] of Object.entries(bindings || {})) {
    const value = section.settings[setting as keyof ThemeSection['settings']];
    if (typeof value === 'string') overrides[field] = value;
  }
  const list = LIST_BINDINGS[section.type];
  return {
    ...content,
    ...overrides,
    ...(list && section.settings.items
      ? { [list]: section.settings.items }
      : {}),
  };
}
export function themeStyle(content: SiteDocument): CSSProperties {
  const theme = designFor(content).theme;
  return {
    '--site-primary': theme.primary,
    '--site-background': theme.background,
    '--site-text': theme.text,
    '--site-muted': theme.muted,
    '--site-surface': theme.surface,
    '--site-accent': theme.accent,
    '--site-radius': `${theme.radius}px`,
    '--site-button-radius': `${theme.buttonRadius}px`,
    '--site-font':
      theme.font === 'serif'
        ? 'Georgia, serif'
        : theme.font === 'system'
          ? 'system-ui, sans-serif'
          : 'var(--font-geist-sans), sans-serif',
  } as CSSProperties;
}
export function safeLink(value?: string) {
  return value &&
    (/^\/(?!\/)/.test(value) ||
      /^https:\/\//.test(value) ||
      /^mailto:[^\s]+@/.test(value) ||
      /^#[a-zA-Z]/.test(value))
    ? value
    : '/contato';
}
export function validImage(value?: string) {
  return (
    !!value && (/^https:\/\/\S+$/.test(value) || /^\/(?!\/)[^\s]+$/.test(value))
  );
}
