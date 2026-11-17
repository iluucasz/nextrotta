'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ModalNotice, ModalSection } from '@/components/modal-kit';
import { MODAL_BODY_CLASS, MODAL_DESCRIPTION_CLASS, MODAL_FOOTER_CLASS, MODAL_HEADER_CLASS, MODAL_TITLE_CLASS } from '@/components/modal-kit';
import { BRAZIL_STATES, formatPlate, VEHICLE_STATUS_LABELS, VEHICLE_STATUSES } from '@/lib/vehicles/rules';
import type { AssignmentRow, VehicleRow } from '@/lib/vehicles/store';
import { brDay, call } from './call';
import { carName, Field, FIELD, type Technician } from './kit';
import './cars.css';

const brDateTime = brDay;

// The rest of a car's data (model, year, Renavam, due dates...) comes back from the plate lookup, never typed here.
// Only the due dates of licensing and insurance are typed (when the car is edited): the alerts of the bell depend on them.
type Form = { plate: string; status: string; technicianId: string; licensingDue: string; insuranceDue: string; renavam: string; state: string };

const emptyForm: Form = { plate: '', status: 'active', technicianId: '', licensingDue: '', insuranceDue: '', renavam: '', state: '' };

const toForm = (car: VehicleRow): Form => ({
  plate: formatPlate(car.plate),
  status: car.status,
  technicianId: car.technicianId ?? '',
  licensingDue: car.licensingDue ?? '',
  insuranceDue: car.insuranceDue ?? '',
  renavam: car.renavam ?? '',
  state: car.state ?? '',
});

