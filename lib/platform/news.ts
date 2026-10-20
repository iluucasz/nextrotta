import { recordAudit } from '../audit';
import { sql } from '../db';
import { isUuid, PlatformError, type Actor } from './errors';

export const NEWS_CATEGORIES = ['feature', 'improvement', 'fix'] as const;
export const NEWS_DESTINATIONS = ['site', 'system', 'both'] as const;
export type NewsCategory = (typeof NEWS_CATEGORIES)[number];
export type NewsDestination = (typeof NEWS_DESTINATIONS)[number];

function serializePost(row: Record<string, unknown>) {
  return {
    id: String(row.id),
    title: String(row.title),
    publishedOn: new Date(row.published_on as string)
      .toISOString()
      .slice(0, 10),
    category: row.category as NewsCategory,
    body: String(row.body ?? ''),
    imageUrl: (row.image_url as string | null) ?? null,
    destination: row.destination as NewsDestination,
    status: row.status as 'draft' | 'published',
    archived: Boolean(row.archived_at),
    createdAt: new Date(row.created_at as string).toISOString(),
    updatedAt: new Date(row.updated_at as string).toISOString(),
  };
}

export type NewsPost = ReturnType<typeof serializePost>;

export async function listNewsPosts() {
  const rows =
    await sql`SELECT * FROM news_posts ORDER BY published_on DESC, created_at DESC`;
  return rows.map(serializePost);
}

export async function getNewsPost(id: string) {
  if (!isUuid(id)) throw new PlatformError('Publicação não encontrada.', 404);
  const rows = await sql`SELECT * FROM news_posts WHERE id = ${id}`;
  if (!rows[0]) throw new PlatformError('Publicação não encontrada.', 404);
  return serializePost(rows[0]);
}

/** Published, not archived posts for one surface: the marketing site or the organizations' system. */
export async function listPublishedNews(
  surface: 'site' | 'system',
  limit = 50,
) {
  const rows = await sql`
    SELECT * FROM news_posts
    WHERE status = 'published' AND archived_at IS NULL AND destination IN (${surface}, 'both')
    ORDER BY published_on DESC, created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(serializePost);
}

function parsePost(input: Record<string, unknown>) {
  const title = String(input.title ?? '').trim();
  const publishedOn = String(input.publishedOn ?? '');
  const category = input.category as NewsCategory;
  const destination = input.destination as NewsDestination;
  const status = input.status === 'published' ? 'published' : 'draft';
  const body = String(input.body ?? '').trim();
  const imageUrl = String(input.imageUrl ?? '').trim() || null;

  if (!title) throw new PlatformError('Informe o título.');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(publishedOn))
    throw new PlatformError('Informe a data da publicação.');
  if (!NEWS_CATEGORIES.includes(category))
    throw new PlatformError('Escolha a categoria.');
  if (!NEWS_DESTINATIONS.includes(destination))
    throw new PlatformError('Escolha onde publicar.');
  if (status === 'published' && !body)
    throw new PlatformError('Escreva o texto antes de publicar.');
  if (imageUrl && !/^https:\/\//.test(imageUrl))
    throw new PlatformError('A imagem precisa de um endereço https.');
  return { title, publishedOn, category, destination, status, body, imageUrl };
}

function audit(
  actor: Actor,
  action: string,
  id: string,
  details: Record<string, unknown>,
) {
  return recordAudit({
    organizationId: null,
    actorId: actor.id,
    actorRole: 'platform_owner',
    action,
    targetType: 'news_post',
    targetId: id,
    details,
  });
}

export async function createNewsPost(
  input: Record<string, unknown>,
  actor: Actor,
) {
  const values = parsePost(input);
  const rows = await sql`
    INSERT INTO news_posts (title, published_on, category, body, image_url, destination, status, created_by)
    VALUES (${values.title}, ${values.publishedOn}, ${values.category}, ${values.body}, ${values.imageUrl},
            ${values.destination}, ${values.status}, ${actor.id})
    RETURNING id
  `;
  await audit(actor, 'news.created', String(rows[0].id), {
    title: values.title,
    status: values.status,
  });
  return getNewsPost(String(rows[0].id));
}

export async function updateNewsPost(
  id: string,
  input: Record<string, unknown>,
  actor: Actor,
) {
  const before = await getNewsPost(id);
  if ('archived' in input) {
    const archived = Boolean(input.archived);
    await sql`UPDATE news_posts SET archived_at = ${archived ? new Date().toISOString() : null}, updated_at = NOW() WHERE id = ${id}`;
    await audit(actor, archived ? 'news.archived' : 'news.restored', id, {
      title: before.title,
    });
    return getNewsPost(id);
  }
  const values = parsePost({ ...before, ...input });
  if (before.archived && values.status === 'published')
    throw new PlatformError('Restaure a publicação antes de publicar.');
  await sql`
    UPDATE news_posts
    SET title = ${values.title}, published_on = ${values.publishedOn}, category = ${values.category}, body = ${values.body},
        image_url = ${values.imageUrl}, destination = ${values.destination}, status = ${values.status}, updated_at = NOW()
    WHERE id = ${id}
  `;
  await audit(
    actor,
    before.status !== 'published' && values.status === 'published'
      ? 'news.published'
      : 'news.updated',
    id,
    {
      title: values.title,
      status: values.status,
    },
  );
  return getNewsPost(id);
}
