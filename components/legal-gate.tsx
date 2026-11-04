'use client';

import { useEffect, useState } from 'react';
import { ExternalLink, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { cn } from '@/lib/utils';

type LegalDocumentInfo = { key: string; title: string; version: string; url: string; accepted: boolean };

// The answer is kept for the session: the menu is rebuilt on every page, and the question is asked once.
let cleared = false;

/**
 * The company's agreement with the platform (terms, privacy policy, data processing agreement). When the text changes, the
 * admin sees this window until they accept; the acceptance is recorded with the version, the moment and the origin. Only the
 * company's admin is asked: not the technicians, not the owner working inside the account, not a preview.
 */
export function LegalGate({ enabled, onResolved }: { enabled: boolean; onResolved?: () => void }) {
  const [documents, setDocuments] = useState<LegalDocumentInfo[]>([]);
  const [pending, setPending] = useState<string[]>([]);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    if (cleared) {
      onResolved?.();
      return;
    }
    let active = true;
    fetch('/api/organization/legal', { cache: 'no-store' })
      .then(async (response) => {
        if (!response.ok) return onResolved?.();
        const data = await response.json();
        if (!active) return;
        setDocuments(data.documents ?? []);
        setPending(data.pending ?? []);
        if (!(data.pending ?? []).length) {
          cleared = true;
          onResolved?.();
        }
      })
      .catch(() => onResolved?.());
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  if (!enabled || !pending.length) return null;
  const list = documents.filter((document) => pending.includes(document.key));
  const version = list[0]?.version ?? '';

  async function accept() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/organization/legal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ documents: pending }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível registrar o aceite.');
      cleared = true;
      setPending([]);
      onResolved?.();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível registrar o aceite.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-lg" onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()} showCloseButton={false}>
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={cn(MODAL_TITLE_CLASS, 'flex items-center gap-2')}>
            <ShieldCheck className="h-5 w-5 text-primary" />
            Antes de continuar
          </DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
            Para usar o NextRotta, a empresa precisa concordar com {list.length === 1 ? 'o documento abaixo' : 'os documentos abaixo'}. Eles valem para todos os usuários da sua empresa.
          </DialogDescription>
        </DialogHeader>
        <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
          <ul className="divide-y divide-border rounded-xl border border-border">
            {list.map((document) => (
              <li key={document.key} className="flex items-center justify-between gap-3 px-4 py-3 text-sm">
                <span className="font-medium">{document.title}</span>
                <a href={document.url} target="_blank" rel="noopener noreferrer" className="inline-flex shrink-0 items-center gap-1 font-medium text-primary hover:underline">
                  Ler
                  <ExternalLink className="h-3.5 w-3.5" />
                </a>
              </li>
            ))}
          </ul>
          <label className="flex cursor-pointer items-start gap-3 text-sm">
            <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} className="mt-1 h-4 w-4 accent-[var(--primary)]" />
            <span>Li e concordo, em nome da empresa, com {list.length === 1 ? 'o documento' : 'os documentos'} (versão {version}).</span>
          </label>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
        </div>
        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'sm:justify-end')}>
          <Button type="button" onClick={() => void accept()} disabled={!agree || busy}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Concordar e continuar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
