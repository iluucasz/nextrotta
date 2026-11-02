'use client';

import { useState } from 'react';
import { Download, Loader2, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { HelpDot, MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { cn } from '@/lib/utils';

/**
 * Answers a technician who asks about their personal data (LGPD): a copy of what is kept, and anonymization. The company is
 * the one who decides and answers; anonymization removes who the person is and keeps the figures it must retain.
 */
export function TechnicianPrivacyDialog({ technician, onClose, onChanged }: { technician: { id: string; name: string }; onClose: () => void; onChanged: () => void }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function anonymize() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/technicians/${technician.id}/privacy`, { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível anonimizar.');
      setDone(true);
      setConfirming(false);
      onChanged();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível anonimizar.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={cn(MODAL_TITLE_CLASS, 'flex items-center gap-2')}>
            <ShieldCheck className="h-5 w-5 text-primary" />
            Dados pessoais
          </DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>{technician.name}</DialogDescription>
        </DialogHeader>
        <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
          {done ? (
            <ModalNotice tone="success">Cadastro anonimizado. O acesso desta pessoa foi encerrado.</ModalNotice>
          ) : confirming ? (
            <ModalNotice tone="warning">
              O nome, o contato, o QRA e o acesso serão removidos e não voltam (só restaurando uma cópia de segurança). As horas, os serviços e a folha continuam, ligados a um cadastro anônimo. Confirma?
            </ModalNotice>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="text-sm font-medium">Baixar uma cópia dos dados</span>
                <Button asChild variant="outline" size="sm">
                  <a href={`/api/technicians/${technician.id}/privacy`}>
                    <Download className="h-4 w-4" />
                    Baixar
                  </a>
                </Button>
              </div>
              <div className="flex items-center justify-between gap-3 rounded-xl border border-border p-3">
                <span className="flex items-center gap-2 text-sm font-medium">
                  Anonimizar o cadastro
                  <HelpDot label="Anonimizar" text="Use quando a pessoa pedir para ser esquecida. Removemos quem ela é (nome, e-mail, telefone, QRA e acesso) e guardamos os números que a empresa precisa manter por lei, sem identificar ninguém." />
                </span>
                <Button variant="outline" size="sm" onClick={() => setConfirming(true)}>
                  Anonimizar
                </Button>
              </div>
            </div>
          )}
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
        </div>
        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'sm:justify-end')}>
          {confirming ? (
            <>
              <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
                Voltar
              </Button>
              <Button variant="destructive" onClick={() => void anonymize()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Anonimizar agora
              </Button>
            </>
          ) : (
            <Button variant="outline" onClick={onClose}>
              Fechar
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
