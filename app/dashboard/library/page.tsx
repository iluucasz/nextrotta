'use client';

import { useEffect, useState } from 'react';
import {
  BookOpen,
  Clock3,
  ExternalLink,
  FileText,
  Filter,
  FolderOpen,
  Globe2,
  Search,
  UserRound,
} from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { LoadingShell } from '@/components/page-skeleton';
import { MetricCard } from '@/components/metric-card';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { formatDate, normalizeText } from '@/lib/formatters';
import type { LibraryDocument } from '@/lib/types';
import { useAppSession } from '@/hooks/use-app-session';
import { useTechnicianVisibility } from '@/hooks/use-technician-visibility';

type AudienceBucket = 'Global' | 'Individual' | 'Administrativo';
type VisibleAudienceBucket = 'Global' | 'Individual';

const audienceSections: Array<{
  id: VisibleAudienceBucket;
  label: string;
  description: string;
  icon: typeof Globe2;
  tone: 'info' | 'success';
  accentClassName: string;
}> = [
  {
    id: 'Global',
    label: 'Globais',
    description: 'Documentos amplos para operação, cobertura e consulta geral do colaborador.',
    icon: Globe2,
    tone: 'info',
    accentClassName: 'border-sky-200 bg-sky-50/80',
  },
  {
    id: 'Individual',
    label: 'Seus documentos',
    description: 'Materiais individuais liberados para o seu perfil, como onboarding e termos.',
    icon: UserRound,
    tone: 'success',
    accentClassName: 'border-emerald-200 bg-emerald-50/80',
  },
];

function normalizeDocumentAudience(value: string): AudienceBucket {
  const normalized = String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

  if (normalized.includes('admin')) return 'Administrativo';
  if (
    normalized.includes('individual') ||
    normalized.includes('tecnico') ||
    normalized.includes('colaborador') ||
    normalized.includes('pessoal')
  ) {
    return 'Individual';
  }

  return 'Global';
}

function getSectionConfig(bucket: VisibleAudienceBucket) {
  return audienceSections.find((section) => section.id === bucket) ?? audienceSections[0];
}

