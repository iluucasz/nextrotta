'use client';

import { useMemo, useRef, useState } from 'react';
import { Download, FileSpreadsheet } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS, ModalNotice } from '@/components/modal-kit';
import { parseImportRows, type ImportRow } from '@/lib/expenses-import';
import { formatCurrency } from '@/lib/formatters';
import { cn } from '@/lib/utils';
import type { ExpensesApi } from './use-expenses';

const COLUMNS = ['Tipo', 'Descrição', 'Fornecedor', 'Categoria', 'Valor', 'Vencimento', 'Competência', 'Status', 'Valor pago', 'Data da baixa', 'Forma de pagamento', 'Observações'];

/** Brings in a spreadsheet of bills: shows what will be imported and what is wrong, line by line, before anything is saved. */
export function ImportDialog({ api, onClose, onDone }: { api: ExpensesApi; onClose: () => void; onDone: (message: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const valid = useMemo(() => rows.filter((row) => !row.problem), [rows]);
  const invalid = rows.length - valid.length;

  async function downloadTemplate() {
    const XLSX = await import('xlsx');
    const example = { Tipo: 'A pagar', Descrição: 'Aluguel da base', Fornecedor: 'Imobiliária Central', Categoria: 'Aluguel', Valor: 1500, Vencimento: '10/11/2026', Competência: '11/2026', Status: 'Pendente', 'Valor pago': '', 'Data da baixa': '', 'Forma de pagamento': 'Boleto', Observações: 'Exemplo — pode apagar esta linha' };
    const bills = XLSX.utils.json_to_sheet([example], { header: COLUMNS });
    const help = XLSX.utils.aoa_to_sheet([
      ['Como preencher'],
      [''],
      ['Tipo', 'A pagar ou A receber.'],
      ['Descrição', 'Obrigatória.'],
      ['Valor', 'Maior que zero. Ex.: 1500 ou 1.500,50.'],
      ['Vencimento', 'Ex.: 10/11/2026 ou 2026-11-10.'],
      ['Competência', 'Opcional. Se vazia, é o mês do vencimento (11/2026).'],
      ['Status', 'Pendente (padrão) ou Paga/Recebida.'],
      ['Valor pago e Data da baixa', 'Opcionais: para contas já pagas, no todo ou em parte.'],
      ['Forma de pagamento', 'Pix, Boleto, Transferência, Cartão, Débito automático, Dinheiro.'],
    ]);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, bills, 'Contas');
    XLSX.utils.book_append_sheet(workbook, help, 'Instruções');
    XLSX.writeFile(workbook, 'modelo-de-contas.xlsx');
  }

  async function readFile(file: File) {
    setError('');
    setFileName(file.name);
    try {
      const XLSX = await import('xlsx');
      const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
      // The sheet with the most rows is the one with the bills.
      let best: Record<string, unknown>[] = [];
      for (const name of workbook.SheetNames) {
        const parsed = XLSX.utils.sheet_to_json<Record<string, unknown>>(workbook.Sheets[name], { defval: '', raw: true });
        if (parsed.length > best.length) best = parsed;
      }
      const parsed = parseImportRows(best);
      setRows(parsed);
      if (!parsed.length) setError('A planilha não tem linhas para importar. Use o modelo.');
    } catch {
      setRows([]);
      setError('Não foi possível ler o arquivo. Use o modelo em XLSX, XLS ou CSV.');
    }
  }

  async function submit() {
    setSaving(true);
    setError('');
    try {
      const result = await api.importRows(valid.map((row) => ({ ...row.values, __line: row.line })));
      onDone(`${result.imported} conta(s) importada(s)${result.rejected.length ? `; ${result.rejected.length} recusada(s)` : ''}.`);
      onClose();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível importar.');
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-2rem)] sm:max-w-3xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>Importar contas de uma planilha</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>Baixe o modelo, preencha e escolha o arquivo. Você confere tudo antes de importar.</DialogDescription>
        </DialogHeader>

        <div className={cn(MODAL_BODY_CLASS, 'space-y-5')}>
          {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" variant="outline" onClick={downloadTemplate}>
              <Download className="h-4 w-4" />
              Baixar o modelo
            </Button>
            <Button type="button" onClick={() => input.current?.click()}>
              <FileSpreadsheet className="h-4 w-4" />
              {fileName ? 'Escolher outro arquivo' : 'Escolher a planilha'}
            </Button>
            <input
              ref={input}
              type="file"
              accept=".xlsx,.xls,.csv"
              className="sr-only"
              aria-label="Arquivo da planilha"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void readFile(file);
                event.target.value = '';
              }}
            />
            {fileName ? <span className="text-sm text-muted-foreground">{fileName}</span> : null}
          </div>

          {rows.length ? (
            <>
              <p className="text-sm">
                <strong>{valid.length}</strong> conta(s) prontas para importar{invalid ? <>; <strong className="text-rose-700">{invalid}</strong> com problema (ficam de fora).</> : '.'}
              </p>
              <div className="max-h-72 overflow-auto rounded-xl border border-border">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-secondary text-left text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2">Linha</th>
                      <th className="px-3 py-2">Descrição</th>
                      <th className="px-3 py-2">Vencimento</th>
                      <th className="px-3 py-2 text-right">Valor</th>
                      <th className="px-3 py-2">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 200).map((row) => (
                      <tr key={row.line} className="border-t border-border">
                        <td className="px-3 py-2 text-muted-foreground">{row.line}</td>
                        <td className="px-3 py-2">
                          {String(row.values.description ?? '') || '—'}
                          <small className="block text-muted-foreground">{row.values.type === 'receivable' ? 'A receber' : row.values.type === 'payable' ? 'A pagar' : ''}</small>
                        </td>
                        <td className="px-3 py-2">{String(row.values.due_date ?? '')}</td>
                        <td className="px-3 py-2 text-right tabular-nums">{Number(row.values.amount) > 0 ? formatCurrency(Number(row.values.amount)) : '—'}</td>
                        <td className={cn('px-3 py-2', row.problem ? 'text-rose-700' : 'text-emerald-700')}>{row.problem ?? 'Pronta'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 200 ? <p className="text-xs text-muted-foreground">Mostrando as 200 primeiras linhas; todas serão importadas.</p> : null}
            </>
          ) : null}
        </div>

        <DialogFooter className={cn(MODAL_FOOTER_CLASS, 'flex-col-reverse sm:flex-row sm:justify-end')}>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={!valid.length || saving}>
            {saving ? 'Importando...' : `Importar ${valid.length || ''} conta(s)`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
