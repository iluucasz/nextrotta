'use client';

import { useEffect, useMemo, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { suggestTechnician } from '@/lib/porto-status';
import { cn } from '@/lib/utils';
import type { FullTechnician } from './use-porto';

type Socorrista = { qra: string; name: string; status: string };

const selectClass = 'h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/20';

async function patchTechnician(technician: FullTechnician, change: { qra: string | null; porto_name_hint: string | null }) {
  const response = await fetch(`/api/technicians?id=${technician.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      qra: change.qra,
      porto_name_hint: change.porto_name_hint,
      name: technician.name,
      email: technician.email,
      commission_percentage: technician.commission_percentage,
      base_salary: technician.base_salary,
      va_allowance: technician.va_allowance,
      vr_allowance: technician.vr_allowance,
      status: technician.status,
    }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error || `Não foi possível salvar o vínculo de ${technician.name}.`);
  }
}

/**
 * Links each technician of the company to the QRA the Porto knows them by. It asks the Porto who is registered there
 * (a real login), proposes the obvious ones by name and lets the person confirm. The robot finds a technician's hours
 * by this QRA: without it, nothing of theirs is imported.
 */
export function MatchDialog({ onClose, onSaved }: { onClose: () => void; onSaved: (message: string) => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [socorristas, setSocorristas] = useState<Socorrista[]>([]);
  const [technicians, setTechnicians] = useState<FullTechnician[]>([]);
  const [selection, setSelection] = useState<Record<string, string>>({});
  const [suggested, setSuggested] = useState<Set<string>>(new Set());
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
        const own: FullTechnician[] = (data.technicians ?? []).filter((technician: FullTechnician) => technician.status === 'active');
        const initial: Record<string, string> = {};
        const guesses = new Set<string>();
        for (const socorrista of found) {
          const linked = own.find((technician) => technician.qra === socorrista.qra);
          if (linked) {
            initial[socorrista.qra] = linked.id;
            continue;
          }
          // No QRA yet: an unambiguous name match is proposed (and marked, so the person confirms it).
          const free = own.filter((technician) => !String(technician.qra ?? '').trim() && !Object.values(initial).includes(technician.id));
          const guess = suggestTechnician(socorrista.name, free);
          initial[socorrista.qra] = guess?.id ?? '';
          if (guess) guesses.add(socorrista.qra);
        }
        setSocorristas(found);
        setTechnicians(own);
        setSelection(initial);
        setSuggested(guesses);
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

  const chosen = useMemo(() => Object.values(selection).filter(Boolean), [selection]);
  const duplicate = chosen.find((id, index) => chosen.indexOf(id) !== index);
  const stillWithout = technicians.filter((technician) => !chosen.includes(technician.id) && !String(technician.qra ?? '').trim());

  async function save() {
    setError('');
    if (duplicate) {
      const name = technicians.find((technician) => technician.id === duplicate)?.name ?? 'Um técnico';
      return setError(`${name} está escolhido para mais de um QRA. Corrija antes de salvar.`);
    }

    setSaving(true);
    try {
      // What each technician should end up with. A QRA the Porto lists is released when nobody is chosen for it; one it
      // does not list is left alone unless the technician is chosen for another.
      const portoQras = new Set(socorristas.map((socorrista) => socorrista.qra));
      const wanted = new Map<string, Socorrista>();
      for (const socorrista of socorristas) {
        const id = selection[socorrista.qra];
        if (id) wanted.set(id, socorrista);
      }

      const changes = technicians
        .map((technician) => {
          const target = wanted.get(technician.id);
          const qra = target ? target.qra : portoQras.has(String(technician.qra)) ? null : (technician.qra ?? null);
          return { technician, qra, name: target?.name ?? technician.porto_name_hint };
        })
        .filter((change) => (change.technician.qra ?? null) !== change.qra);

      // Releases first: two technicians never hold the same QRA, even for a moment (a swap would break otherwise).
      const ordered = [...changes.filter((change) => change.qra === null), ...changes.filter((change) => change.qra !== null)];
      for (const change of ordered) await patchTechnician(change.technician, { qra: change.qra, porto_name_hint: change.name ?? null });
      const saved = ordered.length;
      onSaved(saved ? 'Vínculos salvos.' : 'Nada mudou.');
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>Vincular técnicos ao Porto</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>Escolha quem é cada socorrista do Porto.</DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}

          {loading ? (
            <div className="flex flex-col items-center gap-3 py-12 text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
              Entrando no Porto para ver quem está cadastrado lá…
            </div>
          ) : socorristas.length ? (
            <>
              {suggested.size ? (
                <p className="flex items-center gap-2 rounded-lg bg-secondary/40 px-3 py-2 text-sm text-muted-foreground">
                  <Sparkles className="h-4 w-4 text-primary" />
                  {suggested.size === 1 ? 'Sugerimos 1 vínculo' : `Sugerimos ${suggested.size} vínculos`} pelo nome. Confira antes de salvar.
                </p>
              ) : null}

              <div className="overflow-hidden rounded-xl border border-border">
                <table className="w-full text-left text-sm">
                  <thead className="bg-secondary/50 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-4 py-2.5 font-medium">No Porto</th>
                      <th className="px-4 py-2.5 font-medium">Seu técnico</th>
                    </tr>
                  </thead>
                  <tbody>
                    {socorristas.map((socorrista) => (
                      <tr key={socorrista.qra} className="border-t border-border">
                        <td className="px-4 py-2.5">
                          <strong className="block font-medium">{socorrista.name}</strong>
                          <small className="text-muted-foreground">
                            QRA {socorrista.qra}
                            {socorrista.status ? ` · ${socorrista.status}` : ''}
                          </small>
                        </td>
                        <td className="px-4 py-2.5">
                          <select
                            aria-label={`Técnico para ${socorrista.name}`}
                            className={selectClass}
                            value={selection[socorrista.qra] ?? ''}
                            onChange={(event) => {
                              setSelection((current) => ({ ...current, [socorrista.qra]: event.target.value }));
                              setSuggested((current) => {
                                const next = new Set(current);
                                next.delete(socorrista.qra);
                                return next;
                              });
                            }}
                          >
                            <option value="">Nenhum (não importar)</option>
                            {technicians.map((technician) => (
                              <option key={technician.id} value={technician.id}>
                                {technician.name}
                                {technician.qra && technician.qra !== socorrista.qra ? ` (hoje com o QRA ${technician.qra})` : ''}
                              </option>
                            ))}
                          </select>
                          {suggested.has(socorrista.qra) ? <small className="mt-1 block text-xs text-primary">Sugerido pelo nome</small> : null}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {stillWithout.length ? (
                <p className="text-sm text-muted-foreground">
                  Ainda sem QRA depois disso: <strong className="text-foreground">{stillWithout.map((technician) => technician.name).join(', ')}</strong>. O robô não importa nada deles.
                </p>
              ) : (
                <p className="text-sm text-emerald-700">Todos os seus técnicos ativos ficam vinculados.</p>
              )}
            </>
          ) : !error ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Nenhum socorrista encontrado no Porto para esta conta.</p>
          ) : null}
        </div>

        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={save} disabled={saving || loading || !socorristas.length}>
            {saving ? 'Salvando…' : 'Salvar vínculos'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
