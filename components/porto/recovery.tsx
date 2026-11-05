'use client';

import Link from 'next/link';
import { LifeBuoy, LoaderCircle, RotateCw, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { RecoveryView } from './use-recovery';

/**
 * The import that failed and is being redone (a spinner and what is running), or did not work again (the way to try
 * again and the way to Suporte). Nothing shows when there is nothing to recover.
 */
export function Recovery({ view, onRetry }: { view: RecoveryView; onRetry: () => void }) {
  if (view.state === 'none') return null;

  if (view.state === 'running') {
    return (
      <section className="po-recovery running" role="status" aria-live="polite" aria-label="Recuperando a importação">
        <span className="po-recovery-icon" aria-hidden="true">
          <LoaderCircle size={22} className="mg-spin" />
        </span>
        <div className="po-recovery-text">
          <strong>Recuperando a importação</strong>
          <p>Rodando agora {view.label}, por causa da falha. Leva alguns minutos; pode sair desta tela, o robô continua.</p>
        </div>
      </section>
    );
  }

  return (
    <section className="po-recovery failed" role="alert">
      <span className="po-recovery-icon" aria-hidden="true">
        <XCircle size={22} />
      </span>
      <div className="po-recovery-text">
        <strong>{view.retried ? 'Não deu para recuperar a importação' : 'A importação falhou'}</strong>
        <p>{view.message}</p>
      </div>
      <div className="po-recovery-actions">
        <Button type="button" size="sm" onClick={onRetry}>
          <RotateCw className="h-4 w-4" />
          Tentar novamente
        </Button>
        {view.support || view.retried ? (
          <Button type="button" size="sm" variant="outline" asChild>
            <Link href="/admin/suporte">
              <LifeBuoy className="h-4 w-4" />
              Abrir chamado
            </Link>
          </Button>
        ) : null}
      </div>
    </section>
  );
}
