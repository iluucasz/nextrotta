'use client';

import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  Archive,
  Download,
  Eye,
  History,
  ImagePlus,
  Loader2,
  MoreHorizontal,
  PackagePlus,
  Pencil,
  Plus,
  ScanBarcode,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
} from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { EmptyState } from '@/components/empty-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { formatCurrency, normalizeText } from '@/lib/formatters';
import type { PartDetail } from '@/lib/parts/detail';
import { normalizeBarcode, parseAmount, SALE_STATUS_LABELS, type MovementKind, type Part } from '@/lib/parts/types';
import { Alert, BarcodeScanner, Field, formatDateTime, inputClassName, PartImage, partsApi, resizeImage, Spinner, useParts, inputClass } from '../shared';

export interface CatalogResponse {
  parts: Part[];
  stock: Array<{ partId: string; technicianId: string; quantity: number }>;
  technicians: Array<{ id: string; name: string; status: string; mercadoPago: { nickname: string | null; terminalId: string | null; liveMode: boolean | null } | null }>;
}

type Dialogs =
  | { kind: 'edit'; part: Part | null }
  | { kind: 'purchase'; part: Part | null }
  | { kind: 'adjust'; part: Part }
  | { kind: 'history'; part: Part }
  | { kind: 'detail'; part: Part }
  | { kind: 'import' }
  | null;

const money = (value: number) => value.toFixed(2).replace('.', ',');

