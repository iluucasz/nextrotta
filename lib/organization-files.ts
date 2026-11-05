import { sql } from './db';

/**
 * The files a company keeps in the system (library documents and the photo of each part). The store is private, so they only
 * open through the system: this is what the locked-access page lists, so a locked company can still see and download them.
 */

export type CompanyFiles = {
  documents: Array<{ id: string; title: string; category: string | null; fileName: string | null; type: string | null; size: number | null }>;
  images: Array<{ id: string; name: string; size: number | null }>;
};

const isUuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

export async function listCompanyFiles(organizationId: string): Promise<CompanyFiles> {
  const [documents, images] = await Promise.all([
    sql`
      SELECT id::text AS id, title, category, file_name, type, file_size
      FROM library_documents
      WHERE organization_id = ${organizationId} AND deleted_at IS NULL
      ORDER BY category NULLS LAST, title
    `,
    sql`
      SELECT p.id::text AS id, p.name, i.file_size
      FROM parts p JOIN part_images i ON i.id = p.image_id
      WHERE p.organization_id = ${organizationId}
      ORDER BY p.name
    `,
  ]);
  return {
    documents: documents.map((row) => ({
      id: String(row.id),
      title: String(row.title ?? row.file_name ?? 'Documento'),
      category: (row.category as string | null) ?? null,
      fileName: (row.file_name as string | null) ?? null,
      type: (row.type as string | null) ?? null,
      size: row.file_size == null ? null : Number(row.file_size),
    })),
    images: images.map((row) => ({ id: String(row.id), name: String(row.name ?? 'Peça'), size: row.file_size == null ? null : Number(row.file_size) })),
  };
}

/** The private address and name of one file of the company (null when it is not theirs or does not exist). */
export async function getCompanyFile(organizationId: string, kind: string, id: string): Promise<{ url: string; fileName: string; contentType: string | null } | null> {
  if (!isUuid(id)) return null;
  if (kind === 'documents') {
    const row = (await sql`SELECT url, file_name, title FROM library_documents WHERE id::text = ${id} AND organization_id = ${organizationId} AND deleted_at IS NULL`)[0];
    return row?.url ? { url: String(row.url), fileName: String(row.file_name || row.title || 'documento'), contentType: null } : null;
  }
  if (kind === 'images') {
    const row = (await sql`SELECT i.url, i.content_type, p.name FROM parts p JOIN part_images i ON i.id = p.image_id WHERE p.id::text = ${id} AND p.organization_id = ${organizationId}`)[0];
    if (!row?.url) return null;
    const type = String(row.content_type ?? '');
    const extension = type === 'image/png' ? 'png' : type === 'image/webp' ? 'webp' : 'jpg';
    return { url: String(row.url), fileName: `${String(row.name ?? 'peca').replace(/[\\/:*?"<>|]+/g, ' ').trim()}.${extension}`, contentType: type || null };
  }
  return null;
}
