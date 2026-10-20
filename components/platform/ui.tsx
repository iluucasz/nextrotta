'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowDownUp, Search, ChevronLeft, ChevronRight, Inbox, LoaderCircle, AlertCircle, Plus, ArrowUpRight } from 'lucide-react';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { date } from './api';

export function Title({ title, description, action }: { title: string; description?: string; action?: ReactNode }) { return <div className="nr-heading"><div><p className="nr-eyebrow">NEXTROTTA / PLATAFORMA</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{action}</div>; }
export function Panel({ title, description, children, action, className = '' }: { title?: string; description?: string; children: ReactNode; action?: ReactNode; className?: string }) { return <section className={`nr-panel ${className}`}>{(title || action) && <div className="nr-panel-heading"><div><h2>{title}</h2>{description && <p>{description}</p>}</div>{action}</div>}{children}</section>; }
export function Badge({ children }: { children: ReactNode }) {
  const text = String(children);
  const tone = /Ativa|Ativo|Paga|Conclu|Pronta|Publicado|Ganho|Conectado|Online|Resolvido/.test(text) ? 'good' : /Falh|Vencida|Suspensa|Crítica|Cancelada|Perdido|Desconectado|Offline/.test(text) ? 'bad' : /Pendente|atraso|Novo|Alta|Provisionando|análise/.test(text) ? 'warn' : 'neutral';
  return <span className={`nr-badge ${tone}`}><i />{children}</span>;
}
export function Metric({ label, value, detail, accent }: { label: string; value: ReactNode; detail?: string; accent?: boolean }) { return <div className={`nr-metric ${accent ? 'accent' : ''}`}><span>{label}<ArrowUpRight size={16} /></span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>; }
export function Empty({ title = 'Nenhum resultado por aqui', text = 'Altere os filtros ou cadastre um novo registro para começar.' }: { title?: string; text?: string }) { return <div className="nr-empty"><Inbox size={32} /><h3>{title}</h3><p>{text}</p></div>; }
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) { return <div className="nr-empty" role="alert"><AlertCircle /><h3>Não foi possível carregar</h3><p>{message}</p>{onRetry && <button className="nr-btn primary" onClick={onRetry}>Tentar novamente</button>}</div>; }
export function Loading() { return <div className="nr-empty" role="status"><LoaderCircle className="animate-spin" /><h3>Carregando informações…</h3><p>Estamos preparando sua visão da operação.</p></div>; }
/** Screens load their own data (with their own loading and error states); this is just the frame. */
export function ScreenState({ children }: { children: ReactNode }) {
  return children;
}
export type Field = { key: string; label: string; type?: 'text' | 'number' | 'email' | 'date' | 'textarea' | 'select' | 'checkbox' | 'password'; options?: { value: string; label: string }[]; required?: boolean; min?: number; hint?: string };
export type FormValues = Record<string, string | number | boolean>;
export function Fields({ fields, values, setValues }: { fields: Field[]; values: FormValues; setValues: (values: FormValues) => void }) {
  return <div className="nr-form-grid">{fields.map(field => <label key={field.key} className={field.type === 'textarea' ? 'wide' : ''}><span>{field.label}{field.required ? ' *' : ''}</span>{field.type === 'textarea' ? <textarea rows={5} required={field.required} value={String(values[field.key] ?? '')} onChange={e => setValues({ ...values, [field.key]: e.target.value })} /> : field.type === 'select' ? <select required={field.required} value={String(values[field.key] ?? '')} onChange={e => setValues({ ...values, [field.key]: e.target.value })}>{!field.required && <option value="">Selecionar</option>}{field.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : field.type === 'checkbox' ? <input type="checkbox" checked={Boolean(values[field.key])} onChange={e => setValues({ ...values, [field.key]: e.target.checked })} /> : <input type={field.type || 'text'} min={field.type === 'number' ? field.min ?? 0 : undefined} step={field.type === 'number' ? 'any' : undefined} required={field.required} value={String(values[field.key] ?? '')} onChange={e => setValues({ ...values, [field.key]: field.type === 'number' && e.target.value !== '' ? Number(e.target.value) : e.target.value })} />}{field.hint && <small>{field.hint}</small>}</label>)}</div>;
}
export function Editor({ title, description = 'Confira os dados antes de salvar.', fields, initial, onSave, onClose, reason, strong, children, submit = 'Salvar alterações', validate }: { title: string; description?: string; fields: Field[]; initial: FormValues; onSave: (values: FormValues, reason: string) => void | boolean | Promise<void | boolean>; onClose: () => void; reason?: boolean; strong?: string; children?: ReactNode; submit?: string; validate?: (values: FormValues) => string }) {
  const [values, setValues] = useState(initial);
  const [why, setWhy] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  // Saving may call the API: the dialog stays open, with the API's message, if it fails.
  async function submitForm() {
    const message = validate?.(values); if (message) { setError(message); return; }
    if (strong && confirmation !== strong) return;
    setSaving(true); setError('');
    try { if ((await onSave(values, why)) !== false) onClose(); } catch (reason) { setError(reason instanceof Error ? reason.message : 'Não foi possível salvar.'); } finally { setSaving(false); }
  }
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}><DialogContent className="nr-dialog sm:max-w-2xl"><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription><form onSubmit={event => { event.preventDefault(); void submitForm(); }}><Fields fields={fields} values={values} setValues={setValues} />{children}{reason && <label className="nr-field">Motivo obrigatório<textarea required minLength={5} value={why} onChange={e => setWhy(e.target.value)} placeholder="Descreva por que está realizando esta ação." /></label>}{strong && <label className="nr-field">Digite “{strong}” para confirmar<input required value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>}{error && <p role="alert" className="nr-error">{error}</p>}<div className="nr-dialog-actions"><button type="button" className="nr-btn" onClick={onClose}>Voltar</button><button className="nr-btn primary" disabled={saving || (!!strong && confirmation !== strong)}>{saving ? 'Salvando…' : submit}</button></div></form></DialogContent></Dialog>;
}
export function Confirm({ title, description, reason, strong, onConfirm, onClose }: { title: string; description: string; reason?: boolean; strong?: string; onConfirm: (reason: string) => void | Promise<void>; onClose: () => void }) { return <Editor title={title} description={description} fields={[]} initial={{}} reason={reason} strong={strong} onSave={(_, why) => onConfirm(why)} onClose={onClose} submit="Confirmar" />; }
export type Column<T> = { key: string; label: string; render?: (row: T) => ReactNode };
export function DataTable<T extends { id: string }>({ rows, columns, actions, filters = [], emptyText, defaultSort, defaultDescending = false }: { rows: T[]; columns: Column<T>[]; actions?: (row: T) => ReactNode; filters?: { key: string; label: string; options: string[] }[]; emptyText?: string; defaultSort?: string; defaultDescending?: boolean }) {
  const [search, setSearch] = useState(''); const [selected, setSelected] = useState<Record<string, string>>({}); const [sort, setSort] = useState(defaultSort || columns[0]?.key); const [descending, setDescending] = useState(defaultDescending); const [page, setPage] = useState(1);
  const read = (row: T, key: string): unknown => (row as Record<string, unknown>)[key];
  const filtered = rows.filter(row => JSON.stringify(row).toLocaleLowerCase('pt-BR').includes(search.toLocaleLowerCase('pt-BR')) && filters.every(f => !selected[f.key] || String(read(row, f.key)) === selected[f.key])).sort((a, b) => { const left = read(a, sort), right = read(b, sort); return (typeof left === 'number' && typeof right === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), 'pt-BR', { numeric: true })) * (descending ? -1 : 1); });
  const pages = Math.max(1, Math.ceil(filtered.length / 8)); const current = Math.min(page, pages);
  return <div><div className="nr-table-tools"><label className="nr-search"><Search size={17} /><input aria-label="Buscar registros" placeholder="Buscar…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} /></label>{filters.map(f => <select key={f.key} aria-label={f.label} value={selected[f.key] || ''} onChange={e => { setSelected({ ...selected, [f.key]: e.target.value }); setPage(1); }}><option value="">{f.label}: todos</option>{f.options.map(o => <option key={o}>{o}</option>)}</select>)}</div>{filtered.length ? <div className="nr-table-scroll"><table><thead><tr>{columns.map(c => <th key={c.key}><button onClick={() => { setSort(c.key); setDescending(sort === c.key ? !descending : false); }}>{c.label}<ArrowDownUp size={12} /></button></th>)}{actions && <th>Ações</th>}</tr></thead><tbody>{filtered.slice((current - 1) * 8, current * 8).map(row => <tr key={row.id}>{columns.map(c => <td key={c.key}>{c.render ? c.render(row) : String(read(row, c.key) ?? '—')}</td>)}{actions && <td><div className="nr-row-actions">{actions(row)}</div></td>}</tr>)}</tbody></table></div> : <Empty text={emptyText} />}<div className="nr-pagination"><span>{filtered.length} registro{filtered.length !== 1 ? 's' : ''}</span><div><button aria-label="Página anterior" disabled={current === 1} onClick={() => setPage(current - 1)}><ChevronLeft size={16} /></button><span>{current} de {pages}</span><button aria-label="Próxima página" disabled={current >= pages} onClick={() => setPage(current + 1)}><ChevronRight size={16} /></button></div></div></div>;
}
export const options = (values: string[]) => values.map(value => ({ value, label: value }));
export function NewLink({ href, children }: { href: string; children: ReactNode }) { return <Link className="nr-btn primary" href={href}><Plus size={16} />{children}</Link>; }
export function RichText({ text }: { text: string }) { return <div className="nr-prose">{text.split('\n').map((line, i) => line.startsWith('## ') ? <h2 key={i}>{line.slice(3)}</h2> : line.startsWith('# ') ? <h1 key={i}>{line.slice(2)}</h1> : <p key={i}>{line.split(/(\*\*.*?\*\*)/g).map((part, j) => part.startsWith('**') ? <strong key={j}>{part.slice(2, -2)}</strong> : part)}</p>)}</div>; }
export function RecordDate({ value }: { value: unknown }) { return <span>{date(value, true)}</span>; }
