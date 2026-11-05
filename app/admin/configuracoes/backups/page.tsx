'use client';

import { useCallback, useEffect, useState } from 'react';
import { CalendarClock, CheckCircle2, DatabaseBackup, Download, FileSpreadsheet, HardDrive, Loader2, RotateCcw, ShieldCheck, TriangleAlert, Undo2 } from 'lucide-react';
import { LoadingShell } from '@/components/page-skeleton';
import { Panel } from '@/components/management-ui';
import { Frame } from '@/components/settings/kit';
import '@/components/settings/settings.css';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { useAppSession } from '@/hooks/use-app-session';
import { BACKUP_KIND_LABELS, type BackupKind } from '@/lib/backup/tables';
import { cn } from '@/lib/utils';

type Backup = { id: string; kind: BackupKind; status: string; createdAt: string; sizeBytes: number; rowCounts: Record<string, number>; restoredAt: string | null };
type LastRestore = { backupCreatedAt: string; restoredAt: string; safetyBackupId: string };
type Overview = { configured: boolean; retentionDays: number | null; nextBackupAt: string; backups: Backup[]; lastRestore: LastRestore | null };
type Preview = { daysBack: number; tables: Array<{ table: string; label: string; inBackup: number; willArchive: number }> };
type RestoreResult = { backupCreatedAt: string; safetyBackupId: string | null; tables: Array<{ table: string; label: string; restored: number; archived: number }> };

const timeZone = 'America/Sao_Paulo';
const dayKey = (date: Date) => new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
const clock = (date: Date) => new Intl.DateTimeFormat('pt-BR', { timeZone, hour: '2-digit', minute: '2-digit' }).format(date);

/** "hoje às 00:00", "ontem às 00:00", "28/10 às 00:00". */
function whenLabel(iso: string, now = new Date()) {
  const date = new Date(iso);
  const day = dayKey(date);
  if (day === dayKey(now)) return `hoje às ${clock(date)}`;
  if (day === dayKey(new Date(now.getTime() - 86_400_000))) return `ontem às ${clock(date)}`;
  if (day === dayKey(new Date(now.getTime() + 86_400_000))) return `amanhã às ${clock(date)}`;
  const [, month, dayOfMonth] = day.split('-');
  return `${dayOfMonth}/${month} às ${clock(date)}`;
}