/** Add (car = null) or edit a car: its data, who has it, and its history. */
export function CarDialog({
  car,
  technicians,
  onClose,
  onSaved,
}: {
  car: VehicleRow | null;
  technicians: Technician[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState<Form>(car ? toForm(car) : emptyForm);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [history, setHistory] = useState<AssignmentRow[] | null>(null);
  const confirmRef = useRef<HTMLDivElement>(null);
  const set = (key: keyof Form) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  // The confirmation sits at the end of a scrolling dialog: bring it into view when it opens.
  useEffect(() => {
    if (confirmRemove) confirmRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [confirmRemove]);

  useEffect(() => {
    if (!car) return;
    let active = true;
    call<{ history: AssignmentRow[] }>(`/api/vehicles/${car.id}`)
      .then((data) => active && setHistory(data.history))
      .catch(() => active && setHistory([]));
    return () => {
      active = false;
    };
  }, [car]);

  async function run(action: () => Promise<unknown>) {
    setSaving(true);
    setError('');
    try {
      await action();
      onSaved();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Não foi possível concluir.');
      setSaving(false);
    }
  }

  const save = (event: React.FormEvent) => {
    event.preventDefault();
    void run(() =>
      call(car ? `/api/vehicles/${car.id}` : '/api/vehicles', { method: car ? 'PATCH' : 'POST', body: JSON.stringify(car ? form : { plate: form.plate, technicianId: form.technicianId }) }),
    );
  };

  // The technician who has the car now may have been deactivated since: keep him in the list so the select is not blank.
  const options = car?.technicianId && !technicians.some((technician) => technician.id === car.technicianId)
    ? [...technicians, { id: car.technicianId, name: `${car.technicianName ?? 'Técnico'} (inativo)` }]
    : technicians;

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="flex max-h-[92vh] flex-col gap-0 p-0 sm:max-w-2xl">
        <DialogHeader className={MODAL_HEADER_CLASS}>
          <DialogTitle className={MODAL_TITLE_CLASS}>{car ? `Carro ${formatPlate(car.plate)}` : 'Adicionar carro'}</DialogTitle>
          <DialogDescription className={MODAL_DESCRIPTION_CLASS}>{car ? carName(car) : 'Informe a placa e com qual técnico o carro fica.'}</DialogDescription>
        </DialogHeader>
        <form onSubmit={save} className="flex min-h-0 flex-1 flex-col">
          <div className={`${MODAL_BODY_CLASS} space-y-7`}>
            <ModalSection title="Carro">
              <div className="cr-grid">
                <Field label="Placa" wide={!car}>
                  <input className={FIELD} value={form.plate} onChange={set('plate')} placeholder="ABC-1D23" autoCapitalize="characters" required />
                </Field>
                {car ? (
                  <Field label="Situação">
                    <select className={FIELD} value={form.status} onChange={set('status')}>
                      {VEHICLE_STATUSES.map((status) => (
                        <option key={status} value={status}>
                          {VEHICLE_STATUS_LABELS[status]}
                        </option>
                      ))}
                    </select>
                  </Field>
                ) : null}
              </div>
            </ModalSection>

            <ModalSection title="Com o técnico" help="Escolha quem está com o carro. Ao trocar, o histórico guarda quem ficou com ele e por quanto tempo.">
              <select className={FIELD} value={form.technicianId} onChange={set('technicianId')} aria-label="Técnico">
                <option value="">Sem técnico (no pátio)</option>
                {options.map((technician) => (
                  <option key={technician.id} value={technician.id}>
                    {technician.name}
                  </option>
                ))}
              </select>
            </ModalSection>

            {car ? (
              <ModalSection
                title="Consulta de multas"
                help="Para o sistema consultar as multas deste carro toda semana, ele precisa do Renavam e do estado onde o carro é emplacado (UF). Está no documento do carro (CRLV)."
              >
                <div className="cr-grid">
                  <Field label="Renavam">
                    <input className={FIELD} inputMode="numeric" value={form.renavam} onChange={set('renavam')} />
                  </Field>
                  <Field label="Estado (UF)">
                    <select className={FIELD} value={form.state} onChange={set('state')}>
                      <option value="">Escolha</option>
                      {BRAZIL_STATES.map((uf) => (
                        <option key={uf} value={uf}>
                          {uf}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>
              </ModalSection>
            ) : null}

            {car ? (
              <ModalSection
                title="Documentos"
                help="Quando o licenciamento ou o seguro estiver para vencer, o sino avisa. Depois de regularizar, é só colocar aqui o novo vencimento e o aviso some. Guarde os papéis do carro na Biblioteca."
              >
                <div className="cr-grid">
                  <Field label="Licenciamento vence em">
                    <input className={FIELD} type="date" value={form.licensingDue} onChange={set('licensingDue')} />
                  </Field>
                  <Field label="Seguro vence em">
                    <input className={FIELD} type="date" value={form.insuranceDue} onChange={set('insuranceDue')} />
                  </Field>
                </div>
                <a className="cr-link" href="/admin/library">
                  Guardar documentos do carro na Biblioteca
                </a>
              </ModalSection>
            ) : null}

            {car ? (
              <ModalSection title="Histórico">
                {history === null ? (
                  <p className="cr-muted">Carregando…</p>
                ) : history.length === 0 ? (
                  <p className="cr-muted">Ainda não ficou com nenhum técnico.</p>
                ) : (
                  <ul className="cr-history">
                    {history.map((row) => (
                      <li key={row.id}>
                        <strong>{row.technicianName ?? 'Técnico removido'}</strong>
                        <span>
                          {brDateTime(row.assignedAt)} → {row.releasedAt ? brDateTime(row.releasedAt) : 'até hoje'}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </ModalSection>
            ) : null}

            {error ? <ModalNotice tone="error">{error}</ModalNotice> : null}
            {confirmRemove && car ? (
              <div ref={confirmRef}>
              <ModalNotice tone="warning">
                Remover o carro {formatPlate(car.plate)}? Ele sai da lista e a placa fica livre; o histórico é mantido.
                <span className="cr-confirm">
                  <button type="button" className="mg-button" disabled={saving} onClick={() => setConfirmRemove(false)}>
                    Voltar
                  </button>
                  <button type="button" className="mg-button mg-button-dark" disabled={saving} onClick={() => void run(() => call(`/api/vehicles/${car.id}`, { method: 'DELETE' }))}>
                    Remover
                  </button>
                </span>
              </ModalNotice>
              </div>
            ) : null}
          </div>
          <DialogFooter className={MODAL_FOOTER_CLASS}>
            {car && !confirmRemove ? (
              <button type="button" className="mg-button cr-remove" disabled={saving} onClick={() => setConfirmRemove(true)}>
                Remover carro
              </button>
            ) : null}
            <button type="button" className="mg-button" disabled={saving} onClick={onClose}>
              Cancelar
            </button>
            <button type="submit" className="mg-button mg-button-dark" disabled={saving}>
              {saving ? <Loader2 size={16} className="animate-spin" /> : null} {car ? 'Salvar' : 'Adicionar'}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

