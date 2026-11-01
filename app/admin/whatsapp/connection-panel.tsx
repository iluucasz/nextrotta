'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, Loader2, Send, TriangleAlert, XCircle } from 'lucide-react';
import { Panel } from '@/components/management-ui';
import { HelpDot } from '@/components/modal-kit';
import { PhoneInput } from '@/components/phone-input';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { validatePhone } from '@/lib/whatsapp/phone';
import { InstanceCard, STATE_LABELS, type InstanceStatus } from './instance-card';
import { inputClassName, type TechnicianOption, type WhatsAppConfigForm } from './types';

interface ConnectionPanelProps {
  form: WhatsAppConfigForm;
  onChange: (patch: Partial<WhatsAppConfigForm>) => void;
  technicians: TechnicianOption[];
  /** True while an edit hasn't reached the server yet — sending would use the old settings. */
  unsaved: boolean;
}

type Feedback = { tone: 'success' | 'error'; text: string } | null;

export function ConnectionPanel({ form, onChange, technicians, unsaved }: ConnectionPanelProps) {
  const [state, setState] = useState<InstanceStatus['state'] | null>(null);
  // Test mode = a saved test number: every notification goes to it. The number typed here is kept
  // while the mode is off, so it can still receive a one-off test message.
  const [testMode, setTestMode] = useState(Boolean(form.testPhone));
  const [testNumber, setTestNumber] = useState(form.testPhone);
  const [testText, setTestText] = useState('Mensagem de teste do NextRotta ✅');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testFeedback, setTestFeedback] = useState<Feedback>(null);

  const connected = state === 'connected';
  const withoutPhone = technicians.filter((technician) => technician.status === 'active' && !technician.phone);
  const numberReady = validatePhone(testNumber).status === 'valid';

  function toggleTestMode(enabled: boolean) {
    setTestMode(enabled);
    onChange({ testPhone: enabled ? testNumber : '' });
  }

  function changeTestNumber(value: string) {
    setTestNumber(value);
    if (testMode) onChange({ testPhone: value });
  }

  async function handleSendTest() {
    setIsSendingTest(true);
    setTestFeedback(null);

    try {
      const response = await fetch('/api/whatsapp/test-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: testNumber, message: testText }),
      });
      const data = await response.json().catch(() => null);

      if (!response.ok) throw new Error(data?.error || 'Não foi possível enviar.');

      setTestFeedback({ tone: 'success', text: 'Mensagem enviada. Confira no WhatsApp.' });
    } catch (error) {
      setTestFeedback({ tone: 'error', text: error instanceof Error ? error.message : 'Não foi possível enviar.' });
    } finally {
      setIsSendingTest(false);
    }
  }

  const label = state ? STATE_LABELS[state] : null;

  return (
    <div className="wa-stack">
      <div className="wa-grid">
        <Panel
          title="WhatsApp da empresa"
          help="O número que envia as notificações para os técnicos. Cada empresa tem o seu, e só um número fica conectado por vez."
          badge={label ? <StatusBadge tone={label.tone}>{label.text}</StatusBadge> : undefined}
        >
          <InstanceCard onStatus={(status) => setState(status.state)} />
        </Panel>

        <Panel title="Teste" help="Confira as mensagens antes de liberar para os técnicos. Com o modo teste ligado, todas as notificações vão para o número de teste e nenhum técnico recebe.">
          <div className="wa-toggle">
            <span>
              Modo teste
              <HelpDot label="Modo teste" text="Desvia todas as notificações para o número de teste. Desligado, elas vão para os técnicos normalmente." />
            </span>
            <Switch checked={testMode} onCheckedChange={toggleTestMode} aria-label="Modo teste" />
          </div>

          <label className="wa-field">
            <span>Número de teste</span>
            <PhoneInput
              value={testNumber}
              onChange={changeTestNumber}
              className={inputClassName}
              checkWhatsApp={connected}
              hint={testMode && !numberReady ? <span className="text-amber-700">Informe o número para o modo teste valer.</span> : null}
            />
          </label>

          <div className="wa-test-send">
            <input value={testText} onChange={(event) => setTestText(event.target.value)} className={inputClassName} aria-label="Mensagem de teste" />
            <Button type="button" onClick={handleSendTest} disabled={isSendingTest || unsaved || !connected || !numberReady || !testText.trim()}>
              {isSendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar teste
            </Button>
          </div>
          {!connected ? <p className="wa-hint">Conecte o WhatsApp da empresa para enviar um teste.</p> : null}
          {testFeedback ? (
            <p className={`wa-feedback ${testFeedback.tone}`}>
              {testFeedback.tone === 'success' ? <CheckCircle2 size={16} /> : <XCircle size={16} />}
              {testFeedback.text}
            </p>
          ) : null}
        </Panel>
      </div>

      {withoutPhone.length ? (
        <div className="wa-warning" role="status">
          <TriangleAlert size={18} />
          <span>
            <strong>{withoutPhone.length === 1 ? '1 técnico' : `${withoutPhone.length} técnicos`} sem número</strong> não recebem notificações:{' '}
            {withoutPhone
              .slice(0, 4)
              .map((technician) => technician.name)
              .join(', ')}
            {withoutPhone.length > 4 ? ` e mais ${withoutPhone.length - 4}` : ''}.
          </span>
          <Link href="/admin/technicians">Cadastrar números</Link>
        </div>
      ) : null}
    </div>
  );
}