export default function TechnicianLibraryPage() {
  const { user, loading } = useAppSession();
  const { loading: visibilityLoading, blocked } = useTechnicianVisibility({ page: 'library' });
  const [query, setQuery] = useState('');
  const [documents, setDocuments] = useState<LibraryDocument[]>([]);
  const [isDataLoading, setIsDataLoading] = useState(true);
  const [dataError, setDataError] = useState('');
  const [activeAudience, setActiveAudience] = useState<'all' | VisibleAudienceBucket>('all');

  useEffect(() => {
    let mounted = true;

    async function loadDocuments() {
      if (!user) return;

      setIsDataLoading(true);
      setDataError('');

      try {
        const response = await fetch('/api/documents');
        if (!response.ok) {
          throw new Error('documents_fetch_failed');
        }

        const data = await response.json();
        const nextDocuments = Array.isArray(data.documents)
          ? data.documents.filter((document: LibraryDocument) => normalizeDocumentAudience(document.audience) !== 'Administrativo')
          : [];

        if (mounted) {
          setDocuments(nextDocuments);
        }
      } catch {
        if (mounted) {
          setDocuments([]);
          setDataError('Não foi possível carregar a biblioteca real do banco de dados.');
        }
      } finally {
        if (mounted) {
          setIsDataLoading(false);
        }
      }
    }

    loadDocuments();

    return () => {
      mounted = false;
    };
  }, [user]);

  if (loading || isDataLoading || visibilityLoading || blocked || !user) {
    return <LoadingShell role="technician" />;
  }

  const visibleDocuments = documents.filter((document) => normalizeDocumentAudience(document.audience) !== 'Administrativo');
  const filteredDocuments = visibleDocuments.filter((document) => {
    const bucket = normalizeDocumentAudience(document.audience);
    const haystack = normalizeText(`${document.title} ${document.category} ${document.audience}`);
    const matchesQuery = !query || haystack.includes(normalizeText(query));
    const matchesAudience = activeAudience === 'all' || bucket === activeAudience;

    return matchesQuery && matchesAudience;
  });

  filteredDocuments.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));

  const documentsByAudience = {
    Global: filteredDocuments.filter((document) => normalizeDocumentAudience(document.audience) === 'Global'),
    Individual: filteredDocuments.filter((document) => normalizeDocumentAudience(document.audience) === 'Individual'),
  } satisfies Record<VisibleAudienceBucket, LibraryDocument[]>;

  const audienceTotals = {
    Global: visibleDocuments.filter((document) => normalizeDocumentAudience(document.audience) === 'Global').length,
    Individual: visibleDocuments.filter((document) => normalizeDocumentAudience(document.audience) === 'Individual').length,
  } satisfies Record<VisibleAudienceBucket, number>;

  return (
    <AppShell role="technician" userName={user.name || user.email}>
      <PageHeader
        eyebrow="Base de conhecimento"
        title="Biblioteca"
        description="Consulte materiais globais e documentos individuais liberados para o seu perfil."
      />

      {dataError ? <div className="mb-4 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-700">{dataError}</div> : null}

      <div className="grid gap-3 xl:grid-cols-4">
        <MetricCard title="Documentos" value={visibleDocuments.length} hint="Arquivos liberados para consulta" icon={BookOpen} />
        <MetricCard title="Globais" value={audienceTotals.Global} hint="Materiais amplos para toda a operação" icon={Globe2} tone="success" />
        <MetricCard title="Seus documentos" value={audienceTotals.Individual} hint="Conteúdos individuais liberados para você" icon={UserRound} />
        <MetricCard title="Categorias" value={new Set(visibleDocuments.map((document) => document.category)).size} hint="Biblioteca organizada por assunto" icon={FileText} />
      </div>

      <div className="mt-5">
        <DataPanel
          title="Galeria de documentos"
          description="Busque, filtre por público e navegue pela biblioteca com a mesma organização da central administrativa."
          action={
            <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
              <div className="flex min-h-10 items-center gap-2 rounded-md border border-border bg-background px-3">
                <Search className="h-4 w-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Buscar por título, categoria ou público"
                  className="w-64 bg-transparent text-sm outline-none"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant={activeAudience === 'all' ? 'default' : 'outline'} size="sm" onClick={() => setActiveAudience('all')}>
                  <Filter className="h-4 w-4" />
                  Tudo
                </Button>
                {audienceSections.map((section) => {
                  const Icon = section.icon;

                  return (
                    <Button
                      key={section.id}
                      type="button"
                      variant={activeAudience === section.id ? 'default' : 'outline'}
                      size="sm"
                      onClick={() => setActiveAudience(section.id)}
                    >
                      <Icon className="h-4 w-4" />
                      {section.label}
                    </Button>
                  );
                })}
              </div>
            </div>
          }
        >
          {filteredDocuments.length === 0 ? (
            <EmptyState
              icon={FolderOpen}
              title="Nenhum documento encontrado"
              description="Ajuste a busca ou o filtro de público para localizar outro material liberado para o seu perfil."
            />
          ) : (
            <div className="space-y-6">
              {audienceSections
                .filter((section) => activeAudience === 'all' || activeAudience === section.id)
                .filter((section) => documentsByAudience[section.id].length > 0)
                .map((section) => {
                  const sectionDocuments = documentsByAudience[section.id];
                  const Icon = section.icon;

                  return (
                    <section key={section.id} className="space-y-3">
                      <div className={`rounded-xl border p-4 ${section.accentClassName}`}>
                        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                          <div className="flex items-start gap-3">
                            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-background text-foreground shadow-sm">
                              <Icon className="h-5 w-5" />
                            </div>
                            <div>
                              <div className="flex items-center gap-2">
                                <h3 className="text-base font-semibold">{section.label}</h3>
                                <StatusBadge tone={section.tone}>{sectionDocuments.length} documento{sectionDocuments.length === 1 ? '' : 's'}</StatusBadge>
                              </div>
                              <p className="mt-1 text-sm text-muted-foreground">{section.description}</p>
                            </div>
                          </div>
                          <div className="text-sm text-muted-foreground">
                            {new Set(sectionDocuments.map((document) => document.category)).size} categoria{new Set(sectionDocuments.map((document) => document.category)).size === 1 ? '' : 's'}
                          </div>
                        </div>
                      </div>

                      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                        {sectionDocuments.map((document) => {
                          const bucket = normalizeDocumentAudience(document.audience);
                          const cardSection = getSectionConfig(bucket === 'Individual' ? 'Individual' : 'Global');
                          const CardIcon = cardSection.icon;

                          return (
                            <article key={document.id} className="overflow-hidden rounded-xl border border-border bg-background shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
                              <div className={`border-b p-4 ${cardSection.accentClassName}`}>
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex min-w-0 items-start gap-3">
                                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-background text-foreground shadow-sm">
                                      <CardIcon className="h-5 w-5" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">{document.category}</p>
                                      <h4 className="mt-1 line-clamp-2 text-base font-semibold text-foreground">{document.title}</h4>
                                    </div>
                                  </div>
                                  <StatusBadge tone={cardSection.tone}>{document.type}</StatusBadge>
                                </div>
                              </div>

                              <div className="space-y-4 p-4">
                                <div className="flex flex-wrap gap-2">
                                  <StatusBadge tone={cardSection.tone}>{cardSection.label}</StatusBadge>
                                  <StatusBadge>{document.category}</StatusBadge>
                                </div>

                                <div className="grid gap-2 text-sm text-muted-foreground">
                                  <div className="flex items-center gap-2">
                                    <Clock3 className="h-4 w-4" />
                                    Atualizado em {formatDate(document.updatedAt)}
                                  </div>
                                  <div className="flex items-center gap-2">
                                    <FileText className="h-4 w-4" />
                                    {document.uploadedBy ? `Enviado por ${document.uploadedBy}` : 'Catálogo interno sem remetente informado'}
                                  </div>
                                </div>

                                {document.url ? (
                                  <Button asChild className="w-full">
                                    <a href={document.url} target="_blank" rel="noreferrer">
                                      <ExternalLink className="h-4 w-4" />
                                      Abrir arquivo
                                    </a>
                                  </Button>
                                ) : (
                                  <Button type="button" variant="secondary" className="w-full" disabled>
                                    Arquivo ainda não enviado
                                  </Button>
                                )}
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </section>
                  );
                })}
            </div>
          )}
        </DataPanel>
      </div>
    </AppShell>
  );
}