const sizeLabel = (bytes: number) => (bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} MB`);
const rowsTotal = (counts: Record<string, number>) => Object.values(counts).reduce((total, value) => total + value, 0);
const number = (value: number) => value.toLocaleString('pt-BR');

export default function BackupsPage() {
  const { user, loading } = useAppSession();
  const [overview, setOverview] = useState<Overview | null>(null);
  const [error, setError] = useState('');
  const [making, setMaking] = useState(false);
  const [notice, setNotice] = useState<{ text: string; bad?: boolean } | null>(null);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [undoing, setUndoing] = useState<LastRestore | null>(null);
  const [now, setNow] = useState(() => new Date());

  const load = useCallback(async () => {
    try {
      const response = await fetch('/api/organization/backups', { cache: 'no-store' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível carregar os backups.');
      setOverview(data);
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar os backups.');
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  async function makeBackup() {
    setMaking(true);
    setNotice(null);
    try {
      const response = await fetch('/api/organization/backups', { method: 'POST' });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível fazer o backup.');
      setNotice({ text: 'Backup feito.' });
      await load();
    } catch (reason) {
      setNotice({ text: reason instanceof Error ? reason.message : 'Não foi possível fazer o backup.', bad: true });
    } finally {
      setMaking(false);
    }
  }

  if (loading || !user || (!overview && !error)) return <LoadingShell role="admin" />;

  const backups = overview?.backups.filter((backup) => backup.status === 'completed') ?? [];
  const last = backups[0];
  const totalBytes = backups.reduce((total, backup) => total + backup.sizeBytes, 0);
  const retention = overview?.retentionDays;

  const metrics = [
    { title: 'Último backup', value: last ? whenLabel(last.createdAt, now) : '—', hint: last ? `${sizeLabel(last.sizeBytes)} · ${number(rowsTotal(last.rowCounts))} registros` : 'Ainda não há', icon: DatabaseBackup },
    { title: 'Próximo backup', value: overview ? whenLabel(overview.nextBackupAt, now) : '—', hint: 'Todo dia à meia-noite', icon: CalendarClock },
    { title: 'Guardados por', value: retention === null || retention === undefined ? 'Sem limite' : `${retention} dias`, hint: 'Conforme o seu plano', icon: ShieldCheck },
    { title: 'Backups guardados', value: String(backups.length), hint: backups.length ? sizeLabel(totalBytes) : 'Nenhum ainda', icon: HardDrive },
  ];

  return (
    <Frame
      userName={user.name || user.email}
      title="Backups"
      description="Uma cópia de toda a sua empresa, todo dia à meia-noite."
      actions={
        <Button type="button" onClick={() => void makeBackup()} disabled={making || !overview?.configured}>
          {making ? <Loader2 className="h-4 w-4 animate-spin" /> : <DatabaseBackup className="h-4 w-4" />}
          {making ? 'Fazendo…' : 'Fazer backup agora'}
        </Button>
      }
    >
      {error ? (
        <div className="mg-error" role="alert">
          <div>
            <strong>Não foi possível carregar</strong>
            <p>{error}</p>
          </div>
        </div>
      ) : null}

      {overview && !overview.configured ? (
        <div className="bk-warning" role="status">
          <TriangleAlert size={18} />
          <span>Os backups ainda não estão ativos neste ambiente. Fale com o suporte do NextRotta.</span>
        </div>
      ) : null}

      {overview?.lastRestore ? (
        <div className="bk-undo" role="status">
          <Undo2 size={20} />
          <span>
            <strong>Você restaurou o backup de {whenLabel(overview.lastRestore.backupCreatedAt, now)}</strong>, {whenLabel(overview.lastRestore.restoredAt, now)}. Se não era isso, desfaça: a empresa volta para como estava antes da restauração.
          </span>
          <Button type="button" variant="outline" size="sm" onClick={() => setUndoing(overview.lastRestore)}>
            <Undo2 className="h-4 w-4" />
            Desfazer restauração
          </Button>
        </div>
      ) : null}

      {notice ? (
        <div className={cn('bk-notice', notice.bad && 'bad')} role="status">
          {notice.bad ? <TriangleAlert size={18} /> : <CheckCircle2 size={18} />}
          {notice.text}
        </div>
      ) : null}

      <div className="st-stack">
        <div className="mg-metrics bk-metrics">
          {metrics.map((metric) => (
            <article key={metric.title} className="mg-metric">
              <div className="mg-metric-top">
                <span>{metric.title}</span>
                <span className="mg-icon">
                  <metric.icon size={18} />
                </span>
              </div>
              <strong>{metric.value}</strong>
              <div className="mg-metric-bottom">
                <span>{metric.hint}</span>
              </div>
            </article>
          ))}
        </div>

        <Panel
          title="Seus backups"
          help={`Cada backup guarda a empresa inteira como estava naquele momento, e você pode baixá-lo em planilha. Restaurar leva técnicos, ordens de serviço, horas, escala, folhas, descontos, contas, documentos e configurações de volta para aquela data; o que foi feito depois é arquivado, nada é apagado. Antes de restaurar guardamos uma cópia de agora, para você poder desfazer. Os backups diários ficam guardados por ${retention === null || retention === undefined ? 'tempo ilimitado' : `${retention} dias`}, conforme o seu plano.`}
        >
          {backups.length ? (
            <div className="bk-table" role="table" aria-label="Backups">
              <div className="bk-row head" role="row">
                <span>Quando</span>
                <span>Tipo</span>
                <span>Tamanho</span>
                <span className="bk-hide">Registros</span>
                <span />
              </div>
              {backups.map((backup) => (
                <div key={backup.id} className="bk-row" role="row">
                  <span className="bk-when">
                    <strong>{whenLabel(backup.createdAt, now)}</strong>
                    {backup.restoredAt ? <small>Restaurado {whenLabel(backup.restoredAt, now)}</small> : null}
                  </span>
                  <span>
                    <em className={cn('bk-kind', backup.kind)}>{BACKUP_KIND_LABELS[backup.kind]}</em>
                  </span>
                  <span>{sizeLabel(backup.sizeBytes)}</span>
                  <span className="bk-hide">{number(rowsTotal(backup.rowCounts))}</span>
                  <span className="bk-actions">
                    <Button asChild variant="outline" size="sm" title="Baixar em planilha (Excel), uma aba para cada assunto">
                      <a href={`/api/organization/backups/${backup.id}/planilha`} aria-label="Baixar planilha">
                        <FileSpreadsheet className="h-4 w-4" />
                        <span className="bk-label">Planilha</span>
                      </a>
                    </Button>
                    <Button asChild variant="ghost" size="sm" title="Arquivo completo (.json.gz), para guardar ou restaurar em outro lugar">
                      <a href={`/api/organization/backups/${backup.id}`} download aria-label="Baixar arquivo completo">
                        <Download className="h-4 w-4" />
                        <span className="bk-label">Arquivo</span>
                      </a>
                    </Button>
                    <Button type="button" size="sm" onClick={() => setRestoring(backup)} aria-label="Restaurar">
                      <RotateCcw className="h-4 w-4" />
                      <span className="bk-label">Restaurar</span>
                    </Button>
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p className="st-empty">{overview?.configured ? 'O primeiro backup sai à meia-noite. Você também pode fazer um agora.' : 'Nenhum backup ainda.'}</p>
          )}
        </Panel>
      </div>

      {undoing ? (
        <UndoDialog
          restore={undoing}
          now={now}
          onClose={() => {
            setUndoing(null);
            void load();
          }}
        />
      ) : null}

      {restoring ? (
        <RestoreDialog
          backup={restoring}
          now={now}
          onClose={() => {
            setRestoring(null);
            void load();
          }}
        />
      ) : null}
    </Frame>
  );
}

/** Restoring changes a lot at once: it says from which date the company goes back, counts what changes, and asks for the word. */
function RestoreDialog({ backup, now, onClose }: { backup: Backup; now: Date; onClose: () => void }) {
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<RestoreResult | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewFailed, setPreviewFailed] = useState(false);
  const [undoing, setUndoing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/organization/backups/${backup.id}/preview`, { cache: 'no-store' })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error();
        if (!cancelled) setPreview(data.preview);
      })
      .catch(() => !cancelled && setPreviewFailed(true));
    return () => {
      cancelled = true;
    };
  }, [backup.id]);

  async function restore() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/organization/backups/${backup.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível restaurar o backup.');
      setResult(data.result);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível restaurar o backup.');
    } finally {
      setBusy(false);
    }
  }

  const when = whenLabel(backup.createdAt, now);
  const toArchive = preview?.tables.reduce((total, table) => total + table.willArchive, 0) ?? 0;

  if (undoing && result?.safetyBackupId) {
    return (
      <UndoDialog
        restore={{ backupCreatedAt: backup.createdAt, restoredAt: new Date().toISOString(), safetyBackupId: result.safetyBackupId }}
        now={now}
        onClose={() => window.location.reload()}
        afterRestore
      />
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && (result ? window.location.reload() : onClose())}>
      <DialogContent className="max-h-[calc(100dvh-1rem)] gap-0 overflow-hidden p-0 sm:max-w-lg">
        {result ? (
          <>
            <DialogHeader className={MODAL_HEADER_CLASS}>
              <DialogTitle className={MODAL_TITLE_CLASS}>Backup restaurado</DialogTitle>
              <DialogDescription className={MODAL_DESCRIPTION_CLASS}>Sua empresa voltou ao que era {when}.</DialogDescription>
            </DialogHeader>
            <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
              <ul className="bk-result">
                {result.tables
                  .filter((table) => table.restored || table.archived)
                  .map((table) => (
                    <li key={table.table}>
                      <span>{table.label}</span>
                      <span>
                        {number(table.restored)} {table.restored === 1 ? 'registro' : 'registros'}
                        {table.archived ? ` · ${number(table.archived)} feito${table.archived === 1 ? '' : 's'} depois ${table.archived === 1 ? 'foi arquivado' : 'foram arquivados'}` : ''}
                      </span>
                    </li>
                  ))}
              </ul>
              <ModalNotice tone="success">Guardamos uma cópia de como estava antes. Se não era isso que você queria, é só desfazer: tudo volta ao que era um instante atrás.</ModalNotice>
            </div>
            <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
              {result.safetyBackupId ? (
                <Button type="button" variant="outline" onClick={() => setUndoing(true)}>
                  <Undo2 className="h-4 w-4" />
                  Desfazer restauração
                </Button>
              ) : null}
              <Button type="button" onClick={() => window.location.reload()}>
                Concluir
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogHeader className={MODAL_HEADER_CLASS}>
              <DialogTitle className={MODAL_TITLE_CLASS}>Voltar a empresa para {when}?</DialogTitle>
              <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
                {preview && preview.daysBack > 0 ? `Esse backup tem ${preview.daysBack} ${preview.daysBack === 1 ? 'dia' : 'dias'}. ` : ''}Tudo o que foi feito depois disso deixa de aparecer. Nada é apagado.
              </DialogDescription>
            </DialogHeader>
            <div className={cn(MODAL_BODY_CLASS, 'space-y-4')}>
              <ModalNotice tone="warning">
                A restauração parte da data do backup: ordens de serviço, horas, folhas, contas e o resto lançados depois de {when} serão arquivados.
              </ModalNotice>

              <div className="bk-impact">
                <strong>O que muda</strong>
                {preview ? (
                  <ul className="bk-result">
                    {preview.tables
                      .filter((table) => table.inBackup || table.willArchive)
                      .map((table) => (
                        <li key={table.table}>
                          <span>{table.label}</span>
                          <span>
                            {number(table.inBackup)} {table.inBackup === 1 ? 'volta' : 'voltam'} como estavam
                            {table.willArchive ? <b className="bk-archive"> · {number(table.willArchive)} {table.willArchive === 1 ? 'será arquivado' : 'serão arquivados'}</b> : null}
                          </span>
                        </li>
                      ))}
                  </ul>
                ) : previewFailed ? (
                  <p className="bk-muted">Não conseguimos contar o que muda agora, mas a restauração funciona do mesmo jeito.</p>
                ) : (
                  <p className="bk-muted">
                    <Loader2 className="inline h-4 w-4 animate-spin" /> Contando o que muda…
                  </p>
                )}
                {preview && toArchive === 0 ? <p className="bk-muted">Nada foi lançado depois desse backup, então nada será arquivado.</p> : null}
              </div>

              <ol className="bk-steps">
                <li>Guardamos uma cópia de <b>agora</b> (“Antes de restaurar”).</li>
                <li>Voltamos os dados para {when}.</li>
                <li>
                  Não gostou? <b>Desfazer restauração</b> volta tudo para a cópia de agora.
                </li>
              </ol>

              <div className="bk-scope">
                <div>
                  <strong>Volta ao que era</strong>
                  <p>Técnicos, ordens de serviço, horas, escala, folhas, descontos, contas, documentos e configurações.</p>
                </div>
                <div>
                  <strong>Não muda</strong>
                  <p>Assinatura e cobranças, créditos de IA, usuários e senhas, WhatsApp, Porto e Venda de Peças.</p>
                </div>
              </div>

              <label className="bk-confirm">
                <span>
                  Digite <b>RESTAURAR</b> para confirmar
                </span>
                <input value={confirm} onChange={(event) => setConfirm(event.target.value)} autoComplete="off" disabled={busy} placeholder="RESTAURAR" />
              </label>
              {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
            </div>
            <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button type="button" variant="destructive" onClick={() => void restore()} disabled={busy || confirm !== 'RESTAURAR'}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
                {busy ? 'Restaurando…' : 'Restaurar'}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Undoing is restoring the copy made right before: the company goes back to how it was, and this can be undone too. */
function UndoDialog({ restore, now, onClose, afterRestore = false }: { restore: LastRestore; now: Date; onClose: () => void; afterRestore?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);

  async function undo() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/api/organization/backups/${restore.safetyBackupId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: 'RESTAURAR' }),
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) throw new Error(data?.error || 'Não foi possível desfazer a restauração.');
      setDone(true);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível desfazer a restauração.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !busy && (done ? window.location.reload() : onClose())}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>{done ? 'Restauração desfeita' : 'Desfazer a restauração?'}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>
            {done
              ? 'Sua empresa voltou a ser como estava antes de você restaurar.'
              : `A empresa volta para como estava ${afterRestore ? 'logo antes de você restaurar' : `antes da restauração de ${whenLabel(restore.restoredAt, now)}`}. O que foi restaurado depois disso é arquivado, nada é apagado.`}
          </DialogDescription>
        </DialogHeader>
        <div className={cn(MODAL_BODY_CLASS, 'space-y-3')}>
          {done ? (
            <ModalNotice tone="success">Pronto. Guardamos também uma cópia do momento anterior, se você mudar de ideia de novo.</ModalNotice>
          ) : (
            <ModalNotice tone="warning">Vale para os mesmos dados da restauração: técnicos, ordens de serviço, horas, escala, folhas, descontos, contas, documentos e configurações.</ModalNotice>
          )}
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
        </div>
        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          {done ? (
            <Button type="button" onClick={() => window.location.reload()}>
              Concluir
            </Button>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose} disabled={busy}>
                Cancelar
              </Button>
              <Button type="button" onClick={() => void undo()} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />}
                {busy ? 'Desfazendo…' : 'Desfazer restauração'}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
