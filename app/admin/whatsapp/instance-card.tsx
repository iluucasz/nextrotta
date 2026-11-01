'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, QrCode, RefreshCw, Smartphone, Unplug, XCircle } from 'lucide-react';
import { HelpDot } from '@/components/modal-kit';
import { Button } from '@/components/ui/button';

type InstanceState = 'not_created' | 'connected' | 'connecting' | 'disconnected' | 'unknown';

export interface InstanceStatus {
  serverConfigured: boolean;
  instanceName: string;
  created: boolean;
  state: InstanceState;
  number: string | null;
  profileName: string | null;
  error: string | null;
}

type QrCode = { base64: string | null; pairingCode: string | null };

/** While the QR code is on screen: check whether it was scanned, and renew it before it expires. */
const POLL_MS = 4_000;
const QR_REFRESH_MS = 30_000;

async function call<T>(path: string, method = 'GET'): Promise<T> {
  const response = await fetch(path, { method, cache: 'no-store' });
  const data = await response.json().catch(() => null);
  if (!response.ok) throw new Error(data?.error || 'Não foi possível falar com o WhatsApp.');
  return data as T;
}

export function formatNumber(number: string | null) {
  if (!number) return '';
  const digits = number.replace(/\D/g, '');
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `+${digits}`;
}

export const STATE_LABELS: Record<InstanceState, { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
  not_created: { text: 'Não conectado', tone: 'neutral' },
  connected: { text: 'Conectado', tone: 'success' },
  connecting: { text: 'Aguardando leitura', tone: 'warning' },
  disconnected: { text: 'Desconectado', tone: 'danger' },
  unknown: { text: 'Sem resposta', tone: 'danger' },
};

/**
 * The organization's WhatsApp: its own instance (named after its subdomain), connected by reading a
 * QR code — one number at a time. The Evolution server itself is never shown.
 */
export function InstanceCard({ onStatus }: { onStatus?: (status: InstanceStatus) => void }) {
  const [status, setStatus] = useState<InstanceStatus | null>(null);
  const [qr, setQr] = useState<QrCode | null>(null);
  const [busy, setBusy] = useState<'create' | 'qr' | 'disconnect' | 'refresh' | null>(null);
  const [error, setError] = useState('');
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const lastQrAt = useRef(0);

  const applyStatus = useCallback(
    (next: InstanceStatus) => {
      setStatus(next);
      onStatus?.(next);
      if (next.state === 'connected') setQr(null);
    },
    [onStatus],
  );

  const refresh = useCallback(async () => {
    try {
      applyStatus(await call<InstanceStatus>('/api/whatsapp/instance'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível carregar.');
    }
  }, [applyStatus]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadQr = useCallback(async () => {
    const result = await call<{ connected: boolean; qr: QrCode | null }>('/api/whatsapp/instance/qrcode');
    lastQrAt.current = Date.now();
    if (result.connected) {
      setQr(null);
      await refresh();
    } else {
      setQr(result.qr);
    }
  }, [refresh]);

  // While the QR code is showing: watch for the scan and keep the code fresh.
  useEffect(() => {
    if (!qr) return;
    const timer = window.setInterval(async () => {
      try {
        const next = await call<InstanceStatus>('/api/whatsapp/instance');
        if (next.state === 'connected') {
          applyStatus(next);
          return;
        }
        if (Date.now() - lastQrAt.current > QR_REFRESH_MS) await loadQr();
      } catch {
        // A missed poll is fine; the next one tries again.
      }
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [qr, applyStatus, loadQr]);

  async function run(kind: 'create' | 'qr' | 'disconnect' | 'refresh', action: () => Promise<void>) {
    setBusy(kind);
    setError('');
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível concluir.');
    } finally {
      setBusy(null);
    }
  }

  const create = () =>
    run('create', async () => {
      const result = await call<{ status: InstanceStatus; qr: QrCode | null }>('/api/whatsapp/instance', 'POST');
      applyStatus(result.status);
      lastQrAt.current = Date.now();
      if (result.status.state !== 'connected') setQr(result.qr);
    });

  const showQr = () => run('qr', loadQr);

  const disconnect = () =>
    run('disconnect', async () => {
      applyStatus(await call<InstanceStatus>('/api/whatsapp/instance', 'DELETE'));
      setConfirmDisconnect(false);
    });

  if (!status) {
    return (
      <div className="wa-wait">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando o WhatsApp da empresa…
      </div>
    );
  }

  return (
    <div className="wa-instance">
      {!status.serverConfigured ? (
        <p className="wa-error">O WhatsApp ainda não está disponível na plataforma. Fale com o suporte do NextRotta.</p>
      ) : status.state === 'connected' ? (
        <>
          <div className="wa-number">
            <span className="wa-tile ok">
              <CheckCircle2 size={22} />
            </span>
            <div>
              <strong>{formatNumber(status.number) || 'Número conectado'}</strong>
              {status.profileName ? <small>{status.profileName}</small> : null}
            </div>
          </div>
          {confirmDisconnect ? (
            <div className="wa-confirm">
              <span>Desconectar este número? As notificações param até conectar outro.</span>
              <div>
                <Button type="button" variant="destructive" size="sm" onClick={disconnect} disabled={busy !== null}>
                  {busy === 'disconnect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                  Desconectar
                </Button>
                <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDisconnect(false)} disabled={busy !== null}>
                  Cancelar
                </Button>
              </div>
            </div>
          ) : (
            <div className="wa-actions">
              <Button type="button" variant="outline" onClick={() => run('refresh', refresh)} disabled={busy !== null}>
                {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Verificar
              </Button>
              <Button type="button" variant="outline" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>
                <Unplug className="h-4 w-4" />
                Trocar número
              </Button>
            </div>
          )}
        </>
      ) : qr ? (
        <div className="wa-qr">
          <div className="wa-qr-box">
            {qr.base64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.base64} alt="QR Code para conectar o WhatsApp" />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="wa-qr-side">
            <h3>
              Leia com o celular da empresa
              <HelpDot
                label="Como conectar"
                text={`No celular: WhatsApp → Mais opções ou Configurações → Dispositivos conectados → Conectar dispositivo, e aponte para este código.${qr.pairingCode ? `\nOu conecte com o código ${qr.pairingCode}.` : ''}\nO código é renovado sozinho.`}
              />
            </h3>
            <p>WhatsApp › Dispositivos conectados › Conectar dispositivo</p>
            <p className="wa-waiting">
              <Loader2 className="h-4 w-4 animate-spin" /> Aguardando a leitura
            </p>
            <Button type="button" variant="outline" onClick={showQr} disabled={busy !== null}>
              {busy === 'qr' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Novo código
            </Button>
          </div>
        </div>
      ) : (
        <div className="wa-number">
          <span className="wa-tile">
            <Smartphone size={22} />
          </span>
          <div>
            <strong>Nenhum número conectado</strong>
            <small>Basta ler um QR Code com o celular da empresa.</small>
          </div>
          <Button type="button" size="lg" onClick={status.created ? showQr : create} disabled={busy !== null} className="wa-connect">
            {busy === 'create' || busy === 'qr' ? <Loader2 className="h-4 w-4 animate-spin" /> : status.created ? <QrCode className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
            {status.created ? 'Gerar QR Code' : 'Conectar WhatsApp'}
          </Button>
        </div>
      )}

      {error || status.error ? (
        <p className="wa-error">
          <XCircle size={16} />
          {error || status.error}
        </p>
      ) : null}
    </div>
  );
}
