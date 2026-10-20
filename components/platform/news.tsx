'use client';

import Link from 'next/link';
import { useState } from 'react';
import { Plus } from 'lucide-react';
import { api, date, useResource } from './api';
import { useNotify } from './notice';
import {
  Badge,
  Confirm,
  DataTable,
  Editor,
  ErrorState,
  Loading,
  Panel,
  RichText,
  Title,
  type Field,
} from './ui';

type NewsPost = {
  id: string;
  title: string;
  publishedOn: string;
  category: 'feature' | 'improvement' | 'fix';
  body: string;
  imageUrl: string | null;
  destination: 'site' | 'system' | 'both';
  status: 'draft' | 'published';
  archived: boolean;
  createdAt: string;
  updatedAt: string;
};

export const NEWS_CATEGORY_LABELS = {
  feature: 'Novo recurso',
  improvement: 'Melhoria',
  fix: 'Correção',
};
const DESTINATION_LABELS = {
  site: 'Site',
  system: 'Sistema',
  both: 'Site e sistema',
};
const STATUS_LABELS = { draft: 'Rascunho', published: 'Publicado' };

const FIELDS: Field[] = [
  { key: 'title', label: 'Título', required: true },
  { key: 'publishedOn', label: 'Data', type: 'date', required: true },
  {
    key: 'category',
    label: 'Categoria',
    type: 'select',
    required: true,
    options: Object.entries(NEWS_CATEGORY_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  {
    key: 'destination',
    label: 'Onde publicar',
    type: 'select',
    required: true,
    options: Object.entries(DESTINATION_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  {
    key: 'status',
    label: 'Estado',
    type: 'select',
    required: true,
    options: Object.entries(STATUS_LABELS).map(([value, label]) => ({
      value,
      label,
    })),
  },
  { key: 'imageUrl', label: 'URL da imagem (opcional, https)' },
  {
    key: 'body',
    label: 'Texto (use ## para subtítulos e **negrito**)',
    type: 'textarea',
  },
];

function today() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
  }).format(new Date());
}

function statusText(post: NewsPost) {
  return post.archived ? 'Arquivado' : STATUS_LABELS[post.status];
}

export function News({ id }: { id?: string }) {
  const notify = useNotify();
  const posts = useResource<{ posts: NewsPost[] }>('/news');
  const [editing, setEditing] = useState<NewsPost | 'new' | null>(null);
  const [archive, setArchive] = useState<NewsPost | null>(null);
  const [publishing, setPublishing] = useState<NewsPost | null>(null);

  if (posts.loading && !posts.data) return <Loading />;
  if (posts.error)
    return <ErrorState message={posts.error} onRetry={posts.reload} />;

  const list = posts.data!.posts;
  const current = id ? list.find((post) => post.id === id) : null;

  const publication = publishing && (
    <Confirm
      title={`Publicar ${publishing.title}?`}
      description={`A novidade ficará disponível em: ${DESTINATION_LABELS[publishing.destination]}.`}
      onClose={() => setPublishing(null)}
      onConfirm={async () => {
        await api(`/news/${publishing.id}`, {
          method: 'PATCH',
          body: { status: 'published' },
        });
        notify('Publicação no ar.');
        posts.reload();
      }}
    />
  );

  const editor = editing && (
    <Editor
      title={
        editing === 'new' ? 'Nova publicação' : `Editar · ${editing.title}`
      }
      description="Escolha Publicado no campo Estado para colocar a novidade no ar, ou Rascunho para continuar depois."
      fields={FIELDS}
      initial={
        editing === 'new'
          ? {
              title: '',
              publishedOn: today(),
              category: 'improvement',
              destination: 'both',
              status: 'draft',
              imageUrl: '',
              body: '',
            }
          : {
              title: editing.title,
              publishedOn: editing.publishedOn,
              category: editing.category,
              destination: editing.destination,
              status: editing.status,
              imageUrl: editing.imageUrl ?? '',
              body: editing.body,
            }
      }
      validate={(values) =>
        values.status === 'published' && !String(values.body).trim()
          ? 'Escreva o texto antes de publicar.'
          : ''
      }
      onClose={() => setEditing(null)}
      submit="Salvar publicação"
      onSave={async (values) => {
        if (editing === 'new') await api('/news', { body: values });
        else
          await api(`/news/${editing.id}`, { method: 'PATCH', body: values });
        notify(
          values.status === 'published'
            ? 'Publicação no ar.'
            : 'Rascunho salvo.',
        );
        posts.reload();
      }}
    />
  );

  if (id) {
    if (!current) return <ErrorState message="Publicação não encontrada." />;
    return (
      <>
        <Title
          title={current.title}
          description={`${NEWS_CATEGORY_LABELS[current.category]} · ${date(current.publishedOn)} · ${DESTINATION_LABELS[current.destination]}`}
          action={
            <div className="nr-actions">
              <Link className="nr-btn" href="/plataforma/novidades">
                Voltar à lista
              </Link>
              {!current.archived && (
                <button
                  className="nr-btn primary"
                  onClick={() => setEditing(current)}
                >
                  Editar
                </button>
              )}
              {!current.archived && current.status === 'draft' && (
                <button
                  className="nr-btn primary"
                  onClick={() => setPublishing(current)}
                >
                  Publicar
                </button>
              )}
            </div>
          }
        />
        <Panel
          title="Pré-visualização"
          action={<Badge>{statusText(current)}</Badge>}
        >
          <div className="nr-pad">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {current.imageUrl && (
              <img
                className="mb-6 max-h-80 rounded-lg"
                src={current.imageUrl}
                alt=""
              />
            )}
            <RichText text={current.body} />
          </div>
        </Panel>
        {editor}
        {publication}
      </>
    );
  }

  return (
    <>
      <Title
        title="Novidades"
        description="Conte as melhorias que estão chegando à operação dos seus clientes."
        action={
          <button className="nr-btn primary" onClick={() => setEditing('new')}>
            <Plus size={15} />
            Nova publicação
          </button>
        }
      />
      <Panel title="Publicações">
        <DataTable
          rows={list.map((post) => ({
            ...post,
            categoryText: NEWS_CATEGORY_LABELS[post.category],
            destinationText: DESTINATION_LABELS[post.destination],
            statusText: statusText(post),
          }))}
          defaultSort="publishedOn"
          defaultDescending
          filters={[
            {
              key: 'statusText',
              label: 'Estado',
              options: ['Rascunho', 'Publicado', 'Arquivado'],
            },
            {
              key: 'categoryText',
              label: 'Categoria',
              options: Object.values(NEWS_CATEGORY_LABELS),
            },
            {
              key: 'destinationText',
              label: 'Onde aparece',
              options: Object.values(DESTINATION_LABELS),
            },
          ]}
          columns={[
            {
              key: 'title',
              label: 'Publicação',
              render: (row) => (
                <Link href={`/plataforma/novidades/${row.id}`}>
                  {row.title}
                </Link>
              ),
            },
            { key: 'categoryText', label: 'Categoria' },
            {
              key: 'publishedOn',
              label: 'Data',
              render: (row) => date(row.publishedOn),
            },
            { key: 'destinationText', label: 'Onde aparece' },
            {
              key: 'statusText',
              label: 'Estado',
              render: (row) => <Badge>{row.statusText}</Badge>,
            },
          ]}
          actions={(row) => (
            <>
              {!row.archived && (
                <button onClick={() => setEditing(row)}>Editar</button>
              )}
              {!row.archived && row.status === 'draft' && (
                <button onClick={() => setPublishing(row)}>Publicar</button>
              )}
              <button onClick={() => setArchive(row)}>
                {row.archived ? 'Restaurar' : 'Arquivar'}
              </button>
            </>
          )}
          emptyText="Nenhuma publicação ainda. Conte a primeira novidade aos seus clientes."
        />
      </Panel>
      {editor}
      {publication}
      {archive && (
        <Confirm
          title={`${archive.archived ? 'Restaurar' : 'Arquivar'} ${archive.title}?`}
          description={
            archive.archived
              ? 'Volta a aparecer onde estava publicada.'
              : 'Sai do site e do sistema. Nada é apagado e pode ser restaurada.'
          }
          onClose={() => setArchive(null)}
          onConfirm={async () => {
            await api(`/news/${archive.id}`, {
              method: 'PATCH',
              body: { archived: !archive.archived },
            });
            notify(
              archive.archived
                ? 'Publicação restaurada.'
                : 'Publicação arquivada.',
            );
            posts.reload();
          }}
        />
      )}
    </>
  );
}
