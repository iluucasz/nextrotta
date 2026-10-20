'use client';

import { useEffect, useState } from 'react';
import { Download, LogOut, ShieldCheck } from 'lucide-react';
import { BrandLogo } from '@/components/brand-logo';
import { Button } from '@/components/ui/button';

type Access = {
  name: string;
  status: string;
  since: string | null;
  readOnlyUntil: string | null;
  support: { whatsapp: string | null; email: string | null };
  isAdmin: boolean;
};

const longDate = (value: string | null) =>
  value ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'long' }).format(new Date(value)) : '—';

/**
 * Where a suspended/canceled organization lands once its read-only period is over: nothing was
 * deleted, and the admin can still download everything.
 */
export default function ClosedAccessPage() {
  const [access, setAccess] = useState<Access | null>(null);
  const [error, setError] = useState('');
  const [leaving, setLeaving] = useState(false);
  const [contactUrl, setContactUrl] = useState('/login');

  useEffect(() => {
    // The marketing site lives on the root domain (this page is on the organization's subdomain).
    setContactUrl(`${window.location.protocol}//${window.location.host.split('.').slice(1).join('.')}/contato`);
    fetch('/api/organization/access', { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar.');
        setAccess(data);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.'));
  }, []);

  async function logout() {
    setLeaving(true);
    await fetch('/api/auth/logout', { method: 'POST' }).catch(() => null);
    window.location.assign('/login');
  }

  return (
    <main className="flex min-h-dvh items-center justify-center px-4 py-10" style={{ background: '#f6f8f6', color: '#13261e', minHeight: '100dvh' }}>
      <div className="w-full max-w-xl rounded-2xl border bg-white p-8" style={{ borderColor: '#dfe9e2', boxShadow: '0 14px 40px #12302410' }}>
        <BrandLogo className="h-12 w-auto" />
        <h1 className="mt-8 text-2xl font-semibold">Acesso encerrado</h1>
        {error ? (
          <p className="mt-3 text-sm text-rose-700">{error}</p>
        ) : !access ? (
          <p className="mt-3 text-sm text-muted-foreground">Carregando…</p>
        ) : (
          <>
            <p className="mt-3 leading-relaxed" style={{ fontSize: 15, color: '#425a50' }}>
              O acesso de <strong>{access.name}</strong> ao NextRotta foi {access.status === 'canceled' ? 'cancelado' : 'suspenso'} em{' '}
              {longDate(access.since)}, e o prazo para consultar o sistema terminou em {longDate(access.readOnlyUntil)}.
            </p>
            <div className="mt-5 flex items-start gap-3 rounded-xl p-4 text-sm" style={{ background: '#f1f8f3', color: '#2f5a46' }}>
              <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0" />
              <span>Nenhum dado foi apagado. Para voltar a usar o sistema, fale com o suporte do NextRotta.</span>
            </div>
            {access.isAdmin ? (
              <div className="mt-6">
                <Button asChild size="lg" className="w-full text-white hover:opacity-90" style={{ background: '#1f9d74' }}>
                  <a href="/api/organization/export">
                    <Download className="h-5 w-5" />
                    Baixar todos os dados da empresa
                  </a>
                </Button>
                <p className="mt-2 text-xs text-muted-foreground">
                  Um arquivo com técnicos, OS, horas, escala, folhas, financeiro, documentos e histórico. Senhas não entram no arquivo.
                </p>
              </div>
            ) : (
              <p className="mt-6 text-sm" style={{ color: '#425a50' }}>Para obter uma cópia dos dados, fale com o administrador da sua empresa.</p>
            )}
          </>
        )}
        <div className="mt-8 flex items-center justify-between border-t pt-5 text-sm" style={{ borderColor: '#e7ede8' }}>
          <a
            href={
              access?.support.whatsapp
                ? `https://wa.me/${access.support.whatsapp}?text=${encodeURIComponent(`Olá! Sou da ${access.name} e quero voltar a usar o NextRotta.`)}`
                : contactUrl
            }
            target={access?.support.whatsapp ? '_blank' : undefined}
            rel="noreferrer"
            className="font-medium hover:underline"
            style={{ color: '#1f9d74' }}
          >
            Falar com o suporte{access?.support.whatsapp ? ' no WhatsApp' : ''}
          </a>
          <button type="button" onClick={() => void logout()} disabled={leaving} className="inline-flex items-center gap-2 hover:opacity-80" style={{ color: '#5c7268' }}>
            <LogOut className="h-4 w-4" />
            {leaving ? 'Saindo…' : 'Sair'}
          </button>
        </div>
      </div>
    </main>
  );
}
