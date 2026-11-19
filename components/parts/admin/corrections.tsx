'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, inputClass } from '../shared';

/**
 * A confirmation window that asks for the reason, used by every "desfazer" and "corrigir" of Venda de Peças: the reason goes
 * to the history and to the audit. `onConfirm` throws to show its message here; the caller closes the window when it succeeds.
 */
export function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  tone = 'danger',
  children,
  canConfirm = true,
  onClose,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description?: string;
  confirmLabel: string;
  tone?: 'danger' | 'primary';
  /** Extra fields shown above the reason (a corrected quantity, for example). */
  children?: React.ReactNode;
  canConfirm?: boolean;
  onClose: () => void;
  onConfirm: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setReason('');
      setError('');
      setBusy(false);
    }
  }, [open]);

  async function confirm() {
    setBusy(true);
    setError('');
    try {
      await onConfirm(reason.trim());
    } catch (reasonError) {
      setError(reasonError instanceof Error ? reasonError.message : String(reasonError));
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(value) => !value && !busy && onClose()}>
      <DialogContent className="grid-cols-[minmax(0,1fr)] p-4 sm:max-w-md sm:p-6">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description ? <DialogDescription>{description}</DialogDescription> : null}
        </DialogHeader>
        {children}
        <label className="grid gap-1.5 text-sm">
          <span className="font-medium">Motivo</span>
          <input className={inputClass('h-11 text-base sm:text-sm')} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="Ex.: lancei a quantidade errada" maxLength={300} />
        </label>
        {error ? <Alert>{error}</Alert> : null}
        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="outline" size="lg" onClick={onClose} disabled={busy}>
            Voltar
          </Button>
          <Button variant={tone === 'danger' ? 'destructive' : 'default'} size="lg" onClick={confirm} disabled={busy || !reason.trim() || !canConfirm}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
