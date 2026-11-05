import { NextResponse } from 'next/server';
import { verifyOrganizationAuth } from '../auth';
import { sql } from '../db';
import { getBugReport } from '../platform/bugs';
import { PlatformError } from '../platform/errors';
import { isImageType } from './rules';
import type { ChatMessage, Conversation } from './store';

/** Shared by the routes of the customer's chat window. */

export function chatFailure(error: unknown) {
  if (error instanceof PlatformError) return NextResponse.json({ error: error.message }, { status: error.status });
  console.error('[support/livechat] error:', error);
  return NextResponse.json({ error: 'Erro interno.' }, { status: 500 });
}

/** The customer's view: their messages are "mine", the platform's are the other side. System lines stay in the middle. */
export const forCustomer = (message: ChatMessage) => ({
  id: message.id,
  mine: message.direction === 'in',
  senderName: message.direction === 'in' ? message.senderName : 'Suporte NextRotta',
  body: message.body,
  kind: message.kind,
  attachment: message.attachment ? { id: message.attachment.id, name: message.attachment.fileName, type: message.attachment.contentType, size: message.attachment.size, image: isImageType(message.attachment.contentType) } : null,
  createdAt: message.createdAt,
});

export const conversationView = (conversation: Conversation | null) =>
  conversation ? { id: conversation.id, status: conversation.status, unread: conversation.unreadCustomer, whatsapp: conversation.contactPhone } : null;

/** The ticket of this company that this person may chat about (the admin: any; others: their own). */
export async function authorizeCustomer(request: Request, ticketId: string) {
  const auth = await verifyOrganizationAuth(request);
  if (!auth) throw new PlatformError('Não autorizado.', 401);
  const { report } = await getBugReport(ticketId, { kind: 'organization', organizationId: auth.organizationId });
  if (auth.role !== 'admin' && report.userId !== auth.userId) throw new PlatformError('Chamado não encontrado.', 404);
  const user = (await sql`SELECT name FROM users WHERE id = ${auth.userId}`)[0];
  return { auth, report, userName: String(user?.name ?? 'Cliente') };
}
