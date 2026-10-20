'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  Copy,
  Eye,
  EyeOff,
  Globe,
  GripVertical,
  History,
  Layers3,
  LayoutTemplate,
  LoaderCircle,
  Monitor,
  Palette,
  PanelLeft,
  Plus,
  Redo2,
  RotateCcw,
  Save,
  Search,
  Settings2,
  Smartphone,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import { api, date, errorMessage, useResource } from '../api';
import { useNotify } from '../notice';
import { Confirm, ErrorState, Loading } from '../ui';
import {
  createSection,
  normalizeDocument,
  SECTION_CATALOG,
  type SectionType,
  type SiteDocument,
  type SiteVersion,
} from '@/components/site/theme';
import { Canvas, type EditorPage } from './canvas';
import { useDocumentHistory } from './history';
import { GlobalInspector, SectionInspector, ThemeInspector } from './inspector';
import './editor.css';

interface EditorState {
  draft: SiteDocument;
  published: SiteDocument;
  hasUnpublishedChanges: boolean;
  draftUpdatedAt: string | null;
  publishedAt: string | null;
  designSupported?: boolean;
  versions?: SiteVersion[];
}
type Mode = 'sections' | 'add' | 'theme' | 'history' | 'archive' | 'settings';
const LOCAL_DRAFT = 'nextrotta-cms-recovery-v1';
const LOCAL_VERSIONS = 'nextrotta-cms-history-v1';
const PAGE_LABELS: Record<EditorPage, string> = {
  home: 'Página inicial',
  plans: 'Planos',
  contact: 'Contato',
  custom: 'Sob medida',
  news: 'Novidades',
  terms: 'Termos de uso',
  privacy: 'Privacidade',
};

