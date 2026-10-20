'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Eye,
  EyeOff,
  ImageIcon,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import type { SiteItem } from '@/lib/site/content';
import {
  CONTENT_BINDINGS,
  LIST_BINDINGS,
  type SiteDocument,
  type SiteTheme,
  type ThemeSection,
} from '@/components/site/theme';

export type CmsDocument = SiteDocument & {
  design: NonNullable<SiteDocument['design']>;
};
export type DocumentChange = (
  mutate: (draft: CmsDocument) => void,
  group?: string,
) => void;
export function ColorField({
  label,
  value,
  onChange,
  reset,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  reset?: () => void;
}) {
  const [hex, setHex] = useState(value);
  useEffect(() => setHex(value), [value]);
  return (
    <label className="cms-color-field">
      <span>{label}</span>
      <div>
        <input
          type="color"
          aria-label={label}
          value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#ffffff'}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          aria-label={`${label} hexadecimal`}
          value={hex}
          pattern="#[0-9a-fA-F]{6}"
          maxLength={7}
          onBlur={() => setHex(value)}
          onChange={(e) => {
            setHex(e.target.value);
            if (/^#[0-9a-f]{6}$/i.test(e.target.value))
              onChange(e.target.value);
          }}
        />
        {reset && (
          <button
            type="button"
            aria-label={`Usar cor do tema: ${label}`}
            onClick={(e) => {
              e.preventDefault();
              reset();
            }}
          >
            <X size={13} />
          </button>
        )}
      </div>
    </label>
  );
}
function TextField({
  label,
  value,
  onChange,
  multiline = false,
  hint,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  multiline?: boolean;
  hint?: string;
}) {
  return (
    <label className="cms-field">
      <span>{label}</span>
      {multiline ? (
        <textarea
          rows={4}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      ) : (
        <input value={value} onChange={(e) => onChange(e.target.value)} />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}
export function ThemeInspector({
  theme,
  change,
}: {
  theme: SiteTheme;
  change: DocumentChange;
}) {
  const set = (key: keyof SiteTheme, value: string | number) =>
    change((d) => {
      Object.assign(d.design.theme, { [key]: value });
    }, `theme-${key}`);
  return (
    <>
      <div className="cms-inspector-heading">
        <span className="cms-overline">CONFIGURAÇÕES DO TEMA</span>
        <h2>Identidade visual</h2>
        <p>Estas escolhas se aplicam a toda a página.</p>
      </div>
      <div className="cms-inspector-body">
        <h3>Paleta de cores</h3>
        {(
          [
            ['primary', 'Cor principal'],
            ['background', 'Fundo da página'],
            ['text', 'Títulos e texto'],
            ['muted', 'Texto secundário'],
            ['surface', 'Cartões'],
            ['accent', 'Destaques'],
          ] as const
        ).map(([key, label]) => (
          <ColorField
            key={key}
            label={label}
            value={theme[key]}
            onChange={(v) => set(key, v)}
          />
        ))}
        <h3>Tipografia</h3>
        <label className="cms-field">
          Família tipográfica
          <select
            value={theme.font}
            onChange={(e) => set('font', e.target.value)}
          >
            <option value="geist">Geist · moderna</option>
            <option value="serif">Georgia · editorial</option>
            <option value="system">Sistema · neutra</option>
          </select>
        </label>
        <h3>Formas</h3>
        <label className="cms-field">
          <span>
            Cantos dos cartões <b>{theme.radius}px</b>
          </span>
          <input
            type="range"
            min={0}
            max={32}
            value={theme.radius}
            onChange={(e) => set('radius', Number(e.target.value))}
          />
        </label>
        <label className="cms-field">
          <span>
            Cantos dos botões <b>{theme.buttonRadius}px</b>
          </span>
          <input
            type="range"
            min={0}
            max={32}
            value={theme.buttonRadius}
            onChange={(e) => set('buttonRadius', Number(e.target.value))}
          />
        </label>
        <div
          className="cms-theme-sample"
          style={{
            background: theme.background,
            color: theme.text,
            borderRadius: theme.radius,
          }}
        >
          <strong>Sua marca, seu jeito.</strong>
          <p style={{ color: theme.muted }}>
            Uma pequena prévia da sua identidade.
          </p>
          <span
            style={{
              background: theme.primary,
              color: '#fff',
              borderRadius: theme.buttonRadius,
            }}
          >
            Vamos conversar →
          </span>
        </div>
      </div>
    </>
  );
}
const globalFields: Record<
  string,
  {
    key: keyof SiteDocument;
    label: string;
    multiline?: boolean;
    hint?: string;
  }[]
> = {
  '@header': [],
  '@contact': [
    { key: 'whatsapp', label: 'WhatsApp com país e DDD' },
    { key: 'email', label: 'E-mail' },
    { key: 'phone', label: 'Telefone' },
    { key: 'hours', label: 'Horário de atendimento' },
  ],
  '@footer': [
    { key: 'legalName', label: 'Razão social' },
    { key: 'cnpj', label: 'CNPJ' },
    {
      key: 'socials',
      label: 'Redes sociais',
      multiline: true,
      hint: 'Um endereço https por linha.',
    },
    { key: 'hours', label: 'Horário de atendimento' },
  ],
  '@seo': [
    { key: 'seoTitle', label: 'Título nos buscadores' },
    {
      key: 'seoDescription',
      label: 'Descrição nos buscadores',
      multiline: true,
    },
  ],
  '@terms': [
    {
      key: 'terms',
      label: 'Termos de uso',
      multiline: true,
      hint: '# título, ## subtítulo, **negrito**',
    },
  ],
  '@privacy': [
    {
      key: 'privacy',
      label: 'Política de privacidade',
      multiline: true,
      hint: '# título, ## subtítulo, **negrito**',
    },
  ],
};
export function GlobalInspector({
  id,
  document,
  change,
}: {
  id: string;
  document: CmsDocument;
  change: DocumentChange;
}) {
  const labels: Record<string, string> = {
    '@header': 'Cabeçalho',
    '@footer': 'Rodapé',
    '@contact': 'Informações de contato',
    '@seo': 'Busca e compartilhamento',
    '@terms': 'Termos de uso',
    '@privacy': 'Política de privacidade',
  };
  return (
    <>
      <div className="cms-inspector-heading">
        <span className="cms-overline">CONTEÚDO GLOBAL</span>
        <h2>{labels[id] || 'Página'}</h2>
        <p>Compartilhado entre as páginas do site.</p>
      </div>
      <div className="cms-inspector-body">
        {id === '@header' && (
          <p className="cms-help">
            A marca e a navegação acompanham a identidade do NextRotta. As
            chamadas abaixo são exibidas na capa da página.
          </p>
        )}
        {(globalFields[id] || []).map((field) => (
          <TextField
            key={field.key}
            label={field.label}
            value={
              field.key === 'socials'
                ? document.socials.join('\n')
                : String(document[field.key] || '')
            }
            multiline={field.multiline}
            hint={field.hint}
            onChange={(value) =>
              change((d) => {
                Object.assign(d, {
                  [field.key]:
                    field.key === 'socials'
                      ? value.split('\n').filter(Boolean)
                      : value,
                });
              }, `global-${field.key}`)
            }
          />
        ))}
        {id === '@seo' && (
          <div className="cms-search-preview">
            <span>nextrotta.com.br</span>
            <h3>{document.seoTitle}</h3>
            <p>{document.seoDescription}</p>
          </div>
        )}
      </div>
    </>
  );
}
export function SectionInspector({
  section,
  document,
  change,
  duplicate,
  archive,
}: {
  section: ThemeSection;
  document: CmsDocument;
  change: DocumentChange;
  duplicate: () => void;
  archive: () => void;
}) {
  const bindings = CONTENT_BINDINGS[section.type];
  const listKey = LIST_BINDINGS[section.type];
  const list = listKey ? section.settings.items || document[listKey] : [];
  function setting(key: keyof ThemeSection['settings'], value: unknown) {
    change((d) => {
      const s = d.design.sections.find((s) => s.id === section.id)!;
      if (value === undefined) delete s.settings[key];
      else Object.assign(s.settings, { [key]: value });
    }, `${section.id}-${key}`);
  }
  const value = (key: 'title' | 'text' | 'buttonLabel') =>
    section.settings[key] ??
    (bindings?.[key] ? String(document[bindings[key]!] ?? '') : '');
  const changeItems = (fn: (items: SiteItem[]) => void) =>
    change((d) => {
      const s = d.design.sections.find((s) => s.id === section.id)!;
      const items = structuredClone(s.settings.items || d[listKey!]);
      fn(items);
      s.settings.items = items;
    });
  const custom = ['text', 'image', 'banner', 'cards'].includes(section.type);
  const titleAllowed =
    custom ||
    !!bindings?.title ||
    ['features', 'steps', 'testimonials', 'cta'].includes(section.type);
  return (
    <>
      <div className="cms-inspector-heading">
        <span className="cms-overline">PROPRIEDADES DA SEÇÃO</span>
        <h2>{section.name}</h2>
        <div className="cms-section-tools">
          <button title="Duplicar seção" onClick={duplicate}>
            <Copy size={15} />
            Duplicar
          </button>
          <button
            title={section.hidden ? 'Mostrar seção' : 'Ocultar seção'}
            onClick={() =>
              change((d) => {
                d.design.sections.find((s) => s.id === section.id)!.hidden =
                  !section.hidden;
              })
            }
          >
            {section.hidden ? <Eye size={15} /> : <EyeOff size={15} />}
            {section.hidden ? 'Mostrar' : 'Ocultar'}
          </button>
          <button title="Arquivar seção" onClick={archive}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="cms-inspector-body">
        <TextField
          label="Nome na árvore de seções"
          value={section.name}
          onChange={(name) =>
            change((d) => {
              d.design.sections.find((s) => s.id === section.id)!.name = name;
            }, `${section.id}-name`)
          }
        />
        <h3>Conteúdo</h3>
        {titleAllowed && (
          <TextField
            label="Título"
            value={value('title')}
            multiline
            onChange={(v) => setting('title', v)}
          />
        )}
        {((custom && section.type !== 'image') || bindings?.text) && (
          <TextField
            label="Texto"
            value={value('text')}
            multiline
            onChange={(v) => setting('text', v)}
            hint={custom ? 'Use **negrito** e ## subtítulos.' : undefined}
          />
        )}
        {custom && section.type !== 'image' && (
          <TextField
            label="Texto acima do título"
            value={section.settings.eyebrow || ''}
            onChange={(v) => setting('eyebrow', v)}
          />
        )}
        {(custom || bindings?.buttonLabel) && section.type !== 'image' && (
          <TextField
            label="Texto do botão"
            value={value('buttonLabel')}
            onChange={(v) => setting('buttonLabel', v)}
          />
        )}
        {custom && section.type !== 'image' && (
          <TextField
            label="Link do botão"
            value={section.settings.buttonHref || '/contato'}
            onChange={(v) => setting('buttonHref', v)}
            hint="Use /pagina ou https://…"
          />
        )}
        {['image', 'cards'].includes(section.type) && (
          <>
            <TextField
              label="Endereço da imagem"
              value={section.settings.image || ''}
              onChange={(v) => setting('image', v)}
              hint="URL https ou imagem da pasta pública (/…)."
            />
            <TextField
              label="Texto alternativo"
              value={section.settings.alt || ''}
              onChange={(v) => setting('alt', v)}
            />
            <label className="cms-field">
              Enquadramento
              <select
                value={section.settings.imageFit || 'cover'}
                onChange={(e) => setting('imageFit', e.target.value)}
              >
                <option value="cover">Preencher</option>
                <option value="contain">Mostrar imagem inteira</option>
              </select>
            </label>
          </>
        )}
        {section.type === 'spacer' && (
          <label className="cms-field">
            <span>
              Altura <b>{section.settings.height ?? 64}px</b>
            </span>
            <input
              type="range"
              min={16}
              max={240}
              step={8}
              value={section.settings.height ?? 64}
              onChange={(e) => setting('height', Number(e.target.value))}
            />
          </label>
        )}
        {section.type === 'features' && (
          <p className="cms-help">
            Os recursos exibidos vêm do{' '}
            <Link href="/plataforma/recursos">catálogo da plataforma</Link>.
          </p>
        )}
        {section.type === 'pricing' && (
          <>
            <label className="cms-field">
              Ciclo exibido inicialmente
              <select
                value={document.defaultCycle}
                onChange={(e) =>
                  change((d) => {
                    d.defaultCycle = e.target.value as 'monthly' | 'annual';
                  })
                }
              >
                <option value="monthly">Mensal</option>
                <option value="annual">Anual</option>
              </select>
            </label>
            <TextField
              label="Texto abaixo dos planos"
              value={document.pricingFootnote}
              multiline
              onChange={(v) =>
                change((d) => {
                  d.pricingFootnote = v;
                }, 'pricingFootnote')
              }
            />
            <p className="cms-help">
              Preços e limites vêm do{' '}
              <Link href="/plataforma/planos">cadastro de planos</Link>.
            </p>
          </>
        )}
        {listKey && (
          <>
            <div className="cms-property-title">
              <h3>Itens da seção</h3>
              <button
                title="Adicionar item"
                onClick={() =>
                  changeItems((items) =>
                    items.push({
                      id: crypto.randomUUID(),
                      title: listKey === 'faq' ? 'Nova pergunta' : 'Novo item',
                      text: 'Escreva seu conteúdo aqui.',
                      visible: true,
                    }),
                  )
                }
              >
                <Plus size={16} />
              </button>
            </div>
            {list.map((item, index) => (
              <details className="cms-item-editor" key={item.id}>
                <summary>
                  {item.visible === false ? <EyeOff size={12} /> : <GripIcon />}
                  {item.title}
                </summary>
                <div>
                  <TextField
                    label={
                      listKey === 'faq'
                        ? 'Pergunta'
                        : listKey === 'testimonials'
                          ? 'Nome · cargo · empresa'
                          : 'Título do item'
                    }
                    value={item.title}
                    onChange={(v) =>
                      changeItems((items) => {
                        items[index].title = v;
                      })
                    }
                  />
                  <TextField
                    label={listKey === 'faq' ? 'Resposta' : 'Texto do item'}
                    value={item.text}
                    multiline
                    onChange={(v) =>
                      changeItems((items) => {
                        items[index].text = v;
                      })
                    }
                  />
                  {listKey === 'testimonials' && (
                    <TextField
                      label="URL da foto (https)"
                      value={item.image || ''}
                      onChange={(v) =>
                        changeItems((items) => {
                          items[index].image = v;
                        })
                      }
                    />
                  )}
                  <div className="cms-section-tools">
                    <button
                      title="Mover item para cima"
                      disabled={index === 0}
                      onClick={() =>
                        changeItems((items) => {
                          [items[index], items[index - 1]] = [
                            items[index - 1],
                            items[index],
                          ];
                        })
                      }
                    >
                      <ArrowUp size={14} />
                    </button>
                    <button
                      title="Mover item para baixo"
                      disabled={index === list.length - 1}
                      onClick={() =>
                        changeItems((items) => {
                          [items[index], items[index + 1]] = [
                            items[index + 1],
                            items[index],
                          ];
                        })
                      }
                    >
                      <ArrowDown size={14} />
                    </button>
                    <button
                      onClick={() =>
                        changeItems((items) => {
                          items[index].visible = item.visible === false;
                        })
                      }
                    >
                      {item.visible === false
                        ? 'Restaurar item'
                        : 'Ocultar item'}
                    </button>
                  </div>
                </div>
              </details>
            ))}
            {!list.length && (
              <p className="cms-help">
                Adicione o primeiro item para esta seção aparecer.
              </p>
            )}
          </>
        )}
        <h3>Aparência</h3>
        <ColorField
          label="Fundo da seção"
          value={
            section.settings.background || document.design.theme.background
          }
          onChange={(v) => setting('background', v)}
          reset={() => setting('background', undefined)}
        />
        <ColorField
          label="Texto da seção"
          value={section.settings.color || document.design.theme.text}
          onChange={(v) => setting('color', v)}
          reset={() => setting('color', undefined)}
        />
        <label className="cms-field">
          Alinhamento
          <select
            value={section.settings.align || 'left'}
            onChange={(e) => setting('align', e.target.value)}
          >
            <option value="left">À esquerda</option>
            <option value="center">Centralizado</option>
            <option value="right">À direita</option>
          </select>
        </label>
        <label className="cms-field">
          <span>
            Espaçamento vertical{' '}
            <b>
              {section.settings.padding ?? 'Padrão'}
              {section.settings.padding !== undefined ? 'px' : ''}
            </b>
          </span>
          <input
            type="range"
            min={0}
            max={160}
            step={8}
            value={section.settings.padding ?? 64}
            onChange={(e) => setting('padding', Number(e.target.value))}
          />
          <button
            className="cms-subtle-button"
            onClick={() => setting('padding', undefined)}
          >
            Usar espaçamento do tema
          </button>
        </label>
        <label className="cms-field">
          Largura
          <select
            value={section.settings.width || 'contained'}
            onChange={(e) => setting('width', e.target.value)}
          >
            <option value="contained">Conteúdo centralizado</option>
            <option value="full">Largura completa</option>
          </select>
        </label>
      </div>
    </>
  );
}
function GripIcon() {
  return (
    <span aria-hidden="true" style={{ color: '#a4aba6' }}>
      ⠿
    </span>
  );
}