export function CatalogTab() {
  const { data, error, loading, reload } = useParts<CatalogResponse>('/api/parts');
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const [notice, setNotice] = useState('');
  const [actionError, setActionError] = useState('');

  const parts = useMemo(() => {
    const term = normalizeText(search);
    return (data?.parts ?? []).filter(
      (part) =>
        (showInactive || part.active) &&
        (!term || normalizeText(`${part.name} ${part.barcode ?? ''} ${part.sku ?? ''} ${part.brand ?? ''} ${part.category ?? ''}`).includes(term)),
    );
  }, [data, search, showInactive]);

  async function archive(part: Part) {
    if (!window.confirm(`Arquivar "${part.name}"? Ela some do catálogo (o histórico fica guardado).`)) return;
    setActionError('');
    try {
      await partsApi(`/api/parts/${part.id}`, { method: 'DELETE' });
      setNotice(`"${part.name}" arquivada.`);
      reload();
    } catch (reason) {
      setActionError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  function done(message: string) {
    setDialog(null);
    setNotice(message);
    setActionError('');
    reload();
  }

  return (
    <div className="grid gap-4">
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {error || actionError ? <Alert>{error || actionError}</Alert> : null}
      <DataPanel
        title="Catálogo e estoque central"
        description="Custo = quanto a empresa pagou. Preço de técnico = quanto o técnico deve por peça vendida. Sugerido = preço ao cliente (o técnico pode mudar)."
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'import' })}>
              <Upload className="h-4 w-4" />
              Importar planilha
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDialog({ kind: 'purchase', part: null })}>
              <PackagePlus className="h-4 w-4" />
              Entrada de estoque
            </Button>
            <Button size="sm" onClick={() => setDialog({ kind: 'edit', part: null })}>
              <Plus className="h-4 w-4" />
              Nova peça
            </Button>
          </div>
        }
      >
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <div className="relative min-w-56 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input className={inputClass('pl-9')} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Nome, código de barras, marca…" aria-label="Buscar" />
          </div>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
            Mostrar inativas
          </label>
        </div>
        {loading && !data ? (
          <Spinner />
        ) : !data?.parts.length ? (
          <EmptyState icon={PackagePlus} title="Nenhuma peça cadastrada" description="Cadastre as peças uma a uma ou importe uma planilha." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Peça</th>
                  <th className="py-2 pr-3 text-right font-medium">Custo</th>
                  <th className="py-2 pr-3 text-right font-medium">Técnico</th>
                  <th className="py-2 pr-3 text-right font-medium">Sugerido</th>
                  <th className="py-2 pr-3 text-right font-medium">Central</th>
                  <th className="py-2 pr-3 text-right font-medium">Com técnicos</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {parts.map((part) => {
                  const low = part.minStock !== null && part.centralStock <= part.minStock;
                  return (
                    <tr
                      key={part.id}
                      className="cursor-pointer border-b last:border-0 hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:outline-none"
                      tabIndex={0}
                      onClick={() => setDialog({ kind: 'detail', part })}
                      onKeyDown={(event) => {
                        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
                          event.preventDefault();
                          setDialog({ kind: 'detail', part });
                        }
                      }}
                    >
                      <td className="py-2 pr-3">
                        <div className="flex items-center gap-3">
                          <PartImage src={part.imageUrl} alt={part.name} className="h-10 w-10" />
                          <div className="min-w-0">
                            <p className="font-medium">
                              {part.name} {!part.active ? <StatusBadge>Inativa</StatusBadge> : null}
                            </p>
                            <p className="text-xs text-muted-foreground">{[part.barcode, part.brand, part.category].filter(Boolean).join(' · ') || 'Sem código de barras'}</p>
                          </div>
                        </div>
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(part.costPrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(part.technicianPrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{formatCurrency(part.suggestedPrice)}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">
                        {part.centralStock}
                        {low ? (
                          <span className="ml-1">
                            <StatusBadge tone="warning">repor</StatusBadge>
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 pr-3 text-right tabular-nums">{part.technicianStock}</td>
                      <td className="py-2 text-right" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" aria-label={`Ações de ${part.name}`}>
                              <MoreHorizontal className="h-4 w-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'detail', part })}>
                              <Eye className="h-4 w-4" />
                              Ver detalhes
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'edit', part })}>
                              <Pencil className="h-4 w-4" />
                              Editar
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'purchase', part })}>
                              <PackagePlus className="h-4 w-4" />
                              Entrada de estoque
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'adjust', part })}>
                              <SlidersHorizontal className="h-4 w-4" />
                              Ajustar estoque
                            </DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog({ kind: 'history', part })}>
                              <History className="h-4 w-4" />
                              Movimentações
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => archive(part)} className="text-rose-700">
                              <Archive className="h-4 w-4" />
                              Arquivar
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </DataPanel>

      <Dialog open={dialog !== null} onOpenChange={(open) => !open && setDialog(null)}>
        <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-2xl">
          {dialog?.kind === 'edit' ? <PartForm part={dialog.part} parts={data?.parts ?? []} onSaved={(part, created) => done(created ? `"${part.name}" cadastrada.` : `"${part.name}" salva.`)} /> : null}
          {dialog?.kind === 'purchase' && data ? <PurchaseForm parts={data.parts} initial={dialog.part} onSaved={() => done('Entrada registrada no estoque central.')} /> : null}
          {dialog?.kind === 'adjust' && data ? <AdjustForm part={dialog.part} technicians={data.technicians} onSaved={() => done('Estoque ajustado.')} /> : null}
          {dialog?.kind === 'history' ? <MovementHistory part={dialog.part} /> : null}
          {dialog?.kind === 'detail' ? (
            <PartDetailView part={dialog.part} onAction={(kind) => setDialog({ kind, part: dialog.part })} />
          ) : null}
          {dialog?.kind === 'import' ? <ImportForm onSaved={(message) => done(message)} /> : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------- create / edit

const fmtMoney = (value: number) => value.toFixed(2).replace('.', ',');
const fmtPercent = (value: number) => String(Math.round(value * 10) / 10).replace('.', ',');

function parsePercent(value: string) {
  const text = value.replace(/[%\s]/g, '').replace(',', '.');
  if (!text || text === '-') return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

const UNIT_OPTIONS: Array<[string, string]> = [
  ['un', 'un · unidade'],
  ['par', 'par'],
  ['kit', 'kit'],
  ['cx', 'cx · caixa'],
  ['m', 'm · metro'],
  ['kg', 'kg · quilo'],
  ['L', 'L · litro'],
];

/**
 * The three prices of a part. A price and its margin follow each other: typing the margin
 * calculates the price (and keeps doing so when the cost changes); typing the price calculates the
 * margin. Technician price = cost + margin; suggested price = technician price + margin.
 */
interface Pricing {
  cost: string;
  tech: string;
  techPercent: string;
  techAuto: boolean;
  suggested: string;
  suggestedPercent: string;
  suggestedAuto: boolean;
}

type PricingField = 'cost' | 'tech' | 'techPercent' | 'suggested' | 'suggestedPercent';

function initialPricing(part: Part | null): Pricing {
  const hasSuggested = Boolean(part && part.suggestedPrice > 0);
  return {
    cost: part ? fmtMoney(part.costPrice) : '',
    tech: part ? fmtMoney(part.technicianPrice) : '',
    techPercent: part && part.costPrice > 0 ? fmtPercent((part.technicianPrice / part.costPrice - 1) * 100) : '',
    techAuto: false,
    suggested: part && hasSuggested ? fmtMoney(part.suggestedPrice) : '',
    suggestedPercent: part && hasSuggested && part.technicianPrice > 0 ? fmtPercent((part.suggestedPrice / part.technicianPrice - 1) * 100) : '',
    suggestedAuto: false,
  };
}

function reprice(current: Pricing, field: PricingField, value: string): Pricing {
  const next: Pricing = { ...current };
  if (field === 'cost') next.cost = value;
  if (field === 'tech') Object.assign(next, { tech: value, techAuto: false });
  if (field === 'techPercent') Object.assign(next, { techPercent: value, techAuto: true });
  if (field === 'suggested') Object.assign(next, { suggested: value, suggestedAuto: false });
  if (field === 'suggestedPercent') Object.assign(next, { suggestedPercent: value, suggestedAuto: true });

  const cost = parseAmount(next.cost);
  if (field === 'techPercent' || (field === 'cost' && next.techAuto)) {
    const percent = parsePercent(next.techPercent);
    if (cost !== null && percent !== null) next.tech = fmtMoney(cost * (1 + percent / 100));
  } else if (field === 'tech' || field === 'cost') {
    const tech = parseAmount(next.tech);
    next.techPercent = cost && tech !== null ? fmtPercent((tech / cost - 1) * 100) : '';
  }

  const tech = parseAmount(next.tech);
  if (field === 'suggestedPercent' || (next.suggestedAuto && field !== 'suggested')) {
    const percent = parsePercent(next.suggestedPercent);
    if (tech !== null && percent !== null) next.suggested = fmtMoney(tech * (1 + percent / 100));
  } else {
    const suggested = parseAmount(next.suggested);
    next.suggestedPercent = tech && suggested !== null ? fmtPercent((suggested / tech - 1) * 100) : '';
  }
  return next;
}

/** Text input with a fixed prefix/suffix and right-aligned numbers; `format` runs when it loses focus. */
function AffixInput({
  value,
  onChange,
  prefix,
  suffix,
  format,
  ...rest
}: {
  value: string;
  onChange: (value: string) => void;
  prefix?: string;
  suffix?: string;
  format?: (value: string) => string;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'prefix'>) {
  return (
    <div className="relative">
      {prefix ? <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{prefix}</span> : null}
      <input
        {...rest}
        className={inputClass(`text-right tabular-nums ${prefix ? 'pl-10' : ''} ${suffix ? 'pr-8' : ''}`)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => {
          const formatted = format?.(value);
          if (formatted !== undefined && formatted !== value) onChange(formatted);
        }}
      />
      {suffix ? <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">{suffix}</span> : null}
    </div>
  );
}

const formatMoneyInput = (value: string) => {
  const amount = parseAmount(value);
  return amount === null ? value : fmtMoney(amount);
};

function FormSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="grid gap-3 border-t pt-4">
      <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function PriceRow({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <div className="grid items-center gap-x-3 gap-y-1.5 sm:grid-cols-[minmax(0,1fr)_9.5rem_7.5rem]">
      <div className="min-w-0">
        <p className="text-sm font-medium">{label}</p>
        <p className="text-xs text-muted-foreground">{hint}</p>
      </div>
      {children}
    </div>
  );
}

function PartForm({ part, parts, onSaved }: { part: Part | null; parts: Part[]; onSaved: (part: Part, created: boolean) => void }) {
  const [form, setForm] = useState({
    name: part?.name ?? '',
    barcode: part?.barcode ?? '',
    sku: part?.sku ?? '',
    category: part?.category ?? '',
    brand: part?.brand ?? '',
    unit: part?.unit ?? 'un',
    description: part?.description ?? '',
    minStock: part?.minStock === null || part?.minStock === undefined ? '' : String(part.minStock),
    active: part?.active ?? true,
  });
  const [pricing, setPricing] = useState(() => initialPricing(part));
  const [image, setImage] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(part?.imageUrl ?? null);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  const set = (key: keyof typeof form) => (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));
  const setPrice = (field: PricingField) => (value: string) => setPricing((current) => reprice(current, field, value));

  const categories = useMemo(() => Array.from(new Set(parts.map((item) => item.category).filter((value): value is string => Boolean(value)))).sort(), [parts]);
  const brands = useMemo(() => Array.from(new Set(parts.map((item) => item.brand).filter((value): value is string => Boolean(value)))).sort(), [parts]);
  const unitOptions = UNIT_OPTIONS.some(([value]) => value === form.unit) ? UNIT_OPTIONS : [...UNIT_OPTIONS, [form.unit, form.unit] as [string, string]];

  const barcode = normalizeBarcode(form.barcode);
  const barcodeOwner = barcode ? parts.find((item) => item.id !== part?.id && item.barcode === barcode) : undefined;

  const cost = parseAmount(pricing.cost) ?? 0;
  const technician = parseAmount(pricing.tech) ?? 0;
  const suggested = parseAmount(pricing.suggested) ?? 0;
  const companyGain = technician - cost;
  const technicianGain = suggested - technician;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const body = {
        ...form,
        costPrice: pricing.cost,
        technicianPrice: pricing.tech,
        suggestedPrice: pricing.suggested,
        minStock: form.minStock === '' ? null : form.minStock,
      };
      const result = part
        ? await partsApi<{ part: Part }>(`/api/parts/${part.id}`, { method: 'PATCH', json: body })
        : await partsApi<{ part: Part }>('/api/parts', { method: 'POST', json: body });
      let saved = result.part;
      if (image) {
        const data = new FormData();
        const resized = await resizeImage(image);
        data.append('file', new File([resized], 'imagem.jpg', { type: resized.type || 'image/jpeg' }));
        const uploaded = await fetch(`/api/parts/${saved.id}/image`, { method: 'POST', body: data });
        const uploadBody = await uploaded.json().catch(() => ({}));
        if (!uploaded.ok) throw new Error(`Peça salva, mas a imagem não: ${uploadBody.error ?? uploaded.status}`);
        saved = uploadBody.part;
      }
      onSaved(saved, !part);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-5">
      <DialogHeader>
        <DialogTitle>{part ? 'Editar peça' : 'Nova peça'}</DialogTitle>
        <DialogDescription>Mudar preços vale para as próximas remessas e vendas; o que já aconteceu mantém o preço da época.</DialogDescription>
      </DialogHeader>

      <div className="flex items-start gap-4">
        <div className="grid shrink-0 justify-items-center gap-1.5">
          <PartImage src={preview} alt={form.name || 'Peça'} className="h-24 w-24" />
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (!file) return;
              setImage(file);
              setPreview(URL.createObjectURL(file));
            }}
          />
          <Button type="button" variant="outline" size="sm" onClick={() => fileRef.current?.click()}>
            <ImagePlus className="h-4 w-4" />
            {preview ? 'Trocar' : 'Imagem'}
          </Button>
        </div>
        <div className="grid min-w-0 flex-1 gap-3">
          <Field label="Nome da peça">
            <input className={inputClassName} value={form.name} onChange={set('name')} required autoFocus={!part} placeholder="Ex.: Cabo de aço 3 m" />
          </Field>
          <p className="text-xs text-muted-foreground">A imagem aparece para o técnico no app de vendas.</p>
        </div>
      </div>

      <FormSection title="Identificação">
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label="Código de barras (EAN)" hint={barcodeOwner ? undefined : 'Leia com a câmera ou um leitor, ou digite.'}>
            <div className="flex gap-2">
              <input className={inputClassName} value={form.barcode} onChange={set('barcode')} inputMode="numeric" placeholder="Somente números" />
              <Button type="button" variant="outline" size="icon" className="shrink-0" onClick={() => setScanning(true)} aria-label="Ler código de barras">
                <ScanBarcode className="h-4 w-4" />
              </Button>
            </div>
            {barcodeOwner ? <span className="text-xs text-amber-700">Já usado em “{barcodeOwner.name}”. Cada código só pode ter uma peça.</span> : null}
          </Field>
          <Field label="Código interno (opcional)" hint="Sua referência, se tiver.">
            <input className={inputClassName} value={form.sku} onChange={set('sku')} />
          </Field>
          <Field label="Categoria">
            <input className={inputClassName} value={form.category} onChange={set('category')} list="part-categories" placeholder="Ex.: Hidráulica" />
            <datalist id="part-categories">
              {categories.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
          <Field label="Marca">
            <input className={inputClassName} value={form.brand} onChange={set('brand')} list="part-brands" />
            <datalist id="part-brands">
              {brands.map((value) => (
                <option key={value} value={value} />
              ))}
            </datalist>
          </Field>
        </div>
      </FormSection>

      <FormSection title="Preços">
        <div className="hidden gap-x-3 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[minmax(0,1fr)_9.5rem_7.5rem]">
          <span />
          <span className="text-right">Valor</span>
          <span className="text-right">Margem</span>
        </div>
        <PriceRow label="Custo" hint="O que a empresa pagou pela peça. O técnico nunca vê.">
          <AffixInput prefix="R$" value={pricing.cost} onChange={setPrice('cost')} format={formatMoneyInput} inputMode="decimal" placeholder="0,00" aria-label="Custo" />
          <span />
        </PriceRow>
        <PriceRow label="Preço de técnico" hint="O que o técnico deve à empresa por unidade vendida. Digite a margem e o preço é calculado.">
          <AffixInput prefix="R$" value={pricing.tech} onChange={setPrice('tech')} format={formatMoneyInput} inputMode="decimal" placeholder="0,00" required aria-label="Preço de técnico" />
          <AffixInput suffix="%" value={pricing.techPercent} onChange={setPrice('techPercent')} inputMode="decimal" placeholder="sobre o custo" aria-label="Margem do preço de técnico sobre o custo" />
        </PriceRow>
        <PriceRow label="Preço sugerido ao cliente" hint="Já vem preenchido para o técnico na venda, que pode mudar. Margem sobre o preço de técnico.">
          <AffixInput prefix="R$" value={pricing.suggested} onChange={setPrice('suggested')} format={formatMoneyInput} inputMode="decimal" placeholder="0,00" aria-label="Preço sugerido ao cliente" />
          <AffixInput suffix="%" value={pricing.suggestedPercent} onChange={setPrice('suggestedPercent')} inputMode="decimal" placeholder="sobre o técnico" aria-label="Margem do preço sugerido sobre o preço de técnico" />
        </PriceRow>

        {technician > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="rounded-lg border bg-muted/40 px-3 py-2">
              <p className="text-xs text-muted-foreground">Empresa ganha por unidade</p>
              <p className={`text-base font-semibold tabular-nums ${companyGain < 0 ? 'text-rose-700' : ''}`}>
                {formatCurrency(companyGain)}
                {cost > 0 ? <span className="ml-1.5 text-xs font-normal text-muted-foreground">{fmtPercent((companyGain / cost) * 100)}% sobre o custo</span> : null}
              </p>
            </div>
            {suggested > 0 ? (
              <div className="rounded-lg border bg-muted/40 px-3 py-2">
                <p className="text-xs text-muted-foreground">Técnico fica com, vendendo pelo sugerido</p>
                <p className={`text-base font-semibold tabular-nums ${technicianGain < 0 ? 'text-rose-700' : ''}`}>{formatCurrency(technicianGain)}</p>
              </div>
            ) : null}
          </div>
        ) : null}
        {cost > 0 && technician > 0 && technician < cost ? (
          <Alert tone="warning">O preço de técnico está abaixo do custo: a empresa perde {formatCurrency(cost - technician)} a cada unidade vendida.</Alert>
        ) : null}
        {technician > 0 && suggested > 0 && suggested < technician ? (
          <Alert tone="warning">O preço sugerido está abaixo do preço de técnico: o técnico teria prejuízo de {formatCurrency(technician - suggested)} por unidade.</Alert>
        ) : null}
      </FormSection>

      <FormSection title="Estoque e situação">
        <div className="grid items-start gap-3 sm:grid-cols-2">
          <Field label="Unidade de medida">
            <select className={inputClassName} value={form.unit} onChange={set('unit')}>
              {unitOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Estoque mínimo (central)" hint="Abaixo disso a peça aparece como “repor”. Deixe vazio para não avisar.">
            <input className={inputClass('text-right tabular-nums')} value={form.minStock} onChange={set('minStock')} inputMode="numeric" placeholder="Sem mínimo" />
          </Field>
        </div>
        <Field label="Descrição (opcional)">
          <textarea className={inputClass('min-h-16 py-2')} value={form.description} onChange={set('description')} />
        </Field>
        <label className="flex items-center justify-between gap-4 rounded-lg border px-3 py-2.5">
          <span className="grid gap-0.5">
            <span className="text-sm font-medium">Peça ativa</span>
            <span className="text-xs text-muted-foreground">Desativada, não pode ser enviada aos técnicos.</span>
          </span>
          <Switch checked={form.active} onCheckedChange={(checked) => setForm((current) => ({ ...current, active: checked }))} />
        </label>
      </FormSection>

      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {part ? 'Salvar alterações' : 'Cadastrar peça'}
        </Button>
      </DialogFooter>
      <Dialog open={scanning} onOpenChange={setScanning}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader className="sr-only">
            <DialogTitle>Ler código de barras</DialogTitle>
          </DialogHeader>
          {scanning ? (
            <BarcodeScanner
              showClose={false}
              onDetect={(code) => {
                setForm((current) => ({ ...current, barcode: normalizeBarcode(code) ?? '' }));
                setScanning(false);
              }}
              onClose={() => setScanning(false)}
            />
          ) : null}
        </DialogContent>
      </Dialog>
    </form>
  );
}

// ---------------------------------------------------------------- purchase (entrada)

interface PurchaseLine {
  partId: string;
  quantity: string;
  unitCost: string;
}

function PurchaseForm({ parts, initial, onSaved }: { parts: Part[]; initial: Part | null; onSaved: () => void }) {
  const active = parts.filter((part) => part.active);
  const [lines, setLines] = useState<PurchaseLine[]>([
    { partId: initial?.id ?? active[0]?.id ?? '', quantity: '', unitCost: initial ? money(initial.costPrice) : active[0] ? money(active[0].costPrice) : '' },
  ]);
  const [note, setNote] = useState('');
  const [updateCost, setUpdateCost] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function setLine(index: number, change: Partial<PurchaseLine>) {
    setLines((current) =>
      current.map((line, position) => {
        if (position !== index) return line;
        const next = { ...line, ...change };
        if (change.partId) next.unitCost = money(parts.find((part) => part.id === change.partId)?.costPrice ?? 0);
        return next;
      }),
    );
  }

  function onScan(code: string) {
    const part = parts.find((item) => item.barcode === normalizeBarcode(code));
    if (!part) {
      setError(`Nenhuma peça com o código ${code}. Cadastre antes.`);
      return;
    }
    setError('');
    setLines((current) => {
      const index = current.findIndex((line) => line.partId === part.id);
      if (index >= 0) return current.map((line, position) => (position === index ? { ...line, quantity: String((Number(line.quantity) || 0) + 1) } : line));
      const empty = current.findIndex((line) => !line.quantity);
      const line = { partId: part.id, quantity: '1', unitCost: money(part.costPrice) };
      return empty >= 0 ? current.map((item, position) => (position === empty ? line : item)) : [...current, line];
    });
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await partsApi('/api/parts/stock', {
        method: 'POST',
        json: {
          action: 'purchase',
          note,
          updateCost,
          items: lines.filter((line) => line.partId && line.quantity).map((line) => ({ partId: line.partId, quantity: Number(line.quantity), unitCost: parseAmount(line.unitCost) ?? '' })),
        },
      });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Entrada no estoque central</DialogTitle>
        <DialogDescription>Peças compradas pela empresa. Leia os códigos de barras ou escolha na lista.</DialogDescription>
      </DialogHeader>
      {scanning ? <BarcodeScanner continuous title="Leia cada peça (cada leitura soma 1)" onDetect={onScan} onClose={() => setScanning(false)} /> : null}
      <div className="grid gap-2">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[1fr_80px_100px_auto] items-end gap-2">
            <Field label={index === 0 ? 'Peça' : ''}>
              <select className={inputClassName} value={line.partId} onChange={(event) => setLine(index, { partId: event.target.value })}>
                {active.map((part) => (
                  <option key={part.id} value={part.id}>
                    {part.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={index === 0 ? 'Qtd.' : ''}>
              <input className={inputClassName} value={line.quantity} onChange={(event) => setLine(index, { quantity: event.target.value })} inputMode="numeric" />
            </Field>
            <Field label={index === 0 ? 'Custo un.' : ''}>
              <input className={inputClassName} value={line.unitCost} onChange={(event) => setLine(index, { unitCost: event.target.value })} inputMode="decimal" />
            </Field>
            <Button type="button" variant="ghost" size="icon" onClick={() => setLines((current) => current.filter((_, position) => position !== index))} disabled={lines.length === 1} aria-label="Remover linha">
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => setLines((current) => [...current, { partId: active[0]?.id ?? '', quantity: '', unitCost: active[0] ? money(active[0].costPrice) : '' }])}>
            <Plus className="h-4 w-4" />
            Outra peça
          </Button>
          {!scanning ? (
            <Button type="button" variant="outline" size="sm" onClick={() => setScanning(true)}>
              <ScanBarcode className="h-4 w-4" />
              Ler códigos
            </Button>
          ) : null}
        </div>
      </div>
      <Field label="Observação (nota fiscal, fornecedor…)">
        <input className={inputClassName} value={note} onChange={(event) => setNote(event.target.value)} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={updateCost} onChange={(event) => setUpdateCost(event.target.checked)} />
        Atualizar o custo da peça com o custo desta compra
      </label>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" disabled={busy || !lines.some((line) => line.partId && Number(line.quantity) > 0)}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Registrar entrada
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------- adjust

function AdjustForm({ part, technicians, onSaved }: { part: Part; technicians: CatalogResponse['technicians']; onSaved: () => void }) {
  const [technicianId, setTechnicianId] = useState('');
  const [quantity, setQuantity] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await partsApi('/api/parts/stock', { method: 'POST', json: { action: 'adjust', partId: part.id, technicianId: technicianId || null, quantity: Number(quantity), note } });
      onSaved();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Ajustar estoque — {part.name}</DialogTitle>
        <DialogDescription>Para corrigir erros de lançamento. Falta de peça com técnico se resolve no inventário (vira débito dele).</DialogDescription>
      </DialogHeader>
      <Field label="Estoque">
        <select className={inputClassName} value={technicianId} onChange={(event) => setTechnicianId(event.target.value)}>
          <option value="">Central</option>
          {technicians.map((technician) => (
            <option key={technician.id} value={technician.id}>
              {technician.name}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Quantidade" hint="Positivo entra, negativo sai. Ex.: -2">
        <input className={inputClassName} value={quantity} onChange={(event) => setQuantity(event.target.value)} inputMode="numeric" required />
      </Field>
      <Field label="Motivo">
        <input className={inputClassName} value={note} onChange={(event) => setNote(event.target.value)} required />
      </Field>
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Ajustar
        </Button>
      </DialogFooter>
    </form>
  );
}

// ---------------------------------------------------------------- history

// ---------------------------------------------------------------- detail

function DetailStat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: 'danger' | 'success' }) {
  return (
    <div className="rounded-xl border bg-card p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-xl font-semibold tabular-nums ${tone === 'danger' ? 'text-rose-700' : tone === 'success' ? 'text-emerald-700' : ''}`}>{value}</p>
      {hint ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

const SALE_STATUS_TONES = { awaiting_payment: 'warning', paid: 'success', canceled: 'neutral' } as const;

function PartDetailView({ part, onAction }: { part: Part; onAction: (kind: 'edit' | 'purchase' | 'adjust' | 'history') => void }) {
  const { data, error } = useParts<PartDetail>(`/api/parts/${part.id}`);
  const current = data?.part ?? part;
  const totals = data?.totals;
  const inStock = current.centralStock + current.technicianStock;
  const low = current.minStock !== null && current.centralStock <= current.minStock;
  const margin = current.costPrice > 0 ? ((current.technicianPrice - current.costPrice) / current.costPrice) * 100 : null;

  return (
    <div className="grid gap-5">
      <DialogHeader>
        <div className="flex items-start gap-3">
          <PartImage src={current.imageUrl} alt={current.name} className="h-16 w-16" />
          <div className="min-w-0">
            <DialogTitle className="flex flex-wrap items-center gap-2">
              {current.name}
              {!current.active ? <StatusBadge>Inativa</StatusBadge> : null}
              {low ? <StatusBadge tone="warning">repor</StatusBadge> : null}
            </DialogTitle>
            <DialogDescription>
              {[current.barcode, current.sku && `Cód. ${current.sku}`, current.brand, current.category].filter(Boolean).join(' · ') || 'Sem código de barras'}
            </DialogDescription>
          </div>
        </div>
      </DialogHeader>

      {error ? <Alert>{error}</Alert> : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <DetailStat label="Em estoque" value={`${inStock} ${current.unit}`} hint={`${current.centralStock} na empresa · ${current.technicianStock} com técnicos`} />
        <DetailStat
          label="Vendidas"
          value={totals ? `${totals.sold} ${current.unit}` : '…'}
          hint={totals ? (totals.sold ? `${totals.soldPaid} pagas · ${totals.soldAwaiting} aguardando` : 'Nenhuma venda ainda') : undefined}
        />
        <DetailStat label="Vendido aos clientes" value={totals ? formatCurrency(totals.revenue) : '…'} hint={totals?.averagePrice ? `preço médio ${formatCurrency(totals.averagePrice)}` : undefined} />
        <DetailStat
          label="Lucro da empresa"
          value={totals ? formatCurrency(totals.companyProfit) : '…'}
          tone={totals && totals.companyProfit < 0 ? 'danger' : undefined}
          hint={totals ? `técnicos ficaram com ${formatCurrency(totals.technicianProfit)}` : undefined}
        />
      </div>

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Com quem está</h3>
        {!data ? (
          <Spinner label="Carregando…" />
        ) : !data.holders.length ? (
          <p className="text-sm text-muted-foreground">Esta peça ainda não teve nenhuma movimentação.</p>
        ) : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="bg-muted/40 text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 font-medium">Onde</th>
                  <th className="px-3 py-2 text-right font-medium">Tem agora</th>
                  <th className="px-3 py-2 text-right font-medium">Recebeu</th>
                  <th className="px-3 py-2 text-right font-medium">Vendeu</th>
                  <th className="px-3 py-2 text-right font-medium">Faltas</th>
                </tr>
              </thead>
              <tbody>
                {data.holders.map((holder) => (
                  <tr key={holder.technicianId ?? 'central'} className="border-t">
                    <td className="px-3 py-2 font-medium">
                      {holder.name}
                      {!holder.active ? <span className="ml-2 text-xs font-normal text-muted-foreground">inativo</span> : null}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{holder.stock}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{holder.technicianId ? holder.received : '—'}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">{holder.technicianId ? holder.sold : '—'}</td>
                    <td className={`px-3 py-2 text-right tabular-nums ${holder.missing ? 'text-rose-700' : 'text-muted-foreground'}`}>{holder.technicianId ? holder.missing : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="grid gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Preços e histórico</h3>
        <dl className="grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {(
            [
              ['Custo', formatCurrency(current.costPrice)],
              ['Preço de técnico', `${formatCurrency(current.technicianPrice)}${margin !== null ? ` (${Math.round(margin)}% sobre o custo)` : ''}`],
              ['Preço sugerido', current.suggestedPrice > 0 ? formatCurrency(current.suggestedPrice) : '—'],
              ['Estoque mínimo (empresa)', current.minStock === null ? 'Sem mínimo' : String(current.minStock)],
              ['Comprada (entradas)', totals ? `${totals.purchased} ${current.unit}` : '…'],
              ['Vendas realizadas', totals ? String(totals.sales) : '…'],
              ['Primeira venda', totals?.firstSaleAt ? formatDateTime(totals.firstSaleAt) : '—'],
              ['Última venda', totals?.lastSaleAt ? formatDateTime(totals.lastSaleAt) : '—'],
              ['Faltas em inventário', totals ? `${totals.missing} ${current.unit}` : '…'],
            ] as Array<[string, string]>
          ).map(([label, value]) => (
            <div key={label} className="flex items-baseline justify-between gap-3 border-b py-1">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="font-medium tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      {data?.recentSales.length ? (
        <section className="grid gap-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Últimas vendas</h3>
          <ul className="divide-y rounded-lg border text-sm">
            {data.recentSales.map((sale) => (
              <li key={`${sale.id}-${sale.unitPrice}`} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
                <div className="min-w-0">
                  <p className="font-medium">
                    Venda nº {sale.number} · {sale.technicianName}
                  </p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(sale.createdAt)}</p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="tabular-nums">
                    {sale.quantity} × {formatCurrency(sale.unitPrice)}
                  </span>
                  <StatusBadge tone={SALE_STATUS_TONES[sale.status]}>{SALE_STATUS_LABELS[sale.status]}</StatusBadge>
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <DialogFooter className="gap-2 sm:justify-start">
        <Button type="button" variant="outline" size="sm" onClick={() => onAction('edit')}>
          <Pencil className="h-4 w-4" />
          Editar
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onAction('purchase')}>
          <PackagePlus className="h-4 w-4" />
          Entrada de estoque
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onAction('adjust')}>
          <SlidersHorizontal className="h-4 w-4" />
          Ajustar estoque
        </Button>
        <Button type="button" variant="outline" size="sm" onClick={() => onAction('history')}>
          <History className="h-4 w-4" />
          Movimentações
        </Button>
      </DialogFooter>
    </div>
  );
}

interface Movement {
  id: string;
  technicianName: string | null;
  quantity: number;
  kind: MovementKind;
  kindLabel: string;
  note: string | null;
  createdAt: string;
  createdByName: string | null;
}

function MovementHistory({ part }: { part: Part }) {
  const { data, error } = useParts<{ movements: Movement[] }>(`/api/parts/movements?partId=${part.id}`);
  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Movimentações — {part.name}</DialogTitle>
        <DialogDescription>Cada unidade que entrou ou saiu de um estoque. Nada é apagado.</DialogDescription>
      </DialogHeader>
      {error ? <Alert>{error}</Alert> : null}
      {!data ? (
        <Spinner />
      ) : !data.movements.length ? (
        <p className="text-sm text-muted-foreground">Sem movimentações.</p>
      ) : (
        <ul className="divide-y text-sm">
          {data.movements.map((movement) => (
            <li key={movement.id} className="flex items-start justify-between gap-3 py-2">
              <div>
                <p className="font-medium">
                  {movement.kindLabel} · {movement.technicianName ?? 'Estoque central'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatDateTime(movement.createdAt)}
                  {movement.createdByName ? ` · ${movement.createdByName}` : ''}
                  {movement.note ? ` · ${movement.note}` : ''}
                </p>
              </div>
              <span className={`tabular-nums font-semibold ${movement.quantity > 0 ? 'text-emerald-700' : 'text-rose-700'}`}>
                {movement.quantity > 0 ? '+' : ''}
                {movement.quantity}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ---------------------------------------------------------------- import

const TEMPLATE_COLUMNS = ['nome', 'codigo_barras', 'codigo_interno', 'categoria', 'marca', 'unidade', 'custo', 'preco_tecnico', 'preco_sugerido', 'estoque_minimo', 'quantidade'];

const COLUMN_MAP: Record<string, string> = {
  nome: 'name',
  peca: 'name',
  produto: 'name',
  codigo_barras: 'barcode',
  codigo_de_barras: 'barcode',
  ean: 'barcode',
  codigo_interno: 'sku',
  sku: 'sku',
  categoria: 'category',
  marca: 'brand',
  unidade: 'unit',
  custo: 'costPrice',
  preco_custo: 'costPrice',
  preco_tecnico: 'technicianPrice',
  preco_prestador: 'technicianPrice',
  preco_sugerido: 'suggestedPrice',
  preco_venda: 'suggestedPrice',
  estoque_minimo: 'minStock',
  quantidade: 'quantity',
  qtd: 'quantity',
};

function columnKey(header: string) {
  return normalizeText(header).replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

function ImportForm({ onSaved }: { onSaved: (message: string) => void }) {
  const [rows, setRows] = useState<Array<Record<string, unknown>> | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function downloadTemplate() {
    const sheet = XLSX.utils.aoa_to_sheet([TEMPLATE_COLUMNS, ['Torneira de cozinha cromada', '7891234567890', '', 'Hidráulica', 'Marca X', 'un', '50,00', '75,00', '100,00', '5', '100']]);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Peças');
    XLSX.writeFile(book, 'modelo-pecas.xlsx');
  }

  async function read(file: File) {
    setError('');
    setFileName(file.name);
    try {
      const book = XLSX.read(await file.arrayBuffer(), { type: 'array' });
      const sheet = book.Sheets[book.SheetNames[0]];
      const raw = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '', raw: false });
      const mapped = raw
        .map((row) => {
          const result: Record<string, unknown> = {};
          for (const [header, value] of Object.entries(row)) {
            const key = COLUMN_MAP[columnKey(header)];
            if (key) result[key] = typeof value === 'string' ? value.trim() : value;
          }
          return result;
        })
        .filter((row) => String(row.name ?? '').trim() || String(row.barcode ?? '').trim());
      if (!mapped.length) throw new Error('Nenhuma linha com a coluna "nome" encontrada. Use o modelo.');
      setRows(mapped);
    } catch (reason) {
      setRows(null);
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  async function submit() {
    if (!rows) return;
    setBusy(true);
    setError('');
    try {
      const { result } = await partsApi<{ result: { created: number; updated: number; units: number } }>('/api/parts/import', { method: 'POST', json: { rows } });
      onSaved(`Importação concluída: ${result.created} nova(s), ${result.updated} atualizada(s), ${result.units} unidade(s) no estoque central.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
      setBusy(false);
    }
  }

  return (
    <div className="grid gap-4">
      <DialogHeader>
        <DialogTitle>Importar planilha de peças</DialogTitle>
        <DialogDescription>
          Cria as peças novas e atualiza as existentes (pelo código de barras ou pelo nome). A coluna “quantidade” entra no estoque central como compra. As imagens são
          adicionadas depois, em cada peça.
        </DialogDescription>
      </DialogHeader>
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" size="sm" onClick={downloadTemplate}>
          <Download className="h-4 w-4" />
          Baixar modelo
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-sm font-medium hover:bg-muted">
          <Upload className="h-4 w-4" />
          {fileName || 'Escolher arquivo (.xlsx ou .csv)'}
          <input type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(event) => event.target.files?.[0] && read(event.target.files[0])} />
        </label>
      </div>
      {rows ? (
        <div className="max-h-72 overflow-auto rounded-lg border">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-muted text-left">
              <tr>
                <th className="px-2 py-1.5">Nome</th>
                <th className="px-2 py-1.5">Código</th>
                <th className="px-2 py-1.5 text-right">Custo</th>
                <th className="px-2 py-1.5 text-right">Técnico</th>
                <th className="px-2 py-1.5 text-right">Sugerido</th>
                <th className="px-2 py-1.5 text-right">Qtd.</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, 200).map((row, index) => (
                <tr key={index} className="border-t">
                  <td className="px-2 py-1">{String(row.name ?? '')}</td>
                  <td className="px-2 py-1">{String(row.barcode ?? '')}</td>
                  <td className="px-2 py-1 text-right">{String(row.costPrice ?? '')}</td>
                  <td className="px-2 py-1 text-right">{String(row.technicianPrice ?? '')}</td>
                  <td className="px-2 py-1 text-right">{String(row.suggestedPrice ?? '')}</td>
                  <td className="px-2 py-1 text-right">{String(row.quantity ?? '')}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.length > 200 ? <p className="px-2 py-1 text-xs text-muted-foreground">…e mais {rows.length - 200} linha(s).</p> : null}
        </div>
      ) : null}
      {error ? <Alert>{error}</Alert> : null}
      <DialogFooter>
        <Button onClick={submit} disabled={busy || !rows}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Importar {rows ? `${rows.length} linha(s)` : ''}
        </Button>
      </DialogFooter>
    </div>
  );
}
