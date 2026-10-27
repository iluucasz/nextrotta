'use client';
import { type CSSProperties, type ReactNode } from 'react';
import { ArrowRight, GripVertical, ImageIcon, Plus } from 'lucide-react';
import { RichText } from '@/components/platform/ui';
import {
  designFor,
  safeLink,
  validImage,
  themeStyle,
  type SectionType,
  type SiteDocument,
  type ThemeSection,
} from './theme';
import './theme.css';

export type CanvasControls = {
  selected: string | null;
  select: (id: string) => void;
  dragStart: (id: string) => void;
  drop: (id: string, beforeId: string) => void;
  add: (afterId: string) => void;
};
function CustomSection({ section }: { section: ThemeSection }) {
  const s = section.settings;
  if (section.type === 'spacer')
    return (
      <div
        className="nr-theme-spacer"
        style={{ height: s.height ?? 64 }}
        aria-hidden="true"
      />
    );
  const visual = validImage(s.image) ? (
    <img
      src={s.image}
      alt={s.alt || ''}
      style={{
        objectFit: s.imageFit || 'cover',
        ...(s.height ? { height: s.height } : {}),
      }}
    />
  ) : (
    <div className="nr-theme-image-placeholder">
      <ImageIcon size={40} />
      <span>Selecione uma imagem nas propriedades da seção</span>
    </div>
  );
  return (
    <section
      className={`nr-public-section nr-theme-custom nr-theme-${section.type}`}
    >
      {section.type === 'image' ? (
        <figure>
          {visual}
          {s.title && <figcaption>{s.title}</figcaption>}
        </figure>
      ) : (
        <>
          {section.type === 'cards' && <div>{visual}</div>}
          <div>
            {s.eyebrow && <p className="nr-kicker">{s.eyebrow}</p>}
            <h2>{s.title}</h2>
            <RichText text={s.text || ''} />
            {s.buttonLabel && (
              <a className="nr-btn primary" href={safeLink(s.buttonHref)}>
                {s.buttonLabel}
                <ArrowRight size={16} />
              </a>
            )}
          </div>
        </>
      )}
    </section>
  );
}
export function ThemePage({
  content,
  renderBuiltin,
  editor,
}: {
  content: SiteDocument;
  renderBuiltin: (type: SectionType, section: ThemeSection) => ReactNode;
  editor?: CanvasControls;
}) {
  const design = designFor(content);
  const sections = design.sections.filter((s) => !s.archived && !s.hidden);
  return (
    <div
      className={`nr-theme-page ${editor ? 'is-editing' : ''}`}
      style={themeStyle(content)}
    >
      {sections.map((section) => {
        const s = section.settings;
        const style: CSSProperties = {
          ...(s.background
            ? { '--section-background': s.background, background: s.background }
            : {}),
          ...(s.color ? { '--section-color': s.color, color: s.color } : {}),
          ...(s.align
            ? { textAlign: s.align, '--section-align': s.align }
            : {}),
          ...(s.padding !== undefined
            ? { '--section-padding': `${s.padding}px` }
            : {}),
        } as CSSProperties;
        return (
          <div
            key={section.id}
            data-section-id={section.id}
            data-section-type={section.type}
            data-section-name={section.name}
            className={`nr-theme-section ${editor?.selected === section.id ? 'selected' : ''} ${s.background ? 'has-background' : ''} ${s.color ? 'has-color' : ''} ${s.align ? 'has-alignment' : ''} ${s.padding !== undefined ? 'has-spacing' : ''} ${s.width === 'full' ? 'full-width' : ''}`}
            style={style}
            {...(editor
              ? {
                  tabIndex: 0,
                  role: 'group',
                  'aria-label': `Selecionar seção: ${section.name}`,
                  onClickCapture: (event: React.MouseEvent) => {
                    if (
                      (event.target as HTMLElement).closest(
                        '[data-canvas-control]',
                      )
                    )
                      return;
                    if (
                      (event.target as HTMLElement).closest(
                        'a,button,input,form',
                      )
                    ) {
                      event.preventDefault();
                      event.stopPropagation();
                    }
                    editor.select(section.id);
                  },
                  onKeyDown: (event: React.KeyboardEvent) => {
                    if (
                      event.key === 'Enter' &&
                      event.target === event.currentTarget
                    )
                      editor.select(section.id);
                  },
                  onDragOver: (event: React.DragEvent) => {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = 'move';
                    event.currentTarget.classList.add('drop-target');
                  },
                  onDragLeave: (event: React.DragEvent) =>
                    event.currentTarget.classList.remove('drop-target'),
                  onDrop: (event: React.DragEvent) => {
                    event.preventDefault();
                    event.stopPropagation();
                    event.currentTarget.classList.remove('drop-target');
                    editor.drop(
                      event.dataTransfer.getData('text/plain'),
                      section.id,
                    );
                  },
                }
              : {})}
          >
            {editor && (
              <div data-canvas-control className="nr-canvas-section-label">
                <span
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData('text/plain', section.id);
                    editor.dragStart(section.id);
                  }}
                >
                  <GripVertical size={12} />
                  {section.name}
                </span>
                <button
                  type="button"
                  aria-label={`Adicionar seção depois de ${section.name}`}
                  onClick={() => editor.add(section.id)}
                >
                  <Plus size={13} />
                </button>
              </div>
            )}
            {['text', 'image', 'banner', 'cards', 'spacer'].includes(
              section.type,
            ) ? (
              <CustomSection section={section} />
            ) : (
              renderBuiltin(section.type, section)
            )}
          </div>
        );
      })}
      {!sections.length && editor && (
        <div className="nr-theme-empty">
          <Plus size={30} />
          <h2>A página começa com uma seção.</h2>
          <p>Adicione um componente pela barra lateral ou arraste-o para cá.</p>
          <button
            data-canvas-control
            className="nr-btn primary"
            onClick={() => editor.add('')}
          >
            Adicionar seção
          </button>
        </div>
      )}
    </div>
  );
}
