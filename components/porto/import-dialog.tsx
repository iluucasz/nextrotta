'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { portoStatusIsActive, tidyPortoName } from '@/lib/porto-technician-import';
import { cn } from '@/lib/utils';

type Socorrista = { qra: string; name: string; status: string };

/**
 * Brings technicians from the Porto portal into the company: it asks the Porto who is registered there (a real login),
 * lists them and creates a technician for each one the person ticks. Whoever already has a technician with that QRA is
 * shown but cannot be picked again.
 */
export function ImportPortoDialog({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [socorristas, setSocorristas] = useState<Socorrista[]>([]);
  const [registered, setRegistered] = useState<Set<string>>(new Set());
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch('/api/porto-config/socorristas', { method: 'POST' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Não foi possível buscar os técnicos no Porto.');
        if (cancelled) return;

        const found: Socorrista[] = data.socorristas ?? [];
        const taken = new Set<string>(
          (data.technicians ?? [])
            .filter((technician: { qra?: string | null; status: string }) => technician.status === 'active' && technician.qra)
            .map((technician: { qra: string }) => String(technician.qra)),
        );
        setSocorristas(found);
        setRegistered(taken);
        // The ones who are active in the Porto and not yet here start ticked; the person unticks what they do not want.
        setPicked(new Set(found.filter((item) => !taken.has(item.qra) && portoStatusIsActive(item.status)).map((item) => item.qra)));
      } catch (reason) {
        if (!cancelled) setError(reason instanceof Error ? reason.message : 'Não foi possível buscar os técnicos no Porto.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const available = useMemo(() => socorristas.filter((item) => !registered.has(item.qra)), [socorristas, registered]);
  const allPicked = available.length > 0 && available.every((item) => picked.has(item.qra));

  function toggle(qra: string, checked: boolean) {
    setPicked((current) => {
      const next = new Set(current);
      if (checked) next.add(qra);
      else next.delete(qra);
      return next;
    });
  }

  async function save() {
    setError('');
    setSaving(true);
    try {
      const chosen = socorristas.filter((item) => picked.has(item.qra));
      const response = await fetch('/api/technicians/import-porto', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ socorristas: chosen.map(({ qra, name, status }) => ({ qra, name, status })) }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Não foi possível importar os técnicos.');

      const created = Number(data.created ?? 0);
      const skipped = Array.isArray(data.skipped) ? data.skipped.length : 0;
      onImported(
        `${created === 1 ? '1 técnico importado' : `${created} técnicos importados`}${skipped ? ` (${skipped} já existia${skipped === 1 ? '' : 'm'})` : ''}.`,
      );
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível importar os técnicos.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-2xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>Importar técnicos do Porto</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>Marque quem você quer cadastrar.</DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Entrando no Porto para ver quem está cadastrado lá…
            </div>
          ) : socorristas.length ? (
            <div className="overflow-hidden rounded-xl border border-border">
              <table className="w-full text-left text-sm">
                <thead className="bg-secondary/50 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-12 px-4 py-2.5">
                      <Checkbox
                        aria-label="Marcar todos"
                        checked={allPicked}
                        disabled={!available.length || saving}
                        onCheckedChange={(checked) => setPicked(checked ? new Set(available.map((item) => item.qra)) : new Set())}
                      />
                    </th>
                    <th className="px-4 py-2.5 font-medium">No Porto</th>
                    <th className="px-4 py-2.5 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody>
                  {socorristas.map((socorrista) => {
                    const isRegistered = registered.has(socorrista.qra);
                    return (
                      <tr key={socorrista.qra} className={cn('border-t border-border', isRegistered && 'text-muted-foreground')}>
                        <td className="px-4 py-2.5">
                          <Checkbox
                            aria-label={`Importar ${socorrista.name}`}
                            checked={!isRegistered && picked.has(socorrista.qra)}
                            disabled={isRegistered || saving}
                            onCheckedChange={(checked) => toggle(socorrista.qra, checked === true)}
                          />
                        </td>
                        <td className="px-4 py-2.5">
                          <strong className="block font-medium">{tidyPortoName(socorrista.name)}</strong>
                          <small className="text-muted-foreground">QRA {socorrista.qra}</small>
                        </td>
                        <td className="px-4 py-2.5 text-xs">
                          {isRegistered ? 'Já cadastrado' : portoStatusIsActive(socorrista.status) ? 'Ativo no Porto' : `${socorrista.status || 'Inativo'} no Porto`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : !error ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum socorrista encontrado no Porto para esta conta.</p>
          ) : null}
        </div>

        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={saving || loading || picked.size === 0}>
            {saving ? 'Importando…' : picked.size ? `Importar ${picked.size}` : 'Importar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
