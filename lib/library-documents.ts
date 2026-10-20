import { sql } from './db';

/** Library documents an organization user may see (archived ones never; technicians not the administrative or others' ones). */

export type DocumentAuthScope = {
  organizationId: string;
  role: 'admin' | 'technician';
  technicianId?: string;
};

export async function listDocuments(scope: DocumentAuthScope, documentId?: string) {
  const params: string[] = [scope.organizationId];
  const conditions: string[] = ['d.organization_id = $1', 'd.deleted_at IS NULL'];

  if (scope.role !== 'admin') {
    params.push(scope.technicianId ?? '');
    conditions.push(`d.audience <> 'Administrativo'`);
    conditions.push(`(d.audience <> 'Individual' OR d.technician_id = $${params.length})`);
  }

  conditions.push(`(d.audience <> 'Individual' OR t.status = 'active')`);

  if (documentId) {
    params.push(documentId);
    conditions.push(`d.id = $${params.length}`);
  }

  const query = `
    SELECT
      d.id,
      d.title,
      d.category,
      d.audience,
      d.technician_id,
      t.name AS "technician_name",
      TO_CHAR(d.updated_at::date, 'YYYY-MM-DD') AS "updatedAt",
      d.type,
      '/api/documents/' || d.id || '/file' AS url,
      d.url AS "blobUrl",
      d.file_name AS "fileName",
      d.uploaded_by AS "uploadedBy"
    FROM library_documents d
    LEFT JOIN technicians t ON t.id::text = d.technician_id
    WHERE ${conditions.join(' AND ')}
    ORDER BY d.updated_at DESC, d.created_at DESC
  `;

  return sql.query(query, params);
}