export function VisualSiteEditor({ preview = false }: { preview?: boolean }) {
  const resource = useResource<EditorState>('/site');
  const history = useDocumentHistory();
  const notify = useNotify();
  const [info, setInfo] = useState<EditorState | null>(null);
  const [selected, setSelected] = useState<string | null>('section-hero');
  const [mode, setMode] = useState<Mode>('sections');
  const [device, setDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [zoom, setZoom] = useState<number | 'fit'>(100);
  const [page, setPage] = useState<EditorPage>('home');
  const [previewing, setPreviewing] = useState(preview);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [search, setSearch] = useState('');
  const [after, setAfter] = useState('');
  const [dragging, setDragging] = useState('');
  const [dropTarget, setDropTarget] = useState('');
  const [savedSignature, setSavedSignature] = useState('');
  const [versions, setVersions] = useState<SiteVersion[]>([]);
  const [restoring, setRestoring] = useState<SiteVersion | null>(null);
  const [recovery, setRecovery] = useState<SiteDocument | null>(null);
  const [archiving, setArchiving] = useState<string | null>(null);
  const [leftOpen, setLeftOpen] = useState(false);
  const [rightOpen, setRightOpen] = useState(false);
  const initialized = useRef(false);
  const draft = history.current;
  const dirty = !!draft && JSON.stringify(draft) !== savedSignature;
  const selectedSection = draft?.design.sections.find((s) => s.id === selected);
  useEffect(() => {
    const query = window.matchMedia('(max-width: 760px)');
    const close = () => {
      setLeftOpen(false);
      setRightOpen(false);
    };
    query.addEventListener('change', close);
    return () => query.removeEventListener('change', close);
  }, []);

  useEffect(() => {
    if (!resource.data || initialized.current) return;
    initialized.current = true;
    const normalized = normalizeDocument(resource.data.draft);
    setInfo(resource.data);
    history.reset(normalized);
    setSavedSignature(JSON.stringify(normalized));
    setSelected(
      normalized.design.sections.find((s) => !s.archived && !s.hidden)?.id ||
        null,
    );
    try {
      const local = JSON.parse(localStorage.getItem(LOCAL_DRAFT) || 'null') as {
        content: SiteDocument;
        base: string | null;
      } | null;
      if (
        local?.content &&
        local.base === resource.data.draftUpdatedAt &&
        JSON.stringify(normalizeDocument(local.content)) !==
          JSON.stringify(normalized)
      )
        setRecovery(local.content);
      const localVersions = JSON.parse(
        localStorage.getItem(LOCAL_VERSIONS) || '[]',
      ) as SiteVersion[];
      setVersions(
        resource.data.versions ||
          (Array.isArray(localVersions) ? localVersions : []),
      );
    } catch {
      notify(
        'Não foi possível recuperar o histórico local. O rascunho do servidor foi carregado.',
      );
    }
  }, [resource.data, history.reset, notify]);
  useEffect(() => {
    if (!draft || !info || !dirty) return;
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(
          LOCAL_DRAFT,
          JSON.stringify({ content: draft, base: info.draftUpdatedAt }),
        );
      } catch {
        notify(
          'Não foi possível guardar a recuperação local. Salve o rascunho para preservar as alterações.',
        );
      }
    }, 600);
    return () => clearTimeout(timer);
  }, [draft, dirty, info, notify]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => {
      if (dirty) event.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [dirty]);

  function remember(
    document: SiteDocument,
    kind: SiteVersion['kind'],
    label: string,
  ) {
    const version: SiteVersion = {
      id: crypto.randomUUID(),
      label,
      content: structuredClone(document),
      createdAt: new Date().toISOString(),
      kind,
    };
    const next = [version, ...versions].slice(0, 30);
    setVersions(next);
    try {
      localStorage.setItem(LOCAL_VERSIONS, JSON.stringify(next));
    } catch {
      notify('Versão salva, mas o histórico local está sem espaço.');
    }
  }
  async function save(publish = false) {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const result = await api<EditorState>('/site', {
        method: publish ? 'POST' : 'PUT',
        body: draft,
      });
      const accepted = normalizeDocument({
        ...result.draft,
        design: result.draft.design || draft.design,
      });
      setInfo(result);
      setSavedSignature(JSON.stringify(accepted));
      history.acceptSaved(draft, accepted);
      if (result.versions) setVersions(result.versions);
      else
        remember(
          accepted,
          publish ? 'published' : 'draft',
          publish ? 'Site publicado' : 'Rascunho salvo',
        );
      try {
        localStorage.removeItem(LOCAL_DRAFT);
      } catch {
        /* The server saved the document. */
      }
      notify(
        result.draft.design
          ? publish
            ? 'Tema e conteúdo publicados.'
            : 'Rascunho salvo. O site público continua como estava.'
          : 'Textos salvos. O tema visual permanece neste navegador até a integração de persistência.',
      );
      if (!result.draft.design) {
        try {
          localStorage.setItem(
            LOCAL_DRAFT,
            JSON.stringify({ content: accepted, base: result.draftUpdatedAt }),
          );
        } catch {
          /* The server saved the text. */
        }
      }
    } catch (reason) {
      notify(errorMessage(reason));
      throw reason;
    } finally {
      setSaving(false);
    }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const keys = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey)) return;
      if (event.key.toLowerCase() === 's') {
        event.preventDefault();
        void saveRef.current().catch(() => {});
      }
      const editingInput = (event.target as HTMLElement).closest(
        'input,textarea,[contenteditable]',
      );
      if (event.key.toLowerCase() === 'z' && !editingInput) {
        event.preventDefault();
        if (event.shiftKey) history.redo();
        else history.undo();
      }
      if (event.key.toLowerCase() === 'y' && !editingInput) {
        event.preventDefault();
        history.redo();
      }
    };
    window.addEventListener('keydown', keys);
    return () => window.removeEventListener('keydown', keys);
  }, [history.undo, history.redo]);
  const select = useCallback((id: string) => {
    setSelected(id);
    setRightOpen(true);
    setLeftOpen(false);
    if (!id.startsWith('@')) setMode('sections');
  }, []);
  const addSection = useCallback(
    (type: SectionType, beforeId?: string) => {
      const section = createSection(type);
      history.change((d) => {
        const beforeIndex = beforeId
          ? d.design.sections.findIndex((s) => s.id === beforeId)
          : -1;
        const afterIndex = after
          ? d.design.sections.findIndex((s) => s.id === after)
          : -1;
        d.design.sections.splice(
          beforeIndex >= 0
            ? beforeIndex
            : afterIndex >= 0
              ? afterIndex + 1
              : d.design.sections.length,
          0,
          section,
        );
      });
      setSelected(section.id);
      setMode('sections');
      setAfter('');
      setRightOpen(true);
      setLeftOpen(false);
      setPage('home');
    },
    [history.change, after],
  );
  function drop(id: string, beforeId: string) {
    setDragging('');
    setDropTarget('');
    if (!id || id === beforeId) return;
    if (id.startsWith('new:')) {
      const type = id.slice(4) as SectionType;
      if (SECTION_CATALOG.some((s) => s.type === type))
        addSection(type, beforeId);
      return;
    }
    history.change((d) => {
      const from = d.design.sections.findIndex((s) => s.id === id);
      if (from < 0) return;
      const [section] = d.design.sections.splice(from, 1);
      const to = d.design.sections.findIndex((s) => s.id === beforeId);
      d.design.sections.splice(
        to < 0 ? d.design.sections.length : to,
        0,
        section,
      );
    });
  }
  function move(id: string, delta: number) {
    if (!draft) return;
    const visible = draft.design.sections.filter((s) => !s.archived);
    const index = visible.findIndex((s) => s.id === id);
    if (index + delta < 0 || index + delta >= visible.length) return;
    history.change((d) => {
      const from = d.design.sections.findIndex((s) => s.id === id);
      const target = d.design.sections.findIndex(
        (s) => s.id === visible[index + delta].id,
      );
      const [section] = d.design.sections.splice(from, 1);
      d.design.sections.splice(target, 0, section);
    });
  }

  if (resource.error && !draft)
    return <ErrorState message={resource.error} onRetry={resource.reload} />;
  if (!draft || !info) return <Loading />;
  const sections = draft.design.sections.filter((s) => !s.archived);
  const archived = draft.design.sections.filter((s) => s.archived);
  const catalog = SECTION_CATALOG.filter((s) =>
    `${s.name} ${s.description}`
      .toLocaleLowerCase('pt-BR')
      .includes(search.toLocaleLowerCase('pt-BR')),
  );
  const global = selected?.startsWith('@');
  const restoreVersion = (version: SiteVersion) => {
    history.change((d) => Object.assign(d, normalizeDocument(version.content)));
    setRestoring(null);
    notify(
      'Versão recuperada no editor. Salve o rascunho ou publique para aplicar.',
    );
  };
  const modes = [
    { key: 'sections', label: 'Seções', icon: Layers3 },
    { key: 'add', label: 'Adicionar', icon: Plus },
    { key: 'theme', label: 'Tema', icon: Palette },
    { key: 'history', label: 'Versões', icon: History },
    { key: 'archive', label: 'Arquivadas', icon: Trash2 },
    { key: 'settings', label: 'Configurações', icon: Settings2 },
  ] as const;
  return (
    <div className={`cms-workspace ${previewing ? 'previewing' : ''}`}>
      <header className="cms-topbar">
        <div className="cms-topbar-brand">
          <Link href="/plataforma" aria-label="Voltar ao painel">
            <ArrowLeft size={18} />
          </Link>
          <span className="cms-brand-symbol">
            <LayoutTemplate size={19} />
          </span>
          <div>
            <strong>Editor do site</strong>
            <span>
              <i className={dirty ? 'dirty' : ''} />
              {dirty
                ? 'Alterações não salvas'
                : info.hasUnpublishedChanges
                  ? 'Rascunho'
                  : 'Salvo'}
            </span>
          </div>
        </div>
        <div className="cms-topbar-center">
          <select
            aria-label="Página em edição"
            value={page}
            onChange={(event) => {
              const next = event.target.value as EditorPage;
              setPage(next);
              if (next === 'terms' || next === 'privacy') {
                setSelected(`@${next}`);
                setRightOpen(true);
              } else if (next === 'contact' || next === 'custom') {
                select('@contact');
              } else if (next === 'plans') {
                select(
                  draft.design.sections.find((s) => s.type === 'pricing')?.id ||
                    '@seo',
                );
              } else if (next === 'home') {
                setSelected(
                  draft.design.sections.find((s) => !s.archived)?.id || null,
                );
              }
            }}
          >
            {Object.entries(PAGE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <div className="cms-device-switch">
            <button
              aria-label="Prévia em desktop"
              aria-pressed={device === 'desktop'}
              onClick={() => setDevice('desktop')}
            >
              <Monitor size={17} />
            </button>
            <button
              aria-label="Prévia em celular"
              aria-pressed={device === 'mobile'}
              onClick={() => setDevice('mobile')}
            >
              <Smartphone size={17} />
            </button>
          </div>
        </div>
        <div className="cms-topbar-actions">
          <div className="cms-undo-group">
            <button
              aria-label="Desfazer"
              title="Desfazer (Ctrl+Z)"
              disabled={!history.canUndo || saving}
              onClick={history.undo}
            >
              <Undo2 size={17} />
            </button>
            <button
              aria-label="Refazer"
              title="Refazer (Ctrl+Shift+Z)"
              disabled={!history.canRedo || saving}
              onClick={history.redo}
            >
              <Redo2 size={17} />
            </button>
          </div>
          <button
            className="cms-preview-button"
            aria-pressed={previewing}
            onClick={() => setPreviewing(!previewing)}
          >
            <Eye size={16} />
            <span>{previewing ? 'Voltar a editar' : 'Prévia'}</span>
          </button>
          <button
            className="cms-save-button"
            disabled={saving || !dirty}
            onClick={() => void save().catch(() => {})}
          >
            {saving ? (
              <LoaderCircle size={15} className="animate-spin" />
            ) : (
              <Save size={15} />
            )}
            <span>Salvar rascunho</span>
          </button>
          <button
            className="cms-publish-button"
            disabled={saving}
            onClick={() => setPublishing(true)}
          >
            Publicar
            <ChevronDown size={13} />
          </button>
        </div>
      </header>
      {recovery && (
        <div className="cms-recovery">
          <span>Encontramos alterações locais que ainda não foram salvas.</span>
          <button
            onClick={() => {
              history.change((d) =>
                Object.assign(d, normalizeDocument(recovery)),
              );
              setRecovery(null);
            }}
          >
            Recuperar alterações
          </button>
          <button
            aria-label="Descartar recuperação"
            onClick={() => {
              setRecovery(null);
              localStorage.removeItem(LOCAL_DRAFT);
            }}
          >
            <X size={15} />
          </button>
        </div>
      )}
      <div className="cms-mobile-tools">
        <button
          onClick={() => {
            setLeftOpen(!leftOpen);
            setRightOpen(false);
          }}
        >
          <PanelLeft size={16} />
          Seções
        </button>
        <span>{PAGE_LABELS[page]}</span>
        <button
          onClick={() => {
            setRightOpen(!rightOpen);
            setLeftOpen(false);
          }}
        >
          <Settings2 size={16} />
          Propriedades
        </button>
      </div>
      <div className="cms-body">
        <nav className="cms-tool-rail" aria-label="Ferramentas do editor">
          {modes.map((item) => (
            <button
              key={item.key}
              title={item.label}
              aria-label={item.label}
              aria-current={mode === item.key ? 'page' : undefined}
              onClick={() => {
                setMode(item.key);
                setLeftOpen(item.key !== 'theme' || window.innerWidth >= 760);
                setRightOpen(item.key === 'theme');
              }}
            >
              <item.icon size={19} />
            </button>
          ))}
          <a
            href="/"
            target="_blank"
            rel="noreferrer"
            title="Abrir site público"
          >
            <Globe size={18} />
          </a>
        </nav>
        <aside className={`cms-left-sidebar ${leftOpen ? 'open' : ''}`}>
          <div className="cms-sidebar-heading">
            <div>
              <span className="cms-overline">NEXTROTTA</span>
              <h2>
                {mode === 'sections'
                  ? 'Estrutura da página'
                  : mode === 'add'
                    ? 'Adicionar seção'
                    : mode === 'theme'
                      ? 'Configurações do tema'
                      : mode === 'history'
                        ? 'Histórico de versões'
                        : mode === 'archive'
                          ? 'Seções arquivadas'
                          : 'Conteúdo global'}
              </h2>
            </div>
            <button
              className="cms-close-sidebar"
              aria-label="Fechar seções"
              onClick={() => setLeftOpen(false)}
            >
              <X size={16} />
            </button>
          </div>
          <div className="cms-left-scroll">
            {mode === 'sections' && (
              <>
                <button
                  className={`cms-fixed-section ${selected === '@header' ? 'active' : ''}`}
                  onClick={() => select('@header')}
                >
                  <LayoutTemplate size={15} />
                  <span>
                    Cabeçalho<small>Compartilhado em todo o site</small>
                  </span>
                  <ChevronRight size={13} />
                </button>
                <div className="cms-tree-label">
                  {PAGE_LABELS[page]}
                  <span>{sections.length} seções</span>
                </div>
                {page !== 'home' && (
                  <p className="cms-help cms-sidebar-note">
                    A estrutura personalizável é da página inicial. Use as
                    propriedades para editar os textos desta página.
                  </p>
                )}
                {page === 'home' && (
                  <div
                    className="cms-section-tree"
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={(e) => {
                      if (e.target === e.currentTarget)
                        drop(e.dataTransfer.getData('text/plain'), '');
                    }}
                  >
                    {sections.map((section, index) => (
                      <div
                        key={section.id}
                        className={`cms-tree-row ${selected === section.id ? 'selected' : ''} ${section.hidden ? 'hidden-section' : ''} ${dropTarget === section.id ? 'drop-target' : ''} ${dragging === section.id ? 'dragging' : ''}`}
                        draggable
                        onDragStart={(event) => {
                          event.dataTransfer.setData('text/plain', section.id);
                          event.dataTransfer.effectAllowed = 'move';
                          setDragging(section.id);
                        }}
                        onDragEnd={() => {
                          setDragging('');
                          setDropTarget('');
                        }}
                        onDragOver={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          setDropTarget(section.id);
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          event.stopPropagation();
                          drop(
                            event.dataTransfer.getData('text/plain'),
                            section.id,
                          );
                        }}
                      >
                        <button
                          className="cms-drag-handle"
                          aria-label={`Selecionar e arrastar ${section.name}`}
                          onClick={() => select(section.id)}
                        >
                          <GripVertical size={14} />
                        </button>
                        <button
                          className="cms-section-name"
                          onClick={() => select(section.id)}
                        >
                          <Layers3 size={14} />
                          <span>{section.name}</span>
                        </button>
                        <button
                          className="cms-visibility"
                          aria-label={`${section.hidden ? 'Mostrar' : 'Ocultar'} ${section.name}`}
                          onClick={() =>
                            history.change((d) => {
                              d.design.sections.find(
                                (s) => s.id === section.id,
                              )!.hidden = !section.hidden;
                            })
                          }
                        >
                          {section.hidden ? (
                            <EyeOff size={13} />
                          ) : (
                            <Eye size={13} />
                          )}
                        </button>
                        {selected === section.id && (
                          <div className="cms-tree-actions">
                            <button
                              title="Mover seção para cima"
                              aria-label="Mover seção para cima"
                              disabled={index === 0}
                              onClick={() => move(section.id, -1)}
                            >
                              <ArrowUp size={13} />
                            </button>
                            <button
                              title="Mover seção para baixo"
                              aria-label="Mover seção para baixo"
                              disabled={index === sections.length - 1}
                              onClick={() => move(section.id, 1)}
                            >
                              <ArrowDown size={13} />
                            </button>
                            <button
                              title="Arquivar seção"
                              aria-label="Arquivar seção selecionada"
                              onClick={() => setArchiving(section.id)}
                            >
                              <Trash2 size={13} />
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
                <button
                  className="cms-add-section"
                  onClick={() => {
                    setMode('add');
                    setAfter('');
                  }}
                >
                  <Plus size={16} />
                  Adicionar seção
                </button>
                <button
                  className={`cms-fixed-section ${selected === '@footer' ? 'active' : ''}`}
                  onClick={() => select('@footer')}
                >
                  <LayoutTemplate size={15} />
                  <span>
                    Rodapé<small>Compartilhado em todo o site</small>
                  </span>
                  <ChevronRight size={13} />
                </button>
                <div className="cms-help cms-sidebar-note">
                  <GripVertical size={13} />
                  Arraste as seções para mudar a ordem. Clique na página para
                  editar.
                </div>
              </>
            )}
            {mode === 'add' && (
              <>
                <label className="cms-library-search">
                  <Search size={15} />
                  <input
                    placeholder="Buscar componentes…"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </label>
                {(['Página', 'Componentes'] as const).map((category) => (
                  <div key={category}>
                    <p className="cms-tree-label">
                      {category === 'Página'
                        ? 'Seções prontas'
                        : 'Componentes livres'}
                    </p>
                    {catalog
                      .filter((entry) => entry.category === category)
                      .map((entry) => (
                        <button
                          className="cms-library-item"
                          key={entry.type}
                          draggable
                          onDragStart={(event) => {
                            event.dataTransfer.setData(
                              'text/plain',
                              `new:${entry.type}`,
                            );
                            setDragging(`new:${entry.type}`);
                          }}
                          onDragEnd={() => setDragging('')}
                          onClick={() => addSection(entry.type)}
                        >
                          <span className={`cms-library-thumb ${entry.type}`}>
                            <i />
                            <i />
                            <i />
                          </span>
                          <span>
                            <strong>{entry.name}</strong>
                            <small>{entry.description}</small>
                          </span>
                          <Plus size={14} />
                        </button>
                      ))}
                  </div>
                ))}
                {!catalog.length && (
                  <p className="cms-help cms-sidebar-note">
                    Nenhum componente encontrado. Tente outro nome.
                  </p>
                )}
              </>
            )}
            {mode === 'theme' && (
              <div className="cms-theme-intro">
                <div className="cms-palette-preview">
                  {['primary', 'background', 'text', 'accent'].map((key) => (
                    <i
                      key={key}
                      style={{
                        background: draft.design.theme[key as 'primary'],
                      }}
                    />
                  ))}
                </div>
                <h3>Uma identidade em cada detalhe.</h3>
                <p>
                  Escolha as cores, a tipografia e as formas no painel de
                  propriedades. A página acompanha cada ajuste.
                </p>
                <button onClick={() => setRightOpen(true)}>
                  Editar identidade
                  <ArrowRight size={14} />
                </button>
              </div>
            )}
            {mode === 'history' && (
              <>
                <div className="cms-history-current">
                  <span className="cms-status-dot" />
                  Versão em edição
                  <small>
                    {dirty
                      ? 'Alterações ainda não salvas'
                      : `Salva em ${date(info.draftUpdatedAt, true)}`}
                  </small>
                </div>
                <button
                  className="cms-history-item"
                  onClick={() =>
                    setRestoring({
                      id: 'published',
                      label: 'Versão publicada',
                      createdAt: info.publishedAt || '',
                      kind: 'published',
                      content: info.published,
                    })
                  }
                >
                  <Globe size={16} />
                  <span>
                    <strong>Versão no ar</strong>
                    <small>{date(info.publishedAt, true)}</small>
                  </span>
                  <RotateCcw size={14} />
                </button>
                {versions.map((version) => (
                  <button
                    className="cms-history-item"
                    key={version.id}
                    onClick={() => setRestoring(version)}
                  >
                    <History size={16} />
                    <span>
                      <strong>{version.label}</strong>
                      <small>{date(version.createdAt, true)}</small>
                      <em>
                        {version.kind === 'published'
                          ? 'Publicado'
                          : 'Rascunho'}
                      </em>
                    </span>
                    <RotateCcw size={14} />
                  </button>
                ))}
                {!versions.length && (
                  <p className="cms-help cms-sidebar-note">
                    Ao salvar ou publicar, uma versão será guardada aqui.
                  </p>
                )}
                <p className="cms-help cms-sidebar-note">
                  Restaurar uma versão altera o rascunho. O site no ar só muda
                  quando você publica.
                </p>
              </>
            )}
            {mode === 'archive' && (
              <>
                {archived.length ? (
                  archived.map((section) => (
                    <div className="cms-archived-item" key={section.id}>
                      <Layers3 size={16} />
                      <span>{section.name}</span>
                      <button
                        onClick={() => {
                          history.change((d) => {
                            const s = d.design.sections.find(
                              (s) => s.id === section.id,
                            )!;
                            s.archived = false;
                            s.hidden = false;
                          });
                          select(section.id);
                          notify('Seção restaurada no rascunho.');
                        }}
                      >
                        Restaurar
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="cms-sidebar-empty">
                    <Trash2 size={28} />
                    <h3>Nada arquivado</h3>
                    <p>
                      As seções removidas ficam guardadas aqui e podem voltar
                      para a página.
                    </p>
                  </div>
                )}
              </>
            )}
            {mode === 'settings' && (
              <>
                {[
                  ['@header', 'Cabeçalho'],
                  ['@contact', 'Contato'],
                  ['@footer', 'Rodapé'],
                  ['@seo', 'SEO e compartilhamento'],
                  ['@terms', 'Termos de uso'],
                  ['@privacy', 'Política de privacidade'],
                ].map(([id, label]) => (
                  <button
                    className={`cms-settings-item ${selected === id ? 'active' : ''}`}
                    key={id}
                    onClick={() => {
                      select(id);
                      if (id === '@terms' || id === '@privacy')
                        setPage(id.slice(1) as EditorPage);
                    }}
                  >
                    <Settings2 size={15} />
                    {label}
                    <ChevronRight size={13} />
                  </button>
                ))}
              </>
            )}
          </div>
          <div className="cms-left-footer">
            <span className="cms-status-dot" />
            {info.hasUnpublishedChanges || dirty
              ? 'Você está editando um rascunho'
              : 'Seu site está atualizado'}
          </div>
        </aside>
        <section className="cms-stage">
          <div className="cms-canvas-toolbar">
            <div>
              <span className="cms-status-dot" />
              {previewing ? 'Pré-visualização' : 'Edição visual'}
              <span className="cms-url">
                nextrotta.com.br
                {page === 'home'
                  ? ''
                  : `/${({ plans: 'planos', terms: 'termos', privacy: 'privacidade', contact: 'contato', custom: 'sob-medida', news: 'novidades' } as Record<string, string>)[page]}`}
              </span>
            </div>
            <select
              aria-label="Zoom da página"
              value={zoom}
              onChange={(e) =>
                setZoom(
                  e.target.value === 'fit' ? 'fit' : Number(e.target.value),
                )
              }
            >
              <option value="fit">Ajustar à tela</option>
              <option value="50">50%</option>
              <option value="75">75%</option>
              <option value="100">100%</option>
              <option value="125">125%</option>
              <option value="150">150%</option>
            </select>
          </div>
          <Canvas
            document={draft}
            device={device}
            zoom={zoom}
            page={page}
            onSelectGlobal={select}
            editor={
              previewing
                ? undefined
                : {
                    selected,
                    select,
                    dragStart: setDragging,
                    drop,
                    add: (id) => {
                      setAfter(id);
                      setMode('add');
                      setLeftOpen(true);
                    },
                  }
            }
          />
          <div className="cms-stage-footer">
            <span>
              {previewing
                ? 'Interaja com a prévia. Formulários não são enviados por este editor.'
                : selectedSection
                  ? `Página inicial / ${selectedSection.name}`
                  : 'Selecione uma seção para começar'}
            </span>
            <span>
              {device === 'desktop' ? '1280 px' : '390 px'} ·{' '}
              {zoom === 'fit' ? 'Ajustado' : `${zoom}%`}
            </span>
          </div>
        </section>
        <aside className={`cms-right-sidebar ${rightOpen ? 'open' : ''}`}>
          <button
            className="cms-close-sidebar cms-close-properties"
            aria-label="Fechar propriedades"
            onClick={() => setRightOpen(false)}
          >
            <X size={16} />
          </button>
          {mode === 'theme' ? (
            <ThemeInspector
              theme={draft.design.theme}
              change={history.change}
            />
          ) : global ? (
            <GlobalInspector
              id={selected!}
              document={draft}
              change={history.change}
            />
          ) : selectedSection && !selectedSection.archived ? (
            <SectionInspector
              key={selectedSection.id}
              section={selectedSection}
              document={draft}
              change={history.change}
              duplicate={() => {
                const copy = structuredClone(selectedSection);
                copy.id = crypto.randomUUID();
                copy.name = `${copy.name} (cópia)`;
                history.change((d) => {
                  const index = d.design.sections.findIndex(
                    (s) => s.id === selectedSection.id,
                  );
                  d.design.sections.splice(index + 1, 0, copy);
                });
                select(copy.id);
              }}
              archive={() => setArchiving(selectedSection.id)}
            />
          ) : (
            <div className="cms-sidebar-empty">
              <Settings2 size={28} />
              <h3>Faça do seu jeito.</h3>
              <p>
                Selecione uma seção na página ou na lista para editar seu
                conteúdo e aparência.
              </p>
            </div>
          )}
        </aside>
      </div>
      {archiving && (
        <Confirm
          title="Arquivar esta seção?"
          description="Ela sairá da página e ficará guardada em Seções arquivadas. Você pode restaurá-la quando quiser."
          onClose={() => setArchiving(null)}
          onConfirm={() => {
            history.change((d) => {
              d.design.sections.find((s) => s.id === archiving)!.archived =
                true;
            });
            setSelected(null);
            notify(
              'Seção arquivada. Você pode restaurá-la pela barra lateral.',
            );
          }}
        />
      )}
      {restoring && (
        <Confirm
          title={`Voltar para ${restoring.label.toLowerCase()}?`}
          description={`A versão de ${date(restoring.createdAt, true)} será carregada no editor. Você poderá desfazer esta ação. O site público não será alterado.`}
          onClose={() => setRestoring(null)}
          onConfirm={() => restoreVersion(restoring)}
        />
      )}
      {publishing && (
        <Confirm
          title="Publicar o tema e o conteúdo?"
          description="As alterações que você vê no editor substituirão a versão pública do site. A versão anterior ficará disponível no histórico."
          onClose={() => setPublishing(false)}
          onConfirm={async () => {
            await save(true);
          }}
        />
      )}
    </div>
  );
}
