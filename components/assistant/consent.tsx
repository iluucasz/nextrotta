'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { HelpDot } from '@/components/modal-kit';

// The legal pages are on the root domain; the company works on its own subdomain.
function privacyUrl() {
  if (typeof window === 'undefined') return '/privacidade#ia';
  const { protocol, host } = window.location;
  return `${protocol}//${host.split('.').slice(1).join('.')}/privacidade#ia`;
}

/**
 * The assistant sends the questions, and the data it consults to answer them, to the AI provider (outside Brazil).
 * The company agrees to that once; the acceptance is recorded with the version, the person and the moment.
 */
export function AiConsent({ reason, onAccepted }: { reason: string | null; onAccepted: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/organization/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: ['ai_transfer'] }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível registrar o aceite.');
      onAccepted();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível registrar o aceite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-notice">
      <p>
        {reason}{' '}
        <HelpDot
          label="Envio de dados ao provedor de IA"
          text="Para responder, o assistente envia a sua pergunta e os dados da empresa que ele consulta (técnicos, serviços, folha etc.) ao provedor de IA, que fica fora do Brasil. A NextRotta não usa esses dados para treinar modelos. Os detalhes estão na política de privacidade."
        />
      </p>
      <p>
        <a href={privacyUrl()} target="_blank" rel="noopener noreferrer">
          Ler como os dados são tratados
        </a>
      </p>
      <button type="button" className="ai-notice-button" onClick={() => void accept()} disabled={busy}>
        {busy ? <Loader2 size={14} className="animate-spin" /> : null} Concordar e usar o assistente
      </button>
      {error ? <p role="alert">{error}</p> : null}
    </div>
  );
}
