'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowRight, CheckCircle2 } from 'lucide-react';
import { Fields, type FormValues } from '@/components/platform/ui';
import { REQUEST_KIND_LABELS } from '@/lib/privacy/labels';

/** The public channel for people to exercise their rights over personal data (LGPD, art. 18). */
export function PrivacyRequestPage() {
  const [values, setValues] = useState<FormValues>({ name: '', email: '', kind: 'access', organization: '', message: '', website: '' });
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setSending(true);
    setError('');
    try {
      const response = await fetch('/api/public/privacy-requests', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        setError(data?.error || 'Não foi possível enviar agora. Tente de novo.');
        return;
      }
      setSent(true);
    } catch {
      setError('Não foi possível enviar agora. Verifique sua conexão e tente de novo.');
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="nr-public-section nr-contact">
      <div>
        <p className="nr-kicker">LGPD</p>
        <h1>Privacidade e seus direitos</h1>
        <p>
          Peça acesso, correção, anonimização, eliminação ou portabilidade dos seus dados pessoais. Respondemos em até 15 dias.
        </p>
        <div className="nr-contact-links">
          <Link href="/privacidade">Política de privacidade</Link>
          <Link href="/dpa">Acordo de tratamento de dados</Link>
        </div>
      </div>
      <div className="nr-contact-form">
        {sent ? (
          <div className="nr-contact-success" role="status">
            <CheckCircle2 size={44} />
            <h2>Pedido recebido</h2>
            <p>Respondemos no e-mail informado em até 15 dias.</p>
            <Link className="nr-btn primary" href="/">
              Voltar ao início
            </Link>
          </div>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void submit();
            }}
          >
            <h2>Fazer um pedido</h2>
            <Fields
              fields={[
                { key: 'name', label: 'Seu nome', required: true },
                { key: 'email', label: 'E-mail para a resposta', type: 'email', required: true },
                {
                  key: 'kind',
                  label: 'O que você precisa',
                  type: 'select',
                  options: Object.entries(REQUEST_KIND_LABELS).map(([value, label]) => ({ value, label })),
                  required: true,
                },
                { key: 'organization', label: 'Empresa em que trabalha (se for o caso)' },
                { key: 'message', label: 'Conte o que você precisa', type: 'textarea', required: true },
              ]}
              values={values}
              setValues={setValues}
            />
            <input
              type="text"
              name="website"
              tabIndex={-1}
              autoComplete="off"
              aria-hidden="true"
              className="hidden"
              value={String(values.website)}
              onChange={(event) => setValues({ ...values, website: event.target.value })}
            />
            {error && (
              <p className="nr-error" role="alert">
                {error}
              </p>
            )}
            <button className="nr-btn primary mt-6 w-full" disabled={sending}>
              {sending ? 'Enviando…' : 'Enviar pedido'}
              <ArrowRight size={16} />
            </button>
          </form>
        )}
      </div>
    </section>
  );
}
