'use client';

import Link from 'next/link';
import { useState } from 'react';
import { CheckCircle2, FlaskConical, Loader2, Send, UserX, XCircle } from 'lucide-react';
import { DataPanel } from '@/components/data-panel';
import { PhoneInput } from '@/components/phone-input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { validatePhone } from '@/lib/whatsapp/phone';
import { InstanceCard } from './instance-card';
import { inputClassName, type TechnicianOption, type WhatsAppConfigForm } from './types';

interface ConnectionPanelProps {
  form: WhatsAppConfigForm;
  onChange: (patch: Partial<WhatsAppConfigForm>) => void;
  technicians: TechnicianOption[];
  /** True while an edit hasn't reached the server yet — sending would use the old settings. */
  unsaved: boolean;
}

type Feedback = { tone: 'success' | 'error'; text: string } | null;

function FeedbackLine({ feedback }: { feedback: Feedback }) {
  if (!feedback) return null;

  const Icon = feedback.tone === 'success' ? CheckCircle2 : XCircle;
  return (
    <p className={`flex items-start gap-2 text-sm ${feedback.tone === 'success' ? 'text-emerald-700' : 'text-rose-700'}`}>
      <Icon className="mt-0.5 h-4 w-4 shrink-0" />
      {feedback.text}
    </p>
  );
}

export function ConnectionPanel({ form, onChange, technicians, unsaved }: ConnectionPanelProps) {
  const [connected, setConnected] = useState(false);
  // Test mode = a saved test number: every notification goes to it. The number typed here is kept
  // while the mode is off, so it can still receive a one-off test message.
  const [testMode, setTestMode] = useState(Boolean(form.testPhone));
  const [testNumber, setTestNumber] = useState(form.testPhone);
  const [testText, setTestText] = useState('Mensagem de teste do NextRotta ✅');
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [testFeedback, setTestFeedback] = useState<Feedback>(null);

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

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)] xl:items-start">
      <div className="space-y-5">
        <DataPanel title="Conexão" description="O WhatsApp da empresa, que envia as notificações para os técnicos.">
          <InstanceCard onStatus={(status) => setConnected(status.state === 'connected')} />
        </DataPanel>

        <DataPanel
          title="Técnicos sem WhatsApp"
          description={withoutPhone.length ? 'Técnicos ativos que não recebem notificações por falta de número.' : 'Todos os técnicos ativos têm número cadastrado.'}
        >
          {withoutPhone.length ? (
            <div className="space-y-2">
              <ul className="space-y-1.5 text-sm">
                {withoutPhone.map((technician) => (
                  <li key={technician.id} className="flex items-center gap-2">
                    <UserX className="h-4 w-4 text-amber-600" />
                    {technician.name}
                  </li>
                ))}
              </ul>
              <Link href="/admin/technicians" className="inline-block text-sm font-medium text-primary hover:underline">
                Cadastrar números em Técnicos →
              </Link>
            </div>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="h-4 w-4" />
              Tudo certo.
            </p>
          )}
        </DataPanel>
      </div>

      <DataPanel title="Área de teste" description="Confira as mensagens antes de liberar para os técnicos.">
        <div className="space-y-4">
          <div
            className={`flex items-center justify-between gap-4 rounded-md border px-3 py-3 ${
              testMode ? 'border-amber-300 bg-amber-50' : 'border-border bg-background'
            }`}
          >
            <div className="flex items-start gap-3">
              <FlaskConical className={`mt-0.5 h-5 w-5 shrink-0 ${testMode ? 'text-amber-600' : 'text-muted-foreground'}`} />
              <div>
                <p className="text-sm font-medium">Modo teste {testMode ? 'ligado' : 'desligado'}</p>
                <p className="text-xs text-muted-foreground">
                  {testMode
                    ? 'Todas as notificações vão para o número de teste. Nenhum técnico recebe.'
                    : 'As notificações vão para os técnicos normalmente.'}
                </p>
              </div>
            </div>
            <Switch checked={testMode} onCheckedChange={toggleTestMode} aria-label="Modo teste" />
          </div>

          <label className="block text-sm">
            <span className="mb-1.5 block font-medium">Número de teste</span>
            <PhoneInput
              value={testNumber}
              onChange={changeTestNumber}
              className={inputClassName}
              checkWhatsApp={connected}
              hint={testMode && !numberReady ? <span className="text-amber-700">Informe o número para o modo teste valer.</span> : 'Recebe as notificações no modo teste e a mensagem de teste abaixo.'}
            />
          </label>

          <div className="space-y-3 border-t border-border pt-4">
            <p className="text-sm font-medium">Mensagem de teste</p>
            <textarea
              value={testText}
              onChange={(event) => setTestText(event.target.value)}
              rows={3}
              className={`${inputClassName} py-2`}
              aria-label="Mensagem de teste"
            />
            <Button type="button" onClick={handleSendTest} disabled={isSendingTest || unsaved || !connected || !numberReady || !testText.trim()}>
              {isSendingTest ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Enviar teste agora
            </Button>
            {!connected ? <p className="text-xs text-muted-foreground">Conecte o WhatsApp da empresa para enviar um teste.</p> : null}
            <FeedbackLine feedback={testFeedback} />
          </div>
        </div>
      </DataPanel>
    </div>
  );
}
