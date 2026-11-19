'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, Loader2, Trash2, Undo2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Alert, formatDateTime, partsApi, Spinner, useParts } from '../shared';

interface PurgeCandidate {
  id: string;
  name: string;
  barcode: string | null;
  units: number;
  blockedReason: string | null;
}

interface PurgeCheck {
  eligible: PurgeCandidate[];
  blocked: PurgeCandidate[];
  units: number;
}

/**
 * Permanent delete of one or more parts. First asks the server which ones can go (a part with sales, remittances or an inventory
 * can't: it keeps being archived), shows what will be erased for good and asks for an explicit confirmation.
 */
export function PurgeForm({ ids, onClose, onDone }: { ids: string[]; onClose: () => void; onDone: (message: string) => void }) {
  const [check, setCheck] = useState<PurgeCheck | null>(null);
  const [error, setError] = useState('');
  const [understood, setUnderstood] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    partsApi<PurgeCheck>('/api/parts/purge', { method: 'POST', json: { ids, dryRun: true } })
      .then((result) => active && setCheck(result))
      .catch((reason) => active && setError(reason instanceof Error ? reason.message : String(reason)));
    return () => {
      active = false;
    };
  }, [ids]);

  async function purge() {
    setBusy(true);
    setError('');
    try {
      const result = await partsApi<{ deleted: number; blocked: PurgeCandidate[] }>('/api/parts/purge', { method: 'POST', json: { ids } });
      onDone(
        `${result.deleted} peça${result.deleted === 1 ? '' : 's'} excluída${result.deleted === 1 ? '' : 's'} para sempre.` +
          (result.blocked.length ? ` ${result.blocked.length} não ${result.blocked.length === 1 ? 'pôde' : 'puderam'} ser excluída${result.blocked.length === 1 ? '' : 's'} (têm histórico).` : ''),
      );
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  const count = check?.eligible.length ?? 0;
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Excluir {ids.length === 1 ? 'a peça' : `${ids.length} peças`} para sempre?</DialogTitle>
        <DialogDescription>Diferente de arquivar, isto não tem volta: a peça, suas entradas de estoque e a imagem saem do sistema.</DialogDescription>
      </DialogHeader>

      {!check && !error ? <Spinner label="Conferindo o histórico…" /> : null}
      {error ? <Alert>{error}</Alert> : null}

      {check ? (
        <>
          {count ? (
            <div className="grid gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
              <p className="flex items-center gap-2 font-semibold">
                <AlertTriangle className="h-4 w-4 shrink-0" />
                {count} peça{count === 1 ? '' : 's'} {count === 1 ? 'será excluída' : 'serão excluídas'} de vez
                {check.units ? ` · ${check.units} unidade${check.units === 1 ? '' : 's'} do estoque central ${check.units === 1 ? 'sai' : 'saem'} junto` : ''}
              </p>
              <ul className="max-h-40 list-disc overflow-y-auto pl-5 text-xs">
                {check.eligible.slice(0, 50).map((part) => (
                  <li key={part.id}>
                    {part.name}
                    {part.units ? ` (${part.units} un.)` : ''}
                  </li>
                ))}
              </ul>
              {check.eligible.length > 50 ? <p className="text-xs">…e mais {check.eligible.length - 50}.</p> : null}
            </div>
          ) : (
            <Alert tone="warning">Nenhuma destas peças pode ser excluída: todas já têm histórico. Elas continuam no catálogo e podem ser arquivadas.</Alert>
          )}

          {check.blocked.length ? (
            <div className="grid gap-1 rounded-xl border p-3 text-sm">
              <p className="font-medium">
                {check.blocked.length} não {check.blocked.length === 1 ? 'pode' : 'podem'} ser excluída{check.blocked.length === 1 ? '' : 's'} e {check.blocked.length === 1 ? 'fica' : 'ficam'} como {check.blocked.length === 1 ? 'está' : 'estão'}
              </p>
              <ul className="max-h-32 list-disc overflow-y-auto pl-5 text-xs text-muted-foreground">
                {check.blocked.slice(0, 50).map((part) => (
                  <li key={part.id}>
                    {part.name} — {part.blockedReason}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {count ? (
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1" checked={understood} onChange={(event) => setUnderstood(event.target.checked)} />
              Entendo que isto não pode ser desfeito.
            </label>
          ) : null}
        </>
      ) : null}

      <DialogFooter className="gap-2 sm:gap-2">
        <Button variant="outline" size="lg" onClick={onClose} disabled={busy}>
          {count ? 'Voltar' : 'Fechar'}
        </Button>
        {count ? (
          <Button variant="destructive" size="lg" onClick={purge} disabled={busy || !understood}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            Excluir {count} para sempre
          </Button>
        ) : null}
      </DialogFooter>
    </div>
  );
}

interface PartImport {
  id: string;
  createdAt: string;
  createdByName: string | null;
  created: number;
  updated: number;
  units: number;
  undoneAt: string | null;
}

/** The latest spreadsheet imports, each with a button that takes back everything it did. */
export function ImportHistory({ onUndone }: { onUndone: (message: string) => void }) {
  const { data, error, loading } = useParts<{ imports: PartImport[] }>('/api/parts/import');
  const [confirming, setConfirming] = useState<PartImport | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');

  async function undo(entry: PartImport) {
    setBusy(true);
    setActionError('');
    try {
      const { result } = await partsApi<{ result: { erased: number; restored: number } }>(`/api/parts/import/${entry.id}`, { method: 'POST' });
      onUndone(`Importação desfeita: ${result.erased} peça(s) nova(s) excluída(s) e ${result.restored} atualizada(s) devolvida(s) ao que eram.`);
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  if (loading && !data) return null;
  const imports = data?.imports ?? [];
  if (!imports.length && !error) return null;
  const latest = imports.find((entry) => !entry.undoneAt)?.id;

  return (
    <section className="grid gap-2 border-t pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Importações anteriores</h3>
      {error ? <Alert>{error}</Alert> : null}
      {actionError ? <Alert>{actionError}</Alert> : null}
      <ul className="grid gap-2">
        {imports.slice(0, 5).map((entry) => (
          <li key={entry.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2.5 text-sm">
            <div className="min-w-0">
              <p className="font-medium">
                {formatDateTime(entry.createdAt)}
                {entry.id === latest ? <span className="ml-2 text-xs font-normal text-muted-foreground">mais recente</span> : null}
              </p>
              <p className="text-xs text-muted-foreground">
                {entry.created} nova(s) · {entry.updated} atualizada(s) · {entry.units} un. no estoque{entry.createdByName ? ` · ${entry.createdByName}` : ''}
              </p>
            </div>
            {entry.undoneAt ? (
              <span className="text-xs text-muted-foreground">Desfeita em {formatDateTime(entry.undoneAt)}</span>
            ) : (
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(entry)} disabled={busy}>
                <Undo2 className="h-4 w-4" />
                Desfazer
              </Button>
            )}
          </li>
        ))}
      </ul>

      {confirming ? (
        <div className="grid gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-950">
          <p className="font-semibold">Desfazer a importação de {formatDateTime(confirming.createdAt)}?</p>
          <ul className="list-disc pl-5 text-xs">
            <li>
              As {confirming.created} peça(s) criada(s) por ela são <strong>excluídas para sempre</strong>, com as entradas de estoque.
            </li>
            <li>As {confirming.updated} peça(s) atualizadas voltam aos dados de antes.</li>
            <li>As {confirming.units} unidade(s) que ela colocou no estoque central saem.</li>
          </ul>
          <p className="text-xs">Se alguma peça criada já teve venda, remessa ou inventário, nada é alterado e o sistema avisa qual.</p>
          <div className="grid grid-cols-2 gap-2">
            <Button type="button" variant="outline" onClick={() => setConfirming(null)} disabled={busy}>
              Voltar
            </Button>
            <Button type="button" variant="destructive" onClick={() => undo(confirming)} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Desfazer importação
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}
