import { randomUUID } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { put } from '@vercel/blob';
import { verifyOrganizationAuth } from '@/lib/auth';
import { sql } from '@/lib/db';
import { checkLimit } from '@/lib/billing/entitlements';
import { blockUnlessFeature } from '@/lib/billing/require-feature';
import { listDocuments } from '@/lib/library-documents';

export const runtime = 'nodejs';

function normalizeDocumentAudience(value: string | null | undefined) {
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

function sanitizeFileName(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase();
}

function getFileTitle(fileName: string) {
  return fileName.replace(/\.[^/.]+$/, '');
}

function getDocumentType(fileName: string, mimeType: string) {
  const extension = fileName.split('.').pop();
  if (extension && extension !== fileName && extension.length <= 10) {
    return extension.toUpperCase();
  }

  return mimeType || 'Arquivo';
}

export async function GET(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth || auth.role === 'platform_owner') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'library');
    if (featureBlocked) return featureBlocked;

    const documents = await listDocuments({
      organizationId: auth.organizationId,
      role: auth.role,
      technicianId: auth.technicianId || auth.userId,
    });
    // The blob address stays on the server: files are opened through each document's /file link.
    return NextResponse.json({ documents: documents.map(({ blobUrl: _blobUrl, fileName: _fileName, ...document }) => document) });
  } catch (error) {
    console.error('[documents] Get documents error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'library');
    if (featureBlocked) return featureBlocked;

    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Envie um arquivo válido.' }, { status: 400 });
    }

    const storageLimit = await checkLimit(auth.organizationId, 'storageMb', file.size / (1024 * 1024));
    if (!storageLimit.allowed) {
      return NextResponse.json({ error: storageLimit.message }, { status: 403 });
    }

    const id = randomUUID();
    const title = String(formData.get('title') || getFileTitle(file.name) || 'Documento').trim();
    const category = String(formData.get('category') || 'Não classificado').trim() || 'Não classificado';
    const audience = normalizeDocumentAudience(String(formData.get('audience') || 'Global'));
    const technicianId = String(formData.get('technician_id') || '').trim();

    let targetTechnicianId: string | null = null;
    if (audience === 'Individual') {
      if (!technicianId) {
        return NextResponse.json({ error: 'Selecione o técnico destinatário do documento individual.' }, { status: 400 });
      }

      const technicians = await sql`
        SELECT id
        FROM technicians
        WHERE id::text = ${technicianId}
          AND organization_id = ${auth.organizationId}
          AND status = 'active'
          AND deleted_at IS NULL
        LIMIT 1
      `;

      if (!technicians.length) {
        return NextResponse.json({ error: 'Técnico destinatário não encontrado ou inativo.' }, { status: 404 });
      }

      targetTechnicianId = String(technicians[0].id);
    }

    const safeName = sanitizeFileName(file.name || `documento-${id}`) || `documento-${id}`;
    const fileName = `${id}-${safeName}`;
    const pathname = `library/${auth.organizationId}/${fileName}`;
    const documentType = getDocumentType(file.name || fileName, file.type);
    const buffer = Buffer.from(await file.arrayBuffer());

    // Private store: files are only served through /api/documents/[id]/file, which checks who may see them.
    const blob = await put(pathname, buffer, {
      access: 'private',
      contentType: file.type || 'application/octet-stream',
    });

    const url = blob.url;

    const result = await sql`
      INSERT INTO library_documents (
        organization_id, id, title, category, audience, technician_id, type, url, file_name, file_size, uploaded_by
      )
      VALUES (
        ${auth.organizationId}, ${id}, ${title}, ${category}, ${audience}, ${targetTechnicianId}, ${documentType}, ${url}, ${fileName}, ${file.size}, ${auth.email}
      )
      RETURNING
        id,
        title,
        category,
        audience,
        technician_id,
        (
          SELECT name
          FROM technicians
          WHERE technicians.id::text = library_documents.technician_id
          LIMIT 1
        ) AS "technician_name",
        TO_CHAR(updated_at::date, 'YYYY-MM-DD') AS "updatedAt",
        type,
        '/api/documents/' || id || '/file' AS url,
        uploaded_by AS "uploadedBy"
    `;

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('[documents] Create document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const auth = await verifyOrganizationAuth(request);
    if (!auth) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const featureBlocked = await blockUnlessFeature(auth.organizationId, 'library');
    if (featureBlocked) return featureBlocked;

    if (auth.role !== 'admin') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const id = String(searchParams.get('id') || '').trim();

    if (!id) {
      return NextResponse.json({ error: 'Informe o documento que será excluído.' }, { status: 400 });
    }

    // Archived, not removed: the record and its file in the blob store are kept so the document
    // can be restored (and is part of the organization's exports and backups).
    const documents = await sql`
      UPDATE library_documents
      SET deleted_at = NOW(), deleted_by = ${auth.userId}, updated_at = NOW()
      WHERE id = ${id}
        AND organization_id = ${auth.organizationId}
        AND deleted_at IS NULL
      RETURNING title
    `;

    if (!documents.length) {
      return NextResponse.json({ error: 'Documento não encontrado.' }, { status: 404 });
    }

    return NextResponse.json({ success: true, id, title: documents[0].title });
  } catch (error) {
    console.error('[documents] Delete document error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
