'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle2, Loader2, QrCode, RefreshCw, Smartphone, Unplug, XCircle } from 'lucide-react';
import { StatusBadge } from '@/components/status-badge';
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

function formatNumber(number: string | null) {
  if (!number) return '';
  const digits = number.replace(/\D/g, '');
  const local = digits.startsWith('55') ? digits.slice(2) : digits;
  if (local.length === 11) return `(${local.slice(0, 2)}) ${local.slice(2, 7)}-${local.slice(7)}`;
  if (local.length === 10) return `(${local.slice(0, 2)}) ${local.slice(2, 6)}-${local.slice(6)}`;
  return `+${digits}`;
}

const STATE_LABELS: Record<InstanceState, { text: string; tone: 'success' | 'warning' | 'danger' | 'neutral' }> = {
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
      <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/30 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Verificando o WhatsApp da empresa…
      </div>
    );
  }

  const label = STATE_LABELS[status.state];

  return (
    <div className="rounded-md border border-border bg-secondary/30 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium">WhatsApp da empresa</p>
          <p className="text-xs text-muted-foreground">
            Instância <span className="font-mono">{status.instanceName}</span> · um número por vez
          </p>
        </div>
        <StatusBadge tone={label.tone}>{label.text}</StatusBadge>
      </div>

      {!status.serverConfigured ? (
        <p className="text-sm text-rose-700">O WhatsApp ainda não está disponível na plataforma. Fale com o suporte do NextRotta.</p>
      ) : status.state === 'connected' ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3 rounded-md border border-emerald-200 bg-emerald-50 p-3">
            <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600" />
            <div className="min-w-0 text-sm">
              <p className="font-medium text-emerald-900">{formatNumber(status.number) || 'Número conectado'}</p>
              {status.profileName ? <p className="truncate text-emerald-800">{status.profileName}</p> : null}
            </div>
          </div>
          {confirmDisconnect ? (
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span>Desconectar este número? As notificações param até outro número ser conectado.</span>
              <Button type="button" variant="destructive" size="sm" onClick={disconnect} disabled={busy !== null}>
                {busy === 'disconnect' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Unplug className="h-4 w-4" />}
                Desconectar
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDisconnect(false)} disabled={busy !== null}>
                Cancelar
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => run('refresh', refresh)} disabled={busy !== null}>
                {busy === 'refresh' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                Verificar conexão
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setConfirmDisconnect(true)} disabled={busy !== null}>
                <Unplug className="h-4 w-4" />
                Trocar número
              </Button>
            </div>
          )}
        </div>
      ) : qr ? (
        <div className="grid gap-4 sm:grid-cols-[auto_minmax(0,1fr)] sm:items-center">
          <div className="mx-auto grid h-56 w-56 place-items-center rounded-lg border border-border bg-white p-2">
            {qr.base64 ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qr.base64} alt="QR Code para conectar o WhatsApp" className="h-full w-full object-contain" />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            )}
          </div>
          <div className="space-y-2 text-sm">
            <p className="font-medium">Leia o QR Code com o celular da empresa</p>
            <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
              <li>Abra o WhatsApp no celular.</li>
              <li>Toque em <strong>Mais opções</strong> ou <strong>Configurações</strong> → <strong>Dispositivos conectados</strong>.</li>
              <li>Toque em <strong>Conectar dispositivo</strong> e aponte para este código.</li>
            </ol>
            {qr.pairingCode ? (
              <p className="text-muted-foreground">
                Ou conecte com o código <span className="font-mono font-semibold text-foreground">{qr.pairingCode}</span>.
              </p>
            ) : null}
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Aguardando a leitura. O código é renovado automaticamente.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={showQr} disabled={busy !== null}>
              {busy === 'qr' ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
              Gerar novo código
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            {status.created
              ? 'Nenhum número conectado. Gere o QR Code e leia com o WhatsApp do celular da empresa.'
              : 'Conecte o WhatsApp da empresa para enviar as notificações aos técnicos. Basta ler um QR Code com o celular.'}
          </p>
          <Button type="button" onClick={status.created ? showQr : create} disabled={busy !== null}>
            {busy === 'create' || busy === 'qr' ? <Loader2 className="h-4 w-4 animate-spin" /> : status.created ? <QrCode className="h-4 w-4" /> : <Smartphone className="h-4 w-4" />}
            {status.created ? 'Gerar QR Code' : 'Conectar WhatsApp'}
          </Button>
        </div>
      )}

      {error || status.error ? (
        <p className="mt-3 flex items-start gap-2 text-sm text-rose-700">
          <XCircle className="mt-0.5 h-4 w-4 shrink-0" />
          {error || status.error}
        </p>
      ) : null}
    </div>
  );
}
