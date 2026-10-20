'use client';

import { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { Button } from '@/components/ui/button';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHODS, type PartsSettings, type PaymentMethod } from '@/lib/parts/types';
import { Alert, Field, inputClassName, partsApi, Spinner, useParts, inputClass } from '../shared';

export function SettingsTab() {
  const { data, error } = useParts<{ settings: PartsSettings }>('/api/parts/settings');
  const [form, setForm] = useState<PartsSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: 'success' | 'danger'; text: string } | null>(null);

  useEffect(() => {
    if (data) setForm(data.settings);
  }, [data]);

  function toggle(method: PaymentMethod) {
    setForm((current) =>
      current
        ? { ...current, paymentMethods: current.paymentMethods.includes(method) ? current.paymentMethods.filter((item) => item !== method) : [...current.paymentMethods, method] }
        : current,
    );
  }

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!form) return;
    setBusy(true);
    setMessage(null);
    try {
      const result = await partsApi<{ settings: PartsSettings }>('/api/parts/settings', { method: 'PUT', json: form });
      setForm(result.settings);
      setMessage({ tone: 'success', text: 'Configurações salvas.' });
    } catch (reason) {
      setMessage({ tone: 'danger', text: reason instanceof Error ? reason.message : String(reason) });
    } finally {
      setBusy(false);
    }
  }

  if (!form) return error ? <Alert>{error}</Alert> : <Spinner />;

  return (
    <form onSubmit={save} className="grid gap-4">
      <DataPanel
        title="Formas de pagamento"
        description="O que os técnicos podem oferecer ao cliente. Pix, link e cartão caem na conta do Mercado Pago do próprio técnico, que precisa conectá-la em “Minhas peças”."
      >
        <div className="grid gap-2">
          {PAYMENT_METHODS.map((method) => (
            <label key={method} className="flex items-center gap-3 text-sm">
              <input type="checkbox" checked={form.paymentMethods.includes(method)} onChange={() => toggle(method)} />
              {PAYMENT_METHOD_LABELS[method]}
            </label>
          ))}
        </div>
      </DataPanel>
      <DataPanel title="Recibo e acerto">
        <div className="grid gap-4 sm:max-w-xl">
          <Field label="Rodapé do recibo" hint="Vai no fim do recibo enviado ao cliente pelo WhatsApp (garantia, contato…).">
            <textarea
              className={inputClass('min-h-20 py-2')}
              value={form.receiptFooter}
              maxLength={500}
              onChange={(event) => setForm({ ...form, receiptFooter: event.target.value })}
              placeholder="Ex.: Garantia de 90 dias. Dúvidas: (11) 0000-0000"
            />
          </Field>
          <Field label="Dia do acerto" hint="Até que dia do mês seguinte o técnico paga as peças vendidas. Aparece na tela do técnico.">
            <input
              className={inputClass('w-24')}
              type="number"
              min={1}
              max={28}
              value={form.settlementDay}
              onChange={(event) => setForm({ ...form, settlementDay: Number(event.target.value) })}
            />
          </Field>
        </div>
      </DataPanel>
      {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      <div>
        <Button type="submit" disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          Salvar
        </Button>
      </div>
    </form>
  );
}
